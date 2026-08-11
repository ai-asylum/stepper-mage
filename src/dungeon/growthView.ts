/**
 * The things that STAND UP out of a tile: broken stone, and briar.
 *
 * Both used to be paint. Rubble was a floor texture and bramble was an ember decal,
 * and a texture on the ground is something the eye files with the moss and the
 * flagstones — you read it as "this flagstone is a different colour", not as "there
 * is something in my way". Difficult terrain has to be an OBSTACLE at a glance, from
 * a standing camera, across a room, and the only thing in this engine that reads that
 * way is a thing with height. The spike bed already proved it: sixteen little cards
 * standing proud of the floor say "do not walk here" before a single rule is read.
 *
 * So this draws both as CROSSES — two quads at right angles, per clump, several
 * clumps to a tile. A cross rather than a billboard, deliberately: a billboard turns
 * to follow you, which is right for a flame (it has no facing) and wrong for a rock
 * (it does). Crossed quads hold still, occlude each other, and shift parallax against
 * one another as you walk past, which is what makes a patch read as a volume of stuff
 * rather than as one flat sticker per tile.
 */
import * as THREE from 'three';
import { Pix, rgba } from '../art/pixel';
import { ppu } from '../art/steps';
import type { Grid } from './grid';

/** What a clump is made of. */
export type GrowthKind = 'rubble' | 'plant';

/**
 * Clumps per tile, per axis. THREE for briar, TWO for rubble.
 *
 * Briar is many thin things and wants to look dense; rubble is a few heavy things and
 * a 3x3 of boulders reads as gravel rather than as a collapse. The difference is the
 * whole reason this is per-kind and not one constant.
 */
const GRID: Record<GrowthKind, number> = { rubble: 2, plant: 3 };

/**
 * How tall a clump stands, in world units. A tile is 1.
 *
 * KNEE HEIGHT, not chest height. At 0.52 a 3x3 of briar was a hedge: it read as
 * difficult terrain perfectly and it also hid the altar, the enemies and the far wall
 * behind it, which in a first-person game is the difference between terrain and a
 * blindfold. Low enough to see over, tall enough to occlude a body's feet and throw
 * parallax as you walk past, which is all the read needs.
 */
const HEIGHT: Record<GrowthKind, number> = { rubble: 0.3, plant: 0.38 };

/**
 * A broken slab, drawn as two or three angular chunks with a lit top face.
 *
 * Angular and not round: every rock in this game is chipped, and a smooth lump reads
 * as a mushroom. The top face is a lighter band along the upper edge, which is the
 * cheapest way to say "this is a solid with a top" on a single quad.
 */
