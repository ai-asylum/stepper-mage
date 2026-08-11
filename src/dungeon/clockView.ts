/**
 * The floor's clock, drawn: blades, spikes, trapdoors and the countdown on a gate.
 *
 * A hazard the player cannot read is not a hazard, it is a random subtraction from
 * their health — and this phase's entire claim is that a beat you can COUNT turns
 * "where do I stand" into a second question. So the drawing carries the whole rule:
 * three states per hazard, and the state has to be legible from across the room at a
 * glance, in torchlight, on a brown floor.
 *
 * What makes each state read:
 *  - **LIVE is bright and hard-edged.** Steel, near-white, with a black rim — the one
 *    combination the dungeon's palette never produces on its own.
 *  - **WINDING is the same shape at a third of the size**, so the eye reads it as the
 *    same object rather than as a different tile, and reads it as coming.
 *  - **IDLE is a socket**: the slot the thing lives in, dark, still drawn. A tile that
 *    went completely blank between beats would be a tile the player forgets, and
 *    forgetting is what the wind-up exists to prevent.
 *
 * Built the way `FireView` is built and for the same reasons — procedural `Pix` frames
 * on pooled quads a hair above the floor — because that pattern needs no PNG, restyles
 * itself at every pixel step, and already solves z-fighting and pooling.
 */
import * as THREE from 'three';
import { Pix, rgba } from '../art/pixel';
import { ppu } from '../art/steps';
import { STEP_H, WALL_H } from '../art/tiles';
import { DIR_VEC, Surface, hazardState, type Grid, type HazardState } from './grid';

/** How far above the floor plane a quad sits. Enough to beat z-fighting, no more. */
const LIFT = 0.014;

/** Card sizes for the two hazards that are objects rather than decals. */
const SPIKE_H = 0.42;
const BLADE_W = 0.95;
const BLADE_H = 0.9;
/** How deep an open trapdoor is drawn. Not how far you FALL — see `hazardBites`. */
const SHAFT_D = 3.2;
/** How far a ladder's stiles stand proud of the lip they lean on. */
const LADDER_OVER = 0.22;

const STATES: readonly HazardState[] = ['live', 'winding', 'idle'];

/** How far a spike card stands proud of the floor, per state. Buried, tip, all of it. */
const SPIKE_UP: Record<HazardState, number> = { idle: 0, winding: 0.3, live: 1 };
/**
 * Where the pendulum hangs, per state, as a FRACTION of its full swing.
 *
 * Live is nought — straight down, through the tile — and that is the whole shape of
 * it: the blade is only dangerous at the bottom of its arc, which is the one place a
 * pendulum obviously is dangerous. Idle parks it right out at the end of the swing and
 * winding is the way back in.
 *
 * The SIGN alternates every cycle, so consecutive swings go to opposite sides and the
 * blade travels all the way through the tile rather than bouncing off the middle. That
 * was the first version's mistake: it swung out and came back to the same side, which
 * is not a pendulum, it is a windscreen wiper with one blade.
 */
const BLADE_SWING: Record<HazardState, number> = { idle: 1, winding: 0.55, live: 0 };
/** Full swing, radians. Wide enough that the arc clears the tile on both sides. */
const BLADE_AMP = 1.15;
/** How fast a hazard eases toward its target, per frame. */
const EASE = 0.14;

const STEEL = rgba(226, 232, 238);
const STEEL_DIM = rgba(128, 138, 150);
const RIM = rgba(12, 10, 14);
const BRASS = rgba(255, 194, 62);

/**
 * A BED OF SPIKES, drawn as a standing card that rises through the floor.
 *
 * The first version was a floor decal — nine pale dots that got bigger — and from a
 * standing camera that is not spikes, it is spots on the ground. Spikes are the one
 * hazard whose entire meaning is VERTICAL: the danger is that they came UP, so the
 * drawing has to have height and has to move through the floor plane rather than
 * change colour on it.
 *
 * Roots at the bottom of the card so the quad can simply be pushed down through the
 * floor to retract, which is what gives the three states for free: buried, half out,
 * all the way out.
 */
function spikeCard(n: number): Pix {
  const p = new Pix(n, n);
  const steel = rgba(206, 214, 222);
  const edge = rgba(255, 255, 255);
  const dark = rgba(74, 80, 88);
  const cx = (n - 1) / 2;
  const halfW = n * 0.3;
  const tip = n * 0.04;
  /**
   * ONE spike, billboarded, because sixteen of them make the bed.
   *
   * The first version drew a ROW of four on one card and crossed two cards — which
   * gives you four spikes from the front, four from the side, and a visible seam
   * where the two sheets intersect. A bed of spikes has to look the same from every
   * approach, and the only way a flat card does that is if each spike is its own
   * card turning to face you.
   */
  for (let y = Math.round(tip); y < n; y++) {
    const k = (y - tip) / (n - tip);
    const w = halfW * k;
    for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) {
      if (x < 0 || x >= n) continue;
      const side = (x - cx) / (w || 1);
      p.set(x, y, side < -0.2 ? edge : side > 0.3 ? dark : steel);
    }
  }
  return p;
}

