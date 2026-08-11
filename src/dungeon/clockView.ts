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
import { loadSprite } from './sprites';

/** How far above the floor plane a quad sits. Enough to beat z-fighting, no more. */
const LIFT = 0.014;

/** Card sizes for the two hazards that are objects rather than decals. */
/**
 * Sizes taken from the GENERATED art's own aspect, not chosen and then drawn to.
 *
 * These were hand-plotted `Pix` and the numbers were picked to suit them. The art is
 * now Scenario's, and a generated sprite has an aspect of its own — a 19x98 spike is
 * a stake and a 0.2x0.42 quad is a cone. The height is the design decision and the
 * width follows from the file, so nothing is stretched.
 */
const SPIKE_H = 0.55;
const SPIKE_ASPECT = 19 / 98;
const BLADE_H = 1.0;
const BLADE_ASPECT = 64 / 130;
const BLADE_W = BLADE_H * BLADE_ASPECT;
/** How deep an open trapdoor is drawn. Not how far you FALL — see `hazardBites`. */
const SHAFT_D = 3.2;
/** How far a ladder's stiles stand proud of the lip they lean on. */
const LADDER_OVER = 0.22;


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

export class ClockView {
  readonly group = new THREE.Group();
  private frames = new Map<string, THREE.Texture>();
  /**
   * The five hazard props, generated rather than plotted.
   *
   * They arrive asynchronously, which is why every one of them is a nullable field
   * read at draw time instead of a texture built in `build`. A quad whose map is
   * still null simply draws nothing for a frame or two on the floor it first appears
   * on, which is the same deal every sprite in the game already takes — and the
   * alternative is holding the floor up while five PNGs come off the disk.
   *
   * NOT re-authored per pixel step by this class: `loadSprite` picks the roster for
   * the current density itself, exactly as it does for every creature and prop, so
   * `restep` only has to ask again.
   */
  private art: Partial<Record<'gate' | 'spike' | 'blade' | 'ladder' | 'trapdoor', THREE.Texture>> = {};
  private geo: THREE.PlaneGeometry;
  private barGeo: THREE.PlaneGeometry;
  private barGeoTop: THREE.PlaneGeometry;
  private shaftGeo: THREE.PlaneGeometry;
  /**
   * How far each door is DRAWN, per tile, which is not the same as how far it is.
   *
   * `Grid.doorLift` is the rule and changes the instant a lever is thrown. This is
   * the picture, and it lags — a cut flies to the door and then winds this from the
   * old position to the new one over a couple of seconds, so the player watches the
   * thing move instead of finding it moved. Between cuts the two agree.
   *
   * A map rather than one number, because a floor has a boss door and a gate on it
   * and they are not the same door.
   */
  private lift = new Map<number, number>();
  private barMesh = new Map<number, THREE.Mesh>();

  /** Where a door should be DRAWN. Driven by the cut; see `showDoor` in main. */
  setLift(i: number, k: number): void {
    this.lift.set(i, Math.max(0, Math.min(1, k)));
    const m = this.barMesh.get(i);
    if (m) this.applyLift(m, this.lift.get(i) ?? 0);
  }

  /** What the drawing believes, falling back to the rule for a door nobody has cut to. */
  private liftOf(g: Grid, i: number): number {
    return this.lift.get(i) ?? g.doorLift[i];
  }

  private applyLift(m: THREE.Mesh, k: number): void {
    const h = Math.max(0, 1 - k);
    m.scale.set(1, h, 1);
    m.visible = h > 0.02;
  }
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

