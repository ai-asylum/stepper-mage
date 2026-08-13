/**
 * Four wordmark DIRECTIONS for Unbound Descent, for picking between.
 *
 * Deliberately not four versions of one idea: the shipped mark was a parchment
 * banner, and "the title on a plate" is the thing being questioned, so only one
 * of these is a plate at all. They differ in material (carved stone), in process
 * (burned through), in form (a circular seal rather than a banner) and in
 * whether there is any plate at all (type that falls apart).
 *
 * Drawn with the game's own `Pix` toolkit at art resolution, like everything
 * else in `art.ts`, and rendered to PNGs by `tools/genconcepts.mjs`. Whichever
 * wins gets promoted into `art.ts` and the losers deleted — this file is a
 * decision aid, not a permanent home.
 */
import { Pix, Ramp, hex, rgba } from '../art/pixel';
import { Rng } from '../core/rng';
import { textMask, trimmed } from './art';

/** Grow a mask by one pixel in the four directions. */
function dilate(mask: Pix): Pix {
  const out = new Pix(mask.w + 2, mask.h + 2);
  for (let j = 0; j < mask.h; j++) {
    for (let i = 0; i < mask.w; i++) {
      if (!mask.alpha(i, j)) continue;
      out.set(i + 1, j + 1, hex(0xffffff), { mode: 'set' });
      out.set(i, j + 1, hex(0xffffff), { mode: 'set' });
      out.set(i + 2, j + 1, hex(0xffffff), { mode: 'set' });
      out.set(i + 1, j, hex(0xffffff), { mode: 'set' });
      out.set(i + 1, j + 2, hex(0xffffff), { mode: 'set' });
    }
  }
  return out;
}

/**
 * A — CHISELLED. The title cut into a stone slab.
 *
 * The inverse of the shipped mark's lighting: letters are cut INTO the surface,
 * so the shadow sits along their top edge and the lit lip along the bottom. Get
 * that backwards and carved text pops back out into relief, which is the single
 * thing this direction has to get right.
 */
export function conceptChiselled(title: string, sub: string): Pix {
  const rng = new Rng('concept-chiselled');
  const stone = new Ramp([0x33363f, 0x454956, 0x585d6c, 0x6c7282, 0x848b9b]);
  const main = trimmed(textMask(title, 14, 1));
  const small = trimmed(textMask(sub, 8, 5));

  const padX = 8, padY = 6, gap = 3;
  const w = Math.max(main.w, small.w) + padX * 2;
  const h = main.h + gap + small.h + padY * 2;
  const out = new Pix(w, h);

  // Slab: lighter at the top where the light falls, with grain speckle so it is
  // rock rather than a swatch.
  for (let j = 0; j < h; j++) out.rect(0, j, w, 1, stone.step(1 - j / (h - 1)));
  for (let n = 0; n < w * h * 0.18; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    out.set(x, y, rgba(0, 0, 0, rng.int(8, 26)));
  }
  // Verdigris settling in the low corners — the one warm-adjacent note, and the
  // thing that stops flat grey reading as untextured placeholder.
  for (let n = 0; n < w * 2; n++) {
    const x = rng.int(0, w - 1), y = rng.int(h - 8, h - 1);
    out.set(x, y, rgba(96, 132, 96, rng.int(10, 34)));
  }

  const cut = (mask: Pix, ox: number, oy: number) => {
    for (let j = 0; j < mask.h; j++) {
      for (let i = 0; i < mask.w; i++) {
        if (!mask.alpha(i, j)) continue;
        out.set(ox + i, oy + j, hex(0x1c1e25), { mode: 'set' });
      }
    }
    for (let j = 0; j < mask.h; j++) {
      for (let i = 0; i < mask.w; i++) {
        if (!mask.alpha(i, j)) continue;
        // Shadow along the TOP of the cut, lit lip along the BOTTOM: that pair
        // is the whole illusion of depth going inward.
        if (!mask.alpha(i, j - 1)) out.set(ox + i, oy + j, hex(0x101116), { mode: 'set' });
        if (!mask.alpha(i, j + 1)) out.set(ox + i, oy + j, hex(0x9aa2b2), { mode: 'set' });
      }
    }
  };
  cut(main, Math.round((w - main.w) / 2), padY);
  cut(small, Math.round((w - small.w) / 2), padY + main.h + gap);

  // Chipped corners, so the block is quarried and not extruded.
  for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [w - 1, 0, -1, 1], [0, h - 1, 1, -1], [w - 1, h - 1, -1, -1]]) {
    const d = rng.int(2, 4);
    for (let j = 0; j < d; j++) for (let i = 0; i < d - j; i++) {
      out.set(cx + i * sx, cy + j * sy, 0, { mode: 'set' });
    }
  }
  out.outline(hex(0x14161b));
  return out;
}

