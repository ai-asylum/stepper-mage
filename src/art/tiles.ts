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
import { hex, mix, Pix, Ramp, resolveLevels, rgba, shade, slopeSoft, type Col } from './pixel';
import { ppu, stepArt, type AoArt, type GrainArt, type MasonryArt } from './steps';
import type { FloorDetail, Theme } from './theme';

/**
 * Wall height in world units. A real room, not a crawlspace.
 *
 * The one geometric constant left in this file: it is WORLD units, so unlike every
 * texel count in here it does not move with the step. Texels per world unit is
 * `ppu()` from `./steps`, read at build time.
 */
export const WALL_H = 1.05;

/**
 * An inclusive random range that survives a coarse step.
 *
 * Every inset in the art table is a texel count, and a wall is 18 texels wide at
 * the bottom step — so a range that was `rng.int(12, w - 12)` at 144 inverts, and
 * `rng.int(12, 6)` returns a coordinate off the face entirely. Collapsing an
 * inverted range to its midpoint keeps the feature on the wall while the follow-up
 * is still choosing the insets.
 */
function span(rng: Rng, lo: number, hi: number): number {
  return hi <= lo ? Math.round((lo + hi) / 2) : rng.int(lo, hi);
}

/** A mutable float brightness field, resolved to a Ramp at the end. */
class Field {
  readonly w: number;
  readonly h: number;
  readonly v: Float32Array;
  /**
   * Where this field is a FALLOFF rather than an authored tone, 0..1 — the
   * dither licence `resolveLevels` needs. Only the passes that spread a
   * brightness change over distance write it (AO edges, the vault's arch, soot,
   * a waterline). Everything else — masonry, grain, cracks, plate — is a tone
   * that wants to land on a ramp step and stay there, and dithering it is what
   * put a checkerboard on every wall.
   */
  readonly soft: Float32Array;

  constructor(w: number, h: number, init = 0.5) {
    this.w = w; this.h = h;
    this.v = new Float32Array(w * h).fill(init);
    this.soft = new Float32Array(w * h);
  }

