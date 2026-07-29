/**
 * The twelve star-tree pictograms, and the three disc shapes they sit in.
 *
 * Its own file because this is ART, not layout: `ui/tree.ts` decides where a node
 * goes and what state it is in, and asks here for the drawing. Every glyph is a
 * Canvas 2D path — no image assets, same as the rest of this game's art — and every
 * one is authored in NORMALISED units so one number (`s`, the icon's half-extent)
 * scales the whole set from a 38px disc to a 52px one without re-tuning anything.
 *
 * Two rules the whole set follows, and both come from Loop Hero's camp being
 * criticised as "a muddy blur" of small similar icons:
 *
 *  1. **Nothing is distinguished by fine detail alone.** Where two nodes are in the
 *     same chain the difference is a COUNT you can take in at a glance — two
 *     fingers against three, three belt loops against six, one servant against two,
 *     one blessing star against three. Counting survives being drawn at 19px;
 *     texture does not.
 *  2. **Every glyph has a fallback.** `MONOGRAM` is drawn instead below ~16px of
 *     radius, which no supported stage width reaches today but a 240px one would.
 *
 * Shape carries KIND, following Diablo 4's square-active / circular-upgrade split,
 * and `meta/tree.ts` already names the three kinds it has: "Capability, capacity and
 * persistence only." So the sky is sortable by category before any colour is
 * decoded, which is the channel ESO's constellations were missing.
 */
import type { NodeId } from '../meta/tree';
import { rr } from './hud';

const TAU = Math.PI * 2;

/** What kind of thing a node is. Decides the disc's outline, nothing else. */
export type NodeKind = 'capacity' | 'capability' | 'persistence';

/**
 * Exhaustive on purpose, exactly like `FAMILY`: a node added to `meta/tree.ts`
 * without a kind here is a build error rather than a disc that draws as a circle
 * because a lookup missed.
 */
export const KIND: Readonly<Record<NodeId, NodeKind>> = {
  // capacity — raises a ceiling
  hand2: 'capacity', hand3: 'capacity', belt3: 'capacity', belt6: 'capacity',
  slots4: 'capacity',
  // capability — a new thing you can do
  corpseRaising: 'capability', blessing: 'capability', blessingWider: 'capability',
  altarPages: 'capability',
  // persistence — survives a boundary
  golemKeep1: 'persistence', golemInfusion: 'persistence', golemKeep2: 'persistence',
};

/**
 * The word under the disc. One or two words, and never longer than the lattice
 * cell — `ui/tree.ts` shrinks the font if a narrow stage would clip one.
 *
 * A pictogram alone is a guessing game on first open, and every portrait game
 * surveyed (Archero, Survivor.io, Magic Survival) puts a label under its icon. The
 * pairs are deliberately parallel — HAND II / HAND III, SERVANT / SERVANT II — so
 * the label carries the chain even where the glyph is doing the work.
 */
export const NICK: Readonly<Record<NodeId, string>> = {
  hand2: 'HAND II', hand3: 'HAND III',
  belt3: 'BELT', belt6: 'DEEP BELT',
  corpseRaising: 'CORPSE',
  golemKeep1: 'SERVANT', golemInfusion: 'INFUSION', golemKeep2: 'SERVANT II',
  altarPages: 'ALTARS',
  blessing: 'BLESSING', blessingWider: 'DEEPER',
  slots4: '4TH BAND',
};

/** Two characters, for a disc too small to hold a drawing. Never normally seen. */
export const MONOGRAM: Readonly<Record<NodeId, string>> = {
  hand2: 'H2', hand3: 'H3', belt3: 'B3', belt6: 'B6',
  corpseRaising: 'CR', golemKeep1: 'G1', golemInfusion: 'GI', golemKeep2: 'G2',
  altarPages: 'AP', blessing: 'BL', blessingWider: 'BW', slots4: 'S4',
};

// ------------------------------------------------------------------- disc shapes

/**
 * A polygon with rounded corners, traced with `arcTo` from edge midpoints.
 *
 * Sharp vertices at this size read as rendering faults — a diamond's north point
 * turns into a single bright pixel and a hexagon's corners alias — so both
 * non-circular shapes are rounded by a fraction of their own radius.
 */
function roundPoly(
  ctx: CanvasRenderingContext2D, pts: readonly [number, number][], rad: number,
): void {
  const n = pts.length;
  const mid = (a: readonly [number, number], b: readonly [number, number]): [number, number] =>
    [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[n - 1], pts[0]);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const cur = pts[i], next = pts[(i + 1) % n];
    const m = mid(cur, next);
    ctx.arcTo(cur[0], cur[1], m[0], m[1], rad);
  }
  ctx.closePath();
}

