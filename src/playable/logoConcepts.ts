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
 * E — OPEN BOOK. The grimoire spread open, with the four page elements
 * breaking out of it.
 *
 * The other four directions all treat the title as the subject. This one makes
 * the OBJECT the subject and hangs the title under it, which is the only way
 * the four elements get to be in the mark at all — and they are the game's
 * actual page list (fire, frost, gust, plant), not decorative flourishes.
 *
 * Composed in layers back-to-front so the elements read as coming from behind
 * the book rather than being stuck on top of it: wind, then the four elements,
 * then the book, then the wordmark.
 */
export function conceptOpenBook(title: string, sub: string): Pix {
  const rng = new Rng('concept-openbook-2');

  const FIRE = new Ramp([0x7d2405, 0xc9520b, 0xff8c1a, 0xffc862, 0xfff3cf]);
  const ICE = new Ramp([0x16406b, 0x2b78b0, 0x5fb2e0, 0xa9e2f7, 0xeafbff]);
  const WIND = new Ramp([0x3f6b67, 0x6fa6a0, 0xa8d4ce, 0xdff4f0]);
  const LEAF = new Ramp([0x1e4a1a, 0x357026, 0x57a034, 0x8ec84e]);
  const PARCH = new Ramp([0xa8814d, 0xc9a469, 0xe4cb98, 0xf6ead0]);

  const W = 152;
  const H = 126;
  const out = new Pix(W, H);
  const cx = Math.round(W / 2);
  const cy = 48;

  // ---- wind: two tight swirls curling over the shoulders of the book ------
  // Short arcs near the object, not full-width lines: a line that crosses the
  // whole mark reads as a scratch on the canvas rather than as moving air.
  const swirl = (ox: number, oy: number, r: number, from: number, to: number, dir: number) => {
    let prev: [number, number] | null = null;
    const steps = 34;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = from + (to - from) * t;
      // Radius SHRINKS along the sweep, so the stroke curls into itself. A
      // constant-ish radius over half a turn is just an arc, and a pair of arcs
      // at the top of a mark reads unmistakably as two seagulls.
      // Shrinking radius over rather LESS than a full turn: past about 0.7 of a
      // turn the stroke meets its own start and the gust becomes a closed loop —
      // a balloon tied to the corner of the book.
      const rr = r * (1.05 - t * 0.62);
      const x = Math.round(ox + Math.cos(a) * rr * dir);
      const y = Math.round(oy + Math.sin(a) * rr * 0.62);
      if (prev) out.line(prev[0], prev[1], x, y, WIND.step(0.2 + t * 0.75));
      prev = [x, y];
    }
    if (prev) out.taper(prev[0], prev[1], prev[0] + dir * 6, prev[1] - 3, 1.1, 0.4, WIND.step(0.9));
  };
  swirl(cx - 46, 30, 17, Math.PI * 1.02, Math.PI * 2.18, -1);
  swirl(cx + 46, 30, 17, Math.PI * 1.02, Math.PI * 2.18, 1);
  swirl(cx - 38, 17, 11, Math.PI * 1.05, Math.PI * 2.05, -1);
  swirl(cx + 38, 17, 11, Math.PI * 1.05, Math.PI * 2.05, 1);

  // ---- fire: tongues climbing the left ------------------------------------
  /**
   * Built column-by-column rather than as stacked ellipses.
   *
   * Ellipses per row bulge at the waist and the result reads as a root
   * vegetable — the first pass at this looked like three carrots. A flame is a
   * width FUNCTION: widest just above the base, pinching to nothing at the tip,
   * with the whole tongue leaning as it rises.
   */
  const flame = (bx: number, by: number, hgt: number, w0: number, lean: number) => {
    for (let j = 0; j < hgt; j++) {
      const t = j / (hgt - 1);
      // Widest at the BASE and pinching to the tip. An earlier version peaked
      // at a third of the way up and went to zero at t=0, which drew a fat
      // middle over a pointed bottom — three hanging droplets, fire upside down.
      /**
       * Fuller body, wavier edge, and a tip that wanders.
       *
       * With a 1.15 exponent and a tight flicker the tongues tapered in a
       * straight line, which gave fire the SAME silhouette as the ice shards
       * beside it — two crystals in different colours. Fire has to be the soft
       * one: a fatter mid-body, an edge that ripples, and a tip that leans.
       */
      const flicker = 0.78 + 0.3 * Math.sin(t * 9.5 + bx * 1.7);
      const half = Math.max(0.5, w0 * Math.pow(1 - t, 0.8) * flicker);
      const x = bx + lean * t * t * 12 + Math.sin(t * 4.2 + bx) * 2.6 * t;
      const y = by - j;
      out.rect(Math.round(x - half), y, Math.max(1, Math.round(half * 2)), 1, FIRE.step(0.1 + t * 0.45));
      if (half > 1.3) {
        const ih = half * 0.5;
        out.rect(Math.round(x - ih), y, Math.max(1, Math.round(ih * 2)), 1, FIRE.step(0.55 + t * 0.42));
      }
    }
  };
  flame(27, 96, 45, 6.8, -0.22);
  flame(16, 92, 32, 5, -0.15);
  flame(37, 90, 22, 3.8, -0.4);
  for (let n = 0; n < 18; n++) {
    out.set(rng.int(12, 40), rng.int(44, 84), FIRE.step(0.62 + rng.int(0, 34) / 100));
  }

  // ---- ice: shards climbing the right -------------------------------------
  const shard = (bx: number, by: number, hgt: number, wid: number, lean: number) => {
    const tx = bx + lean;
    out.poly([[bx - wid, by], [bx + wid, by], [tx + wid * 0.2, by - hgt], [tx - wid * 0.2, by - hgt]], ICE.step(0.35));
    out.taper(bx - wid * 0.5, by - 1, tx - wid * 0.15, by - hgt + 1, 1.2, 0.5, ICE.step(0.85));
    out.taper(bx + wid * 0.6, by - 1, tx + wid * 0.15, by - hgt + 1, 0.9, 0.4, ICE.step(0.12));
    out.set(Math.round(tx), by - hgt, ICE.step(0.98));
  };
  shard(W - 28, 96, 45, 6.2, 3);
  shard(W - 17, 92, 32, 4.8, 2);
  shard(W - 38, 90, 22, 3.8, -2);
  for (let n = 0; n < 16; n++) {
    out.set(rng.int(W - 42, W - 10), rng.int(44, 84), ICE.step(0.72 + rng.int(0, 28) / 100));
  }

  // ---- plants: vines climbing UP the outside of the book ------------------
  /**
   * Rooted at the bottom and curling outward-then-in, so they embrace the book
   * rather than lying beside it. The first pass ran them horizontally and they
   * read as pea pods floating in space — a vine has to start somewhere and
   * reach for something.
   */
  const vine = (x0: number, y0: number, dir: number, n: number, reach: number, rise: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + dir * (Math.sin(t * Math.PI * 0.85) * reach);
      const y = y0 - t * rise;
      pts.push([x, y]);
    }
    for (let i = 1; i < pts.length; i++) {
      const th = i < pts.length * 0.4 ? 1.4 : 0.9;
      out.taper(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], th, th * 0.8,
        LEAF.step(0.2 + (i / pts.length) * 0.35));
    }
    for (let i = 2; i < pts.length - 1; i += 3) {
      const [lx, ly] = pts[i];
      const side = (i / 3) % 2 === 0 ? 1 : -1;
      const r = 1.5 + Math.sin((i / pts.length) * Math.PI) * 2.1;
      // Leaves are angled off the stem, not stuck on the side of it.
      const ax = lx + side * r * 1.05;
      const ay = ly - r * 0.55;
      out.ellipse(ax, ay, r, r * 0.55, LEAF.step(0.6));
      out.ellipse(ax + side * 0.3, ay - 0.5, r * 0.55, r * 0.3, LEAF.step(0.9));
    }
  };
  // SHORT. The first pass reached 30 wide and 52 tall from each root and the
  // pair closed into a heart around the whole mark — a wreath competing with
  // the book instead of sitting under it, and it buried the fire and the ice.
  vine(cx - 9, 92, -1, 13, 16, 22);
  vine(cx + 9, 92, 1, 13, 16, 22);
  vine(cx - 3, 90, -1, 8, 8, 12);
  vine(cx + 3, 90, 1, 8, 8, 12);

  // ---- the book -----------------------------------------------------------
  /**
   * Drawn COLUMN-WISE from the spine outward so the spread actually curves.
   *
   * The first attempt used two flat quads and read as a lectern: an open book's
   * whole silhouette is the pair of wings lifting away from a low fold, and a
   * straight top edge kills it. Each column gets its own top and bottom, rising
   * outward, with the page stack drawn as a few offset rows at the far edge.
   */
  const span = 44;
  const foldTop = cy - 2;
  const foldBot = cy + 13;
  const lift = 15;

  const side = (sgn: number) => {
    for (let k = 0; k <= span; k++) {
      const t = k / span;
      const x = cx + sgn * k;
      const rise = Math.pow(t, 0.75) * lift;
      const top = Math.round(foldTop - rise);
      const bot = Math.round(foldBot - rise * 0.42);
      // Cover: one row proud of the pages, and a touch deeper at the outside.
      out.rect(x, top + 1, 1, bot - top + 3, hex(sgn < 0 ? 0x4a1622 : 0x5a1c2a));
      // Pages, brighter toward the outer edge where the light gets in.
      out.rect(x, top, 1, bot - top, PARCH.step(0.3 + t * 0.55));
      // Ruled hint lines, skipped near the fold so they do not crowd it.
      if (k > 6 && k % 7 === 0) {
        out.rect(x - sgn, top + 3, 1, Math.max(1, bot - top - 5), rgba(120, 92, 54, 60));
      }
    }
    // Page stack at the outer lip: three offset rows, which is what sells paper
    // as a thing with thickness rather than a painted shape.
    const xEdge = cx + sgn * span;
    const rEnd = lift;
    for (let s = 0; s < 3; s++) {
      out.rect(xEdge - sgn * s, Math.round(foldBot - rEnd * 0.42) + s, 1, 2, PARCH.step(0.9 - s * 0.22));
    }
    out.rect(xEdge, Math.round(foldTop - rEnd), 1, Math.round(rEnd * 0.58) + 3, PARCH.step(0.98));
  };
  side(-1);
  side(1);

  // The fold itself, and the clasp.
  out.rect(cx, foldTop, 1, foldBot - foldTop + 2, rgba(70, 46, 26, 170));
  out.rect(cx - 1, foldTop + 1, 1, foldBot - foldTop, rgba(70, 46, 26, 90));
  out.rect(cx - 2, foldBot + 1, 5, 4, hex(0xffc23e));
  out.rect(cx - 1, foldBot + 2, 3, 2, hex(0x8a6212));

  // A sigil lifting off the open spread — the reason it is open at all.
  out.ellipseFrame(cx, foldTop - 9, 8, 3, rgba(190, 150, 255, 200));
  out.ellipseFrame(cx, foldTop - 13, 5, 2, rgba(214, 186, 255, 160));
  for (let n = 0; n < 16; n++) {
    out.set(cx + rng.int(-10, 10), foldTop - rng.int(2, 18), rgba(210, 180, 255, rng.int(70, 200)));
  }

  // ---- wordmark under it --------------------------------------------------
  const main = trimmed(textMask(title, 13, 1));
  const small = trimmed(textMask(sub, 8, 5));
  const put = (mask: Pix, oy: number, c: number, shadow: boolean) => {
    const ox = Math.round((W - mask.w) / 2);
    for (let j = 0; j < mask.h; j++) {
      for (let i = 0; i < mask.w; i++) {
        if (!mask.alpha(i, j)) continue;
        if (shadow) out.set(ox + i + 1, oy + j + 2, rgba(0, 0, 0, 210), { mode: 'set' });
        out.set(ox + i, oy + j, hex(c), { mode: 'set' });
      }
    }
  };
  const titleY = H - main.h - small.h - 4;
  put(main, titleY, 0xffd977, true);
  put(small, titleY + main.h + 2, 0xcbb68c, false);
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
