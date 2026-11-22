// SnagCraft — floating quick-capture widget.
//
// Two states in one frameless, transparent window:
//
//   COLLAPSED  a 46x64 glass tab ("flärp") — a vertical bookmark with the
//              unicorn mark and a breathing accent spine; idle, findable,
//              only 58x74 of screen taken. While a recording runs, the spine
//              breathes RED instead.
//   EXPANDED   the full pill: drag grip + Full + Region + Rec + fold + close.
//              Rec is the red record button; mid-take it becomes Stop.
//
// Hover (or click) on the tab expands it; leaving the widget collapses it after
// ~1.2s, as does the fold control. A capture always folds it back first.
//
// WINDOW PLUMBING IS DONE IN RUST, on purpose.
// The `default` capability is scoped to `windows: ["main"]` (see
// src-tauri/capabilities/default.json), so every `plugin:window|*` command is
// rejected from this webview with "not allowed by ACL" — that is exactly why
// `getCurrentWindow().startDragging()` never moved the widget, and why
// `data-tauri-drag-region` (which invokes the same `plugin:window|start_dragging`)
// did not either. Application commands are not ACL-gated, so all window calls
// travel through `widget_capture`, whose `mode` the backend dispatches:
//
//   invoke('widget_capture', { mode: 'full'     })  capture the whole screen
//   invoke('widget_capture', { mode: 'region'   })  pick a region
//   invoke('widget_capture', { mode: 'record'   })  start a screen recording
//   invoke('widget_capture', { mode: 'stop-record' })  end the running take
//   invoke('widget_capture', { mode: 'move'     })  native interactive move (drag)
//   invoke('widget_capture', { mode: 'expand'   })  grow the window to the pill
//   invoke('widget_capture', { mode: 'collapse' })  shrink the window to the tab
//   invoke('close_widget')                          hide this window
//
// The `data-tauri-drag-region` attributes are still set on the tab and the pill
// so the native path takes over unchanged if the widget is ever added to the
// capability; today the mousedown handler below is what actually moves it.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./widget.css";

const THEME_KEY = "snagcraft:theme";
const DRAG_ATTR = "data-tauri-drag-region";

/** Idle time before an expanded widget folds back into its tab. */
const COLLAPSE_DELAY = 1200;
/** Must stay >= the pill's fade-out in widget.css before the window shrinks. */
const FOLD_MS = 170;
/** Hover right after folding must not immediately re-expand (pointer is still
 *  sitting on the tab when the window snaps back). */
const HOVER_GUARD = 420;

type Theme = "light" | "dark";
type CaptureMode = "full" | "region";
type WidgetMode = CaptureMode | "record" | "stop-record" | "move" | "expand" | "collapse";

/* ------------------------------------------------------------------ theme */

function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

/* ------------------------------------------------------------------ icons */

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

// The SnagCraft unicorn — the exact mark used by the File trigger and the app
// icon (fill-based, 32x32). The tab's whole identity in 24px.
const ICON_UNICORN =
  `<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" focusable="false">` +
  `<path fill-rule="evenodd" d="M17.6 9.3 C 22.2 9.4 26 11.9 27.4 15.6 C 28 17.4 28.1 19.1 27.4 20.4 C 26.6 21.9 24.9 22.5 23.2 21.9 C 21.6 22.5 20.4 23.9 19.8 25.9 L 19.3 28.7 L 10.5 28.7 C 10.3 24.5 10.2 20.3 11.4 16.3 C 12.3 13.3 14.5 10.7 17.6 9.3 Z M 22.5 16.1 a 1.1 1.1 0 1 1 -2.2 0 a 1.1 1.1 0 1 1 2.2 0 Z"/>` +
  `<path d="M13.4 10.2 C 12.7 8.1 12.4 6.2 12.7 4.9 C 14.1 6.5 15.6 8.0 16.7 9.2 Z"/>` +
  `<path d="M17.9 9.5 L22.4 1.9 L20.1 10.4 Z"/></svg>`;

/** The accent spine shared by tab and pill (see widget.css). Pure decoration:
 *  pointer-events:none, so the surface underneath stays the drag handle. */
