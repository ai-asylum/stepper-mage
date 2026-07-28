# Turn Economy And Hand Size

**Player-facing:** yes
**Started:** 2026-07-29 00:20
**Status:** in progress

Re-bases the game's core cost. Every component you select costs a turn; releasing the cast is free. Hand size becomes a meta value starting at 1, and the grimoire shrinks to five element pages.

## Why this phase

This is first because it changes the balance of everything downstream. Content built against the old "one cast, one turn" rule would all need retuning later.

It also resolves hand size 1 being a punishment: one page, one turn, free cast is the same tempo as any other action, so the opening state of the game is complete rather than crippled. Fusions stop being free power and become investments — and because turns only cost you while something is acting, assembling out of combat is free, which makes scouting and preparation the reward.

## Settled decisions

- Every component taken costs a turn: tear, harvest, belt draw. The cast is free.
- `meta.handSize` starts at 1. The hardcoded 3 goes away.
- The grimoire holds **elements only** — five pages. Animate, Growth and Multishot
  become belt ingredients.
- **Every cast must contain at least one element.** No ingredient is castable alone.
- Starting at hand size 1 means the shop teaches fusion by selling it; nothing needs
  a tutorial.
- Returning a component is free.
- Being hit mid-assembly never drops the hand — the player already paid in turns.

## Out of scope

- The belt (phase 5) and the tree (phase 4). This phase only makes hand size a value.
- Any new spell content.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

## Acceptance

- A three-page fusion visibly costs three enemy rounds; a one-page cast costs one.
- Assembling with nothing engaged costs nothing.
- A full run is completable at hand size 1 using elements, fixtures and object
  reactions alone.
- A cast made only of ingredients is refused.
- Losing a component is impossible except by casting or returning it.
