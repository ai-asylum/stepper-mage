# Elemental Spread

**Player-facing:** yes
**Status:** shipped
**Started:** 2026-08-10

Every floor needs more than one answer.

## Why this phase

Enemy_Identity gave creatures weaknesses and resistances, and then wrote them as
flavour per creature instead of as a puzzle per floor. The result measured badly:
**floor 3 is four creatures out of four weak to fire.** Its own comment in the table
says "the fungal deep — wet, alive, and rooted" and then every single thing on it
burns. That floor has no strategy at all; Fireball is the whole answer.

Floors 2 and 4 work, because they mostly RESIST fire and force a switch. Floor 1 is
defensible at two of four, since it is the floor that teaches the mechanic. Floor 3 is
the failure and floor 5 is untested by eye.

A spell system with five elements and one correct answer is a spell system with one
element — which is the exact sentence Enemy_Identity opened with, so this is that
phase's own criterion not actually being met.

## Settled decisions

- **A floor is a puzzle, not a theme.** Affinities are assigned per FLOOR first and
  per creature second: decide what mix a floor demands, then distribute it.
- **No floor is solvable with one element.** The hard rule, and the one worth a test.
- **Every floor spreads across at least three of the five pages.** Enough that a
  hand of one has to change between rooms, not only between floors.
## Settled during the build

- **Floor 1 stays fire-LEANING but not fire-only.** Two of four are weak to fire
  rather than three, and the ink elemental moved to spark — wet ink conducts, and the
  floor is called the Drowned Library. The tutorial floor should reward the page
  everyone starts with most of the time, and still contain one room where it is the
  wrong answer.
- **Two of five bosses resist fire, unchanged.** Enemy_Identity's measurement — that
  three made the opening loadout wrong more often than right — survives this table,
  because nothing about the rebalance changes what the player knows when they walk
  in. The bone floor and the foundry keep it; a skeleton and a furnace earn it.

## Measured

Per floor, how many creatures each PAGE beats, before and after. The rule is that no
floor is solvable with one element and every floor spreads across at least three
pages.

| floor | before | after |
|---|---|---|
| 1 | 2 pages, fire 3/4 | 3 pages, worst column 2/4 |
| 2 | 2 pages, gust 3/4 | 3 pages, worst column 2/4 |
| 3 | 2 pages, **fire 4/4** | 3 pages, worst column 2/4 |
| 4 | 2 pages, frost 3/4 | 3 pages, worst column 2/4 |
| 5 | 3 pages, worst 2/4 | unchanged — it already passed |

Floor 3 was the failure the phase was written about and it was not the only one: four
of the five floors broke the three-page rule, and only floor 5 passed. The doc's own
guess that "floor 5 is untested by eye" was the one floor that needed nothing.

The four rows that moved, and why each is the flavour rather than a spreadsheet fix:
the ink elemental conducts because it is wet; the bone hound goes brittle in cold,
which is a second way to break the same material; the fungal creeper answers frost
because cold stops growth, and the fungal priest conducts because damp flesh does;
the forge wasp answers gust because it is the only thing in the foundry that flies.

## Out of scope

- New elements, new pages, or changes to the three-sources rule.
- The bestiary, which is Guidance_And_Blessings.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading.

**Measure before and after, per floor, not by eye.** The count that matters is: for
each floor, how many of its creatures does each element beat? A floor where one column
dominates is the bug. This wants to be a harness check and not a judgement, because
"is this varied" is exactly the kind of thing that reads as fine while being wrong.

**The gate has been deleted.** This paragraph used to say the `mixed` policy would
need its page choice revisited against the new table. `tools/fullrun.mjs` was removed
on 2026-08-09, so there is no policy and no gate — and no automated answer to whether
the run is still completable. The table below is measured; the BALANCE consequence of
it is not.

**Also finish looking at the readouts.** The cast-time `???`/EFFECTIVE/RESISTED chip,
the discovery banner and the nameplate marks were all built and none of them have been
looked at on a phone viewport. A varied table is worthless if the readout that teaches
it is illegible.

## Acceptance

- No floor can be cleared using a single element against every creature on it.
- Every floor's creatures spread across at least three pages.
- Floor 3 specifically is no longer four-of-four weak to fire.
- The cast readout, the discovery banner and the nameplate marks have been seen and
  are legible at 375px wide. — **NOT DONE.** The affinity system was confirmed live
  at 375px (`affinityOf` reports `resist` for a moth against fire), but the cast-time
  chip could not be staged: `main.ts` recomputes `hud.candidates` every frame from
  `targetsInView`, so a debug-assigned target is overwritten before the book will
  open, and the readout never appears. Needs either a debug seam that survives the
  frame or a real played run.
- A full run stays completable at hand size 1. **No harness backs this any more** —
  `tools/fullrun.mjs` was deleted on 2026-08-09, so this is judged by playing.
