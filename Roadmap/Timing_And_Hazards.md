# Timing And Hazards

**Player-facing:** yes
**Status:** shipped
**Started:** 2026-08-10

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

## Settled here — the two that were open

**A HAZARD CANNOT BE STOPPED. It is a metronome.** A jammable one is a puzzle piece,
and a puzzle piece needs a verb to jam it with, a state to say it is jammed, and a way
to teach both — three new things to learn in exchange for making the hazard stop being
the thing this phase is about. A metronome you cannot touch is learnable in one loop
and is then a permanent fact about the room that you PLAN around, which is the second
axis the phase exists to add. Locks_And_Levers owns making a thing change state; one
mechanic doing that twice would leave the player unable to tell which kind of fixture
they were looking at.

**ICE CARRIES YOU UNTIL YOU LEAVE IT.** Not two tiles: you slide while the tile under
you is ice and stop on the first one that is not, or against whatever is in the way.
The loss of control IS the better feeling, and it is also the rule every player already
knows from every other game with ice in it — which is worth more than a cleverer one
nobody can predict. And the whole slide is ONE turn, which is what makes frost
traversal: the cast that laid the ice buys back the turns the walk would have cost.

Third thing settled, which was not on the list: **THE LEVER IS A PRESSURE PLATE.** A
lever on a wall needs a verb, a prompt, a reach test and a tap target, all of which are
things to teach; a plate needs none, because this is a stepper and "put your weight on
that" is the one instruction the player already has. It also puts the cost where the
phase wants it, since the plate is somewhere ELSE and the walk between is the
arithmetic.

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

### What shipped

**`enemyRound` is the clock and there is no other one.** `tickClock` runs beside
`tickStatuses` and `tickGround`, so a beat means one thing everywhere. Hazards ADVANCE
and then resolve, in that order, so the wind-up the player can see always gets a turn
of its own before the blow lands — which is the whole difference between a hazard and
a random subtraction.

**Three states, three silhouettes.** Live is bright steel with a black rim, winding is
the same shape at a third of the size, idle is the socket it lives in. Period 3 or 4,
live for exactly one beat, so every hazard is crossable on the idle beat and waiting
for it costs real turns. Drawn procedurally on the `FireView` pattern — pooled quads
from `Pix` frames — so none of it needed a PNG and all of it re-authors itself at every
pixel step.

**Hazards do not know who stood on them.** The same function damages a creature and the
player, which is what makes baiting work: shove something onto the tile on the wind-up
and it is still there for the swing.

**A gate is a `Tile`, not a `Surface`**, because it changes walkability and that is the
one thing a surface never does — and it is see-through, so the room beyond and the
countdown are both readable from the wrong side of it. The countdown is PIPS rather
than a number: a digit is three pixels tall at this density, and a number in the log is
a number the player has to remember while being chased.

**Ice is a fourth `Ground` substance and a `react` row**, not a new system: frost onto
standing water freezes it, fire melts it back to the water it was. Sliding is one hook
on the stepper, because the stepper knows about the grid and deliberately not about
what a cast left on it.

## Acceptance

- A hazard's cycle can be learned by watching one loop.
- A creature caught by a hazard takes it, and the player can arrange that.
- A timed door is reachable by a player who plans and not by one who walks.
- The countdown is legible without opening anything.
- Nothing ticks out of phase with the enemy round.

### Checked, on generated floors and in the running game

**600 floors, sixty seeds of every depth, zero failures.** Every hazard on a walkable
tile, none on the three tiles `populate` needs, every cycle in range, and no two
hazards within three tiles of each other — a pair any closer reads as one hazard and
the player cannot tell which beat belongs to which. And the gate's two invariants,
which are the ones that can make a floor unfinishable: **with it shut the plate is
still reachable**, and **with it open nothing is cut off**. Every gate moves at least
six tiles between those two answers, or it is not a gate.

Hazards arrive on floor 3 and run 2.9 to 4.7 per floor; spikes join on 5, the gate on
6, the trapdoor on 8. Floor 7 gets a gate least often (39 of 60) because a ring has
few two-neighbour corridor tiles to hang one in.

**The beat, asserted directly.** A period-4 hazard cycles `live idle idle winding` and
a period-3 one `live idle winding`, both repeating exactly, and in both the winding
beat is always immediately followed by the live one. **Ice**: water, frozen by frost,
melted by fire back to water, laid on bare ground as ice, and never counted as burning.

**And in the game.** A blade bit the player for 13 and the same blade bit a creature
for 13 — the baiting play, from one function that never asks who stood there. The gate
started shut, a plate press opened it for its full span of 8, eight ticks shut it
again, and `walkable` followed the flag both ways.

**Not checked: most of the art.** The hazard and gate drawings had never been seen in a
frame. Every attempt to get the camera in front of one ended in the boot chooser
overlaying the view and then a crash, which was blamed on the newly landed start-page
work. It was not that: `ClockView.dispose` and `MurkView.dispose` threw their quad pools
away and left `live` where it was, so the next frame walked an empty array — and a floor
is disposed at the TOP of `enterFloor`, which then awaits the next one being built.
Every frame of every floor change ran against the corpse. Fixed, and the boot chooser
goes to depth 6 now.

**The trapdoor, checked in a frame at last, and it was wrong in three ways.** The lid
was one picture with a `scale.x` on it, so the half-open state was a texture going thin
rather than two leaves swinging; you could walk into an open shaft and nothing happened,
because the fall only ever fired on the beat the thing opened; and when it did fire it
called `descend`, which refuses to move anybody whose boss is still alive — so the one
hazard that exists to take a floor off you was inert for the whole of its useful life.
All three are fixed. Stepped into the showroom's trapdoor at depth 6 with the boss
alive, arrived on depth 7, no heal.