/**
 * Path the disc for `kind`, centred on the origin, as a shape whose AREA is roughly
 * constant across the three.
 *
 * A hexagon inscribed in `r` covers 83% of the circle and a diamond only 64%, so
 * both are given a larger circumradius than the circle — otherwise the persistence
 * chain would read as three small nodes and the sky would look like it had a
 * hierarchy it does not have.
 */
export function shapePath(ctx: CanvasRenderingContext2D, kind: NodeKind, r: number): void {
  if (kind === 'capability') {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    return;
  }
  if (kind === 'capacity') {
    const R = r * 1.06;
    const pts: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      pts.push([Math.cos(a) * R, Math.sin(a) * R]);
    }
    roundPoly(ctx, pts, R * 0.22);
    return;
  }
  const R = r * 1.2;
  roundPoly(ctx, [[0, -R], [R, 0], [0, R], [-R, 0]], R * 0.26);
}

// ------------------------------------------------------------------ the glyphs

/**
 * One pictogram, centred on the origin and bounded by `[-s, s]` on both axes.
 * The caller has already set `fillStyle`, `strokeStyle`, `lineCap` and `lineJoin`.
 */
export type Icon = (ctx: CanvasRenderingContext2D, s: number) => void;

const line = (
  ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number,
): void => {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
};

/** A four-pointed star, the currency's own mark, used wherever a blessing is. */
function star4(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const w = r * 0.30;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + w, cy - w, cx + r, cy);
  ctx.quadraticCurveTo(cx + w, cy + w, cx, cy + r);
  ctx.quadraticCurveTo(cx - w, cy + w, cx - r, cy);
  ctx.quadraticCurveTo(cx - w, cy - w, cx, cy - r);
  ctx.closePath();
  ctx.fill();
}

/**
 * A hand of `n`, as a filled palm with `n` round-capped fingers standing off it.
 *
 * The FINGER COUNT is the whole glyph — the palm is only there to make the count
 * read as a hand rather than as tally marks — so the fingers get the thicker line
 * and the middle one is drawn tallest, which is what makes two-versus-three legible
 * at a glance instead of requiring a count.
 */
const hand = (n: number): Icon => (ctx, s) => {
  const lw = Math.max(1.4, s * 0.20);
  const pw = s * 1.26;
  // palm
  rr(ctx, -pw / 2, s * 0.24, pw, s * 0.70, s * 0.24);
  ctx.fill();
  // thumb, off the palm's left shoulder — it is what fixes the drawing as a HAND
  ctx.lineWidth = lw * 0.9;
  line(ctx, -pw / 2 + lw * 0.2, s * 0.62, -pw / 2 - s * 0.40, s * 0.14);
  // fingers
  ctx.lineWidth = lw * 1.25;
  const gap = (pw * 0.80) / n;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * gap;
    const tall = n === 2 ? (i === 0 ? 0.95 : 0.84) : i === 1 ? 0.95 : 0.82;
    line(ctx, x, s * 0.36, x, -s * tall);
  }
};

/**
 * A strap with loops on it. `rows` straps of three loops each, so the belt
 * upgrade is literally 3 loops against 6 rather than a subtly different buckle.
 */
const belt = (rows: number): Icon => (ctx, s) => {
  ctx.lineWidth = Math.max(1.1, s * 0.13);
  const w = s * 1.90;
  const ys = rows === 1 ? [0] : [-s * 0.52, s * 0.52];
  const strapH = rows === 1 ? s * 0.26 : s * 0.22;
  const loopH = rows === 1 ? s * 0.92 : s * 0.64;
  for (const y of ys) {
    rr(ctx, -w / 2, y - strapH / 2, w, strapH, strapH / 2);
    ctx.stroke();
    // Three loops, laid out clear of the buckle and clear of each other, and squarer
    // than the strap so they read as leather rather than as beads. The loops are what
    // the player is buying, so they have to be COUNTABLE — three against six is the
    // whole difference between this glyph and the deep belt's.
    for (let i = 0; i < 3; i++) {
      const x = -s * 0.14 + i * s * 0.44;
      rr(ctx, x - s * 0.13, y - loopH / 2, s * 0.26, loopH, s * 0.05);
      ctx.stroke();
    }
    // the buckle end, so a strap has a direction and is not a ladder
    const bs = strapH * 1.6;
    rr(ctx, -w / 2, y - bs / 2, bs, bs, s * 0.06);
    ctx.stroke();
  }
};

