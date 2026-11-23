# SnagCraft ✦

[![Release](https://img.shields.io/github/v/release/rostaddotcc/snagcraft)](https://github.com/rostaddotcc/snagcraft/releases/latest)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)

**Open-source Snagit-style screen capture & annotation.** Screenshot, mark up,
record — without the subscription. Capture → annotate → share in under ten seconds.

SnagCraft is a clean-room, Linux-first reimplementation of the Snagit workflow, in
the spirit of ArtCraft (open-source clones of proprietary creative tools).
Bugs, ideas and test reports are welcome — from **humans and AI agents alike**.
See [Reporting bugs & requesting features](#-bugs-ideas--feedback) for how we like
them served.

## The app

| | |
|---|---|
| Download | [Latest release](https://github.com/rostaddotcc/snagcraft/releases/latest) |
| Stack | Tauri 2 — Rust backend, web frontend (Vite + TS, Fabric.js editor) |
| Source | repo root (`src/`, `src-tauri/`) |

## Install

Grab an artifact from the [release page](https://github.com/rostaddotcc/snagcraft/releases/latest):

```bash
# AppImage (portable)
chmod +x SnagCraft-*.AppImage && ./SnagCraft-*.AppImage

# Debian/Ubuntu
sudo dpkg -i snagcraft_*.deb
```

Recording needs `ffmpeg` on `PATH`; OCR needs `tesseract`. On Wayland, capture and
recording go through the desktop portal — a consent prompt on first use, no root,
no hacks.

## Why

Snagit is excellent but proprietary, paid, and has no Linux build. The open-source
landscape is fragmented — Flameshot does screenshots, Kooha/Cap do recording, ShareX
does everything but only on Windows. Nobody ships the whole *capture → annotate →
share* flow in one lightweight app. SnagCraft fills that gap.

## Features

**Capture**
- Full screen, a selected region, a single window, or one monitor — via the desktop
  portal on Wayland (no hacks, no root)
- **Scrolling capture** — scroll the window by hand and SnagCraft stitches the frames
  into one tall image
- **Screen recording** to MP4 or GIF — full screen, a region or a picked window,
  with an on-screen timer, **pause/resume** and optional **microphone + system audio**
  (mixed to AAC)
- **Interval capture** — a screenshot every 5 s / 10 s / 30 s / 60 s / 5 min, optionally
  stitched into an MP4 timelapse
- Capture timer (off / 3 / 5 / 10 s) and a `PrintScreen` shortcut

**Annotate** (native resolution)
- 13 tools: select, crop, arrow, text, rectangle, **true Gaussian blur** / pixelate /
  blackout, spotlight, highlighter, callout, step numbers, **live magnify lens**, brush,
  fill bucket
- **Quick text bar** — font, size, bold, italic and colour float right on the caption
  you're editing; drag to size a text box, no placeholder to delete first
- Shadows with **direction / distance / blur / opacity** sliders and a live sample —
  applied to the selection as you tune them, on shapes, arrows and labels alike
- Stroke width, and per-tool sizes with a live brush-size preview
- Ten bundled OFL fonts (Inter, Lato, Source Serif 4, Playfair Display, Oswald,
  Archivo Black, JetBrains Mono, Fira Code, Caveat, Pacifico) with size / bold / italic,
  plus reusable style presets
- Undo / redo, in-editor crop, delete the selected annotation with `Delete`

**Share**
- Copy to clipboard · save as PNG / JPEG / WebP (with quality) · **Save As…**
- **Save = a new copy**: every Ctrl+S writes a fresh version next to the original
  (never overwrites) and lands in Recent — browse back through every edit
- **Watermark** burned into exports (text, opacity, corner — never the live capture)
- **Upload** to your own endpoint, with the returned link copied to the clipboard
- Auto-save on capture, custom filename patterns (`{date}`, `{time}`, `{datetime}`)
- **OCR** — extract text from a capture (English / Swedish) via the system `tesseract`
- Recent-captures filmstrip — **resizable**: drag its top edge for bigger thumbnails;
  recordings carry a red dot and their length, and open in an in-app player
  (play/pause, scrub timeline, mute, open externally)

**Open & record**
- **New canvas** (`Ctrl+N`) — start drawing immediately on a white canvas; pick a preset
  resolution (HD → 4K, square, story) or type your own, white or transparent background
- **File → Open…** (`Ctrl+O`) to annotate any image on disk; drag-and-drop and `Ctrl+V` too
- **Audio in recordings** — microphone and/or system audio, mixed into AAC
- **Pause/resume** a take without starting a new file

**Desktop integration**
- **Single instance** — launching SnagCraft again focuses the running window;
  `snagcraft --capture` / `--region` trigger a capture from any script or shortcut
- **File associations** — installers register SnagCraft as an image editor
  (PNG/JPEG/WebP/GIF/BMP/AVIF/TIFF): right-click → *Open with SnagCraft*
- **Panel companions** for GNOME Shell and KDE Plasma 6 in [`integrations/`](integrations/README.md)
- System tray with click-to-restore and minimise-to-tray · **Start at login**
- A collapsible floating capture widget (the "flärp") — hover to open, drag to park
  anywhere, fixed size. Full / Region / a red **Rec** button; while a take runs the
  widget hides itself so it never lands in the video
- Global hotkeys — the Wayland GlobalShortcuts portal on Linux (KDE), native
  system hotkeys on Windows/macOS. On Cinnamon (Linux Mint) and GNOME, where no
  portal exists, **Settings → Global hotkeys → Default screenshot tool** can hand
  the `Print` / `Shift+Print` keys to SnagCraft through the desktop's own keyboard
  settings — with a one-click restore of the previous bindings
- Light / dark themes, and a "save before closing?" guard

## Shortcuts

| Key | Action |
|-----|--------|
| `PrintScreen` | Capture full screen |
| `Shift` + `PrintScreen` | Capture a region |
| `Ctrl` / `Cmd` + `Z` | Undo |
| `Ctrl` / `Cmd` + `Shift` + `Z` · `Ctrl` + `Y` | Redo |
| `Ctrl` / `Cmd` + `C` | Copy to clipboard |
| `Ctrl` / `Cmd` + scroll | Zoom in / out |
| `V` `C` `A` `T` `R` `B` `E` `G` `L` `H` `K` `S` `M` | Tools: Select, Crop, Arrow, Text, Shapes, Blur, Brush, Fill, Spotlight, Highlighter, Callout, Step, Magnify |
| `Ctrl` / `Cmd` + `N` | New blank canvas (resolution presets) |
| `Ctrl` / `Cmd` + `O` | Open an image |
| `Ctrl` / `Cmd` + `S` | Save |
| `Ctrl` / `Cmd` + `Shift` + `S` | Save As… |
| `Ctrl` / `Cmd` + `,` | Settings |
| `Delete` / `Backspace` | Delete the selected annotation |
| `Esc` | Cancel / deselect / close |

`PrintScreen` works while the SnagCraft window has focus. To make it work in any
app: KDE uses the GlobalShortcuts portal, Windows/macOS register native hotkeys,
and Cinnamon/GNOME offer the **Default screenshot tool** takeover in Settings →
Global hotkeys (or add a desktop shortcut that runs `snagcraft --capture`).

## 🐛 Bugs, ideas & feedback

Reports from **both humans and AI agents** are welcome — automated testing has
already caught real bugs here. To keep triage fast, this is how we prefer to
receive them.

### The short version

1. **Search first.** [Open issues](https://github.com/rostaddotcc/snagcraft/issues)
   (and closed ones) — add a 👍 or new evidence to an existing report instead of
   opening a duplicate.
2. **One issue per problem.** A report with three bugs gets triaged as zero.
3. **Use the issue forms** — *New issue* → **Bug report**, **Feature request** or
   **Agent report**. They ask for exactly what we need.
4. **Name the version** — the release tag you downloaded, or the About-box version.
5. English is preferred; Swedish works too.

### What a good bug report contains

- **Exact version** (release tag you downloaded, or the About box)
- **OS, desktop environment, session type** — Wayland or X11 matters a lot here
  (`echo $XDG_SESSION_TYPE`)
- **Steps to reproduce** — numbered, from a fresh launch, minimal
- **Expected vs actual behaviour** — two short sentences
- **Logs** — terminal output, `~/.cache/snagcraft-portal.log` for portal problems,
  and the `*.rec.log` written next to a failed recording
- **A screenshot or short clip** for anything visual

Feature requests: describe the **problem** you hit, not only the solution you
imagined — there may be a better fix, or an existing feature you haven't found.

### 🤖 For AI agents

Agent reports are first-class citizens. Use the **Agent report** form, or file via
`gh` / the REST API with this structure — fixed headings, verbatim output:

```markdown
## Identity
<model + harness, e.g. "Hermes Agent running <model>">

## Environment
<version · OS · desktop env · session type>
<probe output: `uname -a`, `echo $XDG_SESSION_TYPE`, app version command>

## Task
<what you were trying to accomplish, one sentence>

## Steps / commands
<exact commands or UI actions, in order — copy-pasteable>

## Output
<verbatim stdout/stderr or log excerpts — do not summarise or truncate errors>

## Expected vs actual
<two short paragraphs>

## Hypothesis (unverified)
<optional root-cause guess — clearly separated from observations>
```

What makes an agent report actionable:

- **Observations ≠ hypotheses.** Report what happened; mark guesses as guesses.
  A confident wrong root-cause costs more triage time than no guess at all.
- **Verbatim output.** Full error text and exit codes, not paraphrases.
- **Show your environment probes.** Don't assume the maintainer's distro, session
  type or installed deps — paste what you actually measured.
- **A minimal repro beats a long narrative.** If you can reduce it to three
  commands, do that first.
- **Say so when it's flaky.** "Reproduced 2/5 attempts" is useful data, not a
  disqualifier.
- **One defect per issue**, and search before filing — parallel agents often find
  the same bug.

Example:

```bash
gh issue create --repo rostaddotcc/snagcraft \
  --title "Region capture grabs the wrong monitor (v1.5.3)" \
  --label bug --label agent-report \
  --body-file report.md
```

### What happens next

- SnagCraft is maintained by one person with agent help; issues are triaged in
  batches. Expect days, not hours — every report gets read, there is no SLA.
- Labels you'll see: `bug`, `enhancement`, `agent-report`, `needs-info`,
  `good first issue`.
- `needs-info` means the report is missing something to act on. Issues that stall
  without a repro may be closed — reopening with new evidence is always welcome.
- Want to fix it yourself? See [CONTRIBUTING.md](CONTRIBUTING.md) — PRs welcome,
  dual-license note included.

### Security

Please **don't** open public issues for vulnerabilities. Use
[private vulnerability reporting](https://github.com/rostaddotcc/snagcraft/security/advisories/new)
(Security tab → Report a vulnerability).

## Platforms

| Feature | Linux (Wayland/X11) — tested | Windows — untested |
|---------|------------------------------|--------------------|
| Screenshot (full / region / window) | ✅ portal + `xcap` | ⚠️ `xcap` |
| Editor (annotations, blur, shadows, fonts) | ✅ | ⚠️ |
| Copy / save (PNG / JPEG / WebP) | ✅ | ⚠️ |
| System tray + floating widget | ✅ | ⚠️ |
| Start at login | ✅ XDG autostart | ⚠️ registry Run key |
| Screen recording | ✅ ScreenCast portal (needs `ffmpeg`) | ⚠️ ffmpeg `gdigrab` |
| Scrolling capture | ✅ | ⚠️ xcap region polling |
| Global hotkeys | ✅ GlobalShortcuts portal | ⚠️ native (RegisterHotKey) |

> **Windows is compile-verified only.** The stable line's `.exe` is built by CI from
> the same code but has not been run on real hardware — **Linux is the focus.**
> Windows test reports are welcome (they're some of the most useful issues you can
> file), but expect rough edges.

## Recording troubleshooting

Linux recording uses the xdg-desktop-portal ScreenCast API and needs `ffmpeg` on
`PATH`. If a take fails to start, SnagCraft logs every portal step to
`~/.cache/snagcraft-portal.log`, and each take writes a `*.rec.log` next to the video.
Those two files pinpoint exactly where the pipeline stopped — attach them to your
issue.

## Build from source

Rust (stable), Node 20+, pnpm, and the
[Tauri Linux deps](https://tauri.app/start/prerequisites/) (`libwebkit2gtk-4.1-dev`, …).

```bash
pnpm install
pnpm tauri dev      # run in development
pnpm tauri build    # produce AppImage / deb / dmg / exe
```

## Project layout

```
src/            frontend (Vite + TS, Fabric.js editor)
src-tauri/      Rust backend (portal / xcap capture, clipboard, commands)
integrations/   GNOME Shell & KDE Plasma 6 panel companions
docs/specs/     design specs
docs/plans/     implementation plans
```

## License

SnagCraft is **GPL-3.0-or-later** — genuinely open source. You are free to use, study,
fork, modify and share it, **including commercially**, as long as derivatives stay open
under the GPL (see [LICENSE](LICENSE)).

**Commercial license:** if you want to embed SnagCraft in a proprietary, closed-source
product where the GPL's source-sharing obligations don't fit, a separate commercial
license is available from the author — that's the one case that needs permission. Open an
issue or reach out to arrange it.

> The project name and logo remain the author's; a fork should carry its own name.

## Acknowledgements

Inspired by the ArtCraft idea (clean-room clones of proprietary creative tools),
[Cap](https://cap.so) (open-source Loom), and
[Flameshot](https://flameshot.org). Not affiliated with TechSmith/Snagit.

Bundled fonts (SIL OFL 1.1 — see `src/assets/fonts/OFL.txt`): Inter, Source Serif 4,
JetBrains Mono, and Caveat.