/**
 * Texel density as a runtime choice, plus the art constants that belong to each
 * density.
 *
 * `PPU` used to be a module const in `tiles.ts`. It is a setting now, and the
 * reason it needs a TABLE rather than a number is that every generator in
 * `tiles.ts` is written in absolute texels — a 3-texel mortar gap, a 30-texel
 * brick course, a bevel two texels wide. Those counts ARE the art: at 36 texels
 * per world unit a 3-texel bevel is a third of a brick, so each step needs its
 * own set chosen by eye. One set with a scale factor applied to it is exactly the
 * answer this shape exists to prevent, which is why nothing here is derived from
 * anything else here.
 *
 * WHAT IS IN THE TABLE and what is not: texel counts and texel-space noise
 * frequencies, because both change meaning when the grid changes. Fractions of a
 * face (a waterline two-thirds down, AO reaching 28% in from an edge), colours and
 * probabilities stay in the generator — they are already density-independent, and
 * copying them four times would only invite the four copies to drift.
 *
 * All four entries are authored at their own grid. Where an entry looks like it is
 * missing something it usually is: a count of 0 or a range of `[0, 0]` is a step
 * saying it does not have that feature, because a feature that cannot be drawn at a
 * density is one fewer feature and not a smaller one. `tiles.ts` carries the size
 * gates for the shapes whose smallest form is bigger than a number — the bone inlay,
 * a rivet's drop shadow, the vault's fluting and its inner floor ring.
 */

/** Every density the world can be built at, coarsest last. */
export const PIXEL_STEPS = [144, 72, 36, 18] as const;
export type PixelStep = (typeof PIXEL_STEPS)[number];

/**
 * Where a fresh save starts.
 *
 * 144 undersamples badly into a 400px-tall buffer — its "detail" arrives as shimmer
 * rather than as detail — so the default belongs below it. 72 is where the 1:1 point
 * sits at about two tiles, which puts most of what is on screen in magnification
 * while a wall still has room for a course of brick, a bevel and a crack.
 *
 * It also happens to be the one step where nothing underneath it is out of register:
 * creatures come from the 72 roster, so the stone and the things standing in front of
 * it are drawn at the same density. At 18 the creatures have to come from 36 (see
 * `spritePpu`) and the torch is still 144 (see `sconce`), so two things are visibly
 * finer than the wall behind them. Those steps remain selectable and remain worth
 * selecting; they are just not what a new player should be handed first.
 */
export const DEFAULT_STEP: PixelStep = 72;

export function isPixelStep(v: unknown): v is PixelStep {
  return (PIXEL_STEPS as readonly unknown[]).includes(v);
}

/**
 * The steps a build can actually offer, which is not always all four.
 *
 * The playable ad is one inlined HTML file under a hard 5 MB budget, and it has to
 * embed every sprite it might ask for — a missing one is a guaranteed 404 inside a
 * single file. The 144 roster is 2.6 MB of the 3.7 MB of art in the game and it is
 * the only step that uses it: 72 draws from `s72`, and both 36 and 18 draw from
 * `s36`. So the ad ships the three coarser steps and the full game ships four.
 *
 * Dropping the step rather than hiding the control is the deliberate half of this.
 * The chip still works and still says what it is showing; there is simply one fewer
 * position on it, which is a smaller lie than a chip that 404s the dungeon.
 */
/**
 * DEAD as of `Roadmap/First_Minutes.md`. The world is locked to `DEFAULT_STEP` and
 * there is no way to change it, so there is nothing to enumerate.
 *
 * `PIXEL_STEPS` and `STEP_ART` stay, because the ROSTERS stay: the art at every
 * density is still generated and still in the repo, and the tooling that authors it
 * reads this table. What was removed is the player-facing CHOICE — three of the four
 * steps are worse than the default and one draws creatures at a different density
 * from the stone it stands on.
 */

/** Noise applied per texel: frequency is in 1/texels, so it moves with the step. */
export interface GrainArt { freq: number; amount: number }

/** Contact darkening at the edges of a face, as a fraction of full darkness. */
export interface AoArt { top: number; bottom: number; sides: number }

