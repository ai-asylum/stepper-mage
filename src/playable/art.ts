/**
 * AD-ONLY pixel art: the playable's wordmark and its button plates.
 *
 * Drawn with the game's own `Pix` toolkit at true art resolution and upscaled
 * NEAREST, so the ad chrome is made of the same chunky pixels as the walls
 * behind it. Nothing here is fetched — it costs bytes of code, not bytes of
 * payload, which is the right trade inside a 5 MB creative.
 *
 * NOT the game's logo. The splash and the Play feature graphic used to be drawn
 * here and are now GENERATED (`tools/genlogoart.mjs`, formatted by
 * `tools/genlogo.mjs`) — hand-plotted marks are not the house style. This
 * wordmark survives only because the creative pays for every byte and a
 * megabyte PNG is a real cost there; see the note in tools/genlogo.mjs.
 */
import { Pix, Ramp, hex, rgba, shade } from '../art/pixel';
import { Rng } from '../core/rng';
import { book, gold } from '../style/palette';

/** Art pixels are this many CSS pixels across. Chunky on purpose. */
export const BUTTON_SCALE = 4;

/**
 * The largest whole-number upscale of `artWidth` that still fits the stage.
 *
 * Whole numbers only: a fractional scale resamples the art off its own grid and
 * the pixels stop being pixels, which is the entire look.
 */
export function fitScale(artWidth: number, stageWidth: number, max = 4): number {
  return Math.max(1, Math.min(max, Math.floor((stageWidth * 0.88) / artWidth)));
}

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
export function textMask(text: string, px: number, tracking: number): Pix {
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
export function trimmed(p: Pix): Pix {
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
export function emboss(
  mask: Pix,
  ramp: Ramp,
  top: number,
  opts: { outline?: boolean; shadow?: number } = {},
): Pix {
  const { outline = true, shadow = 3 } = opts;
  const out = new Pix(mask.w + 4, mask.h + 6);
  const ox = 2, oy = 2;

  // Drop shadow first, offset down-right, so it sits under everything.
  if (shadow > 0) {
    for (let j = 0; j < mask.h; j++) {
      for (let i = 0; i < mask.w; i++) {
        if (mask.alpha(i, j)) out.set(ox + i + 1, oy + j + shadow, rgba(0, 0, 0, 150));
      }
    }
  }
  for (let j = 0; j < mask.h; j++) {
    for (let i = 0; i < mask.w; i++) {
      if (!mask.alpha(i, j)) continue;
      // Light at the TOP: the ramp runs dark→light, and the light end belongs
      // where the light is. Running it the other way makes struck metal look
      // like it is lit from underneath, which just reads as muddy.
      const t = 1 - j / Math.max(1, mask.h - 1);
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
  if (outline) out.outline(OUTLINE);
  return out;
}

/**
 * A ragged edge depth per index, walked rather than sampled independently —
 * uncorrelated noise reads as static, while a walk reads as torn fibre.
 */
export function ragged(rng: Rng, count: number, max: number): number[] {
  const out: number[] = [];
  let d = Math.round(max / 2);
  for (let i = 0; i < count; i++) {
    d = Math.max(0, Math.min(max, d + rng.int(-1, 1)));
    out.push(d);
  }
  return out;
}

/**
 * The wordmark: SPELLTORN over DEEP, printed on a page torn out of the book.
 *
 * The tear is the game's verb and half its name, so the logo carries it
 * literally — all four edges are ripped — rather than leaning on a font choice
 * to imply it. DEEP is set in ink rather than in a pale metal, because on
 * parchment a light-on-light subtitle simply disappears.
 */
function logoPix(title: string, sub: string): Pix {
  const goldRamp = new Ramp([0x7a4512, 0xc08422, 0xf0a91e, 0xffd977, 0xfff2c4]);
  // Ink barely varies: at eight pixels tall a subtitle needs to be a shape you
  // can read, and every extra tone inside a stroke that thin is just noise.
  const inkRamp = new Ramp([0x3a2130, 0x4a2b3a]);

  // Sized so the finished art still clears a 3x upscale on a phone-width stage
  // — a wordmark that can only afford 1x is not pixel art, it is just small.
  const main = emboss(trimmed(textMask(title, 14, 1)), goldRamp, 0xfff2c4);
  // No outline, no shadow: dark ink on parchment already has all the contrast
  // it needs, and either one at this size closes the letters into blobs.
  const small = emboss(
    trimmed(textMask(sub, 9, 5)), inkRamp, 0x5e3a49,
    { outline: false, shadow: 0 },
  );

  const rag = 4;
  const padX = 6;
  const padY = 4;
  const gap = 1;
  const bodyW = Math.max(main.w, small.w) + padX * 2;
  const bodyH = main.h + gap + small.h + padY * 2;
  const w = bodyW + rag * 2;
  const h = bodyH + rag * 2;
  const out = new Pix(w, h);

  // ---- the page ---------------------------------------------------------
  const rng = new Rng('spelltorn-logo');
  const parch = new Ramp([0xc9a469, 0xdfbc83, 0xefd6a4, 0xf8e8c6]);
  for (let j = 0; j < h; j++) {
    // Lighter through the middle, aged toward the top and bottom edges.
    const t = 1 - Math.abs(j / (h - 1) - 0.42) * 1.7;
    out.rect(0, j, w, 1, parch.step(Math.max(0, Math.min(0.999, t))));
  }

  // Foxing — sparse darker specks, so the page is not a flat swatch.
  for (let n = 0; n < w * h * 0.02; n++) {
    out.set(rng.int(0, w - 1), rng.int(0, h - 1), rgba(150, 116, 66, 40));
  }

  // Faint ruled lines: this was a page of a book before it was a logo.
  for (let j = rag + 3; j < h - rag - 3; j += 4) {
    for (let i = rag + 2; i < w - rag - 2; i += 2) out.set(i, j, rgba(120, 96, 60, 28));
  }

  // ---- rip every edge ---------------------------------------------------
  const left = ragged(rng, h, rag);
  const right = ragged(rng, h, rag);
  const top = ragged(rng, w, rag);
  const bottom = ragged(rng, w, rag);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < left[j]; i++) out.set(i, j, 0, { mode: 'set' });
    for (let i = 0; i < right[j]; i++) out.set(w - 1 - i, j, 0, { mode: 'set' });
  }
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < top[i]; j++) out.set(i, j, 0, { mode: 'set' });
    for (let j = 0; j < bottom[i]; j++) out.set(i, h - 1 - j, 0, { mode: 'set' });
  }

  // The torn lip catches light on the fibres — but only on the two edges facing
  // the light. Tracing all four put a white keyline round the whole shape and
  // flattened the page into a sticker.
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!out.alpha(i, j)) continue;
      if (!out.alpha(i - 1, j) || !out.alpha(i, j - 1)) {
        out.set(i, j, hex(0xfff6e2), { mode: 'set' });
      }
    }
  }
  out.outline(hex(0x4a3320));

  // ---- the wordmark ----------------------------------------------------
  out.blit(main, Math.round((w - main.w) / 2), rag + padY);
  out.blit(small, Math.round((w - small.w) / 2), rag + padY + main.h + gap);

  return out;
}

