/**
 * The pixel-art toolkit — every texture and sprite in the game is drawn through
 * this, at real pixel resolution, with no antialiasing anywhere.
 *
 * Design rules (docs/ARTSTYLE.md):
 *  - Authored, not random. Noise is a *detail pass* over deliberate shapes,
 *    never the shape itself. Silhouette first, shading second, detail last.
 *  - Ramps, not gradients. Every surface picks from a 4-6 step `Ramp`, and a
 *    FALLOFF between two steps is an ordered dither so the result stays
 *    quantised. A flat tone is not a falloff: it lands on a step and is written
 *    solid (`levelIndex`), because dithering one flips every other texel across
 *    the whole surface, which is a checkerboard and not a material.
 *  - Everything gets an outline. A sprite without a dark keyline dissolves
 *    against a torch-lit wall.
 *
 * Colours are packed native-endian RGBA (`r | g<<8 | b<<16 | a<<24`) so the
 * buffer can be a Uint32Array view straight onto ImageData.
 */
import * as THREE from 'three';

export type Col = number;

/** Pack 0xRRGGBB + alpha into a buffer colour. */
export function hex(rgb: number, a = 255): Col {
  const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
  return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
}

export function rgba(r: number, g: number, b: number, a = 255): Col {
  return ((r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((a & 255) << 24)) >>> 0;
}

export const TRANSPARENT: Col = 0;

export function unpack(c: Col): [number, number, number, number] {
  return [c & 255, (c >> 8) & 255, (c >> 16) & 255, (c >>> 24) & 255];
}

/** Linear blend of two packed colours (alpha blended too). */
export function mix(a: Col, b: Col, t: number): Col {
  const [ar, ag, ab, aa] = unpack(a);
  const [br, bg, bb, ba] = unpack(b);
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return rgba(
    Math.round(ar + (br - ar) * k),
    Math.round(ag + (bg - ag) * k),
    Math.round(ab + (bb - ab) * k),
    Math.round(aa + (ba - aa) * k),
  );
}

/** Multiply a colour's brightness, keeping alpha. Used for cheap AO. */
export function shade(c: Col, k: number): Col {
  const [r, g, b, a] = unpack(c);
  return rgba(
    Math.min(255, Math.round(r * k)),
    Math.min(255, Math.round(g * k)),
    Math.min(255, Math.round(b * k)),
    a,
  );
}

/** Push a colour toward a tint — used for elemental status recolours. */
export function tint(c: Col, t: Col, amount: number): Col {
  const a = (c >>> 24) & 255;
  const out = mix(c, t, amount);
  return (out & 0x00ffffff) | (a << 24);
}

/**
 * A shading ramp: index 0 is the darkest, last is the brightest. Authoring
 * against ramp indices (not raw colours) is what keeps a whole floor's art
 * feeling like one palette.
 */
export class Ramp {
  readonly cols: Col[];

  constructor(cols: (number | Col)[], packed = false) {
    this.cols = packed ? (cols as Col[]) : (cols as number[]).map((c) => hex(c));
  }

  get length(): number { return this.cols.length; }

  /** Clamped index. */
  at(i: number): Col {
    return this.cols[i < 0 ? 0 : i >= this.cols.length ? this.cols.length - 1 : Math.round(i)];
  }

  /** Continuous [0,1] sample, quantised to a step (no smooth gradient). */
  step(t: number): Col {
    return this.at(Math.floor((t < 0 ? 0 : t > 0.9999 ? 0.9999 : t) * this.cols.length));
  }

  /** Build a ramp by interpolating dark → light through an optional mid. */
  static build(dark: number, light: number, steps = 5, mid?: number): Ramp {
    const out: Col[] = [];
    const d = hex(dark), l = hex(light), m = mid !== undefined ? hex(mid) : undefined;
    for (let i = 0; i < steps; i++) {
      const t = steps === 1 ? 0 : i / (steps - 1);
      if (m === undefined) out.push(mix(d, l, t));
      else out.push(t < 0.5 ? mix(d, m, t * 2) : mix(m, l, (t - 0.5) * 2));
    }
    return new Ramp(out, true);
  }

  /** A darker/lighter sibling ramp — for shaded faces of the same material. */
  scaled(k: number): Ramp {
    return new Ramp(this.cols.map((c) => shade(c, k)), true);
  }

  tinted(t: Col, amount: number): Ramp {
    return new Ramp(this.cols.map((c) => tint(c, t, amount)), true);
  }
}

/** Ordered 4x4 Bayer matrix, normalised to [0,1) — the only blend we allow. */
const BAYER4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
].map((v) => v / 16);

