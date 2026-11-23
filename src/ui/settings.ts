// SnagCraft — theme tokens, export settings and the settings modal.
//
// The app shell owns the live state (save folder, version, theme, export
// defaults); this module owns applying the theme to <html>, the persistence
// helpers for the export/general preferences, and a self-contained, accessible
// settings dialog. No Tauri imports: the shell passes its callbacks in, so the
// panel stays testable in a plain browser.

export type Theme = "light" | "dark";
export type ExportFormat = "png" | "jpeg" | "webp";
/** Container the screen recorder writes. */
export type RecFormat = "mp4" | "gif";

export const THEME_KEY = "snagcraft:theme";

/** Stored theme, defaulting to light (rostad's default, spec Wave 4). */
export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Apply a theme to the document root; persists unless told otherwise. */
export function applyTheme(theme: Theme, persist = true): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  if (!persist) return;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable — the theme just isn't remembered */
  }
}

/* ---------------------------------------------------------------- settings */

export const FORMAT_KEY = "snagcraft:format";
export const QUALITY_KEY = "snagcraft:quality";
export const TIMER_KEY = "snagcraft:timer";
export const FILENAME_KEY = "snagcraft:filename";
export const TRAY_KEY = "snagcraft:minimize-tray";
export const HOTKEYS_ENABLED_KEY = "snagcraft:hotkeys-enabled";
export const HOTKEY_FULL_KEY = "snagcraft:hotkey-full";
export const HOTKEY_REGION_KEY = "snagcraft:hotkey-region";
export const WIDGET_KEY = "snagcraft:widget";
export const REC_FORMAT_KEY = "snagcraft:rec-format";
export const AUTOSAVE_KEY = "snagcraft:autosave";
export const INTERVAL_KEY = "snagcraft:interval";
export const MIC_KEY = "snagcraft:mic";
export const SYSTEM_AUDIO_KEY = "snagcraft:system-audio";
export const WATERMARK_TEXT_KEY = "snagcraft:watermark-text";
export const WATERMARK_OPACITY_KEY = "snagcraft:watermark-opacity";
export const WATERMARK_CORNER_KEY = "snagcraft:watermark-corner";
export const UPLOAD_ENDPOINT_KEY = "snagcraft:upload-endpoint";
export const SPLIT_FOLDERS_KEY = "snagcraft:split-folders";
export const REC_DIR_KEY = "snagcraft:rec-dir";
export const UPDATES_KEY = "snagcraft:check-updates";
/** When the app last asked GitHub for a newer release (ms since epoch). */
export const LAST_UPDATE_CHECK_KEY = "snagcraft:last-update-check";
/** A version the user told us to stop mentioning. */
export const SKIPPED_VERSION_KEY = "snagcraft:skipped-version";

export const DEFAULT_FORMAT: ExportFormat = "png";
export const DEFAULT_REC_FORMAT: RecFormat = "mp4";
export const DEFAULT_QUALITY = 90;
export const DEFAULT_TIMER = 0;
export const DEFAULT_PATTERN = "SnagCraft-{date}-{time}";
export const DEFAULT_HOTKEY_FULL = "Print";
export const DEFAULT_HOTKEY_REGION = "SHIFT+Print";
/** Delay between shots in Interval capture mode. */
export const DEFAULT_INTERVAL = 30;
/** Microphone captured with a take; empty means no microphone. */
export const DEFAULT_MIC = "";
/** Whether the desktop's own sound is mixed into a take. */
export const DEFAULT_SYSTEM_AUDIO = false;
/** Minimum time between automatic checks — one request a day. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Text burned into exports; empty means no watermark. */
export const DEFAULT_WATERMARK_TEXT = "";
/** Watermark visibility, in percent. */
export const DEFAULT_WATERMARK_OPACITY = 45;
/** Corner the watermark sits in. */
export const DEFAULT_WATERMARK_CORNER = "bottom-right";
/** Recordings share the screenshot folder until the user opts out. */
export const DEFAULT_SPLIT_FOLDERS = false;
/** Empty means "follow the save folder". */
export const DEFAULT_REC_DIR = "";
export const WATERMARK_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
/** Delays offered in Settings → Capture. */
export const TIMER_CHOICES: ReadonlyArray<number> = [0, 3, 5, 10];
/** Shot intervals offered in Settings → Capture → Interval capture. */
export const INTERVAL_CHOICES: ReadonlyArray<number> = [5, 10, 30, 60, 300];

/** Action ids shared with the Rust hotkey backend. */
export type HotkeyId = "capture-full" | "capture-region";

/** Which global-shortcut backend is actually live on this desktop. */
export type HotkeyBackend = "portal" | "native" | "none";

export interface GrantedHotkey {
  id: string;
  trigger: string;
}

export interface HotkeyStatus {
  backend: HotkeyBackend;
  granted: GrantedHotkey[];
}

/**
 * State of the "default screenshot tool" takeover (Linux Cinnamon/GNOME):
 * the desktop's own Print/Shift+Print bindings cleared and replaced with
 * custom shortcuts that launch SnagCraft. See src-tauri/src/default_tool.rs.
 */
export interface DefaultToolStatus {
  /** False on unsupported desktops / non-Linux — the card stays hidden. */
  supported: boolean;
  /** "Cinnamon" / "GNOME" when supported. */
  desktop: string;
  /** Our shortcuts are live and the built-in bindings are cleared. */
  isDefault: boolean;
  /** A backup of the previous system bindings exists. */
  canRestore: boolean;
  /** The command the desktop shortcuts run (AppImage-aware). */
  command: string;
  /** Honest reason when unsupported; empty otherwise. */
  detail: string;
}

export interface ExportSettings {
  format: ExportFormat;
  quality: number;
  /** Delayed-capture countdown in seconds; 0 captures immediately. */
  timer: number;
  /** Filename pattern with {date}/{time}/{datetime} tokens. */
  filename: string;
  minimizeToTray: boolean;
  /** Master switch for global hotkeys (auto-registered on startup). */
  hotkeysEnabled: boolean;
  /** Trigger string for full-screen capture, e.g. 'Print'. */
  hotkeyFull: string;
  /** Trigger string for region capture, e.g. 'SHIFT+Print'. */
  hotkeyRegion: string;
  /** Whether the floating capture widget was left open. */
  widget: boolean;
  /** Screen-recording container (MP4 or GIF). */
  recFormat: RecFormat;
  /** Write every fresh capture to the save folder without asking. */
  autoSave: boolean;
  /** Seconds between shots in Interval capture mode. */
  intervalSeconds: number;
  /** Microphone device id for recordings; empty is no microphone. */
  mic: string;
  /** Mix the desktop's own sound into recordings. */
  systemAudio: boolean;
  /** Text burned into exports; empty disables the watermark. */
  watermarkText: string;
  /** 2–100 % visibility of that text. */
  watermarkOpacity: number;
  /** Which corner it sits in. */
  watermarkCorner: string;
  /** POST target for File → Upload…; empty hides the action. */
  uploadEndpoint: string;
  /** Give recordings their own folder instead of sharing the save folder. */
  splitFolders: boolean;
  /** Recording folder when split; empty follows the save folder. */
  recDir: string;
  /** Ask GitHub once a day whether a newer release exists. */
  checkUpdates: boolean;
}

/**
 * The app was renamed from Capicorn. Copy any surviving `capicorn:*` preference
 * to its `snagcraft:*` twin once, so the rename doesn't reset the user's setup.
 */
const migrateLegacyStorage = (): void => {
  try {
    const legacy: Array<[string, string]> = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith("capicorn:")) continue;
      const value = localStorage.getItem(key);
      if (value !== null) legacy.push([key, value]);
    }
    for (const [key, value] of legacy) {
      const target = `snagcraft:${key.slice("capicorn:".length)}`;
      if (localStorage.getItem(target) === null) localStorage.setItem(target, value);
    }
  } catch {
    /* storage unavailable — defaults apply */
  }
};
migrateLegacyStorage();

const store = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const clampInt = (raw: string | null, fallback: number, min: number, max: number): number => {
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
};

export const isExportFormat = (value: string): value is ExportFormat =>
  value === "png" || value === "jpeg" || value === "webp";

export const isRecFormat = (value: string): value is RecFormat =>
  value === "mp4" || value === "gif";

/** Human label for a recording container. */
export const recFormatLabel = (format: RecFormat): string =>
  format === "gif" ? "GIF" : "MP4";

/**
 * Tidy a user-typed trigger: collapse whitespace, uppercase the modifiers and
 * join on '+'. Returns the fallback when nothing usable is left, so a cleared
 * field never becomes a shortcut that binds "everything".
 */
export function normalizeTrigger(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/\s*\+\s*/g, "+")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  if (cleaned === "" || cleaned === "+") return fallback;
  const parts = cleaned.split("+").filter((part) => part !== "");
  return parts.length ? parts.join("+") : fallback;
}

/** Trigger split into key caps for the settings preview ('CTRL+SHIFT+P'). */
export function triggerCaps(trigger: string): string[] {
  const parts = trigger.split("+").filter(Boolean);
  return parts.length ? parts : [trigger];
}

