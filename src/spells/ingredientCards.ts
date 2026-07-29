/**
 * The card an ingredient arrives in your hand on.
 *
 * Exactly the route a harvested element takes (`harvestCards.ts`), and for exactly
 * the same reason: the `Fan` holds `SpellDef`s from the book, `src/book/` is ported
 * near-verbatim and must not be restructured, so a component with no page gets a
 * page-SHAPED def with its own sigil id and its own colour triad and the fan cannot
 * tell the difference. Nothing else in the book ever sees these — they are not in
 * `pages.ts`'s `ORDER`, so no chapter tab, no page, no rank.
 *
 * What makes an ingredient card visibly not a page, and visibly not a harvest
 * either — the hand can hold all three at once, so three readings have to survive at
 * card size:
 *  - the HALO. A torn page wears the book's gold; `main.ts` recolours a borrowed
 *    card's to the ingredient's own, as it does for a harvest.
 *  - the BINDING. A harvest card gets a hard double frame in the element's colour.
 *    An ingredient gets a soft STRAP instead — two horizontal bands top and bottom,
 *    which is the belt itself, and reads as a bundle rather than as a page.
 *  - the STAMP. "FROM THE BELT · CONSUMED", against the harvest's "FROM THE ROOM ·
 *    RANK 1". The one thing a player must know before spending a hand slot on it is
 *    that this one does not come back.
 *
 * Registered from HERE rather than from `pages.ts`, because `book/pageTexture.ts`
 * imports `pages.ts` and touching `SIGILS` from there is a module cycle.
 */
import { SIGILS, type SigilFn } from '../book/pageTexture';
import { colorsOf, type SpellDef } from './pages';
import { INGREDIENT_SPELLS, SPELL_BY_ID } from './spells';

/** The page canvas is 512x660 (`book/pageTexture.ts`). */
const W = 512;
const H = 660;

/** A living stroke weight, so a mark drawn here sits in the book's ink language. */
function stroke(
  ctx: CanvasRenderingContext2D, pts: [number, number][], width: number, colour: string,
): void {
  ctx.strokeStyle = colour;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < pts.length - 1; i++) {
    const t = i / Math.max(1, pts.length - 1);
    ctx.lineWidth = Math.max(0.7, width * (1 + Math.sin(t * 9 + width) * 0.22));
    ctx.beginPath();
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
    ctx.stroke();
  }
}

/**
 * Coffin Moss: a lid, ajar, with the growth coming out of the gap.
 *
 * Drawn as the coffin and not as a plant on purpose — the ingredient is named for
 * where it grows, and a generic sprig would be indistinguishable from Growth's at
 * the size the hand is actually drawn.
 */
