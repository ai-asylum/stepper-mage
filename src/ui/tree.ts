/**
 * The star tree screen — a constellation on a fixed five-column rail, drawn on the
 * same crisp 2D layer as the HUD and owning the whole frame while it is up.
 *
 * Its own file rather than a fifth modal inside `hud.ts` because it is not the HUD:
 * it never reads the floor, the combat or the run, and it is a MODE the game routes
 * to rather than a band drawn over the world. It takes the HUD's paint helpers and
 * nothing else, so the dependency runs one way.
 *
 * WHY THIS SHAPE. The twelve nodes form five prerequisite tiers and are never wider
 * than four, so a 5x5 lattice holds the whole tree with a spare column — and at the
 * measured row pitch that is ~370px of content in a ~577px body. Nothing scrolls.
 * The screen this replaced was a single column of measured cards, ~1300px of content
 * in a 670px body, and its real defect was not the scroll: a column preserves
 * ancestry perfectly and DESTROYS siblinghood, because depth-first order separates
 * two siblings by the entire subtree of the first. A choice is only ever made across
 * siblings, so the old screen never once showed the player the decision they were
 * making — with nothing owned, one of the four roots was visible and the other three
 * were 700px down, underneath a chain of golem nodes nobody could buy. A row of
 * four roots fixes that in the first frame.
 *
 * Three channels, kept strictly orthogonal, so none of them has to be read as text:
 *
 *   - DISC SHAPE carries the node's kind (see `treeIcons.ts`),
 *   - COLOUR carries which chain it belongs to (`FAMILY`),
 *   - RING GEOMETRY carries state — dotted rim locked, a gold arc swept
 *     `stars / price` while you cannot afford it, a complete ring when you can, and
 *     a filled disc once it is yours.
 *
 * That arc is the most valuable thing on the screen and it is nearly free: it turns
 * all twelve nodes into live gauges against your bank, replacing twelve
 * one-at-a-time "✦ 140 · 30 SHORT" strings with one glance. Owned nodes light in
 * their FAMILY colour and not in gold, because gold is the currency and the
 * affordability signal — if owned were also gold, a fully bought tree would collapse
 * into one undifferentiated blob exactly when the player has most invested in it.
 *
 * WHAT IS DELIBERATELY ABSENT. No starfield, no nebula, no parallax, no twinkle.
 * The celestial look is borrowed; the camera and the background are not. A field of
 * small bright dots behind a graph of small bright dots is noise in the same channel
 * as the signal, and glow stops meaning "state" the moment glow is also decoration.
 * The ground stays flat `#08060d` and the nodes are the only stars in it. The motion
 * budget is exactly two things: an affordable node breathes, and a pinned route
 * carries one travelling spark.
 *
 * HOW IT SCALES. The binding constraint is the five-column ceiling, not the node
 * count: five columns times N rows reads well at roughly 50–60% occupancy, so
 * 5 x 10 ≈ 25–30 nodes is the graceful maximum. Nothing about the arithmetic changes
 * on the way there. `rowPitch` is `min((skyH - 24) / TIERS, pitch * 1.26)` with a
 * 52px floor, so the lattice COMPRESSES to fit before it ever scrolls: eight tiers
 * measure 552px in a 577px body on a 390x844 stage and ten tiers measure 553px —
 * still no scroll. Past that the 52px floor binds, the content exceeds the body, and
 * the screen becomes one short flick with the edge fades and the thumb this file
 * already draws. That path is not theoretical: `tools/` exercised it on a stage short
 * enough to force it, which is why the clamp and the fades are here rather than
 * waiting for node thirteen. Beyond ~30 the answer is TABBED SKIES by category, not a
 * bigger sky, and a tier wider than five wraps across two rows — wrapping weakens
 * "row = tier" locally, a sixth column breaks tap targets globally.
 *
 * Every node is tappable whatever its state, a tap SELECTS and never spends, and the
 * docked panel's single button is the only thing that commits. Refusals are reported
 * in the transaction's own words, handed back through `say`. The tree teaches its own
 * shape by being asked and answering.
 */
import {
  NODE_BY_ID, TREE, buyBlocker, missingPrereqs, refundBlocker, type NodeId,
} from '../meta/tree';
import { GOLD, PARCH, hexCss, rr, wrapLines } from './hud';
import { KIND, NICK, drawIcon, shapePath, type NodeKind } from './treeIcons';
import {
  FAMILY, NAME_OF, TIER, TIERS, landsLabel, routeCost, routeTo,
  type TreeAction, type TreeView,
} from './treeCommon';
import { TreeList } from './treeList';

export type { TreeAction, TreeView } from './treeCommon';

/**
 * Which column each node stands in. HAND-AUTHORED, and that is the point.
 *
 * A greedy placement works today and would reshuffle the moment node thirteen
 * arrives — and a shape that changes cannot be remembered. Spatial memory is what
 * lets a player navigate a tree they have not read: it forms relative to landmarks,
 * it is neighbourhood-level rather than exact, and a reflowing layout destroys it
 * while pure scaling preserves it. So the columns are twelve integers a designer
 * owns, exactly like `FAMILY`, and narrow screens SCALE the lattice rather than
 * reflowing it to fewer columns.
 *
 * The authored shape, tier 0 at the bottom:
 *
 *     T4                          SERVANT II
 *     T3                          INFUSION
 *     T2              COFFIN      SERVANT     DEEP BELT
 *     T1   HAND III   BELT                                BLESSING+
 *     T0   HAND II                ALTARS      4TH BAND     BLESSING
 *
 * Four roots side by side along the bottom, in the thumb's lower-middle. The hand
 * and belt chains climb the left, the three-tall golem spire rises through the
 * centre, and the two independent singletons plus the blessing pair sit out on the
 * right — four constellations that stay far apart, which is the answer to a sky of
 * twelve reading as sparse rather than grand.
 *
 * The module asserts below that no two nodes share a cell and warns on any crossing
 * edge, which converts an authoring mistake into a failure on first load rather than
 * into a screen that quietly looks wrong.
 */
const COL: Readonly<Record<NodeId, number>> = {
  hand2: 0, hand3: 0,
  belt3: 1, corpseRaising: 1,
  golemKeep1: 2, golemInfusion: 2, golemKeep2: 2,
  belt6: 3,
  altarPages: 2, slots4: 3,
  blessing: 4, blessingWider: 4,
};

