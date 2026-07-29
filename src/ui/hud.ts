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
import type { Combat, PlayerState } from '../game/combat';
import { STATUS_META, displayName, isElement, type ResolvedCast } from '../spells/spells';
import * as THREE from 'three';
import { DIR_VEC, Tile, type Dir } from '../dungeon/grid';
import { spriteTexture } from '../dungeon/sprites';
import type { Floor } from '../game/floor';

/** One of the three things an altar is offering. */
export interface AltarOffer {
  kind: 'new' | 'upgrade' | 'star';
  id: string;
  name: string;
  colour: number;
  detail: string;
}

export type UiAction =
  | { kind: 'cast' }
  | { kind: 'clear' }
  | { kind: 'target'; entity: Entity }
  | { kind: 'cycle' }
  | { kind: 'bookToggle' }
  | { kind: 'offer'; offer: AltarOffer }
  | { kind: 'altar'; entity: Entity }
  | { kind: 'chest'; entity: Entity }
  | { kind: 'move'; m: 'forward' | 'back' }
  | { kind: 'turn'; d: -1 | 1 }
  | { kind: 'descend' }
  | { kind: 'none' };

interface FloatNum { text: string; colour: number; wx: number; wy: number; t: number; big: boolean; }
interface LogLine { text: string; colour: number; t: number; }

const GOLD = '#ffcf5c';
const PARCH = '#e8d9b0';

