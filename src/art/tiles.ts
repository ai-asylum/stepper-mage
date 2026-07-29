/**
 * Procedural masonry — walls, floors and ceilings, one texture per tile face.
 *
 * Each wall face in the dungeon is its own quad with its own texture variant,
 * which is both how real grid-crawlers look (discrete stone panels, not a
 * smeared continuous surface) and why none of this has to tile seamlessly.
 *
 * Every surface is built the same way: a float LEVEL FIELD in [0,1] describing
 * how lit each pixel is, then a single quantise-with-dither pass through the
 * theme's `Ramp`. Keeping brightness as a field until the last step is what lets
 * bevels, grain, AO and detail stack without turning to mud.
 */
import { Noise2, Rng } from '../core/rng';
import { bayer, hex, mix, Pix, Ramp, rgba, shade, type Col } from './pixel';
import type { FloorDetail, Theme } from './theme';

/** Texels per world unit. Every surface uses this so texel density is uniform. */
export const PPU = 144;
/** Wall height in world units. A real room, not a crawlspace. */
export const WALL_H = 1.05;

const WALL_W = PPU;
const WALL_PX_H = Math.round(PPU * WALL_H);

/** A mutable float brightness field, resolved to a Ramp at the end. */
class Field {
  readonly w: number;
  readonly h: number;
  readonly v: Float32Array;

  constructor(w: number, h: number, init = 0.5) {
    this.w = w; this.h = h;
    this.v = new Float32Array(w * h).fill(init);
  }

  at(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.v[y * this.w + x];
  }

  set(x: number, y: number, n: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.v[y * this.w + x] = n;
  }

  add(x: number, y: number, n: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.v[y * this.w + x] += n;
  }

  mul(x: number, y: number, n: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.v[y * this.w + x] *= n;
  }

  /** Quantise through a ramp with an ordered dither. */
  resolve(ramp: Ramp, fine = true): Pix {
    const p = new Pix(this.w, this.h);
    const steps = ramp.length - 1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        let t = this.v[y * this.w + x];
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const lvl = t * steps;
        const lo = Math.floor(lvl);
        const idx = lvl - lo > bayer(x, y, fine) ? lo + 1 : lo;
        p.set(x, y, ramp.at(idx), { mode: 'set' });
      }
    }
    return p;
  }
}

/**
 * Stamp a course of masonry blocks into a brightness field.
 *
 * The bevel is the load-bearing part: a 1px lighter top/left edge and a 2px
 * darker bottom/right edge per block is what reads as "carved stone" instead of
 * "noise on a rectangle", and it survives the low internal render resolution.
 */
function masonry(
  f: Field, rng: Rng, noise: Noise2,
  opts: { rowH: number; blockW: [number, number]; gap: number; bevel?: number; jitter?: number },
): void {
  const { rowH, blockW, gap } = opts;
  const bevel = opts.bevel ?? 0.16;
  const jitter = opts.jitter ?? 0.1;

  for (let ry = -rowH; ry < f.h + rowH; ry += rowH) {
    // stagger every other course, with a little wander so it never looks like tiling
    const rowIdx = Math.round(ry / rowH);
    const offset = (rowIdx % 2 ? blockW[0] * 0.5 : 0) + rng.range(-4, 4);
    let x = -offset - blockW[1];
    while (x < f.w + blockW[1]) {
      const bw = Math.round(rng.range(blockW[0], blockW[1]));
      const bx = Math.round(x);
      const by = ry + Math.round(rng.range(-1, 1));
      const bh = rowH - gap;

      // per-block base brightness — the single biggest anti-tiling cue
      const base = rng.range(-jitter, jitter) + (noise.at(bx * 0.05, by * 0.05) - 0.5) * 0.12;

      for (let yy = by; yy < by + bh; yy++) {
        for (let xx = bx; xx < bx + bw - gap; xx++) {
          if (xx < 0 || yy < 0 || xx >= f.w || yy >= f.h) continue;
          let v = base;
          const ex = xx - bx, ey = yy - by;
          const rx = bx + bw - gap - 1 - xx, ry2 = by + bh - 1 - yy;
          // lit top + left
          if (ey === 0) v += bevel;
          else if (ey === 1) v += bevel * 0.4;
          if (ex === 0) v += bevel * 0.7;
          // shadowed bottom + right (deeper: this is the recess into mortar)
          if (ry2 === 0) v -= bevel * 1.5;
          else if (ry2 === 1) v -= bevel * 0.7;
          if (rx === 0) v -= bevel * 1.1;
          else if (rx === 1) v -= bevel * 0.45;
          f.add(xx, yy, v);
        }
      }
      x += bw;
    }
  }
}

