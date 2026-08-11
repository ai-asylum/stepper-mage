/**
 * Spell pages, authored as REAL PIXEL ART.
 *
 * LOCAL: upstream paints these faces with antialiased serif type, bezier sigils,
 * radial-gradient parchment and `shadowBlur` glows onto a 512x660 canvas. This
 * game's world is authored pixel art (`src/art/pixel.ts`, 144 texels per world
 * unit, ramps + ordered dither, NEAREST-upscaled), so a smooth book on top of it
 * read as vector art pasted over a pixel-art game. Every page face is now drawn
 * through `Pix` at 128x168 — the size at which one texel lands on ~3 device px of
 * the page as it is actually held — and uploaded with nearest filtering.
 *
 * The character has to survive the port, not just the pipeline: the wobbly ink
 * borders, the sigil ring with its rune ticks, the per-spell sigil and the fake
 * arcane script are all still here, re-authored on the grid. Depth comes from a
 * `Ramp` instead of a gradient, quantised through `resolveLevels`, which dithers
 * the sheet's two real falloffs and snaps everything else flat.
 *
 * Type is the reason the smooth layer existed at all, so it is not a shrunken
 * serif: `src/art/bitfont.ts` is a hand-authored bitmap face sized to this grid.
 *
 * `SIGILS` keeps its CANVAS signature. `src/spells/harvestCards.ts` and
 * `ingredientCards.ts` register the marks for cards the book cannot know about
 * through it, in upstream's ink language, and those files are not part of this
 * change — so a canvas mark is resampled onto the page grid (`resample`) the same
 * way the game's creature sprites are. A page's own sigil is hand-authored in
 * `PIX_SIGILS` and never goes through that path.
 */
import * as THREE from 'three';
import { ALL_PAGES, CHAPTERS, type SpellDef } from '../spells/pages';
import { rankName } from '../spells/spells';
import { chapters } from '../style/palette';
import { hex, mix, Pix, Ramp, resolveLevels, rgba, shade, slopeSoft, unpack, type Col } from '../art/pixel';
import { CELL_H, drawCentered, fitCentered, wrap } from '../art/bitfont';
import { giltify } from './giltify';

/** The canvas the ported `SigilFn` table is authored against. */
const W = 512;
const H = 660;
/** The page that actually ships. 128/168 ≈ PAGE_W/PAGE_H, so texels stay square. */
export const PIX_W = 128;
export const PIX_H = 168;

/** The CSS side of the ink, for the canvas marks that cards still register. */
const INK = '#3d2e50';

// The packed side of the same palette.
const C_INK = hex(0x33253f);
const C_INK_MID = hex(0x584066);
const C_INK_FAINT = hex(0x7a6480);
/**
 * Aged parchment, dark edge to light centre. Warmer and less white than
 * upstream's `#fdf3dc`, which read as a sheet of printer paper against
 * torchlight; five steps because that is what the ordered dither needs to
 * carry a vignette without banding.
 */
const PARCH = new Ramp([0xb08f5e, 0xc9a878, 0xdcc296, 0xe8d3ab, 0xf3e5c6]);
/** Kept: the lore page and the gilt pass still ink in gold. */
export const C_GOLD = hex(0xd9a03c);
export const C_GOLD_HI = hex(0xffe0a0);

// deterministic-ish wobble
function wob(seed: number, t: number, freq = 5): number {
  return Math.sin(t * freq + seed * 1.7) * 0.65 + Math.sin(t * freq * 2.1 + seed * 0.9) * 0.35;
}

function makeCanvas(w = W, h = H): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** A packed triad, the pixel-art twin of `SpellColors`. */
interface Triad { main: Col; glow: Col; deep: Col; }

function triadOf(spell: SpellDef): Triad {
  const num = (s: string) => parseInt(s.replace('#', ''), 16);
  return {
    main: hex(num(spell.colors.main)),
    glow: hex(num(spell.colors.glow)),
    deep: hex(num(spell.colors.deep)),
  };
}

// ------------------------------------------------------------- parchment
/**
 * The sheet itself. Brightness is kept as a float field and quantised ONCE at the
 * end through `PARCH`, which is what lets the vignette, the blotches, the spine
 * shadow and the speckle stack without turning to mud (`src/art/tiles.ts` builds
 * every wall the same way).
 */
function parchment(seed: number, spineShadowLeft = true): Pix {
  /**
   * Levels are held in RAMP-STEP units, not in [0,1], because the difference
   * between a flat field and a gradient has to be expressible exactly.
   *
   * ORDERED DITHER IS FOR GRADIENTS, NOT FOR FLAT FIELDS. A constant tone that
   * lands between two steps flips every other texel across the whole sheet, and a
   * page of screen door reads as a rendering fault, not as paper. So the sheet
   * starts ON step 3 and everything authored — stains, fibre, foxing — moves it by
   * WHOLE steps. Only the two things that genuinely vary across distance, the rim
   * vignette and the gutter shadow, hold fractional levels, and only those dither.
   */
  const BASE = 3;
  const lvl = new Float32Array(PIX_W * PIX_H).fill(BASE);
  /** The dither licence, per texel — see `resolveLevels`. Zero is flat. */
  const soft = new Float32Array(PIX_W * PIX_H);
  const step = (x: number, y: number, d: number) => {
    if (x < 0 || y < 0 || x >= PIX_W || y >= PIX_H) return;
    lvl[y * PIX_W + x] += d;
  };
  const soften = (x: number, y: number, k: number) => {
    if (x < 0 || y < 0 || x >= PIX_W || y >= PIX_H) return;
    const i = y * PIX_W + x;
    if (k > soft[i]) soft[i] = k;
  };

  // damp stains: authored patches one step down, with a wobbling rim so they read
  // as spilled rather than as circles. Masked, so an overlap is not two steps.
  const stain = new Uint8Array(PIX_W * PIX_H);
  for (let i = 0; i < 11; i++) {
    const cx = ((Math.sin(seed * 31 + i * 17.3) + 1) / 2) * PIX_W;
    const cy = ((Math.sin(seed * 47 + i * 29.7) + 1) / 2) * PIX_H;
    const r = 7 + ((Math.sin(i * 7.7 + seed) + 1) / 2) * 15;
    for (let y = Math.floor(cy - r) - 2; y <= cy + r + 2; y++) {
      for (let x = Math.floor(cx - r) - 2; x <= cx + r + 2; x++) {
        if (x < 0 || y < 0 || x >= PIX_W || y >= PIX_H) continue;
        const a = Math.atan2(y - cy, x - cx);
        if (Math.hypot(x - cx, y - cy) >= r * (1 + wob(seed + i, a, 3) * 0.22)) continue;
        stain[y * PIX_W + x] = 1;
      }
    }
  }
  for (let i = 0; i < stain.length; i++) if (stain[i]) lvl[i] -= 1;

  // the rim: handled for a few centuries. A real falloff, so this one dithers.
  const softRim = slopeSoft(1.5, PIX_W * 0.1, true);
  for (let y = 0; y < PIX_H; y++) {
    for (let x = 0; x < PIX_W; x++) {
      const e = Math.min(
        Math.min(x, PIX_W - 1 - x) / (PIX_W * 0.5),
        Math.min(y, PIX_H - 1 - y) / (PIX_H * 0.5),
      );
      if (e < 0.2) { step(x, y, -1.5 * (1 - e / 0.2) * (1 - e / 0.2)); soften(x, y, softRim); }
    }
  }
  // the gutter, where the sheet turns into the spine. Also a real falloff.
  const softGutter = slopeSoft(1.7, 15, true);
  for (let y = 0; y < PIX_H; y++) {
    for (let x = 0; x < 15; x++) {
      const gx = spineShadowLeft ? x : PIX_W - 1 - x;
      const k = 1 - x / 15;
      step(gx, y, -1.7 * k * k);
      soften(gx, y, softGutter);
    }
  }
  // fibre: single-texel runs, a whole step either way
  for (let i = 0; i < 9; i++) {
    const y = Math.floor(((Math.sin(seed * 11 + i * 23.1) + 1) / 2) * PIX_H);
    const x0 = Math.floor(((Math.sin(seed * 7 + i * 13.7) + 1) / 2) * PIX_W * 0.6);
    const len = 18 + ((i * 37) % 40);
    for (let x = x0; x < x0 + len; x++) step(x, y, i % 2 ? 1 : -1);
  }
  // foxing: single dark texels, one or two steps down
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(((Math.sin(seed * 3 + i * 12.9) + 1) / 2) * PIX_W);
    const y = Math.floor(((Math.sin(seed * 5 + i * 8.3) + 1) / 2) * PIX_H);
    step(x, y, i % 4 ? -1 : -2);
  }

  // The shared quantiser: flat snaps, and only the two declared falloffs above
  // are licensed to dither (`resolveLevels` in `src/art/pixel.ts`).
  return resolveLevels(lvl, soft, PIX_W, PIX_H, PARCH, { fine: true, seed: seed | 0 });
}

