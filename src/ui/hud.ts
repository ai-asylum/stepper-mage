/**
 * The whole interface, drawn on the crisp 2D overlay.
 *
 * Layout is built around one constraint: on a phone the spellbook and the world
 * compete for the same thumb and the same pixels. So the book is a single row of
 * page cards pinned to the bottom third, the world keeps the top two thirds, and
 * the CAST bar only appears once you have something selected — it materialises
 * out of the gap instead of permanently occupying it.
 *
 * Selection order is TARGET FIRST, then pages: tapping a creature or object locks
 * a reticle onto it, and the book then previews what the current selection would
 * do to *that* thing. The target is part of the fusion, so the preview has to
 * know it before it can name the cast.
 */
import type { Engine } from '../core/engine';
import type { Entity } from '../game/floor';
import { DENIAL_STATUSES, reactionFor, type Combat, type PlayerState } from '../game/combat';
import {
  SPELL_BY_ID, STATUS_META, displayName, harvestOf, isElement,
  type Element, type ResolvedCast,
} from '../spells/spells';
import * as THREE from 'three';
import { DIR_VEC, Tile, type Dir } from '../dungeon/grid';
import { spriteTexture } from '../dungeon/sprites';
import type { Floor } from '../game/floor';

/**
 * What an altar can put on a card.
 *
 * `new`/`upgrade`/`sacrifice`/`star`/`golden` are all offers ABOUT A PAGE — the
 * altar's one hard rule is that no roll is spell-free, and that rule is stated as
 * "at least one offer of these kinds". The rest are the reasons an altar stays
 * interesting once the book is full.
 *
 * Every kind here is ROLLED and taken in one tap. There is no follow-up step: a
 * golden page is a one-run gift and competes for nothing, so nothing an altar
 * hands out asks a second question.
 */
export type AltarOfferKind =
  | 'new' | 'upgrade' | 'sacrifice' | 'star' | 'golden'
  | 'heal' | 'stars' | 'reroll';

/**
 * One of the three things an altar is offering.
 *
 * Everything a card has to draw is ON the offer. The altar is the one moment in a
 * run where the player is reading rather than reacting, so a card assembled by
 * reaching back into the run — current rank, current HP, what the loadout holds —
 * is a card that can quietly disagree with what taking it actually does. The
 * offer is built once, at roll time, and it is the whole truth about itself.
 */
export interface AltarOffer {
  kind: AltarOfferKind;
  /**
   * The page this offer is about, or `''` when it is about nothing in the book
   * (heal, stars, reroll).
   */
  id: string;
  /** The headline. Already carries its own number where it has one. */
  name: string;
  /** The small line above the headline. Copy lives on the offer, not on the card. */
  tag: string;
  colour: number;
  /** The body line. */
  detail: string;
  /**
   * What taking this costs, spelled out, or null when it is free. Only an offer
   * that takes something away for good has one — today that is the rank-3
   * sacrifice alone — and a price the player meets only in the log afterwards is a
   * trap, so a card must draw this.
   */
  cost: string | null;
  /** Health restored, stars paid, charges banked — 0 when the offer has no number. */
  amount: number;
  /** The page's rank now, or 0 when the offer is not about a page. */
  rank: number;
  /** The rank it becomes; 0 when the offer does not move a rank. Draw pips iff > 0. */
  toRank: number;
  /** How long a full rank ladder is, so a card need not import the rule. */
  maxRank: number;
  /** Draw the golden treatment: this one crosses into the next run. */
  golden: boolean;
  /**
   * The rank-2 page a sacrifice spends. Logic only — what the player must SEE is
   * `cost`, which names it in words.
   */
  spendId?: string;
}

export type UiAction =
  | { kind: 'cast' }
  | { kind: 'clear' }
  | { kind: 'target'; entity: Entity }
  | { kind: 'cycle' }
  | { kind: 'bookToggle' }
  | { kind: 'offer'; offer: AltarOffer }
  /** Spend a banked charge to re-roll the open altar's three offers. */
  | { kind: 'reroll' }
  | { kind: 'altar'; entity: Entity }
  | { kind: 'chest'; entity: Entity }
  /**
   * Take the room's own element off the selected fixture. A control and not a page
   * gesture, so it costs a hand slot and a turn exactly like tearing one.
   */
  | { kind: 'harvest'; entity: Entity }
  | { kind: 'move'; m: 'forward' | 'back' }
  | { kind: 'turn'; d: -1 | 1 }
  | { kind: 'descend' }
  /**
   * Leave a finished run for the star tree. The run-end card's own button — any
   * tap on that card goes the same way, so this is the affordance rather than the
   * only route, and it exists so the thing drawn under the thumb is a real control.
   */
  | { kind: 'tree' }
  | { kind: 'none' };

interface FloatNum {
  text: string; colour: number; wx: number; wy: number; t: number; big: boolean;
  /** Extra px of head start, so two floaters over one tile do not draw as one. */
  lift: number;
}
interface LogLine { text: string; colour: number; t: number; }

/**
 * The palette and the two paint helpers, exported because the star tree screen
 * (`ui/tree.ts`) is a second surface in the same idiom. Exported one way only: the
 * HUD knows nothing about that screen.
 */
export const GOLD = '#ffcf5c';
export const PARCH = '#e8d9b0';

