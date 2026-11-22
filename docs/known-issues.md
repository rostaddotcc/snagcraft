# SnagCraft — known issues

Open defects in the **active** app (the Tauri line in `src/` + `src-tauri/`), with
the root cause as far as it has been traced. Nothing here is fixed until it says so.

Format: what the user sees · where it lives in the code · why it happens · what a
fix has to do · status.

---

## 1. ~~Magnify lens ignores your annotations~~ — FIXED (1.5.5, unreleased)

**Noted by rostad 2026-11-22; fixed the same day.**

**Resolution.** The Editor now hands each lens the working composite instead of
the bare screenshot: `Editor.lensComposite(lens)` renders everything stacked
*below* that lens (capture + arrows/shapes/text/effects) into an offscreen canvas
in **image-pixel space** — the same grid `MagnifyRegion` already samples — and
`MagnifyRegion._render` prefers it (`composer`) with the raw image as fallback.
Because the grid and placement are unchanged, the zoom/centre maths and
`flatten()` needed no edits; the export gets the same pixels. The cache is
versioned (`lensVersion`, bumped by `object:added/removed/moving/scaling/rotating`,
`text:changed`, `path:created`, and `refreshMagnifySources`), rebuilt lazily on
the next render (measured 0.22 ms at 1280×800), and skipped when only a lens
itself moves. `flatten()` builds the composites *before* hiding the effect
regions, so a lens over a blur magnifies the blur instead of leaking the raw
pixels.

**Verified** (dev-server seam `window.__snagEditor`, pixel probes on the lower
canvas + the exported PNG):
| Check | Before | After |
|---|---|---|
| Arrow under the lens, ink in a 30×30 box at the lens centre | 0/900 | 630/900 |
| Same scene exported via `flatten()`, lens centre | — | 528/576 |
| Arrow drawn *above* the lens, lens interior away from the badge | — | 0 (not magnified; drawn on top at 1:1) |

**Original report (for the record).**

**What you see.** Capture an image, draw an arrow / shape / text, then drop a
magnify lens over that area. The lens enlarged the *capture* underneath but the
annotations were invisible inside it.

**Where.** `src/editor/tools.ts` → `MagnifyRegion._render` and
`src/editor/editor.ts` → `magnifySource()` / `refreshMagnifySources()`.

**Why.** The lens sampled exactly one thing: the `FabricImage`'s own element —
the decoded screenshot pixels. Annotations are separate Fabric objects painted
*above* the image, so they were never part of what the lens read. Export used the
same `_render` via `flatten()`, so the saved PNG had the same hole.

**Test that would have caught it.** Render a scene with the lens over a drawn
arrow and assert the lens interior contains the arrow's ink — masked to the
aperture, away from the zoom badge, so the base image alone cannot satisfy it.