// ------------------------------------------------------------- ink language
/**
 * A hand-inked straight run: the path wanders by a texel and the stroke thickens
 * and thins along its length. This is the whole reason the borders read as drawn
 * rather than as a `frame()` call.
 */
function inkRun(
  p: Pix, x0: number, y0: number, x1: number, y1: number,
  col: Col, seed: number, weight = 1,
): void {
  const steps = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0)));
  const horizontal = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const off = Math.round(wob(seed, t * 5.5) * 0.85);
    const thick = weight + (wob(seed + 4, t * 3.1) > 0.3 ? 1 : 0);
    const x = Math.round(x0 + (x1 - x0) * t) + (horizontal ? 0 : off);
    const y = Math.round(y0 + (y1 - y0) * t) + (horizontal ? off : 0);
    for (let k = 0; k < thick; k++) {
      if (horizontal) p.set(x, y + k, col);
      else p.set(x + k, y, col);
    }
  }
}

/** The page's border: two wobbling rules and four corner lozenges. */
function border(p: Pix, seed: number): void {
  const o = 4, i2 = 8;
  inkRun(p, o, o, PIX_W - 1 - o, o, C_INK, seed, 1);
  inkRun(p, PIX_W - 1 - o, o, PIX_W - 1 - o, PIX_H - 1 - o, C_INK, seed + 11, 1);
  inkRun(p, PIX_W - 1 - o, PIX_H - 1 - o, o, PIX_H - 1 - o, C_INK, seed + 22, 1);
  inkRun(p, o, PIX_H - 1 - o, o, o, C_INK, seed + 33, 1);
  inkRun(p, i2, i2, PIX_W - 1 - i2, i2, C_INK_MID, seed + 50, 1);
  inkRun(p, PIX_W - 1 - i2, i2, PIX_W - 1 - i2, PIX_H - 1 - i2, C_INK_MID, seed + 61, 1);
  inkRun(p, PIX_W - 1 - i2, PIX_H - 1 - i2, i2, PIX_H - 1 - i2, C_INK_MID, seed + 72, 1);
  inkRun(p, i2, PIX_H - 1 - i2, i2, i2, C_INK_MID, seed + 83, 1);
  for (const [cx, cy] of [[o + 2, o + 2], [PIX_W - 3 - o, o + 2], [o + 2, PIX_H - 3 - o], [PIX_W - 3 - o, PIX_H - 3 - o]]) {
    lozenge(p, cx, cy, 3, C_INK);
  }
}

/** A filled diamond, radius in texels. The book's corner mark and its cost pip. */
function lozenge(p: Pix, cx: number, cy: number, r: number, col: Col): void {
  for (let dy = -r; dy <= r; dy++) {
    const w = r - Math.abs(dy);
    for (let dx = -w; dx <= w; dx++) p.set(cx + dx, cy + dy, col);
  }
}

/**
 * A hand-inked ring. The circle itself is exact — a per-sample radius jitter at
 * this size reads as a fuzzy scribble, not as a drawn line — and the hand comes
 * from PRESSURE instead: the stroke doubles outward over the arcs where the wobble
 * runs high, the way a nib does when it is pushed.
 */
function inkRing(p: Pix, cx: number, cy: number, r: number, col: Col, seed: number): void {
  p.ellipseFrame(cx, cy, r, r, col);
  const steps = Math.max(24, Math.round(r * 7));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    if (wob(seed, a, 2.2) < 0.42) continue;
    p.set(Math.round(cx + Math.cos(a) * (r + 1)), Math.round(cy + Math.sin(a) * (r + 1)), col);
  }
}

/** One row of fake arcane script — a wave that never repeats its own period. */
function scriptRow(p: Pix, x: number, y: number, len: number, col: Col, seed: number): void {
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const dy = Math.round(Math.sin(t * 34 + seed) * 1.6 + Math.sin(t * 90 + seed * 0.7) * 0.9);
    p.set(x + i, y + dy, col);
    if ((i + Math.floor(seed)) % 7 === 0) p.set(x + i, y + dy - 1, col);
  }
}

/** The sigil ring plus its twelve rune ticks. */
function sigilRing(p: Pix, cx: number, cy: number, r: number, seed: number): void {
  inkRing(p, cx, cy, r, C_INK, seed);
  inkRing(p, cx, cy, r - 3, C_INK_FAINT, seed + 17);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    for (let k = 1; k <= 3; k++) {
      p.set(Math.round(cx + c * (r + k)), Math.round(cy + s * (r + k)), C_INK);
    }
  }
}

// ------------------------------------------------------------- pixel sigils
/** A page's own sigil, authored on the grid. `r` is the ring's inner radius. */
export type PixSigilFn = (p: Pix, cx: number, cy: number, r: number, c: Triad) => void;

/** Ink keyline for a sigil, added without keylining the ring it sits in. */
function keyed(w: number, h: number, draw: (s: Pix) => void): Pix {
  const s = new Pix(w, h);
  draw(s);
  s.outline(C_INK);
  return s;
}