/**
 * A skull.
 *
 * This started as a literal coffin and read as a coffee cup at 30px — the silhouette
 * of a coffin is a tapered box, and a tapered box is every other tapered box. A skull
 * has two filled eye sockets, which nothing else in this set has, so it survives
 * being small in a way an outline never does.
 */
const skull: Icon = (ctx, s) => {
  ctx.lineWidth = Math.max(1.2, s * 0.14);
  // cranium
  rr(ctx, -s * 0.54, -s * 0.78, s * 1.08, s * 0.98, s * 0.46);
  ctx.stroke();
  // jaw
  rr(ctx, -s * 0.30, s * 0.14, s * 0.60, s * 0.50, s * 0.12);
  ctx.stroke();
  // the sockets, filled — the mark that makes it a skull and not a helmet
  for (const x of [-s * 0.24, s * 0.24]) {
    ctx.beginPath();
    ctx.arc(x, -s * 0.28, s * 0.155, 0, TAU);
    ctx.fill();
  }
  // nose
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.06);
  ctx.lineTo(s * 0.09, s * 0.08);
  ctx.lineTo(-s * 0.09, s * 0.08);
  ctx.closePath();
  ctx.fill();
  // two teeth, so the jaw is a jaw
  ctx.lineWidth = Math.max(1, s * 0.09);
  for (const x of [-s * 0.10, s * 0.10]) line(ctx, x, s * 0.18, x, s * 0.60);
};

/**
 * A blocky servant. `cx` offsets it so two can stand side by side, `k` scales it
 * so that pair still fits the same box.
 */
function figure(ctx: CanvasRenderingContext2D, s: number, cx: number, k: number): void {
  const u = s * k;
  rr(ctx, cx - u * 0.25, -u * 0.92, u * 0.50, u * 0.44, u * 0.12);
  ctx.stroke();
  rr(ctx, cx - u * 0.34, -u * 0.36, u * 0.68, u * 0.74, u * 0.14);
  ctx.stroke();
  line(ctx, cx - u * 0.36, -u * 0.22, cx - u * 0.66, u * 0.22);
  line(ctx, cx + u * 0.36, -u * 0.22, cx + u * 0.66, u * 0.22);
  line(ctx, cx - u * 0.17, u * 0.40, cx - u * 0.22, u * 0.92);
  line(ctx, cx + u * 0.17, u * 0.40, cx + u * 0.22, u * 0.92);
}

/** One servant, with the binding across its chest. */
const servant: Icon = (ctx, s) => {
  ctx.lineWidth = Math.max(1.2, s * 0.13);
  figure(ctx, s, 0, 1);
  // the binding: a band across the chest with two links on it, kept INSIDE the
  // body so it cannot be misread as a pair of folded arms
  ctx.lineWidth = Math.max(1, s * 0.10);
  line(ctx, -s * 0.34, s * 0.02, s * 0.34, s * 0.02);
  for (const x of [-s * 0.15, s * 0.15]) {
    ctx.beginPath();
    ctx.arc(x, s * 0.02, s * 0.09, 0, TAU);
    ctx.stroke();
  }
};

/** A servant with something burning in it that does not go out. */
const infusion: Icon = (ctx, s) => {
  ctx.lineWidth = Math.max(1.2, s * 0.13);
  figure(ctx, s, 0, 1);
  // the core, filled — the only solid mark in the golem set
  const c = s * 0.24;
  ctx.beginPath();
  ctx.moveTo(0, -c);
  ctx.lineTo(c * 0.78, 0);
  ctx.lineTo(0, c);
  ctx.lineTo(-c * 0.78, 0);
  ctx.closePath();
  ctx.fill();
  // and its rays
  ctx.lineWidth = Math.max(1, s * 0.09);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    line(ctx, dx * s * 0.30, dy * s * 0.30, dx * s * 0.52, dy * s * 0.52);
  }
};

/** Two servants: the near one solid-lined, the far one behind and thinner. */
const servants2: Icon = (ctx, s) => {
  ctx.lineWidth = Math.max(1, s * 0.10);
  ctx.globalAlpha *= 0.62;
  figure(ctx, s, s * 0.40, 0.80);
  ctx.globalAlpha /= 0.62;
  ctx.lineWidth = Math.max(1.2, s * 0.13);
  figure(ctx, s, -s * 0.26, 0.86);
};

