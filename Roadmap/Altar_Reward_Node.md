# Altar Reward Node

**Player-facing:** yes
**Started:** —
**Status:** planned

Turns the altar from a spell dispenser into the run's general reward node: three choices, always including at least one spell.

## Why this phase

The altar currently only offers spells, so once pages are maxed it degenerates into a star faucet. As the run's only reward hub it has to stay interesting for a whole run.

It is also where golden pages live — the single mechanism by which anything permanent enters the starting book — and where the rank-3 sacrifice happens, which is the decision that makes an eight-page book feel tight.

## Settled decisions

- Always at least one spell option per roll. Spells are element pages only.
- Whether ingredients appear as altar offers is **open** — see the design doc.
- Other kinds: heal, stars, rank-up, sacrifice, reroll charge, golden page.
- Rank 1→2 is free. Rank 2→3 costs a rank-2 page, sacrificed.
- A rolled page already at max rank pays 2 stars instead.
- Golden pages are claimed into a `meta.loadout` slot; a full loadout forces a displace-choice.

## Out of scope

- The star tree. Stars earned here are banked, not spent here.
- Ingredients as an altar reward — that waits for the belt.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

## Acceptance

- No roll is ever spell-free.
- A golden page taken on floor 2 is in the book at the start of the next run, as a normal page.
- Reaching rank 3 always costs a rank-2 page.
- A used altar is visibly used.