export interface MasonryArt {
  /**
   * Course height in texels. ONE number, not a per-variant choice.
   *
   * A wall run is many quads and each takes whichever variant its tile drew, so a
   * course height that varied by variant meant the horizontal mortar lines broke at
   * every tile seam — half the wall on 5-texel courses and half on 4, which cannot
   * be made to meet. It was always wrong and 144 merely hid it; at 18 a wall is
   * under four courses tall, so the mismatch IS the wall.
   *
   * Variety comes from the per-variant rng seed instead: block widths, the stagger
   * wander and the jitter all still differ face to face. Only the courses are shared,
   * which is the same reasoning the ceiling's vault already carried.
   */
  rowH: number;
  /** Block width ranges in texels. The variant picks one. */
  blockW: readonly [readonly [number, number], readonly [number, number]];
  /** Mortar gap in texels. */
  gap: number;
  /** Bevel strength. */
  bevel: number;
  /**
   * The bevel's PROFILE: one weight per texel in from the edge, outermost first.
   * The array's LENGTH is the bevel's width in texels, which is the number the
   * phase is actually about — a bevel has to read as one texel of shadow, and at
   * 36 the two-texel profile 144 uses is a third of a course.
   */
  litTop: readonly number[];
  litLeft: readonly number[];
  /** Bottom and right, as positive weights that get subtracted. */
  darkBottom: readonly number[];
  darkRight: readonly number[];
  /** Per-block brightness jitter — the biggest anti-tiling cue. */
  jitter: number;
  /** How far a course wanders sideways, and each block up or down, in texels. */
  stagger: number;
  wobble: number;
  /** The slow per-block noise laid under the jitter. */
  noiseFreq: number;
  noiseAmt: number;
}

export interface WallArt {
  /** Field tone the masonry is added to. */
  base: number;
  masonry: MasonryArt;
  grain: GrainArt;
  ao: AoArt;
  /** Crack length in texels, and how far in from each edge it may start. */
  crack: { len: readonly [number, number]; inset: number; top: number; bottom: number };
}

export interface FloorArt {
  base: number;
  /** Flagstone cell frequency, and the fbm that breaks up each slab. */
  cellFreq: number;
  blendFreq: number;
  blend: number;
  /** Joint width as a cell threshold, and how dark it cuts. */
  jointW: number;
  jointDepth: number;
  /**
   * How fast a slab crowns away from its joint, and the cap on it.
   *
   * The SIGN chooses which way the flagstone is lit, and it is a real authoring
   * decision rather than a tuning one — see `buildFloor`. Positive puts the joint at
   * the cell's seed and crowns outward, which needs a slab wide enough to hold both.
   * Negative crowns the seed and puts the joint on the cell boundary, which is the
   * only reading that survives a slab four texels across. `crownMax` is unused when
   * `crownGain` is negative.
   */
  crownGain: number;
  crownMax: number;
  grain: GrainArt;
  ao: AoArt;
}

export interface CeilArt {
  base: number;
  /** The barrel vault: how much brighter the crown is, and how fast it falls. */
  archLift: number;
  archSlope: number;
  blendFreq: number;
  blend: number;
  masonry: MasonryArt;
  ao: AoArt;
  /** Timber beam thickness in texels. */
  beamH: number;
}

/** A crack's cross-section in texels, as darkness per offset from its centre. */
export interface CrackArt {
  core: number;
  side: number;
  below: number;
  branchChance: number;
  branchLen: number;
}

export interface DetailArt {
  waterline: {
    /** The tide mark, as a fraction down the face, and its texel wobble. */
    lineFrac: number;
    lineJitter: number;
    waveFreq: number;
    waveAmp: number;
    noiseFreq: number;
    noiseAmp: number;
    /** Speckle counts are per FACE, so they fall with area, not with the step. */
    algae: number;
    algaeFreq: number;
    drips: readonly [number, number];
    dripMin: number;
    floorFreq: number;
    ceilSpecks: number;
  };
  bone: {
    sootReach: number;
    sootSpread: number;
    sootFreq: number;
    /** How far in from an edge an inlay may be centred. */
    inset: number;
    femurLen: readonly [number, number];
    femurW: number;
    knuckleR: number;
    knuckleRy: number;
    knuckleGap: number;
    skullRx: number;
    skullRy: number;
    jawW: number;
    jawH: number;
    eyeR: number;
    eyeRy: number;
    eyeGap: number;
    teethSpan: number;
    teethStep: number;
    teethDrop: number;
    greaseDrips: number;
    greaseLen: readonly [number, number];
    floorBones: number;
    floorBoneReach: number;
    floorBoneW: number;
    floorPits: number;
    floorPitR: readonly [number, number];
    floorPitRy: readonly [number, number];
  };
  moss: {
    /** How far up the wall moss climbs at minimum, and how much further it can. */
    reach: number;
    spread: number;
    reachFreq: number;
    mossFreq: number;
    rootLen: readonly [number, number];
    strands: number;
    strandLen: readonly [number, number];
    floorFreq: number;
  };
  rivet: {
    plateInset: number;
    /** Rivet spacing along a seam, where the first one sits, and its radius. */
    rivetStep: number;
    rivetStart: number;
    rivetInset: number;
    rivetR: number;
    seams: readonly [number, number];
    seamLen: readonly [number, number];
    glowR: readonly [number, number];
    /** The floor grate: overall height, bar width, and the glow under it. */
    grateH: number;
    grateTop: number;
    grateBar: number;
    grateGlow: number;
    floorSpecks: number;
  };
  inlay: {
    stars: readonly [number, number];
    inset: number;
    /** Half-length of a star's spokes in texels. 0 draws a bare point. */
    spoke: number;
    glowR: number;
    fluteStep: number;
    fluteStart: number;
    ridgeFreq: number;
    ringR: readonly [number, number];
  };
}

