# Deeper Dungeon

**Player-facing:** yes
**Started:** —
**Status:** planned

Floors 6 to 10, each with its own palette, roster and boss — and the seven element
triples that currently fall through to systematic composition.

## Why this phase

The dungeon ends at five floors, and two systems are already built against a depth
that does not exist. Descent unlocks have nowhere to skip to. The `altarPages` tree
node is bought and inert, because every one of the five pages is already in every
altar roll — there is no deeper pool to draw from until the book is bigger than the
roll.

The triples are the sharper gap. Hand size 3 is the tree's most expensive capability
purchase, and **seven of the ten page-element triples are unauthored**, so they resolve
through the systematic `Giant`/`Volley`/`Greater` composition instead of being a
discovery. Verified against `COMBOS`: `fire+frost+spark` is Thunderhead,
`fire+gust+spark` is Cinder Cyclone, `fire+frost+gust` is Hailfire. Missing:

    fire+frost+rot    fire+rot+spark    fire+gust+rot     frost+gust+spark
    frost+rot+spark   frost+gust+rot    gust+rot+spark

Every one of those contains Decay, which is the tell: the authored table was written
around fire and never came back for the animancy page. A player who buys hand size 3
and builds around Decay gets a procedurally named non-event.

## Settled decisions

- Floors 6 to 10, five new themes, each with its own palette, light colour, detail
  vocabulary, enemy roster, prop set with matching golem forms, and a boss.
- The seven missing page-element triples are authored, priced against the turn rule
  the way the rest of the table now is.
- Sprites are generated through the existing pipeline — `art/manifest.json` is the
  content bible, one row per sprite, and `tools/genart.py` resamples onto a true pixel
  grid.

## Out of scope

- Start-depth choice and deed gates — Descent_Unlocks, which this phase unblocks.
- New elements. Five pages and four fixture elements is the set; a sixth element
  touches the three-sources rule and belongs to its own decision.
- New spell mechanics. These are new combinations of existing elements.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

Four things worth knowing before starting:

**The stat curves were fitted to five floors, not ten.** `enemyHp`, `bossHp`,
`enemyDamage`, `bossDamage`, `roomEnemyChance` and both heal curves in
`src/game/tuning.ts` are linear in depth, measured and tuned against depths 1–5. At
depth 10 they extrapolate to numbers nobody has measured. Re-measure with the harness
rather than trusting the line.

**Content scale.** Each floor is 3 enemies, 4 props, 4 matching golems and a boss — 12
sprites — so five floors is ~60 new frames against the 63 in the whole game today, plus
five procedural themes. That is comparable to building the original game's art.

**`THEMES.length` is the vault.** Reaching the last floor is the win condition and
pays a hardcoded +25 stars. Extending to ten floors makes the existing win a
midpoint, so the completion payout and the "THE VAULT IS YOURS" moment both move.

**Enemy_Identity ships first and changes what a creature is.** It gives every creature
facing frames, an attack pose and an element it resists. Generating floors 6–10 before
that lands would mean generating them to the old spec and regenerating them after, so
the roster work must be specified against the new creature shape.

## Acceptance

- Ten floors are reachable, each visually distinct from the other nine at a glance.
- No two floors share a palette, a roster or a boss.
- All ten page-element triples resolve to an authored fusion with a name and a reason.
- No authored triple is dominated by three turns of the best single page.
- A full run to depth 10 is completable, measured by the harness rather than asserted.
- The vault moment and the completion payout land on floor 10.
- Every new sprite has a row in `art/manifest.json`.
