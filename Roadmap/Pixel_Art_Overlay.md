# Pixel Art Overlay

**Player-facing:** yes
**Started:** —
**Status:** planned

Every drawn surface above the world becomes real pixel art: the grimoire's textures,
its page faces, and the star tree's pictograms.

## Why this phase

The world is authored pixel art — `Pix` writing a `Uint32Array` over `ImageData`,
through shading ramps and ordered dither, at 144px per world unit, then
NEAREST-upscaled. The overlay is not. The book's textures are painted with
antialiased serif type and vector shapes, its materials are smooth-shaded, and the
tree's twelve pictograms are bezier paths rendered crisp at device resolution.

That is one decision, not three bugs. Rendering the overlay at device resolution was
deliberate and correct for **page text** — a shrunken serif over chunky masonry is
unreadable. It was then applied to everything in that layer without asking whether it
was right for anything else, and it is not right for an icon or a book cover. The
result is two incompatible art pipelines sharing a screen, which reads as vector art
pasted over a pixel-art game.

This phase precedes Enemy_Identity because that phase adds attack VFX and an attack
telegraph, and those have to be authored in whichever pipeline wins here.

## Settled decisions

- The grimoire keeps its 3D model, its paper-curl shader and its tear. Only the
  textures change.
- Book covers, spine, ribbons and page faces are authored through `Pix` and uploaded
  with nearest filtering.
- The tree's twelve pictograms are redrawn as pixel art at a fixed small source size
  and blitted at an integer scale.
- Icons are drawn small and hit big — the tap target stays the whole cell, as it
  already does on the tree and the belt.
- **Belt glyphs and pouch sizing are deferred with the belt**, which is switched off
  behind `BELT_ENABLED`. They are part of this problem and will be part of this
  treatment when the belt comes back.

## Out of scope

- Sprites. Creatures, props, bosses and golems are already resampled onto a true
  pixel grid and are not the problem.
- The `Pix` toolkit itself, and the world's floor/wall/ceiling generators.
- `src/book/`'s geometry, shaders and gesture code — this is a texture change, and
  those files stay mergeable with upstream.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

The hard part is legibility, and it is the reason the smooth layer exists at all. A
page carries a title, a school line, an effect sentence and a turn cost, on a texture
that is read at arm's length on a phone. Shrinking a serif into a pixel grid will not
survive it, so this most likely wants a hand-authored bitmap face sized to the grid
rather than a rasterised system font. Prove the text before committing to the
retexture — if the type cannot be made readable, that is a finding worth reporting
rather than shipping an unreadable book.

## Acceptance

- No antialiased curve or vector-smooth edge remains anywhere on the book, its pages
  or the tree.
- Page text is readable at 390x844 and at 295px wide.
- The book still opens, leafs, tears and closes exactly as it does now.
- A tree pictogram is distinguishable from every other at its drawn size.
- Nothing in `src/book/` outside texture authoring has been restructured.

