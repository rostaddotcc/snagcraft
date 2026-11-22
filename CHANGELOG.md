# Changelog

All notable changes to SnagCraft, newest first. Full release notes for every tag live on
the [releases page](https://github.com/rostaddotcc/snagcraft/releases).

## v1.5.5 (unreleased)
- **Recordings play in the app.** Clicking a recording in **Recent** opens an in-app player
  instead of handing the file to another program: a play button on the preview, then a real
  transport bar — play/pause, current time, a scrub timeline you can drag, total length, mute,
  and a button to open the file externally when you need it. Space toggles playback, ←/→ seek
  (Shift = 1 s), Esc closes.
- **Recent tiles show what a clip is.** Recordings now carry a red dot on the thumbnail and
  their length in the corner, so the strip answers "recording, 7 seconds" before you click.
- **Frame-preview fallback.** If the platform's webview has no decoder for the clip's codec
  (bare WebKitGTK without `gst-libav`, for example), the player steps real ffmpeg frames with
  the same draggable timeline instead of failing — and says so in one line.

## v1.5.4
- **Multi-monitor capture — issue #1 (Windows/macOS).** Capture → **Choose screen** now lists
  every connected display in SnagCraft's own chooser (name, resolution, scale factor, which one
  is primary) and captures the one you pick. **Full screen** composes *all* monitors at their
  real virtual-desktop positions into one image instead of grabbing only the primary.
  On Linux nothing changes: the desktop portal picker still owns that flow.
- **Window capture chooser (Windows/macOS).** Capture → **Window** lists the open windows
  (app name, title, size) in the same chooser, filtered to things that can actually be grabbed —
  no more asking the OS for a dialog it does not have there.
- **Native global hotkeys (Windows/macOS).** `PrintScreen` / `Shift+PrintScreen` are registered
  through the OS hotkey registry; Settings → Global hotkeys shows a **System** badge and explains
  the platform's own fallback when a combo is already taken by another app.
- **Scrolling capture (Windows/macOS).** The same stop rules as the Linux loop (idle 2.5 s, two
  no-change frames, low-confidence warning, 40 000 px cap), same status events.
- **One app, documented as one app.** README, CONTRIBUTING and the issue templates describe a
  single SnagCraft — no edition split.

> Windows installers stay **compile-verified only** — Linux is the tested platform. A report
> from real Windows hardware is the single most useful issue you can file.

## v1.5.3
- **Distinct tool icons.** With the icon-only toolbar, four glyphs were hard to tell apart
  at a glance. Redesigned for clarity at toolbar size:
  - **Brush** is now a diagonal paintbrush with a filled bristle tip; **Highlight** a
    *horizontal* marker over a bold swipe band — they differ by orientation, so they can't
    be confused (they used to be the same diagonal pen).
  - **Spotlight** is a light beam from a source dot down to a lit pool (was a sun-like ring
    that read as "brightness").
  - **Blur** keeps the classic droplet, redrawn cleaner.
  - Tool glyphs render at 18 px (was 16) so the silhouettes stay legible.
  Verified in the real toolbar: Brush vs Highlight unmistakable, all four consistent with
  the rest of the row.

## v1.5.2
- **CI green again.** The widget-size unit test still pinned the pre-v1.5.0 pill width
  (240 px) and failed the quality gate, so v1.5.0/v1.5.1 never got their Windows installers
  attached. The test now asserts the current 292 px pill (matching `widget.css`); full suite
  (97 tests), rustfmt, clippy and tsc all pass. No app behaviour change — this release exists
  so every platform's installers build and land on the release page.

## v1.5.1
- **About box, corrected.** It claimed "MIT licensed" — SnagCraft is GPL-3.0-or-later with
  a commercial option; the line now says so. Added the app name above the version and a
  classic **OK** button; Esc closes it from anywhere.
- **Close-guard polish.** "Your annotations are not on disk yet" → "You have unsaved
  annotations."; the radio-like blue dot before the filename is now a proper picture icon.
