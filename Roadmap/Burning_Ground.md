# Burning Ground

**Player-facing:** yes
**Status:** shipped
**Started:** 2026-08-09

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

## Settled during the build

Every number the "Open" list left undecided, and what decided it.

- **Fire lasts 8 rounds** (`FIRE_TURNS`), and the edges of a patch are fuelled less
  than the middle, so it burns out from the outside in and gutters through three
  drawn heights. Three rounds was tried first and read as a flicker: at one action
  per round the player spends three rounds just getting somewhere.
- **Standing in it costs 2, 4 or 6 a round** (`GROUND_FIRE_DOT` × flame height), for
  creatures and the player alike. Scaled by height rather than flat so the drawing
  prices itself — the edge of an old burn is a scratch, the middle of a fresh one is
  most of a hit, and the player can read which before committing a step.
- **It does NOT spread on its own.** Oil is what makes it spread, and it does that by
  being poured rather than by fire creeping: a broken oil barrel is nine tiles of
  fuel, and fire meeting oil relights the tile from full.
- **Enemies avoid it**, weighted rather than absolutely (`FIRE_DETOUR` = 3 extra
  steps). A hazard only the player respects is a hazard that only punishes the
  player, and avoidance is what turns a volume into area denial instead of
  damage-over-time. Finite on purpose: fire that was impassable would let the player
  seal a corridor and shoot from behind it, which is the exploit `ENGAGE_RADIUS` was
  raised to close.
- **Other elements DO leave ground state**, but only the two that pour: oil and
  water. Frost was left alone. `Ground` holds one substance per tile and `react` is
  the whole vocabulary — oil + fire goes up, water + fire is steam and leaves the
  tile bare, anything else is overwritten by the newcomer.

## Added beyond the original scope

Both asked for during the build, both load-bearing enough to write down.

- **Ground fire is a COMPONENT.** Cast into a burning tile and the fire joins the
  spell as fire slots, one per flame height, consumed on use. This is the harvest
  rule extended to the floor, and it can change what a cast IS — Frostbolt into a
  fire is Steam Burst without ever holding fire. Its contribution to VOLUME is capped
  to what the hand alone would produce, because uncapped it is a loop with gain above
  one: bigger cast, more tiles lit, more to pick up.
- **Containers spill when destroyed.** A barrel of something empties nine tiles from
  where it stood (`SPILL_VOLUME`), which turns an object from a one-shot trigger into
  terrain you positioned. Puddles last 14 rounds against fire's 8 — a trap that
  evaporates before you can spring it is not a trap.

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

- Fire left on the ground is visible, and obviously dangerous. — **met.** Ground
  embers make the area countable; a standing billboarded card makes it read as fire.
- Standing in it costs something, for the player and for creatures alike. — **met.**
- One Gust clears the fire it reaches. — **met in code, unproven in play.** Nothing
  has yet walked into a fire and gusted it out.
- Enemy pathing accounts for it. — **met**, as a weighted detour.
- Balance is UNMEASURED. The acceptance harness was deleted during this phase, so the
  numbers above are reasoned rather than played. `FIRE_TURNS`, `GROUND_FIRE_DOT`,
  `FIRE_DETOUR`, `SPILL_TURNS` and the fuel cap all move combat and all want an eye
  on them.
