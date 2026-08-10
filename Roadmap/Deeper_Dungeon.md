# Deeper Dungeon

**Player-facing:** yes
**Started:** 2026-08-10
**Status:** shipped

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

## What shipped

Ten floors. Sixty-one sprites generated through `tools/genart.py` — including the
per-density rosters, which the base run does NOT derive: `--steps 72,36` is a separate
pass, and forgetting it ships a game that loads `art/s72/...` and 404s on every new
prop.

The five themes reuse the existing five DETAIL vocabularies rather than adding five
more. A vocabulary is a stamping pass plus a table of constants at all four densities;
five new ones is its own phase, and shipping `FloorDetail` values that mapped to
nothing would draw bare masonry. Palette is what separates the floors, and every one
has its own ramps, accent, light colour and fog. Two floors share a pass (6 and 10)
and are told apart by palette alone — the honest cost of not building the art first.

Twenty new bodies got affinities, and the first draft FAILED the rule phase 11 set:
floors 6, 9 and 10 came out at two pages, floor 7 at spark three-of-four. Fixed by
giving each a third answer that is a claim about the creature rather than a filled
column — thermal shock cracks glass, the brine eel is cold-blooded, fine ash carries a
charge, empty regalia stiffens in cold. All ten floors now read three pages with no
column above two of four.

`THEMES.length` moved the vault by itself, being derived. `ROMAN` did not: it stopped
at V and the readout clamps, so every floor from the sixth down announced itself as
DEPTH V — the deepest floor in the game wearing the old midpoint's number.

## Acceptance

- Ten floors are reachable, each visually distinct from the other nine at a glance. —
  **met.** All five build with their own rosters and bosses; verified by entering each.
- No two floors share a palette, a roster or a boss. — **met.** Two share a detail
  vocabulary, which is not a palette; see above.
- All ten page-element triples resolve to an authored fusion with a name and a reason.
  — **met.** Verified by enumerating all ten: none falls through to composition.
- No authored triple is dominated by three turns of the best single page. — **met, and
  it was not before.** Enumerating them found `Cinder Cyclone` at 18x3 = 54 against a
  yardstick of 57 — a three-slot fusion worth less than one turn of the best single
  page across the same three bodies. It had failed quietly since it was written,
  because nothing had ever compared the ten at once. Raised to 20.
- A full run to depth 10 is completable. — **NOT MEASURED, and this is the risk.**
  `enemyHp`, `bossHp`, `enemyDamage`, `bossDamage` and both heal curves are linear in
  depth and were fitted to five floors. At depth 10 they extrapolate to numbers nobody
  has seen, and the harness that would have checked it was deleted on 2026-08-09.
- The vault moment and the completion payout land on floor 10.
- Every new sprite has a row in `art/manifest.json`.