function spine(): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "w-spine";
  el.setAttribute("aria-hidden", "true");
  return el;
}

const ICON_FULL = svg(
  `<rect x="2.5" y="4" width="19" height="12.5" rx="1.8"/>` +
    `<path d="M8.5 20.5h7"/><path d="M12 16.5v4"/>`
);

const ICON_REGION = svg(
  `<path d="M6.5 2.5v15a2 2 0 0 0 2 2h13"/>` +
    `<path d="M2.5 6.5h15a2 2 0 0 1 2 2v13"/>`
);

// Record: the classic filled dot; Stop: the filled square. Both render in the
// record red via .w-btn--rec (widget.css).
const ICON_REC =
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
  `<circle cx="12" cy="12" r="7" fill="currentColor"/></svg>`;
const ICON_STOP =
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
  `<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor"/></svg>`;

// Fold: the pill retreats back into its tab. A double chevron reads as
// "collapse"; the old arrow-with-tail read as "back/undo".
const ICON_FOLD = svg(`<path d="M11.5 5.5L5 12l6.5 6.5"/><path d="M18.5 5.5L12 12l6.5 6.5"/>`);

const ICON_CLOSE = svg(`<path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/>`);

/* ------------------------------------------------------------------- build */

function button(opts: {
  id: string;
  label: string;
  icon: string;
  tip: string;
  variant?: "ghost";
}): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.id = opts.id;
  el.className = opts.variant === "ghost" ? "w-btn w-btn--ghost" : "w-btn";
  el.title = opts.tip;
  el.setAttribute("aria-label", opts.tip);

  const glyph = document.createElement("span");
  glyph.className = "w-icon";
  glyph.innerHTML = opts.icon;

  const text = document.createElement("span");
  text.className = "w-label";
  text.textContent = opts.label;

  el.append(glyph, text);
  return el;
}

/** One channel to the backend. Never throws: a failed move or resize must not
 *  take the widget down with it. */
async function send(mode: WidgetMode): Promise<void> {
  try {
    await invoke("widget_capture", { mode });
  } catch (err) {
    console.warn(`[widget] widget_capture(${mode}) failed`, err);
  }
}

