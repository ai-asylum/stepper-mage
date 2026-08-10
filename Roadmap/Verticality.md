# Verticality

**Player-facing:** yes
**Status:** shipped
**Started:** 2026-08-10

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

## Settled here — the two that were open

**FIVE, and the renderer does not care.** Grid_Vocabulary stored -2..+2 and this phase
was the one entitled to narrow it; it did not, because the cost turned out not to scale
with the count. The riser between two tiles is built from the DIFFERENCE of their
heights, so one quad handles a one-step kerb and a four-step cliff identically and
there is no per-level work anywhere. What the levels cost is fall damage tuning, and
that is a curve rather than a table. In practice the dressing pass uses one level and
two, and terraces uses three of the five.

**A FALL DOES NOT CARRY YOU TO THE NEXT FLOOR.** Timing_And_Hazards owns the pit that
drops you a floor, and if a ledge did it too the player could not tell which kind of
hole they were looking at until they were in it — and the whole design of this phase is
that a drop is legible from the top. So they are two things with two readings: a fall
inside a floor is DAMAGE, always survivable in principle and always your own decision;
a fall between floors will be a TRAP, and traps get to be a surprise because that is
what the other phase is for.

Third thing settled, which nobody had written down: **NOTHING WALKS OFF A LEDGE OF ITS
OWN ACCORD.** Bodies refuse a step down as well as a step up, so falling only ever
happens because something SHOVED you or because you chose it. The consequence is the
point: dropping off an edge puts you somewhere the room cannot follow without going
round, which is a positional resource the player buys by giving up the high ground and
the ladder back.

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

### What shipped

**The renderer is one number and the risers it implies.** Every quad of a tile is built
off `e = heightAt * STEP_H`: floor at `e`, ceiling at `e + WALL_H` — the headroom
follows the ground, so a sunken room is a sunken ROOM rather than a room with a taller
ceiling — and a wall face runs between the two rather than from zero. Where a tile
meets a lower neighbour it draws TWO risers, the ledge and the soffit over it, always
from the high side so no edge is drawn twice. Without the second one a terrace has
daylight over its step.

**`canClimb` is the traversal rule and it is directional.** Down is free everywhere,
up only from a `Surface.Ladder`. That is one-way movement with no new verb and no
locked door — and the same function is asked by the player's feet, by enemy pathing and
by the shove, so nothing has its own idea of what a ledge is. `Combat.shove` gained one
line and gust became the phase's whole argument: it costs five damage and pushes one
tile, so shoving something off a two-level edge beats casting it three times.

**Height turns reachability into a DIRECTED graph**, and that broke every intuition
carried over from the flat grid. `stitch` answers "is it all connected" and is no longer
enough; the question splits in two, and the second one — can you get BACK — is the one
that matters, because a tile you can walk into and not out of is a run ended by the
scenery. The dressing pass therefore makes its cut and then CHECKS, reverting the room
if either answer is no. Three separate ways of breaking it were found that way and none
of them was the obvious one: a pit that swallowed the tile a chapel's door opened off;
a pit split into three strips by the nave's pillars with a ladder in only one of them;
and a room whose only good half to sink depended on which way it was sliced.

**The overlook came out of `visibleTiles`** rather than out of a new system: standing
above, every lower tile within a good look and a clear line is revealed, and the ledge
itself is not an obstacle. That is the whole of "you should know what is coming" — you
are simply higher than it.

**Terraces is written**, which retires the item Layout_Generators had to leave open. It
is the fourteenth generator and it is on the bench with spiral, labyrinth and nested —
the floors get their elevation from the dressing pass instead, because a ledge in the
room where a fight happens is worth more than one floor that is a staircase.

## Acceptance

- A body shoved off a ledge takes damage scaled to the drop, and so does the player.
- You can drop anywhere along an edge and climb back only at a ladder.
- From a high tile you can read the level below before entering it.
- The camera framing never changes.

### Checked, on generated floors and in the running game

**880 floors, eighty seeds of every depth plus terraces, zero failures** on the two
questions that matter once climbing is one-way: every walkable tile reachable from the
start, and every walkable tile able to get BACK to it. Plus: no ladder without
something above it to climb, the altar and the descent reachable and returnable, and
`populate` still placing nothing in stone. Which floors carry elevation, out of eighty
seeds each: islands 65, gauntlet 80, chasm 77, hub 51, terraces 80. The cathedral gets
none and that is structural — every way of halving its nave leaves a chapel door on the
sunken side — and the ring's bulges are too small to hold a drop.

**The traversal rule, exhaustively, over 200 floors**: 201 up-steps from a ladder, none
wrongly refused; 1216 up-steps from plain floor, none wrongly allowed; 1417 downhill
steps, none wrongly refused, and `dropFrom` matching the rise every time. The damage
curve is 0, 4, 16, 36, 64.

**And walked.** Stepping off a one-level ledge: the player lands on the tile below, the
eye drops by 0.287 world units against a `STEP_H` of 0.294, and 4 HP go. Turning round
and pressing back into the ledge BUMPS and does not move — the same feedback a wall
gives. Shoving a hostile off the same edge moves it down a level, costs it 4, and puts
its sprite at -0.294. Looking at the ledge from the high side, the step face and the
soffit above it both draw and the creature standing in the pit is drawn standing in it.

**The framing never moved**, which is the acceptance line most easily broken by
accident: `eyeHeight` 0.525 and `pullback` 0.30 before the drop, during it and after
it, and `PITCH` is untouched. The eye rides the ground and nothing else about the
camera knows this phase happened.

**Not checked:** whether a ledge is FUN to fight around. The shove is the play this
phase exists for and nobody has made it under pressure.
