# SnagCraft — known issues

Open defects in the **active** app (the Tauri line in `src/` + `src-tauri/`), with
the root cause as far as it has been traced. Nothing here is fixed until it says so.

Format: what the user sees · where it lives in the code · why it happens · what a
fix has to do · status.

---

## 1. Magnify lens ignores your annotations — it only magnifies the original screenshot

**Noted by rostad 2026-11-22.** Status: open, not scheduled.

**What you see.** Capture an image, draw an arrow / shape / text, then drop a
magnify lens over that area. The lens enlarges the *capture* underneath but the
annotations are invisible inside it — the enlarged area looks like the raw
screenshot, so the thing you wanted to point at is missing from the zoom.

**Where.** `src/editor/tools.ts` → `MagnifyRegion._render` (~L304) and
`src/editor/editor.ts` → `magnifySource()` / `refreshMagnifySources()` (~L1413).

**Why.** The lens samples exactly one thing: the `FabricImage`'s own element — the
decoded screenshot pixels (`this.image.getElement()`). Annotations are separate
Fabric objects painted *above* the image, so they are simply not part of what the
lens reads. `MagnifyRegion`'s docstring states this as a design decision ("the
pixels come from the background screenshot (never from annotations)"), which is
the behaviour that needs to change. Export uses the same `_render` via
`flatten()`, so the saved PNG matches the on-screen lens — i.e. the export has the
same hole, it is not a live-preview-only artefact.

**What a fix has to do.** Sample the *working composite* instead of the raw image:

1. Editor keeps an offscreen canvas per lens holding everything painted **below**
   that lens (image + the annotations under it), rendered at the current
   resolution; refreshed wherever `refreshMagnifySources()` already runs
   (load / undo / resize / zoom) and after any object change.
2. `MagnifyRegion._render` samples that canvas with the existing centre/zoom math
   unchanged — the geometry there is already correct and WYSIWYG-tested.
3. Objects stacked **above** the lens must stay out of the enlargement (z-order
   semantics: the lens magnifies what is under it).
4. `flatten()` must run the same prefix render at native resolution so the export
   matches the canvas pixel for pixel.

The paused Rust rebuild solved exactly this class of bug (`the lens now samples
the WORKING composite, not ctx.base`) — see the appendix row in
`docs/plans/rust-rebuild-status.md`. Worth reusing that reasoning, not the code.

**Test that would have caught it.** Render a scene with the lens over a drawn
arrow and assert the lens interior contains the arrow's stroke colour — masked to
the aperture so the base image alone cannot satisfy the assertion.