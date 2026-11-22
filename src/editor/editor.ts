// SnagCraft annotation editor.
//
// Fabric.js 6 canvas wrapper: loads a captured screenshot, fits it to the
// container, hosts the annotation tools (src/editor/tools.ts), keeps an
// undo/redo history of canvas states and flattens everything — image +
// annotations + crop + pixelated blur regions — into a PNG data URL.
//
// Public API is LOCKED (editor module ↔ app shell contract, spec §4.2).

import * as fabric from "fabric";
import {
  DEFAULT_BLUR_RADIUS,
  MAX_BLUR_RADIUS,
  MIN_BLUR_RADIUS,
  applyBlurRegion,
  clampBlurRadius,
  highlighter as applyHighlighter,
  spotlight as applySpotlight,
  toDevice,
  type BlurMode,
  type DeviceRect,
} from "./blur";
import {
  ACCENT,
  BlurRegion,
  MAGNIFY_ZOOM,
  MAX_STROKE_WIDTH,
  MIN_STROKE_WIDTH,
  STROKE_WIDTH,
  MagnifyRegion,
  blurRegionPreview,
  clampMagnifyZoom,
  type Box,
  type ImageInfo,
  type Point,
  type ShadowStyle,
  type ShapeKind,
  type TextStyle,
  type Tool,
  type ToolHost,
  createTool,
  fitBox,
  isBlurRegion,
  isHighlighterRegion,
  isMagnifyRegion,
  isSpotlightRegion,
  shadowFromStyle,
} from "./tools";
import {
  DEFAULT_WATERMARK,
  drawWatermark,
  normalizeWatermark,
  type WatermarkOptions,
} from "./watermark";

export type { BlurMode } from "./blur";
export type { ShadowStyle } from "./tools";

export type ToolId =
  | "select"
  | "crop"
  | "arrow"
  | "text"
  | "shape"
  | "blur"
  | "spotlight"
  | "highlighter"
  | "callout"
  | "step"
  | "bucket"
  | "magnify"
  | "brush";

const TOOL_IDS: readonly ToolId[] = [
  "select",
  "crop",
  "arrow",
  "text",
  "shape",
  "blur",
  "spotlight",
  "highlighter",
  "callout",
  "step",
  "bucket",
  "magnify",
  "brush",
];

/**
 * The editor's "ink" settings — exactly what a named style preset stores.
 *
 * The editor only reads and writes the LIVE values; the app shell owns preset
 * persistence (named styles, favourites), so nothing here touches storage.
 * Plain JSON, so a preset round-trips through localStorage unharmed.
 */
export interface EditorStyle {
  /** Ink colour for new annotations (and highlighter fill). */
  color: string;
  /** Stroke width for new shapes/arrows, 1..12. */
  strokeWidth: number;
  /** Caption font family. */
  fontFamily: string;
  /** Caption font size, 8..200. */
  fontSize: number;
  bold: boolean;
  italic: boolean;
  /** Redaction mode for NEW blur regions. */
  blurMode: BlurMode;
  /** Gaussian radius / pixelate block size, 2..60 scene px. */
  blurRadius: number;
  /** Drop shadow for NEW arrow/rect/text/callout/step annotations. */
  shadow: ShadowStyle;
}

const MAX_HISTORY = 80;

/** Pointer travel (scene px) before a mousedown on a live caption becomes a move. */
const TEXT_DRAG_THRESHOLD = 4;
/** Breathing room around the screenshot inside the canvas. */
const PADDING = 16;
/** Smallest useful crop / annotation. */
const MIN_SIZE = 8;
/** Never export more than this on the long side. */
const MAX_EXPORT_EDGE = 8192;
/** Caption defaults and size limits. */
const DEFAULT_FONT_FAMILY = "Inter";
const DEFAULT_FONT_SIZE = 32;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 200;
/** Freehand brush width limits and default (scene px). */
const DEFAULT_BRUSH_WIDTH = 4;
const MIN_BRUSH_WIDTH = 1;
const MAX_BRUSH_WIDTH = 60;
/** Step-badge diameter limits and default (scene px). */
const DEFAULT_STEP_SIZE = 30;
const MIN_STEP_SIZE = 16;
const MAX_STEP_SIZE = 64;
/** Callout caption size limits and default (scene px). */
const DEFAULT_CALLOUT_FONT_SIZE = 24;
const MIN_CALLOUT_FONT_SIZE = 12;
const MAX_CALLOUT_FONT_SIZE = 120;
/** Spotlight / highlighter outline thickness limits and default (scene px). */
const DEFAULT_REGION_THICKNESS = 2;
const MIN_REGION_THICKNESS = 1;
const MAX_REGION_THICKNESS = 60;
/** Drop-shadow limits (blur radius and offsets, scene px). */
const MAX_SHADOW_BLUR = 60;
const MAX_SHADOW_OFFSET = 50;
const DEFAULT_SHADOW: ShadowStyle = {
  enabled: false,
  color: "rgba(0,0,0,0.45)",
  blur: 8,
  offsetX: 0,
  offsetY: 4,
};

/** Same colour at a lower alpha — used for the brush footprint's fill. */
const tint = (color: string, alpha: number): string => {
  const value = color.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) {
    const channels = [short[1], short[2], short[3]].map((part) => parseInt(part + part, 16));
    return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (long) {
    const channels = [long[1], long[2], long[3]].map((part) => parseInt(part, 16));
    return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean);
    if (parts.length >= 3) return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  }
  return `rgba(255, 255, 255, ${alpha})`;
};

/** Range a tool's size slider spans; `step` is the increment the UI steps by. */
export interface ToolSizeRange {
  min: number;
  max: number;
  step: number;
}

/**
 * The one size each tool exposes. Every tool maps its size onto the setting that
 * actually changes what you draw, so a single slider drives all of them:
 * brush→stroke width, arrow/rect→stroke width, text→font size,
 * blur→radius, step→badge diameter, callout→caption size,
 * spotlight/highlighter→outline thickness, magnify→zoom.
 * Tools with no meaningful size (select, crop, bucket) report null.
 */
const TOOL_SIZE_RANGES: Record<ToolId, ToolSizeRange | null> = {
  select: null,
  crop: null,
  arrow: { min: MIN_STROKE_WIDTH, max: MAX_STROKE_WIDTH, step: 1 },
  text: { min: MIN_FONT_SIZE, max: MAX_FONT_SIZE, step: 1 },
  shape: { min: MIN_STROKE_WIDTH, max: MAX_STROKE_WIDTH, step: 1 },
  blur: { min: MIN_BLUR_RADIUS, max: MAX_BLUR_RADIUS, step: 1 },
  spotlight: { min: MIN_REGION_THICKNESS, max: MAX_REGION_THICKNESS, step: 1 },
  highlighter: { min: MIN_REGION_THICKNESS, max: MAX_REGION_THICKNESS, step: 1 },
  callout: { min: MIN_CALLOUT_FONT_SIZE, max: MAX_CALLOUT_FONT_SIZE, step: 1 },
  step: { min: MIN_STEP_SIZE, max: MAX_STEP_SIZE, step: 1 },
  bucket: null,
  magnify: { min: 1.5, max: 10, step: 0.5 },
  brush: { min: MIN_BRUSH_WIDTH, max: MAX_BRUSH_WIDTH, step: 1 },
};

/** Snap a value into a range on its own step grid. */
const clampToRange = (value: number, range: ToolSizeRange): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return range.min;
  const step = range.step > 0 ? range.step : 1;
  const snapped = Math.round((value - range.min) / step) * step + range.min;
  const clamped = Math.min(Math.max(snapped, range.min), range.max);
  return Number(clamped.toFixed(step < 1 ? 1 : 0));
};

interface HistoryEntry {
  json: Record<string, unknown>;
  crop: Box | null;
  /** Natural pixel size of the screenshot at the time of the entry. */
  natural: { width: number; height: number };
}

const isToolId = (value: string): value is ToolId =>
  (TOOL_IDS as readonly string[]).includes(value);

/**
 * Objects that are swapped for pixels on export instead of being drawn.
 *
 * Magnify lenses are deliberately NOT effects: they paint their own live
 * pixels in `_render`, so `toCanvasElement` exports exactly what the canvas
 * shows — no separate export pass, no chance of the two drifting apart.
 */
const isEffectRegion = (object: fabric.FabricObject): boolean =>
  isBlurRegion(object) ||
  isSpotlightRegion(object) ||
  isHighlighterRegion(object);

