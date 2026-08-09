/**
 * What it looks like when a creature hits YOU.
 *
 * The screen already flashed red and shook for every hit in the game, which tells
 * you that you were hurt and nothing about what hurt you. A bone hound closing its
 * jaws and a slag golem venting its chest furnace are the same event to the player,
 * and in a first-person game where the attacker can be off the edge of the screen,
 * that flash is sometimes the ONLY thing you see.
 *
 * So the effect is drawn from the creature's own attack. Three kinds, because three
 * is what the roster actually contains once you stop describing and start grouping:
 *
 *   rake    something with edges closes on you — claws, jaws, blades, a stinger
 *   burst   something is thrown or vented at you — fire, light, spores, a star
 *   lash    something long reaches you — ink, vines, tendrils, threads
 *
 * Three and not twenty. A per-creature effect would be twenty things to author and
 * twenty things to tell apart at a glance during a fight, and the read the player
 * needs is coarse: was that a swipe, a blast, or something that reached me. The
 * COLOUR carries the rest and is per creature.
 *
 * ## Every colour here is BRIGHT, and that is a rule
 *
 * The effect is drawn over a dungeon that is almost entirely dark brown, in a room
 * lit by one torch. A dark effect on a dark room is not subtle, it is invisible: the
 * ink wretch's first colour was #2b3f46 at luminance 58, a near-black slash nobody
 * could see it had happened.
 *
 * So a creature's fx colour is NOT its body colour. It is the brightest thing about
 * that creature — the ink wretch's teal highlights rather than its black ink, the
 * cleaver skeleton's bone rather than its filthy apron. `MIN_FX_LUMA` is the floor
 * and a harness check holds every entry above it, because "make sure none of the
 * VFX are dark" is a rule that only stays true if something enforces it.
 */

export type HitFxKind = 'rake' | 'burst' | 'lash';

/**
 * The luminance an fx colour must clear, on the usual 0-255 perceptual weighting.
 *
 * 150 is not arbitrary: it is above every wall tone the game draws, so an effect at
 * this floor separates from the stone in the darkest room on the darkest floor.
 */
export const MIN_FX_LUMA = 150;

/** Perceptual brightness of a packed RGB, for the floor above. */
export function fxLuma(rgb: number): number {
  return 0.299 * ((rgb >> 16) & 255) + 0.587 * ((rgb >> 8) & 255) + 0.114 * (rgb & 255);
}

export interface HitFx {
  kind: HitFxKind;
  /** The creature's own colour, so a fight has a palette and not just red. */
  colour: number;
}

/**
 * Keyed by sprite id, so a creature that has not been given one falls back rather
 * than crashing — and the fallback is a rake, which is the commonest and the least
 * wrong thing to show for an unknown attacker.
 */
const FX: Record<string, HitFx> = {
  // I — the library. Paper, ink and candle-flame.
  // Teal, not ink-black: the fx takes a creature's BRIGHTEST note, not its body.
  f1_enemy_ink: { kind: 'lash', colour: 0x6fe4d8 },
  f1_enemy_moth: { kind: 'burst', colour: 0xf5b83c },
  f1_enemy_wraith: { kind: 'burst', colour: 0xd8caa8 },
  f1_boss: { kind: 'burst', colour: 0xcf94ff },

  // II — the kitchens. Cleavers, grease and bone.
  f2_enemy_cleaver: { kind: 'rake', colour: 0xc7c0a8 },
  f2_enemy_imp: { kind: 'burst', colour: 0xd8a53a },
  f2_enemy_hound: { kind: 'rake', colour: 0xe0d6b4 },
  f2_boss: { kind: 'rake', colour: 0xff7a5c },

  // III — the fungal deep. Spores, thorns and threads.
  f3_enemy_hulk: { kind: 'burst', colour: 0x8fbf5a },
  f3_enemy_creeper: { kind: 'lash', colour: 0xd6bf62 },
  f3_enemy_priest: { kind: 'lash', colour: 0xd8e8c0 },
  f3_boss: { kind: 'burst', colour: 0xb98cff },

  // IV — the foundry. Everything here is vented, thrown or driven.
  f4_enemy_slag: { kind: 'burst', colour: 0xff8a3a },
  f4_enemy_bellows: { kind: 'burst', colour: 0xffb23a },
  f4_enemy_wasp: { kind: 'rake', colour: 0xff9a4a },
  f4_boss: { kind: 'burst', colour: 0xffd08a },

  // V — the observatory. Starlight and glass.
  f5_enemy_acolyte: { kind: 'burst', colour: 0xbfd8ff },
  f5_enemy_husk: { kind: 'burst', colour: 0xffffff },
  f5_enemy_sentinel: { kind: 'rake', colour: 0xcfe6ff },
  f5_boss: { kind: 'burst', colour: 0xffd76a },
};

const FALLBACK: HitFx = { kind: 'rake', colour: 0xff7a60 };

/** Every entry, for the harness that holds the brightness floor. */
export function allHitFx(): HitFx[] {
  return [...Object.values(FX), FALLBACK];
}

export function hitFxFor(spriteId: string): HitFx {
  return FX[spriteId] ?? FALLBACK;
}
