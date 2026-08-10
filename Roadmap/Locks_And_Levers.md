# Locks And Levers

**Player-facing:** yes
**Status:** planned
**Started:** —

A reason to walk the map that does not make you stronger.

## Why this phase

The compass points at the altar, the altar is the only thing on a floor worth walking
to, and once it is claimed the rest of the map is a corridor to the boss. Exploring is
not rewarded because there is nothing out there.

The obvious fix is more altars, and it is the wrong one — more of the same reward just
inflates the player. The reward for exploring should be ACCESS. A lever does not make
you stronger; it opens the boss door. That is a reason to walk every room that costs
the game's balance nothing at all.

## Settled decisions

- **Levers open doors, not power.** Nothing found by exploring makes the player
  stronger.
- **A boss door shows how many sockets it has.** You know how many levers you are
  missing; you do not know where they are.
- **Blocks are pushed by GUST.** The verb exists and already shoves. One cast, one
  tile, and a cast is a turn — so a block puzzle costs tempo rather than damage.
- **Blocks are solid and indestructible**, which means they do three jobs: a puzzle
  piece, cover that breaks line of sight, and a firebreak.
- **Plates do a different thing per floor** — open a door, raise a wall, extend a
  bridge, kill the lights. Same object, different verb, and that is floor variety
  without a new object.
- **Secret doors are STUPID SIMPLE.** A wall drawn slightly wrong. Tap it, cast at it,
  it opens. No environmental tells, no sequences, no combination locks.
- **Plants grow into climbable vines.** In your way, then your way up. And they burn,
  so which spell you throw at one is a real decision.
- **A camera cut shows a door opening.** Deliberate, brief, and only because the
  player did something — the opposite of a framing that moves on its own.

## Open — not decided

- **Which element grows a vine.** Decay is the animancy page and "make a thing live"
  fits it better than anything else in the book.
- **Whether a floor can be finished without its levers.** A boss door that can only be
  opened one way is a gate; one with a hard alternative is a choice.

## Out of scope

- Rewards that make the player stronger. That is the altar's job.
- Timed doors — Timing_And_Hazards owns anything on a clock.
- What is behind the door.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

**The camera cut is the one new piece of presentation** and it should be built once
and reused for every lever. `Engine` has no concept of a scripted move; the cheapest
version is a fixed look-at with a short ease, and it must return control exactly where
it took it.

**Gust already shoves** (`Combat.shove`), and it stops at anything solid. A block is a
prop that does not die and does not animate — most of what it needs already exists on
`Entity`.

**A secret wall is a tile that draws wrong and answers `clearLine` as a wall.** The
temptation is to make finding it clever; the decision above is that it is not.

## Acceptance

- A floor with levers cannot be finished without walking rooms the compass never
  points at.
- Nothing found by exploring increases the player's damage, health or hand.
- A block can be pushed onto a plate with gust, and blocks line of sight and fire.
- The camera shows the door open, once, and gives control straight back.
- A secret wall is findable by tapping a wall that looks wrong, and nothing else.