  constructor() {
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.geo.rotateX(-Math.PI / 2);
    this.barGeo = new THREE.PlaneGeometry(1, 1.05);
    // A second, TOP-ANCHORED copy: a portcullis retracts upward into its slot, so the
    // quad has to shrink from the bottom with its head-beam staying put.
    this.barGeoTop = new THREE.PlaneGeometry(1, 1.05);
    this.barGeoTop.translate(0, -1.05 / 2, 0);
    // the trapdoor's shaft: as wide as the hole in `trapTile`, hung from its lip
    this.shaftGeo = new THREE.PlaneGeometry(0.8, SHAFT_D);
    this.shaftGeo.translate(0, -SHAFT_D / 2, 0);
    this.spikeGeo = new THREE.PlaneGeometry(SPIKE_H * SPIKE_ASPECT, SPIKE_H);
    // bottom-pivoted, so pushing it down buries it in the floor
    this.spikeGeo.translate(0, SPIKE_H / 2, 0);
    this.bladeGeo = new THREE.PlaneGeometry(BLADE_W, BLADE_H);
    // TOP-pivoted: the mesh rotates about its hanging point, like a pendulum
    this.bladeGeo.translate(0, -BLADE_H / 2, 0);
    this.build();
  }

  private build(): void {
    const n = Math.max(8, Math.round(ppu()));
    /**
     * What is still authored here, and why each one earns it.
     *
     * The five OBJECTS — gate, spike, blade, ladder, trapdoor — are generated art
     * and come in through `loadArt`. What is left is the three things that are not
     * objects: two tiling SURFACES, which is the same category as every wall and
     * floor in `tiles.ts` and is procedural there for the same reason, and one soft
     * shadow, which is an alpha gradient rather than a drawing of anything.
     */
    this.frames.set('sockets', socketTile(n).toTexture());
    this.frames.set('shaft', shaftPix(n).toTexture());
    this.shadow = bladeShadow(n).toTexture();
    void this.loadArt();
  }

  /**
   * Fetch the generated props for the CURRENT pixel step.
   *
   * Fire and forget on purpose: each texture lands in `this.art` when it lands, and
   * the draw reads whatever is there. A missing one costs a frame of an invisible
   * hazard on the floor it first appears on and never blocks the floor being built.
   */
  private async loadArt(): Promise<void> {
    const want = ['gate', 'spike', 'blade', 'ladder', 'trapdoor'] as const;
    await Promise.all(want.map(async (id) => {
      try { this.art[id] = await loadSprite(id); } catch { /* draws nothing */ }
    }));
  }

  /** Re-author at a new texel density. See `DungeonView.restep`. */
  restep(): void {
    for (const t of this.frames.values()) t.dispose();
    this.shadow?.dispose();
    this.frames.clear();
    // The generated props are NOT disposed: `loadSprite` owns and caches them per
    // step, and this class is one of several holders of the same texture.
    this.art = {};
    this.build();
  }

  /**
   * ONE PORTCULLIS DRAW, for the boss door and for a plate's gate alike.
   *
   * They were two blocks doing the same thing badly in two different ways — one
   * centred on a fixed quad and one top-anchored, so a gate and a boss door on the
   * same floor hung at different heights. To the player's feet they are the same
   * object, and now they are the same drawing: bars hung from the lintel, retracting
   * upward into it by however far this door has been wound.
   */
  private drawDoor(g: Grid, i: number, x: number, y: number, e: number, across: boolean): void {
    const k = this.liftOf(g, i);
    if (k >= 0.99) { this.barMesh.delete(i); return; }
    const m = this.take();
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.map = this.art.gate ?? null;
    mat.opacity = 1;
    mat.needsUpdate = true;
    m.geometry = this.barGeoTop;
    m.rotation.set(0, across ? Math.PI / 2 : 0, 0);
    // hung from the lintel, so what retracts is the bottom edge
    m.position.set(x, e + WALL_H, y);
    this.lit(m, g, x, y);
    this.applyLift(m, k);
    this.barMesh.set(i, m);
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
    // kept, because `update` re-applies it every frame with the distance falloff on
    m.userData.lit = l;
    (m.material as THREE.MeshBasicMaterial).color.setScalar(l);
  }

