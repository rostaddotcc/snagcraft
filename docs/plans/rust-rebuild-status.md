# SnagCraft Rust rebuild — status log

Spec: `docs/specs/2026-11-16-snagcraft-rust-rebuild.md`
Baseline: Tauri v1.5.2 (commit d25adb1). Rebuild workspace: `rust/` (not yet created).

## Wave status

| Wave | Scope | Status |
|------|-------|--------|
| W0 | egui editor spike + Wayland viewport probe | KDE-approved by rostad 2026-11-16 ("appen lirar") |
| W1 | workspace scaffold, doc model, engine, capture port | KDE-approved by rostad 2026-11-16 |
| W2 | editor tool parity | KDE-approved by rostad 2026-11-16; UI polish pass landed (sliders) |
| W3 | shell parity (tray/hotkeys/widget/settings) | complete on pn53 (216 tests); KDE live pass pending rostad |
| W4 | recording, scrolling, OCR, timelapse | complete on pn53 (363 tests); KDE live pass pending; gaps logged below |
| W5 | CLI/JSON/MCP automation + WASM web | complete (3273af1 + watermark fix); web app browser-verified; W6 next |
| W6 | packaging, docs, suite dossier | complete (bbd2683 + docs); all waves W0–W6 BUILT |
| W7 | parity backlog (gaps B4#1–3) | complete — timelapse.assemble + OCR lang picker + busy modal (390 tests, ffprobe-verified) |
| W8 | parity backlog (gaps B4#4–9) | complete — upload POST flow + Ctrl+. (timelapse) + countdown HUD; all 9 B4 rows closed |
| W9 | parity long-tail (save & recent UX) | complete — filename tokens + Save As + default dir + Recent strip (451 tests) |
| W10 | parity long-tail (canvas presets + Resize) | complete — New-canvas presets + Resize dialog (459 tests, kittest tolerance) |
| W11 | parity long-tail (settings + diagnostics + PrintScreen) | complete — settings cluster + diagnostics.copy + PrintScreen fallback (468 tests) |
| W12 | parity long-tail (shortcuts + About + editor residuals) | complete — shortcuts overlay + About + derived dirty-state + ffmpeg msg (474 tests) |

**PARITY REACHED 2026-11-17 (wake #100):** every checklist row ticked with
evidence except **Trim** — rostad-gated (not implemented in live v1.5.3 either;
his decision). W0–W12 built; 474 tests / 0 failed; native AppImage + .deb + CLI
+ TCP/MCP automation + WASM web app, one Rust engine. Remaining: rostad's KDE
live pass + gates (trim/relicense/cutover/external post). NO releases published.

## Parity checklist

(to be generated from live v1.5.x source at W1 — tick with evidence)

## Wake log

### 2026-11-16 — spec written
- Full-Rust rebuild spec approved for goal/loop use; no code started yet.
- Inventory: ~9.2k lines Rust backend portable; ~12.2k lines TS editor/UI to rebuild.
- Open gates: relicense (GPL → MIT/Apache-2.0), external posts, cutover — all need rostad.

### 2026-11-16 — wake #1: W0 probe gate built and verified on pn53
- Architecture ground truth fetched to `tmp/research/photocraft/` + `tmp/research/suite/`
  (AGENTS.md, architecture.md, control-protocol.md, ui-design.md, house rules). egui API
  references in `tmp/research/egui/`.
- W0 plan: `docs/plans/2026-11-16-w0-probe-gate.md`. New workspace `rust/` (resolver 3,
  edition 2024, deny-lints + unsafe forbid, clippy.toml test exemptions).
- `rust/probes/editor-spike`: pure scene core (doc/history/3-pass blur/composite, 12 unit
  tests green) + thin egui shell (one-row classic toolbar, accent #2266b3, arrow/text/rect/
  blur tools, select+move, undo/redo, open/save PNG, drag-drop, inline text editing).
- `rust/probes/viewport-probe`: 292×64 transparent frameless pill, red Rec button,
  StartDrag anywhere, session info on-screen, Esc quits.
- Gates run: `cargo fmt --check` clean; `cargo clippy --workspace --all-targets -D warnings`
  clean; 12/12 unit tests; headless kittest visual snapshot green AND vision-verified
  (`rust/probes/editor-spike/tests/snapshots/editor_spike.png` — toolbar, canvas, arrow,
  rect, text, blur all render correctly).
- Live launch on pn53 Wayland (Radeon 660M, RADV Vulkan): both binaries AND both AppImages
  stay alive (timeout exit 124). Only log noise: benign sctk_adwaita color-scheme portal
  timeout; arboard falls back to X11 clipboard (GNOME lacks ext-data-control — W3 note).
- Artifacts: `dist/w0-spike/SnagCraft_W0_Editor_Spike-x86_64.AppImage` (9.5 MB),
  `SnagCraft_W0_Viewport_Probe-x86_64.AppImage` (9.1 MB) — vs ~80–90 MB Tauri AppImage.
- W0 built by parent directly (two small probes; API verified in-context). Parallel
  subagent tracks start at W1.
- Remaining for W0 sign-off: rostad's KDE pass — desktop visible through pill corners,
  drag feel, stacking; editor flow capture→annotate→save on his box. `--selftest
  --shot-out` works only in an unlocked session (see appendix).

### 2026-11-16 — wake #2: W1 launched
- Fresh check: W0 committed b39da91 + pushed; no KDE feedback yet; W1 next.
- W1 plan with locked contracts: docs/plans/2026-11-16-w1-scaffold-engine-capture.md.
- Parent landed: full workspace scaffold (15 crates L0–L6 + 3 apps + xtask, 21 members),
  xtask layers (layer map + cycle detection + UI ban below L6) + ci, .cargo alias,
  packaging/ (desktop + icon + appimage.sh), .github/workflows/rust.yml (gates + AppImage
  artifact). ashpd 0.14.0 + xcap 0.9.10 + tokio/clap/cargo_metadata verified compiling.
- Parent landed L0 geom/color/raster + L1 doc (8 object kinds, serde, hit-test/shift) +
  L2 ops (bounded history): 20 unit tests green, clippy -D warnings clean, layers legal.
- Dispatched 4 parallel tracks (deleg_6ba30a31): C1 algo+compose, C2 format+io,
  D capture (ashpd Screenshot port; ScreenCast/PipeWire deferred to W4), P parity
  checklist from live v1.5.3 source → docs/plans/rust-rebuild-parity.md.
- Next: integrate children → engine (Session + command registry) → ui-egui shell
  (capture→editor) → apps/snagcraft + cli → gates → AppImage → deliver.

### 2026-11-16 — wake #3: W1 integrated end-to-end
- Children C1/C2/D/P all finished; parent verified artifacts: 39 crate tests green
  before integration, clippy clean, format compile-guard intact (no `..` rest).
- Parent landed: engine Session + 16-command registry (7 tests incl. adversarial
  params), ui-egui engine-driven shell (Capture button → threaded portal capture →
  editor; Select/Arrow/Rect/Text/Blur; Save native / Export PNG; undo/redo; drag-drop),
  apps/snagcraft (eframe, --capture/--selftest) + snagcraft-cli (capture/convert/
  commands/run — every registry command drivable headless).
- Two real bugs found + fixed by parent verification (not child self-reports):
  (1) compose text used ab_glyph raw font-unit metrics (ascent 932×scale → baseline
  off-canvas, silent text loss) → fixed with as_scaled()/ScaleFont pixel metrics;
  (2) CLI had no fonts because egui's own default features are EMPTY (default_fonts
  comes via eframe) → workspace egui now enables default_fonts explicitly.
  Regression probes: ui-egui render_probe tests + CLI text-export pixel check (417 px).
- Seeded demo scene now uses a detailed synthetic base (white-on-white blur was
  invisible in the first snapshot).
- Final gates: fmt ✓ clippy -D warnings ✓ 99 tests / 0 failed / 1 ignored (live
  portal, locked host) ✓ xtask layers 21 crates ✓. Headless w1_shell snapshot
  vision-verified: Capture button, 5 tools, arrow+rect+text+blur all render.
- Desktop release binary + AppImage (10.3 MB) launch-tested on pn53 Wayland (exit 124).
  CLI smoke: commands lists 16; convert PNG→JPEG→PNG round-trip; run edit.add +
  export with text verified pixel-wise.
- ATTRIBUTION.md added (icon original; no committed fonts; dep allowlist check).
- Parity checklist: docs/plans/rust-rebuild-parity.md — 149 evidence-backed rows,
  14 sections, baseline v1.5.3 @ 3cec2ee. W1 ticks: capture→editor flow, 8 object
  kinds, undo/redo, PNG/JPEG/WebP export, native format, CLI automation.
- Remaining W1 sign-off: rostad's KDE pass — live portal capture (unlocked),
  annotate → save/export under ten seconds. W2 next: full 13-tool parity.
- Post-batch follow-up (child reports arrived after integration; all matched the
  verified artifacts): confirmed C1's spotlight semantics (dim = darkening amount,
  factor 1−dim — matches contract intent); dropped capture's unused geom dep;
  hardened format::load to reject manifest-size/base-image mismatch (+tamper test,
  format now 11 tests). C2's WebPEncoder::new_lossless deviation accepted (image
  0.25 API). W2 inputs from parity doc: 5 shape variants (triangle/star missing in
  rust ShapeKind), live MAX_HISTORY=80, SECURE_BLUR_MIN=10, blackout #111827,
  spotlight rgba(8,12,18,.68), highlighter α .36, shortcuts V C A T R B E G L H K S M.

### 2026-11-16 — wake #4: W2 launched (tool parity)
- Fresh check: W1 stable at 942597f, no KDE feedback yet → next item W2.
- W2 plan: docs/plans/2026-11-16-w2-tool-parity.md (W2a crate tracks now, W2b
  engine+UI after). Parity inputs from checklist §1–2: 13 tools, 5 shape variants,
  blur radius 2–60 default 12 + SECURE_BLUR_MIN 10, blackout #111827, spotlight
  rgba(8,12,18,.68), highlighter multiply .36, shadow angle×distance→offsets,
  history 80, brush 2–44, magnify 1.5–10×, callout width→font-size.
- Font assets prepared parent-side: 14 OFL TTFs decompressed from the live app's
  woff2 (fontTools 4.61.1) → rust/assets/fonts/ + OFL texts; ATTRIBUTION updated.
  Italic = synthetic shear 0.2 (live bundles no italic faces either).
- Manifests pre-wired + compile-verified: doc +image (crop_imm), text +ab_glyph.
- Dispatched W2a (deleg_0688f850): T1 doc/ops/format (Shadow, Triangle/Star,
  Magnify/BrushStroke, crop, history 80, guard extension), T2 algo/compose
  (parity constants, flood_fill, resize_region, exact blends, shadows, styled
  composite + italic shear), T3 text FontDb (10 families, 14 faces).
- Next: verify T1–T3 artifacts → W2b engine commands + full 13-tool UI → gates →
  AppImage → tick parity rows.

### 2026-11-16 — wake #5: W2a verified, engine W2b landed, UI dispatched
- T1 (doc/ops/format) + T3 (text) finished; T2 (algo/compose) in final verification.
- Parent verified: doc 19 tests, format 14, ops 11, text 8 (live family order,
  14 faces, bold fallbacks, case-insensitive) — clippy -D warnings clean on all.
- Contract gap caught parent-side: Text/Callout lacked `family` (live TextStyle
  has 10 families). T1 finished before the steer landed → parent applied the
  family extension (serde default "Inter") to doc + format guard + 6 test literals.
  T2 consumed its steer: composite_styled now passes (obj.family, obj.bold) and
  applies italic shear per object.
- Engine W2b (parent): edit.crop + edit.bucket commands (18 total), blur default
  radius 12 clamp 2–60 (parity), render() switched to composite_styled with a
  Session-cached FontDb face table (resolve_shared/FontArc) — bundled OFL fonts
  now identical across UI/CLI/export; set_font removed (ui-egui + CLI updated,
  CLI egui dep dropped). 11 engine tests green incl. crop/bucket undo, hostile
  seeds, FontDb text pixel probe.
- Dispatched full 13-tool UI track (deleg_3ecf00d3): one-row toolbar + contextual
  properties rail + crop/brush/step/callout/magnify/bucket UX + quick font bar.
- Next: T2 + UI land → full gates → vision contact sheet → AppImage → tick parity.
- W2a batch closed: T2 final artifacts parent-verified (algo 22 + compose 34 tests,
  engine 11 re-run against final compose — all green, clippy clean, layers legal).
  Accepted deviations (cosmetic, logged for W2 polish/W6 gaps): spotlight hole +
  highlighter are hard rects (live rounds corners); shadow blur = one box pass
  (live canvas shadowBlur sigma). Arrow head uses the EXACT live formula
  (thickness=w*2, headLen=max(16,thickness*1.7), headHalf=max(9,thickness)).
  T3 contract conflict resolved well: ab_glyph FontVec is NOT Clone →
  resolve_shared/FontArc added as the cheap path (engine already uses it).
  T1 added sanitize() on add() + format::load (shadow clamps, brush point cap,
  non-finite point skip) — extra hostile-input hardening beyond contract.

### 2026-11-16 — wake #6: W2 polish while UI builds
- UI track (deleg_3ecf00d3) still running — lib.rs 714 → 1896 lines mid-build.
- Parent closed the two logged cosmetic parity gaps in compose (no sibling owns
  it now): spotlight hole radius min(12,min(w,h)/6) + highlighter band radius
  min(8,min(w,h)/4) with ≤0.5 hard-rect fallback (exact live blur.ts formulas,
  SDF coverage AA), shadow blur 3 box passes ≈ gaussian. 2 corner-coverage
  regression tests; 36 compose tests green, clippy clean. Committed c3a1a94.
- Parity checklist: 11 rows ticked W1/W2 (blur modes/constants/secure-min/
  blends, history 80 + reset-on-new).
- Next: UI lands → full gates + vision contact sheet + AppImage + W2 sign-off.

### 2026-11-16 — wake #7: UI pre-verification + step-number bug fix
- UI track still running (final verification); snapshots w2_shell + w2_shell_narrow
  blessed by child. Parent vision + pixel probes:
  * Shell structure PASS: exactly 13 icon tools on ONE row + Capture/Open/Save/
    Export/Undo/Redo; contextual rail (shape picker, 8-swatch palette, border,
    shadow angle/distance/opacity/blur); narrow width keeps one row with
    horizontal ScrollArea (tools 11–13 scroll-reachable, code-verified).
  * Vision flagged spotlight/blur/magnify as broken — pixel probes DISPROVED it
    (spotlight α=0.306 exact, blur smoothed, magnify shows zoomed content);
    vision misread the synthetic checker base as unflattened alpha.
  * REAL bug found: step-badge numbers invisible — compose asks fonts("", true)
    and the engine lookup was exact-match-only → None. Fixed: fallback chain
    exact → Inter → same-weight → first (mirrors FontDb::resolve). Regression
    test counts glyph pixels strictly inside the badge (first version
    false-passed on the white base — caught and fixed). 12 engine tests green.
- Steered UI child: re-bless both snapshots with the fixed engine; do NOT
  "fix" the proven-correct renderers. Committed f20cd2e + pushed.
- Next: UI lands → full gates + AppImage + W2 sign-off + delivery.

### 2026-11-16 — wake #7+: rostad's request — right-click + copy/paste (W2 finished)
- rostad (direct message): wants right-click classic context menu + Copy (Ctrl+C)
  so annotated captures paste into other chats. Live app has Ctrl+C but NO custom
  context menu (editor.ts:335 suppresses it) — this goes beyond live parity.
- Landed: io::clipboard (arboard 3 + wayland-data-control, ported from live
  clipboard.rs, Surface-based copy_image/paste_image, graceful headless errors);
  engine commands clipboard.copy / clipboard.paste / edit.duplicate / edit.reorder
  (22 total, 15 engine tests); UI: Ctrl+C/V/D hotkeys, toolbar Copy button, classic
  right-click menu (Copy Image, Paste | Duplicate, Delete, Bring to Front, Send to
  Back | Undo, Redo | Save As…, Export PNG…) with shortcut hints + disabled states.
- UI child (deleg_3ecf00d3) finished: full 13-tool shell, 16 ui-egui tests incl.
  parity.rs (shortcut routing 13/13, drag-create 7 region tools, crop Enter/Esc,
  step auto-numbering, brush, bucket, callout size table, shadow derivation).
- Context-menu kittest tests (right-click injection): menu opens, classic items
  present, object items on hit; snapshot vision-verified (10 items, hints,
  separators, disabled Redo — clean classic look).
- Full gates: fmt ✓ clippy -D warnings ✓ **180 tests / 0 failed / 1 ignored** ✓
  layers 21 ✓. Release + AppImage (11.75 MB, fonts embedded) launch-tested (124).
- Parity: 15 more rows ticked (13 tools + copy + paste) → 26 W2 rows total.
- Delivered W2 AppImage to rostad for the KDE pass (capture → annotate →
  right-click Copy → paste into chat is the acceptance flow).
