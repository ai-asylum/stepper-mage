# Tile Vocabulary

**Player-facing:** yes
**Status:** planned
**Started:** —

What a tile DOES to a spell, as opposed to what shape the floor is.

## Why this phase

A floor changes what the player should cast only through its creatures. Every tile is
inert: it holds you up or it does not. So the only question a room asks is "what is
weak to what", and once that is answered the room is answered.

A tile that conducts, or hides, or refuses to burn asks a second question the affinity
table cannot answer — and it asks it visibly, which is the part that matters. A rule
the player has to be told is a theme; a rule they can see in the floor is a mechanic.

## Settled decisions

- **Every surface must be legible in the tile itself.** If the player has to be told,
  it does not ship.
- **Iron plating conducts.** Spark chains along the plate to everything standing on
  it, the player included, and the plating is drawn as a shape so the circuit can be
  read before casting.
- **Fog cuts sight to two tiles.** Ranged creatures become lethal and the compass
  becomes more useful than the map.
- **Shallow water: spark chains, fire will not take.** The flooded floor as a TILE, so
  any layout can have a wet quarter and two strategies in one map.
- **Rubble costs two moves, and gust clears it.** A slow tile the player can edit.
- **Portals are a PAIR of tiles, lit the same colour.** Step on one, arrive at the
  other. That is the whole feature.
- **A floor mixes surfaces.** The layout is a floor's identity, not these.

## Open — not decided

- **Whether fog is a tile or a floor-wide setting.** As a tile it can be a region,
  which is better; as a setting it is one line.
- **Whether a volume crosses a portal.** Teaching `Grid.fill` that a portal is an
  extra edge is cheap, and fire erupting from the far mouth would be the best-looking
  thing on the list — it is also a large change to what a volume can reach.

## Out of scope

- Ground substances a CAST leaves behind. Fire, oil and water exist and are
  Burning_Ground's.
- The shape of the floor — Layout_Generators.
- Anything on a clock — Timing_And_Hazards.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

**`Ground` is the wrong home.** It holds what a cast left behind, which ages and
clears. A surface is part of the floor and never expires, so it belongs on the `Grid`
beside `variant` and `roomOf` — a second byte per tile.

**The conduction rule already exists** as `CONDUCTION_ARC` in `combat.ts`. An iron
plate is that arc with a different reach test, and should extend it rather than copy
it.

**Fog fights the light bake.** `bakeLight` is per-tile and static, and so is fog — the
cheap version is a field the fragment shader reads, not a volumetric anything.

## Acceptance

- Each surface is identifiable at a glance, with no legend.
- Spark on iron plating reaches everything on the plate and nothing off it.
- Fire refuses to light on shallow water.
- Two portals visibly pair, and stepping on one arrives at the other.
- One floor can carry three surfaces without reading as noise.