const pixFire: PixSigilFn = (p, cx, cy, r, c) => {
  const k = r / 15;
  const S = (n: number) => Math.round(n * k);
  const flame = keyed(r * 2 + 6, r * 2 + 8, (s) => {
    const ox = r + 3, oy = r + 4;
    const pt = (dx: number, dy: number): [number, number] => [ox + S(dx), oy + S(dy)];
    s.poly([
      pt(0, -15), pt(5, -8), pt(7, -2), pt(8, 4), pt(6, 10), pt(2, 13),
      pt(-2, 13), pt(-6, 10), pt(-8, 4), pt(-7, -2), pt(-5, -8),
    ], c.main);
    s.poly([
      pt(0, -9), pt(4, -2), pt(5, 4), pt(3, 9), pt(0, 11),
      pt(-3, 9), pt(-5, 4), pt(-4, -2),
    ], c.glow);
    s.ellipse(ox, oy + S(6), Math.max(1, S(2)), Math.max(2, S(4)), hex(0xfff6e2));
    // the base is where the fire is fed from: one darker course under the belly
    s.ellipse(ox, oy + S(12), S(4), Math.max(1, S(1)), c.deep);
  });
  p.blit(flame, cx - (r + 3), cy - (r + 4));
  // embers, hand-placed: they read as sparks only if they are unevenly spaced
  for (const [dx, dy, sz] of [[-9, -11, 1], [8, -13, 1], [11, -6, 0], [-11, -3, 0]] as const) {
    const x = cx + S(dx), y = cy + S(dy);
    if (sz) p.rect(x, y, 2, 2, c.glow);
    else p.set(x, y, c.glow);
    p.set(x, y - 1, c.main);
  }
};

const pixFrost: PixSigilFn = (p, cx, cy, r, c) => {
  const arm = r - 2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const ca = Math.cos(a), sa = Math.sin(a);
    const ex = Math.round(cx + ca * arm), ey = Math.round(cy + sa * arm);
    // the shadow arm first, offset a texel: depth without a gradient
    p.line(cx + 1, cy + 1, ex + 1, ey + 1, c.deep);
    p.line(cx, cy, ex, ey, c.main);
    for (const f of [0.44, 0.72]) {
      const bx = Math.round(cx + ca * arm * f), by = Math.round(cy + sa * arm * f);
      for (const s of [-1, 1]) {
        const ba = a + (s * Math.PI) / 4;
        p.line(bx, by, Math.round(bx + Math.cos(ba) * arm * 0.26), Math.round(by + Math.sin(ba) * arm * 0.26), c.main);
      }
    }
    p.rect(ex - 1, ey - 1, 2, 2, c.glow);
  }
  p.ellipse(cx, cy, 3, 3, c.main);
  p.ellipse(cx, cy, 2, 2, c.glow);
  p.set(cx - 1, cy - 1, hex(0xffffff));
};

const pixSpark: PixSigilFn = (p, cx, cy, r, c) => {
  const k = r / 15;
  const S = (n: number) => Math.round(n * k);
  // a storm ring, broken where the bolt enters and leaves
  for (const [a0, a1, seed] of [[-0.85, 1.7, 13], [2.45, 4.55, 27]] as const) {
    const steps = Math.round((a1 - a0) * r * 3);
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const rr = r - 1 + Math.round(wob(seed, a * 1.7) * 1);
      p.set(Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr), c.deep);
    }
  }
  const bolt = keyed(r * 2 + 6, r * 2 + 8, (s) => {
    const ox = r + 3, oy = r + 4;
    const pt = (dx: number, dy: number): [number, number] => [ox + S(dx), oy + S(dy)];
    s.poly([pt(5, -14), pt(-5, 1), pt(-1, 1), pt(-4, 14), pt(6, -2), pt(1, -2)], c.main);
    s.poly([pt(4, -11), pt(-3, 0), pt(-1, 0), pt(-3, 10), pt(4, -1), pt(0, -1)], hex(0xf4f6ff));
  });
  p.blit(bolt, cx - (r + 3), cy - (r + 4));
  // the landing spark, and the static coming off it
  p.ellipse(cx + S(-4), cy + S(14), 2, 2, c.glow);
  for (let i = 0; i < 4; i++) {
    const a = 1.15 + i * 0.8;
    const sx = cx + S(-4) + Math.round(Math.cos(a) * 4);
    const sy = cy + S(14) + Math.round(Math.sin(a) * 3);
    p.line(sx, sy, Math.round(sx + Math.cos(a) * 3), Math.round(sy + Math.sin(a) * 2), c.main);
  }
};

const pixGust: PixSigilFn = (p, cx, cy, r, c) => {
  const k = r / 15;
  const S = (n: number) => Math.round(n * k);
  // Three wind curls, each a sweep that hooks back on itself. Gust's own colour
  // is a pale mint that disappears on parchment, so the STROKE is the deep tone
  // and only the fat middle sweep carries a highlight — a highlight on all three
  // turned them into a coil spring.
  const rows: [number, number, number, boolean][] = [
    [-8, 11, 3, false], [1, 14, 4, true], [9, 9, 3, false],
  ];
  for (const [yOff, len, curl, fat] of rows) {
    const y = cy + S(yOff);
    const x0 = cx - S(len);
    const run = S(len * 2 - curl);
    const plot = (x: number, py: number) => {
      p.set(x, py, c.deep);
      if (fat) { p.set(x, py + 1, c.deep); p.set(x, py - 1, c.main); }
    };
    for (let x = 0; x <= run; x++) {
      plot(x0 + x, y + Math.round(Math.sin((x / run) * Math.PI) * -1.2));
    }
    // the hook: up, over, and back — the thing that makes a line read as wind
    const cr = S(curl);
    for (let a = 0; a <= 30; a++) {
      const ang = (a / 30) * Math.PI * 1.5;
      plot(x0 + run + Math.round(Math.sin(ang) * cr), y - Math.round((1 - Math.cos(ang)) * cr));
    }
  }
  // the loose leaf, flung off the top curl
  const lx = cx + S(10), ly = cy - S(14);
  const leaf = keyed(11, 9, (s) => {
    s.ellipse(5, 4, 4, 2, c.main);
    s.line(1, 5, 9, 3, c.deep);
    s.set(9, 2, c.deep);
  });
  p.blit(leaf, lx - 5, ly - 4);
};