  /** Declare this texel part of a falloff, licensing it to dither. */
  soften(x: number, y: number, k: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (k > this.soft[i]) this.soft[i] = k;
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

  /**
   * Quantise through a ramp. Shared with the book (`src/art/pixel.ts`), so the
   * flat-snaps-and-only-falloffs-dither rule is one implementation, not two.
   */
  resolve(ramp: Ramp, fine = true, seed = 0): Pix {
    const steps = ramp.length - 1;
    const lvl = new Float32Array(this.w * this.h);
    for (let i = 0; i < lvl.length; i++) {
      const t = this.v[i];
      lvl[i] = (t < 0 ? 0 : t > 1 ? 1 : t) * steps;
    }
    return resolveLevels(lvl, this.soft, this.w, this.h, ramp, { fine, seed });
  }
}

/**
 * Stamp a course of masonry blocks into a brightness field.
 *
 * The bevel is the load-bearing part: a lighter top/left edge and a darker
 * bottom/right edge per block is what reads as "carved stone" instead of "noise on
 * a rectangle", and it survives the low internal render resolution.
 *
 * Its WIDTH is the step's business, not this function's. The four profile arrays in
 * `MasonryArt` are one weight per texel in from the edge, so at 144 the top edge is
 * two texels and at 36 it is one, and neither is a scaled version of the other.
 */
function masonry(f: Field, rng: Rng, noise: Noise2, m: MasonryArt, variant: number): void {
  const rowH = m.rowH;
  const blockW = m.blockW[variant % 3 === 0 ? 0 : 1];
  const { gap, bevel, jitter } = m;

  for (let ry = -rowH; ry < f.h + rowH; ry += rowH) {
    // stagger every other course, with a little wander so it never looks like tiling
    const rowIdx = Math.round(ry / rowH);
    const offset = (rowIdx % 2 ? blockW[0] * 0.5 : 0) + rng.range(-m.stagger, m.stagger);
    let x = -offset - blockW[1];
    while (x < f.w + blockW[1]) {
      const bw = Math.round(rng.range(blockW[0], blockW[1]));
      const bx = Math.round(x);
      const by = ry + Math.round(rng.range(-m.wobble, m.wobble));
      const bh = rowH - gap;

      // per-block base brightness — the single biggest anti-tiling cue
      const base = rng.range(-jitter, jitter)
        + (noise.at(bx * m.noiseFreq, by * m.noiseFreq) - 0.5) * m.noiseAmt;

      for (let yy = by; yy < by + bh; yy++) {
        for (let xx = bx; xx < bx + bw - gap; xx++) {
          if (xx < 0 || yy < 0 || xx >= f.w || yy >= f.h) continue;
          let v = base;
          const ex = xx - bx, ey = yy - by;
          const rx = bx + bw - gap - 1 - xx, ry2 = by + bh - 1 - yy;
          // lit top + left
          if (ey < m.litTop.length) v += bevel * m.litTop[ey];
          if (ex < m.litLeft.length) v += bevel * m.litLeft[ex];
          // shadowed bottom + right (deeper: this is the recess into mortar)
          if (ry2 < m.darkBottom.length) v -= bevel * m.darkBottom[ry2];
          if (rx < m.darkRight.length) v -= bevel * m.darkRight[rx];
          f.add(xx, yy, v);
        }
      }
      x += bw;
    }
  }
}

/**
 * Multiply darkness into the edges of a face — cheap contact AO.
 *
 * The three ramps are falloffs, so they carry a dither licence over their own
 * reach and nowhere else. The span is estimated as `amount * 3`: a mid-grey
 * field on a five-or-six step ramp, since the ramp itself is not known here.
 */
function edgeAo(f: Field, ao: AoArt): void {
  const { top, bottom, sides } = ao;
  const softTop = slopeSoft(top * 3, f.h * 0.28, true);
  const softBot = slopeSoft(bottom * 3, f.h * 0.3, true);
  const softSide = slopeSoft(sides * 3, f.w * 0.12, true);
  for (let y = 0; y < f.h; y++) {
    const ty = y / f.h;
    const kTop = top > 0 ? 1 - top * Math.max(0, 1 - ty / 0.28) : 1;
    const kBot = bottom > 0 ? 1 - bottom * Math.max(0, 1 - (1 - ty) / 0.3) : 1;
    for (let x = 0; x < f.w; x++) {
      const tx = Math.min(x, f.w - 1 - x) / f.w;
      const kSide = sides > 0 ? 1 - sides * Math.max(0, 1 - tx / 0.12) : 1;
      f.mul(x, y, kTop * kBot * kSide);
      if (kTop < 1) f.soften(x, y, softTop);
      if (kBot < 1) f.soften(x, y, softBot);
      if (kSide < 1) f.soften(x, y, softSide);
    }
  }
}

/**
 * Fine grain — the last 10% that stops flat stone looking like plastic.
 *
 * `freq` is per TEXEL, so it is the one noise term in here that has to be reauthored
 * per step or the grain turns from stone into static as the grid coarsens.
 */
function grain(f: Field, noise: Noise2, g: GrainArt): void {
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      f.add(x, y, (noise.fbm(x * g.freq, y * g.freq, 3) - 0.5) * g.amount);
    }
  }
}

/**
 * A branching crack, drawn as a dark line into the field.
 *
 * Its cross-section comes from the step: at 144 a crack is a dark texel with two
 * softer ones beside and below it, and at 36 those two are zero — three texels of
 * crack across a 10-texel brick is a hole, not a crack.
 */
