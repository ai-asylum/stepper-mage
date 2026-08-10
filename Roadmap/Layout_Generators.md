# Layout Generators

**Player-facing:** yes
**Status:** planned
**Started:** —

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

## Open — not decided

- **Which generator each floor gets.** The roster and the hazards should follow from
  it, so this decision is upstream of two other phases and should not be made by
  whichever generator was written first.
- **Whether the boss room is a generator's problem or a shared pass.** Every layout
  needs somewhere to put it, and a spiral's centre is not a hub's rim.

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

## Acceptance

- Ten floors, ten different generators, and no two feel alike to walk.
- Every generator produces a connected floor with a start, an altar, a boss room and
  a way down.
- A player dropped into a floor can tell which layout it is within a few steps.
- No generator needs its own populate, light or minimap path.
