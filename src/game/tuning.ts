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
 * fusion per room, so it is a good deal deeper than it was — roughly twelve
 * depth-1 hits, falling to about seven by depth 5.
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
 * Boss HP, sized so the fight is 7-10 casts unranked and 3-4 with a rank-3 page —
 * the altar ladder is most of what makes a late boss tractable.
 *
 * The curve is deliberately flatter than the old one. A boss stands at the far
 * end of a big room and has to walk to you, so the first half of the fight is a
 * shooting gallery and only the back half costs anything; past about ten casts the
 * extra health lands entirely in the shooting-gallery half and reads as a grind
 * rather than as a fight.
 */
export const bossHp = (depth: number): number => 62 + depth * 12;

/**
 * Damage per attack, before the ±jitter in `Combat.enemyRound`.
 *
 * Set from hits-to-die rather than from a damage curve: clearing a room lands
 * about one hit at depth 1 and about three by depth 5, so a flat-ish per-hit
 * number already produces a steep per-room curve (6% of the bar at depth 1
 * rising to 31% at depth 5, measured). Making the per-hit number climb as fast as
 * the round count does makes the last two floors arithmetically unwinnable.
 */
export const enemyDamage = (depth: number): number => 2 + Math.ceil(depth / 2);

/** A boss hits for a bit under two mooks, and never for a third of the bar. */
export const bossDamage = (depth: number): number => 4 + depth;

/**
 * Status damage per tick. Deliberately flat: against the new enemy HP these are
 * 14-30% of a body per tick instead of 8-16%, so the DOT elements got stronger
 * without touching a spell number. Scaling them with depth on top of that would
 * make "light it and walk away" the only play worth making.
 */
export const BURNING_DOT = 3;
export const DECAY_DOT = 2;

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

/**
 * Attrition. Both are ~30% and ~20% of the bar, the same shares they were before
 * the bar grew — a floor should hand back about half of what it costs, so the run
 * trends downward and a detour for a chest is worth taking.
 */
export const DESCEND_HEAL = 13;
export const CHEST_HEAL_BASE = 6;
export const CHEST_HEAL_SPREAD = 4;
