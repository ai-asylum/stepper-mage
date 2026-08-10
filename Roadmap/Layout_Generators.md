# Layout Generators

**Player-facing:** yes
**Status:** shipped — thirteen of the fourteen; terraces waits for Verticality
**Started:** 2026-08-10

Fourteen ways to build a floor, one per floor, never reused.

## Why this phase

Every floor in the game is the same algorithm: place rectangles, join them with
corridors. Ten floors of that is one floor ten times in different colours, and the
palettes we spent a phase on are decorating a shape the player has already learnt.

A layout is not a look. A ring means you can always go round; a gauntlet means you
cannot. A cathedral means everything sees you the moment you enter; a labyrinth means
nothing does until it is adjacent. That is the difference between fourteen floors and
one floor with fourteen skins — and it is also the design brief for what belongs on
each one, because a ranged creature is lethal in a cathedral and useless in a warren.

## Settled decisions

- **One generator per floor, never reused.** Fourteen, so there is room to cut two and
  still fill ten.
- **The test every generator must pass: it changes how you MOVE.** If the difference
  is only what the walls look like, it is a theme and belongs in `theme.ts`.
- **One interface.** `generate(opts)` becomes a choice of generator, and everything
  downstream — populate, light baking, the minimap — keeps reading a `Grid`.
- **The layout is chosen per floor and fixed.** Not rolled, so a floor is a place
  rather than a shuffle.
- **The fourteen:** rooms-and-corridors (the baseline, floor 1, which teaches the
  grammar), cave, ring, spiral, hub-and-spokes, grid city, cathedral, gauntlet,
  labyrinth, islands, chasm, nested, terraces, warren.

## Settled here — the two that were open

**WHICH FLOOR GETS WHICH**, and it is an argument rather than the order they were
written in. The table lives in `BY_DEPTH` in `layouts.ts`, which is the thing the
roster and hazard phases should read:

| | floor | layout | what it takes away |
|---|---|---|---|
| 1 | The Drowned Library | rooms | nothing — it teaches the grammar |
| 2 | The Ossuary Kitchens | warren | distance |
| 3 | The Verdant Rot | cave | the straight line |
| 4 | The Brass Foundry | grid city | being cornered, either way |
| 5 | The Celestial Vault | cathedral | cover — everything sees you from the door |
| 6 | The Glass Gardens | islands | footing, while leaving sight |
| 7 | The Tidal Vault | ring | the dead end |
| 8 | The Choir of Wounds | gauntlet | the way round |
| 9 | The Ashfall Reach | chasm | half the floor |
| 10 | The Hollow Crown | hub | a route that is not through the middle |

Floors 5 and 6 are the pair the whole grid-vocabulary phase was for: the first takes
sight away by giving you too much of it, the second takes footing away and leaves
sight untouched, which was not sayable before `Tile.Gap`. 7 and 8 are the doc's own
opposites and are kept adjacent on purpose.

**THE BOSS IS BOTH, IN THAT ORDER.** The shared pass puts it at the far end of the
floor, and a layout whose shape names its own end overrides that. Which turned out to
be the smaller half of the fix: the old pass compared room centres with a MANHATTAN
subtraction, which is only ever right when rooms are scattered rectangles. A spiral's
eye is four tiles from the outer lap and forty steps from it; a nest's middle is the
nearest room on the map and the furthest on foot. Measuring what the player actually
walks — the same `flood` the spells and the bodies use — is what lets one pass serve
thirteen shapes. Only spiral, cathedral and nested nominate; a hub's rim says nothing,
because a hub has six equally far ends and choosing between them is a measurement.

## Out of scope

- What is IN a floor — creatures, props, hazards.
- Tile surfaces and what they do to a spell.
- New tile kinds. Islands, chasm and terraces need `Tile.Gap` and height, and those
  come from Grid_Vocabulary.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

**Ten of the fourteen work on the flat grid today.** Rooms, cave, ring, spiral, hub,
grid city, cathedral, gauntlet, labyrinth, nested and warren need nothing new. Islands
and chasm need a gap; terraces needs height. So this phase can start before
Grid_Vocabulary lands and stall on exactly three generators.

**`populate.ts` assumes rooms.** It walks `grid.rooms` and places by room kind, so a
cave or a warren with no rectangles has nowhere to put an altar. Either every
generator declares rooms — even if a "room" is a bulge in a tunnel — or placement
learns to work off open regions.

**`bakeLight` and the minimap are generator-agnostic already** and should stay that
way. If a generator needs its own lighting pass, that is a sign it is a theme.

### What shipped

`grid.ts` no longer generates anything. It is the data and the questions; `layouts.ts`
holds the thirteen carve functions behind one interface; `generate.ts` is the shared
pass. Nothing downstream can tell which layout it is holding, and `populate.ts` was
not touched.

**EVERY GENERATOR DECLARES ROOMS** — the first of the two options above, because it is
far less code than teaching placement about regions, and because a room turned out to
mean something real in every shape: it is a place you can stand and turn around. A
cave's are found by `pockets`, which takes every tile whose whole 3x3 is open, clusters
them and dilates by one; what is left over is tunnel, which is what a corridor has
always been. Two invariants that used to hold by accident of everything being a
rectangle are now enforced, because `populate` puts the altar and the descent on a
room's centre without asking: **a room's centre is a walkable tile of that room**, and
**no tile belongs to two rooms**.