/** Multiply darkness into the edges of a face — cheap contact AO. */
function edgeAo(f: Field, top: number, bottom: number, sides: number): void {
  for (let y = 0; y < f.h; y++) {
    const ty = y / f.h;
    const kTop = top > 0 ? 1 - top * Math.max(0, 1 - ty / 0.28) : 1;
    const kBot = bottom > 0 ? 1 - bottom * Math.max(0, 1 - (1 - ty) / 0.3) : 1;
    for (let x = 0; x < f.w; x++) {
      const tx = Math.min(x, f.w - 1 - x) / f.w;
      const kSide = sides > 0 ? 1 - sides * Math.max(0, 1 - tx / 0.12) : 1;
      f.mul(x, y, kTop * kBot * kSide);
    }
  }
}

/** Fine grain — the last 10% that stops flat stone looking like plastic. */
function grain(f: Field, noise: Noise2, scale = 0.09, amount = 0.09): void {
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      f.add(x, y, (noise.fbm(x * scale, y * scale, 3) - 0.5) * amount);
    }
  }
}

/** A branching crack, drawn as a dark line into the field. */
function crack(f: Field, rng: Rng, x0: number, y0: number, len: number, dir: number, depth = 0): void {
  let x = x0, y = y0, a = dir;
  for (let i = 0; i < len; i++) {
    a += rng.range(-0.5, 0.5);
    x += Math.cos(a); y += Math.sin(a);
    const ix = Math.round(x), iy = Math.round(y);
    f.add(ix, iy, -0.42);
    f.add(ix + 1, iy, -0.14);
    f.add(ix, iy + 1, -0.1);
    if (depth < 2 && rng.chance(0.05)) {
      crack(f, rng, x, y, len * 0.45, a + rng.range(-1.2, 1.2), depth + 1);
    }
  }
}

// -------------------------------------------------------------- detail passes

/**
 * Per-theme detail vocabulary, stamped after masonry. This is the pass that
 * makes a screenshot instantly identifiable as floor 2 rather than floor 4.
 */
