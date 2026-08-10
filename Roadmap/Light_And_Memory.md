# Light And Memory

**Player-facing:** yes
**Status:** planned
**Started:** —

Light you have to make and can lose, and a map that remembers how well you saw a
place.

## Why this phase

The torch is a constant. It reaches the same distance in every room of every floor,
so light is scenery rather than a resource, and the dark is never a problem to solve.

And the minimap is binary — a tile is explored or it is not. It records THAT you were
somewhere, never what you could see when you were there. A room crossed in the dark
and a room stood in under a lit brazier are the same square on the map, which throws
away the most interesting thing the player did.

## Settled decisions

- **Spells light objects.** Fire lights a sconce, a brazier, a lantern. That is how a
  room stops being dark.
- **Lit things can be destroyed**, so light is something you can lose.
- **The minimap brightens per tile to the light level you SAW it at.** Not a binary
  explored flag.
- **And it never dims.** If the light goes out, the map keeps what you knew — the
  record is a memory, not a live feed. A room crossed by a guttering torch stays half
  remembered forever, which is the whole feature.

## Open — not decided

- **Whether unlit rooms are truly dark**, or merely dim. Truly dark makes the torch a
  countdown; dim makes it a nuisance.
- **Whether fog belongs here or in Tile_Vocabulary.** As a surface it can be a region,
  which is better; as a floor-wide setting it is one line.

## Out of scope

- The fog surface itself, if it lands as a tile.
- Creatures that put out lights — Creature_Behaviour.
- What the compass does, which is settled and stays bearing-only.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

**`bakeLight` is per-tile and static**, which is exactly the shape this needs: a lit
sconce raises the bake around it and putting it out lowers it. The player's torch is
added per-fragment on top and should stay that way.

**`grid.explored` is a `Uint8Array` of 0 or 1.** This phase makes it a LEVEL — the
brightest value the tile has ever been seen at — so the change is one array's meaning
and the minimap's fill, not a new system.

**Never dimming is the load-bearing rule.** The moment the map can lose information it
becomes a live sensor, and a live sensor through a wall is the wallhack `Hud.onMap`
was written to prevent.

## Acceptance

- A dark room can be lit by casting fire at something in it.
- Destroying the thing you lit takes the light back.
- The minimap shows a tile at the brightness it was seen, not as a flag.
- Losing a light never removes anything already drawn on the map.