const pixDecay: PixSigilFn = (p, cx, cy, r, c) => {
  const k = r / 15;
  const S = (n: number) => Math.round(n * k);
  const bone = mix(c.glow, hex(0xf2f6e0), 0.45);
  const skull = keyed(r * 2 + 6, r * 2 + 8, (s) => {
    const ox = r + 3, oy = r + 4;
    // cranium + jaw as two quantised domes, not one bezier outline
    s.ellipse(ox, oy - S(3), S(9), S(8), bone);
    s.rect(ox - S(7), oy - S(3), S(14) + 1, S(6), bone);
    s.ellipse(ox, oy + S(4), S(5), S(4), bone);
    // sockets, sunk
    for (const sx of [-1, 1]) {
      s.ellipse(ox + sx * S(4), oy - S(3), S(3), S(3), c.deep);
      s.set(ox + sx * S(4) - 1, oy - S(4), c.main);
    }
    // nose cavity
    s.poly([[ox, oy + S(1)], [ox - S(2), oy + S(4)], [ox + S(2), oy + S(4)]], c.deep);
    // teeth
    for (let i = -2; i <= 2; i++) {
      s.line(ox + i * S(2), oy + S(5), ox + i * S(2), oy + S(8), c.deep);
    }
    // the crooked stitch — the one bit of undead charm upstream drew, kept
    s.line(ox - S(7), oy - S(9), ox - S(4), oy - S(11), c.deep);
    s.line(ox - S(4), oy - S(11), ox - S(1), oy - S(9), c.deep);
    for (const [dx, dy] of [[-6, -10], [-4, -11], [-2, -10]] as const) {
      s.set(ox + S(dx), oy + S(dy) + 1, c.main);
    }
  });
  p.blit(skull, cx - (r + 3), cy - (r + 4));
};

/** Sigils for the pages that exist. Cards route through `SIGILS` instead. */
export const PIX_SIGILS: Record<string, PixSigilFn> = {
  fireball: pixFire,
  frostbolt: pixFrost,
  spark: pixSpark,
  gust: pixGust,
  decay: pixDecay,
};

// ------------------------------------------------------------- sigils
export type SigilFn = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, colors: { main: string; glow: string; deep: string }) => void;

/** Hand-inked line: living stroke weight + subtle path wobble. */
function inkPath(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  width: number,
  seed: number,
  color = INK
) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < pts.length - 1; i++) {
    const t = i / (pts.length - 1);
    ctx.lineWidth = Math.max(0.6, width * (1 + wob(seed, t * 6.28) * 0.28));
    ctx.beginPath();
    const j1 = wob(seed + 3, t * 9) * 1.3;
    const j2 = wob(seed + 7, t * 9 + 0.4) * 1.3;
    ctx.moveTo(pts[i][0] + j1, pts[i][1] + j2);
    ctx.lineTo(pts[i + 1][0] + j1 * 0.6, pts[i + 1][1] + j2 * 0.6);
    ctx.stroke();
  }
}

function inkCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, width: number, seed: number, color = INK) {
  const n = 40;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + wob(seed, a) * 0.02);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  inkPath(ctx, pts, width, seed, color);
}

const sigilFire: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 30;
  // outer flame
  ctx.fillStyle = c.main;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.bezierCurveTo(cx + r * 0.85, cy - r * 0.25, cx + r * 0.6, cy + r * 0.65, cx, cy + r * 0.8);
  ctx.bezierCurveTo(cx - r * 0.6, cy + r * 0.65, cx - r * 0.85, cy - r * 0.25, cx, cy - r);
  ctx.fill();
  // inner flame
  ctx.shadowBlur = 14;
  ctx.fillStyle = c.glow;
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.05, cy - r * 0.4);
  ctx.bezierCurveTo(cx + r * 0.42, cy - r * 0.02, cx + r * 0.32, cy + r * 0.5, cx, cy + r * 0.62);
  ctx.bezierCurveTo(cx - r * 0.32, cy + r * 0.5, cx - r * 0.4, cy + r * 0.05, cx + r * 0.05, cy - r * 0.4);
  ctx.fill();
  // hot core
  ctx.fillStyle = '#fff8e8';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.3, r * 0.14, r * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // embers
  ctx.fillStyle = c.glow;
  for (let i = 0; i < 5; i++) {
    const a = i * 1.4 + 0.4;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r * (0.75 + (i % 2) * 0.32), cy - r * 0.55 - i * 9, 3.4 - i * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
};

const sigilFrost: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.main;
  ctx.shadowBlur = 22;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const ex = cx + Math.cos(a) * r * 0.92;
    const ey = cy + Math.sin(a) * r * 0.92;
    inkPath(ctx, [[cx, cy], [ex, ey]], 5, i * 7, c.deep);
    // branch ticks
    for (const f of [0.45, 0.68]) {
      const bx = cx + Math.cos(a) * r * f;
      const by = cy + Math.sin(a) * r * f;
      for (const s of [-1, 1]) {
        const ba = a + (s * Math.PI) / 4;
        inkPath(ctx, [[bx, by], [bx + Math.cos(ba) * r * 0.18, by + Math.sin(ba) * r * 0.18]], 3.4, i * 13 + f * 10, c.main);
      }
    }
    // tip crystals
    ctx.fillStyle = c.glow;
    ctx.beginPath();
    ctx.arc(ex, ey, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = c.glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const sigilGrowth: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.main;
  ctx.shadowBlur = 20;
  // stem
  const stem: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    stem.push([cx + Math.sin(t * 2.4) * r * 0.14, cy + r * 0.85 - t * r * 1.5]);
  }
  inkPath(ctx, stem, 6, 3, c.deep);
  // leaves
  const leaf = (lx: number, ly: number, dir: number, s: number) => {
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.quadraticCurveTo(lx + dir * r * 0.5 * s, ly - r * 0.28 * s, lx + dir * r * 0.62 * s, ly - r * 0.02 * s);
    ctx.quadraticCurveTo(lx + dir * r * 0.34 * s, ly + r * 0.22 * s, lx, ly);
    ctx.fill();
  };
  leaf(cx + r * 0.05, cy + r * 0.3, 1, 1);
  leaf(cx - r * 0.02, cy + r * 0.05, -1, 0.85);
  leaf(cx + r * 0.1, cy - r * 0.25, 1, 0.6);
  // sprout tip glow
  ctx.fillStyle = c.glow;
  ctx.beginPath();
  ctx.arc(cx + Math.sin(2.4) * r * 0.14, cy - r * 0.68, 7, 0, Math.PI * 2);
  ctx.fill();
  // ascending chevrons
  ctx.strokeStyle = c.main;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    const yy = cy - r * (0.82 + i * 0.22);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.2, yy + r * 0.1);
    ctx.lineTo(cx, yy);
    ctx.lineTo(cx + r * 0.2, yy + r * 0.1);
    ctx.stroke();
  }
  ctx.restore();
};