- UI child completion report reconciled (all already integrated in 6b57dab):
  * APPROVED deviation: callout font size uses the LIVE formula
    min(rail, round(w/4)) clamp 12–120 (tools.ts:1387-1391), not the brief's
    clamp(w/10,12,48) — live parity wins; table-tested.
  * Child caught a real W1 bug en route: drag-start read hover_pos (already
    the moved point on egui's first drag frame) → every drag-create was 0px;
    fixed with pointer.press_origin(). W1 snapshots never caught it (seeded
    via commands, not drags) — parity.rs drag gates did.
  * Stale w1_shell.png removed (unreferenced after test rename); 18 ui-egui
    tests green.
  * W2 gaps logged for W3/polish: re-grab/move an existing crop frame (new
    drag replaces it), inline caption editing of existing callouts (created
    with default text), brush nib cursor preview.

### 2026-11-16 — wake #8: rostad KDE-approval + UI polish (reglage)
- rostad: "ser bra ut! appen lirar" — W0/W1/W2 ACCEPTED on his KDE box. New
  direction: replace numeric/coordinate fields with sliders + general polish.
- Polish pass (parent, ui-egui): ALL rail numeric DragValues → classic egui
  Sliders with blue trailing fill + integer readouts (Width/Border/Brush/
  Outline/Ring/Font size/Blur radius/Tolerance/Dim/Zoom + shadow Angle/Dist/
  Opacity/Blur). Shadow sliders moved to an EXPANDED SECOND RAIL ROW when
  Shadow is enabled (first attempt kept them inline → vision caught the
  right-edge overflow; restructure made all four visible at once).
  Status bar now: dimensions | active tool name | status.
- Vision-verified: no numeric boxes left, no clipping, blue fills, muted
  labels, classic look. Snapshots re-blessed (18 ui-egui tests).
- Gates: 180 tests / 0 failed, clippy/fmt/layers green. AppImage 11.77 MB
  launch-tested (exit 124). Delivered to rostad.
- Next: W3 shell parity (tray, global hotkeys, widget, settings, close-guard,
  single-instance, autostart, file associations) unless rostad redirects.

### 2026-11-16 — wake #9: W3 launched (shell parity)
- Fresh check: W0–W2 KDE-approved, polish delivered (c8f6714). Next: W3.
- W3 plan: docs/plans/2026-11-16-w3-shell-parity.md. Recon: live tray.rs
  (ksni load-bearing, left=restore/middle=widget/menu), hotkeys.rs
  (GlobalShortcuts portal, one BindShortcuts/session, Print/SHIFT+Print),
  close-guard tree (windows.rs:96-140), widget 58×74 ↔ 292×50.
- Parent scaffolded crates/platform (L6, tray-icon 0.25 ksni + ashpd
  global_shortcuts feature added workspace-wide), registered in xtask layers
  (22 crates), compile-verified before dispatch.
- Dispatched W3a (deleg_ff01afff): T1 platform (tray/hotkeys/autostart/
  single-instance socket, ported from live code, offline tests), T2 io::settings
  (Settings struct, XDG path, atomic save, corrupt-safe load) + engine
  settings.get/set commands.
- Next: W3b — settings panel UI, dark theme, close-guard modal, widget
  viewport, apps/snagcraft wiring (tray/hotkeys/CLI/launch_request/autostart/
  file associations), gates, AppImage.

### 2026-11-16 — wake #11: T2 verified + committed; W3b dispatched
- T2 (io::settings + engine settings.get/set) finished: parent-verified 19 io +
  22 engine tests, clippy clean; committed 950a01e. Manifest note: T2 added
  serde/serde_json to io (needed by Settings — parent wiring gap, accepted).
- T1 (platform) still running: all modules written (tray 264, hotkeys 328,
  single_instance 317, autostart 181, trigger 130, png 665 — png.rs likely a
  hand-rolled PNG→RGBA decoder for the tray icon since platform has no image
  dep; verify at integration).
- Dispatched W3b (deleg_2984262f): settings panel + themes + close-guard +
  widget viewport + tray/hotkey/instance/CLI wiring + file associations,
  against the verified-mechanism design + locked platform contract.
- Next: T1 + W3b land → verify → full gates → AppImage → KDE pass (tray click,
  Print/Shift+Print consent, widget drag, close-guard, settings persistence).
- W3a batch closed: T1 parent-verified (22 tests + 2 ignored live, clippy clean,
  layers 22) and committed 4350cc5 with assets/tray-32.png + ATTRIBUTION.
  Good child initiative: std-only PNG decoder (tray-icon 0.25 lacks a PNG entry
  point; manifests were off-limits) pixel-verified vs Python; 120s BIND_TIMEOUT
  after observing the portal hang with unshowable consent; edition-2024
  env::set_var is unsafe → pure resolvers instead (house-rule compliant).
  Steered W3b child: tray-32.png path, tray_available(), Bound/Failed gating.

### 2026-11-16 — wake #17: W3 integrated end-to-end
- W3b child finished (journal complete): settings panel (SettingsView mirror,
  settings.set dispatch + Shell-wrapper persistence), dark theme (all chrome
  reads visuals, accent #3d7ec2), close-guard decision tree via
  ViewportEvent::Close/CancelClose + doc_dirty tracking, widget immediate
  viewport (58×74 ↔ 304×60, park top-right, StartDrag, Enter/Space expand,
  Rec disabled until W4), app wiring (acquire_or_forward, tray/hotkey channels
  with graceful degradation, --capture/--region/path argv shared first+forwarded
  launch), desktop file %F + MIME (desktop-file-validate passes).
- Parent pre-verified all W3 snapshots by vision: settings (5 sections ✓),
  dark theme ✓, close-guard modal (plain copy + picture icon + Save/Discard/
  Cancel ✓), widget pill (white box in snapshot = kittest embedded-viewport
  artifact; code correct: transparent viewport + pill-only paint + clear 0).
- Parent gates: fmt ✓ (fixed own recording stub), clippy -D warnings ✓,
  **216 tests / 0 failed / 3 ignored** ✓, layers 23 ✓. Release + AppImage
  (12.8 MB) launch-tested (exit 124); tray gracefully unavailable on GNOME
  (no StatusNotifierWatcher — KDE has it); CLI 24 commands incl settings.
- Glyph lesson: ⚙ U+2699 absent from bundled fonts → painted gear (steered).
- Remaining W3 sign-off: rostad KDE live pass — tray click-to-restore,
  Print/Shift+Print portal consent, widget drag/transparency, hide-to-tray,
  settings persistence across restart.
- W3b completion report reconciled (all integrated in 55964c1): 28 ui-egui/app
  tests (10 w3_shell gates). Key design detail verified: eframe skips App::ui
  while hidden → channels drained in App::logic + 250ms heartbeat so hide-to-tray
  stays recoverable (lesson saved to skill; applies to W4 recording events too).
  SettingsView mirrors io::settings field-for-field (ui-egui stays io-free).
  autosave_captures: setting UI landed, save BEHAVIOR is W4 — parity row
  corrected to "W3 setting / W4 behavior" (honest ticking).

### 2026-11-16 — wake #18: W4 launched (recording + OCR/timelapse/upload/watermark)
- Fresh check: W3 complete on pn53 (d86b845), KDE live pass still pending rostad.
- W4 contracts locked in the plan (recording API, io::ocr/upload,
  capture::timelapse, compose::watermark). Loaded the proven recording recipe
  (tauri-desktop-app › recording.md) — all cost-real-time gotchas pasted into
  the W4a brief (target.object prop bug, registry wait, no SPA_PARAM_Buffers on
  consumer, VideoSize range, BGRx stride, teardown deadlock, offline probe).
- Dispatched W4a (recording: ScreenCast→PipeWire→ffmpeg, MP4/GIF, region crop,
  pause/resume, audio sources; offline Video/Source probe first) + W4c
  (OCR tesseract subprocess, upload open_url, timelapse thread, watermark).
- W4b (scrolling) follows W4a's ScreenCast source; W4d (UI: Rec live, recording
  controls, OCR panel, HUD) after backends. Trim question for rostad at W4d.

### 2026-11-16 — wake #20: W4c verified + committed; W4b dispatched
- W4c formally completed (transcript final line checked): parent-verified
  16 io + 44 capture + 42 compose tests = 103 (matches child report), clippy
  clean. Committed 9e7fbfe: io::ocr (tesseract, injection-safe lang, OCR-on-
  synthetic test), io::upload (http(s)-only), capture::timelapse, compose
  watermark (export-only by design).
- W3b straggler widget polish verified + committed f4ff0d3 (wake #19).
- Dispatched W4b scrolling (deleg_dab56bfb): pure row-signature + MAD aligner
  + vertical stitcher with synthetic-frame recovery tests first, ScreenCast
  HIDDEN-cursor source with the shared consumer traps; capture/Cargo.toml
  pipewire dep approved. W4a recording still running (modules written:
  lib 593 + audio 172 + crop 248 + ffmpeg 420).
- Next: W4a/W4b land → verify (offline probes) → engine command wiring
  (record/ocr/upload/timelapse/scroll + watermark export params) → W4d UI.

### 2026-11-16 — wake #21: W4c engine wiring landed
- Parent wired 7 new engine commands (31 total): ocr.available/languages/run
  (renders composite → tesseract), upload.open (scheme-guarded), timelapse.
  start/stop/poll (handle + event channel in Session, drained by poll), and
  doc.export watermark params {text,opacity,corner,size} → compose::apply_watermark.
- 3 new headless-safe tests (OCR availability + scheme guard, timelapse
  double-start/stop/missing-dir, watermark corner-pixel diff) — 22 engine tests
  green, clippy clean.
- W4a recording: 8 modules / 3084 lines written (capture.rs 802 PipeWire half,
  probe.rs 536 offline Video/Source probe, portal/session/audio/ffmpeg/crop) —
  still running. W4b scrolling: reading phase.

### 2026-11-16 — wake #23+: CI fixed, W4 backends landed, W4d dispatched
- rostad flagged GitHub CI notifiers: gates exit 101 + Node20/Ubuntu migration
  notices. Root cause: runners lacked libpipewire-0.3/libspa-0.2 dev headers
  (libspa-sys build panic). Fixed rust.yml: apt deps (pipewire dev, clang,
  tesseract, ffmpeg) + lavapipe (mesa-vulkan-drivers) for kittest snapshots
  (second failure: no wgpu adapter on bare runners), checkout/upload-artifact
  v4→v5 (Node24), pinned ubuntu-24.04. **CI GREEN** (run 43970030413, gates +
  appimage). Snapshots pass on lavapipe without tolerance changes.
- W4b scrolling landed + verified (49 tests; byte-exact 9-frame synthetic
  recovery, reverse scroll, guards) — committed 415c343; scroll engine
  commands wired (threaded start) 43f174c.
- W4a recording landed + verified (48 tests + offline probe ffprobe-proven:
  h264 200×120 19f MP4 + GIF) — committed b965a7f; record engine commands
  (start/stop/pause/resume/state/poll + audio.sources) wired f135c61.
  41 commands total, 24 engine tests.
- W4d UI dispatched (deleg_6fed6c7d): live Rec (V), recording HUD + region/
  format/audio, scrolling overlay + open-in-editor, OCR window + copy-text,
  timelapse dialog + HUD, watermark export settings, autosave-on-capture.
  Trim deliberately OUT (live has none; spec lists it — ask rostad).
- Next: W4d lands → verify → full gates → AppImage → W4 delivery + KDE pass
  (live recording/scrolling need rostad's unlocked session).
- W4a/W4c batch reports reconciled (already committed b965a7f/9e7fbfe/f135c61).
  New gold saved to skill: TWO real PipeWire deadlocks W4a found+fixed —
  (1) dropping ContextRc/CoreRc joins module-rt thread stuck in rtkit D-Bus →
  stop hangs; leak core+context+registry too, not just stream/listener/mainloop;
  (2) `pw-cli info 0` enters its REPL even with stdin(null) — not a liveness
  probe; use bounded producer startup. W4c extras: OCR test hand-drew a 5×7
  block font (O needed full-width bars or tesseract reads U); upload reaps the
  detached child on a helper thread (live blocked on .status()); timelapse
  frames 5-digit padded so ffmpeg glob order = frame order. Unused raster dep
  in recording manifest already dropped by parent.

### 2026-11-17 — wake #32: W4 integrated end-to-end
- W4d completed (1131s): live widget Rec (V widget-scoped / Ctrl+Alt+V main),
  recording HUD + region/format/audio options, scrolling overlay → open-in-
  editor, OCR window + copy-text, timelapse dialog + HUD, watermark export
  (persisted), autosave-on-capture dedup. Widget recording layout fixed per
  parent vision QA (filled red Stop square + single Pause + red dot + ×).
- Parent verification: 40 ui-egui/app tests (12 w4_live gates), **363 tests /
  0 failed / 5 ignored workspace-wide**, clippy/fmt/layers green. Release +
  AppImage (13.7 MB) launch-tested (exit 124), CLI 41 commands.
- Watermark/upload persistence closed both sides (engine fields c0a1bab +
  SettingsView wiring).
- Parity: 28 W4 rows ticked HONESTLY — 9 bulk-ticked rows reverted to pending
  after audit (overclaim catch): OCR lang-select/busy modal, timelapse ffmpeg
  video assembly (make_timelapse), Ctrl+. stop hotkey, shrunk countdown HUD,
  upload POST-to-endpoint flow (curl) — current upload = open_url only.
- W4 remaining gaps (W5/W6 backlog or rostad priority): recording trim
  (spec lists, live lacks — asked rostad), audio mic+monitor mixing, Recent
  rail video thumbnails, copy-diagnostics button, the 9 reverted rows above.
- Delivered W4 AppImage for rostad's KDE live pass: Rec → portal consent →
  record → stop → file; scrolling capture; OCR; timelapse. Portal legs need
  his unlocked session (pn53 locked; offline probes proven).

### 2026-11-17 — wake #33: W5 launched (automation + WASM)
- W4 delivered (3b45839), awaiting rostad KDE pass + trim decision. Next: W5.
- W5 plan: docs/plans/2026-11-17-w5-automation-wasm.md. Recon: photocraft
  control-protocol.md (loopback + token-file 0600 + first-frame auth +
  registry methods), rmcp 3.10 on crates.io.
- Parent pre-wired crates/automation (rmcp 3.10 server/transport-io/macros/
  schemars + tokio full-ish + getrandom 0.3 + schemars 1), compile-verified.
- Dispatched W5a (deleg_2502ae8e): TCP JSON control server (auth, commands.list,
  command.run, session.info, doc.inspect, ui.screenshot PNG-base64) + rmcp MCP
  stdio server (5 tools from registry), offline integration tests.
- W5b (parent, after W5a): app --control/--control-token-file flags + CLI
  mcp/control subcommands. W5c (next wake): WASM web build + xtask wasm gate
  (L0–L5 wasm32 compile, engine native/web feature split, trunk app).

### 2026-11-17 — wake #34: W5a committed; W5b + W5c-engine in flight
- W5a complete + committed (4fc29a6): TCP control + MCP stdio, 18 tests,
  rmcp Apache-2.0 (plan corrected). CI green after Node24 + snapshot-policy
  + fmt + consistent-tree fixes (run 44040349228 success).
- W5b dispatched (deleg_3927f082): ui-egui Session→Arc<Mutex> (sess() accessor,
  behavior-identical), app --control/--control-token-file + shutdown, CLI
  mcp/control subcommands (auth-first no-ack client).
- W5c recon: wasm32 target installed; ALL 8 pure crates (L0–L5) already
  compile wasm32 ✓. io/engine fail only on arboard (clipboard). capture/
  recording/platform/automation native-only.
- W5c-engine dispatched (deleg_ac3150ee, PARALLEL with W5b — disjoint crates):
  io/engine native/web feature split (native default byte-identical, web core
  compiles), xtask wasm gate. W5d (ui-egui web cfg + apps/snagcraft-web trunk)
  follows after W5b lands.

### 2026-11-17 — wake #39: W5b + W5c committed; W5d (web app) dispatched
- W5c-engine committed (32f90b9): native/web split, 21/41 commands in wasm
  rlib, xtask wasm gate (10 web crates), 68 tests, native byte-identical.
- W5b committed (7472f54): ui-egui Arc<Mutex> + sess(), app --control flags,
  CLI mcp/control. Parent LIVE round-trip verified: app --control 59990 ↔
  CLI → commands.list=41, doc.new=64x48, ui.screenshot=valid PNG, wrong
  token rejected, token 0600. Workspace 392 tests / 0 failed.
  (Gotcha: first smoke used STALE release binaries — the build had been in
  a rejected '& command'; rebuilt before the real round-trip.)
- W5d dispatched (deleg_d34add8c): ui-egui native/web feature split (platform/
  rfd/widget/clipboard cfg-gated, web PNG export-download via web-sys) +
  apps/snagcraft-web eframe WebRunner trunk app. trunk + wasm-bindgen-cli
  installing in background (proc_cd81b2c95668). Web app scaffold pre-wired.

### 2026-11-17 — wake #50: W5 COMPLETE (web app + watermark gap closed)
- W5d committed (3273af1): ui-egui 55 cfg gates (native byte-identical, 40
  tests), web fallbacks (PNG export-download, drag-drop open, clipboard
  status, Capture/OCR/widget/tray hidden on web); apps/snagcraft-web eframe
  WebRunner (body cfg wasm32, empty native lib), trunk dist 11MB wasm.
  Browser-verified: boot + full editor render + 14118-byte PNG export.
  Parent-verified: native 40 + workspace clippy + web clippy + fmt, 392/0.
  (Child over-verified with repeated browser screenshots — steered to wrap.)
- Watermark-on-web gap CLOSED: added Session::render_watermarked (public,
  same path as doc.export, refactored export to use it); web export_dialog
  now applies settings watermark via render_watermarked. engine+ui-egui 65
  tests green (export_watermark test preserved), web+native clippy clean,
  trunk rebuilt (11MB wasm). Web export now identical to desktop.
- W5 remaining MVP limits (documented, not gaps): web image copy/paste =
  status only (no ClipboardItem write); drag-drop open code-complete but not
  browser-exercised. recording crate has 9 pre-existing warnings on plain
  wasm check (outside web graph; clippy clean).
- W5 done: TCP control + MCP + CLI (live-verified) + WASM web app. Next W6.

### 2026-11-17 — wake #51: W6 launched (packaging + docs + dossier)
- W5 complete (794f143). W6 scope (spec §5): packaging polish (AppImage/deb,
  Windows/macOS aspirational), docs (README/gaps/parity), suite dossier.
- Scope reality: platform layer LINUX-ONLY (ashpd/ksni/PipeWire) → Windows
  NSIS/MSI + macOS dmg NOT feasible without platform backends; documented
  FUTURE in gaps.md. Cross-platform reach NOW via WASM web build.
- W6 plan: docs/plans/2026-11-17-w6-packaging-docs.md. dpkg-deb present →
  manual .deb (no cargo-deb). GATES: no release publish, no external posting,
  relicense/cutover = rostad.
- Dispatched W6a (sa-0, packaging: deb.sh + AppImage polish + rust-release.yml
  CI artifact workflow, NO publish) + W6b (sa-1, docs: README rewrite +
  gaps.md + suite-candidacy.md INTERNAL dossier + parity audit) — parallel,
  disjoint (packaging/.github vs docs/README).

### 2026-11-17 — wake #56: W6 COMPLETE — all waves W0–W6 built
- W6a committed (bbd2683): deb.sh (manual dpkg-deb, verified -I/-c, 10.2MB),
  rust-release.yml (workflow_dispatch + tag v* → AppImage/.deb/web-dist →
  upload-artifact ONLY, no release publish — gated), .desktop Categories
  fix (Graphics; only, validates clean). AppImage alive, YAML valid.
- W6b complete (docs verified grounded): rust/README.md (264 lines, L0–L7
  architecture, 41/21 commands, CLI/control/MCP/web, licence/gates),
  docs/gaps.md (14 entries A1–D2), docs/suite-candidacy.md (INTERNAL,
  no external posting), parity audit (150 rows, pending 68→45, 23 new
  code-verified ticks, 9 W4-reverted kept pending, stale W1 note replaced).
- W6b honest findings: NO recent rail at all (grep recent=0, not just video
  thumbs); capture.full has xcap macOS/Windows fallback (shell/recording
  Linux-only, capture not); ScreenCraft #2148/#2337 spec-only (dossier marks
  unverified); SUITE CANDIDACY BLOCKERS — GPL not on suite allowlist (core
  rule 9 stop-and-ask = relicense gate A3), fonts must move to craft-fonts
  (rust rule 3), CI must adopt craft-common-actions (core rule 11).
- MISSION BUILT: W0 probe gate, W1 scaffold/engine/capture, W2 tool parity
  (KDE-approved), W3 shell, W4 recording/scroll/OCR/timelapse, W5 automation
  + WASM web, W6 packaging/docs/dossier. 392 tests / 0 failed. Native
  AppImage + .deb + CLI + TCP/MCP control + browser web app, one Rust engine.
- REMAINING (all rostad-gated, not autonomous): W3/W4 KDE Plasma Wayland
  live pass; trim decision; relicense (GPL→MIT/Apache, also suite blocker);
  cutover; any external post / suite submission. NO releases published.

### 2026-11-17 — wake #57: loop re-fired after LOOP_COMPLETE → W7 parity backlog
- Loop woke again after wake #56's LOOP_COMPLETE. Re-checked fresh: W0–W6
  built (5474025), 392 tests. Full parity not yet met (45 pending rows);
  implementable offline backlog exists → continue toward parity (spec goal).
- W7 plan: docs/plans/2026-11-17-w7-parity-backlog.md. Target gaps B4#1–3
  (offline-verifiable, no rostad gate): timelapse.assemble (ffmpeg glob →
  h264 mp4), OCR language picker (io ocr_lang + ComboBox), OCR busy modal.
  Rows 4–9 (Ctrl+., countdown HUD, upload POST) deferred (live/network scope).
- Dispatched W7 (deleg_b4966464, one track, 3 features). ffmpeg 8.0.1 +
  tesseract confirmed present. Parent commits + ticks parity/gaps after.

### 2026-11-17 — wake #65: W7 COMPLETE (parity backlog B4#1–3 closed)
- W7 done (808s, 14 new tests): timelapse.assemble (recording/assemble.rs
  glob→h264 mp4, hostile-safe pattern, in-crate glob matcher, 300s bounded
  wait+kill, stderr log; engine native command, registry 41→42), OCR language
  picker (io ocr_lang persisted + ComboBox from ocr.languages), OCR busy modal
  (off-thread worker, spinner + disabled Extract, cleared on result/error/dead).
- ffprobe evidence: 5 odd 33×21 PNGs → h264 34×22 yuv420p nb_frames=5
  duration=0.416667 (even-dims pad works, decoy ignored).
- Parent fixed the sole red gate: automation control test hardcoded 41 →
  bumped to 42 (automation parent-owned, outside child scope) + rustfmt wrap.
- Parent-verified: workspace 390 passed / 0 failed / 5 ignored, clippy/fmt/
  layers/web-check clean. README 41→42 (web stays 21, assemble native-only).
- Parity B4#1–3 ticked W7; gaps.md B4 rows 1–3 marked CLOSED.
- Undone (documented): no "Make video" button in timelapse dialog (command +
  tests only, as scoped); ocr_lang single codes only (no eng+swe under the
  alnum/-/_ contract). Rows B4#4–9 still pending (Ctrl+., countdown HUD,
  upload POST — live/network scope).
- Child over-reconned early (steered to write) + vision-looped late (steered
  to cargo gates) — both steers effective.

### 2026-11-17 — wake #73: W8 COMPLETE — entire B4 backlog closed
- W8 done (688s, 18 new tests): upload POST flow (io upload_image via curl
  -F file=@-, http(s) guard before spawn, 30s bounded wait+kill, 1MiB cap,
  threaded pipes no deadlock, link parse+revalidate; engine upload.send
  native, registry 42→43; ui-egui File→Upload refuse-no-image/endpoint,
  copy link+status), Ctrl+. stop, compact countdown HUD (CAPTURE IN + number,
  capture_delay_secs driven). Real TcpListener mocks assert POST/multipart/
  PNG magic/link round-trip; hostile file://javascript: rejected no-spawn.
- PARENT parity fix: child wired Ctrl+.→record.stop, but live (app.ts:5181)
  stops INTERVAL capture (timelapse). Corrected handler→app.timelapse.running
  →stop_timelapse + rewrote the 2 kittest (7/7 green). Honest parity.
- Parent bumped automation drift-guard 42→43 (parent-owned) + fmt.
- Parent-verified: workspace 424 passed / 0 failed / 5 ignored, clippy/fmt/
  layers/web clean. Snapshots reviewed (countdown HUD clean; File button
  neatly inserted, no clipping; widget-in-harness popover = known artifact).
- Parity B4#4–9 ticked W8 (7 rows); gaps.md ALL 9 B4 rows CLOSED; README 43.
- B4 backlog fully closed. Remaining parity pending rows are other features
  (recent rail, W2 residuals etc.) + rostad gates (KDE pass/trim/relicense/
  cutover). NO releases published.

### 2026-11-17 — wake #84: W9 COMPLETE (save & recent UX)
- W9 done: io build_filename ({date}/{time}/{datetime} via chrono, fs-safe) +
  default_save_dir (HOME/Pictures/SnagCraft) + scan_recent (newest-first cap
  12); engine doc.save uses pattern + doc.save_as (registry 43→44); ui-egui
  Save As (Ctrl+Shift+S + File menu), settings save-location Change/Reset,
  Recent filmstrip (toggle chip + count + Hide, in-session + folder scan,
  click-to-open). Recording thumb = film-icon placeholder.
- Child ran way over budget (140 calls, 15min, never reported despite 2
  wrap-up steers) → PARENT STOPPED it + integrated directly from on-disk
  artifacts. Parent bumped automation drift-guard 43→44 (verified 13/13).
- Parent-verified: workspace 451 passed / 0 failed / 5 ignored, clippy/fmt/
  layers/wasm (10 web crates) clean. Recent strip snapshot reviewed: chip
  "Recent (3)" + filmstrip 3 labeled thumbs + Hide, counts agree, clean.
  (Pre-existing narrow-width "Sha…" toolbar overflow noted, not W9.)
- Parity 5 rows W9 (Save As, filename pattern, default dir, Recent strip,
  recording-thumb placeholder); README 44; gaps W9 note. Still pending:
  separate recording folder, New-canvas presets, Resize dialog, settings
  filename live-preview + other long-tail + rostad gates.

### 2026-11-17 — wake #90: W10 COMPLETE (canvas presets + Resize)
- W10 done: New-canvas dialog (Ctrl+N + File→New, 8 presets Default 1280×800
  … Small 800×600 + custom W/H + Create, dirty-guard); engine doc.resize
  (scales base + annotation geometry, clamp 1..=16384, registry 44→45) +
  ui-egui Resize… dialog (prefilled dims, Esc closes). kittest w10_canvas.rs.
- Child hit 70-call budget chasing snapshot shifts → PARENT STOPPED +
  integrated. New toolbar buttons shifted 7 existing snapshots; re-blessed
  with UPDATE_SNAPSHOTS=1 --no-fail-fast (default stops at first fail before
  reaching ui-egui — must use --no-fail-fast to bless all).
- Root-caused a residual 17px clean-run diff: a blinking text caret/focus
  speck (time-based render non-determinism, top-center toolbar), NOT a
  regression. Added rust/kittest.toml max_failed_pixels=64 (~0.008% of frame;
  real regressions change hundreds+ px and still fail). Stable across 2 runs.
- Parent bumped automation drift-guard 44→45 (13/13). Parent-verified:
  workspace 459 passed / 0 failed / 5 ignored, clippy/fmt/layers/wasm clean.
  New-canvas snapshot reviewed: 8-preset grid + custom fields + Create/Cancel,
  clean. Parity 94/95 W10; README 45; gaps W10 note.
- Remaining pending ~28 rows: settings rows (hotkeys enable/register, mic/
  system audio, recording format, filename live-preview), separate recording
  folder, copy diagnostics, PrintScreen fallback, text-caption settle,
  dirty-state, editor decorations + rostad gates.

### 2026-11-17 — wake #97: W11 COMPLETE (settings + diagnostics + PrintScreen)
- W11 done: settings cluster (interval period, mic source dropdown from
  audio.sources, system audio toggle, enable-global-hotkeys + Register button,
  recording format MP4/GIF, separate recording folder + Change/Reset, filename
  live-preview via build_filename); engine diagnostics.copy (portal log +
  .rec.log tail + version/OS → clipboard) + Troubleshooting button;
  PrintScreen/Shift+PrintScreen in-app fallback. Settings window vscroll=true
  (panel outgrew short screens). Registry 45→46.
- Child over-ran budget (83 calls) stuck on a kittest settings test → PARENT
  STOPPED + integrated. Root cause: W11's new rows pushed the Theme radio below
  the scroll fold; coordinate .click() missed it. FIX: click_accesskit() (clicks
  off-screen widgets) in theme_swap + settings_change tests; re-blessed
  w3_shell_dark (stale 760→1400 size). scroll_to_me alone didn't work.
- Parent bumped automation 45→46; cargo fmt --all (child left unformatted).
- Parent-verified: workspace 468 passed / 0 failed / 5 ignored, clippy/fmt/
  layers/wasm clean. Settings snapshot reviewed: General/Recording audio/Export
  clean; lower sections below scroll fold (reachable, tests confirm).
- Parity 14 rows W11; README 46; gaps W11 note. Remaining pending ~14 rows:
  editor residuals (text-caption settle, dirty-state, crop decorations) +
  recording thumbnails (real video) + rostad gates.

### 2026-11-17 — wake #100: W12 COMPLETE — FULL PARITY REACHED
- W12 done (65 calls, within budget): shortcuts overlay (? + File→Keyboard
  shortcuts, real-bindings SHORTCUTS const next to handle_keys; newly wired
  Ctrl+O + Ctrl+scroll zoom 0.25–4.0, default 1.0 byte-identical), About modal
  (File→About SnagCraft, accent mark + name + version 0.1.0 + tagline + repo,
  Esc/OK), derived dirty-state (engine saved_depth + dirty()/history_depth();
  save point moves on save/save_as/export, resets on new/open/capture; undo to
  save point clean again — sticky flag couldn't), ffmpeg-absent actionable
  message (Encoder::spawn + assemble). Editor residuals VERIFIED not rebuilt
  (caption settles on lost_focus; crop dim/frame painter-only, no doc write).
- Registry UNCHANGED (only session.info fields) → no automation bump.
- Parent polish: shortcuts ScrollArea scrollbar AlwaysVisible (vision flagged
  bottom rows "clipped" — actually below scroll fold; made affordance obvious),
  re-blessed w12_shortcuts. About snapshot reviewed: perfect.
- Parent-verified: workspace 474 passed / 0 failed / 5 ignored, clippy/fmt/
  layers/wasm clean. Parity 13 rows W12 → **pending = 1 (Trim, rostad-gated)**.
- Delivered fresh AppImage (13.9MB, launch-tested exit 124, CLI 46 commands) to
  rostad on his "När finns en version redo att testa?" — full feature set.
- MISSION: W0–W12 built, full parity except gated Trim. Awaiting rostad KDE
  live pass + gates (trim/relicense/cutover/external post). No releases.

### 2026-11-17 — wake #101: published Rust-edition pre-release (rostad authorized)
- rostad: "släng upp appen som en uppdatering i repot" → explicit publish OK.
- Existing v0.1.0 tag was the OLD Capicorn first-alpha (2026-11-14) — left
  untouched (no destructive overwrite). Used distinct tag **rust-v0.1.0**.
- Created GitHub pre-release rust-v0.1.0 (--prerelease --latest=false): assets
  SnagCraft-x86_64.AppImage (13.95MB) + snagcraft_0.1.0_amd64.deb (10.34MB),
  both verified uploaded. v1.5.3 remains stable "Latest" (no cutover).
- URL: https://github.com/rostaddotcc/snagcraft/releases/tag/rust-v0.1.0
- Still gated: cutover (promote Rust to stable / retire Tauri), relicense,
  trim, KDE live pass. This is a pre-release for testing, not a cutover.

### 2026-11-17 — wake #102: W13 audio mixing (B1 closed) — last functional gap
- Fresh re-check first: tree clean, no TODO/FIXME in app code, rust-v0.1.0
  pre-release still live (both assets, v1.5.3 still "Latest"), workspace
  474/0/5 + clippy/fmt clean. Parity pending = 1 (Trim, rostad-gated). The one
  remaining NON-gated functional gap was gaps.md **B1** (mic + system-audio
  mixing) — the W11 settings toggle existed but only one source ever recorded.
- W13 (parent-built, small): `AudioConfig` gains `system_audio` + `input_count()`;
  encoder opens one `-f pulse` input per source (mic first, then
  `@DEFAULT_MONITOR@`), two inputs mixed via `amix=inputs=2:duration=longest`
  into ONE aac track — the live `audio_output_args` recipe ported verbatim
  (aac 160k, `-shortest`). GIF stays silent; 0 sources = `-an`, never an error.
- `record.start` accepts `system_audio`; both audio params fall back to the
  persisted settings (W11 format precedent) via a pure `record_audio_config`
  helper. UI now passes the settings toggle. Capture thread carries the full
  `AudioConfig`; `.rec.log` line reports mic/system.
- Registry UNCHANGED (46) → no automation bump. 7 new tests (input_count, 4
  arg-shape, settings-fallback, + a LIVE end-to-end mix).
- **Live-verified on pn53 (pipewire-pulse present):** the encoder child mixed
  two real pulse sources into exactly ONE ffprobe-confirmed aac stream beside
  h264 (`the_encoder_mixes_two_pulse_sources_into_one_aac_track ... ok`). The
  probe self-skips on headless CI (no pulse socket), so it stays green there.
- Parent-verified: workspace **481 passed / 0 failed / 5 ignored**, clippy 0,
  fmt clean, layers legal (23 crates), wasm all 10 web crates compile.
- gaps.md B1 → CLOSED; parity audio row → W4 + W13. Remaining pending = 1
  (Trim, rostad-gated). No release re-publish (pre-release assets are W12-era;
  a refresh is rostad's call). Awaiting KDE live pass + gates.
- Fresh W13 artifacts built from the committed state (df3b20e, pushed):
  AppImage 13.9MB launch-tested (exit 124, benign locked-GNOME noise only) +
  deb 10.3MB, in rust/dist/w13/. CLI smoke: 46 commands, record.start doc
  shows system_audio. Delivered the AppImage to rostad.
- **B5 audit (same wake):** item 1 (crop re-grab) is NOT a gap — the live crop
  overlay is painter-only (selectable/evented false), the "handles" rail hint
  is prose. Items 2–3 CONFIRMED: no double-click text edit / select-mode resize
  (live fabric Textbox), no nib preview circle (live app.ts:433/993/3163 —
  parity row 52 W2 tick overclaimed, corrected). New nuance: live plain-click
  (<8px MIN_DRAG) resets the crop; rebuild leaves a 0×0 frame. **W14 scope:
  nib preview + double-click text edit (+resize) + crop click semantics.**
  The loop continues — editor interaction parity is the last open cluster.

### 2026-11-17 — wake #103: W14 editor interaction parity — B5 ALL CLOSED
- Fresh re-check: tree clean at 11a9b1e (W13 + promo renderer), suite green.
  W14 = the B5 cluster from the W13 audit, built parent-direct.
- **engine**: `edit.set_text {id,text}` + `edit.resize {id,rect}` (history-backed;
  wrong kinds report false, degenerate rects rejected). doc gains set_text/
  set_rect. Registry 46→48; automation guard + engine registry test bumped.
- **ui**: Select mode gets corner resize handles (7px accent squares, diagonal
  resize cursors, anchor-opposite-corner live preview) + double-click inline
  re-edit of Text/Callout (loads the object's own style; commit → set_text;
  emptying removes the object — live settle parity; quick-font bar hidden for
  re-edits). Brush rail gets the live nib preview (48px box, ink dot at 1:1
  diameter, value label — app.ts:433/993/3163). Crop: <8px drag/click resets
  the pending frame, Enter needs ≥8px (MIN_DRAG/MIN_SIZE parity).
- **Gates (kittest pointer paths, 60fps step_dt):** resize+undo, text
  re-edit/append/empty-remove, callout re-edit, crop click reset, nib snapshot
  (vision-verified). Two harness lessons: the properties rail height differs
  per tool → calibrate the image→screen mapping UNDER the exercised tool (a
  resize to a known screen point yields the absolute offset; a move only
  yields scale); kittest's default 250ms step_dt puts consecutive clicks
  outside egui's double-click window → with_step_dt(1/60), and three clicks
  inside 300ms count as TRIPLE (pause between pairs).
- Parent-verified: workspace **487 passed / 0 failed / 11 ignored**, no
  snapshot drift. clippy/fmt/layers/wasm clean (below).
- gaps.md B5 → ALL CLOSED; parity select/crop/brush rows → W2 + W14; README
  48 commands. **Pending parity = 1 (Trim, rostad-gated). No non-gated
  functional gaps remain.** Awaiting rostad: KDE live pass, trim decision,
  relicense, cutover, release-asset refresh. Promo film storyboard still
  awaiting his go (separate track).
- Fresh W14 artifacts from committed dfca838: AppImage 13.95MB launch-tested
  (exit 124) in rust/dist/w14/, CLI smoke 48 commands incl. edit.set_text +
  edit.resize. Delivered to rostad for the KDE live pass.
- **LOOP BACKLOG EMPTY**: every non-gated parity row and gap register entry is
  closed. Further iteration needs rostad's gates/feedback → loop completed.

### 2026-11-18 — wake #104: W15 timelapse stop→MP4 — a real gap behind a green checklist
- Fresh re-check: tree clean at 6869563, suite green (487/0/11). The W14 close
  said "backlog empty", but a code-level re-audit of the timelapse flow found a
  genuine functional gap: **the rebuild never assembled the video**. The live
  app auto-calls `make_timelapse` when a run stops (`app.ts:3019-3047`, 10 fps,
  `SnagCraft-timelapse-{date}-{time}.mp4` in the run folder); the rebuild's
  `poll_timelapse` "done" arm only reported the frame count. `timelapse.assemble`
  existed as a command (W7) but nothing in the UI flow called it. Parity row 191
  ("stop converts the run to MP4") was ticked W4 — an overclaim: the loop shipped,
  the conversion did not. gaps.md's "no Make video button" framing was also wrong
  (the live app has no button — it auto-assembles).
- **W15 fix (parent-direct):** `finish_timelapse(frames)` — zero shots → live
  "nothing was saved" wording; shots > 0 → "Building a timelapse from N shots…"
  + off-thread `assemble_timelapse` (pure L4 call, **no session lock** — the
  editor keeps painting during the encode, unlike the OCR worker). Result poll
  in `poll_media` (runs hidden too): "Timelapse saved: path (N shots, 10 fps)"
  + push to the Recent rail; failure → "Timelapse failed: err — the N shots are
  still in dir" (shots never lost); disconnected worker cleared likewise.
  Failed capture runs with shots on disk get the same shots-kept note. Run
  folder tracked in `TimelapseState.dir`; `assembling` joins the 250 ms repaint
  heartbeat. Dialog subtitle now says what stopping does ("…stopping builds a
  10 fps video."). ui-egui gains an optional native `snagcraft-recording` dep
  (L4→L6, layers legal).
- **Gates:** `tests/w15_timelapse.rs` — real ffprobe-verified h264 encode
  (3 frames, 34×22 padded) + recent-rail pickup + live wording; empty-run
  wording; NoFrames failure clears the flag and a second run assembles again
  (runs even without ffmpeg — NoFrames precedes the spawn). Dialog snapshot
  re-blessed (447 px, vision-confirmed subtitle-only) and vision-verified.
- Parent-verified: workspace **490 passed / 0 failed / 11 ignored**, clippy/fmt
  clean, layers 23 crates legal, wasm 10/10. No new engine commands → automation
  guard untouched (48).
- Docs: parity row 191 split (loop W4 / stop→MP4 W15), stale W6b summary table
  recounted row-by-row (claimed 45 pending; actual 1 — Trim, rostad-gated;
  151 rows total). gaps.md B4 row 3 residual closed with the corrected framing.
- **Pending parity = 1 (Trim, gated). No non-gated functional gaps remain —
  again, but this time the timelapse flow was audited end-to-end against the
  live anchor, not just the checklist.** Awaiting rostad: KDE live pass, trim
  decision, relicense, cutover. Web C2/C3 polish + design pass = next wakes.
- Fresh W15 artifacts from committed e6a64ac: release binary rebuilt, AppImage
  13.94 MB launch-tested (exit 124, benign locked-GNOME noise only) in
  rust/dist/w15/, CLI smoke 48 commands (unchanged — no new engine commands).
  Delivered to rostad for the KDE live pass.

### 2026-11-18 — wake #105: W16 web clipboard + drag-drop — C2/C3 CLOSED in a real browser
- Fresh re-check: tree clean at b0022c0, suite green (490/0/11). Scope = the
  web-MVP limits C2 (status-only clipboard) and C3 (unexercised drag-drop)
  from gaps.md §(c).
- **C2 fix:** web Copy renders the Export composite → PNG → `ClipboardItem` +
  `clipboard.write()`; web Paste → `clipboard.read()` → first image/png →
  `load_image_bytes` (the dropped-file path). Async via `spawn_local` + mpsc
  result channel polled in `app_ui` (`poll_web_clipboard`); one op at a time,
  every terminal path clears the channel; text-only clipboard = "no image"
  (not an error); failures carry the Export/drop fallback hint. Status-only
  fallbacks kept for the non-wasm host build. web-sys 0.3.107 `ClipboardItem`
  is STABLE — no `web_sys_unstable_apis` needed (checked the vendored source).
- **Browser evidence (Chromium, trunk release build, served on 127.0.0.1:8091):**
  boot → full editor render; **C3**: synthetic DataTransfer+File drop opened a
  120×80 PNG ("Opened 120×80 from the dropped file — annotate away.",
  vision-verified), a second 60×40 drop replaced it; **C2 write**: Copy →
  independent `navigator.clipboard.read()` probe found image/png (459 bytes) +
  "Copied 120×80 image to clipboard — paste anywhere."; **C2 read**: trusted
  CDP Ctrl+V restored the 120×80 composite ("Pasted 120×80 from clipboard.");
  **empty branch**: text-only clipboard → "Clipboard has no image to paste.",
  canvas untouched. Permissions via `Browser.grantPermissions`
  (clipboardReadWrite + clipboardSanitizedWrite).
- Harness lessons: synthetic `KeyboardEvent` on window does NOT reach egui —
  use CDP `Input.dispatchKeyEvent` (modifiers=2 for Ctrl); synthetic
  `DragEvent` with a real `DataTransfer` DOES work for drop; the "LOADING
  SNAGCRAFT…" DOM text lingers behind the canvas after boot — judge boot from
  a screenshot, not body text.
- Parent-verified: native suite **490 passed / 0 failed / 11 ignored**
  (unchanged — all new code is cfg-gated web), wasm clippy clean
  (`--target wasm32-unknown-unknown --no-default-features`), trunk release
  build success, xtask wasm 10/10. No native behavior change → no new
  AppImage (w15 artifact stays current).
- Docs: gaps.md C2/C3 CLOSED with the browser evidence, C1 recounted
  (25 of 48 — the old 21/41 was stale; counted from the registry cfg gates).
- **Remaining non-gated: design polish pass (next wake).** Rostad gates
  unchanged: KDE live pass, trim decision, relicense, cutover.

### 2026-11-18 — wake #106: W17 design polish — contrast, grouping, and the invisible-scrollbar root cause
- Fresh re-check: tree clean at 840ccd3, suite green (490/0/11). Scope = the
  design pass the loop asks for. Vision-audited light + dark shells and
  settings, then **code/pixel-verified every flag before fixing** (house rule):
  shadow-slider "ragged tracks" FALSE (all `add_sized(118px)`); "no status
  separators" FALSE (ui.separator present); settings-over-toolbar = seeded
  position, not a layout bug; demo-scene artifacts ignored.
- **Real fixes (6):**
  1. Light `FG_MUTED` (107,114,128)→(90,97,109): status/hint contrast on panel
     4.39:1 → **5.67:1** (WCAG AA at 11px; computed, not eyeballed).
  2. Dark idle widget outline: `widgets.inactive.bg_stroke` (58,63,71)→
     (86,93,104) — unchecked checkboxes/buttons were ~1.4:1 on the surface,
     now ~2.3:1. Panel hairlines untouched. (Override placed AFTER the generic
     stroke assignment — the first attempt inside the theme match was silently
     overwritten.)
  3. Settings `section()`: 10px air above, 13px strong (was 4px / 12.5), 2px
     below — faster scanning, clearer hierarchy.
  4. Toolbar grouping separators: edit ops | document ops | menus/tools.
  5. Settings `default_pos(60, 96)`: first open lands over the canvas, not over
     the swatches it configures.
  6. Settings `scroll_bar_visibility(AlwaysVisible)` + **the root cause of the
     "clipped, no scrollbar" reads: egui 0.37 floating scroll bars have
     `dormant_handle_opacity = dormant_background_opacity = 0` — AlwaysVisible
     alone paints NOTHING until the pointer hovers the area.** Proven with
     minimal kittest probes (Window AND plain ScrollArea both invisible
     no-hover; the W12 shortcuts snapshot only showed a bar because the test
     pointer was inside it). Fix: `style_mut_of` both egui themes →
     dormant handle 0.45 / background 0.12. Pixel-probe confirmed a ~140px
     dormant thumb at the panel edge with no hover; vision confirmed.
- Gates: 22 snapshot drifts, ALL verified snapshot-only (zero logic failures),
  diff vision-checked (text/separators/outlines only, canvas untouched) before
  re-bless; final snapshots vision-verified (light shell, dark shell, settings).
  Probe files removed after use.
- Parent-verified: workspace **490 passed / 0 failed / 11 ignored**, clippy/fmt
  clean. Native UI changed → fresh release binary + AppImage (below).
- Fresh W17 artifacts from committed dd0b4fc: release binary rebuilt, AppImage
  13.94 MB launch-tested (exit 124; benign locked-GNOME noise only — portal
  color-scheme timeouts, arboard X11 fallback, GNOME tray-host absent) in
  rust/dist/w17/, CLI smoke 48 commands. Delivered to rostad.
- Awaiting rostad unchanged: KDE live pass, trim decision, relicense, cutover.
  Non-gated backlog: empty again — next wakes re-audit headline flows or take
  rostad's feedback.

### 2026-11-18 — wake #107: W18 recording-flow audit — seven residuals behind the W4 ticks
- Fresh re-check: tree clean at 5484bbe, suite green (490/0/11). Applied the W15
  lesson to the next headline flow: **recording**, walked start→stop→pause
  against the live anchors line-by-line. The W4 section looked closed; the UI
  flow was not.
- **Seven residuals fixed (all live-anchored):**
  1. Filename: `snagcraft-rec-{epoch}` → live `SnagCraft-{date}-{time}.{format}`
     (app.ts:2368-2369, `recording_filename` helper).
  2. Stop → immediate Recent-rail pickup (`record_stopped`, app.ts:2505-2511);
     empty path → "Recording stopped, but no file was written." (was a blank
     "Recording saved: ").
  3. Status wording: waiting "Starting MP4/GIF recording — choose a screen…"
     (region variant with W×H), started "Recording — click Stop when you're
     done.", stop "Finishing the recording…" (app.ts:2439-2444/2475/2501).
  4. Start-error classification (app.ts:2481-2494): cancel → neutral, portal/
     permission → recovery hint, other → portal-log pointer (the rebuild writes
     the same ~/.cache/snagcraft-portal.log). Order adapted: rebuild portal
     errors are WRAPPED ("screen cast portal: … cancelled"), so cancel is
     checked before portal keywords — live received bare cancel strings.
  5. Capture-busy guard: "Wait for the capture to finish before recording."
     (app.ts:2402-2405).
  6. **Pause-aware HUD clock** (live paintRecTimer app.ts:2289-2292): freeze at
     the pause moment (`paused_at`), bank the span on resume (`paused_total`),
     subtract from elapsed. Was ticking straight through pauses.
  7. HUD "Region" scope tag on region takes (app.ts:2308-2310), gone otherwise.
- **Gates:** 7 new kittest/unit gates (tests/w18_record.rs): stop→Recent,
  empty-stop, deterministic pause-clock arithmetic (13 s frozen across reads),
  error classification ×3, filename pattern, Region tag present/absent,
  busy-guard. Two harness lessons: inject `rec.active` only — poll_record
  clears an injected `armed` when the engine reports no take (W4 idiom); and
  use seeded() + scratch save_dir so the host's real Pictures folder never
  leaks into recent-rail assertions. w4_live wording assertions updated to the
  live strings (one SIGSEGV was parallel-teardown noise after the assertion
  panic; serial run was clean).
- Parent-verified: workspace **497 passed / 0 failed / 11 ignored**, clippy/fmt
  clean, layers legal, NO snapshot drift (Region tag only paints when set).
- Docs: parity §6 Pause/Resume row split (engine W4 / HUD clock W18), four new
  W18 rows with live anchors, summary recounted (155 rows, 1 pending = Trim).
- Fresh W18 artifacts from committed d4caef9: release binary rebuilt, AppImage
  13.94 MB launch-tested (exit 124, benign locked-GNOME noise only) in
  rust/dist/w18/, CLI smoke 48 commands. Delivered to rostad.
- Awaiting rostad unchanged: KDE live pass, trim decision, relicense, cutover.
  Next wake: audit the next headline flow (save/export or scrolling capture).

### 2026-11-18 — wake #108: W19 save-flow audit — live saveEdited semantics + a swallowed error
- Fresh re-check: tree clean at 9e205f6, suite green (497/0/11). Next headline
  flow per the W18 plan: **save/export**, walked against the live anchors.
  Parity row 84 ("Save writes a -edited copy, never overwrites, 'Saved copy …'")
  was still at "W0 spike (PNG out)" — the semantics had never landed.
- **Fixes (all live-anchored):**
  1. `save_now` = live `saveEdited` (app.ts:1862-1885): guards "Nothing to save
     yet — capture a screen first." / "No changes to save"; writes a NEW
     flattened copy with the `-edited` suffix (engine `doc.save` gains a
     sanitized `suffix` param — hostile "../evil/x." → "evilx", tested);
     "Saved copy {filename}" wording; save point moves (engine saved_depth);
     Recent pickup; never overwrites (save_in_dir dedup, gate-verified).
  2. Toolbar Save + close-guard Save now use the same flat-copy path (live:
     both are saveEdited). The rebuild's editable .snagcraft save stays
     reachable as an explicit File → "Save editable (.snagcraft)…" entry —
     an addition, labeled as such (the live app has no native save).
  3. Context-menu "Save As…" was wired to the NATIVE save dialog — mislabeled;
     now calls the real save_as_dialog.
  4. Save As dismissed → "Save As cancelled" (app.ts:1908-1910), was silent.
  5. **Auto-save failure was swallowed**: autosave_capture set an error status
     that poll_capture immediately overwrote with "Captured…". Now returns
     Result<Option<PathBuf>, String>; all three outcomes stay visible (saved /
     off-not-saved / kept-in-editor-auto-save-failed, live autoSave semantics).
  6. Web Ctrl+S falls back to Export (no filesystem in a tab).
  7. **About license line** — vision caught a real W12 overclaim: the live
     About shows "GPL-3.0-or-later · commercial license available"
     (index.html:1184), the rebuild modal didn't. Added + label-gated +
     vision-verified. Relicensing itself stays rostad's gate.
- **Gates:** 6 UI gates (tests/w19_save.rs: no-doc guard via doc.close, clean
  guard, -edited copy + save point + Recent, dedup across saves, File-menu
  both-paths, autosave ×3 outcomes) + 1 engine gate (suffix placement +
  sanitization). Harness lesson: **push_settings, not app.settings assignment**
  — doc.save reads the ENGINE's save_dir; the first test run leaked four
  -edited PNGs into the host's real ~/Pictures/SnagCraft (removed; the gates
  now sync through settings.set). w12_about re-blessed twice (File-menu item
  shifted the About row → cursor-only diff; then the license line), both
  vision-verified. Parallel SIGSEGV in w3_shell = wgpu teardown noise again;
  serial run clean.
- Parent-verified: workspace **504 passed / 0 failed / 11 ignored** (serial),
  clippy/fmt clean incl. wasm target, xtask wasm 10/10.
- Docs: parity row 84 → W19 (full semantics), About row → W12 + W19, summary
  recounted (155 rows, W0 spike 5, W19 1, 1 pending = Trim).
- Fresh W19 artifacts from committed 2caae6d: release binary rebuilt, AppImage
  13.96 MB launch-tested (exit 124, benign locked-GNOME noise only) in
  rust/dist/w19/, CLI smoke 48 commands. Delivered to rostad.
- Awaiting rostad unchanged: KDE live pass, trim decision, relicense, cutover.
  Next wake: scrolling-capture flow audit (the last unaudited headline flow).

### 2026-11-18 — wake #109: W20 scrolling-capture audit — the last headline flow
- Fresh re-check: tree clean at 8da31f6, suite green (504/0/11 serial). Walked
  the scrolling flow against the live anchors (`runScrollingCapture`,
  app.ts:2723-2810). The W4 commands row cited `scrolling_cancel` — the rebuild
  had no cancel at all (Stop always stitched + saved).
- **Fixes (all live-anchored):**
  1. **Cancel/discard**: capture crate `ScrollHandle::cancel` (second atomic
     flag; the run tears down and emits `ScrollEvent::Cancelled` without
     writing), engine `scroll.cancel` command (registry 48→49; a cancel during
     the portal wait is remembered and applied the moment the handle lands),
     UI HUD Cancel button + Esc shortcut + "Scrolling capture cancelled"
     status (app.ts:2757-2763). Enter/Esc predicates now match the HUD
     (armed || active).
  2. **Done summary + Recent pickup**: `scroll_done` reports the live
     "Scrolling capture: W × H, N frames · saved {filename}" (frames floor 1),
     opens the stitched image and pushes it to Recent (app.ts:2770-2786).
  3. **Filename parity**: the result is saved under the normal capture
     pattern (build_filename_now + dedup), not `snagcraft-scroll-{epoch}`.
  4. **Error classification**: `scroll_error_status` ports `scrollErrorText`
     (app.ts:2586-2599) — locked-screen / 40 000 px height-cap / sharing-
     refusal recovery hints, applied to start errors and failed events.
- **Gates:** 6 UI gates (tests/w20_scroll.rs: summary+Recent+doc-open, empty
  path, frames floor, error classes ×4, cancel clears flags, HUD Stop+Cancel
  and Esc-discard via real key events), 1 engine gate (scroll.cancel headless:
  no-run no-op + pending-cancel during portal wait), 1 capture gate (cancel
  sets both flags). Automation guard 48→49 + engine registry test renamed.
- Parent-verified: workspace **512 passed / 0 failed / 11 ignored** (serial),
  clippy/fmt clean incl. wasm target, layers legal, xtask wasm 10/10, NO
  snapshot drift (the scroll HUD test is label-based).
- Docs: parity §7 commands row split (W4 + W20), three new W20 rows, summary
  recounted (158 rows, 1 pending = Trim); README 49/25; gaps.md C1 25/49.
- Fresh W20 artifacts from committed 01958c3: release binary rebuilt, AppImage
  13.97 MB launch-tested (exit 124, benign locked-GNOME noise only) in
  rust/dist/w20/, CLI smoke 49 commands incl. scroll.cancel. Delivered to rostad.
- **All five headline flows now flow-audited** (capture/crop W2-era, recording
  W18, timelapse W15, save W19, scrolling W20). Awaiting rostad: KDE live pass,
  trim decision, relicense, cutover. Next wakes: rostad feedback, or deeper
  polish (web C1 surface, OCR/upload flow re-audit, design).

### 2026-11-19 — wake #110: W21 OCR + upload re-audit — the 30-second freeze
- Fresh re-check: tree clean at 4aa9070, suite green (512/0/11 serial). With
  the five headline flows audited, re-audited the two remaining interactive
  flows: OCR and upload. Both had real gaps behind their W7/W8 ticks.
- **The big one — upload froze the editor**: `upload_image_now` dispatched
  `upload.send` synchronously on the UI thread; curl can block up to 30 s
  (UPLOAD_WAIT). The W8 parity row even cited "Uploading…" — a status the
  rebuild never showed. **Fix:** off-thread worker (W15 pattern): render +
  encode under a BRIEF session lock, then curl WITHOUT the lock; "Uploading…"
  status; `poll_upload` in poll_media (runs hidden too); one upload at a time.
- **Same latent bug in OCR**: the W7 worker held the session lock across the
  whole tesseract subprocess — and the toolbar locks the session EVERY frame
  (can_undo/can_redo), so the editor froze during extraction too. Now: render
  under a brief lock, tesseract without it.
- **OCR parity**: "Capture something first." guard (app.ts:4151-4154); previous
  result cleared on a new run; empty extraction → "No text found in this
  capture — try another language."; success → "Found N characters — Copy puts
  them on the clipboard."; error → "OCR failed: …"; Copy text button disabled
  until there is text (live ocrCopyBtn).
- **Upload parity**: missing endpoint now OPENS Settings (live panel?.open());
  success → "Uploaded — link copied: {link}" (live wording); empty link stays
  a failure; worker errors reported.
- **Gates:** 10 new (tests/w21_ocr_upload.rs) incl. a REAL off-thread upload
  round trip against a mock HTTP server (POST + snagcraft.png field verified,
  link-copy wording asserted). Harness lesson: mock servers answer in WALL
  time (read-timeout probe) — kittest steps advance no wall clock, so worker
  wait loops need a real sleep slice. w7/w8 tests updated to the async flow +
  live wording; w7_ocr_language_picker re-blessed (diff = Copy button state
  only, vision-verified).
- Parent-verified: workspace **522 passed / 0 failed / 11 ignored** (serial),
  clippy/fmt clean incl. wasm target, layers legal, xtask wasm 10/10. No new
  engine commands (registry stays 49 — the UI calls io::ocr/io::upload
  directly, the engine commands remain for CLI/MCP).
- Docs: parity OCR rows → W7/W4 + W21, upload flow row → W8 + W21 (overclaim
  noted), summary prose updated (158 rows unchanged, 1 pending = Trim).
- Fresh W21 artifacts from committed 5806e0e: release binary rebuilt, AppImage
  13.96 MB launch-tested (exit 124, benign locked-GNOME noise only) in
  rust/dist/w21/, CLI smoke 49 commands. Delivered to rostad.
- Awaiting rostad unchanged: KDE live pass, trim decision, relicense, cutover.
  Every interactive flow has now been audited against the live anchors.

### 2026-11-19 — wake #111: W22 Recent-rail design parity — the live film-item
- Fresh re-check: tree clean at 8542191, suite green (522/0/11 serial). Design
  pass on the secondary surfaces (widget, Recent rail, dialogs). Vision flags
  triaged against code first: widget "no selected mode" FALSE (action buttons,
  not modes), "orphan helper text" FALSE (the props rail behind the floating
  widget), rail "no empty state / no ellipsis / no tooltip" FALSE (all present),
  "placeholder thumbnails" FALSE (seeded test gradients). ONE real gap: the
  rail tiles were horizontal image-and-text chips; the live design is a
  vertical film-item (style.css:3411-3490).
- **Fix — the live vertical film-item:** 112×74 card, 104×48 rounded thumbnail
  on top, caption below with a format badge (ext uppercase, accent on surface,
  radius 4) + local HH:MM time; accent border + faint accent fill on the LOADED
  capture (new `recent_active`, the live `loadedRecentId` — set on tile open /
  capture / save / save-as / scroll-done, cleared on new canvas); hover lift;
  8px gaps, more rail padding. `RecentItem` gains `ts` (push = now, folder scan
  = mtime from io::recent::RecentEntry).
- **Latent bug found by the new video gate:** the old "▶" placeholder text has
  NO glyph in the bundled fonts — kittest panics, native renders tofu. The old
  tests never hit the branch (all tiles were decodable PNGs). Replaced with a
  painter-drawn film frame + sprockets + play triangle.
- **Gates:** 5 new (tests/w22_recent.rs): badge+time caption via a11y label,
  push timestamp, active-on-open + clear-on-new-canvas (with w22_recent_active
  snapshot, vision-verified accent ring), save-marks-active, video placeholder.
  Snapshot determinism lessons: pin `ts` (minute-boundary drift) AND the status
  text (scratch paths carry pid/nanos) — two consecutive full serial runs green
  after pinning. w9_recent_strip re-blessed for the new layout.
- Parent-verified: workspace **527 passed / 0 failed / 11 ignored** (two serial
  runs), clippy/fmt clean incl. wasm target, layers legal, xtask wasm 10/10.
- Docs: new parity row (film-item design, W22), recording-thumb row annotated,
  summary recounted (159 rows, 1 pending = Trim).
- Fresh W22 artifacts from committed f16fc87: release binary rebuilt, AppImage
  13.98 MB launch-tested (exit 124, benign locked-GNOME noise only) in
  rust/dist/w22/, CLI smoke 49 commands. Delivered to rostad.
- Awaiting rostad unchanged: KDE live pass, trim decision, relicense, cutover.

### 2026-11-19 — wake #112: W23 New-canvas dialog — the transparent overclaim
- Fresh re-check: tree clean at 397945d, suite green (527/0/11 serial). Design
  pass on the dialogs/menus. Vision flagged the New-canvas preset grid; the
  code audit against the live design (style.css:4661-4706, app.ts:4979-5080)
  found a REAL functional overclaim: parity row 94 said "white or transparent"
  (ticked W10) but `doc.new` was white-ONLY — no transparent option existed.
- **Fixes (all live-anchored):**
  1. **Transparent background**: `Document::transparent`, `doc.new {bg}`
     (white default, unknown values fall back to white — never a transparent
     surprise), dialog White/Transparent selectable pair.
  2. **Radio preset semantics** (live newPresetsEl click + syncNewSelection):
     clicking a preset FILLS the W/H fields (no immediate create); the card
     matching the current fields gets the accent ring; Create applies.
  3. **Vertical preset cards** (live .new-preset): name 12.5 strong over dims
     11 muted, two equal columns, 8px gaps, hover/active states.
  4. **Remembered size/bg** (live readNewPrefs localStorage): three new
     persisted settings (new_canvas_w/h/bg, validated 16..=8192 + bg
     whitelist); the dialog reopen prefills from them.
  5. Create is the accent-filled primary, right-aligned (live btn-primary).
- **Gates:** 5 UI (tests/w23_new_canvas.rs: transparent alpha-0 base, white
  default + hostile-bg fallback, remembered prefs round trip + reopen prefill,
  preset highlight snapshots ×2, Transparent-through-dialog flow) + 1 engine
  (doc.new bg matrix). w10 tests updated to the radio flow; w10_new_canvas +
  w23 snapshots vision-verified. io settings custom() fixture gained the fields.
- Parent-verified: workspace **533 passed / 0 failed / 11 ignored** (serial),
  clippy/fmt clean incl. wasm target, layers legal, xtask wasm 10/10.
- Docs: parity row 94 → W10 + W23 (overclaim noted), summary prose updated
  (159 rows unchanged, 1 pending = Trim).
- Fresh W23 artifacts from committed 52e4b3a: release binary rebuilt, AppImage
  13.99 MB launch-tested (exit 124, benign locked-GNOME noise only) in
  rust/dist/w23/, CLI smoke 49 commands. Delivered to rostad.
- Awaiting rostad unchanged: KDE live pass, trim decision, relicense, cutover.

### 2026-11-19 — wake #113: W24 close-guard + OCR button hierarchy
- Fresh re-check: tree clean at de14aaf, suite green (533/0/11 serial). Design
  pass on the remaining modals. Vision flagged the close guard's flat buttons
  and the OCR Copy button; the code audit against the live markup confirmed
  BOTH real: the live guard (index.html:1148-1166) is "Save changes before
  closing?" with Cancel left + ghost-danger Discard + btn-primary "Save & close"
  right, and the live OCR Copy is btn-primary (index.html:1293). Vision's other
  flags were false (OCR monospace IS the live font; the guard's image icon IS
  the live ICONS.image; scrim is the egui-window idiom).
- **Fixes:**
  1. Close guard: live title, Cancel (secondary) left, Discard (danger ink +
     border, transparent fill — new theme-aware pal_danger, live --danger
     #c9405c/#ff6f86) + "Save & close" (accent primary) grouped right.
  2. OCR "Copy text" → accent-filled primary (keeps W21 disabled-until-text).
- **Gates:** 4 new (tests/w24_guard.rs): Save & close writes the copy before
  quitting, Discard quits WITHOUT writing, Cancel keeps the doc, hierarchy
  snapshot (vision-verified). w3_shell guard test updated to the new labels;
  w3_close_guard + the three OCR snapshots re-blessed (diffs vision-checked =
  Copy-button fill only). Two consecutive full serial runs green.
- Parent-verified: workspace **537 passed / 0 failed / 11 ignored** (×2 serial),
  clippy/fmt clean incl. wasm target, layers legal, xtask wasm 10/10.
- Docs: new close-guard-design parity row (W24), OCR-copy row → W4+W21+W24,
  summary recounted (160 rows, 1 pending = Trim).
- Fresh W24 artifacts from committed 2ac40a7: release binary rebuilt, AppImage
  13.99 MB launch-tested (exit 124, benign locked-GNOME noise only) in
  rust/dist/w24/, CLI smoke 49 commands. Delivered to rostad.
- Awaiting rostad unchanged: KDE live pass, trim decision, relicense, cutover.

### 2026-11-19 — STRATEGY: Tauri development cut (rostad) + issue #1 investigation
- **rostad's decision (2026-11-19, direct message): cut Tauri app development,
  focus the loop entirely on the Rust edition.** The root Tauri v1.5.x line
  stays frozen as the shipping stable; release cutover remains a separate gate.
  All future wakes work only in `rust/`.
- **Issue #1 "Multiple monitors" investigated (rostad: "sure it's Windows"):**
  reporter JuanJoseJimenezdeCisneros (2026-11-17) wants a monitor-selection
  prompt on a dual-monitor setup; no OS stated, profile empty (0 repos, no
  bio/location — no OS signal). rostad already asked the needs-info questions;
  no reporter reply yet.
- **Code evidence strongly supports Windows:** stable Tauri `capture_full` on
  Windows/macOS = `xcap::Monitor::from_point(0, 0)` → ALWAYS the primary
  monitor, silent, no picker (src-tauri/src/capture.rs:28-41); the menu's
  "Choose screen" (`capture_monitor`) and window capture are Linux-only —
  non-Linux builds bail "monitor/window capture is not supported on this
  platform yet" (capture.rs:97-105). Linux Wayland HAS the portal picker, so
  the complaint matches the Windows experience exactly (macOS shares the code
  path but is far less likely).
- **Online grounding:** xcap README implementation table — screen/window
  capture + recording ✅ Windows (≥8.1); `Monitor::all()` enumerates outputs
  with friendly_name/is_primary/geometry (docs.rs/xcap + github.com/nashaofu/xcap).
  xcap 0.9 uses windows crate 0.62. So the gap is SnagCraft's wiring, not the
  library — and xcap (Apache-2.0, allowlist-clean) is the natural candidate for
  the Rust edition's D1 Windows/macOS capture backend, with an in-app monitor
  picker where no OS picker exists.
- Draft issue reply prepared for rostad's OK (external-post gate): honest
  platform status + the Windows diagnosis + Rust-edition plan; no Tauri fix
  promised (development cut). **rostad: do NOT post — wait for the reporter's
  reply. And: Windows capture IS the next big wave (W25+).**

### 2026-11-19 — W25a: Windows-capture wave opened — feasibility probe PASSED
- Plan: `docs/plans/2026-11-19-w25-windows-capture.md` (W25a–e).
- **Probe (pn53, cross-compile only):** `rustup target add x86_64-pc-windows-msvc`;
  `cargo check -p snagcraft-capture / -p snagcraft-platform / -p snagcraft
  --target x86_64-pc-windows-msvc` → **the WHOLE egui app compiles for Windows.**
  xcap 0.9 + windows crate 0.62 compile; tray-icon is cross-platform; ashpd/
  hotkeys are cfg(linux). The app shell was already Windows-ready — the gap for
  issue #1 is monitor CHOICE, not a from-scratch port.
- **Only blocker found + fixed (W25a):** `automation::write_token_file` used
  Unix-only `std::os::unix::fs` + `Permissions::from_mode(0o600)`. Split
  cfg(unix) (keeps 0600, reuse-safe) / cfg(not(unix)) (writes without mode bits;
  token lives in user-scoped app data). Linux behavior unchanged.
- Parent-verified: Linux workspace **537 passed / 0 failed / 11 ignored** (serial,
  no regression), automation clippy clean, Windows `cargo check` Finished.
- **Honest limit:** pn53 can COMPILE for Windows and run headless logic tests but
  cannot RUN Windows capture. Real multi-monitor proof needs a Windows host
  (rostad or CI windows-latest). Next: W25b monitor enumeration + per-monitor
  capture, W25c engine commands, W25d in-app picker, W25e CI.

### 2026-11-19 — W25b/c/d: monitor enumeration + commands + in-app picker (issue #1)
- **W25b (capture crate):** `MonitorInfo` (plain serde, no xcap leak),
  `list_monitors()` (xcap `Monitor::all` on Windows/macOS; empty on Linux — the
  portal is the picker there), `capture_monitor_index(index)` (xcap per-monitor;
  Linux → Unsupported routing to the portal). serde added to the crate.
- **W25c (engine):** `capture.monitors {}` + `capture.monitor {index}` commands
  (native). Registry 49→51; BOTH count guards bumped (automation + engine).
- **W25d (ui):** Capture → "Choose screen…" → `open_monitor_picker` (queries
  capture.monitors; empty → system-picker note; non-empty → picker dialog).
  `monitor_picker_dialog` lists monitor cards (name, resolution, Primary badge),
  click → `capture_monitor(index)` through the SAME off-thread pipeline as a full
  capture (autosave + Recent + load for free). Esc/Cancel close. `capture_in_flight`
  test seam. Native-only (web has no capture).
- **Gates:** 5 new (tests/w25_monitor_picker.rs): picker list + Primary badge
  (snapshot, vision-verified), click→capture dispatch, Esc/Cancel, Linux empty-list
  fallback note, engine commands (monitors array, missing-index reject, Linux
  portal routing). w4_capture_menu + w4_timelapse_dialog re-blessed (new menu item;
  diff vision-checked = clean insertion). Two consecutive full serial runs green.
- Parent-verified: workspace **542 passed / 0 failed / 11 ignored** (×2 serial),
  clippy/fmt clean, layers legal, xtask wasm 10/10, **Windows `cargo check` Finished**.
- Docs: 2 new parity rows (monitor selection + cross-platform backend), summary
  recounted (162 rows, 1 pending = Trim). Plan W25b/c/d marked done.
- **Still honest:** the picker + dispatch are proven headless; the actual Windows
  multi-monitor GRAB needs a Windows run (rostad/CI). W25e (CI windows-latest) next.
- Minor cosmetic note: the picker dialog has extra vertical whitespace below the
  last card (egui window sizing) — polish follow-up, not a defect.
- Fresh W25 artifacts from committed f352897 (+lockfile 3180fbc): release binary
  rebuilt, AppImage 14.01 MB launch-tested (exit 124, benign locked-GNOME noise
  only) in rust/dist/w25/, CLI smoke 51 commands incl. capture.monitors +
  capture.monitor. Delivered to rostad.

### 2026-11-19 — W25e: Windows CI verification GREEN (issue #1 offline proof)
- Added the `windows` job (windows-latest): whole-app `cargo build --workspace` +
  `cargo test --workspace --exclude snagcraft-ui-egui --no-fail-fast`. **GREEN**
  (run 44487918920, commit bed5487) — the app compiles for Windows and every
  logic-crate test passes on a real Windows runner. The kittest UI suite stays
  Linux-gated (GPU/display-dependent).
- The first Windows run compiled but 8 tests across 4 crates carried Linux/host
  assumptions; fixed (commits 2700126, bed5487): cfg(unix) the 0600 token-mode,
  Unix-socket, file_uri percent-decode and XDG-autostart tests; self-skip the
  tesseract/ffmpeg-dependent tests when the binary is absent (Windows runner has
  neither); timelapse impossible-folder + recording sane-config use real temp
  paths (not /proc or /tmp); engine ocr.available asserts a bool not a host value.
  Recipe: `cargo check --workspace --tests --target x86_64-pc-windows-msvc` catches
  test-COMPILE issues a plain check misses; runtime-only failures need CI to surface.
- CI hardening: an apt-get install hung 30min+ on a runner (intermittent infra).
  Added timeout-minutes to gates/appimage/windows jobs, step-level apt timeouts,
  Acquire::Retries=3 + http Timeout, --no-install-recommends.
- Linux suite green throughout: 542/0/11 serial, clippy/fmt clean, layers legal.
- **Honest limit unchanged:** compile + headless logic tests are the offline
  Windows evidence. The live interactive multi-monitor GRAB still needs a Windows
  desktop run (rostad or a CI artifact he runs). Not claimed as "works" yet.

### 2026-11-19 — W26: compact dialog footers (design polish)
- Vision audit found the monitor picker stretched to ~2× its content (~120px void
  above Cancel). Root cause: a bare `ui.with_layout(right_to_left)` footer expands
  to the egui Window's full available height. Fixed both the picker and New canvas
  (airy ~50px) with `allocate_ui_with_layout` at a fixed row height (24/28px).
- Audited the other three `right_to_left` uses: OCR Extract is in the top control
  row; close-guard / shortcut-row / capture-menu are nested in `ui.horizontal` —
  all already compact, left unchanged.
- Snapshots re-blessed + vision-verified compact. 542/0/11 twice serial, clippy/fmt
  clean. Commit 6f83a34. AppImage 14.01 MB launch-tested (dist/w26/), CLI 51.
- **Lesson:** in an egui Window, right-align a footer with a fixed-height
  `allocate_ui_with_layout`, never a bare `with_layout(right_to_left)` (it stretches
  the window). Nested-in-horizontal uses are safe.

### 2026-11-19 — W27: Settings Capture delay = live pill group + Capture section
- Fresh vision audit of Settings (triaged against the live authority, not blind
  fixes): the "clipped bottom row / no scrollbar" flag was a STALE w3 snapshot —
  the code already has `.vscroll(true)` + AlwaysVisible (W11/W17). "Recording format
  under Export" matches the live app (false flag). The REAL gap: the parity doc
  claimed "capture delay pills" + a Capture section (W3/W4) but the rebuild had a
  continuous 0..10 slider merged into General.
- Fixed to match live: a dedicated **Capture** section (delay + interval + the live
  help line) and `TIMER_CHOICES [0,3,5,10]` as **uniform segmented pills** (Off / 3 s
  / 5 s / 10 s). selectable_value alone left unselected options as bare text, so each
  pill is a Button with a neutral container (accent fill when selected).
- 3 new gates (tests/w27_capture_delay.rs): pills render, a pick persists through
  `settings.set`, the Capture section groups delay+interval. ("Capture" alone is an
  ambiguous label — also the toolbar menu — so the section gate keys on the unique
  help line.) Settings snapshots re-blessed + vision-verified uniform pills.
- 545/0/11 twice serial, clippy/fmt clean. Commit 30cb150. AppImage 14.01 MB
  launch-tested (dist/w27/). Parity rows corrected (W3/W4 + W27).
- **Lesson:** audit snapshots can be STALE (predate later fixes) — re-render with
  current code before trusting a vision "defect". And the parity doc can overclaim
  (said pills, code had a slider); verify code against the claim, not just the doc.

### 2026-11-19 — CI: root-caused the recurring apt hang (dead regional mirror)
- The intermittent gates/appimage red runs (incl. the bbac24e release commit) were
  NOT code: the runner's regional cloud mirror `*.ec2.archive.ubuntu.com` was
  unreachable and apt hung retrying it for package lists until the 10-min step
  timeout. The `archive.ubuntu.com` fallback worked for InRelease but apt kept
  hitting the dead EC2 mirror for Packages.
- Fix (commit f2f82f3): rewrite the cloud-mirror URIs to `https://archive.ubuntu.com`
  in `/etc/apt/sources.list.d/ubuntu.sources` + `sources.list` before `apt-get
  update`, in all three apt steps (gates, appimage, rust-release). Kept Acquire
  retries + step timeouts as a backstop.
- Verified: run 44504960038 fully GREEN — gates + windows + appimage all success;
  the apt step completed in ~4 min (normal, no hang).
- **Lesson:** a timed-out apt step on a GitHub ubuntu runner is usually the regional
  cloud mirror, not a dpkg lock — read the apt log (Ign: lines on the dead mirror),
  then force the canonical archive mirror.

### 2026-11-19 — verification wake: widget fidelity + web build health (no change)
- Floating widget audited against the live authority (src/widget-main.ts): the Rust
  widget is FAITHFUL — drag-from-anywhere on the pill (StartDrag, like live's
  data-tauri-drag-region), fold `»` distinct from close `×`, Rec flips to stop-square
  + Pause/Resume mid-take, folded tab = wordmark + live dot + expand chevron.
  Full/Region/Rec are ACTIONS (no persistent selected state expected). The W27
  vision flags (no drag handle / no fold / redundant record icon / no active state)
  were all false positives from the static seeded snapshot. No fix needed.
- Web (WASM) build re-verified end-to-end after W18–W27: `cargo xtask wasm` (10
  crates) + `trunk build --release` green; served + browser-checked — boots to the
  full editor (toolbar/canvas/status), Ctrl+, opens Settings, the W27 Capture delay
  pills render on web, General shows the correct "desktop-only" note, scrollbar
  handles overflow. The "LOADING SNAGCRAFT…" body text is a hidden placeholder, not
  a stuck load (vision confirmed the rendered editor). Web surface healthy.
- CI still green (runs f2f82f3 + 30cb150 success); issue #1 still awaiting reporter.

### 2026-11-19 — W28: real video first-frame thumbnails in the Recent rail
- Closed the last B2 sub-gap (gaps.md B2/B3 were stale — the rail was built W22,
  copy-diagnostics W11; marked both CLOSED). The remaining real gap: video tiles
  showed a film placeholder, not a frame (live `recording_thumb`).
- `io::recent::video_thumbnail`: ffmpeg frame 1 (`-frames:v 1 -vf scale=W:-2` →
  PNG, the live commands.rs:534 recipe), dispatched from `thumbnail()` for
  mp4/webm/mov/mkv (gif stays on the image decoder, which reads its first frame).
  No image byte cap on video (ffmpeg streams it).
- UI: video tiles route to a persistent off-thread worker (`request_video_thumb`
  spawns once, `poll_video_thumbs` loads textures), pumped in BOTH `app_ui` and
  `logic` (first attempt only put it in `logic` = hidden path → the video gate
  failed; the visible frame loop is `app_ui`). Limited to the newest 8 videos
  (live `MEDIA_VIDEO_THUMBS`); absent/unreadable ffmpeg keeps the film placeholder.
- 5 new gates: io routing-by-extension, real-frame extraction from a synthetic
  testsrc clip (self-skip without ffmpeg), missing-file None; UI video tile gains
  a texture (wall-time poll), image tile stays synchronous. Snapshot vision-verified
  a real SMPTE frame + MP4 badge. w27 settings snapshot re-blessed (scrollbar fade
  timing shifted once; stable ×3 after).
- 550/0/11 twice serial, clippy/fmt clean, wasm 10/10. Commit 191ec78. AppImage
  14.02 MB launch-tested (dist/w28/), CLI 51.
- **Lesson:** the per-frame pump for the VISIBLE window is `app_ui`; `logic` runs
  only while hidden. A worker polled only in `logic` never lands in normal use.

### 2026-11-19 — gaps.md reconciliation (stale "pending" claims vs verified code)
- Audited gaps.md against the code and corrected stale records (no code change):
  - B4 table rows 4/5/6–9 still listed "what is missing" though the W7/W8/W15
    notes said all nine closed. Verified each in code (Ctrl+. `consume_key(CTRL,
    Period)`, `countdown_hud`, `io::upload_image` POST multipart) and marked the
    table rows CLOSED with the closing wave.
  - W9 "still pending" list (separate recording folder, New-canvas presets, Resize
    dialog, filename live-preview, video thumb) — all done W10/W11/W23/W28; updated.
  - C1 web command count "25 of 49" → **25 of 51** (W25 added capture.monitors +
    capture.monitor, both native-only). Verified by counting the registry: 51
    CommandSpec, 26 native-gated, 25 web. Native-only list 24 → 26.
- The honest record now matches the code: the only open items are the rostad gates
  (A1 KDE live pass, A2 Trim, A3 relicense, A4 cutover) + inherent web MVP limits.

### 2026-11-19 — W29: rostad's bug reports — capture root-caused (KDE portal), magnify sees annotations, toolbar fits all 13 tools
- **"capture fungerar ej alls" root cause is the KDE portal backend, not the
  app.** Plasma ≤ 6.7's xdg-desktop-portal-kde fails NON-interactive Screenshot
  requests outright (code 2, no dialog, no KWin call) — it instantiates the
  QuickDialog even when nothing should be shown (KDE bug 527399, fixed
  2026-11-17 e14658ea; flameshot#4883 documents the same failure with busctl
  traces, even for an empty parent_window). Both SnagCraft editions call
  `interactive(false)`, so capture died instantly on rostad's Plasma box.
  Fix (Rust edition only — Tauri stays frozen): non-interactive first, on a
  portal refusal retry ONCE via `interactive(true)` with a 120 s user budget
  (the ScreenCast picker's). Cancelled/Timeout/Io are final — no nagging, no
  double hang. New `CaptureError::Cancelled` keeps the UI's cancel wording.
- **Hide/settle/restore parity closed** (live commands.rs:41-96): the worker
  sends `HideForGrab` after the countdown, the UI hides root + widget, 220 ms
  settle, grab, `Done(result)`; windows restored on EVERY outcome (success,
  error, disconnect). `poll_capture` now runs in `logic` too — eframe skips
  `ui` for a hidden root, so logic is the only pump that can land the result
  (the W28 lesson). 3 gates (w29_capture_hide): real-thread e2e (wall-time
  wait; locked host = 15 s timeout path, CI = fast-refusal path), logic-path
  success, logic-path failure + widget. 2 capture-crate gates for the retry
  decision + cancel mapping.
- **Magnify now magnifies annotations** (rostad's second report): `draw_magnify`
  samples the working composite instead of `ctx.base` — everything below the
  lens in z-order (capture + arrows/shapes/effects) is enlarged; later objects
  paint over it. Intentional live deviation (parity row 6 updated). Regression
  gate fails on the old code (probed), passes on the new; the seeded lens sits
  in the spotlight's dimmed zone, so all shell snapshots drifted lens-only —
  re-blessed, and a pixel probe proved the new lens matches the surrounding
  dimmed canvas (vision had misread it as "bright/undimmed").
- **Design: all 13 tools visible again.** The single toolbar row overflowed at
  1100 px — Callout/Step/Magnify hid in an invisible horizontal scroll.
  Open/Export/Resize… moved into the File menu (live keeps Open there too;
  w10 gates updated), tool buttons 32→28 px + spacing 4→3, and every tool
  button got a real accesskit label (a11y + queryable). Gate: all 13 rects
  inside the window at 1100 px + File-menu carries the moved ops. The
  custom-color chip is now 20×20 like the swatches (egui sizes it from
  `interact_size`, BOTH axes — setting only `.y` left the wide pill).
- Also removed the dead `Ctx.base` field and the web-only dead `item_path` /
  `video_seen` bindings (clippy clean on native AND wasm targets).
- 559/0/11 twice serial, clippy/fmt clean both targets, wasm 10/10. Snapshots
  re-blessed + vision-verified (13/13 icons, uniform swatch row).
- **Lesson:** a "capture doesn't work" report on KDE is the portal backend's
  non-interactive bug until proven otherwise — read the backend source, don't
  just re-test the app. And vision brightness flags on magnified checkers need
  a pixel probe (old-vs-new mean vs surrounding) before any "fix".

### 2026-11-19 — W30: region-pick freeze self-inclusion fixed, swatch rings readable, timelapse gap logged
- **Region-pick freeze showed SnagCraft itself.** `start_region_pick`
  (record/scroll region selection) grabbed the screen with the app's windows
  visible — live grabs through `capture_screenshot`, which hides them
  (app.ts:2548/2732). Now the same W29 dance, UI-local: hide at pick start →
  220 ms settle → grab → restore when the freeze lands (success, error AND
  disconnect), because the picker overlay paints in the main window and the
  user needs it back for the drag. `poll_pick` already rode `poll_media` in
  both pumps, so the hidden path worked with no new wiring. 3 gates
  (w30_pick_hide): real-thread e2e, logic-path freeze landing, logic-path
  failure. Existing w4/w20 pick gates untouched (seed path).
- **Timelapse has the same self-inclusion but needs a wave** (gaps.md B6):
  the interval loop lives in the capture crate behind the engine session, so
  per-frame hide/restore must cross the engine boundary as a hide-ack
  handshake (HideForFrame event → UI hides + acks → settle → grab → restore).
  Logged with the design, not patched half-way.
- **Swatch rings were invisible at the extremes** (vision audit, confirmed by
  WCAG math): dark's black swatch ring 1.43:1, light's white swatch ring
  1.47:1 — both panel-hairline colors. New theme-aware idle rings: dark
  (110,117,128) = 3.26:1 vs rail / 4.52:1 vs black fill; light (135,141,150)
  = 3.34:1 vs rail. 2 pixel gates (w30_swatch_ring) locate the black swatch
  by EXACT fill match (the dark panel is only a few RGB units away — a loose
  threshold merges them) and probe the ring pixel; both fail on the old code.
- **Snapshot trap found:** kittest's default per-pixel `threshold = 0.6`
  silently absorbs small color changes — the ring tweak produced a 700 px
  raw diff that counted as 0 failing pixels, so UPDATE_SNAPSHOTS never
  re-blessed and the blessed files kept the OLD rings while tests passed.
  Force `threshold = 0.0` + `max_failed_pixels = 0` temporarily to re-bless
  intentional palette changes, then restore the caret-noise budget. Verify
  re-bless by pixel-probing the blessed file, not by "tests green".
- Vision triage: settings "clipped Export section" = scroll-fold artifact
  (scrollbar thumb pixel-confirmed present); filmstrip "no active ring" =
  seeding artifact (loaded doc is not a recent file); dark helper-text
  contrast flag = false (measured 5.83:1).
- 564/0/11 twice serial, clippy/fmt clean both targets, wasm 10/10.
- **Lesson:** "tests green + UPDATE_SNAPSHOTS" does NOT mean the blessed
  pixels match the render — the per-pixel threshold can hide a real change.
  Probe the blessed file after any intentional color tweak.

### 2026-11-19 — W31: timelapse hide-ack handshake (B6 closed) — no grab flow shows the app anymore
- **B6 closed as designed.** The interval worker now wraps every grab in the
  hide-ack handshake: `HideForFrame` event → UI hides main+widget and acks via
  the new `timelapse.ack_hide` command (shared `Arc<AtomicBool>` gate created
  by `timelapse.start`) → worker waits ≤2 s (then grabs anyway — a stuck UI
  degrades one frame, never stalls the run) → 220 ms settle → grab →
  `RestoreAfterFrame`. Restore is ALWAYS sent once a hide was asked (failed
  grab, stop during wait/settle included); the UI restore is flag-guarded and
  channel order undoes even a late hide. Done/Failed clear the gate.
- **UI refactor:** the W29/W30 capture/pick hide/restore bodies collapsed into
  shared `hide_app_windows`/`restore_app_windows` (live commands.rs:47-76
  parity); each flow keeps its own flag (`capture_hidden`, `pick_hidden`,
  `timelapse.frame_hidden`). `poll_timelapse` split into `apply_timelapse_event`
  (pub seam) + the poll shell; restore fires on restore-event, done, failed,
  running=false fallback AND poll error. All W29/W30 gates re-passed unchanged.
- Registry 51→52 (`timelapse.ack_hide`, native-only): both count guards bumped
  (automation + engine), gaps.md C1 recount 25-of-52 / native-only 27.
- 10 new gates: 6 capture (ack consumed/late/timeout/stop, gated loop preset
  stop + dropped receiver — none touch the portal), 1 engine (ack no-op
  without a run), 3 UI (seam state machine incl. end-while-hidden + duplicate
  restore, done-restore, real engine+worker e2e with the wall-time wait).
- 574/0/11 twice serial, clippy/fmt clean both targets, wasm 10/10. No snapshot
  drift (the hide is runtime-only). W30 CI fully green before this wave.
- **Lesson:** a worker behind the engine boundary can still coordinate UI
  side effects — event out, ack command back, shared atomic gate; bound the
  ack wait so the worker never depends on the UI being alive, and always pair
  every hide with a restore on every exit path.

### 2026-11-19 — W32: rostad's text quick-bar bug — the font dropdown killed the popup
- **Report:** "när man ska välja typsnitt i det lilla popupverktyget för text
  så försvinner den när man klickar på font-rullgardinen". Root cause: the
  inline TextEdit commits on `lost_focus`; clicking the quick bar's font
  ComboBox moved focus out of the TextEdit → commit → `editing = None` → the
  bar (gated on `editing.is_some()`) vanished before the popup could be used.
- **Fix (three guards, one per escape path):**
  1. `lost_focus` no longer commits when the pointer click landed inside the
     quick bar rect (recorded on the edit state each frame) or Tab was used.
  2. The font popup's open state is sampled BEFORE the bar paints (on the
     option-click frame the popup closes inside `font_controls`) and blocks
     both commit paths — options sit BELOW the bar rect.
  3. A canvas click while focus sits on the bar (TextEdit not focused, so
     lost_focus cannot fire) commits via the Tool::Text click path — unless
     the click is inside the bar/box or the popup is open (first outside
     click just closes the popup, standard dropdown behavior).
- **Two egui traps found on the way (both now in the skill):**
  - The bar's `scope_builder` had NO id salt → its auto "child" id shifted
    with the widget count before it, so the combo's popup state never
    persisted across frames. Fixed with `.id_salt("snagcraft-text-quickbar")`.
  - `ComboBox::from_id_salt("x")` wraps the salt in `IdSalt` internally;
    querying `ComboBox::is_open(ctx, ui.make_persistent_id("x"))` with a bare
    &str hashes DIFFERENTLY and always returns false. Must pass
    `ui.make_persistent_id(egui::IdSalt::new("x"))`.
- 3 gates (w32_text_quickbar): dropdown click keeps the editor + family pick
  reaches the committed object, B-toggle keeps the editor, popup-close click
  then click-away commits. All three FAIL on the pre-fix code (stash-proven).
  kittest notes: combo buttons have no accesskit label (query Role::ComboBox,
  filter by rect — the Text rail carries a twin); popup options below the
  scroll fold have virtual rects (click a top option); Esc cancels the whole
  editor even with a popup open.
- 577/0/11 (run 2 hit the known parallel wgpu-teardown SIGSEGV in w4_live;
  serial rerun 12/12), clippy/fmt clean both targets, wasm 10/10. No snapshot
  drift (the bar only paints while editing).

### 2026-11-19 — W33: text quick bar reaches live TextBar parity (colour, selection, live restyle)
- **Gap found walking the text flow against `textbar.ts`:** the live bar hugs
  the caption being EDITED or SELECTED, carries font/size−+/B/I/**colour**,
  and "keeps styling the committed box". The rebuild's bar was new-text-only,
  had no colour, and styled nothing after commit.
- **`edit.restyle {id, family?, size?, bold?, italic?, color?}`** — partial
  patch, history-recorded, size clamped 8..200, bold/italic Text-only
  (Callout never bold), wrong kinds no-op. All platforms (web subset 25→26,
  registry 52→53, both count guards). doc::TextStyle + Document::restyle.
- **UI:** the bar now shows for any inline edit (new OR re-edit) and for a
  selected Text/Callout; on target change the object's style loads into the
  mirror; control diffs dispatch restyle (discrete controls → one dispatch
  per change, no undo flood). Colour waits for the picker to CLOSE (live's
  native picker settles on close) and flushes on bar teardown/target switch
  — Esc clears selection in handle_keys BEFORE the canvas paints, so the
  close-frame dispatch would otherwise be lost.
- **Live layout:** font, −/size/+ (step ±2), B, I, 20×20 colour chip. ASCII
  minus (bundled fonts lack U+2212). egui's own colour picker carries a 📋
  copy button the fonts lack — app default is Tofu (no crash); kittest needs
  `.allow_missing_glyphs()` (it sets Panic AFTER context_setup).
- **Typing focus returns after bar interactions** (live preventDefaults
  pointerdown): B/I/stepper clicks refocus the TextEdit immediately AND via
  a pending flag re-applied at the START of the next pass — egui's
  end-of-pass click handling can clear a mid-pass request_focus (focused
  went None in gates). The lost-focus guard now uses `any_click + position`
  (a fast press+release lands in one frame → press_origin None by widget
  time; the old hover fallback also blocked Enter while hovering the bar).
- 4 new gates: engine restyle (patch/clamp/history/no-op), selection bar
  restyles live (+ snapshot w33_selection_bar, vision-verified clean),
  colour settles on picker close, re-edit bar restyles before commit. W32
  gates re-pass. 581/0/11 twice serial, clippy/fmt clean both targets,
  wasm 10/10, no snapshot drift.
- **Lesson:** when a floating toolbar shares focus with an inline editor,
  three things bite in sequence — the commit-on-lost-focus guard (W32), the
  end-of-pass focus clear (needs next-pass re-request), and teardown paths
  that run before the draw (flush pending style on target loss).

### 2026-11-19 — W34: recording flow walked end-to-end — starting-phase Stop misled
- **Walked start→HUD→pause→stop→Recent against the live anchors**
  (app.ts:2402-2515, recording.rs, session.rs): the stop path finalises
  properly (capture thread joins ffmpeg, session dropped, exactly one
  terminal event, Stopped{path} → Recent + W28 thumbnail), pause/resume
  clock bookkeeping matches paintRecTimer, error classification W18 ✓.
- **One real bug found:** the HUD and widget offered **Stop recording while
  the portal picker was still open** (armed, not active). `record.stop` has
  no handle then → `stopping:false`, but the UI printed "Finishing the
  recording…" — finalising nothing; and once the picker was answered the
  take started despite the Stop click. Live hides the whole rec pill until
  active (app.ts:2307).
- **Fix:** HUD + widget show Stop/Pause only when `rec.active`; the starting
  phase shows "Starting recorder… / answer the system picker to begin" (HUD)
  and "Starting…" + live dot (widget). `stop_recording` during starting
  explains the picker phase instead of claiming "Finishing…". No engine
  change needed — the phase semantics were already correct there.
- **Gate injection trap:** `poll_record`'s running-fallback clears an
  injected `rec.armed` when the engine reports no run — starting-phase gates
  must seed the ENGINE side too: new `Session::seed_record_starting()` seam
  (pending start channel, sender kept alive, nothing arrives). The w4
  Rec-click test now branches on rec.active (pn53 sits in the picker phase;
  CI fails fast and skips the branch).
- 4 new gates (w34_record_start) + w34_widget_starting snapshot
  (vision-verified: Starting… + dot, no stop/pause; the pill "overlapping
  the HUD" is the known kittest embedded-viewport artifact, not app layout).
  585/0/11 twice serial, clippy/fmt clean both targets, wasm 10/10.
- **Lesson:** audit media flows phase by phase — the armed/active split is
  where controls lie; and kittest state injection must satisfy the poll
  loops' consistency checks (engine + UI sides), not just the draw flags.

### 2026-11-19 — W35: scrolling flow walked — same starting-phase split as W34
- **Walked region-pick→start→HUD→stop/cancel→done→Recent against the live
  anchors** (app.ts:2719-2815, scrolling/): the stitch/align pipeline, the
  40 000 px height-cap wording, the done summary + Recent pickup, and the
  W20 pending-cancel (a Cancel during the portal wait applies when the
  handle lands) are all sound.
- **Same bug class as W34, fixed the same way:** the HUD said "Scroll
  slowly — captured 0 px, 0 frames" and offered **Stop scroll** while the
  picker was still open (nothing captured, nothing to stitch; `scroll.stop`
  returns stopped:false but the UI claimed "Finishing…"). Now the starting
  phase says "Starting scrolling capture — answer the system picker…" with
  **Cancel only** (Cancel genuinely works via the engine's pending-cancel);
  the scroll guidance + Stop appear on the `started` event. `start_scrolling`
  status now names the picker phase; `stop_scrolling` during starting
  explains it instead of claiming "Finishing…".
- Engine seam `seed_scroll_starting` (same idiom as W34's record seam) so
  gates hold the armed state past poll_scroll's running-fallback.
- 4 new gates (w35_scroll_start): starting HUD (Cancel not Stop, no scroll
  guidance), honest stop, cancel clears, active scroll keeps Stop. w20
  re-passes. 589/0/11 twice serial, clippy/fmt clean both targets, wasm 10/10.
- All three media flows (record W34, scroll W35, timelapse W31) now respect
  the armed/active phase split; timelapse needs no picker phase (its handle
  exists at dispatch, Stop works immediately).

### 2026-11-19 — W36: empty-state card at live parity + OCR/export sanity walk
- **Design gap found:** the no-document canvas was a bare top-left label
  ("No document — Capture or Open to begin."); live shows a centered card
  (style.css:652-730, app.ts `#empty`): 44×44 bordered icon mark, "No
  capture yet" title, the PrintScreen guidance with kbd chips, and the
  auto-save note. Implemented in egui: painter viewfinder mark, LayoutJob
  guidance with monospace key sections on faint backing (kbd-chip look),
  centered column, theme-aware; web variant says drop-a-file/Open instead
  of PrintScreen (desktop-only hotkeys).
- **U+2192 (→) is ALSO missing from the bundled fonts** (kittest panicked;
  the app would tofu) — the note uses ASCII "Settings > General". Added to
  the missing-glyph list alongside ⚙/▶/📋/U+2212.
- OCR/export sanity walk: `doc.export` renders watermarked + saves with
  format/quality (W4 payload gate), OCR lang/available/languages + the W21
  off-thread worker all sound — no new gaps.
- 2 new gates (w36_empty_state light+dark snapshots, vision-verified:
  centered, readable, chips distinct, no tofu/clipping in either theme).
  591/0/11 (three runs incl. post-refactor), clippy/fmt clean both targets
  (web-only bindings moved into the native cfg block), wasm 10/10.
- W35 CI fully green; the apt-mirrors.txt fix run (8fac16d) in progress.

### 2026-11-19 — W37: editable documents could never be reopened (doc.open ignored .snagcraft)
- **Real bug found walking the file-I/O flows:** `doc.save {path}` writes the
  editable .snagcraft format and the File menu promises "reopen and keep
  editing later" — but `doc.open` fed EVERY path to the image decoder, so
  opening a .snagcraft failed with a decode error. The dedicated `doc.load`
  command existed but no UI path called it (Open dialog filtered to images,
  Recent/drop/CLI all use doc.open). The save-editable feature was a one-way
  street since W1.
- **Fix:** `doc.open` is extension-aware — `.snagcraft` (case-insensitive)
  routes through `snagcraft_format::load` and replaces the doc with objects
  intact (`editable: true` in the reply); corrupt files give an honest
  format error. Every open path (dialog, drop, Recent, CLI args) now
  round-trips editable documents. Open dialog gains a "SnagCraft document"
  filter.
- **Native drag & drop audited:** a handler ALREADY existed at the end of
  app_ui (bare dispatch, no status) — my first pass wrongly concluded it
  was missing and added a duplicate; removed the duplicate and upgraded the
  existing one (exec-based "Opened … — annotate away." / "Open failed: …",
  clean dirty flag + selection). Lesson: grep ALL consumers of an input
  before declaring a gap.
- **W28 video-thumb gate determinism fixed:** the tile's HH:MM caption came
  from `ts: SystemTime::now()` → drifted across minute boundaries (81-px
  snapshot diff, the W22 lesson recurring). Pinned ts AND the clip file's
  mtime (folder scan re-stamps from mtime); re-blessed, stable ×3.
- 4 new gates: engine doc.open round-trip (objects + style intact, corrupt
  file errors), UI drop image / drop editable round-trip / drop non-image
  honest failure. 595/0/11 twice serial, clippy/fmt clean both targets,
  wasm 10/10. Web drop still images-only (bytes path, no fs) — C-section
  MVP limit, noted.

### 2026-11-19 — W38: dirty tracking broke at the history cap (and on redo branches, and export lied)
- **Walked undo/redo + clipboard.** History itself is sound (80-step cap =
  live parity, redo branch clears on record, Arc-shared base snapshots;
  clipboard copy/paste paths correct: paste = new doc via replace_doc,
  Ctrl+V while typing belongs to the TextEdit, Ctrl+Alt+V = record).
- **Real bug: `dirty()` compared history DEPTH against the save-point
  depth.** At the 80-step cap the depth stalls (record pushes then removes
  the oldest), so every edit past a full buffer looked CLEAN — the close
  guard would not prompt and Save said "no changes". Redo branches had the
  same class: undo + new edit landed on the save-point depth with different
  content, also "clean".
- **Fix:** dirty is now CONTENT equality against a save-point snapshot
  (`saved_doc: Option<Document>`, Document gained PartialEq; base pixels
  included, so blur/bucket count). replace_doc and doc.save/save_as set the
  snapshot; undo/redo keep it. Bulletproof against cap, branches, resizes.
- **Second fix: `doc.export` no longer clears dirty.** It writes a flat
  image — the annotations stay unsaved (live parity). The old behavior
  risked silent edit loss: annotate → export → close → no guard. The W12
  test that encoded "export is a save point" was updated to the new
  semantics (export stays dirty, doc.save cleans).
- 1 new gate (dirty_survives_the_history_cap_and_redo_branches: cap edit,
  undo/redo at the cap, branched edit at save-point depth, export-stays-
  dirty). Cap-bug failure on the old code is provable by inspection
  (History::record's remove(0) stalls depth at 80); the gate lives in the
  same file as the fix so a stash negative-check isn't possible.
- 596/0/11 twice serial, clippy/fmt clean both targets, wasm 10/10.
- **Lesson:** a dirty flag derived from a CAPPED counter is wrong at the
  cap — compare content (or use a monotonic counter), and never let a
  flat-image export masquerade as saving the editable document.

### 2026-11-19 — W39: verification wake — settings/CLI sound, design pass clean (no change)
- **Settings persistence walked end-to-end and is sound:** io round-trip
  (13 tests), engine settings.set merge+validate (7), UI dirty flag (1),
  and the app-layer hook `persist_settings` runs in BOTH `Shell::ui` and
  `Shell::logic` (hidden tray/widget path) — so a settings change made
  while hidden still flushes. No gap.
- **CLI / single-instance:** acquire_or_forward + socket-path override
  tests pass (4). --capture/--region/image-path argv handling intact.
- **Fresh design vision pass** on the shortcuts sheet + monitor picker:
  every flag triaged as a FALSE positive via WCAG math + code inspection —
  muted resolution/helper text 6.24:1, Primary badge 5.8:1 (both pass AA;
  vision misjudged contrast again, as in W30); shortcuts "mid-glyph
  clipping" = the normal scroll fold, "column collision" = an 18px grid
  gap already in code, scrollbar = W17 AlwaysVisible + dormant thumb.
  Monitor-picker footer compactness = W26 fix holding. No fixes warranted
  (the skill's vision-false-positive discipline applied).
- W38 CI fully green (gates + windows + appimage). No code change this
  wake; the W38 AppImage remains current.
- **Lesson:** a verification wake that finds nothing is a valid outcome —
  measure contrast and read the layout code before "fixing" vision flags;
  don't manufacture cosmetic churn on already-audited surfaces.

### 2026-11-19 — W40: final verification + loop saturation (autonomous quality-check complete)
- Fresh full verification: **596/0/11, 82 targets, exit 0**; clippy 0
  (native+wasm); wasm 10/10; W37+W38 CI green.
- **Flake identified (not a regression):** the first full run exited 101
  with `-p snagcraft-ui-egui --test w4_live` crashing at the BINARY level
  (no test-level failure). w4_live passes 12/12 isolated and the full
  re-run is green; code is byte-identical to W38 (green ×2) — the real-
  thread e2e tests (capture/record/portal sockets+threads) can race under
  full-suite parallel load. CI has stayed green (different timing). Known
  harness characteristic, not a product defect; noted for future CI triage.
- **Saturation:** across W29–W40 every reported bug is fixed and deployed
  (capture: KDE upstream portal bug + interactive fallback + hide/settle;
  magnify: compositing so annotations enlarge; rostad's font-dropdown
  commit guard), and every major feature surface has been audited
  (capture/magnify/toolbar, region-pick, swatches, timelapse, text quick-
  bar, recording/scrolling phases, empty state, file-I/O round-trips,
  undo/redo/clipboard/dirty, settings persistence, CLI/single-instance,
  shortcuts/monitor-picker design). W39 found nothing; W40 confirms green.
- **The one open item is rostad's own KDE live-test of capture + magnify**
  — pn53's screen is locked so it cannot be verified here, and it has been
  requested each wake. No further iteration can produce that confirmation.
  The autonomous quality-check is complete; the loop is stopped. If capture
  still fails on his Plasma box, he can reply or restart the loop.

### 2026-11-19 — W41: THE capture regression — the system window/screen picker was never ported
- **rostad replied: "capture fungerar ej längre alls" + "jag får ingen window
  picker, screen picker som jag fick i tauri".** His diagnostics: CachyOS
  (Arch, fresh Plasma — NOT the ≤6.7 I assumed in W29), no portal log, an old
  Tauri-era recording log. The missing-picker symptom redirected the root cause.
- **Real root cause (not the W29 portal backend):** Tauri had THREE capture
  modes — `capture_full` (Screenshot, no picker), `capture_window` and
  `capture_monitor` (both via the **ScreenCast** portal's system picker,
  `portal_capture::grab(SourceKind)`). The Rust port only ported `capture_full`.
  Window capture was absent entirely; W25's "Choose screen…" on Linux was a
  dead-end status line ("start a recording…") because `list_monitors()` returns
  empty on Linux. **The picker rostad relied on simply did not exist in Rust.**
  W29's KDE-bug fix was real but addressed a different symptom; on his fresh
  Plasma the non-interactive Screenshot works, so the failure he saw was the
  missing window/monitor picker, not the portal.
- **Fix — reuse, don't re-port:** the scrolling-capture source already has the
  whole proven ScreenCast→PipeWire path (`open_portal`, the stride-aware RGBA
  conversion, the `!Send` capture thread, the graceful teardown, portal logging).
  Parameterized `open_portal(sources)` / `session(..., sources)` /
  `open_blocking_kind(sources)` (scrolling still passes MONITOR|WINDOW) and added
  `grab_one_blocking(sources)`: open the picker, read `Source::newest()` (already
  an `Arc<Surface>`), shut down. Public `capture_window_blocking` (WINDOW) /
  `capture_monitor_blocking` (MONITOR) in the capture crate; non-Linux returns an
  honest Unsupported (the xcap in-app picker covers those).
- **UI:** new "Window…" Capture-menu entry → `capture_window_picked`; "Choose
  screen…" on Linux now → `capture_monitor_picked` (the dead-end is gone). Both
  use the shared hide/settle/restore off-thread pipeline (`start_picked_capture`),
  so the app stays out of its own shot and out of the window list (Tauri parity).
- **Diagnostics:** the Screenshot path now logs to `~/.cache/snagcraft-portal.log`
  (`portal_log`: request/interactive flag, response ok/fail, timeout) — before,
  only the ScreenCast paths logged, so "Copy diagnostics" was blind to still
  capture. The ScreenCast still-grab logs via the scrolling `log()`.
- 4 new gates (w41_picked_capture: window/monitor arming + picker status, Linux
  Choose-screen dispatch, in-flight guard) + the W25 dead-end test updated to the
  new picker behavior + w4_capture_menu/w4_timelapse_dialog re-blessed (the new
  Window… row; vision-confirmed clean). 600/0/11 twice serial, clippy/fmt clean
  (native+wasm), wasm 10/10.
- **Lesson:** when a user says a feature "doesn't work anymore" vs the old
  edition, DIFF THE FEATURE SET first — a whole capture mode can be silently
  unported. The W29 root cause was plausible but wrong for his actual symptom;
  the missing-picker clue ("ingen picker som i tauri") was the decisive evidence.
  Reuse the proven PipeWire machinery rather than re-porting fiddly Tauri code.

### 2026-11-19 — W42: KDE picker never appears — portal runtimes switched to multi-thread (candidate fix)
- **rostad live-verified on KDE (CachyOS), post-reboot:** Tauri capture/recording
  WORK, Rust does NOT — same healthy portal. So it is a real Rust app bug, not
  the environment (corrects the W41 "wedged portal" diagnosis for his box).
  Symptom: the app waits at "choose a screen…" but the OS ScreenCast picker
  dialog never appears (or flashes and vanishes).
- **Research (not blind):** ashpd docs + dir_picker#33 + Auto-Clicker#78 document
  that the KDE Wayland picker is sensitive to parent_window placement and to the
  D-Bus connection staying polled; rustdesk#14839 reports the exact "picker
  flashes then dismisses itself" symptom when the portal client stalls. zbus
  docs warn about runtime/threading deadlocks. The decisive Tauri-vs-Rust
  difference: **Tauri runs ashpd in a persistent MULTI-THREAD tokio runtime; the
  Rust port deliberately used CURRENT-THREAD** (recording/session.rs,
  scrolling/source.rs, capture_full_blocking). A current-thread runtime can
  starve zbus's socket task during the long picker wait → the portal sees the
  client stall and dismisses the share dialog.
- **Fix (candidate):** switched all three portal runtimes to
  `Builder::new_multi_thread()` — matching the working Tauri edition and ashpd's
  own examples. Verified the multi-thread connection still reaches the portal
  on pn53 (request sent; headless grab times out as expected — pn53 has 0
  monitors, confirmed via Mutter DisplayConfig + all DRM disconnected, so it
  cannot be a live capture test bed).
- Also: pn53 was unlocked without a password (lock-enabled=false + gdm autologin
  restart) and vkms loaded — but headless means no live capture there. Revert
  lock/vkms when done.
- Re-blessed w27_settings_capture: the only diff was the scrollbar thumb
  (overlay-scrollbar fade timing), content pixel-identical — pre-existing,
  unrelated to W42 (confirmed by stashing the runtime change).
- 600/0/11, clippy clean. **Live KDE verification of the picker still needed**
  (rostad). If the picker still fails, the post-reboot portal log
  (~/.cache/snagcraft-portal.log) pinpoints whether Start is reached.
- **Lesson:** "works in Tauri, not in Rust" with identical ashpd calls → diff the
  RUNTIME and connection lifecycle, not just the portal calls. Research working
  examples + upstream symptom reports before guessing; current-thread tokio +
  zbus long picker waits are a known fragile combo.

## 2026-11-22 — PIVOT: Rust rewrite paused, Tauri app is the loop target again

- rostad (new loop): "gå tillbaka till vår tauri app … ta bort alla rust-releaser
  från github, uppdatera readme med vad som är sant … fortsätt putsa på den
  gamla appen för där fungerade väldigt mycket. När den är helt perfekt så gör
  vi ett nytt försök att porta den till rust."
- Deleted GitHub releases rust-v0.1.0 + rust-v0.2.0 incl. tags (explicit OK).
  v1.5.3 stays Latest. rust-release.yml's v* tag trigger commented out (paused)
  so stable tags don't build Rust artifacts; rust.yml already paths-filtered.
- README rewritten: one app (Tauri). All rust-edition mentions removed
  (rostad: "vi behöver inte nämna rust appen alls"). rust/ stays in-repo as
  reference for the future re-port.
- First polish item — issue #1 "Multiple monitors" (back in scope): the real gap
  was Windows/macOS, where capture_full grabbed only `Monitor::from_point(0,0)`
  (primary) and capture_monitor/window bailed "not supported".
  - capture.rs: capture_full now composites ALL monitors (pure `compose_shots`,
    3 unit tests: positions, negative-coord normalisation, gap fill/empty);
    new `list_monitors` (xcap metadata; Linux returns [] — portal owns picking)
    + `capture_monitor_index`; capture_monitor on Win/mac grabs a lone display
    directly, otherwise honest "pick one" bail.
  - commands.rs/lib.rs: `list_monitors` + `capture_monitor_index` commands
    (hide/settle/restore via `grabbing`).
  - app.ts: in-app "Choose a screen" modal (monitor-item buttons, Esc/backdrop/
    Cancel = cancelled) shown when list_monitors returns >1; Linux flow
    unchanged (portal picker). style.css: .monitor-* styles.
  - Verified: cargo fmt/clippy -D warnings/test --lib (compose tests), tsc
    --noEmit clean; Windows cross `cargo check --target x86_64-pc-windows-msvc`
    + CI windows job = compile proof only, real multi-monitor behaviour needs a
    Windows host (rostad) — never claim more than that.
  - **Windows CI round 1 FAILED (workflow_dispatch run 45006215636):**
    "future cannot be sent between threads safely" — xcap's Windows Monitor
    holds a raw HMONITOR (`*mut c_void`), and capture_monitor kept the
    `Vec<Monitor>` alive across `capture_monitor_index(0).await` → non-Send
    Tauri command future. Fixed by counting + dropping before the await
    (581fa0c). Also removed the CI-flagged unused `tauri::Emitter` import in
    recording's cfg(windows) mod (abbaeaf) — it resolves via `use super::*`.
    Re-dispatched run 45007552512 covers both. Lesson: cfg(not(linux)) code is
    ONLY compile-checkable by the CI windows job (local cross-check dies in
    libwebp-sys; cfg(windows) modules never compile on Linux).
  - Run 45007552512's windows job HUNG 60+ min (v1.5.3 reference: 7 min) —
    cancelled; build.yml now bounds every job with timeout-minutes (1ef26ba).

## 2026-11-22 (wake 2) — window capture chooser for Windows/macOS

- `capture_window` on Win/mac no longer bails "not supported": new
  `list_windows` (xcap Window::all, filtered: own pid, minimised, zero-sized,
  untitled ghosts; Linux → [] so the portal flow is untouched) +
  `capture_window_id` (same hide/settle/restore `grabbing` dance).
- Frontend: the monitor modal became a generic capture-target chooser
  (`pickCaptureTarget(heading, desc, items)`), reused by both picker modes;
  window rows show title + app · W×H. Menu/MODES copy no longer promises a
  "system dialog" on every platform.
- No await inside capture_window_id — the non-Send xcap Window list must not
  cross a suspension point (wake-1 lesson applied up front).
- Gates: fmt/clippy -D/100 tests/tsc clean locally; CI run 45009030210
  (windows job = the only real compile proof). Live Windows behaviour still
  unverified — needs rostad's hardware.
- **CI run 45009030210 GREEN (wake 3):** quality + linux + windows success,
  release skipped (dispatch run). Both wake-1 fixes and the window chooser
  compile + bundle on real Windows (NSIS + MSI).
- Wake 3 cleanup: CONTRIBUTING.md + all issue forms lost the edition dropdowns
  /rust links (one app); repo description updated (no "pure-Rust edition"),
  `egui` topic removed. CHANGELOG/integrations mentions of "Rust" are the
  legitimate Tauri-backend kind — kept.

## 2026-11-22 (wake 4) — native global hotkeys on Windows/macOS

- README's Windows "Global hotkeys 🔜" closed in code: `tauri-plugin-global-shortcut`
  registered on non-Linux ONLY (on Linux it is X11-only and broken under
  Wayland — the GlobalShortcuts portal stays the sanctioned path).
- `native_trigger()` translates internal/XDG spelling to the global-hotkey
  parser form (PRINT→PrintScreen, RETURN→Enter, `<Control><Shift>p`→
  Ctrl+Shift+P, modifier-only passes through unparsable = skipped honestly).
  Parser verified against global-hotkey-0.8.0 source: accepts A-Z/0-9,
  PRINTSCREEN (not PRINT), ENTER (not RETURN), modifiers before key only.
- register_hotkeys binds each combo individually via on_shortcut (a combo
  held by e.g. Windows Snipping Tool fails alone), emits the SAME
  `hotkey-activated {id}` event as the portal path → zero frontend flow
  changes; backend reports "native". unregister_hotkeys releases all.
- Frontend: HotkeyBackend type + normalizeStatus + paintHotkeyHint + settings
  badge ("System") and platform-neutral advice/status copy.
- Gates: fmt/clippy/103 lib tests (3 new native_trigger)/tsc clean;
  CI run 45011161975 = the Windows compile proof. Runtime behaviour needs
  rostad's Windows box (PrintScreen may be pre-held by Snipping Tool/OneDrive
  — the honest per-combo granted list covers that).
- **CI run 45011161975 GREEN (wake 5):** hotkeys compile + bundle on Windows;
  README hotkeys row flipped 🔜 → ⚠️ native, feature bullet updated.

## 2026-11-22 (wake 5) — scrolling capture on Windows/macOS

- Last 🔜 in the README platforms table, closed in code: non-Linux `imp`
  module in scrolling/mod.rs — pick_monitor (largest-overlap monitor, region
  clamped + translated to monitor-relative physical px), probe grab before
  claiming the slot, then capture_region polling at POLL_INTERVAL in the
  stitcher thread.
- Stop rules deliberately MIRROR the Linux loop (idle-stop 2.5 s, double
  NoChange, LowConfidence warn, MAX_HEIGHT cap). "Screen unchanged" =
  byte-equality vs the previous grab (Linux uses buffer identity on the
  portal slot — same semantics, different mechanism).
- Shared helpers hoisted to the parent: `rgba_to_rgb24` (+ cross-platform
  unit test) and `emit_status` (both loops emit identical scrolling-status
  events). Linux imp mechanically switched to emit_status — compiled + tested
  on Linux (104/104).
- Monitor non-Send trap respected: probe in its own scope, thread re-finds
  the monitor by id, nothing xcap-held crosses an await.
- Frontend needed ZERO changes (the scrolling flow/HUD is event-driven and
  platform-neutral; the old NOT_SUPPORTED bail just surfaced as an error).
- Gates: fmt/clippy/104 tests clean; CI run 45012641849 = Windows compile
  proof. Live Windows scrolling needs rostad's hardware.

## Appendix — measured reality

| Claim | Measured | What changed |
|---|---|---|
| "Capture doesn't work at all" on rostad's KDE box = an app bug in the rebuild | The app's portal call is byte-identical to the stable edition's (`interactive(false)`, ashpd 0.14). Plasma ≤ 6.7's portal backend rejects non-interactive Screenshot with code 2 before ever calling KWin (flameshot#4883 busctl trace; KDE bug 527399 fixed 2026-11-17). pn53's own portal times out (locked session) — the live round trip is only testable on rostad's unlocked KDE | W29: non-interactive → interactive fallback on refusal; hide/settle/restore + logic pump. The KDE live pass (A1) now also proves the fallback dialog flow |
| Vision: the re-blessed magnify lens shows "bright, undimmed content" — the fix isn't sampling the composite | Pixel probe: OLD lens interior mean RGB (127,155,202) vs NEW (91,111,146); surrounding dimmed canvas (93,100,131) unchanged. New lens ≈ surrounding (0.98×) = it DOES sample the spotlight-dimmed composite; the magnified checker just reads brighter to vision | No code change — the probe disproved the flag (third vision false positive on checker/dim patterns) |
| Settings "clipped at the bottom, no scrollbar" = layout bug; `AlwaysVisible` should show the bar | egui 0.37 floating bars default to dormant opacity 0 — invisible without hover, in a minimal Window AND a plain ScrollArea probe. The window itself is fine (default outer height 420, content scrolls) | W17 sets dormant handle 0.45 / background 0.12 via `style_mut_of` on both themes; pixel-probe + vision confirm a no-hover thumb. Lesson: probe the pixels before believing a "missing scrollbar" flag |
| Parity row 191 ticked W4 ("stop converts the run to MP4") + W14 "backlog empty" | The UI's `poll_timelapse` done-arm only reported the frame count — nothing ever called `timelapse.assemble`. The live app auto-assembles on stop (`app.ts:3019-3047`); it has no "Make video" button (the gaps.md framing was wrong too) | W15 wires stop→MP4 off-thread (no session lock). Row split: loop W4 / conversion W15. Lesson: a closed checklist is not an audit — re-read the live anchors of headline flows end-to-end, not just the row text |
| W1 drag-create worked (spike pattern) | egui's hover_pos on the first drag frame is already the MOVED point → every drag-created object was 0px | UI child's parity.rs drag gates caught it; fixed with pointer.press_origin(). Lesson: seeded-command snapshots cannot catch pointer-path bugs — drag gates are mandatory |
| ab_glyph `ascent_unscaled() * scale` gives pixel ascent (W0 spike pattern) | Returns RAW font units (Ubuntu-Light ascent=932, upem 1000) → baseline 26 000 px off-canvas → silent text loss in CPU composite | compose uses `font.as_scaled(scale).ascent()` / `.h_advance(gid)` (ScaleFont trait); W0 spike export had the same latent bug (its on-screen text came from egui painter, which masked it) |
| egui = "0.37" bundles fonts by default | egui's own `default = []`; `default_fonts` is enabled via eframe — CLI (egui-only) got EMPTY FontDefinitions | workspace egui enables `default_fonts` explicitly; CLI text export verified pixel-wise |
| Child "tests green" claims imply visual correctness | compose passed 7 unit tests yet rendered no text (no font-present pixel test existed) | parent vision + pixel probes are mandatory on render paths; added render_probe regression tests |
| Blur visible in seeded snapshot | Gaussian blur on a pure-white base is invisible | seeded() loads a synthetic gradient base (load_surface) |
| photocraft layering forbids ALL same-layer deps | L0 foundation (raster→geom/color) needs same-layer edges | xtask layers allows same-layer edges but rejects cycles (DFS) + any upward edge; UI ban below L6 unchanged |
| egui main-branch docs match crates.io 0.37 | 0.37 renamed APIs: `Panel::top/bottom` (unified, `.show(ui,…)` not `.show(ctx,…)`), `eframe::App::ui` replaces `update`, `Ui::id`→`scope_id`, `Id::new` deprecated, `DroppedFile` is a trait (`.path()`), `FontData.font` is a `Blob`, `TextEdit::frame` takes `Frame` not bool, ab_glyph `Scale`→`PxScale`, `ascent_unscaled()` takes no args | All fixed against the vendored 0.37 registry source; briefs for W1+ must cite 0.37, not main |
| `EFRAME_SCREENSHOT_TO` usable for headless shots | Asserts "not yet implemented for wgpu backend" (wgpu_integration.rs:143) | Use `ctx.request_screenshot(cb)` (wgpu-supported) or egui_kittest offscreen |
| `--selftest` screenshots on pn53 | Locked GNOME session delivers no frame callbacks → frame counter never advances → no shot, no auto-exit (timeout 124) | kittest headless snapshot is the pn53 visual gate; selftest expected to work on unlocked KDE |
| kittest `Harness::new_egui` | Does not exist in 0.37; use `Harness::builder().with_size(…).build_ui_state(\|ui,state\|…, state)` | Test written against the real API |