/** Ordered 8x8 Bayer — finer dither for large wall surfaces. */
const BAYER8 = (() => {
  const m: number[] = new Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // recursive Bayer construction
      let v = 0, mask = 4, bit = 0;
      let xx = x, yy = y;
      for (let i = 0; i < 3; i++) {
        const bx = (xx >> (2 - i)) & 1;
        const by = (yy >> (2 - i)) & 1;
        v |= ((bx ^ by) << (5 - bit)) | (bx << (4 - bit));
        bit += 2;
      }
      void mask;
      m[y * 8 + x] = v / 64;
    }
  }
  return m;
})();

export function bayer(x: number, y: number, fine = false): number {
  return fine ? BAYER8[(y & 7) * 8 + (x & 7)] : BAYER4[(y & 3) * 4 + (x & 3)];
}

// ------------------------------------------------------------- quantising

/**
 * How far the jitter may move a level, in ramp steps. Under half a step, so it
 * can never carry a value past the pair of steps it belongs between.
 */
const JITTER_STEPS = 0.42;

/**
 * A deterministic per-texel jitter in [-0.5, 0.5).
 *
 * Hashed from the coordinate and a seed rather than drawn from an Rng, because
 * every texture is built at boot and has to come out byte-identical on every
 * run — a screenshot comparison between two builds is worthless otherwise.
 */
export function jitter(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x85ebca6b) ^ Math.imul(seed | 0, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 16;
  return ((h >>> 0) % 4096) / 4096 - 0.5;
}

/**
 * One brightness level, in RAMP STEPS, resolved to a ramp index.
 *
 * ORDERED DITHER IS A GRADIENT TECHNIQUE. A flat tone that lands between two
 * steps flips every other texel across the whole surface, which is a
 * checkerboard, not a material — and at 144 texels per world unit, magnified by
 * the low-res target and then again by the nearest upscale, it is a block grid
 * on the screen. So dithering is a LICENCE that a falloff has to hold:
 *
 *  - `soft` 0 — the field is flat here. The level snaps to its nearest step and
 *    is written solid, with no threshold compare at all.
 *  - `soft` 1 — a real falloff. Full ordered dither, over the value plus a
 *    seeded jitter, because a gradient shallow enough to sit at half a step
 *    across a whole region re-aligns the Bayer matrix into that same grid.
 *  - in between the threshold slides from a hard round toward the Bayer value,
 *    so the dither appears only as a band either side of each step boundary and
 *    widens with the licence. There is no cliff between flat and not-flat.
 */
export function levelIndex(
  v: number, x: number, y: number, soft: number, steps: number,
  fine = false, seed = 0,
): number {
  const c = v < 0 ? 0 : v > steps ? steps : v;
  const w = soft < 0 ? 0 : soft > 1 ? 1 : soft;
  if (w <= 0) return Math.round(c);
  const j = c + jitter(x, y, seed) * JITTER_STEPS * w;
  const lo = Math.floor(j);
  // w scales the threshold about 0.5: at w=0 this is exactly Math.round(j)
  const thr = 0.5 + w * (bayer(x, y, fine) - 0.5);
  const idx = j - lo > thr ? lo + 1 : lo;
  return idx < 0 ? 0 : idx > steps ? steps : idx;
}

/**
 * Quantise a float LEVEL FIELD (in ramp steps) into a Pix.
 *
 * `soft` is the per-texel dither licence, written by whichever authoring pass
 * knows it is drawing a falloff — an AO edge, baked light, a vignette. Passing
 * `null` declares the whole field flat, which is the right answer for a field
 * built out of authored shapes and noise: those want to land on a step and stay
 * there. `src/art/tiles.ts` and `src/book/pageTexture.ts` both resolve here, so
 * the world and the book cannot drift apart on this.
 */
export function resolveLevels(
  lvl: Float32Array, soft: Float32Array | null, w: number, h: number, ramp: Ramp,
  opts?: { fine?: boolean; seed?: number },
): Pix {
  const p = new Pix(w, h);
  const steps = ramp.length - 1;
  const fine = opts?.fine ?? true;
  const seed = opts?.seed ?? 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      p.set(x, y, ramp.at(levelIndex(lvl[i], x, y, soft ? soft[i] : 0, steps, fine, seed)), { mode: 'set' });
    }
  }
  return p;
}