function wallDetail(p: Pix, f: Field, rng: Rng, noise: Noise2, theme: Theme, variant: number): void {
  const detail: FloorDetail = theme.detail;
  const acc = theme.accent;

  if (detail === 'waterline') {
    // A tide mark two-thirds down, with algae below and slow drips above.
    const base = f.h * 0.58 + rng.range(-6, 6);
    for (let x = 0; x < f.w; x++) {
      const wave = Math.sin(x * 0.11 + rng.next() * 0.2) * 2.2 + noise.at(x * 0.06, 3) * 5;
      const line = Math.round(base + wave);
      for (let y = line; y < f.h; y++) {
        const d = (y - line) / (f.h - line + 1);
        f.mul(x, y, 0.74 + d * 0.1);
      }
      // the stain edge itself is darkest
      f.mul(x, line, 0.55);
      f.mul(x, line + 1, 0.7);
    }
    // algae speckle clinging under the waterline
    for (let i = 0; i < 190; i++) {
      const x = rng.int(0, f.w - 1);
      const y = rng.int(Math.round(base) + 2, f.h - 1);
      if (noise.fbm(x * 0.1, y * 0.1, 2) < 0.44) continue;
      p.set(x, y, mix(p.get(x, y), hex(0x2e5f4a), rng.range(0.25, 0.6)));
    }
    // vertical drip streaks from the top
    const drips = rng.int(1, 3);
    for (let i = 0; i < drips; i++) {
      const x = rng.int(4, f.w - 5);
      const len = rng.int(14, Math.round(base));
      for (let y = 0; y < len; y++) {
        const c = p.get(x, y);
        p.set(x, y, shade(c, 0.72));
        if (rng.chance(0.3)) p.set(x + 1, y, shade(p.get(x + 1, y), 0.86));
      }
    }
  } else if (detail === 'bone') {
    // soot creeping down from the ceiling
    for (let x = 0; x < f.w; x++) {
      const reach = 10 + noise.fbm(x * 0.05, 1, 3) * 26;
      for (let y = 0; y < reach; y++) f.mul(x, y, 0.5 + 0.5 * (y / reach));
    }
    // bone inlay: a femur or a small skull set into the masonry
    if (variant % 2 === 0) {
      const cx = rng.int(24, f.w - 24), cy = rng.int(Math.round(f.h * 0.3), Math.round(f.h * 0.7));
      const boneCol = hex(0xd8c9a0), boneDark = hex(0x8a7a58);
      if (rng.chance(0.5)) {
        // femur, laid horizontally
        const len = rng.int(20, 30);
        p.taper(cx - len / 2, cy, cx + len / 2, cy + rng.range(-2, 2), 2.4, 2.4, boneCol);
        for (const s of [-1, 1]) {
          p.ellipse(cx + (s * len) / 2, cy - 2.5, 3.2, 3, boneCol);
          p.ellipse(cx + (s * len) / 2, cy + 2.5, 3.2, 3, boneCol);
        }
        p.outline(boneDark, true);
      } else {
        // small skull
        p.ellipse(cx, cy, 8, 7.5, boneCol);
        p.rect(cx - 5, cy + 5, 10, 5, boneCol);
        p.ellipse(cx - 3.2, cy - 0.5, 2.2, 2.6, hex(0x2a1c16));
        p.ellipse(cx + 3.2, cy - 0.5, 2.2, 2.6, hex(0x2a1c16));
        p.rect(cx - 1, cy + 3, 2, 2, hex(0x2a1c16));
        for (let i = -4; i <= 4; i += 2) p.set(cx + i, cy + 8, hex(0x2a1c16));
        p.outline(boneDark, true);
      }
    }
    // grease drips
    for (let i = 0; i < 2; i++) {
      const x = rng.int(3, f.w - 4), len = rng.int(8, 22), y0 = rng.int(0, f.h - len);
      for (let y = y0; y < y0 + len; y++) p.set(x, y, mix(p.get(x, y), hex(0x3a2a10), 0.5));
    }
  } else if (detail === 'moss') {
    // moss creeps UP from the floor and out of every recess
    for (let x = 0; x < f.w; x++) {
      const reach = 16 + noise.fbm(x * 0.045, 7, 3) * 40;
      for (let y = f.h - 1; y > f.h - reach; y--) {
        const t = 1 - (f.h - y) / reach;
        if (noise.fbm(x * 0.08, y * 0.08, 3) * 1.15 < 1 - t) continue;
        const mossCol = mix(hex(0x2f4a26), acc, noise.at(x * 0.2, y * 0.2) * 0.35);
        p.set(x, y, mix(p.get(x, y), mossCol, 0.55 + t * 0.4));
      }
    }
    // a root splitting the stone
    if (variant % 2 === 0) {
      const x0 = rng.int(10, f.w - 10);
      crack(f, rng, x0, f.h - 1, rng.int(26, 48), -Math.PI / 2 + rng.range(-0.4, 0.4));
    }
    // hanging strands from the top edge
    for (let i = 0; i < 5; i++) {
      const x = rng.int(2, f.w - 3), len = rng.int(4, 16);
      for (let y = 0; y < len; y++) p.set(x, y, mix(p.get(x, y), hex(0x3d5c2e), 0.7));
    }
  } else if (detail === 'rivet') {
    // riveted iron plate bolted over the stone
    const py0 = Math.round(f.h * 0.22), py1 = Math.round(f.h * 0.82);
    const plate = new Field(f.w, f.h, 0);
    for (let y = py0; y < py1; y++) for (let x = 3; x < f.w - 3; x++) plate.set(x, y, 1);
    for (let y = py0; y < py1; y++) {
      for (let x = 3; x < f.w - 3; x++) {
        let v = 0.06;
        if (y === py0) v += 0.2;
        if (y === py1 - 1) v -= 0.26;
        if (x === 3) v += 0.14;
        if (x === f.w - 4) v -= 0.2;
        f.add(x, y, v);
      }
    }
    // rivets along the plate seams
    const rc = hex(0x2a1a14);
    for (let x = 8; x < f.w - 6; x += 13) {
      for (const y of [py0 + 4, py1 - 5]) {
        p.ellipse(x, y, 2, 2, shade(p.get(x, y), 1.5));
        p.set(x + 1, y + 1, rc);
        p.set(x, y + 1, rc);
      }
    }
    // lava seams glowing through the cracks
    const seams = rng.int(1, 3);
    for (let i = 0; i < seams; i++) {
      let x = rng.range(6, f.w - 6), y = rng.range(py0, py1), a = rng.range(0, Math.PI * 2);
      for (let s = 0; s < rng.int(18, 34); s++) {
        a += rng.range(-0.45, 0.45);
        x += Math.cos(a); y += Math.sin(a);
        const ix = Math.round(x), iy = Math.round(y);
        p.set(ix, iy, acc);
        p.set(ix, iy + 1, mix(p.get(ix, iy + 1), theme.accentDeep, 0.7));
      }
    }
    for (let i = 0; i < seams; i++) {
      p.glow(rng.range(8, f.w - 8), rng.range(py0, py1), rng.range(10, 18), acc, 0.32, 3);
    }
  } else if (detail === 'inlay') {
    // gold constellation inlay: a few stars joined by hairline channels
    const n = rng.int(3, 5);
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      pts.push([rng.int(14, f.w - 14), rng.int(Math.round(f.h * 0.18), Math.round(f.h * 0.8))]);
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], mix(acc, hex(0x6b5a20), 0.45));
    }
    for (const [x, y] of pts) {
      // a four-point star, the only place we allow a bright accent on a wall
      p.set(x, y, hex(0xfffbe0));
      p.line(x - 2, y, x + 2, y, acc);
      p.line(x, y - 2, x, y + 2, acc);
      p.set(x, y, hex(0xfffbe0));
      p.glow(x, y, 7, acc, 0.5, 3);
    }
    // faint vertical fluting
    for (let x = 6; x < f.w - 4; x += 16) {
      for (let y = 0; y < f.h; y++) {
        p.set(x, y, shade(p.get(x, y), 1.1));
        p.set(x + 1, y, shade(p.get(x + 1, y), 0.88));
      }
    }
  }
}