export interface StepArt {
  /** Texels per world unit. Every tile face is built at this density. */
  ppu: number;
  /**
   * The density the SPRITE PNGs shipped for this step were authored at.
   *
   * It picks the roster (`public/art/s<n>/`) AND divides the pixel size, so those
   * two can never disagree: world size is `pixels / spritePpu`, and a creature stays
   * the same size in world units precisely because both halve together.
   *
   * It is a separate field from `ppu` because the two genuinely diverge at the
   * bottom, and that divergence is a finding rather than an oversight. **A texel
   * density that works for tiling masonry does not work for a single object that
   * has to be identified.** A wall gets to be vague — it repeats, and no one has to
   * tell one brick from another. A creature standing one tile away fills half the
   * screen and has to be recognisably a candle-moth and not a boss. At 18 the moth
   * is nineteen texels across and the floor-1 boss loses its eye entirely, so it
   * reads as a coloured blob with a keyline. That is not something better art fixes;
   * nineteen pixels is nineteen pixels.
   *
   * So 18 draws its creatures from the 36 roster. They are twice the stone's density
   * there and that is the deliberate trade: slightly finer than the wall, versus
   * unidentifiable. The 18 roster was generated, looked at, and cut.
   */
  spritePpu: number;
  wall: WallArt;
  floor: FloorArt;
  ceil: CeilArt;
  crack: CrackArt;
  /**
   * The torch sconce, in texels. All four steps say 26x40, and that is a known
   * loose end rather than a considered answer.
   *
   * Its quad is sized in WORLD units off `WALL_H` — a torch that does not scale
   * with the ceiling hangs through it — so nothing here changes its size, only
   * its resolution. Stepping that resolution needs `buildSconce` rewritten per
   * step the way the wall generators were: it draws the bracket and the three
   * flame layers at absolute 144-space texel offsets, so halving W and H alone
   * puts the bracket below the frame. Until then the torch is the one thing in
   * the world still drawn at 144, and at 18 it reads finer than the stone it is
   * bolted to.
   */
  sconce: { w: number; h: number };
  detail: DetailArt;
}