export function buildLogo(title: string, sub: string): HTMLCanvasElement {
  return logoPix(title, sub).toCanvas();
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
  const c = hex(base);

  // HARD bands, not a gradient. At fifteen pixels tall a smooth ramp only ever
  // resolves to bands anyway, and choosing them explicitly is what makes the
  // plate read as struck metal instead of a CSS button that got pixelated.
  const lip = shade(c, 1.55);
  const faceHi = shade(c, 1.16);
  const faceLo = shade(c, 0.86);
  const foot = shade(c, 0.52);

  const mid = Math.max(2, Math.round(h * 0.45));
  p.rect(0, 0, w, mid, faceHi);
  p.rect(0, mid, w, h - mid, faceLo);
  p.rect(1, 1, w - 2, 1, lip);
  p.rect(1, h - 2, w - 2, 1, foot);
  p.rect(1, 1, 1, h - 2, shade(c, 1.3));
  p.rect(w - 2, 1, 1, h - 2, shade(c, 0.68));

  p.frame(0, 0, w, h, INK);
  // Chamfer: knock the corner texels out so the plate reads as cut metal
  // rather than a rounded box. Done after the frame, which fills them back in.
  for (const [cx, cy] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]] as const) {
    p.set(cx, cy, 0, { mode: 'set' });
    p.set(cx === 0 ? 1 : w - 2, cy === 0 ? 1 : h - 2, INK, { mode: 'set' });
  }

  // Studs at each end, vertically centred: one lit texel over one shadowed one.
  const sy = Math.floor(h / 2) - 1;
  for (const sx of [3, w - 4]) {
    p.set(sx, sy, lip, { mode: 'set' });
    p.set(sx, sy + 1, foot, { mode: 'set' });
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
