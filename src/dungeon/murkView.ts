/**
 * A fog bank, as actual fog: soft billboards hanging in the air.
 *
 * The first version tinted the floor and the walls toward grey and called it weather.
 * It was not weather — it was a desaturated rectangle with a hard shoreline, and it
 * read as a rendering fault rather than as something in the room. The mistake is worth
 * naming because it is easy to make again: FOG IS A VOLUME, and nothing you do to the
 * surfaces of a room can produce one. A surface tint has no parallax, no depth
 * sorting, nothing between you and the wall, and no reason to move.
 *
 * So this is what fog actually needs, and each of the four does a job the tint could
 * not:
 *
 *  - **It hangs IN THE AIR, in layers.** Several billboards per tile at different
 *    heights and depths, so walking through the bank slides them past each other. That
 *    parallax is most of what makes it read as volume rather than as paint.
 *  - **It OCCLUDES.** The cards are between the camera and the wall, so the wall goes
 *    away behind them rather than changing colour. That is the difference between
 *    "hidden" and "greyed out".
 *  - **It DRIFTS.** Slow, per-card, on its own phase. Motion is what the eye finds in
 *    a dark room and it is what separates fog from a stain on the floor.
 *  - **It is LIT like everything else.** The cards take the room's illuminance, so a
 *    bank is dark where the room is dark and glows where a torch reaches into it. An
 *    unlit fog is a white sheet hanging in a black corridor.
 *
 * Built on the `FireView` pattern — pooled quads, procedural `Pix` frames, no PNG, and
 * it re-authors itself at every pixel step.
 */
import * as THREE from 'three';
import { Pix, rgba } from '../art/pixel';
import { ppu } from '../art/steps';
import { STEP_H, WALL_H } from '../art/tiles';
import { Surface, type Grid } from './grid';

/** How many billboards per fogged tile. Enough to layer, few enough to draw. */
const PER_TILE = 3;
/** Frames of drift, cycled per card on its own phase. */
const FRAMES = 3;
/** A card is wider than a tile so the bank has no seams between its columns. */
const CARD_W = 2.1;
const CARD_H = 1.5;

/**
 * One puff: a soft blob with NO hard edge anywhere.
 *
 * Every other card in this game has a black keyline, because everything else is an
 * object and a keyline is what makes an object read. Fog is the exception and must
 * have none — an outlined cloud is a balloon. The alpha falls off to nothing at the
 * rim, which is also what lets three of them overlap into something thicker rather
 * than into three visible shapes.
 */
function puff(n: number, frame: number): Pix {
  const p = new Pix(n, n);
  const rnd = (x: number, y: number): number => {
    const s = Math.sin(x * 127.1 + y * 311.7 + frame * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const cx = (n - 1) / 2, cy = (n - 1) / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // an ellipse wider than it is tall — fog lies in sheets, it does not ball up
      const dx = (x - cx) / (n * 0.5);
      const dy = (y - cy) / (n * 0.34);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) continue;
      // lumpy edge, so no two cards have the same silhouette
      const lump = 0.72 + rnd((x >> 1) + frame, y >> 1) * 0.4;
      if (d > lump) continue;
      const a = Math.round(150 * (1 - d / lump) ** 1.6);
      if (a < 6) continue;
      const v = 200 + Math.round(rnd(x, y) * 40);
      p.set(x, y, rgba(v, v + 4, v + 10, a));
    }
  }
  return p;
}

export class MurkView {
  readonly group = new THREE.Group();
  private frames: THREE.Texture[] = [];
  private geo: THREE.PlaneGeometry;
  private pool: THREE.Mesh[] = [];
  private live = 0;
  /** Per-card drift seed, so no two move together. */
  private phase: number[] = [];
  private home: THREE.Vector3[] = [];

  constructor() {
    this.geo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    this.build();
  }

  private build(): void {
    const n = Math.max(12, Math.round(ppu()));
    for (let f = 0; f < FRAMES; f++) this.frames.push(puff(n, f).toTexture());
  }

  restep(): void {
    for (const t of this.frames) t.dispose();
    this.frames = [];
    this.build();
    for (const m of this.pool) (m.material as THREE.MeshBasicMaterial).map = this.frames[0];
  }