function crack(f: Field, rng: Rng, x0: number, y0: number, len: number, dir: number, depth = 0): void {
  const c = stepArt().crack;
  let x = x0, y = y0, a = dir;
  for (let i = 0; i < len; i++) {
    a += rng.range(-0.5, 0.5);
    x += Math.cos(a); y += Math.sin(a);
    const ix = Math.round(x), iy = Math.round(y);
    f.add(ix, iy, -c.core);
    if (c.side) f.add(ix + 1, iy, -c.side);
    if (c.below) f.add(ix, iy + 1, -c.below);
    if (depth < 2 && rng.chance(c.branchChance)) {
      crack(f, rng, x, y, len * c.branchLen, a + rng.range(-1.2, 1.2), depth + 1);
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
  const art = stepArt().detail;

  if (detail === 'waterline') {
    // A tide mark two-thirds down, with algae below and slow drips above.
    const w = art.waterline;
    const base = f.h * w.lineFrac + rng.range(-w.lineJitter, w.lineJitter);
    for (let x = 0; x < f.w; x++) {
      const wave = Math.sin(x * w.waveFreq + rng.next() * 0.2) * w.waveAmp
        + noise.at(x * w.noiseFreq, 3) * w.noiseAmp;
      // Clamped, because at 19 texels tall a wave that was ±7 at 144 walks the tide
      // mark off the bottom of the face and the stain covers the whole wall.
      const line = Math.max(1, Math.min(f.h - 2, Math.round(base + wave)));
      const softTide = slopeSoft(0.3, f.h - line, true);
      for (let y = line; y < f.h; y++) {
        const d = (y - line) / (f.h - line + 1);
        f.mul(x, y, 0.74 + d * 0.1);
        f.soften(x, y, softTide);
      }
      // the stain edge itself is darkest
      f.mul(x, line, 0.55);
      f.mul(x, line + 1, 0.7);
    }
    // algae speckle clinging under the waterline
    for (let i = 0; i < w.algae; i++) {
      const x = rng.int(0, f.w - 1);
      const y = span(rng, Math.round(base) + 2, f.h - 1);
      if (noise.fbm(x * w.algaeFreq, y * w.algaeFreq, 2) < 0.44) continue;
      p.set(x, y, mix(p.get(x, y), hex(0x2e5f4a), rng.range(0.25, 0.6)));
    }
    // vertical drip streaks from the top
    const drips = span(rng, w.drips[0], w.drips[1]);
    for (let i = 0; i < drips; i++) {
      const x = span(rng, 4, f.w - 5);
      const len = span(rng, w.dripMin, Math.round(base));
      for (let y = 0; y < len; y++) {
        const c = p.get(x, y);
        p.set(x, y, shade(c, 0.72));
        if (rng.chance(0.3)) p.set(x + 1, y, shade(p.get(x + 1, y), 0.86));
      }
    }
  } else if (detail === 'bone') {
    const b = art.bone;
    // soot creeping down from the ceiling — a long falloff, so it may dither
    for (let x = 0; x < f.w; x++) {
      const reach = b.sootReach + noise.fbm(x * b.sootFreq, 1, 3) * b.sootSpread;
      const soft = slopeSoft(1.5, reach, true);
      for (let y = 0; y < reach; y++) {
        f.mul(x, y, 0.5 + 0.5 * (y / reach));
        f.soften(x, y, soft);
      }
    }
    // bone inlay: a femur or a small skull set into the masonry
    //
    // DROPPED below a size rather than shrunk, and `skullRx: 0` in a step's table is
    // that step saying so. Two reasons, and the second is the harder one: a five-texel
    // skull is a pale smudge with a dark bar in it, and `outline(_, true)` treats the
    // buffer's own border as an edge, so the keyline lands round the whole FACE as well
    // as round the bone. At 144 that is one texel in a hundred and forty-four and it
    // has always shipped; at 36 it is a bone-coloured frame round every second wall.
    // The soot above and the bone shards underfoot carry the floor without it.
    if (variant % 2 === 0 && b.skullRx >= 4) {
      const cx = span(rng, b.inset, f.w - b.inset);
      const cy = span(rng, Math.round(f.h * 0.3), Math.round(f.h * 0.7));
      const boneCol = hex(0xd8c9a0), boneDark = hex(0x8a7a58);
      if (rng.chance(0.5)) {
        // femur, laid horizontally
        const len = span(rng, b.femurLen[0], b.femurLen[1]);
        p.taper(cx - len / 2, cy, cx + len / 2, cy + rng.range(-b.femurW, b.femurW),
          b.femurW, b.femurW, boneCol);
        for (const s of [-1, 1]) {
          p.ellipse(cx + (s * len) / 2, cy - b.knuckleGap, b.knuckleR, b.knuckleRy, boneCol);
          p.ellipse(cx + (s * len) / 2, cy + b.knuckleGap, b.knuckleR, b.knuckleRy, boneCol);
        }
        p.outline(boneDark, true);
      } else {
        // small skull
        p.ellipse(cx, cy, b.skullRx, b.skullRy, boneCol);
        p.rect(cx - b.jawW / 2, cy + b.jawH, b.jawW, b.jawH, boneCol);
        p.ellipse(cx - b.eyeGap, cy - 0.5, b.eyeR, b.eyeRy, hex(0x2a1c16));
        p.ellipse(cx + b.eyeGap, cy - 0.5, b.eyeR, b.eyeRy, hex(0x2a1c16));
        // The nose and the teeth are DROPPED rather than shrunk once the skull is
        // small enough that they would cover it. A feature that cannot be drawn at a
        // step is not a smaller version of itself, it is one fewer feature. The
        // threshold is above 72's skull on purpose: at five texels of radius the jaw
        // already owns every row a nose or a tooth could go in.
        if (b.skullRx >= 6) {
          p.rect(cx - 1, cy + 3, 2, 2, hex(0x2a1c16));
          for (let i = -b.teethSpan; i <= b.teethSpan; i += b.teethStep) {
            p.set(cx + i, cy + b.teethDrop, hex(0x2a1c16));
          }
        }
        p.outline(boneDark, true);
      }
    }
    // grease drips
    for (let i = 0; i < b.greaseDrips; i++) {
      const x = span(rng, 3, f.w - 4);
      const len = span(rng, b.greaseLen[0], b.greaseLen[1]);
      const y0 = span(rng, 0, f.h - len);
      for (let y = y0; y < y0 + len; y++) p.set(x, y, mix(p.get(x, y), hex(0x3a2a10), 0.5));
    }
  } else if (detail === 'moss') {
    const m = art.moss;
    // moss creeps UP from the floor and out of every recess
    for (let x = 0; x < f.w; x++) {
      const reach = m.reach + noise.fbm(x * m.reachFreq, 7, 3) * m.spread;
      for (let y = f.h - 1; y > f.h - reach; y--) {
        const t = 1 - (f.h - y) / reach;
        if (noise.fbm(x * m.mossFreq, y * m.mossFreq, 3) * 1.15 < 1 - t) continue;
        const mossCol = mix(hex(0x2f4a26), acc, noise.at(x * 0.2, y * 0.2) * 0.35);
        p.set(x, y, mix(p.get(x, y), mossCol, 0.55 + t * 0.4));
      }
    }
    // a root splitting the stone
    if (variant % 2 === 0) {
      const x0 = span(rng, 10, f.w - 10);
      crack(f, rng, x0, f.h - 1, span(rng, m.rootLen[0], m.rootLen[1]),
        -Math.PI / 2 + rng.range(-0.4, 0.4));
    }
    // hanging strands from the top edge
    for (let i = 0; i < m.strands; i++) {
      const x = span(rng, 2, f.w - 3);
      const len = span(rng, m.strandLen[0], m.strandLen[1]);
      for (let y = 0; y < len; y++) p.set(x, y, mix(p.get(x, y), hex(0x3d5c2e), 0.7));
    }
  } else if (detail === 'rivet') {
    const r = art.rivet;
    // riveted iron plate bolted over the stone
    const py0 = Math.round(f.h * 0.22), py1 = Math.round(f.h * 0.82);
    const inset = r.plateInset;
    for (let y = py0; y < py1; y++) {
      for (let x = inset; x < f.w - inset; x++) {
        let v = 0.06;
        if (y === py0) v += 0.2;
        if (y === py1 - 1) v -= 0.26;
        if (x === inset) v += 0.14;
        if (x === f.w - inset - 1) v -= 0.2;
        f.add(x, y, v);
      }
    }
    // rivets along the plate seams
    const rc = hex(0x2a1a14);
    for (let x = r.rivetStart; x < f.w - r.rivetStart; x += r.rivetStep) {
      for (const y of [py0 + r.rivetInset, py1 - r.rivetInset - 1]) {
        p.ellipse(x, y, r.rivetR, r.rivetR, shade(p.get(x, y), 1.5));
        // Two texels of shadow under a one-texel head is a shadow bigger than the
        // rivet casting it, and a whole row of them merges into a black line. So the
        // shadow is dropped once the head stops being wider than a texel.
        if (r.rivetR >= 1) {
          p.set(x + 1, y + 1, rc);
          p.set(x, y + 1, rc);
        }
      }
    }
    // lava seams glowing through the cracks
    const seams = span(rng, r.seams[0], r.seams[1]);
    for (let i = 0; i < seams; i++) {
      let x = rng.range(6, f.w - 6), y = rng.range(py0, py1), a = rng.range(0, Math.PI * 2);
      for (let s = 0, n = span(rng, r.seamLen[0], r.seamLen[1]); s < n; s++) {
        a += rng.range(-0.45, 0.45);
        x += Math.cos(a); y += Math.sin(a);
        const ix = Math.round(x), iy = Math.round(y);
        p.set(ix, iy, acc);
        p.set(ix, iy + 1, mix(p.get(ix, iy + 1), theme.accentDeep, 0.7));
      }
    }
    for (let i = 0; i < seams; i++) {
      p.glow(rng.range(8, f.w - 8), rng.range(py0, py1),
        rng.range(r.glowR[0], r.glowR[1]), acc, 0.32, 3);
    }
  } else if (detail === 'inlay') {
    const g = art.inlay;
    // gold constellation inlay: a few stars joined by hairline channels
    const n = span(rng, g.stars[0], g.stars[1]);
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      pts.push([
        span(rng, g.inset, f.w - g.inset),
        span(rng, Math.round(f.h * 0.18), Math.round(f.h * 0.8)),
      ]);
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], mix(acc, hex(0x6b5a20), 0.45));
    }
    for (const [x, y] of pts) {
      // a four-point star, the only place we allow a bright accent on a wall — and a
      // bare point once the spokes would be longer than the brick they sit on.
      p.set(x, y, hex(0xfffbe0));
      if (g.spoke > 0) {
        p.line(x - g.spoke, y, x + g.spoke, y, acc);
        p.line(x, y - g.spoke, x, y + g.spoke, acc);
      }
      p.set(x, y, hex(0xfffbe0));
      p.glow(x, y, g.glowR, acc, 0.5, 3);
    }
    // Faint vertical fluting. A flute is a lit column and its shadow, so it is two
    // texels wide however coarse the grid gets — which means its SPACING is the only
    // thing a step can choose, and below about four the pairs meet and the face is
    // striped rather than fluted. `fluteStep: 0` is the step saying it has no fluting.
    if (g.fluteStep > 0) {
      for (let x = g.fluteStart; x < f.w - g.fluteStart; x += g.fluteStep) {
        for (let y = 0; y < f.h; y++) {
          p.set(x, y, shade(p.get(x, y), 1.1));
          p.set(x + 1, y, shade(p.get(x + 1, y), 0.88));
        }
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
  // Seeded PER VARIANT, which it did not used to be. Every variant drew from the
  // same sequence, so the only things telling two wall faces apart were the course
  // height and the block width the variant index selected. Course height had to
  // stop varying — it is what breaks a wall run at its seams — and taking it away
  // would have left six variants collapsing onto two patterns, which is the same
  // tiling artefact from the other direction. Varying the sequence instead gives
  // every face its own block layout and jitter under courses that still line up.
  const rng = new Rng(`${seed}-w${variant}`);
  const noise = new Noise2(seed + '-n');
  const art = stepArt().wall;
  const W = ppu(), H = Math.round(ppu() * WALL_H);
  const f = new Field(W, H, art.base);

  masonry(f, rng, noise, art.masonry, variant);
  grain(f, noise, art.grain);
  // the top of a wall is shaded by the ceiling, the bottom by the floor contact
  edgeAo(f, art.ao);
  if (variant % 4 === 3) {
    const c = art.crack;
    crack(f, rng, span(rng, c.inset, W - c.inset), span(rng, c.top, H - c.bottom),
      span(rng, c.len[0], c.len[1]), rng.range(0.9, 2.3));
  }

  const p = f.resolve(theme.wall, true, 11 + variant);
  wallDetail(p, f, rng, noise, theme, variant);
  return p;
}

function buildFloor(theme: Theme, seed: string, variant: number): Pix {
  const rng = new Rng(seed);
  const noise = new Noise2(seed + '-n');
  const art = stepArt().floor;
  const det = stepArt().detail;
  const P = ppu();
  const f = new Field(P, P, art.base);

  // Flagstones via cellular noise: irregular slabs with dark joints, which
  // reads better underfoot than a regular grid at a grazing camera angle.
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      const c = noise.cell(x * art.cellFreq, y * art.cellFreq);
      let v = art.base + (noise.fbm(x * art.blendFreq, y * art.blendFreq, 3) - 0.5) * art.blend;
      if (art.crownGain >= 0) {
        if (c < art.jointW) v -= art.jointDepth * (1 - c / art.jointW);          // joint
        else v += Math.min(art.crownMax, (c - art.jointW) * art.crownGain);      // slab crown
      } else {
        // The same field read the other way up. `cell` returns distance from a
        // slab's SEED, so the pit above sits in the middle of a flagstone and only
        // reads as a joint while it is several texels across and the crown around it
        // has room to rise. At 36 it is one dark texel in the middle of a slab —
        // which is a chip, not a joint — and at 18 it is nothing at all. Crowning the
        // seed instead puts the darkness on the cell BOUNDARY, so a four-texel slab
        // still gets a one-texel line round it. `crownMax` is not used here: the cap
        // on this falloff is `jointDepth`, because it is the joint.
        v -= Math.min(art.jointDepth, Math.max(0, c - art.jointW) * -art.crownGain);
      }
      f.set(x, y, v);
    }
  }
  grain(f, noise, art.grain);
  // Heavy edge darkening per tile. Each floor quad is one tile, so this draws a
  // seam at every tile boundary — the single cue that tells you where you stand
  // and how far the wall actually is.
  edgeAo(f, art.ao);

  const p = f.resolve(theme.floor, true, 41 + variant);

  // theme dressing on the ground
  if (theme.detail === 'waterline') {
    // shallow standing water in the low spots
    const wf = det.waterline.floorFreq;
    for (let y = 0; y < P; y++) {
      for (let x = 0; x < P; x++) {
        const w = noise.fbm(x * wf + 11, y * wf, 3);
        if (w < 0.52) continue;
        const t = Math.min(1, (w - 0.52) * 4);
        p.set(x, y, mix(p.get(x, y), hex(0x16303a), 0.35 + t * 0.4));
        if (t > 0.7 && rng.chance(0.04)) p.set(x, y, hex(0x4e7f8c)); // glint
      }
    }
  } else if (theme.detail === 'moss') {
    const mf = det.moss.floorFreq;
    for (let y = 0; y < P; y++) {
      for (let x = 0; x < P; x++) {
        const m = noise.fbm(x * mf + 5, y * mf, 3);
        if (m < 0.5) continue;
        p.set(x, y, mix(p.get(x, y), hex(0x2c4423), Math.min(0.75, (m - 0.5) * 3)));
      }
    }
  } else if (theme.detail === 'bone') {
    const b = det.bone;
    for (let i = 0; i < b.floorBones; i++) {
      const x = span(rng, 4, P - 5), y = span(rng, 4, P - 5);
      const r = b.floorBoneReach;
      p.taper(x, y, x + rng.range(-r, r), y + rng.range(-r, r),
        b.floorBoneW, b.floorBoneW, hex(0xa89468));
    }
    for (let i = 0; i < b.floorPits; i++) {
      p.ellipse(span(rng, 6, P - 6), span(rng, 6, P - 6),
        rng.range(b.floorPitR[0], b.floorPitR[1]),
        rng.range(b.floorPitRy[0], b.floorPitRy[1]), hex(0x2c1a10));
    }
  } else if (theme.detail === 'rivet') {
    const r = det.rivet;
    // grated channels with ember light beneath
    if (variant % 3 === 0) {
      const y0 = span(rng, r.grateTop, P - r.grateTop - r.grateH);
      for (let y = y0; y < y0 + r.grateH; y++) {
        for (let x = 0; x < P; x++) {
          p.set(x, y, y % (r.grateBar * 2) < r.grateBar
            ? hex(0x1a1010)
            : mix(theme.accentDeep, theme.accent, noise.at(x * 0.1, y) * 0.7));
        }
      }
      p.glow(P / 2, y0 + r.grateH / 2, r.grateGlow, theme.accent, 0.3, 3);
    }
    for (let i = 0; i < r.floorSpecks; i++) {
      p.set(rng.int(0, P - 1), rng.int(0, P - 1), hex(0x2a1c14));
    }
  } else if (theme.detail === 'inlay') {
    const g = det.inlay;
    // a polished marble sheen band
    for (let y = 0; y < P; y++) {
      for (let x = 0; x < P; x++) {
        const v = noise.ridge(x * g.ridgeFreq, y * g.ridgeFreq, 3);
        if (v > 0.72) p.set(x, y, mix(p.get(x, y), hex(0x8fa0d8), (v - 0.72) * 2));
      }
    }
    if (variant % 3 === 0) {
      p.ellipseFrame(P / 2, P / 2, g.ringR[0], g.ringR[0], mix(theme.accent, hex(0x5a4a18), 0.5));
      // Two concentric rings a texel apart are one fat ring. The inner one is dropped
      // when it would touch the outer, so the coarse steps get a single hairline.
      if (g.ringR[0] - g.ringR[1] >= 2) {
        p.ellipseFrame(P / 2, P / 2, g.ringR[1], g.ringR[1], mix(theme.accent, hex(0x5a4a18), 0.6));
      }
    }
  }
  return p;
}

