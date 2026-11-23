// SnagCraft app shell — top bar, annotation toolbar, editor stage, status line.
// Talks to the locked Editor API and the locked Tauri command set only.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  enable as autostartEnable,
  disable as autostartDisable,
  isEnabled as autostartIsEnabled,
} from "@tauri-apps/plugin-autostart";
import { Editor, type ToolId } from "../editor/editor";
import { cropDataUrl, selectRegion, type Box } from "./region";
import { TextBar, type TextTarget } from "./textbar";
import {
  DEFAULT_INTERVAL,
  DEFAULT_PATTERN,
  LAST_UPDATE_CHECK_KEY,
  SKIPPED_VERSION_KEY,
  SettingsPanel,
  UPDATE_CHECK_INTERVAL_MS,
  applyTheme,
  buildFilename,
  expandPattern,
  formatLabel,
  recFormatLabel,
  readExportSettings,
  readTheme,
  saveExportSettings,
  type ExportFormat,
  type ExportSettings,
  type RecFormat,
  type DefaultToolStatus,
  type HotkeyBackend,
  type HotkeyStatus,
  type Theme,
} from "./settings";

type CaptureResult = { dataUrl: string; width: number; height: number };
/**
 * Newest published release, as answered by the `check_for_update` command
 * (src-tauri/src/update.rs). Nothing is downloaded — the UI links to the page.
 */
interface UpdateInfo {
  current: string;
  latest: string;
  newer: boolean;
  title: string;
  url: string;
  notes: string;
}
/** Remembered "a newer release exists" answer, so a restart needs no request. */
const UPDATE_AVAILABLE_KEY = "snagcraft:update-available";
/** One connected display, as reported by the backend (issue #1). */
type MonitorInfo = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
};
/** One capturable window, as reported by the backend (Windows/macOS). */
type WindowInfo = {
  id: number;
  appName: string;
  title: string;
  width: number;
  height: number;
};
type StatusKind = "info" | "success" | "error" | "recording";
type CaptureMode = "full" | "region" | "window" | "monitor" | "scrolling" | "interval";
/** Recording modes: the whole screen via the OS picker, a dragged region, or one window. */
type RecMode = "full" | "region" | "window";

/** Modes that hand the choice to the OS portal picker. */
const PICKER_MODES = ["window", "monitor"] as const;
type PickerMode = (typeof PICKER_MODES)[number];

const isPickerMode = (value: string | undefined): value is PickerMode =>
  value === "window" || value === "monitor";

/** Status line shown while a mode is being prepared. */
const CAPTURE_READY: Record<CaptureMode, string> = {
  full: "Capturing screen…",
  region: "Preparing region capture…",
  window: "Opening the window picker…",
  monitor: "Opening the screen picker…",
  scrolling: "Preparing scrolling capture…",
  interval: "Starting interval capture…",
};

/** What the countdown overlay calls the pending grab. */
const CAPTURE_HINT: Record<CaptureMode, string> = {
  full: "Full screen",
  region: "Region",
  window: "Window",
  monitor: "Screen",
  scrolling: "Scrolling capture",
  interval: "Interval capture",
};

/** Portal dismissals and denials arrive as plain errors — read them as cancels. */
const isCancelled = (message: string): boolean =>
  /cancel|dismiss|denied|deny|abort|nothing selected/i.test(message);

/**
 * A *recording* cancel is only a user dismissing the picker. Backend failures
 * also mention cancel/abort ("pipeline aborted after cancellation") — those are
 * real errors and must surface verbatim, so require the whole message to be a
 * bare cancel signal rather than any message containing the word.
 */
const isRecordingCancel = (message: string): boolean => {
  const text = message.trim().replace(/[.!]+$/, "").toLowerCase();
  if (text === "" || text.length > 80) return false;
  return /^(?:user\s+)?(?:cancel(?:l)?ed|cancel|abort(?:ed)?|dismiss(?:ed)?|nothing selected|no screen (?:was )?(?:picked|selected))(?:\s+by\s+user)?$/.test(
    text,
  );
};

/** Backend progress payload for a live manual-scroll stitch. */
type ScrollingStatus = {
  frames?: number;
  height?: number;
  confidence?: number;
  warning?: string | null;
};

/** Additive Editor API (Wave 2/3, contract-locked). */
type InkApi = {
  setColor(hex: string): void;
  getColor(): string;
  setStrokeWidth(width: number): void;
  getStrokeWidth(): number;
};
type InkEditor = Editor & InkApi;

/**
 * Wave 4 added the bucket tool and Wave 5 adds spotlight / highlighter /
 * callout to `ToolId`. Widen locally so the shell typechecks against either
 * revision of the editor module while the tracks land.
 */
type ShellToolId =
  | ToolId
  | "brush"
  | "bucket"
  | "spotlight"
  | "highlighter"
  | "callout"
  | "magnify";

/** Wave 5 blur tuning. Optional so the shell builds against either editor revision. */
type BlurMode = "gaussian" | "pixelate" | "blackout";
type BlurApi = {
  setBlurMode?(mode: BlurMode): void;
  getBlurMode?(): BlurMode;
  setBlurRadius?(radius: number): void;
  getBlurRadius?(): number;
};

/**
 * Wave 13: drop-shadow for the tools that draw a shape (arrow, rect, text,
 * callout, step). One flat snapshot, mirroring the editor's own ShadowStyle.
 */
type ShadowStyle = {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
};

/**
 * Wave 7 style contract: one flat snapshot of everything the editor draws with,
 * so the shell can save it as a named preset. Methods stay optional, so the
 * shell also builds against an editor revision that has not shipped them yet.
 */
type EditorStyle = {
  color: string;
  strokeWidth: number;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  blurMode: BlurMode;
  blurRadius: number;
  shadow: ShadowStyle;
};
type StyleApi = {
  getStyle?(): Partial<EditorStyle>;
  applyStyle?(patch: Partial<EditorStyle>): void;
};

/** Shadow API landed by track E; optional so the shell also builds without it. */
type ShadowApi = {
  getShadow?(): Partial<ShadowStyle>;
  setShadow?(patch: Partial<ShadowStyle>): void;
};

type ChangeDetail = { tool?: ToolId; canUndo?: boolean; canRedo?: boolean };

const icon = (body: string, size = 16, weight = 1.4): string =>
  `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  capture: icon(
    `<rect x="2.4" y="3" width="11.2" height="7.6" rx="1.5"/><path d="M6 13.4h4M8 10.6v2.8"/>`,
  ),
  caret: icon(`<path d="M4.6 6.4 8 9.8l3.4-3.4"/>`, 12),
  full: icon(`<rect x="2.2" y="2.8" width="11.6" height="8.4" rx="1.4"/><path d="M5.4 13.4h5.2"/>`),
  window: icon(
    `<rect x="2.4" y="2.8" width="11.2" height="10.4" rx="1.6"/><path d="M2.4 5.9h11.2"/>`,
  ),
  monitor: icon(
    `<rect x="1.6" y="2.6" width="8" height="5.6" rx="1.3"/><rect x="6" y="7" width="8.4" height="5.8" rx="1.3"/>`,
  ),
  region: icon(
    `<path d="M2.6 6V3.6A1 1 0 0 1 3.6 2.6H6M10 2.6h2.4a1 1 0 0 1 1 1V6M13.4 10v2.4a1 1 0 0 1-1 1H10M6 13.4H3.6a1 1 0 0 1-1-1V10"/>`,
  ),
  scrolling: icon(
    `<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.6"/><path d="M8 4.9v6.2M5.9 6.9 8 4.8l2.1 2.1M10.1 9.1 8 11.2 5.9 9.1"/>`,
  ),
  interval: icon(
    `<circle cx="8" cy="8.6" r="5.1"/><path d="M8 5.9v2.7l1.8 1.3"/><path d="M6.3 1.8h3.4M8 1.8v1.7"/>`,
  ),
  check: icon(`<path d="M3 8.6 6.4 12l6.6-7.6"/>`, 14, 2.1),
  undo: icon(`<path d="M6.2 4.2 3.4 7l2.8 2.8"/><path d="M3.6 7h5.2a3.6 3.6 0 0 1 0 7.2H6.4"/>`),
  redo: icon(`<path d="M9.8 4.2 12.6 7l-2.8 2.8"/><path d="M12.4 7H7.2a3.6 3.6 0 0 0 0 7.2h2.4"/>`),
  copy: icon(
    `<rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.6"/><path d="M10.5 5.5V4.1A1.6 1.6 0 0 0 8.9 2.5H4.1A1.6 1.6 0 0 0 2.5 4.1v4.8a1.6 1.6 0 0 0 1.6 1.6h1.4"/>`,
  ),
  save: icon(
    `<path d="M3 4.2A1.7 1.7 0 0 1 4.7 2.5h6.9L13.5 4.4v7.4a1.7 1.7 0 0 1-1.7 1.7H4.7A1.7 1.7 0 0 1 3 11.8z"/><path d="M5.6 2.5v3.4h4.4V2.5M5.4 13.5v-3.3h5.2v3.3"/>`,
  ),
  openFile: icon(
    `<path d="M2.4 4.9a1.2 1.2 0 0 1 1.2-1.2h2.7l1.5 1.7h4.6a1.2 1.2 0 0 1 1.2 1.2v.7"/><path d="M2.4 7.3h9.8a1 1 0 0 1 1 1.2l-.8 4.3a1.2 1.2 0 0 1-1.2 1H3.2a1.2 1.2 0 0 1-1.2-1z"/>`,
  ),
  newFile: icon(
    `<path d="M4 2.6h5.2L13 6.4v7H4z"/><path d="M9.2 2.8v3.6H13"/><path d="M8.5 8.2v3.2M6.9 9.8h3.2"/>`,
  ),
  saveAs: icon(
    `<path d="M2.4 5.6a1.4 1.4 0 0 1 1.4-1.4h2.2l1.2 1.5h5.4a1.4 1.4 0 0 1 1.4 1.4v4.3a1.4 1.4 0 0 1-1.4 1.4H3.8a1.4 1.4 0 0 1-1.4-1.4z"/><path d="M8 7.6v3.5M6.5 9.6 8 11.1l1.5-1.5"/>`,
  ),
  moon: icon(`<path d="M13.1 9.7A5.5 5.5 0 0 1 6.3 2.9a5.6 5.6 0 1 0 6.8 6.8z"/>`),
  sun: icon(
    `<circle cx="8" cy="8" r="2.9"/><path d="M8 1.7v1.6M8 12.7v1.6M1.7 8h1.6M12.7 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1"/>`,
  ),
  settings: icon(
    `<path d="M2.6 5.2h10.8M2.6 10.8h10.8"/><circle cx="6" cy="5.2" r="1.8"/><circle cx="10.2" cy="10.8" r="1.8"/>`,
  ),
  close: icon(`<path d="M4.6 4.6 11.4 11.4M11.4 4.6 4.6 11.4"/>`, 14, 1.7),
  help: icon(
    `<circle cx="8" cy="8" r="6"/><path d="M6.1 6.2a2 2 0 1 1 2.8 1.9c-.6.3-.9.7-.9 1.3v.4"/><circle cx="8" cy="11.6" r=".55" fill="currentColor" stroke="none"/>`,
  ),
  widget: icon(
    `<rect x="2.4" y="2.4" width="5.4" height="5.4" rx="1.3"/><rect x="8.2" y="2.4" width="5.4" height="5.4" rx="1.3"/><rect x="2.4" y="8.2" width="5.4" height="5.4" rx="1.3"/><path d="M12.6 9.2v3.6M10.8 11h3.6"/>`,
  ),
  record: icon(`<circle cx="8" cy="8" r="5.2" fill="currentColor" stroke="none"/>`),
  stop: icon(`<rect x="3.6" y="3.6" width="8.8" height="8.8" rx="1.8" fill="currentColor" stroke="none"/>`),
  ocr: icon(
    `<path d="M2.6 5.4V3.6a1 1 0 0 1 1-1h1.8M10.6 2.6h1.8a1 1 0 0 1 1 1v1.8M13.4 10.6v1.8a1 1 0 0 1-1 1h-1.8M5.4 13.4H3.6a1 1 0 0 1-1-1v-1.8"/><path d="M5.6 5.8h4.8M5.6 8h3.2M5.6 10.2h4"/>`,
  ),
  film: icon(
    `<rect x="2.4" y="4" width="11.2" height="8" rx="1.4"/><path d="M5.2 4v8M10.8 4v8"/><path d="M5.2 7.2h5.6M5.2 9.6h5.6"/>`,
  ),
  image: icon(
    `<rect x="2.4" y="3" width="11.2" height="10" rx="1.4"/><circle cx="6" cy="6.4" r="1.1"/><path d="M2.6 11.4l3.2-3 2.6 2.2 2.2-2.4 2.8 3"/>`,
  ),
  play: icon(
    `<path d="M5.4 3.2 12.4 8l-7 4.8z" fill="currentColor" stroke="none"/>`,
  ),
  pause: icon(
    `<rect x="4.4" y="3.2" width="2.6" height="9.6" rx="0.9" fill="currentColor" stroke="none"/><rect x="9" y="3.2" width="2.6" height="9.6" rx="0.9" fill="currentColor" stroke="none"/>`,
  ),
  replay: icon(
    `<path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5"/><path d="M3 2.9v3.2h3.2"/>`,
  ),
  volume: icon(
    `<path d="M3 6.2h2.2L8.6 3.4v9.2L5.2 9.8H3z"/><path d="M10.8 5.8a3.2 3.2 0 0 1 0 4.4"/>`,
  ),
  volumeOff: icon(
    `<path d="M3 6.2h2.2L8.6 3.4v9.2L5.2 9.8H3z"/><path d="M10.8 6.4 13.4 9.6M13.4 6.4 10.8 9.6"/>`,
  ),
  external: icon(
    `<path d="M9.4 2.6h4v4"/><path d="M13.4 2.6 8 8"/><path d="M11.6 9.6v2.6a1.2 1.2 0 0 1-1.2 1.2H3.8a1.2 1.2 0 0 1-1.2-1.2V5.6a1.2 1.2 0 0 1 1.2-1.2h2.6"/>`,
  ),
  // File → Check for updates… (a circular arrow; no glyph dependency).
  refresh: icon(
    `<path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8"/><path d="M13.4 2.3v3h-3"/>`,
  ),
};

const TOOLS: ReadonlyArray<{ id: ShellToolId; label: string; hint: string; icon: string }> = [
  {
    id: "select",
    label: "Select",
    hint: "Select and move annotations (V)",
    icon: icon(`<path d="M4.6 2.8 12 9.3l-3.6.5 1.6 3.4-1.7.8-1.6-3.5-2.1 2z"/>`),
  },
  {
    id: "crop",
    label: "Crop",
    hint: "Crop the capture (C)",
    icon: icon(`<path d="M4.6 2v9.4a1 1 0 0 0 1 1H14"/><path d="M11.4 2v9.4a1 1 0 0 1-1 1H2"/>`),
  },
  {
    id: "arrow",
    label: "Arrow",
    hint: "Draw an arrow (A)",
    icon: icon(`<path d="M3.4 12.6 12 4"/><path d="M6.2 4H12v5.8"/>`),
  },
  {
    id: "text",
    label: "Text",
    hint: "Add a text label (T)",
    icon: icon(`<path d="M3.4 4.4V2.8h9.2v1.6"/><path d="M8 2.8v10.4M6.2 13.2h3.6"/>`),
  },
  {
    id: "shape",
    label: "Shapes",
    hint: "Draw a shape — pick the outline in the panel (R)",
    icon: icon(`<rect x="1.9" y="2.2" width="6" height="6" rx="1.1"/><circle cx="10.9" cy="10.9" r="3"/><path d="M11.1 2.2 14 7.4H8.2z"/>`),
  },
  {
    id: "blur",
    label: "Blur",
    hint: "Blur sensitive areas (B)",
    icon: icon(
      `<path d="M8 2c2.4 2.8 3.9 5 3.9 6.7a3.9 3.9 0 0 1-7.8 0C4.1 7 5.6 4.8 8 2z"/>`,
    ),
  },
  {
    id: "brush",
    label: "Brush",
    hint: "Freehand pen — size sets the nib (E)",
    icon: icon(
      `<path d="M13.5 2.5a1.5 1.5 0 0 1 0 2.1l-6 6-2.1-2.1 6-6a1.5 1.5 0 0 1 2.1 0z"/><path d="M5.4 8.5 2.6 11.3c-.6.6-.8 1.5-1.1 2.2.7-.3 1.6-.5 2.2-1.1l2.8-2.8z" fill="currentColor" stroke="none"/>`,
    ),
  },
  {
    id: "bucket",
    label: "Bucket",
    hint: "Fill an area with ink (G)",
    icon: icon(
      `<path d="M6.6 2.2 2.9 5.9a1.4 1.4 0 0 0 0 2l3.2 3.2a1.4 1.4 0 0 0 2 0l3.7-3.7z"/><path d="M4.6 4.2 8.6 8.2"/><path d="M13.2 9.7c0 .9-.6 1.6-1.4 1.6s-1.4-.7-1.4-1.6c0-.7 1.4-2.2 1.4-2.2s1.4 1.5 1.4 2.2z"/>`,
    ),
  },
  {
    id: "spotlight",
    label: "Spotlight",
    hint: "Dim everything outside a region (L)",
    icon: icon(
      `<circle cx="8" cy="2.3" r="1.2" fill="currentColor" stroke="none"/><path d="M7 3.6 4.6 9.4M9 3.6 11.4 9.4"/><ellipse cx="8" cy="12.6" rx="4.2" ry="1.4"/>`,
    ),
  },
  {
    id: "highlighter",
    label: "Highlight",
    hint: "Swipe a translucent highlighter (H)",
    icon: icon(
      `<rect x="1.8" y="11.8" width="12.4" height="2.6" rx="1" fill="currentColor" stroke="none" opacity="0.5"/><rect x="2.6" y="5.4" width="7" height="4.2" rx="0.9"/><path d="M9.6 6.4 13 7.5v1.2l-3.4 1.1z"/>`,
    ),
  },
  {
    id: "callout",
    label: "Callout",
    hint: "Speech-bubble note (K)",
    icon: icon(
      `<path d="M2.6 3.4h10.8v6.6H8.4l-3 2.8V10H2.6z"/><path d="M5.2 6.2h5.6M5.2 8h3.4"/>`,
    ),
  },
  {
    id: "step",
    label: "Step",
    hint: "Numbered callout steps (S)",
    icon: icon(`<circle cx="8" cy="8" r="5.5"/><path d="M7.1 6.3 8.2 5.5v5M6.6 10.5h3.2"/>`),
  },
  {
    id: "magnify",
    label: "Magnify",
    hint: "Zoom lens over a detail — the slider sets the zoom (M)",
    icon: icon(
      `<circle cx="7.1" cy="7.1" r="3.7"/><path d="M9.9 9.9 13.4 13.4"/><path d="M5.5 7.1h3.2M7.1 5.5v3.2"/>`,
    ),
  },
];

const COLORS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Red", hex: "#ff3b30" },
  { name: "Orange", hex: "#ff9500" },
  { name: "Yellow", hex: "#ffcc00" },
  { name: "Green", hex: "#34c759" },
  { name: "Blue", hex: "#007aff" },
  { name: "Purple", hex: "#8b7cf6" },
  { name: "Black", hex: "#1c1c1e" },
  { name: "White", hex: "#ffffff" },
];

type PropGroup = "shape" | "color" | "stroke" | "font" | "blur" | "shadow";

/**
 * Contextual properties rail: the one place a tool's settings live. Each tool
 * only ever shows the groups it actually reads, so the panel never offers a
 * control the current tool ignores (Snagit's contextual-panel pattern).
 */
const PROPS: Record<string, { hint: string; groups: ReadonlyArray<PropGroup>; strokeLabel?: string }> = {
  select: {
    hint: "Click an annotation to select it, then drag to move. Delete removes it.",
    groups: [],
  },
  crop: {
    hint: "Drag the handles to frame the shot, then press Enter to crop.",
    groups: [],
  },
  arrow: {
    hint: "Drag to draw an arrow. Width sets how heavy it looks.",
    groups: ["color", "stroke", "shadow"],
  },
  shape: {
    hint: "Drag to draw the chosen outline.",
    groups: ["shape", "color", "stroke", "shadow"],
  },
  step: {
    hint: "Click to drop the next numbered step — numbers stay in order.",
    groups: ["color", "stroke", "shadow"],
    strokeLabel: "Ring width",
  },
  text: {
    hint: "Click where the text should start, then type.",
    groups: ["color", "font", "shadow"],
  },
  bucket: {
    hint: "Click a closed area to flood-fill it with the current color.",
    groups: ["color"],
  },
  blur: {
    hint: "Drag over anything private — intensity sets how hard it hides.",
    groups: ["blur"],
  },
  brush: {
    hint: "Drag to draw freehand — size sets the nib.",
    groups: ["color"],
  },
  spotlight: {
    hint: "Drag to light a region; everything outside it is dimmed.",
    groups: ["color", "stroke"],
    strokeLabel: "Feather",
  },
  highlighter: {
    hint: "Swipe across text to mark it — width is the marker thickness.",
    groups: ["color", "stroke"],
    strokeLabel: "Thickness",
  },
  callout: {
    hint: "Click to place a speech bubble, then type the note.",
    groups: ["color", "font", "stroke", "shadow"],
    strokeLabel: "Outline",
  },
  magnify: {
    hint: "Drag over a detail to zoom it — the slider sets the zoom.",
    groups: ["color", "stroke"],
    strokeLabel: "Lens border",
  },
};

const DEFAULT_COLOR = "#ff3b30";
const DEFAULT_STROKE = 3;
const DEFAULT_FONT = "Inter";
const DEFAULT_SIZE = 32;
const MODE_KEY = "snagcraft:capture-mode";
const REC_MODE_KEY = "snagcraft:rec-mode";
const INK_KEY = "snagcraft:ink-color";
const STROKE_KEY = "snagcraft:stroke-width";
const DIR_KEY = "snagcraft:save-dir";
const FONT_KEY = "snagcraft:font-family";
const SIZE_KEY = "snagcraft:font-size";
const BOLD_KEY = "snagcraft:text-bold";
const ITALIC_KEY = "snagcraft:text-italic";
const BLUR_MODE_KEY = "snagcraft:blur-mode";
const BLUR_RADIUS_KEY = "snagcraft:blur-radius";
const DEFAULT_BLUR_MODE: BlurMode = "gaussian";
const DEFAULT_BLUR_RADIUS = 12;
const MIN_BLUR_RADIUS = 2;
const MAX_BLUR_RADIUS = 60;
const SHADOW_KEY = "snagcraft:shadow";
const MIN_SHADOW_BLUR = 0;
const MAX_SHADOW_BLUR = 60;
const MIN_SHADOW_OFFSET = -50;
const MAX_SHADOW_OFFSET = 50;

/** Nib preview circle: the 48px box maps the brush range onto 2–44 px. */
const BRUSH_PREVIEW_MIN = 2;
const BRUSH_PREVIEW_MAX = 44;

/** Matches the editor's own default shadow (track E contract). */
const DEFAULT_SHADOW: ShadowStyle = {
  enabled: false,
  color: "rgba(0,0,0,0.45)",
  blur: 8,
  offsetX: 0,
  offsetY: 4,
};

/** Text formatting slice of the Editor (landed by track E alongside this shell). */
type TextApi = {
  setFontFamily?(family: string): void;
  getFontFamily?(): string;
  setFontSize?(size: number): void;
  getFontSize?(): number;
  setTextBold?(bold: boolean): void;
  isTextBold?(): boolean;
  setTextItalic?(italic: boolean): void;
  isTextItalic?(): boolean;
};

/**
 * Per-tool size knob + image resize (track E lands it alongside this shell).
 * Everything optional so the rail degrades quietly on an older editor build.
 */
type SizeApi = {
  getToolSize?(): number;
  setToolSize?(size: number): void;
  getToolSizeRange?(): { min: number; max: number; step: number } | null;
  resizeImage?(width: number, height: number): void;
  getImageSize?(): { width: number; height: number };
};

/** Families bundled under src/assets/fonts (OFL). `css` is a safe font-family token. */
const FONTS: ReadonlyArray<{ family: string; css: string; stack: string }> = [
  { family: "Inter", css: "Inter", stack: "'Inter', system-ui, sans-serif" },
  { family: "Lato", css: "Lato", stack: "'Lato', 'Helvetica Neue', sans-serif" },
  { family: "Source Serif 4", css: "'Source Serif 4'", stack: "'Source Serif 4', Georgia, serif" },
  {
    family: "Playfair Display",
    css: "'Playfair Display'",
    stack: "'Playfair Display', Georgia, serif",
  },
  { family: "Oswald", css: "Oswald", stack: "'Oswald', 'Arial Narrow', sans-serif" },
  {
    family: "Archivo Black",
    css: "'Archivo Black'",
    stack: "'Archivo Black', 'Arial Black', sans-serif",
  },
  {
    family: "JetBrains Mono",
    css: "'JetBrains Mono'",
    stack: "'JetBrains Mono', ui-monospace, monospace",
  },
  { family: "Fira Code", css: "'Fira Code'", stack: "'Fira Code', ui-monospace, monospace" },
  { family: "Caveat", css: "Caveat", stack: "'Caveat', cursive" },
  { family: "Pacifico", css: "Pacifico", stack: "'Pacifico', cursive" },
];

// Warm every bundled face (regular + bold) so canvas text never renders in a
// fallback while the real font is still downloading. Best-effort, never fatal.
if (typeof document !== "undefined" && document.fonts?.load) {
  for (const font of FONTS) {
    void document.fonts.load(`16px ${font.css}`).catch(() => {});
    void document.fonts.load(`700 16px ${font.css}`).catch(() => {});
  }
}

const errText = (e: unknown): string =>
  typeof e === "string" ? e : e instanceof Error ? e.message : String(e);

const readStore = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStore = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the preference just isn't remembered */
  }
};

const readMode = (): CaptureMode => {
  const stored = readStore(MODE_KEY);
  return stored === "region" ||
    stored === "window" ||
    stored === "monitor" ||
    stored === "scrolling" ||
    stored === "interval"
    ? stored
    : "full";
};

const readRecMode = (): RecMode => {
  const stored = readStore(REC_MODE_KEY);
  return stored === "region" || stored === "window" ? stored : "full";
};

const readColor = (): string => {
  const stored = readStore(INK_KEY) ?? "";
  return /^#[0-9a-f]{6}$/i.test(stored) ? stored.toLowerCase() : DEFAULT_COLOR;
};

const readStroke = (): number => {
  const raw = readStore(STROKE_KEY);
  if (raw === null || raw.trim() === "") return DEFAULT_STROKE;
  const stored = Number(raw);
  if (!Number.isFinite(stored) || stored <= 0) return DEFAULT_STROKE;
  return Math.min(12, Math.max(1, Math.round(stored)));
};

const readFont = (): string => {
  const stored = readStore(FONT_KEY) ?? "";
  return FONTS.some((f) => f.family === stored) ? stored : DEFAULT_FONT;
};

const readSize = (): number => {
  const raw = readStore(SIZE_KEY);
  if (raw === null || raw.trim() === "") return DEFAULT_SIZE;
  const stored = Number(raw);
  if (!Number.isFinite(stored) || stored <= 0) return DEFAULT_SIZE;
  return Math.min(200, Math.max(8, Math.round(stored)));
};

const readBool = (key: string): boolean => readStore(key) === "true";

const readBlurMode = (): BlurMode => {
  const stored = readStore(BLUR_MODE_KEY) ?? "";
  return stored === "pixelate" || stored === "blackout" ? stored : DEFAULT_BLUR_MODE;
};

const readBlurRadius = (): number => {
  const raw = readStore(BLUR_RADIUS_KEY);
  if (raw === null || raw.trim() === "") return DEFAULT_BLUR_RADIUS;
  const stored = Number(raw);
  if (!Number.isFinite(stored) || stored <= 0) return DEFAULT_BLUR_RADIUS;
  return Math.min(MAX_BLUR_RADIUS, Math.max(MIN_BLUR_RADIUS, Math.round(stored)));
};

/* ---------------------------------------------------------------- shadow */

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;

/** Colours we accept from storage: hex, rgb()/rgba() or a plain CSS name. */
const isCssColor = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim() !== "" &&
  /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|[a-z]{3,20})$/i.test(value.trim());

/** Coerce anything shadow-shaped into a complete, in-range ShadowStyle. */
const normalizeShadow = (value: unknown, base: ShadowStyle = DEFAULT_SHADOW): ShadowStyle => {
  if (!value || typeof value !== "object") return { ...base };
  const src = value as Record<string, unknown>;
  return {
    enabled: typeof src.enabled === "boolean" ? src.enabled : base.enabled,
    color: isCssColor(src.color) ? src.color.trim() : base.color,
    blur: clampNumber(src.blur, base.blur, MIN_SHADOW_BLUR, MAX_SHADOW_BLUR),
    offsetX: clampNumber(src.offsetX, base.offsetX, MIN_SHADOW_OFFSET, MAX_SHADOW_OFFSET),
    offsetY: clampNumber(src.offsetY, base.offsetY, MIN_SHADOW_OFFSET, MAX_SHADOW_OFFSET),
  };
};

const readShadow = (): ShadowStyle => {
  const raw = readStore(SHADOW_KEY);
  if (raw === null || raw.trim() === "") return { ...DEFAULT_SHADOW };
  try {
    return normalizeShadow(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SHADOW };
  }
};

/** Split a CSS colour into the hex a color input understands and its alpha. */
const splitColorAlpha = (color: string): { hex: string; alpha: number } => {
  const rgba = color.match(
    /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)/i,
  );
  if (rgba) {
    const hex = `#${[rgba[1], rgba[2], rgba[3]]
      .map((part) =>
        Math.min(255, Math.max(0, Math.round(Number(part))))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
    const alpha = rgba[4] === undefined ? 1 : Math.min(1, Math.max(0, Number(rgba[4])));
    return { hex, alpha };
  }
  return { hex: /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#000000", alpha: 1 };
};

/** Direction the shadow falls, in degrees (0 = right, 90 = straight down). */
const shadowAngleOf = (style: ShadowStyle): number => {
  const degrees = (Math.atan2(style.offsetY, style.offsetX) * 180) / Math.PI;
  return Math.round((degrees + 360) % 360);
};

/** How far it falls, in px. */
const shadowDistanceOf = (style: ShadowStyle): number =>
  Math.round(Math.hypot(style.offsetX, style.offsetY));

/** Opacity carried in the colour's alpha, as a percentage. */
const shadowOpacityOf = (style: ShadowStyle): number =>
  Math.round(splitColorAlpha(style.color).alpha * 100);

/** Offsets for a direction + distance pair; the stored shape stays offsetX/offsetY. */
const shadowOffsets = (angle: number, distance: number): { offsetX: number; offsetY: number } => {
  const radians = (angle * Math.PI) / 180;
  return {
    offsetX: Math.round(Math.cos(radians) * distance),
    offsetY: Math.round(Math.sin(radians) * distance),
  };
};

/** Re-attach the alpha the shadow already carried to a freshly picked hex. */
const withAlpha = (hex: string, alpha: number): string => {
  if (alpha >= 0.999) return hex.toLowerCase();
  const n = parseInt(hex.slice(1), 16);
  const parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${Math.round(alpha * 100) / 100})`;
};

/* ------------------------------------------------- new: presets / recents */

const PRESETS_KEY = "snagcraft:presets";
const FILM_KEY = "snagcraft:filmstrip-open";
const OCR_LANG_KEY = "snagcraft:ocr-lang";
const RECENT_LIMIT = 12;

type OcrLang = "eng" | "swe";
const OCR_LANGS: ReadonlyArray<{ id: OcrLang; label: string }> = [
  { id: "eng", label: "English" },
  { id: "swe", label: "Swedish" },
];

/** A named, partial style snapshot (partial so a preset only touches what it sets). */
type EditorPreset = { name: string; style: Partial<EditorStyle> };