  private take(): THREE.Mesh {
    if (this.live < this.pool.length) {
      const m = this.pool[this.live++];
      m.visible = true;
      return m;
    }
    const mat = new THREE.MeshBasicMaterial({
      map: this.frames[0],
      transparent: true,
      // No depth write, so cards never occlude EACH OTHER into hard edges — they are
      // meant to accumulate. They still depth-TEST, so a wall in front of the bank
      // still hides it.
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(this.geo, mat);
    m.renderOrder = 3;
    this.group.add(m);
    this.pool.push(m);
    this.live++;
    return m;
  }

  /** Rebuild the bank from the grid. Called when the floor is built, not per frame. */
  sync(g: Grid): void {
    this.live = 0;
    this.phase.length = 0;
    this.home.length = 0;

    for (let y = 1; y < g.h - 1; y++) {
      for (let x = 1; x < g.w - 1; x++) {
        if (g.surfaceAt(x, y) !== Surface.Fog) continue;
        const e = g.heightAt(x, y) * STEP_H;
        for (let k = 0; k < PER_TILE; k++) {
          const m = this.take();
          // deterministic scatter, so the bank does not reshuffle on every rebuild
          const s = Math.sin(x * 12.9 + y * 78.2 + k * 37.7) * 43758.5;
          const r1 = s - Math.floor(s);
          const r2 = (s * 3.7) - Math.floor(s * 3.7);
          const hx = x + (r1 - 0.5) * 0.9;
          const hz = y + (r2 - 0.5) * 0.9;
          const hy = e + 0.25 + k * (WALL_H * 0.28) + r1 * 0.15;
          m.position.set(hx, hy, hz);
          m.scale.setScalar(0.8 + r2 * 0.6);
          (m.material as THREE.MeshBasicMaterial).map = this.frames[k % FRAMES];
          this.phase.push(r1 * 6.283);
          this.home.push(new THREE.Vector3(hx, hy, hz));
        }
      }
    }
    for (let i = this.live; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  /**
   * Billboard, drift, and take the room's light.
   *
   * The light is read per card from the baked grid rather than from a shader, because
   * these are unlit `MeshBasicMaterial` quads — cheap, and they have to be, since a
   * bank is a few hundred of them. Multiplying the material colour by the tile's own
   * illuminance is the same answer the world shader reaches by a longer route.
   */
  update(time: number, cam: THREE.Vector3, g: Grid, torch: THREE.Color, ambient: number): void {
    for (let i = 0; i < this.live; i++) {
      const m = this.pool[i];
      const h = this.home[i];
      const ph = this.phase[i];
      m.position.set(
        h.x + Math.sin(time * 0.21 + ph) * 0.18,
        h.y + Math.sin(time * 0.17 + ph * 1.7) * 0.05,
        h.z + Math.cos(time * 0.18 + ph * 0.8) * 0.18,
      );
      m.lookAt(cam.x, m.position.y, cam.z);

      const tx = Math.round(m.position.x), tz = Math.round(m.position.z);
      const baked = g.inside(tx, tz) ? g.lightAt(tx, tz) : 0;
      // the player's own torch, falling off the same way the world's does
      const d = Math.hypot(m.position.x - cam.x, m.position.z - cam.z);
      const t = Math.max(0, 1 - Math.max(d, 0.85) / 7);
      const lit = Math.min(1.25, ambient + baked * 0.55 + t * t * 1.3);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setRGB(torch.r * lit, torch.g * lit, torch.b * lit);
      /**
       * FADE OUT THE ONES YOU ARE INSIDE. A card a few centimetres from the lens is a
       * grey wall stapled to the camera, which is the single worst thing a fog volume
       * can do — so they thin as you push into them and the bank stays a place you can
       * move through rather than a screen effect.
       */
      mat.opacity = Math.min(1, Math.max(0, (d - 0.35) / 0.9)) * 0.85;
    }
  }

  /**
   * `live` FIRST, and it is the whole of a crash rather than tidiness.
   *
   * `update` walks `pool[0..live)` every frame. Emptying the pool and leaving the
   * count behind means the very next frame dereferences a mesh that is not there — and
   * a floor is disposed at the top of `enterFloor`, which then awaits the next one
   * being built, so every frame of every floor change ran against the corpse. It
   * looked intermittent because it needed a bank of fog to have been drawn.
   *
   * `FireView` has always got this right and the three views written from it did not.
   */
  dispose(): void {
    this.live = 0;
    for (const m of this.pool) (m.material as THREE.Material).dispose();
    for (const t of this.frames) t.dispose();
    this.geo.dispose();
    this.pool.length = 0;
    this.group.clear();
  }
}
