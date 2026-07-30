/**
 * A hand-authored bitmap face, drawn straight into a `Pix` buffer.
 *
 * The grimoire's page text is the one thing on the overlay that a shrunken
 * system font cannot survive: the page texture is ~128 texels wide, so a
 * rasterised serif lands at three or four texels of x-height and turns to grey
 * mush the moment it is quantised. So the type is authored ON the grid instead —
 * every stroke is exactly one texel, every glyph is a decision.
 *
 * The cell is 9 rows: rows 0-6 are cap height, 2-6 are x-height, 7-8 hold
 * descenders. `y` in every call is the TOP of the cell, not the baseline, because
 * page layout here is measured off a row of pixels rather than off a font metric.
 *
 * Widths are per-glyph (an `i` is one texel wide) — a monospaced 5px face wastes
 * a quarter of a page's width on air, and page width is the binding constraint on
 * whether the effect sentence fits in three lines.
 */
import { Pix, type Col } from './pixel';

export const CELL_H = 9;
/** Rows 0..6 inclusive: a capital is seven texels tall. */
export const CAP_H = 7;
/** The last ink row of a capital or of an x-height lowercase. */
export const BASELINE = 6;

/** `[topRow, rows]`. `#` is ink, anything else is paper. */
type Glyph = [number, string[]];