/** Stored export preferences, each field falling back to its default. */
export function readExportSettings(): ExportSettings {
  const rawFormat = store(FORMAT_KEY) ?? "";
  const rawTimer = clampInt(store(TIMER_KEY), DEFAULT_TIMER, 0, 60);
  const rawPattern = store(FILENAME_KEY);
  const rawRec = store(REC_FORMAT_KEY) ?? "";
  const rawInterval = clampInt(store(INTERVAL_KEY), DEFAULT_INTERVAL, 1, 3600);
  return {
    format: isExportFormat(rawFormat) ? rawFormat : DEFAULT_FORMAT,
    quality: clampInt(store(QUALITY_KEY), DEFAULT_QUALITY, 1, 100),
    // Only the offered delays (plus a stored custom value) are honoured.
    timer: TIMER_CHOICES.includes(rawTimer) ? rawTimer : DEFAULT_TIMER,
    filename:
      rawPattern !== null && rawPattern.trim() !== "" ? rawPattern : DEFAULT_PATTERN,
    minimizeToTray: store(TRAY_KEY) === "true",
    hotkeysEnabled: store(HOTKEYS_ENABLED_KEY) === "true",
    hotkeyFull: normalizeTrigger(store(HOTKEY_FULL_KEY) ?? "", DEFAULT_HOTKEY_FULL),
    hotkeyRegion: normalizeTrigger(store(HOTKEY_REGION_KEY) ?? "", DEFAULT_HOTKEY_REGION),
    widget: store(WIDGET_KEY) === "true",
    recFormat: isRecFormat(rawRec) ? rawRec : DEFAULT_REC_FORMAT,
    // On unless explicitly turned off (Wave 11 default).
    autoSave: store(AUTOSAVE_KEY) !== "false",
    // Same rule as the capture delay: only an offered interval is honoured.
    intervalSeconds: INTERVAL_CHOICES.includes(rawInterval) ? rawInterval : DEFAULT_INTERVAL,
    mic: (store(MIC_KEY) ?? DEFAULT_MIC).trim(),
    systemAudio: store(SYSTEM_AUDIO_KEY) === "true",
    watermarkText: (store(WATERMARK_TEXT_KEY) ?? DEFAULT_WATERMARK_TEXT).slice(0, 120),
    watermarkOpacity: clampInt(store(WATERMARK_OPACITY_KEY), DEFAULT_WATERMARK_OPACITY, 2, 100),
    watermarkCorner: (WATERMARK_CORNERS as ReadonlyArray<string>).includes(
      store(WATERMARK_CORNER_KEY) ?? "",
    )
      ? (store(WATERMARK_CORNER_KEY) as string)
      : DEFAULT_WATERMARK_CORNER,
    uploadEndpoint: (store(UPLOAD_ENDPOINT_KEY) ?? "").trim(),
    splitFolders: store(SPLIT_FOLDERS_KEY) === "true",
    recDir: (store(REC_DIR_KEY) ?? DEFAULT_REC_DIR).trim(),
    // On unless explicitly turned off — the check is one request a day and the
    // answer is only ever a quiet notice.
    checkUpdates: store(UPDATES_KEY) !== "false",
  };
}

/** Persist the whole export-preference block in one pass. */
export function saveExportSettings(settings: ExportSettings): void {
  try {
    localStorage.setItem(FORMAT_KEY, settings.format);
    localStorage.setItem(QUALITY_KEY, String(settings.quality));
    localStorage.setItem(TIMER_KEY, String(settings.timer));
    localStorage.setItem(FILENAME_KEY, settings.filename);
    localStorage.setItem(TRAY_KEY, String(settings.minimizeToTray));
    localStorage.setItem(HOTKEYS_ENABLED_KEY, String(settings.hotkeysEnabled));
    localStorage.setItem(HOTKEY_FULL_KEY, settings.hotkeyFull);
    localStorage.setItem(HOTKEY_REGION_KEY, settings.hotkeyRegion);
    localStorage.setItem(WIDGET_KEY, String(settings.widget));
    localStorage.setItem(REC_FORMAT_KEY, settings.recFormat);
    localStorage.setItem(AUTOSAVE_KEY, String(settings.autoSave));
    localStorage.setItem(INTERVAL_KEY, String(settings.intervalSeconds));
    localStorage.setItem(MIC_KEY, settings.mic);
    localStorage.setItem(SYSTEM_AUDIO_KEY, String(settings.systemAudio));
    localStorage.setItem(WATERMARK_TEXT_KEY, settings.watermarkText);
    localStorage.setItem(WATERMARK_OPACITY_KEY, String(settings.watermarkOpacity));
    localStorage.setItem(WATERMARK_CORNER_KEY, settings.watermarkCorner);
    localStorage.setItem(UPLOAD_ENDPOINT_KEY, settings.uploadEndpoint);
    localStorage.setItem(SPLIT_FOLDERS_KEY, String(settings.splitFolders));
    localStorage.setItem(REC_DIR_KEY, settings.recDir);
    localStorage.setItem(UPDATES_KEY, String(settings.checkUpdates));
  } catch {
    /* storage unavailable — the preferences just aren't remembered */
  }
}

/** File extension used on disk for a format ('jpeg' writes .jpg). */
export function formatExtension(format: ExportFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

/** Human label used in status messages and the settings select. */
export function formatLabel(format: ExportFormat): string {
  return format === "jpeg" ? "JPEG" : format === "webp" ? "WebP" : "PNG";
}

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Expand the filename pattern: {date} → 2026-11-14, {time} → 19-45-12,
 * {datetime} → 2026-11-14-19-45-12. Unknown tokens are left alone so a typo
 * never silently disappears, and path separators are stripped so the file
 * always lands in the chosen folder.
 */
export function expandPattern(pattern: string, date = new Date()): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const clock = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  const expanded = (pattern.trim() === "" ? DEFAULT_PATTERN : pattern)
    .replace(/\{date\}/gi, day)
    .replace(/\{time\}/gi, clock)
    .replace(/\{datetime\}/gi, `${day}-${clock}`)
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return expanded === "" ? `SnagCraft-${day}-${clock}` : expanded;
}

/** Full filename for a capture, extension included. */
export function buildFilename(
  pattern: string,
  format: ExportFormat,
  date = new Date(),
  suffix = "",
): string {
  return `${expandPattern(pattern, date)}${suffix}.${formatExtension(format)}`;
}

export interface SettingsOptions {
  /** Current save folder, or null while it is still unresolved. */
  getSaveDir(): string | null;
  /** Open the native folder picker; resolves to the new folder (or null). */
  changeSaveDir(): Promise<string | null>;
  /** Put the save folder back to the OS default; resolves to the folder (or null). */
  resetSaveDir(): Promise<string | null>;
  /** Recording folder, or null when it follows the save folder. */
  getRecDir(): string | null;
  /** Pick a recording folder; resolves to the new folder (or null). */
  changeRecDir(): Promise<string | null>;
  /** Make recordings follow the save folder again. */
  resetRecDir(): Promise<string | null>;
  /** Version string for the footer, when the shell has one. */
  getVersion(): string | null;
  /** Called when the user picks a theme inside the panel. */
  setTheme(theme: Theme): void;
  /** Live export/general preferences. */
  getSettings(): ExportSettings;
  /**
   * Persist + apply a change. `silent` is for continuous controls (slider
   * drags, filename typing) that must not spam the status bar.
   */
  updateSettings(patch: Partial<ExportSettings>, opts?: { silent?: boolean }): void;
  /** Bind (or re-bind) the configured global shortcuts; null when it failed. */
  registerHotkeys(): Promise<HotkeyStatus | null>;
  /** Last status the shell knows about, painted whenever the panel opens. */
  getHotkeyStatus(): HotkeyStatus | null;
  /** Copy recording diagnostics (portal + per-take logs) to the clipboard. */
  copyDiagnostics?(): Promise<void>;
  /** Microphone devices the backend can record from (Tauri stays in the shell). */
  listAudioSources?(): Promise<AudioSource[]>;
  /** Launch-at-login state, read from the OS (Tauri stays in the shell). */
  getAutostart?(): Promise<boolean>;
  /** Register / unregister SnagCraft as a login item. */
  setAutostart?(enabled: boolean): Promise<void>;
  /** Default-screenshot-tool state (Linux Cinnamon/GNOME; Tauri in the shell). */
  getDefaultToolStatus?(): Promise<DefaultToolStatus>;
  /** Take over Print/Shift+Print after explicit confirmation; returns state. */
  setDefaultTool?(): Promise<DefaultToolStatus>;
  /** Put the desktop's previous screenshot bindings back; returns state. */
  restoreDefaultTool?(): Promise<DefaultToolStatus>;
  /** Ask GitHub for the newest release; resolves to a one-line summary. */
  checkForUpdates?(): Promise<string>;
}

/** One microphone the recorder can capture. */
export interface AudioSource {
  id: string;
  name: string;
}

