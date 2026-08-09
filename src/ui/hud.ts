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
  INGREDIENT_IDS, SPELL_BY_ID, STATUS_META, displayName, harvestOf, isElement,
  wantsCorpse, wantsObject,
  type Element, type ResolvedCast,
} from '../spells/spells';
import type { BeltSlot } from '../spells/belt';
import { drawBeltIcon } from './beltIcons';
import { BELT_ENABLED } from '../flags';
import type { HitFx } from '../game/hitfx';
import { Pix, hex } from '../art/pixel';
import { drawCentered, CELL_H } from '../art/bitfont';
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
  // A bundle of one belt ingredient. About a spell, but never about a PAGE, so it
  // does not satisfy the "no roll is spell-free" rule — see `rollExtras`, which is
  // where it is rolled and where it is gated on the belt being able to keep it.
  | 'heal' | 'stars' | 'reroll' | 'ingredient';

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
  /**
   * Draw an ingredient out of a belt pouch. A single tap, where the book is
   * flip-and-tear — and a CONTROL, so `UI_CONTROLS` in `main.ts` has it: the strip
   * sits under the grimoire, inside the book's own gesture zone, so without that a
   * tap on a pouch would leaf the book instead.
   */
  | { kind: 'belt'; id: string }
  /**
   * Put ONE component back — the card tapped in the fan above the grimoire. Free,
   * and it is the only way to undo a single choice: CLEAR still dumps the lot.
   *
   * A CONTROL, so `UI_CONTROLS` in `main.ts` has it, for the reason the CAST pill is
   * in there: the fan's lowest cards sit a few px above the book's top edge, and a
   * tap that jitters low must not turn into a page flip.
   */
  | { kind: 'card'; index: number }
  | { kind: 'move'; m: 'forward' | 'back' }
  | { kind: 'turn'; d: -1 | 1 }
  | { kind: 'descend' }
  /**
   * Leave a finished run for the star tree. The run-end card's own button — any
   * tap on that card goes the same way, so this is the affordance rather than the
   * only route, and it exists so the thing drawn under the thumb is a real control.
   */
  | { kind: 'tree' }
  /**
   * Coarsen the world's texel density one step, wrapping back to the finest.
   *
   * The only DISPLAY control in the game, and it is in the HUD rather than on the star
   * tree because the tree only opens from a finished run: a player whose eyes the
   * shimmer is hurting should not have to die to turn it down. It is drawn beside the
   * minimap, which is the other readout that is up from the first frame and stays up
   * over the run-end card.
   */
  | { kind: 'pixels' }
  | { kind: 'none' };

/**
 * One card of the fan, as a screen rect in CSS px.
 *
 * Supplied by the game rather than laid out here, because the fan is real 3D
 * geometry parented to the book's own camera (`src/book/fan.ts`) — the HUD cannot
 * know where a card is without projecting it, and projecting it needs the book's
 * scene. `index` is the fan index and not the array position: a card behind the
 * camera is skipped, so the two can differ.
 */
export interface HandCard {
  index: number;
  x: number; y: number; w: number; h: number;
  /** The card's roll in radians, CCW. The fan tilts every card; the badge follows. */
  rot: number;
}

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

/**
 * How much room above the book's top edge the belt strip owns, caption included.
 *
 * A named constant because three other things are laid out against it — the CAST bar,
 * the cycle button and the log all sit immediately above the strip — and the band
 * between the fan of torn pages and the book's edge is only ~83px on a 390x844 stage.
 * A magic number in four places is a band that silently overlaps the first time one of
 * them is nudged.
 *
 * ZERO while the belt is flagged off, which is the other half of not drawing the strip:
 * the band is a reservation for something that is no longer there, and 46px of held-open
 * nothing above the book's edge reads as a rendering fault. Relaxing it here puts the
 * CAST bar, the cycle button and the log back exactly where they were before the belt
 * shipped, because all three are laid out off this one constant.
 */
const BELT_BAND = BELT_ENABLED ? 46 : 0;

/**
 * The strip's own geometry, all measured DOWN FROM the book's edge.
 *
 * `LAP` is the half of this that matters: the strap is drawn 5px past the book's top
 * edge, so it passes behind the grimoire's cover rather than resting on top of it. That
 * is the fiction the design asks for — the belt is at your waist and the book is held
 * in front of it — and it is also where the pixels are, because everything above the
 * edge is spoken for. It was 8 first and the strap read as a rule ON the cover rather
 * than as a strap going behind it: most of the leather has to stay visible.
 */
const STRAP_H = 12;
const LOOP_H = 22;
const LAP = 5;
/** How long the strap tugs after a refused pickup, and how long the line stays up. */
const PULSE_S = 1.9;
const SAID_S = 3.2;