/**
 * An altar slab with three pages standing on it, fanned.
 *
 * The pages are rotated about the point where they MEET THE SLAB, which is what
 * makes it read as a fan of offers rather than as a crown — an earlier version
 * rotated them about their centres and the result was a five-point coronet.
 */
const altar: Icon = (ctx, s) => {
  // the slab, solid: it is the ground the offers stand on
  rr(ctx, -s * 0.86, s * 0.42, s * 1.72, s * 0.28, s * 0.07);
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.11);
  // Wide enough to be pages. Narrower and they read as candles, which is the wrong
  // altar entirely — this node widens the POOL OF PAGES an altar offers from.
  for (const [dx, a] of [[-0.32, -0.30], [0, 0], [0.32, 0.30]] as const) {
    ctx.save();
    ctx.translate(s * dx, s * 0.40);
    ctx.rotate(a);
    rr(ctx, -s * 0.18, -s * 1.18, s * 0.36, s * 1.18, s * 0.04);
    ctx.stroke();
    ctx.restore();
  }
};

/**
 * The dungeon mouth, with the blessings you are offered in it. `n` stars, so one
 * blessing and three read apart by counting.
 */
const mouth = (n: number): Icon => (ctx, s) => {
  ctx.lineWidth = Math.max(1.2, s * 0.14);
  const half = n === 1 ? s * 0.52 : s * 0.70;
  ctx.beginPath();
  ctx.moveTo(-half, s * 0.94);
  ctx.lineTo(-half, -s * 0.16);
  ctx.arc(0, -s * 0.16, half, Math.PI, 0);
  ctx.lineTo(half, s * 0.94);
  ctx.stroke();
  // the threshold, so the arch is a doorway and not a horseshoe
  line(ctx, -half - s * 0.16, s * 0.94, half + s * 0.16, s * 0.94);
  if (n === 1) star4(ctx, 0, -s * 0.14, s * 0.34);
  else {
    star4(ctx, 0, -s * 0.34, s * 0.24);
    star4(ctx, -s * 0.36, s * 0.20, s * 0.21);
    star4(ctx, s * 0.36, s * 0.20, s * 0.21);
  }
};

/** The starting book, bound with four bands — the fourth one picked out. */
const binding: Icon = (ctx, s) => {
  ctx.lineWidth = Math.max(1.2, s * 0.13);
  rr(ctx, -s * 0.56, -s * 0.88, s * 1.12, s * 1.76, s * 0.12);
  ctx.stroke();
  // the spine
  line(ctx, -s * 0.24, -s * 0.88, -s * 0.24, s * 0.88);
  ctx.lineWidth = Math.max(1, s * 0.11);
  const ys = [-s * 0.54, -s * 0.18, s * 0.18, s * 0.54];
  ys.forEach((y, i) => {
    // The fourth band is the one this node buys, so it is the solid one and the
    // other three are the book you already have.
    if (i === 3) {
      ctx.fillRect(-s * 0.58, y - s * 0.09, s * 0.42, s * 0.18);
    } else line(ctx, -s * 0.56, y, -s * 0.18, y);
  });
};

/**
 * Every node's drawing. Exhaustive, so an unglyphed node cannot ship: the sky is
 * only ever as good as its worst icon, and a missing one would silently fall back
 * to a monogram nobody reviewed.
 */
export const ICON: Readonly<Record<NodeId, Icon>> = {
  hand2: hand(2),
  hand3: hand(3),
  belt3: belt(1),
  belt6: belt(2),
  corpseRaising: skull,
  golemKeep1: servant,
  golemInfusion: infusion,
  golemKeep2: servants2,
  altarPages: altar,
  blessing: mouth(1),
  blessingWider: mouth(3),
  slots4: binding,
};

/**
 * Draw node `id`'s pictogram at `(cx, cy)`, sized to a disc of radius `r`.
 *
 * Below `r = 16` the glyph is replaced by its monogram — a bad drawing is worse
 * than a word, and at that size every one of these becomes a smudge. No stage the
 * engine's aspect clamp can produce gets there today.
 */
export function drawIcon(
  ctx: CanvasRenderingContext2D, id: NodeId, cx: number, cy: number, r: number, colour: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (r < 16) {
    ctx.font = `bold ${Math.round(r * 0.92)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(MONOGRAM[id], 0, r * 0.06);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  } else {
    ICON[id](ctx, r * 0.60);
  }
  ctx.restore();
}
