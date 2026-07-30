# Polish Pass

**Player-facing:** yes
**Started:** —
**Status:** planned

The collected defects — the things that read as bugs rather than as difficulty, plus
the deferred findings from earlier phases' reviews.

## Why this phase

Every item here undercuts work that is already done. A target marker floating in a dark
doorway makes the targeting system look broken rather than deep. A golem standing still
makes the game's core verb look unfinished. A floor whose palette does not read makes
five hand-authored themes look like one.

They are collected rather than fixed in place because each one is small, none of them
belong to the phase whose work they undercut, and fixing them together means one
verification pass instead of six.

## Settled decisions

- **Target markers must not draw through walls.** Currently a down-triangle appears
  over anything the forward ray reaches, including entities in a room the player cannot
  see into.
- **Golems must follow rather than stall.** They path with BFS, and greedy stepping was
  already replaced once; whatever remains is a second bug, not the same one.
- **Each floor must read as its own palette.** Five themes exist with distinct ramps,
  accent and light colours, and the result still reads monochrome orange — so the cause
  is downstream of the theme data, most likely the ACES tonemap and exposure in the post
  pass compressing every hue toward the same warm.
- **A chest is animatable**, with its own golem form.
- **The HUD text layer must stop overdrawing itself.** Log lines, world captions, name
  plates and the fan's cards all draw into the same band and through each other. Three
  separate reviews have now flagged it independently, and it gets worse every time that
  band gains an element.
- **No tree node may sell capacity that nothing can fill.** Two currently do.

## Out of scope

- New content of any kind.
- Anything with a phase of its own. If a defect belongs to a system still being built,
  it belongs to that phase.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

Deferred findings that land here, with their reasoning:

**Free-turn attrition** — from the turn economy phase's code review. Taking a component
charged a turn and returning one was free, so tearing and returning in a loop farmed
status ticks from outside the aggro radius at no risk. **Casting_And_Movement moves the
turn onto the cast, which probably dissolves this entirely** — re-check it before
building anything, because the fix may already be free.

**The resting reticle prefers furniture** — from the same review. Candidates sort
nearest-first, props hug walls and enemies hold the open middle, so entering a room
often selects a bookshelf. It self-corrects on the first tear, but the idle state points
at scenery.

**Two tree nodes sell nothing.** `belt6` buys a sixth loop, but a belt slot holds one
ingredient *kind* and there are five, so the sixth can never be filled. `slots4` buys a
fourth loadout binding, and since golden pages became a one-run gift nothing writes
`meta.loadout` any more, so nothing can fill it either. Both are 60–140 stars for
nothing. Either give them something to hold or take them off the tree; do not leave them
sellable.

**Two tasks here need the belt, which is switched off.** The chest golem needs an
animation ingredient, and golems-stalling needs a golem to observe. Both wait on
`BELT_ENABLED`, or on the belt's UX rethink landing.

## Acceptance

- No target marker is visible for an entity the player cannot see.
- A golem given a reachable player follows it across a floor without stalling.
- Screenshots of all five floors side by side read as five palettes.
- A chest can be animated and its golem fights for the player.
- No two HUD text elements overdraw each other in the band above the grimoire, at
  390x844 and at 295px wide.
- Every purchasable tree node has an effect the player can use the moment they buy it.
- The free-turn attrition loop either cannot be performed or costs what it should.
