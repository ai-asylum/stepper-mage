# Sight And Reach

**Player-facing:** yes
**Status:** planned
**Started:** —

Nothing acts on the player from outside their knowledge, and nothing the player casts
reaches outside the room it went off in.

## Why this phase

Four complaints that are one complaint: **the game acts where the player cannot see.**

A hostile that walks into the open during its own round stays undrawn until the player
next moves, so it closes and swings while invisible. A blast kills creatures in rooms
the player has never entered. A creature standing at arm's length behind the player is
announced only as a number on the HP bar. Each of these was reported separately and
each is the same failure: the simulation and the presentation disagree about what
exists.

The rule this phase buys is that **being surprised is always the player's fault**.

## Settled decisions

- **Culling runs after every enemy round, not only before it.** `Floor.cull` decides
  visibility, and it is currently called before `enemyRound` and never after — so a
  body that moves into line of sight is invisible until the player's next step. The
  fix belongs at the end of the ROUND rather than at one call site, because casting
  runs a round too and fixing only the movement path leaves casting broken.
- **Splash, arcs and object reactions are gated on line of sight from the BLAST
  CENTRE.** Not from the player. A fireball that goes off round a corner should still
  splash what is standing next to it; what it must not do is reach through a wall.
  This is a deliberate trade and it is worth writing down: it shrinks "I killed things
  I never saw" without eliminating it, and the lever if that returns is moving the
  origin to the player.
- **Line of sight is the SAME predicate targeting already uses.** `targetsInView`
  samples `clearLine`; the damage paths must not grow a second, drifting answer to the
  same question.
- **A hostile within `THREAT_REACH` is on the minimap whether or not it is in sight.**
  This does not undo the wallhack fix. Memory stays banned — you never see where
  something WAS — but presence at arm's length is not seeing through a wall, it is
  knowing something is next to you.
- **The threat telegraph gains a direction.** The damage chevrons already know how to
  point; a threat in reach uses the same shape in its own treatment, so an adjacent
  unseen creature can be turned toward rather than merely counted.

## Out of scope

- Enemy AI, pathing or aggro range.
- The turn rule, which is settled in Casting_And_Movement.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading.

**Three victim-selection sites in `combat.ts` pick by distance alone** — the splash
victims, the conduction arc (`CONDUCTION_ARC_SHARE`), and the object-reaction victims.
All three need the same gate and none of them should implement it themselves.

**Gating damage by sight is a NERF and it will move the gate.** Radius spells get
materially weaker, Meteor and the arcs most of all. `fullrun --hand1` is calibrated on
the current numbers and should be expected to fail before it passes; budget the retune
into this phase rather than discovering it.

## Acceptance

- No creature can move into the open and act while still undrawn.
- Nothing takes damage from a blast it has no line of sight to.
- A hostile that can reach the player is on the minimap and has a direction, whether
  or not it is on screen.
- The minimap still never shows a creature the player cannot currently see or reach.
- `fullrun --hand1` clears 5/5 after the retune.