const icon = (body: string, size = 16): string =>
  `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  sun: icon(
    `<circle cx="8" cy="8" r="2.9"/><path d="M8 1.7v1.6M8 12.7v1.6M1.7 8h1.6M12.7 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1"/>`,
    14,
  ),
  moon: icon(`<path d="M13.1 9.7A5.5 5.5 0 0 1 6.3 2.9a5.6 5.6 0 1 0 6.8 6.8z"/>`, 14),
  close: icon(`<path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/>`, 14),
  caret: icon(`<path d="M4.6 6.4 8 9.8l3.4-3.4"/>`, 12),
  check: icon(`<path d="M3 8.6 6.4 12l6.6-7.6" stroke-width="2.1"/>`, 12),
  folder: icon(
    `<path d="M2.3 5.4A1.5 1.5 0 0 1 3.8 3.9h2.1l1.3 1.6h5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5H3.8a1.5 1.5 0 0 1-1.5-1.5z"/>`,
    14,
  ),
  keyboard: icon(
    `<rect x="1.6" y="4.4" width="12.8" height="7.2" rx="1.4"/><path d="M4.2 6.6h.01M6.6 6.6h.01M9 6.6h.01M11.4 6.6h.01M4.2 9.4h7.6"/>`,
    14,
  ),
  widget: icon(
    `<rect x="2.4" y="2.4" width="5.4" height="5.4" rx="1.3"/><rect x="8.2" y="2.4" width="5.4" height="5.4" rx="1.3"/><rect x="2.4" y="8.2" width="5.4" height="5.4" rx="1.3"/><path d="M12.6 9.2v3.6M10.8 11h3.6"/>`,
    14,
  ),
};

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Escape user-typed text before it lands in innerHTML. */
const esc = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export class SettingsPanel {
  private readonly opts: SettingsOptions;
  private root: HTMLDivElement | null = null;
  private card!: HTMLDivElement;
  private dirPath!: HTMLElement;
  private versionEl!: HTMLElement;
  private segments: HTMLButtonElement[] = [];
  private changeBtn!: HTMLButtonElement;
  private resetBtn!: HTMLButtonElement;
  private timerPills: HTMLButtonElement[] = [];
  private intervalSelect!: HTMLSelectElement;
  private formatSelect!: HTMLSelectElement;
  private recFormatSelect!: HTMLSelectElement;
  private micSelect!: HTMLSelectElement;
  private micNote!: HTMLElement;
  private systemSwitch!: HTMLButtonElement;
  private watermarkInput!: HTMLInputElement;
  private watermarkStyleField!: HTMLElement;
  private watermarkOpacityInput!: HTMLInputElement;
  private watermarkOpacityOut!: HTMLOutputElement;
  private watermarkCornerSelect!: HTMLSelectElement;
  private uploadInput!: HTMLInputElement;
  private splitSwitch!: HTMLButtonElement;
  private recRow!: HTMLElement;
  private recActions!: HTMLElement;
  private recDirEl!: HTMLElement;
  private recChangeBtn!: HTMLButtonElement;
  private recResetBtn!: HTMLButtonElement;
  private qualityField!: HTMLElement;
  private qualityInput!: HTMLInputElement;
  private qualityOut!: HTMLOutputElement;
  private nameInput!: HTMLInputElement;
  private namePreview!: HTMLElement;
  private traySwitch!: HTMLButtonElement;
  private widgetSwitch!: HTMLButtonElement;
  private autosaveSwitch!: HTMLButtonElement;
  private updatesSwitch!: HTMLButtonElement;
  private updateActions!: HTMLElement;
  private checkUpdatesBtn!: HTMLButtonElement;
  private updateNote!: HTMLElement;
  private autostartRow!: HTMLElement;
  private autostartSwitch!: HTMLButtonElement;
  private autostartBusy = false;
  private hotkeySwitch!: HTMLButtonElement;
  private hotkeyFullInput!: HTMLInputElement;
  private hotkeyRegionInput!: HTMLInputElement;
  private hotkeyFullPreview!: HTMLElement;
  private hotkeyRegionPreview!: HTMLElement;
  private hotkeyRegisterBtn!: HTMLButtonElement;
  private hotkeyStatusEl!: HTMLElement;
  private defaultToolEl!: HTMLElement;
  private defaultToolDesktopEl!: HTMLElement;
  private defaultToolNoteEl!: HTMLElement;
  private defaultToolApplyBtn!: HTMLButtonElement;
  private defaultToolConfirmBtn!: HTMLButtonElement;
  private defaultToolCancelBtn!: HTMLButtonElement;
  private defaultToolRestoreBtn!: HTMLButtonElement;
  private defaultToolStatus: DefaultToolStatus | null = null;
  private defaultToolMode: "idle" | "confirm" | "busy-apply" | "busy-restore" | "error" = "idle";
  private defaultToolError = "";
  private diagBtn!: HTMLButtonElement;
  private diagFeedback!: HTMLElement;
  private lastFocus: HTMLElement | null = null;
  private picking = false;
  private resetting = false;
  private registering = false;

  constructor(opts: SettingsOptions) {
    this.opts = opts;
  }

  isOpen(): boolean {
    return !!this.root && !this.root.hidden;
  }

  open(): void {
    const root = this.ensure();
    if (!root.hidden) return;
    this.lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Microphones come and go between openings — re-read them each time.
    void this.loadMicSources();
    this.refresh();
    root.hidden = false;
    // Force a style pass so the entrance transition runs from its start state.
    void root.offsetWidth;
    root.classList.add("is-open");
    this.card.focus({ preventScroll: true });
  }

  close(): void {
    const root = this.root;
    if (!root || root.hidden) return;
    root.classList.remove("is-open");
    root.hidden = true;
    this.lastFocus?.focus({ preventScroll: true });
    this.lastFocus = null;
  }

  /** Paint the launch-at-login switch from a known state. */
  private paintAutostart(on: boolean): void {
    this.autostartSwitch.classList.toggle("is-on", on);
    this.autostartSwitch.setAttribute("aria-checked", String(on));
    this.autostartSwitch.title = on
      ? "SnagCraft starts when you log in"
      : "SnagCraft does not start at login";
  }

  /** The OS owns this state, so every refresh asks it instead of guessing. */
  private async refreshAutostart(): Promise<void> {
    const get = this.opts.getAutostart;
    if (!get) return;
    try {
      this.paintAutostart((await get()) === true);
    } catch {
      // Unreadable state must not break the rest of the panel.
    }
  }

  private async toggleAutostart(): Promise<void> {
    const get = this.opts.getAutostart;
    const set = this.opts.setAutostart;
    if (!get || !set || this.autostartBusy) return;
    this.autostartBusy = true;
    const next = this.autostartSwitch.getAttribute("aria-checked") !== "true";
    try {
      await set(next);
      this.paintAutostart(next);
    } catch (err) {
      // Revert and say why — a silent snap-back reads as a broken switch.
      this.paintAutostart(!next);
      this.autostartSwitch.title = `Could not change start-at-login: ${String(err)}`;
    } finally {
      this.autostartBusy = false;
    }
  }

  /** Re-render the whole panel from the shell's live state (idempotent). */
  refresh(theme: Theme = readTheme()): void {
    if (!this.root) return;
    const dir = this.opts.getSaveDir();
    this.dirPath.textContent = dir ?? "Not set yet";
    this.dirPath.title = dir ?? "";
    this.dirPath.classList.toggle("is-empty", !dir);

    // Recording folder: only offered when the user splits the two.
    const settingsNow = this.opts.getSettings();
    const split = settingsNow.splitFolders;
    this.splitSwitch.classList.toggle("is-on", split);
    this.splitSwitch.setAttribute("aria-checked", String(split));
    this.splitSwitch.title = split
      ? "Recordings have their own folder"
      : "Recordings share the save folder";
    this.recRow.hidden = !split;
    this.recActions.hidden = !split;
    const recDir = this.opts.getRecDir();
    this.recDirEl.textContent = recDir ?? "Same as the save folder";
    this.recDirEl.title = recDir ?? "";
    this.recDirEl.classList.toggle("is-empty", !recDir);

    const version = this.opts.getVersion();
    this.versionEl.textContent = version ? `SnagCraft ${version}` : "SnagCraft";

    for (const segment of this.segments) {
      const active = segment.dataset.themeChoice === theme;
      segment.classList.toggle("is-active", active);
      segment.setAttribute("aria-checked", String(active));
      segment.tabIndex = active ? 0 : -1;
    }

    const settings = this.opts.getSettings();

    for (const pill of this.timerPills) {
      const active = Number(pill.dataset.timer) === settings.timer;
      pill.classList.toggle("is-active", active);
      pill.setAttribute("aria-checked", String(active));
      pill.tabIndex = active ? 0 : -1;
    }

    this.formatSelect.value = settings.format;
    this.recFormatSelect.value = settings.recFormat;
    this.intervalSelect.value = String(settings.intervalSeconds);
    this.paintQuality(settings.format, settings.quality);

    // Never fight the caret while the caret sits in the mic select.
    if (document.activeElement !== this.micSelect) {
      this.micSelect.value = settings.mic;
    }
    this.systemSwitch.classList.toggle("is-on", settings.systemAudio);
    this.systemSwitch.setAttribute("aria-checked", String(settings.systemAudio));
    this.systemSwitch.title = settings.systemAudio
      ? "The desktop's own sound is mixed into recordings"
      : "Recordings capture no desktop sound";

    // Watermark: the style controls only matter once there is text.
    if (document.activeElement !== this.watermarkInput) {
      this.watermarkInput.value = settings.watermarkText;
    }
    this.watermarkStyleField.hidden = settings.watermarkText.trim() === "";
    this.watermarkOpacityInput.value = String(settings.watermarkOpacity);
    this.watermarkOpacityOut.textContent = String(settings.watermarkOpacity);
    this.watermarkOpacityInput.style.setProperty("--fill", `${settings.watermarkOpacity}%`);
    this.watermarkCornerSelect.value = settings.watermarkCorner;
    if (document.activeElement !== this.uploadInput) {
      this.uploadInput.value = settings.uploadEndpoint;
    }

    // Never fight the caret while the pattern is being typed.
    if (document.activeElement !== this.nameInput) {
      this.nameInput.value = settings.filename;
    }
    this.paintPreview();

    this.traySwitch.classList.toggle("is-on", settings.minimizeToTray);
    this.traySwitch.setAttribute("aria-checked", String(settings.minimizeToTray));
    this.traySwitch.title = settings.minimizeToTray ? "Minimize to tray is on" : "Minimize to tray is off";

    if (!this.autostartRow.hidden) void this.refreshAutostart();

    this.widgetSwitch.classList.toggle("is-on", settings.widget);
    this.widgetSwitch.setAttribute("aria-checked", String(settings.widget));
    this.widgetSwitch.title = settings.widget ? "Floating widget is showing" : "Floating widget is hidden";

    this.autosaveSwitch.classList.toggle("is-on", settings.autoSave);
    this.autosaveSwitch.setAttribute("aria-checked", String(settings.autoSave));
    this.autosaveSwitch.title = settings.autoSave
      ? "Fresh captures are saved automatically"
      : "Fresh captures stay in the editor until you save them";

    this.updatesSwitch.classList.toggle("is-on", settings.checkUpdates);
    this.updatesSwitch.setAttribute("aria-checked", String(settings.checkUpdates));
    this.updatesSwitch.title = settings.checkUpdates
      ? "SnagCraft asks GitHub once a day for a newer release"
      : "Automatic update checks are off — File → Check for updates… still works";

    this.hotkeySwitch.classList.toggle("is-on", settings.hotkeysEnabled);
    this.hotkeySwitch.setAttribute("aria-checked", String(settings.hotkeysEnabled));
    this.hotkeySwitch.title = settings.hotkeysEnabled ? "Global hotkeys are on" : "Global hotkeys are off";
    this.hotkeyRegisterBtn.disabled = this.registering || !settings.hotkeysEnabled;

    // Never fight the caret while a trigger is being typed.
    if (document.activeElement !== this.hotkeyFullInput) {
      this.hotkeyFullInput.value = settings.hotkeyFull;
    }
    if (document.activeElement !== this.hotkeyRegionInput) {
      this.hotkeyRegionInput.value = settings.hotkeyRegion;
    }
    this.paintCaps(this.hotkeyFullPreview, settings.hotkeyFull);
    this.paintCaps(this.hotkeyRegionPreview, settings.hotkeyRegion);
    this.paintHotkeyStatus(this.opts.getHotkeyStatus());
    // The default-tool card reads the OS each time the panel refreshes —
    // bindings can change outside the app (system settings, another tool).
    void this.refreshDefaultTool();
  }

  /* ------------------------------------------------------------- internals */

  /** Render a trigger as keycaps ('CTRL+SHIFT+P' → Ctrl Shift P). */
  private paintCaps(el: HTMLElement, trigger: string): void {
    el.innerHTML = triggerCaps(trigger)
      .map((cap) => `<kbd>${esc(cap)}</kbd>`)
      .join("")
      .trim();
    el.dataset.trigger = trigger;
  }

  /** Backend badge + which of the two shortcuts the desktop actually granted. */
  private paintHotkeyStatus(status: HotkeyStatus | null): void {
    const settings = this.opts.getSettings();
    const el = this.hotkeyStatusEl;

    if (!settings.hotkeysEnabled) {
      el.dataset.state = "off";
      el.innerHTML = `<p class="hotkey-note">Global hotkeys are off — SnagCraft listens only while its window has focus.</p>`;
      return;
    }
    if (!status) {
      el.dataset.state = "pending";
      el.innerHTML = `<p class="hotkey-note">Not registered yet — press <strong>Register hotkeys</strong> to bind them.</p>`;
      return;
    }

    const portal = status.backend === "portal";
    const native = status.backend === "native";
    el.dataset.state = portal || native ? "ok" : "warn";

    const actions: ReadonlyArray<{ id: HotkeyId; label: string; want: string }> = [
      { id: "capture-full", label: "Capture full screen", want: settings.hotkeyFull },
      { id: "capture-region", label: "Capture region", want: settings.hotkeyRegion },
    ];

    const rows = actions
      .map(({ id, label, want }) => {
        const hit = status.granted.find((g) => g.id === id);
        return `<li class="${hit ? "is-granted" : "is-missing"}">
          <span class="hotkey-state" aria-hidden="true">${hit ? ICONS.check : ICONS.close}</span>
          <span class="hotkey-name">${esc(label)}</span>
          <kbd class="hotkey-key">${esc(hit ? hit.trigger : want)}</kbd>
          <span class="sr-only">${hit ? "granted" : "not granted"}</span>
        </li>`;
      })
      .join("");

    const backendLine = portal
      ? `<span class="hotkey-badge is-ok">Wayland portal</span><span class="hotkey-backend-text">org.freedesktop.portal.GlobalShortcuts — shortcuts stay active while any app is focused.</span>`
      : native
        ? `<span class="hotkey-badge is-ok">System</span><span class="hotkey-backend-text">Native global shortcuts — active while any app is focused.</span>`
        : `<span class="hotkey-badge is-warn">No backend</span><span class="hotkey-backend-text">No global-shortcut service answered on this system.</span>`;

    const advice = portal || native
      ? ""
      : this.defaultToolStatus?.isDefault
        ? `<p class="hotkey-note">PrintScreen is routed to SnagCraft by your desktop's own keyboard shortcuts — manage this under <strong>Default screenshot tool</strong> below.</p>`
        : `<p class="hotkey-note">Global hotkeys need a system service that accepts the binding: on Linux the <strong>Wayland GlobalShortcuts portal</strong> (KDE Plasma provides it; GNOME 46 and older do not), on Windows/macOS the OS hotkey registry (another app may already hold the combo). Without it, keep using PrintScreen inside the window, or add a shortcut in your desktop settings that runs <code>snagcraft --capture</code>.</p>`;

    el.innerHTML = `
      <div class="hotkey-backend">${backendLine}</div>
      <ul class="hotkey-list">${rows}</ul>
      ${advice}`;
  }

  /**
   * Ask the shell for the microphone devices and paint them into the select.
   * Devices come and go, so this runs again every time the panel opens; a
   * backend without `list_audio_sources` simply leaves the None-only list.
   */
  private async loadMicSources(): Promise<void> {
    const list = this.opts.listAudioSources;
    if (!list) {
      this.paintMicSources([], "Microphone selection is not available in this build.");
      return;
    }
    try {
      const raw: unknown = await list();
      const sources: AudioSource[] = [];
      const seen = new Set<string>();
      for (const entry of Array.isArray(raw) ? raw : []) {
        const src = (entry ?? {}) as { id?: unknown; name?: unknown };
        const id = typeof src.id === "string" ? src.id.trim() : "";
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const name = typeof src.name === "string" && src.name.trim() ? src.name.trim() : id;
        sources.push({ id, name });
      }
      this.paintMicSources(sources, "");
    } catch (e) {
      this.paintMicSources(
        [],
        `Could not list microphones: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Rebuild the microphone options, keeping the stored choice selectable. */
  private paintMicSources(sources: ReadonlyArray<AudioSource>, note: string): void {
    const current = this.opts.getSettings().mic;
    const options = [`<option value="">None</option>`].concat(
      sources.map((src) => `<option value="${esc(src.id)}">${esc(src.name)}</option>`),
    );
    // A remembered device that is unplugged right now stays visible, so the
    // panel never silently switches the user to another microphone.
    if (current && !sources.some((src) => src.id === current)) {
      options.push(`<option value="${esc(current)}">${esc(current)} — not connected</option>`);
    }
    this.micSelect.innerHTML = options.join("");
    this.micSelect.value = current;
    this.micNote.textContent =
      note ||
      (sources.length
        ? `${sources.length} microphone${sources.length === 1 ? "" : "s"} found — sound is mixed in beside the video.`
        : "No microphone found — the take records video only.");
  }

  private paintQuality(format: ExportFormat, quality: number): void {
    const lossy = format !== "png";
    this.qualityField.hidden = !lossy;
    this.qualityInput.value = String(quality);
    this.qualityOut.textContent = String(quality);
    this.qualityInput.style.setProperty("--fill", `${((quality - 1) / 99) * 100}%`);
  }

  private paintPreview(): void {
    const settings = this.opts.getSettings();
    const sample = expandPattern(this.nameInput.value || settings.filename);
    this.namePreview.textContent = `${sample}.${formatExtension(settings.format)}`;
    this.namePreview.classList.toggle("is-fallback", this.nameInput.value.trim() === "");
  }

  /** Ask GitHub now (File → Check for updates… does the same); inline feedback. */
  private async checkNow(): Promise<void> {
    if (!this.opts.checkForUpdates) return;
    this.checkUpdatesBtn.disabled = true;
    this.updateNote.textContent = "Checking…";
    try {
      this.updateNote.textContent = await this.opts.checkForUpdates();
    } catch (e) {
      this.updateNote.textContent = `Could not check: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.checkUpdatesBtn.disabled = false;
    }
  }

  /** Copy the recording diagnostics via the shell, with inline feedback. */
  private async copyDiagnostics(): Promise<void> {
    if (!this.opts.copyDiagnostics) {
      this.diagFeedback.textContent = "Not available in this build.";
      return;
    }
    this.diagBtn.disabled = true;
    this.diagFeedback.textContent = "Copying…";
    try {
      await this.opts.copyDiagnostics();
      this.diagFeedback.textContent = "Copied to clipboard ✓";
    } catch (e) {
      this.diagFeedback.textContent = `Could not copy: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.diagBtn.disabled = false;
    }
  }

  private ensure(): HTMLDivElement {
    if (this.root) return this.root;

    const root = document.createElement("div");
    root.className = "modal-backdrop";
    root.hidden = true;
    root.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" aria-describedby="settings-desc" tabindex="-1">
        <header class="modal-head">
          <div class="modal-heading">
            <h2 class="modal-title" id="settings-title">Settings</h2>
            <p class="modal-desc" id="settings-desc">Capture behaviour, where files go, and how they are written.</p>
          </div>
          <button type="button" class="icon-btn modal-x" data-close aria-label="Close settings" title="Close (Esc)">${ICONS.close}</button>
        </header>
        <div class="modal-body">
          <section class="setting" data-section="general">
            <h3 class="setting-title">General</h3>
            <div class="setting-row">
              <div class="setting-row-text">
                <span class="setting-label" id="tray-label">Minimize to tray</span>
                <span class="setting-sub">Closing the window keeps SnagCraft running in the tray.</span>
              </div>
              <button type="button" class="switch" id="settings-tray" role="switch" aria-checked="false" aria-labelledby="tray-label"><span class="switch-knob" aria-hidden="true"></span></button>
            </div>
            <div class="setting-row" id="settings-autostart-row" hidden>
              <div class="setting-row-text">
                <span class="setting-label" id="autostart-label">Start at login</span>
                <span class="setting-sub">Launch SnagCraft automatically when you log in, so capture is always one click away.</span>
              </div>
              <button type="button" class="switch" id="settings-autostart" role="switch" aria-checked="false" aria-labelledby="autostart-label"><span class="switch-knob" aria-hidden="true"></span></button>
            </div>
            <div class="setting-row">
              <div class="setting-row-text">
                <span class="setting-label" id="widget-label">Show floating widget</span>
                <span class="setting-sub">A small always-ready strip for one-click full or region captures.</span>
              </div>
              <button type="button" class="switch" id="settings-widget" role="switch" aria-checked="false" aria-labelledby="widget-label"><span class="switch-knob" aria-hidden="true"></span></button>
            </div>
            <div class="setting-row">
              <div class="setting-row-text">
                <span class="setting-label" id="autosave-label">Auto-save captures</span>
                <span class="setting-sub">Write every fresh capture to the save folder. Off keeps it in the editor until you press Save or Save As.</span>
              </div>
              <button type="button" class="switch" id="settings-autosave" role="switch" aria-checked="true" aria-labelledby="autosave-label"><span class="switch-knob" aria-hidden="true"></span></button>
            </div>
            <div class="setting-row">
              <div class="setting-row-text">
                <span class="setting-label" id="updates-label">Check for updates</span>
                <span class="setting-sub">Ask GitHub once a day whether a newer SnagCraft is out. Nothing is downloaded, and no data about you is sent.</span>
              </div>
              <button type="button" class="switch" id="settings-updates" role="switch" aria-checked="true" aria-labelledby="updates-label"><span class="switch-knob" aria-hidden="true"></span></button>
            </div>
            <div class="dir-actions" id="settings-update-actions" hidden>
              <button type="button" class="btn-secondary" id="settings-check-updates">Check for updates now</button>
              <span class="token-hint" id="settings-update-note" role="status" aria-live="polite"></span>
            </div>
          </section>

          <section class="setting" data-section="capture">
            <h3 class="setting-title">Capture</h3>
            <p class="setting-help">Wait before grabbing the screen, so you can set the shot up first.</p>
            <div class="pills" id="settings-timer" role="radiogroup" aria-label="Capture delay">
              ${TIMER_CHOICES.map(
                (seconds) =>
                  `<button type="button" role="radio" data-timer="${seconds}" aria-checked="${seconds === 0}">${seconds === 0 ? "Off" : `${seconds} s`}</button>`,
              ).join("")}
            </div>
            <div class="field">
              <label class="field-label" for="settings-interval">Interval capture</label>
              <div class="select-wrap">
                <select id="settings-interval" class="field-select">
                  ${INTERVAL_CHOICES.map(
                    (seconds) =>
                      `<option value="${seconds}"${seconds === DEFAULT_INTERVAL ? " selected" : ""}>every ${seconds === 300 ? "5 min" : `${seconds} s`}</option>`,
                  ).join("")}
                </select>
                <span class="select-arrow" aria-hidden="true">${ICONS.caret}</span>
              </div>
              <p class="token-hint">How often Interval capture takes a shot. Capture → Interval starts the loop; Stop ends it.</p>
            </div>
          </section>

          <section class="setting" data-section="recording">
            <h3 class="setting-title">Recording audio</h3>
            <p class="setting-help">What a screen recording picks up. Changes apply to the next take.</p>
            <div class="field">
              <label class="field-label" for="settings-mic">Microphone</label>
              <div class="select-wrap">
                <select id="settings-mic" class="field-select">
                  <option value="">None</option>
                </select>
                <span class="select-arrow" aria-hidden="true">${ICONS.caret}</span>
              </div>
              <p class="token-hint" id="settings-mic-note" role="status" aria-live="polite">Loading microphones…</p>
            </div>
            <div class="setting-row">
              <div class="setting-row-text">
                <span class="setting-label" id="system-audio-label">System audio</span>
                <span class="setting-sub">Mix the desktop's own sound — app audio, videos — into the take.</span>
              </div>
              <button type="button" class="switch" id="settings-system-audio" role="switch" aria-checked="false" aria-labelledby="system-audio-label"><span class="switch-knob" aria-hidden="true"></span></button>
            </div>
          </section>

          <section class="setting" data-section="hotkeys">
            <h3 class="setting-title">Global hotkeys</h3>
            <div class="setting-row">
              <div class="setting-row-text">
                <span class="setting-label" id="hotkeys-label">Enable global hotkeys</span>
                <span class="setting-sub">Capture while another app has focus. Needs the Wayland GlobalShortcuts portal — KDE Plasma provides it; GNOME 46 and older do not.</span>
              </div>
              <button type="button" class="switch" id="settings-hotkeys" role="switch" aria-checked="false" aria-labelledby="hotkeys-label"><span class="switch-knob" aria-hidden="true"></span></button>
            </div>
            <div class="hotkey-rows">
              <label class="hotkey-row" for="hotkey-full">
                <span class="hotkey-row-text">
                  <span class="setting-label">Capture full screen</span>
                  <span class="hotkey-caps" id="hotkey-full-caps" aria-hidden="true"></span>
                </span>
                <input type="text" class="field-input hotkey-input" id="hotkey-full" spellcheck="false" autocomplete="off" placeholder="${DEFAULT_HOTKEY_FULL}" aria-label="Full screen shortcut trigger" />
              </label>
              <label class="hotkey-row" for="hotkey-region">
                <span class="hotkey-row-text">
                  <span class="setting-label">Capture region</span>
                  <span class="hotkey-caps" id="hotkey-region-caps" aria-hidden="true"></span>
                </span>
                <input type="text" class="field-input hotkey-input" id="hotkey-region" spellcheck="false" autocomplete="off" placeholder="${DEFAULT_HOTKEY_REGION}" aria-label="Region capture shortcut trigger" />
              </label>
            </div>
            <div class="hotkey-actions">
              <button type="button" class="btn-secondary" id="settings-register-hotkeys">Register hotkeys</button>
              <span class="hotkey-format-hint">Format: <code>Print</code>, <code>SHIFT+Print</code>, <code>CTRL+SHIFT+P</code></span>
            </div>
            <div class="hotkey-status" id="settings-hotkey-status" data-state="off" role="status" aria-live="polite"></div>
            <div class="default-tool" id="settings-default-tool" data-state="idle" hidden>
              <div class="default-tool-head">
                <span class="setting-label">Default screenshot tool</span>
                <span class="default-tool-desktop" id="settings-default-tool-desktop"></span>
              </div>
              <p class="default-tool-note" id="settings-default-tool-note" role="status" aria-live="polite"></p>
              <div class="default-tool-actions">
                <button type="button" class="btn-secondary" id="settings-default-tool-apply">Make SnagCraft the default…</button>
                <button type="button" class="btn-primary" id="settings-default-tool-confirm" hidden>Change keyboard settings</button>
                <button type="button" class="btn-secondary" id="settings-default-tool-cancel" hidden>Cancel</button>
                <button type="button" class="btn-secondary" id="settings-default-tool-restore" hidden>Restore system shortcuts</button>
              </div>
            </div>
          </section>

          <section class="setting" data-section="save">
            <h3 class="setting-title">Save location</h3>
            <p class="setting-help">Every capture is written here. Edited copies join it in the same folder.</p>
            <div class="dir-row">
              <span class="dir-icon" aria-hidden="true">${ICONS.folder}</span>
              <code class="dir-path" id="settings-dir">Not set yet</code>
              <button type="button" class="btn-secondary" id="settings-change">Change…</button>
            </div>
            <div class="dir-actions">
              <button type="button" class="btn-secondary" id="settings-reset">Reset to default</button>
              <span class="token-hint">Puts the folder back to the OS default (usually Pictures).</span>
            </div>
            <div class="setting-row">
              <div class="setting-row-text">
                <span class="setting-label" id="split-folders-label">Separate recording folder</span>
                <span class="setting-sub">Off: recordings land with the screenshots. On: pick a folder just for recordings.</span>
              </div>
              <button type="button" class="switch" id="settings-split-folders" role="switch" aria-checked="false" aria-labelledby="split-folders-label"><span class="switch-knob" aria-hidden="true"></span></button>
            </div>
            <div class="dir-row" id="settings-rec-row" hidden>
              <span class="dir-icon" aria-hidden="true">${ICONS.folder}</span>
              <code class="dir-path" id="settings-rec-dir">Same as the save folder</code>
              <button type="button" class="btn-secondary" id="settings-rec-change">Change…</button>
            </div>
            <div class="dir-actions" id="settings-rec-actions" hidden>
              <button type="button" class="btn-secondary" id="settings-rec-reset">Use the save folder</button>
              <span class="token-hint">Recordings follow the screenshot folder again.</span>
            </div>
          </section>

          <section class="setting" data-section="export">
            <h3 class="setting-title">Export</h3>
            <p class="setting-help">PNG stays lossless. JPEG and WebP are far smaller — quality controls how much detail they keep.</p>
            <div class="field">
              <label class="field-label" for="settings-format">Format</label>
              <div class="select-wrap">
                <select id="settings-format" class="field-select">
                  <option value="png">PNG · lossless, sharpest text</option>
                  <option value="jpeg">JPEG · small, no transparency</option>
                  <option value="webp">WebP · small and modern</option>
                </select>
                <span class="select-arrow" aria-hidden="true">${ICONS.caret}</span>
              </div>
              <p class="token-hint" id="settings-format-hint">Default save format — auto-save, Save and Save As all write this. <span class="nowrap"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd></span> opens Save As… with any name and folder.</p>
            </div>
            <div class="field">
              <label class="field-label" for="settings-rec-format">Recording format</label>
              <div class="select-wrap">
                <select id="settings-rec-format" class="field-select">
                  <option value="mp4">MP4 · video, smallest for long takes</option>
                  <option value="gif">GIF · loops anywhere, no player</option>
                </select>
                <span class="select-arrow" aria-hidden="true">${ICONS.caret}</span>
              </div>
              <p class="token-hint">Used by the Record button in the top bar.</p>
            </div>
            <div class="field" id="settings-quality-field" hidden>
              <label class="field-label" for="settings-quality">Quality <output class="field-value" id="settings-quality-out" for="settings-quality">90</output></label>
              <input type="range" class="slider" id="settings-quality" min="1" max="100" step="1" value="90" aria-label="Export quality" />
            </div>
            <div class="field">
              <label class="field-label" for="settings-filename">Filename pattern</label>
              <input type="text" class="field-input" id="settings-filename" value="${DEFAULT_PATTERN}" spellcheck="false" autocomplete="off" aria-describedby="settings-tokens settings-preview" />
              <p class="token-hint" id="settings-tokens"><code>{date}</code> 2026-11-14 · <code>{time}</code> 19-45-12 · <code>{datetime}</code> both</p>
              <p class="preview-line" id="settings-preview">Preview: <code class="preview-name">${DEFAULT_PATTERN}.png</code></p>
            </div>
            <div class="field">
              <label class="field-label" for="settings-watermark">Watermark</label>
              <input type="text" class="field-input" id="settings-watermark" value="" placeholder="e.g. @rostad — leave empty for none" spellcheck="false" autocomplete="off" />
              <p class="token-hint">Burned into exports only. The editor and your screenshots stay clean.</p>
            </div>
            <div class="field" id="settings-watermark-style" hidden>
              <label class="field-label" for="settings-watermark-opacity">Watermark opacity <output class="field-value" id="settings-watermark-opacity-out" for="settings-watermark-opacity">45</output></label>
              <input type="range" class="slider" id="settings-watermark-opacity" min="2" max="100" step="1" value="45" aria-label="Watermark opacity" />
              <div class="select-wrap">
                <select id="settings-watermark-corner" class="field-select" aria-label="Watermark corner">
                  <option value="bottom-right">Bottom right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="top-right">Top right</option>
                  <option value="top-left">Top left</option>
                </select>
                <span class="select-arrow" aria-hidden="true">${ICONS.caret}</span>
              </div>
            </div>
            <div class="field">
              <label class="field-label" for="settings-upload">Upload endpoint</label>
              <input type="url" class="field-input" id="settings-upload" value="" placeholder="https://your-server.example/upload" spellcheck="false" autocomplete="off" />
              <p class="token-hint">File → Upload… POSTs the PNG here and copies the link the server answers with. Empty hides the action.</p>
            </div>
          </section>

          <section class="setting" data-section="troubleshooting">
            <h3 class="setting-title">Troubleshooting</h3>
            <p class="setting-help">Recording not starting? Copy the diagnostic logs — they show exactly where the capture pipeline stopped. Attach them to a bug report.</p>
            <div class="dir-actions">
              <button type="button" class="btn-secondary" id="settings-copy-diag">Copy recording diagnostics</button>
              <span class="token-hint" id="settings-diag-feedback" role="status" aria-live="polite"></span>
            </div>
          </section>

          <section class="setting" data-section="theme">
            <h3 class="setting-title">Theme</h3>
            <p class="setting-help">Light for daylight, dark for late sessions.</p>
            <div class="segmented" role="radiogroup" aria-label="Theme">
              <button type="button" role="radio" data-theme-choice="light" aria-checked="true">${ICONS.sun}<span>Light</span></button>
              <button type="button" role="radio" data-theme-choice="dark" aria-checked="false" tabindex="-1">${ICONS.moon}<span>Dark</span></button>
            </div>
          </section>
        </div>
        <footer class="modal-foot">
          <span class="modal-version" id="settings-version"></span>
          <button type="button" class="btn-secondary" data-close>Close</button>
        </footer>
      </div>`;

    this.root = root;
    this.card = root.querySelector<HTMLDivElement>(".modal")!;
    this.dirPath = root.querySelector<HTMLElement>("#settings-dir")!;
    this.versionEl = root.querySelector<HTMLElement>("#settings-version")!;
    this.changeBtn = root.querySelector<HTMLButtonElement>("#settings-change")!;
    this.resetBtn = root.querySelector<HTMLButtonElement>("#settings-reset")!;
    this.diagBtn = root.querySelector<HTMLButtonElement>("#settings-copy-diag")!;
    this.diagFeedback = root.querySelector<HTMLElement>("#settings-diag-feedback")!;
    this.segments = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-theme-choice]"));
    this.timerPills = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-timer]"));
    this.intervalSelect = root.querySelector<HTMLSelectElement>("#settings-interval")!;
    this.formatSelect = root.querySelector<HTMLSelectElement>("#settings-format")!;
    this.recFormatSelect = root.querySelector<HTMLSelectElement>("#settings-rec-format")!;
    this.micSelect = root.querySelector<HTMLSelectElement>("#settings-mic")!;
    this.micNote = root.querySelector<HTMLElement>("#settings-mic-note")!;
    this.systemSwitch = root.querySelector<HTMLButtonElement>("#settings-system-audio")!;
    this.watermarkInput = root.querySelector<HTMLInputElement>("#settings-watermark")!;
    this.watermarkStyleField = root.querySelector<HTMLElement>("#settings-watermark-style")!;
    this.watermarkOpacityInput = root.querySelector<HTMLInputElement>("#settings-watermark-opacity")!;
    this.watermarkOpacityOut = root.querySelector<HTMLOutputElement>("#settings-watermark-opacity-out")!;
    this.watermarkCornerSelect = root.querySelector<HTMLSelectElement>("#settings-watermark-corner")!;
    this.uploadInput = root.querySelector<HTMLInputElement>("#settings-upload")!;
    this.splitSwitch = root.querySelector<HTMLButtonElement>("#settings-split-folders")!;
    this.recRow = root.querySelector<HTMLElement>("#settings-rec-row")!;
    this.recActions = root.querySelector<HTMLElement>("#settings-rec-actions")!;
    this.recDirEl = root.querySelector<HTMLElement>("#settings-rec-dir")!;
    this.recChangeBtn = root.querySelector<HTMLButtonElement>("#settings-rec-change")!;
    this.recResetBtn = root.querySelector<HTMLButtonElement>("#settings-rec-reset")!;
    this.qualityField = root.querySelector<HTMLElement>("#settings-quality-field")!;
    this.qualityInput = root.querySelector<HTMLInputElement>("#settings-quality")!;
    this.qualityOut = root.querySelector<HTMLOutputElement>("#settings-quality-out")!;
    this.nameInput = root.querySelector<HTMLInputElement>("#settings-filename")!;
    this.namePreview = root.querySelector<HTMLElement>("#settings-preview .preview-name")!;
    this.traySwitch = root.querySelector<HTMLButtonElement>("#settings-tray")!;
    this.widgetSwitch = root.querySelector<HTMLButtonElement>("#settings-widget")!;
    this.autosaveSwitch = root.querySelector<HTMLButtonElement>("#settings-autosave")!;
    this.updatesSwitch = root.querySelector<HTMLButtonElement>("#settings-updates")!;
    this.updateActions = root.querySelector<HTMLElement>("#settings-update-actions")!;
    this.checkUpdatesBtn = root.querySelector<HTMLButtonElement>("#settings-check-updates")!;
    this.updateNote = root.querySelector<HTMLElement>("#settings-update-note")!;
    // "Check now" needs the shell's IPC bridge; a plain-browser build has none.
    this.updateActions.hidden = !this.opts.checkForUpdates;
    this.autostartRow = root.querySelector<HTMLElement>("#settings-autostart-row")!;
    this.autostartSwitch = root.querySelector<HTMLButtonElement>("#settings-autostart")!;
    // Launch-at-login needs the shell's OS bridge; without it (plain-browser
    // tests) the row simply does not exist.
    this.autostartRow.hidden = !this.opts.getAutostart || !this.opts.setAutostart;
    this.hotkeySwitch = root.querySelector<HTMLButtonElement>("#settings-hotkeys")!;
    this.hotkeyFullInput = root.querySelector<HTMLInputElement>("#hotkey-full")!;
    this.hotkeyRegionInput = root.querySelector<HTMLInputElement>("#hotkey-region")!;
    this.hotkeyFullPreview = root.querySelector<HTMLElement>("#hotkey-full-caps")!;
    this.hotkeyRegionPreview = root.querySelector<HTMLElement>("#hotkey-region-caps")!;
    this.hotkeyRegisterBtn = root.querySelector<HTMLButtonElement>("#settings-register-hotkeys")!;
    this.hotkeyStatusEl = root.querySelector<HTMLElement>("#settings-hotkey-status")!;
    this.defaultToolEl = root.querySelector<HTMLElement>("#settings-default-tool")!;
    this.defaultToolDesktopEl = root.querySelector<HTMLElement>("#settings-default-tool-desktop")!;
    this.defaultToolNoteEl = root.querySelector<HTMLElement>("#settings-default-tool-note")!;
    this.defaultToolApplyBtn = root.querySelector<HTMLButtonElement>("#settings-default-tool-apply")!;
    this.defaultToolConfirmBtn = root.querySelector<HTMLButtonElement>("#settings-default-tool-confirm")!;
    this.defaultToolCancelBtn = root.querySelector<HTMLButtonElement>("#settings-default-tool-cancel")!;
    this.defaultToolRestoreBtn = root.querySelector<HTMLButtonElement>("#settings-default-tool-restore")!;

    for (const closer of Array.from(root.querySelectorAll<HTMLElement>("[data-close]"))) {
      closer.addEventListener("click", () => this.close());
    }

    for (const segment of this.segments) {
      segment.addEventListener("click", () => {
        const choice: Theme = segment.dataset.themeChoice === "dark" ? "dark" : "light";
        this.opts.setTheme(choice);
        this.refresh(choice);
      });
    }

    this.changeBtn.addEventListener("click", () => void this.pickFolder());
    this.resetBtn.addEventListener("click", () => void this.resetFolder());

    this.traySwitch.addEventListener("click", () => {
      const next = !this.opts.getSettings().minimizeToTray;
      this.opts.updateSettings({ minimizeToTray: next });
      this.refresh();
    });

    this.autostartSwitch.addEventListener("click", () => void this.toggleAutostart());

    this.widgetSwitch.addEventListener("click", () => {
      const next = !this.opts.getSettings().widget;
      this.opts.updateSettings({ widget: next });
      this.refresh();
    });

    this.autosaveSwitch.addEventListener("click", () => {
      const next = !this.opts.getSettings().autoSave;
      this.opts.updateSettings({ autoSave: next });
      this.refresh();
    });

    this.updatesSwitch.addEventListener("click", () => {
      const next = !this.opts.getSettings().checkUpdates;
      this.opts.updateSettings({ checkUpdates: next });
      this.refresh();
    });

    this.checkUpdatesBtn.addEventListener("click", () => void this.checkNow());

    this.hotkeySwitch.addEventListener("click", () => {
      const next = !this.opts.getSettings().hotkeysEnabled;
      this.opts.updateSettings({ hotkeysEnabled: next });
      this.refresh();
    });

    this.hotkeyRegisterBtn.addEventListener("click", () => void this.register());

    this.defaultToolApplyBtn.addEventListener("click", () => {
      this.defaultToolMode = "confirm";
      this.paintDefaultTool();
    });
    this.defaultToolCancelBtn.addEventListener("click", () => {
      this.defaultToolMode = "idle";
      this.paintDefaultTool();
    });
    this.defaultToolConfirmBtn.addEventListener("click", () => void this.applyDefaultTool());
    this.defaultToolRestoreBtn.addEventListener("click", () => void this.restoreDefaultTool());

    this.intervalSelect.addEventListener("change", () => {
      const parsed = Number(this.intervalSelect.value);
      const value = INTERVAL_CHOICES.includes(parsed) ? parsed : DEFAULT_INTERVAL;
      this.opts.updateSettings({ intervalSeconds: value });
      this.refresh();
    });

    this.micSelect.addEventListener("change", () => {
      this.opts.updateSettings({ mic: this.micSelect.value });
      this.refresh();
    });

    this.systemSwitch.addEventListener("click", () => {
      const next = !this.opts.getSettings().systemAudio;
      this.opts.updateSettings({ systemAudio: next });
      this.refresh();
    });

    this.diagBtn.addEventListener("click", () => void this.copyDiagnostics());

    const commitTrigger = (input: HTMLInputElement, which: "full" | "region"): void => {
      const fallback = which === "full" ? DEFAULT_HOTKEY_FULL : DEFAULT_HOTKEY_REGION;
      const value = normalizeTrigger(input.value, fallback);
      input.value = value;
      this.opts.updateSettings(
        which === "full" ? { hotkeyFull: value } : { hotkeyRegion: value },
        { silent: true },
      );
      this.refresh();
    };

    this.hotkeyFullInput.addEventListener("change", () => commitTrigger(this.hotkeyFullInput, "full"));
    this.hotkeyRegionInput.addEventListener("change", () =>
      commitTrigger(this.hotkeyRegionInput, "region"),
    );
    for (const input of [this.hotkeyFullInput, this.hotkeyRegionInput]) {
      input.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        input.dispatchEvent(new Event("change"));
        input.blur();
      });
      // Live keycap preview while typing, without committing the value.
      input.addEventListener("input", () => {
        const preview = input === this.hotkeyFullInput ? this.hotkeyFullPreview : this.hotkeyRegionPreview;
        this.paintCaps(preview, normalizeTrigger(input.value, input.placeholder));
      });
    }

    for (const pill of this.timerPills) {
      pill.addEventListener("click", () => {
        this.opts.updateSettings({ timer: Number(pill.dataset.timer) });
        this.refresh();
      });
    }

    this.formatSelect.addEventListener("change", () => {
      const value = this.formatSelect.value;
      const format: ExportFormat = isExportFormat(value) ? value : DEFAULT_FORMAT;
      this.opts.updateSettings({ format });
      this.refresh();
      this.paintPreview();
    });

    this.recFormatSelect.addEventListener("change", () => {
      const value = this.recFormatSelect.value;
      this.opts.updateSettings({ recFormat: isRecFormat(value) ? value : DEFAULT_REC_FORMAT });
    });

    this.watermarkInput.addEventListener("input", () => {
      this.opts.updateSettings({ watermarkText: this.watermarkInput.value }, { silent: true });
      this.watermarkStyleField.hidden = this.watermarkInput.value.trim() === "";
    });
    this.watermarkInput.addEventListener("blur", () => {
      this.opts.updateSettings({ watermarkText: this.watermarkInput.value.trim() });
      this.refresh();
    });
    this.watermarkOpacityInput.addEventListener("input", () => {
      const value = clampInt(this.watermarkOpacityInput.value, DEFAULT_WATERMARK_OPACITY, 2, 100);
      this.opts.updateSettings({ watermarkOpacity: value }, { silent: true });
      this.watermarkOpacityOut.textContent = String(value);
    });
    this.watermarkOpacityInput.addEventListener("change", () => {
      this.opts.updateSettings({
        watermarkOpacity: clampInt(
          this.watermarkOpacityInput.value,
          DEFAULT_WATERMARK_OPACITY,
          2,
          100,
        ),
      });
    });
    this.watermarkCornerSelect.addEventListener("change", () => {
      this.opts.updateSettings({ watermarkCorner: this.watermarkCornerSelect.value });
    });
    this.uploadInput.addEventListener("input", () => {
      this.opts.updateSettings({ uploadEndpoint: this.uploadInput.value.trim() }, { silent: true });
    });
    this.uploadInput.addEventListener("blur", () => {
      this.opts.updateSettings({ uploadEndpoint: this.uploadInput.value.trim() });
      this.refresh();
    });

    this.splitSwitch.addEventListener("click", () => {
      const next = !this.opts.getSettings().splitFolders;
      this.opts.updateSettings({ splitFolders: next });
      this.refresh();
    });
    this.recChangeBtn.addEventListener("click", () => {
      void this.opts.changeRecDir().then(() => this.refresh());
    });
    this.recResetBtn.addEventListener("click", () => {
      void this.opts.resetRecDir().then(() => this.refresh());
    });
    this.qualityInput.addEventListener("input", () => {
      const quality = clampInt(this.qualityInput.value, DEFAULT_QUALITY, 1, 100);
      this.opts.updateSettings({ quality }, { silent: true });
      this.paintQuality(this.opts.getSettings().format, quality);
    });
    this.qualityInput.addEventListener("change", () => {
      this.opts.updateSettings({ quality: clampInt(this.qualityInput.value, DEFAULT_QUALITY, 1, 100) });
      this.paintQuality(this.opts.getSettings().format, this.opts.getSettings().quality);
    });

    this.nameInput.addEventListener("input", () => {
      this.opts.updateSettings({ filename: this.nameInput.value }, { silent: true });
      this.paintPreview();
    });
    this.nameInput.addEventListener("blur", () => {
      if (this.nameInput.value.trim() === "") {
        this.opts.updateSettings({ filename: DEFAULT_PATTERN }, { silent: true });
      }
      this.opts.updateSettings({ filename: this.opts.getSettings().filename });
      this.refresh();
    });

    // Click on the scrim (not the card) closes.
    root.addEventListener("pointerdown", (ev) => {
      if (ev.target === root) this.close();
    });

    root.addEventListener("keydown", this.onKeyDown);
    // Focus can sit on <body> after clicking non-focusable chrome, so Esc is
    // also caught at the document — but only while this dialog is topmost.
    document.addEventListener("keydown", this.onDocKeyDown, true);
    document.body.append(root);
    return root;
  }

  /** True when no other visible modal sits above this one. */
  private isTopmost(): boolean {
    if (!this.root || this.root.hidden) return false;
    const mine = Number(getComputedStyle(this.root).zIndex) || 0;
    return Array.from(document.querySelectorAll<HTMLElement>(".modal-backdrop:not([hidden])")).every(
      (el) => el === this.root || (Number(getComputedStyle(el).zIndex) || 0) <= mine,
    );
  }

  private readonly onDocKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== "Escape" || !this.isTopmost()) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.close();
  };

  private async register(): Promise<void> {
    if (this.registering) return;
    this.registering = true;
    const label = this.hotkeyRegisterBtn.textContent;
    this.hotkeyRegisterBtn.disabled = true;
    this.hotkeyRegisterBtn.textContent = "Registering…";
    this.hotkeyStatusEl.dataset.state = "pending";
    try {
      await this.opts.registerHotkeys();
    } finally {
      this.registering = false;
      this.hotkeyRegisterBtn.textContent = label ?? "Register hotkeys";
      this.refresh();
    }
  }

  /* ------------------------------------------- default screenshot tool */

  /** Re-read the OS state; the card hides itself when unsupported. */
  private async refreshDefaultTool(): Promise<void> {
    const get = this.opts.getDefaultToolStatus;
    if (!get) {
      this.defaultToolStatus = null;
      this.paintDefaultTool();
      return;
    }
    try {
      this.defaultToolStatus = await get();
    } catch {
      this.defaultToolStatus = null;
    }
    this.paintDefaultTool();
  }

  /**
   * Render the takeover card. Visible only on supported desktops where it
   * matters: no global-hotkey backend, an active takeover, or a restore is
   * possible. The confirmation step spells out every system change before
   * anything is written.
   */
  private paintDefaultTool(): void {
    const status = this.defaultToolStatus;
    const backend = this.opts.getHotkeyStatus()?.backend ?? "none";
    const visible =
      !!status?.supported && (backend === "none" || status.isDefault || status.canRestore);
    this.defaultToolEl.hidden = !visible;
    if (!visible || !status) return;

    this.defaultToolDesktopEl.textContent = status.desktop;
    const mode = this.defaultToolMode;
    const busy = mode === "busy-apply" || mode === "busy-restore";
    const confirm = mode === "confirm";
    const active = status.isDefault && !busy && mode !== "error" && !confirm;

    this.defaultToolEl.dataset.state = active
      ? "ok"
      : mode === "error"
        ? "warn"
        : confirm
          ? "confirm"
          : "idle";

    let note: string;
    if (mode === "busy-apply") {
      note = "Changing your desktop's keyboard settings…";
    } else if (mode === "busy-restore") {
      note = "Restoring your previous keyboard settings…";
    } else if (mode === "error") {
      note = `Could not change the keyboard settings: ${esc(this.defaultToolError)}`;
    } else if (confirm) {
      note =
        `This changes your ${esc(status.desktop)} keyboard settings: the system's <kbd>Print</kbd> and ` +
        `<kbd>Shift</kbd>+<kbd>Print</kbd> screenshot shortcuts are disabled, and two custom shortcuts ` +
        `are added that run <code>${esc(status.command)} --capture</code> and ` +
        `<code>${esc(status.command)} --region</code>. Other screenshot shortcuts ` +
        `(Ctrl+Print…) keep going to the system tool. You can restore the previous settings at any time.`;
    } else if (active) {
      note =
        "SnagCraft is the default screenshot tool — <kbd>Print</kbd> captures the full screen and " +
        "<kbd>Shift</kbd>+<kbd>Print</kbd> a region, in any app. The shortcuts launch SnagCraft even when it isn't running.";
    } else {
      note =
        `Your desktop keeps <kbd>Print</kbd> for its own screenshot tool, and no global-hotkey service is available here. ` +
        "SnagCraft can take the keys over through the desktop's own keyboard settings.";
    }
    this.defaultToolNoteEl.innerHTML = note;

    this.defaultToolApplyBtn.hidden = busy || confirm || active;
    this.defaultToolConfirmBtn.hidden = !confirm;
    this.defaultToolCancelBtn.hidden = !confirm;
    this.defaultToolRestoreBtn.hidden = busy || confirm || !status.canRestore;
    this.defaultToolApplyBtn.disabled = busy;
    this.defaultToolConfirmBtn.disabled = busy;
    this.defaultToolCancelBtn.disabled = busy;
    this.defaultToolRestoreBtn.disabled = busy;
  }

  /** Confirmed takeover: clear the built-in bindings, add ours, keep a backup. */
  private async applyDefaultTool(): Promise<void> {
    const set = this.opts.setDefaultTool;
    if (!set || this.defaultToolMode === "busy-apply") return;
    this.defaultToolMode = "busy-apply";
    this.paintDefaultTool();
    try {
      this.defaultToolStatus = await set();
      this.defaultToolMode = "idle";
      this.defaultToolError = "";
    } catch (e) {
      this.defaultToolMode = "error";
      this.defaultToolError = e instanceof Error ? e.message : String(e);
    }
    this.paintDefaultTool();
    this.paintHotkeyStatus(this.opts.getHotkeyStatus());
  }

  /** One-click undo: put every previous binding back exactly as it was. */
  private async restoreDefaultTool(): Promise<void> {
    const restore = this.opts.restoreDefaultTool;
    if (!restore || this.defaultToolMode === "busy-restore") return;
    this.defaultToolMode = "busy-restore";
    this.paintDefaultTool();
    try {
      this.defaultToolStatus = await restore();
      this.defaultToolMode = "idle";
      this.defaultToolError = "";
    } catch (e) {
      this.defaultToolMode = "error";
      this.defaultToolError = e instanceof Error ? e.message : String(e);
    }
    this.paintDefaultTool();
    this.paintHotkeyStatus(this.opts.getHotkeyStatus());
  }

  private async resetFolder(): Promise<void> {
    if (this.resetting) return;
    this.resetting = true;
    const label = this.resetBtn.textContent;
    this.resetBtn.disabled = true;
    this.resetBtn.textContent = "Resetting…";
    try {
      await this.opts.resetSaveDir();
    } finally {
      this.resetting = false;
      this.resetBtn.disabled = false;
      this.resetBtn.textContent = label ?? "Reset to default";
      this.refresh();
    }
  }

  private async pickFolder(): Promise<void> {
    if (this.picking) return;
    this.picking = true;
    const label = this.changeBtn.textContent;
    this.changeBtn.disabled = true;
    this.changeBtn.textContent = "Choosing…";
    try {
      await this.opts.changeSaveDir();
    } finally {
      this.picking = false;
      this.changeBtn.disabled = false;
      this.changeBtn.textContent = label ?? "Change…";
      this.refresh();
    }
  }

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (!this.root) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      this.close();
      return;
    }
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      const group = this.segments.includes(document.activeElement as HTMLButtonElement)
        ? this.segments
        : this.timerPills.includes(document.activeElement as HTMLButtonElement)
          ? this.timerPills
          : null;
      if (!group) return;
      ev.preventDefault();
      const index = group.findIndex((s) => s === document.activeElement);
      const step = ev.key === "ArrowRight" ? 1 : -1;
      const next = group[(index + step + group.length) % group.length];
      next?.focus();
      next?.click();
      return;
    }
    if (ev.key !== "Tab") return;

    const items = Array.from(this.root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (ev.shiftKey && (active === first || !this.root.contains(active))) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && (active === last || !this.root.contains(active))) {
      ev.preventDefault();
      first.focus();
    }
  };
}