// ------------------------------------------------------------------- builders

export interface TileSet {
  walls: Pix[];
  floors: Pix[];
  ceils: Pix[];
}

function buildWall(theme: Theme, seed: string, variant: number): Pix {
  const rng = new Rng(seed);
  const noise = new Noise2(seed + '-n');
  const f = new Field(WALL_W, WALL_PX_H, 0.62);

  masonry(f, rng, noise, {
    rowH: variant % 2 === 0 ? 30 : 24,
    blockW: variant % 3 === 0 ? [39, 60] : [48, 78],
    gap: 3,
    bevel: 0.17,
    jitter: 0.11,
  });
  grain(f, noise, 0.1, 0.1);
  // the top of a wall is shaded by the ceiling, the bottom by the floor contact
  edgeAo(f, 0.3, 0.22, 0.18);
  if (variant % 4 === 3) {
    crack(f, rng, rng.int(12, WALL_W - 12), rng.int(8, WALL_PX_H - 30), rng.int(24, 46), rng.range(0.9, 2.3));
  }

  const p = f.resolve(theme.wall);
  wallDetail(p, f, rng, noise, theme, variant);
  return p;
}

function buildFloor(theme: Theme, seed: string, variant: number): Pix {
  const rng = new Rng(seed);
  const noise = new Noise2(seed + '-n');
  const f = new Field(PPU, PPU, 0.5);

  // Flagstones via cellular noise: irregular slabs with dark joints, which
  // reads better underfoot than a regular grid at a grazing camera angle.
  for (let y = 0; y < PPU; y++) {
    for (let x = 0; x < PPU; x++) {
      const c = noise.cell(x * 0.045, y * 0.045);
      let v = 0.52 + (noise.fbm(x * 0.07, y * 0.07, 3) - 0.5) * 0.16;
      if (c < 0.1) v -= 0.42 * (1 - c / 0.1);        // joint
      else v += Math.min(0.14, (c - 0.1) * 0.4);      // slab crown
      f.set(x, y, v);
    }
  }
  grain(f, noise, 0.16, 0.11);
  // Heavy edge darkening per tile. Each floor quad is one tile, so this draws a
  // seam at every tile boundary — the single cue that tells you where you stand
  // and how far the wall actually is.
  edgeAo(f, 0.34, 0.34, 0.34);

  const p = f.resolve(theme.floor);

  // theme dressing on the ground
  if (theme.detail === 'waterline') {
    // shallow standing water in the low spots
    for (let y = 0; y < PPU; y++) {
      for (let x = 0; x < PPU; x++) {
        const w = noise.fbm(x * 0.035 + 11, y * 0.035, 3);
        if (w < 0.52) continue;
        const t = Math.min(1, (w - 0.52) * 4);
        p.set(x, y, mix(p.get(x, y), hex(0x16303a), 0.35 + t * 0.4));
        if (t > 0.7 && rng.chance(0.04)) p.set(x, y, hex(0x4e7f8c)); // glint
      }
    }
  } else if (theme.detail === 'moss') {
    for (let y = 0; y < PPU; y++) {
      for (let x = 0; x < PPU; x++) {
        const m = noise.fbm(x * 0.04 + 5, y * 0.04, 3);
        if (m < 0.5) continue;
        p.set(x, y, mix(p.get(x, y), hex(0x2c4423), Math.min(0.75, (m - 0.5) * 3)));
      }
    }
  } else if (theme.detail === 'bone') {
    for (let i = 0; i < 14; i++) {
      const x = rng.int(4, PPU - 5), y = rng.int(4, PPU - 5);
      p.taper(x, y, x + rng.range(-7, 7), y + rng.range(-7, 7), 1.2, 1.2, hex(0xa89468));
    }
    for (let i = 0; i < 5; i++) {
      p.ellipse(rng.int(6, PPU - 6), rng.int(6, PPU - 6), rng.range(3, 6), rng.range(2, 4), hex(0x2c1a10));
    }
  } else if (theme.detail === 'rivet') {
    // grated channels with ember light beneath
    if (variant % 3 === 0) {
      const y0 = rng.int(18, PPU - 34);
      for (let y = y0; y < y0 + 16; y++) {
        for (let x = 0; x < PPU; x++) {
          p.set(x, y, y % 4 < 2 ? hex(0x1a1010) : mix(theme.accentDeep, theme.accent, noise.at(x * 0.1, y) * 0.7));
        }
      }
      p.glow(PPU / 2, y0 + 8, 30, theme.accent, 0.3, 3);
    }
    for (let i = 0; i < 30; i++) {
      p.set(rng.int(0, PPU - 1), rng.int(0, PPU - 1), hex(0x2a1c14));
    }
  } else if (theme.detail === 'inlay') {
    // a polished marble sheen band
    for (let y = 0; y < PPU; y++) {
      for (let x = 0; x < PPU; x++) {
        const v = noise.ridge(x * 0.03, y * 0.03, 3);
        if (v > 0.72) p.set(x, y, mix(p.get(x, y), hex(0x8fa0d8), (v - 0.72) * 2));
      }
    }
    if (variant % 3 === 0) {
      p.ellipseFrame(PPU / 2, PPU / 2, 30, 30, mix(theme.accent, hex(0x5a4a18), 0.5));
      p.ellipseFrame(PPU / 2, PPU / 2, 22, 22, mix(theme.accent, hex(0x5a4a18), 0.6));
    }
  }
  return p;
}