/**
 * A PENDULUM BLADE: a crescent on a shaft, hanging from the ceiling.
 *
 * Not billboarded, unlike everything else on a card in this game, and that is the
 * whole point — a blade swings in a PLANE, and a quad that turns to face the camera
 * can never show a swing. It is fixed across the corridor and pivots about its top
 * edge, so from either end of the passage you watch it sweep past you.
 *
 * Drawn with the pivot at the very top of the card, because the mesh is rotated about
 * that edge: the shaft has to reach the ceiling at every angle or the blade detaches
 * and hangs in the air.
 */
function bladePix(n: number): Pix {
  const p = new Pix(n, n);
  const steel = rgba(214, 222, 230);
  const edge = rgba(255, 255, 255);
  const dark = rgba(66, 72, 80);
  const brass = rgba(150, 116, 52);

  // the shaft, from the top of the card down to the hub
  const sx = Math.round(n / 2), sw = Math.max(1, Math.round(n * 0.05));
  const hubY = Math.round(n * 0.62);
  p.rect(sx - sw, 0, sw * 2, hubY, dark);
  p.rect(sx - sw, 0, Math.max(1, sw), hubY, steel);
  p.ellipse(sx, hubY, Math.max(2, n * 0.07), Math.max(2, n * 0.07), brass);

  // the crescent: a wide arc below the hub, thin at the tips and thick in the middle
  const r = n * 0.34;
  for (let y = hubY; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x - sx) / r, dy = (y - hubY) / r;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1 || d < 0.55) continue;
      // the cutting edge is the OUTSIDE of the arc — one bright texel of it
      p.set(x, y, d > 0.92 ? edge : d > 0.66 ? steel : dark);
    }
  }
  return p;
}

/**
 * The inside of a shaft: masonry at the lip, fading to black a few courses down.
 *
 * An open trapdoor without this is a black quadrilateral lying on the floor, which is
 * exactly what a rendering error looks like — the same complaint the bottomless pits
 * got, and for the same reason. A hole is only read as a hole if you can see the
 * WALLS of it, because the walls are what carry the perspective; without them there
 * is no depth cue at all and the eye files it as a decal.
 *
 * Only the top of the shaft is drawn as stone. Below that it goes to nothing, which
 * is both cheaper than lighting a pit nobody will ever stand in and the more honest
 * picture: what is down there is not modelled, so the drawing should stop rather than
 * invent a floor.
 */
function shaftPix(n: number): Pix {
  const p = new Pix(n, n);
  const stone = rgba(78, 72, 66);
  const dark = rgba(38, 35, 33);
  for (let y = 0; y < n; y++) {
    // full stone for the first courses, then down to black over the rest
    const k = Math.max(0, 1 - Math.max(0, y - n * 0.12) / (n * 0.55));
    for (let x = 0; x < n; x++) {
      // a coarse block bond, so the shaft has a scale you can read the drop against
      const course = Math.floor(y / Math.max(2, n * 0.16));
      const jog = (course % 2) * 0.5;
      const bx = (x / Math.max(2, n * 0.24)) + jog;
      const seam = (bx % 1) < 0.08 || (y % Math.max(2, Math.round(n * 0.16))) === 0;
      const c = seam ? dark : stone;
      const a = Math.round(255 * k);
      if (a <= 0) continue;
      p.set(x, y, ((c & 0x00ffffff) | (a << 24)) >>> 0);
    }
  }
  return p;
}

/**
 * THE SOCKETS the spikes come out of: a 4x4 grid of slots cut into the tile.
 *
 * Without them the bed of spikes is sixteen cones standing on an unbroken flagstone,
 * which is not a trap — it is a decoration somebody put on the floor. A trap has to
 * be readable in the state where it is NOT armed, because that is the state the
 * player has to make the decision in: the whole mechanic is walking onto a tile in
 * the gap between beats, and you cannot choose to do that if the safe tile looks
 * exactly like the safe tile next to it.
 *
 * So the holes are drawn on every state and never move. They are the permanent half
 * of the hazard — the part that says something comes up HERE — and the spikes are the
 * half that arrives. Each slot is a touch wider than the spike that fills it, with a
 * bright lip on the near edge and black inside, which is the only way a hole reads as
 * a hole on a floor lit this flatly.
 */
