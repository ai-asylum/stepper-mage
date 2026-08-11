# Altar Reward Node

**Player-facing:** yes
**Started:** 2026-07-29 11:05
**Status:** shipped

Turns the altar from a spell dispenser into the run's general reward node: three choices, always including at least one spell.

## Why this phase

The altar currently only offers spells, so once pages are maxed it degenerates into a star faucet. As the run's only reward hub it has to stay interesting for a whole run.

It is also where golden pages live — the single mechanism by which anything permanent enters the starting book — and where the rank-3 sacrifice happens, which is the decision that makes an eight-page book feel tight.

## Settled decisions

- Always at least one spell option per roll. Spells are element pages only.
- ~~Always at least ONE.~~ **Strengthened:** all three cards are usually pages. One
  non-page card is the common exception, two is rare, and the roll is weighted that
  way because an altar that pays in consolations is not a place you cross a floor for.
- Whether ingredients appear as altar offers is **open** — see the design doc.
- Other kinds: heal, ingredient bundle, rank-up, sacrifice, golden page.
- **A page you do not own outranks every rank-up** — an order, not a weight. Rank-ups
  fill what the new pages leave, so they arrive when the book is nearly complete.
- **Stars are a backstop, not an offer.** Reached only when the pages and the extras
  are both exhausted. A star card means the altar had nothing, not that it preferred
  to pay you.
- **Reroll charges are removed from the game.** Both grant paths — this node and the
  mouth blessing — are gone. A charge trades a certain prize for the right to ask
  later, which loses to any card that is a spell.
- The golden page is rolled as a PAGE and takes a page slot, and its element is struck
  out of the ordinary draw — so a page can never sit beside its own gilded twin.
- Rank 1→2 is free. Rank 2→3 costs a rank-2 page, sacrificed.
- A rolled page already at max rank pays 2 stars instead, below every page that has
  something left to give.
- ~~Golden pages are claimed into a `meta.loadout` slot; a full loadout forces a
  displace-choice.~~ **Superseded:** a golden page is granted at the start of the
  NEXT run and that run only — a gift forwarded one run, not an addition to the
  starting book. No slot competition, so no displace step.

## Out of scope

- The star tree. Stars earned here are banked, not spent here.
- Ingredients as an altar reward — that waits for the belt.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

## Acceptance

- No roll is ever spell-free.
- A golden page taken on floor 2 is in the book at the start of the next run, as a
  normal page — and gone the run after that.
- Reaching rank 3 always costs a rank-2 page.
- A used altar is visibly used.