/** The rail is five wide. Set by tap targets at a 267px usable width, not by taste. */
const COLS = 5;
const SIDE = 14;

/** Every prerequisite edge once, child-first so the child's colour can lead. */
const EDGES: readonly { from: NodeId; to: NodeId }[] = TREE.flatMap((n) =>
  n.requires.map((r) => ({ from: r, to: n.id })));

/**
 * The layout lint. Runs once, at module load, on static data.
 *
 * A duplicate cell is a hard failure because it is unambiguously a mistake and the
 * symptom — two discs drawn on top of each other — is one a reviewer can miss. A
 * crossing is a warning because it is a judgement call: it may be the least bad
 * option for some future thirteenth node, and the author should see it rather than
 * be stopped by it. Zero crossings today.
 */
(() => {
  const seen = new Map<string, NodeId>();
  for (const n of TREE) {
    const key = `${TIER[n.id]}:${COL[n.id]}`;
    const other = seen.get(key);
    if (other) throw new Error(`ui/tree.ts: ${n.id} and ${other} share cell ${key}`);
    seen.set(key, n.id);
  }
  const at = (id: NodeId): [number, number] => [COL[id], TIER[id]];
  const cross = (
    a: [number, number], b: [number, number], c: [number, number], d: [number, number],
  ): boolean => {
    // Shared endpoints are a fan, not a crossing.
    for (const p of [a, b]) for (const q of [c, d]) if (p[0] === q[0] && p[1] === q[1]) return false;
    const side = (p: number[], q: number[], r: number[]): number =>
      Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
  };
  const bad: string[] = [];
  for (let i = 0; i < EDGES.length; i++) {
    for (let j = i + 1; j < EDGES.length; j++) {
      if (cross(at(EDGES[i].from), at(EDGES[i].to), at(EDGES[j].from), at(EDGES[j].to))) {
        bad.push(`${EDGES[i].from}->${EDGES[i].to} x ${EDGES[j].from}->${EDGES[j].to}`);
      }
    }
  }
  if (bad.length) console.warn('ui/tree.ts: crossing edges —', bad.join(', '));
})();

type State = 'owned' | 'ready' | 'short' | 'locked';

/** One drawn node: where it landed, how big, and what it currently is. */
interface Cell {
  id: NodeId;
  cx: number; cy: number;
  /** Circumradius of the disc's own shape. */
  r: number;
  /** Outermost reach of the shape, which differs per kind. */
  outer: number;
  kind: NodeKind;
  colour: number;
  state: State;
  /** `stars / price`, clamped — the arc's sweep. */
  fill: number;
  /** Position on the pinned route, 1-based, or 0. */
  step: number;
  /** The lattice cell, which is the hit target. */
  hit: [number, number, number, number];
}

interface Hit { rect: [number, number, number, number]; action: TreeAction }

export class TreeScreen {
  /** The last thing the tree said back, and whether it was a refusal. */
  message: string | null = null;
  private messageBad = false;

  /** Which presentation is up. The list is the bulk-reading fallback. */
  mode: 'sky' | 'list' = 'sky';
  /** The node the docked panel is describing, or null for the idle panel. */
  selected: NodeId | null = null;

  private readonly list = new TreeList();
  private hits: Hit[] = [];
  private cells: Cell[] = [];
  private cellOf = new Map<NodeId, Cell>();
  private viewH = 0;
  private maxScroll = 0;
  /** Animation clock. Two things move; both read this. */
  private t = 0;
  /**
   * The constellation's own scroll offset, which is zero today — five tiers fit in
   * the body with room to spare. It exists, with its clamp and its edge fades,
   * because the same lattice at eight tiers is ~1.15 screens and one flick is then
   * the whole navigation model.
   */
  private skyScroll = 0;
  /** Where the sky band started last frame, so `reveal` can centre against it. */
  private skyTop = 0;

  constructor(private view: () => TreeView) {}

  /**
   * Whichever view is up, its scroll — so `main.ts` can keep one drag branch that
   * samples a position, drags, and clamps, without knowing which view it is driving.
   */
  get scroll(): number {
    return this.mode === 'list' ? this.list.scroll : this.skyScroll;
  }

  /** Entering the screen fresh: nothing selected, nothing said, bottom of the sky. */
  open(): void {
    this.selected = null;
    this.message = null;
    this.messageBad = false;
    this.skyScroll = Number.POSITIVE_INFINITY;   // clamped to the bottom on first draw
    this.list.scroll = 0;
  }

  say(text: string, bad: boolean): void {
    this.message = text;
    this.messageBad = bad;
  }

  /**
   * The clock behind the two moving things. Called by the game loop while the
   * screen is up; the screen is still correct without it, just still.
   */
  update(dt: number): void {
    this.t += dt;
  }

  scrollBy(dy: number): void {
    this.scrollTo(this.scroll + dy);
  }

  scrollTo(y: number): void {
    if (this.mode === 'list') { this.list.scrollTo(y); return; }
    this.skyScroll = Math.max(0, Math.min(this.maxScroll, y));
  }

  /**
   * Bring a node to the player's attention: in the sky that means SELECT it, since
   * the whole tree is already on screen and there is nothing to scroll to. Needs one
   * drawn frame first, exactly as before.
   */
  reveal(id: NodeId): boolean {
    if (this.mode === 'list') return this.list.reveal(id);
    const c = this.cellOf.get(id);
    if (!c) return false;
    this.selected = id;
    this.scrollTo(this.skyScroll + (c.cy - (this.viewH / 2 + this.skyTop)));
    return true;
  }

  /** Where the controls landed this frame, so a scripted tap can be aimed. */
  controls(): { kind: string; id: NodeId | null; x: number; y: number; w: number; h: number }[] {
    return this.hits.map(({ rect, action }) => ({
      kind: action.kind,
      id: 'id' in action ? action.id : null,
      x: rect[0], y: rect[1], w: rect[2], h: rect[3],
    }));
  }