/**
 * B — BRANDED. The title burned through, embers still eating the edges.
 *
 * Fire is the game's signature element and "unbound" is what happens to a
 * binding that burns, so the mark is the damage rather than a picture of it.
 * No plate edge is drawn: the char field IS the shape, and it is deliberately
 * irregular so the logo has no rectangle anywhere in it.
 */
export function conceptBranded(title: string, sub: string): Pix {
  const rng = new Rng('concept-branded');
  // Hot at the letter edge, cooling outward into char.
  const ember = new Ramp([0x3d1206, 0x8c2c07, 0xd4600e, 0xff9a2e, 0xffd98a, 0xfff6d8]);

  const main = trimmed(textMask(title, 14, 1));
  const small = trimmed(textMask(sub, 8, 5));
  const padX = 10, padY = 8, gap = 4;
  const w = Math.max(main.w, small.w) + padX * 2;
  const h = main.h + gap + small.h + padY * 2;
  const out = new Pix(w, h);

  // The char field. Irregular by construction — every row is eaten in from both
  // sides by a walked amount, so the mark has no straight edge anywhere.
  const eatL: number[] = [];
  const eatR: number[] = [];
  let dl = 3, dr = 3;
  for (let j = 0; j < h; j++) {
    dl = Math.max(0, Math.min(7, dl + rng.int(-1, 1)));
    dr = Math.max(0, Math.min(7, dr + rng.int(-1, 1)));
    eatL.push(dl); eatR.push(dr);
  }
  for (let j = 0; j < h; j++) {
    for (let i = eatL[j]; i < w - eatR[j]; i++) {
      const n = rng.int(0, 100);
      const c = n > 92 ? 0x2a1410 : n > 70 ? 0x1a0c0a : 0x120807;
      out.set(i, j, hex(c), { mode: 'set' });
    }
  }
  // Ash flecks and a few live sparks caught in the char.
  for (let n = 0; n < w * h * 0.03; n++) {
    out.set(rng.int(0, w - 1), rng.int(0, h - 1), rgba(120, 108, 100, rng.int(12, 40)));
  }

  /**
   * Burn a word in.
   *
   * Three passes outward from the glyph: the letter core is the coolest part
   * (it is the hole the fire already finished), then the hot rim, then a wide
   * soft scorch. Doing the rim as a dilation difference rather than an outline
   * is what makes it look eaten rather than stroked.
   */
  const burn = (mask: Pix, ox: number, oy: number) => {
    const halo = dilate(dilate(mask));
    for (let j = 0; j < halo.h; j++) {
      for (let i = 0; i < halo.w; i++) {
        if (!halo.alpha(i, j)) continue;
        out.set(ox + i - 2, oy + j - 2, hex(0x521a06), { mode: 'set' });
      }
    }
    const rim = dilate(mask);
    for (let j = 0; j < rim.h; j++) {
      for (let i = 0; i < rim.w; i++) {
        if (!rim.alpha(i, j)) continue;
        const t = 0.55 + rng.int(0, 40) / 100;
        out.set(ox + i - 1, oy + j - 1, ember.step(Math.min(0.999, t)), { mode: 'set' });
      }
    }
    for (let j = 0; j < mask.h; j++) {
      for (let i = 0; i < mask.w; i++) {
        if (!mask.alpha(i, j)) continue;
        // The letter itself is the hole: near-black, with the odd surviving
        // ember so it is not a flat cut-out.
        const live = rng.int(0, 100) > 90;
        out.set(ox + i, oy + j, live ? ember.step(0.75) : hex(0x0a0504), { mode: 'set' });
      }
    }
  };
  burn(main, Math.round((w - main.w) / 2), padY);
  burn(small, Math.round((w - small.w) / 2), padY + main.h + gap);

  // Smoke rising off the top edge.
  for (let n = 0; n < w * 0.8; n++) {
    const x = rng.int(0, w - 1);
    out.set(x, rng.int(0, 3), rgba(90, 80, 76, rng.int(20, 60)));
  }
  return out;
}

/**
 * C — SEAL. The title inside an arcane disc.
 *
 * An emblem rather than a banner: circular, symmetrical, and readable as a
 * badge at avatar size, which is the one thing a wide wordmark can never do.
 * Borrows the app icon's violet sigil so the launcher and the wordmark are
 * plainly the same game.
 */
