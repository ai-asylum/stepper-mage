# Creature Behaviour

**Player-facing:** yes
**Status:** planned
**Started:** —

Monsters that are a problem to solve rather than a pile of health.

## Why this phase

Every creature in the game is the same creature: it walks toward you and it hits you,
and the only thing that differs is how much damage it takes to stop. `Enemy_Identity`
gave them faces, facings and elements; it did not give them behaviour, so a bone hound
and a fungal priest play identically.

That is why the answer to every room is the same cast. Not because the cast is too
strong — because the room never asks anything else.

## Settled decisions

- **A statue is an obstacle while you look at it.** Turn away and it moves. The
  counterplay uses what the player already has: light the ground, look away, let it
  walk into the fire.
- **A spell-eater drinks ground effects.** It walks into your fire and puts it out, so
  your terrain is a resource it is stealing.
- **Something bursts when it dies**, hitting its own tile and its neighbours. Trivial
  to avoid one at a time; punishing to a volley. The cleanest anti-AOE creature there
  is.
- **Something strengthens as its kin die**, so kill order is the puzzle.
- **Ranged creatures**, which make cover matter and give blocks and pillars a job.
- **Creatures that move differently** — not all of them walk one tile toward you.

## Open — not decided

- **Whether anything crawls on walls or ceilings.** The camera does not pitch and must
  not start, so anything above has to be readable at the fixed framing or it does not
  belong up there.
- **How much of this is animation and how much is rules.** A statue that only moves
  unobserved needs no new art; a wall-crawler needs a whole new pose set.

## Out of scope

- Rebalancing — Difficulty_Rebase decides what a creature's numbers are worth.
- Hazards that act on a clock — Timing_And_Hazards.
- New floors or rosters.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

**`enemyRound` is one branch for hostiles and one for golems**, and every hostile runs
the same code. Behaviour means that branch becomes a small set of behaviours keyed off
the creature, and `Combatant` is where that lives.

**`isAlerted` and the threat set feed the HUD.** A creature that does not close in a
straight line has to keep those honest, or the telegraph promises a reach the creature
does not have.

**The statue needs the player's FACING**, which `stepper.dir` already carries and
`targetsInView` already uses for its cone — the same test, asked of the creature
instead of the player.

## Acceptance

- Two creatures on the same floor pose different problems, not different numbers.
- At least one creature is best answered by something other than damage.
- A room of the bursting creature makes a volley the wrong choice, visibly.
- Nothing new requires the camera to move.
