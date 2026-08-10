# Grid Vocabulary

**Player-facing:** yes
**Status:** planned
**Started:** —

What a tile is allowed to be. A gap you can see across but not walk, and a floor
that is not all at one height.

## Why this phase

The grid says `Wall | Floor | Stairs` at a single height, and that is the ceiling on
every layout the game can ever generate. Islands, a chasm and terraces are not hard to
write — they are impossible to say. The generator is not the limit; the alphabet is.

It is also the cheapest place to add variety, because almost nothing reads the grid
directly. Targeting, the volume flood, enemy pathing and the minimap all go through
`walkable()` and `clearLine()`, so a new tile kind is learned by most of the game
without being told.

## Settled decisions

- **A GAP blocks movement and not sight.** Every obstacle today does both, because a
  wall is the only obstacle there is. A gap is a second axis: `walkable()` says no,
  `clearLine()` says yes. You can see across it, shoot across it, and not cross it.
- **Volumes stop at a gap.** Fire fills walkable tiles, so a gap is a firebreak — and
  that falls out of `Grid.fill` without a special case.
- **Height is a small integer per tile**, not a second grid. A floor is mostly one
  level with sections a step or two down.
- **This phase adds no gameplay.** It is the data the next four phases are written in.
  A gap that nothing generates and nothing falls into is the correct outcome here.

## Open — not decided

- **How many height levels.** Two is enough for a sunken room; more is enough for a
  terraced floor, and the renderer pays for every one of them.
- **Whether a gap has a bottom.** A pit you fall INTO is a different tile from a gap
  you cannot enter, and Verticality needs the first one.

## Out of scope

- What falls into a gap, and what falling costs — Verticality.
- Which floors use any of this — Layout_Generators.
- Surfaces: what a tile does to a spell standing on it — Tile_Vocabulary.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

**`clearLine` and `walkable` are the seam.** Both already exist and both are asked by
everything that matters. A tile kind that answers them correctly is a tile kind the
targeting cone, the flood, `stepToward` and the minimap all understand for free.

**The minimap has to draw a gap as a gap.** It has three tones today — wall, seen
floor, walked floor. A gap that draws as a wall is a lie about a route.

**Height is the expensive half and it is mostly renderer.** `render.ts` builds wall
quads at `WALL_H` off a 2D grid; per-tile elevation means the floor and ceiling quads
move too, and sprite sorting stops being trivial once things can be above each other.
Consider landing the gap alone first — it is data — and taking height with
Verticality.

## Acceptance

- A gap can be seen and shot across, and cannot be walked into.
- A volume stops at a gap, without a special case for it.
- The minimap draws a gap as neither wall nor floor.
- Nothing in the game generates one yet, and nothing is broken by that.