function buildCeil(theme: Theme, seed: string, variant: number): Pix {
  const rng = new Rng(seed);
  const noise = new Noise2(seed + '-n');
  const art = stepArt().ceil;
  const P = ppu();
  const f = new Field(P, P, art.base);

  // rough barrel-vault: brightest along the crown, falling off to the springing.
  // The vault IS the falloff, so it holds the licence; the fbm on top of it does not.
  const softArch = slopeSoft(0.15 * 3, P / 2, true);
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      const arch = 1 - Math.abs(x / P - 0.5) * art.archSlope;
      f.set(x, y, art.base + arch * art.archLift
        + (noise.fbm(x * art.blendFreq, y * art.blendFreq, 3) - 0.5) * art.blend);
      f.soften(x, y, softArch);
    }
  }
  // Variant 0's courses, always: the ceiling only ever had one set of them, and the
  // vault reads as a vault because every tile's masonry runs the same way.
  masonry(f, rng, noise, art.masonry, 0);
  edgeAo(f, art.ao);

  const p = f.resolve(theme.ceil, true, 71 + variant);

  // a timber beam across every third ceiling tile — gives corridors rhythm
  if (variant % 3 === 0) {
    const bh = art.beamH, y0 = Math.round(P * 0.5 - bh / 2);
    for (let y = y0; y < y0 + bh; y++) {
      for (let x = 0; x < P; x++) {
        const t = (y - y0) / bh;
        const wood = mix(hex(0x2a1d14), hex(0x4a3524), 1 - Math.abs(t - 0.35) * 2);
        p.set(x, y, wood);
      }
    }
    for (let x = 0; x < P; x++) {
      p.set(x, y0, hex(0x120c08));
      p.set(x, y0 + bh - 1, hex(0x0d0906));
    }
  }
  if (theme.detail === 'waterline') {
    for (let i = 0; i < stepArt().detail.waterline.ceilSpecks; i++) {
      const x = rng.int(0, P - 1), y = rng.int(0, P - 1);
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
  const { w: W, h: H } = stepArt().sconce;
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
