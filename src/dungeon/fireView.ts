/**
 * Burning ground, drawn.
 *
 * `Roadmap/Burning_Ground.md` says to draw it before tuning it, and it is right: a
 * hazard the player cannot see is worse than no hazard. The hard part is the
 * palette — the world is a dark brown cavern lit by orange torchlight, so an orange
 * floor tile has to compete with an orange floor, and the naive version reads as a
 * slightly-warmer flagstone.
 *
 * Three things carry it, and none of them is the colour on its own:
 *  - **It is UNLIT.** `MeshBasicMaterial` with `fog: false`, so fire is exactly as
 *    bright at the far end of a room as it is underfoot. Everything else in the
 *    world dims with distance; fire refusing to is what makes it read as a light
 *    source rather than as a floor texture.
 *  - **It has a hard black rim.** The one thing the brown floor never has. An edge
 *    is what makes the AREA legible — the player needs to count tiles, not admire a
 *    glow — and it is what stops two adjacent burning tiles reading as one blob.
 *  - **It MOVES.** Four frames on a per-tile phase offset, so a patch of fire
 *    shimmers instead of sitting there. Motion is what the eye finds in a dark
 *    scene, and it separates fire from every static thing on the floor.
 *
 * Sitting a hair above the floor plane rather than on it, because a coplanar quad
 * z-fights with the flagstones and the artefact looks exactly like a rendering bug.
 */
import * as THREE from 'three';
import { Pix, rgba } from '../art/pixel';
import { ppu } from '../art/steps';

const FRAMES = 4;

/** How far above the floor plane the quad sits. Enough to beat z-fighting, and far
 *  less than anything the camera can perceive as floating. */
const LIFT = 0.012;

/** The standing card's world size. Under a tile wide so two neighbouring fires
 *  read as two fires rather than as a wall of flame. */
const CARD_W = 0.8;
const CARD_H = 0.85;

/** A card is invisible inside this radius of the camera and fully drawn a band
 *  beyond it — see the fade in `update`. */
const CARD_FADE_IN = 0.55;
const CARD_FADE_BAND = 0.7;

/**
 * One frame of burning ground, authored at the current texel density.
 *
 * Drawn as embers rather than as flames: this is ground that is on fire, seen from
 * a standing camera looking down at it, and a lick of flame drawn on a flat quad
 * reads as a decal of a fire rather than as a fire. Bright core, darker crust,
 * black rim.
 */
function emberTile(n: number, frame: number): Pix {
  const p = new Pix(n, n);
  const rnd = (x: number, y: number): number => {
    const s = Math.sin((x * 12.9898 + y * 78.233 + frame * 37.719)) * 43758.5453;
    return s - Math.floor(s);
  };

  const core = rgba(255, 214, 92);
  const mid = rgba(255, 122, 32);
  const crust = rgba(126, 38, 16);
  const rim = rgba(18, 8, 6);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // Distance from the tile edge, so the fire pools in the middle and the rim
      // stays clean however the noise falls.
      const edge = Math.min(x, y, n - 1 - x, n - 1 - y) / (n / 2);
      const heat = edge * 0.85 + rnd(x, y) * 0.5;
      p.set(x, y, heat > 1.0 ? core : heat > 0.66 ? mid : crust);
    }
  }
  p.frame(0, 0, n, n, rim);
  return p;
}

/**
 * One frame of the standing flame CARD.
 *
 * The embers alone tell you which tiles are on fire and nothing else — read from a
 * standing camera they are a pattern on the ground, and the eye files them with the
 * moss and the flagstones. The card is what makes it a fire: something with height,
 * billboarded to the camera exactly like every creature and prop in the room, so it
 * occludes, it bobs, and it belongs to the same 2.5D world as the rest of the
 * decoration rather than being painted onto the floor of it.
 *
 * Drawn as tongues rather than as one blob, because a single silhouette reads as a
 * cone of light and three tongues at different heights read as burning.
 */
function flameCard(n: number, frame: number): Pix {
  const p = new Pix(n, n);
  const core = rgba(255, 240, 170);
  const mid = rgba(255, 168, 46);
  const outer = rgba(214, 74, 20);
  const soot = rgba(58, 22, 12);

  // Three tongues, each on its own phase so they never rise together.
  const tongues = [
    { x: 0.30, h: 0.62, w: 0.17, ph: 0.0 },
    { x: 0.52, h: 0.92, w: 0.22, ph: 1.7 },
    { x: 0.73, h: 0.55, w: 0.15, ph: 3.4 },
  ];
  const t = (frame / FRAMES) * Math.PI * 2;

  for (const g of tongues) {
    const sway = Math.sin(t + g.ph) * 0.05;
    const h = g.h * (0.86 + 0.14 * Math.sin(t * 1.6 + g.ph));
    const baseX = g.x * n, baseY = n - 1;
    const tipX = (g.x + sway) * n, tipY = n - h * n;
    // outer body, then a hotter core inside it — a flame is layered, not tinted
    p.taper(baseX, baseY, tipX, tipY, g.w * n, 0.6, outer);
    p.taper(baseX, baseY - n * 0.06, tipX, tipY + n * 0.16, g.w * n * 0.62, 0.5, mid);
    p.taper(baseX, baseY - n * 0.12, tipX, tipY + n * 0.34, g.w * n * 0.3, 0.5, core);
  }
  // A dark rim for the same reason the embers have one: it is the only thing in
  // this palette the brown room never produces, and it is what holds the shape
  // together against a wall lit the same colour as the fire.
  p.outline(soot, false, true);
  return p;
}