/** The authored step. Every number here is the one the world shipped with. */
const STEP_144: StepArt = {
  ppu: 144,
  spritePpu: 144,
  wall: {
    base: 0.62,
    masonry: {
      rowH: 30,
      blockW: [[39, 60], [48, 78]],
      gap: 3,
      bevel: 0.17,
      litTop: [1, 0.4],
      litLeft: [0.7],
      darkBottom: [1.5, 0.7],
      darkRight: [1.1, 0.45],
      jitter: 0.11,
      stagger: 4,
      wobble: 1,
      noiseFreq: 0.05,
      noiseAmt: 0.12,
    },
    grain: { freq: 0.1, amount: 0.1 },
    ao: { top: 0.3, bottom: 0.22, sides: 0.18 },
    crack: { len: [24, 46], inset: 12, top: 8, bottom: 30 },
  },
  floor: {
    base: 0.52,
    cellFreq: 0.045,
    blendFreq: 0.07,
    blend: 0.16,
    jointW: 0.1,
    jointDepth: 0.42,
    crownGain: 0.4,
    crownMax: 0.14,
    grain: { freq: 0.16, amount: 0.11 },
    ao: { top: 0.34, bottom: 0.34, sides: 0.34 },
  },
  ceil: {
    base: 0.34,
    archLift: 0.2,
    archSlope: 1.5,
    blendFreq: 0.06,
    blend: 0.18,
    masonry: {
      rowH: 33,
      blockW: [[45, 69], [45, 69]],
      gap: 3,
      bevel: 0.1,
      litTop: [1, 0.4],
      litLeft: [0.7],
      darkBottom: [1.5, 0.7],
      darkRight: [1.1, 0.45],
      jitter: 0.07,
      stagger: 4,
      wobble: 1,
      noiseFreq: 0.05,
      noiseAmt: 0.12,
    },
    ao: { top: 0.2, bottom: 0.2, sides: 0.2 },
    beamH: 11,
  },
  crack: { core: 0.42, side: 0.14, below: 0.1, branchChance: 0.05, branchLen: 0.45 },
  sconce: { w: 26, h: 40 },
  detail: {
    waterline: {
      lineFrac: 0.58, lineJitter: 6, waveFreq: 0.11, waveAmp: 2.2,
      noiseFreq: 0.06, noiseAmp: 5, algae: 190, algaeFreq: 0.1,
      drips: [1, 3], dripMin: 14, floorFreq: 0.035, ceilSpecks: 26,
    },
    bone: {
      sootReach: 10, sootSpread: 26, sootFreq: 0.05, inset: 24,
      femurLen: [20, 30], femurW: 2.4, knuckleR: 3.2, knuckleRy: 3, knuckleGap: 2.5,
      skullRx: 8, skullRy: 7.5, jawW: 10, jawH: 5,
      eyeR: 2.2, eyeRy: 2.6, eyeGap: 3.2, teethSpan: 4, teethStep: 2, teethDrop: 8,
      greaseDrips: 2, greaseLen: [8, 22],
      floorBones: 14, floorBoneReach: 7, floorBoneW: 1.2,
      floorPits: 5, floorPitR: [3, 6], floorPitRy: [2, 4],
    },
    moss: {
      reach: 16, spread: 40, reachFreq: 0.045, mossFreq: 0.08,
      rootLen: [26, 48], strands: 5, strandLen: [4, 16], floorFreq: 0.04,
    },
    rivet: {
      plateInset: 3, rivetStep: 13, rivetStart: 8, rivetInset: 4, rivetR: 2,
      seams: [1, 3], seamLen: [18, 34], glowR: [10, 18],
      grateH: 16, grateTop: 18, grateBar: 2, grateGlow: 30, floorSpecks: 30,
    },
    inlay: {
      stars: [3, 5], inset: 14, spoke: 2, glowR: 7,
      fluteStep: 16, fluteStart: 6, ridgeFreq: 0.03, ringR: [30, 22],
    },
  },
};

/**
 * 72 texels per unit — a wall of 72x76.
 *
 * The step where 144's vocabulary still fits and only its WIDTHS have to change.
 * The one decision that matters: **the bevel is one texel.** 144 spends two on it,
 * which is 7% of a 30-texel course; two texels of a 15-texel course is 13%, and the
 * second one stops being a highlight and becomes a second brick colour. So the
 * profiles here are all length 1 and the mortar gap comes down to one texel with
 * them, which keeps the joint at the same share of a course as 144's.
 *
 * Grain and the per-block noise are the other reauthored numbers: their frequency
 * is per texel, and simply doubling it puts the finest fbm octave under two texels,
 * which is static rather than stone. They are pulled back below the doubling and
 * their amount comes down with them.
 */