function socketTile(n: number): Pix {
  const p = new Pix(n, n);
  const dark = rgba(10, 9, 12);
  const lip = rgba(120, 126, 134);
  const shade = rgba(52, 50, 54);
  // matched to the bed: four across, on the same 0.226-of-a-tile pitch
  const pitch = n / 4;
  const r = Math.max(2, Math.round(pitch * 0.3));
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const cx = (i + 0.5) * pitch, cy = (j + 0.5) * pitch;
      p.ellipse(cx, cy, r + 1, r + 1, shade);
      p.ellipse(cx, cy, r, r, dark);
      // the lip catches the light on the far side, which is where a chamfer would
      p.ellipse(cx, cy - r * 0.55, r * 0.8, Math.max(1, r * 0.22), lip);
      p.ellipse(cx, cy - r * 0.55, r * 0.6, Math.max(1, r * 0.14), dark);
    }
  }
  return p;
}

/**
 * A TRAPDOOR stays a floor decal, because it genuinely is one.
 *
 * Two leaves that part on a hole. This is the one hazard whose danger is the ABSENCE
 * of floor, so drawing it flat is correct rather than a compromise — and the live
 * state is the only thing in the room darker than the room, which is what makes a
 * hole read as a hole.
 */
function trapTile(n: number, state: HazardState): Pix {
  const p = new Pix(n, n);
  const leaf = rgba(96, 88, 80);
  const band = rgba(52, 48, 44);
  const VOIDC = rgba(4, 3, 5);
  const inset = Math.round(n * 0.1), span = n - inset * 2;
  if (state === 'live') {
    /**
     * THE HOLE IS LEFT EMPTY, not filled with black.
     *
     * A black quad lying in the floor plane is the thing that made an open trapdoor
     * read as a rendering fault: it has no perspective in it, so the eye files it as
     * a decal rather than as a void. The shaft walls under it are the depth, and they
     * can only be seen if the lid gets out of the way — so the live state draws the
     * LIP and nothing else, and what you look through it at is the masonry going down.
     */
    p.frame(inset, inset, span, span, band);
    p.frame(inset + 1, inset + 1, span - 2, span - 2, VOIDC);
  } else {
    const gap = state === 'winding' ? Math.max(2, Math.round(n * 0.16)) : 1;
    const half = Math.round((span - gap) / 2);
    p.rect(inset, inset, span, half, leaf);
    p.rect(inset, inset + half + gap, span, half, leaf);
    p.rect(inset, inset + half, span, gap, VOIDC);
    p.frame(inset, inset, span, span, band);
    // hinge bands, so it reads as two doors rather than as two grey rectangles
    for (const bx of [inset + Math.round(span * 0.25), inset + Math.round(span * 0.7)]) {
      p.rect(bx, inset, Math.max(1, Math.round(n * 0.05)), half, band);
      p.rect(bx, inset + half + gap, Math.max(1, Math.round(n * 0.05)), half, band);
    }
  }
  return p;
}

/** The blade's mark on the floor: a soft dark smear along the line of the sweep. */
function bladeShadow(n: number): Pix {
  const p = new Pix(n, n);
  const cx = (n - 1) / 2, cy = (n - 1) / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x - cx) / (n * 0.42);
      const dy = (y - cy) / (n * 0.17);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) continue;
      p.set(x, y, rgba(0, 0, 0, Math.round(150 * (1 - d) ** 1.3)));
    }
  }
  return p;
}

/**
 * A LADDER, drawn to hang on the face of a ledge.
 *
 * It shipped as a floor texture and looked exactly like what it was: a picture of a
 * ladder lying on the ground. A ladder is the one object in the game whose entire
 * meaning is the vertical face it is leaning against, so it is drawn as a tall card
 * and hung on the riser — and its stiles run off the top of the card on purpose, so
 * they can poke above the lip the way a real one does.
 */
function ladderPix(n: number): Pix {
  const p = new Pix(n, n);
  const wood = rgba(122, 86, 48);
  const lit = rgba(178, 134, 78);
  const dark = rgba(48, 32, 16);
  const inset = Math.max(1, Math.round(n * 0.2));
  const sw = Math.max(1, Math.round(n * 0.09));
  // two stiles, full height
  for (const sx of [inset, n - 1 - inset - sw]) {
    p.rect(sx, 0, sw, n, wood);
    p.rect(sx, 0, Math.max(1, Math.round(sw * 0.45)), n, lit);
    p.rect(sx + sw - 1, 0, 1, n, dark);
  }
  // rungs across them
  /**
   * FIVE OR SIX RUNGS, not twenty.
   *
   * The card is stretched to whatever drop it serves, so the rung COUNT is fixed in
   * the texture and has to read at the height it ends up — and a rung every few
   * centimetres reads as a grille, not a ladder. Spaced about a foot apart at the
   * height a single level actually is.
   */
  const rungs = Math.max(3, Math.round(n / 26));
  const rh = Math.max(1, Math.round(n * 0.055));
  for (let r = 0; r < rungs; r++) {
    const y = Math.round(((r + 0.5) / rungs) * n - rh / 2);
    p.rect(inset, y, n - inset * 2 - sw, rh, lit);
    p.rect(inset, y + rh, n - inset * 2 - sw, 1, dark);
  }
  return p;
}

