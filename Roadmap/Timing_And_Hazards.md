# Timing And Hazards

**Player-facing:** yes
**Status:** planned
**Started:** —

Blades, spikes and doors on a beat you can count — so WHERE you stand and WHEN
become a second question.

## Why this phase

Every problem in this game is "what do I cast at that". There is no question about
when, because nothing in a room changes on its own.

This is a stepper, so it is already a clock: a cast is a turn, a step is a turn, and
the player counts turns whether they mean to or not. A blade that swings every third
turn is readable without a tooltip and plannable without a UI. It is the cheapest
second axis the game can have.

## Settled decisions

- **Hazards run on a countable beat.** Turns, not seconds. Watch one cycle, know the
  rest.
- **Hazards hit creatures too.** A blade is a weapon: bait something onto the tile, or
  shove it there on the wrong beat. Another answer to a monster that is not damage.
- **Timed doors make TURNS the currency.** A lever opens a door some tiles away and it
  shuts in a few turns. Five turns is five actions — walk, or spend one casting the ice
  that carries you further per step.
- **Ice is traversal.** Frost on the ground means you slide, so a movement spell exists
  without adding a movement spell.
- **The clock is visible**, on the door. Failing is the player's fault and retrying is
  obvious.
- **Traps belong here**, including a fall that drops you to the floor below — same
  clock, same tiles.

## Open — not decided

- **Whether a hazard can be stopped.** One a player can jam is a puzzle piece; one
  they cannot is a metronome.
- **How far ice carries.** Two tiles changes a route; more becomes a loss of control,
  which is a different feeling and may be the better one.

## Out of scope

- The shape of the room the hazard is in — Layout_Generators.
- Creatures that act on a timer of their own — Creature_Behaviour.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

**`enemyRound` is the clock.** Hazards should tick where statuses and the ground do,
so a beat is a beat everywhere and nothing drifts out of phase with the round.

**The countdown goes ON the door**, not in the log. A number the player has to
remember is a number they will misremember, and the puzzle is arithmetic done while
being chased.

**Ice uses the ground layer that exists.** Frost on water freezes it; `Ground` holds
the substance and `groundUse` already decides what a cast does to a tile, so sliding is
a property of a substance rather than a new system.

## Acceptance

- A hazard's cycle can be learned by watching one loop.
- A creature caught by a hazard takes it, and the player can arrange that.
- A timed door is reachable by a player who plans and not by one who walks.
- The countdown is legible without opening anything.
- Nothing ticks out of phase with the enemy round.
