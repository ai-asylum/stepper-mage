/**
 * The twelve star-tree pictograms, and the three disc shapes they sit in.
 *
 * Its own file because this is ART, not layout: `ui/tree.ts` decides where a node
 * goes and what state it is in, and asks here for the drawing.
 *
 * THE MARKS ARE PIXEL ART. Every one is authored through `art/pixel.ts`'s `Pix` on a
 * fixed 16x16 grid and blitted at an INTEGER device-pixel scale with smoothing off,
 * the same "draw small, hit big" rule the world follows at 144px per unit. They used
 * to be bezier paths rendered crisp at device resolution, which put smooth vector
 * curves on the same screen as a quantised pixel-art dungeon — one decision applied
 * where it did not belong, since the reason the overlay is crisp is PAGE TEXT and an
 * icon is not text. The disc, its rim, the gauge arc and the nickname are still
 * drawn by `tree.ts` as vectors; those are chrome and state, not art.
 *
 * Why 16x16. The disc measures ~49px across at 390x844 and ~36px at a 295px stage,
 * so the mark wants ~1.3x the disc radius: 16px source lands on a 4x blit on the wide
 * stage and 3x on the narrow one at dpr 2, which keeps the drawn size within 2% of
 * the same fraction of the disc at both. A smaller grid could not hold six countable
 * belt loops; a larger one would make the scale step coarser, not finer.
 *
 * The mask is authored in WHITE at two alpha levels and colourised on the way into
 * the cache, so `tree.ts` keeps handing in one CSS colour and the three channels stay
 * orthogonal — shape is kind, colour is chain, ring geometry is state, and the mark
 * inside the disc never touches any of them. The second alpha level is the only
 * shading a monochrome mark can have and still be one hue, which is this game's
 * ramp discipline applied to a one-colour sprite.
 *
 * Two rules the whole set follows, and both come from Loop Hero's camp being
 * criticised as "a muddy blur" of small similar icons:
 *
 *  1. **Nothing is distinguished by fine detail alone.** Where two nodes are in the
 *     same chain the difference is a COUNT you can take in at a glance — two
 *     fingers against three, three belt loops against six, one servant against two,
 *     one blessing star against three. A pixel grid makes that rule sharper, not
 *     looser: at 16px a count is the only detail that survives at all.
 *  2. **Every glyph has a fallback.** `MONOGRAM` is drawn instead below ~16px of
 *     radius, which no supported stage width reaches today but a 240px one would.
 *
 * Shape carries KIND, following Diablo 4's square-active / circular-upgrade split,
 * and `meta/tree.ts` already names the three kinds it has: "Capability, capacity and
 * persistence only." So the sky is sortable by category before any colour is
 * decoded, which is the channel ESO's constellations were missing.
 */
import { Pix, TRANSPARENT, rgba, type Col } from '../art/pixel';
import type { NodeId } from '../meta/tree';

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
  // Not capacity: it raises no ceiling, it tells you something.
  chart: 'capability',
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
  chart: 'CHART',
};

