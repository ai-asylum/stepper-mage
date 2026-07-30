# Ingredient Belt

**Player-facing:** yes
**Started:** 2026-07-29 15:20
**Status:** shipped — currently **flagged off**

> **Flagged off as of 2026-07-30.** The phase shipped and stays shipped; nothing below
> has been rewritten and nothing in `_todo.md` has been un-ticked. The strip's UX and UI
> are being reconsidered, and the feature is parked until the spell book work lands.
>
> The switch is `BELT_ENABLED` in [`src/flags.ts`](../src/flags.ts). Flipping that one
> boolean to `true` is the whole job — the code, the art, the card faces, the tree nodes
> and the drop tables are all intact. With it `false`: the strip does not draw at all
> (not even the locked strap) and the `BELT_BAND` layout reservation relaxes to 0, no
> chest, boss or altar pays an ingredient, nothing can be drawn into the hand,
> `derivedBeltSlots` is 0, and `belt3`/`belt6` plus corpse rites and the three golem
> nodes cannot be bought and say why on the card. Anything already owned stays owned and
> stays refundable — the gate is on the purchase, never on the save.
>
> **Consequence, accepted:** object animation is a belt ingredient, so golems are
> unreachable again while this is off. The animate paths are intact and simply never
> reached; what went away is everything that ADVERTISED an animation to the player.
> Belt assertions in `tools/playtest.mjs` and `tools/booktest.mjs` are gated on the flag
> so they skip cleanly and re-arm when it is flipped back.

A strip of pouch slots under the grimoire holding the five consumable ingredients.

## Why this phase

The belt is a second way to cast that shares the fusion hand but nothing else. Its items exist to break a rule of the system for one cast — never to supply an element or a status, because pages and fixtures already do that. That constraint is the only thing keeping ingredients from becoming consumable reskins of the spellbook.

It renders even while locked so the capability advertises itself before it is owned.

## Settled decisions

- Separate object from the book: the book is flip-and-tear, the belt is a single tap.
- Three visual states: locked strap, owned-and-empty loops, filled with count badges.
- An ingredient never supplies an element or a status; it only shapes.
- No ingredient is castable alone — every cast needs an element beside it.
- The five: object animation, Coffin Moss, Growth, Multishot, TimeSand.
- TimeSand is free to take, and zeroes the turn cost of the next two components.
- Object animation and corpse animation are separate ingredients.
- Drops are generous. They cost a hand slot and are consumed, so scarcity means hoarding.
- Consumed only on cast; taking one out stays returnable.

## Out of scope

- Ingredients that supply elements. Those belong to pages and fixtures.
- Ingredients surviving a run.
- Anything that is not a spell component: inventory management, golem behaviour.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

## Acceptance

- The belt is visible and obviously empty before purchase.
- Picking one up while locked explains why it cannot be kept.
- A returned ingredient is not consumed.
- No ingredient duplicates a page's element or status.
- An ingredient with no element selected cannot be cast.
- TimeSand plus two components costs zero turns.