function mount(): void {
  const host = document.getElementById("widget");
  if (!host) return;
  const root: HTMLElement = host;

  root.classList.add("w-widget");
  root.dataset.state = "collapsed";
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "SnagCraft quick capture");

  /* ------------------------------------------------------------- the tab */

  // The tab IS the drag region: it is the only thing on screen when the widget
  // is folded, so it has to move the window. Everything drawn inside it is
  // pointer-events:none (widget.css) so the pointer lands on this element.
  const tab = document.createElement("div");
  tab.className = "w-tab";
  tab.setAttribute(DRAG_ATTR, "");
  tab.setAttribute("role", "button");
  tab.tabIndex = 0;
  tab.setAttribute("aria-expanded", "false");
  tab.setAttribute("aria-label", "Expand SnagCraft capture");
  tab.title = "Drag to move · click to expand";
  tab.append(spine());
  const glyph = document.createElement("span");
  glyph.className = "w-tab__glyph";
  glyph.innerHTML = ICON_UNICORN;
  tab.append(glyph);

  /* ------------------------------------------------------------ the pill */

  const bar = document.createElement("div");
  bar.className = "w-bar";
  // The pill's own background drags the window too, so the whole bar is a
  // handle and not just the 20px grip. Buttons are not drag regions.
  bar.setAttribute(DRAG_ATTR, "");
  bar.setAttribute("inert", "");

  const grip = document.createElement("div");
  grip.className = "w-grip";
  grip.setAttribute(DRAG_ATTR, "");
  grip.setAttribute("title", "Drag to move");
  grip.setAttribute("aria-hidden", "true");
  const dots = document.createElement("span");
  dots.className = "w-grip__grid";
  for (let i = 0; i < 6; i += 1) {
    const dot = document.createElement("i");
    dot.className = "w-grip__dot";
    dots.append(dot);
  }
  grip.append(dots);

  const full = button({
    id: "w-full",
    label: "Full",
    icon: ICON_FULL,
    tip: "Capture full screen (F)",
  });

  const region = button({
    id: "w-region",
    label: "Region",
    icon: ICON_REGION,
    tip: "Capture a region (R)",
  });

  const rec = button({
    id: "w-rec",
    label: "Rec",
    icon: ICON_REC,
    tip: "Record the screen (V)",
  });
  rec.classList.add("w-btn--rec");

  const sep = document.createElement("span");
  sep.className = "w-sep";
  sep.setAttribute("aria-hidden", "true");

  const fold = button({
    id: "w-fold",
    label: "",
    icon: ICON_FOLD,
    tip: "Fold into the tab",
    variant: "ghost",
  });
  fold.classList.add("w-btn--fold");

  const close = button({
    id: "w-close",
    label: "",
    icon: ICON_CLOSE,
    tip: "Close widget (Esc)",
    variant: "ghost",
  });
  close.classList.add("w-btn--close");

  bar.append(spine(), grip, full, region, rec, sep, fold, close);
  root.append(tab, bar);

  /* -------------------------------------------------- collapse / expand */

  let expanded = false;
  let hovering = false;
  let collapseTimer = 0;
  let foldedAt = 0;
  let gen = 0;

  function clearTimers(): void {
    if (collapseTimer) {
      window.clearTimeout(collapseTimer);
      collapseTimer = 0;
    }
  }

  async function expand(): Promise<void> {
    clearTimers();
    if (expanded) return;
    const mine = ++gen;
    expanded = true;
    // Grow the window BEFORE the pill is painted: a 292px pill inside a 58px
    // window would be clipped for as long as the resize takes to land.
    await send("expand");
    if (gen !== mine || !expanded) return;
    root.dataset.state = "expanded";
    tab.setAttribute("aria-expanded", "true");
    bar.removeAttribute("inert");
  }

  function collapse(): void {
    clearTimers();
    if (!expanded) return;
    gen += 1;
    expanded = false;
    root.dataset.state = "collapsed";
    tab.setAttribute("aria-expanded", "false");
    bar.setAttribute("inert", "");
    foldedAt = performance.now();
    // Shrink only after the pill has faded out, so it is never cut in half by
    // the window edge mid-transition.
    window.setTimeout(() => {
      if (!expanded) void send("collapse");
    }, FOLD_MS);
  }

  function collapseIfIdle(): void {
    if (!expanded) return;
    if (hovering) return;
    // Keyboard focus inside the pill (Tab + Enter) keeps it open.
    if (bar.contains(document.activeElement)) return;
    collapse();
  }

  function scheduleCollapse(): void {
    clearTimers();
    if (!expanded) return;
    collapseTimer = window.setTimeout(() => {
      collapseTimer = 0;
      collapseIfIdle();
    }, COLLAPSE_DELAY);
  }

  /* -------------------------------------------------------------- hover */

  // Leaving the whole window (not just the tab) starts the idle timer.
  document.documentElement.addEventListener("pointerenter", () => {
    hovering = true;
    clearTimers();
  });
  document.documentElement.addEventListener("pointerleave", () => {
    hovering = false;
    scheduleCollapse();
  });

  tab.addEventListener("pointerenter", () => {
    // Right after folding the pointer is still parked on the tab; without this
    // the widget would ping-pong open/closed under the cursor.
    if (performance.now() - foldedAt < HOVER_GUARD) return;
    void expand();
  });
  tab.addEventListener("click", () => void expand());
  tab.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      void expand();
    }
  });

  /* --------------------------------------------------------------- drag */

  // Capture phase, so this runs before Tauri's own drag-region listener. That
  // listener calls `plugin:window|start_dragging` (denied here by the ACL, see
  // the header) and turns a double click into a maximise — neither is wanted.
  // Stopping the event keeps the move entirely in our hands.
  function onPress(ev: MouseEvent): void {
    if (ev.button !== 0) return;
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target) return;
    if (!target.closest(`[${DRAG_ATTR}]`)) return;
    // Buttons must stay buttons: pressing one never moves the window.
    if (target.closest("button, a, input, select, textarea, [data-no-drag]")) return;

    ev.preventDefault();
    ev.stopPropagation();
    // Second click of a double click: already moving (or just finished).
    if (ev.detail > 1) return;
    void send("move");
  }
  document.addEventListener("mousedown", onPress, true);

  /* ------------------------------------------------------------- wiring */

  // A short debounce kept as a timestamp, not a timer: the widget window is
  // small and often unfocused, and background throttling would otherwise leave
  // a boolean stuck "busy" and swallow the next click.
  let busyUntil = 0;

  function flash(el: HTMLButtonElement): void {
    if (typeof el.animate !== "function") return;
    el.animate(
      [
        { transform: "scale(0.94)", backgroundColor: "var(--accent-press)" },
        { transform: "scale(1)", backgroundColor: "var(--accent-soft)" },
        { transform: "scale(1)", backgroundColor: "transparent" },
      ],
      { duration: 320, easing: "ease-out" }
    );
  }

  async function capture(mode: CaptureMode, el: HTMLButtonElement): Promise<void> {
    const now = performance.now();
    if (now < busyUntil) return;
    busyUntil = now + 400;

    flash(el);
    // Fold first: the backend hides the window, and it must come back as a tab.
    collapse();
    try {
      await invoke("widget_capture", { mode });
    } catch (err) {
      console.warn("[widget] widget_capture failed", err);
    }
  }

  async function closeWidget(): Promise<void> {
    try {
      await invoke("close_widget");
    } catch (err) {
      console.warn("[widget] close_widget failed", err);
    }
  }

  full.addEventListener("click", () => void capture("full", full));
  region.addEventListener("click", () => void capture("region", region));
  fold.addEventListener("click", () => collapse());
  close.addEventListener("click", () => void closeWidget());

  /* ------------------------------------------------------------- recording */

  // The backend broadcasts `recording-state` to every window; the widget mirrors
  // it so a take started elsewhere (main window, hotkey) still turns the tab's
  // spine red and flips Rec into Stop.
  let recLive = false;

  function paintRec(): void {
    root.dataset.recording = recLive ? "true" : "false";
    const icon = rec.querySelector<HTMLElement>(".w-icon");
    const label = rec.querySelector<HTMLElement>(".w-label");
    if (icon) icon.innerHTML = recLive ? ICON_STOP : ICON_REC;
    if (label) label.textContent = recLive ? "Stop" : "Rec";
    rec.classList.toggle("is-live", recLive);
    rec.title = recLive ? "Stop the recording (V)" : "Record the screen (V)";
    rec.setAttribute("aria-label", rec.title);
    rec.setAttribute("aria-pressed", String(recLive));
  }

  async function toggleRec(): Promise<void> {
    const now = performance.now();
    if (now < busyUntil) return;
    busyUntil = now + 400;
    flash(rec);
    if (recLive) {
      // Stop keeps the widget on screen — the user opened it mid-take on purpose.
      await send("stop-record");
      return;
    }
    // Start folds + hides the widget (Rust) so it never lands in the video.
    collapse();
    await send("record");
  }

  rec.addEventListener("click", () => void toggleRec());
  void listen<{ recording?: boolean }>("recording-state", (ev) => {
    recLive = ev.payload?.recording === true;
    paintRec();
  }).catch(() => {
    /* plain browser or an older backend without the recorder */
  });
  paintRec();

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      void closeWidget();
      return;
    }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

    const key = ev.key.toLowerCase();
    if (key === "f") {
      ev.preventDefault();
      void capture("full", full);
    } else if (key === "r") {
      ev.preventDefault();
      void capture("region", region);
    } else if (key === "v") {
      ev.preventDefault();
      void toggleRec();
    }
  });

  // The window is hidden on capture and re-shown with the tab size by Rust
  // (`show_widget`); coming back with focus means an idle widget.
  window.addEventListener("focus", () => {
    if (performance.now() - foldedAt < HOVER_GUARD) return;
    collapseIfIdle();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) collapseIfIdle();
  });

  // Keep the widget in step when the app flips the theme while it is open.
  window.addEventListener("storage", (ev) => {
    if (ev.key === THEME_KEY) applyTheme(readTheme());
  });
}

applyTheme(readTheme());
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}