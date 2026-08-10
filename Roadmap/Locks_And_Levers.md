# Locks And Levers

**Player-facing:** yes
**Status:** part shipped — levers, the boss door and the cut. Four items open.
**Started:** 2026-08-10

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

## Settled here — the two that were open

**A FLOOR CANNOT BE FINISHED WITHOUT ITS LEVERS.** A boss door with a hard alternative
is a choice, and the choice everybody makes is the one that skips the walking — which
would leave the phase having built an optional errand. It is a gate. The generator
guarantees what that requires: with the door shut every lever is reachable, and the
door genuinely gates the boss room rather than sitting beside a second way in.

**DECAY GROWS A VINE**, which is the animancy page and the only one in the book whose
verb is "make a thing live". Recorded because it was asked, and NOT IMPLEMENTED — vines
are one of the four items this phase did not ship.

The plate/lever pair also settled itself. They are the same gesture — stand on it —
and opposite objects: a plate is MOMENTARY and belongs to the clock (`Timing_And_Hazards`
owns it), a lever is PERMANENT and belongs to the map. One way to work a mechanism is
one thing to learn.

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

### What shipped, and what did not

SHIPPED: levers, the boss door with its sockets, and the camera cut.

- **The lever is a tile you stand on**, with a sprite standing on it that does not
  block — you throw it by walking onto it, so a lever that blocked its own tile would
  be a lever nobody could reach. Its art was generated through `tools/genart.py` at all
  three densities: raised with a dark rune, thrown with the rune lit amber.
- **The boss door reuses the portcullis and the pips** from Timing_And_Hazards, which
  is the whole reason it was cheap. The pips read how many sockets are still dark and
  never where the levers are — a count turns exploring into something you can finish,
  and a location would turn it into an errand somebody set you. They stay up, all lit,
  after it opens: a door that forgot what it cost never cost anything.
- **The cut turns the LOOK and not the eye.** The camera stays exactly where the player
  is standing and only the yaw swings out and back inside a second. Nothing has to be
  restored because nothing was taken away, and `First_Minutes`' rule that the framing
  never moves on its own is intact — this moves because the player threw a lever.

NOT SHIPPED, and none of them are started: **blocks** pushed by gust, **pressure plates
with a different verb per floor**, **secret walls**, and **vines**. The two that the
acceptance list needs are blocks and secret walls; the phase is not finished without
them.

## Acceptance

- A floor with levers cannot be finished without walking rooms the compass never
  points at.
- Nothing found by exploring increases the player's damage, health or hand.
- A block can be pushed onto a plate with gust, and blocks line of sight and fire.
- The camera shows the door open, once, and gives control straight back.
- A secret wall is findable by tapping a wall that looks wrong, and nothing else.

### Checked

**800 floors, eighty seeds of every depth, zero failures** on the invariants that make
this a lock rather than a decoration: the door starts shut, every lever is reachable
WITH IT SHUT, no boss tile is reachable with it shut, everything is reachable with it
open, no two levers share a room, no lever sits on a tile `populate` needs, and the
lever props come out one per lever tile.

One real defect was found and fixed by that audit, and it was the one that matters:
the pass originally tested the lock with the floor's TIMED gates shut, so a route into
the boss room that ran through one looked blocked. Fifteen floors in six hundred could
therefore be finished by pressing a plate and walking past the lock with every socket
still dark. A plate gate is a delay and not a barrier, so the pass now reasons with
every one of them open.

**Coverage is uneven and structural.** Out of eighty seeds: floor 4 locks 72 times,
floor 10 71, floor 8 66, floor 6 45, floor 9 26 — and floors 5 and 7 essentially never,
because a cathedral's apse and a ring's bulges open onto their neighbours too widely for
any single tile to gate them. A floor with no lock is simply a floor without this
mechanic, which is correct behaviour and thin coverage.

**Not checked: any of it in a frame.** The lever sprites were inspected as PNGs and look
right; nothing has been seen standing in a room, no socket pip has been seen on a door,
and the camera cut has never been watched. The same boot-chooser crash that blocked
Timing_And_Hazards' art is still in the way.
