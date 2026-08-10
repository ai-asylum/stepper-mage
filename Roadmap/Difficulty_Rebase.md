# Difficulty Rebase

**Player-facing:** yes
**Status:** planned
**Started:** —

The game is far too easy, spells scale too fast, and nothing deep resists anything.

## Why this phase

Three pages and everything dies in one cast. The empowerment ladder multiplies faster
than enemy health climbs, so the middle of a run is the last time a fight is a fight —
after that the answer to every room is the same cast, larger.

And the affinity table only ever says which of five pages a creature dislikes. A
depth-9 body and a depth-1 body are the same KIND of problem with different numbers,
so there is nothing a deep floor can ask that a shallow one cannot.

None of this is one number. It is the shape of the curves, and it is the second half
of the same pass as Mana_And_Pacing — doing content before both is tuning twice.

## Settled decisions

- **Spells scale slower.** The empowerment ladder is the offender: rank and hand size
  both multiply the same cast, and they compound.
- **Advanced creatures resist the BASICS.** A deep body should shrug off a single
  element and answer only to a combination — so the third hand slot buys a key rather
  than a bigger hammer.
- **Depth asks a different question, not a bigger one.**

## Open — not decided

- **Whether resistance is per-element or per-CAST-SIZE.** "Immune to single elements"
  is a different rule from "resistant to fire", and it is the one that makes fusions
  necessary rather than efficient.
- **Where the curves should sit**, which cannot be answered without playing — the
  acceptance harness was deleted on 2026-08-09.

## Out of scope

- New creatures — Creature_Behaviour.
- New floors, layouts or hazards.
- The economy itself — Mana_And_Pacing decides what a cast costs before this decides
  what it is worth.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

**`tuning.ts` is the whole surface** and its header is a record of every previous
rebase, including which levers were tried and reverted. Read it before moving a curve;
several obvious fixes are already documented as measured failures.

**`affinity.ts` currently guarantees three pages per floor with no column above two of
four** (`Elemental_Spread`). Whatever replaces it must keep that property or floors go
back to being solvable with one element.

**There is no harness.** Everything here is judged by playing, and the numbers should
be moved in small steps with someone at the controls.

## Acceptance

- A full run at hand size 3 is not won by casting the same fusion in every room.
- A deep creature cannot be reliably killed by a single element.
- No floor becomes solvable by one element as a side effect of the changes.
- The last three floors are harder than the first three in kind, not only in numbers.
