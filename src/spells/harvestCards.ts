/**
 * The card a harvested element arrives in your hand on.
 *
 * A harvest has no page and never will — Stone, Water, Oil, Starlight and the
 * candelabra's Flame exist nowhere in the book (`docs/DESIGN.md`, "**No Stone page
 * exists.**"). But the `Fan` holds `SpellDef`s, and `src/book/` is ported
 * near-verbatim from upstream and is not to be restructured. So the cheapest honest
 * route is to meet the book where it is: a harvested element gets a page-SHAPED def
 * with its own sigil `id` and its own `colors` triad, exactly like `pages.ts` builds
 * for a real page, and the fan cannot tell the difference. Nothing else in the book
 * ever sees these — they are not in `SPELLS`, so no chapter tab, no page, no rank.
 *
 * What makes the card visibly NOT a page you own, in the order it reads at the size
 * the hand is actually drawn:
 *  - the HALO. Every torn page wears the book's gold on its edge and in its merge
 *    glow; `main.ts` recolours a borrowed card's to the element's own. Gold means
 *    yours.
 *  - the BINDING. `harvestFace` frames the card in the element's colour, where a
 *    page has only the book's thin ink border.
 *  - the SIGIL and the title, which belong to no page in the game.
 *  - the stamp, for anyone who looks closely: where it came from, and rank 1.
 *
 * `SIGILS` is the page painter's only injection point for a card the book cannot
 * know about, which is why the frame and the stamp are drawn from a sigil rather
 * than from somewhere more obvious.
 *
 * Registered from HERE and not from `pages.ts` deliberately: `book/pageTexture.ts`
 * imports `pages.ts`, so touching `SIGILS` from there is a module cycle whose
 * outcome depends on which file the bundler happens to reach first.
 */
import { SIGILS, type SigilFn } from '../book/pageTexture';
import { colorsOf, type SpellDef } from './pages';
import { SPELLS, SPELL_BY_ID } from './spells';

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

/** A candle: the one honest overlap with a page, and it looks like a candle. */
const markFlame: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  // the stick
  ctx.fillStyle = c.deep;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.17, cy + r * 0.92);
  ctx.lineTo(cx - r * 0.13, cy - r * 0.1);
  ctx.lineTo(cx + r * 0.13, cy - r * 0.1);
  ctx.lineTo(cx + r * 0.17, cy + r * 0.92);
  ctx.closePath();
  ctx.fill();
  // wax running over the lip
  ctx.fillStyle = c.glow;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.08, r * 0.15, r * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // the flame
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 34;
  ctx.fillStyle = c.main;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.95);
  ctx.bezierCurveTo(cx + r * 0.4, cy - r * 0.45, cx + r * 0.3, cy - r * 0.08, cx, cy - r * 0.12);
  ctx.bezierCurveTo(cx - r * 0.3, cy - r * 0.08, cx - r * 0.4, cy - r * 0.45, cx, cy - r * 0.95);
  ctx.fill();
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#fff8e8';
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.4, r * 0.08, r * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

/** A droplet, mid-fall, over the rings it is about to make. */
const markWater: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 24;
  ctx.fillStyle = c.main;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.85);
  ctx.bezierCurveTo(cx + r * 0.52, cy - r * 0.05, cx + r * 0.44, cy + r * 0.42, cx, cy + r * 0.42);
  ctx.bezierCurveTo(cx - r * 0.44, cy + r * 0.42, cx - r * 0.52, cy - r * 0.05, cx, cy - r * 0.85);
  ctx.fill();
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#f2fbff';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.13, cy + r * 0.06, r * 0.08, r * 0.13, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // the surface it is falling into
  for (const [w, y] of [[0.86, 0.72], [0.58, 0.88]] as const) {
    stroke(ctx, [
      [cx - r * w, cy + r * y],
      [cx - r * w * 0.4, cy + r * (y - 0.07)],
      [cx + r * w * 0.4, cy + r * (y - 0.07)],
      [cx + r * w, cy + r * y],
    ], 3, c.deep);
  }
};

/** A drum with its bung out, and the slick already spreading. */
const markOil: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 14;
  ctx.fillStyle = c.main;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.46, cy - r * 0.68);
  ctx.lineTo(cx + r * 0.46, cy - r * 0.68);
  ctx.lineTo(cx + r * 0.52, cy + r * 0.36);
  ctx.lineTo(cx - r * 0.52, cy + r * 0.36);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // hoops
  for (const y of [-0.34, 0.06]) {
    stroke(ctx, [[cx - r * 0.5, cy + r * y], [cx + r * 0.5, cy + r * y]], 4, c.deep);
  }
  stroke(ctx, [
    [cx - r * 0.46, cy - r * 0.68], [cx + r * 0.46, cy - r * 0.68],
    [cx + r * 0.52, cy + r * 0.36], [cx - r * 0.52, cy + r * 0.36],
    [cx - r * 0.46, cy - r * 0.68],
  ], 3.4, c.deep);
  // the slick, wider than the drum — this is the part that matters
  ctx.fillStyle = c.main;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.62, r * 0.92, r * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = c.glow;
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.3, cy + r * 0.58, r * 0.16, r * 0.05, -0.1, 0, Math.PI * 2);
  ctx.fill();
  // a drip still falling
  ctx.fillStyle = c.deep;
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.18, cy + r * 0.46, r * 0.05, r * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
};

