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
  // Fire is the biggest column here and is meant to be — this is the floor that
  // teaches the mechanic — but it is two of four rather than the whole floor, so
  // even the tutorial has a room where the starting page is the wrong answer.
  f1_enemy_ink: { weak: ['spark'], resist: ['water'] },     // wet ink conducts
  f1_enemy_moth: { weak: ['gust'], resist: ['fire'] },      // it IS a flame
  f1_enemy_wraith: { weak: ['fire'], resist: ['stone'] },   // loose paper, nothing to hit
  f1_boss: { weak: ['fire'], resist: ['rot'] },             // a book cannot rot faster than it burns

  // ---- II, the Ossuary Kitchens. Bone: resists fire, breaks under a blow — and
  // the hound is the row that stops "hit it" being the whole floor. Cold makes bone
  // brittle, which is a second way to break the same material.
  f2_enemy_cleaver: { weak: ['gust', 'stone'], resist: ['fire'] },
  f2_enemy_imp: { weak: ['fire'], resist: ['oil'] },        // rendered fat, and it is already greasy
  f2_enemy_hound: { weak: ['frost', 'stone'], resist: ['fire', 'rot'] },
  /**
   * THE BOSS OF FLOOR TWO DOES NOT RESIST FIRE, though everything around it does.
   *
   * Bone resisting flame is the right reading and the cleaver and the hound keep it.
   * On the BOSS it collided with the roster: a new save holds fire and only fire until
   * Kela is out on floor three, so a fire-resistant wall on floor two was a check the
   * player's book had no answer to. Stone is harvestable off a fixture and gust is not
   * a page they own, so the intended out — harvest stone, hit the bone with it — is a
   * play you have to already know exists, two floors before the game has taught that
   * fixtures are components at all.
   *
   * The weakness stays, so finding the stone is still the good line and still hits half
   * again as hard. What is gone is the punishment for not finding it: flame is now
   * ordinary against this boss rather than blunted, which makes floor two a fight a
   * one-element book can win slowly and a two-element one can win well.
   */
  f2_boss: { weak: ['gust', 'stone'] },

  // ---- III, the fungal deep. Wet, alive, and rooted — which is three different
  // vulnerabilities and used to be written as one. Burning was the answer to every
  // creature on this floor; now it answers two of four, and the other two are what
  // "wet" and "alive" actually imply.
  f3_enemy_hulk: { weak: ['fire'], resist: ['stone', 'rot'] },
  f3_enemy_creeper: { weak: ['frost'], resist: ['gust'] },  // growth, and cold stops growth
  f3_enemy_priest: { weak: ['spark'], resist: ['rot'] },    // damp flesh conducts
  f3_boss: { weak: ['fire', 'frost'], resist: ['rot'] },

  // ---- IV, the foundry. Already on fire; cold and water are the answer, and the
  // wasp is the exception that stops the floor being one column — it is the only
  // thing in here that flies, and a gust wrecks a flyer.
  f4_enemy_slag: { weak: ['water', 'frost'], resist: ['fire'] },
  f4_enemy_bellows: { weak: ['water', 'spark'], resist: ['fire'] },
  f4_enemy_wasp: { weak: ['gust'], resist: ['fire'] },
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

  // ---- VI, the Glass Gardens. Brittle, and nothing in here burns.
  f6_enemy_bloom: { weak: ['gust', 'stone'], resist: ['fire'] },
  f6_enemy_shard: { weak: ['frost', 'stone'], resist: ['fire', 'spark'] }, // thermal shock
  f6_enemy_gardener: { weak: ['rot'], resist: ['frost'] },          // the one living thing
  f6_boss: { weak: ['gust', 'stone'], resist: ['fire', 'starlight'] },

  // ---- VII, the Tidal Vault. Already soaked, so spark is the floor's own answer —
  // and the one thing that is metal rather than meat answers to rot instead.
  f7_enemy_drowned: { weak: ['spark'], resist: ['water', 'frost'] },
  f7_enemy_crab: { weak: ['fire', 'stone'], resist: ['water'] },    // boiled in its shell
  f7_enemy_eel: { weak: ['frost'], resist: ['water', 'spark'] },   // cold-blooded, and it lives in charge
  f7_boss: { weak: ['spark', 'rot'], resist: ['water'] },

  // ---- VIII, the Choir of Wounds. Flesh and bronze: it rots, and a blow silences
  // the bronze half.
  f8_enemy_cantor: { weak: ['rot'], resist: ['spark'] },
  f8_enemy_bellman: { weak: ['gust', 'stone'], resist: ['rot'] },   // bronze does not rot
  f8_enemy_hymn: { weak: ['fire'], resist: ['stone'] },             // loose paper again
  f8_boss: { weak: ['rot'], resist: ['spark', 'stone'] },

  // ---- IX, the Ashfall Reach. Cold and dead already, so fire is worthless here —
  // this is the second floor that turns Fireball away and it is deep enough to.
  f9_enemy_cinder: { weak: ['water', 'gust'], resist: ['fire'] },   // ash scatters
  f9_enemy_obsidian: { weak: ['frost', 'stone'], resist: ['fire'] },
  f9_enemy_mourner: { weak: ['spark', 'water'], resist: ['fire', 'rot'] }, // fine ash carries a charge
  f9_boss: { weak: ['water', 'frost'], resist: ['fire'] },

  // ---- X, the Hollow Crown. Black glass over nothing. Starlight is the only thing
  // that touches a void, and the armour answers to a blow.
  f10_enemy_regent: { weak: ['starlight', 'frost'], resist: ['fire', 'rot'] }, // no body to burn
  f10_enemy_herald: { weak: ['starlight', 'spark'], resist: ['frost'] },
  f10_enemy_kingsguard: { weak: ['gust', 'stone'], resist: ['spark'] },
  f10_boss: { weak: ['starlight', 'gust'], resist: ['fire', 'rot'] },
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
