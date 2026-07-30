/**
 * LOCAL (not upstream): the grimoire's BOARDS, SPINE, PAGE EDGES, GOLD TRIM and
 * RIBBON, authored as real pixel art.
 *
 * Upstream shades the body with flat vertex colours under a toon ramp, which is
 * correct there and wrong here: this game's world is authored pixel art (144
 * texels per world unit, ramps, NEAREST-upscaled), so a smooth plum board next
 * to a pixel-art wall reads as vector art pasted over the game. The geometry,
 * the merge and the outline shell are untouched — every part keeps its
 * primitive, and only its UVs are remapped into a region of one atlas built
 * through `Pix` and uploaded with nearest filtering.
 *
 * The board's region is 128x168, matching the page faces (`pageTexture.ts`), so
 * a texel on the cover is the same size as a texel on the paper beside it.
 *
 * NOTHING HERE DITHERS. These are small textures magnified hard, and every tone
 * is written as a whole ramp step — the exact case `resolveLevels` snaps for the
 * world (see `src/art/pixel.ts`; an ordered dither over a flat tone is the
 * checkerboard this phase removed).
 */
import * as THREE from 'three';
import { Noise2, Rng } from '../core/rng';
import { hex, Pix, Ramp } from '../art/pixel';
import { book as bookPal } from '../style/palette';

/** The atlas is square and power-of-two out of habit; nothing samples mips. */
const A = 256;

export type CoverRegion =
  | 'board' | 'spine' | 'gold' | 'goldDark' | 'pageEdge' | 'pageFace' | 'ribbon' | 'cloth';

/** [x, y, w, h] in atlas texels. */
const RECT: Record<CoverRegion, [number, number, number, number]> = {
  board: [0, 0, 128, 168],
  spine: [128, 0, 32, 168],
  gold: [160, 0, 32, 32],
  goldDark: [192, 0, 32, 32],
  ribbon: [224, 0, 24, 64],
  pageEdge: [160, 32, 64, 32],
  pageFace: [160, 64, 64, 32],
  cloth: [224, 64, 24, 64],
};

// Ramps around the book palette — every mid step IS a `style/palette` entry, and
// only the dark and light ends are new, which is how `art/theme.ts` builds the
// world's masonry from a single stone colour. Five steps each: enough to model a
// bevel and a worn edge, few enough that the body still reads as one material.
const LEATHER = Ramp.build(0x3a1624, bookPal.leather, 5, bookPal.leatherDark);
const SPINE = Ramp.build(0x2a0f1a, 0x6a3346, 5, 0x4a2232);
const GOLD = Ramp.build(0x6b4a10, 0xfff0a8, 5, bookPal.trim);
const EDGE = Ramp.build(0x9a8156, bookPal.pageFace, 5, bookPal.pageEdge);
const CLOTH = Ramp.build(0x6e2318, 0xef8a6a, 5, bookPal.ribbon);
/**
 * The same weave with no colour of its own, for the chapter tabs: those are
 * tinted per school, so their region has to MULTIPLY rather than replace. Four
 * grey steps still quantise the tint — a stepped multiplier over a flat colour
 * is a stepped colour.
 */
const CLOTH_GREY = Ramp.build(0x6a6a6a, 0xffffff, 4);

/** Whole-step write. The only way anything in this file puts down a colour. */
function put(p: Pix, x: number, y: number, ramp: Ramp, step: number): void {
  p.set(x, y, ramp.at(step < 0 ? 0 : step > ramp.length - 1 ? ramp.length - 1 : step), { mode: 'set' });
}

/**
 * Pebbled leather: a base step with noise-chosen patches one step either way.
 * The patches are what stop a 128px board reading as a painted rectangle, and
 * they are whole steps, so there is no grid in them at any magnification.
 */
function grainInto(p: Pix, ramp: Ramp, base: number, noise: Noise2, scale = 0.13): void {
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const n = noise.fbm(x * scale, y * scale, 3);
      put(p, x, y, ramp, base + (n > 0.62 ? 1 : n < 0.4 ? -1 : 0));
    }
  }
}