/**
 * Depth as a numeral. Spelled out rather than repeated: `'I'.repeat(depth)` printed
 * DEPTH IIII on floor 4, which is not how the game names its floors anywhere else
 * (`Roadmap/Casting_And_Movement.md` writes DEPTH IV) and was survivable only while
 * the label faded after a second and a half.
 */
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

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
  /**
   * Hostiles that can hit you before you act again — see `THREAT_REACH`.
   *
   * A SET rather than a flag on the entity because it is a fact about the player's
   * position, not about the creature: the same body is a threat from one tile and
   * not from three, and nothing about it changed in between.
   */
  threats: ReadonlySet<Entity> = new Set();
  /** What the run has learned about a creature, bound from `Combat`. */
  loreFor: ((spriteId: string) => { weak: boolean; resist: boolean } | null) | null = null;
  /** What the run knows about one species against one element, bound from `Combat`. */
  knownFor: ((spriteId: string, element: string) => string | null) | null = null;
  /**
   * A discovery to announce, and its clock. One at a time: two banners at once is
   * two things to read in a fight where there was already too much to read.
   */
  private discovery: { text: string; colour: number } | null = null;
  private discoveryT = 0;

  /**
   * How the hand in front of you lands on the creature you have selected.
   *
   * `null` when there is nothing to say — no target, no hand, or a target with no
   * affinities at all. `???` when ANY element in the hand is untested on this
   * species: a partly-known cast is an unknown cast, and claiming otherwise would be
   * the one thing this readout must never do.
   */
  castEffect(): { label: string; colour: number } | null {
    const t = this.target;
    if (!t || !this.knownFor) return null;
    const cast = this.currentCast();
    if (!cast || cast.refusal || !cast.elements.length || cast.damage <= 0) return null;
    const seen = cast.elements.map((el) => this.knownFor!(t.spriteId, el));
    if (seen.some((k) => k === null)) return { label: '???', colour: 0x9a8f80 };
    if (seen.includes('weak')) return { label: 'EFFECTIVE', colour: 0xffd166 };
    if (seen.every((k) => k === 'resist')) return { label: 'RESISTED', colour: 0x8aa0b8 };
    return { label: 'NORMAL', colour: 0xb9a88a };
  }

  /** Announce a newly discovered matchup. Called from `Combat.onDiscover`. */
  discovered(text: string, colour: number): void {
    this.discovery = { text, colour };
    this.discoveryT = 1;
  }
  /** Page ids currently torn out — decides which candidates are highlighted. */
  tornIds: string[] = [];

  private floats: FloatNum[] = [];
  private log: LogLine[] = [];
  private shout: { text: string; colour: number; t: number } | null = null;
  private discover: { text: string; colour: number; t: number } | null = null;
  /** Cached hit rects, rebuilt every draw so hit-testing matches what is drawn. */
  private hits: { rect: [number, number, number, number]; action: UiAction }[] = [];
  private hurtFlash = 0;
  /** The strike currently playing across the screen, and its 1->0 clock. */
  private hitFx: HitFx | null = null;
  private hitFxT = 0;
  private hitFxSeed = 0;
  /** Reused low-res buffer the strike is composed in. */
  private fxBuf: HTMLCanvasElement | null = null;
  /**
   * How hard you were hit from each side, relative to your FACING — index 0 ahead,
   * 1 right, 2 behind, 3 left. Each decays on its own clock, so two attackers on
   * two sides light two chevrons and the harder one stays up longer.
   */
  private hurtFrom = [0, 0, 0, 0];
  /** Reused low-res buffer the chevrons are composed in. */
  private hurtBuf: HTMLCanvasElement | null = null;
  private descendReady = false;
  /**
   * Mirrors `Book.closed`, for LAYOUT only — everything in the bottom band is placed
   * against the book's edge and there is no edge when there is no book.
   *
   * It is a mirror and never a source: the answer is derived in `bookOnScreen`
   * (`main.ts`) and written here in the same breath it is written to the book. The
   * control that used to toggle it is gone, on purpose — see `Roadmap/Casting_And_Movement.md`.
   */
  bookClosed = false;

  /**
   * This floor's name, beside the depth in the top-left.
   *
   * Permanent, because the two places it used to be said — a shout across the middle
   * of the screen and a log line — both faded, and then nothing on screen answered
   * "where am I" at all.
   */
  floorName = '';

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
   * The world's texel density, for the chip that changes it. Told, not asked: the
   * answer lives in `src/art/steps.ts` and `main.ts` writes it here on every change,
   * exactly as it does for the banked stars and the pinned goal.
   */
  pixelStep = 144;

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
   * The fusion ceiling and what is held against it, set by the game each frame.
   *
   * The one readout in this band that the rebase made MORE important, not less: a
   * cast costs one turn whatever it holds, so how many components you may hold is
   * exactly how much a turn is worth to you.
   */
  handSize = 1;
  handHeld = 0;

  /**
   * Where the fan's cards are on screen, in fan order, projected by the game each
   * frame. Empty while the hand is merging — a card already flying into the cast
   * cannot be taken back, so it must not look tappable.
   */
  handCards: HandCard[] = [];
  /**
   * The slots the hand has NOT filled, projected from the same fan transform the
   * real cards are. See `drawEmptySlots` for why they cannot be laid out here.
   */
  emptySlots: HandCard[] = [];

  /**
   * Does this body belong on the minimap right now?
   *
   * A `static` rather than an inline condition so the harness can ask the same
   * question the draw loop asks. It was inline, the harness could not reach it, and
   * the rule was wrong for a long time without anything noticing.
   *
   * Anything that MOVES has to be in SIGHT, not merely standing on explored ground.
   * Terrain can be remembered because it stays where it was — that is what the
   * dimmer explored tiles are. A creature cannot: remembering where it stood is
   * worthless the moment it walks off, and drawing it live from memory is drawing it
   * through a wall. That is what put enemies on the map with nothing on screen, and
   * it was the map lying rather than the world hiding.
   *
   * Furniture keeps the explored rule, so an altar or a chest you have found stays
   * on the map from across the floor, which is most of why a map is worth having.
   */
  static onMap(floor: Floor, e: Entity): boolean {
    const g = floor.grid;
    if (!e.alive || !g.inside(e.sprite.tx, e.sprite.ty)) return false;
    const i = g.idx(e.sprite.tx, e.sprite.ty);
    return (e.hostile || e.animated) ? floor.visible.has(i) : !!g.explored[i];
  }

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

  playerHurt(fx: HitFx | null = null): void {
    this.hurtFlash = 1;
    // A fresh strike restarts the effect rather than blending with the last one.
    // Two hostiles hitting in the same round is common, and two half-faded rakes
    // crossing each other reads as noise instead of as being hit twice.
    this.hitFx = fx;
    this.hitFxT = fx ? 1 : 0;
    this.hitFxSeed = Math.random() * 1000;
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
    // Faster than the flash. The strike is the READ — what hit me — and it wants to
    // be gone before the next round so it never overlaps the next one's telegraph.
    if (this.hitFxT > 0) this.hitFxT = Math.max(0, this.hitFxT - dt * 2.8);
    // Slower than the strike. This is the one the player may need to act on — the
    // strike says "ow", this says "turn round" — so it outlives the frame it fired in.
    for (let i = 0; i < 4; i++) {
      if (this.hurtFrom[i] > 0) this.hurtFrom[i] = Math.max(0, this.hurtFrom[i] - dt * 0.85);
    }
    // Slow. This is the only moment in the loop that is worth stopping for, and the
    // complaint that started it was that everything flashes past too fast to read.
    if (this.discoveryT > 0) this.discoveryT = Math.max(0, this.discoveryT - dt * 0.34);
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
    // Above the run-end return below, so the one control that is not about the run
    // stays reachable on a run that has ended.
    this.drawPixelChip(ctx, W);

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

    /**
     * The top of whatever is covering the bottom of the screen — the grimoire's own
     * measured edge, and when the book is away the thing that replaced it.
     *
     * The large CAST is that thing (see `drawBigCast`), so it becomes the anchor the
     * rest of the band lays out above, exactly as the cover was. Without that the band
     * dropped to 0.90H the instant the book left and the cycle-target button landed on
     * top of the button that had taken the book's place.
     */
    this.bookTop = !this.bookClosed && this.measuredBookTop !== null
      ? Math.round(this.measuredBookTop)
      : this.handFull() ? Math.round(H * 0.80)
      : Math.round(H * 0.90);
    this.drawBelt(ctx, W);
    // Before the CAST bar, so that where a card's box and the bar's touch, CAST wins:
    // `hit` scans backwards, so whatever is pushed last is on top.
    this.drawEmptySlots(ctx, W);
    this.drawFanCards(ctx, W);
    this.drawCastBar(ctx, W);
    this.drawBigCast(ctx, W);
    this.drawLog(ctx, W);
    this.drawVitals(ctx, W);
    this.drawHitFx(ctx, W, H);
    this.drawHurtFrom(ctx, W, H);
    this.drawDiscovery(ctx, W);
    this.drawHand(ctx);
    this.drawPin(ctx);
    this.drawParty(ctx, W);
    this.drawSealedNote(ctx, W);
    this.drawHarvest(ctx, W);
    this.drawAltarPrompt(ctx, W);
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
    /**
     * What the hand needs to be AIMED at, asked of the same two predicates `isLegal`
     * asks (`spells.ts`), and not of a literal id.
     *
     * Both were `tornIds.includes('animate')` before. That happened to be right for
     * the animating ingredient and was silently wrong for the other one: a hand
     * holding Coffin Moss drew every hostile in the room as a legal target while
     * `isLegal` refused all of them, so the reticle invited a cast the rule would not
     * allow. `wantsCorpse` is asked FIRST here for the same reason it is there — it is
     * the narrowest rule, and nothing on a floor is a corpse yet.
     */
    const needObject = wantsObject(this.tornIds);
    const needCorpse = wantsCorpse(this.tornIds);
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
        : needCorpse ? false
        : needObject ? animatable
        : (e.hostile || animatable);
      const isTarget = e === this.target;
      /**
       * What this object would do if the current hand landed on it. Suppressed while
       * the hand needs a corpse, because then NOTHING is a legal target and a barrel
       * lit up in Spark yellow would be advertising a cast that cannot happen.
       */
      const react = animatable && !needObject && !needCorpse
        ? reactionFor(e.spriteId, held) : null;

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
      /**
       * Violet is the ANIMATE colour — the cast bar's own hint names it as the ring you
       * tap to animate something — so while the belt is flagged off it would be inviting
       * a cast that no hand can assemble. Furniture still gets a marker, because it is
       * still a legal target for a bolt and still harvestable; it wears the tone this
       * file already paints furniture in (the scenery health bar's `#b08c5a`) instead of
       * the invitation. Reaction colours are untouched: a barrel going off is an ELEMENT
       * landing on it, which the belt has nothing to do with.
       */
      const col = react ? hexCss(react.colour)
        : interactive ? '#ffcf5c'
        : animatable ? (BELT_ENABLED ? '#b98cff' : '#b08c5a')
        : '#ff7a5c';

      /**
       * THE TELEGRAPH. A body that can reach you this round wears a red ring that
       * pulses, whether it is the selected target or not.
       *
       * It is drawn under the marker rather than replacing it, so it reads as a
       * state the creature is in rather than a different kind of creature — and it
       * survives every other colour this loop paints, because the one thing it must
       * never be is subtle. Before hostiles could move and attack in the same round
       * nothing needed this: a creature two tiles off could not touch you. Now it
       * can, and without the ring the only way to learn that is to lose the HP.
       */
      if (this.threats.has(e)) {
        const pulse = 0.55 + Math.sin(t * 7) * 0.45;
        const r = 13 + pulse * 3;
        ctx.globalAlpha = 0.35 + pulse * 0.45;
        ctx.strokeStyle = '#ff3a2a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

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
        : (needObject && animatable) || interactive || react ? 0.8
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
          : animatable && needObject ? `ANIMATE ${displayName(e.spriteId).toUpperCase()}`
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

        /**
         * What you have found out about this creature, on the creature.
         *
         * Only ever what you have ALREADY hit it with — the table is never shown,
         * and a creature you have not fought says nothing. It is two marks rather
         * than a list of elements on purpose: the game remembers that a weakness
         * exists, and remembering WHICH one is the player's job. That is the part
         * that makes the knowledge feel earned instead of issued.
         */
        const lore = this.loreFor?.(e.spriteId) ?? null;
        if (lore && (lore.weak || lore.resist)) {
          const marks = `${lore.weak ? '▲' : ''}${lore.resist ? '▼' : ''}`;
          ctx.font = 'bold 9px ui-monospace, monospace';
          ctx.fillStyle = lore.weak ? '#ffd166' : '#8aa0b8';
          ctx.fillText(marks, mx + w / 2 + 7, ty - 23);
        }
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
    /**
     * THE STAIRS ARE TAPPABLE, and they were not.
     *
     * They are not a `candidate` — `targetsInView` answers "what can I aim a spell
     * at", and a staircase is not that — so nothing above ever gave them a hit box
     * and tapping the door did nothing at all. Pushed here rather than by making
     * them targetable, because targetable is exactly what they must not be:
     * selecting a staircase would open the grimoire at it.
     */
    if (this.descendReady) {
      const st = this.map?.().floor.entities.find((e) => e.kind === 'stairs');
      if (st?.sprite.group.visible) {
        const box = st.sprite.screenBox(project);
        if (box) {
          this.hits.push({
            rect: [box.x - 8, box.y - 8, box.w + 16, box.h + 16],
            action: { kind: 'descend' },
          });
        }
      }
    }
  }

  private drawTopBar(ctx: CanvasRenderingContext2D, W: number): void {
    ctx.font = '9px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    /**
     * Outlined, because this row sits straight on the world and the world is not a
     * background: a lit wall at close range is nearly white, and the floor name at
     * 0.55 parchment simply vanished into it. The same trick the damage floaters use.
     */
    const ink = (text: string, x: number, y: number, fill: string) => {
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = 'rgba(8,5,10,0.72)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = fill;
      ctx.fillText(text, x, y);
    };
    // Depth AND the floor's name, permanently. A name that only ever appeared as a
    // fading shout is a name you cannot go back and read.
    const depth = `DEPTH ${ROMAN[Math.min(ROMAN.length, Math.max(1, this.state.depth)) - 1]}`;
    ink(this.floorName ? `${depth} — ${this.floorName}` : depth, 12, 12,
      'rgba(240,228,196,0.82)');

    ctx.textAlign = 'right';
    // Run total plus the bank. Showing only the run made banked stars look lost.
    const total = this.bankedStars + this.state.stars;
    ink(`✦ ${total}`, W - 12, 12, GOLD);
    if (this.state.stars > 0) {
      ctx.font = '8px ui-monospace, monospace';
      ink(`+${this.state.stars} this run`, W - 12, 23, 'rgba(255,207,92,0.7)');
      ctx.font = '9px ui-monospace, monospace';
    }
    ctx.textAlign = 'left';
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
      if (!Hud.onMap(floor, e)) continue;
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

  /**
   * The texel-density chip, right-hand column under the minimap.
   *
   * There is nowhere else for it. The left column is the depth, the health bar, the
   * hand and the pinned goal; the centre is the party bar and the shout; the bottom
   * two-thirds is the grimoire's. The strip under the minimap is the only piece of
   * this screen nothing else claims, and it puts the chip next to the other readout
   * that is neither the world nor the book.
   *
   * A control, so it takes a hit region and so `UI_CONTROLS` in `main.ts` names it.
   * `▦` is a hatched square — the pixel grid it changes, at a glance.
   */
  private drawPixelChip(ctx: CanvasRenderingContext2D, W: number): void {
    const label = `▦ ${this.pixelStep}`;
    ctx.font = '8px ui-monospace, monospace';
    const w = ctx.measureText(label).width + 14;
    // Under the minimap when there is one, under the star total when there is not.
    const y = this.map ? 140 : 40;
    const x = W - w - 10;
    this.pill(ctx, x, y, label, 'rgba(200,186,214,0.9)', 'rgba(170,150,200,0.45)');
    this.hits.push({ rect: [x - 6, y - 6, w + 12, 26], action: { kind: 'pixels' } });
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
   * Is every hand slot full?
   *
   * The one condition behind three things that must never disagree: the grimoire
   * slides away (`bookOnScreen` in `main.ts` asks the same question of the same two
   * numbers), the small CAST pill stands down, and the large one takes the book's
   * place. An empty hand is not full at any ceiling, which is what keeps "no CAST
   * with nothing to cast" separate from "one CAST or the other".
   */
  private handFull(): boolean {
    return this.handHeld > 0 && this.handHeld >= Math.max(this.handSize, 1);
  }

  /**
   * The resolved fusion name, with CAST. The torn pages themselves are
   * real 3D objects fanned above the book, so this bar only has to name the
   * result — which is the one thing you cannot read off the pages.
   *
   * The SMALL one, for a hand that is not yet full — at hand size 3 a player may want
   * to release one page, and this is what lets them. Stands down the moment the hand
   * fills, because then `drawBigCast` is on screen and two CAST buttons is worse than
   * either.
   */
  private drawCastBar(ctx: CanvasRenderingContext2D, W: number): void {
    if (this.handFull()) return;
    const cast = this.currentCast();
    if (!cast) return;
    const ok = !cast.refusal;
    // A refusal has to say what to DO about it. "Animate needs an object" with
    // no next step is why this read as the game being broken.
    let hint = cast.refusal ?? '';
    // Only rewrite the refusal into a targeting hint when targeting is actually
    // the problem — a hand with no element is refused whatever it is aimed at.
    const hasElement = this.tornIds.some(isElement);
    // Off the ROLE, not the id, and deliberately not extended to Coffin Moss: moss is
    // refused because nothing on the floor has fallen, and its own refusal already
    // says exactly that. There is no target to point at.
    if (!ok && hasElement && wantsObject(this.tornIds)) {
      const anyObject = this.candidates.some((e) => e.kind === 'prop' && !e.animated);
      hint = anyObject
        ? 'Tap an object (violet ring) to animate it'
        : 'No object in sight — find furniture to animate';
    }
    if (!ok) {
      // A refusal is a sentence, not a button. It keeps the plain pill.
      ctx.font = '9.5px ui-monospace, monospace';
      const tw = Math.min(W - 32, ctx.measureText(hint).width + 44);
      const bx = (W - tw) / 2, by = this.bookTop - BELT_BAND - 34;
      rr(ctx, bx, by, tw, 32, 16);
      ctx.fillStyle = 'rgba(64,24,24,0.92)';
      ctx.fill();
      rr(ctx, bx, by, tw, 32, 16);
      ctx.strokeStyle = 'rgba(255,120,120,0.7)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffb0a0';
      ctx.fillText(hint, W / 2, by + 16);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      return;
    }

    /**
     * NAME ON TOP, BUTTON UNDER. They used to be one pill reading "Gust · CAST",
     * which asks the player to read a label and press a label in the same glance —
     * and the thing you press was the same size as the thing you read.
     */
    const scale = 3;
    const btnW = Math.min(W - 72, 176);
    // Anchored to the same edge the pill was, so nothing else in the band moves.
    // Lifted clear of the book. At `- 34` the key's bottom edge landed exactly on
    // the grimoire's top and read as one welded object rather than a control.
    const by = this.bookTop - BELT_BAND - 84;
    // Stack: heading, then the key. `by` is the TOP of the group, and the button's
    // height is derived rather than assumed so the two cannot drift apart.
    this.drawCastHeading(ctx, W / 2, by + 10, cast.name.toUpperCase(), cast.colour);
    const btn = this.castButton(ctx, W / 2, by + 24, btnW, scale);
    this.hits.push({ rect: [btn.x, btn.y, btn.w, btn.h], action: { kind: 'cast' } });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  private drawBigCast(ctx: CanvasRenderingContext2D, W: number): void {
    if (!this.handFull() || this.offers) return;
    const cast = this.currentCast();
    if (!cast) return;
    const ok = !cast.refusal;

    // `bookTop` IS this button's top while the hand is full — see `draw`. One number,
    // so the band above cannot be laid out against a different edge than this occupies.
    // Tall enough to HOLD the stack. It was 76 with a 68px button pushed into it,
    // so the key hung out of the bottom of its own panel and over the hint under it.
    const bw = Math.min(W - 32, 420), bh = 92;
    const bx = (W - bw) / 2, by = this.bookTop;
    /**
     * NO PANEL when the cast is legal. The name and the key carry themselves — the
     * key is already a raised gold object with its own keyline — and a rounded pill
     * around them boxed a pixel-art button inside a piece of vector chrome.
     *
     * The refusal still gets one, because a refusal is a sentence and a sentence off
     * a dark dungeon floor needs something to sit on.
     */
    if (!ok) {
      rr(ctx, bx, by, bw, bh, 20);
      ctx.fillStyle = 'rgba(64,24,24,0.92)';
      ctx.fill();
      rr(ctx, bx, by, bw, bh, 20);
      ctx.strokeStyle = 'rgba(255,120,120,0.7)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (ok) {
      /**
       * Same stack as the small control — what it IS on top, what you PRESS beneath.
       *
       * The chip is the one place in the loop the player is already looking at while
       * the decision is still reversible. WEAK!/RESISTED prints at the moment of
       * impact, which is after the choice and among the damage number, the screen
       * flash and the shake: accurate, and unreadable.
       */
      this.drawCastHeading(ctx, W / 2, by + 14, cast.name.toUpperCase(), cast.colour);
      // Bigger than the small one — this is the whole turn, and the book is gone.
      const btn = this.castButton(ctx, W / 2, by + 30, Math.min(bw - 56, 248), 3);
      this.hits.push({ rect: [btn.x, btn.y, btn.w, btn.h], action: { kind: 'cast' } });
    } else {
      ctx.font = 'bold 13px ui-monospace, monospace';
      ctx.fillStyle = '#ffb0a0';
      ctx.fillText('CANNOT CAST', W / 2, by + 22);
      ctx.font = '9.5px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255,200,190,0.86)';
      const lines = wrapLines(ctx, cast.refusal!, bw - 36).slice(0, 3);
      lines.forEach((ln, i) => ctx.fillText(ln, W / 2, by + 44 + i * 13));
    }

    // On its own plate, because it lands on the floor of the room rather than on any
    // panel and 8px parchment over a lit tile is not text.
    const note = '✕  ON A CARD PUTS IT BACK';
    ctx.font = '8px ui-monospace, monospace';
    const nw = ctx.measureText(note).width + 18;
    rr(ctx, (W - nw) / 2, by + bh + 4, nw, 14, 7);
    ctx.fillStyle = 'rgba(14,9,16,0.86)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(198,50,34,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,168,142,0.95)';
    ctx.fillText(note, W / 2, by + bh + 11.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
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
   * The fan is cancellable: one small ✕ per card, with the whole card as its target.
   *
   * DRAW SMALL, HIT BIG — the belt's lesson. The badge is a 16px dark disc with a
   * hairline gold rim; the card behind it is ~80x105px and that is what the thumb
   * actually lands on. Deliberately the quietest thing in the band: nothing here is
   * filled, bold or pulsed, because the CAST pill is the loud control above the book
   * and this must not compete with it. The card's own golden halo is already the
   * "this is live" signal, so the badge only has to say what a tap DOES.
   *
   * A ✕ rather than an arrow pointing back at the source, because the three sources
   * have three different destinations — a page goes into the book, a vial onto the
   * belt, and a harvested element nowhere at all (`docs/DESIGN.md`: fixtures are not
   * storable) — so no arrow is true for all three. ✕ is, and it is also the one mark
   * that cannot be misread as "cast this one", which is the misreading that would
   * cost the player a hand.
   */
  /**
   * EMPTY SPELL SLOTS, and what to do about them.
   *
   * With nothing torn, the band above the grimoire was blank — so a player who does
   * not already know that pages are torn OUT and held has no way to find out. The
   * book is open and beautiful and reads as scenery.
   *
   * The boxes come from `main`, projected from the FAN'S OWN slot transform, which
   * is the same function that places the real cards. That matters and the first
   * version got it wrong: it laid the outlines out independently in screen pixels,
   * so an outline was not where its card would land and putting a card in made the
   * row jump. One source of truth for the row, or the two disagree the instant
   * anything fills.
   *
   * Only the unfilled ones are ever in the list, so a filled slot never gets a box
   * drawn behind the card standing in it.
   */
  private drawEmptySlots(ctx: CanvasRenderingContext2D, W: number): void {
    if (this.offers || this.bookClosed || !this.emptySlots.length) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let lowest = 0;
    for (const b of this.emptySlots) {
      const pulse = 0.5 + Math.sin(this.engine.time * 2.4 + b.index * 0.7) * 0.5;
      ctx.save();
      // Leaning with the fan, because the slot leans and the card that lands in it
      // will lean — an upright box in a fanned row reads as a different object.
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
      ctx.rotate(-b.rot);
      ctx.globalAlpha = 0.3 + pulse * 0.28;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = PARCH;
      rr(ctx, -b.w / 2, -b.h / 2, b.w, b.h, 5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.5 + pulse * 0.3;
      ctx.font = `${Math.round(b.h * 0.28)}px ui-monospace, monospace`;
      ctx.fillStyle = PARCH;
      ctx.fillText('+', 0, 0);
      ctx.restore();
      lowest = Math.max(lowest, b.y + b.h);
    }

    ctx.globalAlpha = 0.85;
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.fillStyle = PARCH;
    ctx.fillText(
      this.handHeld > 0 ? 'TAP ANOTHER PAGE' : 'TAP A PAGE IN THE BOOK TO TEAR IT OUT',
      W / 2, lowest + 13,
    );
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  private drawFanCards(ctx: CanvasRenderingContext2D, W: number): void {
    if (this.offers) return;            // the modal owns every tap; see drawBelt
    /**
     * Bigger once the hand is FULL, which is the state the book is away in. At hand
     * size 1 that is after every single tear, so leafing to a different page means
     * cancelling first — the quietest control in the band becomes the only way back
     * into the grimoire, and a quiet control is the wrong answer to that.
     */
    const full = this.handFull();
    const r = full ? 11 : 8;
    for (const c of this.handCards) {
      /**
       * Pushed in FAN ORDER, which is what resolves an overlap: `slot()` steps each
       * card toward the camera by its index, so the highest index is the one drawn on
       * top — and `hit` scans backwards, so the highest index is also the first tested.
       * The card the player can see is the card that answers.
       */
      this.hits.push({ rect: [c.x, c.y, c.w, c.h], action: { kind: 'card', index: c.index } });

      /**
       * Pinned to the card's own top-right corner, which means following its TILT: the
       * fan rolls every card by up to 0.18rad, and the rect here is the upright box, so
       * a badge parked at the box's corner floats off the paper on the outer cards.
       * Rotated and inset, it sits ON the card at any hand size.
       */
      // Sat ON the paper at a 10px inset before, where it read as part of the page's
      // artwork. Perched just outside the corner it reads as something attached TO the
      // card, which is what a remove control should look like.
      const hw = c.w / 2 + 2, hh = c.h / 2 + 2;
      const sn = Math.sin(c.rot), cs = Math.cos(c.rot);
      // Clamped inside the stage: at 295px the outer card of a three-card fan hangs
      // off the edge, and a badge drawn past it is a control that looks unreachable.
      const bx = Math.min(W - 11, Math.max(11, c.x + c.w / 2 + hw * cs - hh * sn));
      const by = c.y + c.h / 2 - (hw * sn + hh * cs);
      /**
       * The badge gets its OWN hit region, and a generous one.
       *
       * Until this existed the only rect was the card's, and moving the badge outside
       * the corner put the visible button outside the only thing that answered a tap —
       * so the ✕ was unclickable while the card's middle still worked, which is worse
       * than a plain failure because nothing tells you. 44px against an 8px disc: draw
       * small, hit big, the same rule the belt pouches follow.
       *
       * Pushed AFTER the card so it wins `hit`'s backward scan, and computed from the
       * same live box in the same frame, so it tracks a card that is still flying in
       * instead of lagging behind the drawn mark.
       */
      const bh = 22;
      this.hits.push({
        rect: [bx - bh, by - bh, bh * 2, bh * 2],
        action: { kind: 'card', index: c.index },
      });

      // Red, because this is the only destructive control in the band and every other
      // affordance on screen is gold or parchment. It reads as remove at a glance
      // without having to be big — and it is the one mark here that must never be
      // mistaken for "cast".
      ctx.save();
      if (full) {
        ctx.shadowColor = 'rgba(255,146,116,0.7)';
        ctx.shadowBlur = 7;
      }
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(198,50,34,0.95)';
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,146,116,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#fff0e6';
      ctx.lineWidth = full ? 2 : 1.6;
      const k = r * 0.38;
      ctx.beginPath();
      ctx.moveTo(bx - k, by - k); ctx.lineTo(bx + k, by + k);
      ctx.moveTo(bx + k, by - k); ctx.lineTo(bx - k, by + k);
      ctx.stroke();
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

  /**
   * The belt strip: a strap across the book's top edge with the pouches on it.
   *
   * DRAWN ALWAYS, in the three states `docs/DESIGN.md` names — bare strap while the
   * tree node is unbought, open loops once it is, vials and bundles with count badges
   * once there is something in them. That is the whole reason it renders locked: the
   * capability has to advertise itself before it is owned, and a strip that appears out
   * of nowhere on purchase advertises nothing.
   *
   * WHERE IT SITS. Lapped over the book's own top edge, so the strap runs BEHIND the
   * grimoire and the loops stand up out of it. That is the only honest space left: the
   * fan of torn pages reaches to about `bookTop - 200`, its cards bottom out around
   * `bookTop - 83`, and the CAST bar, the turn-cost pill and the log fill the band
   * between. Rather than squeeze a fifth thing in there, the strip takes the ~30px
   * immediately above the edge plus a caption row, and the three controls above it
   * moved up by `BELT_BAND` — which is also why the log now stacks upward instead of
   * down. Nothing here is drawn where the book's pages are read.
   *
   * The strip is inside the book's own gesture zone by construction, which is exactly
   * why `{ kind: 'belt' }` is in `UI_CONTROLS` (`main.ts`): a tap on a pouch has to beat
   * a page flip, and the whole strap absorbs taps so the gap between two loops cannot
   * leaf the book either.
   *
   * DRAW SMALL, HIT BIG — the star tree's lesson. The loops are 24px tall on a strap
   * that has to survive a 295px stage; each one's hit rect is the full pitch wide (44px
   * at six loops on the narrowest supported width) and 48px tall, reaching down into
   * the book's cover where nothing else is tappable.
   */
  private drawBelt(ctx: CanvasRenderingContext2D, W: number): void {
    /**
     * Flagged off: not even the locked strap.
     *
     * The bare strap exists to ADVERTISE an unlock, and there is nothing to advertise
     * while the chain that buys it cannot be bought — a perforated strap with a
     * BELT · LOCKED caption would be selling a purchase the star tree refuses. So the
     * whole strip goes, hit rects included, and `BELT_BAND` gives its 46px back.
     */
    if (!BELT_ENABLED) return;
    /**
     * The one exception to "always": the altar modal owns the whole frame. Under the
     * veil the strip is a ghost, but its hit rects would still be live — and a pouch tap
     * spends a hand slot and a turn, which is not something an invisible control should
     * be able to do while the player is reading three offers.
     */
    if (this.offers) return;
    const belt = this.state.belt;
    const B = this.bookTop;
    const strapBottom = B + LAP;
    const strapTop = strapBottom - STRAP_H;
    const loopBottom = strapTop + 6;
    const loopTop = loopBottom - LOOP_H;
    // Narrower gutters on a narrow stage. Six loops have to fit a 295px SE, and 4px a
    // side is 8px of pitch — the difference between a 40px tap target and a 44px one.
    const mx = W < 340 ? 10 : 14;
    /** 0 means the tree node is unbought: bare strap, no loops, unlit. */
    const n = Math.max(0, belt.capacity);
    const locked = n === 0;

    /**
     * How fresh the last refusal is. `belt.refusal.at` is a `performance.now()` stamp
     * and it is only cleared by a successful pickup, so without reading the clock the
     * strap would pulse for a refusal from two rooms ago — which is precisely what
     * `belt.ts` says the timestamp is there to prevent.
     */
    const age = belt.refusal ? (performance.now() - belt.refusal.at) / 1000 : Infinity;
    const pulse = age < PULSE_S ? 1 - age / PULSE_S : 0;
    const said = age < SAID_S ? belt.refusal!.why : null;

    // ---- the strap ------------------------------------------------------
    ctx.save();
    // A physical TUG rather than a flash: the strap is leather and the thing that just
    // happened is a drop bouncing off it. Horizontal, because vertical would read as
    // the whole HUD juddering.
    if (pulse > 0) ctx.translate(Math.sin(age * 34) * 2.4 * pulse, 0);

    const sw = W - mx * 2;
    const grad = ctx.createLinearGradient(0, strapTop, 0, strapBottom);
    if (locked) {
      // Unlit, not absent: the same leather with the warmth taken out of it. A near-black
      // bar read as a drawn rule rather than as an object you could own one day.
      grad.addColorStop(0, 'rgba(58,50,46,0.88)');
      grad.addColorStop(1, 'rgba(24,19,20,0.88)');
    } else {
      grad.addColorStop(0, 'rgba(92,58,33,0.95)');
      grad.addColorStop(1, 'rgba(38,23,15,0.95)');
    }
    rr(ctx, mx, strapTop, sw, STRAP_H, STRAP_H / 2);
    ctx.fillStyle = grad;
    ctx.fill();

    if (pulse > 0) {
      ctx.shadowColor = hexCss(0xff6a3c, 0.5 + pulse * 0.5);
      ctx.shadowBlur = 5 + pulse * 14;
    }
    ctx.strokeStyle = pulse > 0 ? hexCss(0xff6a3c, 0.5 + pulse * 0.5)
      : locked ? 'rgba(176,160,140,0.34)'
      : 'rgba(255,207,92,0.42)';
    ctx.lineWidth = pulse > 0 ? 1.7 : 1.1;
    /**
     * Perforated while locked, and that is a borrowed word rather than a new one: the
     * star tree draws every unbought node with a dashed rim, so dashed means "not yours
     * yet" on both screens. A LONG dash, for the reason `treeIcons.ts` gives about a
     * hexagon's corners: at [3, 3] the rim read as marching ants around a selection
     * rather than as an edge that happens to be broken.
     */
    if (locked && pulse <= 0) ctx.setLineDash([6, 4.5]);
    rr(ctx, mx, strapTop, sw, STRAP_H, STRAP_H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    // Stitching: two dashed hairlines, which is what makes the band read as leather
    // instead of as a drawn rule. Drawn while locked too, dimmer — the strap is the same
    // object either way and "unlit" is a lighting state, not a different strap.
    ctx.strokeStyle = locked ? 'rgba(198,182,158,0.16)' : 'rgba(255,214,140,0.26)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    for (const y of [strapTop + 2.5, strapBottom - 2.5]) {
      ctx.beginPath();
      ctx.moveTo(mx + 7, y);
      ctx.lineTo(W - mx - 7, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // The buckle, so a strap has a direction and is not a ladder — `treeIcons.ts`'s
    // belt glyph makes the same call, and the strip and the node it is bought from
    // should be recognisably the same object.
    const bs = STRAP_H + 2;
    rr(ctx, mx - 1, strapTop - 1, bs, bs, 2.5);
    ctx.strokeStyle = locked ? 'rgba(176,160,140,0.5)' : 'rgba(255,214,140,0.78)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // the pin, so the buckle is a buckle and not an empty square
    ctx.beginPath();
    ctx.moveTo(mx - 1 + bs / 2, strapTop);
    ctx.lineTo(mx - 1 + bs / 2, strapTop + bs - 2);
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // ---- the pouches ----------------------------------------------------
    /**
     * The strap absorbs a tap wherever it is hit, pushed FIRST so the loops (pushed
     * after, and `hit` scans backwards) win their own area. Without it, the gap between
     * two loops is a page flip, because every pixel here is below the book's edge.
     *
     * On a LOCKED strap that catch-all carries a real ingredient id, which is what makes
     * the bare strap explain itself when you poke it: `takeIngredient` refuses on
     * capacity before it ever looks at which ingredient was asked for, so any id lands
     * on the locked line. It is a coupling and it is noted in the report — an empty
     * `id` would be the cleaner ask.
     */
    /** The whole band, loops included, so the catch-all is never shorter than a loop. */
    const band: [number, number, number, number] = [mx, loopTop - 6, sw, LOOP_H + 24];
    this.hits.push({ rect: band, action: { kind: 'belt', id: locked ? INGREDIENT_IDS[0] : '' } });

    if (!locked) {
      /**
       * Laid out in the strap CLEAR OF THE BUCKLE rather than centred on the screen.
       * Centred, six loops on a 295px stage put the first one straight through the
       * buckle — and the buckle is what makes the strip a strap, so it is the fixed
       * thing and the loops are what move.
       */
      const x0 = mx + bs + 4;
      const room = W - mx - x0;
      const pitch = Math.min(46, room / n);
      const loopW = Math.min(28, pitch - 12);
      const startX = x0 + (room - pitch * n) / 2;
      /** A full hand cannot draw anything, whatever is on the strap. */
      const handFull = this.handHeld >= Math.max(this.handSize, 1);

      for (let i = 0; i < n; i++) {
        const cx = startX + pitch * (i + 0.5);
        const slot = belt.slots[i];
        if (slot) this.drawPouch(ctx, cx, loopTop, loopW, strapTop, slot, handFull);
        else this.drawEmptyLoop(ctx, cx, loopTop, loopW);
        this.hits.push({
          rect: [cx - pitch / 2, band[1], pitch, band[3]],
          action: { kind: 'belt', id: slot?.id ?? '' },
        });
      }
    }
    ctx.restore();

    // ---- the one caption row -------------------------------------------
    /**
     * One line, two jobs, and never both at once: the refusal the belt just recorded,
     * else the fact that the strap has no loops. An always-on label would be permanent
     * noise on the one band of this screen that has no pixels to spare, and both of
     * these are things the player cannot find out any other way.
     *
     * There was a third — TimeSand's remaining free components — and it is gone with
     * the thing it read. Under cast = 1 turn every component is free to take, so
     * `BeltState.free` is 0 for every hand ever held and a caption gated on `> 0`
     * could never draw. A readout of a constant is noise even when the constant is 0.
     *
     * The refusal COPY is `belt.refusal.why` verbatim. The belt owns the wording of its
     * own rules; the strip only decides that it appears here, next to the strap that is
     * pulsing for it, rather than only in a log line that scrolls.
     */
    const caption = said ?? (locked ? 'BELT · LOCKED' : null);
    if (!caption) return;

    let size = 8.5;
    ctx.font = `${size}px ui-monospace, monospace`;
    // Shrunk to fit rather than wrapped: a second line would come out of the CAST bar's
    // row, and the longest refusal (the full-belt one, which names an ingredient) still
    // clears 6.5px on a 295px stage.
    while (size > 6.5 && ctx.measureText(caption).width + 16 > W - 24) {
      size -= 0.5;
      ctx.font = `${size}px ui-monospace, monospace`;
    }
    const tw = Math.min(W - 24, ctx.measureText(caption).width + 16);
    /**
     * As close to the strap as the loops allow. `BELT_BAND` is the reservation the CAST
     * bar is laid out against and it has to clear an open flap's tip, but a LOCKED strap
     * has no flaps and no loops — parked at the full height the line floated 39px above
     * the thing it was about and read as belonging to the world, not to the belt.
     */
    const cx0 = (W - tw) / 2, cy0 = B - (locked ? 26 : BELT_BAND);
    rr(ctx, cx0, cy0, tw, 14, 7);
    ctx.fillStyle = 'rgba(14,9,16,0.88)';
    ctx.fill();
    ctx.strokeStyle = said ? hexCss(0xff6a3c, 0.5 + pulse * 0.5) : 'rgba(178,166,148,0.42)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = said ? '#ffb0a0' : 'rgba(214,204,186,0.78)';
    ctx.fillText(caption, W / 2, cy0 + 7.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  /**
   * A filled loop: the ingredient standing in its pouch, with the count on the strap.
   *
   * The badge hangs at the pouch's foot rather than over its shoulder, and that is a
   * layout decision worth 10px: on the strap it costs no height at all, and the row of
   * brass tags along the leather is how a real bandolier is labelled.
   */
  private drawPouch(
    ctx: CanvasRenderingContext2D, cx: number, loopTop: number, loopW: number,
    strapTop: number, slot: BeltSlot, handFull: boolean,
  ): void {
    const col = SPELL_BY_ID[slot.id]?.colour ?? 0xffffff;
    /**
     * How many of this stack are still on the belt rather than already in the hand.
     * Derived from `tornIds` — the belt is deliberately NOT decremented when a vial is
     * taken out, because a hand can always be put back — so this is the only reading
     * that agrees with what a tap will actually do.
     */
    const inHand = this.tornIds.reduce((k, h) => k + (h === slot.id ? 1 : 0), 0);
    const drawable = slot.count - inHand;

    ctx.save();
    /**
     * Dimmed and still tappable, exactly like the harvest pill: the refusal is worth
     * hearing, and a control that vanishes when you start using it teaches that it was
     * never there.
     *
     * Two depths, because the two reasons are not the same news. A full hand dims
     * everything hard — nothing on the strap can be taken. A stack that is entirely IN
     * the hand dims only a little, because that pouch's real message is the gold rim
     * below saying so, and at 0.46 the rim went with it.
     */
    if (handFull && inHand === 0) ctx.globalAlpha *= 0.46;
    else if (drawable <= 0) ctx.globalAlpha *= 0.78;

    // the pouch ground, in the ingredient's own colour — the altar cards' device, and
    // what makes a filled loop read as a button rather than as a drawing
    rr(ctx, cx - loopW / 2, loopTop, loopW, LOOP_H, 4);
    ctx.fillStyle = hexCss(col, 0.2);
    ctx.fill();

    // Centred with a hair of inset rather than filling the mouth: a glyph whose topmost
    // mark lands ON the rim (the moss tie did) loses that mark to the rim's own line.
    drawBeltIcon(ctx, slot.id, cx, loopTop + LOOP_H * 0.5, Math.min(10.5, loopW * 0.39),
      hexCss(col, 0.98));

    // The rim, GOLD while one of these is in your hand — the tap's own feedback, and
    // the only channel that can carry it, since a hit rect has no pressed state.
    rr(ctx, cx - loopW / 2, loopTop, loopW, LOOP_H, 4);
    if (inHand > 0) {
      ctx.shadowColor = hexCss(0xffcf5c, 0.6);
      ctx.shadowBlur = 6;
    }
    ctx.strokeStyle = inHand > 0 ? GOLD : hexCss(col, 0.82);
    ctx.lineWidth = inHand > 0 ? 1.7 : 1.2;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // the two rivets the loop is stitched down by, on the strap under it
    ctx.fillStyle = 'rgba(255,214,140,0.85)';
    for (const sg of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + sg * (loopW / 2 - 3), strapTop + STRAP_H / 2, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }

    // the count badge
    const label = String(slot.count);
    ctx.font = 'bold 8px ui-monospace, monospace';
    const bw = Math.max(12, ctx.measureText(label).width + 8);
    // Slung under the pouch's foot and mostly on the strap. Level with the mouth it ate
    // the bottom-right of every glyph — and the glyph is what names the ingredient, so
    // the number is the thing that has to move.
    const bx = cx + loopW / 2 - bw + 2, by = loopTop + LOOP_H - 3;
    rr(ctx, bx, by, bw, 11, 5.5);
    ctx.fillStyle = hexCss(col, 0.95);
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,7,12,0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Knocked out dark on the bright pill, the treatment `drawSeal` already uses: a
    // number this small needs the contrast to come from the plate, not from the ink.
    ctx.fillStyle = '#160f1a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + bw / 2, by + 6);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.restore();
  }

  /**
   * An owned, empty loop: `docs/DESIGN.md`'s "loops with open flaps, brass catching
   * light".
   *
   * The flap is the state's whole signature. A hollow rounded rect on a dark strap is
   * ambiguous — it could be a slot, a gap, a rendering fault — but a flap fallen back
   * off the mouth says the pocket is open and there is nothing in it, which is the exact
   * thing this state has to communicate to a player who has just bought the node.
   */
  private drawEmptyLoop(
    ctx: CanvasRenderingContext2D, cx: number, loopTop: number, loopW: number,
  ): void {
    const x = cx - loopW / 2;
    // darker than the strap, so it reads as a hole and not as a raised panel
    rr(ctx, x, loopTop, loopW, LOOP_H, 4);
    ctx.fillStyle = 'rgba(9,6,11,0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(214,168,96,0.72)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    // The inside of the mouth, caught by the same light the brass is: one hairline
    // across the top makes the dark rectangle a pocket with a depth instead of a hole
    // cut in the strap.
    ctx.strokeStyle = 'rgba(232,200,150,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 3, loopTop + 3.5);
    ctx.lineTo(x + loopW - 3, loopTop + 3.5);
    ctx.stroke();

    // the flap, hinged on the mouth's near corner and fallen open to the left
    ctx.save();
    ctx.translate(x + 3, loopTop + 2);
    ctx.rotate(0.42);
    rr(ctx, -loopW * 0.44, -3.2, loopW * 0.44, 6.4, 2.4);
    ctx.fillStyle = 'rgba(84,55,32,0.97)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,186,110,0.72)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // the stud the flap buttons onto, with its highlight — the "brass catching light"
    const sy = loopTop + LOOP_H * 0.52;
    ctx.beginPath();
    ctx.arc(cx, sy, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(226,182,104,0.95)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - 0.8, sy - 0.9, 0.95, 0, Math.PI * 2);
    ctx.fillStyle = '#fff4d8';
    ctx.fill();
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

  /**
   * The last few lines the game said, stacked UPWARD from a fixed bottom edge.
   *
   * Downward from a top edge before, which put the fourth line 48px lower than the
   * first — straight through the CAST pill, so a chest that pays three ingredients
   * printed its log across the button naming the fusion. Anchoring the NEWEST line
   * just above the pill and growing the stack up into the fan instead keeps the one
   * line that matters in the one place nothing else claims, and older lines drift into
   * a region they are already fading out of.
   */
  private drawLog(ctx: CanvasRenderingContext2D, W: number): void {
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const bottom = this.bookTop - BELT_BAND - 74;
    const n = this.log.length;
    this.log.forEach((l, i) => {
      const age = Math.max(0, 1 - Math.max(0, l.t - 3.4) / 1.6);
      ctx.globalAlpha = 0.85 * age;
      ctx.fillStyle = hexCss(l.colour);
      ctx.fillText(l.text, W / 2, bottom - (n - 1 - i) * 12);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  /**
   * The spell's name and how it will land, as ONE centred group on one line.
   *
   * They were laid out independently — name centred on the panel, chip pinned to the
   * right edge — and at a glance that reads as two unrelated things at two different
   * heights rather than as a heading. Measuring both and centring the pair is the
   * whole fix, and it means the chip sits where the eye already is instead of in the
   * corner it has no reason to look at.
   */
  private drawCastHeading(
    ctx: CanvasRenderingContext2D, cx: number, y: number, name: string, colour: number,
  ): void {
    const eff = this.castEffect();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 17px ui-monospace, monospace';
    const nw = ctx.measureText(name).width;
    ctx.font = 'bold 9px ui-monospace, monospace';
    const cw = eff ? ctx.measureText(eff.label).width + 14 : 0;
    const gap = eff ? 8 : 0;
    let x = cx - (nw + gap + cw) / 2;

    ctx.font = 'bold 17px ui-monospace, monospace';
    ctx.fillStyle = hexCss(colour);
    ctx.fillText(name, x, y);
    x += nw + gap;

    if (eff) {
      ctx.font = 'bold 9px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(10,7,12,0.82)';
      rr(ctx, x, y - 8, cw, 16, 7); ctx.fill();
      ctx.strokeStyle = hexCss(eff.colour, 0.9);
      ctx.lineWidth = 1.1; ctx.stroke();
      ctx.fillStyle = hexCss(eff.colour);
      ctx.textAlign = 'center';
      ctx.fillText(eff.label, x + cw / 2, y);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * The gold CAST button, built as REAL pixel art and blitted at an integer scale.
   *
   * Not a rounded rectangle with a system font in it. It is composed in a `Pix` — the
   * same buffer the grimoire's pages and the tree's pictograms are drawn in — with a
   * one-texel keyline, a one-texel bevel lit from the top left, and the game's own
   * bitmap face. Then it goes up at a whole-number scale with smoothing off, so every
   * edge lands on the grid the rest of the game is drawn on.
   *
   * `scale` is a texel size, not a font size. Everything inside is authored in texels
   * and multiplied once, which is why the bevel stays exactly one texel wide whether
   * the button is the small one under the hand or the big one under the book.
   */
  private castButton(
    ctx: CanvasRenderingContext2D, cx: number, y: number, wPx: number, scale: number,
  ): { x: number; y: number; w: number; h: number } {
    const bw = Math.max(24, Math.round(wPx / scale));
    const bh = CELL_H + 8;
    const p = new Pix(bw, bh);

    const GOLD = hex(0xe8b53a);
    const LIT = hex(0xffe089);
    const DARK = hex(0x8a5f14);
    const KEY = hex(0x140a12);
    const INK = hex(0x2a1a06);

    p.rect(1, 1, bw - 2, bh - 2, GOLD);
    // Bevel: lit along the top and left, shadow along the bottom and right. One
    // texel each, which is what makes it read as a raised key rather than a panel.
    p.rect(1, 1, bw - 2, 1, LIT);
    p.rect(1, 1, 1, bh - 2, LIT);
    p.rect(1, bh - 2, bw - 2, 1, DARK);
    p.rect(bw - 2, 1, 1, bh - 2, DARK);
    // Keyline, with the corners knocked out so it reads as a rounded key.
    p.rect(0, 1, 1, bh - 2, KEY);
    p.rect(bw - 1, 1, 1, bh - 2, KEY);
    p.rect(1, 0, bw - 2, 1, KEY);
    p.rect(1, bh - 1, bw - 2, 1, KEY);

    drawCentered(p, 'CAST', bw / 2, 4, INK, { scale: 1, tracking: 1 });

    const cv = p.toCanvas();
    const w = bw * scale, h = bh * scale;
    const x = Math.round(cx - w / 2);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, 0, 0, bw, bh, x, Math.round(y), w, h);
    ctx.restore();
    return { x, y: Math.round(y), w, h };
  }

  /**
   * THE DISCOVERY BANNER — the one thing in this loop worth stopping for.
   *
   * Everything else about a hit is transient by design: the damage number, the
   * WEAK!/RESISTED flash, the screen shake. That is right for the ninetieth hit and
   * wrong for the first, and they looked identical, which is why the mechanic was
   * invisible in play. This fires ONCE per species-and-element pair, holds about
   * three seconds, and names both — the creature and what it did to that element.
   *
   * Placed just above the book rather than at the top of the screen: the top is
   * where the depth label and the minimap live and nothing there ever moves, so
   * nothing there is looked at mid-fight. The band above the grimoire is where the
   * player's eyes already are.
   */
  private drawDiscovery(ctx: CanvasRenderingContext2D, W: number): void {
    if (!this.discovery || this.discoveryT <= 0) return;
    // Snaps in, holds, fades out — so the hold is flat and readable rather than a
    // ramp the player is chasing.
    const t = this.discoveryT;
    const a = t > 0.85 ? (1 - t) / 0.15 : t < 0.25 ? t / 0.25 : 1;
    const y = this.bookTop - 96 - (1 - Math.min(1, t * 6)) * 8;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = 'bold 9px ui-monospace, monospace';
    const head = 'DISCOVERED';
    ctx.font = 'bold 11px ui-monospace, monospace';
    const bw = Math.max(ctx.measureText(this.discovery.text).width + 34, 190);
    const bx = (W - bw) / 2;

    ctx.fillStyle = 'rgba(12,8,14,0.92)';
    rr(ctx, bx, y, bw, 40, 10); ctx.fill();
    ctx.strokeStyle = hexCss(this.discovery.colour, 0.95);
    ctx.lineWidth = 1.6; ctx.stroke();

    ctx.font = 'bold 8px ui-monospace, monospace';
    ctx.fillStyle = hexCss(this.discovery.colour, 0.75);
    ctx.fillText(head, W / 2, y + 12);
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.fillStyle = hexCss(this.discovery.colour);
    ctx.fillText(this.discovery.text, W / 2, y + 27);
    ctx.restore();
  }

  /**
   * Record a hit from a side, relative to the way the player is facing.
   *
   * `amount` only sets how LOUD it is, never how long: a scratch and a maul both
   * need to stay up long enough to be turned toward, and a big hit that vanished
   * as fast as a small one would be the wrong way round.
   */
  /** Which sides are lit right now, and whether a strike is playing — harness only. */
  hurtSides(): number[] {
    return this.hurtFrom.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  }

  strikePlaying(): boolean { return this.hitFxT > 0 && !!this.hitFx; }

  clearHurtFrom(): void {
    this.hurtFrom = [0, 0, 0, 0];
    this.hitFxT = 0;
    this.hitFx = null;
  }

  damageFrom(side: number, amount: number): void {
    const i = ((side % 4) + 4) % 4;
    this.hurtFrom[i] = Math.max(this.hurtFrom[i], 0.55 + Math.min(0.45, amount / 22));
  }

  /**
   * WHERE IT CAME FROM. Four chevrons around the world view, one per side.
   *
   * The research is unambiguous on two points and this follows both.
   *
   * FIRST, use two signals, not one. Playtesting reported by Jasper Stephenson's UX
   * analysis found half of testers missed a centre-screen damage cue and half missed
   * a screen-edge one — different halves. So this is the edge half and the existing
   * full-screen red flash is the centre half, and neither is asked to work alone.
   *
   * SECOND, do not spend the direction on colour. Every accessibility guideline
   * says the same thing and it costs nothing here: a chevron POINTING outward says
   * which way on its own, so the red is emphasis rather than information.
   *
   * The 2D-around-the-centre form is the one that analysis rates highest and
   * Destiny 2's world-space markers lowest, because a flat ring is read without
   * being interpreted. This game gets that for free and then some: it is a grid
   * stepper, so there are only ever FOUR directions a blow can come from, and four
   * discrete chevrons are unambiguous where a continuous arc has to be estimated.
   *
   * Two placement decisions are this game's own. They sit around the WORLD view
   * rather than the screen, because the bottom third of the screen is the grimoire
   * and an indicator behind it does not exist. And they are drawn into the same
   * low-res buffer as the strike, because a smooth vector arc over pixel-art stone
   * is the thing that keeps getting pulled out of this game.
   */
  private drawHurtFrom(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    if (!this.hurtFrom.some((v) => v > 0)) return;
    const top = 46;
    // Clamped to the VIEWPORT as well as to the book. `bookTop` is the book's real
    // measured edge and sits below the screen while the book is down — which is most
    // of the time, since it only rises for a selected target — so trusting it alone
    // put the "behind" chevron off the bottom of the phone, which is precisely the
    // one direction the player cannot otherwise see.
    const bot = Math.min(H - 26, Math.max(top + 80, this.bookTop - 10));
    const cx = W / 2, cy = (top + bot) / 2;
    const rx = W * 0.42, ry = (bot - top) * 0.44;

    // Same low-res buffer treatment as the strike: composed at about a sixth scale
    // and blitted with smoothing off, so the chevrons are built out of the same size
    // of block as the stone behind them.
    // Four, not the strike's six. A chevron has to keep a POINT to say which way it
    // means, and at a sixth scale the sideways ones lost theirs and read as bars.
    const S = 4;
    const bw = Math.max(24, Math.round(W / S)), bh = Math.max(24, Math.round(H / S));
    if (!this.hurtBuf) this.hurtBuf = document.createElement('canvas');
    const buf = this.hurtBuf;
    if (buf.width !== bw || buf.height !== bh) { buf.width = bw; buf.height = bh; }
    const b = buf.getContext('2d')!;
    b.clearRect(0, 0, bw, bh);

    for (let i = 0; i < 4; i++) {
      const v = this.hurtFrom[i];
      if (v <= 0) continue;
      // Fresh hits flash; the tail is steady so it can be read rather than chased.
      const flash = v > 0.8 ? 0.7 + Math.sin(this.engine.time * 30) * 0.3 : 1;
      b.globalAlpha = Math.min(1, v * 1.15) * flash;
      b.fillStyle = '#ff3a2a';
      b.strokeStyle = 'rgba(20,8,10,0.9)';
      b.lineWidth = 0.6;

      // Size carries how hard it was, which is the other thing the analysis singles
      // out — Overwatch scales the indicator by the hit rather than only fading it.
      const k = 0.7 + v * 0.5;
      // Deep relative to its span, so the point is unmistakable at this size.
      const half = (30 * k) / S, depth = (24 * k) / S;
      // 0 ahead, 1 right, 2 behind, 3 left — then the chevron points AWAY from the
      // middle, so it reads as "from over there" and not "go this way".
      const ax = (i === 1 ? cx + rx : i === 3 ? cx - rx : cx) / S;
      const ay = (i === 0 ? cy - ry : i === 2 ? cy + ry : cy) / S;
      const horizontal = i === 1 || i === 3;
      const out = i === 1 || i === 2 ? 1 : -1;

      b.beginPath();
      if (horizontal) {
        b.moveTo(ax + depth * out, ay);
        b.lineTo(ax - depth * out * 0.4, ay - half);
        b.lineTo(ax - depth * out * 0.05, ay);
        b.lineTo(ax - depth * out * 0.4, ay + half);
      } else {
        b.moveTo(ax, ay + depth * out);
        b.lineTo(ax - half, ay - depth * out * 0.4);
        b.lineTo(ax, ay - depth * out * 0.05);
        b.lineTo(ax + half, ay - depth * out * 0.4);
      }
      b.closePath();
      b.fill();
      b.stroke();
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, 0, 0, bw, bh, 0, 0, W, H);
    ctx.restore();
  }

  /**
   * The strike, drawn across the whole overlay — as PIXEL ART.
   *
   * It is composed into a small offscreen buffer and blitted up with smoothing off,
   * so every edge lands on the same kind of chunky grid the world is drawn on. The
   * first version drew straight onto the full-resolution overlay with radial
   * gradients and a shadow blur, and it looked like a slick vector effect pasted
   * over a pixel-art game — the exact failure the belt icons were pulled for.
   *
   * Everything below is therefore written in BUFFER pixels, of which there are
   * about sixty across, and shapes are sized so they survive that.
   *
   * Three kinds share one vocabulary — arrive fast, leave faster, carry the
   * creature's colour rather than blood red — so they read as one language.
   */
  private drawHitFx(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const fx = this.hitFx;
    if (!fx || this.hitFxT <= 0) return;
    const k = 1 - this.hitFxT;              // 0 at impact, 1 when spent
    const fade = Math.sin(this.hitFxT * Math.PI * 0.9);
    const col = hexCss(fx.colour);
    const rnd = (n: number): number => {
      const x = Math.sin(this.hitFxSeed + n * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };

    // ~6 overlay pixels per buffer pixel, which is close enough to the world's own
    // texel size at the default step that the two do not look like different games.
    const bw = Math.max(24, Math.round(W / 6));
    const bh = Math.max(24, Math.round(H / 6));
    if (!this.fxBuf) this.fxBuf = document.createElement('canvas');
    const buf = this.fxBuf;
    if (buf.width !== bw || buf.height !== bh) { buf.width = bw; buf.height = bh; }
    const b = buf.getContext('2d')!;
    b.clearRect(0, 0, bw, bh);
    b.fillStyle = col;
    b.strokeStyle = col;
    b.lineCap = 'butt';
    b.lineJoin = 'miter';

    if (fx.kind === 'rake') {
      // Three strokes sweeping across, each a little behind the last, so the eye
      // reads one hand rather than three unrelated cuts.
      const ang = -0.75 + rnd(1) * 0.5;
      const cx = bw * (0.3 + rnd(2) * 0.4), cy = bh * (0.3 + rnd(3) * 0.2);
      // Nearly together, and thin. Staggered too far apart only ever showed one
      // stroke at a time, which reads as a beam rather than as a hand.
      for (let i = 0; i < 3; i++) {
        const lead = Math.max(0, Math.min(1, k * 2.4 - i * 0.09));
        if (lead <= 0) continue;
        const off = (i - 1) * Math.round(bw * 0.11);
        const len = bh * 0.72 * lead;
        b.globalAlpha = fade * (1 - i * 0.16);
        b.lineWidth = 1.6 - i * 0.25;
        b.beginPath();
        b.moveTo(cx - Math.cos(ang) * len * 0.5 + off, cy - Math.sin(ang) * len * 0.5 - off * 0.3);
        b.lineTo(cx + Math.cos(ang) * len * 0.5 + off, cy + Math.sin(ang) * len * 0.5 - off * 0.3);
        b.stroke();
      }
    } else if (fx.kind === 'burst') {
      // Thrown or vented AT you. Concentric hard rings rather than a gradient —
      // a gradient is the one thing that cannot survive being called pixel art.
      const cx = Math.round(bw * 0.5), cy = Math.round(bh * 0.34);
      const r = Math.max(bw, bh) * (0.04 + k * 0.5);
      for (let i = 0; i < 3; i++) {
        const rr2 = r * (1 - i * 0.26);
        if (rr2 <= 0) continue;
        b.globalAlpha = fade * (0.16 + i * 0.16);
        b.beginPath();
        b.arc(cx, cy, rr2, 0, Math.PI * 2);
        b.fill();
      }
      b.globalAlpha = fade;
      b.lineWidth = 2;
      for (let i = 0; i < 7; i++) {
        const a = rnd(10 + i) * Math.PI * 2;
        b.beginPath();
        b.moveTo(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5);
        b.lineTo(cx + Math.cos(a) * r * 1.5, cy + Math.sin(a) * r * 1.5);
        b.stroke();
      }
    } else {
      // Something LONG reached you: one whipping curve that overshoots and recoils.
      const y0 = bh * (0.25 + rnd(4) * 0.3);
      const dir = rnd(5) > 0.5 ? 1 : -1;
      const reach = k < 0.45 ? k / 0.45 : 1 - (k - 0.45) / 0.55 * 0.35;
      b.globalAlpha = fade;
      b.lineWidth = 4 - k * 2;
      b.beginPath();
      const x0 = dir > 0 ? -3 : bw + 3;
      b.moveTo(x0, y0);
      b.quadraticCurveTo(
        x0 + dir * bw * 0.55 * reach, y0 - bh * 0.16 * reach,
        x0 + dir * bw * 1.05 * reach, y0 + bh * 0.1 * reach,
      );
      b.stroke();
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.8;
    ctx.drawImage(buf, 0, 0, bw, bh, 0, 0, W, H);
    ctx.restore();
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
    /**
     * THE OTHER HALF OF THE TELEGRAPH: the bar itself pulses while anything can
     * reach you, and says how many.
     *
     * The ring drawn on a creature only works for a creature you can SEE, and the
     * threat that most needs announcing is the one around the corner — two tiles
     * away, closing and swinging in the same round, with nothing on screen. This
     * carries that case without leaking where it is, which the minimap deliberately
     * will not do either.
     */
    const n = this.threats.size;
    if (n > 0) {
      const pulse = 0.5 + Math.sin(this.engine.time * 7) * 0.5;
      ctx.globalAlpha = 0.45 + pulse * 0.55;
      ctx.strokeStyle = '#ff3a2a';
      ctx.lineWidth = 1.5;
      rr(ctx, 12, y, bw, 9, 4); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.font = '8px ui-monospace, monospace';
    ctx.fillStyle = PARCH;
    ctx.fillText(`${Math.max(0, this.state.hp)}/${this.state.maxHp}`, 14, y + 12);
    if (n > 0) {
      const label = `${n} IN REACH`;
      ctx.font = 'bold 8px ui-monospace, monospace';
      ctx.fillStyle = '#ff6a55';
      ctx.fillText(label, 14 + ctx.measureText(`${Math.max(0, this.state.hp)}/${this.state.maxHp}`).width + 10, y + 12);
    }
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
    // Nudged 4px clear of the belt's count badges, which hang off the strap and reach
    // `bookTop + 7`. Any further down and it lands on the open page's chapter line,
    // which is worse than the collision it was fixing.
    const bx = (W - tw) / 2, by = this.bookTop + 11;
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

  /** Cycle-target button — sits clear of the swipe area. */
  private drawCycle(ctx: CanvasRenderingContext2D, W: number): void {
    // Same row as the CAST bar, so the two move together off one constant.
    const r = 18, cx = W - 30, cy = this.bookTop - BELT_BAND - 34;
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
