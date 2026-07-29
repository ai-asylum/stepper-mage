# Ingredient Belt

**Player-facing:** yes
**Started:** 2026-07-29 15:20
**Status:** shipped

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
