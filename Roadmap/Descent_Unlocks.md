# Descent Unlocks

**Player-facing:** yes
**Started:** 2026-08-10
**Status:** shipped

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

Three things to resolve before building. **All three are resolved** — see below.

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

## Settled during the build

- **The unlock is a SET of boss kills, not a deepest depth.** `meta.bossKills` holds
  the depths whose boss has fallen. The acceptance below decided this on its own: a
  player who starts deep and kills that boss must not thereby unlock floors they have
  never reached, and only a set survives that. `meta.best` stays what it was — a
  number nothing reads.
- **The catch-up rites happen at the MOUTH, through the altar's own chooser.** No new
  screen: `rollAltarOffers` takes a null altar, `chooseOffer` applies a reward whether
  or not there is stone in front of the player, and the three owed rolls come up one
  after another before the blessing. The doc suggested the tree screen; the chooser is
  closer, because the player already knows the gesture.
- **The income slope is fixed rather than balanced against.** A body paid a flat +1 at
  every depth, so the pull toward depth was the completion bonus and almost nothing
  else. `bodyStars` steps every three floors — 1, then 2 from depth 4, 3 from 7, 4 at
  ten — so a deep floor is worth walking into before the bottom is reached. The +25
  completion bonus is untouched; moving it would repriced the whole tree.

## The bug this phase nearly shipped with

Boot used to `await` the start-depth chooser, and `engine.start()` comes hundreds of
lines later. The modal is drawn BY the render loop, so awaiting it during boot
deadlocks: the chooser cannot be seen, so it cannot be answered, so the loop it is
waiting on never starts. Every save with a deep start unlocked came up to a black
screen with no `window.__game` at all.

The mouth sequence runs after `engine.start()` now and is deliberately not awaited by
boot. Worth remembering for anything else that wants to ask the player something
before the first tile.

## Acceptance

- Killing a floor's boss unlocks starting on the floor below it, and nothing else does.
  — **met.** `Combat.onBossKilled` is the only writer.
- The unlock survives a reload. — **met.** Written to disc the moment the boss falls,
  not banked until the run ends: dying on the next floor is not a reason to lose proof
  of the fight you won.
- A start-depth choice appears at run start once anything past floor 1 is unlocked, and
  offers only floors 1, 6 and 11. — **met.** Verified: one depth-5 boss kill produced
  exactly "The Drowned Library / the long road" and "The Glass Gardens / depth 6".
  Eleven is bounded by `THEMES.length`, so it is never offered at ten floors.
- Starting deep grants exactly three catch-up altar draws. — **met.** Verified: three
  rites, counted down in the caption, then the blessing, then the captions restored.
- A deep run banks measurably fewer stars than a full run that reaches the same depth.
  — **met by construction**, and NOT measured: the skipped floors' income is simply
  never earned, and three rites are fewer than the five altars skipped.
- A player who starts deep and kills that boss does not thereby unlock floors they have
  never reached. — **met.** The set records depth 6; floor 7 is not an offer point, and
  floor 11 needs depth 10.