const STEP_72: StepArt = {
  ppu: 72,
  spritePpu: 72,
  wall: {
    base: 0.62,
    masonry: {
      rowH: 15,
      blockW: [[20, 31], [25, 39]],
      gap: 1,
      bevel: 0.18,
      litTop: [1],
      litLeft: [0.7],
      darkBottom: [1.5],
      darkRight: [1.1],
      jitter: 0.11,
      stagger: 3,
      wobble: 1,
      noiseFreq: 0.09,
      noiseAmt: 0.12,
    },
    grain: { freq: 0.17, amount: 0.09 },
    ao: { top: 0.3, bottom: 0.22, sides: 0.16 },
    crack: { len: [13, 25], inset: 7, top: 4, bottom: 15 },
  },
  floor: {
    base: 0.52,
    // Slab period 1/cellFreq and joint diameter 2*jointW/cellFreq are the two
    // numbers the eye reads on a floor, and both are in texels. Six slabs across a
    // tile, joint a bit over two texels — 144's proportions on half the grid.
    cellFreq: 0.085,
    blendFreq: 0.11,
    blend: 0.15,
    jointW: 0.1,
    jointDepth: 0.46,
    crownGain: 0.4,
    crownMax: 0.14,
    grain: { freq: 0.18, amount: 0.09 },
    ao: { top: 0.34, bottom: 0.34, sides: 0.34 },
  },
  ceil: {
    base: 0.34,
    archLift: 0.2,
    archSlope: 1.5,
    blendFreq: 0.11,
    blend: 0.16,
    masonry: {
      rowH: 16,
      blockW: [[23, 35], [23, 35]],
      gap: 1,
      bevel: 0.11,
      litTop: [1],
      litLeft: [0.7],
      darkBottom: [1.5],
      darkRight: [1.1],
      jitter: 0.07,
      stagger: 3,
      wobble: 1,
      noiseFreq: 0.09,
      noiseAmt: 0.12,
    },
    ao: { top: 0.2, bottom: 0.2, sides: 0.2 },
    beamH: 6,
  },
  crack: { core: 0.42, side: 0.12, below: 0.06, branchChance: 0.05, branchLen: 0.45 },
  sconce: { w: 26, h: 40 },
  detail: {
    waterline: {
      lineFrac: 0.58, lineJitter: 3, waveFreq: 0.22, waveAmp: 1.1,
      noiseFreq: 0.12, noiseAmp: 2.4, algae: 48, algaeFreq: 0.18,
      drips: [1, 3], dripMin: 7, floorFreq: 0.07, ceilSpecks: 7,
    },
    bone: {
      sootReach: 5, sootSpread: 13, sootFreq: 0.09, inset: 12,
      femurLen: [10, 16], femurW: 1.4, knuckleR: 1.8, knuckleRy: 1.6, knuckleGap: 1.5,
      // A skull a texel WIDER than half of 144's, because the jaw and the two
      // sockets are all that is left of it here and they need the room. The nose and
      // the teeth are dropped at this size — see the gate in `wallDetail`.
      skullRx: 5, skullRy: 4.5, jawW: 6, jawH: 3,
      eyeR: 1.2, eyeRy: 1.4, eyeGap: 2, teethSpan: 2, teethStep: 1, teethDrop: 4,
      greaseDrips: 2, greaseLen: [4, 11],
      floorBones: 8, floorBoneReach: 4, floorBoneW: 1,
      floorPits: 4, floorPitR: [2, 3], floorPitRy: [1, 2],
    },
    moss: {
      reach: 8, spread: 20, reachFreq: 0.09, mossFreq: 0.13,
      rootLen: [13, 25], strands: 4, strandLen: [2, 8], floorFreq: 0.075,
    },
    rivet: {
      plateInset: 2, rivetStep: 7, rivetStart: 4, rivetInset: 2, rivetR: 1,
      seams: [1, 3], seamLen: [9, 17], glowR: [5, 9],
      grateH: 8, grateTop: 9, grateBar: 1, grateGlow: 15, floorSpecks: 12,
    },
    inlay: {
      stars: [3, 5], inset: 8, spoke: 1, glowR: 3.5,
      fluteStep: 8, fluteStart: 3, ridgeFreq: 0.055, ringR: [15, 11],
    },
  },
};

/**
 * 36 texels per unit — a wall of 36x38.
 *
 * The step where the MORTAR GAP goes. At 144 a joint is three neutral texels with a
 * two-texel shadow above them; scaled down that is one neutral texel between a dark
 * one and a light one, and three tones inside three texels out of a nine-texel
 * course is a band, not a joint. So `gap: 0` here: blocks butt, and the joint is
 * exactly the shadow under one block against the highlight on top of the next — one
 * dark texel, one light texel, nothing between them. That is a chiselled edge, and
 * it is the shape a brick has at this size.
 *
 * Four courses of nine up the wall, two or three blocks across each: the same block
 * count as 144, because that is a property of the wall and not of the grid.
 */
