/**
 * Ad-only pixel art: the wordmark and the button plates.
 *
 * Drawn with the game's own `Pix` toolkit at true art resolution and upscaled
 * NEAREST by CSS, so the ad chrome is made of the same chunky pixels as the
 * walls behind it. Nothing here is fetched — it costs bytes of code, not bytes
 * of payload, which matters inside a 5 MB creative.
 */
import { Pix, Ramp, hex, rgba, shade } from '../art/pixel';
import { Rng } from '../core/rng';
import { book, gold } from '../style/palette';

/** Art pixels are this many CSS pixels across. Chunky on purpose. */
export const LOGO_SCALE = 4;
export const BUTTON_SCALE = 4;

const INK = hex(0x140a18);
const OUTLINE = hex(0x2a1420);

/**
 * Rasterise a string into a 1-bit mask.
 *
 * `Pix` has no text, and hand-authoring a bitmap font for one wordmark would be
 * a lot of glyphs to maintain. Canvas text at art resolution is already
 * essentially pixel art — thresholding the alpha just removes the antialiasing
 * that would otherwise smear when upscaled.
 */
function textMask(text: string, px: number, tracking: number): Pix {
  const font = `bold ${px}px ui-monospace, Menlo, Consolas, monospace`;
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return new Pix(1, 1);
  measure.font = font;
  const widths = [...text].map((ch) => Math.ceil(measure.measureText(ch).width));
  const w = widths.reduce((a, b) => a + b, 0) + tracking * (text.length - 1);
  const h = Math.ceil(px * 1.4);

  const cv = document.createElement('canvas');
  cv.width = Math.max(1, w);
  cv.height = h;
  const ctx = cv.getContext('2d');
  if (!ctx) return new Pix(1, 1);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  // Per-character so tracking is exact; measureText on the whole string would
  // include kerning we cannot then reproduce.
  let x = 0;
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], x, h / 2);
    x += widths[i] + tracking;
  }

  const img = ctx.getImageData(0, 0, cv.width, h).data;
  const out = new Pix(cv.width, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < cv.width; i++) {
      // Hard threshold: pixel art has no partial coverage.
      if (img[(j * cv.width + i) * 4 + 3] > 128) out.set(i, j, hex(0xffffff));
    }
  }
  return out;
}

/** Trim a mask to its ink so stacked words sit tight. */
function trimmed(p: Pix): Pix {
  const b = p.bounds();
  if (b.w <= 0) return p;
  const out = new Pix(b.w, b.h);
  out.blit(p, -b.x, -b.y);
  return out;
}

/**
 * Paint a mask with a vertical ramp plus a lit top edge, and knock a hard
 * outline around it — the three things that make flat text read as a wordmark.
 */
function emboss(mask: Pix, ramp: Ramp, top: number): Pix {
  const out = new Pix(mask.w + 4, mask.h + 6);
  const ox = 2, oy = 2;

  // Drop shadow first, offset down-right, so it sits under everything.
  for (let j = 0; j < mask.h; j++) {
    for (let i = 0; i < mask.w; i++) {
      if (mask.alpha(i, j)) out.set(ox + i + 1, oy + j + 3, rgba(0, 0, 0, 150));
    }
  }
  for (let j = 0; j < mask.h; j++) {
    for (let i = 0; i < mask.w; i++) {
      if (!mask.alpha(i, j)) continue;
      const t = j / Math.max(1, mask.h - 1);
      out.set(ox + i, oy + j, ramp.step(t), { mode: 'set' });
    }
  }
  // Top-lit row: any texel whose neighbour above is empty catches the light.
  for (let j = 0; j < mask.h; j++) {
    for (let i = 0; i < mask.w; i++) {
      if (mask.alpha(i, j) && !mask.alpha(i, j - 1)) {
        out.set(ox + i, oy + j, hex(top), { mode: 'set' });
      }
    }
  }
  out.outline(OUTLINE);
  return out;
}

/**
 * The wordmark: SPELLTORN over DEEP, on a page whose bottom edge is ripped.
 *
 * The tear is the game's verb and the name's other half, so the logo carries it
 * literally rather than leaning on a font choice to imply it.
 */