- **Contrast pass.** Modal subtitles, the About repo line and the recording format label
  raised from subtle to muted grey for legibility.

## v1.5.0
- **The widget is a widget again — not a window.** It can no longer be stretched,
  maximised or minimised (KDE offered all three even on the frameless flärp, and
  stretching did nothing but grow an empty transparent frame). The window is now
  locked (`resizable/maximizable/minimizable = false` + min=max size hints); the
  tab↔pill resize still works because each state change briefly unlocks the GTK
  geometry hints around the programmatic resize.
- **Red Rec button on the pill.** One click starts a full-screen recording — the widget
  folds and hides so it never lands in the video. While a take runs (started anywhere:
  widget, main window, hotkey) the tab's spine breathes **red**, and reopening the widget
  shows a pulsing filled-red **Stop** button that ends the take. `V` is the widget
  shortcut for Rec/Stop, alongside `F` (Full) and `R` (Region).
- Pill widened 240→292 px to seat the new button; record red unified to `#e5484d`.

## v1.4.0
- **Draw from the first second.** SnagCraft now opens on a white 1280×800 canvas instead of
  an empty workspace — no more annotating "on nothing". Tools, Save and Copy are ready
  immediately; a capture still replaces the canvas exactly as before.
- **File → New… (`Ctrl+N`)** — a classic new-document dialog with resolution presets
  (Default 1280×800, HD, Full HD, QHD, 4K UHD, Square, Story, Small), custom width/height
  (16–8192 px) and a White / Transparent background choice. Your last pick is remembered.
- **No work lost on New.** Creating a canvas over unsaved edits auto-saves a copy first —
  the same no-prompt semantics as browsing Recent.
- Shortcuts overlay and README document `Ctrl+N` / `Ctrl+O`.

## v1.3.2
- **Tool shortcuts fixed.** The keys promised in the tooltips now actually work: `G` fill
  bucket, `L` spotlight, `K` callout (previously unmapped!), `E` brush — the handler had
  drifted from the documented keys. All 13 tools have a shortcut.
- **Complete shortcuts sheet.** The overlay lists every tool as its own letter→tool row
  (no more unmapped letter soup), descriptions left-aligned in a consistent column with
  full-contrast text. README table matches.
- **Classic native menus.** Accelerators are plain right-aligned text (no keycap boxes),
  the empty Upload… keycap is gone, About shows a plain version string, and toggle/radio
  checks sit in a proper LEFT gutter — the Floating widget checkmark actually renders now
  (it never did: the state class was missing).
- **Empty state grows up.** The AI-sparkle glyph is replaced by a neutral monitor icon.
- **Settings polish.** Helper texts raised to readable contrast, section radii unified.
- **CI fix.** The release-attach job uploads artifact files, not their bundle subdirs
  (first run failed on `artifacts/deb: is a directory`); v1.3.1's Windows installers were
  backfilled onto its release.

## v1.3.1
- **Classic icon toolbar.** The annotation tools are now compact icon buttons on a single
  row at every desktop width — names live in the tooltips, the properties rail and the
  shortcuts overlay, like a native tool palette. No more wrapped second row with a dead
  left half; Save/Copy/OCR keep their text labels on the right.
- **Legible keycaps.** Shortcut hints (top bar + status bar) use full-contrast text and
  darker keycaps; the active tool gets a stronger accent border in the light theme.
- **CI ships Windows installers on the release page.** Tag builds now attach the NSIS
  `.exe` and WiX `.msi` (plus the Linux bundles) to the GitHub release automatically —
  previously they only lived in expiring workflow artifacts.

## v1.3.0
- **Classic desktop look.** The violet-tinted chrome is gone: neutral grey surfaces with
  one restrained blue accent (primary action, active tool, logo), smaller corner radii,
  a more compact top bar, flat surfaces instead of tinted gradients — in both themes and
  in the floating widget. A utility, not a landing page.