/**
 * The dither licence a ramp of `span` steps spread over `px` texels earns.
 *
 * A dither can only stand in for a gradient if the field crosses a step
 * boundary inside one Bayer tile; a slower ramp than that repeats the tile
 * coherently, which is the grid. So the licence is the slope measured against
 * the matrix's own period, and a flat run (span 0) earns nothing.
 */
export function slopeSoft(span: number, px: number, fine = false): number {
  if (px <= 1) return 0;
  const perTexel = Math.abs(span) / (px - 1);
  return Math.min(1, perTexel * (fine ? 8 : 4));
}

export interface DrawOpts {
  /** Blend mode: 'over' (default alpha blend), 'set' (overwrite), 'add'. */
  mode?: 'over' | 'set' | 'add';
}

/**
 * A drawable pixel buffer. All coordinates are integers; anything fractional is
 * floored on the way in. Out-of-bounds writes are silently dropped, which lets
 * shape code run past the edges without guards.
 */
export class Pix {
  readonly w: number;
  readonly h: number;
  readonly data: Uint32Array;

  constructor(w: number, h: number, fill: Col = TRANSPARENT) {
    this.w = w | 0;
    this.h = h | 0;
    this.data = new Uint32Array(this.w * this.h);
    if (fill !== TRANSPARENT) this.data.fill(fill);
  }

  clone(): Pix {
    const p = new Pix(this.w, this.h);
    p.data.set(this.data);
    return p;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): Col {
    x |= 0; y |= 0;
    if (!this.inBounds(x, y)) return TRANSPARENT;
    return this.data[y * this.w + x];
  }

  /** Alpha of a pixel, 0-255. */
  alpha(x: number, y: number): number {
    return (this.get(x, y) >>> 24) & 255;
  }

  set(x: number, y: number, c: Col, opts?: DrawOpts): void {
    x |= 0; y |= 0;
    if (!this.inBounds(x, y)) return;
    const i = y * this.w + x;
    const mode = opts?.mode ?? 'over';
    if (mode === 'set') { this.data[i] = c; return; }

    const sa = (c >>> 24) & 255;
    if (sa === 0) return;

    if (mode === 'add') {
      const [sr, sg, sb] = unpack(c);
      const [dr, dg, db, da] = unpack(this.data[i]);
      const k = sa / 255;
      this.data[i] = rgba(
        Math.min(255, dr + sr * k),
        Math.min(255, dg + sg * k),
        Math.min(255, db + sb * k),
        Math.max(da, sa),
      );
      return;
    }

    if (sa === 255) { this.data[i] = c; return; }
    // straight-alpha 'over'
    const [sr, sg, sb] = unpack(c);
    const [dr, dg, db, da] = unpack(this.data[i]);
    const a = sa / 255;
    const outA = sa + da * (1 - a);
    if (outA <= 0) { this.data[i] = TRANSPARENT; return; }
    const blend = (s: number, d: number) => Math.round((s * sa + d * da * (1 - a)) / outA);
    this.data[i] = rgba(blend(sr, dr), blend(sg, dg), blend(sb, db), Math.round(outA));
  }

  fill(c: Col): this {
    this.data.fill(c);
    return this;
  }

  // ---------------------------------------------------------------- shapes

