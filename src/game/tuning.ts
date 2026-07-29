/**
 * Combat tuning — every number that encodes the TURN ECONOMY, in one place
 * because the next phase that changes the tempo has to find them all.
 *
 * The tempo these are sized for: a hand of ONE. You tear one page (the room gets
 * a round), you release the cast for free. So the loop is one enemy round per
 * cast, and a room costs one round per cast it takes to empty it — where the old
 * numbers assumed a hand of three pages fused into a single turn. Against the old
 * stats a room that used to be two fusions was five to eight single casts, so the
 * rounds spent standing in it roughly tripled. Everything below is derived from
 * "how many rounds does a room last, and how many hits land in that time".
 *
 * The two invariants worth preserving when these move:
 *  - A cast is the unit of enemy HP. `enemyHp` is written as a number of
 *    Fireballs, not as a curve that looked nice.
 *  - The player bar is measured in HITS, not in HP. Enemy damage is set so a
 *    room lands a survivable fraction of the bar, because at hand size 1 the
 *    player cannot shorten a fight by spending more per turn.
 */

/**
 * The bar has to absorb a whole fight at one cast per round rather than one
 * fusion per room, so it is a good deal deeper than it was — roughly eleven
 * depth-1 hits, falling to about seven by depth 5 (see `DAMAGE_JITTER`: the
 * average hit is half a point above `enemyDamage`, so the hit count is derived
 * from 3.5 and 5.5, not from 3 and 5).
 */
export const PLAYER_MAX_HP = 40;

/**
 * Enemy HP, sized in CASTS. A rank-1 Fireball is 10 and lights a 3-per-turn burn,
 * so one cast plus its first tick is 13 and two casts plus a tick is 23: a depth-1
 * body dies to a single cast, depth 2 to a cast and its burn, and depths 3-5 to
 * two. Two is the ceiling on purpose — every extra cast per body multiplies
 * straight into rounds-in-the-room, and at hand size 1 a round in the room is a
 * round of standing there being hit.
 */
export const enemyHp = (depth: number): number => 7 + depth * 3;

/**
 * Boss HP, sized so the fight is 8-12 casts unranked and 4-7 with a rank-3 page
 * (measured).
 *
 * A rank-3 page used to end a boss in 3-4 because its extra projectiles wrapped
 * back onto the only body in the room; they no longer do (see `spells.ts` — a
 * volley spreads and never doubles up), so rank buys a boss fight a damage
 * multiplier and nothing else. That is the ladder paying out at the rate the turn
 * economy prices it at, and this curve is sized against the new rate.
 *
 * The curve is deliberately flatter than the old one. A boss stands at the far
 * end of a big room and has to walk to you, so the first half of the fight is a
 * shooting gallery and only the back half costs anything; past about ten casts the
 * extra health lands entirely in the shooting-gallery half and reads as a grind
 * rather than as a fight.
 */
export const bossHp = (depth: number): number => 62 + depth * 12;

/**
 * Damage per attack, before the jitter in `Combat.enemyRound`.
 *
 * Set from hits-to-die rather than from a damage curve: clearing a room lands
 * about one hit at depth 1 and about two and a half by depth 5, so a flat-ish
 * per-hit number already produces a steep per-room curve (6% of the bar at depth
 * 1 rising to 33% at depth 5, measured). Making the per-hit number climb as fast as
 * the round count does makes the last two floors arithmetically unwinnable.
 */
export const enemyDamage = (depth: number): number => 2 + Math.ceil(depth / 2);

/** A boss hits for a bit under two mooks, and never for a third of the bar. */
export const bossDamage = (depth: number): number => 4 + depth;

/**
 * Per-attack jitter, passed straight to `Rng.int`, which is INCLUSIVE at both
 * ends. So this is -1, 0, +1 or +2 — deliberately NOT symmetric: the average hit
 * is half a point above `enemyDamage`, and every hits-to-die figure in this file
 * is derived from that biased average rather than from the base.
 *
 * `enemyRound` floors the result at 1. That is unreachable at every depth these
 * curves produce, and it stays as a guard so `enemyDamage` can be retuned below
 * the jitter without an attack quietly healing the player.
 */
export const DAMAGE_JITTER: readonly [number, number] = [-1, 2];

/**
 * Status damage per tick. Burning is the fast one and decay is the long one, so
 * they share a rate and differ only in duration (see `STATUS_META` in
 * `spells.ts`): burning is 3 ticks, decay is 5. That is what makes Decay worth
 * the rounds it needs in an economy that charges for time — it out-totals a
 * Fireball while paying out slower per round, which is a trade rather than a
 * downgrade.
 *
 * Deliberately flat with depth: against the enemy HP curve these are already
 * 14-30% of a body per tick, and scaling them on top of that would make "light
 * it and walk away" the only play worth making.
 */
export const BURNING_DOT = 3;
export const DECAY_DOT = 3;