export function buildLogo(title: string, sub: string): HTMLCanvasElement {
  const goldRamp = new Ramp([0x6d3d10, 0xb8781f, 0xf0a91e, 0xffd977, 0xfff2c4]);
  const paleRamp = new Ramp([0x8a6a4a, 0xc9ab84, 0xefdcb6, 0xfdf3dc]);

  const main = emboss(trimmed(textMask(title, 22, 2)), goldRamp, 0xfff6e0);
  const small = emboss(trimmed(textMask(sub, 11, 6)), paleRamp, 0xfdf3dc);

  const padX = 10;
  const gap = 3;
  const w = Math.max(main.w, small.w) + padX * 2;
  const bannerH = main.h + gap + small.h + 12;
  const tearH = 6;
  const out = new Pix(w, bannerH + tearH);

  // ---- the parchment the wordmark is printed on ------------------------
  const rng = new Rng('spelltorn-logo');
  const parch = new Ramp([book.pageEdge, book.pageFace]);
  for (let j = 0; j < bannerH; j++) {
    const t = 1 - j / bannerH;
    out.rect(0, j, w, 1, parch.step(t * 0.85 + 0.1));
  }

  // Ragged bottom: a per-column random depth, walked so neighbours stay close —
  // a purely random edge reads as noise rather than as torn fibre.
  let depth = 3;
  for (let i = 0; i < w; i++) {
    depth = Math.max(0, Math.min(tearH, depth + rng.int(-1, 1)));
    for (let j = 0; j < tearH; j++) {
      const y = bannerH + j;
      if (j < depth) {
        out.set(i, y, j === depth - 1 ? hex(book.pageEdge) : parch.step(0.2));
      }
    }
    // A fibrous shadow line just above the rip.
    out.set(i, bannerH - 1 + depth - (depth ? 1 : 0), hex(0xd8bf8e));
  }

  // Faint ruled lines, so the parchment reads as a page rather than a slab.
  for (let j = 6; j < bannerH - 6; j += 5) {
    for (let i = 4; i < w - 4; i += 2) out.set(i, j, rgba(120, 96, 60, 26));
  }
  out.outline(hex(0x6b4a2c));

  // ---- the wordmark ----------------------------------------------------
  out.blit(main, Math.round((w - main.w) / 2), 5);
  out.blit(small, Math.round((w - small.w) / 2), 5 + main.h + gap);

  return out.toCanvas();
}

/**
 * A chunky beveled plate for a button.
 *
 * Generated at the exact art size the caller will scale by an integer factor,
 * so nothing is ever resampled off-grid. The middle is a pure vertical ramp,
 * which is also what makes the plate safe to stretch horizontally if a label
 * runs long.
 */
export function buildPlate(w: number, h: number, base: number): HTMLCanvasElement {
  const p = new Pix(w, h);
  // Already-packed Cols, hence `packed: true` — the default path would run
  // hex() over values that have an alpha byte in them.
  const face = new Ramp(
    [shade(hex(base), 0.55), hex(base), hex(base), shade(hex(base), 1.45)],
    true,
  );

  for (let j = 0; j < h; j++) p.rect(0, j, w, 1, face.step(1 - j / h));

  // Chamfer: knock the corner texels out so the plate reads as cut metal
  // rather than a rounded CSS box that happens to be pixelated.
  for (const [cx, cy] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]] as const) {
    p.set(cx, cy, 0, { mode: 'set' });
  }

  p.rect(1, 1, w - 2, 1, shade(hex(base), 1.7));           // top highlight
  p.rect(1, h - 2, w - 2, 1, shade(hex(base), 0.45));       // bottom shadow
  p.rect(1, 1, 1, h - 2, shade(hex(base), 1.35));           // left light
  p.rect(w - 2, 1, 1, h - 2, shade(hex(base), 0.6));        // right dark
  p.frame(0, 0, w, h, INK);
  // re-cut the chamfer the frame just filled back in
  for (const [cx, cy] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]] as const) {
    p.set(cx, cy, 0, { mode: 'set' });
  }

  // Rivets, inset from each end.
  for (const rx of [3, w - 4]) {
    p.set(rx, 3, shade(hex(base), 1.8));
    p.set(rx, 4, shade(hex(base), 0.5));
  }

  return p.toCanvas();
}

/** The gold plate the store CTA sits on. */
export function buildCtaPlate(w: number, h: number): HTMLCanvasElement {
  return buildPlate(w, h, gold);
}

/** The muted plate the dismiss control sits on. */
export function buildDismissPlate(w: number, h: number): HTMLCanvasElement {
  return buildPlate(w, h, book.leatherDark);
}
