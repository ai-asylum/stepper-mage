/**
 * What a creature is made of, and therefore what hurts it.
 *
 * Without this the five elements collapse into one. Every enemy took the same
 * damage from everything, so Fireball was correct against all of them and the only
 * reason to own a second page was that you might not have the first.
 *
 * ## "Physical" is gust and stone
 *
 * There is no physical damage channel and there is not going to be one. Adding an
 * element to express "weak to a blunt blow" would touch the three-sources rule for
 * a single adjective. Instead the table names the two elements that HIT rather than
 * burn, chill or corrode.
 *
 * Gust carries it. It is a book page, so it is available on every floor from the
 * first turn, and it is already the impact element — it is the one that staggers.
 * Stone is the same blow from a fixture, a bonus where a floor has a statue or a
 * set of gears, never the only key to a door.
 *
 * That distinction is load-bearing and was nearly got wrong: stone ALONE was the
 * obvious reading of "bone is weak to physical", and it is unusable. Stone is a
 * fixture element yielded by the floor-3 statue and the floor-4 gears and hoist —
 * and floor 2 is the Ossuary Kitchens, the floor made of bone, which harvests water
 * and oil. The weakness would have been unexploitable on the one floor it is about.
 *
 * ## The numbers
 *
 * Weak is 1.5x and resistant is 0.6x, not 2x and 0.5x. At hand size 1 a cast is the
 * whole turn, so guessing wrong already costs the turn; doubling the swing on top of
 * that punishes not-knowing harder than knowing is rewarded, and the player does not
 * start with a way to know. The gentler spread still moves a five-cast boss fight by
 * more than a cast either way, which is the bar this has to clear to matter.
 *
 * ## Rules of the table
 *
 * A creature lists only what it is UNUSUAL about. Anything unlisted is 1x, so the
 * table reads as a set of claims rather than a matrix, and adding an element later
 * does not mean revisiting twenty rows.
 *
 * Every creature that resists something is weak to something. A body with only a
 * resistance is a body the player can only get wrong.
 */
import type { Element } from '../spells/spells';

export const WEAK_MULT = 1.5;
export const RESIST_MULT = 0.6;

export interface Affinity {
  weak?: readonly Element[];
  resist?: readonly Element[];
}

/**
 * Keyed by sprite id. Anything absent takes everything at face value, which is what
 * the whole roster did before this existed — so props, golems and any creature not
 * yet given a character are unaffected rather than broken.
 */
const AFFINITY: Record<string, Affinity> = {
  // ---- I, the Drowned Library. Paper and ink, and a library is already flooded.
  // Fire is the obvious answer here and it is meant to be: this is the floor that
  // teaches the mechanic, so its lesson is the one nobody needs a hint for.
  f1_enemy_ink: { weak: ['fire'], resist: ['water'] },
  f1_enemy_moth: { weak: ['gust'], resist: ['fire'] },      // it IS a flame
  f1_enemy_wraith: { weak: ['fire'], resist: ['stone'] },   // loose paper, nothing to hit
  f1_boss: { weak: ['fire'], resist: ['rot'] },             // a book cannot rot faster than it burns

  // ---- II, the Ossuary Kitchens. Bone: resists fire, breaks under a blow.
  f2_enemy_cleaver: { weak: ['gust', 'stone'], resist: ['fire'] },
  f2_enemy_imp: { weak: ['fire'], resist: ['oil'] },        // rendered fat, and it is already greasy
  f2_enemy_hound: { weak: ['gust', 'stone'], resist: ['fire', 'rot'] },
  f2_boss: { weak: ['gust', 'stone'], resist: ['fire'] },

  // ---- III, the fungal deep. Wet, alive, and rooted.
  f3_enemy_hulk: { weak: ['fire'], resist: ['stone', 'rot'] },
  f3_enemy_creeper: { weak: ['fire'], resist: ['gust'] },   // low and anchored
  f3_enemy_priest: { weak: ['fire'], resist: ['rot'] },
  f3_boss: { weak: ['fire', 'frost'], resist: ['rot'] },

  // ---- IV, the foundry. Already on fire; water and cold are the answer.
  f4_enemy_slag: { weak: ['water', 'frost'], resist: ['fire'] },
  f4_enemy_bellows: { weak: ['water', 'spark'], resist: ['fire'] },
  f4_enemy_wasp: { weak: ['frost'], resist: ['fire'] },
  f4_boss: { weak: ['water', 'frost'], resist: ['fire'] },

  // ---- V, the observatory. Stone, glass and starlight — brittle, not burnable.
  f5_enemy_acolyte: { weak: ['spark'], resist: ['starlight'] },
  f5_enemy_husk: { weak: ['gust', 'stone'], resist: ['fire', 'starlight'] },
  f5_enemy_sentinel: { weak: ['gust', 'stone'], resist: ['spark'] },
  // Fire is deliberately NOT resisted here. Two of the five bosses turning away
  // Fireball is the lesson; three makes the STARTING loadout wrong more often than
  // right, and the player has no way to know before they walk in. The bone floor and
  // the foundry are the two that earn it — a skeleton and a furnace — and this one
  // was only ever resisting fire because I was filling in a column.
  f5_boss: { weak: ['rot'], resist: ['starlight'] },
};

export type Affinities = 'weak' | 'resist' | 'plain';

/** How this creature answers this element. */
export function affinityOf(spriteId: string, element: Element): Affinities {
  const a = AFFINITY[spriteId];
  if (!a || element === 'none') return 'plain';
  if (a.weak?.includes(element)) return 'weak';
  if (a.resist?.includes(element)) return 'resist';
  return 'plain';
}

/** The damage multiplier, and the only place the two constants are applied. */
export function affinityMult(spriteId: string, element: Element): number {
  const k = affinityOf(spriteId, element);
  return k === 'weak' ? WEAK_MULT : k === 'resist' ? RESIST_MULT : 1;
}

/** Everything a creature is unusual about, for the bestiary-ish readout. */
export function affinityFor(spriteId: string): Affinity | null {
  return AFFINITY[spriteId] ?? null;
}