- **System application behaviour.** SnagCraft is now single-instance: a second launch
  focuses the running window. `snagcraft --capture` and `--region` ask the running app to
  capture (or start it), `--help` / `--version` answer on the console, and an image path
  in the arguments opens straight in the editor.
- **File associations.** The .deb / .msi / NSIS installers register SnagCraft as an editor
  for PNG, JPEG, WebP, GIF, BMP, AVIF and TIFF — right-click an image → *Open with
  SnagCraft*.
- **GNOME & KDE panel companions** (`integrations/`): a GNOME Shell extension (45+) and a
  Plasma 6 plasmoid that add a one-click capture button to the panel, plus a `.desktop`
  entry with capture actions for AppImage users. Reference implementations — live-session
  validation welcome.

## v1.2.1
- **Fix: the thin AppImage failed to start on Wayland desktops.** The ksni tray dependency
  added in v1.1.0 accidentally re-enabled tray-icon's default features, which link
  `libxdo.so.3` — an X11 library many Wayland systems don't have. The thin AppImage (system
  libraries) died with a loader error; the full AppImage was unaffected. The dependency now
  builds with `default-features = false`, the binary no longer needs libxdo, and the thin
  AppImage starts everywhere v1.0.2 did. No behaviour changes.

## v1.2.0
- **Shadows actually work now.** Two root causes fixed: fabric strips a shadow before
  stroking unless `affectStroke` is set — outline-only shapes (rects, ellipses, arrows, lines)
  never cast one without it — and the shadow controls only styled *future* annotations.
  Now the shadow toggle/sliders restyle the **current selection live**, and every shape,
  arrow and label casts a proper shadow.
- **Quick text settings on the image.** A floating bar hugs the caption you're editing or
  selecting: font family, size −/+, bold, italic and colour — no trip to the properties rail.
  The rail stays in sync, and the bar follows the box as you move/zoom.
- **Text tool, rebuilt.** No more automatic "Text" placeholder — a new box starts empty with
  just a caret. Drag to size the box (a dashed preview shows the size while you drag); a plain
  click gets a comfortable default. Typed captions now survive switching tools (they used to
  be silently discarded); an untouched box still disappears on its own.
- **Six new bundled fonts** (all OFL): Lato, Oswald, Playfair Display, Archivo Black,
  Fira Code and Pacifico — ten families in total, warmed at startup so canvas text never
  renders in a fallback face.
- **Resizable Recent strip.** Drag its top edge (or focus it and use ↑/↓) to give Recent more
  room — thumbnails scale with it, up to poster size, for low-vision readability. The height
  persists; double-click or Home resets.
- **Save = a new copy, always.** Ctrl+S / Save writes a fresh versioned copy next to the
  original (colliding names gain `-2`, `-3`, … — nothing is ever overwritten) and it appears
  in Recent immediately. Browsing Recent with unsaved edits saves a copy first and switches —
  the "unsaved changes" prompt is gone from history browsing; nothing is ever lost.

## v1.1.0
- **The tray icon answers clicks.** SnagCraft now uses tray-icon's native StatusNotifierItem
  (ksni) backend on Linux instead of libappindicator, which never emitted mouse events:
  **left click (or double click) restores the window**, middle click toggles the floating
  widget, right click opens the menu. The menu gains a *Floating widget* item.
- **Start at login.** Settings → General gains a *Start at login* switch, backed by the
  official `tauri-plugin-autostart` — XDG autostart on Linux (AppImage-aware, so the entry
  points at the real file), the registry Run key on Windows, a LaunchAgent on macOS.
- **The flärp has a face.** The floating widget's collapsed tab is redesigned from a generic
  glass square into a vertical bookmark tab: the SnagCraft unicorn mark (the same silhouette
  as the File trigger and app icon), a breathing accent spine on the left edge, and one tight
  corner so it reads as a tab. The expanded pill carries the same spine. Also fixes a cascade
  bug that silently shrank the tab glyph to 17px, and honours `prefers-reduced-motion`.

