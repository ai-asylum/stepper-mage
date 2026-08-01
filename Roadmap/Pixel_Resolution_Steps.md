# Pixel Resolution Steps

**Player-facing:** yes
**Started:** 2026-07-30 00:05
**Status:** in progress

Four texel densities — 144, 72, 36 and 18 pixels per world unit — each one **authored**
at its own resolution rather than downsampled from the one above, and chosen from a
setting.

## Why this phase

`PPU = 144` is too high for the buffer it is drawn into, and the cost is not detail —
it is aliasing. The world renders into a 400px-tall target and upscales NEAREST with no
mipmaps, so a wall one unit tall is roughly **1:1 at two tiles** and **undersampled
about 2:1 by four**. Past that the shimmer and busy-ness in the distance is texels
fighting over screen pixels, and no amount of art fixes it because the sampler has
nothing to fall back on.

Halving PPU moves the 1:1 point to about one tile, so nearly everything on screen is
magnified rather than crushed. That is both a chunkier, more deliberate pixel-art look
and measurably less shimmer.

## Settled decisions

- **Four steps: 144, 72, 36, 18.** Eighteen is the floor — a wall holds 18x19 texels
  and there is nowhere left to put a brick.
- **Each step is remade, not downsampled.** A resampled 144px texture at 36px is mush;
  the point is art that was composed for the grid it lands on.
- The step is a **setting the player chooses**, persisted. It lives as a chip under the
  minimap, in the run, because the only other screen in the game opens from a finished
  run and nobody should have to die to turn the shimmer down.
- **The book, the tree and the HUD do not take a step.** They are a separate
  full-resolution overlay pass, so they are not what aliases and there is nothing for a
  step to fix — a coarser page would cost legibility on a 390px phone and buy nothing.
  The grimoire is held in your hands in front of the room, which is already a different
  plane; at the low end it reads as a fine object in a coarse world rather than as a
  mismatch.
- **Sprites take the step, but they stop at 36.** Rosters ship at 144, 72 and 36, and
  the 18 world draws its creatures from the 36 set. The 18 roster was generated, looked
  at, and cut. **A texel density that works for tiling masonry does not work for a
  single object that has to be identified**: a wall repeats and gets to be vague,
  while a creature one tile away fills half the screen and has to be recognisably a
  candle-moth rather than a boss. At 18 the moth is nineteen texels across and the
  floor-1 boss loses the eye that is its whole identity, so it reads as a coloured blob
  with a keyline. No amount of re-authoring fixes nineteen pixels. This is the phase's
  own rule — cut a step that cannot be made to look deliberate — applied to the half of
  the art where it bit.
- **18 is the default.** It is what the phase argued for: 144's "detail" arrives as
  shimmer in a 400px-tall buffer, and 18 puts nearly everything on screen in
  magnification. It also means every step is somebody's first impression.

## Out of scope

- `internalHeight` and the render resolution. That is the other pixel-size knob, it is
  independent, and it is not what this phase changes.
- New floors, creatures or spells.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

**The world textures are procedural, so "remade" means the generators, not files.**
`src/art/tiles.ts` composes masonry, bevels, AO, cracks, grain and per-theme detail out
of absolute pixel counts — a 3px bevel, a brick course so many pixels tall. Those
numbers are the art. At PPU 36 a 3px bevel is a third of a brick, so each step needs its
own set, chosen by eye, not a scale factor applied to one set. Five themes times four
steps is the bulk of this phase.

**Sprites are sized off their own density, not the world's.** World size is
`pixels / spritePpu * SPRITE_SCALE`, where `spritePpu` is the roster a step draws from —
a separate field from `ppu` precisely because the two diverge at 18. Halve the pixels
and that entry together and the quad does not move; wire them into one number and
halving the world's density doubles every creature in it.

Lower rosters are re-derived from the raws cached in `art/_work/` with
`tools/genart.py --steps 72,36` — no API calls. Going back to the 1024px raw matters:
the shipped 144 PNG is already quantised to 32 colours and keylined, and squeezing that
again carries both decisions down to a grid that wanted different ones. Three knobs move
per step and they do not move together — palette size, a pre-blur that kills detail
finer than a resample cell, and a contrast lift that compensates for how hard averaging
flattens tone. Blurring 18 as hard as 72 is what turned the bookshelf into a brown
rectangle; the coarser the grid the *less* pre-blur it wants, because the box filter has
already destroyed everything below a cell.

**The book and HUD are a separate pipeline and will not follow.** They render crisp at
device resolution and were just authored at a fixed pixel size, so the chunkier the
world gets the wider the mismatch. Either the page and cover atlases take a step too, or
the phase accepts that the grimoire stops matching the room at the low end — decide
deliberately, and say which.

**A slider makes every step a promise.** Two steps tuned well will beat four tuned
badly, and the failure mode of this phase is four positions that all look like
accidents. If a step cannot be made to look deliberate, cutting it is the better answer.

## Acceptance

- All four steps are selectable, and the choice survives a reload.
- Each step's textures were composed at that density — no step is a resample of another.
- At every step, a brick reads as a brick and a bevel reads as one pixel of shadow, not
  as a third of a course.
- Sprites are the same size in world units at every step — to within one texel of the
  coarsest step, which is as exact as integer pixel dimensions allow.
- A creature is identifiable at every step, standing one tile away.
- Distant walls do not shimmer at 72 and below.
- Nothing in the HUD, the book or the tree changes size or legibility when the step
  changes, or if it does, it changes deliberately.