const FACE: Record<string, Glyph> = {
  A: [0, ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#']],
  B: [0, ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.']],
  C: [0, ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.']],
  D: [0, ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.']],
  E: [0, ['#####', '#....', '#....', '####.', '#....', '#....', '#####']],
  F: [0, ['#####', '#....', '#....', '####.', '#....', '#....', '#....']],
  G: [0, ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.']],
  H: [0, ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#']],
  I: [0, ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###']],
  J: [0, ['..##', '...#', '...#', '...#', '...#', '#..#', '.##.']],
  K: [0, ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#']],
  L: [0, ['#....', '#....', '#....', '#....', '#....', '#....', '#####']],
  M: [0, ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#']],
  N: [0, ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#']],
  O: [0, ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.']],
  P: [0, ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....']],
  Q: [0, ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#']],
  R: [0, ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#']],
  S: [0, ['.###.', '#...#', '#....', '.###.', '....#', '#...#', '.###.']],
  T: [0, ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..']],
  U: [0, ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.']],
  V: [0, ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..']],
  W: [0, ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#']],
  X: [0, ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#']],
  Y: [0, ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..']],
  Z: [0, ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####']],

  a: [2, ['.##.', '...#', '.###', '#..#', '.###']],
  b: [0, ['#...', '#...', '###.', '#..#', '#..#', '#..#', '###.']],
  c: [2, ['.###', '#...', '#...', '#...', '.###']],
  d: [0, ['...#', '...#', '.###', '#..#', '#..#', '#..#', '.###']],
  e: [2, ['.##.', '#..#', '####', '#...', '.###']],
  f: [0, ['.###', '.#..', '###.', '.#..', '.#..', '.#..', '.#..']],
  g: [2, ['.###', '#..#', '#..#', '#..#', '.###', '...#', '###.']],
  h: [0, ['#...', '#...', '###.', '#..#', '#..#', '#..#', '#..#']],
  i: [0, ['#', '.', '#', '#', '#', '#', '#']],
  j: [0, ['..#', '...', '..#', '..#', '..#', '..#', '..#', '..#', '##.']],
  k: [0, ['#...', '#...', '#..#', '#.#.', '##..', '#.#.', '#..#']],
  l: [0, ['#.', '#.', '#.', '#.', '#.', '#.', '##']],
  m: [2, ['#####', '#.#.#', '#.#.#', '#.#.#', '#.#.#']],
  n: [2, ['###.', '#..#', '#..#', '#..#', '#..#']],
  o: [2, ['.##.', '#..#', '#..#', '#..#', '.##.']],
  p: [2, ['###.', '#..#', '#..#', '#..#', '###.', '#...', '#...']],
  q: [2, ['.###', '#..#', '#..#', '#..#', '.###', '...#', '...#']],
  r: [2, ['#.##', '##..', '#...', '#...', '#...']],
  s: [2, ['.###', '#...', '.##.', '...#', '###.']],
  t: [0, ['.#.', '.#.', '###', '.#.', '.#.', '.#.', '.##']],
  u: [2, ['#..#', '#..#', '#..#', '#..#', '.###']],
  v: [2, ['#...#', '#...#', '#...#', '.#.#.', '..#..']],
  w: [2, ['#...#', '#...#', '#.#.#', '#.#.#', '.#.#.']],
  x: [2, ['#...#', '.#.#.', '..#..', '.#.#.', '#...#']],
  y: [2, ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '.##..']],
  z: [2, ['####', '...#', '.##.', '#...', '####']],

  '0': [0, ['.##.', '#..#', '#.##', '#.##', '##.#', '#..#', '.##.']],
  '1': [0, ['.#..', '##..', '.#..', '.#..', '.#..', '.#..', '###.']],
  '2': [0, ['.##.', '#..#', '...#', '..#.', '.#..', '#...', '####']],
  '3': [0, ['###.', '...#', '...#', '.##.', '...#', '...#', '###.']],
  '4': [0, ['...#', '..##', '.#.#', '#..#', '####', '...#', '...#']],
  '5': [0, ['####', '#...', '#...', '###.', '...#', '...#', '###.']],
  '6': [0, ['.##.', '#..#', '#...', '###.', '#..#', '#..#', '.##.']],
  '7': [0, ['####', '...#', '...#', '..#.', '..#.', '.#..', '.#..']],
  '8': [0, ['.##.', '#..#', '#..#', '.##.', '#..#', '#..#', '.##.']],
  '9': [0, ['.##.', '#..#', '#..#', '.###', '...#', '#..#', '.##.']],

  ' ': [0, ['..', '..', '..', '..', '..', '..', '..']],
  '.': [6, ['#']],
  ',': [6, ['.#', '#.']],
  "'": [0, ['#', '#']],
  '"': [0, ['#.#', '#.#']],
  '-': [4, ['###']],
  '—': [4, ['#####']],
  '·': [4, ['#']],
  '•': [3, ['##', '##']],
  '~': [3, ['.#..#', '#.##.']],
  '!': [0, ['#', '#', '#', '#', '#', '.', '#']],
  '?': [0, ['.##.', '#..#', '...#', '..#.', '.#..', '....', '.#..']],
  ':': [2, ['#', '.', '.', '#']],
  ';': [2, ['.#', '..', '..', '.#', '#.']],
  '(': [0, ['.#', '#.', '#.', '#.', '#.', '#.', '.#']],
  ')': [0, ['#.', '.#', '.#', '.#', '.#', '.#', '#.']],
  '/': [0, ['...#', '...#', '..#.', '..#.', '.#..', '.#..', '#...']],
  '+': [2, ['.#.', '###', '.#.']],
  '*': [0, ['#.#', '.#.', '#.#']],
};

/** Curly quotes and long dashes fold onto the drawn glyphs. */
const ALIAS: Record<string, string> = {
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '–': '—', '…': '.',
};

function glyph(ch: string): Glyph | null {
  return FACE[ALIAS[ch] ?? ch] ?? null;
}

export interface TextOpts {
  /** Integer upscale. 2 is the display size used for page titles. */
  scale?: number;
  /** Extra texels between glyphs, at scale 1. */
  tracking?: number;
  /** Smear one texel right — the display weight, not a second face. */
  bold?: boolean;
}

function advanceOf(ch: string, o: TextOpts): number {
  const g = glyph(ch);
  if (!g) return 0;
  const w = Math.max(...g[1].map((r) => r.length));
  return w + 1 + (o.tracking ?? 0) + (o.bold ? 1 : 0);
}

/** Width in texels of a string as it would be drawn. */
export function measure(s: string, o: TextOpts = {}): number {
  const scale = o.scale ?? 1;
  let w = 0;
  for (const ch of s) w += advanceOf(ch, o);
  // the trailing advance is inter-glyph space, not part of the mark
  return Math.max(0, w - (1 + (o.tracking ?? 0) + (o.bold ? 1 : 0))) * scale;
}

/** Draw at `x`, with `y` the TOP row of the cell. Returns the width drawn. */
export function drawText(p: Pix, s: string, x: number, y: number, col: Col, o: TextOpts = {}): number {
  const scale = Math.max(1, Math.round(o.scale ?? 1));
  let cx = x;
  for (const ch of s) {
    const g = glyph(ch);
    if (!g) continue;
    const [top, rows] = g;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== '#') continue;
        const px = cx + c * scale;
        const py = y + (top + r) * scale;
        for (let j = 0; j < scale; j++) {
          for (let i = 0; i < scale; i++) {
            p.set(px + i, py + j, col);
            if (o.bold) p.set(px + i + scale, py + j, col);
          }
        }
      }
    }
    cx += advanceOf(ch, o) * scale;
  }
  return cx - x;
}

/** Draw centred on `cx`. Odd widths land on the left texel, deliberately. */
export function drawCentered(p: Pix, s: string, cx: number, y: number, col: Col, o: TextOpts = {}): number {
  const w = measure(s, o);
  drawText(p, s, Math.round(cx - w / 2), y, col, o);
  return w;
}

/** Greedy wrap to `maxW` texels. Words longer than a line are not broken. */
export function wrap(s: string, maxW: number, o: TextOpts = {}): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of s.split(/\s+/)) {
    if (!word) continue;
    const test = line ? `${line} ${word}` : word;
    if (line && measure(test, o) > maxW) {
      out.push(line);
      line = word;
    } else line = test;
  }
  if (line) out.push(line);
  return out;
}

/**
 * Draw a string so it FITS `maxW`, dropping from `scale` down to 1 and, failing
 * that, splitting on the last space that helps. Page titles come from spell data
 * and card data alike, and "Coffin Moss" is half again as wide as "Spark".
 */
export function fitCentered(
  p: Pix, s: string, cx: number, y: number, col: Col, maxW: number, o: TextOpts = {},
): number {
  const scale = Math.max(1, Math.round(o.scale ?? 1));
  for (let sc = scale; sc >= 1; sc--) {
    const opt = { ...o, scale: sc };
    if (measure(s, opt) <= maxW) {
      drawCentered(p, s, cx, y, col, opt);
      return CELL_H * sc;
    }
    // two lines at this size beat one line a size down
    const lines = wrap(s, maxW, opt);
    if (lines.length === 2 && lines.every((l) => measure(l, opt) <= maxW)) {
      drawCentered(p, lines[0], cx, y, col, opt);
      drawCentered(p, lines[1], cx, y + (CAP_H + 1) * sc, col, opt);
      return (CAP_H + 1 + CELL_H) * sc;
    }
  }
  drawCentered(p, s, cx, y, col, { ...o, scale: 1 });
  return CELL_H;
}