function buildCeil(theme: Theme, seed: string, variant: number): Pix {
  const rng = new Rng(seed);
  const noise = new Noise2(seed + '-n');
  const f = new Field(PPU, PPU, 0.42);

  // rough barrel-vault: brightest along the crown, falling off to the springing
  for (let y = 0; y < PPU; y++) {
    for (let x = 0; x < PPU; x++) {
      const arch = 1 - Math.abs(x / PPU - 0.5) * 1.5;
      f.set(x, y, 0.34 + arch * 0.2 + (noise.fbm(x * 0.06, y * 0.06, 3) - 0.5) * 0.18);
    }
  }
  masonry(f, rng, noise, { rowH: 33, blockW: [45, 69], gap: 3, bevel: 0.1, jitter: 0.07 });
  edgeAo(f, 0.2, 0.2, 0.2);

  const p = f.resolve(theme.ceil);

  // a timber beam across every third ceiling tile — gives corridors rhythm
  if (variant % 3 === 0) {
    const bh = 11, y0 = Math.round(PPU * 0.5 - bh / 2);
    for (let y = y0; y < y0 + bh; y++) {
      for (let x = 0; x < PPU; x++) {
        const t = (y - y0) / bh;
        const wood = mix(hex(0x2a1d14), hex(0x4a3524), 1 - Math.abs(t - 0.35) * 2);
        p.set(x, y, wood);
      }
    }
    for (let x = 0; x < PPU; x++) {
      p.set(x, y0, hex(0x120c08));
      p.set(x, y0 + bh - 1, hex(0x0d0906));
    }
  }
  if (theme.detail === 'waterline') {
    for (let i = 0; i < 26; i++) {
      const x = rng.int(0, PPU - 1), y = rng.int(0, PPU - 1);
      p.set(x, y, mix(p.get(x, y), hex(0x1c2c30), 0.6));
    }
  }
  return p;
}

