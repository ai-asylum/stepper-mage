# Locks And Levers

**Player-facing:** yes
**Status:** part shipped — levers, the boss door, the cut and the blocks. Three open.
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

**Gust already shoves** (`Combat.shove`), and it stops at anything solid. This section
used to guess that a block would therefore be "a prop that does not die and does not
animate", reusing `Entity`, and that guess was wrong: a block has to break line of
sight, and every question about sight, footing and fire is asked of the GRID. It is a
tile, it has its own shove (`Combat.pushBlock`), and it shares nothing with the one on
`Entity` but the word.

**A secret wall is a tile that draws wrong and answers `clearLine` as a wall.** The
temptation is to make finding it clever; the decision above is that it is not.

### What shipped, and what did not

SHIPPED: levers, the boss door with its sockets, the camera cut, and the blocks.

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
- **STEPPING ON A PLATE CUTS TO ITS DOOR.** A plate is an actuator and every actuation
  is watched; a lever is not a special case, it was only the first one built. This was
  asked for, was written into the step path in `main.ts`, and then never fired once,
  because the block asked which tile the player was on before anything had told it they
  had moved — so the stale answer always agreed with the door and the change was made a
  moment later by the clock, silently, with the camera pointing somewhere else. Both
  directions: the gate falling when you step OFF is the half that teaches the rule.
- **A PLATE IS DRAWN.** It shipped as `Surface.Plate` with no case in any draw path, so
  the one tile in the dungeon that opens a door was bare flagstone for two phases. A
  mechanism the player cannot see is not a mechanism they can be out of sync with — it
  is a door that moves for no reason, and every theory they form about it will be wrong.
  A recessed slab with a gutter round it and a pressed boss in the middle, at the same
  bar as every other surface: identifiable at a glance, with no legend.

- **A BLOCK IS A TILE**, and that is the whole of why it was cheap. `Tile.Block`
  answers `walkable` like a wall and `seeThrough` like a wall, so it is a puzzle piece,
  cover that breaks line of sight, and a firebreak from two lines — `clearLine` reads
  the grid, `fill` walks the grid, `flood` walks the grid, and not one of them needed a
  word about blocks. As an entity it would have been three special cases in three
  files that have to keep agreeing.
- **The renderer had to learn a third question.** It decided where to build wall faces
  by asking `seeThrough`, which was the same question as "is this masonry" for exactly
  as long as a wall was the only opaque thing on a floor. A block is opaque and is not
  the building, so a face built against one would have been welded into a mesh that is
  built once — the stone slides east and leaves a four-sided shell behind it. `masonry`
  is now the question the renderer and the light bake ask, and the baked light
  deliberately passes straight through a block for the same reason: an honest shadow
  under a thing that moves is a dark patch of floor that outlives it.
- **NOTHING CAN BE SEALED OFF.** A sokoban deadlock is a genre when the level was
  designed for it and a bug when it was not. Both halves of the rule check it rather
  than reason about it: the generator writes a candidate in, floods, and takes it back
  out if one reachable tile stopped being reachable, and the push asks the same
  question of the player's own tile before every single tile of travel.
- **SQUARE-ON OR NOTHING.** A body takes a diagonal shove because a body stands on a
  tile; a block IS the tile, and half a tile of stone is not a position. Standing at a
  corner gets a refusal in words instead of a lurch nobody could have predicted.
- **The generator lines one up with every gate's plate**, two or three tiles out, with
  a clear level run between them and somewhere to stand and blow. That is the point of
  the object: a plate holds its gate up only while something is on it, so the thing
  that opens it cannot be the thing that goes through it. Without a block, a lone
  player never passes a timed gate at all — which is why `placeGate` has to keep
  everything behind one optional, and why the block is what makes that space worth
  putting anything in.

NOT SHIPPED, and none of them are started: **pressure plates with a different verb per
floor**, **secret walls**, and **vines**. Secret walls is the one the acceptance list
still needs; the phase is not finished without it.

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

**The blocks were played, on depth 6.** A block was aimed at, gusted one tile, gusted
again onto its gate's plate, and the gate went up: `doorLift` 0 to 1, and the cut fired
with the door's own index. Sight and fire were asked afterwards and both stop at it — a
ray north returns the two tiles in front of the stone and nothing past it, and a
nine-tile fill pours around it and never onto its tile. It was looked at in the frame:
a banded, chamfered cube standing a head above the eye with floor showing all the way
round its base, which reads as something somebody left there rather than as part of the
room.

**Not checked in a frame: the levers.** The sprites were inspected as PNGs and look
right; nothing has been seen standing in a room and no socket pip has been seen on a
door. The boot-chooser crash that blocked this and `Timing_And_Hazards`' art is gone —
it was `ClockView.dispose` leaving its live count behind after emptying the pool — so
this is now only a matter of walking to one.