/** Two characters, for a disc too small to hold a drawing. Never normally seen. */
export const MONOGRAM: Readonly<Record<NodeId, string>> = {
  hand2: 'H2', hand3: 'H3', belt3: 'B3', belt6: 'B6',
  corpseRaising: 'CR', golemKeep1: 'G1', golemInfusion: 'GI', golemKeep2: 'G2',
  altarPages: 'AP', blessing: 'BL', blessingWider: 'BW', slots4: 'S4',
  chart: 'CH',
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

// ------------------------------------------------------------------ the marks

/** The grid every mark is authored on. See the file header for why it is 16. */
const SRC = 16;

/**
 * The two tones. `SOLID` is the mark; `SHADE` is the part of it that is context —
 * a palm behind its fingers, a strap behind its loops, the slab under the pages.
 * Alpha rather than a second hue, so the FAMILY colour stays the only colour.
 */
const SOLID: Col = rgba(255, 255, 255, 255);
const SHADE: Col = rgba(255, 255, 255, 165);

/**
 * Every write is `mode: 'set'`, never 'over'.
 *
 * The mask is white-on-white and differs only in alpha, so alpha-blending a shade
 * over a solid would produce the solid again. Painting order, not compositing, is
 * what layers these marks — and it is what lets a hole be punched through a filled
 * silhouette, which is how the skull gets its sockets and the golem its core.
 */
const SET = { mode: 'set' } as const;

const box = (p: Pix, x: number, y: number, w: number, h: number, c: Col): void => {
  p.rect(x, y, w, h, c, SET);
};

/** Punch back to transparent — the disc behind shows through. */
const cut = (p: Pix, x: number, y: number, w: number, h: number): void => {
  p.rect(x, y, w, h, TRANSPARENT, SET);
};

/** Spans, as inclusive `[x0, x1]` pairs per row — for a silhouette with no rectangle
 *  in it, where a row table is easier to read and to correct than nested shapes. */
type Rows = readonly (readonly [number, readonly [number, number][]])[];
const rows = (p: Pix, r: Rows, c: Col): void => {
  for (const [y, spans] of r) for (const [a, b] of spans) box(p, a, y, b - a + 1, 1, c);
};

/**
 * A four-pointed sparkle, the currency's own mark, used wherever a blessing is.
 *
 * Concave on purpose: `r - |dy|` would draw a diamond, and this set already has a
 * diamond (the golem's core). The 1.9 exponent is the flattest curve that still
 * pinches the waist — a linear taper is a diamond and a halved one is a thin plus,
 * and a plus is a crucifix, which is the wrong word entirely on a screen that also
 * carries a skull. Below r = 3 there is no sparkle to be had at any exponent, which
 * is why the three-blessing mark uses r = 3 and not something smaller.
 */
function star(p: Pix, cx: number, cy: number, r: number, c: Col): void {
  for (let dy = -r; dy <= r; dy++) {
    const t = 1 - Math.abs(dy) / r;
    const half = dy === 0 ? r : Math.max(0, Math.floor(r * Math.pow(t, 1.9)));
    box(p, cx - half, cy + dy, half * 2 + 1, 1, c);
  }
}

/** One pictogram, drawn into a fresh `SRC x SRC` buffer. */
type Mark = (p: Pix) => void;

/**
 * A hand of `n`, as a shaded palm with `n` solid fingers standing off it.
 *
 * The FINGER COUNT is the whole glyph — the palm is only there to make the count
 * read as a hand rather than as tally marks — so the fingers get the solid tone and
 * the tallest one is picked out, which is what makes two-versus-three legible at a
 * glance instead of requiring a count. Two fingers leave a two-pixel gutter up the
 * middle of the palm and three fill it, so the pair differs in silhouette and not
 * only in arithmetic.
 */
const hand = (n: number): Mark => (p) => {
  box(p, 4, 9, 8, 6, SHADE);          // palm
  cut(p, 4, 14, 1, 1); cut(p, 11, 14, 1, 1);
  // the thumb, off the palm's left shoulder — it is what fixes the drawing as a HAND
  box(p, 2, 10, 2, 2, SOLID);
  box(p, 1, 11, 2, 2, SOLID);
  const xs = n === 2 ? [5, 9] : [4, 7, 10];
  const tops = n === 2 ? [2, 4] : [3, 2, 4];
  xs.forEach((x, i) => box(p, x, tops[i], 2, 10 - tops[i], SOLID));
};

/**
 * A strap with loops on it. `straps` lanes of three loops each, so the belt upgrade
 * is literally 3 loops against 6 rather than a subtly different buckle.
 *
 * The strap is shaded and the loops solid, because the loops are what the player is
 * buying and a same-tone loop crossing a same-tone strap is one blob. The buckle end
 * gives the strap a direction so it is not read as a ladder.
 */
const belt = (straps: number): Mark => (p) => {
  const lanes = straps === 1
    ? [{ sy: 6, sh: 4, ly: 3, lh: 10, bh: 8 }]
    : [{ sy: 3, sh: 3, ly: 1, lh: 7, bh: 7 }, { sy: 11, sh: 3, ly: 9, lh: 7, bh: 7 }];
  for (const l of lanes) {
    box(p, 0, l.sy, 16, l.sh, SHADE);
    for (const x of [6, 9, 12]) box(p, x, l.ly, 2, l.lh, SOLID);
    // the buckle, as a frame so the strap threads through it
    const by = l.sy + l.sh / 2 - l.bh / 2;
    box(p, 0, by, 5, l.bh, SOLID);
    cut(p, 1, by + 1, 3, l.bh - 2);
    box(p, 2, by + 1, 1, l.bh - 2, SOLID);   // the pin
  }
};

/**
 * A skull, drawn as a filled silhouette with its sockets PUNCHED OUT.
 *
 * This started as a literal coffin and read as a coffee cup at 30px — the silhouette
 * of a coffin is a tapered box, and a tapered box is every other tapered box. Two
 * holes in a filled dome is a mark nothing else in this set has, and a hole survives
 * being small in a way an outline never does: the sockets are 3x2 source pixels, so
 * they are 9x6 real ones even on the narrow stage.
 */
const skull: Mark = (p) => {
  rows(p, [
    [2, [[5, 10]]], [3, [[4, 11]]],
    [4, [[3, 12]]], [5, [[3, 12]]], [6, [[3, 12]]], [7, [[3, 12]]], [8, [[3, 12]]],
    [9, [[4, 11]]],
    [10, [[5, 10]]], [11, [[5, 10]]], [12, [[6, 9]]],
  ], SOLID);
  cut(p, 4, 5, 3, 2); cut(p, 9, 5, 3, 2);   // the sockets
  cut(p, 7, 8, 2, 1);                        // the nose
  cut(p, 6, 10, 1, 2); cut(p, 8, 10, 1, 2);  // and the teeth between them
};

/** The blocky servant every persistence mark is built from. */
function figure(p: Pix, c: Col): void {
  box(p, 6, 1, 4, 3, c);      // head
  box(p, 7, 4, 2, 1, SHADE);  // neck
  box(p, 4, 5, 8, 7, c);      // body
  box(p, 2, 6, 2, 5, c); box(p, 12, 6, 2, 5, c);   // arms
  box(p, 5, 12, 2, 3, c); box(p, 9, 12, 2, 3, c);  // legs
}

/** One servant, with the binding across its chest. */
const servant: Mark = (p) => {
  figure(p, SOLID);
  // The binding: a band across the chest with two links picked out of it, kept
  // INSIDE the body so it cannot be misread as a pair of folded arms.
  box(p, 4, 7, 8, 2, SHADE);
  box(p, 6, 7, 1, 2, SOLID); box(p, 9, 7, 1, 2, SOLID);
};

/**
 * A servant with something burning in it that does not go out.
 *
 * The core is a diamond HOLE with a lit block inside it, which is the only isolated
 * island in the whole set — nothing else reads as a thing sitting in a socket.
 */
const infusion: Mark = (p) => {
  figure(p, SOLID);
  rows(p, [[6, [[7, 8]]], [7, [[6, 9]]], [8, [[5, 10]]], [9, [[6, 9]]], [10, [[7, 8]]]],
    TRANSPARENT);
  box(p, 7, 7, 2, 2, SOLID);
};

/**
 * Two servants, the second standing behind in the shaded tone. TWO HEADS is the
 * whole difference from `servant`, and it is a count, not a detail.
 */
const servants2: Mark = (p) => {
  // behind, and half a step back so the pair does not read as one wide figure
  box(p, 10, 2, 3, 2, SHADE);
  box(p, 9, 5, 5, 5, SHADE);
  box(p, 8, 6, 1, 3, SHADE); box(p, 14, 6, 1, 3, SHADE);
  box(p, 9, 10, 2, 3, SHADE); box(p, 12, 10, 2, 3, SHADE);
  // in front
  box(p, 2, 3, 3, 2, SOLID);
  box(p, 1, 6, 5, 5, SOLID);
  box(p, 0, 7, 1, 3, SOLID); box(p, 6, 7, 1, 3, SOLID);
  box(p, 1, 11, 2, 3, SOLID); box(p, 4, 11, 2, 3, SOLID);
};

/**
 * A slab with three pages FANNED across it, offset up and to the right.
 *
 * Third attempt, and the two failures are worth keeping written down because both
 * were the same mistake — building the mark out of three separate uprights:
 *
 *  - Three bars rooted in a slab with their tops splayed outward is a CROWN, which is
 *    what the vector version was accused of and what the first pixel version
 *    reproduced. Anchoring them at the slab does not help; the air between them is
 *    the coronet.
 *  - Overlapping them and clipping their corners removed the crown and produced a
 *    SUITCASE: three lidded boxes sharing a base plate is a case with a handle.
 *
 * What works is one offset direction. A stepped fan is the motif every card game
 * uses for "a hand of several", the front page is drawn whole and the two behind show
 * three pixels of edge each, and no arrangement of a briefcase is diagonal. Ruled
 * lines on the front page, because this node widens the POOL OF PAGES an altar offers
 * from and the thing being counted has to look like something with writing on it.
 */
const altar: Mark = (p) => {
  const page = (x: number, y: number): void => {
    box(p, x, y, 8, 9, SHADE);
    p.frame(x, y, 8, 9, SOLID, SET);
  };
  page(7, 1); page(4, 3); page(1, 5);
  box(p, 2, 8, 6, 1, SOLID); box(p, 2, 10, 6, 1, SOLID);
  box(p, 0, 14, 16, 2, SOLID);   // the slab, solid: it is what the offers lie on
};

/**
 * The blessings you are offered at the dungeon mouth: `n` sparkles over a threshold.
 *
 * NO CONTAINER, and that is the whole finding. The vector version drew an arch with
 * the stars inside it, and quantised, an arch over a plinth is a GRAVESTONE — with a
 * skull two nodes away, the sky was telling the same lie in two colours. Rebuilding
 * the arch as a flat-lintel gateway killed the gravestone and produced a framed plus
 * sign instead, because the walls left a ten-pixel opening and a sparkle needs
 * thirteen before its waist pinches. There is no room for both a frame and a star at
 * 16px, so the frame lost: the disc is already a container, and the two-pixel
 * threshold is all the dungeon mouth this mark needs to stand on.
 *
 * One thirteen-pixel sparkle against three seven-pixel ones. Both the count and the
 * size carry the pair, so it reads before it is counted.
 */
const mouth = (n: number): Mark => (p) => {
  box(p, 0, 14, 16, 2, SHADE);   // the threshold you cross to be offered them
  if (n === 1) { star(p, 7, 7, 6, SOLID); return; }
  star(p, 7, 3, 3, SOLID);
  star(p, 3, 10, 3, SOLID);
  star(p, 11, 10, 3, SOLID);
};

/**
 * The starting book, bound with four bands — the fourth one picked out.
 *
 * The bands run PAST the cover's edge, so they are hardware on the spine rather than
 * lines ruled on the front, and the fourth is twice as thick because it is the one
 * this node buys. Four countable bands, and the count is the mark.
 */
const binding: Mark = (p) => {
  box(p, 4, 1, 9, 14, SHADE);
  p.frame(4, 1, 9, 14, SOLID, SET);
  box(p, 6, 2, 1, 12, SOLID);                      // the spine
  for (const y of [3, 6, 9]) box(p, 2, y, 7, 1, SOLID);
  box(p, 2, 11, 8, 2, SOLID);                      // the fourth
};

/**
 * Every node's drawing. Exhaustive, so an unglyphed node cannot ship: the sky is
 * only ever as good as its worst icon, and a missing one would silently fall back
 * to a monogram nobody reviewed.
 */
/**
 * THE CHART: a folded sheet with a pin stuck in it.
 *
 * A map alone would read as any other rectangle at 16px, and the thing this node
 * actually sells is the MARK — so the pin is the loud half: two pixels of head above
 * the sheet and a shaft down into it. The fold lines are shade, because they are what
 * makes the rectangle a map rather than a door.
 */
const chart: Mark = (p) => {
  box(p, 2, 3, 12, 10, SHADE);          // the sheet
  box(p, 2, 3, 12, 1, SOLID);           // its top edge, so it reads as paper not a hole
  box(p, 2, 12, 12, 1, SOLID);
  // The two folds. Vertical, evenly spaced: a sheet that has been in a pocket.
  box(p, 6, 4, 1, 8, SOLID);
  box(p, 10, 4, 1, 8, SOLID);
  // The pin, punched clean through the sheet so the head sits on top of it.
  cut(p, 8, 1, 3, 3);
  box(p, 8, 1, 3, 3, SOLID);
  box(p, 9, 4, 1, 6, SOLID);
};

const MARK: Readonly<Record<NodeId, Mark>> = {
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
  chart,
};

// ------------------------------------------------------------------- the cache

/**
 * Rasterised marks, keyed by node and CSS colour.
 *
 * Twelve `Pix` renders a frame would be absurd — this screen redraws every frame for
 * the breath and the route spark. The mask is built once per node and the colourised
 * copy once per (node, colour); `tree.ts` picks its colour from twelve families times
 * four states, so the map tops out at 48 sixteen-pixel canvases and then never grows.
 */
const MASKS = new Map<NodeId, HTMLCanvasElement>();
const TINTED = new Map<string, HTMLCanvasElement>();

function mask(id: NodeId): HTMLCanvasElement {
  let cv = MASKS.get(id);
  if (!cv) {
    const p = new Pix(SRC, SRC);
    MARK[id](p);
    cv = p.toCanvas();
    MASKS.set(id, cv);
  }
  return cv;
}

/**
 * The mark in `colour`, alpha included.
 *
 * `source-in` multiplies the fill's alpha by the mask's, which is exactly what the
 * two-tone mask wants: a shaded pixel stays proportionally shaded at every state's
 * opacity, so a locked node's palm does not go opaque while its fingers fade.
 */
function tinted(id: NodeId, colour: string): HTMLCanvasElement {
  const key = `${id}|${colour}`;
  let cv = TINTED.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = SRC; cv.height = SRC;
    const c = cv.getContext('2d')!;
    c.drawImage(mask(id), 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = colour;
    c.fillRect(0, 0, SRC, SRC);
    TINTED.set(key, cv);
  }
  return cv;
}

/**
 * How much of the disc the mark covers, as a multiple of the disc RADIUS.
 *
 * 1.3 rather than the 1.2 the vector set used, because a pixel mark has no
 * antialiased taper to soften its edge and reads slightly smaller than its bounding
 * box. Still inside the diamond's inscribed square (0.85r half-extent at a 1.2r
 * circumradius), so the persistence chain does not clip.
 */
const SPAN = 1.3;

/** Below this radius a drawing is worse than a word. */
const MIN_R = 16;

/**
 * Draw node `id`'s pictogram at `(cx, cy)`, sized to a disc of radius `r`.
 *
 * The blit deliberately drops out of the canvas transform and works in DEVICE
 * pixels: the source is placed on a whole-pixel origin at a whole-number scale, so
 * every source pixel becomes an exact k-by-k block whatever the stage width or the
 * device ratio. Drawing it through the dpr transform instead would land the mark on
 * a fractional boundary and the browser would blend the edges — which is the vector
 * softness this whole pass exists to remove. `globalAlpha` is part of the context
 * state and survives, so `tree.ts`'s route dimming still applies.
 *
 * Below `r = 16` the mark is replaced by its monogram — at that size every one of
 * these becomes a smudge, and no stage the engine's aspect clamp can produce gets
 * there today.
 */
export function drawIcon(
  ctx: CanvasRenderingContext2D, id: NodeId, cx: number, cy: number, r: number, colour: string,
): void {
  if (r < MIN_R) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = colour;
    ctx.font = `bold ${Math.round(r * 0.92)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(MONOGRAM[id], 0, r * 0.06);
    ctx.restore();
    return;
  }
  const m = ctx.getTransform();
  const k = Math.max(1, Math.round((r * SPAN * (m.a || 1)) / SRC));
  const size = SRC * k;
  const dx = Math.round(m.a * cx + m.c * cy + m.e - size / 2);
  const dy = Math.round(m.b * cx + m.d * cy + m.f - size / 2);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tinted(id, colour), dx, dy, size, size);
  ctx.restore();
}