  hit(x: number, y: number): TreeAction {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const [rx, ry, rw, rh] = this.hits[i].rect;
      if (x >= rx && y >= ry && x <= rx + rw && y <= ry + rh) return this.hits[i].action;
    }
    return { kind: 'none' };
  }

  // ---------------------------------------------------------------------- draw

  draw(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const v = this.view();
    this.hits = [];

    // Opaque: the run behind this one is over, and a dungeon showing through the
    // spend screen reads as a pause menu rather than as the surface.
    ctx.fillStyle = '#08060d';
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'top';

    const headerH = this.drawHeader(ctx, W, v);
    const ctaH = 40;
    const ctaTop = H - 8 - ctaH;

    if (this.mode === 'list') {
      // The old screen, unchanged: the list gets the whole body and the footer
      // carries the message, because a docked one-node panel above a scrolling list
      // of twelve full cards would be saying the same thing twice.
      const footerTop = ctaTop - 34;
      this.hits.push(...this.list.draw(ctx, W, headerH, footerTop - headerH, v));
      this.rule(ctx, W, footerTop);
      ctx.textAlign = 'center';
      if (this.message) {
        ctx.font = '8.5px ui-monospace, monospace';
        ctx.fillStyle = this.messageBad ? '#ff9a80' : GOLD;
        wrapLines(ctx, this.message, W - 36).slice(0, 2)
          .forEach((ln, i) => ctx.fillText(ln, W / 2, footerTop + 8 + i * 11));
      } else {
        ctx.font = '8px ui-monospace, monospace';
        ctx.fillStyle = 'rgba(232,217,176,0.35)';
        ctx.fillText('tap a card to buy it · drag to see the rest', W / 2, footerTop + 8);
      }
    } else {
      const panelH = Math.max(112, Math.min(138, Math.round(H * 0.172)));
      const panelTop = ctaTop - 10 - panelH;
      const skyTop = headerH;
      const skyH = panelTop - 8 - skyTop;
      this.drawSky(ctx, W, skyTop, skyH, v);
      this.drawPanel(ctx, W, panelTop, panelH, v);
    }

    this.drawCta(ctx, W, ctaTop, ctaH);
    ctx.textAlign = 'left';
  }

  private rule(ctx: CanvasRenderingContext2D, W: number, y: number): void {
    ctx.strokeStyle = 'rgba(255,207,92,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }

  // -------------------------------------------------------------------- header

  private drawHeader(ctx: CanvasRenderingContext2D, W: number, v: TreeView): number {
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.fillStyle = GOLD;
    ctx.fillText('THE STAR TREE', W / 2, 7);

    // The bank, big. It is the number the whole screen is about, and every arc in
    // the sky is drawn against it.
    ctx.font = 'bold 21px ui-monospace, monospace';
    ctx.fillStyle = GOLD;
    ctx.fillText(`✦ ${v.stars}`, W / 2, 19);

    const owned = TREE.filter((n) => v.owned.includes(n.id)).length;
    this.chipRow(ctx, W, 45, [
      [`HAND ${v.handSize}`, 0xffcf5c],
      [`BOOK ${v.slots}`, 0xe8d9b0],
      [`${owned}/${TREE.length} OWNED`, 0xb98cff],
    ]);

    // The view toggle. Small, top-right, out of the title's way even at 295px.
    const label = this.mode === 'sky' ? 'LIST' : 'SKY';
    ctx.font = 'bold 7.5px ui-monospace, monospace';
    const bw = ctx.measureText(label).width + 18, bh = 16;
    const bx = W - 8 - bw, by = 5;
    rr(ctx, bx, by, bw, bh, 8);
    ctx.fillStyle = 'rgba(24,18,32,0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,217,176,0.38)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(232,217,176,0.85)';
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + 0.5);
    ctx.textBaseline = 'top';
    // Padded: it is the one small control on a screen of large ones.
    this.hits.push({ rect: [bx - 8, by - 5, bw + 16, bh + 12], action: { kind: 'mode' } });

    const h = 66;
    this.rule(ctx, W, h);
    return h;
  }

  /** Small readouts, centred as a group. The HUD's pill, laid out from the middle. */
  private chipRow(
    ctx: CanvasRenderingContext2D, W: number, y: number, chips: [string, number][],
  ): void {
    ctx.font = '8px ui-monospace, monospace';
    const ws = chips.map(([t]) => ctx.measureText(t).width + 14);
    let x = (W - (ws.reduce((a, b) => a + b, 0) + (chips.length - 1) * 6)) / 2;
    chips.forEach(([label, col], i) => {
      rr(ctx, x, y, ws[i], 15, 7);
      ctx.fillStyle = 'rgba(20,14,26,0.9)';
      ctx.fill();
      ctx.strokeStyle = hexCss(col, 0.45);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = hexCss(col);
      ctx.fillText(label, x + ws[i] / 2, y + 8);
      ctx.textBaseline = 'top';
      x += ws[i] + 6;
    });
  }

  // ----------------------------------------------------------------------- sky

  /**
   * Measure the lattice, then draw edges under discs.
   *
   * The disc is drawn SMALL and the hit rect is the whole lattice cell. That single
   * decision is what makes the narrow case work: at the 295px floor the cell is
   * 53x58 and clears a 48dp target in both axes while the disc is only 34px, so the
   * drawing can be sized for legibility rather than for fingers, and the
   * edge-inflated target sizes a thumb actually needs are satisfied for free.
   */
  private drawSky(
    ctx: CanvasRenderingContext2D, W: number, top: number, skyH: number, v: TreeView,
  ): void {
    this.skyTop = top;
    this.viewH = skyH;
    const pitch = (W - SIDE * 2) / COLS;
    /**
     * Rows are pitched off the COLUMN pitch, not off the space available.
     *
     * Left to fill the body, five tiers would sit 110px apart on a tall stage and the
     * lattice would stop looking like a lattice. Tied to `pitch * 1.32` it stays
     * roughly square — slightly taller than wide, which is the room a disc plus its
     * nickname needs — and the leftover height becomes margin. 1.32 rather than 1.26
     * because the persistence chain is three diamonds stacked in one column and a
     * diamond reaches 1.2r, so a tighter pitch left barely 25px of visible edge
     * between them.
     */
    const rowPitch = Math.max(52, Math.min(100, Math.min((skyH - 24) / TIERS, pitch * 1.32)));
    const contentH = TIERS * rowPitch;
    this.maxScroll = Math.max(0, contentH - skyH);
    this.skyScroll = Math.max(0, Math.min(this.maxScroll, this.skyScroll));
    // Centred when it fits — which is the whole point — and bottom-anchored by the
    // clamp when it does not, so tier 0 is what a fresh open lands on.
    const offset = this.maxScroll > 0 ? -this.skyScroll : (skyH - contentH) / 2;

    const r = Math.max(16, Math.min(25, pitch * 0.34));
    const route = v.pinned ? routeTo(v.pinned, v.owned) : [];
    const onRoute = new Map(route.map((id, i) => [id, i + 1]));

    this.cells = TREE.map((n) => {
      const kind = KIND[n.id];
      const owned = v.owned.includes(n.id);
      const missing = missingPrereqs(n.id, v.owned).length > 0;
      const state: State = owned ? 'owned'
        : missing ? 'locked'
        : v.stars >= n.price ? 'ready' : 'short';
      const cx = SIDE + pitch * (COL[n.id] + 0.5);
      const cy = top + offset + contentH - (TIER[n.id] + 0.5) * rowPitch;
      return {
        id: n.id, cx, cy, r, kind, colour: FAMILY[n.id], state,
        outer: r * (kind === 'capability' ? 1 : kind === 'capacity' ? 1.06 : 1.2),
        fill: Math.max(0, Math.min(1, v.stars / n.price)),
        step: onRoute.get(n.id) ?? 0,
        hit: [cx - pitch / 2, cy - rowPitch / 2, pitch, rowPitch],
      };
    });
    this.cellOf = new Map(this.cells.map((c) => [c.id, c]));

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, W, skyH);
    ctx.clip();

    // Empty sky deselects. Pushed first so every node cell drawn after it wins.
    this.hits.push({ rect: [0, top, W, skyH], action: { kind: 'deselect' } });

    this.drawEdges(ctx, v, route);
    /**
     * Which node breathes. With a route pinned it is the route's NEXT step and
     * nothing else, so the screen answers "what now" before being asked; without one
     * it is everything you can afford. Only ever one kind of pulse, because glow
     * stops carrying state the moment glow is decoration.
     */
    const focus = route.length
      ? this.cellOf.get(route[0])?.state === 'ready' ? route[0] : null
      : null;
    for (const c of this.cells) {
      this.drawNode(ctx, c, {
        dim: route.length > 0 && c.step === 0 && c.state !== 'owned',
        breathe: route.length ? c.id === focus : c.state === 'ready',
        pitch,
      });
      // Clipped to the band, so a cell half under the header cannot take a tap
      // aimed at the bank.
      const [hx, hy, hw, hh] = c.hit;
      const y0 = Math.max(hy, top), y1 = Math.min(hy + hh, top + skyH);
      if (y1 - y0 >= 16) {
        this.hits.push({ rect: [hx, y0, hw, y1 - y0], action: { kind: 'select', id: c.id } });
      }
    }
    ctx.restore();

    if (this.maxScroll > 0) this.drawScrollHints(ctx, W, top, skyH, contentH);
  }

  /**
   * The prerequisite edges. Straight lines, trimmed to the discs at both ends so
   * nothing is drawn across a glyph.
   *
   * A bought edge is solid and bright in the child's family colour, an edge whose
   * parent you own is a dimmer solid, and an edge you cannot yet reach at all is
   * dashed — so the branch you are on is a lit line rather than three nodes that
   * happen to be near each other, and the constellation is literally completed by
   * your purchases.
   */
  private drawEdges(ctx: CanvasRenderingContext2D, v: TreeView, route: readonly NodeId[]): void {
    const routed = new Set(route);
    const legs: { x0: number; y0: number; qx: number; qy: number; x1: number; y1: number }[] = [];

    for (const e of EDGES) {
      const a = this.cellOf.get(e.from), b = this.cellOf.get(e.to);
      if (!a || !b) continue;
      const dx = b.cx - a.cx, dy = b.cy - a.cy;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const x0 = a.cx + ux * (a.outer + 3), y0 = a.cy + uy * (a.outer + 3);
      const x1 = b.cx - ux * (b.outer + 3), y1 = b.cy - uy * (b.outer + 3);
      /**
       * An edge that spans two columns SAGS.
       *
       * Belt → Deep Belt is the only one today and its straight line passes within a
       * pixel or two of the Bound Servant sitting between them, which reads as
       * touching a node it has nothing to do with. Bowing it downward — away from the
       * row above — pushes the midpoint clear, and a slack wire between two stars is
       * the right look anyway.
       */
      const sag = Math.abs(COL[e.to] - COL[e.from]) >= 2 ? 16 : 0;
      const qx = (x0 + x1) / 2, qy = (y0 + y1) / 2 + sag;

      const bought = a.state === 'owned' && b.state === 'owned';
      const live = a.state === 'owned';
      // On the route when the step it enables is on the route and the step it comes
      // from is either on the route or already paid for.
      const pinned = routed.has(e.to) && (routed.has(e.from) || v.owned.includes(e.from));
      if (pinned) legs.push({ x0, y0, qx, qy, x1, y1 });

      ctx.save();
      if (route.length && !pinned && !bought) ctx.globalAlpha = 0.45;
      if (bought) {
        ctx.shadowColor = hexCss(b.colour, 0.6);
        ctx.shadowBlur = 6;
        ctx.strokeStyle = hexCss(b.colour, 0.95);
        ctx.lineWidth = 2.1;
      } else if (pinned) {
        ctx.strokeStyle = hexCss(0xffcf5c, 0.8);
        ctx.lineWidth = 1.8;
      } else if (live) {
        ctx.strokeStyle = hexCss(b.colour, 0.46);
        ctx.lineWidth = 1.4;
      } else {
        ctx.strokeStyle = 'rgba(152,144,166,0.26)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
      }
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(qx, qy, x1, y1);
      ctx.stroke();
      ctx.restore();
      ctx.setLineDash([]);
    }

    if (!legs.length) return;
    /**
     * One spark, walking the whole pinned route end to end.
     *
     * One and not one per edge: the entire motion budget for this screen is an
     * affordable node's breath plus this, and a route of five edges with five sparks
     * would be five moving things claiming to be one journey.
     */
    const lens = legs.map((l) => Math.hypot(l.x1 - l.x0, l.y1 - l.y0));
    const total = lens.reduce((a, b) => a + b, 0);
    let d = ((this.t * 0.30) % 1) * total;
    for (let i = 0; i < legs.length; i++) {
      if (d > lens[i]) { d -= lens[i]; continue; }
      const k = lens[i] ? d / lens[i] : 0;
      const l = legs[i];
      // On the curve, not the chord, so a sagging leg does not have its spark
      // travelling beside it.
      const m = 1 - k;
      const sx = m * m * l.x0 + 2 * m * k * l.qx + k * k * l.x1;
      const sy = m * m * l.y0 + 2 * m * k * l.qy + k * k * l.y1;
      ctx.save();
      ctx.shadowColor = 'rgba(255,229,138,0.9)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = '#fff2c8';
      ctx.fill();
      ctx.restore();
      break;
    }
  }

  /**
   * One node: halo, disc, rim, gauge ring, pictogram, phase pip, route numeral,
   * selection bracket, nickname.
   *
   * The GAUGE RING is the piece that matters. It is a circle at a constant 3.5px
   * outside the shape whatever the shape is — so the state channel stays one shape
   * and never has to be told apart from the kind channel — carrying a faint full
   * track and a gold arc swept from twelve o'clock by `stars / price`. Empty means
   * nothing banked toward it, full means buy it now, and the whole sky reads as
   * twelve simultaneous answers to "how close am I".
   */
  private drawNode(
    ctx: CanvasRenderingContext2D, c: Cell,
    o: { dim: boolean; breathe: boolean; pitch: number },
  ): void {
    const n = NODE_BY_ID[c.id];
    const sel = this.selected === c.id;
    const gauge = c.outer + 3.5;

    ctx.save();
    // Dimmed, not hidden: with a route pinned the route has to be figure and the
    // rest ground, but a node the player can afford must never become unfindable
    // just because they are also saving for something else.
    if (o.dim) ctx.globalAlpha = 0.46;

    // The breath: an affordable node, or the next step of a pinned route.
    if (o.breathe) {
      const pulse = 0.5 + Math.sin(this.t * 4.4) * 0.5;
      ctx.save();
      ctx.shadowColor = hexCss(0xffcf5c, 0.4 + pulse * 0.4);
      ctx.shadowBlur = 10 + pulse * 12;
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, gauge, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,207,92,0.001)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    // the disc
    ctx.save();
    ctx.translate(c.cx, c.cy);
    if (c.state === 'owned') {
      ctx.shadowColor = hexCss(c.colour, 0.5);
      ctx.shadowBlur = 9;
    }
    shapePath(ctx, c.kind, c.r);
    ctx.fillStyle = c.state === 'owned' ? hexCss(c.colour, 0.9)
      : c.state === 'ready' ? 'rgba(26,19,34,0.96)'
      : c.state === 'short' ? 'rgba(18,14,24,0.96)'
      : 'rgba(12,10,17,0.96)';
    ctx.fill();
    ctx.shadowBlur = 0;
    // The rim, and the one place the state channel uses a LINE STYLE: a locked node
    // is perforated, which survives colour-blindness and a dim phone.
    ctx.strokeStyle = c.state === 'owned' ? 'rgba(255,247,224,0.9)'
      : c.state === 'ready' ? hexCss(c.colour, 0.95)
      : c.state === 'short' ? hexCss(c.colour, 0.55)
      : 'rgba(158,150,172,0.62)';
    ctx.lineWidth = c.state === 'owned' ? 1.5 : c.state === 'ready' ? 1.9 : 1.3;
    // A longer dash than a dotted circle would use, so a hexagon's corners and a
    // diamond's points survive being perforated — the SHAPE channel has to keep
    // working while the state channel is saying "not yet".
    if (c.state === 'locked') ctx.setLineDash([3.4, 3]);
    shapePath(ctx, c.kind, c.r);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // the gauge
    if (c.state !== 'owned') {
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, gauge, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,207,92,0.09)';
      ctx.lineWidth = 2.4;
      ctx.stroke();
      if (c.fill > 0.005) {
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, gauge, -Math.PI / 2, -Math.PI / 2 + c.fill * Math.PI * 2);
        /**
         * Dimmer AND perforated while a prerequisite is missing.
         *
         * The arc still answers "can I afford it", which is true and worth knowing —
         * but a node you can afford and cannot buy would otherwise wear a complete
         * bright ring, which is exactly the mark that means "buy me". Dashing it
         * makes locked one language everywhere: dashed rim, dashed gauge, dashed
         * incoming edge.
         */
        ctx.strokeStyle = c.state === 'locked' ? 'rgba(255,207,92,0.34)' : GOLD;
        ctx.lineWidth = c.state === 'locked' ? 2 : 2.6;
        if (c.state === 'locked') ctx.setLineDash([3, 3]);
        else ctx.lineCap = 'round';
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineCap = 'butt';
      }
    } else {
      // Owned: the gauge is replaced by a thin bright halo ring, so the ring channel
      // is never empty and "paid for" has its own geometry.
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, gauge, 0, Math.PI * 2);
      ctx.strokeStyle = hexCss(c.colour, 0.35);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // the pictogram, knocked out dark on an owned node
    drawIcon(ctx, c.id, c.cx, c.cy, c.r,
      c.state === 'owned' ? 'rgba(16,11,20,0.88)'
        : c.state === 'ready' ? hexCss(c.colour, 0.98)
        : c.state === 'short' ? hexCss(c.colour, 0.66)
        : hexCss(c.colour, 0.26));

    /**
     * The effect-not-live pip: a hollow ring at four o'clock, and one line in the
     * panel. Seven of twelve nodes are bought-but-inert pending a later phase, which
     * cost a 29px band on every card of the old screen — ~175px of scroll spent
     * communicating a development schedule rather than a purchase. A ring and not a
     * filled disc, because a filled disc is this game's alarm: this is a date.
     */
    if (!n.live) {
      const a = Math.PI * 0.28;
      ctx.beginPath();
      ctx.arc(c.cx + Math.cos(a) * gauge, c.cy + Math.sin(a) * gauge, 3.1, 0, Math.PI * 2);
      ctx.fillStyle = '#08060d';
      ctx.fill();
      ctx.strokeStyle = c.state === 'locked' ? 'rgba(154,168,224,0.45)' : 'rgba(154,168,224,0.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // the purchase-order numeral, when a route is pinned
    if (c.step > 0) {
      const a = Math.PI * 1.22;
      const bx = c.cx + Math.cos(a) * gauge, by = c.cy + Math.sin(a) * gauge;
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, Math.PI * 2);
      ctx.fillStyle = GOLD;
      ctx.fill();
      ctx.font = 'bold 9px ui-monospace, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2a1c06';
      ctx.fillText(String(c.step), bx, by + 0.5);
      ctx.textBaseline = 'top';
    }

    // the nickname, always — a pictogram alone is a guessing game on first open
    const fs = Math.max(6, Math.min(7.5, o.pitch * 0.105));
    ctx.font = `bold ${fs}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    const nick = NICK[c.id];
    // Shrink rather than clip: at 295px "SERVANT II" is 36px in a 53px cell, so this
    // is insurance for a stage narrower than anything the aspect clamp produces.
    if (ctx.measureText(nick).width > o.pitch - 4) {
      ctx.font = `bold ${(fs * (o.pitch - 4)) / ctx.measureText(nick).width}px ui-monospace, monospace`;
    }
    /**
     * Knocked out of the background before it is filled.
     *
     * A vertical edge runs from a parent's disc up to its child's, and the child's
     * label sits between the two — so without this the line is drawn straight through
     * the word, and the pinned route's spark travels across the letters. Stroking the
     * text in the ground colour first erases the line behind it, which reads as the
     * wire passing behind a sign.
     */
    ctx.strokeStyle = '#08060d';
    ctx.lineWidth = 3.6;
    ctx.lineJoin = 'round';
    ctx.strokeText(nick, c.cx, c.cy + gauge + 4);
    ctx.fillStyle = c.state === 'owned' ? hexCss(c.colour, 0.98)
      : c.state === 'ready' ? 'rgba(255,244,220,0.95)'
      : c.state === 'short' ? 'rgba(226,216,200,0.6)'
      : 'rgba(190,184,200,0.46)';
    ctx.fillText(nick, c.cx, c.cy + gauge + 4);

    ctx.restore();

    // The selection bracket, drawn OUTSIDE the dim so the node you tapped is never
    // one of the dimmed ones.
    if (sel) {
      const s = gauge + 7, k = s * 0.44;
      ctx.strokeStyle = PARCH;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        ctx.moveTo(c.cx + sx * s - sx * k, c.cy + sy * s);
        ctx.lineTo(c.cx + sx * s, c.cy + sy * s);
        ctx.lineTo(c.cx + sx * s, c.cy + sy * s - sy * k);
      }
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  private drawScrollHints(
    ctx: CanvasRenderingContext2D, W: number, top: number, h: number, contentH: number,
  ): void {
    // Fades at both edges: content cropped cleanly by a clip reads as "there is
    // nothing more", which is the illusion of completeness and a real bug.
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

  // --------------------------------------------------------------------- panel

  /**
   * The docked detail panel: fixed height, always present, always meaningful.
   *
   * A panel and not a bottom sheet, on purpose. Always-needed content belongs in
   * permanent chrome — a sheet for it means a vertical swipe-to-dismiss competing
   * with the sky's own drag, and a grab handle instead of a visible affordance. The
   * height is fixed so the layout never reflows between "nothing selected" and "a
   * locked node with a refusal on it", which costs ~16% of the screen and buys a
   * lattice that never moves under the thumb.
   *
   * Idle it is not wasted: it carries the pinned route's progress, or the legend for
   * the four ring states — which is where the screen teaches the language it uses
   * instead of labelling twelve nodes with it.
   */
  private drawPanel(
    ctx: CanvasRenderingContext2D, W: number, top: number, h: number, v: TreeView,
  ): void {
    const x = 10, w = W - 20, pad = 13;
    rr(ctx, x, top, w, h, 10);
    ctx.fillStyle = 'rgba(17,13,24,0.96)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,207,92,0.20)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const btnH = 28;
    const btnY = top + h - 9 - btnH;
    const textTop = top + 34;
    const textEnd = btnY - 4;

    if (this.selected) this.drawSelected(ctx, x, w, top, pad, textTop, textEnd, btnY, btnH, v);
    else if (v.pinned) this.drawPinnedIdle(ctx, x, w, top, pad, textTop, btnY, btnH, v);
    else this.drawLegend(ctx, x, w, top, pad, textTop, btnY, btnH, v);
    ctx.textAlign = 'left';
  }

  /** The tapped node, in words. Name, effect, price, prerequisite, honesty. */
  private drawSelected(
    ctx: CanvasRenderingContext2D, x: number, w: number, top: number, pad: number,
    textTop: number, textEnd: number, btnY: number, btnH: number, v: TreeView,
  ): void {
    const id = this.selected!;
    const n = NODE_BY_ID[id];
    const owned = v.owned.includes(id);
    const missing = missingPrereqs(id, v.owned).map(NAME_OF);
    const colour = FAMILY[id];
    const state: State = owned ? 'owned'
      : missing.length ? 'locked'
      : v.stars >= n.price ? 'ready' : 'short';
    const held = owned ? refundBlocker(id, v.owned) : null;

    // The family flash down the leading edge, as on an altar card.
    ctx.fillStyle = hexCss(colour, 0.85);
    ctx.fillRect(x + 1, top + 12, 4, btnY - top - 22);

    ctx.textAlign = 'left';
    ctx.font = 'bold 7.5px ui-monospace, monospace';
    ctx.fillStyle = owned ? 'rgba(255,207,92,0.95)'
      : state === 'locked' ? 'rgba(172,164,182,0.8)'
      : hexCss(colour, state === 'ready' ? 0.9 : 0.6);
    ctx.fillText(
      owned ? (held ? '✓ OWNED · HELD' : '✓ OWNED')
        : state === 'locked' ? 'LOCKED'
        : state === 'ready' ? 'READY TO BUY'
        : `SAVING UP · ${n.price - v.stars} SHORT`,
      x + pad, top + 10,
    );
    if (!owned) {
      ctx.textAlign = 'right';
      ctx.fillStyle = state === 'ready' ? GOLD : 'rgba(232,217,176,0.6)';
      ctx.fillText(`✦ ${v.stars} / ${n.price}`, x + w - pad, top + 10);
      ctx.textAlign = 'left';
    }

    // The headline carries the panel, same as the altar card's: serif, big, brightest.
    ctx.font = 'bold 15px ui-serif, Georgia, serif';
    ctx.fillStyle = owned ? GOLD : state === 'locked' ? 'rgba(214,207,222,0.9)' : '#fff4dc';
    ctx.fillText(n.name, x + pad, top + 19);

    /**
     * The note stack, drawn in priority order until the space runs out.
     *
     * The message goes FIRST because it is the newest fact on the screen and it is
     * usually a refusal — and refusals are rendered here rather than in a footer
     * because this is where the eye already is, having just tapped the button that
     * produced it. The verbatim text comes from `meta/tree.ts`; nothing here
     * paraphrases a rule.
     */
    const iw = w - pad * 2;
    const notes: { text: string; font: string; fill: string; lh: number }[] = [];
    if (this.message) {
      ctx.font = 'bold 8.5px ui-monospace, monospace';
      for (const ln of wrapLines(ctx, this.message, iw).slice(0, 2)) {
        notes.push({
          text: ln, font: 'bold 8.5px ui-monospace, monospace',
          fill: this.messageBad ? '#ff9a80' : GOLD, lh: 11,
        });
      }
    }
    ctx.font = '9px ui-monospace, monospace';
    for (const ln of wrapLines(ctx, n.effect, iw).slice(0, 2)) {
      notes.push({
        text: ln, font: '9px ui-monospace, monospace',
        fill: owned ? 'rgba(255,240,206,0.86)' : 'rgba(226,216,200,0.76)', lh: 11,
      });
    }
    if (missing.length) {
      notes.push({
        text: `NEEDS ${missing.join(' AND ').toUpperCase()} FIRST`,
        font: 'bold 8px ui-monospace, monospace', fill: '#ffb060', lh: 11,
      });
    }
    /**
     * Why the refund is refused, BEFORE the tap, in the model's own words.
     *
     * The dimmed button and the HELD tag say that something is wrong; only this says
     * what to sell first. It is the same string the refusal would produce, so the
     * screen cannot paraphrase the leaves-only rule into something subtly different —
     * and it is worth the line, because being told to sell the belt first is how the
     * player finds out the belt depends on hand size 2.
     */
    if (held && !this.message) {
      ctx.font = 'bold 8px ui-monospace, monospace';
      for (const ln of wrapLines(ctx, held, iw).slice(0, 2)) {
        notes.push({
          text: ln, font: 'bold 8px ui-monospace, monospace',
          fill: 'rgba(200,190,205,0.72)', lh: 11,
        });
      }
    }
    // Bought, priced, persisted and inert is indistinguishable from broken unless
    // it is stated where the purchase happens. Seven of the twelve are.
    if (!n.live && n.lands) {
      notes.push({
        text: `${owned ? 'BOUGHT · ' : ''}EFFECT ARRIVES IN ${landsLabel(n.lands)}`,
        font: 'bold 7.5px ui-monospace, monospace', fill: '#bcc6ee', lh: 10,
      });
    }
    const risk = owned ? v.atRisk(id) : [];
    if (risk.length) {
      notes.push({
        text: `SELLING GIVES UP ${risk.join(' AND ').toUpperCase()}`,
        font: 'bold 7.5px ui-monospace, monospace', fill: '#ffb0a0', lh: 10,
      });
    }
    let y = textTop;
    for (const ln of notes) {
      if (y + ln.lh > textEnd + 2) break;
      ctx.font = ln.font;
      ctx.fillStyle = ln.fill;
      ctx.fillText(ln.text, x + pad, y);
      y += ln.lh;
    }

    /**
     * One button, always in the same place, and the only thing on the screen that
     * spends. `buyBlocker` and `refundBlocker` decide which it is, so the panel can
     * never offer a purchase the model would refuse.
     */
    const bx = x + pad, bw = w - pad * 2;
    if (owned) {
      this.button(ctx, bx, btnY, bw, btnH, `SELL  ✦ ${n.price}`,
        0x3c2a0e, 'rgba(255,207,92,0.8)', '#ffe6b0', held ? 0.45 : 1);
      // Dimmed and STILL tappable: the leaves-only rule is taught by asking and
      // being told what to sell first, so the gesture has to stay available.
      this.hits.push({ rect: [bx, btnY - 4, bw, btnH + 8], action: { kind: 'sell', id } });
      return;
    }
    if (buyBlocker(id, v.owned, v.stars) === null) {
      this.button(ctx, bx, btnY, bw, btnH, `BUY  ✦ ${n.price}`,
        0x4a3410, GOLD, '#fff0c8', 1);
      this.hits.push({ rect: [bx, btnY - 4, bw, btnH + 8], action: { kind: 'buy', id } });
      return;
    }
    if (v.pinned === id) {
      this.button(ctx, bx, btnY, bw, btnH, 'CLEAR THE ROUTE',
        0x1a1420, 'rgba(200,192,208,0.5)', 'rgba(222,216,228,0.9)', 1);
      this.hits.push({ rect: [bx, btnY - 4, bw, btnH + 8], action: { kind: 'unpin' } });
      return;
    }
    this.button(ctx, bx, btnY, bw, btnH, 'SAVE FOR THIS',
      0x141e34, 'rgba(140,200,255,0.85)', '#d6ecff', 1);
    this.hits.push({ rect: [bx, btnY - 4, bw, btnH + 8], action: { kind: 'pin', id } });
  }

  /**
   * The idle panel with a route pinned: what you are saving for, how far along, and
   * the total.
   *
   * This is the half of the screen the old one had nothing for. A tree whose prices
   * total ~1,340 against ~70 stars a run is not a map of roads not taken — you will
   * eventually own everything, so the only decision it ever presents is ORDER, and
   * its real job is "help me choose what to buy next and give me something to save
   * for". A numbered route with a running total is that, natively, on day one.
   */
  private drawPinnedIdle(
    ctx: CanvasRenderingContext2D, x: number, w: number, top: number, pad: number,
    textTop: number, btnY: number, btnH: number, v: TreeView,
  ): void {
    const goal = v.pinned!;
    const route = routeTo(goal, v.owned);
    const total = routeCost(route);
    const short = Math.max(0, total - v.stars);

    ctx.fillStyle = hexCss(FAMILY[goal], 0.85);
    ctx.fillRect(x + 1, top + 12, 4, btnY - top - 22);

    ctx.textAlign = 'left';
    ctx.font = 'bold 7.5px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(140,200,255,0.9)';
    ctx.fillText('SAVING FOR', x + pad, top + 10);
    ctx.font = 'bold 15px ui-serif, Georgia, serif';
    ctx.fillStyle = '#fff4dc';
    ctx.fillText(NODE_BY_ID[goal].name, x + pad, top + 19);

    ctx.font = 'bold 8px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(232,217,176,0.8)';
    ctx.fillText(
      `ROUTE · ${route.length} NODE${route.length === 1 ? '' : 'S'} · ✦ ${total} TOTAL`
      + (short ? ` · ✦ ${short} SHORT` : ' · PAID FOR'),
      x + pad, textTop,
    );

    // The bar. Same arithmetic as every arc in the sky, at route scale.
    const bw = w - pad * 2, by = textTop + 14;
    rr(ctx, x + pad, by, bw, 7, 3.5);
    ctx.fillStyle = 'rgba(255,207,92,0.12)';
    ctx.fill();
    const k = total ? Math.max(0, Math.min(1, v.stars / total)) : 1;
    if (k > 0.01) {
      rr(ctx, x + pad, by, Math.max(4, bw * k), 7, 3.5);
      ctx.fillStyle = GOLD;
      ctx.fill();
    }

    if (by + 20 < btnY) {
      ctx.font = '7.5px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(232,217,176,0.45)';
      ctx.fillText(`next: ${NODE_BY_ID[route[0] ?? goal].name}`, x + pad, by + 11);
    }

    const bx = x + pad;
    this.button(ctx, bx, btnY, bw, btnH, 'CLEAR THE ROUTE',
      0x1a1420, 'rgba(200,192,208,0.5)', 'rgba(222,216,228,0.9)', 1);
    this.hits.push({ rect: [bx, btnY - 4, bw, btnH + 8], action: { kind: 'unpin' } });
  }

  /**
   * The idle panel with nothing pinned: the legend.
   *
   * The sky carries state in ring geometry precisely so it does not have to carry
   * twelve words, and this is where those words live instead — once, in a fixed
   * place, rather than on every node forever.
   */
  private drawLegend(
    ctx: CanvasRenderingContext2D, x: number, w: number, top: number, pad: number,
    textTop: number, btnY: number, btnH: number, v: TreeView,
  ): void {
    ctx.textAlign = 'left';
    ctx.font = 'bold 7.5px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(232,217,176,0.5)';
    ctx.fillText('THE SKY', x + pad, top + 10);
    ctx.font = 'bold 15px ui-serif, Georgia, serif';
    const complete = TREE.every((n) => v.owned.includes(n.id));
    ctx.fillStyle = '#fff4dc';
    ctx.fillText(complete ? 'The sky is full.' : 'Tap a star.', x + pad, top + 19);

    const affordable = TREE.filter((n) =>
      buyBlocker(n.id, v.owned, v.stars) === null).length;
    ctx.font = '8px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(226,216,200,0.66)';
    // "nothing in reach yet" is true of an empty bank and of a finished tree, and
    // it means opposite things — a finished tree has nothing left to reach FOR.
    ctx.fillText(
      complete
        ? 'every node owned · sell any of them back in full'
        : affordable
          ? `${affordable} within reach · every node sells back in full`
          : 'nothing in reach yet · every node sells back in full',
      x + pad, textTop,
    );
    ctx.font = '7.5px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(232,217,176,0.38)';
    // Measured against the 295px floor, where the panel's inner width is 249px and
    // this line at 7.5px monospace is 212px. Longer copy clipped there.
    ctx.fillText('the gold ring is how close · LIST reads them all', x + pad, textTop + 11);

    /**
     * Four keys, drawn with the same primitives the sky uses so the legend cannot
     * drift from the thing it explains. They sit in the row the commit button
     * occupies when a node is selected, which is what keeps the panel from having a
     * hollow bottom third in its most common state.
     */
    const keys: [State, string][] = [
      ['locked', 'LOCKED'], ['short', 'SAVING'], ['ready', 'READY'], ['owned', 'OWNED'],
    ];
    const cw = (w - pad * 2) / keys.length;
    const ky = btnY + btnH / 2;
    keys.forEach(([st, label], i) => {
      const cx = x + pad + cw * i + 8, r = 6;
      const ring = (rad: number): void => {
        ctx.beginPath();
        ctx.arc(cx, ky, rad, 0, Math.PI * 2);
      };
      ring(r);
      ctx.fillStyle = st === 'owned' ? hexCss(0xe8d9b0, 0.9) : 'rgba(16,12,22,0.95)';
      ctx.fill();
      ctx.strokeStyle = st === 'owned' ? 'rgba(255,247,224,0.9)'
        : st === 'locked' ? 'rgba(158,150,172,0.7)' : 'rgba(232,217,176,0.55)';
      ctx.lineWidth = 1.1;
      if (st === 'locked') ctx.setLineDash([2.2, 2.2]);
      ring(r);
      ctx.stroke();
      ctx.setLineDash([]);
      if (st === 'short' || st === 'ready') {
        ctx.beginPath();
        ctx.arc(cx, ky, r + 3, -Math.PI / 2,
          -Math.PI / 2 + (st === 'ready' ? Math.PI * 2 : Math.PI * 1.05));
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 1.9;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
      ctx.font = 'bold 6.5px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(232,217,176,0.62)';
      ctx.fillText(label, cx + r + 5, ky + 0.5);
      ctx.textBaseline = 'top';
    });
  }

  /** One panel button, in the house's one shape. */
  private button(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
    label: string, fill: number, edge: string, fg: string, alpha: number,
  ): void {
    ctx.globalAlpha = alpha;
    rr(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = hexCss(fill, 0.95);
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.font = 'bold 10.5px ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = fg;
    ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.globalAlpha = 1;
  }

  private drawCta(ctx: CanvasRenderingContext2D, W: number, y: number, h: number): void {
    const label = 'ENTER THE DUNGEON  ▼';
    const bw = W - 48, bx = (W - bw) / 2;
    rr(ctx, bx, y, bw, h, h / 2);
    ctx.fillStyle = 'rgba(124,59,82,0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,194,62,0.9)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe6b0';
    ctx.fillText(label, W / 2, y + h / 2 + 0.5);
    ctx.textBaseline = 'top';
    this.hits.push({ rect: [bx, y - 6, bw, h + 14], action: { kind: 'start' } });
  }
}
