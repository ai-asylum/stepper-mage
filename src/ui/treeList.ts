/**
 * The star tree as a column of cards — kept, deliberately, behind the LIST toggle.
 *
 * The constellation in `ui/tree.ts` replaced this as the default because a single
 * column cannot show two nodes as ALTERNATIVES: depth-first order separates two
 * siblings by the whole subtree of the first, so the screen never shows the decision
 * being made. But a list is better at exactly one thing, and it is a real thing —
 * reading all twelve effects end to end, which the sky turns into twelve taps. A
 * first-session player who wants to understand the economy before spending is
 * better served here.
 *
 * So this is a concession with a maintenance cost, stated as one. It is the old
 * screen, moved rather than rewritten: layout is one column of cards indented by
 * prerequisite depth, with edges drawn as spines in the left gutter.
 */
import { TREE, dependents, missingPrereqs, type NodeId, type TreeNode } from '../meta/tree';
import { GOLD, hexCss, rr, wrapLines } from './hud';
import { FAMILY, NAME_OF, landsLabel, type TreeAction, type TreeView } from './treeCommon';

const LEFT = 10;
/** Room for the spine that carries a prerequisite edge into the card. */
const GUTTER = 14;
const INDENT = 16;
const RIGHT = 12;
const GAP = 10;
/** How far down a card its headline sits — where an incoming edge lands. */
const ELBOW = 22;

const cardX = (depth: number): number => LEFT + GUTTER + depth * INDENT;

interface Row { node: TreeNode; depth: number; parent: NodeId | null; }

/**
 * The nodes in depth-first prerequisite order, each with its depth and the
 * prerequisite it hangs from.
 *
 * Depth-first and not by tier, because a card's parent has to be the card ABOVE
 * it for a spine to be readable without crossings. Built once — the shape of the
 * tree is static; only what is owned changes.
 */