const sigilMulti: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.main;
  ctx.shadowBlur = 20;
  const ox = cx;
  const oy = cy + r * 0.75;
  for (const spread of [-0.55, 0, 0.55]) {
    const tx = cx + Math.sin(spread) * r * 1.05;
    const ty = cy - Math.cos(spread) * r * 0.95;
    inkPath(ctx, [[ox, oy], [tx, ty]], 5, spread * 17, c.deep);
    // arrowhead
    const a = Math.atan2(ty - oy, tx - ox);
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.moveTo(tx + Math.cos(a) * 16, ty + Math.sin(a) * 16);
    ctx.lineTo(tx + Math.cos(a + 2.5) * 13, ty + Math.sin(a + 2.5) * 13);
    ctx.lineTo(tx + Math.cos(a - 2.5) * 13, ty + Math.sin(a - 2.5) * 13);
    ctx.fill();
  }
  // origin burst
  ctx.fillStyle = c.glow;
  ctx.beginPath();
  ctx.arc(ox, oy, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const sigilSummon: SigilFn = (ctx, cx, cy, r, c) => {
  // a four-point summoning star over three clay mounds heaving from the ground
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 26;
  const sx = cx;
  const sy = cy - r * 0.32;
  const R = r * 0.62;
  const star = (scale: number, fill: string) => {
    const o = R * scale;
    const inn = o * 0.24;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(sx, sy - o);
    ctx.quadraticCurveTo(sx + inn, sy - inn, sx + o, sy);
    ctx.quadraticCurveTo(sx + inn, sy + inn, sx, sy + o);
    ctx.quadraticCurveTo(sx - inn, sy + inn, sx - o, sy);
    ctx.quadraticCurveTo(sx - inn, sy - inn, sx, sy - o);
    ctx.fill();
  };
  star(1, c.main);
  ctx.shadowBlur = 12;
  star(0.55, c.glow);
  star(0.22, '#fff8e8');
  ctx.restore();
  // orbit ring around the star, hand-inked
  inkCircle(ctx, sx, sy, R * 1.12, 2.2, 21, c.deep);
  // two attendant sparkles riding the orbit
  ctx.fillStyle = c.glow;
  for (const a of [0.6, 3.9]) {
    ctx.beginPath();
    ctx.arc(sx + Math.cos(a) * R * 1.12, sy + Math.sin(a) * R * 1.12, 4.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // golden motes sift down toward the waking clay
  ctx.fillStyle = c.main;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(sx + Math.sin(i * 2.4) * r * 0.28, sy + R * 1.3 + i * r * 0.11, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // three clay mounds glooping out of the ground line
  const gy = cy + r * 0.82;
  ctx.save();
  ctx.shadowColor = c.main;
  ctx.shadowBlur = 8;
  ctx.fillStyle = c.deep;
  for (const [mx, mr] of [[-0.42, 0.26], [0.02, 0.34], [0.44, 0.22]] as const) {
    ctx.beginPath();
    ctx.arc(cx + mx * r, gy, mr * r, Math.PI, 0);
    ctx.fill();
  }
  ctx.restore();
  inkPath(ctx, [[cx - r * 0.8, gy], [cx + r * 0.8, gy]], 3, 17, c.deep);
};

const sigilSkull: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.main;
  ctx.shadowBlur = 24;
  // cranium
  ctx.fillStyle = c.glow;
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.18, r * 0.62, Math.PI, 0);
  ctx.bezierCurveTo(cx + r * 0.62, cy + r * 0.35, cx + r * 0.4, cy + r * 0.42, cx + r * 0.34, cy + r * 0.5);
  ctx.lineTo(cx - r * 0.34, cy + r * 0.5);
  ctx.bezierCurveTo(cx - r * 0.4, cy + r * 0.42, cx - r * 0.62, cy + r * 0.35, cx - r * 0.62, cy - r * 0.18);
  ctx.fill();
  // jaw
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.3, cy + r * 0.48);
  ctx.quadraticCurveTo(cx, cy + r * 0.92, cx + r * 0.3, cy + r * 0.48);
  ctx.fill();
  ctx.restore();
  // eye sockets (dark, sunken)
  ctx.fillStyle = c.deep;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + sx * r * 0.28, cy - r * 0.08, r * 0.2, r * 0.24, sx * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // a sickly glint in the sockets
  ctx.fillStyle = c.main;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + sx * r * 0.24, cy - r * 0.02, r * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }
  // nose cavity
  ctx.fillStyle = c.deep;
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.14);
  ctx.lineTo(cx - r * 0.09, cy + r * 0.36);
  ctx.lineTo(cx + r * 0.09, cy + r * 0.36);
  ctx.fill();
  // teeth ticks along the jawline
  for (let i = -2; i <= 2; i++) {
    inkPath(
      ctx,
      [[cx + i * r * 0.13, cy + r * 0.5], [cx + i * r * 0.13, cy + r * 0.68]],
      2.4,
      i * 5,
      c.deep
    );
  }
  // crooked stitch across the cranium (undead charm)
  inkPath(ctx, [[cx - r * 0.5, cy - r * 0.36], [cx - r * 0.28, cy - r * 0.5], [cx - r * 0.06, cy - r * 0.34]], 2.6, 4, c.deep);
};

const sigilSpark: SigilFn = (ctx, cx, cy, r, c) => {
  // the classic bolt glyph striking through a storm ring broken where it
  // enters and exits (segments hand-inked separately — never erased)
  const arc = (a0: number, a1: number, seed: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 14; i++) {
      const a = a0 + ((a1 - a0) * i) / 14;
      const rr = r * 0.9 * (1 + wob(seed, a) * 0.03);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    inkPath(ctx, pts, 2.6, seed, c.deep);
  };
  arc(-0.9, 1.75, 13); // right side, open where the bolt enters top-left…
  arc(2.4, 4.6, 27); // …and exits bottom-right
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 26;
  // the bolt blade (non-self-intersecting — fills clean)
  const bolt: [number, number][] = [
    [cx + r * 0.28, cy - r * 0.95],
    [cx - r * 0.34, cy + r * 0.08],
    [cx - r * 0.05, cy + r * 0.1],
    [cx - r * 0.24, cy + r * 0.9],
    [cx + r * 0.36, cy - r * 0.14],
    [cx + r * 0.06, cy - r * 0.16],
  ];
  ctx.fillStyle = c.main;
  ctx.beginPath();
  bolt.forEach(([x, y], i) => {
    const wx = x + wob(7, i * 1.7) * 3;
    const wy = y + wob(11, i * 2.3) * 3;
    if (i === 0) ctx.moveTo(wx, wy);
    else ctx.lineTo(wx, wy);
  });
  ctx.closePath();
  ctx.fill();
  // hot inner streak down the blade
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#f2f5ff';
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.17, cy - r * 0.78);
  ctx.lineTo(cx - r * 0.2, cy + r * 0.04);
  ctx.lineTo(cx - r * 0.02, cy + r * 0.055);
  ctx.lineTo(cx - r * 0.16, cy + r * 0.66);
  ctx.lineTo(cx + r * 0.14, cy - r * 0.08);
  ctx.lineTo(cx - r * 0.02, cy - r * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // the landing spark at the tip
  ctx.fillStyle = c.glow;
  ctx.beginPath();
  ctx.arc(cx - r * 0.24, cy + r * 0.92, 6, 0, Math.PI * 2);
  ctx.fill();
  // static ticks radiating off the strike point
  for (let i = 0; i < 4; i++) {
    const a = 1.2 + i * 0.75;
    const sx = cx - r * 0.24 + Math.cos(a) * r * 0.2;
    const sy = cy + r * 0.92 + Math.sin(a) * r * 0.14;
    inkPath(ctx, [[sx, sy], [sx + Math.cos(a) * r * 0.14, sy + Math.sin(a) * r * 0.1]], 2.6, i * 9, c.main);
  }
};

