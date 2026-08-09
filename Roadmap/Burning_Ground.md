# Burning Ground

**Player-facing:** yes
**Status:** planned
**Started:** —

Fire stays on the floor after the cast, as terrain you have to deal with — and Gust is
how you deal with it.

## Why this phase

Fire is the most generally useful element in the game and nothing about casting it
costs anything. Spell_Reach gives it a downside at the instant it goes off, by letting
a volume reach the caster; this gives it one that lasts.

It also gives Gust a job. Gust currently staggers, which is real but thin, and it is
the answer to the bone floor because bone is weak to impact. Making it the thing that
puts fire out turns two elements into a loop instead of two entries in a table: fire
makes the ground dangerous, gust makes it safe again, and both are volumes so both
behave the same way about corners.

## Settled decisions

- **Fire occupies ground tiles after the cast**, as an obstacle rather than as a
  status on a creature.
- **Gust puts it out**, and should be able to clear it in one cast — "one shot maybe"
  was the shape asked for, so a gust that clears what it touches rather than reducing
  it.
- **Gust is a volume too**, or it cannot reach round a corner to a fire that got there
  by wrapping.

## Open — not decided

Everything about the numbers, and they are the whole feature:

- **How long fire lasts** if nobody puts it out.
- **What standing in it costs** a creature, and the player.
- **Whether it spreads** on its own, and whether OIL — which already exists as an
  element and already has a fire reaction — is what makes it spread.
- **Whether enemies avoid it.** A hazard that only the player respects is a hazard
  that only punishes the player.
- **Whether other elements leave ground state.** Frost is the obvious candidate and
  the obvious way for this to become five systems instead of one.

## Out of scope

- How far a spell reaches when it is cast, which is Spell_Reach. This phase starts
  where that one stops.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading.

**This is a new kind of thing in the game.** Everything that persists today lives on a
creature as a status; nothing lives on the floor. That means a grid-sized layer, a tick
that ages it, a way to draw it, and a rule for what walking into it does — and each of
those is somewhere a bug can hide that no existing test would catch.

**Draw it before tuning it.** A hazard the player cannot see is worse than no hazard,
and the world is drawn at 72 texels in a dark brown palette where an orange floor tile
has to compete with an orange floor.

**It interacts with everything already on the floor.** Oil, water, props that react,
golems that walk, and enemy pathing which currently has no concept of a tile it should
not enter.

## Acceptance

- Fire left on the ground is visible, and obviously dangerous.
- Standing in it costs something, for the player and for creatures alike.
- One Gust clears the fire it reaches.
- Enemy pathing accounts for it, or it is a decision on record that it does not.
- `fullrun --hand1` clears 5/5.