/** A board: pebbled leather, a tooled gilt border, and a blind-stamped star. */
function boardPix(): Pix {
  const [, , w, h] = RECT.board;
  const p = new Pix(w, h);
  const noise = new Noise2('book-board');
  const rng = new Rng('book-board');
  grainInto(p, LEATHER, 2, noise);

  // The rolled edge of a bound board: two steps down at the very rim, one step
  // in from it. Whole steps, so it is a drawn edge and not a vignette.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (e < 2) put(p, x, y, LEATHER, 0);
      else if (e < 5) put(p, x, y, LEATHER, 1);
      else if (e === 5 || e === 6) put(p, x, y, LEATHER, 3); // the raised roll catches the light
    }
  }

  // tooled border: a gilt rule with a blind rule inside it
  const o = 11;
  for (let x = o; x < w - o; x++) { put(p, x, o, GOLD, 3); put(p, x, h - 1 - o, GOLD, 3); }
  for (let y = o; y < h - o; y++) { put(p, o, y, GOLD, 3); put(p, w - 1 - o, y, GOLD, 3); }
  const i2 = o + 4;
  for (let x = i2; x < w - i2; x++) { put(p, x, i2, LEATHER, 0); put(p, x, h - 1 - i2, LEATHER, 0); }
  for (let y = i2; y < h - i2; y++) { put(p, i2, y, LEATHER, 0); put(p, w - 1 - i2, y, LEATHER, 0); }
  // corner lozenges on the gilt rule
  for (const [cx, cy] of [[o, o], [w - 1 - o, o], [o, h - 1 - o], [w - 1 - o, h - 1 - o]]) {
    for (let dy = -3; dy <= 3; dy++) {
      const run = 3 - Math.abs(dy);
      for (let dx = -run; dx <= run; dx++) put(p, cx + dx, cy + dy, GOLD, Math.abs(dy) < 2 ? 4 : 3);
    }
  }

  /**
   * The blind-stamped star, pressed INTO the leather: a hollow one step down,
   * keylined dark where the press bit and light where it threw the grain up. The
   * light side is chosen per edge from which way it faces, which is what makes a
   * flat fill read as a recess.
   */
  const cx = w >> 1, cy = h >> 1, r = 30;
  const pts: [number, number][] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.4;
    pts.push([Math.round(cx + Math.cos(a) * rad), Math.round(cy + Math.sin(a) * rad)]);
  }
  p.poly(pts, LEATHER.at(1));
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const facingLight = (ax + bx) / 2 - cx + ((ay + by) / 2 - cy) > 0;
    p.line(ax, ay, bx, by, LEATHER.at(facingLight ? 3 : 0));
  }
  p.ellipse(cx, cy, 8, 8, LEATHER.at(0));
  p.ellipseFrame(cx, cy, 7, 7, GOLD.at(3));
  p.ellipse(cx, cy, 3, 3, GOLD.at(4));

  // scuffs: a handled book is brightest where a thumb has been
  for (let i = 0; i < 90; i++) {
    const x = rng.int(3, w - 4), y = rng.int(3, h - 4);
    if (Math.min(x, y, w - 1 - x, h - 1 - y) < 6) continue;
    put(p, x, y, LEATHER, rng.chance(0.6) ? 3 : 1);
  }
  return p;
}

/** The spine roll: leather with five raised bands, ribbed across the roll. */
function spinePix(): Pix {
  const [, , w, h] = RECT.spine;
  const p = new Pix(w, h);
  grainInto(p, SPINE, 2, new Noise2('book-spine'), 0.2);
  // The cylinder's u runs AROUND the roll, so a band is a row of texels: lit on
  // the way up, dark in the hollow between bands.
  for (let i = 0; i < 5; i++) {
    const y0 = Math.round(((i + 0.5) / 5) * h) - 5;
    for (let y = y0; y < y0 + 10; y++) {
      for (let x = 0; x < w; x++) {
        const t = (y - y0) / 9;
        put(p, x, y, SPINE, t < 0.12 ? 0 : t < 0.3 ? 3 : t < 0.72 ? 4 : t < 0.88 ? 2 : 0);
      }
    }
  }
  return p;
}

/**
 * A gold cap or band: raised metal, not a pattern.
 *
 * Deliberately NOT hatched. A repeating hatch on a region this small is magnified
 * into a barcode across the corner caps, which is the same complaint as a
 * checkerboard wearing better clothes. So the relief is a bevel — light along the
 * top and left, dark along the bottom and right, a couple of scratches — and it
 * works on the spine bands too, where u wraps the roll and the bevel becomes the
 * lit side of a cylinder.
 */
function goldPix(scale = 1): Pix {
  const [, , w, h] = RECT.gold;
  const p = new Pix(w, h);
  const ramp = scale < 1 ? GOLD.scaled(scale) : GOLD;
  const rng = new Rng(`book-gold-${scale}`);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lit = Math.min(x, y), dark = Math.min(w - 1 - x, h - 1 - y);
      put(p, x, y, ramp, lit < 2 ? 4 : dark < 2 ? 1 : dark < 5 ? 2 : 3);
    }
  }
  for (let i = 0; i < 10; i++) {
    const x = rng.int(3, w - 4), y = rng.int(3, h - 4);
    put(p, x, y, ramp, rng.chance(0.5) ? 4 : 2);
  }
  return p;
}