/**
 * The countdown, drawn as PIPS rather than as a number.
 *
 * A digit at this texel density is three pixels tall and unreadable, and a number in
 * the log is a number the player has to remember while being chased. Pips are
 * countable at a glance and they shorten visibly, which is the one property the
 * mechanic actually needs: not "how many" but "how much less than last turn".
 */
function pipStrip(n: number, turns: number, span: number): Pix {
  const p = new Pix(n, n);
  if (turns <= 0) return p;
  const cells = Math.max(1, Math.min(8, span));
  const cw = n / cells;
  const h = Math.max(2, Math.round(n * 0.34));
  const y = Math.round((n - h) / 2);
  for (let i = 0; i < cells; i++) {
    const lit = i < turns;
    const x = Math.round(i * cw + cw * 0.18);
    const w = Math.max(1, Math.round(cw * 0.64));
    p.rect(x, y, w, h, lit ? BRASS : rgba(48, 40, 30));
  }
  p.outline(RIM, false, true);
  return p;
}

/**
 * A shut portcullis: vertical bars with a heavy head-beam.
 *
 * Drawn as a standing quad rather than as geometry, so opening and shutting costs a
 * texture swap instead of rebuilding the floor — a gate on a five-turn countdown
 * would otherwise rebuild the whole floor mesh twice per press. It reads as a gate
 * because of the two things a wall never has: gaps you can see the room through, and
 * a horizontal beam across the top that the bars hang from.
 */
function portcullis(n: number): Pix {
  const p = new Pix(n, n);
  /**
   * THE GAPS ARE THE GATE, and the first version had none.
   *
   * It asked for `n / 6` bars and made each one `n * 0.07` wide, which at the step
   * this game actually runs (`ppu()` is 72) is twelve bars on a six-texel pitch at
   * five texels wide — a one-texel gap. Then it ran an eight-neighbour `outline` over
   * the result, and an eight-neighbour outline closes a one-texel gap. The portcullis
   * came out a solid sheet of steel with a grain on it, which is why it read as a
   * wall with the alpha broken rather than as bars.
   *
   * So the pitch and the bar are now derived from each other rather than picked
   * separately: the bar takes a THIRD of its pitch and the other two thirds are the
   * hole. That ratio survives any step — at the coarsest it is one texel of bar to
   * two of air, and at the finest it is the same picture with more texels in it.
   * There is no outline pass at all; the rim is drawn INTO each bar, where it cannot
   * bleed into the gap beside it.
   */
  const BARS = 7;
  const pitch = n / BARS;
  const w = Math.max(1, Math.round(pitch / 3));
  const top = Math.round(n * 0.12);

  /** One horizontal tie, thin. A portcullis is a grid; a fence is not a gate. */
  const tie = (y: number, h: number): void => {
    p.rect(0, y, n, h, STEEL_DIM);
    p.rect(0, y, n, Math.max(1, Math.round(h / 3)), STEEL);
  };

  for (let b = 0; b < BARS; b++) {
    const x = Math.round((b + 0.5) * pitch - w / 2);
    p.rect(x, top, w, n - top, STEEL_DIM);
    // the lit edge, one texel of it, and the shadow side the same
    p.rect(x, top, 1, n - top, STEEL);
    p.rect(x + w - 1, top, 1, n - top, RIM);
    // a spiked foot, so the bottom edge is not a straight line of nothing
    p.ellipse(x + w / 2, n - 2, Math.max(1, w * 0.9), Math.max(1, n * 0.025), STEEL);
  }

  // two ties, placed off-centre so the grille does not read as a chessboard
  tie(Math.round(n * 0.38), Math.max(1, Math.round(n * 0.035)));
  tie(Math.round(n * 0.74), Math.max(1, Math.round(n * 0.035)));

  // the lintel the whole thing hangs from — the one part that IS solid
  p.rect(0, 0, n, top, rgba(74, 68, 60));
  p.rect(0, 0, n, Math.max(1, Math.round(n * 0.04)), STEEL_DIM);
  p.rect(0, top - 1, n, 1, RIM);
  return p;
}