  rect(x: number, y: number, w: number, h: number, c: Col, opts?: DrawOpts): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c, opts);
    return this;
  }

  /** 1px outline rectangle. */
  frame(x: number, y: number, w: number, h: number, c: Col, opts?: DrawOpts): this {
    for (let i = 0; i < w; i++) { this.set(x + i, y, c, opts); this.set(x + i, y + h - 1, c, opts); }
    for (let j = 0; j < h; j++) { this.set(x, y + j, c, opts); this.set(x + w - 1, y + j, c, opts); }
    return this;
  }

  /** Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, c: Col, opts?: DrawOpts): this {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.set(x0, y0, c, opts);
      if (x0 === x1 && y0 === y1) break;
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
    return this;
  }

  /** Filled axis-aligned ellipse, centre (cx,cy), radii (rx,ry). */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Col, opts?: DrawOpts): this {
    if (rx <= 0 || ry <= 0) return this;
    const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) {
      const dy = (y - cy) / ry;
      const s = 1 - dy * dy;
      if (s < 0) continue;
      const half = Math.sqrt(s) * rx;
      const xa = Math.round(cx - half), xb = Math.round(cx + half);
      for (let x = xa; x <= xb; x++) this.set(x, y, c, opts);
    }
    return this;
  }

  /** Ellipse outline only. */
  ellipseFrame(cx: number, cy: number, rx: number, ry: number, c: Col, opts?: DrawOpts): this {
    const inner = new Pix(this.w, this.h);
    inner.ellipse(cx, cy, rx, ry, hex(0xffffff));
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!inner.alpha(x, y)) continue;
        if (!inner.alpha(x - 1, y) || !inner.alpha(x + 1, y) ||
            !inner.alpha(x, y - 1) || !inner.alpha(x, y + 1)) this.set(x, y, c, opts);
      }
    }
    return this;
  }

  /** Filled convex/concave polygon via even-odd scanline. */
  poly(pts: readonly [number, number][], c: Col, opts?: DrawOpts): this {
    if (pts.length < 3) return this;
    let minY = Infinity, maxY = -Infinity;
    for (const [, py] of pts) { if (py < minY) minY = py; if (py > maxY) maxY = py; }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if (ay === by) continue;
        const yc = y + 0.5;
        if ((yc >= ay && yc < by) || (yc >= by && yc < ay)) {
          xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.round(xs[i]); x <= Math.round(xs[i + 1]) - (xs[i + 1] % 1 === 0 ? 1 : 0); x++) {
          this.set(x, y, c, opts);
        }
      }
    }
    return this;
  }

  /** A tapered stroke — limbs, tentacles, roots, staffs. */
  taper(x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, c: Col, opts?: DrawOpts): this {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = r0 + (r1 - r0) * t;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      if (r <= 0.5) this.set(Math.round(x), Math.round(y), c, opts);
      else this.ellipse(x, y, r, r, c, opts);
    }
    return this;
  }

  // ------------------------------------------------------------- gradients

  /**
   * Dithered vertical ramp fill over a region. `t0`/`t1` are ramp positions at
   * top/bottom; the ordered dither makes the transition read as pixel texture
   * rather than a smooth gradient.
   */
  rampV(x: number, y: number, w: number, h: number, ramp: Ramp, t0 = 0, t1 = 1, fine = false): this {
    const steps = ramp.length - 1;
    // The gradient is known in closed form here, so the licence is too: a run
    // with t0 === t1 is flat and snaps.
    const soft = slopeSoft((t1 - t0) * steps, h, fine);
    for (let j = 0; j < h; j++) {
      const t = h <= 1 ? t0 : t0 + (t1 - t0) * (j / (h - 1));
      for (let i = 0; i < w; i++) {
        this.set(x + i, y + j, ramp.at(levelIndex(t * steps, x + i, y + j, soft, steps, fine)));
      }
    }
    return this;
  }

  /** Same, horizontally — for lit/shadowed wall sides. */
  rampH(x: number, y: number, w: number, h: number, ramp: Ramp, t0 = 0, t1 = 1, fine = false): this {
    const steps = ramp.length - 1;
    const soft = slopeSoft((t1 - t0) * steps, w, fine);
    for (let i = 0; i < w; i++) {
      const t = w <= 1 ? t0 : t0 + (t1 - t0) * (i / (w - 1));
      for (let j = 0; j < h; j++) {
        this.set(x + i, y + j, ramp.at(levelIndex(t * steps, x + i, y + j, soft, steps, fine)));
      }
    }
    return this;
  }

  /**
   * Additive radial glow, quantised into `bands` steps so a torch's pool of
   * light still looks hand-placed. Only touches pixels that already exist when
   * `maskToOpaque` is set (keeps sprite glows inside the silhouette).
   */
  glow(cx: number, cy: number, radius: number, c: Col, strength = 1, bands = 4, maskToOpaque = false): this {
    const [r, g, b] = unpack(c);
    const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(this.h - 1, Math.ceil(cy + radius));
    const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(this.w - 1, Math.ceil(cx + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (maskToOpaque && !this.alpha(x, y)) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
        if (d >= 1) continue;
        let f = (1 - d) * (1 - d) * strength;
        // Quantise into bands. The falloff's slope is known in closed form, so
        // the band edges dither and the slack outer ring — where the falloff has
        // gone flat — snaps instead of speckling.
        const slope = (2 * (1 - d) * strength * bands) / radius;
        f = levelIndex(f * bands, x, y, Math.min(1, slope * 4), bands) / bands;
        if (f <= 0) continue;
        this.set(x, y, rgba(r, g, b, Math.min(255, Math.round(255 * f))), { mode: 'add' });
      }
    }
    return this;
  }

  // ----------------------------------------------------------------- masks

  /**
   * Add a keyline around every opaque pixel. `inside` draws it on the sprite's
   * own edge pixels instead of outside — used when the sprite must stay within
   * its cell.
   */
  outline(c: Col, inside = false, diagonal = false): this {
    const src = this.clone();
    const near = diagonal
      ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]
      : [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const solid = src.alpha(x, y) > 128;
        if (inside ? !solid : solid) continue;
        let edge = false;
        for (const [dx, dy] of near) {
          const a = src.alpha(x + dx, y + dy) > 128;
          if (inside ? !a : a) { edge = true; break; }
        }
        if (edge) this.set(x, y, c, { mode: 'set' });
      }
    }
    return this;
  }

  /** Drop the alpha of everything by a factor — for ghosts and fades. */
  fade(k: number): this {
    for (let i = 0; i < this.data.length; i++) {
      const c = this.data[i];
      const a = (c >>> 24) & 255;
      if (!a) continue;
      this.data[i] = (c & 0x00ffffff) | (Math.round(a * k) << 24);
    }
    return this;
  }

  /** Recolour every opaque pixel toward a tint — status effects. */
  tintAll(t: Col, amount: number): this {
    for (let i = 0; i < this.data.length; i++) {
      if (!((this.data[i] >>> 24) & 255)) continue;
      this.data[i] = tint(this.data[i], t, amount);
    }
    return this;
  }

  /** Mirror the left half onto the right — the fastest route to a readable,
   *  symmetric creature silhouette. */
  mirrorX(seam = 0): this {
    const mid = Math.floor(this.w / 2) + seam;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < mid; x++) {
        const c = this.get(x, y);
        this.set(this.w - 1 - x, y, c, { mode: 'set' });
      }
    }
    return this;
  }

  /** Composite another buffer at an offset. */
  blit(src: Pix, dx = 0, dy = 0, opts?: DrawOpts): this {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.get(x, y);
        if (!((c >>> 24) & 255)) continue;
        this.set(dx + x, dy + y, c, opts);
      }
    }
    return this;
  }

  /** Offset the whole buffer, wrapping — used to make tiles seamless. */
  scroll(dx: number, dy: number): this {
    const src = this.clone();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const sx = ((x - dx) % this.w + this.w) % this.w;
        const sy = ((y - dy) % this.h + this.h) % this.h;
        this.set(x, y, src.get(sx, sy), { mode: 'set' });
      }
    }
    return this;
  }

  /** Nearest-neighbour integer upscale. */
  scale(n: number): Pix {
    const out = new Pix(this.w * n, this.h * n);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.get(x, y);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.set(x * n + i, y * n + j, c, { mode: 'set' });
      }
    }
    return out;
  }

  /** Trim to the opaque bounding box; returns the offset that was removed. */
  bounds(): { x: number; y: number; w: number; h: number } {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!this.alpha(x, y)) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // ------------------------------------------------------------------ out

  toCanvas(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = this.w; cv.height = this.h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h);
    new Uint32Array(img.data.buffer).set(this.data);
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  /** A three.js texture with strictly nearest filtering and no mips. */
  toTexture(opts?: { repeat?: boolean; mips?: boolean }): THREE.Texture {
    const tex = new THREE.CanvasTexture(this.toCanvas());
    tex.magFilter = THREE.NearestFilter;
    // Mips would blur the pixels; we accept the shimmer and fight it with the
    // low internal render resolution instead.
    tex.minFilter = opts?.mips ? THREE.NearestMipmapNearestFilter : THREE.NearestFilter;
    tex.generateMipmaps = !!opts?.mips;
    const wrap = opts?.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapS = wrap; tex.wrapT = wrap;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 1;
    return tex;
  }
}

/** Stack several Pix frames into one horizontal sheet + a three.js texture. */
export function sheet(frames: Pix[]): Pix {
  if (!frames.length) return new Pix(1, 1);
  const w = frames[0].w, h = frames[0].h;
  const out = new Pix(w * frames.length, h);
  frames.forEach((f, i) => out.blit(f, i * w, 0));
  return out;
}