/** Build every tile texture for a floor. Called once per floor entry. */
export function buildTileSet(theme: Theme, seed: string): TileSet {
  const walls: Pix[] = [];
  const floors: Pix[] = [];
  const ceils: Pix[] = [];
  for (let i = 0; i < 6; i++) walls.push(buildWall(theme, `${seed}-w${i}`, i));
  for (let i = 0; i < 4; i++) floors.push(buildFloor(theme, `${seed}-f${i}`, i));
  for (let i = 0; i < 3; i++) ceils.push(buildCeil(theme, `${seed}-c${i}`, i));
  return { walls, floors, ceils };
}

/**
 * A wall-mounted torch sconce, drawn as its own small sprite so it can be
 * billboarded onto a wall face and flicker independently of the masonry.
 */
export function buildSconce(theme: Theme, seed: string): Pix[] {
  const frames: Pix[] = [];
  const W = 26, H = 40;
  for (let fi = 0; fi < 4; fi++) {
    const rng = new Rng(`${seed}-sconce-${fi}`);
    const p = new Pix(W, H);
    // iron bracket
    const iron = hex(0x241a1c), ironLit = hex(0x4a3a38);
    p.rect(W / 2 - 2, 16, 4, H - 18, iron);
    p.taper(W / 2, 18, W / 2, 14, 3, 2, ironLit);
    p.rect(W / 2 - 5, 12, 10, 5, iron);
    p.frame(W / 2 - 5, 12, 10, 5, ironLit);
    // Flame — three quantised layers, shifted per frame. These take their
    // colour from the floor's LIGHT colour, not its arcane accent: a torch is
    // fire, and tinting it violet made every sconce look like a spell effect.
    const sway = Math.sin(fi * 1.57) * 1.6;
    const lift = fi % 2;
    const cx = W / 2 + sway;
    const outer = mix(theme.lightCol, hex(0x7a2a08), 0.55);
    p.ellipse(cx, 9 - lift, 5, 7, outer);
    p.ellipse(cx + sway * 0.3, 8 - lift, 3.6, 5.4, theme.lightCol);
    p.ellipse(cx + sway * 0.4, 7 - lift, 2, 3.4, hex(0xfff2c4));
    // embers
    for (let i = 0; i < 3; i++) {
      p.set(Math.round(cx + rng.range(-4, 4)), Math.round(rng.range(0, 6)), hex(0xffd489));
    }
    p.glow(cx, 8, 16, theme.lightCol, 0.55, 4);
    frames.push(p);
  }
  return frames;
}

/** Colour helper shared with the renderer: a Col as a three.js-ready hex int. */
export function colToHex(c: Col): number {
  const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
  return (r << 16) | (g << 8) | b;
}

export { rgba };