## v1.0.2
- **Separate recording folder (optional).** Settings → Save location gains a *Separate recording folder* switch. Off (the default): recordings land with the screenshots, exactly as before. On: pick a folder just for recordings, or reset to follow the save folder again. The Recent strip scans both folders and merges them, newest first.

## v1.0.1
- **The Recent strip now reads the save folder.** On launch, when the strip opens, after a save and whenever the folder changes it lists the images and recordings actually on disk — newest first, up to 60, with thumbnails — so captures from earlier sessions come back instead of only this session's. Clicking an image reads it from disk; recordings open in the system player. Unsaved in-session captures stay on top.
- New Rust tests cover the folder scan (images kept, videos kept, other files and subfolders ignored) and the thumbnail encoder.

## v1.0.0
**SnagCraft** — the app is renamed from **Capicorn** (a nod to Snagit and the ArtCraft suite).
Same app, new name:
- product name, binary, crate, app identifier, window title, About dialog, tray and every release
  asset (`SnagCraft_*`)
- the save folder becomes `~/Pictures/SnagCraft`; the old `~/Pictures/Capicorn` folder is adopted
  on first launch, so existing captures stay put
- stored preferences (`capicorn:*`) are copied to `snagcraft:*` once, so settings survive the rename
- the repository moves to github.com/rostaddotcc/snagcraft (GitHub redirects the old URL)

## v0.28.0
- **Shapes tool** replaces the plain Box: pick rectangle, ellipse, triangle, line or star in the tool panel, then drag. Colour, width and shadow are shared with the other shape annotations.
- **Shadow colour now sticks** — the colour input is no longer rewritten while the native picker is open, which made the choice look like it reset.
- **Removed the S/M/L stroke presets**; the width slider is the only control.

## v0.27.1
- **Quality gate in CI.** A new `quality` job runs `cargo fmt --check`, `cargo clippy -D warnings`, the Rust unit tests and `tsc --noEmit`; both platform builds now depend on it.
- The whole Rust tree is **rustfmt-formatted** and **clippy-clean** (zero warnings).

## v0.27.0
- **Watermark.** Burn a text mark into exports — Settings → Export sets the text, opacity and corner. It never touches the editor or the live capture, and the size scales with the image so a 4K shot stays readable.
- **Upload.** File → Upload… POSTs the flattened PNG to *your* endpoint (Settings → Export) as `multipart/form-data` and copies the link the server answers with. No provider hardcoded, no credentials shipped — point it at your own handler.

## v0.26.0
- **Open images from disk.** File → Open… (`Ctrl+O`) with an image filter; everything is normalised to PNG, lands in the editor and appears in Recent as "Open". Drag-and-drop and `Ctrl+V` keep working.
- **Shadow controls you can feel.** The X/Y offset steppers are gone. **Direction** (0–360°), **distance**, **blur** and **opacity** sliders drive the shadow, with the sample tile showing how it falls. Offsets are derived from angle × distance, so existing presets keep their shadows.

## v0.25.0
- **Audio in recordings.** Pick a microphone and/or capture system audio (Linux: PulseAudio devices via `pactl`; Windows: `dshow`); the sources are mixed with `amix` into AAC. GIF stays silent.
- **Interval capture.** Capture → Interval takes a screenshot every 5 s / 10 s / 30 s / 60 s / 5 min in a small always-on-top card, saves every shot with a sequence number and can turn the whole set into an **MP4 timelapse** in one click.
- **Pause / resume** a recording from the pill; the elapsed clock freezes with it.
- **Record a window** — a third Record row restricts the portal picker to windows.
- **Magnify is back, and real.** Drag a lens and the area under it is enlarged live by 1.5–10× (the size slider becomes the zoom); an `N×` badge shows the factor. Exports match the canvas.

