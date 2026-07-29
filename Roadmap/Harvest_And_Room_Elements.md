# Harvest And Room Elements

**Player-facing:** yes
**Started:** 2026-07-29 12:10
**Status:** shipped

Room fixtures become element taps, and objects react to being hit. Adjacent and facing, non-depleting, one hand slot and one turn, always rank 1.

## Why this phase

Animate currently runs dry — a room holds two or three props and then the verb is dead. Harvesting gives every prop a second use and makes room composition tactical rather than decorative: fighting beside the forge means one of your slots is fire, for as long as you stay there.

It is also the only place Stone, Water, Oil and Starlight exist, which is what unlocks the authored Stone fusions without spending a book slot.

## Settled decisions

- Four elements with no book page: Stone, Water, Oil, Starlight.
- ~~Line of sight, not adjacency. It is magic.~~ **Superseded:** adjacent and
  facing, like every other interaction with an object. See `## Reaching` in the
  design doc — line of sight let the player strip a floor from its doorway.
- Non-depleting — the candelabra stays lit. The cost is proximity plus a hand slot plus a turn.
- Always rank 1, never scales with rank.
- Harvested elements are never storable. Animating a fixture removes it as a tap.
- Objects also **react** when hit with the right element — the object is the intended
  target and the payoff is spatial. Oil and fire explodes; water and spark shocks
  everything adjacent.
- Three uses per object, mutually exclusive: harvest it, animate it, or set it off.

## Out of scope

- The Reliquary Jar, which makes a harvest storable. That is a belt ingredient.
- Adding Stone as a book page. It does not exist as a page.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

## Acceptance

- Harvesting a candelabra twice works, and it is still lit.
- Stone plus Fireball resolves as Meteor.
- Water applies soaked without needing Steam Burst.
- Hitting an oil drum with fire damages everything beside it.
- Animating a fixture removes it from the harvest list.
