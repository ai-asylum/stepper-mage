# Verticality

**Player-facing:** yes
**Status:** planned
**Started:** —

More than one level per floor, and what falling off one costs.

## Why this phase

Everything is at one height, so every fight is a plan view. The player has one
spatial question — how far away is it — and no second one.

Height adds the second for free, and it makes the weakest spell in the book the
strongest in the right room: gust shoves, and a shove near a ledge is worth more than
damage. That is a direct answer to every creature being an HP sink, and it costs no new
verb.

## Settled decisions

- **Falling is DAMAGE, scaled by the drop.** Not an instant kill. A one-step drop is a
  nudge and four levels hurts, which is why height is worth more than two levels.
- **It cuts both ways.** Something can shove the player off, so a ledge is a threat
  readable from across the room.
- **Down is free, up is not.** You can always drop; climbing needs a ladder. One-way
  traversal with no new verb and no locked door.
- **Standing high shows you the room below** before you walk into it — "you should know
  what is coming" without a reveal or a tooltip.

## Open — not decided

- **How many levels.** Two gets falling, the shove and the overlook; more gets a
  terraced layout and costs renderer work per level.
- **Whether a fall can carry you to the next FLOOR.** Traps do that in
  Timing_And_Hazards, and one mechanic doing it twice needs a reason.

## Out of scope

- Ladders as a puzzle lock — Locks_And_Levers owns vines and gates.
- The height field itself, which is Grid_Vocabulary's.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

**This is the renderer phase and the largest of the dungeon set.** `render.ts` builds
wall quads at `WALL_H` off a 2D grid, and floor and ceiling are single planes per tile.
Per-tile elevation moves all three, and sprite sorting stops being trivial once two
things can occupy a column at different heights.

**The camera does not pitch and must not start.** `FRAME_SHIFT` is a constant
(`First_Minutes`) and a look-up gesture is not the answer to a ceiling. If something
cannot be seen at the fixed framing, it should not be up there.

**Gust already shoves** (`Combat.shove`). What is missing is what happens when the
destination is lower.

## Acceptance

- A body shoved off a ledge takes damage scaled to the drop, and so does the player.
- You can drop anywhere along an edge and climb back only at a ladder.
- From a high tile you can read the level below before entering it.
- The camera framing never changes.