const STEP_36: StepArt = {
  ppu: 36,
  spritePpu: 36,
  wall: {
    base: 0.62,
    masonry: {
      rowH: 9,
      blockW: [[12, 18], [14, 22]],
      gap: 0,
      bevel: 0.19,
      litTop: [1],
      litLeft: [0.7],
      darkBottom: [1.5],
      darkRight: [1.1],
      jitter: 0.11,
      stagger: 2,
      wobble: 0,
      noiseFreq: 0.18,
      noiseAmt: 0.12,
    },
    grain: { freq: 0.22, amount: 0.06 },
    ao: { top: 0.26, bottom: 0.19, sides: 0.12 },
    crack: { len: [7, 14], inset: 4, top: 2, bottom: 8 },
  },
  floor: {
    // Higher than the finer steps'. The boundary-joint reading below subtracts a
    // joint without a crown to add back, so the field's mean drops with it; the base
    // is lifted to put the SLAB back on the ramp step it sits on at 144, which is
    // measured rather than guessed — the room must not change brightness when the
    // chip changes the stone.
    base: 0.635,
    // Five slabs across the tile, and the joint moved to the cell BOUNDARY — a
    // negative `crownGain`. A slab is seven texels here, which is not enough to hold
    // a dark pit at its centre and a crown rising away from it.
    cellFreq: 0.13,
    // Every fbm frequency in this entry is well under the naive doubling, and the
    // reason is the octave count: `fbm` runs three octaves at f, 2f and 4f, so a base
    // frequency over about a sixth of a texel puts the finest octave under two texels
    // and the field stops being a shape and becomes per-texel speckle.
    blendFreq: 0.13,
    blend: 0.13,
    jointW: 0.44,
    jointDepth: 0.24,
    crownGain: -3,
    crownMax: 0.14,
    grain: { freq: 0.26, amount: 0.06 },
    ao: { top: 0.32, bottom: 0.32, sides: 0.32 },
  },
  ceil: {
    base: 0.34,
    archLift: 0.2,
    archSlope: 1.5,
    blendFreq: 0.11,
    blend: 0.14,
    masonry: {
      rowH: 9,
      blockW: [[12, 18], [12, 18]],
      gap: 0,
      // Stronger than 144's, not weaker: the ceiling ramp is five colours over a dark
      // range, so a bevel that only just clears one ramp step at 144 clears none here.
      bevel: 0.14,
      litTop: [1],
      litLeft: [0.7],
      darkBottom: [1.5],
      darkRight: [1.1],
      jitter: 0.07,
      stagger: 2,
      wobble: 0,
      noiseFreq: 0.18,
      noiseAmt: 0.12,
    },
    ao: { top: 0.18, bottom: 0.18, sides: 0.18 },
    beamH: 4,
  },
  crack: { core: 0.46, side: 0, below: 0, branchChance: 0.04, branchLen: 0.5 },
  sconce: { w: 26, h: 40 },
  detail: {
    waterline: {
      lineFrac: 0.58, lineJitter: 2, waveFreq: 0.4, waveAmp: 0.8,
      noiseFreq: 0.2, noiseAmp: 1.2, algae: 13, algaeFreq: 0.3,
      drips: [1, 2], dripMin: 4, floorFreq: 0.08, ceilSpecks: 3,
    },
    bone: {
      sootReach: 3, sootSpread: 7, sootFreq: 0.11, inset: 7,
      // No inlay at this step: an eleven-texel femur reads well enough on its own, but
      // it costs a bone-coloured keyline round the whole face — see `wallDetail`.
      femurLen: [0, 0], femurW: 1.1, knuckleR: 1.1, knuckleRy: 1, knuckleGap: 1.2,
      skullRx: 0, skullRy: 0, jawW: 0, jawH: 0,
      eyeR: 0, eyeRy: 0, eyeGap: 0, teethSpan: 0, teethStep: 1, teethDrop: 0,
      greaseDrips: 1, greaseLen: [3, 7],
      floorBones: 5, floorBoneReach: 3, floorBoneW: 0.9,
      floorPits: 3, floorPitR: [2, 3], floorPitRy: [1, 2],
    },
    moss: {
      reach: 4, spread: 10, reachFreq: 0.11, mossFreq: 0.1,
      rootLen: [7, 13], strands: 3, strandLen: [2, 5], floorFreq: 0.09,
    },
    rivet: {
      // A one-texel head every four texels. Its two-texel drop shadow is gated off
      // above this size, so the seam reads as dots rather than as a black line.
      plateInset: 1, rivetStep: 4, rivetStart: 2, rivetInset: 1, rivetR: 0.5,
      seams: [1, 2], seamLen: [5, 9], glowR: [3, 5],
      grateH: 4, grateTop: 5, grateBar: 1, grateGlow: 8, floorSpecks: 6,
    },
    inlay: {
      // Spokes dropped: a one-texel spoke either side of the point is a three-texel
      // plus that swallows the point it was meant to decorate. A star here is a white
      // texel and a ring of glow, which is what a star that small looks like.
      stars: [2, 4], inset: 5, spoke: 0, glowR: 2,
      // Fluting at half 144's world spacing, because the pair is stuck at two texels
      // wide: keeping the spacing would put half the face under a stripe.
      fluteStep: 8, fluteStart: 3, ridgeFreq: 0.08, ringR: [8, 5],
    },
  },
};