/** One capture in the filmstrip: full image for reloading, tiny thumb for the strip. */
type RecentShot = {
  id: string;
  dataUrl: string;
  thumb: string;
  ts: number;
  format: ExportFormat;
  label: string;
  /** "video" entries point at a recording file; "image" (default) is a capture. */
  kind?: "image" | "video";
  /** Absolute path of a recording or a file-backed capture. */
  path?: string;
  /** File extension for path-backed entries (badge text). */
  ext?: string;
  /** File name for path-backed entries (tooltip / status). */
  name?: string;
  /** Clip length in ms (videos only) — shown on the tile and in the player. */
  durationMs?: number;
};

/** One row from `list_folder_media` — the save folder's contents. */
type FolderMedia = {
  path: string;
  name: string;
  kind: "image" | "video";
  modified: number;
  thumb: string;
  /** Clip length in ms, absent/null when ffprobe couldn't read it. */
  durationMs: number | null;
};

/** What `recording_meta` returns for a freshly finished recording. */
type RecordingMeta = { thumb: string; durationMs: number | null };

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const SEED_PRESETS: ReadonlyArray<EditorPreset> = [
  { name: "Red arrow", style: { color: "#ff3b30", strokeWidth: 3 } },
  { name: "Highlight", style: { color: "#ffcc00", strokeWidth: 5 } },
  { name: "Blur strong", style: { blurMode: "gaussian", blurRadius: 40 } },
];

/** Keep only the fields the editor understands, clamped to the rail's ranges. */
const sanitizeStyle = (value: unknown): Partial<EditorStyle> => {
  const out: Partial<EditorStyle> = {};
  if (!value || typeof value !== "object") return out;
  const src = value as Record<string, unknown>;
  if (typeof src.color === "string" && /^#[0-9a-f]{6}$/i.test(src.color)) {
    out.color = src.color.toLowerCase();
  }
  if (typeof src.strokeWidth === "number" && Number.isFinite(src.strokeWidth)) {
    out.strokeWidth = Math.min(12, Math.max(1, Math.round(src.strokeWidth)));
  }
  if (typeof src.fontFamily === "string" && src.fontFamily.trim()) {
    out.fontFamily = src.fontFamily.trim().slice(0, 48);
  }
  if (typeof src.fontSize === "number" && Number.isFinite(src.fontSize)) {
    out.fontSize = Math.min(200, Math.max(8, Math.round(src.fontSize)));
  }
  if (typeof src.bold === "boolean") out.bold = src.bold;
  if (typeof src.italic === "boolean") out.italic = src.italic;
  if (src.blurMode === "gaussian" || src.blurMode === "pixelate" || src.blurMode === "blackout") {
    out.blurMode = src.blurMode;
  }
  if (typeof src.blurRadius === "number" && Number.isFinite(src.blurRadius)) {
    out.blurRadius = Math.min(MAX_BLUR_RADIUS, Math.max(MIN_BLUR_RADIUS, Math.round(src.blurRadius)));
  }
  if (src.shadow && typeof src.shadow === "object") {
    out.shadow = normalizeShadow(src.shadow);
  }
  return out;
};

const readPresets = (): EditorPreset[] => {
  const raw = readStore(PRESETS_KEY);
  if (raw === null) {
    writeStore(PRESETS_KEY, JSON.stringify(SEED_PRESETS));
    return SEED_PRESETS.map((p) => ({ name: p.name, style: { ...p.style } }));
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const list: EditorPreset[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const src = entry as { name?: unknown; style?: unknown };
      const name = typeof src.name === "string" ? src.name.trim().slice(0, 32) : "";
      if (!name) continue;
      list.push({ name, style: sanitizeStyle(src.style) });
    }
    return list;
  } catch {
    return [];
  }
};

const savePresets = (list: ReadonlyArray<EditorPreset>): void =>
  writeStore(PRESETS_KEY, JSON.stringify(list));