const sigilStone: SigilFn = (ctx, cx, cy, r, c) => {
  // a faceted boulder mid-fall — motion ticks above, impact ticks below.
  // deliberately the quietest sigil in the book: stone doesn't glow
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 8;
  const face: [number, number][] = [
    [cx - r * 0.6, cy - r * 0.1],
    [cx - r * 0.3, cy - r * 0.55],
    [cx + r * 0.25, cy - r * 0.6],
    [cx + r * 0.62, cy - r * 0.12],
    [cx + r * 0.48, cy + r * 0.42],
    [cx - r * 0.12, cy + r * 0.56],
    [cx - r * 0.52, cy + r * 0.32],
  ];
  ctx.fillStyle = c.main;
  ctx.beginPath();
  face.forEach(([x, y], i) => {
    const wx = x + wob(23, i * 2.3) * 3;
    const wy = y + wob(31, i * 1.9) * 3;
    if (i === 0) ctx.moveTo(wx, wy);
    else ctx.lineTo(wx, wy);
  });
  ctx.closePath();
  ctx.fill();
  // two ochre strata bands crossing the face
  ctx.fillStyle = c.glow;
  ctx.save();
  ctx.beginPath();
  face.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = 0.55;
  ctx.fillRect(cx - r * 0.7, cy - r * 0.08, r * 1.4, r * 0.11);
  ctx.fillRect(cx - r * 0.7, cy + r * 0.22, r * 1.4, r * 0.08);
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.restore();
  // facet lines, hand-inked
  inkPath(ctx, [[cx - r * 0.3, cy - r * 0.55], [cx - r * 0.05, cy - r * 0.05], [cx - r * 0.12, cy + r * 0.56]], 2.6, 5, c.deep);
  inkPath(ctx, [[cx + r * 0.25, cy - r * 0.6], [cx - r * 0.05, cy - r * 0.05]], 2.4, 11, c.deep);
  inkPath(ctx, [[cx - r * 0.05, cy - r * 0.05], [cx + r * 0.48, cy + r * 0.42]], 2.4, 17, c.deep);
  // the outline itself, inked over the fill
  inkPath(ctx, [...face, face[0]], 3.2, 29, c.deep);
  // motion ticks above (it is coming down fast)
  for (const [dx, len] of [[-0.25, 0.22], [0.05, 0.3], [0.3, 0.2]] as const) {
    inkPath(
      ctx,
      [[cx + dx * r, cy - r * 0.95], [cx + dx * r - r * 0.06, cy - r * 0.95 + len * r]],
      2.8,
      dx * 40,
      c.deep
    );
  }
  // impact ticks + pebbles at the ground line below
  inkPath(ctx, [[cx - r * 0.85, cy + r * 0.85], [cx + r * 0.85, cy + r * 0.85]], 3, 41, c.deep);
  ctx.fillStyle = c.main;
  for (const [px, pr] of [[-0.6, 0.07], [0.55, 0.08], [0.72, 0.05]] as const) {
    ctx.beginPath();
    ctx.arc(cx + px * r, cy + r * 0.8, pr * r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const s of [-1, 1]) {
    inkPath(
      ctx,
      [[cx + s * r * 0.3, cy + r * 0.8], [cx + s * r * 0.45, cy + r * 0.68]],
      2.4,
      s * 7,
      c.deep
    );
  }
};

/** Gust 💨: three comma-curl wind strokes sweeping right, a loose leaf
 *  tumbling off the topmost curl. */
const sigilGust: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.main;
  ctx.shadowBlur = 18;
  // three stacked wind curls, each a sweep that hooks back on itself
  const rows: [number, number, number][] = [
    // yOff, length, curlR
    [-r * 0.42, r * 1.5, r * 0.26],
    [0, r * 1.75, r * 0.32],
    [r * 0.45, r * 1.3, r * 0.2],
  ];
  rows.forEach(([yOff, len, curl], i) => {
    const y = cy + yOff;
    const x0 = cx - len / 2;
    const pts: [number, number][] = [];
    const n = 22;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (t < 0.7) {
        // the long sweep, bowing gently
        const tt = t / 0.7;
        pts.push([x0 + tt * (len - curl), y + Math.sin(tt * Math.PI) * r * 0.1 * (i % 2 ? 1 : -1)]);
      } else {
        // the curl: hooking up and back around
        const a = ((t - 0.7) / 0.3) * Math.PI * 1.6;
        pts.push([
          x0 + (len - curl) + Math.sin(a) * curl,
          y - (1 - Math.cos(a)) * curl * 0.8,
        ]);
      }
    }
    inkPath(ctx, pts, 5 - i, i * 13, c.deep);
  });
  ctx.restore();
  // the loose leaf, flung off the top curl
  ctx.save();
  ctx.translate(cx + r * 0.62, cy - r * 0.78);
  ctx.rotate(0.6);
  ctx.fillStyle = c.main;
  ctx.beginPath();
  ctx.ellipse(0, 0, 9, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = c.deep;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-9, 0);
  ctx.lineTo(9, 0);
  ctx.stroke();
  ctx.restore();
};

/** Shrink 🐜: a fading dashed outer ring with four arrows driving INWARD
 *  onto a tiny dense core — the big made small. */