const ROWS: readonly Row[] = (() => {
  const out: Row[] = [];
  const placed = new Set<NodeId>();
  /**
   * Roots go CHEAPEST FIRST, and only the roots.
   *
   * They are the four things a player with an empty tree is choosing between, and
   * the order they are declared in is the order the design doc lists them — which
   * left the second-cheapest node in the tree at the bottom of the screen, under
   * five cards it does not connect to. Inside a chain the declared order is already
   * the tier order and price only agrees with it, so it is left alone.
   */
  const roots = [...TREE].sort((a, b) => a.price - b.price);
  const walk = (parent: NodeId | null, depth: number): void => {
    for (const n of parent === null ? roots : TREE) {
      if (placed.has(n.id)) continue;
      // The DEEPEST prerequisite is the one the card hangs from; any other is
      // named in words on the card instead. Nothing in the tree has two today.
      const p = n.requires.length ? n.requires[n.requires.length - 1] : null;
      if (p !== parent) continue;
      placed.add(n.id);
      out.push({ node: n, depth, parent: p });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  // A node whose chain never reaches a root would otherwise be invisible here —
  // unbuyable and unmentioned, which is the worst failure this screen has. Flat.
  for (const n of TREE) if (!placed.has(n.id)) out.push({ node: n, depth: 0, parent: null });
  return out;
})();

type State = 'owned' | 'ready' | 'short' | 'locked';

interface Card {
  row: Row;
  x: number; w: number; h: number;
  state: State;
  colour: number;
  /** What it costs, or how far short you are. Empty once owned. */
  priceTag: string;
  /** Prerequisites still missing, by name. Empty unless locked. */
  needs: string[];
  body: string[];
  band: string[];
  risk: string[];
  /** Whether a refund is currently refused, so the sell pill can dim. */
  held: boolean;
  needsY: number; bodyY: number; bandY: number; riskY: number; sellY: number;
}

interface Hit { rect: [number, number, number, number]; action: TreeAction }

export class TreeList {
  /** Content-space scroll offset, clamped in `draw` against measured content. */
  scroll = 0;

  /** Content-space row tops, so `reveal` can scroll a node into view. */
  private rowY = new Map<NodeId, { y: number; h: number }>();
  private viewH = 0;
  private maxScroll = 0;
  private hits: Hit[] = [];

  scrollBy(dy: number): void {
    this.scrollTo(this.scroll + dy);
  }

  scrollTo(y: number): void {
    this.scroll = Math.max(0, Math.min(this.maxScroll, y));
  }

  /** Put a node in the middle of the viewport. Needs one drawn frame first. */
  reveal(id: NodeId): boolean {
    const r = this.rowY.get(id);
    if (!r) return false;
    this.scrollTo(r.y - (this.viewH - r.h) / 2);
    return true;
  }

  /**
   * Draw the whole list into the band `[top, top + bodyH]` and return the hit
   * rects it wants, already clipped to that band.
   */
  draw(
    ctx: CanvasRenderingContext2D, W: number, top: number, bodyH: number, v: TreeView,
  ): Hit[] {
    this.hits = [];
    this.viewH = bodyH;

    const cards = this.layout(ctx, W, v);
    const contentH = cards.reduce((a, c) => a + c.h + GAP, 0) + 6;
    this.maxScroll = Math.max(0, contentH - bodyH);
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll));

    let y = 6;
    const tops = cards.map((c) => { const at = y; y += c.h + GAP; return at; });
    this.rowY = new Map(cards.map((c, i) => [c.row.node.id, { y: tops[i], h: c.h }]));

    const shift = top - this.scroll;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, W, bodyH);
    ctx.clip();
    ctx.translate(0, shift);
    // Edges under the cards, so a spine emerges from beneath its parent instead of
    // being drawn across it.
    cards.forEach((c, i) => this.drawEdge(ctx, cards, tops, c, i, v));
    cards.forEach((c, i) => this.drawCard(ctx, c, tops[i], shift, top, bodyH));
    ctx.restore();

    this.drawScrollHints(ctx, W, top, bodyH, contentH);
    return this.hits;
  }

  /**
   * Measure every card. Cards size themselves to their copy for the same reason
   * the altar's do: one shared height either clips the long ones or hollows out
   * the short ones, on a screen whose whole job is being read.
   */
  private layout(ctx: CanvasRenderingContext2D, W: number, v: TreeView): Card[] {
    return ROWS.map((row) => {
      const n = row.node;
      const owned = v.owned.includes(n.id);
      const needs = missingPrereqs(n.id, v.owned).map(NAME_OF);
      const state: State = owned ? 'owned'
        : needs.length ? 'locked'
        : v.stars >= n.price ? 'ready' : 'short';
      const x = cardX(row.depth);
      const w = W - x - RIGHT;

      ctx.font = '9px ui-monospace, monospace';
      const body = wrapLines(ctx, n.effect, w - 30);
      ctx.font = 'bold 7.5px ui-monospace, monospace';
      const band = n.live ? [] : wrapLines(
        ctx,
        `${owned ? 'BOUGHT · ' : ''}EFFECT ARRIVES IN ${landsLabel(n.lands ?? '')}`,
        w - 52,
      );
      const risk = owned ? v.atRisk(n.id) : [];

      let c = 38;
      const needsY = c;
      if (needs.length) c += 12;
      const bodyY = c;
      c += body.length * 11 + 5;
      const bandY = c;
      if (band.length) c += band.length * 10 + 9;
      const riskY = c;
      if (risk.length) c += 12;
      const sellY = c;
      if (owned) c += 28;

      return {
        row, x, w, h: c + 6, state, colour: FAMILY[n.id], needs, body, band, risk,
        priceTag: owned ? ''
          : state === 'short' ? `✦ ${n.price} · ${n.price - v.stars} SHORT`
          : `✦ ${n.price}`,
        held: owned && dependents(n.id).some((d) => v.owned.includes(d)),
        needsY, bodyY, bandY, riskY, sellY,
      };
    });
  }

  /**
   * One prerequisite edge: down the gutter from under the parent card, then an
   * elbow into the child's headline.
   */
  private drawEdge(
    ctx: CanvasRenderingContext2D, cards: Card[], tops: number[], c: Card, i: number, v: TreeView,
  ): void {
    const elbowY = tops[i] + ELBOW;
    if (!c.row.parent) {
      // No prerequisite: a diamond in the gutter, which is what "start here" looks
      // like next to a column of cards that all hang off something.
      const dx = c.x - 8, s = 3.4;
      ctx.beginPath();
      ctx.moveTo(dx, elbowY - s); ctx.lineTo(dx + s, elbowY);
      ctx.lineTo(dx, elbowY + s); ctx.lineTo(dx - s, elbowY);
      ctx.closePath();
      ctx.strokeStyle = hexCss(c.colour, c.state === 'owned' ? 0.95 : 0.4);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      return;
    }

    const pi = cards.findIndex((o) => o.row.node.id === c.row.parent);
    if (pi < 0) return;
    const live = v.owned.includes(c.row.parent);
    const colX = cardX(c.row.depth - 1) + 6;

    ctx.beginPath();
    ctx.moveTo(colX, tops[pi] + cards[pi].h - 8);
    ctx.arcTo(colX, elbowY, c.x, elbowY, 6);
    ctx.lineTo(c.x, elbowY);
    ctx.strokeStyle = c.state === 'owned' ? hexCss(0xffcf5c, 0.95)
      : live ? hexCss(c.colour, 0.5)
      : 'rgba(150,140,160,0.3)';
    ctx.lineWidth = c.state === 'owned' ? 2 : live ? 1.4 : 1.2;
    if (!live) ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (live) {
      ctx.beginPath();
      ctx.arc(c.x, elbowY, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = c.state === 'owned' ? GOLD : hexCss(c.colour, 0.6);
      ctx.fill();
    }
  }

  /**
   * @param y      the card's top in CONTENT space; the context is already translated
   * @param shift  content-to-screen offset, for the hit rects, which are not
   */
  private drawCard(
    ctx: CanvasRenderingContext2D, c: Card, y: number, shift: number,
    bodyTop: number, bodyH: number,
  ): void {
    const n = c.row.node;
    const { x, w, h, state } = c;
    // Nothing off screen is drawn, and nothing off screen takes a tap.
    if (y + h + shift < bodyTop - 4 || y + shift > bodyTop + bodyH + 4) return;

    rr(ctx, x, y, w, h, 8);
    ctx.fillStyle = state === 'owned' ? 'rgba(38,29,14,0.97)'
      : state === 'locked' ? 'rgba(14,11,19,0.95)'
      : state === 'ready' ? 'rgba(26,18,32,0.96)'
      : 'rgba(19,14,23,0.96)';
    ctx.fill();
    ctx.strokeStyle = state === 'owned' ? GOLD
      : state === 'locked' ? 'rgba(150,140,160,0.34)'
      : hexCss(c.colour, state === 'ready' ? 0.9 : 0.34);
    ctx.lineWidth = state === 'owned' ? 1.8 : state === 'ready' ? 1.5 : 1.2;
    // A locked card is perforated, so "you cannot have this yet" survives being
    // read in one glance down a column of twelve.
    if (state === 'locked') ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // The family stripe down the leading edge, as on an altar card.
    ctx.fillStyle = hexCss(c.colour, state === 'owned' ? 0.95 : state === 'locked' ? 0.22 : 0.7);
    ctx.fillRect(x + 1, y + 10, 4, h - 20);

    // tag row: what state this is on the left, what it costs on the right
    ctx.textAlign = 'left';
    ctx.font = 'bold 7.5px ui-monospace, monospace';
    ctx.fillStyle = state === 'owned' ? 'rgba(255,207,92,0.95)'
      : state === 'locked' ? 'rgba(170,162,180,0.75)'
      : hexCss(c.colour, state === 'ready' ? 0.85 : 0.5);
    ctx.fillText(
      state === 'owned' ? '✓ OWNED' : state === 'locked' ? 'LOCKED'
        : state === 'ready' ? 'AVAILABLE' : 'SAVING UP',
      x + 16, y + 9,
    );
    if (c.priceTag) {
      ctx.textAlign = 'right';
      ctx.fillStyle = state === 'ready' ? GOLD
        : state === 'locked' ? 'rgba(200,190,205,0.5)' : 'rgba(255,150,120,0.85)';
      ctx.fillText(c.priceTag, x + w - 12, y + 9);
      ctx.textAlign = 'left';
    }

    // The headline carries the card, same as the altar's: serif, big, brightest.
    ctx.font = 'bold 15px ui-serif, Georgia, serif';
    ctx.fillStyle = state === 'owned' ? GOLD
      : state === 'locked' ? 'rgba(206,199,214,0.8)' : '#fff4dc';
    ctx.fillText(n.name, x + 16, y + 19);

    // The prerequisite in words as well as in the spine — the spine says WHERE it
    // hangs from, this says WHAT to buy, and on a scrolled screen the parent card
    // may not be on it.
    if (c.needs.length) {
      ctx.font = 'bold 8px ui-monospace, monospace';
      ctx.fillStyle = '#ffb060';
      ctx.fillText(`NEEDS ${c.needs.join(' AND ').toUpperCase()} FIRST`, x + 16, y + c.needsY);
    }

    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = state === 'owned' ? 'rgba(255,240,206,0.86)'
      : state === 'locked' ? 'rgba(210,203,216,0.5)'
      : 'rgba(226,216,200,0.74)';
    c.body.forEach((ln, k) => ctx.fillText(ln, x + 16, y + c.bodyY + k * 11));

    if (c.band.length) this.drawBand(ctx, c, y);

    // The card itself buys. Pushed first, so the sell pill inside it wins where
    // the two overlap — `hit` walks the list backwards.
    this.addHit([x, y + shift, w, h], { kind: 'buy', id: n.id }, bodyTop, bodyH);

    if (state === 'owned') {
      if (c.risk.length) {
        ctx.font = 'bold 7.5px ui-monospace, monospace';
        ctx.fillStyle = '#ffb0a0';
        ctx.fillText(`SELLING GIVES UP ${c.risk.join(' AND ').toUpperCase()}`, x + 16, y + c.riskY);
      }
      const pill = this.drawSell(ctx, c, y);
      this.addHit(
        [pill[0] - 10, pill[1] + shift - 7, pill[2] + 20, pill[3] + 14],
        { kind: 'sell', id: n.id }, bodyTop, bodyH,
      );
    }
  }

  /**
   * The band that says the effect is not live yet. Cool grey-violet rather than the
   * altar's alarm orange: this is not a price and not a warning, it is a date.
   */
  private drawBand(ctx: CanvasRenderingContext2D, c: Card, y: number): void {
    const { x, w, h } = c;
    const top = y + c.bandY;
    ctx.save();
    rr(ctx, x, y, w, h, 8);
    ctx.clip();
    ctx.fillStyle = 'rgba(38,38,74,0.62)';
    ctx.fillRect(x, top, w, c.band.length * 10 + 9);
    ctx.restore();
    ctx.strokeStyle = 'rgba(150,160,220,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 1, top + 0.5); ctx.lineTo(x + w - 1, top + 0.5);
    ctx.stroke();
    // A hollow ring, not a filled disc: the altar's filled disc is its alarm.
    ctx.beginPath();
    ctx.arc(x + 22, top + 9, 4.4, 0, Math.PI * 2);
    ctx.strokeStyle = '#9aa8e0';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.font = 'bold 7.5px ui-monospace, monospace';
    ctx.fillStyle = '#bcc6ee';
    c.band.forEach((ln, k) => ctx.fillText(ln, x + 32, top + 5 + k * 10));
  }

  /**
   * SELL, on the card, as its own control. Returns its content-space rect. Dimmed
   * and still tappable when something depends on this node, so the gesture stays
   * available and the refusal says why.
   */
  private drawSell(
    ctx: CanvasRenderingContext2D, c: Card, y: number,
  ): [number, number, number, number] {
    const label = `SELL  ✦ ${c.row.node.price}`;
    ctx.font = 'bold 8.5px ui-monospace, monospace';
    const w = ctx.measureText(label).width + 26, h = 24;
    const bx = c.x + c.w - 12 - w, by = y + c.sellY;
    ctx.globalAlpha = c.held ? 0.4 : 1;
    rr(ctx, bx, by, w, h, 12);
    ctx.fillStyle = 'rgba(60,40,14,0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,207,92,0.8)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe6b0';
    ctx.fillText(label, bx + w / 2, by + h / 2 + 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.globalAlpha = 1;
    if (c.held) {
      ctx.font = '7.5px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(200,190,205,0.6)';
      ctx.fillText('held by what it unlocked', c.x + 16, by + 8);
    }
    return [bx, by, w, h];
  }

  /** Clip a hit rect to the scrolling viewport and keep it if anything is left. */
  private addHit(
    rect: [number, number, number, number], action: TreeAction, bodyTop: number, bodyH: number,
  ): void {
    const top = Math.max(rect[1], bodyTop);
    const bottom = Math.min(rect[1] + rect[3], bodyTop + bodyH);
    // A sliver of a card under the header must not take a tap aimed at the bank.
    if (bottom - top < 12) return;
    this.hits.push({ rect: [rect[0], top, rect[2], bottom - top], action });
  }

  private drawScrollHints(
    ctx: CanvasRenderingContext2D, W: number, top: number, h: number, contentH: number,
  ): void {
    if (contentH <= h) return;
    // Fades at both edges: a canvas cannot imply its own scroll, and a card cut off
    // cleanly by a clip looks like the end of the list.
    const fade = (y0: number, y1: number): void => {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, 'rgba(8,6,13,0.95)');
      g.addColorStop(1, 'rgba(8,6,13,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0));
    };
    fade(top, top + 14);
    fade(top + h, top + h - 18);

    const trackH = h - 16;
    const thumbH = Math.max(28, trackH * (h / contentH));
    const ty = top + 8 + (trackH - thumbH) * (this.maxScroll ? this.scroll / this.maxScroll : 0);
    rr(ctx, W - 6, ty, 3, thumbH, 1.5);
    ctx.fillStyle = 'rgba(255,207,92,0.35)';
    ctx.fill();
  }
}