/** The fore-edge of a page stack: one texel per sheet, gathered in fives. */
function pageEdgePix(): Pix {
  const [, , w, h] = RECT.pageEdge;
  const p = new Pix(w, h);
  const rng = new Rng('book-edge');
  for (let y = 0; y < h; y++) {
    const gather = y % 5 === 0;
    for (let x = 0; x < w; x++) {
      put(p, x, y, EDGE, gather ? 1 : y % 2 ? 4 : 3);
    }
  }
  for (let i = 0; i < 40; i++) put(p, rng.int(0, w - 1), rng.int(0, h - 1), EDGE, 2);
  return p;
}

/** A flat sheet seen from above — the top of the stack. */
function pageFacePix(): Pix {
  const [, , w, h] = RECT.pageFace;
  const p = new Pix(w, h);
  const rng = new Rng('book-face');
  p.fill(EDGE.at(4));
  for (let i = 0; i < 26; i++) put(p, rng.int(0, w - 1), rng.int(0, h - 1), EDGE, rng.chance(0.4) ? 2 : 3);
  for (let i = 0; i < 5; i++) {
    const y = rng.int(1, h - 2), x0 = rng.int(0, w - 10);
    for (let x = x0; x < x0 + rng.int(6, 18); x++) put(p, x, y, EDGE, 3);
  }
  return p;
}

/** Woven ribbon: warp stripes along its length, frayed at the loose end. */
function ribbonPix(ramp: Ramp, fray: boolean): Pix {
  const [, , w, h] = RECT.ribbon;
  const p = new Pix(w, h);
  const rng = new Rng('book-ribbon');
  const top = ramp.length - 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // warp stripes, broken every few rows so it reads as cloth and not as a grid
      const stripe = x % 3 === 0 ? top - 3 : x % 3 === 1 ? top - 1 : top - 2;
      put(p, x, y, ramp, y % 7 === 6 ? Math.max(0, stripe - 1) : stripe);
    }
  }
  for (let x = 0; x < w; x++) put(p, x, 0, ramp, 0);
  if (!fray) return p;
  // the frayed end: loose threads at the swallowtail
  for (let x = 0; x < w; x++) {
    const len = rng.int(0, 4);
    for (let y = h - 1; y > h - 1 - len; y--) p.set(x, y, 0, { mode: 'set' });
    put(p, x, h - 1 - len, ramp, top);
  }
  return p;
}

let atlas: THREE.Texture | null = null;

/** The body's one texture. Built once; nearest, no mips (`Pix.toTexture`). */
export function coverAtlas(): THREE.Texture {
  if (atlas) return atlas;
  const p = new Pix(A, A, hex(0x000000, 0));
  const at = (name: CoverRegion, src: Pix) => p.blit(src, RECT[name][0], RECT[name][1]);
  at('board', boardPix());
  at('spine', spinePix());
  at('gold', goldPix());
  at('goldDark', goldPix(0.82));
  at('pageEdge', pageEdgePix());
  at('pageFace', pageFacePix());
  at('ribbon', ribbonPix(CLOTH, true));
  at('cloth', ribbonPix(CLOTH_GREY, false));
  atlas = p.toTexture();
  return atlas;
}

/**
 * Point a part's 0..1 UVs at one atlas region, in place.
 *
 * Every primitive in the body already carries per-face 0..1 UVs, so this is the
 * whole of what texturing the merged mesh takes — no geometry is rebuilt.
 */
export function uvRegion(geo: THREE.BufferGeometry, name: CoverRegion): THREE.BufferGeometry {
  const [x, y, w, h] = RECT[name];
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv) return geo;
  // Half-texel inset: NEAREST sampling exactly on a region boundary rounds into
  // the neighbour, which shows up as a stray gold texel along the leather.
  const u0 = (x + 0.5) / A, u1 = (x + w - 0.5) / A;
  // three.js flips textures on upload, so v runs up from the region's last row.
  const v0 = 1 - (y + h - 0.5) / A, v1 = 1 - (y + 0.5) / A;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * Rescale UVs into 0..1 before pointing them at a region.
 *
 * `ExtrudeGeometry` writes SHAPE-SPACE coordinates as UVs, so a chapter tab's uv
 * is its own size in metres and would land far outside its region.
 */
export function uvNormalise(
  geo: THREE.BufferGeometry, x0: number, y0: number, w: number, h: number,
): THREE.BufferGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv) return geo;
  const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, c01((uv.getX(i) - x0) / w), c01((uv.getY(i) - y0) / h));
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * The vertex colour a textured part carries: the atlas holds the colour now, and
 * a tint on top of it would fight the ramp the region was authored against.
 */
export const UNTINTED = 0xffffff;
