# Dungeon Shape

**Player-facing:** yes
**Status:** planned
**Started:** —

Where the boss stands, where the way down is, and when the map admits it exists.

## Why this phase

Two placement bugs that both cost the player a fight or a search.

**Bosses spawn wherever the populate pass put them** and sometimes that is behind
furniture, where they wedge and the fight becomes a standoff against geometry rather
than against a creature. A boss is the one body on a floor that must be able to move.

**The way down is somewhere else entirely.** The stairs are generated at their own
spot, hidden until the boss falls, and then the player has to go and find them — after
the fight, with nothing left to do but walk. And the minimap marks them from the moment
the tile is explored, so the map advertises a door that does not yet exist.

Both are the floor lying about its own shape.

## Settled decisions

- **A boss spawns at the centre of its room.** Not at a scattered placement point. It
  is the only body whose room is built around it, and the centre is the one tile
  guaranteed to have room to move.
- **The way down appears where the boss died.** Killing the boss opens the door, in
  the place the player is already standing, so the reward for the fight is not a walk.
- **The map does not mark the stairs until they exist.** `Hud.onMap` treats stairs as
  furniture, and furniture is remembered from exploration — which is right for a chest
  and wrong for a door that has not been opened yet.

## Out of scope

- Room generation, corridor layout or floor size.
- Descending itself, which already works by walking in or tapping.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading.

**The stairs entity already exists from generation and is hidden** (`revealStairs`).
Moving it on boss death is cheaper and safer than spawning one, because every other
system — `entityAt`, the descend reach check, the minimap — already knows about it.

**The tap-to-descend path has never been verified.** It was added with a hit rect
pushed outside the candidate loop and only the walk-in path was tested. This phase
touches the stairs, so it is the phase that should prove both.

## Acceptance

- A boss is never stuck against furniture at spawn.
- The way down appears at the boss's position when it dies.
- The minimap shows no stairs marker before the boss falls, and one after.
- Both descending by walking in and descending by tapping are verified.