export class FireView {
  readonly group = new THREE.Group();
  private frames: THREE.Texture[] = [];
  private cards: THREE.Texture[] = [];
  private geo: THREE.PlaneGeometry;
  private cardGeo: THREE.PlaneGeometry;
  /** Pooled quads, reused across rounds — fire is placed and cleared constantly. */
  private pool: THREE.Mesh[] = [];
  private cardPool: THREE.Mesh[] = [];
  private live = 0;
  private phase: number[] = [];

  constructor() {
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    this.build();
  }

  private build(): void {
    const n = Math.max(8, Math.round(ppu()));
    this.frames = [];
    this.cards = [];
    for (let f = 0; f < FRAMES; f++) {
      this.frames.push(emberTile(n, f).toTexture());
      this.cards.push(flameCard(n, f).toTexture());
    }
  }

  /** Re-author the frames at a new texel density. See `DungeonView.restep`. */
  restep(): void {
    for (const t of this.frames) t.dispose();
    for (const t of this.cards) t.dispose();
    this.build();
    for (const m of this.pool) (m.material as THREE.MeshBasicMaterial).map = this.frames[0];
    for (const m of this.cardPool) (m.material as THREE.MeshBasicMaterial).map = this.cards[0];
  }

  /**
   * Show exactly this set of burning tiles.
   *
   * Called with the whole set every time rather than diffed, because the set is
   * tiny, it changes every round, and a diff is a second copy of the truth that can
   * drift from `Ground`.
   */
  sync(tiles: Iterable<number>, gridW: number): void {
    let i = 0;
    for (const t of tiles) {
      const x = t % gridW, y = (t / gridW) | 0;
      this.take(i).position.set(x, LIFT, y);
      this.pool[i].visible = true;
      // The card stands on the tile centre, its base on the floor.
      this.takeCard(i).position.set(x, CARD_H / 2, y);
      this.cardPool[i].visible = true;
      i++;
    }
    for (let k = i; k < this.live; k++) {
      this.pool[k].visible = false;
      this.cardPool[k].visible = false;
    }
    this.live = i;
  }

  private takeCard(i: number): THREE.Mesh {
    if (this.cardPool[i]) return this.cardPool[i];
    const mat = new THREE.MeshBasicMaterial({
      // No `alphaTest` here, unlike the sconces: alpha testing compares the final
      // alpha, so the moment the near-camera fade drops opacity below the
      // threshold the whole card would vanish in one frame instead of fading.
      map: this.cards[0], transparent: true, depthWrite: false, fog: false,
    });
    const m = new THREE.Mesh(this.cardGeo, mat);
    m.renderOrder = 2;
    this.cardPool[i] = m;
    this.group.add(m);
    return m;
  }

  private take(i: number): THREE.Mesh {
    if (this.pool[i]) return this.pool[i];
    const mat = new THREE.MeshBasicMaterial({
      map: this.frames[0], transparent: true, depthWrite: false, fog: false,
    });
    const m = new THREE.Mesh(this.geo, mat);
    // Flat on the floor. The plane is born facing +z, so it wants a quarter turn
    // back onto the ground.
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 1;
    this.pool[i] = m;
    this.phase[i] = (i * 2.399) % (Math.PI * 2);
    this.group.add(m);
    return m;
  }

  /**
   * Per-frame: cycle the frames so a patch of fire shimmers, and turn every card
   * to face the camera.
   *
   * Y-only billboarding, the same rule `Sprite.update` follows and for the same
   * reason — a flame that tilted with the camera would be the one thing in the
   * room that does, and verticals staying vertical is what keeps the world solid.
   */
  update(time: number, cam: THREE.Vector3): void {
    for (let i = 0; i < this.live; i++) {
      const f = Math.floor(time * 7 + this.phase[i] * 3) % FRAMES;
      (this.pool[i].material as THREE.MeshBasicMaterial).map = this.frames[f];

      const card = this.cardPool[i];
      const g = Math.floor(time * 9 + this.phase[i] * 5) % FRAMES;
      (card.material as THREE.MeshBasicMaterial).map = this.cards[g];
      card.rotation.set(0, Math.atan2(cam.x - card.position.x, cam.z - card.position.z), 0);

      /**
       * Fade the card out as the camera reaches it, and drop it entirely on the
       * tile the player is standing on.
       *
       * A billboard a few centimetres from the lens is a wall of orange across the
       * whole screen, and the tile you are standing on is exactly where you least
       * want the view blocked — that is the tile that is hurting you. The ground
       * embers still mark it, so nothing is lost but the obstruction. Faded rather
       * than switched off so a fire does not pop as you walk into it.
       */
      const dx = cam.x - card.position.x, dz = cam.z - card.position.z;
      const near = Math.sqrt(dx * dx + dz * dz);
      const mat = card.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, Math.min(1, (near - CARD_FADE_IN) / CARD_FADE_BAND));
      card.visible = mat.opacity > 0.01;
    }
  }

  dispose(): void {
    for (const t of this.frames) t.dispose();
    for (const t of this.cards) t.dispose();
    for (const m of this.pool) (m.material as THREE.Material).dispose();
    for (const m of this.cardPool) (m.material as THREE.Material).dispose();
    this.geo.dispose();
    this.cardGeo.dispose();
    this.pool.length = 0;
    this.cardPool.length = 0;
    this.live = 0;
  }
}