## v0.24.0
- **The unicorn head is now the File menu** — it replaces the word "File" and the topbar brand text (which only took space). Clicking it opens save/settings/widget/About.
- **Settings icon removed** from the topbar; Settings… stays in the File menu (Ctrl+,).
- **About dialog** added (File → About) with the version, license and repository; the version also shows beside the row.
- **Magnify removed** — its live preview was only a tinted box (no enlargement until export), so the half-working tool is gone from the toolbar, editor and shortcut list.

## v0.23.0
- **The timer is now a small always-on-top countdown**, not a full-window overlay. The main window shrinks to a clean timer card (decorations off), so the desktop stays usable — open menus, hover tooltips, arrange the shot — while it counts down.
- **The floating widget comes back after a capture**, and closing the editor now leaves the widget on top instead of quitting the app. Closing the widget brings the editor back, so the app can never become unreachable.
- **Removed Pin** — it never worked reliably and its purpose was unclear; gone from the UI and the backend (with its tests).
- `set_hud_mode` generalises the window-shrink used by both the scrolling card and the timer.

## v0.22.4
- **Scrolling capture's Done button now works.** The card used to sit inside a full-size **click-through** window, so a click on Done passed straight through to the app below, and after scrolling another window Enter went there too. A new `set_scroll_mode` shrinks the main window to the card (min-size lifted while active), turns click-through off and keeps the card on top — Done is clickable and Enter is delivered. The app chrome is hidden while the card owns the window; the old Alt "mouse control" step is gone.

