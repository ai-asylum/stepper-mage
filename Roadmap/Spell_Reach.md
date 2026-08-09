# Spell Reach

**Player-facing:** yes
**Status:** planned
**Started:** —

Spells propagate through the grid instead of through the air. Some have a RADIUS and
some have a VOLUME, and neither passes through a wall.

## Why this phase

Radius spells reach through stone. A blast in one room kills creatures in the next,
because a victim is chosen by straight-line distance and a wall is not consulted.

## Settled decisions

- **A spell has a RADIUS or a VOLUME, and they are different things.** A radius is a
  point effect that reaches some distance. A volume FILLS space — it flows into every
  tile it can walk to, wraps corners, pours down hallways, and is dangerous to whoever
  is standing in it INCLUDING THE PLAYER. Fire is a volume. Which spell is which is a
  table this phase has to write.
- **A volume reaching the caster is a feature, not a hazard to design out.** It is the
  balancing lever on fire: the most generally useful element becomes the one you can
  hurt yourself with, and standing in a doorway stops being free.
- **A volume FILLS THE GRID.** It propagates outward tile by tile from where it went
  off, up to its radius, spreading through doorways and round corners exactly as far
  as it can walk. Radius becomes PATH distance rather than straight-line distance.
- **It never crosses a wall.** That is the whole rule and the only rule.
- **It is NOT contained to a room.** A blast beside a doorway should pour into the
  hallway; rooms are not airtight and the wall is what stops fire, not the label on
  the tiles. Room containment was considered and is wrong.
- **It is NOT line of sight.** Line of sight was considered and is also wrong: it
  refuses to go round a corner, and a blast round a corner is precisely what a blast
  does. A raycast models an arrow, not an explosion.
- **A radius does not wrap.** Reaching round a corner is what makes a volume a volume;
  if everything wrapped there would be no distinction worth having.
- **The propagation is the BFS `stepToward` already uses.** Same walkable test, same
  expansion, different stopping condition. There should be one answer in the codebase
  to "which tiles can be reached from here in N steps".

## Open — not decided

- **Which spells are volumes.** Fire is. Gust probably is, because it has to be able to
  reach a fire in order to put one out. Everything else is unasked.
- **What a volume does to the player** beyond being able to reach them — the same
  damage as an enemy takes, or less, and whether the player's own cast can kill them.

## Out of scope

- Persistent ground fire, which is Burning_Ground. This phase is about how far a spell
  reaches at the instant it goes off, not about what it leaves behind.
- Radius numbers and damage. This bounds the existing reach; it does not retune it.
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
- A volume can reach and damage the player.
- Object reactions obey the same bound as the cast that set them off.
- `fullrun --hand1` clears 5/5.
