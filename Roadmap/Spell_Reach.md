# Spell Reach

**Player-facing:** yes
**Status:** planned
**Started:** —

A blast fills the space it is in, up to its radius, and does not pass through walls.

## Why this phase

Radius spells reach through stone. A blast in one room kills creatures in the next,
because a victim is chosen by straight-line distance and a wall is not consulted.

## Settled decisions

- **A blast FILLS THE GRID.** It propagates outward tile by tile from where it went
  off, up to its radius, spreading through doorways and round corners exactly as far
  as it can walk. Radius becomes PATH distance rather than straight-line distance.
- **It never crosses a wall.** That is the whole rule and the only rule.
- **It is NOT contained to a room.** A blast beside a doorway should pour into the
  hallway; rooms are not airtight and the wall is what stops fire, not the label on
  the tiles. Room containment was considered and is wrong.
- **It is NOT line of sight.** Line of sight was considered and is also wrong: it
  refuses to go round a corner, and a blast round a corner is precisely what a blast
  does. A raycast models an arrow, not an explosion.
- **The propagation is the BFS `stepToward` already uses.** Same walkable test, same
  expansion, different stopping condition. There should be one answer in the codebase
  to "which tiles can be reached from here in N steps".

## Out of scope

- Radius numbers, damage, or the shape of any area effect. This bounds the existing
  reach; it does not retune it.
- What the player can see. A wall stops fire whether or not anyone is watching.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading.

**Three victim-selection sites in `combat.ts` pick by straight-line distance** — the
splash victims, the conduction arc (`CONDUCTION_ARC_SHARE`) and the object-reaction
victims. All three need the same flood, and none of them should implement it
themselves.

**A flood is cheap here and should not be optimised.** The grid is small, radii are
single digits, and the BFS in `stepToward` already expands a whole floor without
anyone noticing.

**Expect a retune, but a smaller one than a raycast would have needed.** This is more
generous than line of sight — it reaches round corners — and less generous than the
current straight-line radius, which reaches through walls. The net is a nerf to blasts
fired at a wall and no change at all to one fired down an open room, so the gate may
move less than it looks like it should. Measure rather than assume.

## Acceptance

- A blast never damages anything on the far side of a wall.
- A blast beside a doorway reaches into the hallway, up to its radius.
- A blast in an open room is unchanged.
- Object reactions obey the same bound as the cast that set them off.
- `fullrun --hand1` clears 5/5.
