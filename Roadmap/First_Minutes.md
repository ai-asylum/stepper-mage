# First Minutes

**Player-facing:** yes
**Status:** planned
**Started:** —

What the game does before the player knows anything, and one setting that should never
have been a setting.

## Why this phase

The opening is the only part of the game every player sees, and it currently spends it
on things that confuse rather than teach.

The book flies in and leafs itself, and the empty hand slots sit behind it saying to
drag a page out of a book that is mid-animation. The camera pitches the first time the
grimoire rises, so the game the player learned to look at in the first ten seconds is
not the game they are looking at in the eleventh. And nothing anywhere says how to
move.

Separately: the texel-density chip is a developer tool that shipped. It sits on the HUD
of a first-person dungeon game offering four art directions, three of which are worse
than the default and one of which draws creatures at a different density from the
stone. It was the right thing to build and it is the wrong thing to ship.

## Settled decisions

- **72 texels, locked.** The default already; this removes the other three and the
  chip with them. It is the one step where nothing is out of register — creatures come
  from the 72 roster, so stone and sprites share a density.
- **The camera never changes pitch.** Whatever it is at the dungeon mouth is what it
  is for the rest of the run. A camera that moves when a UI element appears makes the
  UI feel like it is pushing the world around.
- **The empty slots do not exist during the book's intro.** They are an instruction,
  and an instruction to drag a page out of a book that is still flying in is an
  instruction that cannot be followed.
- **A movement hint, until the player moves once.** It goes away on the first step and
  never returns — a hint that persists is a hint that failed.

## Out of scope

- The rest of the HUD, and the tutorial the game does not have.
- The art at other densities, which stays in the repo and stays generated. This
  removes the CHOICE, not the rosters.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading.

**Locking the step is a deletion, and it should delete.** `availableSteps`, the chip,
its hit target, the persisted `meta.pixelStep`, the debug surface's `setPixels` and
`cyclePixels`, and the harness checks that drive them. Leaving a dead setting behind a
constant is how a setting comes back.

**Check what the playable bundle embeds afterwards.** It currently ships every roster
so the chip cannot 404; with no chip it only needs 72, which is a large saving on a
5 MB budget.

**The pitch change is `Engine.frameAbove`** — a lens shift driven by the book's
measured top edge. Removing it means picking one framing and keeping it, which is a
judgement about how much floor is visible, so it wants looking at rather than
reasoning about.

## Acceptance

- The game runs at 72 texels and there is no way to change it.
- The camera framing at the dungeon mouth is the framing during a fight.
- No empty slots or instructions are on screen during the opening animation.
- A first-time player is told how to move, once.
- The playable bundle is smaller than it was.
