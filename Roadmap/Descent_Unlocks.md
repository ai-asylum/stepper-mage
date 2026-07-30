# Descent Unlocks

**Player-facing:** yes
**Started:** —
**Status:** planned

Boss kills earn the right to start deeper. Offered every fifth floor, and the deep
start is deliberately the weaker path.

## Why this phase

Re-treading floors you have already cleared becomes a chore as the dungeon grows, and
with ten floors the early ones are a toll you pay to reach the part of the run that is
still teaching you something.

The design's position is that **money buys options and deeds buy permission**. Stars
already buy every capability in the game through the tree; nothing in the tree can buy
depth, because depth is the one thing that should be evidence rather than a purchase.
Killing floor N's boss is proof you can reach floor N+1, so it is the only thing that
unlocks it.

`meta.best` is already written on every death and every clear and **read nowhere** —
it has been dead data since the meta existed. This is the phase that gives it a job.

## Settled decisions

- **Boss kills only.** Nothing else is deed-gated. Killing floor N's boss unlocks
  starting at floor N+1.
- The choice is offered **every fifth floor** — 1 / 6 / 11 — and the player picks from
  what they have unlocked.
- Skipping five floors grants **three** catch-up altar draws. Fewer than you skipped,
  on purpose: the deep start is the weaker path, not a shortcut.
- A deep start **earns fewer stars per run**, because the skipped floors' income is
  skipped with them.

## Out of scope

- Any deed gate that is not a boss kill. The design considered a wider set and cut it:
  "Nothing else is deed-gated."
- New floors — Deeper_Dungeon, which this phase depends on.
- Changing what the tree sells.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

Three things to resolve before building:

**Recording a boss kill is not the same as recording a best depth.** `meta.best` is a
single number and the unlock needs a set — a player who reaches floor 7 and dies has
killed six bosses, but a player who *starts* at floor 6 and kills that boss has killed
one boss at depth 6 and none below it. Decide whether the unlock is "deepest boss
killed" or "which bosses have been killed", and note that the second is the only one
that survives a player starting deep.

**The catch-up draws need somewhere to happen.** Three altar draws with no altar in
front of you is a new moment the game does not have — either the dungeon mouth becomes
a place where offers can be rolled, or the first floor's altar pays three times. The
star tree screen is the closest existing surface.

**The pull toward depth is a cliff, not a slope** — a deferred finding from the turn
economy phase's design review. Star income is a flat +1 per body and `3 + depth` per
boss, against a single hardcoded +25 for completing the run. So depth barely pays until
the very end, and then pays enormously. A phase that makes starting deep *cost* stars
per run is aiming at an incentive curve that is already the wrong shape, and should fix
the slope rather than balance against the cliff.

## Acceptance

- Killing a floor's boss unlocks starting on the floor below it, and nothing else does.
- The unlock survives a reload.
- A start-depth choice appears at run start once anything past floor 1 is unlocked, and
  offers only floors 1, 6 and 11.
- Starting deep grants exactly three catch-up altar draws.
- A deep run banks measurably fewer stars than a full run that reaches the same depth.
- A player who starts deep and kills that boss does not thereby unlock floors they have
  never reached.
