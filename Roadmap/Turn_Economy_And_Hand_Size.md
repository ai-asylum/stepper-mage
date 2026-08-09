# Turn Economy And Hand Size

**Player-facing:** yes
**Started:** 2026-07-29 00:20
**Status:** shipped

Re-bases the game's core cost. Every component you select costs a turn; releasing the cast is free. Hand size becomes a meta value starting at 1, and the grimoire shrinks to five element pages.

## Why this phase

This is first because it changes the balance of everything downstream. Content built against the old "one cast, one turn" rule would all need retuning later.

It also resolves hand size 1 being a punishment: one page, one turn, free cast is the same tempo as any other action, so the opening state of the game is complete rather than crippled. Fusions stop being free power and become investments — and because turns only cost you while something is acting, assembling out of combat is free, which makes scouting and preparation the reward.

## Settled decisions

- Every component taken costs a turn: tear, harvest, belt draw. The cast is free.
- `meta.handSize` starts at 1. The hardcoded 3 goes away.
- The grimoire holds **elements only** — five pages. Animate, Growth and Multishot
  become belt ingredients.
- **Every cast must contain at least one element.** No ingredient is castable alone.
- Starting at hand size 1 means the shop teaches fusion by selling it; nothing needs
  a tutorial.
- Returning a component is free.
- Being hit mid-assembly never drops the hand — the player already paid in turns.

## Out of scope

- The belt (phase 20) and the tree (phase 4). This phase only makes hand size a value.
- Any new spell content.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

## Acceptance

- A three-page fusion visibly costs three enemy rounds; a one-page cast costs one.
- Assembling with nothing engaged costs nothing.
- A full run is completable at hand size 1 using elements, fixtures and object
  reactions alone. **Met on elements alone** — `tools/fullrun.mjs --hand1` clears
  5/5 fixed seeds. Fixtures and object reactions arrive with
  [Harvest_And_Room_Elements](Harvest_And_Room_Elements.md), so the toolkit only
  widens from here. Both single-page spam lines fail (1/5); the line that plays
  the frost-into-fire shatter clears every seed, so the criterion is met by a
  competent player rather than by any input at all.
- A cast made only of ingredients is refused.
- Losing a component is impossible except by casting or returning it.

## Review

### Run 1 — 2026-07-29

#### Accepted findings

- [main.ts doCast] The hand is destroyed before `combat.cast` is awaited and the boolean is discarded, so "false means the hand is untouched" is a promise the only caller does not keep → resolve legality before the merge, or stop promising it.
- [main.ts book.canRip] "Hand full" and "you have not learned this" collapse into one silent refusal, and nothing anywhere tells the player their hand size is 1 → split them and say so.
- [hud.ts assemblyTurns] The readout counts every component taken, so assembling in an empty room advertises a cost never paid — the exact inverse of the phase's headline → count only rounds in which something acted.
- [combat.ts enemyRound] Contains no `await`, so `takeTurn` resolves in one microtask and `busy` / the blocked branch are no-ops. Nothing paces the rounds, so "visibly costs three enemy rounds" has no mechanism behind it.
- [main.ts spendComponentTurn, doCast] A throw skips `refreshTargets` / `checkDeath` and leaves `busy` stuck true, soft-locking all input → `try/finally`.
- [main.ts loadMeta] Save fields are trusted: `slots <= 0` yields an unusable book via `setBookPages`'s fallback, and a non-numeric `handSize` makes `fan.count >= NaN` false, i.e. an unbounded hand → clamp both.
- [main.ts handSizeBonus] Never restored, so one debug `selectPages` raises the real tear ceiling for the session — and `fullrun.mjs` therefore drives the whole run at hand size 3, so the acceptance line has no harness behind it.
- [main.ts keys.KeyR] Omits the `refreshTargets()` the HUD's own clear path performs, leaving `tornIds` and the reticle stale.
- [tools/*.mjs] `selectPages(['animate','fire'])` now silently tears only `fire`, so the named verification harnesses pass while testing nothing. They also still set `g.state.mana`, a currency deliberately removed.
- [tuning.ts, combat.ts] `rng.int(-1,2)` is inclusive, so the jitter averages +0.5 and is not the symmetric range the comment claims; two figures in the same file disagree. `combat.ts`'s "nothing here is a magic number" header is false while the engage radius and SHATTER threshold stay local.
- [hud.ts] The turns readout shares a row with `drawLog`'s first line when the cast pill is wide.

#### Rejected findings

- [spells.ts INGREDIENT_SPELLS] Exported and unused → deliberate forward scaffolding for the belt phase, not dead code.

#### Deferred findings

- [combat.ts] Free-turn attrition: tear, return for free, repeat, farming status ticks from outside the aggro radius at zero risk. Real, but the fix collides with the settled "returning is free" rule → Polish_Pass.

## Design Review (Gate 2)

### Run 1 — 2026-07-29

#### Accepted findings

- **The rank ladder is priced at one turn for what the design prices at three.** `byRank` expands a rank-3 page to three copies, so one turn buys 36 on a single target (45 with burn) against a three-turn Thunderhead's 36. Rank is strictly better than fusing, which inverts the trade this phase exists to create — and it lands before fusion is purchasable.
- **Round-denial is the dominant line at hand size 1.** `frozen`/`shocked`/`stagger` skip a body's whole action, and the player gets exactly one action per round, so a 2-turn freeze refreshes before it expires. Two bodies lock indefinitely; at rank 2+ the volley re-freezes every hostile every cast and incoming damage goes to zero.
- **The valve that would break the lock is arithmetically unreachable.** SHATTER needs `damage >= 10`; Frostbolt is 8 at rank 1 and 9 at rank 3, so the only freezing tool at hand size 1 can never trip it.
- **Enemies close one tile per player action while the player casts every action, and corridor tiles are never "same room".** `targetsInView` reaches 7 but hostiles skip their turn when `!sameRoom && d > 4`, leaving a 3-tile band where everything is targetable and nothing may act. A whole room, and every boss, falls for zero HP from a standoff.
- **The heal budget cannot fund the reported costs.** 40 + 4x13 + ~5x8 = ~132 HP against 185 routed or 288 for a full clear. The routed path dies at the depth-3 boss.
- **Attrition is flat against a cost curve that grows 13x**, and the cap destroys 13 HP on floor 1 — 9.8% of the run's entire healing budget — on the one floor with no use for it.
- **`COMBOS` was not re-based, which is the one thing this phase's ordering rationale demands.** Under N components = N turns, every `count: 1` pair is dead: Steam Burst 13 against two Fireballs' 31.
- **Gust has no `stagger`**, contradicting the design doc, leaving a 4-damage page with no status — one of five pages is dead weight and one of five altar options is a trap.
- **Decay is dominated because the turn economy prices the rounds a DOT needs to pay out**: 12 over 4 rounds against Fireball's 19 over 3.

#### Rejected findings

- **"The economy pays more for engaging less."** Refuted by its own numbers — star sources are monotone in content touched and death banks what is already earned. The real issue is the shape of the pull toward depth, recorded below.

#### Deferred findings

- Every room is furnished with props that had no use once Animate left the book. Partly resolved already — props became legal bolt targets and destructible — but the resting reticle still prefers furniture → Polish_Pass.
- The pull toward depth is a cliff (a hardcoded +25) rather than a slope, against a flat +1 per body → Descent_Unlocks.
- Three of five elemental interactions gate on `soaked`, which has no hand-size-1 source until the water fixture exists → Harvest_And_Room_Elements.
- `meta.stars` has no sink and `meta.best` is written but never read → Star_Tree.