  /**
   * THE SAME FALLOFF THE ROOM HAS. Applied per frame, because it depends on where
   * you are standing.
   *
   * Every quad in this file is a `MeshBasicMaterial` with `fog: false`, so the
   * dungeon's exponential fog — the thing that takes a corridor down to almost
   * nothing forty tiles out — never touched any of them. The room receded and the
   * gate did not, so a portcullis at the far end of a dark passage came out as a
   * bright white rectangle floating in the black: the single most visible object on
   * the screen, at the greatest possible distance, which is the exact inverse of
   * what it should be.
   *
   * Matched to `uFogDensity` in `render` rather than guessed. Approximated as a
   * multiply toward black instead of a mix toward the fog colour, which is the one
   * thing a basic material's `color` can do — and at the distances where the
   * difference would show, both answers are indistinguishable from dark.
   */
  private static readonly FOG_DENSITY = 0.016;

  private refog(cam: THREE.Vector3): void {
    for (let k = 0; k < this.live; k++) {
      const m = this.pool[k];
      const base = m.userData.lit as number | undefined;
      if (base === undefined) continue;
      const dx = m.position.x - cam.x, dy = m.position.y - cam.y, dz = m.position.z - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const f = Math.exp(-ClockView.FOG_DENSITY * d2);
      (m.material as THREE.MeshBasicMaterial).color.setScalar(base * f);
    }
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
    this.barMesh.clear();

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
        /**
         * THE LID, and the three states are what it is DOING rather than three
         * drawings of it.
         *
         * There used to be a `trapTile` per state, which is three pictures of the
         * same object that have to agree with each other by hand. The generated art
         * is one shut trapdoor, and a double-leaf trapdoor opening is the two leaves
         * swinging DOWN — which from directly above is exactly a squash toward the
         * seam. So idle is the lid at full size, winding is the same lid at a third
         * of its width, and live does not draw it at all: the leaves are hanging
         * straight down inside the shaft, and what you look at is the hole.
         *
         * Which also means the lid can never disagree with itself, and the open state
         * is the one that costs nothing to draw.
         */
        if (state !== 'live') {
          const m = this.take();
          const mat = m.material as THREE.MeshBasicMaterial;
          mat.map = this.art.trapdoor ?? null;
          mat.opacity = 1;
          mat.needsUpdate = true;
          m.geometry = this.geo;
          m.rotation.set(0, 0, 0);
          m.scale.set(state === 'winding' ? 0.34 : 1, 1, 1);
          m.position.set(h.x, e + LIFT, h.y);
          this.lit(m, g, h.x, h.y);
        }
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
            mat.map = this.art.spike ?? null;
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
      mat.map = this.art.blade ?? null;
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

      this.drawDoor(g, d.i, x, y, e, across);

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
          mat.map = this.art.ladder ?? null;
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
     * THE BOSS DOOR. The same bars as a timed gate, because to the player's feet it
     * is the same object.
     *
     * NO PIP STRIP, on this door or on the timed one.
     *
     * Both carried one and both were wrong. On the boss door it was supposed to be
     * a lever counter and it was not even that: `pipStrip` always draws eight cells,
     * so a door with two levers showed eight boxes with at most two lit, and what
     * the player read was a countdown to something. On the timed gate it genuinely
     * was the countdown, and it still read as a row of abstract boxes bolted to a
     * portcullis — a readout, in a game that has no other readouts in the world.
     *
     * The information both were carrying is already said in words at the moment it
     * means anything: the log when you throw a lever, and the log when a plate is
     * pressed. What the doors themselves do is be shut or be open.
     */
    const bd = g.bossDoor;
    if (bd) {
      const x = bd.i % g.w, y = (bd.i / g.w) | 0;
      const e = g.heightAt(x, y) * STEP_H;
      const across = g.walkable(x - 1, y) || g.walkable(x + 1, y);
      this.drawDoor(g, bd.i, x, y, e, across);
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
    if (cam) this.refog(cam);
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
    this.shadow?.dispose();
    this.geo.dispose();
    this.barGeo.dispose();
    this.barGeoTop.dispose();
    this.shaftGeo.dispose();
    this.spikeGeo.dispose();
    this.bladeGeo.dispose();
    this.pool.length = 0;
    this.group.clear();
  }
}
