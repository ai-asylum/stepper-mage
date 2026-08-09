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
- Both descending by walking in and descending by tapping are verified. — **HALF
  MET.** Walking in is verified end to end. Tapping is not. See below.

## Walking in DESCENDS. Tapping is still unverified.

The task said neither path had ever been checked. One of them now has.

**Walk-in: verified.** Boss killed, stairs opened on its tile, player stepped onto
them with a real animated step, floor changed from depth 1 to depth 2 and the new
floor came up with `stairsOpen` correctly false again.

Getting there took two false alarms, both mine, and they are worth recording because
anything driven through the dev server will hit them:

1. **A throttled render loop looks exactly like a dead input.** The Browser pane was
   hidden, so `requestAnimationFrame` was throttled to nothing and `engine.time` sat
   frozen. A step that never animates never completes, so `onStepDone` never fires and
   nothing downstream of it can happen. The fix is to pump the loop by hand —
   `engine.onUpdate(1/60)` in a loop, advancing `engine.time` alongside it.
2. **`descend()` is async.** Pumping the loop synchronously is not enough; the block
   has to yield to real macrotasks between batches or nothing awaited inside can
   settle. Depth changed only once the pump was interleaved with `setTimeout`.

**Tap: still unverified.** Two attempts, both invalid tests rather than evidence. The
first called the debug `tapHud` with an action object when it takes SCREEN
COORDINATES. The second projected the stairs with `worldToUi` and got an off-screen x
for a staircase directly ahead of a correctly-facing player, which is a projection
that cannot be trusted in a pane that is not composited. So there is still no evidence
either way about the tap path, which is exactly what the doc suspected: it was added
with a hit rect pushed outside the candidate loop and only the walk-in path was
tested.

**One real bug was found and fixed on the way there.** A body at zero HP stays
`alive` until its death animation finishes, and `solidAt` counted it as solid for
that whole second — so the player killed the boss, stepped onto the staircase that
had just opened underneath it, and bumped into the corpse. Harmless while the stairs
sat at the room's centre; a direct consequence of moving them to where the boss
falls. Nothing but walking it would have caught this.