## v0.22.3
- **Window / Choose-screen capture now negotiates its size flexibly.** The stream asked for an exact `VideoSize` (the portal's hint), which the producer cannot always match for an individual window — the format negotiation failed, no frame arrived, and the grab timed out as "cancelled". It now offers a **range** (1×1 … 16384×16384) with the hint as the default, so the producer delivers its real size. The recorder got the same fix.
- Window/monitor capture now **logs** to `~/.cache/snagcraft-portal.log` (picker answer, stream states, negotiated format, first frame), so "Copy recording diagnostics" covers it too.

## v0.22.2
- Fixed **Window / Choose-screen** capture (and scrolling capture) on KDE. The one-frame ScreenCast consumer carried the same three PipeWire traps the recorder had: a `target.object` prop resolving before the registry saw the portal node, no registry wait before connecting, and an oversized explicit buffer pool KWin rejects. All three now use the proven pattern.

## v0.22.1
- Rectangle boxes are **untinted again** (outline only) — the faint fill added for shadows read as an unwanted "highlight". The drop shadow still falls naturally around the outline.

## v0.22.0
- Design pass toward a **more classic, less "AI" look**: neutral grey chrome (dropped the purple tint from surfaces/borders), tighter border radii, softer shadows; the purple accent is now reserved for primary actions and the brand.
- Neutral dot grid and scrollbars.

## v0.21.0
- Removed the standalone **Record** button — recording lives in the Capture menu; the running take's pill gains a **Stop** button.
- Blur/pixelate/blackout now preview **transparently** while dragging and apply the **real** effect the moment the box is released (no more odd colour, no click-elsewhere needed).
- New **unicorn** logo + app icon (ArtCraft-style clean geometric mark).
- Windows builds now produce an **.msi** as well as the NSIS .exe.

## v0.20.0
- New **File** menu (top-left): Save As…, Save, Copy image, Settings…, and a **Floating widget** toggle — the widget is easy to find again.
- **Record modes live in the Capture menu** (Record full screen / Record region); the separate Record dropdown is gone, so there is one mode menu.
- Window / screen captures **no longer leave the floating widget on screen** (it is hidden with the main window during a capture, so it can't "pop up").

## v0.19.0
- Recording indicator is red and pulses (the status dot follows the recording state).
- More shortcuts: bare-letter tool keys (`V R A T B P H S M E K`) and **Ctrl+scroll zoom**.
- Blur tool shows the **real** blur / pixelate / blackout live on the canvas, not a placeholder.
- Rectangle shadows now cast (the box gets a faint tint instead of a pure outline).
- Sleeker arrow: rounded tail, tapered shaft, head scaled with the stroke width.
- Text tool: resizable **text box** (drag to size), wrapping text, and a thin grey frame.

## v0.18.2
- License changed to **GPL-3.0-or-later** with a commercial dual-license; added a
  CONTRIBUTING note (contributions are licensed under both).
- README: the Windows `.exe` is now marked untested, with Linux as the focus.

## v0.18.1
- Recordings now appear in the Recent filmstrip (thumbnail via ffmpeg, film-icon fallback); clicking one opens the file with the OS default player.

## v0.18.0
- Settings moved to the top-left of the title bar.
- Thin AppImage (~3.9 MB) that uses the system's WebKitGTK instead of bundling the whole
  stack; the full self-contained AppImage (82 MB) ships alongside it.

## v0.17.2
- Screen recording: `error alloc buffers: Invalid argument` — drop the explicit
  `SPA_PARAM_Buffers` pool (KWin rejected it); `MAP_BUFFERS` producer defaults are correct.

## v0.17.1
- Screen recording fix: `no target node available` — drop the `target.object` stream
  property (it pre-resolved the target before the portal node was in the registry) and wait
  for the node to appear in the registry before connecting.

## v0.17.0
- Paste (`Ctrl+V`) or drag-and-drop an image to annotate it.

## v0.16.0
- In-app keyboard shortcuts overlay (`?` key or the top-bar help button).

## v0.15.0 — Windows recording
- Windows screen recording via `ffmpeg -f gdigrab` (full screen or region), graceful stop.

## v0.14.1
- Settings → Troubleshooting → "Copy recording diagnostics": bundles the portal log and the
  latest take log onto the clipboard.

## v0.14.0
- Windows NSIS installer built by GitHub Actions CI.
- Platform support matrix and recording troubleshooting in the README.

## v0.13.1
- Widget drag fixed at the root: the `widget` window is now covered by the Tauri capability
  (`allow-start-dragging`, `allow-set-size`), and window moves go through an app command.

## v0.13.0
- Recording: the portal offers monitors **and** windows; SelectSources is kept alive until
  the cast starts; the real portal error is surfaced (no more false "no screen was picked");
  every portal step is logged to `~/.cache/snagcraft-portal.log`.
- Brush-size preview in the properties rail and as an on-canvas cursor.
- Shadows for arrows, rectangles, text, callouts and steps.
- The floating widget collapses to a small edge tab ("flärp").

## v0.12.2
- Per-take recording diagnostic log.

## v0.12.1
- Clear error when `ffmpeg` is missing.

## v0.12.0
- Recording dropdown with full-screen and region modes; region crops each frame.

## v0.11.0
- Save As… (native dialog, PNG/JPEG/WebP), reset-to-default save folder, auto-save toggle,
  transparent movable widget.

## v0.10.1
- Text tool: no stuck placeholder, undo works while typing, drag the text box while editing.

## v0.10.0
- Window and monitor capture; menu polish.

## v0.9.0
- Brush tool, per-tool size sliders, image resize.

## v0.8.0
- Scrolling capture: manual scroll + frame stitching.

## v0.7.0
- Screen recording (MP4/GIF).

## v0.6.0
- OCR, style presets, recent-captures filmstrip, pin, magnify.

## v0.5.0
- Global hotkeys (GlobalShortcuts portal), floating widget, contextual properties rail.

## v0.4.0
- True Gaussian blur (StackBlur), pixelate, blackout, spotlight, highlighter, callout.
- Export PNG/JPEG/WebP, system tray, minimise-to-tray, close guard, capture timer.

## v0.3.0
- Fonts (Inter, Source Serif 4, JetBrains Mono, Caveat), font picker, capture dropdown,
  dark mode, settings, fill bucket.

## v0.2.1
- True fullscreen region capture.

## v0.2.0
- Region capture and colour selection.

## v0.1.0
- First alpha: portal capture + Fabric.js editor.