/**
 * 18 texels per unit, the floor of the phase — a wall of 18x19.
 *
 * Four courses. Each one is five texels: a lit texel, three of stone, a shadowed
 * texel. Blocks are six to nine wide with a lit column on the left and a shadowed
 * one on the right, so a brick is a four-to-seven by three field of one tone inside
 * a two-tone frame. That is three ramp indices and it is a brick — but only because
 * nothing else is competing for those texels, which is what most of this entry is
 * about.
 *
 * DROPPED here, not shrunk: the grain (per-texel noise on an 18-texel wall is
 * speckle, and it was fighting the bevel for the same texels), the wall crack
 * (`len: 0` — a four-texel crack is indistinguishable from a mortar joint), the
 * hanging moss strands and the root, the bone inlay (already gone at 36), the grease
 * drips, the floor pits (a radius-one ellipse draws a five-texel plus, which is a
 * shape no pit has), the waterline's drips and its algae speckle, the ceiling specks,
 * the foundry's floor grit, and the vault's fluting.
 *
 * What survives is what has a silhouette rather than a texture: the tide mark, the
 * moss line, the soot, the iron plate with three rivets a side, one lava seam, one
 * gold ring, two stars.
 */
const STEP_18: StepArt = {
  ppu: 18,
  spritePpu: 36,
  wall: {
    base: 0.62,
    masonry: {
      rowH: 5,
      blockW: [[6, 9], [7, 11]],
      gap: 0,
      bevel: 0.22,
      litTop: [1],
      litLeft: [0.7],
      darkBottom: [1.4],
      darkRight: [1.1],
      jitter: 0.1,
      stagger: 1,
      wobble: 0,
      // Low, not high: this noise is sampled once per BLOCK, and a block is seven
      // texels wide here, so the doubling that keeps a per-texel frequency honest
      // makes neighbouring bricks unrelated instead of quarried from the same stone.
      noiseFreq: 0.22,
      noiseAmt: 0.12,
    },
    grain: { freq: 0.4, amount: 0 },
    ao: { top: 0.22, bottom: 0.15, sides: 0.1 },
    crack: { len: [0, 0], inset: 2, top: 1, bottom: 4 },
  },
  floor: {
    base: 0.635,
    // Three or four slabs across the tile, joint one texel, on the boundary. Four is
    // the floor: at five the joints take a fifth of the surface and the slabs stop
    // having an inside.
    cellFreq: 0.2,
    blendFreq: 0.07,
    blend: 0.1,
    jointW: 0.42,
    jointDepth: 0.26,
    crownGain: -3,
    crownMax: 0.14,
    grain: { freq: 0.4, amount: 0 },
    // Lighter than the finer steps'. This is the tile-boundary seam and it has to
    // stay, but 0.34 over five texels of an eighteen-texel tile is a vignette that
    // leaves the flagstones nowhere to be seen.
    ao: { top: 0.26, bottom: 0.26, sides: 0.26 },
  },
  ceil: {
    base: 0.34,
    archLift: 0.2,
    archSlope: 1.5,
    blendFreq: 0.06,
    blend: 0.11,
    masonry: {
      rowH: 5,
      blockW: [[7, 10], [7, 10]],
      gap: 0,
      bevel: 0.17,
      litTop: [1],
      litLeft: [0.7],
      darkBottom: [1.4],
      darkRight: [1.1],
      jitter: 0.06,
      stagger: 1,
      wobble: 0,
      noiseFreq: 0.22,
      noiseAmt: 0.12,
    },
    ao: { top: 0.15, bottom: 0.15, sides: 0.15 },
    // Three, not two. The beam is drawn as wood with a dark keyline top and bottom,
    // so at two texels the keylines meet and it is a black stripe; at three there is
    // one row of timber between them and it reads as a beam.
    beamH: 3,
  },
  crack: { core: 0.5, side: 0, below: 0, branchChance: 0, branchLen: 0.45 },
  sconce: { w: 26, h: 40 },
  detail: {
    waterline: {
      lineFrac: 0.6, lineJitter: 1, waveFreq: 0.5, waveAmp: 0.9,
      noiseFreq: 0.16, noiseAmp: 1.1, algae: 0, algaeFreq: 0.3,
      drips: [0, 0], dripMin: 2, floorFreq: 0.055, ceilSpecks: 0,
    },
    bone: {
      sootReach: 1, sootSpread: 4, sootFreq: 0.07, inset: 3,
      // Inlay dropped entirely — both `femurLen[1]` and `skullRx` sit under the gates
      // in `wallDetail`. The soot down the top of the wall and the bone shards on the
      // floor are what says ossuary at this size.
      femurLen: [0, 0], femurW: 0.8, knuckleR: 0.8, knuckleRy: 0.8, knuckleGap: 0.8,
      skullRx: 0, skullRy: 0, jawW: 0, jawH: 0,
      eyeR: 0, eyeRy: 0, eyeGap: 0, teethSpan: 0, teethStep: 1, teethDrop: 0,
      greaseDrips: 0, greaseLen: [1, 3],
      // Half a texel of width, so `taper` sets single texels instead of stamping
      // three-wide ellipses: a bone shard here is a one-texel line or it is a blob.
      floorBones: 3, floorBoneReach: 2, floorBoneW: 0.5,
      floorPits: 0, floorPitR: [1, 1], floorPitRy: [1, 1],
    },
    moss: {
      // The moss mask has to be COARSER than the grid, not finer: at a frequency near
      // one the fbm is white noise and the moss becomes a flat green band with a
      // straight top edge. Two or three lumps across the wall is the whole feature.
      reach: 2, spread: 5, reachFreq: 0.07, mossFreq: 0.09,
      rootLen: [0, 0], strands: 0, strandLen: [1, 2], floorFreq: 0.06,
    },
    rivet: {
      plateInset: 1, rivetStep: 6, rivetStart: 2, rivetInset: 1, rivetR: 0.5,
      seams: [1, 1], seamLen: [2, 4], glowR: [2, 3],
      // One bar and one lit channel. The bar pattern is anchored to the tile and the
      // channel's position is rolled, so at THREE rows the grate came out as
      // bar-lava-bar or lava-bar-lava depending on the roll, and the second is a pair
      // of half-channels open to the floor. Two rows is the height that cannot land
      // wrong.
      grateH: 2, grateTop: 3, grateBar: 1, grateGlow: 5, floorSpecks: 0,
    },
    inlay: {
      // ONE star, so there is no channel to draw between two of them. Two points on an
      // eighteen-texel face land within a few texels of each other often enough, and
      // when they do the hairline joining them is an eight-texel gold bar across the
      // brickwork. A constellation at this size is a single glint in the stone.
      stars: [1, 1], inset: 4, spoke: 0, glowR: 1.5,
      // One ring, and half the tile across rather than three quarters — the inner one
      // is dropped by the gate in `buildFloor` when it would touch the outer.
      fluteStep: 0, fluteStart: 0, ridgeFreq: 0.05, ringR: [4, 4],
    },
  },
};

export const STEP_ART: Record<PixelStep, StepArt> = {
  144: STEP_144,
  72: STEP_72,
  36: STEP_36,
  18: STEP_18,
};

/**
 * The live step.
 *
 * Module state rather than a parameter threaded through every generator, because
 * the generators are called from six places that have no business knowing about a
 * display setting, and the value is read only while a texture is being built —
 * `main.ts` writes it once at boot from the save, and once per change, and rebuilds
 * immediately after. There is no window in which a half-built floor could see two
 * densities.
 */
let active: PixelStep = DEFAULT_STEP;

export function pixelStep(): PixelStep { return active; }

/** Set the density. The CALLER rebuilds — see `Floor.restep`. */
/**
 * DEAD. Kept as the seam the art tooling sets when it renders a roster at another
 * density; nothing in the GAME calls it, and the setting it used to back is gone.
 */
export function setPixelStep(s: PixelStep): void { active = s; }

/** Texels per world unit, at the current step. */
export function ppu(): number { return STEP_ART[active].ppu; }

/** Every absolute-texel constant the generators need, at the current step. */
export function stepArt(): StepArt { return STEP_ART[active]; }
