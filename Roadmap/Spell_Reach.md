# Spell Reach

**Player-facing:** yes
**Status:** planned
**Started:** —

A blast stops at the walls of the room it goes off in.

## Why this phase

Radius spells reach through stone. A blast in one room kills creatures in the next,
and the player finds out by walking into an empty room later — or never finds out at
all, because the corpses are somewhere they have not been.

This is not a visibility problem and the fix is not a visibility rule. A wall stops
fire whether or not anyone is looking at it. The rule this phase buys is that **a
spell's reach is bounded by geometry**, and it would be the same rule in a game with
no player in it.

## Settled decisions

- **Line of sight from the BLAST CENTRE.** Not from the player. A fireball that goes
  off round a corner still splashes what is standing beside it, because that is what
  a blast does; what it must not do is pass through a wall.
- **This is deliberately not "you cannot kill what you cannot see".** That rule was
  considered and rejected: it would mean a blast behaves differently depending on
  where the caster happens to be standing, which is a rule about the camera dressed
  up as a rule about fire. The cost is that a player can still kill something they
  never saw — round a corner from them, in the open from the blast — and if that
  becomes the complaint, the lever is moving the origin to the player.
- **The predicate is the one targeting already uses.** `targetsInView` samples
  `clearLine`; the damage paths must not grow a second, drifting answer to "is there
  a wall between these two tiles".
- **Room containment is NOT the rule.** It sounds closer to "within a room" and it is
  worse: corridors have no room, so `roomAt` returns null and a blast in a corridor
  either hits nothing or needs a special case. Line of sight handles rooms and
  corridors with one test, and inside a room it gives the same answer anyway, because
  walls are what bound a room.

## Out of scope

- What the player can see, which is Unseen_Threats.
- Spell damage, radius numbers or the shape of any area effect. This bounds the
  existing reach; it does not retune it.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading.

**Three victim-selection sites in `combat.ts` pick by distance alone** — the splash
victims, the conduction arc (`CONDUCTION_ARC_SHARE`) and the object-reaction victims.
All three need the same gate, and none of them should implement it themselves.

**This is a NERF and it will move the gate.** Radius spells get materially weaker,
Meteor and the arcs most of all, and `fullrun --hand1` is calibrated on the current
numbers. Expect it to fail before it passes and budget the retune into this phase
rather than discovering it.

## Acceptance

- Nothing takes damage from a blast that has no line of sight to it.
- A blast in a corridor still works, and still stops at the corners.
- Object reactions obey the same bound as the cast that set them off.
- `fullrun --hand1` clears 5/5 after the retune.