export class ClockView {
  readonly group = new THREE.Group();
  private frames = new Map<string, THREE.Texture>();
  private pips: THREE.Texture[] = [];
  private bars: THREE.Texture | null = null;
  private ladder: THREE.Texture | null = null;
  private geo: THREE.PlaneGeometry;
  private pipGeo: THREE.PlaneGeometry;
  private barGeo: THREE.PlaneGeometry;
  private barGeoTop: THREE.PlaneGeometry;
  private shaftGeo: THREE.PlaneGeometry;
  /**
   * How far the BOSS DOOR has been raised, 0 shut to 1 gone.
   *
   * Driven by the cutscene rather than by the rule: the gate is unlocked the moment
   * the last lever is thrown, and this is the several seconds it takes to physically
   * grind out of the way while somebody watches.
   */
  doorLift = 0;
  private bossBars: THREE.Mesh | null = null;
  private pool: THREE.Mesh[] = [];
  private live = 0;
  private spikeGeo: THREE.PlaneGeometry;
  private bladeGeo: THREE.PlaneGeometry;
  /** Everything `update` animates between beats. Rebuilt by `sync`. */
  private moving: {
    mesh: THREE.Mesh; kind: 'spikes' | 'blade';
    base: number; across?: boolean; target: number; at: number; shadow?: THREE.Mesh;
    billboard?: boolean;
  }[] = [];
  /** Which way each blade is swinging, flipped every time its cycle wraps. */
  private swingDir = new Map<number, number>();
  private lastBeat = new Map<number, number>();
  private shadow: THREE.Texture | null = null;
  /**
   * How many pips the strip can show. Covers both readers — the longest gate
   * countdown and the most sockets a boss door has — so the frames are built once.
   */
  private span = 8;

  constructor() {
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.geo.rotateX(-Math.PI / 2);
    this.pipGeo = new THREE.PlaneGeometry(0.86, 0.3);
    this.barGeo = new THREE.PlaneGeometry(1, 1.05);
    // A second, TOP-ANCHORED copy: a portcullis retracts upward into its slot, so the
    // quad has to shrink from the bottom with its head-beam staying put.
    this.barGeoTop = new THREE.PlaneGeometry(1, 1.05);
    this.barGeoTop.translate(0, -1.05 / 2, 0);
    // the trapdoor's shaft: as wide as the hole in `trapTile`, hung from its lip
    this.shaftGeo = new THREE.PlaneGeometry(0.8, SHAFT_D);
    this.shaftGeo.translate(0, -SHAFT_D / 2, 0);
    this.spikeGeo = new THREE.PlaneGeometry(0.2, SPIKE_H);
    // bottom-pivoted, so pushing it down buries it in the floor
    this.spikeGeo.translate(0, SPIKE_H / 2, 0);
    this.bladeGeo = new THREE.PlaneGeometry(BLADE_W, BLADE_H);
    // TOP-pivoted: the mesh rotates about its hanging point, like a pendulum
    this.bladeGeo.translate(0, -BLADE_H / 2, 0);
    this.build();
  }

  private build(): void {
    const n = Math.max(8, Math.round(ppu()));
    // the trapdoor is the only hazard still drawn per state — the other two are
    // objects that MOVE, so one drawing each and the state is a transform
    for (const st of STATES) this.frames.set(`trapdoor:${st}`, trapTile(n, st).toTexture());
    this.frames.set('spikes', spikeCard(n).toTexture());
    this.frames.set('sockets', socketTile(n).toTexture());
    this.frames.set('shaft', shaftPix(n).toTexture());
    this.frames.set('blade', bladePix(n).toTexture());
    for (let t = 0; t <= this.span; t++) this.pips.push(pipStrip(n, t, this.span).toTexture());
    this.bars = portcullis(n).toTexture();
    this.shadow = bladeShadow(n).toTexture();
    this.ladder = ladderPix(n).toTexture();
  }

  /** Re-author at a new texel density. See `DungeonView.restep`. */
  restep(): void {
    for (const t of this.frames.values()) t.dispose();
    for (const t of this.pips) t.dispose();
    this.bars?.dispose();
    this.ladder?.dispose();
    this.shadow?.dispose();
    this.frames.clear();
    this.pips = [];
    this.build();
  }

  /**
   * Put a quad in the room's LIGHT, which a `MeshBasicMaterial` will never do on its
   * own.
   *
   * Basic materials are unlit by definition — that is what makes them cheap and it is
   * why every card in this file uses one — but unlit means every gate, spike and blade
   * in the dungeon was drawn at full brightness whatever the torches were doing. A
   * portcullis forty tiles away in an unlit corridor came out the brightest object on
   * the screen, visible straight through the dark it was supposed to be hiding in.
   *
   * The fix is the one lever a basic material does have: `color` multiplies the map.
   * Feed it the same per-tile light the floor under it is built with and the quad
   * sits in the room instead of on top of it. A floor of ambient, because a hazard
   * that goes completely black is a hazard the player steps on.
   */
  private lit(m: THREE.Mesh, g: Grid, x: number, y: number, k = 1): void {
    const l = Math.max(0.07, g.lightAt(x, y)) * k;
    (m.material as THREE.MeshBasicMaterial).color.setScalar(l);
  }

