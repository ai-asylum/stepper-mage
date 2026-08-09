# Dungeon Shape

**Player-facing:** yes
**Status:** in progress
**Started:** 2026-08-10

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

- A boss is never stuck against furniture at spawn. — **met.** It takes the tile
  nearest the room centre that has three free neighbours, the same `openTiles` test
  creature placement uses. Observed on floor 1: boss on the centre tile with all four
  neighbours walkable.
- The way down appears at the boss's position when it dies. — **met.** Observed: boss
  moved off-centre, killed, stairs opened on its tile and `grid.stairs` followed.
- The minimap shows no stairs marker before the boss falls, and one after. — **met.**
  `Hud.onMap` reads `Floor.stairsOpen`, which is a fact about the floor rather than
  about whether a mesh happens to be drawn.
- Both descending by walking in and descending by tapping are verified. — **NOT MET,
  and this is the phase's open question.** See below.

## The descent is still unverified, and it may be broken

The task said this path had never been checked. It still has not passed.

Walking onto the open stairs did not descend. All three of the walk-in guard's
conditions were true at the moment of arrival — the player standing on the stairs
tile, the stairs sprite visible, HP above zero — and the floor did not change. Either
`onStepDone` is not running for that arrival, or it is running and the descent is
being dropped somewhere after the guard.

What is NOT yet ruled out is the test itself. The player was positioned with the
debug `place()` and moved with a synthetic `stepper.press`, and a teleport does not
go through `onStepDone` at all. So this is a genuine suspicion rather than a
confirmed defect, and the next session should reproduce it by playing rather than by
poking.

**One real bug was found and fixed on the way there.** A body at zero HP stays
`alive` until its death animation finishes, and `solidAt` counted it as solid for
that whole second — so the player killed the boss, stepped onto the staircase that
had just opened underneath it, and bumped into the corpse. Harmless while the stairs
sat at the room's centre; a direct consequence of moving them to where the boss
falls. Nothing but walking it would have caught this.
