# First Steps

**Player-facing:** yes
**Status:** shipped
**Started:** 2026-09-04

The tutorial [First_Minutes](First_Minutes.md) put out of scope: six guided beats
through the whole of the loop, once ever, on the line that phase already built.

## Why this phase

`First_Minutes` shipped one sentence — SWIPE TO MOVE, until the player moves once —
and listed "the tutorial the game does not have" under **Out of scope**. That
sentence covers the first of five verbs. Nothing anywhere says that a tap aims, that
a page comes out of the book upward, that the pill fires it, or that the lit
candelabra on the wall is a spell component rather than scenery.

The last of those is the one that matters most and is guessed least. `docs/DESIGN.md`
is built on the room being a third source of components alongside the book and the
belt; a lit fixture reads as decoration in every other first-person game ever made,
so a player who is never told walks the whole dungeon past half of their own
inventory.

The phase is deliberately NOT a curriculum. `docs/DESIGN.md` says starting at hand
size 1 "is the reason the game needs no fusion tutorial", and that omission is the
design's, not an oversight to correct — so fusion, the belt, the star tree, the altar
and the deed gates are all left to sell themselves.

## Settled decisions

- **Six beats, in the order the game reveals itself.** Step, turn, aim, tear, cast,
  harvest. Not a teaching order chosen here: the mouth of the dungeon hands you a
  closed book and an empty corridor, `bookOnScreen` only raises the grimoire once
  something is aimed at, and a cast needs a component in hand. The script follows the
  rules that already hold.
- **It replaces the movement hint rather than sitting beside it.** The HUD draws one
  instruction at a time, and two voices competing for that line at the moment the
  player knows nothing is worse than either alone. `SWIPE TO MOVE` survives as the
  fallback the flow leaves behind, unchanged, for the nudge case and for anyone the
  flow does not run for.
- **Every beat is the real gesture.** Each one ends on the event or the state the game
  itself reads — `stepper.onArrive`, `onTurnDone`, `hud.target`, `fan.count`, a cast
  that actually spent the turn, `harvestFrom`. There is no timer standing in for a
  swipe, and a beat cannot be satisfied by something the player did not do.
- **Nothing can wedge, and there is always a way out.** A beat whose gesture is not
  available says what to do to reach it instead of repeating an instruction that
  cannot be followed; if that goes unanswered it restates itself, and then gives up
  and hands over the next beat. A SKIP pill is on screen the whole time.
- **The game does the gating, not the flow.** One refusal exists — the grimoire will
  not give up a page while the first instruction is fresh — and it is bounded to eight
  seconds. Everything else is already gated by rules the game enforces for its own
  reasons, and a second copy of those rules would be a second thing to keep true.
- **Once ever, per save.** Completion is persisted under its own versioned key. A save
  that has finished a run counts as taught, which is what keeps the flow off the
  screen of every player who already owns the game.

## Out of scope

- Fusion, the belt, the altar's three cards, the star tree and the deed gates. All of
  them arrive with a screen of their own that explains them, and the first descent is
  over before any of them is reachable.
- A second flow for the depths. Whatever floor 4 needs teaching is not a first-run
  problem.
- Localisation. The lines are English upper-case in the HUD's own voice, exactly as
  every other string in the game is today.

## Implementation

`src/game/onboarding.ts` is the script and the clock; it holds no game state and can
write none. `main.ts` builds it, hands it five booleans a frame, tells it what the
player did, and reads one line off it into the HUD.

**The world view is a thunk, not a snapshot.** `hud` does not exist until the first
floor is built, so a view handed over at construction would have read `undefined`.

**The tick runs first in the frame**, above the door-cut's early return. A line the
loop stops refreshing is a line that stays on screen, and the one interruption this
flow is guaranteed to meet is the staircase at the end of the floor it runs on.

**The clock only runs while a gesture is being asked for.** Modals, cuts, the plunge
and a finished run are not time the player is failing to act in.

**It reports itself as a funnel** — `onboarding_step` per beat, then
`onboarding_completed` or `onboarding_skipped` with the beat reached, named as well as
numbered. The existing `ftue_completed` is untouched: it is an activation column that
fires once per install and cannot be backfilled, so redefining it would leave the two
halves of the series measuring different things.

**The harnesses opt out by default.** Every one of them runs in an empty
localStorage, which is a first-time player; `openGame` marks the flow complete so they
measure the game. `tools/ftuetest.mjs` is the one that opts in, and
`window.__game.replayOnboarding()` is the way back in by hand.

## Acceptance

- Every beat is ended by the real thing it claims to wait for. — **met and verified**
  by `tools/ftuetest.mjs`: a real key-driven step and turn, a reticle, a page in the
  hand, a cast that spent the turn, and a harvest from a fixture the player is
  standing next to and facing.
- A beat the room cannot answer does not ask forever. — **met and verified.** The
  give-up clock is asserted directly, and the two beats that depend on the generated
  floor say what to walk toward while their gesture is unavailable.
- The flow can be skipped, and the skip is remembered. — **met and verified.** The
  SKIP pill is found by hit-testing the drawn HUD rather than by assuming where it is.
- The game plays normally afterwards. — **met and verified.** No gate is left behind,
  no line is left on screen, and the grimoire is unconditionally free.
- It does not run for a player who already owns the game. — **met**, on the evidence
  of `meta.best > 0`. Not verified in play, because there is no way to observe an
  existing install from here; it is a two-line path and it is worth an eye at review.
- The playable ad still converts. — **not measured**, and it cannot be from here. The
  creative runs this same code, so a first-time localStorage means the ad now opens on
  SWIPE UP TO STEP with a SKIP under it. That is the reason the one refusal is capped
  at eight seconds rather than at the beat's own 30.
