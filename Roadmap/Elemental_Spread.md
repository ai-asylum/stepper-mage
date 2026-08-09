# Elemental Spread

**Player-facing:** yes
**Status:** planned
**Started:** —

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
## Open — not decided

Two questions this phase must answer and must not answer by assumption:

- **Whether floor 1 stays fire-friendly.** The argument for is that fire is the page
  everyone starts with and floor 1 is the tutorial. The argument against is that it is
  still a floor and still needs a strategy. Not settled.
- **How many bosses may resist the starting page.** Enemy_Identity measured that three
  of five made the opening loadout wrong more often than right; that measurement was
  against the old table and does not automatically survive this one.

## Out of scope

- New elements, new pages, or changes to the three-sources rule.
- The bestiary, which is Guidance_And_Blessings.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading.

**Measure before and after, per floor, not by eye.** The count that matters is: for
each floor, how many of its creatures does each element beat? A floor where one column
dominates is the bug. This wants to be a harness check and not a judgement, because
"is this varied" is exactly the kind of thing that reads as fine while being wrong.

**The gate will move.** `mixed` is the line that reads the table, and changing the
table changes what that line should play. Expect the retune, and expect the policy's
page choice to need revisiting alongside it.

**Also finish looking at the readouts.** The cast-time `???`/EFFECTIVE/RESISTED chip,
the discovery banner and the nameplate marks were all built and none of them have been
looked at on a phone viewport. A varied table is worthless if the readout that teaches
it is illegible.

## Acceptance

- No floor can be cleared using a single element against every creature on it.
- Every floor's creatures spread across at least three pages.
- Floor 3 specifically is no longer four-of-four weak to fire.
- The cast readout, the discovery banner and the nameplate marks have been seen and
  are legible at 375px wide.
- A full run stays completable at hand size 1. **No harness backs this any more** —
  `tools/fullrun.mjs` was deleted on 2026-08-09, so this is judged by playing.