  private take(): THREE.Mesh {
    if (this.live < this.pool.length) {
      const m = this.pool[this.live++];
      m.visible = true;
      return m;
    }
    const mat = new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, alphaTest: 0.02, fog: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(this.geo, mat);
    this.group.add(m);
    this.pool.push(m);
    this.live++;
    return m;
  }

  /**
   * Re-place every quad from the grid's current state.
   *
   * Called when the clock ticks and when a plate is pressed, never per frame: none of
   * this animates between beats, on purpose. A hazard that eased between its states
   * would be a hazard whose state is ambiguous for most of the turn, and the player is
   * making a decision on exactly that reading.
   */
  sync(g: Grid): void {
    this.live = 0;
    this.bossBars = null;

    /**
     * Hazards are OBJECTS now, not decals, so each kind is placed differently and
     * `update` animates it between beats. What `sync` does is decide the TARGET;
     * the movement toward it happens per frame, because a blade that teleported
     * between three angles once a turn is not a swinging blade.
     */
    this.moving.length = 0;
    for (const h of g.hazards) {
      const state = hazardState(h);
      const e = g.heightAt(h.x, h.y) * STEP_H;

      if (h.kind === 'trapdoor') {
        /**
         * The shaft is drawn in EVERY state, not only the open one.
         *
         * The floor has a permanent hole in it here (see `render`), so the masonry
         * going down is what is behind the leaves at all times. Skipping it while the
         * lid is shut saves four quads and costs a strip of void showing through the
         * seam between the leaves at a grazing angle, which is the one artefact this
         * whole exercise exists to get rid of.
         */
        {
          for (let f = 0; f < 4; f++) {
            const [dx, dy] = DIR_VEC[f];
            const m = this.take();
            const mat = m.material as THREE.MeshBasicMaterial;
            mat.map = this.frames.get('shaft') ?? null;
            mat.opacity = 1;
            mat.needsUpdate = true;
            m.geometry = this.shaftGeo;
            m.rotation.set(0, dx !== 0 ? Math.PI / 2 : 0, 0);
            // on the lip of the hole `trapTile` cuts, hanging down from the floor
            m.position.set(h.x + dx * 0.4, e - 0.002, h.y + dy * 0.4);
            // a shade under the room, so the hole is darker than the floor round it
            this.lit(m, g, h.x, h.y, 0.55);
          }
        }
        const m = this.take();
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.map = this.frames.get(`trapdoor:${state}`) ?? null;
        mat.opacity = 1;
        mat.needsUpdate = true;
        m.geometry = this.geo;
        m.rotation.set(0, 0, 0);
        m.position.set(h.x, e + LIFT, h.y);
        this.lit(m, g, h.x, h.y);
        continue;
      }

      if (h.kind === 'spikes') {
        // the slots, always, in every state — see `socketTile`
        {
          const m = this.take();
          const mat = m.material as THREE.MeshBasicMaterial;
          mat.map = this.frames.get('sockets') ?? null;
          mat.opacity = 1;
          mat.needsUpdate = true;
          m.geometry = this.geo;
          m.rotation.set(0, 0, 0);
          m.position.set(h.x, e + LIFT, h.y);
          this.lit(m, g, h.x, h.y);
        }
        // a four-by-four bed, each spike its own billboard so the grid reads the
        // same from every approach
        for (let j = 0; j < 4; j++) {
          for (let i = 0; i < 4; i++) {
            const m = this.take();
            const mat = m.material as THREE.MeshBasicMaterial;
            mat.map = this.frames.get('spikes') ?? null;
            mat.opacity = 1;
            mat.needsUpdate = true;
            m.geometry = this.spikeGeo;
            m.position.set(h.x - 0.34 + i * 0.226, e, h.y - 0.34 + j * 0.226);
            this.lit(m, g, h.x, h.y);
            this.moving.push({
              mesh: m, kind: 'spikes', base: e,
              target: SPIKE_UP[state], at: SPIKE_UP[state], billboard: true,
            });
          }
        }
        continue;
      }

      /**
       * A blade: one plane hanging across the passage, pivoting from the ceiling, and
       * a SHADOW on the floor under it.
       *
       * The shadow is not decoration — it is the only part of the hazard you can read
       * while you are looking at where your feet are going to be. The blade itself is
       * up at head height and off to one side; the mark on the floor is what says
       * "the sweep passes through HERE, and it is over there right now".
       */
      const across = g.walkable(h.x - 1, h.y) || g.walkable(h.x + 1, h.y);
      const key = g.idx(h.x, h.y);
      let dir = this.swingDir.get(key) ?? 1;
      if (h.beat === 0 && this.lastBeat.get(key) !== 0) dir = -dir;
      this.swingDir.set(key, dir);
      this.lastBeat.set(key, h.beat);

      const m = this.take();
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map = this.frames.get('blade') ?? null;
      mat.opacity = 1;
      mat.needsUpdate = true;
      m.geometry = this.bladeGeo;
      /**
       * Hung one wall-height above ITS OWN tile, not from the room's ceiling.
       *
       * The room's ceiling clears the highest floor in the place, so in anywhere with
       * a terrace in it the blade was hanging a storey and a half up with a long bare
       * shaft holding it. A blade guards a tile; it hangs over that tile at the height
       * a ceiling would be there.
       */
      m.position.set(h.x, e + WALL_H, h.y);
      this.lit(m, g, h.x, h.y);

      const sh = this.take();
      const smat = sh.material as THREE.MeshBasicMaterial;
      smat.map = this.shadow;
      smat.opacity = 1;
      smat.needsUpdate = true;
      sh.geometry = this.geo;
      sh.rotation.set(0, across ? Math.PI / 2 : 0, 0);
      sh.position.set(h.x, e + LIFT, h.y);
      this.lit(sh, g, h.x, h.y);

      this.moving.push({
        mesh: m, kind: 'blade', base: 0, across, shadow: sh,
        target: BLADE_SWING[state] * dir, at: BLADE_SWING[state] * dir,
      });
    }

    for (const d of g.doors) {
      const x = d.i % g.w, y = (d.i / g.w) | 0;
      const e = g.heightAt(x, y) * STEP_H;
      /**
       * A portcullis hangs ACROSS the passage, so it is turned to face along it. The
       * gate tile has exactly two open neighbours by construction (see `placeGate`),
       * which is the axis — a gate rotated the other way would be a sheet of bars you
       * walk through the plane of.
       */
      const across = g.walkable(x - 1, y) || g.walkable(x + 1, y);

      if (d.turns <= 0) {
        const m = this.take();
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.map = this.bars;
        mat.opacity = 1;
        mat.needsUpdate = true;
        m.geometry = this.barGeo;
        m.rotation.set(0, across ? Math.PI / 2 : 0, 0);
        m.position.set(x, e + 0.52, y);
        this.lit(m, g, x, y);
        continue;
      }

      const m = this.take();
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map = this.pips[Math.max(0, Math.min(this.span, d.turns))] ?? null;
      mat.opacity = 1;
      mat.needsUpdate = true;
      m.geometry = this.pipGeo;
      /**
       * ON the gate and standing up, not on the floor by it. The countdown has to be
       * readable from the side of the door you are still on, which a floor decal in a
       * doorway is not — you would be reading it off the tile you are trying to reach.
       */
      m.rotation.set(0, across ? Math.PI / 2 : 0, 0);
      m.position.set(x, e + 0.86, y);
      this.lit(m, g, x, y);
    }

    /**
     * LADDERS, hung on the ledge they climb.
     *
     * The tile carries the RULE (`Surface.Ladder` is what `canClimb` reads) and this
     * carries the picture, on the face of whichever neighbour is higher. Sized to the
     * drop it serves, and pushed a little proud of the lip so the stiles show over the
     * top from above — which is the only view from which the ladder is a decision.
     */
    for (let y = 1; y < g.h - 1; y++) {
      for (let x = 1; x < g.w - 1; x++) {
        if (g.surfaceAt(x, y) !== Surface.Ladder) continue;
        const e = g.heightAt(x, y) * STEP_H;
        for (const [dx, dy] of DIR_VEC) {
          const nx = x + dx, ny = y + dy;
          if (!g.walkable(nx, ny)) continue;
          const ne = g.heightAt(nx, ny) * STEP_H;
          if (ne <= e) continue;
          const rise = ne - e;
          const m = this.take();
          const mat = m.material as THREE.MeshBasicMaterial;
          mat.map = this.ladder;
          mat.opacity = 1;
          mat.needsUpdate = true;
          m.geometry = this.geo;
          // scale the unit quad to the drop, standing upright on the shared edge
          m.scale.set(0.62, 1, rise + LADDER_OVER);
          m.rotation.set(-Math.PI / 2, 0, dy !== 0 ? 0 : Math.PI / 2);
          m.position.set(
            x + dx * 0.47,
            e + (rise + LADDER_OVER) / 2,
            y + dy * 0.47,
          );
          this.lit(m, g, x, y);
          break;
        }
      }
    }

    /**
     * THE BOSS DOOR AND ITS SOCKETS.
     *
     * The same bars as a timed gate, because it is the same object as far as the
     * player's feet are concerned — and the same pips, reading how many levers are
     * still out there. What it never shows is WHERE they are: the count turns
     * exploring into something you can finish, and a location would turn it into an
     * errand somebody set you.
     *
     * The pips stay up after it opens, all lit. A door that forgot what it cost is a
     * door that never cost anything.
     */
    const bd = g.bossDoor;
    if (bd) {
      const x = bd.i % g.w, y = (bd.i / g.w) | 0;
      const e = g.heightAt(x, y) * STEP_H;
      const across = g.walkable(x - 1, y) || g.walkable(x + 1, y);
      if (!g.doorOpen[bd.i] || this.doorLift < 1) {
        const m = this.take();
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.map = this.bars;
        mat.opacity = 1;
        mat.needsUpdate = true;
        m.geometry = this.barGeoTop;
        m.rotation.set(0, across ? Math.PI / 2 : 0, 0);
        // top-anchored: the head-beam sits where the ceiling is, bars hang below
        m.position.set(x, e + 0.52 + 1.05 / 2, y);
        this.lit(m, g, x, y);
        this.bossBars = m;
      }
      const m = this.take();
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map = this.pips[Math.max(0, Math.min(this.span, bd.pulled.size))] ?? null;
      mat.opacity = 1;
      mat.needsUpdate = true;
      m.geometry = this.pipGeo;
      m.rotation.set(0, across ? Math.PI / 2 : 0, 0);
      m.position.set(x, e + 0.94, y);
      this.lit(m, g, x, y);
    }

    for (let i = this.live; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  /**
   * Ease every moving hazard toward the pose its beat asks for.
   *
   * Per frame, and this is the half that makes a hazard READ. The rule is discrete —
   * three states, one tick a turn — but a blade that jumped between three angles is
   * a blade nobody can see swing, and spikes that popped between three heights are
   * three sprites rather than one thing coming out of the floor. The target is always
   * the state's own pose, so nothing here can disagree with the rule; it only decides
   * how long the trip takes.
   */
  update(cam?: THREE.Vector3): void {
    // The gate, mid-grind. Scaled from its head-beam so the bars retract upward.
    if (this.bossBars) {
      const k = Math.max(0, 1 - this.doorLift);
      this.bossBars.scale.set(1, k, 1);
      this.bossBars.visible = k > 0.02;
    }
    for (const m of this.moving) {
      m.at += (m.target - m.at) * EASE;
      if (m.kind === 'spikes') {
        // buried at 0, fully proud at 1 — the quad slides up through the floor
        m.mesh.position.y = m.base - SPIKE_H * (1 - m.at) + LIFT;
        if (m.billboard && cam) m.mesh.rotation.y = Math.atan2(cam.x - m.mesh.position.x, cam.z - m.mesh.position.z);
      } else {
        const ang = m.at * BLADE_AMP;
        m.mesh.rotation.set(0, m.across ? Math.PI / 2 : 0, ang);
        /**
         * The shadow tracks the TIP, not the pivot, so it slides across the tile as
         * the blade sweeps and sits dead centre exactly when the blade is down. It
         * also shrinks as the blade rises, which is what a shadow does and what makes
         * the centred one read as "now".
         */
        if (m.shadow) {
          const off = Math.sin(ang) * 0.55;
          const p = m.shadow.position;
          /**
           * ALONG THE SWING, which is the axis the blade's plane lies in — and it was
           * the other one. `across` says the passage runs along X, and a blade in
           * that passage sweeps ACROSS it, along Z; the shadow was being slid along X
           * instead, so it tracked at right angles to the thing casting it.
           */
          if (m.across) p.setZ(m.mesh.position.z + off);
          else p.setX(m.mesh.position.x + off);
          const k = 1 - Math.abs(m.at) * 0.45;
          m.shadow.scale.set(k, 1, k);
          (m.shadow.material as THREE.MeshBasicMaterial).opacity = 0.35 + (1 - Math.abs(m.at)) * 0.5;
        }
      }
    }
  }

  dispose(): void {
    for (const m of this.pool) (m.material as THREE.Material).dispose();
    for (const t of this.frames.values()) t.dispose();
    for (const t of this.pips) t.dispose();
    this.bars?.dispose();
    this.ladder?.dispose();
    this.shadow?.dispose();
    this.geo.dispose();
    this.pipGeo.dispose();
    this.barGeo.dispose();
    this.barGeoTop.dispose();
    this.shaftGeo.dispose();
    this.spikeGeo.dispose();
    this.bladeGeo.dispose();
    this.pool.length = 0;
    this.group.clear();
  }
}