export class Editor {
  private readonly container: HTMLElement;
  private readonly canvas: fabric.Canvas;
  private readonly host: ToolHost;
  private readonly tools = new Map<ToolId, Tool>();
  /** Editor-only decoration (crop shading) — never exported, never in history. */
  private readonly chrome = new Set<fabric.FabricObject>();

  private image: fabric.FabricImage | null = null;
  private sourceDataUrl = "";
  private natural = { width: 1, height: 1 };
  /**
   * The capture as decoded pixels. resizeImage() re-samples THIS, so repeated
   * resizes copy from the original rather than compounding re-encodes, and
   * undo can rebuild any earlier size.
   */
  private base: CanvasImageSource | null = null;

  /**
   * Per-lens composite canvases (capture + everything drawn below that lens).
   * Kept in image-pixel space so the viewport zoom/pan never invalidates them;
   * `lensVersion` is bumped by anything that changes the scene's contents.
   */
  private readonly lensCanvases = new Map<
    MagnifyRegion,
    { version: number; canvas: HTMLCanvasElement }
  >();
  private lensVersion = 0;

  private tool: ToolId = "select";
  private cropBox: Box | null = null;

  /**
   * In-flight drag of the caption currently being edited. Fabric's IText eats
   * mousedown for caret placement, so repositioning a live caption is handled
   * here (scene-space delta applied on every move).
   */
  private textDrag: {
    object: fabric.IText;
    start: Point;
    left: number;
    top: number;
    moved: boolean;
  } | null = null;

  /** True when a caption was live at the moment the current pointer went down. */
  private captionAtPointerDown = false;

  /** Ink colour applied to NEW annotations (existing ones keep their colour). */
  private inkColor = ACCENT;
  /** Stroke width applied to NEW annotations. */
  private inkWidth = STROKE_WIDTH;
  /** Which outline the Shapes tool draws (persisted by the shell). */
  private shapeKindValue: ShapeKind = "rect";
  /** Redaction mode applied to NEW blur/redaction regions. */
  private blurMode: BlurMode = "gaussian";
  /** Gaussian radius (or pixelate block size) in scene px, for NEW regions. */
  private blurRadius = DEFAULT_BLUR_RADIUS;
  /** Caption typography applied to NEW text objects. */
  private fontFamily = DEFAULT_FONT_FAMILY;
  private fontSize = DEFAULT_FONT_SIZE;
  private textBold = false;
  private textItalic = false;
  /** Freehand stroke width for NEW brush strokes. */
  private brushWidth = DEFAULT_BRUSH_WIDTH;
  /** Diameter of NEW numbered step badges. */
  private stepSize = DEFAULT_STEP_SIZE;
  /** Caption font size inside NEW callouts (independent of caption size). */
  private calloutFontSize = DEFAULT_CALLOUT_FONT_SIZE;
  /** Outline thickness for NEW spotlight / highlighter regions. */
  private regionThickness = DEFAULT_REGION_THICKNESS;
  /** Magnification for NEW magnify lenses. */
  private magnifyZoom = MAGNIFY_ZOOM;
  /** Optional watermark burned into exports only (never the live canvas). */
  private watermark: WatermarkOptions = { ...DEFAULT_WATERMARK };
  /** Drop shadow applied to NEW arrow/rect/text/callout/step annotations. */
  private shadow: ShadowStyle = { ...DEFAULT_SHADOW };

  /**
   * Brush footprint preview: an editor-only decoration (never exported, never
   * in history) that follows the pointer so the stroke size is visible before
   * a single pixel is drawn.
   */
  private brushCursor: fabric.Circle | null = null;
  private brushCursorVisible = false;

  private history: HistoryEntry[] = [];
  private cursor = -1;
  /** True while a history state is being applied — blocks recursive commits. */
  private restoring = false;
  private pending: Promise<void> = Promise.resolve();

  private readonly resizeObserver: ResizeObserver | null;
  private destroyed = false;

  constructor(container: HTMLElement) {
    this.container = container;

    const element = document.createElement("canvas");
    container.replaceChildren(element);

    this.canvas = new fabric.Canvas(element, {
      preserveObjectStacking: true,
      selection: true,
      uniformScaling: false,
      enableRetinaScaling: true,
      stopContextMenu: true,
      fireRightClick: false,
    });

    this.host = {
      canvas: this.canvas,
      bounds: () => this.drawBounds(),
      imageInfo: () => this.imageInfo(),
      textStyle: () => this.textStyle(),
      addObject: (object) => this.addObject(object),
      removeObject: (object) => this.removeObject(object),
      commit: () => this.commit(),
      setCrop: (box) => this.setCrop(box),
      nextStepNumber: () => this.nextStepNumber(),
      color: () => this.inkColor,
      shapeKind: () => this.shapeKindValue,
      strokeWidth: () => this.inkWidth,
      blurMode: () => this.blurMode,
      blurRadius: () => this.blurRadius,
      brushWidth: () => this.brushWidth,
      stepSize: () => this.stepSize,
      calloutFontSize: () => this.calloutFontSize,
      regionThickness: () => this.regionThickness,
      magnifyZoom: () => this.magnifyZoom,
      sourceImage: () => this.magnifySource(),
      imageOrigin: () => this.magnifyOrigin(),
      shadow: () => this.getShadow(),
    };

    this.canvas.on("mouse:down", this.onMouseDown);
    this.canvas.on("mouse:move", this.onMouseMove);
    this.canvas.on("mouse:up", this.onMouseUp);
    this.canvas.on("mouse:wheel", this.onWheel);
    this.canvas.on("mouse:out", this.onMouseOut);
    this.canvas.on("object:modified", this.onObjectModified);

    // Anything that changes what sits under a lens invalidates its cached
    // composite — mid-drag moves included, since those never reach commit().
    const lensEvents: (keyof fabric.CanvasEvents)[] = [
      "object:added",
      "object:removed",
      "object:moving",
      "object:scaling",
      "object:rotating",
      "text:changed",
      "path:created",
    ];
    for (const event of lensEvents) this.canvas.on(event, this.onLensContentChange);

    // Fabric's own mouse:out is unreliable across the pointer leaving the
    // element, so the brush preview is also hidden on a native pointerleave.
    this.canvas.upperCanvasEl?.addEventListener("pointerleave", this.onPointerLeave);

    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("pointerdown", this.onPointerDownCapture, true);

    this.resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => this.layout());
    this.resizeObserver?.observe(container);