function hexCss(n: number, a = 1): string {
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

/** Rounded rect path helper — the UI's one shape. */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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

  /** Name of the open page when it is a spell not yet learned, else null. */
  sealedPage: string | null = null;

  /** An unused altar or chest within reach, set by the game each turn. */
  altarInReach: Entity | null = null;

  /**
   * Turns the hand currently held has cost. A readout, not a control: the price
   * of a fusion is paid before you press CAST, so it has to be visible NEXT to
   * CAST or the player never connects the two.
   */
  assemblyTurns = 0;

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
    this.floats.push({ text, colour, wx, wy, t: 0, big });
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
    this.drawShout(ctx, W, H);

    // The grimoire occupies roughly the bottom third of the screen.
    this.bookTop = this.bookClosed || this.measuredBookTop === null
      ? Math.round(H * 0.90)
      : Math.round(this.measuredBookTop);
    this.drawCastBar(ctx, W);
    this.drawLog(ctx, W);
    this.drawVitals(ctx, W);
    this.drawParty(ctx, W);
    this.drawSealedNote(ctx, W);
    this.drawAltarPrompt(ctx, W);
    this.drawBookToggle(ctx, W, H);
    if (this.candidates.length > 1) this.drawCycle(ctx, W);
    if (this.descendReady) this.drawDescend(ctx, W);
    if (this.offers) this.drawOffers(ctx, W, H);
    if (this.state.hp <= 0) this.drawDeath(ctx, W, H);
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
    const hasTorn = this.tornIds.length > 0;
    const t = this.engine.time;
    const project = (pt: THREE.Vector3, out: { x: number; y: number; behind: boolean }) =>
      this.engine.worldToUi(pt, out);

    for (const e of this.candidates) {
      if (!e.alive || !e.sprite.group.visible) { e.sprite.setOutline(0xffffff, false); continue; }

      const animatable = e.kind === 'prop' && !e.animated;
      const interactive = (e.kind === 'altar' || e.kind === 'chest') && !e.spent;
      const legal = interactive ? true
        : wantsObject ? animatable
        : hasTorn ? e.hostile
        : (e.hostile || animatable);
      const isTarget = e === this.target;

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

      const col = interactive ? '#ffcf5c' : animatable ? '#b98cff' : '#ff7a5c';

      // the down triangle
      const bob = isTarget ? Math.sin(t * 5) * 2.2 : 0;
      const size = isTarget ? 8 : 5.5;
      const ty = my - 4 + bob;
      ctx.beginPath();
      ctx.moveTo(mx, ty + size);
      ctx.lineTo(mx - size * 0.85, ty - size * 0.7);
      ctx.lineTo(mx + size * 0.85, ty - size * 0.7);
      ctx.closePath();
      ctx.globalAlpha = isTarget ? 1 : (wantsObject && animatable) || interactive ? 0.8 : 0.45;
      ctx.fillStyle = isTarget ? GOLD : col;
      ctx.fill();
      ctx.strokeStyle = 'rgba(12,8,14,0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (isTarget) {
        const label = e.kind === 'chest' && !e.spent ? 'OPEN'
          : interactive ? 'TAKE A SPELL'
          : animatable && wantsObject ? `ANIMATE ${displayName(e.spriteId).toUpperCase()}`
          : displayName(e.spriteId).toUpperCase();
        ctx.font = 'bold 9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        const w = ctx.measureText(label).width + 14;
        ctx.fillStyle = 'rgba(14,9,16,0.86)';
        rr(ctx, mx - w / 2, ty - 30, w, 15, 7);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = col;
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
          let sx2 = mx - (st.length * 9) / 2;
          for (const sv of st) {
            ctx.fillStyle = hexCss(STATUS_META[sv.id].colour);
            ctx.fillRect(sx2, ty - 22, 6, 6);
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
      const rise = 34 * (1 - Math.pow(1 - k, 2));
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

    // What this hand cost, tucked above the pill's leading edge. Left-aligned
    // there rather than to the right of the pill, which is where the cycle-target
    // button lives once there is more than one thing to shoot at.
    if (this.assemblyTurns > 0) {
      ctx.font = '10px ui-monospace, monospace';
      ctx.textBaseline = 'bottom';
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = PARCH;
      ctx.fillText(`${this.assemblyTurns} turn${this.assemblyTurns > 1 ? 's' : ''}`, bx + 2, by - 4);
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'top';
    }
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
   * "Take the spell" prompt. Collecting used to happen by walking into the altar,
   * which meant it fired while the altar was behind you and out of frame — you
   * got a spell from something you never saw. Now it is a deliberate tap.
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

    const cw = W - 48, ch = 78, gap = 12;
    const total = offers.length * ch + (offers.length - 1) * gap;
    let y = H / 2 - total / 2;

    for (const o of offers) {
      const x = 24;
      rr(ctx, x, y, cw, ch, 8);
      ctx.fillStyle = 'rgba(26,18,32,0.96)';
      ctx.fill();
      ctx.strokeStyle = hexCss(o.colour, 0.9);
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // a colour flash down the leading edge, so the three read as distinct
      ctx.fillStyle = hexCss(o.colour, 0.85);
      ctx.fillRect(x + 1, y + 10, 4, ch - 20);

      const tag = o.kind === 'new' ? 'NEW SPELL'
        : o.kind === 'upgrade' ? 'UPGRADE'
        : 'CELESTIAL STARS';
      ctx.textAlign = 'left';
      ctx.font = '8px ui-monospace, monospace';
      ctx.fillStyle = hexCss(o.colour, 0.85);
      ctx.fillText(tag, x + 18, y + 14);

      ctx.font = 'bold 15px ui-serif, Georgia, serif';
      ctx.fillStyle = '#fff4dc';
      ctx.fillText(o.kind === 'star' ? '✦  +2 Stars' : o.name, x + 18, y + 30);

      ctx.font = '9px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(226,216,200,0.75)';
      wrapLeft(ctx, o.detail, x + 18, y + 52, cw - 40, 12);

      this.hits.push({ rect: [x, y, cw, ch], action: { kind: 'offer', offer: o } });
      y += ch + gap;
    }
    ctx.textAlign = 'left';
  }

  private drawDeath(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    ctx.fillStyle = 'rgba(8,4,10,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px ui-monospace, monospace';
    ctx.fillStyle = '#d8452f';
    ctx.fillText('YOU DIED', W / 2, H * 0.38);
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = PARCH;
    ctx.fillText(
      `depth ${this.state.depth}  \u00b7  \u2726 ${this.state.stars} earned  \u00b7  \u2726 ${this.bankedStars + this.state.stars} banked`,
      W / 2, H * 0.44,
    );
    ctx.fillStyle = 'rgba(232,217,176,0.6)';
    ctx.fillText('tap to return to the surface', W / 2, H * 0.52);
    ctx.textAlign = 'left';
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

/** Left-aligned word wrap for the offer cards. */
function wrapLeft(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number,
): void {
  let line = '', yy = y;
  for (const w of text.split(' ')) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = w; yy += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
}