function rubblePix(n: number, seed: number): Pix {
  const p = new Pix(n, n);
  const rnd = (k: number): number => {
    const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const dark = rgba(58, 50, 44);
  const body = rgba(112, 100, 88);
  const top = rgba(158, 144, 126);
  const rim = rgba(28, 22, 20);

  // two chunks, the taller one behind and offset, so the silhouette has a step in it
  const chunks = [
    { x: 0.30 + rnd(1) * 0.1, w: 0.36, h: 0.62 + rnd(2) * 0.22 },
    { x: 0.58 + rnd(3) * 0.1, w: 0.30, h: 0.40 + rnd(4) * 0.20 },
  ];
  for (const c of chunks) {
    const x0 = Math.round((c.x - c.w / 2) * n);
    const x1 = Math.round((c.x + c.w / 2) * n);
    const yTop = Math.round((1 - c.h) * n);
    for (let x = x0; x < x1; x++) {
      // a jagged crown rather than a flat one — a broken stone has no level edge
      const jag = Math.round(rnd(x * 3.1) * n * 0.09);
      for (let y = yTop + jag; y < n; y++) {
        const shade = y < yTop + jag + Math.max(1, n * 0.12) ? top : body;
        p.set(x, y, y > n - Math.max(1, n * 0.14) ? dark : shade);
      }
    }
  }
  p.outline(rim, false, true);
  return p;
}

/**
 * A briar tuft: a few blades fanning off a common root, with a thorn or two.
 *
 * Drawn as tapers from a single base point so the clump reads as one plant rather
 * than as three separate weeds standing in a row. The dark rim does the same job it
 * does on the flame card — it is the one value the brown room never produces, and it
 * is what keeps green legible against a wall lit by torchlight.
 */
function plantPix(n: number, seed: number): Pix {
  const p = new Pix(n, n);
  const rnd = (k: number): number => {
    const s = Math.sin(seed * 45.164 + k * 91.377) * 27183.311;
    return s - Math.floor(s);
  };
  const deep = rgba(34, 76, 48);
  const leaf = rgba(72, 148, 88);
  const bright = rgba(146, 220, 138);
  const rim = rgba(16, 32, 22);

  const baseX = 0.5 * n, baseY = n - 1;
  const blades = 5;
  for (let i = 0; i < blades; i++) {
    const t = i / (blades - 1);
    // fan from left to right, tallest through the middle
    const lean = (t - 0.5) * 0.78;
    const h = (0.55 + Math.sin(t * Math.PI) * 0.42) * (0.82 + rnd(i) * 0.3);
    const tipX = baseX + lean * n * 0.9;
    const tipY = n - h * n;
    const col = i % 2 === 0 ? leaf : deep;
    p.taper(baseX + (t - 0.5) * n * 0.16, baseY, tipX, tipY, n * 0.11, 0.5, col);
    // a highlight up the spine of every other blade, so the clump has depth
    if (i % 2 === 0) {
      p.taper(baseX + (t - 0.5) * n * 0.16, baseY - n * 0.08, tipX, tipY + n * 0.2,
        n * 0.05, 0.4, bright);
    }
  }
  // thorns: single texels off the outer blades, which is all a thorn needs to be
  for (let i = 0; i < 3; i++) {
    const x = Math.round((0.22 + rnd(10 + i) * 0.56) * n);
    const y = Math.round((0.30 + rnd(20 + i) * 0.45) * n);
    p.set(x, y, bright);
  }
  p.outline(rim, false, true);
  return p;
}

interface Clump { mesh: THREE.Mesh; kind: GrowthKind }

export class GrowthView {
  readonly group = new THREE.Group();
  private tex: Record<GrowthKind, THREE.Texture[]> = { rubble: [], plant: [] };
  private geo: Record<GrowthKind, THREE.PlaneGeometry>;
  private pool: Clump[] = [];
  private live = 0;

  constructor() {
    this.geo = {
      rubble: this.makeGeo('rubble'),
      plant: this.makeGeo('plant'),
    };
    this.build();
  }

  /** A quad standing ON the floor: pivot at the bottom edge, not the middle. */
  private makeGeo(kind: GrowthKind): THREE.PlaneGeometry {
    const h = HEIGHT[kind];
    const g = new THREE.PlaneGeometry(h, h);
    g.translate(0, h / 2, 0);
    return g;
  }

  private build(): void {
    const n = Math.max(8, Math.round(ppu() * HEIGHT.plant));
    // FOUR variants each, picked by tile so a patch is not the same rock repeated.
    // Four rather than one because a repeated silhouette is the single loudest tell
    // that a floor was generated, and rather than sixteen because nobody counts past
    // about three and every extra one is a texture.
    for (let i = 0; i < 4; i++) {
      this.tex.rubble.push(rubblePix(n, i + 1).toTexture());
      this.tex.plant.push(plantPix(n, i + 1).toTexture());
    }
  }

  /** Re-author at a new texel density. See `DungeonView.restep`. */
  restep(): void {
    for (const k of ['rubble', 'plant'] as const) {
      for (const t of this.tex[k]) t.dispose();
      this.tex[k] = [];
    }
    this.build();
  }

  private take(kind: GrowthKind, variant: number): THREE.Mesh {
    const existing = this.pool[this.live];
    const tex = this.tex[kind][variant % this.tex[kind].length];
    if (existing) {
      existing.kind = kind;
      existing.mesh.geometry = this.geo[kind];
      const mat = existing.mesh.material as THREE.MeshBasicMaterial;
      mat.map = tex;
      mat.needsUpdate = true;
      existing.mesh.visible = true;
      this.live++;
      return existing.mesh;
    }
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.5, depthWrite: true, fog: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.geo[kind], mat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.pool.push({ mesh, kind });
    this.live++;
    return mesh;
  }

  /**
   * Place every clump for this set of tiles.
   *
   * Called on the same beat the floor is re-culled, so it takes the whole set rather
   * than diffing: a patch of briar grows, burns and is swept every few rounds, and a
   * diff over something that churns that hard is more state to get wrong than the
   * rebuild costs.
   */
  sync(g: Grid, tiles: Iterable<{ i: number; kind: GrowthKind }>): void {
    this.live = 0;
    for (const { i, kind } of tiles) {
      const tx = i % g.w, ty = (i / g.w) | 0;
      const per = GRID[kind];
      const light = Math.max(0.07, g.lightAt(tx, ty));
      for (let j = 0; j < per; j++) {
        for (let k = 0; k < per; k++) {
          // Deterministic per tile AND per slot, so a patch does not reshuffle itself
          // every time the floor re-culls — which would read as the rubble twitching.
          const h = Math.sin(i * 37.7 + j * 11.3 + k * 5.1) * 43758.5453;
          const r = h - Math.floor(h);
          const h2 = Math.sin(i * 91.1 + j * 3.7 + k * 17.9) * 27183.3;
          const r2 = h2 - Math.floor(h2);
          // spread across the tile with a jitter, so the grid never shows
          const step = 1 / per;
          const ox = (j + 0.5) * step - 0.5 + (r - 0.5) * step * 0.55;
          const oz = (k + 0.5) * step - 0.5 + (r2 - 0.5) * step * 0.55;

          /**
           * TWO QUADS AT RIGHT ANGLES — the cross. One card is a sticker that
           * vanishes edge-on; two crossed hold a silhouette from every approach, and
           * that is the whole reason this is not a billboard.
           */
          for (let q = 0; q < 2; q++) {
            const m = this.take(kind, Math.floor(r * 4));
            m.position.set(tx + ox, 0.001, ty + oz);
            m.rotation.set(0, q === 0 ? 0 : Math.PI / 2, 0);
            m.scale.setScalar(0.72 + r2 * 0.5);
            (m.material as THREE.MeshBasicMaterial).color.setScalar(light);
          }
        }
      }
    }
    for (let i = this.live; i < this.pool.length; i++) this.pool[i].mesh.visible = false;
  }

  dispose(): void {
    for (const { mesh } of this.pool) (mesh.material as THREE.MeshBasicMaterial).dispose();
    for (const k of ['rubble', 'plant'] as const) {
      for (const t of this.tex[k]) t.dispose();
      this.geo[k].dispose();
    }
    this.group.clear();
    this.pool.length = 0;
  }
}