**Four things the shared pass had to learn**, each of which was a property one
generator used to get by construction:

- **`stitch`.** Connectivity was a property of the old generator — rooms were chained
  in placement order — and that does not survive thirteen shapes. A cave's automaton
  leaves lagoons, a crack can cut the only corridor to a room, and islands are
  disconnected on purpose until the causeways go in. It floods from a whole component
  at once, through walls, until it touches another, and carves the path back.
- **`settle`.** Carving is not over when a generator says it is: the chasm cuts its
  crack through a floor that already has rooms, so a room can lose the tile it named
  as its centre. Ten seeds in forty were putting a room's centre — and twice the
  player's own start tile — inside the void.
- **Coverage lighting.** "One or two sconces, three at an altar" lit a quarter of the
  cathedral's nave. A per-area budget fixes the nave and still fails the nested rings,
  which are two tiles wide and forty long. So the stop condition is coverage: hang
  sconces, still never two within three tiles, until the room is lit.
- **The free-standing brazier.** An island has no wall to hang anything on and
  generated in total darkness. `face: -1` is the fallback the type always allowed for.

**ROOM COUNT IS A DIFFICULTY KNOB AND NOBODY HAD NOTICED,** because there had only
ever been one generator. Rooms are the unit `populate` counts in, so a shape that
declares twenty of them has tripled the floor's enemies without saying so — the first
warren was a six-by-six lattice, thirty-six rooms and a hundred and one bodies. Every
layout is held to six or seven now. Two related trims fell out of the same measurement:
the old `rooms` generator asked for more rooms as depth rose ON TOP OF the grid growing
with depth, which compounded into floor 9 having nine rooms and twenty bodies against
floor 10's seven and fourteen — it asks for a flat seven now — and five layouts got a
size cap, because a maze or a cathedral fills its grid where rooms-and-corridors leaves
three quarters of it solid.

**TERRACES IS NOT WRITTEN.** It is the fourteenth and the only one that needs
elevation DRAWN rather than merely stored: `render.ts` puts every tile at y=0, and a
terrace nobody can see is a flat floor with a number on it. It waits for Verticality,
which is the phase that pays that bill. Spiral, labyrinth and nested are written,
playable and unassigned — the bench the phase's own "fourteen, so there is room to cut
two" was for. `GenOpts.layout` forces one, so a generator nobody has a floor for is
still a generator somebody can walk.

## Acceptance

- Ten floors, ten different generators, and no two feel alike to walk.
- Every generator produces a connected floor with a start, an altar, a boss room and
  a way down.
- A player dropped into a floor can tell which layout it is within a few steps.
- No generator needs its own populate, light or minimap path.

### Checked, against generated floors and in the running game

There is no harness, so the audit was driven from the dev server against the real
modules: generate the floor, then assert on it and run `populate` over it.

**1300 floors — a hundred seeds of every one of the thirteen — with zero failures**
on: one connected walkable space; the border intact; an entrance, an altar and a boss
room; every room's centre walkable and its own; every room's tiles walkable and its
own; the start and the descent walkable and both reachable ON FOOT from the start; the
boss room holding a tile with three free neighbours, so it cannot be spawned wedged;
every room carrying at least one light; and `populate` placing an altar, a boss, a
descent and nothing at all inside stone. Generation costs under a millisecond a floor.

The shape of what it produces, per floor, over a hundred seeds each:

| floor | rooms | open tiles | enemies | floor lit |
|---|---|---|---|---|
| 1 rooms | 4-7 | 121-257 | 3-11 | ≥87% |
| 2 warren | 7 | 87-119 | 9-13 | ≥93% |
| 3 cave | 5-6 | 196-355 | 6-11 | ≥63% |
| 4 grid city | 7 | 238 | 9-14 | ≥61% |
| 5 cathedral | 6 | 398 | 7-11 | ≥70% |
| 6 islands | 7 | 211-342 | 10-14 | ≥82% |
| 7 ring | 6 | 283-318 | 7-11 | ≥77% |
| 8 gauntlet | 7 | 264 | 11-14 | ≥90% |
| 9 chasm | 7 | 261-377 | 12-14 | ≥86% |
| 10 hub | 7 | 215-273 | 14 | ≥83% |

**And walked, in the game.** Floor 6 is the one to look at: the minimap is almost
entirely hollow cells with one solid plateau around the wedge, and from the shore you
can see a causeway running out into black and a second island with three creatures
standing on it — visible the whole way and reachable only the long way round. Floor 9
draws the crack as a column of hollow cells beside you and a black band across the
corridor with the floor resuming beyond it. Floor 5's minimap is one solid block of
open floor filling the window; floor 2's is a four-by-four smudge with wall on every
side. Four floors, four maps nobody would confuse.

**Not checked:** whether any of it is FUN, or how the roster should change per shape.
A ranged creature is lethal in a cathedral and useless in a warren, and the briefs are
carried per layout for the roster phases to read — but nothing has played these.
