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
import { loadSprite } from './sprites';
import type { Grid } from './grid';

/**
 * THE PLANTS ARE DRAWN ART, not code.
 *
 * Rubble stays procedural — it is broken masonry, it wants to match the wall it fell
 * off, and four `Pix` chunks do that better than a drawing would. The plants do not:
 * grass and briar have to be told apart INSTANTLY across a lit room, because one of
 * them costs a turn to cross and the other is scenery, and hand-plotted tapers made
 * two green tufts that differed only in height. These come through `art/manifest.json`
 * and `tools/genart.py` like every other sprite in the game.
 */
const PLANT_ART: Partial<Record<GrowthKind, string>> = {
  plant: 'terrain_grass',
  briar: 'terrain_briar',
};

/**
 * What a clump is made of.
 *
 * `plant` is the undergrowth a cast throws around itself and `briar` is the thicket
 * on the tile it was aimed at. Two things at once, never two stages of one thing:
 * the briar is what holds a body, the plant is what carries fire to it, and the
 * player has to be able to see which tile is which from across the room.
 */
export type GrowthKind = 'rubble' | 'plant' | 'briar';

/**
 * Clumps per tile, per axis. THREE for green things, TWO for rubble.
 *
 * Briar is many thin things and wants to look dense; rubble is a few heavy things and
 * a 3x3 of boulders reads as gravel rather than as a collapse. The difference is the
 * whole reason this is per-kind and not one constant.
 */
const GRID: Record<GrowthKind, number> = { rubble: 2, plant: 3, briar: 2 };

/**
 * How tall a clump stands, in world units. A tile is 1.
 *
 * KNEE HEIGHT, not chest height. At 0.52 a 3x3 of briar was a hedge: it read as
 * difficult terrain perfectly and it also hid the altar, the enemies and the far wall
 * behind it, which in a first-person game is the difference between terrain and a
 * blindfold. Low enough to see over, tall enough to occlude a body's feet and throw
 * parallax as you walk past, which is all the read needs.
 */
const HEIGHT: Record<GrowthKind, number> = { rubble: 0.3, plant: 0.13, briar: 0.5 };

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

interface Clump { mesh: THREE.Mesh; kind: GrowthKind }

export class GrowthView {
  readonly group = new THREE.Group();
  private tex: Record<GrowthKind, THREE.Texture[]> = { rubble: [], plant: [], briar: [] };
  private geo: Record<GrowthKind, THREE.PlaneGeometry>;
  private pool: Clump[] = [];
  private live = 0;

  constructor() {
    this.geo = {
      rubble: this.makeGeo('rubble'),
      plant: this.makeGeo('plant'),
      briar: this.makeGeo('briar'),
    };
    this.build();
  }

  /**
   * A quad standing ON the floor: pivot at the bottom edge, not the middle.
   *
   * `aspect` is width over height. Rubble is drawn square because it is authored
   * square; the plant sprites are not — the grass is four times wider than it is
   * tall, and forcing that into a square quad would stand it up like a hedge, which
   * is the exact read the low sprite exists to avoid.
   */
  private makeGeo(kind: GrowthKind, aspect = 1): THREE.PlaneGeometry {
    const h = HEIGHT[kind];
    const g = new THREE.PlaneGeometry(h * aspect, h);
    g.translate(0, h / 2, 0);
    return g;
  }

  private build(): void {
    const n = Math.max(8, Math.round(ppu() * HEIGHT.rubble));
    // FOUR variants, picked by tile so a patch is not the same rock repeated. Four
    // rather than one because a repeated silhouette is the single loudest tell that a
    // floor was generated, and rather than sixteen because nobody counts past about
    // three and every extra one is a texture.
    for (let i = 0; i < 4; i++) this.tex.rubble.push(rubblePix(n, i + 1).toTexture());
    void this.loadPlants();
  }

  /**
   * Bind the two plant sprites, and size their quads to the art.
   *
   * Async and unawaited: a clump with no texture yet is invisible for a frame or two
   * and then appears, which is what every other sprite in this game already does, and
   * the alternative is making floor construction wait on a texture fetch.
   */
  private async loadPlants(): Promise<void> {
    for (const kind of ['plant', 'briar'] as const) {
      const tex = await loadSprite(PLANT_ART[kind]!);
      const img = tex.image as { width: number; height: number };
      this.geo[kind].dispose();
      this.geo[kind] = this.makeGeo(kind, img.width / img.height);
      this.tex[kind] = [tex];
      /**
       * Rebind what is ALREADY on screen, not just the geometry.
       *
       * A floor is built and synced before this resolves, so those clumps were made
       * with no map at all and drew as white slabs — and `sync` only rebinds a slot
       * when it reuses it, which for a static patch of briar is never.
       */
      for (const c of this.pool) {
        if (c.kind !== kind) continue;
        c.mesh.geometry = this.geo[kind];
        const mat = c.mesh.material as THREE.MeshBasicMaterial;
        mat.map = tex;
        mat.needsUpdate = true;
      }
    }
  }

  /**
   * Re-author at a new texel density. See `DungeonView.restep`.
   *
   * Rubble only. The plant sprites are art files and `loadSprite` already picks the
   * right one for the step, so re-plotting them here would only throw away textures
   * the cache is holding for everyone else.
   */
  restep(): void {
    for (const t of this.tex.rubble) t.dispose();
    this.tex.rubble = [];
    this.build();
  }

  private take(kind: GrowthKind, variant: number): THREE.Mesh {
    const existing = this.pool[this.live];
    // Null until the art lands — see `loadPlants`, which rebinds every slot when it
    // does. A quad with no map draws as a white slab, so it must be `null` and not
    // `undefined`: three.js treats the first as "no texture" and the second as "keep
    // whatever was there".
    const set = this.tex[kind];
    const tex = set.length ? set[variant % set.length] : null;
    if (existing) {
      existing.kind = kind;
      existing.mesh.geometry = this.geo[kind];
      const mat = existing.mesh.material as THREE.MeshBasicMaterial;
      mat.map = tex;
      mat.needsUpdate = true;
      existing.mesh.visible = !!tex;
      existing.mesh.visible = true;
      this.live++;
      return existing.mesh;
    }
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.5, depthWrite: true, fog: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.geo[kind], mat);
    mesh.visible = !!tex;
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
    // The plant textures belong to the shared sprite cache and are NOT disposed here —
    // another floor will want them, and `loadSprite` hands out the same object.
    for (const t of this.tex.rubble) t.dispose();
    for (const k of ['rubble', 'plant', 'briar'] as const) this.geo[k].dispose();
    this.group.clear();
    this.pool.length = 0;
  }
}