export function mountApp(root: HTMLElement): void {
  const currentTheme = readTheme();
  applyTheme(currentTheme);

  root.innerHTML = `
    <header class="topbar">
      <div class="topbar-left">
        <div class="file-menu-wrap">
          <button type="button" class="file-btn file-btn-mark" id="file-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="file-menu" title="File menu — save, settings, about">
            <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M17.6 9.3 C 22.2 9.4 26 11.9 27.4 15.6 C 28 17.4 28.1 19.1 27.4 20.4 C 26.6 21.9 24.9 22.5 23.2 21.9 C 21.6 22.5 20.4 23.9 19.8 25.9 L 19.3 28.7 L 10.5 28.7 C 10.3 24.5 10.2 20.3 11.4 16.3 C 12.3 13.3 14.5 10.7 17.6 9.3 Z M 22.5 16.1 a 1.1 1.1 0 1 1 -2.2 0 a 1.1 1.1 0 1 1 2.2 0 Z" /><path d="M13.4 10.2 C 12.7 8.1 12.4 6.2 12.7 4.9 C 14.1 6.5 15.6 8.0 16.7 9.2 Z" /><path d="M17.9 9.5 L22.4 1.9 L20.1 10.4 Z" /></svg></span>
            <span class="file-caret" aria-hidden="true">${ICONS.caret}</span>
          </button>
          <div class="capture-menu file-menu" id="file-menu" role="menu" aria-label="File" hidden>
            <button type="button" class="menu-item" data-file="new" title="New blank canvas — pick a resolution"><span class="menu-icon">${ICONS.newFile}</span><span class="menu-label">New…</span><span class="menu-check"></span><kbd class="menu-key">Ctrl+N</kbd></button>
            <button type="button" class="menu-item" data-file="open" title="Open an image from disk and annotate it"><span class="menu-icon">${ICONS.openFile}</span><span class="menu-label">Open…</span><span class="menu-check"></span><kbd class="menu-key">Ctrl+O</kbd></button>
            <button type="button" class="menu-item" data-file="save-as" title="Choose a name, folder and format"><span class="menu-icon">${ICONS.saveAs}</span><span class="menu-label">Save As…</span><span class="menu-check"></span><kbd class="menu-key">Ctrl+Shift+S</kbd></button>
            <button type="button" class="menu-item" data-file="save" title="Save a copy at the default format"><span class="menu-icon">${ICONS.save}</span><span class="menu-label">Save</span><span class="menu-check"></span><kbd class="menu-key">Ctrl+S</kbd></button>
            <button type="button" class="menu-item" data-file="upload" title="Upload to your endpoint and copy the link"><span class="menu-icon">${ICONS.openFile}</span><span class="menu-label">Upload…</span><span class="menu-check"></span><kbd class="menu-key"></kbd></button>
            <button type="button" class="menu-item" data-file="copy" title="Copy the image to the clipboard"><span class="menu-icon">${ICONS.copy}</span><span class="menu-label">Copy image</span><span class="menu-check"></span><kbd class="menu-key">Ctrl+C</kbd></button>
            <div class="menu-sep" role="separator" aria-hidden="true"></div>
            <button type="button" class="menu-item" data-file="settings" title="All settings"><span class="menu-icon">${ICONS.settings}</span><span class="menu-label">Settings…</span><span class="menu-check"></span><kbd class="menu-key">Ctrl+,</kbd></button>
            <button type="button" class="menu-item" data-file="widget" role="menuitemcheckbox" aria-checked="false" title="Show or hide the floating capture widget"><span class="menu-icon">${ICONS.widget}</span><span class="menu-label">Floating widget</span><span class="menu-check">${ICONS.check}</span><span class="menu-key-space" aria-hidden="true"></span></button>
            <div class="menu-sep" role="separator" aria-hidden="true"></div>
            <button type="button" class="menu-item" data-file="update" title="Ask GitHub whether a newer version has been published"><span class="menu-icon">${ICONS.refresh}</span><span class="menu-label">Check for updates…</span><span class="menu-check"><span class="update-dot" id="update-dot" hidden></span></span><kbd class="menu-key" id="update-menu-hint"></kbd></button>
            <button type="button" class="menu-item" data-file="about" title="Version, license and repository"><span class="menu-icon">${ICONS.help}</span><span class="menu-label">About</span><span class="menu-check"></span><kbd class="menu-key" id="about-menu-version"></kbd></button>
          </div>
        </div>
      </div>
      <div class="topbar-right">
        <span class="topbar-hint" id="hotkey-hint"><kbd>PrintScreen</kbd> full · <span class="key-pair"><kbd>Shift</kbd><kbd>PrintScreen</kbd></span> region</span>
        <div class="topbar-tools">
          <button type="button" class="icon-btn" id="theme-toggle" title="Switch to dark theme" aria-label="Switch to dark theme" aria-pressed="false">${currentTheme === "dark" ? ICONS.sun : ICONS.moon}</button>
          <button type="button" class="icon-btn" id="help-btn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">${ICONS.help}</button>
        </div>
        <div class="rec-group">
          <div class="rec-pill" id="rec-pill" hidden>
            <span class="rec-pulse" aria-hidden="true"></span>
            <span class="rec-scope" id="rec-scope" hidden>Region</span>
            <span class="rec-timer" id="rec-timer" role="timer" aria-label="Recording time">00:00</span>
            <span class="rec-format" id="rec-format">MP4</span>
            <button type="button" class="rec-pause" id="rec-pause" title="Pause the recording" aria-pressed="false">Pause</button>
            <button type="button" class="rec-stop" id="rec-stop" title="Stop the recording and save it">Stop</button>
          </div>
        </div>
        <div class="split-btn" id="capture-split">
          <button type="button" class="btn-primary split-main" id="capture" aria-keyshortcuts="PrintScreen" title="Capture full screen (PrintScreen)">
            ${ICONS.capture}
            <span>Capture</span>
            <span class="split-mode" id="capture-mode-label">Full</span>
          </button>
          <span class="split-divider" aria-hidden="true"></span>
          <button type="button" class="btn-primary split-caret" id="capture-caret" aria-haspopup="menu" aria-expanded="false" aria-controls="capture-menu" aria-label="Capture options" title="Capture options">
            ${ICONS.caret}
          </button>
          <div class="capture-menu" id="capture-menu" role="menu" aria-label="Capture mode" hidden>
            <button type="button" class="menu-item" role="menuitemradio" data-mode="full" aria-checked="true" title="Grab every screen at once, straight away">
              <span class="menu-icon">${ICONS.full}</span>
              <span class="menu-label">Full screen</span>
              <span class="menu-check">${ICONS.check}</span>
              <kbd class="menu-key">PrintScreen</kbd>
            </button>
            <button type="button" class="menu-item" role="menuitemradio" data-mode="region" aria-checked="false" title="Drag a rectangle on the screen, straight away">
              <span class="menu-icon">${ICONS.region}</span>
              <span class="menu-label">Select region</span>
              <span class="menu-check">${ICONS.check}</span>
              <span class="menu-keys"><kbd>Shift</kbd><kbd>PrintScreen</kbd></span>
            </button>
            <button type="button" class="menu-item" role="menuitemradio" data-mode="window" aria-checked="false" title="Choose which window to capture">
              <span class="menu-icon">${ICONS.window}</span>
              <span class="menu-label">Window</span>
              <span class="menu-check">${ICONS.check}</span>
              <span class="menu-key-space" aria-hidden="true"></span>
            </button>
            <button type="button" class="menu-item" role="menuitemradio" data-mode="monitor" aria-checked="false" title="Choose which screen to capture">
              <span class="menu-icon">${ICONS.monitor}</span>
              <span class="menu-label">Choose screen</span>
              <span class="menu-check">${ICONS.check}</span>
              <span class="menu-key-space" aria-hidden="true"></span>
            </button>
            <div class="menu-sep" role="separator" aria-hidden="true"></div>
            <button type="button" class="menu-item" role="menuitemradio" data-mode="scrolling" aria-checked="false" title="Select a region, then scroll the page yourself — SnagCraft stitches it into one tall image">
              <span class="menu-icon">${ICONS.scrolling}</span>
              <span class="menu-label">Scrolling capture</span>
              <span class="menu-check">${ICONS.check}</span>
              <span class="menu-key-space" aria-hidden="true"></span>
            </button>
            <button type="button" class="menu-item" role="menuitemradio" data-mode="interval" aria-checked="false" title="Take a screenshot every N seconds, then build a timelapse">
              <span class="menu-icon">${ICONS.interval}</span>
              <span class="menu-label">Interval</span>
              <span class="menu-check">${ICONS.check}</span>
              <span class="menu-key-space" aria-hidden="true"></span>
            </button>
            <div class="menu-sep" role="separator" aria-hidden="true"></div>
            <button type="button" class="menu-item" role="menuitem" data-rec-mode="full" title="Record the whole screen (system picker)">
              <span class="menu-icon menu-icon-rec">${ICONS.record}</span>
              <span class="menu-label">Record full screen</span>
              <span class="menu-check"></span>
              <span class="menu-key-space" aria-hidden="true"></span>
            </button>
            <button type="button" class="menu-item" role="menuitem" data-rec-mode="region" title="Drag a rectangle, then record only that area">
              <span class="menu-icon menu-icon-rec">${ICONS.record}</span>
              <span class="menu-label">Record region</span>
              <span class="menu-check"></span>
              <span class="menu-key-space" aria-hidden="true"></span>
            </button>
            <button type="button" class="menu-item" role="menuitem" data-rec-mode="window" title="Pick one window and record only that window">
              <span class="menu-icon menu-icon-rec">${ICONS.record}</span>
              <span class="menu-label">Record window</span>
              <span class="menu-check"></span>
              <span class="menu-key-space" aria-hidden="true"></span>
            </button>
          </div>
        </div>
      </div>
    </header>

    <nav class="toolbar" aria-label="Annotation tools">
      <div class="tool-group" id="tools" role="toolbar" aria-label="Tools"></div>
      <span class="toolbar-sep" aria-hidden="true"></span>
      <div class="tool-group">
        <button type="button" class="chip chip-icon" id="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${ICONS.undo}</button>
        <button type="button" class="chip chip-icon" id="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${ICONS.redo}</button>
      </div>
      <span class="toolbar-sep" aria-hidden="true"></span>
      <div class="tool-group toolbar-actions">
        <button type="button" class="chip chip-icon chip-badge" id="film-toggle" disabled title="Recent captures appear after your first capture" aria-label="Recent captures" aria-pressed="false">${ICONS.film}<span class="chip-count" id="film-count">0</span></button>
        <span class="toolbar-sep" aria-hidden="true"></span>
        <button type="button" class="chip" id="ocr" disabled title="Extract text from this capture">${ICONS.ocr}<span>OCR</span></button>
        <span class="toolbar-sep" aria-hidden="true"></span>
        <button type="button" class="chip" id="copy" disabled title="Copy to clipboard (Ctrl+C)">${ICONS.copy}<span>Copy</span></button>
        <button type="button" class="chip" id="save" disabled title="Save an edited copy to your save folder (Ctrl+S)">${ICONS.save}<span>Save</span></button>
        <button type="button" class="chip" id="save-as" disabled title="Save As… — choose name and folder (Ctrl+Shift+S)">${ICONS.saveAs}<span>Save As…</span></button>
      </div>
    </nav>

    <main class="workspace">
      <section class="stage" aria-label="Capture canvas">
      <div class="editor-shell" id="editor"></div>
      <div class="empty-state" id="empty">
        <span class="empty-mark" aria-hidden="true">${ICONS.capture}</span>
        <p class="empty-title">No capture yet</p>
        <p class="empty-text">Press <kbd>PrintScreen</kbd> for the full screen, <span class="key-pair"><kbd>Shift</kbd><kbd>PrintScreen</kbd></span> for a region — or pick a mode from <strong>Capture</strong>.</p>
        <p class="empty-note">Captures are saved to your save folder automatically — switch that off in Settings → General.</p>
      </div>

      <section class="player" id="player" hidden aria-label="Recording player">
        <div class="player-view" id="player-view">
          <video class="player-video" id="player-video" playsinline preload="metadata" hidden></video>
          <img class="player-poster" id="player-poster" alt="" hidden />
          <button type="button" class="player-big" id="player-big" aria-label="Play recording" title="Play">${ICONS.play}</button>
          <p class="player-note" id="player-note" hidden></p>
        </div>
        <div class="player-bar">
          <button type="button" class="player-btn player-btn-main" id="player-toggle" aria-label="Play" title="Play / pause (Space)">${ICONS.play}</button>
          <span class="player-clock" id="player-cur">0:00</span>
          <input type="range" class="player-range" id="player-range" min="0" max="1000" step="1" value="0" aria-label="Seek" />
          <span class="player-clock player-clock-total" id="player-dur">0:00</span>
          <button type="button" class="player-btn" id="player-mute" aria-label="Mute" title="Mute">${ICONS.volume}</button>
          <span class="player-sep" aria-hidden="true"></span>
          <button type="button" class="player-btn" id="player-ext" aria-label="Open in another program" title="Open in another program">${ICONS.external}</button>
          <button type="button" class="player-btn" id="player-close" aria-label="Close preview" title="Close preview (Esc)">${ICONS.close}</button>
        </div>
      </section>

      <footer class="filmstrip" id="filmstrip" hidden aria-label="Recent captures">
        <div class="filmstrip-resize" id="film-resize" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="Resize recent captures" title="Drag to resize · double-click to reset"></div>
        <div class="filmstrip-head">
          <span class="filmstrip-title">Recent</span>
          <span class="filmstrip-total" id="film-total">0</span>
          <button type="button" class="filmstrip-link" id="film-clear" title="Forget this session's captures">Clear</button>
          <button type="button" class="filmstrip-link filmstrip-hide" id="film-close" aria-label="Hide recent captures" title="Hide">${ICONS.close}</button>
        </div>
        <div class="filmstrip-track" id="film-track" role="listbox" aria-label="Recent captures"></div>
        <p class="filmstrip-empty" id="film-empty">Captures from this session land here — click one to load it back into the editor.</p>
      </footer>
      </section>

      <aside class="props" id="props" aria-label="Tool properties">
        <header class="props-head">
          <span class="props-eyebrow">Tool properties</span>
          <h2 class="props-title" id="props-title">Select</h2>
          <p class="props-hint" id="props-hint">Click an annotation to select it, then drag to move.</p>
        </header>

        <div class="props-body" id="props-body">
          <p class="props-idle" id="props-idle">No capture yet — these settings apply to your next annotation.</p>

          <section class="prop-group presets" aria-label="Style presets">
            <div class="prop-head">
              <h3 class="prop-label">Style presets</h3>
              <button type="button" class="preset-add" id="preset-save-toggle" aria-expanded="false" title="Save the current style as a preset">+ Save style</button>
            </div>
            <div class="preset-chips" id="preset-chips"></div>
            <form class="preset-form" id="preset-form" hidden>
              <input type="text" class="preset-input" id="preset-name" maxlength="32" placeholder="Name this preset" aria-label="Preset name" autocomplete="off" />
              <button type="submit" class="btn-secondary preset-confirm" id="preset-confirm">Save</button>
            </form>
          </section>

          <section class="prop-group" data-group="shape" id="shape-group" hidden>
            <div class="prop-head">
              <h3 class="prop-label">Shape</h3>
            </div>
            <div class="shape-picker" id="shape-picker" role="radiogroup" aria-label="Shape">
              <button type="button" class="shape-btn" data-shape="rect" role="radio" aria-checked="true" aria-label="Rectangle" title="Rectangle"><svg viewBox="0 0 16 16"><rect x="2.6" y="3.6" width="10.8" height="8.8" rx="1.2"/></svg></button>
              <button type="button" class="shape-btn" data-shape="ellipse" role="radio" aria-checked="false" aria-label="Ellipse" title="Ellipse"><svg viewBox="0 0 16 16"><ellipse cx="8" cy="8" rx="5.6" ry="4.4"/></svg></button>
              <button type="button" class="shape-btn" data-shape="triangle" role="radio" aria-checked="false" aria-label="Triangle" title="Triangle"><svg viewBox="0 0 16 16"><path d="M8 2.6 13.6 13H2.4z"/></svg></button>
              <button type="button" class="shape-btn" data-shape="line" role="radio" aria-checked="false" aria-label="Line" title="Line"><svg viewBox="0 0 16 16"><path d="M2.6 13 13.4 3"/></svg></button>
              <button type="button" class="shape-btn" data-shape="star" role="radio" aria-checked="false" aria-label="Star" title="Star"><svg viewBox="0 0 16 16"><path d="M8 2.2 9.9 6.4l4.5.4-3.4 3 1 4.4L8 11.8 4 14.2l1-4.4-3.4-3 4.5-.4z"/></svg></button>
            </div>
          </section>

          <section class="prop-group" data-group="color">
            <div class="prop-head">
              <h3 class="prop-label">Color</h3>
              <div class="prop-head-end">
                <output class="prop-value" id="color-value">${DEFAULT_COLOR}</output>
                <label class="color-custom prop-custom" title="Custom color">
                  <input type="color" id="color-custom" value="${DEFAULT_COLOR}" aria-label="Custom annotation color" />
                  <span class="color-custom-ring" aria-hidden="true"></span>
                </label>
              </div>
            </div>
            <div class="swatches" id="swatches" role="radiogroup" aria-label="Annotation color"></div>
          </section>

          <section class="prop-group prop-size" data-group="size" id="tool-size-group" hidden>
            <div class="prop-head">
              <label class="prop-label" id="tool-size-label" for="tool-size">Size</label>
              <output class="prop-value" id="tool-size-out" for="tool-size">3 px</output>
            </div>
            <div class="size-row">
              <input type="range" class="slider slider-size" id="tool-size" min="1" max="12" step="1" value="3" aria-labelledby="tool-size-label" />
              <div class="brush-preview" id="brush-preview" hidden aria-hidden="true">
                <span class="brush-preview-box"><span class="brush-preview-dot" id="brush-preview-dot"></span></span>
                <span class="brush-preview-value" id="brush-preview-value">1 px</span>
              </div>
            </div>
            <p class="prop-note" id="tool-size-note"></p>
          </section>

          <section class="prop-group" data-group="stroke">
            <div class="prop-head">
              <h3 class="prop-label" id="stroke-label">Width</h3>
              <output class="prop-value" id="stroke-value">${DEFAULT_STROKE} px</output>
            </div>
          </section>

          <section class="prop-group" data-group="font">
            <h3 class="prop-label">Font</h3>
            <label class="font-picker">
              <span class="sr-only">Font family</span>
              <select id="font-family" class="font-select" aria-label="Font family">
                ${FONTS.map(
                  (f) => `<option value="${f.family}" style="font-family:${f.stack}">${f.family}</option>`,
                ).join("")}
              </select>
              <span class="font-picker-arrow" aria-hidden="true">${ICONS.caret}</span>
            </label>
            <div class="prop-row">
              <div class="size-stepper" role="group" aria-label="Font size">
                <button type="button" class="step-btn" id="size-down" aria-label="Smaller text" title="Smaller">−</button>
                <input type="number" id="font-size" class="size-input" min="8" max="200" step="1" value="${DEFAULT_SIZE}" aria-label="Font size in pixels" />
                <button type="button" class="step-btn" id="size-up" aria-label="Larger text" title="Larger">+</button>
              </div>
              <div class="text-toggle-group" role="group" aria-label="Text style">
                <button type="button" class="text-toggle" id="text-bold" aria-pressed="false" title="Bold" aria-label="Bold"><span class="text-toggle-glyph" style="font-weight:700">B</span></button>
                <button type="button" class="text-toggle" id="text-italic" aria-pressed="false" title="Italic" aria-label="Italic"><span class="text-toggle-glyph" style="font-style:italic;font-family:'Source Serif 4',Georgia,serif">I</span></button>
              </div>
            </div>
          </section>

          <section class="prop-group" data-group="blur">
            <h3 class="prop-label">Mode</h3>
            <div class="segmented segmented-sm segmented-full" id="blur-modes" role="radiogroup" aria-label="Blur mode">
              <button type="button" role="radio" data-blur-mode="gaussian" aria-checked="false">Gaussian</button>
              <button type="button" role="radio" data-blur-mode="pixelate" aria-checked="false">Pixelate</button>
              <button type="button" role="radio" data-blur-mode="blackout" aria-checked="false">Blackout</button>
            </div>
            <div class="radius-field" id="blur-radius-field">
              <div class="prop-head">
                <label class="prop-label" for="blur-radius">Intensity</label>
                <output class="radius-value" id="blur-radius-out" for="blur-radius">${DEFAULT_BLUR_RADIUS}</output>
              </div>
              <input type="range" class="slider slider-sm" id="blur-radius" min="2" max="60" step="1" value="${DEFAULT_BLUR_RADIUS}" aria-label="Blur intensity" />
            </div>
            <p class="prop-note" id="blur-hint">Drag over anything private.</p>
          </section>

          <section class="prop-group prop-shadow" data-group="shadow" id="shadow-group" hidden>
            <div class="prop-head">
              <h3 class="prop-label" id="shadow-label">Shadow</h3>
              <button type="button" class="switch switch-sm" id="shadow-toggle" role="switch" aria-checked="false" aria-labelledby="shadow-label" title="Shadow off"><span class="switch-knob" aria-hidden="true"></span></button>
            </div>
            <div class="shadow-fields" id="shadow-fields" hidden>
              <div class="shadow-sample">
                <span class="shadow-sample-box"><span class="shadow-sample-fill" id="shadow-preview" aria-hidden="true"></span></span>
                <span class="shadow-sample-text">Lifts the shape off the capture</span>
              </div>
              <div class="prop-head">
                <label class="prop-label" for="shadow-blur">Blur</label>
                <output class="prop-value" id="shadow-blur-out" for="shadow-blur">8</output>
              </div>
              <input type="range" class="slider slider-sm" id="shadow-blur" min="0" max="60" step="1" value="8" aria-label="Shadow blur" />
              <div class="prop-head">
                <label class="prop-label" for="shadow-angle">Direction</label>
                <output class="prop-value" id="shadow-angle-out" for="shadow-angle">90°</output>
              </div>
              <input type="range" class="slider slider-sm" id="shadow-angle" min="0" max="360" step="1" value="90" aria-label="Shadow direction" />
              <div class="prop-head">
                <label class="prop-label" for="shadow-distance">Distance</label>
                <output class="prop-value" id="shadow-distance-out" for="shadow-distance">4 px</output>
              </div>
              <input type="range" class="slider slider-sm" id="shadow-distance" min="0" max="50" step="1" value="4" aria-label="Shadow distance" />
              <div class="prop-head">
                <label class="prop-label" for="shadow-opacity">Opacity</label>
                <output class="prop-value" id="shadow-opacity-out" for="shadow-opacity">45%</output>
              </div>
              <input type="range" class="slider slider-sm" id="shadow-opacity" min="2" max="100" step="1" value="45" aria-label="Shadow opacity" />
              <div class="prop-head">
                <label class="prop-label" for="shadow-color">Color</label>
                <label class="color-custom prop-custom" title="Shadow color">
                  <input type="color" id="shadow-color" value="#000000" aria-label="Shadow color" />
                  <span class="color-custom-ring" aria-hidden="true"></span>
                </label>
              </div>
            </div>
            <p class="prop-note" id="shadow-note">Applies to new boxes, arrows and labels.</p>
          </section>

          <section class="prop-group prop-resize" data-group="resize" id="resize-group" hidden>
            <div class="prop-head">
              <h3 class="prop-label">Image size</h3>
              <output class="prop-value" id="image-size-out">—</output>
            </div>
            <button type="button" class="btn-secondary resize-open" id="resize-open" aria-expanded="false" aria-controls="resize-pop">Resize…</button>
          </section>
        </div>

        <div class="resize-pop" id="resize-pop" hidden role="dialog" aria-labelledby="resize-title">
          <header class="resize-head">
            <h3 class="resize-title" id="resize-title">Resize image</h3>
            <button type="button" class="icon-btn resize-x" id="resize-close" aria-label="Cancel resize" title="Cancel (Esc)">${ICONS.close}</button>
          </header>
          <p class="resize-current" id="resize-current">Current: —</p>
          <div class="resize-fields">
            <label class="resize-field">
              <span class="resize-field-label">Width</span>
              <input type="number" class="resize-input" id="resize-w" min="1" max="8192" step="1" inputmode="numeric" autocomplete="off" />
            </label>
            <span class="resize-times" aria-hidden="true">×</span>
            <label class="resize-field">
              <span class="resize-field-label">Height</span>
              <input type="number" class="resize-input" id="resize-h" min="1" max="8192" step="1" inputmode="numeric" autocomplete="off" />
            </label>
          </div>
          <label class="resize-lock">
            <input type="checkbox" id="resize-lock" checked />
            <span class="resize-lock-box" aria-hidden="true"><span class="resize-lock-mark"></span></span>
            <span class="resize-lock-text">Lock aspect ratio</span>
            <span class="resize-ratio" id="resize-ratio"></span>
          </label>
          <p class="resize-error" id="resize-error" role="alert" hidden></p>
          <div class="resize-actions">
            <button type="button" class="btn-secondary" id="resize-cancel">Cancel</button>
            <button type="button" class="btn-primary" id="resize-apply">Apply</button>
          </div>
        </div>

        <footer class="props-foot">Applies to new annotations</footer>
      </aside>
    </main>

    <footer class="statusbar">
      <span class="status-dot" id="dot" data-kind="info" aria-hidden="true"></span>
      <span class="status-text" id="status" role="status" aria-live="polite">Ready</span>
      <span class="status-keys"><kbd>Ctrl</kbd><kbd>Z</kbd> undo · <kbd>Ctrl</kbd><kbd>S</kbd> save copy · <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>S</kbd> save as</span>
    </footer>

    <div class="countdown" id="countdown" hidden role="dialog" aria-modal="true" aria-labelledby="countdown-num">
      <div class="countdown-card">
        <p class="countdown-kicker" id="countdown-kicker">Capture in</p>
        <span class="countdown-num" id="countdown-num" aria-live="assertive">3</span>
        <p class="countdown-hint" id="countdown-hint">Full screen · press Esc to cancel</p>
        <button type="button" class="btn-secondary countdown-cancel" id="countdown-cancel">Cancel</button>
      </div>
    </div>

    <div class="modal-backdrop close-guard" id="close-guard" hidden>
      <div class="modal modal-sm" role="alertdialog" aria-modal="true" aria-labelledby="guard-title" aria-describedby="guard-desc" tabindex="-1">
        <header class="modal-head">
          <div class="modal-heading">
            <h2 class="modal-title" id="guard-title">Save changes before closing?</h2>
            <p class="modal-desc" id="guard-desc">You have unsaved annotations.</p>
          </div>
        </header>
        <div class="modal-body guard-body">
          <p class="guard-swatch"><span class="guard-file-icon" aria-hidden="true">${ICONS.image}</span><span id="guard-file">SnagCraft capture</span></p>
        </div>
        <footer class="modal-foot guard-foot">
          <button type="button" class="btn-secondary" id="guard-cancel">Cancel</button>
          <div class="guard-actions">
            <button type="button" class="btn-ghost-danger" id="guard-discard">Discard</button>
            <button type="button" class="btn-primary" id="guard-save">Save &amp; close</button>
          </div>
        </footer>
      </div>
    </div>

    <div class="modal-backdrop" id="about-modal" hidden>
      <div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="about-title" tabindex="-1">
        <header class="modal-head">
          <div class="modal-heading">
            <h2 class="modal-title" id="about-title">About</h2>
          </div>
          <button type="button" class="icon-btn modal-x" id="about-close" aria-label="Close" title="Close (Esc)">${ICONS.close}</button>
        </header>
        <div class="modal-body about-body">
          <span class="about-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M17.6 9.3 C 22.2 9.4 26 11.9 27.4 15.6 C 28 17.4 28.1 19.1 27.4 20.4 C 26.6 21.9 24.9 22.5 23.2 21.9 C 21.6 22.5 20.4 23.9 19.8 25.9 L 19.3 28.7 L 10.5 28.7 C 10.3 24.5 10.2 20.3 11.4 16.3 C 12.3 13.3 14.5 10.7 17.6 9.3 Z M 22.5 16.1 a 1.1 1.1 0 1 1 -2.2 0 a 1.1 1.1 0 1 1 2.2 0 Z" /><path d="M13.4 10.2 C 12.7 8.1 12.4 6.2 12.7 4.9 C 14.1 6.5 15.6 8.0 16.7 9.2 Z" /><path d="M17.9 9.5 L22.4 1.9 L20.1 10.4 Z" /></svg></span>
          <p class="about-name">SnagCraft</p>
          <p class="about-version" id="about-version">—</p>
          <p class="about-meta">Open-source screen capture and recording.</p>
          <p class="about-meta about-repo">github.com/rostaddotcc/snagcraft</p>
          <p class="about-meta about-license">GPL-3.0-or-later · commercial license available</p>
        </div>
        <footer class="modal-foot about-foot">
          <button type="button" class="btn-primary" id="about-ok">OK</button>
        </footer>
      </div>
    </div>
    <div class="modal-backdrop" id="update-modal" hidden>
      <div class="modal modal-sm update-modal" role="dialog" aria-modal="true" aria-labelledby="update-title" aria-describedby="update-desc" tabindex="-1">
        <header class="modal-head">
          <div class="modal-heading">
            <h2 class="modal-title" id="update-title">Update available</h2>
            <p class="modal-desc" id="update-desc">A newer SnagCraft has been published.</p>
          </div>
          <button type="button" class="icon-btn modal-x" id="update-close" aria-label="Close" title="Close (Esc)">${ICONS.close}</button>
        </header>
        <div class="modal-body update-body">
          <p class="update-versions"><span class="update-now" id="update-latest">—</span> <span class="update-was">you have <span id="update-current">—</span></span></p>
          <p class="update-release-title" id="update-release-title" hidden></p>
          <p class="update-notes" id="update-notes" hidden></p>
          <p class="update-install-note" id="update-install-note" hidden></p>
          <div class="update-progress" id="update-progress" hidden>
            <div class="update-bar" id="update-bar" role="progressbar" aria-label="Update download" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="update-bar-fill" id="update-bar-fill"></span></div>
            <span class="update-progress-text" id="update-progress-text" role="status" aria-live="polite"></span>
          </div>
          <p class="update-feedback" id="update-feedback" role="status" aria-live="polite" hidden></p>
        </div>
        <footer class="modal-foot update-foot">
          <button type="button" class="btn-secondary" id="update-skip">Skip this version</button>
          <div class="guard-actions">
            <button type="button" class="btn-secondary" id="update-later">Later</button>
            <button type="button" class="btn-secondary" id="update-open">Release notes</button>
            <button type="button" class="btn-primary" id="update-now" hidden>Update now</button>
            <button type="button" class="btn-primary" id="update-restart" hidden>Restart now</button>
          </div>
        </footer>
      </div>
    </div>
    <div class="modal-backdrop" id="monitor-modal" hidden>
      <div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="monitor-title" tabindex="-1">
        <header class="modal-head">
          <div class="modal-heading">
            <h2 class="modal-title" id="monitor-title">Choose a screen</h2>
            <p class="modal-desc" id="monitor-desc">Which display should SnagCraft capture?</p>
          </div>
          <button type="button" class="icon-btn modal-x" id="monitor-close" aria-label="Close" title="Close (Esc)">${ICONS.close}</button>
        </header>
        <div class="modal-body monitor-body" id="monitor-list"></div>
        <footer class="modal-foot">
          <button type="button" class="btn-secondary" id="monitor-cancel">Cancel</button>
        </footer>
      </div>
    </div>
    <div class="modal-backdrop" id="shortcuts-modal" hidden>
      <div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" tabindex="-1">
        <header class="modal-head">
          <div class="modal-heading">
            <h2 class="modal-title" id="shortcuts-title">Keyboard shortcuts</h2>
          </div>
          <button type="button" class="icon-btn modal-x" id="shortcuts-close" aria-label="Close" title="Close (Esc)">${ICONS.close}</button>
        </header>
        <div class="modal-body">
          <dl class="shortcut-list">
            <div><dt><kbd>PrintScreen</kbd></dt><dd>Capture full screen</dd></div>
            <div><dt><kbd>Shift</kbd> + <kbd>PrintScreen</kbd></dt><dd>Capture a region</dd></div>
            <div><dt><kbd>Ctrl</kbd> + <kbd>Z</kbd></dt><dd>Undo</dd></div>
            <div><dt><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> · <kbd>Ctrl</kbd> + <kbd>Y</kbd></dt><dd>Redo</dd></div>
            <div><dt><kbd>Ctrl</kbd> + <kbd>C</kbd></dt><dd>Copy to clipboard</dd></div>
            <div><dt><kbd>Ctrl</kbd> + <kbd>V</kbd></dt><dd>Paste an image to annotate</dd></div>
            <div><dt><kbd>Ctrl</kbd> + <kbd>scroll</kbd></dt><dd>Zoom in / out</dd></div>
            <div><dt><kbd>V</kbd></dt><dd>Select tool</dd></div>
            <div><dt><kbd>C</kbd></dt><dd>Crop tool</dd></div>
            <div><dt><kbd>A</kbd></dt><dd>Arrow tool</dd></div>
            <div><dt><kbd>T</kbd></dt><dd>Text tool</dd></div>
            <div><dt><kbd>R</kbd></dt><dd>Shapes tool</dd></div>
            <div><dt><kbd>B</kbd></dt><dd>Blur tool</dd></div>
            <div><dt><kbd>E</kbd></dt><dd>Brush tool</dd></div>
            <div><dt><kbd>G</kbd></dt><dd>Fill bucket tool</dd></div>
            <div><dt><kbd>L</kbd></dt><dd>Spotlight tool</dd></div>
            <div><dt><kbd>H</kbd></dt><dd>Highlighter tool</dd></div>
            <div><dt><kbd>K</kbd></dt><dd>Callout tool</dd></div>
            <div><dt><kbd>S</kbd></dt><dd>Step numbers tool</dd></div>
            <div><dt><kbd>M</kbd></dt><dd>Magnify tool</dd></div>
            <div><dt><kbd>Ctrl</kbd> + <kbd>N</kbd></dt><dd>New blank canvas</dd></div>
            <div><dt><kbd>Ctrl</kbd> + <kbd>O</kbd></dt><dd>Open an image</dd></div>
            <div><dt><kbd>Ctrl</kbd> + <kbd>S</kbd></dt><dd>Save</dd></div>
            <div><dt><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd></dt><dd>Save As…</dd></div>
            <div><dt><kbd>Ctrl</kbd> + <kbd>,</kbd></dt><dd>Settings</dd></div>
            <div><dt><kbd>Delete</kbd> · <kbd>Backspace</kbd></dt><dd>Delete selected annotation</dd></div>
            <div><dt><kbd>Esc</kbd></dt><dd>Cancel / deselect / close</dd></div>
            <div><dt><kbd>Space</kbd> · <kbd>K</kbd></dt><dd>Play / pause a recording (player open)</dd></div>
            <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Seek a recording 5 s (Shift = 1 s)</dd></div>
            <div><dt><kbd>?</kbd></dt><dd>This help</dd></div>
          </dl>
        </div>
      </div>
    </div>

    <div class="modal-backdrop" id="new-modal" hidden>
      <div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="new-title" tabindex="-1">
        <header class="modal-head">
          <div class="modal-heading">
            <h2 class="modal-title" id="new-title">New canvas</h2>
            <p class="modal-desc">A blank canvas to draw on — pick a size or type your own.</p>
          </div>
          <button type="button" class="icon-btn modal-x" id="new-close" aria-label="Close" title="Close (Esc)">${ICONS.close}</button>
        </header>
        <div class="modal-body">
          <div class="new-presets" id="new-presets" role="radiogroup" aria-label="Resolution presets"></div>
          <div class="new-custom">
            <label class="new-dim">Width<input type="number" id="new-w" min="16" max="8192" step="1" inputmode="numeric"></label>
            <span class="new-x" aria-hidden="true">×</span>
            <label class="new-dim">Height<input type="number" id="new-h" min="16" max="8192" step="1" inputmode="numeric"></label>
            <span class="new-unit">px</span>
          </div>
          <div class="new-bg-row">
            <span class="new-bg-label" id="new-bg-label">Background</span>
            <div class="segmented" role="radiogroup" aria-labelledby="new-bg-label">
              <button type="button" role="radio" data-bg="white" aria-checked="true">White</button>
              <button type="button" role="radio" data-bg="transparent" aria-checked="false" tabindex="-1">Transparent</button>
            </div>
          </div>
        </div>
        <footer class="modal-foot">
          <button type="button" class="btn-secondary" id="new-cancel">Cancel</button>
          <button type="button" class="btn-primary" id="new-create">Create</button>
        </footer>
      </div>
    </div>

    <div class="modal-backdrop" id="ocr-modal" hidden>
      <div class="modal modal-ocr" role="dialog" aria-modal="true" aria-labelledby="ocr-title" tabindex="-1">
        <header class="modal-head">
          <div class="modal-heading">
            <h2 class="modal-title" id="ocr-title">Extract text</h2>
            <p class="modal-desc">Recognises text on the current capture, annotations included.</p>
          </div>
          <button type="button" class="icon-btn modal-x" id="ocr-close" aria-label="Close" title="Close (Esc)">${ICONS.close}</button>
        </header>
        <div class="modal-body ocr-body">
          <div class="ocr-controls">
            <label class="ocr-lang">
              <span class="ocr-lang-label">Language</span>
              <select class="ocr-select" id="ocr-lang" aria-label="OCR language">
                <option value="eng">English</option>
                <option value="swe">Swedish</option>
              </select>
            </label>
            <button type="button" class="btn-secondary ocr-run" id="ocr-run">Extract text</button>
            <span class="ocr-busy" id="ocr-busy" hidden>Reading…</span>
          </div>
          <textarea class="ocr-text" id="ocr-text" readonly spellcheck="false" aria-label="Extracted text" placeholder="Recognised text will appear here."></textarea>
          <p class="ocr-status" id="ocr-status" role="status" aria-live="polite"></p>
        </div>
        <footer class="modal-foot ocr-foot">
          <span class="ocr-meta" id="ocr-meta">Language: English</span>
          <div class="ocr-actions">
            <button type="button" class="btn-secondary" id="ocr-cancel">Close</button>
            <button type="button" class="btn-primary" id="ocr-copy" disabled>Copy text</button>
          </div>
        </footer>
      </div>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;

  const editorEl = $<HTMLDivElement>("#editor");
  const stageEl = $<HTMLElement>(".stage");
  const emptyEl = $<HTMLDivElement>("#empty");
  const statusEl = $<HTMLSpanElement>("#status");
  const dotEl = $<HTMLSpanElement>("#dot");
  /** Version from the backend, for the About dialog + settings. */
  let appVersion = "";
  const toolsEl = $<HTMLDivElement>("#tools");
  const captureBtn = $<HTMLButtonElement>("#capture");
  const caretBtn = $<HTMLButtonElement>("#capture-caret");
  const modeLabelEl = $<HTMLSpanElement>("#capture-mode-label");
  const menuEl = $<HTMLDivElement>("#capture-menu");
  const splitEl = $<HTMLDivElement>("#capture-split");
  const themeBtn = $<HTMLButtonElement>("#theme-toggle");
  const recScopeEl = $<HTMLSpanElement>("#rec-scope");
  const recPillEl = $<HTMLDivElement>("#rec-pill");
  const recTimerEl = $<HTMLSpanElement>("#rec-timer");
  const recFormatEl = $<HTMLSpanElement>("#rec-format");
  const recStopBtn = $<HTMLButtonElement>("#rec-stop");
  const recPauseBtn = $<HTMLButtonElement>("#rec-pause");
  const undoBtn = $<HTMLButtonElement>("#undo");
  const redoBtn = $<HTMLButtonElement>("#redo");
  const copyBtn = $<HTMLButtonElement>("#copy");
  const saveBtn = $<HTMLButtonElement>("#save");
  const saveAsBtn = $<HTMLButtonElement>("#save-as");
  const swatchesEl = $<HTMLDivElement>("#swatches");
  const customColorEl = $<HTMLInputElement>("#color-custom");
  const fontSelect = $<HTMLSelectElement>("#font-family");
  const sizeInput = $<HTMLInputElement>("#font-size");
  const sizeDownBtn = $<HTMLButtonElement>("#size-down");
  const sizeUpBtn = $<HTMLButtonElement>("#size-up");
  const boldBtn = $<HTMLButtonElement>("#text-bold");
  const italicBtn = $<HTMLButtonElement>("#text-italic");
  const blurModesEl = $<HTMLDivElement>("#blur-modes");
  const blurRadiusInput = $<HTMLInputElement>("#blur-radius");
  const blurRadiusOut = $<HTMLOutputElement>("#blur-radius-out");
  const blurHint = $<HTMLParagraphElement>("#blur-hint");
  const radiusField = $<HTMLDivElement>("#blur-radius-field");
  const propsEl = $<HTMLElement>("#props");
  const toolSizeGroup = $<HTMLElement>("#tool-size-group");
  const toolSizeInput = $<HTMLInputElement>("#tool-size");
  const toolSizeLabel = $<HTMLLabelElement>("#tool-size-label");
  const toolSizeOut = $<HTMLOutputElement>("#tool-size-out");
  const toolSizeNote = $<HTMLParagraphElement>("#tool-size-note");
  const brushPreview = $<HTMLDivElement>("#brush-preview");
  const brushPreviewDot = $<HTMLSpanElement>("#brush-preview-dot");
  const brushPreviewValue = $<HTMLSpanElement>("#brush-preview-value");
  const shapePicker = $<HTMLDivElement>("#shape-picker");
  const shadowGroup = $<HTMLElement>("#shadow-group");
  const shadowToggle = $<HTMLButtonElement>("#shadow-toggle");
  const shadowFields = $<HTMLDivElement>("#shadow-fields");
  const shadowBlurInput = $<HTMLInputElement>("#shadow-blur");
  const shadowBlurOut = $<HTMLOutputElement>("#shadow-blur-out");
  const shadowAngleInput = $<HTMLInputElement>("#shadow-angle");
  const shadowAngleOut = $<HTMLOutputElement>("#shadow-angle-out");
  const shadowDistanceInput = $<HTMLInputElement>("#shadow-distance");
  const shadowDistanceOut = $<HTMLOutputElement>("#shadow-distance-out");
  const shadowOpacityInput = $<HTMLInputElement>("#shadow-opacity");
  const shadowOpacityOut = $<HTMLOutputElement>("#shadow-opacity-out");
  const shadowColorInput = $<HTMLInputElement>("#shadow-color");
  const shadowPreview = $<HTMLSpanElement>("#shadow-preview");
  const resizeGroup = $<HTMLElement>("#resize-group");
  const imageSizeOut = $<HTMLOutputElement>("#image-size-out");
  const resizeOpenBtn = $<HTMLButtonElement>("#resize-open");
  const resizePop = $<HTMLDivElement>("#resize-pop");
  const resizeCloseBtn = $<HTMLButtonElement>("#resize-close");
  const resizeCancelBtn = $<HTMLButtonElement>("#resize-cancel");
  const resizeApplyBtn = $<HTMLButtonElement>("#resize-apply");
  const resizeCurrentEl = $<HTMLParagraphElement>("#resize-current");
  const resizeRatioEl = $<HTMLSpanElement>("#resize-ratio");
  const resizeWInput = $<HTMLInputElement>("#resize-w");
  const resizeHInput = $<HTMLInputElement>("#resize-h");
  const resizeLockInput = $<HTMLInputElement>("#resize-lock");
  const resizeErrorEl = $<HTMLParagraphElement>("#resize-error");
  const propsBody = $<HTMLDivElement>("#props-body");
  const propsTitle = $<HTMLHeadingElement>("#props-title");
  const propsHint = $<HTMLParagraphElement>("#props-hint");
  const propsIdle = $<HTMLParagraphElement>("#props-idle");
  const strokeLabel = $<HTMLHeadingElement>("#stroke-label");
  const strokeValue = $<HTMLOutputElement>("#stroke-value");
  const colorValue = $<HTMLOutputElement>("#color-value");
  const hotkeyHintEl = $<HTMLSpanElement>("#hotkey-hint");
  const countdownEl = $<HTMLDivElement>("#countdown");
  const countdownNum = $<HTMLSpanElement>("#countdown-num");
  const countdownHint = $<HTMLParagraphElement>("#countdown-hint");
  const countdownCancelBtn = $<HTMLButtonElement>("#countdown-cancel");
  const guardEl = $<HTMLDivElement>("#close-guard");
  const guardFileEl = $<HTMLSpanElement>("#guard-file");
  const guardSaveBtn = $<HTMLButtonElement>("#guard-save");
  const guardDiscardBtn = $<HTMLButtonElement>("#guard-discard");
  const guardCancelBtn = $<HTMLButtonElement>("#guard-cancel");
  const filmToggleBtn = $<HTMLButtonElement>("#film-toggle");
  const filmStripEl = $<HTMLElement>("#filmstrip");
  const filmTrackEl = $<HTMLDivElement>("#film-track");
  const filmCountEl = $<HTMLSpanElement>("#film-count");
  const filmTotalEl = $<HTMLSpanElement>("#film-total");
  const filmEmptyEl = $<HTMLParagraphElement>("#film-empty");
  const filmClearBtn = $<HTMLButtonElement>("#film-clear");
  const filmCloseBtn = $<HTMLButtonElement>("#film-close");
  const playerEl = $<HTMLElement>("#player");
  const playerVideoEl = $<HTMLVideoElement>("#player-video");
  const playerPosterEl = $<HTMLImageElement>("#player-poster");
  const playerBigBtn = $<HTMLButtonElement>("#player-big");
  const playerNoteEl = $<HTMLParagraphElement>("#player-note");
  const playerToggleBtn = $<HTMLButtonElement>("#player-toggle");
  const playerCurEl = $<HTMLSpanElement>("#player-cur");
  const playerRangeEl = $<HTMLInputElement>("#player-range");
  const playerDurEl = $<HTMLSpanElement>("#player-dur");
  const playerMuteBtn = $<HTMLButtonElement>("#player-mute");
  const playerExtBtn = $<HTMLButtonElement>("#player-ext");
  const playerCloseBtn = $<HTMLButtonElement>("#player-close");
  const ocrBtn = $<HTMLButtonElement>("#ocr");
  const ocrModalEl = $<HTMLDivElement>("#ocr-modal");
  const ocrLangSelect = $<HTMLSelectElement>("#ocr-lang");
  const ocrRunBtn = $<HTMLButtonElement>("#ocr-run");
  const ocrBusyEl = $<HTMLSpanElement>("#ocr-busy");
  const ocrTextEl = $<HTMLTextAreaElement>("#ocr-text");
  const ocrStatusEl = $<HTMLParagraphElement>("#ocr-status");
  const ocrMetaEl = $<HTMLSpanElement>("#ocr-meta");
  const ocrCopyBtn = $<HTMLButtonElement>("#ocr-copy");
  const ocrCloseBtn = $<HTMLButtonElement>("#ocr-close");
  const ocrCancelBtn = $<HTMLButtonElement>("#ocr-cancel");
  const presetChipsEl = $<HTMLDivElement>("#preset-chips");
  const presetFormEl = $<HTMLFormElement>("#preset-form");
  const presetNameEl = $<HTMLInputElement>("#preset-name");
  const presetSaveToggle = $<HTMLButtonElement>("#preset-save-toggle");

  const editor = new Editor(editorEl) as InkEditor;

  // Dev-server seam: `pnpm dev` (port 1420) exposes the live editor as
  // `window.__snagEditor`, so tools can be driven programmatically — pixel
  // checks for the magnify composite, drag gates. A packaged app never has
  // that port, so this stays out of real builds.
  if (location.port === "1420") {
    (window as unknown as Record<string, unknown>).__snagEditor = editor;
  }

  // Quick text settings: font/size/bold/italic/colour floating right on the
  // caption being edited or selected. The editor bridge keeps this Tauri-free.
  const textBar = new TextBar({
    host: stageEl,
    fonts: FONTS,
    minSize: 8,
    maxSize: 200,
    bridge: {
      getActiveText: () => editor.getActiveText() as TextTarget | null,
      getOverlayAnchor: () => editor.getOverlayAnchor(),
      hasObject: (object) => editor.hasObject(object),
      subscribe: (callback) => editor.onTextContextChange(callback),
      commit: () => editor.commitTextStyles(),
      setFontFamily: (family) => editor.setFontFamily(family),
      setFontSize: (size) => editor.setFontSize(size),
      setBold: (bold) => editor.setTextBold(bold),
      setItalic: (italic) => editor.setTextItalic(italic),
      setColor: (color) => editor.setColor(color),
    },
  });
  const toolButtons = new Map<ShellToolId, HTMLButtonElement>();
  let hasImage = false;
  let busy = false;
  let mode: CaptureMode = readMode();
  let theme: Theme = currentTheme;
  let saveDir: string | null = readStore(DIR_KEY);
  let panel: SettingsPanel | null = null;
  let settings: ExportSettings = readExportSettings();
  let blurMode: BlurMode = readBlurMode();
  let blurRadius = readBlurRadius();
  /** Live countdown, so a second capture (or Esc) can cancel the first. */
  let countdownCancel: (() => void) | null = null;
  let guardBusy = false;
  let hotkeyStatus: HotkeyStatus | null = null;
  let widgetVisible = false;
  /** Mirror of the editor's live style, so presets still work on older builds. */
  let inkColor = readColor();
  let strokeWidth = readStroke();
  let presets: EditorPreset[] = readPresets();
  let recent: RecentShot[] = [];
  let loadedRecentId: string | null = null;
  let filmOpen = readStore(FILM_KEY) !== "closed";
  let ocrLang: OcrLang = readStore(OCR_LANG_KEY) === "swe" ? "swe" : "eng";
  let ocrBusy = false;
  let lastOcrText = "";
  /** Screen recording: our own start time, plus flags for async races. */
  let recording = false;
  let recStartedAt = 0;
  let recTick = 0;
  let recStarting = false;
  let recStopping = false;
  /** Pause is a backend stop of the frames; the pill only freezes its clock. */
  let recPaused = false;
  let recPausedAt = 0;
  /** Total time spent paused, subtracted from the pill's elapsed clock. */
  let recPausedMs = 0;
  /** Format the running take was started with (the setting can change mid-take). */
  let recFormatUsed: RecFormat | null = null;
  /** Which mode the primary Record button starts (persisted). */
  let recMode: RecMode = readRecMode();
  /** Region of the running take, or null for a full-screen take. */
  let recRegionUsed: Box | null = null;

  function setStatus(message: string, kind: StatusKind = "info"): void {
    statusEl.textContent = message;
    dotEl.dataset.kind = kind;
  }

  /* --------------------------------------------------------------- theme */

  function syncThemeButton(): void {
    const dark = theme === "dark";
    themeBtn.innerHTML = dark ? ICONS.sun : ICONS.moon;
    const label = dark ? "Switch to light theme" : "Switch to dark theme";
    themeBtn.title = label;
    themeBtn.setAttribute("aria-label", label);
    themeBtn.setAttribute("aria-pressed", String(dark));
  }

  function setTheme(next: Theme, persist = true): void {
    theme = next;
    applyTheme(next, persist);
    syncThemeButton();
    panel?.refresh(next);
  }

  /* -------------------------------------------------------------- settings */

  async function setWidget(on: boolean, announce = true): Promise<void> {
    const previous = settings.widget;
    settings = { ...settings, widget: on };
    saveExportSettings(settings);
    panel?.refresh();
    try {
      let shown = widgetVisible;
      if (on !== shown) {
        const raw = await invoke<boolean>("toggle_widget");
        shown = typeof raw === "boolean" ? raw : on;
        if (on !== shown) {
          const again = await invoke<boolean>("toggle_widget");
          shown = typeof again === "boolean" ? again : on;
        }
      }
      widgetVisible = shown;
      if (announce) {
        setStatus(shown ? "Floating widget shown" : "Floating widget hidden", shown ? "success" : "info");
      }
    } catch (e) {
      settings = { ...settings, widget: previous };
      saveExportSettings(settings);
      if (announce) setStatus(`Floating widget unavailable: ${errText(e)}`, "error");
    }
    panel?.refresh();
  }

  /* --------------------------------------------------------------- hotkeys */

  /** Shortcuts exactly as the Rust side expects them. */
  function hotkeyShortcuts(): Array<{ id: string; trigger: string }> {
    return [
      { id: "capture-full", trigger: settings.hotkeyFull },
      { id: "capture-region", trigger: settings.hotkeyRegion },
    ];
  }

  /** Defensive read of the backend's status payload. */
  function normalizeStatus(raw: unknown): HotkeyStatus {
    const src = (raw ?? {}) as { backend?: unknown; granted?: unknown };
    const backend: HotkeyBackend =
      src.backend === "portal" ? "portal" : src.backend === "native" ? "native" : "none";
    const granted = Array.isArray(src.granted)
      ? src.granted
          .map((entry) => entry as { id?: unknown; trigger?: unknown })
          .filter((entry) => !!entry && typeof entry.id === "string")
          .map((entry) => ({ id: String(entry.id), trigger: String(entry.trigger ?? "") }))
      : [];
    return { backend, granted };
  }

  /** Defensive read of the default-screenshot-tool payload. */
  function normalizeDefaultTool(raw: unknown): DefaultToolStatus {
    const src = (raw ?? {}) as {
      supported?: unknown;
      desktop?: unknown;
      isDefault?: unknown;
      canRestore?: unknown;
      command?: unknown;
      detail?: unknown;
    };
    return {
      supported: src.supported === true,
      desktop: typeof src.desktop === "string" ? src.desktop : "",
      isDefault: src.isDefault === true,
      canRestore: src.canRestore === true,
      command: typeof src.command === "string" ? src.command : "",
      detail: typeof src.detail === "string" ? src.detail : "",
    };
  }

  /** Bind (or unbind) the configured shortcuts; returns the live status. */
  async function applyHotkeys(announce = true): Promise<HotkeyStatus | null> {
    if (!settings.hotkeysEnabled) {
      try {
        await invoke("unregister_hotkeys");
      } catch {
        /* backend predates hotkeys — nothing to unbind */
      }
      hotkeyStatus = null;
      paintHotkeyHint();
      panel?.refresh();
      return null;
    }
    try {
      const raw = await invoke<unknown>("register_hotkeys", { shortcuts: hotkeyShortcuts() });
      hotkeyStatus = normalizeStatus(raw);
      if (announce) {
        const granted = hotkeyStatus.granted.length;
        if (hotkeyStatus.backend === "none") {
          setStatus(
            "No global-shortcut service accepted the bindings — see Settings → Global hotkeys.",
            "error",
          );
        } else if (granted === 0) {
          setStatus("The system granted none of your shortcuts — try a different trigger.", "error");
        } else {
          const via = hotkeyStatus.backend === "portal" ? "via the Wayland portal" : "natively";
          setStatus(`Hotkeys bound ${granted}/2 ${via}`, granted === 2 ? "success" : "info");
        }
      }
    } catch (e) {
      hotkeyStatus = null;
      if (announce) setStatus(`Global hotkeys unavailable: ${errText(e)}`, "error");
    }
    paintHotkeyHint();
    panel?.refresh();
    return hotkeyStatus;
  }

  const keyCaps = (trigger: string): string =>
    trigger
      .split("+")
      .filter(Boolean)
      .map((cap) => `<kbd>${cap.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</kbd>`)
      .join("");

  /** Top-bar hint: only claims a global shortcut when the system granted it. */
  function paintHotkeyHint(): void {
    const live =
      settings.hotkeysEnabled &&
      (hotkeyStatus?.backend === "portal" || hotkeyStatus?.backend === "native")
        ? hotkeyStatus
        : null;
    if (live && live.granted.length) {
      const full = live.granted.find((g) => g.id === "capture-full");
      const region = live.granted.find((g) => g.id === "capture-region");
      hotkeyHintEl.innerHTML = [
        full ? `${keyCaps(full.trigger)} full` : "",
        region ? `${keyCaps(region.trigger)} region` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return;
    }
    hotkeyHintEl.innerHTML = `<kbd>PrintScreen</kbd> full · <span class="key-pair"><kbd>Shift</kbd><kbd>PrintScreen</kbd></span> region`;
  }

  /* -------------------------------------------------------------- settings */

  /** Persist + apply an export/general preference change from the panel. */
  function updateSettings(patch: Partial<ExportSettings>, opts: { silent?: boolean } = {}): void {
    if (patch.widget !== undefined) {
      void setWidget(patch.widget, !opts.silent);
      return;
    }

    if (
      patch.hotkeysEnabled !== undefined ||
      patch.hotkeyFull !== undefined ||
      patch.hotkeyRegion !== undefined
    ) {
      settings = { ...settings, ...patch };
      saveExportSettings(settings);
      if (!opts.silent) {
        if (patch.hotkeysEnabled !== undefined) {
          setStatus(settings.hotkeysEnabled ? "Global hotkeys on — binding shortcuts…" : "Global hotkeys off");
        } else if (settings.hotkeysEnabled) {
          setStatus("Shortcut updated — rebinding…");
        }
      }
      void applyHotkeys(!opts.silent);
      panel?.refresh();
      return;
    }

    if (patch.minimizeToTray !== undefined) {
      const enabled = patch.minimizeToTray;
      const previous = settings.minimizeToTray;
      settings = { ...settings, minimizeToTray: enabled };
      saveExportSettings(settings);
      void invoke("set_minimize_to_tray", { enabled }).catch(() => {
        settings = { ...settings, minimizeToTray: previous };
        saveExportSettings(settings);
        panel?.refresh();
        setStatus("Minimize to tray is not available in this build.", "error");
      });
      if (!opts.silent) setStatus(enabled ? "Closing minimizes SnagCraft to the tray" : "Closing quits SnagCraft");
      panel?.refresh();
      return;
    }

    settings = { ...settings, ...patch };
    saveExportSettings(settings);
    if (
      patch.watermarkText !== undefined ||
      patch.watermarkOpacity !== undefined ||
      patch.watermarkCorner !== undefined
    ) {
      applyWatermark();
    }
    if (patch.splitFolders !== undefined || patch.recDir !== undefined) {
      void refreshRecentFromFolder();
      if (!opts.silent && patch.splitFolders !== undefined) {
        setStatus(
          settings.splitFolders
            ? "Recordings get their own folder"
            : "Recordings share the save folder",
        );
      }
    }
    if (!opts.silent) {
      if (patch.timer !== undefined) {
        setStatus(
          settings.timer > 0
            ? `Capture delay: ${settings.timer} s — press Capture to start the countdown`
            : "Capture delay: off — captures immediately",
        );
      } else if (patch.recFormat !== undefined) {
        setStatus(`Recording format: ${recFormatLabel(settings.recFormat)}`);
      } else if (patch.format !== undefined) {
        setStatus(
          `Export format: ${formatLabel(settings.format)}${
            settings.format === "png" ? "" : ` · quality ${settings.quality}`
          }`,
        );
      } else if (patch.quality !== undefined) {
        setStatus(`Export quality: ${settings.quality}`);
      } else if (patch.filename !== undefined) {
        setStatus(`Filename pattern: ${expandName(settings.filename)}`);
      } else if (patch.autoSave !== undefined) {
        setStatus(
          settings.autoSave
            ? "Auto-save on — every capture is written to the save folder"
            : "Auto-save off — new captures stay in the editor until you save them",
        );
      } else if (patch.checkUpdates !== undefined) {
        setStatus(
          settings.checkUpdates
            ? "SnagCraft will check GitHub once a day for a newer release"
            : "Automatic update checks off — File → Check for updates… still works",
        );
      }
    }
    panel?.refresh();
  }

  /** Filename the next save would produce (guard text + status). */
  const expandName = (pattern: string): string => buildFilename(pattern, settings.format, new Date());

  /* --------------------------------------------------------------- saving */

  /** Resolve the save folder, seeding it from the backend on first run. */
  async function ensureSaveDir(): Promise<string | null> {
    if (saveDir) return saveDir;
    try {
      const dir = await invoke<string>("default_save_dir");
      const trimmed = typeof dir === "string" ? dir.trim() : "";
      if (!trimmed) return null;
      saveDir = trimmed;
      writeStore(DIR_KEY, trimmed);
      panel?.refresh();
      return trimmed;
    } catch (e) {
      setStatus(`Could not determine the save folder: ${errText(e)}`, "error");
      return null;
    }
  }

  /** Put the save folder back to the OS default and remember it. */
  async function resetSaveDir(): Promise<string | null> {
    try {
      const dir = await invoke<string>("default_save_dir");
      const trimmed = typeof dir === "string" ? dir.trim() : "";
      if (!trimmed) {
        setStatus("Could not resolve the default save folder.", "error");
        return saveDir;
      }
      saveDir = trimmed;
      writeStore(DIR_KEY, trimmed);
      setStatus(`Save folder reset to default: ${trimmed}`, "success");
      panel?.refresh();
      void refreshRecentFromFolder();
      return trimmed;
    } catch (e) {
      setStatus(`Could not reset the save folder: ${errText(e)}`, "error");
      return saveDir;
    }
  }

  async function pickSaveDir(): Promise<string | null> {
    try {
      const dir = await invoke<string>("pick_save_dir");
      const trimmed = typeof dir === "string" ? dir.trim() : "";
      if (!trimmed) return saveDir;
      saveDir = trimmed;
      writeStore(DIR_KEY, trimmed);
      setStatus(`Save folder: ${trimmed}`);
      panel?.refresh();
      // The strip follows the folder the user just picked.
      void refreshRecentFromFolder();
      return trimmed;
    } catch (e) {
      const message = errText(e);
      if (/cancel/i.test(message)) {
        setStatus("Folder change cancelled");
      } else {
        setStatus(`Could not change folder: ${message}`, "error");
      }
      return saveDir;
    }
  }

  /** Pick a folder just for recordings (only used when the two are split). */
  async function pickRecDir(): Promise<string | null> {
    try {
      const dir = await invoke<string>("pick_save_dir");
      const trimmed = typeof dir === "string" ? dir.trim() : "";
      if (!trimmed) return settings.recDir || null;
      settings = { ...settings, recDir: trimmed };
      saveExportSettings(settings);
      setStatus(`Recording folder: ${trimmed}`);
      panel?.refresh();
      void refreshRecentFromFolder();
      return trimmed;
    } catch (e) {
      const message = errText(e);
      if (/cancel/i.test(message)) setStatus("Recording folder change cancelled");
      else setStatus(`Could not change the recording folder: ${message}`, "error");
      return settings.recDir || null;
    }
  }

  /** Recordings follow the save folder again. */
  async function resetRecDir(): Promise<string | null> {
    settings = { ...settings, recDir: "" };
    saveExportSettings(settings);
    setStatus("Recording folder follows the save folder again.");
    panel?.refresh();
    void refreshRecentFromFolder();
    return null;
  }

  /**
   * Write a data URL through `save_image` using the chosen format, quality and
   * filename pattern. Throws on failure so each caller can word its own status.
   */
  async function writeImage(
    dataUrl: string,
    edited: boolean,
  ): Promise<{ path: string; filename: string } | null> {
    const dir = await ensureSaveDir();
    if (!dir) return null;
    const filename = buildFilename(
      settings.filename,
      settings.format,
      new Date(),
      edited ? "-edited" : "",
    );
    const path = await invoke<string>("save_image", {
      dataUrl,
      dir,
      filename,
      format: settings.format,
      quality: Math.round(settings.quality),
    });
    return { path: typeof path === "string" && path ? path : `${dir}/${filename}`, filename };
  }

  /**
   * Auto-save a freshly loaded capture. Never throws — capture must survive.
   * `prefix` replaces the bare "Saved …" wording (e.g. "Captured window 800 × 600").
   */
  async function autoSave(dataUrl: string, prefix?: string): Promise<void> {
    // Settings → General → Auto-save captures. Off leaves the capture in the
    // editor untouched; Save and Save As still write it on demand.
    if (!settings.autoSave) {
      setStatus(
        prefix
          ? `${prefix} — auto-save is off, not saved to disk`
          : "Capture ready — auto-save is off, not saved to disk",
      );
      return;
    }
    try {
      const saved = await writeImage(dataUrl, false);
      if (!saved) return;
      setStatus(prefix ? `${prefix} — saved ${saved.filename}` : `Saved ${saved.filename}`, "success");
    } catch (e) {
      setStatus(`Capture kept in the editor — auto-save failed: ${errText(e)}`, "error");
    }
  }

  /**
   * Ctrl+S / Save: writes a NEW copy of the edited capture (never overwrites
   * the original — the backend dedupes colliding names) and surfaces it in
   * Recent, so every saved edit is a version you can browse back to.
   */
  async function saveEdited(): Promise<boolean> {
    if (!hasImage) {
      setStatus("Nothing to save yet — capture a screen first.", "error");
      return false;
    }
    if (!isDirty()) {
      setStatus("No changes to save");
      return false;
    }
    try {
      const saved = await writeImage(editor.flatten(), true);
      if (!saved) return false;
      // The copy is now the open document: highlight it once the folder scan
      // brings it into Recent (newest first, with a real thumbnail).
      loadedRecentId = `file-${saved.path}`;
      setStatus(`Saved copy ${saved.filename}`, "success");
      syncDirty();
      void refreshRecentFromFolder();
      return true;
    } catch (e) {
      setStatus(`Save failed: ${errText(e)}`, "error");
      return false;
    }
  }

  /**
   * Ctrl+Shift+S / Save As…: native dialog, suggested name from the filename
   * pattern (no -edited suffix), current default format and quality.
   */
  async function saveAs(): Promise<void> {
    if (!hasImage) {
      setStatus("Nothing to save yet — capture a screen first.", "error");
      return;
    }
    try {
      const path = await invoke<string>("save_image_as", {
        dataUrl: editor.flatten(),
        suggestedName: buildFilename(settings.filename, settings.format),
        format: settings.format,
        quality: Math.round(settings.quality),
      });
      const saved = typeof path === "string" ? path.trim() : "";
      setStatus(saved ? `Saved ${saved}` : "Saved copy", "success");
      syncDirty();
    } catch (e) {
      const message = errText(e);
      if (/cancel/i.test(message)) {
        setStatus("Save As cancelled");
      } else {
        setStatus(`Save As failed: ${message}`, "error");
      }
    }
  }

  /** Wave 4 adds Editor#isDirty; fall back to history depth if it has not landed. */
  function isDirty(): boolean {
    const probe = editor as unknown as { isDirty?: () => boolean };
    return typeof probe.isDirty === "function" ? probe.isDirty() : editor.canUndo();
  }

  /** Tell the Rust side whether closing needs a guard. Best-effort. */
  function syncDirty(): void {
    void invoke("set_dirty", { dirty: hasImage && isDirty() }).catch(() => {
      /* older backend without set_dirty — the guard then simply never fires */
    });
  }

  /* ------------------------------------------------------------ countdown */

  /**
   * Show a cancellable countdown before the grab. Resolves true when it runs
   * out and false when the user cancels (Esc, the button, or a new capture).
   */
  function runCountdown(seconds: number, requested: CaptureMode): Promise<boolean> {
    countdownCancel?.();
    return new Promise<boolean>((resolve) => {
      let remaining = Math.max(1, Math.round(seconds));
      let settled = false;
      const timers: number[] = [];

      const settle = (capture: boolean): void => {
        if (settled) return;
        settled = true;
        for (const id of timers) window.clearTimeout(id);
        timers.length = 0;
        countdownCancelBtn.removeEventListener("click", cancel);
        document.removeEventListener("keydown", cancel, true);
        countdownEl.classList.remove("is-open");
        countdownEl.hidden = true;
        document.body.classList.remove("is-counting", "countdown-hud");
        void invoke("set_hud_mode", { enabled: false, width: 0, height: 0 }).catch(() => {
          /* nothing to restore */
        });
        if (countdownCancel === cancel) countdownCancel = null;
        resolve(capture);
      };

      const cancel = (): void => settle(false);

      const tick = (): void => {
        if (remaining <= 0) {
          settle(true);
          return;
        }
        countdownNum.textContent = String(remaining);
        countdownNum.classList.remove("is-tick");
        void countdownNum.offsetWidth;
        countdownNum.classList.add("is-tick");
        remaining -= 1;
        timers.push(window.setTimeout(tick, 1000));
      };

      countdownHint.textContent = `${CAPTURE_HINT[requested]} · Esc to cancel`;
      // The HUD hides #app, so the timer must live directly under <body> to stay visible.
      if (countdownEl.parentElement !== document.body) {
        document.body.appendChild(countdownEl);
      }
      countdownEl.hidden = false;
      document.body.classList.add("is-counting", "countdown-hud");
      // The timer gets its own small always-on-top window: the desktop stays
      // usable, so the user can open menus and prepare the screen while it counts.
      void invoke("set_hud_mode", { enabled: true, width: 280, height: 228 }).catch(() => {
        /* older backend: the countdown stays a full-window overlay */
      });
      void countdownEl.offsetWidth;
      countdownEl.classList.add("is-open");
      countdownCancel = cancel;
      countdownCancelBtn.addEventListener("click", cancel);
      document.addEventListener("keydown", cancel, true);
      countdownCancelBtn.focus({ preventScroll: true });
      tick();
    });
  }

  /* ------------------------------------------------------------ close guard */

  function guardKeyDown(ev: KeyboardEvent): void {
    if (guardEl.hidden) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      dismissGuard("Close cancelled — your capture is still here.");
      return;
    }
    if (ev.key !== "Tab") return;
    const items = [guardCancelBtn, guardDiscardBtn, guardSaveBtn].filter((b) => !b.disabled);
    const active = document.activeElement as HTMLElement | null;
    const index = items.indexOf(active as HTMLButtonElement);
    ev.preventDefault();
    const step = ev.shiftKey ? -1 : 1;
    const next = items[(index + step + items.length) % items.length];
    next?.focus();
  }

  function dismissGuard(message?: string): void {
    if (guardEl.hidden) return;
    guardEl.classList.remove("is-open");
    guardEl.hidden = true;
    document.removeEventListener("keydown", guardKeyDown, true);
    guardBusy = false;
    guardSaveBtn.disabled = false;
    guardDiscardBtn.disabled = false;
    if (message) setStatus(message);
  }

  function showGuard(): void {
    if (!guardEl.hidden) return;
    countdownCancel?.();
    guardFileEl.textContent = expandName(settings.filename);
    guardEl.hidden = false;
    void guardEl.offsetWidth;
    guardEl.classList.add("is-open");
    guardSaveBtn.disabled = !(hasImage && isDirty());
    guardDiscardBtn.disabled = false;
    guardCancelBtn.disabled = false;
    document.addEventListener("keydown", guardKeyDown, true);
    (guardSaveBtn.disabled ? guardDiscardBtn : guardSaveBtn).focus({ preventScroll: true });
  }

  /** Ask Rust to close for real; resolves false when the invoke failed. */
  async function forceClose(): Promise<boolean> {
    try {
      await invoke("force_close");
      return true;
    } catch (e) {
      setStatus(`Could not close the window: ${errText(e)}`, "error");
      return false;
    }
  }

  async function onGuardSave(): Promise<void> {
    if (guardBusy) return;
    guardBusy = true;
    guardSaveBtn.disabled = true;
    guardDiscardBtn.disabled = true;
    guardCancelBtn.disabled = true;
    if (hasImage && isDirty()) {
      try {
        const saved = await writeImage(editor.flatten(), true);
        if (!saved) {
          guardBusy = false;
          guardSaveBtn.disabled = false;
          guardDiscardBtn.disabled = false;
          guardCancelBtn.disabled = false;
          return;
        }
        setStatus(`Saved copy ${saved.filename}`, "success");
      } catch (e) {
        setStatus(`Save failed: ${errText(e)}`, "error");
        guardBusy = false;
        guardSaveBtn.disabled = false;
        guardDiscardBtn.disabled = false;
        guardCancelBtn.disabled = false;
        return;
      }
    }
    const closed = await forceClose();
    if (closed) {
      guardBusy = false;
      dismissGuard();
    } else {
      guardBusy = false;
      guardSaveBtn.disabled = !(hasImage && isDirty());
      guardDiscardBtn.disabled = false;
      guardCancelBtn.disabled = false;
    }
  }

  async function onGuardDiscard(): Promise<void> {
    if (guardBusy) return;
    guardBusy = true;
    guardSaveBtn.disabled = true;
    guardDiscardBtn.disabled = true;
    guardCancelBtn.disabled = true;
    const closed = await forceClose();
    if (closed) {
      guardBusy = false;
      dismissGuard();
    } else {
      guardBusy = false;
      guardSaveBtn.disabled = !(hasImage && isDirty());
      guardDiscardBtn.disabled = false;
      guardCancelBtn.disabled = false;
    }
  }

  /* ------------------------------------------------------------- history */

  function syncHistory(): void {
    let canUndo = false;
    let canRedo = false;
    try {
      canUndo = hasImage && editor.canUndo();
      canRedo = hasImage && editor.canRedo();
    } catch {
      canUndo = false;
      canRedo = false;
    }
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
  }

  function setImageState(loaded: boolean): void {
    // A capture or an image takes the stage back from the recording player.
    if (loaded && playerIsOpen()) closePlayer();
    hasImage = loaded;
    stageEl.classList.toggle("has-image", loaded);
    emptyEl.setAttribute("aria-hidden", String(loaded));
    propsIdle.hidden = loaded;
    copyBtn.disabled = !loaded;
    saveBtn.disabled = !loaded;
    saveAsBtn.disabled = !loaded;
    ocrBtn.disabled = !loaded;
    paintResizeState();
    syncHistory();
    syncDirty();
  }

  /* ---------------------------------------------------------------- capture */

  /**
   * Menu visibility is tracked in JS (not via `hidden` alone) so the close
   * animation can play out before the panel is actually removed. One controller
   * drives both split buttons, so Capture and Record behave identically.
   */
  type MenuController = { setOpen(open: boolean): void; isOpen(): boolean };

  function createMenu(
    split: HTMLElement,
    menu: HTMLElement,
    caret: HTMLButtonElement,
  ): MenuController {
    let open = false;
    let closeTimer: number | null = null;

    const setOpen = (next: boolean): void => {
      if (closeTimer !== null) {
        window.clearTimeout(closeTimer);
        closeTimer = null;
      }
      const wasOpen = open;
      open = next;
      split.classList.toggle("is-open", next);
      caret.setAttribute("aria-expanded", String(next));

      if (next) {
        menu.classList.remove("is-closing");
        if (!wasOpen) {
          menu.hidden = false;
          menu.classList.remove("is-open");
          void menu.offsetWidth;
          menu.classList.add("is-open");
        }
        const active = menu.querySelector<HTMLButtonElement>(".menu-item.is-active");
        (active ?? menu.querySelector<HTMLButtonElement>(".menu-item"))?.focus({
          preventScroll: true,
        });
        return;
      }

      if (!wasOpen || menu.hidden) return;
      menu.classList.remove("is-open");
      menu.classList.add("is-closing");
      closeTimer = window.setTimeout(() => {
        closeTimer = null;
        menu.hidden = true;
        menu.classList.remove("is-closing");
      }, 130);
    };

    return { setOpen, isOpen: () => open };
  }

  const captureMenu = createMenu(splitEl, menuEl, caretBtn);

  const setMenuOpen = (open: boolean): void => captureMenu.setOpen(open);

  function setMode(next: CaptureMode, announce = false): void {
    mode = next;
    writeStore(MODE_KEY, next);
    for (const item of Array.from(menuEl.querySelectorAll<HTMLButtonElement>(".menu-item"))) {
      const active = item.dataset.mode === next;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-checked", String(active));
    }
    const labels: Record<
      CaptureMode,
      { short: string; title: string; aria: string; announce: string }
    > = {
      full: {
        short: "Full",
        title: "Capture full screen (PrintScreen)",
        aria: "Capture full screen",
        announce: "Capture mode: full screen.",
      },
      region: {
        short: "Region",
        title: "Select a region to capture (Shift+PrintScreen)",
        aria: "Select region to capture",
        announce: "Capture mode: select region — press Capture, then drag on the screen.",
      },
      window: {
        short: "Window",
        title: "Capture a window — pick one in the window chooser",
        aria: "Capture a window",
        announce: "Capture mode: window — a chooser asks which window to grab.",
      },
      monitor: {
        short: "Screen",
        title: "Choose a screen to capture — pick one in the screen chooser",
        aria: "Choose a screen to capture",
        announce: "Capture mode: choose screen — a chooser asks which monitor to grab.",
      },
      scrolling: {
        short: "Scroll",
        title: "Scrolling capture — select a region, then scroll it yourself",
        aria: "Start a scrolling capture",
        announce: "Scrolling capture: press Capture, drag a region, then scroll it yourself.",
      },
      interval: {
        short: "Interval",
        title: "Interval capture — a screenshot every few seconds, then a timelapse",
        aria: "Start interval capture",
        announce: "Interval capture: press Capture to start the loop, then Stop when you have enough shots.",
      },
    };
    const copy = labels[next];
    modeLabelEl.textContent = copy.short;
    captureBtn.title = copy.title;
    captureBtn.setAttribute("aria-label", copy.aria);
    if (announce) setStatus(copy.announce);
  }

  /** Persist + paint the recording mode; the primary Record button uses it. */
  function setRecMode(next: RecMode, announce = false): void {
    recMode = next;
    writeStore(REC_MODE_KEY, next);
    if (announce) {
      setStatus(
        next === "region"
          ? "Recording mode: region — drag the area to record."
          : next === "window"
            ? "Recording mode: window — the system picker asks which window to record."
            : "Recording mode: full screen — the system picker asks which screen to record.",
      );
    }
  }

  function setBusy(value: boolean): void {
    busy = value;
    captureBtn.disabled = value;
    caretBtn.disabled = value;
    captureBtn.classList.toggle("is-busy", value);
    splitEl.classList.toggle("is-busy", value);
    if (value) setMenuOpen(false);
  }

  /* ------------------------------------------------------------ recording */

  /** mm:ss for the pill; minutes keep counting past 60 on long takes. */
  function elapsedLabel(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const mm = String(Math.floor(total / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function paintRecTimer(): void {
    if (!recording) return;
    // Paused takes keep the clock frozen at the moment Pause was pressed; a
    // resumed take skips over the paused span instead of jumping by it.
    const now = recPaused && recPausedAt ? recPausedAt : Date.now();
    recTimerEl.textContent = elapsedLabel(now - recStartedAt - recPausedMs);
  }

  /** Pill shows Pause while live and Resume while paused; the dot stops pulsing. */
  function paintRecPaused(): void {
    recPillEl.classList.toggle("is-paused", recPaused);
    recPauseBtn.textContent = recPaused ? "Resume" : "Pause";
    recPauseBtn.setAttribute("aria-pressed", String(recPaused));
    recPauseBtn.title = recPaused ? "Resume the recording" : "Pause the recording";
    recTimerEl.setAttribute("aria-label", recPaused ? "Recording time, paused" : "Recording time");
    paintRecTimer();
  }

  /** Show/hide the recording pill and lock the capture controls while a take runs. */
  function paintRecording(active: boolean): void {
    recPillEl.hidden = !active;
    recScopeEl.hidden = !(active && recRegionUsed !== null);
    recScopeEl.textContent = recRegionUsed ? "Region" : "";
    recFormatEl.textContent = recFormatLabel(recFormatUsed ?? settings.recFormat);
    recPauseBtn.hidden = !active;
    captureBtn.disabled = active || busy;
    caretBtn.disabled = active || busy;
    if (active) {
      setMenuOpen(false);
      paintRecPaused();
    }
  }

  function beginRecording(): void {
    if (!recording) recording = true;
    if (!recStartedAt) recStartedAt = Date.now();
    recPaused = false;
    recPausedAt = 0;
    recPausedMs = 0;
    window.clearInterval(recTick);
    paintRecPaused();
    recTick = window.setInterval(paintRecTimer, 500);
    paintRecording(true);
  }

  function endRecording(): void {
    recording = false;
    recStartedAt = 0;
    recPaused = false;
    recPausedAt = 0;
    recPausedMs = 0;
    recFormatUsed = null;
    recRegionUsed = null;
    window.clearInterval(recTick);
    recTick = 0;
    recTimerEl.textContent = "00:00";
    paintRecording(false);
  }

  /** Ask the backend to hold the frames (pause) or start them again (resume). */
  async function toggleRecPause(): Promise<void> {
    if (!recording || recStopping) return;
    const next = !recPaused;
    recPauseBtn.disabled = true;
    try {
      await invoke(next ? "pause_recording" : "resume_recording");
    } catch (e) {
      setStatus(`Could not ${next ? "pause" : "resume"} the recording: ${errText(e)}`, "error");
      return;
    } finally {
      recPauseBtn.disabled = false;
    }
    const stamp = Date.now();
    if (recPaused && recPausedAt) recPausedMs += stamp - recPausedAt;
    recPaused = next;
    recPausedAt = next ? stamp : 0;
    paintRecPaused();
    setStatus(next ? "Recording paused" : "Recording resumed", next ? "info" : "recording");
  }

  /** Filename the backend writes: SnagCraft-<date>-<time>.<mp4|gif>. */
  const recordingFilename = (): string =>
    `SnagCraft-${expandPattern("{date}-{time}").replace(/\s+/g, "-")}.${settings.recFormat}`;

  /** Fullscreen frozen screenshot + drag box — the region selector used by capture. */
  async function pickRecordingRegion(): Promise<Box | null> {
    let full = false;
    try {
      await invoke("set_fullscreen", { full: true });
      full = true;
      await settle();
      const shot = await invoke<CaptureResult>("capture_screenshot");
      setStatus("Drag to select the area to record — Enter to confirm, Esc to cancel.");
      const box = await selectRegion(shot.dataUrl);
      await invoke("set_fullscreen", { full: false });
      full = false;
      return box;
    } finally {
      if (full) {
        try {
          await invoke("set_fullscreen", { full: false });
        } catch {
          /* restore failed — the window is left as-is rather than stuck fullscreen */
        }
      }
    }
  }

  /**
   * Start a take in `next` mode. Full screen hands over to the OS screen picker;
   * region runs the fullscreen selector first and passes the box to the backend.
   * Selecting a mode from the Record menu calls this with that mode.
   */
  async function startRecording(next: RecMode = recMode): Promise<void> {
    if (recording || recStarting || recStopping) return;
    if (busy) {
      setStatus("Wait for the capture to finish before recording.");
      return;
    }
    // Recordings share the save folder unless the user split them off.
    const dir =
      settings.splitFolders && settings.recDir.trim()
        ? settings.recDir.trim()
        : await ensureSaveDir();
    if (!dir) {
      setStatus("Pick a save folder before recording.", "error");
      return;
    }
    recStarting = true;
    recFormatUsed = settings.recFormat;
    recFormatEl.textContent = recFormatLabel(recFormatUsed);
    try {
      let region: Box | null = null;
      if (next === "region") {
        setStatus("Choose the area to record — drag on the screen.");
        try {
          region = await pickRecordingRegion();
        } catch (e) {
          const message = errText(e);
          setStatus(
            isRecordingCancel(message)
              ? "Region recording cancelled — nothing was recorded."
              : `Could not grab the screen for the region: ${message}`,
            isRecordingCancel(message) ? "info" : "error",
          );
          return;
        }
        if (!region) {
          setStatus("Region recording cancelled — nothing was recorded.");
          return;
        }
        setStatus(
          `Starting ${recFormatLabel(settings.recFormat)} region recording — ${region.width} × ${region.height}…`,
        );
      } else if (next === "window") {
        setStatus(`Starting ${recFormatLabel(settings.recFormat)} window recording — choose a window…`);
      } else {
        setStatus(`Starting ${recFormatLabel(settings.recFormat)} recording — choose a screen…`);
      }

      // Audio is always sent in full: the backend decides which halves it can
      // honour, and null means "no microphone" rather than "unset".
      const audio = { mic: settings.mic || null, system: settings.systemAudio };
      const args: Record<string, unknown> = {
        format: settings.recFormat,
        dir,
        filename: recordingFilename(),
        audio,
        // Fullscreen and region takes capture a monitor; window mode asks the
        // portal for one window instead.
        source: next === "window" ? "window" : "monitor",
      };
      // Full screen omits `region` entirely so the backend runs its OS picker.
      if (region) args.region = region;
      // Set before the invoke: the backend's `recording-state` event can land
      // first, and the pill must already know this is a region take.
      recRegionUsed = region;
      await invoke("start_recording", args);

      recStartedAt = Date.now();
      beginRecording();
      setStatus(
        region
          ? `Recording a ${region.width} × ${region.height} region — click Stop when you're done.`
          : "Recording — click Stop when you're done.",
        "recording",
      );
    } catch (e) {
      const message = errText(e);
      if (/portal|permission|denied|deny|refus/i.test(message)) {
        setStatus(
          "Recording cancelled — screen sharing wasn't allowed. Approve the system prompt and try again.",
          "error",
        );
      } else if (isRecordingCancel(message)) {
        // Only a bare user dismissal lands here; every other failure is shown.
        setStatus("Recording cancelled — no screen was picked.");
      } else {
        setStatus(
          `Could not start recording: ${message} — see ~/.cache/snagcraft-portal.log for details`,
          "error",
        );
      }
      recRegionUsed = null;
      endRecording();
    } finally {
      recStarting = false;
    }
  }

  async function stopRecording(): Promise<void> {
    if (!recording || recStopping) return;
    recStopping = true;
    recStopBtn.disabled = true;
    setStatus("Finishing the recording…");
    try {
      const path = await invoke<string>("stop_recording");
      const saved = typeof path === "string" ? path.trim() : "";
      endRecording();
      if (saved) {
        setStatus(`Recording saved: ${saved}`, "success");
        void addRecentRecording(saved, recRegionUsed ? "Region recording" : "Recording");
      } else {
        setStatus("Recording stopped, but no file was written.", "error");
      }
    } catch (e) {
      endRecording();
      setStatus(`Could not save the recording: ${errText(e)}`, "error");
    } finally {
      recStopping = false;
      recStopBtn.disabled = false;
    }
  }

  /**
   * Let the webview settle into the new viewport size. Two animation frames are
   * enough when frames are flowing; the timeout races them so a throttled or
   * occluded window can never stall the capture flow.
   */
  function settle(): Promise<void> {
    const frames = new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const timer = new Promise<void>((resolve) => {
      window.setTimeout(resolve, 120);
    });
    return Promise.race([frames, timer]);
  }

  /**
   * Snagit-style region capture: go fullscreen so the window IS the desktop,
   * freeze the screen, drag a box over it, restore the window, then crop.
   * The window is ALWAYS restored, on success, cancel and error alike.
   */
  async function runRegionCapture(): Promise<void> {
    let full = false;
    try {
      await invoke("set_fullscreen", { full: true });
      full = true;
      await settle();

      const shot = await invoke<CaptureResult>("capture_screenshot");
      setStatus("Drag to select a region — Enter to confirm, Esc to cancel.");
      const box = await selectRegion(shot.dataUrl);

      await invoke("set_fullscreen", { full: false });
      full = false;

      if (!box) {
        setStatus("Region capture cancelled");
        return;
      }
      const cropped = await cropDataUrl(shot.dataUrl, box);
      await editor.load(cropped);
      setImageState(true);
      setStatus(`Captured region ${box.width} × ${box.height}`, "success");
      await addRecent(cropped, "Region");
      await autoSave(cropped);
    } finally {
      if (full) {
        try {
          await invoke("set_fullscreen", { full: false });
        } catch {
          /* restore failed — the window is left as-is rather than stuck half-way */
        }
      }
    }
  }

  /* ---------------------------------------------------- scrolling capture */

  /** Live hook into the visible status card (null while no cast is running). */
  let scrollFeed: ((status: ScrollingStatus) => void) | null = null;
  /** Frames accepted by the backend for the take that just finished. */
  let scrollFrames = 0;

  const SCROLL_HEIGHT_CAP = 40000;

  /** Friendly copy for the portal / screen-lock / height-cap failure modes. */
  function scrollErrorText(e: unknown): string {
    const raw = errText(e).trim();
    if (/lock/i.test(raw)) {
      return "The screen is locked — unlock it, then start the scrolling capture again.";
    }
    if (/(height|too tall|too high|maximum|max_?height|\bcap\b)/i.test(raw)) {
      return "That would pass the 40 000 px height limit. Select a shorter region, or capture the page in two passes.";
    }
    if (/portal|permission|denied|refus|share|screencast|pipewire/i.test(raw)) {
      return "Screen sharing wasn't allowed. Approve the system prompt (or pick this window) and try again.";
    }
    return `Scrolling capture failed: ${raw}`;
  }

  /**
   * Float the live progress card and resolve on Enter / Done / Esc / Cancel.
   * The window is click-through while this is open, so `Alt` briefly hands the
   * pointer back for clicking Done (auto-restores after 5 s).
   */
  function showScrollCard(box: { width: number; height: number }): Promise<"done" | "cancel"> {
    return new Promise<"done" | "cancel">((resolve) => {
      const el = document.createElement("div");
      el.className = "scroll-card";
      el.tabIndex = -1;
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", "Scrolling capture in progress");
      el.innerHTML = `
        <div class="scroll-card-head">
          <span class="scroll-live" aria-hidden="true"></span>
          <span class="scroll-title">Scrolling capture</span>
          <span class="scroll-region">${box.width} × ${box.height}</span>
        </div>
        <div class="scroll-metrics">
          <span class="scroll-metric"><span class="scroll-num" data-frames>0</span><span class="scroll-unit">frames</span></span>
          <span class="scroll-metric"><span class="scroll-num" data-height>0</span><span class="scroll-unit">px captured</span></span>
        </div>
        <div class="scroll-bar" aria-hidden="true"><span class="scroll-bar-fill" data-bar></span></div>
        <p class="scroll-warn" data-warn role="status" aria-live="polite" hidden></p>
        <p class="scroll-hint" data-hint>Scroll the window, then press <kbd>Enter</kbd> or <strong>Done</strong>.</p>
        <div class="scroll-actions">
          <button type="button" class="scroll-btn scroll-btn-ghost" data-act="cancel">Cancel</button>
          <button type="button" class="scroll-btn scroll-btn-primary" data-act="done">Done</button>
        </div>
        <p class="scroll-note" data-note><kbd>Esc</kbd> cancel</p>
      `;

      document.querySelectorAll(".scroll-card").forEach((old) => old.remove());
      document.body.appendChild(el);

      const framesEl = el.querySelector<HTMLElement>("[data-frames]");
      const heightEl = el.querySelector<HTMLElement>("[data-height]");
      const barEl = el.querySelector<HTMLElement>("[data-bar]");
      const warnEl = el.querySelector<HTMLElement>("[data-warn]");
      const hintEl = el.querySelector<HTMLElement>("[data-hint]");

      let settled = false;

      const update = (status: ScrollingStatus): void => {
        // Backend numbers can be missing or negative mid-stream; clamp defensively.
        const frames = Number(status.frames);
        const height = Number(status.height);
        const nFrames = Number.isFinite(frames) ? Math.max(0, Math.round(frames)) : 0;
        const nHeight = Number.isFinite(height) ? Math.max(0, Math.round(height)) : 0;
        scrollFrames = nFrames;
        if (framesEl) framesEl.textContent = String(nFrames);
        if (heightEl) heightEl.textContent = nHeight.toLocaleString("en-US");
        if (barEl) {
          const pct = Math.min(100, Math.max(2, (nHeight / SCROLL_HEIGHT_CAP) * 100));
          barEl.style.width = `${pct}%`;
        }

        const warning = typeof status.warning === "string" ? status.warning.trim() : "";
        const confidence = Number(status.confidence);
        const shaky = Number.isFinite(confidence) && confidence > 0 && confidence < 0.45;
        if (!warnEl) return;
        if (warning) {
          warnEl.hidden = false;
          warnEl.dataset.kind = "hard";
          const guided = /[—–-]{1,2}\s/.test(warning);
          warnEl.textContent =
            /fast|speed|slow/i.test(warning) && !guided
              ? `${warning} — pause a moment before the next scroll.`
              : warning;
          el.classList.add("has-warning");
        } else if (shaky) {
          warnEl.hidden = false;
          warnEl.dataset.kind = "soft";
          warnEl.textContent = "That last step was hard to match — scroll a little more slowly.";
          el.classList.add("has-warning");
        } else {
          warnEl.hidden = true;
          el.classList.remove("has-warning");
        }
      };

      const finish = (how: "done" | "cancel"): void => {
        if (settled) return;
        settled = true;
        window.removeEventListener("keydown", onKey, true);
        scrollFeed = null;
        el.remove();
        resolve(how);
      };

      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key === "Enter" || ev.code === "NumpadEnter") {
          ev.preventDefault();
          ev.stopPropagation();
          finish("done");
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          finish("cancel");
        }
      };

      el.addEventListener("click", (ev) => {
        const act = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-act]")?.dataset.act;
        if (act === "done") finish("done");
        else if (act === "cancel") finish("cancel");
      });

      if (hintEl) {
        hintEl.innerHTML = "Scroll the window, then press <kbd>Enter</kbd> or <strong>Done</strong>.";
      }

      scrollFeed = update;
      window.addEventListener("keydown", onKey, true);
      el.focus({ preventScroll: true });
    });
  }

  /**
   * Manual-scroll capture: freeze + select a region, hand the wheel back to the
   * app underneath, let the user scroll, then stitched frames land in the editor.
   * Locked backend contract: scrolling_start / scrolling_done / scrolling_cancel.
   */
  async function runScrollingCapture(): Promise<void> {
    let full = false;
    let casting = false;
    try {
      await invoke("set_fullscreen", { full: true });
      full = true;
      await settle();

      setStatus("Drag over the area you want to scroll — Esc to cancel.");
      const shot = await invoke<CaptureResult>("capture_screenshot");
      const box = await selectRegion(shot.dataUrl);

      await invoke("set_fullscreen", { full: false });
      full = false;

      if (!box) {
        setStatus("Scrolling capture cancelled");
        return;
      }

      scrollFrames = 0;
      await invoke("scrolling_start", { region: box });
      casting = true;
      // The card gets its own small clickable window: the main window shrinks to
      // the card and click-through stays off, so Done (and Enter) actually work.
      document.body.classList.add("scroll-hud");
      await invoke("set_hud_mode", { enabled: true, width: 372, height: 330 }).catch(() => {
        /* older backend: fall back to the in-window card */
      });
      setStatus("Scrolling capture running — scroll the window, then press Enter.");

      const decision = await showScrollCard(box);
      const frames = Math.max(1, scrollFrames);

      if (decision === "cancel") {
        casting = false;
        await invoke("scrolling_cancel").catch(() => {
          /* already torn down on the Rust side */
        });
        setStatus("Scrolling capture cancelled");
        return;
      }

      const res = await invoke<CaptureResult>("scrolling_done");
      casting = false;

      await editor.load(res.dataUrl);
      setImageState(true);
      await addRecent(res.dataUrl, "Scrolling");
      syncDirty();

      let note = "";
      let failed = false;
      try {
        const saved = await writeImage(res.dataUrl, false);
        if (saved) note = ` · saved ${saved.filename}`;
      } catch (e) {
        failed = true;
        note = ` · auto-save failed: ${errText(e)}`;
      }
      setStatus(
        `Scrolling capture: ${res.width} × ${res.height}, ${frames} frames${note}`,
        failed ? "error" : "success",
      );
    } catch (e) {
      setStatus(scrollErrorText(e), "error");
    } finally {
      scrollFeed = null;
      document.body.classList.remove("scroll-hud");
      try {
        await invoke("set_hud_mode", { enabled: false, width: 0, height: 0 });
      } catch {
        /* nothing to restore */
      }
      if (casting) {
        try {
          await invoke("scrolling_cancel");
        } catch {
          /* nothing left to cancel */
        }
      }
      if (full) {
        try {
          await invoke("set_fullscreen", { full: false });
        } catch {
          /* restore failed — the window is left as-is rather than stuck half-way */
        }
      }
    }
  }

  /* ------------------------------------------------------- interval capture */

  /**
   * One live interval loop. `seq` is the zero-padded shot counter the filename
   * carries, so the shots of a run sort in capture order on disk.
   */
  type IntervalRun = {
    stop: boolean;
    shots: number;
    seq: number;
    startedAt: number;
    dir: string;
    every: number;
    timelapse: boolean;
  };

  /** The running loop, or null while no interval capture is live. */
  let intervalRun: IntervalRun | null = null;

  /** Join a folder and a file name without doubling or dropping the slash. */
  const joinPath = (dir: string, name: string): string => `${dir.replace(/[\\/]+$/, "")}/${name}`;

  const pad4 = (n: number): string => String(Math.max(0, Math.round(n))).padStart(4, "0");

  /**
   * Shot filename: the user's own pattern plus the sequence number. The fixed
   * `SnagCraft-interval-` prefix is what the timelapse glob matches, and a
   * leading "SnagCraft-" in the pattern is folded into it instead of repeated.
   */
  function intervalFilename(date: Date, seq: number): string {
    const expanded = expandPattern(settings.filename, date).replace(/^snagcraft[-_ ]/i, "");
    return `SnagCraft-interval-${expanded}-${pad4(seq)}.png`;
  }

  /** Tiny stateful card for the loop; the widget repaints from the shell. */
  type IntervalCard = {
    paint(leftMs: number, elapsedMs: number): void;
    setShots(shots: number): void;
    setWarning(message: string): void;
    dispose(): void;
  };

  /**
   * Float the interval card and take the window over (the shell shrinks it to
   * a 300 × 190 HUD), so the desktop stays usable between shots and Stop stays
   * clickable. Mirrors the scrolling card's shape, one size smaller.
   */
  function showIntervalCard(run: IntervalRun): IntervalCard {
    const el = document.createElement("div");
    el.className = "interval-card";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Interval capture");
    el.innerHTML = `
      <div class="interval-head">
        <span class="interval-live" aria-hidden="true"></span>
        <span class="interval-title">Interval capture</span>
        <span class="interval-every">every ${run.every >= 60 ? `${Math.round(run.every / 60)} min` : `${run.every} s`}</span>
      </div>
      <div class="interval-live-row">
        <div class="interval-clock">
          <span class="interval-count" data-count role="timer" aria-label="Time to the next shot">${run.every}</span>
          <span class="interval-clock-unit" aria-hidden="true">s</span>
        </div>
        <div class="interval-stats">
          <span class="interval-stat"><span class="interval-num" data-shots>0</span><span class="interval-unit">shots</span></span>
          <span class="interval-stat"><span class="interval-num" data-elapsed>00:00</span><span class="interval-unit">elapsed</span></span>
        </div>
      </div>
      <p class="interval-warn" data-warn role="status" aria-live="polite" hidden></p>
      <label class="interval-check">
        <input type="checkbox" data-timelapse${run.timelapse ? " checked" : ""} />
        <span>Make a timelapse when stopped</span>
      </label>
      <button type="button" class="scroll-btn scroll-btn-primary interval-stop" data-act="stop" title="Stop the loop (Ctrl+.)">Stop</button>
    `;

    document.querySelectorAll(".interval-card").forEach((old) => old.remove());
    document.body.appendChild(el);

    const countEl = el.querySelector<HTMLElement>("[data-count]");
    const shotsEl = el.querySelector<HTMLElement>("[data-shots]");
    const elapsedEl = el.querySelector<HTMLElement>("[data-elapsed]");
    const warnEl = el.querySelector<HTMLElement>("[data-warn]");
    const timelapseEl = el.querySelector<HTMLInputElement>("[data-timelapse]");
    const stopEl = el.querySelector<HTMLButtonElement>("[data-act=\"stop\"]");

    /** Remember the choice immediately, so a stop mid-wait still honours it. */
    timelapseEl?.addEventListener("change", () => {
      run.timelapse = timelapseEl.checked === true;
    });

    stopEl?.addEventListener("click", () => {
      run.stop = true;
      stopEl.disabled = true;
      stopEl.textContent = "Stopping…";
    });

    return {
      paint(leftMs, elapsedMs) {
        if (countEl) countEl.textContent = String(Math.max(0, Math.ceil(leftMs / 1000)));
        if (elapsedEl) elapsedEl.textContent = elapsedLabel(elapsedMs);
      },
      setShots(shots) {
        if (shotsEl) shotsEl.textContent = String(shots);
      },
      setWarning(message) {
        if (!warnEl) return;
        warnEl.hidden = message === "";
        warnEl.textContent = message;
      },
      dispose() {
        el.remove();
      },
    };
  }

  /** Sleep out one interval, painting the countdown; Stop wakes it early. */
  function waitInterval(run: IntervalRun, card: IntervalCard): Promise<void> {
    const total = Math.max(1, Math.round(run.every)) * 1000;
    return new Promise<void>((resolve) => {
      const started = Date.now();
      let timer = 0;
      const tick = (): void => {
        const left = Math.max(0, total - (Date.now() - started));
        card.paint(left, Date.now() - run.startedAt);
        if (run.stop || left === 0) {
          window.clearInterval(timer);
          resolve();
        }
      };
      timer = window.setInterval(tick, 200);
      tick();
    });
  }

  /** One shot: grab the screen, then write it as PNG under the run's folder. */
  async function captureIntervalShot(run: IntervalRun): Promise<string> {
    const res = await invoke<CaptureResult>("capture_screenshot");
    const filename = intervalFilename(new Date(), ++run.seq);
    await invoke<string>("save_png_to_dir", { dataUrl: res.dataUrl, dir: run.dir, filename });
    return filename;
  }

  /**
   * Interval capture: no region, no fullscreen — the window becomes a 300 × 190
   * HUD card that counts down and grabs the screen every `intervalSeconds` until
   * Stop (the button or Ctrl+.). Every shot lands in the save folder; the
   * optional timelapse is assembled by the backend when the loop ends.
   */
  async function runIntervalCapture(): Promise<void> {
    if (intervalRun) {
      setStatus("Interval capture is already running — press Stop in the card.");
      return;
    }
    const dir = await ensureSaveDir();
    if (!dir) {
      setStatus("Pick a save folder before interval capture.", "error");
      return;
    }

    const every = Math.min(3600, Math.max(1, Math.round(settings.intervalSeconds) || DEFAULT_INTERVAL));
    const run: IntervalRun = {
      stop: false,
      shots: 0,
      seq: 0,
      startedAt: Date.now(),
      dir,
      every,
      timelapse: false,
    };
    intervalRun = run;

    const card = showIntervalCard(run);
    document.body.classList.add("interval-hud");
    await invoke("set_hud_mode", { enabled: true, width: 300, height: 190 }).catch(() => {
      /* older backend: the card stays inside a normal window */
    });
    setStatus(`Interval capture — a shot every ${every} s. Stop ends the loop.`);

    try {
      while (!run.stop) {
        await waitInterval(run, card);
        if (run.stop) break;
        try {
          await captureIntervalShot(run);
          run.shots += 1;
          card.setShots(run.shots);
          card.setWarning("");
          setStatus(
            `Interval capture — ${run.shots} shot${run.shots === 1 ? "" : "s"} saved to ${dir}`,
            "success",
          );
        } catch (e) {
          // A failed grab must not end the loop: the next tick simply tries again.
          card.setWarning(`That shot failed: ${errText(e)}`);
        }
      }
    } finally {
      intervalRun = null;
      document.body.classList.remove("interval-hud");
      card.dispose();
      await invoke("set_hud_mode", { enabled: false, width: 0, height: 0 }).catch(() => {
        /* nothing to restore */
      });
    }

    if (run.shots === 0) {
      setStatus("Interval capture stopped before the first shot — nothing was saved.");
      return;
    }

    setStatus(
      `Interval capture stopped — ${run.shots} shot${run.shots === 1 ? "" : "s"} saved to ${dir}`,
      "success",
    );
    if (!run.timelapse) return;

    const out = joinPath(dir, `SnagCraft-timelapse-${expandPattern("{date}-{time}")}.mp4`);
    setStatus(`Building a timelapse from ${run.shots} shots…`);
    try {
      const saved = await invoke<string>("make_timelapse", {
        dir,
        pattern: "SnagCraft-interval-*.png",
        fps: 10,
        out,
      });
      const path = typeof saved === "string" && saved.trim() ? saved.trim() : out;
      setStatus(`Timelapse saved: ${path} (${run.shots} shots, 10 fps)`, "success");
    } catch (e) {
      setStatus(
        `Timelapse failed: ${errText(e)} — the ${run.shots} shots are still in ${dir}`,
        "error",
      );
    }
  }

  /** One row in the capture-target chooser. */
  type ChooserItem = { name: string; meta: string };

  /**
   * In-app capture-target chooser for Windows/macOS (issue #1): no OS portal
   * picker exists there, so screens or windows from the backend are offered
   * as buttons. Resolves the chosen index, or null when cancelled.
   */
  function pickCaptureTarget(
    heading: string,
    description: string,
    items: ChooserItem[],
  ): Promise<number | null> {
    return new Promise<number | null>((resolve) => {
      const backdrop = $<HTMLDivElement>("#monitor-modal");
      const listEl = $<HTMLDivElement>("#monitor-list");
      const cancelBtn = $<HTMLButtonElement>("#monitor-cancel");
      const closeBtn = $<HTMLButtonElement>("#monitor-close");
      $<HTMLElement>("#monitor-title").textContent = heading;
      $<HTMLElement>("#monitor-desc").textContent = description;
      let settled = false;

      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          finish(null);
        }
      };
      const onBackdrop = (ev: PointerEvent | MouseEvent): void => {
        if (ev.target === backdrop) finish(null);
      };
      const onCancel = (): void => finish(null);

      function finish(value: number | null): void {
        if (settled) return;
        settled = true;
        document.removeEventListener("keydown", onKey, true);
        backdrop.removeEventListener("pointerdown", onBackdrop);
        cancelBtn.removeEventListener("click", onCancel);
        closeBtn.removeEventListener("click", onCancel);
        backdrop.classList.remove("is-open");
        backdrop.hidden = true;
        resolve(value);
      }

      listEl.replaceChildren();
      items.forEach((item, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "monitor-item";
        const name = document.createElement("span");
        name.className = "monitor-name";
        name.textContent = item.name;
        const meta = document.createElement("span");
        meta.className = "monitor-meta";
        meta.textContent = item.meta;
        btn.append(name, meta);
        btn.addEventListener("click", () => finish(index));
        listEl.appendChild(btn);
      });

      cancelBtn.addEventListener("click", onCancel);
      closeBtn.addEventListener("click", onCancel);
      backdrop.addEventListener("pointerdown", onBackdrop);
      document.addEventListener("keydown", onKey, true);
      backdrop.hidden = false;
      void backdrop.offsetWidth;
      backdrop.classList.add("is-open");
      listEl.querySelector<HTMLElement>(".monitor-item")?.focus({ preventScroll: true });
    });
  }

  /**
   * Window / monitor capture: on Linux the OS portal shows its own picker, so
   * the only things we own are the waiting status, the load and the auto-save.
   * On Windows/macOS the target list comes from the backend and the chooser
   * above replaces the missing OS dialog.
   */
  async function runPickerCapture(kind: PickerMode): Promise<void> {
    let command = kind === "window" ? "capture_window" : "capture_monitor";
    let args: { index?: number; id?: number } | undefined;
    const what = kind === "window" ? "window" : "screen";
    // Linux returns empty lists (the portal is the picker there); only a real
    // Windows/macOS enumeration opens the in-app chooser.
    if (kind === "monitor") {
      const monitors = await invoke<MonitorInfo[]>("list_monitors").catch(
        () => [] as MonitorInfo[],
      );
      if (monitors.length > 1) {
        const index = await pickCaptureTarget(
          "Choose a screen",
          "Which display should SnagCraft capture?",
          monitors.map((monitor, i) => {
            const scale =
              monitor.scaleFactor > 0 && monitor.scaleFactor !== 1
                ? ` · ${Math.round(monitor.scaleFactor * 100)}%`
                : "";
            const primary = monitor.isPrimary ? " · primary" : "";
            return {
              name: monitor.name || `Display ${i + 1}`,
              meta: `${monitor.width} × ${monitor.height}${scale}${primary}`,
            };
          }),
        );
        if (index === null) {
          setStatus("Capture cancelled");
          return;
        }
        command = "capture_monitor_index";
        args = { index };
      }
    } else {
      const windows = await invoke<WindowInfo[]>("list_windows").catch(() => [] as WindowInfo[]);
      if (windows.length > 0) {
        const index = await pickCaptureTarget(
          "Choose a window",
          "Which window should SnagCraft capture?",
          windows.map((win) => ({
            name: win.title || win.appName || "Untitled window",
            meta: `${win.appName || "Unknown app"} · ${win.width} × ${win.height}`,
          })),
        );
        if (index === null) {
          setStatus("Capture cancelled");
          return;
        }
        command = "capture_window_id";
        args = { id: windows[index].id };
      }
    }
    let res: CaptureResult;
    try {
      res = await invoke<CaptureResult>(command, args);
    } catch (e) {
      const message = errText(e);
      if (isCancelled(message)) {
        setStatus("Capture cancelled");
        return;
      }
      setStatus(
        `${what === "window" ? "Window" : "Screen"} capture failed: ${message}`,
        "error",
      );
      return;
    }
    if (!res || typeof res.dataUrl !== "string" || res.dataUrl.length === 0) {
      // The picker closed without a selection — nothing to report as a failure.
      setStatus("Capture cancelled");
      return;
    }
    try {
      await editor.load(res.dataUrl);
    } catch (e) {
      setStatus(`Could not open the capture: ${errText(e)}`, "error");
      return;
    }
    setImageState(true);
    const width = Number(res.width) || 0;
    const height = Number(res.height) || 0;
    const size = width > 0 && height > 0 ? ` ${width} × ${height}` : "";
    const captured = `Captured ${what}${size}`;
    setStatus(captured, "success");
    await addRecent(res.dataUrl, kind === "window" ? "Window" : "Screen");
    syncDirty();
    await autoSave(res.dataUrl, captured);
  }

  async function runCapture(requested: CaptureMode = mode): Promise<void> {
    if (busy || !guardEl.hidden) return;
    if (recording) {
      setStatus("Stop the recording before capturing a screen.");
      return;
    }
    setBusy(true);
    try {
      if (settings.timer > 0 && requested !== "scrolling" && requested !== "interval") {
        setStatus(`Capturing in ${settings.timer} s — Esc to cancel`);
        const proceed = await runCountdown(settings.timer, requested);
        if (!proceed) {
          setStatus("Capture cancelled");
          return;
        }
        // Let the overlay finish fading out before the screen is grabbed.
        await settle();
      }
      setStatus(CAPTURE_READY[requested]);
      if (requested === "full") {
        const res = await invoke<CaptureResult>("capture_screenshot");
        await editor.load(res.dataUrl);
        setImageState(true);
        setStatus(`Captured ${res.width} × ${res.height}`, "success");
        await addRecent(res.dataUrl, "Full screen");
        syncDirty();
        await autoSave(res.dataUrl);
        return;
      }
      if (requested === "scrolling") {
        await runScrollingCapture();
        return;
      }
      if (requested === "interval") {
        await runIntervalCapture();
        return;
      }
      if (isPickerMode(requested)) {
        await runPickerCapture(requested);
        return;
      }
      await runRegionCapture();
    } catch (e) {
      setStatus(`Capture failed: ${errText(e)}`, "error");
    } finally {
      setBusy(false);
      // The widget hides during the grab; bring it back on top afterwards.
      if (settings.widget) {
        void invoke("open_widget").catch(() => {
          /* the widget window may be gone */
        });
      }
    }
  }

  /* ------------------------------------------------------------------- ink */

  function highlightColor(hex: string): void {
    const normalized = hex.toLowerCase();
    let matched = false;
    for (const btn of Array.from(swatchesEl.querySelectorAll<HTMLButtonElement>(".swatch"))) {
      const active = (btn.dataset.hex || "").toLowerCase() === normalized;
      if (active) matched = true;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    }
    customColorEl.closest(".color-custom")?.classList.toggle("is-active", !matched);
    customColorEl.value = normalized;
    if (colorValue) colorValue.textContent = normalized.toUpperCase();
    // The nib preview is filled with the ink colour, so it follows every change.
    paintBrushPreview(activeTool);
  }

  function applyColor(hex: string, announce = true): void {
    try {
      editor.setColor(hex);
    } catch (e) {
      setStatus(`Color failed: ${errText(e)}`, "error");
      return;
    }
    inkColor = hex.toLowerCase();
    highlightColor(hex);
    writeStore(INK_KEY, hex);
    if (announce) {
      const named = COLORS.find((c) => c.hex.toLowerCase() === hex.toLowerCase());
      setStatus(`Ink color: ${named ? named.name.toLowerCase() : hex}`);
    }
  }

  function highlightStroke(width: number): void {
    if (strokeValue) strokeValue.textContent = `${width} px`;
  }

  function applyStroke(width: number, announce = true): void {
    try {
      editor.setStrokeWidth(width);
    } catch (e) {
      setStatus(`Stroke failed: ${errText(e)}`, "error");
      return;
    }
    strokeWidth = width;
    highlightStroke(width);
    writeStore(STROKE_KEY, String(width));
    if (activeTool !== "text" && activeTool !== "blur") paintToolSize(activeTool);
    if (announce) setStatus(`Stroke width: ${width} px`);
  }

  /* ------------------------------------------------------------------ text */

  const textApi = editor as unknown as TextApi;
  let fontFamily = readFont();
  let fontSize = readSize();
  let textBold = readBool(BOLD_KEY);
  let textItalic = readBool(ITALIC_KEY);

  const fontEntry = (family: string): (typeof FONTS)[number] =>
    FONTS.find((f) => f.family === family) ?? FONTS[0];

  function paintTextToggles(): void {
    boldBtn.classList.toggle("is-active", textBold);
    boldBtn.setAttribute("aria-pressed", String(textBold));
    boldBtn.title = textBold ? "Bold (on)" : "Bold";
    italicBtn.classList.toggle("is-active", textItalic);
    italicBtn.setAttribute("aria-pressed", String(textItalic));
    italicBtn.title = textItalic ? "Italic (on)" : "Italic";
  }

  function applyFont(family: string, announce = true): void {
    const entry = fontEntry(family);
    fontFamily = entry.family;
    textApi.setFontFamily?.(entry.css);
    fontSelect.value = entry.family;
    fontSelect.style.fontFamily = entry.stack;
    writeStore(FONT_KEY, entry.family);
    if (announce) setStatus(`Font: ${entry.family}`);
  }

  function applySize(size: number, announce = true): void {
    const next = Math.min(200, Math.max(8, Math.round(size) || DEFAULT_SIZE));
    fontSize = next;
    textApi.setFontSize?.(next);
    sizeInput.value = String(next);
    sizeDownBtn.disabled = next <= 8;
    sizeUpBtn.disabled = next >= 200;
    writeStore(SIZE_KEY, String(next));
    // Text's size lives in the same knob as the rail slider — keep the editor's
    // generic tool size in step no matter which control moved.
    if (activeTool === "text" && sizeRange) {
      try {
        sizeApi.setToolSize?.(next);
      } catch {
        /* older editor without the generic setter */
      }
      paintToolSize("text");
    }
    if (announce) setStatus(`Text size: ${next} px`);
  }

  function applyBold(on: boolean, announce = true): void {
    textBold = on;
    textApi.setTextBold?.(on);
    paintTextToggles();
    writeStore(BOLD_KEY, String(on));
    if (announce) setStatus(on ? "Bold on" : "Bold off");
  }

  function applyItalic(on: boolean, announce = true): void {
    textItalic = on;
    textApi.setTextItalic?.(on);
    paintTextToggles();
    writeStore(ITALIC_KEY, String(on));
    if (announce) setStatus(on ? "Italic on" : "Italic off");
  }

  /** Adopt the editor's own values once its setters/getters are present. */
  function syncTextFromEditor(): void {
    const family = textApi.getFontFamily?.();
    if (family) {
      const hit = FONTS.find((f) => family.toLowerCase().includes(f.family.toLowerCase()));
      if (hit && hit.family !== fontFamily) {
        fontFamily = hit.family;
        fontSelect.value = hit.family;
        fontSelect.style.fontFamily = hit.stack;
        writeStore(FONT_KEY, hit.family);
      }
    }
    const size = textApi.getFontSize?.();
    if (typeof size === "number" && Number.isFinite(size)) {
      const clamped = Math.min(200, Math.max(8, Math.round(size)));
      fontSize = clamped;
      sizeInput.value = String(clamped);
      sizeDownBtn.disabled = clamped <= 8;
      sizeUpBtn.disabled = clamped >= 200;
    }
    const bold = textApi.isTextBold?.();
    if (typeof bold === "boolean") textBold = bold;
    const italic = textApi.isTextItalic?.();
    if (typeof italic === "boolean") textItalic = italic;
    paintTextToggles();
  }

  /* ----------------------------------------------------------------- blur */

  const blurApi = editor as unknown as BlurApi;

  function paintBlur(): void {
    for (const btn of Array.from(
      blurModesEl.querySelectorAll<HTMLButtonElement>("[data-blur-mode]"),
    )) {
      const active = btn.dataset.blurMode === blurMode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
      btn.tabIndex = active ? 0 : -1;
    }
    blurRadiusInput.value = String(blurRadius);
    blurRadiusOut.textContent = String(blurRadius);
    blurRadiusInput.style.setProperty(
      "--fill",
      `${((blurRadius - MIN_BLUR_RADIUS) / (MAX_BLUR_RADIUS - MIN_BLUR_RADIUS)) * 100}%`,
    );
    const usesIntensity = blurMode !== "blackout";
    radiusField.classList.toggle("is-muted", !usesIntensity);
    blurRadiusInput.disabled = !usesIntensity;
    blurHint.textContent =
      blurMode === "gaussian"
        ? "Gaussian softens the area — intensity sets how far it smears."
        : blurMode === "pixelate"
          ? "Pixelate blocks the area — intensity sets the block size."
          : "Blackout paints the area solid; intensity is unused.";
  }

  function applyBlurMode(next: BlurMode, announce = true): void {
    blurMode = next;
    try {
      blurApi.setBlurMode?.(next);
    } catch (e) {
      setStatus(`Blur mode failed: ${errText(e)}`, "error");
      return;
    }
    writeStore(BLUR_MODE_KEY, next);
    paintBlur();
    if (announce) setStatus(`Blur mode: ${next}`);
  }

  function applyBlurRadius(next: number, announce = true): void {
    const clamped = Math.min(
      MAX_BLUR_RADIUS,
      Math.max(MIN_BLUR_RADIUS, Math.round(next) || DEFAULT_BLUR_RADIUS),
    );
    blurRadius = clamped;
    try {
      blurApi.setBlurRadius?.(clamped);
    } catch (e) {
      setStatus(`Blur intensity failed: ${errText(e)}`, "error");
      return;
    }
    writeStore(BLUR_RADIUS_KEY, String(clamped));
    paintBlur();
    if (activeTool === "blur" && sizeRange) {
      try {
        sizeApi.setToolSize?.(clamped);
      } catch {
        /* older editor without the generic setter */
      }
      paintToolSize("blur");
    }
    if (announce) setStatus(`Blur intensity: ${clamped}`);
  }

  /** Adopt whatever the editor reports once its blur setters are present. */
  function syncBlurFromEditor(): void {
    const mode = blurApi.getBlurMode?.();
    if (mode === "gaussian" || mode === "pixelate" || mode === "blackout") {
      blurMode = mode;
    }
    const radius = blurApi.getBlurRadius?.();
    if (typeof radius === "number" && Number.isFinite(radius)) {
      blurRadius = Math.min(MAX_BLUR_RADIUS, Math.max(MIN_BLUR_RADIUS, Math.round(radius)));
    }
    paintBlur();
  }


  /* ------------------------------------------------- tool size + resize */

  const sizeApi = editor as unknown as SizeApi;

  /** Each tool names its single size knob in its own words. */
  const SIZE_LABELS: Record<string, string> = {
    arrow: "Stroke",
    shape: "Border",
    brush: "Brush size",
    bucket: "Spread",
    step: "Ring width",
    spotlight: "Feather",
    highlighter: "Thickness",
    callout: "Outline",
    blur: "Blur radius",
    text: "Font size",
    magnify: "Zoom",
  };

  const SIZE_NOTES: Record<string, string> = {
    brush: "Nib width for freehand strokes.",
    text: "8–200 px — new labels only.",
    blur: "Higher hides more — 2–60 px.",
    highlighter: "Marker thickness while swiping.",
    magnify: "How far the lens zooms in (1.5–10×).",
  };

  let activeTool: ShellToolId = "select";
  let sizeRange: { min: number; max: number; step: number } | null = null;

  /** Magnify reads its slider as a zoom factor, every other tool as pixels. */
  const sizeUnit = (id: ShellToolId): string => (id === "magnify" ? "×" : " px");

  const paintSliderFill = (input: HTMLInputElement, min: number, max: number): void => {
    const span = max - min || 1;
    const pct = ((Number(input.value) - min) / span) * 100;
    input.style.setProperty("--fill", `${Math.min(100, Math.max(0, pct))}%`);
  };

  /** Snap to the range's own step (keeps integer tools integer). */
  const snapSize = (value: number, range: { min: number; max: number; step: number }): number => {
    const step = range.step > 0 ? range.step : 1;
    const snapped = Math.round(value / step) * step;
    return Math.min(range.max, Math.max(range.min, Math.round(snapped * 100) / 100));
  };

  /**
   * Paint the always-visible nib reference next to the brush slider: a circle
   * whose diameter tracks the brush size (1 px → 2 px dot, 60 px → 44 px) in the
   * current ink colour, so the size is legible without drawing a test stroke.
   */
  function paintBrushPreview(id: ShellToolId): void {
    const show = id === "brush" && !!sizeRange;
    brushPreview.hidden = !show;
    if (!show || !sizeRange) return;
    const raw = Number(toolSizeInput.value);
    const value = Number.isFinite(raw) ? raw : sizeRange.min;
    const span = sizeRange.max - sizeRange.min || 1;
    const t = Math.min(1, Math.max(0, (value - sizeRange.min) / span));
    const diameter = Math.round(BRUSH_PREVIEW_MIN + t * (BRUSH_PREVIEW_MAX - BRUSH_PREVIEW_MIN));
    brushPreviewDot.style.width = `${diameter}px`;
    brushPreviewDot.style.height = `${diameter}px`;
    brushPreviewDot.style.background = inkColor;
    brushPreviewValue.textContent = `${value} px`;
    brushPreview.title = `Nib preview — ${value} px at 1:1`;
  }

  /**
   * Paint the generic size slider for the active tool. Visibility is decided by
   * the editor's own range, so a tool that has no size knob simply never shows
   * one — no duplicated per-tool wiring in the shell.
   */
  function paintToolSize(id: ShellToolId): void {
    activeTool = id;
    const range = sizeApi.getToolSizeRange?.() ?? null;
    sizeRange = range && range.max > range.min ? range : null;
    toolSizeGroup.hidden = !sizeRange;
    toolSizeGroup.classList.toggle("is-hero", id === "text");
    if (!sizeRange) {
      brushPreview.hidden = true;
      return;
    }

    const label = SIZE_LABELS[id] ?? "Size";
    const unit = sizeUnit(id);
    toolSizeLabel.textContent = label;
    toolSizeInput.setAttribute(
      "aria-label",
      unit === "×" ? `${label} factor` : `${label} in pixels`,
    );
    toolSizeInput.min = String(sizeRange.min);
    toolSizeInput.max = String(sizeRange.max);
    toolSizeInput.step = String(sizeRange.step > 0 ? sizeRange.step : 1);

    const live = sizeApi.getToolSize?.();
    const fallback = id === "text" ? fontSize : id === "blur" ? blurRadius : strokeWidth;
    const raw = typeof live === "number" && Number.isFinite(live) ? live : fallback;
    const value = snapSize(raw, sizeRange);
    toolSizeInput.value = String(value);
    toolSizeOut.textContent = `${value}${unit}`;
    const note = SIZE_NOTES[id] ?? "";
    toolSizeNote.textContent = note;
    toolSizeNote.hidden = !note;
    const dimmed = id === "blur" && blurMode === "blackout";
    toolSizeInput.disabled = dimmed;
    toolSizeGroup.classList.toggle("is-muted", dimmed);
    paintSliderFill(toolSizeInput, sizeRange.min, sizeRange.max);
    paintBrushPreview(id);
  }

  /** One slider writes through to whichever knob the active tool reads. */
  function applyToolSize(next: number, announce = true): void {
    if (!sizeRange || !Number.isFinite(next)) return;
    // Pin the tool for this update: a change event fired mid-write (some editors
    // notify on size changes) must not re-target the mirror bookkeeping.
    const tool = activeTool;
    const value = snapSize(next, sizeRange);
    try {
      sizeApi.setToolSize?.(value);
    } catch (e) {
      setStatus(`Size failed: ${errText(e)}`, "error");
      return;
    }
    // Keep the shell's mirrors honest so presets and steppers agree.
    if (tool === "text") applySize(value, false);
    else if (tool === "blur") applyBlurRadius(value, false);
    else {
      strokeWidth = value;
      highlightStroke(value);
    }
    paintToolSize(tool);
    if (announce) {
      setStatus(`${SIZE_LABELS[tool] ?? "Size"}: ${value}${sizeUnit(tool)}`);
    }
  }

  /* ---------------------------------------------------------------- shadow */

  const shadowApi = editor as unknown as ShadowApi;
  let shadow: ShadowStyle = readShadow();

  /** Mirror the shadow into the rail: switch, slider, steppers, colour, sample. */
  function paintShadow(): void {
    const on = shadow.enabled;
    shadowToggle.classList.toggle("is-on", on);
    shadowToggle.setAttribute("aria-checked", String(on));
    shadowToggle.title = on ? "Shadow on" : "Shadow off";
    shadowFields.hidden = !on;

    shadowBlurInput.value = String(shadow.blur);
    shadowBlurOut.textContent = String(shadow.blur);
    shadowBlurInput.style.setProperty("--fill", `${(shadow.blur / MAX_SHADOW_BLUR) * 100}%`);

    const angle = shadowAngleOf(shadow);
    const distance = Math.min(MAX_SHADOW_OFFSET, shadowDistanceOf(shadow));
    const opacity = shadowOpacityOf(shadow);

    shadowAngleInput.value = String(angle);
    shadowAngleOut.textContent = `${angle}°`;
    shadowAngleInput.style.setProperty("--fill", `${(angle / 360) * 100}%`);
    shadowDistanceInput.value = String(distance);
    shadowDistanceOut.textContent = `${distance} px`;
    shadowDistanceInput.style.setProperty("--fill", `${(distance / MAX_SHADOW_OFFSET) * 100}%`);
    shadowOpacityInput.value = String(opacity);
    shadowOpacityOut.textContent = `${opacity}%`;
    shadowOpacityInput.style.setProperty("--fill", `${opacity}%`);

    // Never write back into the colour input while the picker is open: setting
    // `.value` mid-pick resets the dialog, which read as "the colour won't stick".
    if (document.activeElement !== shadowColorInput) {
      shadowColorInput.value = splitColorAlpha(shadow.color).hex;
    }
    shadowPreview.style.boxShadow =
      `${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}`;
  }

  /** Push a shadow change to the editor, then persist and repaint. */
  function applyShadow(patch: Partial<ShadowStyle>, announce = true): void {
    const next = normalizeShadow({ ...shadow, ...patch });
    try {
      shadowApi.setShadow?.(next);
    } catch (e) {
      setStatus(`Shadow failed: ${errText(e)}`, "error");
      return;
    }
    shadow = next;
    writeStore(SHADOW_KEY, JSON.stringify(next));
    paintShadow();
    if (announce) {
      setStatus(
        next.enabled
          ? `Shadow on — ${shadowAngleOf(next)}°, ${shadowDistanceOf(next)} px, blur ${next.blur} px`
          : "Shadow off",
      );
    }
  }

  /** Adopt the editor's own shadow when it reports one (tool change, undo). */
  function syncShadowFromEditor(): void {
    const live = shadowApi.getShadow?.();
    if (!live || typeof live !== "object") return;
    shadow = normalizeShadow(live, shadow);
    paintShadow();
  }

  /* --------------------------------------------------------- image resize */

  let resizeLocked = true;
  let resizeBase = { width: 0, height: 0 };

  function imageSize(): { width: number; height: number } | null {
    const size = sizeApi.getImageSize?.();
    if (size && size.width > 0 && size.height > 0) return size;
    return null;
  }

  /** Keep the rail's size readout + Resize affordance in step with the canvas. */
  function paintResizeState(): void {
    const size = imageSize();
    if (size) resizeBase = size;
    resizeGroup.hidden = !hasImage || typeof sizeApi.resizeImage !== "function";
    imageSizeOut.textContent = size ? `${size.width} × ${size.height}` : "—";
    if (!hasImage) closeResize(false);
  }

  const gcdOf = (a: number, b: number): number => {
    let x = Math.abs(Math.round(a));
    let y = Math.abs(Math.round(b));
    while (y) [x, y] = [y, x % y];
    return x || 1;
  };

  const ratioText = (width: number, height: number): string => {
    if (!width || !height) return "";
    const divisor = gcdOf(width, height);
    return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
  };

  const baseRatio = (): number => (resizeBase.height > 0 ? resizeBase.width / resizeBase.height : 1);

  function setResizeError(message: string): void {
    resizeErrorEl.textContent = message;
    resizeErrorEl.hidden = !message;
  }

  function openResize(): void {
    const size = imageSize();
    if (!size) {
      setStatus("Nothing to resize — capture a screen first.", "error");
      return;
    }
    if (typeof sizeApi.resizeImage !== "function") {
      setStatus("Resize is not available in this build.", "error");
      return;
    }
    resizeBase = size;
    resizeWInput.value = String(size.width);
    resizeHInput.value = String(size.height);
    resizeLockInput.checked = resizeLocked;
    resizeCurrentEl.textContent = `Current: ${size.width} × ${size.height} px`;
    resizeRatioEl.textContent = ratioText(size.width, size.height);
    setResizeError("");
    resizePop.hidden = false;
    resizePop.classList.add("is-open");
    resizeOpenBtn.setAttribute("aria-expanded", "true");
    resizeWInput.focus({ preventScroll: true });
    resizeWInput.select();
  }

  function closeResize(restoreFocus = true): void {
    if (resizePop.hidden) return;
    resizePop.hidden = true;
    resizePop.classList.remove("is-open");
    resizeOpenBtn.setAttribute("aria-expanded", "false");
    if (restoreFocus) resizeOpenBtn.focus({ preventScroll: true });
  }

  function syncResizeFromWidth(): void {
    if (!resizeLocked) return;
    const width = Math.round(Number(resizeWInput.value));
    if (!Number.isFinite(width) || width < 1) return;
    resizeHInput.value = String(Math.max(1, Math.round(width / baseRatio())));
  }

  function syncResizeFromHeight(): void {
    if (!resizeLocked) return;
    const height = Math.round(Number(resizeHInput.value));
    if (!Number.isFinite(height) || height < 1) return;
    resizeWInput.value = String(Math.max(1, Math.round(height * baseRatio())));
  }

  function applyResize(): void {
    const size = imageSize() ?? resizeBase;
    const width = Math.round(Number(resizeWInput.value));
    const height = Math.round(Number(resizeHInput.value));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      setResizeError("Width and height must each be at least 1 pixel.");
      return;
    }
    if (width > 8192 || height > 8192) {
      setResizeError("8192 px is the maximum on either side.");
      return;
    }
    if (size.width === width && size.height === height) {
      setResizeError("");
      closeResize();
      setStatus(`Already ${width} × ${height} px — nothing to resize.`);
      return;
    }
    if (typeof sizeApi.resizeImage !== "function") {
      setResizeError("Resize is not available in this build.");
      return;
    }
    resizeApplyBtn.disabled = true;
    try {
      sizeApi.resizeImage(width, height);
    } catch (e) {
      resizeApplyBtn.disabled = false;
      setResizeError(`Resize failed: ${errText(e)}`);
      return;
    }
    resizeApplyBtn.disabled = false;
    const after = imageSize() ?? { width, height };
    resizeBase = after;
    imageSizeOut.textContent = `${after.width} × ${after.height}`;
    setResizeError("");
    closeResize();
    syncDirty();
    setStatus(`Resized to ${after.width} × ${after.height} px`, "success");
  }


  /* ---------------------------------------------------- styles + presets */

  const styleApi = editor as unknown as StyleApi;

  /** Everything the editor currently draws with (local mirrors fill any gap). */
  function currentStyle(): EditorStyle {
    const live: Partial<EditorStyle> = styleApi.getStyle?.() ?? {};
    return {
      color: typeof live.color === "string" ? live.color : inkColor,
      strokeWidth: typeof live.strokeWidth === "number" ? live.strokeWidth : strokeWidth,
      fontFamily: typeof live.fontFamily === "string" ? live.fontFamily : fontFamily,
      fontSize: typeof live.fontSize === "number" ? live.fontSize : fontSize,
      bold: typeof live.bold === "boolean" ? live.bold : textBold,
      italic: typeof live.italic === "boolean" ? live.italic : textItalic,
      blurMode: live.blurMode ?? blurMode,
      blurRadius: typeof live.blurRadius === "number" ? live.blurRadius : blurRadius,
      shadow: live.shadow ? normalizeShadow(live.shadow, shadow) : { ...shadow },
    };
  }

  /** Paint the rail to match a style slice without touching the editor. */
  function paintStyleState(patch: Partial<EditorStyle>): void {
    if (typeof patch.color === "string" && /^#[0-9a-f]{6}$/i.test(patch.color)) {
      inkColor = patch.color.toLowerCase();
      highlightColor(inkColor);
      writeStore(INK_KEY, inkColor);
    }
    if (typeof patch.strokeWidth === "number") {
      const width = Math.min(12, Math.max(1, Math.round(patch.strokeWidth)));
      strokeWidth = width;
      highlightStroke(width);
      writeStore(STROKE_KEY, String(width));
    }
    if (typeof patch.fontFamily === "string") {
      const family = patch.fontFamily.toLowerCase();
      const hit = FONTS.find((f) => family.includes(f.family.toLowerCase()));
      if (hit) {
        fontFamily = hit.family;
        fontSelect.value = hit.family;
        fontSelect.style.fontFamily = hit.stack;
        writeStore(FONT_KEY, hit.family);
      }
    }
    if (typeof patch.fontSize === "number") {
      const size = Math.min(200, Math.max(8, Math.round(patch.fontSize)));
      fontSize = size;
      sizeInput.value = String(size);
      sizeDownBtn.disabled = size <= 8;
      sizeUpBtn.disabled = size >= 200;
      writeStore(SIZE_KEY, String(size));
    }
    if (typeof patch.bold === "boolean") {
      textBold = patch.bold;
      paintTextToggles();
      writeStore(BOLD_KEY, String(patch.bold));
    }
    if (typeof patch.italic === "boolean") {
      textItalic = patch.italic;
      paintTextToggles();
      writeStore(ITALIC_KEY, String(patch.italic));
    }
    if (patch.blurMode) {
      blurMode = patch.blurMode;
      writeStore(BLUR_MODE_KEY, patch.blurMode);
      paintBlur();
    }
    if (typeof patch.blurRadius === "number") {
      blurRadius = Math.min(MAX_BLUR_RADIUS, Math.max(MIN_BLUR_RADIUS, Math.round(patch.blurRadius)));
      writeStore(BLUR_RADIUS_KEY, String(blurRadius));
      paintBlur();
    }
    if (patch.shadow) {
      shadow = normalizeShadow(patch.shadow, shadow);
      writeStore(SHADOW_KEY, JSON.stringify(shadow));
      paintShadow();
    }
  }

  /** Apply a style slice through the editor's bulk API, or one setter at a time. */
  function applyStylePatch(patch: Partial<EditorStyle>): void {
    if (typeof styleApi.applyStyle === "function") {
      try {
        styleApi.applyStyle(patch);
      } catch (e) {
        setStatus(`Style failed: ${errText(e)}`, "error");
        return;
      }
    } else {
      if (typeof patch.color === "string") applyColor(patch.color, false);
      if (typeof patch.strokeWidth === "number") applyStroke(patch.strokeWidth, false);
      if (typeof patch.fontFamily === "string") applyFont(patch.fontFamily, false);
      if (typeof patch.fontSize === "number") applySize(patch.fontSize, false);
      if (typeof patch.bold === "boolean") applyBold(patch.bold, false);
      if (typeof patch.italic === "boolean") applyItalic(patch.italic, false);
      if (patch.blurMode) applyBlurMode(patch.blurMode, false);
      if (typeof patch.blurRadius === "number") applyBlurRadius(patch.blurRadius, false);
    }
    if (patch.shadow) applyShadow(patch.shadow, false);
    paintStyleState(patch);
  }

  function setPresetFormOpen(open: boolean): void {
    presetFormEl.hidden = !open;
    presetSaveToggle.setAttribute("aria-expanded", String(open));
    if (open) {
      presetNameEl.value = "";
      presetNameEl.focus({ preventScroll: true });
    }
  }

  function renderPresets(): void {
    presetChipsEl.innerHTML = presets.length
      ? presets
          .map(
            (p, i) => `<span class="preset" data-index="${i}">
              <button type="button" class="preset-apply" title="Apply “${escapeHtml(p.name)}”">
                <span class="preset-dot" style="--preset-dot:${p.style.color ?? "var(--accent)"}" aria-hidden="true"></span>
                <span class="preset-name">${escapeHtml(p.name)}</span>
              </button>
              <button type="button" class="preset-del" aria-label="Delete preset ${escapeHtml(p.name)}" title="Delete preset">×</button>
            </span>`,
          )
          .join("")
      : `<p class="preset-empty">No presets yet — tune the rail, then save it.</p>`;
  }

  function applyPreset(index: number): void {
    const preset = presets[index];
    if (!preset) return;
    applyStylePatch(preset.style);
    setStatus(`Preset “${preset.name}” applied`, "success");
  }

  function savePresetFromForm(): void {
    const typed = presetNameEl.value.trim().slice(0, 32);
    const name = typed || `Preset ${presets.length + 1}`;
    const style = currentStyle();
    const index = presets.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    if (index >= 0) presets = presets.map((p, i) => (i === index ? { name, style } : p));
    else presets = [...presets, { name, style }];
    savePresets(presets);
    renderPresets();
    setPresetFormOpen(false);
    setStatus(index >= 0 ? `Preset “${name}” updated` : `Preset “${name}” saved`, "success");
  }

  function deletePreset(index: number): void {
    const removed = presets[index];
    if (!removed) return;
    presets = presets.filter((_, i) => i !== index);
    savePresets(presets);
    renderPresets();
    setStatus(`Preset “${removed.name}” deleted`);
  }

  /* ---------------------------------------------------------- filmstrip */

  const clockLabel = (ts: number): string =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  /** Downscale to a small JPEG so a dozen recents cost almost nothing. */
  function makeThumb(dataUrl: string): Promise<string> {
    return new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, 220 / Math.max(1, img.naturalWidth));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(dataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.72));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  /** Prepend a capture to the strip; never throws, never blocks the capture flow. */
  async function addRecent(dataUrl: string, label: string): Promise<void> {
    try {
      const thumb = await makeThumb(dataUrl);
      const entry: RecentShot = {
        id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        dataUrl,
        thumb,
        ts: Date.now(),
        format: settings.format,
        label,
      };
      recent = [entry, ...recent].slice(0, RECENT_LIMIT);
      loadedRecentId = entry.id;
      renderFilm();
      filmTrackEl.scrollLeft = 0;
    } catch {
      /* thumbnailing is a nicety — a failure must never cost the capture */
    }
  }

  /** Prepend a finished recording to the strip; thumbnail is best-effort. */
  async function addRecentRecording(path: string, label: string): Promise<void> {
    const clean = path.trim();
    if (!clean) return;
    let thumb = "";
    let durationMs: number | undefined;
    try {
      const meta = await invoke<RecordingMeta>("recording_meta", { path: clean });
      thumb = meta.thumb;
      if (meta.durationMs && meta.durationMs > 0) durationMs = meta.durationMs;
    } catch {
      /* no ffmpeg / unreadable file — the strip shows a film icon instead */
    }
    const entry: RecentShot = {
      id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      dataUrl: "",
      thumb,
      ts: Date.now(),
      format: settings.format,
      label,
      kind: "video",
      path: clean,
      durationMs,
    };
    recent = [entry, ...recent].slice(0, RECENT_LIMIT);
    renderFilm();
    filmTrackEl.scrollLeft = 0;
  }

  /**
   * Rebuild the strip from the configured save folder: images and recordings
   * written in any session, newest first. Entries from this session that are not
   * on disk yet (auto-save off) are kept on top.
   */
  async function refreshRecentFromFolder(): Promise<void> {
    const dirs: string[] = [];
    const primary = await ensureSaveDir();
    if (primary) dirs.push(primary);
    const rec = settings.splitFolders ? settings.recDir.trim() : "";
    if (rec && !dirs.includes(rec)) dirs.push(rec);
    if (!dirs.length) return;
    try {
      const seen = new Set<string>();
      const fromFolder: RecentShot[] = [];
      for (const dir of dirs) {
        const files = await invoke<FolderMedia[]>("list_folder_media", { dir });
        for (const file of files) {
          if (seen.has(file.path)) continue;
          seen.add(file.path);
          const ext = (file.name.split(".").pop() ?? "").toLowerCase();
          fromFolder.push({
            id: `file-${file.path}`,
            dataUrl: "",
            thumb: file.thumb,
            ts: file.modified,
            format: settings.format,
            label: file.kind === "video" ? "Recording" : "Image",
            kind: file.kind,
            path: file.path,
            ext,
            name: file.name,
            durationMs: file.durationMs && file.durationMs > 0 ? file.durationMs : undefined,
          });
        }
      }
      const saved = new Set(fromFolder.map((entry) => entry.path));
      const sessionOnly = recent.filter((entry) => !entry.path || !saved.has(entry.path));
      recent = [...sessionOnly, ...fromFolder]
        .sort((a, b) => b.ts - a.ts)
        .slice(0, RECENT_LIMIT);
      renderFilm();
    } catch {
      /* folder unreadable — keep whatever we already have */
    }
  }

  function renderFilm(): void {
    const hasAny = recent.length > 0;
    const shown = hasAny && filmOpen;
    filmStripEl.hidden = !shown;
    filmCountEl.textContent = String(recent.length);
    filmTotalEl.textContent = String(recent.length);
    filmToggleBtn.disabled = !hasAny;
    filmToggleBtn.classList.toggle("is-active", shown);
    filmToggleBtn.setAttribute("aria-pressed", String(shown));
    filmToggleBtn.title = hasAny
      ? shown
        ? "Hide recent captures"
        : "Show recent captures"
      : "Recent captures appear after your first capture";
    filmClearBtn.disabled = !hasAny;
    filmEmptyEl.hidden = hasAny;
    filmTrackEl.innerHTML = recent
      .map((item) => {
        const isVideo = item.kind === "video";
        const ext = (item.ext ?? (item.path ?? "").split(".").pop() ?? "").toUpperCase();
        const badge = isVideo
          ? ext || "VIDEO"
          : ext && ext !== "PNG"
            ? ext
            : formatLabel(item.format);
        const length = isVideo ? fmtLength(item.durationMs) : "";
        // The dot marks a recording; the chip carries its length, so the strip
        // tells you "clip, 7 seconds" before you click anything.
        const marks = isVideo
          ? `<span class="film-rec" aria-hidden="true"></span>${
              length ? `<span class="film-dur">${length}</span>` : ""
            }`
          : "";
        const thumbHtml = item.thumb
          ? `<span class="film-thumb"><img src="${item.thumb}" alt="" loading="lazy" />${marks}</span>`
          : `<span class="film-thumb${isVideo ? " film-thumb-video" : ""}">${
              isVideo ? ICONS.film : ICONS.full
            }${marks}</span>`;
        const title = `${item.label} · ${clockLabel(item.ts)} · ${badge}${
          isVideo ? ` · recording${length ? ` (${length})` : ""}` : ""
        }`;
        return `<button type="button" class="film-item${
          item.id === loadedRecentId ? " is-active" : ""
        }" data-id="${item.id}" role="option" aria-selected="${
          item.id === loadedRecentId
        }" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
          ${thumbHtml}
          <span class="film-caption"><span class="film-badge">${badge}</span><span class="film-time">${clockLabel(
            item.ts,
          )}</span></span>
        </button>`;
      })
      .join("");
  }

  function setFilmOpen(open: boolean): void {
    filmOpen = open;
    writeStore(FILM_KEY, open ? "open" : "closed");
    renderFilm();
    // Opening the strip is the natural moment to pick up files written since.
    if (open) void refreshRecentFromFolder();
  }

  async function loadRecent(id: string): Promise<void> {
    const item = recent.find((r) => r.id === id);
    if (!item) return;
    if (item.path) {
      if (item.kind === "video") {
        // Recordings preview in-app (play button + transport); "open in another
        // program" stays one click away in the player's bar.
        openRecording(item);
        return;
      }
      // Folder-backed image: read it back from disk (nothing is held in memory).
      // Unsaved edits are kept as a saved copy first — browsing history must
      // never cost work, and never needs a scary prompt.
      if (hasImage && isDirty()) {
        const kept = await saveEdited();
        if (!kept) {
          setStatus("Could not save a copy of your edits — staying on this image.", "error");
          return;
        }
      }
      try {
        const dataUrl = await invoke<string>("read_image_file", { path: item.path });
        await editor.load(dataUrl);
        loadedRecentId = item.id;
        setImageState(true);
        renderFilm();
        setStatus(`Opened ${item.name ?? "image"} — annotate away.`, "success");
      } catch (e) {
        setStatus(`Could not open that image: ${errText(e)}`, "error");
      }
      return;
    }
    if (hasImage && isDirty()) {
      const kept = await saveEdited();
      if (!kept) {
        setStatus("Could not save a copy of your edits — staying on this image.", "error");
        return;
      }
    }
    try {
      await editor.load(item.dataUrl);
      loadedRecentId = item.id;
      setImageState(true);
      renderFilm();
      setStatus(`Reloaded ${item.label.toLowerCase()} from ${clockLabel(item.ts)}`, "success");
    } catch (e) {
      setStatus(`Could not reload that capture: ${errText(e)}`, "error");
    }
  }

  /* --------------------------------------------------------------- player */

  /**
   * In-app preview for recordings. Two modes behind one timeline:
   *  - "video": a real <video> element (asset protocol), full transport control.
   *  - "frames": ffmpeg frames on demand, for webviews with no decoder for the
   *    clip's codec (H.264 in a bare WebKitGTK is the common case) — the
   *    timeline still scrubs, it just steps frames instead of streaming.
   * GIFs animate on their own in an <img>, so they carry no transport.
   */
  type PlayerMode = "video" | "frames" | "gif";

  const PLAYER_STEPS = 1000;
  const PLAYER_FRAME_WIDTH = 1600;

  const player = {
    item: null as RecentShot | null,
    mode: "video" as PlayerMode,
    durationMs: 0,
    positionMs: 0,
    playing: false,
    scrubbing: false,
    frameInFlight: false,
    pendingFrameMs: null as number | null,
    frameTimer: 0,
    watchdog: 0,
  };

  function playerIsOpen(): boolean {
    return !playerEl.hidden;
  }

  /** `0:07` — the clock readout in the transport bar. */
  function fmtClock(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  /** `7s` for short clips, `1:23` from a minute up — the tile overlay. */
  function fmtLength(ms: number | undefined): string {
    if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return "";
    if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
    return fmtClock(ms);
  }

  function syncPlayerBar(): void {
    const duration = player.durationMs;
    const position = Math.max(0, Math.min(player.positionMs, duration > 0 ? duration : player.positionMs));
    const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
    if (!player.scrubbing) playerRangeEl.value = String(Math.round(ratio * PLAYER_STEPS));
    playerRangeEl.style.setProperty("--player-fill", `${(ratio * 100).toFixed(2)}%`);
    playerRangeEl.disabled = duration <= 0;
    playerCurEl.textContent = fmtClock(duration > 0 ? position : 0);
    playerDurEl.textContent = duration > 0 ? fmtClock(duration) : "--:--";
    playerRangeEl.setAttribute("aria-valuetext", `${fmtClock(position)} of ${fmtClock(duration)}`);
    const playing = player.mode === "video" && player.playing;
    playerToggleBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
    playerToggleBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    playerToggleBtn.disabled = player.mode !== "video";
    const atEnd = duration > 0 && position >= duration - 120;
    playerBigBtn.hidden = playing || player.mode !== "video";
    playerBigBtn.innerHTML = atEnd ? ICONS.replay : ICONS.play;
    playerMuteBtn.innerHTML = playerVideoEl.muted ? ICONS.volumeOff : ICONS.volume;
    playerMuteBtn.setAttribute("aria-label", playerVideoEl.muted ? "Unmute" : "Mute");
  }

  function setPlayerOpen(open: boolean): void {
    playerEl.hidden = !open;
    stageEl.classList.toggle("is-video", open);
  }

  function stopPlayerWatchdog(): void {
    if (player.watchdog) {
      window.clearTimeout(player.watchdog);
      player.watchdog = 0;
    }
  }

  function cancelFrameTimer(): void {
    if (player.frameTimer) {
      window.clearTimeout(player.frameTimer);
      player.frameTimer = 0;
    }
    player.pendingFrameMs = null;
  }

  /** Show a frame from the backend — the scrub fallback and the open poster. */
  async function pumpFrame(): Promise<void> {
    const item = player.item;
    const target = player.pendingFrameMs;
    if (!item?.path || target === null || player.frameInFlight) return;
    player.pendingFrameMs = null;
    player.frameInFlight = true;
    try {
      const url = await invoke<string>("recording_frame", {
        path: item.path,
        ms: Math.round(target),
        maxWidth: PLAYER_FRAME_WIDTH,
      });
      // A newer clip (or a closed player) must not be overwritten by a slow frame.
      if (player.item === item && player.mode === "frames") playerPosterEl.src = url;
    } catch {
      /* ffmpeg missing or the file is gone — keep the last frame on screen */
    }
    player.frameInFlight = false;
    if (player.pendingFrameMs !== null && player.item === item) void pumpFrame();
  }

  function scheduleFrame(ms: number, delayMs: number): void {
    player.pendingFrameMs = ms;
    if (player.frameTimer) window.clearTimeout(player.frameTimer);
    player.frameTimer = window.setTimeout(() => {
      player.frameTimer = 0;
      void pumpFrame();
    }, delayMs);
  }

  /** Swap the video element for ffmpeg frames (unsupported codec). */
  function enterFrameMode(): void {
    if (!playerIsOpen() || !player.item) return;
    stopPlayerWatchdog();
    cancelFrameTimer();
    player.mode = "frames";
    player.playing = false;
    playerVideoEl.pause();
    playerVideoEl.hidden = true;
    playerEl.classList.add("is-frames");
    playerPosterEl.hidden = false;
    if (!playerPosterEl.getAttribute("src") && player.item.thumb) {
      playerPosterEl.src = player.item.thumb;
    }
    if (!player.durationMs) player.durationMs = player.item.durationMs ?? 0;
    playerNoteEl.hidden = false;
    playerNoteEl.textContent =
      "Frame preview — this system has no in-app decoder for the clip's codec. Drag the bar to scrub.";
    scheduleFrame(player.positionMs, 0);
    syncPlayerBar();
  }

  function playerTogglePlay(): void {
    if (!playerIsOpen() || player.mode !== "video") return;
    if (playerVideoEl.paused) {
      const duration = playerVideoEl.duration;
      if (Number.isFinite(duration) && duration > 0 && playerVideoEl.currentTime >= duration - 0.08) {
        playerVideoEl.currentTime = 0;
      }
      void playerVideoEl.play().catch(() => {
        /* autoplay/codec refusal: fall back to frame scrubbing */
        enterFrameMode();
      });
    } else {
      playerVideoEl.pause();
    }
  }

  function playerSeek(ms: number): void {
    const duration = player.durationMs;
    const target = Math.max(0, duration > 0 ? Math.min(ms, duration) : ms);
    player.positionMs = target;
    if (player.mode === "video") {
      if (playerVideoEl.readyState >= 1) {
        try {
          playerVideoEl.currentTime = target / 1000;
        } catch {
          /* not seekable yet — the next timeupdate catches up */
        }
      }
    } else if (player.mode === "frames") {
      scheduleFrame(target, player.scrubbing ? 90 : 0);
    }
    syncPlayerBar();
  }

  function closePlayer(): void {
    if (!playerIsOpen()) return;
    stopPlayerWatchdog();
    cancelFrameTimer();
    const wasVideo = player.item?.kind === "video";
    playerVideoEl.pause();
    playerVideoEl.removeAttribute("src");
    playerVideoEl.removeAttribute("poster");
    playerVideoEl.load();
    player.item = null;
    player.mode = "video";
    player.playing = false;
    player.scrubbing = false;
    player.durationMs = 0;
    player.positionMs = 0;
    playerPosterEl.hidden = true;
    playerPosterEl.removeAttribute("src");
    playerVideoEl.hidden = true;
    playerNoteEl.hidden = true;
    playerEl.classList.remove("is-frames", "is-gif");
    setPlayerOpen(false);
    if (wasVideo && loadedRecentId && recent.find((r) => r.id === loadedRecentId)?.kind === "video") {
      loadedRecentId = null;
      renderFilm();
    }
  }

  /** Open a recording in the in-app player (replaces the old external hand-off). */
  function openRecording(item: RecentShot): void {
    const path = item.path ?? "";
    if (!path) return;

    stopPlayerWatchdog();
    cancelFrameTimer();
    playerVideoEl.pause();
    playerVideoEl.removeAttribute("src");
    playerVideoEl.removeAttribute("poster");
    playerVideoEl.load();

    const ext = (item.ext ?? path.split(".").pop() ?? "").toLowerCase();
    player.item = item;
    player.mode = "video";
    player.playing = false;
    player.scrubbing = false;
    player.durationMs = item.durationMs ?? 0;
    player.positionMs = 0;

    loadedRecentId = item.id;
    renderFilm();
    playerEl.classList.remove("is-frames", "is-gif");
    playerEl.classList.toggle("is-gif", ext === "gif");
    playerNoteEl.hidden = true;
    playerPosterEl.hidden = true;
    playerPosterEl.removeAttribute("src");
    playerVideoEl.hidden = true;
    let url = "";
    try {
      url = convertFileSrc(path);
    } catch {
      url = "";
    }
    if (ext === "gif" || !url) {
      // Animated image (or no asset protocol): show it in an <img>, no transport.
      player.mode = "gif";
      playerPosterEl.src = url || item.thumb;
      playerPosterEl.hidden = false;
      if (ext !== "gif") {
        playerNoteEl.hidden = false;
        playerNoteEl.textContent = "This file can't be previewed in-app — open it in another program.";
      }
      setPlayerOpen(true);
      syncPlayerBar();
      return;
    }

    playerVideoEl.poster = item.thumb || "";
    playerVideoEl.hidden = false;
    setPlayerOpen(true);
    playerVideoEl.src = url;
    syncPlayerBar();
    // A webview that refuses the codec sometimes fires no error at all —
    // if no metadata has landed by now, scrub frames instead.
    player.watchdog = window.setTimeout(() => {
      player.watchdog = 0;
      if (playerIsOpen() && player.mode === "video" && playerVideoEl.readyState < 1) {
        enterFrameMode();
      }
    }, 2500);
  }

  /** Keys that only make sense while the player is up (Space, ←/→, Esc, M). */
  function handlePlayerKeys(ev: KeyboardEvent): boolean {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
    const target = ev.target as HTMLElement | null;
    const typing =
      !!target &&
      (target.tagName === "TEXTAREA" ||
        (target.tagName === "INPUT" && target !== playerRangeEl) ||
        target.isContentEditable);
    if (typing) return false;
    if (ev.key === "Escape") {
      ev.preventDefault();
      closePlayer();
      return true;
    }
    if (ev.key === " " || ev.key === "k" || ev.key === "K") {
      if (target === playerRangeEl) return false;
      ev.preventDefault();
      playerTogglePlay();
      return true;
    }
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      if (target === playerRangeEl) return false;
      ev.preventDefault();
      const step = ev.shiftKey ? 1000 : 5000;
      playerSeek(player.positionMs + (ev.key === "ArrowRight" ? step : -step));
      return true;
    }
    if (ev.key === "m" || ev.key === "M") {
      ev.preventDefault();
      playerVideoEl.muted = !playerVideoEl.muted;
      syncPlayerBar();
      return true;
    }
    return false;
  }

  function wirePlayer(): void {
    playerBigBtn.addEventListener("click", () => playerTogglePlay());
    playerToggleBtn.addEventListener("click", () => playerTogglePlay());
    playerVideoEl.addEventListener("click", () => playerTogglePlay());
    playerCloseBtn.addEventListener("click", () => closePlayer());
    playerMuteBtn.addEventListener("click", () => {
      playerVideoEl.muted = !playerVideoEl.muted;
      syncPlayerBar();
    });
    playerExtBtn.addEventListener("click", () => {
      const path = player.item?.path;
      if (!path) return;
      void invoke("open_path", { path })
        .then(() => setStatus(`Opened ${player.item?.name ?? "the recording"} in another program.`, "success"))
        .catch((e) => setStatus(`Could not open the recording: ${errText(e)}`, "error"));
    });

    playerRangeEl.addEventListener("input", () => {
      player.scrubbing = true;
      const ratio = Number(playerRangeEl.value) / PLAYER_STEPS;
      playerSeek(ratio * (player.durationMs || 0));
    });
    playerRangeEl.addEventListener("change", () => {
      player.scrubbing = false;
      const ratio = Number(playerRangeEl.value) / PLAYER_STEPS;
      playerSeek(ratio * (player.durationMs || 0));
    });

    playerVideoEl.addEventListener("loadedmetadata", () => {
      stopPlayerWatchdog();
      if (!playerIsOpen() || player.mode !== "video") return;
      const duration = playerVideoEl.duration;
      if (Number.isFinite(duration) && duration > 0) {
        player.durationMs = Math.round(duration * 1000);
        syncPlayerBar();
      }
    });
    playerVideoEl.addEventListener("loadeddata", stopPlayerWatchdog);
    playerVideoEl.addEventListener("timeupdate", () => {
      if (player.mode !== "video" || player.scrubbing) return;
      player.positionMs = playerVideoEl.currentTime * 1000;
      syncPlayerBar();
    });
    playerVideoEl.addEventListener("play", () => {
      stopPlayerWatchdog();
      player.playing = true;
      syncPlayerBar();
    });
    playerVideoEl.addEventListener("pause", () => {
      player.playing = false;
      syncPlayerBar();
    });
    playerVideoEl.addEventListener("ended", () => {
      player.playing = false;
      player.positionMs = player.durationMs;
      syncPlayerBar();
    });
    playerVideoEl.addEventListener("error", () => {
      if (playerIsOpen() && player.mode === "video") enterFrameMode();
    });
  }

  /* ----------------------------------------------------------------- ocr */

  function setOcrBusy(value: boolean): void {
    ocrBusy = value;
    ocrBusyEl.hidden = !value;
    ocrRunBtn.disabled = value;
  }

  function ocrSay(message: string, kind: StatusKind = "info"): void {
    ocrStatusEl.textContent = message;
    ocrStatusEl.dataset.kind = kind;
  }

  function ocrKeyDown(ev: KeyboardEvent): void {
    if (ocrModalEl.hidden) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeOcr();
      return;
    }
    if (ev.key !== "Tab") return;
    const items = Array.from(
      ocrModalEl.querySelectorAll<HTMLElement>(
        "button:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      ),
    );
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    ev.preventDefault();
    const step = ev.shiftKey ? -1 : 1;
    items[(index + step + items.length) % items.length]?.focus({ preventScroll: true });
  }

  function openOcr(): void {
    if (!hasImage) {
      setStatus("Nothing to read yet — capture a screen first.", "error");
      return;
    }
    ocrLangSelect.value = ocrLang;
    ocrMetaEl.textContent = `Language: ${OCR_LANGS.find((l) => l.id === ocrLang)?.label ?? "English"}`;
    ocrModalEl.hidden = false;
    void ocrModalEl.offsetWidth;
    ocrModalEl.classList.add("is-open");
    document.addEventListener("keydown", ocrKeyDown, true);
    ocrRunBtn.focus({ preventScroll: true });
    void runOcr();
  }

  function closeOcr(): void {
    if (ocrModalEl.hidden) return;
    ocrModalEl.classList.remove("is-open");
    ocrModalEl.hidden = true;
    document.removeEventListener("keydown", ocrKeyDown, true);
    ocrBtn.focus({ preventScroll: true });
  }

  async function runOcr(): Promise<void> {
    if (ocrBusy) return;
    if (!hasImage) {
      ocrSay("Capture something first.", "error");
      return;
    }
    setOcrBusy(true);
    ocrCopyBtn.disabled = true;
    ocrTextEl.value = "";
    lastOcrText = "";
    ocrSay(ocrLang === "swe" ? "Reading Swedish text…" : "Reading text…");
    try {
      const text = await invoke<string>("ocr_image", { dataUrl: editor.flatten(), lang: ocrLang });
      lastOcrText = typeof text === "string" ? text.trim() : "";
      ocrTextEl.value = lastOcrText;
      ocrCopyBtn.disabled = !lastOcrText;
      if (lastOcrText) {
        ocrSay(`Found ${lastOcrText.length} characters — Copy puts them on the clipboard.`, "success");
        setStatus("Text extracted", "success");
      } else {
        ocrSay("No text found in this capture — try another language.", "info");
      }
    } catch (e) {
      const message = errText(e);
      ocrSay(`Could not extract text: ${message}`, "error");
      setStatus(`OCR failed: ${message}`, "error");
    } finally {
      setOcrBusy(false);
      ocrMetaEl.textContent = `Language: ${OCR_LANGS.find((l) => l.id === ocrLang)?.label ?? "English"}`;
    }
  }

  async function copyOcrText(): Promise<void> {
    const text = ocrTextEl.value || lastOcrText;
    if (!text) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        ocrTextEl.focus({ preventScroll: true });
        ocrTextEl.select();
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setStatus("Extracted text copied to the clipboard", "success");
      ocrSay(`Copied ${text.length} characters.`, "success");
    } else {
      setStatus("Could not copy — select the text and press Ctrl+C.", "error");
      ocrSay("Copy was blocked — select the text and press Ctrl+C.", "error");
    }
  }

  /* ---------------------------------------------------------------- wiring */

  toolsEl.innerHTML = TOOLS.map(
    (t) =>
      `<button type="button" class="chip tool" data-tool="${t.id}" title="${t.hint}" aria-label="${t.label}" aria-pressed="false">${t.icon}<span>${t.label}</span></button>`,
  ).join("");

  for (const btn of Array.from(toolsEl.querySelectorAll<HTMLButtonElement>(".tool"))) {
    const id = btn.dataset.tool as ShellToolId;
    toolButtons.set(id, btn);
    btn.addEventListener("click", () => selectTool(id));
  }

  swatchesEl.innerHTML = COLORS.map(
    (c) =>
      `<button type="button" class="swatch" role="radio" data-hex="${c.hex}" aria-checked="false" aria-label="${c.name}" title="${c.name}" style="--swatch:${c.hex}"><span class="swatch-fill"></span></button>`,
  ).join("");

  for (const btn of Array.from(swatchesEl.querySelectorAll<HTMLButtonElement>(".swatch"))) {
    btn.addEventListener("click", () => applyColor(btn.dataset.hex || DEFAULT_COLOR));
  }

  customColorEl.addEventListener("input", () => applyColor(customColorEl.value, false));
  customColorEl.addEventListener("change", () => applyColor(customColorEl.value, false));

  fontSelect.addEventListener("change", () => applyFont(fontSelect.value));
  sizeDownBtn.addEventListener("click", () => applySize(fontSize - 1));
  sizeUpBtn.addEventListener("click", () => applySize(fontSize + 1));
  sizeInput.addEventListener("change", () => applySize(Number(sizeInput.value)));
  sizeInput.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    applySize(Number(sizeInput.value));
    sizeInput.blur();
  });
  boldBtn.addEventListener("click", () => applyBold(!textBold));
  italicBtn.addEventListener("click", () => applyItalic(!textItalic));

  for (const btn of Array.from(
    blurModesEl.querySelectorAll<HTMLButtonElement>("[data-blur-mode]"),
  )) {
    btn.addEventListener("click", () => {
      const value = btn.dataset.blurMode;
      applyBlurMode(value === "pixelate" || value === "blackout" ? value : "gaussian");
    });
  }
  blurRadiusInput.addEventListener("input", () => applyBlurRadius(Number(blurRadiusInput.value), false));
  blurRadiusInput.addEventListener("change", () => applyBlurRadius(Number(blurRadiusInput.value)));

  toolSizeInput.addEventListener("input", () => applyToolSize(Number(toolSizeInput.value), false));
  toolSizeInput.addEventListener("change", () => applyToolSize(Number(toolSizeInput.value)));
  toolSizeInput.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    // Let the native range move, then push the snapped value through.
    window.setTimeout(() => applyToolSize(Number(toolSizeInput.value), false), 0);
  });

  for (const btn of Array.from(shapePicker.querySelectorAll<HTMLButtonElement>("[data-shape]"))) {
    btn.addEventListener("click", () => {
      const api = editor as unknown as { setShapeKind?: (kind: string) => void };
      try {
        api.setShapeKind?.(btn.dataset.shape ?? "rect");
      } catch (e) {
        setStatus(`Shape failed: ${errText(e)}`, "error");
        return;
      }
      paintShapePicker();
    });
  }

  shadowToggle.addEventListener("click", () => applyShadow({ enabled: !shadow.enabled }));
  shadowBlurInput.addEventListener("input", () =>
    applyShadow({ blur: Number(shadowBlurInput.value) }, false),
  );
  shadowBlurInput.addEventListener("change", () => applyShadow({ blur: Number(shadowBlurInput.value) }));
  shadowColorInput.addEventListener("input", () => {
    // Keep the soft alpha the shadow already had when the user picks a new hue.
    const alpha = splitColorAlpha(shadow.color).alpha;
    applyShadow({ color: withAlpha(shadowColorInput.value, alpha) }, false);
  });
  shadowColorInput.addEventListener("change", () => {
    const alpha = splitColorAlpha(shadow.color).alpha;
    applyShadow({ color: withAlpha(shadowColorInput.value, alpha) });
  });
  // Direction + distance are the offsets, just expressed the way people think:
  // "the shadow falls down-right" instead of "x 6, y 6".
  const shadowFromSliders = (): { angle: number; distance: number } => ({
    angle: Number(shadowAngleInput.value) || 0,
    distance: Math.min(MAX_SHADOW_OFFSET, Math.max(0, Number(shadowDistanceInput.value) || 0)),
  });
  shadowAngleInput.addEventListener("input", () => {
    const { angle, distance } = shadowFromSliders();
    applyShadow(shadowOffsets(angle, distance), false);
  });
  shadowAngleInput.addEventListener("change", () => {
    const { angle, distance } = shadowFromSliders();
    applyShadow(shadowOffsets(angle, distance));
    setStatus(`Shadow falls ${angle}° · ${distance} px`, "success");
  });
  shadowDistanceInput.addEventListener("input", () => {
    const { angle, distance } = shadowFromSliders();
    applyShadow(shadowOffsets(angle, distance), false);
  });
  shadowDistanceInput.addEventListener("change", () => {
    const { angle, distance } = shadowFromSliders();
    applyShadow(shadowOffsets(angle, distance));
    setStatus(`Shadow distance ${distance} px`, "success");
  });
  shadowOpacityInput.addEventListener("input", () => {
    const alpha = Math.min(1, Math.max(0.02, (Number(shadowOpacityInput.value) || 0) / 100));
    applyShadow({ color: withAlpha(splitColorAlpha(shadow.color).hex, alpha) }, false);
  });
  shadowOpacityInput.addEventListener("change", () => {
    const alpha = Math.min(1, Math.max(0.02, (Number(shadowOpacityInput.value) || 0) / 100));
    applyShadow({ color: withAlpha(splitColorAlpha(shadow.color).hex, alpha) });
  });

  resizeOpenBtn.addEventListener("click", () => {
    if (resizePop.hidden) openResize();
    else closeResize();
  });
  resizeCloseBtn.addEventListener("click", () => closeResize());
  resizeCancelBtn.addEventListener("click", () => closeResize());
  resizeApplyBtn.addEventListener("click", () => applyResize());
  resizeWInput.addEventListener("input", syncResizeFromWidth);
  resizeHInput.addEventListener("input", syncResizeFromHeight);
  resizeLockInput.addEventListener("change", () => {
    resizeLocked = resizeLockInput.checked;
  });
  for (const input of [resizeWInput, resizeHInput]) {
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        applyResize();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        closeResize();
      }
    });
  }
  const onResizeOutside = (ev: PointerEvent): void => {
    if (resizePop.hidden) return;
    const target = ev.target as Node | null;
    if (target && (resizePop.contains(target) || resizeOpenBtn.contains(target))) return;
    closeResize(false);
  };
  document.addEventListener("pointerdown", onResizeOutside);
  blurModesEl.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
    const order: BlurMode[] = ["gaussian", "pixelate", "blackout"];
    const index = order.indexOf(blurMode);
    ev.preventDefault();
    const step = ev.key === "ArrowRight" ? 1 : -1;
    const next = order[(index + step + order.length) % order.length];
    applyBlurMode(next);
    blurModesEl
      .querySelector<HTMLButtonElement>(`[data-blur-mode="${next}"]`)
      ?.focus({ preventScroll: true });
  });

  /** Swap the rail to the active tool's own property groups. */
  function paintProps(id: ShellToolId): void {
    const spec = PROPS[id] ?? { hint: "", groups: [] };
    const tool = TOOLS.find((t) => t.id === id);
    propsTitle.textContent = tool ? tool.label : id;
    propsHint.textContent = spec.hint;
    strokeLabel.textContent = spec.strokeLabel ?? "Width";
    for (const group of Array.from(propsBody.querySelectorAll<HTMLElement>("[data-group]"))) {
      const key = group.dataset.group ?? "";
      // Size and Resize are driven by the editor's live capabilities, not the table.
      if (key === "size" || key === "resize") continue;
      group.hidden = !spec.groups.includes(key as PropGroup);
    }
    paintToolSize(id);
    paintShadow();
    paintShapePicker();
    // Blur runs its radius through the generic size slider when the editor has one.
    radiusField.hidden = !!sizeRange && id === "blur";
    propsEl.classList.toggle("is-contextless", spec.groups.length === 0 && !sizeRange);
  }

  /** Mirror the editor's Shapes outline into the picker. */
  function paintShapePicker(): void {
    const api = editor as unknown as { getShapeKind?: () => string };
    const active = api.getShapeKind?.() ?? "rect";
    for (const btn of Array.from(
      shapePicker.querySelectorAll<HTMLButtonElement>("[data-shape]"),
    )) {
      const on = btn.dataset.shape === active;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-checked", String(on));
    }
  }

  function selectTool(id: ShellToolId, announce = true): void {
    try {
      editor.setTool(id as ToolId);
    } catch (e) {
      setStatus(`${id} is not available in this build: ${errText(e)}`, "error");
      return;
    }
    paintProps(id);
    for (const [key, btn] of toolButtons) {
      const active = key === id;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
    if (announce && !hasImage) {
      const tool = TOOLS.find((t) => t.id === id);
      setStatus(`${tool ? tool.label : id} tool selected — capture a screen to start annotating.`);
    }
  }

  async function copyPng(): Promise<void> {
    if (!hasImage) {
      setStatus("Nothing to copy yet — capture a screen first.", "error");
      return;
    }
    try {
      await invoke("copy_png", { dataUrl: editor.flatten() });
      setStatus("Copied to clipboard", "success");
    } catch (e) {
      setStatus(`Copy failed: ${errText(e)}`, "error");
    }
  }

  panel = new SettingsPanel({
    getSaveDir: () => saveDir,
    changeSaveDir: () => pickSaveDir(),
    resetSaveDir: () => resetSaveDir(),
    getRecDir: () => (settings.splitFolders && settings.recDir ? settings.recDir : null),
    changeRecDir: () => pickRecDir(),
    resetRecDir: () => resetRecDir(),
    getVersion: () => (appVersion ? appVersion : null),
    setTheme: (next) => setTheme(next),
    getSettings: () => settings,
    updateSettings: (patch, opts) => updateSettings(patch, opts),
    registerHotkeys: () => applyHotkeys(true),
    getHotkeyStatus: () => hotkeyStatus,
    copyDiagnostics: async () => {
      const text = await invoke<string>("recording_diagnostics");
      await navigator.clipboard.writeText(text);
    },
    // Tauri stays here: the panel itself is importable without it.
    listAudioSources: async () => {
      const raw = await invoke<Array<{ id: string; name: string }>>("list_audio_sources");
      return Array.isArray(raw)
        ? raw.map((src) => ({ id: String(src.id), name: String(src.name ?? src.id) }))
        : [];
    },
    // Launch-at-login: the official plugin owns the OS registration (XDG
    // autostart on Linux — AppImage-aware —, registry Run key on Windows,
    // LaunchAgent on macOS). The panel only ever sees these two callbacks.
    getAutostart: () => autostartIsEnabled(),
    setAutostart: (enabled) => (enabled ? autostartEnable() : autostartDisable()),
    // Default screenshot tool (Linux Cinnamon/GNOME): the backend clears the
    // desktop's own Print/Shift+Print bindings and adds custom shortcuts that
    // run the single-instance CLI. The panel owns confirmation + restore UI.
    getDefaultToolStatus: async () => normalizeDefaultTool(await invoke("default_tool_status")),
    setDefaultTool: async () =>
      normalizeDefaultTool(await invoke("set_default_screenshot_tool")),
    restoreDefaultTool: async () =>
      normalizeDefaultTool(await invoke("restore_default_screenshot_tool")),
    // File → Check for updates… without the menu: same backend command, and the
    // panel gets the one-line answer for its inline note.
    checkForUpdates: () => checkForUpdates(true),
  });

  guardSaveBtn.addEventListener("click", () => void onGuardSave());
  guardDiscardBtn.addEventListener("click", () => void onGuardDiscard());
  guardCancelBtn.addEventListener("click", () =>
    dismissGuard("Close cancelled — your capture is still here."),
  );
  guardEl.addEventListener("pointerdown", (ev) => {
    if (ev.target === guardEl) dismissGuard("Close cancelled — your capture is still here.");
  });

  themeBtn.addEventListener("click", () => setTheme(theme === "dark" ? "light" : "dark"));

  captureBtn.addEventListener("click", () => void runCapture());
  recStopBtn.addEventListener("click", () => void stopRecording());
  recPauseBtn.addEventListener("click", () => void toggleRecPause());
  caretBtn.addEventListener("click", () => setMenuOpen(!captureMenu.isOpen()));

  /* ---------------------------------------------------------------- file menu */
  const fileBtn = $<HTMLButtonElement>("#file-btn");
  /** Mirror the watermark settings into the editor (they only affect exports). */
  function applyWatermark(): void {
    const api = editor as unknown as { setWatermark?: (options: unknown) => void };
    try {
      api.setWatermark?.({
        text: settings.watermarkText,
        opacity: settings.watermarkOpacity / 100,
        corner: settings.watermarkCorner,
      });
    } catch (e) {
      setStatus(`Watermark failed: ${errText(e)}`, "error");
    }
  }

  /** File → Upload… — POST the flattened image and copy the returned link. */
  async function uploadImage(): Promise<void> {
    if (!hasImage) {
      setStatus("Nothing to upload — capture or open an image first.", "error");
      return;
    }
    const endpoint = settings.uploadEndpoint.trim();
    if (!endpoint) {
      setStatus("Set an upload endpoint in Settings → Export first.", "error");
      panel?.open();
      return;
    }
    try {
      setStatus("Uploading…");
      const link = await invoke<string>("upload_image", {
        dataUrl: editor.flatten(),
        endpoint,
      });
      try {
        await invoke("copy_text", { text: link });
        setStatus(`Uploaded — link copied: ${link}`, "success");
      } catch {
        setStatus(`Uploaded: ${link}`, "success");
      }
    } catch (e) {
      setStatus(`Upload failed: ${errText(e)}`, "error");
    }
  }

  const fileMenuEl = $<HTMLDivElement>("#file-menu");
  const fileWrapEl = fileMenuEl.parentElement as HTMLElement;
  const fileMenu = createMenu(fileWrapEl, fileMenuEl, fileBtn);
  const syncFileMenu = (): void => {
    const widgetItem = fileMenuEl.querySelector<HTMLButtonElement>('[data-file="widget"]');
    if (widgetItem) {
      widgetItem.setAttribute("aria-checked", String(settings.widget));
      widgetItem.classList.toggle("is-active", settings.widget);
    }
    for (const id of ["save", "save-as", "copy"]) {
      const el = fileMenuEl.querySelector<HTMLButtonElement>(`[data-file="${id}"]`);
      if (el) el.disabled = !hasImage;
    }
  };
  const setFileMenuOpen = (open: boolean): void => {
    if (open) syncFileMenu();
    fileMenu.setOpen(open);
  };
  fileBtn.addEventListener("click", () => setFileMenuOpen(!fileMenu.isOpen()));
  fileBtn.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowDown" || !fileMenuEl.hidden) return;
    ev.preventDefault();
    setFileMenuOpen(true);
  });
  for (const item of Array.from(fileMenuEl.querySelectorAll<HTMLButtonElement>(".menu-item"))) {
    item.addEventListener("click", () => {
      const action = item.dataset.file;
      setFileMenuOpen(false);
      fileBtn.focus({ preventScroll: true });
      switch (action) {
        case "new":
          openNewCanvas();
          break;
        case "open":
          void openImage();
          break;
        case "save-as":
          void saveAs();
          break;
        case "save":
          void saveEdited();
          break;
        case "copy":
          void copyPng();
          break;
        case "upload":
          void uploadImage();
          break;
        case "settings":
          panel?.open();
          break;
        case "widget":
          void setWidget(!settings.widget);
          break;
        case "about":
          openAbout();
          break;
        case "update":
          void checkForUpdates(true).catch(() => {
            /* status line already explains it */
          });
          break;
      }
    });
  }
  fileMenuEl.addEventListener("keydown", (ev) => {
    const items = Array.from(fileMenuEl.querySelectorAll<HTMLButtonElement>(".menu-item"));
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const step = ev.key === "ArrowDown" ? 1 : -1;
      items[(idx + step + items.length) % items.length]?.focus();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      setFileMenuOpen(false);
      fileBtn.focus({ preventScroll: true });
    }
  });

  // Opening from the caret with ArrowDown is a standard menu affordance.
  caretBtn.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowDown" || !menuEl.hidden) return;
    ev.preventDefault();
    setMenuOpen(true);
  });

  for (const item of Array.from(menuEl.querySelectorAll<HTMLButtonElement>(".menu-item"))) {
    item.addEventListener("click", () => {
      // Record entries now live in the same Capture menu.
      const recRaw = item.dataset.recMode;
      if (recRaw === "full" || recRaw === "region" || recRaw === "window") {
        setMenuOpen(false);
        setRecMode(recRaw, true);
        caretBtn.focus({ preventScroll: true });
        void startRecording(recRaw);
        return;
      }
      const raw = item.dataset.mode;
      const next: CaptureMode =
        raw === "region" || raw === "window" || raw === "monitor" || raw === "scrolling" || raw === "interval"
          ? raw
          : "full";
      setMode(next, true);
      setMenuOpen(false);
      caretBtn.focus({ preventScroll: true });
      // Flow modes start right away: scrolling opens the region overlay, the
      // picker modes hand over to the OS dialog, interval opens its HUD card.
      if (next === "scrolling" || next === "interval" || isPickerMode(next)) void runCapture(next);
    });
  }

  menuEl.addEventListener("keydown", (ev) => {
    const items = Array.from(menuEl.querySelectorAll<HTMLButtonElement>(".menu-item"));
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const step = ev.key === "ArrowDown" ? 1 : -1;
      const next = (idx + step + items.length) % items.length;
      items[next]?.focus();
    } else if (ev.key === "Home" || ev.key === "End") {
      ev.preventDefault();
      items[ev.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      setMenuOpen(false);
      caretBtn.focus({ preventScroll: true });
    }
  });

  // Record menu: same affordances as Capture — ArrowDown from the caret, arrow
  // keys / Home / End inside, Esc back to the caret. Selecting a mode persists it
  // AND starts that kind of take immediately.
  const onDocPointerDown = (ev: PointerEvent): void => {
    const target = ev.target as Node | null;
    if (!menuEl.hidden && !(target && splitEl.contains(target))) setMenuOpen(false);
    if (!fileMenuEl.hidden && !(target && fileWrapEl.contains(target))) setFileMenuOpen(false);
  };
  document.addEventListener("pointerdown", onDocPointerDown);

  editorEl.addEventListener("snagcraft:change", (ev) => {
    const detail = (ev as CustomEvent<ChangeDetail>).detail;
    const canUndo = typeof detail?.canUndo === "boolean" ? detail.canUndo : editor.canUndo();
    const canRedo = typeof detail?.canRedo === "boolean" ? detail.canRedo : editor.canRedo();
    undoBtn.disabled = !hasImage || !canUndo;
    redoBtn.disabled = !hasImage || !canRedo;
    if (detail?.tool) {
      paintProps(detail.tool as ShellToolId);
      // The quick bar belongs to text work; other tools release a held box.
      if (detail.tool !== "text" && detail.tool !== "select") textBar.release();
    }
    // Shadow can change inside the editor (undo, tool restore) — mirror it back.
    syncShadowFromEditor();
    // The quick text bar edits editor defaults directly — keep the rail in step.
    syncTextFromEditor();
    const liveColor = editor.getColor();
    if (liveColor && liveColor.toLowerCase() !== inkColor) applyColor(liveColor, false);
    paintResizeState();
    syncDirty();
  });

  undoBtn.addEventListener("click", () => {
    editor.undo();
    syncHistory();
  });
  redoBtn.addEventListener("click", () => {
    editor.redo();
    syncHistory();
  });
  copyBtn.addEventListener("click", () => void copyPng());
  saveBtn.addEventListener("click", () => void saveEdited());
  saveAsBtn.addEventListener("click", () => void saveAs());
  ocrBtn.addEventListener("click", () => openOcr());

  filmToggleBtn.addEventListener("click", () => setFilmOpen(!filmOpen));
  filmCloseBtn.addEventListener("click", () => {
    setFilmOpen(false);
    filmToggleBtn.focus({ preventScroll: true });
  });
  filmClearBtn.addEventListener("click", () => {
    recent = [];
    loadedRecentId = null;
    renderFilm();
    setStatus("Recent captures cleared");
  });

  /* ------------------------------------------- resizable Recent strip */
  // Drag the top edge to give Recent more room; thumbnails scale with it so
  // the strip stays readable for low-vision use. Height persists; double-click
  // (or Home) resets to the compact default.
  const FILM_HEIGHT_KEY = "snagcraft:film-height";
  const FILM_MIN = 110;
  const filmResizeEl = $<HTMLDivElement>("#film-resize");
  let filmHeight: number | null = null;
  let filmDrag: { startY: number; startH: number } | null = null;

  const filmMax = (): number =>
    Math.max(FILM_MIN, Math.min(Math.round(stageEl.clientHeight * 0.7), 468));

  function applyFilmHeight(height: number | null): void {
    filmHeight = height;
    if (height == null) {
      filmStripEl.style.height = "";
      filmStripEl.style.removeProperty("--film-thumb-h");
      filmStripEl.style.removeProperty("--film-item-w");
      return;
    }
    const clamped = Math.min(Math.max(Math.round(height), FILM_MIN), filmMax());
    // head + caption + padding ≈ 68px; the rest is thumbnail.
    const thumb = Math.min(Math.max(clamped - 68, 48), 400);
    filmStripEl.style.height = `${clamped}px`;
    filmStripEl.style.setProperty("--film-thumb-h", `${thumb}px`);
    filmStripEl.style.setProperty("--film-item-w", `${Math.round((thumb * 112) / 48)}px`);
  }

  const persistFilmHeight = (): void => {
    if (filmHeight != null) writeStore(FILM_HEIGHT_KEY, String(filmHeight));
  };

  filmResizeEl.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    filmResizeEl.setPointerCapture(ev.pointerId);
    filmDrag = { startY: ev.clientY, startH: filmStripEl.getBoundingClientRect().height };
  });
  filmResizeEl.addEventListener("pointermove", (ev) => {
    if (!filmDrag) return;
    applyFilmHeight(filmDrag.startH + (filmDrag.startY - ev.clientY));
  });
  const endFilmDrag = (ev: PointerEvent): void => {
    if (!filmDrag) return;
    filmDrag = null;
    try {
      filmResizeEl.releasePointerCapture(ev.pointerId);
    } catch {
      /* capture already gone */
    }
    persistFilmHeight();
  };
  filmResizeEl.addEventListener("pointerup", endFilmDrag);
  filmResizeEl.addEventListener("pointercancel", endFilmDrag);
  filmResizeEl.addEventListener("dblclick", () => {
    applyFilmHeight(null);
    writeStore(FILM_HEIGHT_KEY, "");
  });
  filmResizeEl.addEventListener("keydown", (ev) => {
    const current = filmStripEl.getBoundingClientRect().height;
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      applyFilmHeight(current + 24);
      persistFilmHeight();
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      applyFilmHeight(current - 24);
      persistFilmHeight();
    } else if (ev.key === "Home") {
      ev.preventDefault();
      applyFilmHeight(null);
      writeStore(FILM_HEIGHT_KEY, "");
    }
  });
  window.addEventListener("resize", () => {
    if (filmHeight != null) applyFilmHeight(filmHeight);
  });
  const storedFilmHeight = Number(readStore(FILM_HEIGHT_KEY));
  if (Number.isFinite(storedFilmHeight) && storedFilmHeight >= FILM_MIN) {
    applyFilmHeight(storedFilmHeight);
  }
  filmTrackEl.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLButtonElement>(".film-item");
    const id = btn?.dataset.id;
    if (id) void loadRecent(id);
  });

  presetChipsEl.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement | null;
    const chip = target?.closest<HTMLElement>(".preset");
    if (!chip) return;
    const index = Number(chip.dataset.index);
    if (!Number.isInteger(index)) return;
    if (target?.closest(".preset-del")) deletePreset(index);
    else if (target?.closest(".preset-apply")) applyPreset(index);
  });
  presetSaveToggle.addEventListener("click", () => setPresetFormOpen(presetFormEl.hidden));
  presetFormEl.addEventListener("submit", (ev) => {
    ev.preventDefault();
    savePresetFromForm();
  });
  presetNameEl.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    setPresetFormOpen(false);
    presetSaveToggle.focus({ preventScroll: true });
  });

  ocrRunBtn.addEventListener("click", () => void runOcr());
  ocrCopyBtn.addEventListener("click", () => void copyOcrText());
  ocrCloseBtn.addEventListener("click", () => closeOcr());
  ocrCancelBtn.addEventListener("click", () => closeOcr());
  ocrLangSelect.addEventListener("change", () => {
    ocrLang = ocrLangSelect.value === "swe" ? "swe" : "eng";
    writeStore(OCR_LANG_KEY, ocrLang);
    void runOcr();
  });
  ocrModalEl.addEventListener("pointerdown", (ev) => {
    if (ev.target === ocrModalEl) closeOcr();
  });

  // Keyboard shortcuts overlay (the "?" help).
  const shortcutsModalEl = $<HTMLDivElement>("#shortcuts-modal");
  const shortcutsCloseBtn = $<HTMLButtonElement>("#shortcuts-close");
  const helpBtnEl = $<HTMLButtonElement>("#help-btn");
  const openShortcuts = (): void => {
    if (!shortcutsModalEl.hidden) return;
    shortcutsModalEl.hidden = false;
    void shortcutsModalEl.offsetWidth;
    shortcutsModalEl.classList.add("is-open");
    shortcutsModalEl.querySelector<HTMLElement>(".modal")?.focus({ preventScroll: true });
  };
  const closeShortcuts = (): void => {
    if (shortcutsModalEl.hidden) return;
    shortcutsModalEl.classList.remove("is-open");
    shortcutsModalEl.hidden = true;
    helpBtnEl.focus({ preventScroll: true });
  };
  helpBtnEl.addEventListener("click", openShortcuts);
  shortcutsCloseBtn.addEventListener("click", closeShortcuts);
  shortcutsModalEl.addEventListener("pointerdown", (ev) => {
    if (ev.target === shortcutsModalEl) closeShortcuts();
  });

  // About dialog (File → About): version, license and repository.
  const aboutModalEl = $<HTMLDivElement>("#about-modal");
  const aboutCloseBtn = $<HTMLButtonElement>("#about-close");
  const openAbout = (): void => {
    if (!aboutModalEl.hidden) return;
    aboutModalEl.hidden = false;
    void aboutModalEl.offsetWidth;
    aboutModalEl.classList.add("is-open");
    aboutModalEl.querySelector<HTMLElement>(".modal")?.focus({ preventScroll: true });
  };
  const closeAbout = (): void => {
    if (aboutModalEl.hidden) return;
    aboutModalEl.classList.remove("is-open");
    aboutModalEl.hidden = true;
    fileBtn.focus({ preventScroll: true });
  };
  aboutCloseBtn.addEventListener("click", closeAbout);
  $<HTMLButtonElement>("#about-ok").addEventListener("click", closeAbout);
  aboutModalEl.addEventListener("pointerdown", (ev) => {
    if (ev.target === aboutModalEl) closeAbout();
  });
  aboutModalEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeAbout();
    }
  });

  // ------------------------------------- check for updates (File menu + daily)
  // The backend asks GitHub for the newest published release. Nothing is ever
  // downloaded by itself: an automatic check leaves a marker in the File menu,
  // and the dialog only offers the release page.
  const updateModalEl = $<HTMLDivElement>("#update-modal");
  const updateDotEl = document.getElementById("update-dot");
  const updateMenuEl = fileMenuEl.querySelector<HTMLButtonElement>('[data-file="update"]');
  const updateHintEl = document.getElementById("update-menu-hint");
  let availableUpdate: UpdateInfo | null = null;
  let shownUpdate: UpdateInfo | null = null;
  let checkingUpdates = false;

  // In-place install (Tauri's signed updater): dialog pieces + a tiny state
  // machine. `canInstallUpdate` is false for .deb installs and anything that
  // isn't an AppImage, where the button would have nothing to write to.
  const updateBarEl = document.getElementById("update-bar");
  const updateBarFillEl = document.getElementById("update-bar-fill");
  const updateProgressEl = document.getElementById("update-progress");
  const updateProgressTextEl = document.getElementById("update-progress-text");
  const updateFeedbackEl = document.getElementById("update-feedback");
  const updateInstallNoteEl = document.getElementById("update-install-note");
  const updateNowBtn = $<HTMLButtonElement>("#update-now");
  const updateRestartBtn = $<HTMLButtonElement>("#update-restart");
  const updateLaterBtn = $<HTMLButtonElement>("#update-later");
  const updateSkipBtn = $<HTMLButtonElement>("#update-skip");
  const updateOpenBtn = $<HTMLButtonElement>("#update-open");
  /** Rust event carrying download progress (src-tauri/src/update.rs). */
  const UPDATE_PROGRESS_EVENT = "snagcraft-update-progress";
  type UpdatePhase = "available" | "downloading" | "installed" | "failed";
  let updatePhase: UpdatePhase = "available";
  let canInstallUpdate = false;
  let progressPct = 0;

  const bareVersion = (value: string): string => value.replace(/^v/i, "");
  const skippedVersion = (): string => readStore(SKIPPED_VERSION_KEY) ?? "";

  /** The release a quiet check already found, remembered across restarts. */
  function rememberedUpdate(): UpdateInfo | null {
    const raw = readStore(UPDATE_AVAILABLE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<UpdateInfo>;
      const info: UpdateInfo = {
        current: String(parsed.current ?? ""),
        latest: String(parsed.latest ?? ""),
        newer: parsed.newer === true,
        title: String(parsed.title ?? ""),
        url: String(parsed.url ?? ""),
        notes: String(parsed.notes ?? ""),
      };
      // A build that has caught up must never keep advertising the old version.
      if (!info.newer || !info.latest || !info.url.startsWith("https://")) return null;
      if (appVersion && info.latest === bareVersion(appVersion)) return null;
      return info;
    } catch {
      return null;
    }
  }

  /** Marker in the File menu: a dot, the version in the gutter, nothing more. */
  function markUpdate(info: UpdateInfo | null): void {
    availableUpdate = info;
    const visible = !!info && info.latest !== skippedVersion();
    if (updateDotEl) updateDotEl.hidden = !visible;
    if (updateMenuEl) updateMenuEl.classList.toggle("has-update", visible);
    if (updateMenuEl) {
      updateMenuEl.title = visible && info
        ? `SnagCraft v${info.latest} is available — open the release page`
        : "Ask GitHub whether a newer version has been published";
    }
    if (updateHintEl) updateHintEl.textContent = visible && info ? `v${info.latest}` : "";
  }

  function openUpdateModal(info: UpdateInfo): void {
    shownUpdate = info;
    const set = (id: string, text: string): void => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    updatePhase = "available";
    progressPct = 0;
    set("update-latest", `v${info.latest}`);
    set("update-current", `v${info.current}`);
    set("update-title", "Update available");
    set(
      "update-desc",
      canInstallUpdate
        ? "SnagCraft can download and install it here — or open the release page."
        : "A newer SnagCraft has been published.",
    );
    // The release title usually repeats the tag; keep only the description.
    const headline = info.title.replace(/^\s*v?\d+(?:\.\d+)*\s*[—–-]?\s*/i, "").trim();
    set("update-release-title", headline);
    const titleEl = document.getElementById("update-release-title");
    if (titleEl) titleEl.hidden = headline === "";
    set("update-notes", info.notes);
    const notesEl = document.getElementById("update-notes");
    if (notesEl) notesEl.hidden = info.notes === "";
    if (updateInstallNoteEl) {
      updateInstallNoteEl.hidden = canInstallUpdate;
      updateInstallNoteEl.textContent = canInstallUpdate
        ? ""
        : "This build can't replace itself (installed as a system package) — grab the new version from the release page.";
    }
    setUpdateFeedback("", "info");
    paintUpdateDialog();
    if (!updateModalEl.hidden) return;
    updateModalEl.hidden = false;
    void updateModalEl.offsetWidth;
    updateModalEl.classList.add("is-open");
    updateModalEl.querySelector<HTMLElement>(".modal")?.focus({ preventScroll: true });
  }

  /** Show a line under the dialog body (errors, hints). */
  function setUpdateFeedback(message: string, kind: "info" | "error"): void {
    if (!updateFeedbackEl) return;
    updateFeedbackEl.textContent = message;
    updateFeedbackEl.hidden = message === "";
    updateFeedbackEl.dataset.kind = kind;
  }

  /** Buttons + progress follow one small state machine. */
  function paintUpdateDialog(): void {
    const busy = updatePhase === "downloading";
    const installed = updatePhase === "installed";
    if (updateNowBtn) {
      updateNowBtn.hidden = !canInstallUpdate || busy || installed;
      updateNowBtn.disabled = busy;
      updateNowBtn.textContent = "Update now";
    }
    if (updateRestartBtn) updateRestartBtn.hidden = !installed;
    if (updateLaterBtn) {
      updateLaterBtn.hidden = installed;
      updateLaterBtn.disabled = busy;
    }
    if (updateSkipBtn) {
      updateSkipBtn.hidden = busy || installed;
      updateSkipBtn.disabled = busy;
    }
    if (updateOpenBtn) {
      updateOpenBtn.textContent = canInstallUpdate ? "Release notes" : "Open the release page";
      updateOpenBtn.disabled = busy;
    }
    if (updateProgressEl) updateProgressEl.hidden = !busy && !installed;
    if (updateBarEl) updateBarEl.setAttribute("aria-valuenow", String(Math.round(progressPct)));
    if (updateBarFillEl) updateBarFillEl.style.width = `${progressPct}%`;
    if (updateProgressTextEl && !busy && installed) {
      updateProgressTextEl.textContent = "Installed — restart SnagCraft to use it.";
    }
  }

  const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  /** Download + install through Tauri's signed updater. */
  async function startUpdateInstall(): Promise<void> {
    if (!canInstallUpdate || updatePhase === "downloading") return;
    updatePhase = "downloading";
    progressPct = 0;
    setUpdateFeedback("", "info");
    paintUpdateDialog();
    if (updateProgressTextEl) updateProgressTextEl.textContent = "Starting the download…";
    try {
      const version = await invoke<string>("install_update");
      updatePhase = "installed";
      progressPct = 100;
      const latestEl = document.getElementById("update-latest");
      if (latestEl) latestEl.textContent = `v${version}`;
      const titleEl = document.getElementById("update-title");
      if (titleEl) titleEl.textContent = "Update installed";
      const desc = document.getElementById("update-desc");
      if (desc) desc.textContent = `SnagCraft v${version} is installed. Restart to use it.`;
      paintUpdateDialog();
      setStatus(`SnagCraft v${version} is installed — restart to use it.`, "success");
      // The offered update is now on disk; the marker would only repeat itself.
      try {
        localStorage.removeItem(UPDATE_AVAILABLE_KEY);
      } catch {
        /* storage unavailable — the marker just stays until restart */
      }
      markUpdate(null);
      if (updateHintEl) updateHintEl.textContent = "restart";
    } catch (e) {
      updatePhase = "failed";
      const message = errText(e);
      setUpdateFeedback(message, "error");
      paintUpdateDialog();
      setStatus(`The update did not install: ${message}`, "error");
    }
  }

  /** Restart into the installed build — after the unsaved-work check. */
  function restartIntoUpdate(): void {
    if (hasImage && isDirty()) {
      const message = "You have unsaved annotations. Save them (Ctrl+S), then press Restart now again.";
      setUpdateFeedback(message, "error");
      setStatus("Save your capture first — then restart to finish the update.", "error");
      return;
    }
    void invoke("restart_app").catch((e: unknown) =>
      setStatus(`Could not restart: ${errText(e)}`, "error"),
    );
  }

  if (updateNowBtn) updateNowBtn.addEventListener("click", () => void startUpdateInstall());
  if (updateRestartBtn) updateRestartBtn.addEventListener("click", restartIntoUpdate);

  // Progress while the artifact downloads (emitted by `install_update`).
  void listen<{ downloaded: number; total: number | null }>(UPDATE_PROGRESS_EVENT, (event) => {
    if (updatePhase !== "downloading") return;
    const { downloaded, total } = event.payload;
    const known = typeof total === "number" && total > 0;
    progressPct = known ? Math.min(100, (downloaded / (total as number)) * 100) : 0;
    if (updateProgressTextEl) {
      updateProgressTextEl.textContent = known
        ? `Downloading ${megabytes(downloaded)} of ${megabytes(total as number)} — ${Math.round(progressPct)} %`
        : `Downloading ${megabytes(downloaded)}…`;
    }
    paintUpdateDialog();
  });

  function closeUpdateModal(): void {
    if (updateModalEl.hidden) return;
    updateModalEl.classList.remove("is-open");
    updateModalEl.hidden = true;
    fileBtn.focus({ preventScroll: true });
  }

  /**
   * Ask the backend for the newest release. `manual` means the user clicked it,
   * so the answer belongs in a dialog and a failure is spoken out loud; the
   * quiet daily check stays silent about both.
   */
  async function checkForUpdates(manual: boolean): Promise<string> {
    if (checkingUpdates) return "An update check is already running.";
    checkingUpdates = true;
    // Recorded up front so a failed (offline) check still waits a day.
    writeStore(LAST_UPDATE_CHECK_KEY, String(Date.now()));
    if (manual) setStatus("Checking for updates…");
    try {
      const info = await invoke<UpdateInfo>("check_for_update");
      if (info.newer) {
        writeStore(UPDATE_AVAILABLE_KEY, JSON.stringify(info));
        markUpdate(info);
        if (manual) {
          openUpdateModal(info);
          setStatus(`SnagCraft v${info.latest} is available — open the release page from the dialog.`);
        } else if (info.latest !== skippedVersion()) {
          setStatus(`SnagCraft v${info.latest} is available — File → Check for updates…`);
        }
        return `SnagCraft v${info.latest} is available.`;
      }
      try {
        localStorage.removeItem(UPDATE_AVAILABLE_KEY);
      } catch {
        /* storage unavailable — the marker just isn't remembered */
      }
      markUpdate(null);
      if (manual) setStatus(`SnagCraft v${info.current} is the newest release.`, "success");
      return `SnagCraft v${info.current} is the newest release.`;
    } catch (e) {
      if (manual) setStatus(`Could not check for updates: ${errText(e)}`, "error");
      throw e;
    } finally {
      checkingUpdates = false;
    }
  }

  /** One quiet check a day — Settings → General can switch it off. */
  function maybeCheckForUpdates(): void {
    markUpdate(rememberedUpdate());
    if (!settings.checkUpdates) return;
    const last = Number(readStore(LAST_UPDATE_CHECK_KEY) ?? 0);
    if (Number.isFinite(last) && last > 0 && Date.now() - last < UPDATE_CHECK_INTERVAL_MS) return;
    void checkForUpdates(false).catch(() => {
      /* offline or rate-limited: say nothing and try again tomorrow */
    });
  }

  $<HTMLButtonElement>("#update-open").addEventListener("click", () => {
    const url = shownUpdate?.url ?? "";
    closeUpdateModal();
    if (!url) return;
    void invoke("open_url", { url }).catch((e: unknown) =>
      setStatus(`Could not open the release page: ${errText(e)}`, "error"),
    );
  });
  $<HTMLButtonElement>("#update-later").addEventListener("click", () => {
    closeUpdateModal();
    setStatus("Still on the installed version — File → Check for updates… shows it again.");
  });
  $<HTMLButtonElement>("#update-skip").addEventListener("click", () => {
    const latest = shownUpdate?.latest ?? "";
    if (latest) writeStore(SKIPPED_VERSION_KEY, latest);
    markUpdate(availableUpdate);
    closeUpdateModal();
    if (latest) {
      setStatus(`Not mentioning v${latest} again — the manual check still offers it.`);
    }
  });
  $<HTMLButtonElement>("#update-close").addEventListener("click", closeUpdateModal);
  updateModalEl.addEventListener("pointerdown", (ev) => {
    if (ev.target === updateModalEl) closeUpdateModal();
  });
  updateModalEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeUpdateModal();
    }
  });

  // Paste or drop an image to annotate it (Snagit-style).
  const loadImageFile = (file: File): void => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      void editor
        .load(reader.result)
        .then(() => {
          setImageState(true);
          syncDirty();
          setStatus("Image loaded — annotate away.", "success");
        })
        .catch((e: unknown) => setStatus(`Could not load that image: ${errText(e)}`, "error"));
    };
    reader.readAsDataURL(file);
  };

  /** File → Open: load any image from disk into the editor (Ctrl+O). */
  async function loadImagePath(path: string): Promise<void> {
    const dataUrl = await invoke<string>("read_image_file", { path });
    await editor.load(dataUrl);
    setImageState(true);
    syncDirty();
    const name = path.split(/[\\/]/).pop() || "image";
    setStatus(`Opened ${name} — annotate away.`, "success");
    await addRecent(dataUrl, "Open");
  }

  async function openImage(): Promise<void> {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        title: "Open an image",
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "tif", "tiff"],
          },
        ],
      });
      if (!picked || Array.isArray(picked)) return;
      await loadImagePath(picked);
    } catch (e) {
      setStatus(`Could not open that image: ${errText(e)}`, "error");
    }
  }

  /* ------------------------------------------------------- new blank canvas */

  const NEW_PRESETS: ReadonlyArray<{ label: string; w: number; h: number }> = [
    { label: "Default", w: 1280, h: 800 },
    { label: "HD", w: 1280, h: 720 },
    { label: "Full HD", w: 1920, h: 1080 },
    { label: "QHD", w: 2560, h: 1440 },
    { label: "4K UHD", w: 3840, h: 2160 },
    { label: "Square", w: 1080, h: 1080 },
    { label: "Story", w: 1080, h: 1920 },
    { label: "Small", w: 800, h: 600 },
  ];
  const NEW_CANVAS_KEY = "snagcraft.newCanvas";
  const clampDim = (n: number): number => Math.max(16, Math.min(8192, Math.round(n)));

  /** A blank canvas is just a generated PNG — every downstream path (export,
      resize, blur snapshots, crop) keeps working unchanged. */
  function blankCanvasDataUrl(w: number, h: number, bg: "white" | "transparent"): string {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    if (bg === "white") {
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
      }
    }
    return c.toDataURL("image/png");
  }

  /** Replace the document with a blank canvas. Unsaved edits are auto-saved as
      a copy first — the same no-prompt, no-work-loss semantics as browsing Recent. */
  async function newCanvas(w: number, h: number, bg: "white" | "transparent"): Promise<void> {
    w = clampDim(w);
    h = clampDim(h);
    if (hasImage && isDirty()) await saveEdited();
    await editor.load(blankCanvasDataUrl(w, h, bg));
    loadedRecentId = null;
    setImageState(true);
    syncDirty();
    setStatus(`New canvas ${w}×${h} — draw away, or press PrintScreen to capture.`, "success");
  }

  const newModalEl = $<HTMLDivElement>("#new-modal");
  const newPresetsEl = $<HTMLDivElement>("#new-presets");
  const newWEl = $<HTMLInputElement>("#new-w");
  const newHEl = $<HTMLInputElement>("#new-h");
  let newBg: "white" | "transparent" = "white";

  newPresetsEl.innerHTML = NEW_PRESETS.map(
    (p, i) =>
      `<button type="button" class="new-preset" role="radio" aria-checked="false" data-preset="${i}" tabindex="-1"><span class="new-preset-name">${p.label}</span><span class="new-preset-dims">${p.w} × ${p.h}</span></button>`,
  ).join("");

  function readNewPrefs(): { w: number; h: number; bg: "white" | "transparent" } {
    try {
      const raw = localStorage.getItem(NEW_CANVAS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { w?: number; h?: number; bg?: string };
        if (Number.isFinite(p.w) && Number.isFinite(p.h)) {
          return {
            w: clampDim(p.w as number),
            h: clampDim(p.h as number),
            bg: p.bg === "transparent" ? "transparent" : "white",
          };
        }
      }
    } catch {
      /* corrupt prefs — fall back to the default */
    }
    return { w: 1280, h: 800, bg: "white" };
  }

  function syncNewSelection(): void {
    const w = Number(newWEl.value);
    const h = Number(newHEl.value);
    for (const b of newPresetsEl.querySelectorAll<HTMLButtonElement>(".new-preset")) {
      const p = NEW_PRESETS[Number(b.dataset.preset)];
      const hit = p.w === w && p.h === h;
      b.classList.toggle("is-active", hit);
      b.setAttribute("aria-checked", String(hit));
      b.tabIndex = hit ? 0 : -1;
    }
    for (const b of newModalEl.querySelectorAll<HTMLButtonElement>("[data-bg]")) {
      const hit = b.dataset.bg === newBg;
      b.classList.toggle("is-active", hit);
      b.setAttribute("aria-checked", String(hit));
      b.tabIndex = hit ? 0 : -1;
    }
  }

  const openNewCanvas = (): void => {
    if (!newModalEl.hidden) return;
    const prefs = readNewPrefs();
    newWEl.value = String(prefs.w);
    newHEl.value = String(prefs.h);
    newBg = prefs.bg;
    syncNewSelection();
    newModalEl.hidden = false;
    void newModalEl.offsetWidth;
    newModalEl.classList.add("is-open");
    newWEl.focus({ preventScroll: true });
    newWEl.select();
  };
  const closeNewCanvas = (): void => {
    if (newModalEl.hidden) return;
    newModalEl.classList.remove("is-open");
    newModalEl.hidden = true;
    fileBtn.focus({ preventScroll: true });
  };
  const createFromModal = (): void => {
    const w = clampDim(Number(newWEl.value) || 1280);
    const h = clampDim(Number(newHEl.value) || 800);
    try {
      localStorage.setItem(NEW_CANVAS_KEY, JSON.stringify({ w, h, bg: newBg }));
    } catch {
      /* storage unavailable — the canvas still gets created */
    }
    closeNewCanvas();
    void newCanvas(w, h, newBg);
  };

  $<HTMLButtonElement>("#new-create").addEventListener("click", createFromModal);
  $<HTMLButtonElement>("#new-cancel").addEventListener("click", closeNewCanvas);
  $<HTMLButtonElement>("#new-close").addEventListener("click", closeNewCanvas);
  newModalEl.addEventListener("pointerdown", (ev) => {
    if (ev.target === newModalEl) closeNewCanvas();
  });
  newPresetsEl.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>(".new-preset");
    if (!b) return;
    const p = NEW_PRESETS[Number(b.dataset.preset)];
    newWEl.value = String(p.w);
    newHEl.value = String(p.h);
    syncNewSelection();
  });
  newWEl.addEventListener("input", syncNewSelection);
  newHEl.addEventListener("input", syncNewSelection);
  for (const b of newModalEl.querySelectorAll<HTMLButtonElement>("[data-bg]")) {
    b.addEventListener("click", () => {
      newBg = b.dataset.bg === "transparent" ? "transparent" : "white";
      syncNewSelection();
    });
  }
  newModalEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.target === newWEl || ev.target === newHEl)) {
      ev.preventDefault();
      createFromModal();
    }
  });

  document.addEventListener("paste", (ev) => {
    const items = ev.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          ev.preventDefault();
          loadImageFile(file);
        }
        return;
      }
    }
  });

  window.addEventListener("dragover", (ev) => {
    if (ev.dataTransfer?.types.includes("Files")) ev.preventDefault();
  });
  window.addEventListener("drop", (ev) => {
    const file = ev.dataTransfer?.files?.[0];
    if (file?.type.startsWith("image/")) {
      ev.preventDefault();
      loadImageFile(file);
    }
  });

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" && !aboutModalEl.hidden) {
      ev.preventDefault();
      closeAbout();
      return;
    }
    if (ev.key === "Escape" && !newModalEl.hidden) {
      ev.preventDefault();
      closeNewCanvas();
      return;
    }
    if (ev.key === "Escape" && !resizePop.hidden) {
      ev.preventDefault();
      closeResize();
      return;
    }
    if (ev.key === "Escape" && !shortcutsModalEl.hidden) {
      ev.preventDefault();
      closeShortcuts();
      return;
    }
    if (playerIsOpen() && handlePlayerKeys(ev)) return;
    if (ev.code === "PrintScreen" || ev.key === "PrintScreen") {
      ev.preventDefault();
      void runCapture(ev.shiftKey ? "region" : "full");
      return;
    }
    {
      const field = ev.target as HTMLElement | null;
      const typingNow =
        !!field && (field.tagName === "INPUT" || field.tagName === "TEXTAREA" || field.isContentEditable);
      if (
        (ev.key === "?" || (ev.key === "/" && ev.shiftKey)) &&
        !typingNow &&
        !(ev.ctrlKey || ev.metaKey || ev.altKey) &&
        shortcutsModalEl.hidden
      ) {
        ev.preventDefault();
        openShortcuts();
        return;
      }
    }
    const target = ev.target as HTMLElement | null;
    const typing =
      !!target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

    // Bare-letter tool shortcuts (no modifier), routed through selectTool so the
    // toolbar and properties rail follow along.
    if (!typing && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey && ev.key.length === 1) {
      const toolShortcuts: Record<string, ShellToolId> = {
        v: "select",
        c: "crop",
        a: "arrow",
        t: "text",
        r: "shape",
        b: "blur",
        e: "brush",
        g: "bucket",
        l: "spotlight",
        h: "highlighter",
        k: "callout",
        s: "step",
        m: "magnify",
      };
      const tool = toolShortcuts[ev.key.toLowerCase()];
      if (tool) {
        ev.preventDefault();
        void selectTool(tool);
        return;
      }
    }
    if (typing || !(ev.ctrlKey || ev.metaKey) || ev.altKey) return;

    const key = ev.key.toLowerCase();
    if (key === ".") {
      // Ctrl+. ends a running interval capture (the Stop button does the same).
      if (!intervalRun) return;
      ev.preventDefault();
      intervalRun.stop = true;
      setStatus("Stopping interval capture…");
      return;
    }
    if (key === ",") {
      ev.preventDefault();
      panel?.open();
      return;
    }
    if (key === "z") {
      ev.preventDefault();
      if (ev.shiftKey) editor.redo();
      else editor.undo();
      syncHistory();
    } else if (key === "y") {
      ev.preventDefault();
      editor.redo();
      syncHistory();
    } else if (key === "c") {
      ev.preventDefault();
      void copyPng();
    } else if (key === "s") {
      ev.preventDefault();
      if (ev.shiftKey) void saveAs();
      else void saveEdited();
    } else if (key === "o") {
      ev.preventDefault();
      void openImage();
    } else if (key === "n") {
      ev.preventDefault();
      openNewCanvas();
    }
  };
  window.addEventListener("keydown", onKeyDown);

  /* ------------------------------------------------------------- tauri glue */

  // Rust asks us to run a capture (tray menu item, future global hotkey).
  void listen("tray-capture", () => {
    void runCapture();
  }).catch(() => {
    /* plain browser or an older backend without the tray */
  });

  // OS integration: `snagcraft --capture` / `--region` from a panel companion
  // or terminal, forwarded by the single-instance plugin.
  void listen<{ mode?: string }>("cli-capture", (ev) => {
    void runCapture(ev.payload?.mode === "region" ? "region" : "full");
  }).catch(() => {
    /* plain browser */
  });

  // An image opened via file association ("Open with SnagCraft").
  void listen<{ path?: string }>("cli-open", (ev) => {
    const path = ev.payload?.path;
    if (path) {
      void loadImagePath(path).catch((e) =>
        setStatus(`Could not open that image: ${errText(e)}`, "error"),
      );
    }
  }).catch(() => {
    /* plain browser */
  });

  // First launch: did the OS ask for a capture or an image? Poll once the
  // listeners above are registered (later launches arrive as events).
  void invoke<{ capture?: string; file?: string }>("launch_request")
    .then((req) => {
      if (req.capture) void runCapture(req.capture === "region" ? "region" : "full");
      else if (req.file) {
        void loadImagePath(req.file).catch((e) =>
          setStatus(`Could not open that image: ${errText(e)}`, "error"),
        );
      }
    })
    .catch(() => {
      /* plain browser or an older backend */
    });

  // A registered global shortcut fired (Wayland GlobalShortcuts portal).
  void listen<{ id?: string }>("hotkey-activated", (ev) => {
    const id = ev.payload?.id;
    if (id === "capture-full") void runCapture("full");
    else if (id === "capture-region") void runCapture("region");
  }).catch(() => {
    /* no hotkey backend in this build */
  });

  // The floating widget asked for a capture of its own.
  void listen<{ mode?: string }>("widget-capture", (ev) => {
    const raw = ev.payload?.mode;
    const requested: CaptureMode =
      raw === "region" || raw === "window" || raw === "monitor" ? raw : "full";
    void runCapture(requested);
  }).catch(() => {
    /* widget window absent */
  });

  // The widget's red Rec button: start a full-screen recording (the widget
  // hides itself so it never lands in the video). Its Stop button (shown when
  // the widget is opened mid-take) ends the take.
  void listen("widget-record", () => {
    void startRecording("full");
  }).catch(() => {
    /* widget window absent */
  });
  void listen("widget-stop-record", () => {
    void stopRecording();
  }).catch(() => {
    /* widget window absent */
  });

  // Live progress for a manual-scroll stitch (frames accepted, stitched height,
  // match confidence and any "too fast" warning). No cast running → dropped.
  void listen<ScrollingStatus>("scrolling-status", (ev) => {
    const payload = ev.payload;
    if (!payload || typeof payload !== "object") return;
    scrollFeed?.(payload);
  }).catch(() => {
    /* backend without the scrolling module */
  });

  // Recording state is authoritative on the Rust side (stop button, hotkey,
  // screen-picker cancel) — mirror it instead of trusting our own click only.
  void listen<{ recording?: boolean; path?: string | null }>("recording-state", (ev) => {
    const live = ev.payload?.recording === true;
    const path = typeof ev.payload?.path === "string" ? ev.payload.path.trim() : "";
    if (live && !recording) {
      beginRecording();
      setStatus("Recording — click Stop when you're done.", "recording");
    } else if (!live && recording && !recStopping) {
      endRecording();
      if (path) {
        setStatus(`Recording saved: ${path}`, "success");
        void addRecentRecording(path, recRegionUsed ? "Region recording" : "Recording");
      } else {
        setStatus("Recording stopped.");
      }
    }
  }).catch(() => {
    /* older backend without the recorder */
  });

  // Rust intercepts the close while the canvas is dirty and asks us to guard it.
  void listen("close-requested", () => {
    syncDirty();
    showGuard();
  }).catch(() => {
    /* no close guard outside the Tauri window */
  });

  // Keep the Rust-side tray preference mirrored with our stored value.
  void invoke("set_minimize_to_tray", { enabled: settings.minimizeToTray }).catch(() => {
    /* command missing on older builds — the toggle reports that itself */
  });

  const onUnload = (): void => {
    window.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("pointerdown", onDocPointerDown);
    document.removeEventListener("pointerdown", onResizeOutside);
    panel?.close();
    editor.destroy();
  };
  window.addEventListener("beforeunload", onUnload, { once: true });

  /* ------------------------------------------------------------------ init */

  // Shadow first: every setter below notifies snagcraft:change, whose
  // syncShadowFromEditor() would otherwise adopt the editor's default shadow
  // and quietly wipe what the rail remembered from last session.
  try {
    shadowApi.setShadow?.(shadow);
  } catch {
    /* older editor without the shadow setter — the rail still remembers it */
  }
  syncShadowFromEditor();
  paintShadow();

  selectTool("select", false);
  setImageState(false);
  // Start on a white canvas so drawing works immediately — never edit "on nothing".
  void newCanvas(1280, 800, "white");
  setMode(mode, false);
  setRecMode(recMode, false);
  setTheme(theme, false);

  const savedInk = readColor();
  const savedStroke = readStroke();
  try {
    applyColor(savedInk, false);
    applyStroke(savedStroke, false);
  } catch {
    highlightColor(savedInk);
    highlightStroke(savedStroke);
    customColorEl.value = savedInk;
  }

  applyFont(fontFamily, false);
  applySize(fontSize, false);
  applyBold(textBold, false);
  applyItalic(textItalic, false);
  syncTextFromEditor();

  applyBlurMode(blurMode, false);
  applyBlurRadius(blurRadius, false);
  syncBlurFromEditor();

  renderPresets();
  wirePlayer();
  renderFilm();
  ocrLangSelect.value = ocrLang;

  setStatus("Ready — press PrintScreen for the full screen, Shift+PrintScreen for a region.");

  // Adopt a recording that was already running (window reload, external start).
  void invoke<boolean>("is_recording")
    .then((live) => {
      if (!live || recording) return;
      recStartedAt = Date.now();
      beginRecording();
      setStatus("Recording — click Stop when you're done.", "recording");
    })
    .catch(() => {
      /* no recorder in this build */
    });

  // Restore the hotkey bindings and floating widget from last session.
  void (async () => {
    try {
      hotkeyStatus = normalizeStatus(await invoke<unknown>("get_hotkey_status"));
    } catch {
      hotkeyStatus = null;
    }
    // Enables + binds when hotkeys are on; unbinds anything a previous session
    // left bound when they are off.
    await applyHotkeys(false);
    paintHotkeyHint();
    panel?.refresh();

    if (settings.widget) {
      try {
        await invoke("open_widget");
        widgetVisible = true;
      } catch {
        widgetVisible = false;
        settings = { ...settings, widget: false };
        saveExportSettings(settings);
        panel?.refresh();
      }
    }
  })();

  void (async () => {
    try {
      const version = await invoke<string>("get_version");
      appVersion = version ? (version.startsWith("v") ? version : `v${version}`) : "";
      const aboutVersion = document.getElementById("about-version");
      if (aboutVersion) aboutVersion.textContent = appVersion || "unknown";
      const aboutMenuVersion = document.getElementById("about-menu-version");
      if (aboutMenuVersion) aboutMenuVersion.textContent = appVersion || "";
      panel?.refresh();
    } catch {
      appVersion = "";
    }
    applyWatermark();
    await ensureSaveDir();
    void refreshRecentFromFolder();
    // Whether this install can replace itself (AppImage) or must point at the
    // release page (.deb). Read once, before any dialog can open.
    canInstallUpdate = await invoke<boolean>("update_can_install").catch(() => false);
    // Quiet, once a day at most: leaves a marker in the File menu, never a modal.
    maybeCheckForUpdates();
  })();
}