    this.layout(true);
    this.currentTool().activate();
    this.applyInteractivity();
  }

  /* ------------------------------------------------------------- public API */

  /** Load a captured image (PNG data URL) into the editor, fit to view. */
  async load(dataUrl: string): Promise<void> {
    if (this.destroyed) return;
    this.sourceDataUrl = dataUrl;

    const image = await fabric.FabricImage.fromURL(dataUrl);
    if (this.destroyed) return;

    this.canvas.discardActiveObject();
    const stale = this.canvas.getObjects();
    if (stale.length) this.canvas.remove(...stale);
    this.chrome.clear();
    this.cropBox = null;
    this.history = [];
    this.cursor = -1;

    const width = image.width ?? this.natural.width;
    const height = image.height ?? this.natural.height;
    this.natural = { width: Math.max(1, width), height: Math.max(1, height) };

    // Keep the decoded capture: resizeImage() always re-samples from here.
    const element = image.getElement();
    this.base = (element ?? null) as CanvasImageSource | null;

    this.configureImage(image);

    this.image = image;
    this.canvas.add(image);
    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    this.layout(true);
    this.resetHistory();
    this.applyInteractivity();
    this.canvas.requestRenderAll();
    this.notify();
  }

  /** Flatten image + annotations (and crop, and blur) to a PNG data URL. */
  flatten(): string {
    const image = this.image;
    if (!image) return this.sourceDataUrl;

    const box = this.outputBox();
    const multiplier = this.outputMultiplier(box);

    // Settle an in-flight caption first (so it lands in history), then silence
    // history while the render state is mutated.
    const active = this.canvas.getActiveObject();
    if (active instanceof fabric.IText && active.isEditing) {
      const wasRestoring = this.restoring;
      this.restoring = false;
      active.exitEditing();
      this.restoring = wasRestoring;
    }

    const wasRestoring = this.restoring;
    this.restoring = true;

    // Build every lens composite BEFORE the effect regions are hidden: a lens
    // magnifies what the user sees, blur/spotlight included, so it must not be
    // built from a scene with those objects temporarily invisible.
    this.markLensDirty();
    for (const lens of this.canvas.getObjects().filter(isMagnifyRegion)) {
      this.lensComposite(lens);
    }

    const effects = this.canvas.getObjects().filter(isEffectRegion);
    const hidden: fabric.FabricObject[] = [...effects, ...this.chrome];
    const visibility = hidden.map((object) => object.visible);
    for (const object of hidden) object.visible = false;

    let imageLayer: HTMLCanvasElement;
    let inkLayer: HTMLCanvasElement;
    try {
      imageLayer = this.canvas.toCanvasElement(multiplier, {
        ...box,
        filter: (object) => object === image,
      });
      inkLayer = this.canvas.toCanvasElement(multiplier, {
        ...box,
        filter: (object) => !object.excludeFromExport,
      });
    } finally {
      for (let index = 0; index < hidden.length; index += 1) {
        const object = hidden[index];
        object.visible = visibility[index];
      }
      this.restoring = wasRestoring;
    }

    this.applyEffects(imageLayer, effects, box, multiplier);

    const output = document.createElement("canvas");
    output.width = Math.max(1, imageLayer.width);
    output.height = Math.max(1, imageLayer.height);
    const context = output.getContext("2d");
    if (!context) return this.sourceDataUrl;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(imageLayer, 0, 0);
    context.drawImage(inkLayer, 0, 0);
    // Watermark last: above every annotation, and in exports only.
    drawWatermark(context, output.width, output.height, {
      ...this.watermark,
      // Scale with the export so a 4K capture gets a readable mark too.
      size: Math.round(Math.min(160, Math.max(16, output.height / 36))),
    });
    return output.toDataURL("image/png");
  }

  setTool(tool: ToolId): void {
    if (!isToolId(tool)) return;
    this.textDrag = null;
    const previous = this.tools.get(this.tool);
    if (previous && this.tool !== tool) previous.deactivate();
    this.tool = tool;
    // The brush footprint belongs to the brush tool only.
    if (tool !== "brush") this.hideBrushCursor();
    const next = this.currentTool();
    next.activate();
    this.applyInteractivity();
    this.canvas.defaultCursor = next.cursor;
    this.canvas.requestRenderAll();
    this.notify();
  }

  undo(): void {
    if (this.cursor <= 0) return;
    this.cursor -= 1;
    this.restore();
  }

  redo(): void {
    if (this.cursor >= this.history.length - 1) return;
    this.cursor += 1;
    this.restore();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("pointerdown", this.onPointerDownCapture, true);
    this.canvas.upperCanvasEl?.removeEventListener("pointerleave", this.onPointerLeave);
    this.brushCursor = null;
    this.brushCursorVisible = false;
    for (const tool of this.tools.values()) tool.deactivate();
    this.tools.clear();
    this.chrome.clear();
    void this.canvas.dispose();
    this.container.replaceChildren();
  }

  /* ------------------------------------------- additive UI conveniences */

  getTool(): ToolId {
    return this.tool;
  }

  canUndo(): boolean {
    return this.cursor > 0;
  }

  canRedo(): boolean {
    return this.cursor < this.history.length - 1;
  }

  /** Ink colour for new annotations. Does not recolour existing objects. */
  setColor(color: string): void {
    if (typeof color !== "string") return;
    const next = color.trim();
    if (!next) return;
    this.inkColor = next;
    if (this.tool === "brush") this.syncBrushCursor();
    this.notify();
  }

  getColor(): string {
    return this.inkColor;
  }

  /** Stroke width for new annotations, clamped to 1..12 and rounded. */
  setStrokeWidth(width: number): void {
    if (typeof width !== "number" || !Number.isFinite(width)) return;
    const clamped = Math.min(Math.max(width, MIN_STROKE_WIDTH), MAX_STROKE_WIDTH);
    this.inkWidth = Math.round(clamped);
    this.notify();
  }

  getStrokeWidth(): number {
    return this.inkWidth;
  }

  /**
   * Redaction mode for NEW blur regions. If blur regions are selected, they are
   * retuned in place as well (so an existing region can be flipped between
   * gaussian / pixelate / blackout without redrawing it).
   */
  setBlurMode(mode: BlurMode): void {
    if (mode !== "gaussian" && mode !== "pixelate" && mode !== "blackout") return;
    const changed = this.blurMode !== mode;
    this.blurMode = mode;
    const retuned = this.retuneBlurSelection();
    if (changed && !retuned) this.notify();
  }

  getBlurMode(): BlurMode {
    return this.blurMode;
  }

  /** Gaussian radius / pixelate block size, in scene px, clamped to 2..60. */
  setBlurRadius(radius: number): void {
    if (typeof radius !== "number" || !Number.isFinite(radius)) return;
    const next = clampBlurRadius(radius);
    const changed = this.blurRadius !== next;
    this.blurRadius = next;
    const retuned = this.retuneBlurSelection();
    if (changed && !retuned) this.notify();
  }

  getBlurRadius(): number {
    return this.blurRadius;
  }

  /* --------------------------------------------------------------- shadows */

  /**
   * Drop shadow for NEW arrow/rect/text/callout/step annotations. Partial
   * patches are merged into the live style; every field is validated (blur
   * 0..60, offsets -50..50, non-empty colour) so junk from a stored preset
   * cannot poison the canvas. Existing annotations keep their own shadow.
   */
  /** Set the export watermark; an empty `text` disables it. */
  setWatermark(options: Partial<WatermarkOptions>): void {
    this.watermark = normalizeWatermark({ ...this.watermark, ...options });
  }

  /** Current export watermark (the shell mirrors it in Settings). */
  getWatermark(): WatermarkOptions {
    return { ...this.watermark };
  }

  /** Choose the outline the Shapes tool draws. */
  setShapeKind(kind: ShapeKind): void {
    this.shapeKindValue = kind;
  }

  /** Current Shapes outline. */
  getShapeKind(): ShapeKind {
    return this.shapeKindValue;
  }

  setShadow(patch: Partial<ShadowStyle>): void {
    if (!patch || typeof patch !== "object") return;
    const next: ShadowStyle = { ...this.shadow };

    if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
    if (typeof patch.color === "string" && patch.color.trim()) {
      next.color = patch.color.trim();
    }
    if (typeof patch.blur === "number" && Number.isFinite(patch.blur)) {
      next.blur = Math.min(Math.max(Math.round(patch.blur), 0), MAX_SHADOW_BLUR);
    }
    if (typeof patch.offsetX === "number" && Number.isFinite(patch.offsetX)) {
      next.offsetX = Math.min(Math.max(Math.round(patch.offsetX), -MAX_SHADOW_OFFSET), MAX_SHADOW_OFFSET);
    }
    if (typeof patch.offsetY === "number" && Number.isFinite(patch.offsetY)) {
      next.offsetY = Math.min(Math.max(Math.round(patch.offsetY), -MAX_SHADOW_OFFSET), MAX_SHADOW_OFFSET);
    }

    if (JSON.stringify(next) === JSON.stringify(this.shadow)) return;
    this.shadow = next;
    // Live retune: the controls must affect the CURRENT selection too, not
    // only annotations drawn afterwards — drawing a shape and then reaching
    // for the shadow sliders is the natural order, and it used to do nothing.
    if (!this.retuneShadowSelection()) this.notify();
  }

  /** Apply the live shadow style to selected annotations. True if any. */
  private retuneShadowSelection(): boolean {
    if (this.restoring) return false;
    const targets = this.canvas
      .getActiveObjects()
      .filter(
        (o) =>
          o !== this.image &&
          !isBlurRegion(o) &&
          !isSpotlightRegion(o) &&
          !isHighlighterRegion(o) &&
          !isMagnifyRegion(o),
      );
    if (!targets.length) return false;
    const shadow = shadowFromStyle(this.shadow) ?? null;
    for (const target of targets) {
      target.shadow = shadow;
      target.dirty = true;
    }
    this.commit();
    this.canvas.requestRenderAll();
    this.notify();
    return true;
  }

  /** A copy of the live shadow style (safe for a preset to hold on to). */
  getShadow(): ShadowStyle {
    return { ...this.shadow };
  }

  /* ------------------------------------------------ quick text bar bridge */

  /** The caption currently being edited or selected, if any. */
  getActiveText(): fabric.Textbox | fabric.IText | null {
    const active = this.canvas.getActiveObject();
    if (active instanceof fabric.Textbox || active instanceof fabric.IText) return active;
    return null;
  }

  /** Upper canvas element — coordinate anchor for canvas-adjacent overlays. */
  getOverlayAnchor(): HTMLCanvasElement | null {
    return this.canvas.upperCanvasEl ?? null;
  }

  /** Whether an object is still part of the scene (quick-bar lifecycle). */
  hasObject(object: unknown): boolean {
    return this.canvas.getObjects().includes(object as fabric.FabricObject);
  }

  /**
   * Subscribe to everything that can move or change the active text context
   * (render, selection, editing, removal). Returns an unsubscribe function.
   */
  onTextContextChange(callback: () => void): () => void {
    const events: (keyof fabric.CanvasEvents)[] = [
      "after:render",
      "selection:created",
      "selection:updated",
      "selection:cleared",
      "text:editing:entered",
      "text:editing:exited",
      "object:removed",
    ];
    for (const event of events) this.canvas.on(event, callback);
    return () => {
      for (const event of events) this.canvas.off(event, callback);
    };
  }

  /** Record a style change made directly on an object (the quick bar). */
  commitTextStyles(): void {
    this.commit();
    this.canvas.requestRenderAll();
    this.notify();
  }

  /** Apply the current mode/radius to selected blur regions. True if any. */
  private retuneBlurSelection(): boolean {
    if (this.restoring) return false;
    const targets = this.canvas.getActiveObjects().filter(isBlurRegion);
    if (!targets.length) return false;
    for (const region of targets) {
      region.mode = this.blurMode;
      region.radius = this.blurRadius;
      const preview = blurRegionPreview(region.mode);
      region.set({ fill: preview.fill, stroke: preview.stroke });
      region.dirty = true;
    }
    this.commit();
    this.canvas.requestRenderAll();
    return true;
  }

  /** True once the canvas holds any state beyond the freshly loaded capture. */
  isDirty(): boolean {
    return this.cursor > 0;
  }

  /** Snapshot of the current ink settings (the shell saves this as a preset). */
  getStyle(): EditorStyle {
    return {
      color: this.inkColor,
      strokeWidth: this.inkWidth,
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      bold: this.textBold,
      italic: this.textItalic,
      blurMode: this.blurMode,
      blurRadius: this.blurRadius,
      shadow: this.getShadow(),
    };
  }

  /**
   * Restore a preset. Only the fields present in `style` are applied, each
   * through its normal validating setter (so out-of-range or junk values from
   * stored presets are clamped/ignored), and one change event is emitted when
   * anything actually moved. Existing annotations are never recoloured.
   */
  applyStyle(style: Partial<EditorStyle> | null | undefined): void {
    if (!style || typeof style !== "object") return;

    const isInk = (value: unknown): value is string =>
      typeof value === "string" && value.trim().length > 0;
    const isNumber = (value: unknown): value is number =>
      typeof value === "number" && Number.isFinite(value);

    const before = JSON.stringify(this.getStyle());

    if (isInk(style.color)) this.setColor(style.color);
    if (isNumber(style.strokeWidth)) this.setStrokeWidth(style.strokeWidth);
    if (isInk(style.fontFamily)) this.setFontFamily(style.fontFamily);
    if (isNumber(style.fontSize)) this.setFontSize(style.fontSize);
    if (typeof style.bold === "boolean") this.setTextBold(style.bold);
    if (typeof style.italic === "boolean") this.setTextItalic(style.italic);
    if (style.blurMode) this.setBlurMode(style.blurMode);
    if (isNumber(style.blurRadius)) this.setBlurRadius(style.blurRadius);
    if (style.shadow && typeof style.shadow === "object") this.setShadow(style.shadow);

    // The setters above already notify; this covers the no-op-but-changed case
    // (e.g. a preset that only matched already-active values) exactly once.
    if (JSON.stringify(this.getStyle()) !== before) this.notify();
  }

  /** Font family for new captions. Existing captions keep their own. */
  setFontFamily(fontFamily: string): void {
    if (typeof fontFamily !== "string") return;
    const next = fontFamily.trim();
    if (!next) return;
    this.fontFamily = next;
    this.notify();
  }

  getFontFamily(): string {
    return this.fontFamily;
  }

  /** Caption font size for new text, clamped to 8..200 and rounded. */
  setFontSize(size: number): void {
    if (typeof size !== "number" || !Number.isFinite(size)) return;
    const clamped = Math.min(Math.max(size, MIN_FONT_SIZE), MAX_FONT_SIZE);
    this.fontSize = Math.round(clamped);
    this.notify();
  }

  getFontSize(): number {
    return this.fontSize;
  }

  setTextBold(bold: boolean): void {
    if (this.textBold === !!bold) return;
    this.textBold = !!bold;
    this.notify();
  }

  isTextBold(): boolean {
    return this.textBold;
  }

  setTextItalic(italic: boolean): void {
    if (this.textItalic === !!italic) return;
    this.textItalic = !!italic;
    this.notify();
  }

  isTextItalic(): boolean {
    return this.textItalic;
  }

  /* ------------------------------------------------------- unified tool size */

  /**
   * Size range for the ACTIVE tool, or null when the tool has no size
   * (select, crop, bucket). `step` is the increment the UI should use.
   */
  getToolSizeRange(): ToolSizeRange | null {
    const range = TOOL_SIZE_RANGES[this.tool];
    return range ? { ...range } : null;
  }

  /** Active tool's size — 0 for tools without one (check getToolSizeRange). */
  getToolSize(): number {
    switch (this.tool) {
      case "brush":
        return this.brushWidth;
      case "arrow":
      case "shape":
        return this.inkWidth;
      case "text":
        return this.fontSize;
      case "blur":
        return this.blurRadius;
      case "step":
        return this.stepSize;
      case "callout":
        return this.calloutFontSize;
      case "spotlight":
      case "highlighter":
        return this.regionThickness;
      case "magnify":
        return this.magnifyZoom;
      default:
        return 0;
    }
  }

  /**
   * Set the active tool's size, snapped to the tool's range. Routed through the
   * specific setters where one exists, so getToolSize() and getStrokeWidth() /
   * getFontSize() / getBlurRadius() can never disagree.
   */
  setToolSize(size: number): void {
    if (typeof size !== "number" || !Number.isFinite(size)) return;
    const range = TOOL_SIZE_RANGES[this.tool];
    if (!range) return;
    const value = clampToRange(size, range);

    switch (this.tool) {
      case "brush":
        this.brushWidth = Math.round(value);
        this.syncBrushCursor();
        break;
      case "step":
        this.stepSize = Math.round(value);
        break;
      case "callout":
        this.calloutFontSize = Math.round(value);
        break;
      case "arrow":
      case "shape":
        this.setStrokeWidth(value);
        return;
      case "text":
        this.setFontSize(value);
        return;
      case "blur":
        this.setBlurRadius(value);
        return;
      case "spotlight":
      case "highlighter": {
        const changed = this.regionThickness !== value;
        this.regionThickness = value;
        if (this.retuneRegionSelection()) return;
        if (changed) this.notify();
        return;
      }
      case "magnify": {
        const zoom = clampMagnifyZoom(value);
        const changed = this.magnifyZoom !== zoom;
        this.magnifyZoom = zoom;
        if (this.retuneLensSelection()) return;
        if (changed) this.notify();
        return;
      }
      default:
        return;
    }
    this.notify();
  }

  /** Apply the active thickness to selected spotlight/highlighter regions. */
  private retuneRegionSelection(): boolean {
    if (this.restoring) return false;
    const targets = this.canvas
      .getActiveObjects()
      .filter((object) => isSpotlightRegion(object) || isHighlighterRegion(object));
    if (!targets.length) return false;
    for (const region of targets) {
      if (!isSpotlightRegion(region) && !isHighlighterRegion(region)) continue;
      region.thickness = this.regionThickness;
      region.set({
        // Spotlight paints its edge itself; the highlighter's edge is its stroke.
        strokeWidth: isHighlighterRegion(region) ? this.regionThickness : 0,
        strokeUniform: true,
      });
      region.dirty = true;
    }
    this.commit();
    this.canvas.requestRenderAll();
    return true;
  }

  /**
   * Apply the active zoom to selected lenses. A lens paints its own pixels, so
   * a new `zoom` shows up on the very next frame — the slider is live.
   */
  private retuneLensSelection(): boolean {
    if (this.restoring) return false;
    const targets = this.canvas.getActiveObjects().filter(isMagnifyRegion);
    if (!targets.length) return false;
    for (const lens of targets) {
      lens.zoom = this.magnifyZoom;
      lens.dirty = true;
    }
    this.commit();
    this.canvas.requestRenderAll();
    return true;
  }

  /* ----------------------------------------------------------- image resize */

  /** Natural (pixel) size of the loaded screenshot; 0x0 before load(). */
  getImageSize(): { width: number; height: number } {
    if (!this.image) return { width: 0, height: 0 };
    return {
      width: Math.max(1, Math.round(this.natural.width)),
      height: Math.max(1, Math.round(this.natural.height)),
    };
  }

  /**
   * Re-sample the screenshot to `width` x `height` pixels (each clamped to >= 1).
   *
   * The new pixels are drawn from the ORIGINAL capture, so repeated resizes do
   * not compound re-encodes. Annotations and the crop follow the image's new
   * on-screen box (layout() rebases them about the image origin), the natural
   * size is updated, and the change is committed, so undo restores both the
   * pixels and the annotation geometry.
   */
  resizeImage(width: number, height: number): void {
    if (this.destroyed || this.restoring) return;
    if (!this.image || !this.base) return;
    if (typeof width !== "number" || typeof height !== "number") return;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;

    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    if (
      nextWidth === Math.round(this.natural.width) &&
      nextHeight === Math.round(this.natural.height)
    ) {
      return;
    }

    const rebuilt = this.buildImage(nextWidth, nextHeight);
    if (!rebuilt) return;

    // Park the new layer where the old one sits; layout() then rescales the ink
    // from the old display box to the new one.
    const previous = this.imageBox();
    rebuilt.image.set({
      left: previous.left,
      top: previous.top,
      scaleX: previous.width / nextWidth,
      scaleY: previous.height / nextHeight,
    });
    rebuilt.image.setCoords();

    const stale = this.image;
    this.canvas.remove(stale);
    this.canvas.insertAt(0, rebuilt.image);
    this.image = rebuilt.image;
    this.natural = { width: nextWidth, height: nextHeight };
    this.sourceDataUrl = rebuilt.dataUrl;

    this.layout(true);
    this.applyInteractivity();
    this.commit();
    this.canvas.requestRenderAll();
  }

  /** Screenshot flags: never selectable, never serialized into history. */
  private configureImage(image: fabric.FabricImage): fabric.FabricImage {
    image.set({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      hoverCursor: "default",
      lockMovementX: true,
      lockMovementY: true,
      lockRotation: true,
      // The screenshot is placed through its own transform and is never part of
      // the serialized history (a capture can be many megabytes).
      excludeFromExport: true,
    });
    return image;
  }

  /** Re-sample the base capture at `width` x `height` as a fresh image layer. */
  private buildImage(
    width: number,
    height: number,
  ): { image: fabric.FabricImage; dataUrl: string } | null {
    const base = this.base;
    if (!base) return null;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    try {
      context.drawImage(base, 0, 0, canvas.width, canvas.height);
    } catch {
      return null;
    }

    const image = this.configureImage(new fabric.FabricImage(canvas));
    return { image, dataUrl: canvas.toDataURL("image/png") };
  }

  /* --------------------------------------------------------------- tool glue */

  private currentTool(): Tool {
    let tool = this.tools.get(this.tool);
    if (!tool) {
      tool = createTool(this.tool, this.host);
      this.tools.set(this.tool, tool);
    }
    return tool;
  }

  private pointOf(event: fabric.TPointerEventInfo): Point {
    const point = this.canvas.getScenePoint(event.e);
    return { x: point.x, y: point.y };
  }

  /** Ctrl/Cmd + wheel zooms the canvas around the pointer. */
  private readonly onWheel = (event: fabric.TPointerEventInfo): void => {
    const e = event.e as WheelEvent;
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.zoomBy(factor, { x: e.offsetX, y: e.offsetY });
  };

  /** Multiply the viewport zoom, keeping `screenPoint` (canvas px) fixed. */
  zoomBy(factor: number, screenPoint?: { x: number; y: number }): void {
    const current = this.canvas.getZoom();
    const next = Math.min(8, Math.max(0.4, current * factor));
    if (Math.abs(next - current) < 1e-4) return;
    const pivot = screenPoint
      ? new fabric.Point(screenPoint.x, screenPoint.y)
      : this.canvas.getCenterPoint();
    this.canvas.zoomToPoint(pivot, next);
    this.canvas.requestRenderAll();
  }

  /** Reset the viewport (zoom + pan) to 1:1, e.g. after loading a new capture. */
  resetZoom(): void {
    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    this.canvas.requestRenderAll();
  }

  /** True when `point` (scene space) falls inside the object, incl. a margin. */
  private hitTest(object: fabric.FabricObject, point: Point, margin = 0): boolean {
    const box = object.getBoundingRect();
    return (
      point.x >= box.left - margin &&
      point.x <= box.left + box.width + margin &&
      point.y >= box.top - margin &&
      point.y <= box.top + box.height + margin
    );
  }

  private beginTextDrag(object: fabric.IText, point: Point): void {
    this.textDrag = {
      object,
      start: point,
      left: object.left ?? 0,
      top: object.top ?? 0,
      moved: false,
    };
  }

  /** Apply the drag delta; returns true when the pointer actually moved. */
  private moveTextDrag(point: Point): boolean {
    const drag = this.textDrag;
    if (!drag) return false;
    if (!drag.object.isEditing || !this.canvas.getObjects().includes(drag.object)) {
      this.textDrag = null;
      return false;
    }
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < TEXT_DRAG_THRESHOLD) return false;
    drag.moved = true;
    drag.object.set({ left: drag.left + dx, top: drag.top + dy });
    drag.object.setCoords();
    this.canvas.requestRenderAll();
    return true;
  }

  private endTextDrag(): void {
    const drag = this.textDrag;
    this.textDrag = null;
    if (!drag || !drag.moved) return;
    drag.object.setCoords();
    this.canvas.requestRenderAll();
    // The caption is still being edited; its position lands in history when it
    // settles (click away / Escape / undo), so no extra commit here.
  }

  /**
   * Snapshot, taken before fabric sees the event, of whether a caption was
   * being edited. Fabric settles a live caption itself when the click lands
   * outside it, so by the time our mouse:down handler runs that caption is
   * already gone — this flag tells "this click dismissed a caption" apart from
   * "start a new one".
   */
  private readonly onPointerDownCapture = (): void => {
    const active = this.canvas.getActiveObject();
    this.captionAtPointerDown =
      this.tool === "text" &&
      active instanceof fabric.IText &&
      active.isEditing;
  };

  private readonly onMouseDown = (event: fabric.TPointerEventInfo): void => {
    if (this.destroyed || this.restoring) return;
    if (this.tool === "select") return;
    const point = this.pointOf(event);
    const dismissedCaption = this.captionAtPointerDown;
    this.captionAtPointerDown = false;
    const active = this.canvas.getActiveObject();
    if (active instanceof fabric.IText && active.isEditing) {
      if (this.hitTest(active, point, 6)) {
        // Grab the live caption: a drag repositions it, a plain click still
        // drops the caret where the user clicked.
        this.beginTextDrag(active, point);
        return;
      }
      // Click outside: settle the caption (an untouched placeholder is
      // dropped, typed text is committed). The next click starts a new one.
      active.exitEditing();
      return;
    }
    // Fabric settled the caption while handling this very click — that click
    // closed the caption, it should not immediately open a fresh one.
    if (dismissedCaption) return;
    this.currentTool().onPointerDown(point, event.e);
  };

  private readonly onMouseMove = (event: fabric.TPointerEventInfo): void => {
    if (this.destroyed || this.restoring) return;
    const point = this.pointOf(event);
    if (this.tool === "brush") this.moveBrushCursor(point);
    if (this.textDrag) {
      this.moveTextDrag(point);
      return;
    }
    if (this.tool === "select") return;
    this.currentTool().onPointerMove(point);
  };

  private readonly onMouseUp = (event: fabric.TPointerEventInfo): void => {
    if (this.destroyed || this.restoring) return;
    if (this.textDrag) {
      this.endTextDrag();
      return;
    }
    if (this.tool === "select") return;
    this.currentTool().onPointerUp(this.pointOf(event));
  };

  private readonly onObjectModified = (): void => {
    this.commit();
  };

  private readonly onMouseOut = (): void => {
    this.hideBrushCursor();
  };

  private readonly onPointerLeave = (): void => {
    this.hideBrushCursor();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.destroyed) return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    // Undo/redo first: while a caption is being edited the keystroke is aimed
    // at fabric's hidden textarea, whose own Ctrl+Z would swallow it. Settle
    // the caption, then undo the canvas history.
    if (modifier && (key === "z" || key === "y")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const redo = key === "y" || event.shiftKey;
      const active = this.canvas.getActiveObject();
      if (active instanceof fabric.IText && active.isEditing) {
        const before = this.cursor;
        active.exitEditing(); // settle: commits real text, drops a placeholder
        if (this.cursor !== before && !redo) {
          // The caption just landed on the stack: one Ctrl+Z removes it.
          this.undo();
        } else if (this.cursor === before) {
          // Nothing was committed, so there is nothing of ours to undo — do
          // not silently roll back the user's previous action.
          this.canvas.discardActiveObject();
          this.canvas.requestRenderAll();
        }
        return;
      }
      if (redo) this.redo();
      else this.undo();
      return;
    }

    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }

    const active = this.canvas.getActiveObject();
    if (active instanceof fabric.IText && active.isEditing) return;
    if (event.key === "Escape") {
      if (this.currentTool().onEscape()) {
        event.preventDefault();
        return;
      }
      if (this.tool === "crop" && this.cropBox) {
        event.preventDefault();
        this.setCrop(null);
        return;
      }
      if (this.canvas.getActiveObject()) {
        event.preventDefault();
        this.canvas.discardActiveObject();
        this.canvas.requestRenderAll();
      }
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      const targets = this.canvas
        .getActiveObjects()
        .filter((object) => !object.excludeFromExport);
      if (!targets.length) return;
      event.preventDefault();
      this.canvas.discardActiveObject();
      for (const object of targets) this.canvas.remove(object);
      this.commit();
      this.canvas.requestRenderAll();
    }
  };

  /* ---------------------------------------------------------- object plumbing */

  private addObject(object: fabric.FabricObject): void {
    this.canvas.add(object);
    this.applyInteractivity(object);
    // A lens added by the tool must composite immediately — waiting for the
    // first commit would show the bare screenshot mid-drag.
    if (isMagnifyRegion(object)) {
      object.composer = () => this.lensComposite(object);
    }
  }

  private removeObject(object: fabric.FabricObject): void {
    this.chrome.delete(object);
    if (isMagnifyRegion(object)) this.lensCanvases.delete(object);
    this.canvas.remove(object);
  }

  /**
   * Rebuild every blur region's live snapshot from the current background, so
   * the canvas shows the actual blur/pixelate/blackout instead of a placeholder.
   */
  private refreshBlurPreviews(): void {
    const regions = this.canvas.getObjects().filter(isBlurRegion);
    if (!regions.length) return;
    for (const region of regions) {
      region.snapshot = this.blurSnapshot(region);
    }
    this.canvas.requestRenderAll();
  }

  /** Sample the capture under `region`, apply its effect, return the patch. */
  private blurSnapshot(region: BlurRegion): HTMLCanvasElement | null {
    const base = this.base;
    if (!base) return null;
    const box = this.imageBox();
    if (box.width < 1 || box.height < 1) return null;
    const scaleX = box.width / this.natural.width;
    const scaleY = box.height / this.natural.height;
    const scene = region.getBoundingRect();
    const sx = (scene.left - box.left) / scaleX;
    const sy = (scene.top - box.top) / scaleY;
    const sw = scene.width / scaleX;
    const sh = scene.height / scaleY;
    if (sw < 1 || sh < 1) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(4096, Math.max(1, Math.round(sw)));
    canvas.height = Math.min(4096, Math.max(1, Math.round(sh)));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(base, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    applyBlurRegion(
      canvas,
      { x: 0, y: 0, width: canvas.width, height: canvas.height },
      region.mode,
      Math.max(1, region.radius / scaleX),
    );
    return canvas;
  }

  private bounds(): Box {
    return {
      left: 0,
      top: 0,
      width: this.canvas.getWidth(),
      height: this.canvas.getHeight(),
    };
  }

  /** Pointer clamp: draw inside the screenshot, not into the letterbox. */
  private drawBounds(): Box {
    if (!this.image) return this.bounds();
    return this.imageBox();
  }

  /** The screenshot's source data + scene transform (bucket sampling). */
  private imageInfo(): ImageInfo | null {
    const image = this.image;
    if (!image || !this.sourceDataUrl) return null;
    return {
      dataUrl: this.sourceDataUrl,
      natural: { width: this.natural.width, height: this.natural.height },
      left: image.left,
      top: image.top,
      scaleX: image.scaleX,
      scaleY: image.scaleY,
    };
  }

  /* --------------------------------------------------------------- magnify */

  /**
   * The screenshot layer a magnify lens samples. It is the FabricImage's own
   * element (an <img> for a fresh capture, a canvas after a resize), i.e. the
   * pixels at native resolution; the object's scale only affects how the
   * canvas displays them.
   */
  private magnifySource(): HTMLImageElement | HTMLCanvasElement | null {
    const element = this.image?.getElement() ?? null;
    if (!element || element instanceof HTMLVideoElement) return null;
    return element;
  }

  /** Top-left corner of the screenshot, in canvas (scene) coordinates. */
  private magnifyOrigin(): { left: number; top: number } {
    const box = this.imageBox();
    return { left: box.left, top: box.top };
  }

  /**
   * Re-attach the screenshot to every lens. `source` and `background` are
   * deliberately not serialized (a lens in the undo JSON must not carry a
   * multi-megabyte image), so a restored or re-laid-out lens has to be handed
   * the current layer and placement again — otherwise it would only draw its
   * frame. Called on load/undo/zoom/resize, like `refreshBlurPreviews`.
   */
  private refreshMagnifySources(): void {
    const lenses = this.canvas.getObjects().filter(isMagnifyRegion);
    if (!lenses.length) return;
    const source = this.magnifySource();
    const origin = this.magnifyOrigin();
    const scaleX = this.image?.scaleX ?? 1;
    const scaleY = this.image?.scaleY ?? 1;
    for (const lens of lenses) {
      lens.source = source;
      lens.background = { left: origin.left, top: origin.top, scaleX, scaleY };
      // What the lens actually draws: the same grid, with everything the user
      // has drawn below it burned in. Built lazily on the next render.
      lens.composer = () => this.lensComposite(lens);
      lens.dirty = true;
    }
    // Drop caches for lenses that are no longer in the scene.
    for (const stale of this.lensCanvases.keys()) {
      if (!lenses.includes(stale)) this.lensCanvases.delete(stale);
    }
    this.markLensDirty();
  }

  /** Any scene change makes every cached lens composite stale. */
  private markLensDirty(): void {
    this.lensVersion += 1;
  }

  /**
   * Canvas-event hook: a moved/scaled lens does not change the content under
   * it (only which region it samples), so lens-only drags skip the rebuild —
   * the expensive case, since it runs on every pointer frame.
   */
  private readonly onLensContentChange = (event?: unknown): void => {
    const target = (event as { target?: fabric.FabricObject } | undefined)?.target;
    if (target && isMagnifyRegion(target)) {
      const lenses = this.canvas.getObjects().filter(isMagnifyRegion);
      // Another lens can sit above this one and composite it, so only skip the
      // rebuild when this is the sole lens in the scene.
      if (lenses.length <= 1) return;
    }
    this.markLensDirty();
  };

  /**
   * The pixels a lens should magnify: the capture with every object stacked
   * *below* that lens rendered on top — i.e. the working composite, so arrows,
   * shapes and captions appear inside the lens instead of a bare screenshot.
   *
   * Rendered in image-pixel space (one canvas px = one captured px), which is
   * the same grid `source` uses: the lens' centre/zoom maths is untouched, the
   * live canvas and `flatten()` therefore agree, and viewport zoom/pan can
   * never invalidate the cache. Objects *above* the lens stay out, so z-order
   * semantics still hold (the lens magnifies what is under it).
   */
  private lensComposite(lens: MagnifyRegion): HTMLCanvasElement | null {
    const image = this.image;
    if (!image) return null;
    const { width, height } = this.natural;
    if (width <= 0 || height <= 0) return null;

    const cached = this.lensCanvases.get(lens);
    if (cached && cached.version === this.lensVersion && cached.canvas.width === width && cached.canvas.height === height) {
      return cached.canvas;
    }

    const canvas =
      cached && cached.canvas.width === width && cached.canvas.height === height
        ? cached.canvas
        : document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;

    const place = lens.background;
    const scaleX = place?.scaleX || image.scaleX || 1;
    const scaleY = place?.scaleY || image.scaleY || 1;
    const left = place?.left ?? image.left ?? 0;
    const top = place?.top ?? image.top ?? 0;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    // Scene coordinates → image pixels (object.render applies its own matrix).
    context.setTransform(1 / scaleX, 0, 0, 1 / scaleY, -left / scaleX, -top / scaleY);

    // Objects are sorted bottom-to-top: everything before the lens is "below".
    const below: fabric.FabricObject[] = [];
    for (const object of this.canvas.getObjects()) {
      if (object === lens) break;
      if (object.visible === false || this.chrome.has(object)) continue;
      below.push(object);
    }

    const skipOffscreen = this.canvas.skipOffscreen;
    // Objects scrolled out of the viewport must still land in the composite.
    this.canvas.skipOffscreen = false;
    try {
      for (const object of below) {
        context.save();
        object.render(context);
        context.restore();
      }
    } finally {
      this.canvas.skipOffscreen = skipOffscreen;
    }

    this.lensCanvases.set(lens, { version: this.lensVersion, canvas });
    lens.dirty = true;
    return canvas;
  }

  /** Typography the text tool should use for a new caption. */
  private textStyle(): TextStyle {
    return {
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      fontWeight: this.textBold ? "bold" : "normal",
      fontStyle: this.textItalic ? "italic" : "normal",
    };
  }

  private nextStepNumber(): number {
    let highest = 0;
    for (const object of this.canvas.getObjects()) {
      if (!(object instanceof fabric.Group)) continue;
      for (const child of object.getObjects()) {
        if (!(child instanceof fabric.Text)) continue;
        const value = Number.parseInt((child.text ?? "").trim(), 10);
        if (!Number.isNaN(value) && value > highest) highest = value;
      }
    }
    return highest + 1;
  }

  /** Enable fabric's own select/move only for annotations, only with the select tool. */
  private applyInteractivity(only?: fabric.FabricObject): void {
    const selecting = this.tool === "select";
    this.canvas.selection = selecting;
    this.canvas.skipTargetFind = !selecting;

    const objects = only ? [only] : this.canvas.getObjects();
    for (const object of objects) {
      const interactive = selecting && !object.excludeFromExport;
      object.selectable = interactive;
      object.evented = interactive;
      object.hoverCursor = interactive ? "move" : "default";
    }

    if (!selecting) this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
  }

  /* ------------------------------------------------------ brush footprint */

  /**
   * The brush preview circle: editor-only chrome like the crop shading —
   * unselectable, never a pointer target, excluded from export and from history
   * (fabric's serializer skips excludeFromExport objects). Its diameter is the
   * live brush width in scene px, i.e. exactly the footprint of the next stroke.
   */
  private brushCursorObject(): fabric.Circle {
    const existing = this.brushCursor;
    if (existing) return existing;
    const cursor = new fabric.Circle({
      left: 0,
      top: 0,
      radius: Math.max(1, this.brushWidth) / 2,
      originX: "center",
      originY: "center",
      fill: tint(this.inkColor, 0.18),
      stroke: this.inkColor,
      strokeWidth: 1,
      strokeUniform: true,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      excludeFromExport: true,
      objectCaching: false,
      hoverCursor: "crosshair",
    });
    this.brushCursor = cursor;
    return cursor;
  }

  /** Re-apply brush width + ink colour to the preview. */
  private retuneBrushCursor(cursor: fabric.Circle): void {
    cursor.set({
      radius: Math.max(1, this.brushWidth) / 2,
      fill: tint(this.inkColor, 0.18),
      stroke: this.inkColor,
    });
    cursor.setCoords();
  }

  /** Park the preview on a scene point, above everything else. */
  private moveBrushCursor(point: Point): void {
    if (this.tool !== "brush") return;
    const canvas = this.canvas;
    const cursor = this.brushCursorObject();
    this.retuneBrushCursor(cursor);
    cursor.set({ left: point.x, top: point.y });
    cursor.setCoords();
    if (!canvas.getObjects().includes(cursor)) canvas.add(cursor);
    canvas.bringObjectToFront(cursor);
    this.brushCursorVisible = true;
    canvas.requestRenderAll();
  }

  /** Take the preview off the canvas (pointer left / tool changed). */
  private hideBrushCursor(): void {
    this.brushCursorVisible = false;
    const cursor = this.brushCursor;
    if (!cursor) return;
    if (this.canvas.getObjects().includes(cursor)) this.canvas.remove(cursor);
    this.canvas.requestRenderAll();
  }

  /** Keep the preview alive across undo/redo, and drop it when not brushing. */
  private syncBrushCursor(): void {
    if (this.tool !== "brush") {
      this.hideBrushCursor();
      return;
    }
    if (!this.brushCursorVisible) return;
    const cursor = this.brushCursorObject();
    this.retuneBrushCursor(cursor);
    if (!this.canvas.getObjects().includes(cursor)) this.canvas.add(cursor);
    this.canvas.bringObjectToFront(cursor);
    this.canvas.requestRenderAll();
  }

  /* ------------------------------------------------------------------- crop */

  private setCrop(box: Box | null): void {
    if (this.restoring) return;
    if (!box) {
      if (!this.cropBox) return;
      this.cropBox = null;
      this.renderCropOverlay();
      this.commit();
      this.canvas.requestRenderAll();
      return;
    }
    const clamped = this.clampToImage(box);
    if (clamped.width < MIN_SIZE || clamped.height < MIN_SIZE) return;
    this.cropBox = clamped;
    this.renderCropOverlay();
    this.commit();
    this.canvas.requestRenderAll();
  }

  private clampToImage(box: Box): Box {
    const limit = this.imageBox();
    const left = Math.max(box.left, limit.left);
    const top = Math.max(box.top, limit.top);
    const right = Math.min(box.left + box.width, limit.left + limit.width);
    const bottom = Math.min(box.top + box.height, limit.top + limit.height);
    return {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  }

  private renderCropOverlay(): void {
    for (const object of this.chrome) this.canvas.remove(object);
    this.chrome.clear();

    const crop = this.cropBox;
    if (!crop) return;

    const width = this.canvas.getWidth();
    const height = this.canvas.getHeight();
    const bands: Box[] = [
      { left: 0, top: 0, width, height: crop.top },
      {
        left: 0,
        top: crop.top + crop.height,
        width,
        height: height - (crop.top + crop.height),
      },
      { left: 0, top: crop.top, width: crop.left, height: crop.height },
      {
        left: crop.left + crop.width,
        top: crop.top,
        width: width - (crop.left + crop.width),
        height: crop.height,
      },
    ];

    for (const band of bands) {
      if (band.width <= 0 || band.height <= 0) continue;
      const shade = new fabric.Rect({
        left: band.left,
        top: band.top,
        width: band.width,
        height: band.height,
        originX: "left",
        originY: "top",
        fill: "rgba(8, 10, 14, 0.55)",
        strokeWidth: 0,
        selectable: false,
        evented: false,
        excludeFromExport: true,
        objectCaching: false,
      });
      this.chrome.add(shade);
      this.canvas.add(shade);
    }

    const frame = new fabric.Rect({
      left: crop.left,
      top: crop.top,
      width: crop.width,
      height: crop.height,
      originX: "left",
      originY: "top",
      fill: "transparent",
      stroke: ACCENT,
      strokeWidth: 2,
      strokeDashArray: [10, 6],
      selectable: false,
      evented: false,
      excludeFromExport: true,
      objectCaching: false,
    });
    this.chrome.add(frame);
    this.canvas.add(frame);
  }

  /* ----------------------------------------------------------------- layout */

  private imageBox(): Box {
    const image = this.image;
    if (!image) return this.bounds();
    return {
      left: image.left,
      top: image.top,
      width: (image.width ?? this.natural.width) * image.scaleX,
      height: (image.height ?? this.natural.height) * image.scaleY,
    };
  }

  private imageBoxFor(width: number, height: number): Box {
    return fitBox(this.natural, { left: 0, top: 0, width, height }, PADDING);
  }

  private layout(force = false): void {
    if (this.destroyed) return;
    const measuredWidth = Math.round(this.container.clientWidth);
    const measuredHeight = Math.round(this.container.clientHeight);
    const width = measuredWidth > 0 ? measuredWidth : Math.max(1, this.canvas.getWidth());
    const height = measuredHeight > 0 ? measuredHeight : Math.max(1, this.canvas.getHeight());

    if (!force && width === this.canvas.getWidth() && height === this.canvas.getHeight()) {
      return;
    }

    const image = this.image;
    if (!image) {
      this.canvas.setDimensions({ width, height });
      this.canvas.calcOffset();
      this.canvas.requestRenderAll();
      return;
    }

    const previous = this.imageBox();
    this.canvas.setDimensions({ width, height });
    this.canvas.calcOffset();

    const next = this.imageBoxFor(width, height);
    const scale = previous.width > 0 ? next.width / previous.width : 1;

    image.set({
      left: next.left,
      top: next.top,
      scaleX: next.width / this.natural.width,
      scaleY: next.height / this.natural.height,
    });
    image.setCoords();

    if (Math.abs(scale - 1) > 1e-6) {
      for (const object of this.canvas.getObjects()) {
        if (object === image) continue;
        const centre = object.getCenterPoint();
        const x = next.left + (centre.x - previous.left) * scale;
        const y = next.top + (centre.y - previous.top) * scale;
        object.scaleX *= scale;
        object.scaleY *= scale;
        object.setPositionByOrigin(new fabric.Point(x, y), "center", "center");
        object.setCoords();
        // Blur strength is authored in scene px, so it must follow the zoom too.
        if (isBlurRegion(object)) {
          object.radius = clampBlurRadius(object.radius * scale);
        }
      }
      const crop = this.cropBox;
      if (crop) {
        this.cropBox = {
          left: next.left + (crop.left - previous.left) * scale,
          top: next.top + (crop.top - previous.top) * scale,
          width: crop.width * scale,
          height: crop.height * scale,
        };
        this.renderCropOverlay();
      }
    }

    // Zoom/resize rescales the image, so the blur snapshots must be resampled.
    this.refreshBlurPreviews();
    // The screenshot moved/scaled: lens placements follow it.
    this.refreshMagnifySources();
    this.canvas.requestRenderAll();
  }

  /* ----------------------------------------------------------------- history */

  private resetHistory(): void {
    this.history = [
      {
        json: this.canvas.toObject() as Record<string, unknown>,
        crop: this.cropBox ? { ...this.cropBox } : null,
        natural: { ...this.natural },
      },
    ];
    this.cursor = 0;
    this.notify();
  }

  private commit(): void {
    if (this.destroyed || this.restoring) return;
    // Rebuild the live blur snapshots now the action is finalised: a blur box
    // drawn this drag only has a real size once the drag ends, so the snapshot
    // must be taken here rather than when the (1×1) region was first added.
    this.refreshBlurPreviews();
    // Lenses sample the screenshot by reference; keep that reference current.
    this.refreshMagnifySources();
    const json = this.canvas.toObject() as Record<string, unknown>;
    const crop = this.cropBox ? { ...this.cropBox } : null;
    const natural = { ...this.natural };
    // A single user action can reach commit() more than once (settling a
    // caption fires both the tool's own commit and object:modified). Never
    // stack the same state twice, or one Ctrl+Z would appear to do nothing.
    const current = this.history[this.cursor];
    if (
      current &&
      JSON.stringify(current.json) === JSON.stringify(json) &&
      JSON.stringify(current.crop) === JSON.stringify(crop) &&
      current.natural.width === natural.width &&
      current.natural.height === natural.height
    ) {
      this.notify();
      return;
    }
    this.history.length = this.cursor + 1;
    this.history.push({ json, crop, natural });
    while (this.history.length > MAX_HISTORY) this.history.shift();
    this.cursor = this.history.length - 1;
    this.notify();
  }

  private restore(): void {
    const entry = this.history[this.cursor];
    if (!entry) return;
    const json = JSON.parse(JSON.stringify(entry.json)) as Record<string, unknown>;
    const crop = entry.crop ? { ...entry.crop } : null;
    const natural = { ...entry.natural };
    this.restoring = true;
    this.pending = this.pending
      .then(() => this.applyEntry(json, crop, natural))
      .catch((error: unknown) => {
        this.restoring = false;
        console.error("SnagCraft: could not restore canvas state", error);
      });
    this.notify();
  }

  private async applyEntry(
    json: Record<string, unknown>,
    crop: Box | null,
    natural: { width: number; height: number },
  ): Promise<void> {
    if (this.destroyed) return;
    const canvas = this.canvas;
    canvas.discardActiveObject();

    // The screenshot is not part of the serialized state, so a restore that
    // changes the pixel density has to rebuild it at the recorded size first.
    const width = Math.max(1, Math.round(natural.width));
    const height = Math.max(1, Math.round(natural.height));
    if (
      width !== Math.round(this.natural.width) ||
      height !== Math.round(this.natural.height)
    ) {
      const rebuilt = this.buildImage(width, height);
      if (rebuilt) {
        this.image = rebuilt.image;
        this.natural = { width, height };
        this.sourceDataUrl = rebuilt.dataUrl;
      }
    }

    await canvas.loadFromJSON(json);
    this.chrome.clear();

    // loadFromJSON clears everything, including the screenshot object.
    const image = this.image;
    if (image) {
      if (!canvas.getObjects().includes(image)) canvas.insertAt(0, image);
      // Re-fit at the restored natural size: annotations keep the coordinates
      // they were authored in (same size + same container ⇒ same display box).
      const box = this.imageBoxFor(canvas.getWidth(), canvas.getHeight());
      image.set({
        left: box.left,
        top: box.top,
        scaleX: box.width / this.natural.width,
        scaleY: box.height / this.natural.height,
      });
      image.setCoords();
    }

    this.cropBox = crop ? this.clampToImage(crop) : null;
    this.applyInteractivity();
    this.renderCropOverlay();
    // loadFromJSON emptied the canvas: bring the brush footprint back if the
    // brush is mid-hover.
    this.syncBrushCursor();
    // Fresh regions from JSON carry no snapshot; rebuild them from the capture.
    this.refreshBlurPreviews();
    // Restored lenses carry no pixels either: hand them the screenshot again.
    this.refreshMagnifySources();
    canvas.requestRenderAll();
    this.restoring = false;
    this.notify();
  }

  /* ------------------------------------------------------------------ export */

  private outputBox(): Box {
    const crop = this.cropBox;
    if (crop) {
      const clamped = this.clampToImage(crop);
      if (clamped.width >= 1 && clamped.height >= 1) {
        return {
          left: Math.round(clamped.left),
          top: Math.round(clamped.top),
          width: Math.max(1, Math.round(clamped.width)),
          height: Math.max(1, Math.round(clamped.height)),
        };
      }
    }
    const image = this.imageBox();
    return {
      left: Math.round(image.left),
      top: Math.round(image.top),
      width: Math.max(1, Math.round(image.width)),
      height: Math.max(1, Math.round(image.height)),
    };
  }

  /** Export at (at least) the capture's native resolution. */
  private outputMultiplier(box: Box): number {
    const displayed = this.imageBox().width;
    if (displayed <= 0) return 1;
    const native = Math.min(Math.max(this.natural.width / displayed, 1), 4);
    const edge = Math.max(box.width, box.height);
    if (edge <= 0) return native;
    return Math.max(1, Math.min(native, MAX_EXPORT_EDGE / edge));
  }

  /**
   * Turn effect regions into real pixels on the flattened image layer, at
   * export resolution, in a fixed order: blur/redaction first, then the
   * highlighter tint, then the spotlight dimming (so the lit hole always shows
   * the finished region).
   */
  private applyEffects(
    layer: HTMLCanvasElement,
    effects: fabric.FabricObject[],
    box: Box,
    multiplier: number,
  ): void {
    if (!effects.length) return;
    const size = { width: layer.width, height: layer.height };
    const cache = new Map<fabric.FabricObject, DeviceRect>();
    const device = (object: fabric.FabricObject): DeviceRect => {
      const cached = cache.get(object);
      if (cached) return cached;
      const rect = toDevice(object.getBoundingRect(), box, multiplier, size);
      cache.set(object, rect);
      return rect;
    };

    const spotlights: DeviceRect[] = [];
    for (const object of effects) {
      const rect = device(object);
      if (isBlurRegion(object)) {
        // Radius is authored in scene px; scale it to the export pixel grid.
        applyBlurRegion(layer, rect, object.mode, Math.max(1, object.radius * multiplier));
      } else if (isHighlighterRegion(object)) {
        applyHighlighter(layer, rect, object.ink, object.alpha);
      } else if (isSpotlightRegion(object)) {
        spotlights.push(rect);
      }
    }

    if (spotlights.length) applySpotlight(layer, spotlights);

  }

  /* ------------------------------------------------------------------ events */

  private notify(): void {
    this.container.dispatchEvent(
      new CustomEvent("snagcraft:change", {
        bubbles: true,
        detail: {
          tool: this.tool,
          canUndo: this.canUndo(),
          canRedo: this.canRedo(),
        },
      }),
    );
  }
}