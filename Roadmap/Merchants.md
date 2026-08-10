# Merchants

**Player-facing:** yes
**Status:** planned
**Started:** —

Someone in the dungeon who wants something you have.

## Why this phase

Everything the player finds is either used immediately or is stars. There is no
third thing to do with an object, and nothing in the dungeon has an opinion about what
you are carrying.

A merchant makes a spare page worth something other than a sacrifice, gives a reason
to still care about a fixture on floor 9, and puts one thing in the dungeon that is
not trying to kill you — which is a texture the game has none of.

## Settled decisions

- **A merchant is a body in a room**, found by walking, not marked on the map.
- **They buy and they sell**, and what they sell is not power the altar already sells.
- **Nothing is randomly generated about what they want.** A merchant with a legible
  appetite is a merchant you can plan for two floors ahead.

## Open — not decided

- **What the currency is.** Stars are the meta currency and spending them in a run
  makes the tree compete with the shop, which may be the interesting version or may be
  the thing that ruins both.
- **Whether a merchant persists across floors** — met on 3, met again on 7 — which is
  the difference between a vending machine and a character.
- **Whether they can be robbed**, and what the dungeon thinks of that.

## Out of scope

- Dialogue systems of any kind.
- Quests.
- Anything that makes the player stronger for free — Locks_And_Levers settled that
  exploring pays in access.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

**The altar's chooser is the surface.** It is three objects and a caption and it has
been reused three times already — an altar, a blessing, a start depth. A shop is four
objects and a price, which is the same screen with one more field.

**`AltarOffer` already carries a `cost`**, used today by the rank-3 sacrifice alone.
That field is the seam.

**A merchant needs somewhere to stand**, which means `populate.ts` needs a room kind
for them — and `Layout_Generators` decides what a room even is on eight of the ten
floors. Sequence this after that.

## Acceptance

- A merchant can be found by exploring and is not marked before you find them.
- A spare rank-2 page has a use that is not the sacrifice.
- What they offer is legible before you reach them, at least in kind.
- Nothing they sell duplicates what an altar already gives.
