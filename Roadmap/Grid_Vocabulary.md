# Grid Vocabulary

**Player-facing:** yes
**Status:** shipped
**Started:** 2026-08-10

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

## Settled here — the two that were open

- **FIVE height levels, -2..+2, and 0 is the plane the game already stands on.** So an
  all-zero array is exactly today's floor and nothing had to be migrated. Two down
  carries a sunken room and the ledge you get shoved off; two up carries a terrace you
  can see over from the walkway. The count is a renderer bill and not a design wish —
  every level is another band of quads at every elevation seam — so Verticality may
  narrow it and should not widen it without paying.
- **A GAP HAS NO BOTTOM, and a pit you fall into is not a tile kind.** It is a floor
  tile a level or two down, which the height array already says. That keeps the
  alphabet at one new letter instead of two, and it means Verticality gets its fall
  for free from something it has to build anyway: the drop from `heightAt(here)` to
  `heightAt(there)`. A gap is the case with no `there`.

Sight became its own seam to carry this. `Grid.seeThrough` is the second question the
grid answers — only a wall fails it — and `walkable`, which every obstacle used to
share, is now strictly about footing.

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

**That is what was done: the gap is live, height is a field nobody reads.** The seam
held — targeting, the volume flood, `stepToward`, the pathing flood and the bump all
learned the gap from `walkable` and `seeThrough` without being edited. FIVE places had
to be told the difference by hand, and every one of them turned out to be a place that
had been saying "wall" when it meant something narrower:

- `clearLine` asked `walkable` of a sight question. Now `seeThrough`.
- `rayTiles` did too, and now returns the gap and what is behind it.
- The light bake stopped at anything unwalkable. Light crosses open air, or a brazier
  on one lip leaves the other in the dark for a reason you can see straight through.
- `placeLights` hung sconces on "not walkable", which over a chasm is a floating torch.
- `render.ts` drew a floor under everything that was not a wall, and a full-height wall
  face against everything that was not walkable — the second one would have put a wall
  along the edge of a thing whose entire point is that you see across it. A gap now
  gets no floor and no wall face and keeps its ceiling, and the hole IS the absent quad.

## Acceptance

- A gap can be seen and shot across, and cannot be walked into.
- A volume stops at a gap, without a special case for it.
- The minimap draws a gap as neither wall nor floor.
- Nothing in the game generates one yet, and nothing is broken by that.

### Checked, on the dev server, by carving a gap into a live floor

There is no harness, so this was driven by hand through `window.__game`: carve a tile
to `Tile.Gap`, `restep`, and look.

- **Seen and shot across.** With a gap between the player and an altar, an ink creature
  and a candelabra, `hud.candidates` held all three — the same list as before the carve.
  `rayTiles` returned the gap AND the five tiles beyond it.
- **Not walked into.** `press({move:'forward'})` into the gap bumped and left the player
  on their tile; the identical press with that one tile set back to `Floor` moved them
  onto it. Same seed, same frame, one byte different.
- **The volume stops.** `fill(9)` from the near side took nine tiles and none of them
  was the gap; `flood` reported -1 on it and 4 on the tile behind it — the way round.
  No line of `fill` mentions gaps.
- **The map.** Three carved tiles drew as three hollow cells, three rows ahead of the
  wedge, against solid floor either side.
- **Nothing generates one.** A freshly generated floor counts zero gaps, and the
  renderer, the sconce placer and the light bake were all touched to keep it that way
  honestly rather than by never meeting one.