/**
 * Enemies per room. This is as much of the tempo as any single stat: every body
 * in the room gets a free action for each page you tear, so a fourth enemy is a
 * fourth of the incoming damage on every round of a fight that is now several
 * rounds long. Three is the ceiling, and the fourth body that used to arrive as
 * a hard step at depth 3 is now a roll that leans on with depth, so the curve
 * has no cliff in it.
 */
export const ROOM_ENEMIES_BASE = 2;
export const ROOM_ENEMIES_MAX = 3;
export const roomEnemyChance = (depth: number): number => 0.2 + depth * 0.08;

// ----------------------------------------------------------------- engagement

/**
 * How far a hostile will act from — step toward you, or hit you.
 *
 * This is the same number as the default reach of `targetsInView`, and it has to
 * be: anything the player can put a reticle on has to be allowed to answer.
 * While the engage radius was 4 and targeting reached 7 there was a three-tile
 * band — always outside a room, because corridor tiles belong to no room — where
 * every body in a room was a legal target and no body was allowed to move. A
 * whole room, and every boss, could be shot to death from a corridor for zero HP.
 */
export const ENGAGE_RADIUS = 7;

/** How far a golem will break off from following you to engage something. */
export const GOLEM_AGGRO = 6;

/**
 * Rounds a body is braced against round-denial after losing one to it.
 *
 * The player gets exactly ONE action per round, so any denial that lasts two
 * rounds refreshes before it expires and the fight simply stops: two bodies could
 * be held forever with alternating Frostbolts, and a wide enough volley held the
 * whole room. Statuses keep their full durations — frozen still pins a body in
 * place for two rounds and still leaves it open to SHATTER — but the SKIP is rate
 * limited, so nothing loses two rounds in a row and a boss loses at most one in
 * three. Denial becomes tempo you buy rather than a lock you close.
 */
export const DENIAL_BRACE = 1;
export const BOSS_DENIAL_BRACE = 2;

// ------------------------------------------------- elemental interactions

/** CONDUCTION: shock on a soaked body, and the share that arcs onward. */
export const CONDUCTION_MULT = 1.5;
export const CONDUCTION_ARC_SHARE = 0.5;
export const CONDUCTION_ARC_RANGE = 3;

/**
 * SHATTER: a hit this heavy on a frozen body breaks the shell open.
 *
 * Eight is exactly a rank-1 Frostbolt, and that is the whole point — at hand size
 * 1 the only thing that freezes is Frostbolt, so if the threshold sits above it
 * the valve that ends a freeze can never trip. The 5-damage utility pages (Gust,
 * Decay) stay below it, so "a heavy hit" still means something.
 */
export const SHATTER_DAMAGE = 8;
export const SHATTER_MULT = 1.5;

/** Frost bites deeper through water. */
export const DEEP_FREEZE_MULT = 1.6;

// ------------------------------------------------------------------- pacing

/**
 * How long a round takes to read, in milliseconds.
 *
 * "A three-page fusion visibly costs three enemy rounds" needs a mechanism, and
 * this is it — without a real delay the whole round resolves inside one microtask
 * and three rounds look exactly like none. Only bodies that actually act are
 * paced, so assembling in an empty room is still instant and still free.
 *
 * Kept short on purpose. `main.ts` blocks input for the whole round, so every
 * millisecond here is also a millisecond the player cannot step — and retreating
 * mid-assembly is a tactic this phase wants to keep viable. A three-body room is
 * ~240ms of round, which staggers the bodies visibly without stalling the stepper.
 */
export const ACT_PACE_MS = 60;
export const ROUND_PACE_MS = 60;

// ---------------------------------------------------------------- attrition

/**
 * Attrition, scaled with depth because everything it is measured against is.
 *
 * Flat heals could not fund the run. 40 + 4x13 + ~5x8 was about 132 HP against a
 * measured cost of 236 for a routed floor-by-floor clear, and the shape was worse
 * than the total: a floor costs 9 HP at depth 1 and 43 at depth 5 (measured), so a
 * flat heal is a windfall on floor 1 and a rounding error on floor 5. Sized off
 * the floor's own cost instead, so `descendHeal` lands you on the next floor at
 * roughly full and the bar is the fight's budget rather than the run's.
 *
 * Together these come to about 131 HP of healing on a full route, which puts the
 * whole budget at ~170 against a ~107 measured cost with the altar rank ladder
 * taken — comfortable routed, tight for a full clear.
 *
 * Sized off the depth being LEFT, so the heal that funds floor 4 is the one you
 * take walking out of floor 3.
 */
export const descendHeal = (depth: number): number => 4 + depth * 5;
export const chestHealBase = (depth: number): number => 2 + depth * 3;
export const CHEST_HEAL_SPREAD = 4;

/**
 * How much of a heal the bar can actually take.
 *
 * Call sites heal by THIS rather than by clamping afterwards, so the number in
 * the log is the number the player got. The old form threw away most of the
 * descent heal on floor 1 — the one floor with nothing to spend it on — and still
 * announced the full amount.
 */
export const healable = (hp: number, maxHp: number, amount: number): number =>
  Math.max(0, Math.min(amount, maxHp - hp));
