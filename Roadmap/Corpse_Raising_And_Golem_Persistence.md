# Corpse Raising And Golem Persistence

**Player-facing:** yes
**Started:** —
**Status:** planned

Enemy corpses become animatable, and a surviving golem comes with you down the stairs.

## Why this phase

Animate runs dry in a room of two or three props. Corpses are a renewable supply
that combat itself creates, so killing and animating start feeding each other.

Golem persistence is grouped here because it is the same subject from the other end:
it is the unlock that changes how a whole floor is played rather than a single cast,
turning golems from disposable into something you route around and protect.

## Settled decisions

- The node unlocks the capability; **Coffin Moss** is its consumable form and the
  per-use limiter — the same relationship the belt has with its ingredients.
- Corpse animation and object animation are separate ingredients.
- A carried golem keeps its rank and infusion at the second tier.

See [docs/DESIGN.md](../docs/DESIGN.md) for the rest.

## Out of scope

Anything not in this phase's task list.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

## Acceptance

Every task in this phase's list is demonstrably working in the running game.
