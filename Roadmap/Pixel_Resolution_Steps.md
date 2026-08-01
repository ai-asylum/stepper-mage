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
  mismatch. Same answer, same reason, for every billboarded sprite: they follow the
  density their art was authored at, not the masonry's.

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

**Sprites are sized off PPU and will double if it halves.** World size is
`pixels / PPU * SPRITE_SCALE`, so every creature and prop needs its source size halved
per step or the roster grows twice as tall each time. They can be re-derived from the
raws cached in `art/_work/` with `tools/genart.py --post` — no API calls — but that is 63
files per step, and they all ship. Decide whether every step carries a full set before
generating any of them.

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
- Sprites are the same size in world units at every step.
- Distant walls do not shimmer at 72 and below.
- Nothing in the HUD, the book or the tree changes size or legibility when the step
  changes, or if it does, it changes deliberately.