const markMoss: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  // the box, tapered like a coffin
  ctx.fillStyle = c.deep;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.34, cy - r * 0.5);
  ctx.lineTo(cx + r * 0.34, cy - r * 0.5);
  ctx.lineTo(cx + r * 0.24, cy + r * 0.86);
  ctx.lineTo(cx - r * 0.24, cy + r * 0.86);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  stroke(ctx, [
    [cx - r * 0.34, cy - r * 0.5], [cx + r * 0.34, cy - r * 0.5],
    [cx + r * 0.24, cy + r * 0.86], [cx - r * 0.24, cy + r * 0.86],
    [cx - r * 0.34, cy - r * 0.5],
  ], 3.2, c.main);
  // the lid, pushed aside
  ctx.save();
  ctx.fillStyle = c.main;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.44, cy - r * 0.62);
  ctx.lineTo(cx + r * 0.2, cy - r * 0.74);
  ctx.lineTo(cx + r * 0.24, cy - r * 0.56);
  ctx.lineTo(cx - r * 0.4, cy - r * 0.44);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // moss out of the gap, uneven so it reads as growth and not as a fringe
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 22;
  for (const [x, len, bend] of [
    [-0.2, 0.5, -0.16], [-0.02, 0.66, 0.05], [0.16, 0.44, 0.18], [0.3, 0.3, 0.26],
  ] as const) {
    stroke(ctx, [
      [cx + r * x, cy - r * 0.5],
      [cx + r * (x + bend * 0.5), cy - r * (0.5 + len * 0.55)],
      [cx + r * (x + bend), cy - r * (0.5 + len)],
    ], 3.6, c.glow);
  }
  ctx.fillStyle = c.glow;
  for (const [x, y] of [[-0.24, -1.0], [0.06, -1.2], [0.28, -0.86]] as const) {
    ctx.beginPath();
    ctx.arc(cx + r * x, cy + r * y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

/** TimeSand: the glass, most of it already through, and grains still falling. */
const markSand: SigilFn = (ctx, cx, cy, r, c) => {
  const w = r * 0.46, h = r * 0.8;
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 20;
  ctx.fillStyle = c.main;
  // the lower bulb, heaped — the hour already spent
  ctx.beginPath();
  ctx.moveTo(cx, cy + h * 0.1);
  ctx.lineTo(cx + w * 0.86, cy + h);
  ctx.lineTo(cx - w * 0.86, cy + h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.45;
  // the upper bulb, nearly empty
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 0.1);
  ctx.lineTo(cx + w * 0.34, cy - h * 0.5);
  ctx.lineTo(cx - w * 0.34, cy - h * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // the frame
  stroke(ctx, [[cx - w, cy - h * 1.14], [cx + w, cy - h * 1.14]], 5, c.deep);
  stroke(ctx, [[cx - w, cy + h * 1.14], [cx + w, cy + h * 1.14]], 5, c.deep);
  for (const s of [-1, 1]) {
    stroke(ctx, [
      [cx + s * w * 0.92, cy - h * 1.1],
      [cx + s * w * 0.1, cy],
      [cx + s * w * 0.92, cy + h * 1.1],
    ], 3.4, c.deep);
  }
  // the thread of sand still running
  ctx.save();
  ctx.fillStyle = c.glow;
  for (const y of [-0.24, 0, 0.26, 0.52]) {
    ctx.beginPath();
    ctx.arc(cx, cy + h * y, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

/**
 * The belt treatment: a strap across the card and a stamp saying what it is.
 *
 * A strap rather than the harvest card's frame, because the hand can hold both at
 * once and two rectangular borders in two colours read as the same card twice. The
 * strap is positioned off the canvas and the stamp off the sigil ring, for the reason
 * `harvestFace` gives: the two page faces call a sigil at different centres.
 */
function beltFace(mark: SigilFn): SigilFn {
  return (ctx, cx, cy, r, c) => {
    ctx.save();
    // two leather bands, top and bottom — the strip the pouch hangs from
    for (const y of [104, H - 134]) {
      ctx.fillStyle = c.deep;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(38, y, W - 76, 30);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.main;
      ctx.lineWidth = 2;
      ctx.strokeRect(38, y, W - 76, 30);
      // the brass, catching light, three to a band
      ctx.fillStyle = c.glow;
      for (const x of [0.24, 0.5, 0.76]) {
        ctx.beginPath();
        ctx.arc(38 + (W - 76) * x, y + 15, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    mark(ctx, cx, cy, r, c);

    // The one thing that must be read before a hand slot is spent on it.
    const label = 'FROM THE BELT · CONSUMED';
    ctx.save();
    ctx.font = 'bold 19px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const w = ctx.measureText(label).width + 34;
    const y = cy + r * 1.55;
    ctx.fillStyle = c.deep;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(cx - w / 2, y, w, 30);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.main;
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - w / 2, y, w, 30);
    ctx.fillStyle = '#fff4dc';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, y + 16);
    ctx.restore();
  };
}

/**
 * Marks by ingredient id.
 *
 * Animate, Growth and Multishot reuse the book's own `summon`, `growth` and
 * `multishot` sigils — they were drawn for these three when all three were pages,
 * and there is no second Growth to tell one apart from. Coffin Moss and TimeSand are
 * new to the game and get new marks.
 */
const MARKS: Record<string, SigilFn> = {
  animate: SIGILS.summon,
  moss: markMoss,
  grow: SIGILS.growth,
  split: SIGILS.multishot,
  sand: markSand,
};

/**
 * One card per ingredient, keyed by the id the hand actually holds.
 *
 * The sigil `id` is prefixed, load-bearing twice over exactly as in
 * `harvestCards.ts`: `pageArt` caches art by it, so sharing `summon` outright would
 * hand every ingredient the same face, and `SIGILS` is keyed by it, so the prefix is
 * what keeps the belt treatment off the sigils it borrows.
 */
export const INGREDIENT_CARDS: Record<string, SpellDef> = {};
for (const s of INGREDIENT_SPELLS) {
  const id = `belt-${s.id}`;
  SIGILS[id] = beltFace(MARKS[s.id] ?? SIGILS.summon);
  INGREDIENT_CARDS[s.id] = {
    id,
    gameId: s.id,
    name: s.name,
    // Shaping was `transmutation`'s chapter when Growth and Multishot were pages,
    // and it is still the honest label for what these do. It costs nothing to be
    // right about: a card that is not in the book produces no tab.
    school: 'transmutation',
    role: s.role === 'animate' || s.role === 'raise' ? 'summon' : 'modifier',
    cost: s.cost,
    colors: colorsOf(s.colour),
    effect: s.effect,
    flavor: s.flavor,
  };
}

/** The card for an ingredient id, or null if that id is not one. */
export function ingredientCard(id: string): SpellDef | null {
  return INGREDIENT_CARDS[id] ?? null;
}

/** The ingredient's own colour, for the halo it wears instead of the book's gold. */
export function ingredientColour(id: string): number {
  return SPELL_BY_ID[id]?.colour ?? 0xffffff;
}
