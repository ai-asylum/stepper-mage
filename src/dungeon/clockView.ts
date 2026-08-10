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
import { STEP_H } from '../art/tiles';
import { hazardState, type Grid, type HazardKind, type HazardState } from './grid';

/** How far above the floor plane a quad sits. Enough to beat z-fighting, no more. */
const LIFT = 0.014;

const KINDS: readonly HazardKind[] = ['blade', 'spikes', 'trapdoor'];
const STATES: readonly HazardState[] = ['live', 'winding', 'idle'];

const STEEL = rgba(226, 232, 238);
const STEEL_DIM = rgba(128, 138, 150);
const SOCKET = rgba(38, 34, 40);
const RIM = rgba(12, 10, 14);
const VOID = rgba(6, 5, 8);
const BRASS = rgba(255, 194, 62);

/**
 * One frame of one hazard.
 *
 * Drawn from directly above, because that is what a floor quad is, and every shape
 * here is chosen to survive that projection: a blade is a LINE, spikes are a GRID of
 * points, a trapdoor is a SQUARE that becomes a hole. Three silhouettes nobody can
 * confuse at eight tiles.
 */
function hazardTile(n: number, kind: HazardKind, state: HazardState): Pix {
  const p = new Pix(n, n);
  const mid = (n - 1) / 2;

  // The socket is always there, so the tile never goes blank between beats.
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const edge = Math.min(x, y, n - 1 - x, n - 1 - y);
      if (edge < Math.max(1, n * 0.08)) p.set(x, y, SOCKET);
    }
  }

  if (kind === 'blade') {
    // A sweep across the tile. Live is the full span at full width; winding is a
    // stub of the same line, so the eye reads the same object about to move.
    const reach = state === 'live' ? 0.46 : state === 'winding' ? 0.16 : 0.06;
    const w = state === 'live' ? Math.max(1, n * 0.13) : Math.max(1, n * 0.07);
    const col = state === 'live' ? STEEL : STEEL_DIM;
    p.taper(mid - n * reach, mid, mid + n * reach, mid, w, w, col);
    if (state === 'live') {
      // a bright edge along the top of the sweep — a blade has a side that cuts
      p.taper(mid - n * reach, mid - Math.max(1, n * 0.05), mid + n * reach,
        mid - Math.max(1, n * 0.05), Math.max(1, n * 0.04), Math.max(1, n * 0.04), rgba(255, 255, 255));
    }
  } else if (kind === 'spikes') {
    // A grid of points. Live is a full spike, winding is the tip only, idle is the
    // hole it comes out of — three sizes of the same nine marks.
    const r = state === 'live' ? Math.max(1, n * 0.1)
      : state === 'winding' ? Math.max(1, n * 0.05) : Math.max(1, n * 0.03);
    const col = state === 'live' ? STEEL : state === 'winding' ? STEEL_DIM : SOCKET;
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const cx = n * (0.25 + i * 0.25), cy = n * (0.25 + j * 0.25);
        p.ellipse(cx, cy, r, r, col);
        if (state === 'live') p.ellipse(cx, cy - r * 0.4, r * 0.45, r * 0.45, rgba(255, 255, 255));
      }
    }
  } else {
    // A trapdoor: two leaves that part. Live is a hole, which is the one thing on a
    // floor that is DARKER than the floor — nothing else in the room reads as absence.
    if (state === 'live') {
      p.rect(Math.round(n * 0.12), Math.round(n * 0.12),
        Math.round(n * 0.76), Math.round(n * 0.76), VOID);
    } else {
      const gap = state === 'winding' ? Math.max(1, n * 0.08) : 1;
      const half = Math.round((n * 0.76 - gap) / 2);
      p.rect(Math.round(n * 0.12), Math.round(n * 0.12), Math.round(n * 0.76), half, STEEL_DIM);
      p.rect(Math.round(n * 0.12), Math.round(n * 0.12) + half + gap,
        Math.round(n * 0.76), half, STEEL_DIM);
      if (state === 'winding') {
        p.rect(Math.round(n * 0.12), Math.round(n * 0.12) + half, Math.round(n * 0.76), gap, VOID);
      }
    }
  }

  p.frame(0, 0, n, n, RIM);
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
  const bars = Math.max(3, Math.round(n / 6));
  const w = Math.max(1, Math.round(n * 0.07));
  for (let b = 0; b < bars; b++) {
    const x = Math.round(((b + 0.5) / bars) * n - w / 2);
    p.rect(x, Math.round(n * 0.1), w, n - Math.round(n * 0.1), STEEL_DIM);
    p.rect(x, Math.round(n * 0.1), Math.max(1, Math.round(w * 0.4)),
      n - Math.round(n * 0.1), STEEL);
    // a spiked foot, so the bottom edge is not a straight line of nothing
    p.ellipse(x + w / 2, n - 1, w * 0.7, Math.max(1, n * 0.03), STEEL);
  }
  p.rect(0, 0, n, Math.max(2, Math.round(n * 0.12)), rgba(74, 68, 60));
  p.rect(0, 0, n, Math.max(1, Math.round(n * 0.04)), STEEL_DIM);
  p.outline(RIM, false, true);
  return p;
}

export class ClockView {
  readonly group = new THREE.Group();
  private frames = new Map<string, THREE.Texture>();
  private pips: THREE.Texture[] = [];
  private bars: THREE.Texture | null = null;
  private geo: THREE.PlaneGeometry;
  private pipGeo: THREE.PlaneGeometry;
  private barGeo: THREE.PlaneGeometry;
  private pool: THREE.Mesh[] = [];
  private live = 0;
  /** The longest countdown any door on this floor has, so the pips are built once. */
  private span = 6;

  constructor() {
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.geo.rotateX(-Math.PI / 2);
    this.pipGeo = new THREE.PlaneGeometry(0.86, 0.3);
    this.barGeo = new THREE.PlaneGeometry(1, 1.05);
    this.build();
  }

  private build(): void {
    const n = Math.max(8, Math.round(ppu()));
    for (const k of KINDS) {
      for (const s of STATES) this.frames.set(`${k}:${s}`, hazardTile(n, k, s).toTexture());
    }
    for (let t = 0; t <= this.span; t++) this.pips.push(pipStrip(n, t, this.span).toTexture());
    this.bars = portcullis(n).toTexture();
  }

  /** Re-author at a new texel density. See `DungeonView.restep`. */
  restep(): void {
    for (const t of this.frames.values()) t.dispose();
    for (const t of this.pips) t.dispose();
    this.bars?.dispose();
    this.frames.clear();
    this.pips = [];
    this.build();
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

    for (const h of g.hazards) {
      const m = this.take();
      const mat = m.material as THREE.MeshBasicMaterial;
      const state = hazardState(h);
      mat.map = this.frames.get(`${h.kind}:${state}`) ?? null;
      mat.opacity = 1;
      mat.needsUpdate = true;
      m.geometry = this.geo;
      m.rotation.set(0, 0, 0);
      m.position.set(h.x, g.heightAt(h.x, h.y) * STEP_H + LIFT, h.y);
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
    }

    for (let i = this.live; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  dispose(): void {
    for (const m of this.pool) (m.material as THREE.Material).dispose();
    for (const t of this.frames.values()) t.dispose();
    for (const t of this.pips) t.dispose();
    this.bars?.dispose();
    this.geo.dispose();
    this.pipGeo.dispose();
    this.barGeo.dispose();
    this.pool.length = 0;
    this.group.clear();
  }
}