/** A four-point star, long rays, cold light. */
const markStarlight: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 30;
  const star = (scale: number, fill: string) => {
    const o = r * scale;
    const inn = o * 0.2;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(cx, cy - o);
    ctx.quadraticCurveTo(cx + inn, cy - inn, cx + o * 0.72, cy);
    ctx.quadraticCurveTo(cx + inn, cy + inn, cx, cy + o);
    ctx.quadraticCurveTo(cx - inn, cy + inn, cx - o * 0.72, cy);
    ctx.quadraticCurveTo(cx - inn, cy - inn, cx, cy - o);
    ctx.fill();
  };
  star(0.95, c.main);
  ctx.shadowBlur = 12;
  star(0.5, '#ffffff');
  ctx.restore();
  // rays, uneven, so it reads as light rather than as a compass rose
  for (const [a, len] of [[0.79, 0.95], [2.36, 0.7], [3.93, 0.95], [5.5, 0.7]] as const) {
    stroke(ctx, [
      [cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3],
      [cx + Math.cos(a) * r * len, cy + Math.sin(a) * r * len],
    ], 2.6, c.deep);
  }
  ctx.fillStyle = c.glow;
  for (const [a, d] of [[1.1, 0.86], [4.2, 0.78], [2.9, 0.9]] as const) {
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r * d, cy + Math.sin(a) * r * d, 4, 0, Math.PI * 2);
    ctx.fill();
  }
};

/**
 * The borrowed treatment: the element's own binding, and a stamp saying what this
 * card is. Wrapped around the mark rather than mixed into it, so the marks stay
 * ordinary sigils and could be handed to a real page unchanged.
 *
 * The frame is positioned off the canvas and the stamp off the sigil ring, because
 * `actionPage` and `lorePage` call a sigil at different centres and only the action
 * face is ever shown for one of these.
 */
function harvestFace(mark: SigilFn): SigilFn {
  return (ctx, cx, cy, r, c) => {
    ctx.save();
    ctx.strokeStyle = c.main;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 7;
    ctx.strokeRect(46, 46, W - 92, H - 92);
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.strokeRect(58, 58, W - 116, H - 116);
    ctx.restore();

    mark(ctx, cx, cy, r, c);

    const label = 'FROM THE ROOM · RANK 1';
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
 * Marks by fixture element id. Stone reuses the book's own boulder sigil — it was
 * drawn for this element and there is no second Stone to tell it apart from.
 */
const MARKS: Record<string, SigilFn> = {
  flame: markFlame,
  stone: SIGILS.stone,
  water: markWater,
  oil: markOil,
  starlight: markStarlight,
};

/**
 * One card per fixture element, keyed by the id the hand actually holds.
 *
 * The sigil `id` is prefixed, and that is load-bearing twice over: `pageArt` caches
 * art by it, so a shared id would hand a harvested card the Fireball page's face,
 * and `SIGILS` is keyed by it, so the prefix is what keeps the borrowed treatment
 * off a real page.
 */
export const HARVEST_CARDS: Record<string, SpellDef> = {};
/**
 * Every component the ROOM supplies gets a card, not only the elemental ones.
 *
 * This iterated `FIXTURE_SPELLS`, which is `kind === 'element'` — so golem clay, a
 * fixture INGREDIENT, had no card. The harvest then spent the fixture's draw and put
 * nothing in the hand: the clay vanished between the prop and the fan, which is the
 * worst shape a bug can take here because it costs the player a resource and says
 * nothing. Keyed on `source` for the same reason `harvestOf` is.
 */
for (const s of SPELLS.filter((sp) => sp.source === 'fixture')) {
  const id = `harvest-${s.id}`;
  SIGILS[id] = harvestFace(MARKS[s.id] ?? SIGILS.stone);
  HARVEST_CARDS[s.id] = {
    id,
    gameId: s.id,
    name: s.name,
    // The card is elemental and says so; what it is NOT is a page, which the frame
    // and the stamp are there to say. There is no fourth school to put it in
    // without adding a chapter to a book that must never hold one of these.
    school: 'elementalism',
    /**
     * The card's role is the BOOK's vocabulary (`pages.ts`: bolt / modifier / summon),
     * not the game's (`spells.ts`, which also has animate / raise / tempo). It decides
     * how the sheet is drawn and nothing else — every rule about what a hand can DO
     * reads the real role off `gameId`.
     *
     * So an animating component is drawn as a SUMMON, which is what it is from the
     * page's point of view: a body arrives.
     */
    role: s.role === 'animate' || s.role === 'raise' ? 'summon'
      : s.role === 'tempo' ? 'modifier'
      : s.role,
    cost: s.cost,
    colors: colorsOf(s.colour),
    effect: s.effect,
    flavor: s.flavor,
  };
}

/** The card for a harvested element id, or null if that id is not one. */
export function harvestCard(id: string): SpellDef | null {
  return HARVEST_CARDS[id] ?? null;
}

/** The element's own colour, for the halo the card wears instead of the book's gold. */
export function harvestColour(id: string): number {
  return SPELL_BY_ID[id]?.colour ?? 0xffffff;
}