export function conceptSeal(title: string, sub: string): Pix {
  const R = 54;
  const size = R * 2 + 6;
  const out = new Pix(size, size);
  const cx = size / 2, cy = size / 2;

  const violet = hex(0x8a5cff);
  const dim = hex(0x4a2f8a);

  out.ellipse(cx, cy, R, R, hex(0x150c24));
  out.ellipseFrame(cx, cy, R, R, violet);
  out.ellipseFrame(cx, cy, R - 3, R - 3, dim);
  out.ellipseFrame(cx, cy, R - 14, R - 14, dim);

  // Spokes between the two rings — eight, so it reads as a compass rose and a
  // ward at once.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x0 = cx + Math.cos(a) * (R - 14), y0 = cy + Math.sin(a) * (R - 14);
    const x1 = cx + Math.cos(a) * (R - 3), y1 = cy + Math.sin(a) * (R - 3);
    out.line(Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), dim);
  }
  // Runic ticks around the outer ring.
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const x = cx + Math.cos(a) * (R - 7), y = cy + Math.sin(a) * (R - 7);
    out.set(Math.round(x), Math.round(y), k % 4 === 0 ? violet : dim, { mode: 'set' });
  }

  const main = trimmed(textMask(title, 11, 0));
  const small = trimmed(textMask(sub, 7, 3));
  const put = (mask: Pix, oy: number, c: number, shadow: boolean) => {
    const ox = Math.round((size - mask.w) / 2);
    for (let j = 0; j < mask.h; j++) {
      for (let i = 0; i < mask.w; i++) {
        if (!mask.alpha(i, j)) continue;
        if (shadow) out.set(ox + i, oy + j + 1, rgba(0, 0, 0, 170), { mode: 'set' });
        out.set(ox + i, oy + j, hex(c), { mode: 'set' });
      }
    }
  };
  /**
   * Darken behind the type so the spokes do not run through the letters —
   * CLIPPED to the inner disc, not a full-width rect. A rectangle reads as a
   * rendering fault laid over the seal rather than as part of it, which is
   * enough to make the whole direction look broken.
   */
  const bandTop = Math.round(cy - main.h / 2) - 3;
  const bandBot = bandTop + main.h + 6;
  for (let j = bandTop; j < bandBot; j++) {
    for (let i = 0; i < size; i++) {
      const dx = i - cx, dy = j - cy;
      if (dx * dx + dy * dy > (R - 15) * (R - 15)) continue;
      out.set(i, j, rgba(10, 6, 18, 215));
    }
  }
  put(main, Math.round(cy - main.h / 2) - 2, 0xf0e6ff, true);
  put(small, Math.round(cy + main.h / 2) + 3, 0xa982ff, false);
  return out;
}

/**
 * D — FALLING. No plate at all; the second word comes apart and drops.
 *
 * The only direction where the type IS the illustration: UNBOUND holds, DESCENT
 * loses its letters downward one at a time, shedding fragments. Set per
 * character rather than as one string, because the whole idea needs each glyph
 * placed on its own baseline.
 */
export function conceptFalling(title: string, sub: string): Pix {
  const rng = new Rng('concept-falling');
  const main = trimmed(textMask(title, 15, 2));

  const chars = [...sub].map((ch) => trimmed(textMask(ch, 12, 0)));
  const gapX = 4;
  const subW = chars.reduce((a, c) => a + c.w + gapX, -gapX);
  const drop = 22;

  const w = Math.max(main.w, subW) + 10;
  const h = main.h + 10 + drop + 16;
  const out = new Pix(w, h);

  // UNBOUND: solid bone, one hard shadow. No ramp — this direction is about
  // silhouette, and a gradient inside the strokes would soften exactly the edge
  // it depends on.
  const mx = Math.round((w - main.w) / 2);
  for (let j = 0; j < main.h; j++) {
    for (let i = 0; i < main.w; i++) {
      if (!main.alpha(i, j)) continue;
      out.set(mx + i + 1, 2 + j + 2, rgba(0, 0, 0, 190), { mode: 'set' });
      out.set(mx + i, 2 + j, hex(0xf4ecdd), { mode: 'set' });
    }
  }

  // DESCENT: each glyph sits lower and dimmer than the one before it.
  let x = Math.round((w - subW) / 2);
  const baseY = 2 + main.h + 6;
  const fade = new Ramp([0xd8cdbb, 0xa2957f, 0x6d6354, 0x453f36]);
  for (let k = 0; k < chars.length; k++) {
    const c = chars[k];
    const t = k / Math.max(1, chars.length - 1);
    const dy = Math.round(t * t * drop);
    const col = fade.step(t);
    for (let j = 0; j < c.h; j++) {
      for (let i = 0; i < c.w; i++) {
        if (!c.alpha(i, j)) continue;
        out.set(x + i, baseY + dy + j, col, { mode: 'set' });
      }
    }
    // Fragments shaken loose, more of them the further the glyph has fallen.
    for (let n = 0; n < Math.round(t * 7); n++) {
      out.set(
        x + rng.int(0, c.w - 1),
        baseY + dy + c.h + rng.int(1, 12),
        fade.step(Math.min(0.999, t + 0.2)),
        { mode: 'set' },
      );
    }
    x += c.w + gapX;
  }
  return out;
}