export function hexCss(n: number, a = 1): string {
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

/** Rounded rect path helper — the UI's one shape. */
export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Hud {
  target: Entity | null = null;
  /** Candidates the player can tap, refreshed by the game each turn. */
  candidates: Entity[] = [];
  /** Page ids currently torn out — decides which candidates are highlighted. */
  tornIds: string[] = [];

  private floats: FloatNum[] = [];
  private log: LogLine[] = [];
  private shout: { text: string; colour: number; t: number } | null = null;
  private discover: { text: string; colour: number; t: number } | null = null;
  /** Cached hit rects, rebuilt every draw so hit-testing matches what is drawn. */
  private hits: { rect: [number, number, number, number]; action: UiAction }[] = [];
  private hurtFlash = 0;
  private descendReady = false;
  /** Mirrors Book.closed so the toggle can draw the right affordance. */
  bookClosed = false;

  /** The three offers an altar is presenting, or null when none is open. */
  offers: AltarOffer[] | null = null;
  offerAltar: Entity | null = null;

  /** Stars banked from previous runs, so the total is not invisible. */
  bankedStars = 0;

  /**
   * What the player pinned at the star tree, and what the whole route to it costs.
   *
   * Here, in the run, and not only in the menu that set it — that is the entire
   * point. A meta goal that lives behind a screen you reach after dying is a goal
   * you cannot feel yourself approaching; printed under the star counter it turns
   * every ✦ picked up on floor three into progress toward a named thing.
   */
  pinGoal: { name: string; need: number } | null = null;

  /**
   * How the run ended, or null while it is still live.
   *
   * Set by the game rather than inferred from `hp <= 0`, because a run also ends by
   * being WON — the vault is taken with health to spare — and that ending has to
   * land on the same card and lead to the same place. `earned` is passed in for the
   * same reason: the vault pays a bonus on top of the run's stars, so the number on
   * the card cannot be recomputed here without knowing about that bonus. It is also
   * what the bank is derived from, since `bankedStars` is still the pre-run figure —
   * the same one the top bar adds the run's own stars to.
   */
  runEnd: { kind: 'died' | 'won'; depth: number; earned: number } | null = null;

  /** Name of the open page when it is a spell not yet learned, else null. */
  sealedPage: string | null = null;

  /** An unused altar or chest within reach, set by the game each turn. */
  altarInReach: Entity | null = null;

  /**
   * The fixture within reach, set by the game each turn.
   *
   * Its own field rather than a question about `target`, because reach and
   * selection are different things: a target survives being turned away from —
   * that is what lets you keep a reticle on a body while you back down a corridor —
   * and an interaction does not. `main.ts` owns both answers and they come from the
   * same predicate the taps use, so no prompt here can be lit while the rule refuses.
   */
  harvestInReach: Entity | null = null;

  /**
   * Turns the hand currently held has cost. A readout, not a control: the price
   * of a fusion is paid before you press CAST, so it has to be visible NEXT to
   * CAST or the player never connects the two.
   */
  assemblyTurns = 0;

  /**
   * The fusion ceiling and what is held against it, set by the game each frame.
   * A readout for the same reason: the cost of everything is priced per component,
   * so how many components you may hold is the first thing the player has to know.
   */
  handSize = 1;
  handHeld = 0;

  /** Where the minimap reads the world from. Bound per floor. */
  private map: (() => { floor: Floor; x: number; y: number; dir: Dir }) | null = null;

  bindMap(fn: () => { floor: Floor; x: number; y: number; dir: Dir }): void {
    this.map = fn;
  }

  /** The book's measured top edge, so HUD layout matches the gesture boundary. */
  setBookTop(y: number): void {
    this.measuredBookTop = Number.isFinite(y) ? y : null;
  }

  /**
   * Top of the grimoire's screen footprint. The book is a 3D object rendered in
   * the overlay pass, so this is a measured constant rather than a layout value —
   * everything the player must SEE (targets, damage numbers, the reticle) stays
   * above it.
   */
  private bookTop = 0;
  private measuredBookTop: number | null = null;

  /**
   * @param torn  the pages currently ripped out, supplied by the Fan
   * @param onClear  return every torn page to the book
   */
  constructor(
    private engine: Engine,
    private state: PlayerState,
    private combat: Combat,
    private torn: () => string[],
    private onClear: () => void,
  ) {}

  // ------------------------------------------------------------------ feedback

  addFloat(text: string, colour: number, wx: number, wy: number, big = false): void {
    /**
     * Stack floaters that share a tile instead of drawing them on top of each
     * other. A body can produce two in one beat — the damage number from your cast
     * and then the caption for the round it lost — and superimposed they read as
     * one mangled word rather than as two events.
     */
    const together = this.floats.filter((f) => f.wx === wx && f.wy === wy).length;
    this.floats.push({ text, colour, wx, wy, t: 0, big, lift: Math.min(3, together) * 15 });
    if (this.floats.length > 24) this.floats.shift();
  }

  addLog(text: string, colour = 0xd8c9a0): void {
    this.log.push({ text, colour, t: 0 });
    if (this.log.length > 4) this.log.shift();
  }

  setShout(text: string, colour: number): void {
    this.shout = { text, colour, t: 0 };
  }

  setDiscovery(text: string, colour: number): void {
    this.discover = { text, colour, t: 0 };
  }

  playerHurt(): void {
    this.hurtFlash = 1;
  }

  setDescendReady(v: boolean): void {
    this.descendReady = v;
  }

  clearSelection(): void {
    this.onClear();
  }

  /** The pages currently torn out, in tear order. */
  selectedIds(): string[] {
    return this.torn();
  }

  /** What the current selection would do to the current target. */
  currentCast(): ResolvedCast | null {
    const ids = this.selectedIds();
    if (!ids.length) return null;
    const t = this.target;
    return this.combat.preview(ids, t
      ? {
          kind: t.animated ? 'golem' : t.kind === 'prop' ? 'prop'
            : t.kind === 'boss' ? 'boss' : t.kind === 'chest' ? 'chest' : 'enemy',
          propId: t.kind === 'prop' && !t.animated ? t.spriteId : undefined,
        }
      : { kind: 'none' });
  }

  update(dt: number): void {
    for (const f of this.floats) f.t += dt;
    this.floats = this.floats.filter((f) => f.t < 1.3);
    for (const l of this.log) l.t += dt;
    this.log = this.log.filter((l) => l.t < 5);
    if (this.shout) { this.shout.t += dt; if (this.shout.t > 1.5) this.shout = null; }
    if (this.discover) { this.discover.t += dt; if (this.discover.t > 2.4) this.discover = null; }
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    this.engine.setFlash(this.hurtFlash * 0.42, 0xd82f2f);
    // drop a dead target
    if (this.target && !this.target.alive) this.target = null;
  }

  // ---------------------------------------------------------------------- draw

  draw(ctx: CanvasRenderingContext2D): void {
    const W = this.engine.sw, H = this.engine.sh;
    this.hits = [];

    this.drawWorldOverlay(ctx);
    this.drawTopBar(ctx, W);
    this.drawMiniMap(ctx, W);

    /**
     * A finished run keeps its world and its readouts and loses its controls.
     *
     * Everything below drew under the run-end card as well, which put a live-looking
     * CAST bar, a DESCEND button and a spellbook tab on a screen that says the run is
     * over — and on the vault win the run's own shout landed on the card's headline,
     * so the game announced itself twice in two fonts.
     */
    if (this.runEnd) { this.drawRunEnd(ctx, W, H); return; }
    this.drawShout(ctx, W, H);

    // The grimoire occupies roughly the bottom third of the screen.
    this.bookTop = this.bookClosed || this.measuredBookTop === null
      ? Math.round(H * 0.90)
      : Math.round(this.measuredBookTop);
    this.drawCastBar(ctx, W);
    this.drawLog(ctx, W);
    this.drawVitals(ctx, W);
    this.drawHand(ctx);
    this.drawPin(ctx);
    this.drawParty(ctx, W);
    this.drawSealedNote(ctx, W);
    this.drawHarvest(ctx, W);
    this.drawAltarPrompt(ctx, W);
    this.drawBookToggle(ctx, W, H);
    if (this.candidates.length > 1) this.drawCycle(ctx, W);
    if (this.descendReady) this.drawDescend(ctx, W);
    if (this.offers) this.drawOffers(ctx, W, H);
  }

  /**
   * Markers over everything targetable.
   *
   * Three things matter here and all three were wrong before:
   *  - the HIT AREA is the sprite's whole projected box, so a tap anywhere on a
   *    creature selects it rather than only its crown;
   *  - the marker is a DOWN TRIANGLE sitting above the silhouette, which points
   *    at its subject instead of floating ambiguously between two of them;
   *  - the selected thing gets a one-texel keyline in the shader — white for an
   *    object, red for a creature — so selection is on the thing itself.
   */
  private drawWorldOverlay(ctx: CanvasRenderingContext2D): void {
    const v = new THREE.Vector3();
    const p = { x: 0, y: 0, behind: false };
    const wantsObject = this.tornIds.includes('animate');
    /** Hoisted: the hand is the same for every candidate in the room. */
    const held = this.handElements();
    const t = this.engine.time;
    const project = (pt: THREE.Vector3, out: { x: number; y: number; behind: boolean }) =>
      this.engine.worldToUi(pt, out);

    for (const e of this.candidates) {
      if (!e.alive || !e.sprite.group.visible) { e.sprite.setOutline(0xffffff, false); continue; }

      const animatable = e.kind === 'prop' && !e.animated;
      const interactive = (e.kind === 'altar' || e.kind === 'chest') && !e.spent;
      /**
       * The same rule as `isLegal` in `main.ts`, which is the one that actually
       * governs the cast. It used to disagree while a page was torn — furniture was
       * crossed out here and cast at happily there — and object reactions make that
       * gap load-bearing: the barrel IS the intended target.
       */
      const legal = interactive ? true
        : wantsObject ? animatable
        : (e.hostile || animatable);
      const isTarget = e === this.target;
      /** What this object would do if the current hand landed on it. */
      const react = animatable && !wantsObject ? reactionFor(e.spriteId, held) : null;

      const box = e.sprite.screenBox(project);
      if (!box) { e.sprite.setOutline(0xffffff, false); continue; }

      // The whole silhouette is the touch target, with a small margin.
      this.hits.push({
        rect: [box.x - 6, box.y - 10, box.w + 12, box.h + 16],
        action: interactive
          ? (e.kind === 'chest' ? { kind: 'chest', entity: e } : { kind: 'altar', entity: e })
          : { kind: 'target', entity: e },
      });

      // selection keyline, on the sprite itself
      e.sprite.setOutline(e.hostile ? 0xff3a2a : 0xffffff, isTarget && legal);

      const mx = box.x + box.w / 2;
      const my = box.y - 6;

      if (!legal) {
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = '#8a7a6a';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(mx - 5, my - 5); ctx.lineTo(mx + 5, my + 5);
        ctx.moveTo(mx + 5, my - 5); ctx.lineTo(mx - 5, my + 5);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }

      // A reactive object wears the reaction's colour, selected or not: hold a Spark
      // in a room with a water barrel and the barrel goes yellow, which is the
      // cheapest way this game will ever teach the table.
      const col = react ? hexCss(react.colour)
        : interactive ? '#ffcf5c'
        : animatable ? '#b98cff'
        : '#ff7a5c';

      // the down triangle
      const bob = isTarget ? Math.sin(t * 5) * 2.2 : 0;
      const size = isTarget ? 8 : 5.5;
      const ty = my - 4 + bob;
      ctx.beginPath();
      ctx.moveTo(mx, ty + size);
      ctx.lineTo(mx - size * 0.85, ty - size * 0.7);
      ctx.lineTo(mx + size * 0.85, ty - size * 0.7);
      ctx.closePath();
      ctx.globalAlpha = isTarget ? 1
        : (wantsObject && animatable) || interactive || react ? 0.8
        : 0.45;
      ctx.fillStyle = isTarget ? GOLD : col;
      ctx.fill();
      ctx.strokeStyle = 'rgba(12,8,14,0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (isTarget) {
        // An object about to go off says so ON ITSELF, before the cast — "the barrel
        // did that" is not something a caption after the fact can teach.
        // An INSTRUCTION only while the instruction would work: an altar you are
        // standing at and facing says what to do with it, and one across the room
        // says what it is. Telling the player to take a spell from something the
        // reach rule will refuse is the game pointing at its own refusal.
        const label = interactive
          ? (e === this.altarInReach
              ? (e.kind === 'chest' ? 'OPEN' : 'TAKE A SPELL')
              : displayName(e.spriteId).toUpperCase())
          : animatable && wantsObject ? `ANIMATE ${displayName(e.spriteId).toUpperCase()}`
          : react ? `${displayName(e.spriteId).toUpperCase()} · ${react.verb}`
          : displayName(e.spriteId).toUpperCase();
        const plate = react ? hexCss(react.colour) : col;
        ctx.font = 'bold 9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        const w = ctx.measureText(label).width + 14;
        ctx.fillStyle = 'rgba(14,9,16,0.86)';
        rr(ctx, mx - w / 2, ty - 30, w, 15, 7);
        ctx.fill();
        ctx.strokeStyle = plate;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = plate;
        ctx.fillText(label, mx, ty - 23);
        ctx.textAlign = 'left';

        // Furniture gets a bar too, but only once it has been hit — otherwise
        // every room is full of health bars on scenery. Without it, breaking a
        // blocker gives no feedback until it suddenly falls over.
        if (e.maxHp > 0 && (e.hostile || e.animated || e.hp < e.maxHp)) {
          const bw = 40, bh = 3;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(mx - bw / 2 - 1, ty - 13, bw + 2, bh + 2);
          ctx.fillStyle = e.hostile ? '#d8452f' : e.animated ? '#8ce06a' : '#b08c5a';
          ctx.fillRect(mx - bw / 2, ty - 12, bw * Math.max(0, e.hp / e.maxHp), bh);

          const st = this.combat.statusesOf(e).filter((sx) => sx.turns > 0);
          /**
           * Status pips, ABOVE the name plate. They used to sit at `ty - 22`, which
           * is inside the plate's own box, so every pip was drawn across the name —
           * survivable while a pip was decoration, not while it carries the brace.
           *
           * A braced body acts next round however it is painted, so the pips that
           * would have stopped it are drawn HOLLOW: same colour, no fill, "held but
           * not biting". Timing a freeze against the brace is the difference between
           * the lines that clear a hand-size-1 run and the lines that die on floor
           * 4, and it was the half of that rhythm nothing on screen showed.
           */
          const braced = this.combat.bracedFor(e) > 0;
          let sx2 = mx - (st.length * 9) / 2;
          for (const sv of st) {
            const pip = hexCss(STATUS_META[sv.id].colour);
            if (braced && DENIAL_STATUSES.includes(sv.id)) {
              ctx.strokeStyle = pip;
              ctx.lineWidth = 1;
              ctx.strokeRect(sx2 + 0.5, ty - 39.5, 5, 5);
            } else {
              ctx.fillStyle = pip;
              ctx.fillRect(sx2, ty - 40, 6, 6);
            }
            sx2 += 9;
          }
        }
      }
      void v; void p;
    }

    // floating damage numbers
    for (const f of this.floats) {
      v.set(f.wx, 0.95, f.wy);
      this.engine.worldToUi(v, p);
      if (p.behind) continue;
      const k = f.t / 1.3;
      const rise = f.lift + 34 * (1 - Math.pow(1 - k, 2));
      ctx.globalAlpha = Math.max(0, 1 - Math.pow(k, 2.4));
      ctx.font = `bold ${f.big ? 20 : 15}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(f.text, p.x, p.y - rise);
      ctx.fillStyle = hexCss(f.colour);
      ctx.fillText(f.text, p.x, p.y - rise);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }
  }

  private drawTopBar(ctx: CanvasRenderingContext2D, W: number): void {
    ctx.font = '9px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(232,217,176,0.55)';
    ctx.fillText(`DEPTH ${'I'.repeat(Math.min(5, this.state.depth))}`, 12, 12);

    ctx.textAlign = 'right';
    ctx.fillStyle = GOLD;
    // Run total plus the bank. Showing only the run made banked stars look lost.
    const total = this.bankedStars + this.state.stars;
    ctx.fillText(`✦ ${total}`, W - 12, 12);
    if (this.state.stars > 0) {
      ctx.font = '8px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255,207,92,0.6)';
      ctx.fillText(`+${this.state.stars} this run`, W - 12, 23);
      ctx.font = '9px ui-monospace, monospace';
    }
    ctx.textAlign = 'left';
    void 0;
  }

  /**
   * Minimap, top-right. Deliberately crude: a 9x9 window of hard cells centred on
   * you, floor light, wall dark, one-pixel gaps between them.
   *
   * The only question it has to answer is "is there a wall on that side of me",
   * and it has to answer it at a glance. A prettier, zoomed-out map answered it
   * worse, so this trades all of its range for legibility. Walls adjacent to
   * explored floor are drawn too — you can see the wall you are standing against
   * even if you never walked into it, and floor you have walked is brighter than
   * floor you have only seen.
   */
  private drawMiniMap(ctx: CanvasRenderingContext2D, W: number): void {
    if (!this.map) return;
    const { floor, x: px, y: py, dir } = this.map();
    const g = floor.grid;

    const SPAN = 4;                       // tiles either side of the player
    const CELL = 11;                      // px per tile — big enough to count
    const N = SPAN * 2 + 1;
    const SIZE = N * CELL + 6;
    const ox = W - SIZE - 10, oy = 28;

    rr(ctx, ox, oy, SIZE, SIZE, 5);
    ctx.fillStyle = 'rgba(8,5,11,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,194,62,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const gx = ox + 3, gy = oy + 3;

    /**
     * HEADING-LOCKED: the map rotates with you, so "up" on the map is always the
     * way you are facing. In a stepper the question is never "where is north", it
     * is "do I turn left or right" — and answering that off a world-aligned map
     * means doing the rotation in your head every time.
     *
     * Facing is always cardinal, so this is an exact remap of which cell to
     * sample. Nothing is interpolated and the grid stays perfectly crisp.
     */
    const [fx, fy] = DIR_VEC[dir];
    const [rx, ry] = DIR_VEC[((dir + 1) % 4) as Dir];
    /** screen offset (right, down) -> world tile offset */
    const toWorld = (a: number, b: number): [number, number] =>
      [a * rx - b * fx, a * ry - b * fy];

    /** A wall counts as known once any neighbouring floor tile has been seen. */
    const known = (tx: number, ty: number): boolean => {
      if (!g.inside(tx, ty)) return false;
      if (g.explored[g.idx(tx, ty)]) return true;
      for (const [dx, dy] of DIR_VEC) {
        const nx = tx + dx, ny = ty + dy;
        if (g.inside(nx, ny) && g.explored[g.idx(nx, ny)] && g.tiles[g.idx(nx, ny)] !== Tile.Wall) {
          return true;
        }
      }
      return false;
    };

    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const [wdx, wdy] = toWorld(i - SPAN, j - SPAN);
        const tx = px + wdx, ty = py + wdy;
        const cx = gx + i * CELL, cy = gy + j * CELL;
        if (!known(tx, ty)) continue;
        const wall = !g.inside(tx, ty) || g.tiles[g.idx(tx, ty)] === Tile.Wall;
        // Three levels, not two: wall, floor you have only SEEN, and floor you
        // have actually walked. The map is heading-locked, so without the third
        // level you cannot tell which way you came in after a couple of turns.
        // one-pixel inset gives every cell a hard edge, so the grid is countable
        ctx.fillStyle = wall ? '#2b2029'
          : g.visited[g.idx(tx, ty)] ? '#c9b590'
          : '#6a5c48';
        ctx.fillRect(cx + 1, cy + 1, CELL - 2, CELL - 2);
      }
    }

    // things worth walking toward, mapped through the same rotation
    for (const e of floor.entities) {
      if (!e.alive) continue;
      if (!g.inside(e.sprite.tx, e.sprite.ty)) continue;
      if (!g.explored[g.idx(e.sprite.tx, e.sprite.ty)]) continue;
      const edx = e.sprite.tx - px, edy = e.sprite.ty - py;
      // project the world offset onto the player's right / forward axes
      const a = edx * rx + edy * ry;
      const b = -(edx * fx + edy * fy);
      if (Math.abs(a) > SPAN || Math.abs(b) > SPAN) continue;
      const col = e.kind === 'altar' ? (e.spent ? '#6a5a80' : '#b98cff')
        : e.kind === 'chest' ? (e.spent ? '#7a6a44' : '#ffcf5c')
        : e.kind === 'stairs' ? '#8ce0ff'
        : e.kind === 'boss' ? '#ff4a4a'
        : e.hostile ? '#e0553c'
        : e.animated ? '#8ce06a'
        : '#8a7a68';
      const cx = gx + (a + SPAN) * CELL, cy = gy + (b + SPAN) * CELL;
      ctx.fillStyle = col;
      ctx.fillRect(cx + 3, cy + 3, CELL - 6, CELL - 6);
    }

    // the player, dead centre, as a wedge so facing is unambiguous
    const pcx = gx + SPAN * CELL + CELL / 2;
    const pcy = gy + SPAN * CELL + CELL / 2;
    // The map rotates, so the marker is a fixed up-arrow. A rotating arrow on a
    // rotating map would cancel out and tell you nothing.
    ctx.fillStyle = '#fff8e4';
    ctx.strokeStyle = '#1a1016';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pcx, pcy - 5);
    ctx.lineTo(pcx - 4.2, pcy + 4);
    ctx.lineTo(pcx + 4.2, pcy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawShout(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    if (this.discover) {
      const k = this.discover.t / 2.4;
      ctx.globalAlpha = Math.min(1, (1 - k) * 2.5);
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = hexCss(this.discover.colour);
      ctx.fillText(this.discover.text, W / 2, H * 0.30);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }
    if (!this.shout) return;
    const k = this.shout.t / 1.5;
    // punch in, hold, fade out
    const scale = k < 0.14 ? 0.7 + (k / 0.14) * 0.42 : 1.02 - k * 0.04;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (1 - k) * 2.2));
    ctx.translate(W / 2, H * 0.355);
    ctx.scale(scale, scale);
    ctx.font = 'bold 19px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.strokeText(this.shout.text, 0, 0);
    ctx.fillStyle = hexCss(this.shout.colour);
    ctx.fillText(this.shout.text, 0, 0);
    ctx.restore();
  }

  /**
   * The resolved fusion name, with CAST. The torn pages themselves are
   * real 3D objects fanned above the book, so this bar only has to name the
   * result — which is the one thing you cannot read off the pages.
   */
  private drawCastBar(ctx: CanvasRenderingContext2D, W: number): void {
    const cast = this.currentCast();
    if (!cast) return;
    const ok = !cast.refusal;
    // A refusal has to say what to DO about it. "Animate needs an object" with
    // no next step is why this read as the game being broken.
    let hint = cast.refusal ?? '';
    // Only rewrite the refusal into a targeting hint when targeting is actually
    // the problem — a hand with no element is refused whatever it is aimed at.
    const hasElement = this.tornIds.some(isElement);
    if (!ok && hasElement && this.tornIds.includes('animate')) {
      const anyObject = this.candidates.some((e) => e.kind === 'prop' && !e.animated);
      hint = anyObject
        ? 'Tap an object (violet ring) to animate it'
        : 'No object in sight — find furniture to animate';
    }
    const label = ok ? `${cast.name}  ·  CAST` : hint;
    ctx.font = ok ? 'bold 13px ui-monospace, monospace' : '9.5px ui-monospace, monospace';
    const tw = Math.min(W - 32, ctx.measureText(label).width + 44);
    // Directly beneath the torn pages: the button is the end of the gesture
    // chain, so it sits tight under the hand you just assembled rather than
    // floating in its own band.
    // Clear of the chapter tabs, which poke up past the book's top edge.
    const bx = (W - tw) / 2, by = this.bookTop - 62;
    rr(ctx, bx, by, tw, 32, 16);
    ctx.fillStyle = ok ? 'rgba(28,18,12,0.9)' : 'rgba(70,26,26,0.86)';
    ctx.fill();
    ctx.strokeStyle = ok ? hexCss(cast.colour, 0.95) : 'rgba(255,120,120,0.7)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = ok ? '#fff6df' : '#ffb0a0';
    ctx.fillText(label, W / 2, by + 16.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    if (ok) this.hits.push({ rect: [bx, by, tw, 32], action: { kind: 'cast' } });

    // What this hand cost. Its own pill, clear ABOVE the log's top line: the
    // readout used to sit with its baseline exactly on that line, so a wide cast
    // pill pushed it into the log's first message and the two read as one string.
    // Left-aligned rather than right, which is where the cycle-target button lives
    // once there is more than one thing to shoot at.
    if (this.assemblyTurns > 0) {
      const cost = `${this.assemblyTurns} turn${this.assemblyTurns > 1 ? 's' : ''} spent`;
      ctx.font = '9px ui-monospace, monospace';
      const pw = ctx.measureText(cost).width + 16;
      const py = by - 26;
      rr(ctx, bx, py, pw, 16, 8);
      ctx.fillStyle = 'rgba(14,9,16,0.82)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,207,92,0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textBaseline = 'middle';
      ctx.fillStyle = GOLD;
      ctx.fillText(cost, bx + 8, py + 8.5);
      ctx.textBaseline = 'top';
    }
  }

  /**
   * The fusion ceiling: how many components you can hold, and how many you are
   * holding.
   *
   * Always on, because hand size is the number the whole turn economy is priced
   * against and nothing else in the game ever states it — at a hand of one the
   * player's only encounter with it was a refused swipe. Information, not a
   * control, so it takes no hit region.
   */
  private drawHand(ctx: CanvasRenderingContext2D): void {
    // A debug-lifted hand can hold more than the real ceiling; show the larger of
    // the two rather than rendering a fraction that reads as a bug.
    const cap = Math.max(this.handSize, this.handHeld);
    const full = this.handHeld >= cap;
    const y = 50;
    const w = this.pill(ctx, 12, y, `HAND ${this.handHeld}/${cap}`,
      full ? GOLD : PARCH, full ? 'rgba(255,207,92,0.75)' : 'rgba(232,217,176,0.28)');
    /**
     * Banked reroll charges, next to hand size and in the altar modal's blue, so
     * the thing you hold and the button that spends it are visibly the same
     * currency. Only while you hold one — an always-on "×0" is noise — and with no
     * hit region, because an altar is the only place a charge can be spent.
     */
    if (this.state.rerolls > 0) {
      this.pill(ctx, 12 + w + 6, y, `↻ REROLL ×${this.state.rerolls}`,
        '#cfe6ff', 'rgba(140,200,255,0.6)');
    }
  }

  /**
   * The star tree's pinned goal, in the run that is earning it.
   *
   * Left column, under the hand pill, because the top-right of this screen is the
   * minimap's and the centre is the party bar's. A readout and not a control: the
   * only place a pin can be set or cleared is the tree, and the only thing this has
   * to do here is make the number the player is banking toward visible while they
   * bank it. Absent entirely when nothing is pinned — an always-on empty goal is
   * noise, and this screen has no pixels to spare for it.
   */
  private drawPin(ctx: CanvasRenderingContext2D): void {
    const p = this.pinGoal;
    if (!p) return;
    const total = this.bankedStars + this.state.stars;
    const done = total >= p.need;
    this.pill(ctx, 12, 67, `✦ ${total} / ${p.need}`,
      done ? GOLD : '#cfe6ff', done ? 'rgba(255,207,92,0.75)' : 'rgba(140,200,255,0.5)');
    ctx.font = '7.5px ui-monospace, monospace';
    ctx.fillStyle = done ? 'rgba(255,207,92,0.7)' : 'rgba(180,210,240,0.6)';
    ctx.fillText(done ? `${p.name.toUpperCase()} · AFFORDED` : p.name.toUpperCase(), 12, 84);
  }

  /** One small readout pill, in the HUD's one shape. Returns its width. */
  private pill(
    ctx: CanvasRenderingContext2D, x: number, y: number, label: string, fg: string, edge: string,
  ): number {
    ctx.font = '8px ui-monospace, monospace';
    const w = ctx.measureText(label).width + 14, h = 14;
    rr(ctx, x, y, w, h, 7);
    ctx.fillStyle = 'rgba(14,9,16,0.7)';
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = fg;
    ctx.fillText(label, x + 7, y + h / 2 + 0.5);
    ctx.textBaseline = 'top';
    return w;
  }

  private drawLog(ctx: CanvasRenderingContext2D, W: number): void {
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const y0 = this.bookTop - 66;
    this.log.forEach((l, i) => {
      const age = Math.max(0, 1 - Math.max(0, l.t - 3.4) / 1.6);
      ctx.globalAlpha = 0.85 * age;
      ctx.fillStyle = hexCss(l.colour);
      ctx.fillText(l.text, W / 2, y0 + i * 12);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  private drawVitals(ctx: CanvasRenderingContext2D, W: number): void {
    // Top-left, under the depth label. Anchoring this to the book put it right
    // where the torn pages fan out.
    const y = 28;
    const bw = W * 0.34;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    rr(ctx, 12, y, bw, 9, 4); ctx.fill();
    const frac = Math.max(0, this.state.hp / this.state.maxHp);
    ctx.fillStyle = frac > 0.34 ? '#c9382a' : '#ff5a3c';
    rr(ctx, 13, y + 1, Math.max(0, (bw - 2) * frac), 7, 3); ctx.fill();
    ctx.font = '8px ui-monospace, monospace';
    ctx.fillStyle = PARCH;
    ctx.fillText(`${Math.max(0, this.state.hp)}/${this.state.maxHp}`, 14, y + 12);
    void W;

  }

  /**
   * Why the open page will not tear. Without this the only feedback for an
   * unlearned spell was the tear snapping back, which is indistinguishable from
   * the gesture having failed.
   */
  private drawSealedNote(ctx: CanvasRenderingContext2D, W: number): void {
    if (!this.sealedPage) return;
    const label = `${this.sealedPage.toUpperCase()} — NOT YET LEARNED`;
    ctx.font = '9px ui-monospace, monospace';
    const tw = ctx.measureText(label).width + 26;
    const bx = (W - tw) / 2, by = this.bookTop + 6;
    rr(ctx, bx, by, tw, 20, 10);
    ctx.fillStyle = 'rgba(14,10,18,0.86)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,140,160,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(200,195,210,0.9)';
    ctx.fillText(label, W / 2, by + 10.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  }

  /**
   * The party bar: your animated golems, top-centre, with health.
   * They follow you around now, so you need to know they exist and how hurt they
   * are without hunting for them in the room.
   */
  private drawParty(ctx: CanvasRenderingContext2D, W: number): void {
    const party = this.combat.party;
    if (!party.length) return;
    const cw = 46, ch = 30, gap = 5;
    const total = party.length * cw + (party.length - 1) * gap;
    let x = (W - total) / 2;
    const y = 8;
    for (const g of party) {
      rr(ctx, x, y, cw, ch, 4);
      ctx.fillStyle = 'rgba(24,16,30,0.86)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(140,224,106,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // a thumbnail of the golem's own sprite, so you can tell them apart
      const img = (this.spriteImg(g.spriteId));
      if (img) {
        const sc = Math.min((cw - 8) / img.width, (ch - 10) / img.height);
        const iw = img.width * sc, ih = img.height * sc;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, x + (cw - iw) / 2, y + 2, iw, ih);
        ctx.imageSmoothingEnabled = true;
      }
      // health
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x + 4, y + ch - 6, cw - 8, 3);
      ctx.fillStyle = '#8ce06a';
      ctx.fillRect(x + 4, y + ch - 6, (cw - 8) * Math.max(0, g.hp / g.maxHp), 3);
      x += cw + gap;
    }
  }

  /** Pull the raw <img> behind a loaded sprite texture, for HUD thumbnails. */
  private spriteImg(id: string): HTMLImageElement | null {
    const tex = spriteTexture(id);
    const img = tex?.image as HTMLImageElement | undefined;
    return img && img.width ? img : null;
  }

  /**
   * The elements currently in the hand, for the two questions that are about the
   * ELEMENT rather than the resolved cast: what an object would answer to, and
   * whether there is anything castable at all.
   */
  private handElements(): Element[] {
    const out: Element[] = [];
    for (const id of this.tornIds) {
      const el = SPELL_BY_ID[id]?.element;
      if (el && el !== 'none' && !out.includes(el)) out.push(el);
    }
    return out;
  }

  /** The fixture element the object in reach would give up, or null. */
  private harvestTarget(): { entity: Entity; id: string } | null {
    const e = this.harvestInReach;
    if (!e || !e.alive) return null;
    // `hp <= 0` is a body playing its death animation — it is still `alive` until the
    // sprite is gone, and offering to harvest a barrel that is in pieces was the one
    // way this pill could contradict the room.
    if (e.kind !== 'prop' || e.animated || e.hp <= 0) return null;
    const id = harvestOf(e.spriteId);
    return id ? { entity: e, id } : null;
  }

  /**
   * HARVEST: the room's own element, offered on the thing that supplies it.
   *
   * Drawn for the fixture you are standing at and FACING, and for nothing else
   * (`docs/DESIGN.md`, Reaching) — so it comes and goes with the rule rather than
   * staying lit across the room and refusing. Nothing to do with the reticle: it
   * appears whether or not you have tapped the thing, because at one tile ahead
   * there is only ever one thing it could mean.
   *
   * A full hand DIMS it rather than hiding it or shouting: at a hand of one a full
   * hand is the steady state, so an alarm here would be permanent, and a control that
   * disappears exactly when you start using the system teaches that it was never
   * there. It keeps its hit region, exactly like a tear does — the gesture stays
   * available and `harvestFrom` says why it will not happen.
   */
  private drawHarvest(ctx: CanvasRenderingContext2D, W: number): void {
    const h = this.harvestTarget();
    if (!h) return;
    const def = SPELL_BY_ID[h.id];
    const full = this.handHeld >= Math.max(this.handSize, 1);
    const label = `HARVEST  ·  ${(def?.name ?? h.id).toUpperCase()}`;
    ctx.font = 'bold 12px ui-monospace, monospace';
    const tw = Math.min(W - 32, ctx.measureText(label).width + 40);
    /**
     * The prompt band, above the hand: a card in the fan reaches to about
     * `bookTop - 200` and its glow above that, so anything lower is drawn across the
     * component you just took. It can share the altar prompt's row outright — both
     * say "there is something here to take", and both now describe the ONE tile in
     * front of you, so a fixture and an altar can no longer both be in reach.
     */
    const bx = (W - tw) / 2, by = this.bookTop - 300;
    const col = def?.colour ?? 0xffcf5c;
    ctx.globalAlpha = full ? 0.42 : 1;
    rr(ctx, bx, by, tw, 28, 14);
    ctx.fillStyle = 'rgba(22,16,28,0.9)';
    ctx.fill();
    // Pulsed like the altar prompt: both are "there is something here to take".
    if (!full) ctx.globalAlpha = 0.7 + Math.sin(this.engine.time * 3.4) * 0.24;
    ctx.strokeStyle = hexCss(col, 0.95);
    ctx.lineWidth = 1.7;
    ctx.stroke();
    ctx.globalAlpha = full ? 0.42 : 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = hexCss(col);
    ctx.fillText(label, W / 2, by + 14.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.globalAlpha = 1;
    this.hits.push({ rect: [bx, by, tw, 28], action: { kind: 'harvest', entity: h.entity } });
  }

  /**
   * "Take the spell" prompt. Collecting used to happen by walking into the altar,
   * which meant it fired while the altar was behind you and out of frame — you
   * got a spell from something you never saw. Now it is a deliberate tap, on an
   * altar you are standing at and facing, so the prompt always has its subject on
   * the screen with it.
   */
  private drawAltarPrompt(ctx: CanvasRenderingContext2D, W: number): void {
    const e = this.altarInReach;
    if (!e || !e.alive || e.spent) return;
    const t = this.engine.time;
    const chest = e.kind === 'chest';
    const label = chest ? 'TAP TO OPEN' : 'TAP THE ALTAR';
    ctx.font = 'bold 11px ui-monospace, monospace';
    const tw = ctx.measureText(label).width + 40;
    const bx = (W - tw) / 2, by = this.bookTop - 300;
    const pulse = 0.72 + Math.sin(t * 3.4) * 0.22;
    rr(ctx, bx, by, tw, 28, 14);
    ctx.fillStyle = chest ? 'rgba(56,40,14,0.9)' : 'rgba(40,24,60,0.9)';
    ctx.fill();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = chest ? '#ffcf5c' : '#b98cff';
    ctx.lineWidth = 1.7;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = chest ? '#fff0c8' : '#e8d8ff';
    ctx.fillText(label, W / 2, by + 14.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    this.hits.push({
      rect: [bx, by, tw, 28],
      action: chest ? { kind: 'chest', entity: e } : { kind: 'altar', entity: e },
    });
  }

  /**
   * The grimoire tab — always the same pill, dead centre at the bottom, so it is
   * one consistent target that toggles rather than a control that moves and
   * changes shape depending on state.
   */
  private drawBookToggle(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const closed = this.bookClosed;
    const label = closed ? 'OPEN SPELLBOOK' : 'CLOSE SPELLBOOK';
    ctx.font = 'bold 10px ui-monospace, monospace';
    const w = ctx.measureText(label).width + 34;
    const h = 26;
    const bx = (W - w) / 2, by = H - h - 8;
    rr(ctx, bx, by, w, h, 13);
    ctx.fillStyle = closed ? 'rgba(124,59,82,0.94)' : 'rgba(30,18,26,0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,194,62,0.85)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe6b0';
    ctx.fillText(label, W / 2, by + h / 2 + 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    this.hits.push({ rect: [bx - 10, by - 10, w + 20, h + 20], action: { kind: 'bookToggle' } });
  }

  /** Cycle-target button — sits clear of the swipe area. */
  private drawCycle(ctx: CanvasRenderingContext2D, W: number): void {
    const r = 18, cx = W - 30, cy = this.bookTop - 62;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(18,12,22,0.78)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,207,92,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(232,217,176,0.9)';
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText('\u25ce', cx, cy + 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    this.hits.push({ rect: [cx - r - 5, cy - r - 5, r * 2 + 10, r * 2 + 10], action: { kind: 'cycle' } });
  }

  private drawDescend(ctx: CanvasRenderingContext2D, W: number): void {
    const label = 'DESCEND \u25bc';
    ctx.font = 'bold 12px ui-monospace, monospace';
    const tw = ctx.measureText(label).width + 40;
    const bx = (W - tw) / 2, by = this.bookTop - 258;
    rr(ctx, bx, by, tw, 30, 15);
    ctx.fillStyle = 'rgba(255,229,138,0.20)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,229,138,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff6df';
    ctx.fillText(label, W / 2, by + 15);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    this.hits.push({ rect: [bx, by, tw, 30], action: { kind: 'descend' } });
  }

  /**
   * The altar's three offers. A modal, because this is the one moment in a run
   * where the player should be reading rather than reacting.
   */
  private drawOffers(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const offers = this.offers!;
    ctx.fillStyle = 'rgba(8,5,12,0.86)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.fillStyle = '#b98cff';
    ctx.fillText('THE ALTAR OFFERS', W / 2, H * 0.16);
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(232,217,176,0.55)';
    ctx.fillText('choose one', W / 2, H * 0.16 + 16);

    const cw = W - 48, x = 24, gap = 12;
    /**
     * Cards are MEASURED, not fixed. A card with a two-line body and a price has
     * half again the content of a bare one, and one shared height either clips the
     * long card or hollows out the short ones — on the only screen in the game
     * that is meant to be read.
     */
    ctx.font = '9px ui-monospace, monospace';
    const bodies = offers.map((o) => wrapLines(ctx, o.detail, cw - 40));
    ctx.font = 'bold 8.5px ui-monospace, monospace';
    const prices = offers.map((o) => (o.cost ? wrapLines(ctx, o.cost, cw - 52) : []));
    const heights = offers.map((_, i) =>
      50 + bodies[i].length * 12 + (prices[i].length ? 17 + prices[i].length * 11 : 8));

    let y = H / 2 - (heights.reduce((a, b) => a + b, 0) + (offers.length - 1) * gap) / 2;

    offers.forEach((o, i) => {
      const ch = heights[i];
      /** Top of the price band, or 0 when this offer is free. */
      const py = prices[i].length ? y + 54 + bodies[i].length * 12 : 0;
      /**
       * The sacrifice is the only offer that destroys a page you own, and it wears
       * that page's colour — which on Frostbolt is the same cold blue as a reroll
       * charge, the most harmless card in the roll. So the frame stops being the
       * page's colour and becomes an alarm; the leading edge keeps the colour,
       * because WHICH page is still what the offer is about.
       */
      const danger = o.kind === 'sacrifice';

      if (o.golden) {
        // The only card in the game that glows. A golden page is the one thing that
        // crosses a run boundary at all, and it shows up in maybe half of a full
        // run's altars — it cannot be a card you skim.
        const pulse = 0.6 + Math.sin(this.engine.time * 2.4) * 0.4;
        ctx.save();
        ctx.shadowColor = `rgba(255,207,92,${0.35 + pulse * 0.35})`;
        ctx.shadowBlur = 9 + pulse * 11;
      }
      rr(ctx, x, y, cw, ch, 8);
      if (o.golden) {
        const g = ctx.createLinearGradient(x, y, x, y + ch);
        g.addColorStop(0, 'rgba(78,56,20,0.97)');
        g.addColorStop(1, 'rgba(30,22,13,0.97)');
        ctx.fillStyle = g;
      } else ctx.fillStyle = danger ? 'rgba(40,16,13,0.96)' : 'rgba(26,18,32,0.96)';
      ctx.fill();
      ctx.strokeStyle = o.golden ? GOLD : danger ? '#ff6a3c' : hexCss(o.colour, 0.9);
      ctx.lineWidth = o.golden ? 2.2 : danger ? 1.8 : 1.6;
      // Perforated, and nothing else on the modal is: an alarm colour alone cannot
      // carry "this destroys a page" when a fire page's own colour is that orange.
      // A tear-here line is what the offer literally does.
      if (danger) ctx.setLineDash([7, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (o.golden) ctx.restore();

      if (o.golden) {
        // A gilded edge: double rule and picked-out corners, the two marks a
        // hand-illuminated page has and a printed one does not.
        rr(ctx, x + 4.5, y + 4.5, cw - 9, ch - 9, 5);
        ctx.strokeStyle = 'rgba(255,207,92,0.38)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.strokeStyle = GOLD;
        ctx.beginPath();
        for (const [cx, cy, sx, sy] of [
          [x + 4.5, y + 4.5, 1, 1], [x + cw - 4.5, y + 4.5, -1, 1],
          [x + 4.5, y + ch - 4.5, 1, -1], [x + cw - 4.5, y + ch - 4.5, -1, -1],
        ] as const) {
          ctx.moveTo(cx + sx * 7, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * 7);
        }
        ctx.stroke();
      }

      // A colour flash down the leading edge, so the three read as distinct. Held
      // clear of the frame on the two cards whose frame is not a plain line — the
      // gilded rule and the tear line both chop a strip drawn under them into
      // something that looks like a rendering fault. Stopped above the price band
      // for the same reason: run behind it, it reads as a bar half full of mud.
      const inset = o.golden || danger;
      const flashTop = y + (inset ? 14 : 10);
      const flashEnd = py ? py - 4 : y + ch - (inset ? 14 : 10);
      ctx.fillStyle = hexCss(o.colour, 0.85);
      ctx.fillRect(x + (inset ? 8 : 1), flashTop, inset ? 3 : 4, flashEnd - flashTop);

      ctx.textAlign = 'left';
      ctx.font = '8px ui-monospace, monospace';
      ctx.fillStyle = danger ? 'rgba(255,150,110,0.95)'
        : o.golden ? 'rgba(255,207,92,0.9)'
        : hexCss(o.colour, 0.8);
      ctx.fillText(o.tag, x + 18, y + 12);

      // The headline carries the whole card: serif, big, and the only bright thing
      // on it, so the eye lands on WHAT this is before the small print.
      ctx.font = 'bold 16px ui-serif, Georgia, serif';
      ctx.fillStyle = o.golden ? GOLD : '#fff4dc';
      ctx.fillText(o.name, x + 18, y + 26);

      // NEXT RUN and not PERMANENT: the seal is the card's one-word summary, and
      // the whole of what a golden page is now is WHEN it pays out.
      if (o.golden) this.drawSeal(ctx, x + cw - 14, y + 10, 'NEXT RUN');
      else if (o.toRank > 0) this.drawRankPips(ctx, x + cw - 14, y + 13, o);

      ctx.font = '9px ui-monospace, monospace';
      // Warmer and brighter on the gilded card: the same grey on its lit ground is
      // the one place the body copy loses its contrast.
      ctx.fillStyle = o.golden ? 'rgba(255,240,206,0.88)' : 'rgba(226,216,200,0.72)';
      bodies[i].forEach((ln, k) => ctx.fillText(ln, x + 18, y + 50 + k * 12));

      // The price, on the card, BEFORE it is taken — only the rank-3 sacrifice has
      // one, because it is the only offer that takes something away for good.
      // A banded row with a warning disc rather than one more line of body text:
      // a player who meets this price in the log afterwards was tricked by the UI.
      if (py) {
        ctx.save();
        rr(ctx, x, y, cw, ch, 8);
        ctx.clip();
        ctx.fillStyle = 'rgba(96,30,16,0.58)';
        ctx.fillRect(x, py, cw, ch - (py - y));
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,120,70,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 1, py + 0.5); ctx.lineTo(x + cw - 1, py + 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + 24, py + 12, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ff6a3c';
        ctx.fill();
        ctx.font = 'bold 9px ui-monospace, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#1c0b06';
        ctx.fillText('!', x + 24, py + 12.5);
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.font = 'bold 8.5px ui-monospace, monospace';
        ctx.fillStyle = '#ffc0a4';
        prices[i].forEach((ln, k) => ctx.fillText(ln, x + 34, py + 7 + k * 11));
      }

      this.hits.push({ rect: [x, y, cw, ch], action: { kind: 'offer', offer: o } });
      y += ch + gap;
    });

    // A reroll charge is spendable HERE and nowhere else, so the modal is the only
    // place it can be reached.
    if (this.state.rerolls > 0) {
      const label = `↻  REROLL  ×${this.state.rerolls}`;
      ctx.font = 'bold 10px ui-monospace, monospace';
      const tw = ctx.measureText(label).width + 36;
      const bx = (W - tw) / 2, by = y + 8, bh = 28;
      rr(ctx, bx, by, tw, bh, 14);
      ctx.fillStyle = 'rgba(18,30,50,0.94)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(140,200,255,0.85)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#d6ecff';
      ctx.fillText(label, W / 2, by + bh / 2 + 0.5);
      ctx.font = '8px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(140,200,255,0.55)';
      ctx.textBaseline = 'top';
      ctx.fillText('spends a charge · turns all three over', W / 2, by + bh + 6);
      // Padded, because it is the one small control on a screen of large ones.
      this.hits.push({ rect: [bx - 8, by - 8, tw + 16, bh + 16], action: { kind: 'reroll' } });
    }
    ctx.textAlign = 'left';
  }

  /**
   * Rank as a MOVE, not a destination.
   *
   * The pips you hold are the page's own dimmed colour, then a caret, then the
   * ones this offer adds in bright gold — so the card says "you have one, this
   * makes two" at a glance, which a bare "Rank 2" never does. The caret carries
   * that on its own: Spark's colour IS gold, so hue alone cannot be the
   * difference between owned and gained. Anchored to the card's right edge.
   */
  private drawRankPips(ctx: CanvasRenderingContext2D, right: number, top: number, o: AltarOffer): void {
    const S = 8, G = 4, CARET = 8;
    // No caret on a page you do not hold yet: there is nothing to its left for the
    // move to come FROM, and it reads as a stray glyph.
    const caret = o.rank > 0 && o.toRank > o.rank;
    let px = right - (o.maxRank * S + (o.maxRank - 1) * G + (caret ? CARET : 0));
    ctx.font = '7px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(232,217,176,0.42)';
    ctx.fillText('RANK', px - 7, top + 1);
    ctx.textAlign = 'left';
    for (let i = 0; i < o.maxRank; i++) {
      if (caret && i === o.rank) {
        ctx.font = 'bold 9px ui-monospace, monospace';
        ctx.fillStyle = GOLD;
        ctx.fillText('›', px + 1, top);
        px += CARET;
      }
      if (i >= o.rank && i < o.toRank) {
        ctx.save();
        ctx.shadowColor = 'rgba(255,207,92,0.9)';
        ctx.shadowBlur = 7;
        ctx.fillStyle = GOLD;
        ctx.fillRect(px, top, S, S);
        ctx.restore();
      } else if (i < o.rank) {
        ctx.fillStyle = hexCss(o.colour, 0.5);
        ctx.fillRect(px, top, S, S);
      } else {
        ctx.strokeStyle = 'rgba(232,217,176,0.26)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, top + 0.5, S - 1, S - 1);
      }
      px += S + G;
    }
  }

  /** The golden card's stamp: what makes it different is WHEN it pays out. */
  private drawSeal(ctx: CanvasRenderingContext2D, right: number, top: number, label: string): void {
    ctx.font = 'bold 7.5px ui-monospace, monospace';
    const w = ctx.measureText(label).width + 14, h = 14;
    const bx = right - w;
    rr(ctx, bx, top, w, h, 7);
    ctx.fillStyle = 'rgba(255,207,92,0.9)';
    ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2a1c06';
    ctx.fillText(label, bx + w / 2, top + h / 2 + 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  }

  /**
   * The end of a run, and the way on from it.
   *
   * The moment has to LAND \u2014 the depth reached and the stars it paid, held still \u2014
   * and then it has to lead somewhere, because a run that banks stars and offers
   * nowhere to spend them is the dead end this card used to be. So the second half
   * of it is a door to the star tree rather than "tap to return to the surface".
   */
  private drawRunEnd(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const end = this.runEnd!;
    const won = end.kind === 'won';
    // Heavier than a modal veil: the grimoire is a lit 3D object in the overlay pass
    // and it reads straight through a light one, so the card ends up sharing the
    // frame with a page of Frostbolt.
    ctx.fillStyle = 'rgba(8,4,10,0.86)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.font = `bold ${won ? 17 : 22}px ui-monospace, monospace`;
    ctx.fillStyle = won ? '#ffe58a' : '#d8452f';
    ctx.fillText(won ? 'THE VAULT IS YOURS' : 'YOU DIED', W / 2, H * 0.38);
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = PARCH;
    ctx.fillText(
      `depth ${end.depth}  \u00b7  \u2726 ${end.earned} earned  \u00b7  \u2726 ${this.bankedStars + end.earned} banked`,
      W / 2, H * 0.44,
    );
    if (won) {
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255,229,138,0.72)';
      ctx.fillText('You have taken everything the dungeon had. For now.', W / 2, H * 0.475);
    }

    const label = 'SPEND AT THE STAR TREE  \u25b8';
    ctx.font = 'bold 12px ui-monospace, monospace';
    const bw = Math.min(W - 56, ctx.measureText(label).width + 44), bh = 40;
    const bx = (W - bw) / 2, by = Math.round(H * 0.51);
    rr(ctx, bx, by, bw, bh, 20);
    ctx.fillStyle = 'rgba(46,30,58,0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,194,62,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe6b0';
    ctx.fillText(label, W / 2, by + bh / 2 + 0.5);
    ctx.textBaseline = 'top';
    ctx.font = '8px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(232,217,176,0.45)';
    ctx.fillText('a new run starts from there', W / 2, by + bh + 9);
    ctx.textAlign = 'left';
    this.hits.push({ rect: [bx - 8, by - 8, bw + 16, bh + 16], action: { kind: 'tree' } });
  }

  /**
   * Hit-test a tap.
   *
   * Buttons win outright (they are drawn on top and are unambiguous). For world
   * targets, the NEAREST one to the tap point wins rather than whichever happened
   * to be registered last — with several creatures overlapping on screen, "last
   * drawn" is arbitrary and picking the wrong one is worse than picking none.
   */
  hit(x: number, y: number): UiAction {
    const world: { action: UiAction; d2: number }[] = [];

    for (let i = this.hits.length - 1; i >= 0; i--) {
      const [rx, ry, rw, rh] = this.hits[i].rect;
      if (x < rx || y < ry || x > rx + rw || y > ry + rh) continue;
      const a = this.hits[i].action;
      if (a.kind === 'target' || a.kind === 'altar') {
        const cx = rx + rw / 2, cy = ry + rh / 2;
        world.push({ action: a, d2: (x - cx) ** 2 + (y - cy) ** 2 });
        continue;
      }
      return a;                       // a real button
    }

    if (!world.length) return { kind: 'none' };
    world.sort((a, b) => a.d2 - b.d2);
    return world[0].action;
  }
}

/**
 * Word wrap for the offer cards, split rather than drawn: the cards size
 * themselves to their copy, so the line count has to be known before anything is
 * laid out. Measured in the caller's current font.
 */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(' ')) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      out.push(line);
      line = w;
    } else line = test;
  }
  if (line) out.push(line);
  return out;
}