const sigilShrink: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 16;
  // the dashed ghost of the former size
  const n = 16;
  for (let i = 0; i < n; i++) {
    if (i % 2) continue;
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 0.9) / n) * Math.PI * 2;
    const pts: [number, number][] = [];
    for (let k = 0; k <= 4; k++) {
      const a = a0 + (a1 - a0) * (k / 4);
      pts.push([cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95]);
    }
    inkPath(ctx, pts, 2.4, i * 5, c.deep);
  }
  // four inward arrows
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const ox = Math.cos(a);
    const oy = Math.sin(a);
    const x0 = cx + ox * r * 0.78;
    const y0 = cy + oy * r * 0.78;
    const x1 = cx + ox * r * 0.34;
    const y1 = cy + oy * r * 0.34;
    inkPath(ctx, [[x0, y0], [x1, y1]], 4.4, i * 9, c.main);
    // the arrowhead, splayed off the shaft tip
    const pa = a + Math.PI * 0.82;
    const pb = a - Math.PI * 0.82;
    inkPath(ctx, [[x1, y1], [x1 - Math.cos(pa) * -12, y1 - Math.sin(pa) * -12]], 3.6, i * 9 + 3, c.main);
    inkPath(ctx, [[x1, y1], [x1 - Math.cos(pb) * -12, y1 - Math.sin(pb) * -12]], 3.6, i * 9 + 6, c.main);
  }
  // the tiny dense survivor
  ctx.fillStyle = c.deep;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c.glow;
  ctx.beginPath();
  ctx.arc(cx - r * 0.03, cy - r * 0.04, r * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

export const SIGILS: Record<string, SigilFn> = {
  fireball: sigilFire,
  frostbolt: sigilFrost,
  spark: sigilSpark,
  stone: sigilStone,
  gust: sigilGust,
  growth: sigilGrowth,
  multishot: sigilMulti,
  shrink: sigilShrink,
  summon: sigilSummon,
  decay: sigilSkull,
};

// ------------------------------------------------------- canvas → pixel grid
/**
 * Resample a canvas-drawn mark onto the page's texel grid.
 *
 * A card registered from `src/spells/` is drawn in upstream's ink language at
 * 512x660, which is four times the page's resolution. Point-sampling it would
 * drop every thin stroke, so each texel is an alpha-weighted box average of its
 * source block, hard-cut at 42% coverage and snapped to the mark's own palette —
 * the same treatment the game's creature sprites got when they were put on a true
 * pixel grid. No antialiased edge and no intermediate tone survives it.
 */
function resample(src: HTMLCanvasElement, palette: Col[]): Pix {
  const data = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
  const fx = src.width / PIX_W;
  const fy = src.height / PIX_H;
  const out = new Pix(PIX_W, PIX_H);
  const cols = palette.map((c) => unpack(c));
  for (let y = 0; y < PIX_H; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.min(src.height, Math.ceil((y + 1) * fy));
    for (let x = 0; x < PIX_W; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.min(src.width, Math.ceil((x + 1) * fx));
      let ar = 0, ag = 0, ab = 0, aa = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * src.width + sx) * 4;
          const a = data[i + 3] / 255;
          ar += data[i] * a; ag += data[i + 1] * a; ab += data[i + 2] * a;
          aa += a; n++;
        }
      }
      if (!n || aa / n < 0.42) continue;
      const r = ar / aa, g = ag / aa, b = ab / aa;
      let best = 0, bestD = Infinity;
      for (let k = 0; k < cols.length; k++) {
        const [pr, pg, pb] = cols[k];
        const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
        if (d < bestD) { bestD = d; best = k; }
      }
      out.set(x, y, palette[best], { mode: 'set' });
    }
  }
  return out;
}

/**
 * The sigil for a page, on the grid. A real page's sigil is authored in
 * `PIX_SIGILS`; anything else is a card mark registered through `SIGILS` from
 * `src/spells/`, and gets resampled.
 */
function drawSigil(p: Pix, spell: SpellDef, cx: number, cy: number, r: number): void {
  const t = triadOf(spell);
  const authored = PIX_SIGILS[spell.id];
  if (authored) { authored(p, cx, cy, r, t); return; }
  const fn = SIGILS[spell.id];
  if (!fn) return;
  const [c, ctx] = makeCanvas();
  const sx = (cx / PIX_W) * W, sy = (cy / PIX_H) * H;
  fn(ctx, sx, sy, (r / PIX_W) * W, spell.colors);
  const mark = resample(c, [
    t.deep, t.main, t.glow, hex(0xfff6e2), C_INK,
    mix(t.deep, t.main, 0.5), mix(t.main, t.glow, 0.5),
  ]);
  mark.outline(C_INK);
  p.blit(mark);
}

// ------------------------------------------------------------- page builders
/**
 * The layout budget, and why it is not upstream's.
 *
 * The grimoire sits at the bottom of a portrait phone and the bottom ~27% of every
 * page is BELOW the screen edge (measured off the book's own projected geometry).
 * Upstream puts the effect sentence at 78% of the page height and the cost line at
 * 88%, so on this game's framing both were simply invisible. Everything a player
 * has to read now lives above 70%, and the cost row sits just under it where a
 * torn card still shows it.
 */
const MARGIN = 10;
/** Titles may run the full inner width. */
const TITLE_W = PIX_W - MARGIN * 2;
/** Prose gets a real margin inside the border rule, or it reads as overflowing. */
const PROSE_W = PIX_W - 36;
/** The last texel row a phone actually shows, with a line's worth of slack. */
const FOLD = 118;

/** Chapter colours are chosen for ribbons; on parchment they need darkening. */
function schoolCol(school: SpellDef['school']): Col {
  return shade(hex(chapters[school]), 0.72);
}

/**
 * `title` overrides the page's printed name, and exists for the RANK LADDER.
 *
 * A deepened page is a different spell by name — a rank-2 Flame is a Fireball, and
 * that renaming is the whole of what the ladder is for. `spell.name` is the rank-1
 * name and only ever that, so a card offering the upgrade printed "Flame" in letter
 * height across the top while its own caption underneath said "Fireball": the object
 * the player was looking at contradicted the sentence describing it, and read as a
 * second copy of a page they already held rather than as a deeper one.
 *
 * An override rather than a rank argument, because this file draws pages and does not
 * otherwise know the ladder exists — the caller already has `rankName` and the rank
 * the offer is FOR, which is not always the rank the player holds.
 */
export function actionPage(spell: SpellDef, index: number, title?: string): Pix {
  const seed = index * 13 + 3;
  const p = parchment(seed);
  border(p, seed);

  // title
  fitCentered(p, title ?? spell.name, PIX_W / 2, 11, C_INK, TITLE_W, { scale: 2, bold: true });
  // the underline flourish: a wobbling rule that swells at the middle
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const x = Math.round(PIX_W / 2 - 30 + t * 60);
    const y = 28 + Math.round(Math.sin(t * Math.PI) * -1.6) + Math.round(wob(seed + 5, t * 4) * 0.6);
    p.set(x, y, C_INK);
    if (t > 0.25 && t < 0.75) p.set(x, y + 1, C_INK_MID);
  }
  drawCentered(p, `~ ${spell.school} ~`, PIX_W / 2, 32, schoolCol(spell.school));

  sigilRing(p, PIX_W / 2, 61, 20, seed + 9);
  drawSigil(p, spell, PIX_W / 2, 61, 20);

  // effect: the sentence the whole page exists to deliver
  const lines = wrap(spell.effect, PROSE_W).slice(0, 4);
  const top = FOLD - lines.length * (CELL_H - 1);
  lines.forEach((line, i) => drawCentered(p, line, PIX_W / 2, top + i * (CELL_H - 1), C_INK));

  /**
   * REMOVED: the "CAST · ONE TURN" pip row.
   *
   * Upstream printed a mana cost here. This game has no mana, so the row was rewritten
   * to state the turn rule instead — and it states it on every page, identically,
   * forever. A line that is the same on all ten pages carries no information about the
   * page it is on; it is a rule about the game, and the page is the wrong place to
   * keep repeating it.
   */
  // The foot of the page. Below the fold in the book, but a torn card shows its
  // whole face, and a card with an empty quarter reads as an unfinished page.
  inkRun(p, 26, 150, PIX_W - 27, 150, C_INK_FAINT, seed + 91);
  for (const dx of [-7, 0, 7]) lozenge(p, PIX_W / 2 + dx, 156, 1, C_INK_FAINT);
  return p;
}

