# Guidance And Blessings

**Player-facing:** yes
**Started:** 2026-08-10
**Status:** in progress

A compass that points at the next thing worth walking to, a blessing chosen at the
dungeon mouth, and the bestiary — the one record the player is never sold back.

## Why this phase

A floor gives no direction at all. The altar is the run's only progression lever and
finding it before the boss is luck: the minimap shows a 9x9 window of what you have
already seen, which answers "is there a wall beside me" and cannot answer "where is
the thing I need". A player who misses the altar loses the floor's only rank-up, and
nothing told them it was there.

The blessing exists because floor 1 currently has no shape to it. Every run opens
identically — same three pages, same rank, same hand — so the first floor is a fixed
sequence rather than a hand you were dealt. One choice at the mouth changes what the
run is about before the first tile.

The bestiary is here because it is the counterpart to the star tree, and the design
takes a position on it: knowledge the player earned is **never sold back to them**.
Two nodes already exist for the blessing (`blessing`, `blessingWider`), recorded and
inert, and this is the phase that makes them real.

## Settled decisions

- **A compass, not a revealed map.** One arrow, pointing at the next thing that
  matters, in this order: an unclaimed altar → the boss while it lives → the stairs
  once it is dead.
- **A run-start blessing:** choose one of three at the dungeon mouth, before floor 1.
- The tree's `blessing` node grants the choice; `blessingWider` widens the roll.
- **The bestiary is free and never sold.** It fills as the player animates props and
  discovers fusions. Selling a record of something the player already found is a
  paywall on their own memory, and it is listed under `## Rejected — do not re-add`.

## Out of scope

- Elemental weaknesses and resistances, and anything the bestiary would say about a
  creature's element — that is Enemy_Identity, and this phase should not pre-empt what
  it decides a creature entry contains.
- New floors, spells or fusions.
- Deed gates and start depth — Descent_Unlocks.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

Three things to resolve before building. **All three are now resolved** — the
decisions are recorded under `## Settled during the build` below.

**The bestiary's animation half is currently unreachable.** It fills as props are
animated, and animation needs an ingredient off a belt that is switched off behind
`BELT_ENABLED`. The fusion half works. Either the entry is authored to fill from
either source independently, or this task waits on the belt — decide, do not ship a
screen with a permanently empty column.

**What the blessings are is not decided.** `docs/DESIGN.md` names the node and calls
the idea good; it does not list a single blessing. They must obey the same non-overlap
rule everything else does — a blessing that grants an element duplicates a page, one
that shapes a cast duplicates an ingredient — so the honest space is probably run-level
rather than cast-level: start deeper in the book, start with a reroll charge, start
with a rank. Propose them, do not invent them silently.

**The compass has to survive not knowing.** The altar may be in an unexplored room, so
either the arrow points at something the player has not seen — which is a revealed map
wearing one arrow — or it only points at what they have found, which makes it useless
for its main job. That tension is the whole design problem of this phase.

## Settled during the build

- **The compass gives BEARING and nothing else.** No distance, no marker, no room
  shape. This is the answer to the tension the section above calls the phase's whole
  design problem: direction is not layout. One angle reveals a single number about the
  floor, and it points at things the player has not found because the altar they have
  already found is the one they do not need pointing at. Distance was considered and
  rejected — bearing plus distance over two steps triangulates the exact tile, which
  is a revealed map wearing one arrow.
- **The three blessings are RUN-LEVEL, on three different axes.** A wider book (a
  fourth page), a spare hand (a reroll charge banked), a deeper page (an owned page at
  rank 2). Breadth, agency, power — so the choice is about how you want to play rather
  than which number is biggest. Run-level because the non-overlap rule leaves nothing
  else honest: a blessing granting an element duplicates a page, one shaping a cast
  duplicates an ingredient.
- **The bestiary ships its FUSION half only.** Entries fill from each source
  independently and only the sections that can fill are shown, so there is no
  permanently empty column and the animation half lights up by itself whenever
  `BELT_ENABLED` comes back. Filling it from prop DESTRUCTION instead was considered
  and rejected: it records something different from what the entry is about, and
  quietly redefines the bestiary rather than waiting for the feature it was designed
  around.

## Acceptance

- The compass points at the unclaimed altar, switches to the boss once the altar is
  claimed, and to the stairs once the boss is dead. — **met.**
- A player who follows it reaches the altar on every floor of a run. — **met in
  principle, not walked.** The bearing is correct (verified: facing south with the
  altar to the east, the arrow reads left), but nobody has yet followed it end to end.
- It never shows the layout of a room the player has not entered. — **met.** Only an
  angle leaves `compassGoal`.
- Three blessings are offered before floor 1 and the chosen one visibly changes the
  run. — **met.**
- Without the `blessing` node, no choice is offered and nothing hints that one was
  missed. — **met.** `offerBlessings` returns early and draws nothing.
- The bestiary records a fusion the moment it is first cast, and costs nothing ever. —
  **NOT DONE.** `Combat.discovered` already records the fusion; what is missing is a
  screen to read it and persistence across runs.
- No screen anywhere offers to sell bestiary knowledge. — **met vacuously**, there
  being no bestiary screen yet.
