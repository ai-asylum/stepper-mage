# Star Tree

**Player-facing:** yes
**Started:** —
**Status:** planned

The pre-dungeon spend screen: a skill tree with prerequisite edges, fully refundable.

## Why this phase

Stars currently accumulate with nothing to spend them on, so the whole meta loop dead-ends.

A tree rather than a shop list because some purchases genuinely depend on others — the belt is inert below hand size 2, since every ingredient is a modifier and needs something to modify. A tree expresses that as an edge instead of relying on the player buying in the right order. Refundable because with prerequisites in place, experimentation should be free.

## Settled decisions

- Skill tree with prerequisites, fully refundable.
- Every node changes behaviour, not a number. No +damage, no +HP.
- Belt nodes require hand size 2.
- Nodes: hand size 2 and 3, belt 3 and 6, corpse raising, altar pool pages, loadout slots, blessing options.

## Out of scope

- Deed-gated unlocks. Boss kills gate start depth only, and that is phase 9.
- The bestiary, which is free and never sold.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

## Acceptance

- Stars spend, refund, and survive a reload.
- The belt cannot be bought before hand size 2.
- Dying routes into the tree rather than reloading the page.
- No node grants a flat stat increase.