export function lorePage(spell: SpellDef, index: number): Pix {
  const seed = index * 29 + 7;
  const p = parchment(seed, false);
  border(p, seed);

  // chapter marker: the school this page is filed under + its leaf numeral
  const chapter = CHAPTERS.find((c) => c.school === spell.school);
  const leaf = ['I', 'II', 'III', 'IV', 'V', 'VI'][index - (chapter?.firstIndex ?? 0)] ?? '';
  drawCentered(p, `— ${chapter?.name ?? spell.school} · ${leaf} —`, PIX_W / 2, 14, schoolCol(spell.school));

  // the faded emblem: the same sigil, drawn once more and left to sink into the
  // paper. Faded by blending toward the sheet rather than by alpha, so it stays
  // quantised (the page shader discards anything under half alpha anyway).
  const emblem = new Pix(PIX_W, PIX_H);
  inkRing(emblem, PIX_W / 2, 50, 20, C_INK_MID, seed + 3);
  drawSigil(emblem, spell, PIX_W / 2, 50, 19);
  for (let y = 0; y < PIX_H; y++) {
    for (let x = 0; x < PIX_W; x++) {
      const c = emblem.get(x, y);
      if (!((c >>> 24) & 255)) continue;
      p.set(x, y, mix(c, p.get(x, y), 0.34));
    }
  }

  // fake arcane script — rows of wavy ink, in lines of uneven length
  let y = 72;
  for (let row = 0; row < 3; row++) {
    const len = Math.round(PROSE_W * (0.62 + ((row * 37 + index * 13) % 34) / 100));
    scriptRow(p, MARGIN + 4, y, len, C_INK_FAINT, seed + row * 3);
    y += 8;
  }

  // flavour. The strings already carry their own quotes, so upstream's added pair
  // would double them.
  const quote = wrap(spell.flavor, PROSE_W).slice(0, 4);
  const top = FOLD - quote.length * (CELL_H - 1);
  quote.forEach((line, i) => drawCentered(p, line, PIX_W / 2, top + i * (CELL_H - 1), C_INK));
  return p;
}

/** Plain parchment used for the back face of ripped pages. */
export function blankPage(): Pix {
  const p = parchment(55);
  inkRun(p, 6, 6, PIX_W - 7, 6, C_INK_MID, 200);
  inkRun(p, PIX_W - 7, 6, PIX_W - 7, PIX_H - 7, C_INK_MID, 211);
  inkRun(p, PIX_W - 7, PIX_H - 7, 6, PIX_H - 7, C_INK_MID, 222);
  inkRun(p, 6, PIX_H - 7, 6, 6, C_INK_MID, 233);
  return p;
}

/** Apply a jagged torn strip along the left (spine) edge. */
export function tornVariant(src: Pix): Pix {
  const p = src.clone();
  for (let y = 0; y < PIX_H; y++) {
    const t = y / PIX_H;
    const depth = 2 + Math.round(Math.abs(wob(9, t * 12)) * 4);
    for (let x = 0; x < depth; x++) p.set(x, y, rgba(0, 0, 0, 0), { mode: 'set' });
    // the torn fibre line: paper is lighter where it has been pulled apart
    p.set(depth, y, mix(p.get(depth, y), PARCH.at(PARCH.length - 1), 0.6));
    p.set(depth + 1, y, mix(p.get(depth + 1, y), PARCH.at(1), 0.35));
  }
  return p;
}

export interface PageArt {
  action: THREE.Texture;
  lore: THREE.Texture;
  torn: THREE.Texture;
}

const artCache = new Map<string, PageArt>();
let blankTex: THREE.Texture | null = null;

/**
 * The pages of the book that are GILDED, by spell id.
 *
 * A golden page is a one-run gift, and `Roadmap/Altar_Screen.md` is specific that it
 * should look like one for the whole run rather than only on the altar that offered
 * it — it used to arrive in the book looking like every other page, which made the
 * rarest thing in the roll the least remarkable thing in the grimoire.
 *
 * A set rather than a flag on the spell, because gilding is a property of THIS RUN's
 * copy: the same Fireball is an ordinary page in the next one.
 */
const gilded = new Set<string>();

export function setGilded(id: string | null): void {
  gilded.clear();
  if (id) {
    gilded.add(id);
    // The art is cached per spell, and this one has to be re-authored in gold.
    artCache.delete(id);
  }
}

/**
 * What rank the book holds each page at, so a page can print the name it CURRENTLY
 * carries.
 *
 * A deepened page is a different spell by name — that renaming is the whole of what
 * the rank ladder is for — but the art was authored once off `spell.name`, which is
 * the rank-1 name and only ever that. So a book holding a rank-2 fire page opened on
 * a sheet headed "Flame", and the player had no way to tell it from the rank-1 page
 * they started with.
 *
 * Kept here, beside `gilded`, because it is the same shape of problem and wants the
 * same solution: a property of THIS RUN's copy of the page, held next to the cache it
 * invalidates. Returns whether anything moved, so the caller only rebuilds the book
 * when it has to — this is called on every rank write and most of them change nothing.
 */
const ranks = new Map<string, number>();

export function setPageRanks(next: Record<string, number>): boolean {
  const ids = new Set([...ranks.keys(), ...Object.keys(next)]);
  let moved = false;
  for (const id of ids) {
    const was = ranks.get(id) ?? 0;
    const now = next[id] ?? 0;
    if (was === now) continue;
    moved = true;
    if (now > 0) ranks.set(id, now); else ranks.delete(id);
    // Cached per SIGIL id, which is what `pageArt` keys on — not the game id.
    // Over ALL_PAGES, not the book's current `SPELLS` — the cache outlives which
    // pages the run happens to hold, and a stale entry for a page not in the book
    // right now is exactly the one that would come back wrong when it is learnt.
    for (const pg of ALL_PAGES) if (pg.gameId === id) artCache.delete(pg.id);
  }
  return moved;
}

export function pageArt(spell: SpellDef, index: number): PageArt {
  let art = artCache.get(spell.id);
  if (!art) {
    const gild = gilded.has(spell.gameId);
    // The name at the rank the book holds it at. `rankName` floors an absent or 0
    // rank to rung 1, so a page the run has not ranked still prints its own name.
    const title = rankName(spell.gameId, ranks.get(spell.gameId) ?? 1);
    const action = gild
      ? giltify(actionPage(spell, index, title))
      : actionPage(spell, index, title);
    const lore = gild ? giltify(lorePage(spell, index)) : lorePage(spell, index);
    art = {
      action: action.toTexture(),
      lore: lore.toTexture(),
      torn: tornVariant(action).toTexture(),
    };
    artCache.set(spell.id, art);
  }
  return art;
}

export function blankPageTexture(): THREE.Texture {
  if (!blankTex) blankTex = blankPage().toTexture();
  return blankTex;
}
