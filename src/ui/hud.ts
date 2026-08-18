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
import { isCastableObject, type Entity } from '../game/floor';
import { DENIAL_STATUSES, reactionFor, type Combat, type PlayerState } from '../game/combat';
import {
  INGREDIENT_IDS, SPELL_BY_ID, STATUS_META, displayName, harvestOf, isElement,
  rankName, wantsCorpse, wantsObject,
  type Element, type ResolvedCast,
} from '../spells/spells';
import type { BeltSlot } from '../spells/belt';
import { drawBeltIcon } from './beltIcons';
import { BELT_ENABLED } from '../flags';
import type { HitFx } from '../game/hitfx';
import { Pix, hex } from '../art/pixel';
import { drawPortrait, PORTRAIT_ASPECT } from './portraits';
import type { Wizard } from '../game/wizards';
import { drawCentered, CELL_H } from '../art/bitfont';
import * as THREE from 'three';
import { DIR_VEC, Tile, type Dir } from '../dungeon/grid';
import { PORTAL_HUES, STEP_H } from '../art/tiles';
import { spriteTexture } from '../dungeon/sprites';
import { BLOCK_H } from '../dungeon/clockView';
import type { Floor } from '../game/floor';
import { CARD_H, CARD_W, pageCard, scrollCard } from '../book/offerCard';
import { ALL_PAGES } from '../spells/pages';

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
/**
 * A tile the player has aimed at, as opposed to a body.
 *
 * Burning ground is the first thing in this game worth aiming at that is not an
 * entity — it lives as tile indices in `Ground` and is drawn from a pooled quad, and
 * giving it a body just to be targetable would put a second copy of the truth beside
 * the one that already works.
 *
 * `tile: true` is the discriminant, and it is a literal rather than a `kind` string
 * because `Entity` already has a `kind` meaning something else entirely.
 */
export interface TileTarget { tile: true; x: number; y: number }

/** What the reticle can be on: a body, or a tile. */
export type AimTarget = Entity | TileTarget;

export function isTileTarget(t: AimTarget | null): t is TileTarget {
  return !!t && (t as TileTarget).tile === true;
}

/**
 * Are these the same aim?
 *
 * Bodies compare by identity; tiles cannot, because a tile target is a fresh object
 * every time the candidate list is rebuilt — which is every frame. Comparing those by
 * reference silently dropped the reticle on the frame after it was set.
 */
export function sameTarget(a: AimTarget | null, b: AimTarget | null): boolean {
  if (!a || !b) return a === b;
  if (isTileTarget(a) || isTileTarget(b)) {
    return isTileTarget(a) && isTileTarget(b) && a.x === b.x && a.y === b.y;
  }
  return a === b;
}

export type AltarOfferKind =
  | 'new' | 'upgrade' | 'sacrifice' | 'star' | 'golden'
  // A bundle of one belt ingredient. About a spell, but never about a PAGE, so it
  // does not satisfy the "no roll is spell-free" rule — see `rollExtras`, which is
  // where it is rolled and where it is gated on the belt being able to keep it.
  | 'heal' | 'stars' | 'ingredient'
  /**
   * A run-start BLESSING, chosen at the dungeon mouth before floor 1.
   *
   * On the altar's offer type rather than a type of its own, because it is the same
   * gesture answering the same question — three objects, choose one — and the modal
   * that draws it is already exactly right. A second chooser would be a second thing
   * to keep in step with this one.
   */
  | 'blessing'
  /**
   * WHERE THE RUN BEGINS, offered at the mouth once a deed has unlocked a deeper
   * start. Its own kind and not a blessing, because both would otherwise be an
   * id-less offer carrying a number in `amount` and the two would resolve as each
   * other — a start-depth pick granting a blessing's stars.
   */
  | 'startDepth'
  /**
   * THE ONE PAGE the run sets out with, chosen at the mouth out of what the star
   * tree has bound. Its own kind rather than a `new`, because a `new` is an altar
   * offer that has an altar behind it to spend and a stone to walk away from; this
   * one is answered before the first turn and cannot be declined.
   */
  | 'startPage';

/**
 * One of the three things an altar is offering.
 *
 * Everything a card has to draw is ON the offer. The altar is the one moment in a
 * run where the player is reading rather than reacting, so a card assembled by
 * reaching back into the run — current rank, current HP, what the loadout holds —
 * is a card that can quietly disagree with what taking it actually does. The
 * offer is built once, at roll time, and it is the whole truth about itself.
 */
/**
 * The mark on a non-spell offer's scroll — a glyph, not a word, because the copy
 * under the card already says it and a scroll with a sentence on it is a page.
 */
/**
 * The word under a scroll's sigil. The sigil says WHAT, this says which — and the
 * copy beneath the card says the rest.
 */
const OFFER_LABEL: Record<string, string> = {
  heal: 'mend', stars: 'stars', star: 'stars',
  rank: 'deepen', upgrade: 'deepen', sacrifice: 'sacrifice',
  ingredient: 'vial', blessing: 'blessing', startDepth: 'descend',
  startPage: 'carry',
};

export interface AltarOffer {
  kind: AltarOfferKind;
  /**
   * Portrait asset id, when this card is about a PERSON rather than a page.
   *
   * Optional because it is only ever set by the roster screen — an altar's offers are
   * pages and heals, and giving those a face would be the card claiming to be somebody.
   */
  portrait?: string;
  /**
   * The page this offer is about, or `''` when it is about nothing in the book
   * (heal, stars).
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
  | { kind: 'target'; entity: AimTarget }
  | { kind: 'cycle' }
  /** Open or close the bestiary. Free, always — see `Hud.drawBestiary`. */
  | { kind: 'bestiary' }
  /** Open or close the settings panel — see `Hud.drawSettings`. */
  | { kind: 'settings' }
  /** Look at a wizard on the roster screen. Opens their profile; does NOT pick them. */
  | { kind: 'wizardPeek'; id: string }
  /** Commit to the wizard whose profile is open. The CHOOSE button, and only that. */
  | { kind: 'wizardPick'; id: string }
  /** Back out of a profile to the roster. */
  | { kind: 'wizardBack' }
  /** Toggle the one gesture-direction preference — see `Meta.invertGestures`. */
  | { kind: 'invertGestures' }
  /** Cut a captive loose. Once ever, per hero — see `main.ts`'s `rescue`. */
  | { kind: 'rescue'; entity: Entity }
  /** Dismiss the rescue card. */
  | { kind: 'rescueDone' }
  /**
   * Wipe the save. Fires only on the SECOND tap of the reset row, because the first
   * one arms it — see `Hud.resetArmed`. A single tap that deletes every star a player
   * has ever banked is not a control, it is a trap.
   */
  | { kind: 'resetProgress' }
  | { kind: 'offer'; offer: AltarOffer }
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
 * The room the deleted ✕ badge used to need above each card, given back.
 *
 * The badge perched outside a card's top corner, so everything stacked above the fan —
 * the CAST key and its heading — was really clearing the BADGE and not the cards. With
 * it gone that clearance is a gap, and the band drops by exactly what the badge was
 * costing rather than by a number picked to look right.
 */
const CARD_BADGE_WAS = 14;

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
/**
 * Ten, because the dungeon is ten floors deep.
 *
 * It stopped at V and the readout CLAMPS rather than overflows, so every floor from
 * the sixth down announced itself as DEPTH V — the deepest floor in the game wore the
 * old midpoint's number.
 */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/**
 * The size the cog GLYPH is drawn at, in HUD px.
 *
 * Larger than the 17px row it sits on, on purpose: ⚙ fills much less of its em box than
 * a digit does, so type-size parity would leave it visibly the smaller of the two. This
 * is the size at which the drawn cog matches the drawn star count.
 */
/** Seconds a run of fruitless taps stays open before it is forgotten. */
const TAP_WINDOW = 1.6;
/** Seconds the nudged instruction stays on screen. */
const NUDGE_SHOW = 3.5;

const COG_SIZE = 23;
/** The top row's text top edge — the depth label and the star count both sit on it. */
const ROW_TOP = 12;
/**
 * The in-game portrait beside the health bar. Small — it is a reminder of who you are,
 * not a picture to look at, and the 66x98 source crops to this aspect without losing any
 * of the face (see `drawPortrait`).
 */
/**
 * THE MINIMAP'S OWN GEOMETRY, hoisted so the portrait can mirror it exactly.
 *
 * These were locals inside `drawMiniMap` — SPAN 4, CELL 11, +6 of padding, top at 28. The
 * portrait is supposed to be the same height as the map and sit opposite it, and "the same
 * height" has to be one number rather than two that agree today.
 */
const MAP_SPAN = 4;
const MAP_CELL = 11;
const MAP_SIZE = (MAP_SPAN * 2 + 1) * MAP_CELL + 6;
/**
 * The cards' top edge, derived from the row above instead of written as 28.
 *
 * At 28 it cleared the row's 17px em box by four pixels, and four pixels is the worst
 * distance there is: too close to read as a gap and too far to read as touching, so the
 * eye keeps going back to check whether the label is sitting on the portrait's frame. A
 * clear ten reads as two rows, which is what they are.
 */
const MAP_TOP = ROW_TOP + 17 + 10;
/**
 * Right edge the star readout aligns to, derived from the cog rather than written
 * twice. The two used to share `W - 12` and the cog would have sat on the count.
 *
 * The cog's ink runs from `W - 12` leftward, so this is its far edge plus a 14px gap —
 * enough that the row reads as `✦ 85   ⚙` and not as one three-part badge.
 */
const STARS_RIGHT = (W: number): number => W - COG_SIZE - 26;

/**
 * Desaturate whatever was just drawn into this rect — WITHOUT `ctx.filter`.
 *
 * `ctx.filter` is the obvious way to write this and it does nothing on the platform
 * the game ships to. Canvas filters landed in Safari only recently, so on a large
 * share of iPhones every `grayscale(1)` in this file was silently a no-op: locked
 * wizards on the roster came up in full colour, indistinguishable from the one the
 * player owns, and it looked correct on every desktop it was ever checked on.
 *
 * The `saturation` blend mode is the portable equivalent and has been in Safari for
 * years. Painting a zero-saturation grey through it keeps the backdrop's luminosity
 * and takes its colour away, which is exactly what the filter did.
 */
function desaturate(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
): void {
  const was = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'saturation';
  ctx.fillStyle = 'hsl(0,0%,50%)';
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = was;
}

/** Lift what was just drawn, the same way and for the same reason. */
function brighten(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, amount: number,
): void {
  const was = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(255,255,255,${amount})`;
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = was;
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
  target: AimTarget | null = null;
  /** Candidates the player can tap, refreshed by the game each turn. */
  candidates: AimTarget[] = [];
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
    // A tile has no affinities. The chip is a claim about a CREATURE's element and
    // drawing "???" over burning ground would be inventing a creature to be unsure
    // about.
    if (!t || isTileTarget(t) || !this.knownFor) return null;
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
   * Is the book mid-animation — flying in, leafing itself, flipping?
   *
   * Separate from `bookClosed`, which asks whether the book is DOWN. A book that is
   * on its way up is neither closed nor usable, and the empty hand slots are an
   * instruction: "drag a page out of the book". Drawn over a book that is still
   * arriving, that instruction cannot be followed, which makes the opening read as
   * unresponsive rather than as animated (`Roadmap/First_Minutes.md`).
   */
  bookBusy = false;

  /**
   * What the open chooser is FOR. The altar sets neither and gets the default; the
   * dungeon-mouth blessing sets both, because "THE ALTAR OFFERS" over a choice made
   * before the first floor would be naming a thing the player has not met.
   */
  offerTitle = 'THE ALTAR OFFERS';
  offerSubtitle = 'choose one';

  /** Rasterised offer objects, keyed on what makes one look different. */
  private offerArt = new Map<string, HTMLCanvasElement>();

  /**
   * Has the player taken a single step yet?
   *
   * Nothing in the game says how to move. The book teaches itself — it flies in, it
   * says to drag a page — and then the player is standing in a corridor with no idea
   * that the world responds to a swipe at all. This is the one sentence that fixes
   * it, and it goes away the moment it has been obeyed: a hint that persists is a
   * hint that failed (`Roadmap/First_Minutes.md`).
   */
  hasMoved = false;

  /** The nudged instruction's remaining time, and the run of fruitless taps that
   *  earns it. See `idleTap`. */
  private nudgeT = 0;
  private tapRun = 0;
  private tapRunT = 0;

  /**
   * Every fusion this player has ever cast, newest last. Owned by `meta`.
   *
   * The one record that is never sold back. There is no node, no price and no unlock
   * anywhere near it, and there must not be: a paywall on the player's own memory is
   * explicitly rejected in `docs/DESIGN.md`.
   */
  bestiary: readonly string[] = [];
  bestiaryOpen = false;
  settingsOpen = false;
  /**
   * Has the reset row been tapped once already?
   *
   * Lives on the HUD rather than in `main.ts` because it is a property of the PANEL
   * being open: closing settings has to disarm it, and the only thing that knows the
   * panel closed is the thing that draws it.
   */
  resetArmed = false;
  /**
   * The FOV the slider should draw, and the range it spans. Pushed in by `main.ts`
   * rather than read from the save here, so the HUD keeps knowing nothing about
   * persistence — the same arrangement `bankedStars` has.
   */
  fov = 100;
  fovRange: readonly [number, number] = [85, 120];
  /** Track geometry from the last draw, so a drag can be resolved against it. */
  fovTrack: { x: number; y: number; w: number } | null = null;
  /** Mirror of `Meta.invertGestures`, pushed in by `main.ts` like `fov` is. */
  invertGestures = false;
  /**
   * The rescue card: who was just freed, and who freed them. Null the rest of the time.
   *
   * Both wizards, because the beat is the one moment two of them share a screen — a card with
   * only the captive on it is a notification, and a notification is what this is deliberately
   * not.
   */
  rescued: { wizard: Wizard; by: Wizard | null } | null = null;
  /**
   * Who the player is this run. Null only before a wizard has been chosen, which is the
   * one moment the vitals block has no name to put over the bar.
   */
  wizard: Wizard | null = null;
  /**
   * The roster screen. Non-null only at the dungeon mouth, before a run has a wizard.
   *
   * Its own screen rather than a set of `offers`, and that is the whole point of this
   * pass: an offer is a CARD — a page with a title, a sigil well and a rules line — and a
   * portrait pasted into a card's sigil well looks exactly like a portrait pasted into a
   * card's sigil well. A person is not a page, so this draws none of that furniture.
   *
   * Every wizard is always here, in chain order, locked ones included and greyed. A
   * roster that hides what you have not earned cannot answer "what am I working toward",
   * which is half the reason it exists.
   */
  roster: readonly { wizard: Wizard; locked: boolean; freedBy: string | null }[] | null = null;
  /** The wizard whose profile is open over the roster, or null for the grid itself. */
  rosterPeek: Wizard | null = null;
  /**
   * The page the peeked wizard begins with, pushed in by `main.ts`.
   *
   * Handed over rather than looked up here, because the HUD does not import the spell
   * tables and should not start — the roster screen is the only place that needs to say
   * what a wizard casts, and `main.ts` already holds `SPELL_BY_ID`.
   */
  startSpell: { name: string; effect: string } | null = null;
  /**
   * The peeked wizard's page, as a real offer, so the profile can draw the ACTUAL card
   * through `offerCanvas` rather than inventing a second kind of spell card.
   */
  startCard: AltarOffer | null = null;

  /**
   * Where the compass points, or null when nothing does.
   *
   * Written by `main.ts`, which is the only place that knows the priority — an
   * unclaimed altar, then the boss while it lives, then the stairs once it is dead.
   * The HUD draws a bearing and asks no questions about what earned it.
   */
  compassGoal: { x: number; y: number; label: string; colour: string } | null = null;

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

  /** True while a cutscene owns the screen. See `draw`. */
  cinema = false;

  /**
   * The ONE thing a cut is allowed to draw, and only once it has finished saying
   * what it flew out to say.
   *
   * Offering the skip at the top of the cut is offering the player a way out of a
   * shot before they know what the shot is of, which is how you teach somebody that
   * your cutscenes are not worth watching. The game sets this when the gate has
   * landed; until then there is nothing on the screen at all.
   */
  cinePrompt: string | null = null;

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
    /**
     * The stairs are furniture that DOES NOT EXIST YET. Every other fixture is safe
     * to remember from exploration because it was there when you saw it; the way
     * down is generated with the floor and hidden until the boss falls, so the
     * explored rule had the map advertising a door that had not been opened — and
     * then the door turned out to be somewhere else, because it now opens where the
     * boss dies.
     */
    if (e.kind === 'stairs') return floor.stairsOpen && !!g.explored[i];
    return (e.hostile || e.animated) ? floor.visible.has(i) : !!g.explored[i];
  }

  /** Where the minimap reads the world from. Bound per floor. */
  private map: (() => { floor: Floor; x: number; y: number; dir: Dir }) | null = null;

  bindMap(fn: () => { floor: Floor; x: number; y: number; dir: Dir }): void {
    this.map = fn;
  }

  /**
   * The vertical middle of the top row's ink, measured by `drawTopBar` as it draws it.
   *
   * Exists so the cog can sit level with the star count without either of them owning a
   * magic number the other has to match. See `drawSettingsCog`.
   */
  private topRowMid = ROW_TOP + 6;

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
    const body = isTileTarget(t) ? null : t;
    const tile = isTileTarget(t) ? t : null;
    /**
     * Ground fire joins the cast, so the preview has to include it or the spell
     * changes identity the moment the player commits. Aimed at a TILE the fuel comes
     * from that tile; aimed at a body, from the tile it stands on.
     */
    return this.combat.previewAimed(
      ids,
      body
        ? {
            kind: body.animated ? 'golem' : body.kind === 'prop' ? 'prop'
              : body.kind === 'boss' ? 'boss' : body.kind === 'chest' ? 'chest' : 'enemy',
            propId: body.kind === 'prop' && !body.animated ? body.spriteId : undefined,
          }
        // A tile has no kind to speak of. `none` is right: nothing about the cast
        // resolves off what it was thrown at, only off where it lands.
        : { kind: 'none' },
      tile,
      body);
  }

  update(dt: number): void {
    // The nudge and the tap run, on the same clock as everything else here.
    if (this.nudgeT > 0) this.nudgeT = Math.max(0, this.nudgeT - dt);
    if (this.tapRunT > 0) {
      this.tapRunT = Math.max(0, this.tapRunT - dt);
      if (this.tapRunT === 0) this.tapRun = 0;
    }
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
    // Drop a dead target. A tile cannot die — `refreshTargets` drops it when the
    // fire goes out, which is the only way a tile stops being a candidate.
    if (this.target && !isTileTarget(this.target) && !this.target.alive) this.target = null;
  }

  // ---------------------------------------------------------------------- draw

  /**
   * THE WHOLE HUD LAYS OUT IN THE SAFE BOX. This is the only place that knows it.
   *
   * The stage is untouched and the world still bleeds to all four edges — the dungeon is
   * scenery and a wall clipped by a corner radius costs nothing. The CHROME is what the
   * phone's own furniture eats: the camera housing takes the top strip, the corners are
   * cut by a ~50px arc, the home indicator owns the bottom band. So the ink and the hit
   * boxes both move inside `engine.insetTop`/`insetBottom` and everything downstream —
   * every `y = 12` and every `H - 76` in this file — lands inside the safe box without
   * knowing the insets exist.
   *
   * One space rather than a per-element opt-in, because the failure this replaced was a
   * cog whose ink had moved and whose hit box had not. Anything that genuinely needs
   * real stage pixels says so at its call site: `atStage` for the world overlay, and
   * `engine.sh` for the handful of washes that have to cover the physical screen.
   *
   * The hit rects are plain numbers that `ctx.translate` cannot reach, so they are
   * shifted here, once, after everything has been pushed.
   */
  draw(ctx: CanvasRenderingContext2D): void {
    const t = this.engine.insetTop;
    this.hits = [];
    ctx.save();
    ctx.translate(0, t);
    this.drawSafe(ctx, this.engine.sw, this.engine.sh - t - this.engine.insetBottom);
    ctx.restore();
    for (const h of this.hits) h.rect[1] += t;
  }

  /**
   * Draw in REAL STAGE PIXELS, undoing the safe-box shift for the duration.
   *
   * For the world overlay only. Its reticles come from `engine.worldToUi`, which
   * projects to the stage the world is actually rendered on, so a reticle drawn in the
   * safe box would sit `insetTop` below the creature it is pointing at. Its hit rects
   * are unshifted to match, which cancels the shift `draw` applies to all of them.
   */
  private atStage(ctx: CanvasRenderingContext2D, f: () => void): void {
    const t = this.engine.insetTop;
    const n0 = this.hits.length;
    ctx.save();
    ctx.translate(0, -t);
    f();
    ctx.restore();
    for (let i = n0; i < this.hits.length; i++) this.hits[i].rect[1] -= t;
  }

  private drawSafe(ctx: CanvasRenderingContext2D, W: number, H: number): void {

    /**
     * CINEMA MODE DRAWS NOTHING.
     *
     * Not "most of the HUD" — nothing. A cut is the one moment the game is not asking
     * the player for anything, and a health bar and a minimap over the top of it turn
     * a shot of the room into a screenshot of a game. `hits` is left empty on purpose
     * too, so there is no control to press by accident; the tap that ends the hold is
     * caught upstream of any of this.
     */
    if (this.cinema) { this.drawCinePrompt(ctx, W, H); return; }

    /**
     * The book's top edge is measured BEFORE the world overlay, not after it.
     *
     * It used to be computed further down, with the rest of the band, and the world
     * overlay had no idea where the book was — so a ground target on the tile you are
     * standing next to projects to a quad most of the screen tall, and its outline
     * was stroked straight across the grimoire. The book is a 3D object rendered in
     * the overlay pass and the HUD canvas composites on top of it, so canvas always
     * wins that fight: the reticle drew over the cards.
     *
     * Everything the player must SEE lives above this line, which is exactly the
     * contract `bookTop` already had; the world overlay simply was not being held to
     * it. It is clipped to that band now, and so are its hit regions.
     *
     * The line itself is the grimoire's own measured edge, and when the book is away,
     * whatever replaced it — the large CAST (see `drawBigCast`) becomes the anchor the
     * rest of the band lays out above, exactly as the cover was. Without that the band
     * dropped to 0.90H the instant the book left and the cycle-target button landed on
     * top of the button that had taken the book's place.
     */
    /**
     * In SAFE-BOX pixels like the rest of the layout, which is why the measured edge has
     * the top inset taken off it: `measuredBookTop` comes from the 3D book on the full
     * stage, and every reader of `bookTop` in this file is laying out chrome.
     */
    this.bookTop = !this.bookClosed && this.measuredBookTop !== null
      ? Math.round(this.measuredBookTop) - this.engine.insetTop
      : this.handFull() ? Math.round(H * 0.80)
      : Math.round(H * 0.90);

    // The overlay is the one thing drawn on the stage rather than in the safe box, so its
    // clip is in stage pixels too — the book's real edge, not the shifted one.
    const bookTopStage = this.bookTop + this.engine.insetTop;
    this.atStage(ctx, () => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, bookTopStage);
      ctx.clip();
      this.drawWorldOverlay(ctx);
      ctx.restore();
    });
    // A target you cannot see is a target you cannot mean to tap. Clipping the ink
    // without clipping the hit region would leave an invisible control over the book.
    // These are the overlay's own hits, so the comparison is in stage pixels as well.
    this.hits = this.hits.filter((h) => h.rect[1] < bookTopStage);
    this.drawTopBar(ctx, W);
    this.drawMiniMap(ctx, W);
    // Above the run-end return below, so the one control that is not about the run
    // stays reachable on a run that has ended.
    this.drawSettingsCog(ctx, W);

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

    this.drawBelt(ctx, W);
    // Before the CAST bar, so that where a card's box and the bar's touch, CAST wins:
    // `hit` scans backwards, so whatever is pushed last is on top.
    this.drawCompass(ctx, W, H);
    this.drawMoveHint(ctx, W, H);
    this.drawEmptySlots(ctx, W);
    this.drawFanCards();
    this.drawCastBar(ctx, W);
    this.drawBigCast(ctx, W);
    this.drawLog(ctx, W);
    this.drawVitals(ctx, W);
    this.drawHitFx(ctx, W, H);
    this.drawHurtFrom(ctx, W, H);
    this.drawDiscovery(ctx, W);
    this.drawPin(ctx);
    this.drawParty(ctx, W);
    this.drawSealedNote(ctx, W);
    this.drawHarvest(ctx, W);
    this.drawAltarPrompt(ctx, W);
    if (this.candidates.length > 1) this.drawCycle(ctx, W);
    if (this.descendReady) this.drawDescend(ctx, W);
    if (this.offers) this.drawOffers(ctx, W, H);
    // Before the bestiary and the cog, because at the dungeon mouth the roster is the
    // only thing on screen and nothing else may be reachable underneath it.
    if (this.roster) this.drawRoster(ctx, W, H);
    if (this.bestiaryOpen) this.drawBestiary(ctx, W, H);
    // Last, so it covers everything including the bestiary. The cog is hidden while
    // the bestiary is up, so the two can never both be open — but drawing order is
    // the wrong place to rely on that.
    if (this.settingsOpen) this.drawSettings(ctx, W, H);
    // Last of all: a rescue interrupts everything, because it happens once ever.
    if (this.rescued) this.drawRescue(ctx, W, H);
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
  /**
   * The skip line, low and small and quiet.
   *
   * Bottom of the frame rather than the middle, thin rather than bold: it is an
   * offer, not an instruction, and it has to lose every fight it picks with what is
   * happening behind it. It breathes so that it reads as live rather than as a
   * caption burnt into the shot.
   */
  private drawCinePrompt(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    if (!this.cinePrompt) return;
    const pulse = 0.62 + 0.28 * Math.sin(this.engine.time * 3.1);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = H - 34;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const w = ctx.measureText(this.cinePrompt).width + 22;
    ctx.fillRect((W - w) / 2, y - 10, w, 20);
    ctx.fillStyle = '#e8dcc0';
    ctx.fillText(this.cinePrompt, W / 2, y + 1);
    ctx.restore();
  }

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

    for (const c of this.candidates) {
      /**
       * A TILE marker: a ring on the ground, drawn where the fire is.
       *
       * Not the down-triangle bodies get. That marker points at a silhouette from
       * above, and burning ground has no silhouette — a ring lying on the tile says
       * "this square" in a way an arrow hovering over it cannot.
       */
      if (isTileTarget(c)) {
        /**
         * The SELECTED tile only, drawn as the tile itself.
         *
         * Two things were wrong with marking every burning tile. A fixed-size ellipse
         * does not shrink with distance, so three tiles receding down a corridor
         * stacked into a pile of little rings that read as a rendering artefact; and
         * "selected" was a brightness difference inside that pile, which is no
         * difference at all.
         *
         * Unselected tiles get NO mark. They do not need one — the fire is already
         * the most visible thing in the room, and a marker on something that is
         * already shouting is noise. They stay tappable; the hit region below is
         * registered either way.
         *
         * The mark is the tile's own four corners projected, so it sits ON the square
         * in perspective and says "this one" the way a floating ring never could.
         */
        /**
         * The tile's four corners, projected. They are the hit region as well as the
         * outline, so what the player taps is exactly the square they can see.
         *
         * A fixed-size rect was the first version and it was fiddly for two opposite
         * reasons at once: too small on a tile at the far end of a corridor, and far
         * smaller than the fire it was marking on a tile underfoot. A projected quad
         * is neither, because it IS the tile.
         */
        const corner = { x: 0, y: 0, behind: false };
        const pts: [number, number][] = [];
        /**
         * A BLOCK IS MARKED ON THE TOP OF IT, not on the tile under it.
         *
         * The two things a tile target can be are now opposite shapes: burning ground
         * lies flat, and a block stands nearly to the ceiling. Ringing the floor plane
         * under a block draws the outline where the stone is hiding it and puts the
         * tap region at its feet — so most of the object the player is looking at is
         * not the thing they can press. Lifting both to the lid fixes the same defect
         * twice, because the outline IS the hit region.
         */
        /**
         * AND IT STANDS ON ITS OWN FLOOR, which is not always the plane y=0.
         *
         * The corners were projected at zero flat, which was right for as long as
         * every tile in the game was at zero. Verticality made it wrong for both
         * kinds of tile target — a fire in a sunken room got its outline drawn a
         * whole storey above the flames — and it is only visible at all in the rooms
         * that step, which is why it survived.
         */
        const cg = this.map ? this.map().floor.grid : null;
        const lift = cg
          ? cg.heightAt(c.x, c.y) * STEP_H + (cg.at(c.x, c.y) === Tile.Block ? BLOCK_H : 0)
          : 0;
        for (const [ox, oz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as const) {
          /**
           * y = 0 exactly, which is the floor plane the tiles are built on.
           *
           * It was 0.05 — lifted, the way the fire decal is, to avoid z-fighting.
           * But this outline is drawn by the HUD in 2D over the frame, so it can
           * never z-fight with anything; all the lift did was project the corners
           * from five centimetres above the ground, and at this camera's grazing
           * angle that is a visible slide up-frame. The outline sat off its own tile.
           */
          project(new THREE.Vector3(c.x + ox, lift, c.y + oz), corner);
          if (corner.behind) { pts.length = 0; break; }
          pts.push([corner.x, corner.y]);
        }
        if (!pts.length) continue;

        /**
         * AND THE HIT REGION IS THE WHOLE STONE, not just its lid.
         *
         * Lifting the outline to the top of a block put the tap region up there with
         * it, which is right for the mark and wrong for the finger: a block stands
         * nearly a storey tall and at this camera the face you are looking at is the
         * SIDE of it, so the only part of a block that answered a tap was the sliver
         * of lid visible over the top. Tapping the stone itself — the large, obvious,
         * lit thing filling the frame — did nothing, and on a floor whose exit is a
         * block puzzle that is not a fiddly reticle, it is a floor you cannot finish.
         *
         * So the box is grown over the prism: the lid corners the outline is drawn
         * from, plus the same four at the block's own floor. The outline stays on the
         * lid, because a ring drawn round the whole prism reads as a box in the air
         * rather than a mark on a thing.
         */
        const hit: [number, number][] = pts.slice();
        if (cg && cg.at(c.x, c.y) === Tile.Block) {
          const base = cg.heightAt(c.x, c.y) * STEP_H;
          for (const [ox, oz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as const) {
            project(new THREE.Vector3(c.x + ox, base, c.y + oz), corner);
            if (corner.behind) continue;
            hit.push([corner.x, corner.y]);
          }
        }

        const xs = hit.map((q) => q[0]), ys = hit.map((q) => q[1]);
        let x0 = Math.min(...xs), x1 = Math.max(...xs);
        let y0 = Math.min(...ys), y1 = Math.max(...ys);
        /**
         * Never smaller than a thumb. A tile six paces off projects to a few pixels
         * of height, and a target you can see but cannot reliably hit is worse than
         * one you cannot see — so the box is grown about its centre to a floor.
         */
        const MIN = 40;
        if (x1 - x0 < MIN) { const c2 = (x0 + x1) / 2; x0 = c2 - MIN / 2; x1 = c2 + MIN / 2; }
        if (y1 - y0 < MIN) { const c2 = (y0 + y1) / 2; y0 = c2 - MIN / 2; y1 = c2 + MIN / 2; }
        this.hits.push({
          rect: [x0, y0, x1 - x0, y1 - y0],
          action: { kind: 'target', entity: c },
        });
        if (!sameTarget(c, this.target)) continue;

        const pulse = 0.6 + Math.sin(t * 3.2) * 0.4;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
        ctx.closePath();
        // A dark rim under a cold line: the two things this palette never produces
        // beside a flame, which is what the burning ground itself had to learn.
        ctx.strokeStyle = 'rgba(8,5,10,0.9)';
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.strokeStyle = '#eaf6ff';
        ctx.lineWidth = 2.2;
        ctx.globalAlpha = 0.7 + pulse * 0.3;
        ctx.stroke();
        ctx.restore();
        continue;
      }
      const e = c;
      if (!e.alive || !e.sprite.group.visible) { e.sprite.setOutline(0xffffff, false); continue; }

      const animatable = isCastableObject(e);
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
        /**
         * The plate is world-projected, so a body standing close puts it low on the
         * frame — straight through the log, the cast bar and the fan's cards, all of
         * which own that band. Clamped to stay above it.
         *
         * Clamped rather than moved to a fixed row: the plate has to stay attached to
         * the thing it names, and a caption that jumped to a bar at the top of the
         * screen would be labelling nothing. Held just clear of the band instead, so
         * it is still over its creature and no longer inside someone else's rows.
         */
        const plateY = Math.min(ty - 30, this.bookTop - BELT_BAND - 96);
        ctx.fillStyle = 'rgba(14,9,16,0.86)';
        rr(ctx, mx - w / 2, plateY, w, 15, 7);
        ctx.fill();
        ctx.strokeStyle = plate;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = plate;
        ctx.fillText(label, mx, plateY + 7);

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
          ctx.fillText(marks, mx + w / 2 + 7, plateY + 7);
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
    // 2x. This row is the only permanent statement of WHERE and HOW RICH, and it was set at
    // 9px next to a 105px portrait and a 105px map — small enough that the two things a
    // player checks between rooms were the two hardest things on the screen to read.
    ctx.font = 'bold 17px ui-monospace, monospace';
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
    /**
     * FITTED between the portrait and the star count, rather than drawn and hoped for.
     *
     * At 2x the floor name ran straight through the ✦ figure. The row has two fixed ends —
     * the portrait on the left and the stars on the right — so the only thing that can give
     * is the NAME, and it gives in that order: shrink to fit, then drop the name and keep
     * the depth. The depth is never sacrificed, because it is the one word here the player
     * navigates by.
     */
    /**
     * DEPTH I - LIBRARY. The short name, and left aligned explicitly.
     *
     * The full theme name ("The Drowned Library") ran through the star count at 2x, and
     * shrinking it to fit made the one permanent statement of WHERE the smallest thing in
     * the row. The last word carries the floor on its own — nobody navigates by the
     * article — so the name is cut to it rather than the type size cut to the name.
     *
     * `textAlign` is set here rather than assumed: this row runs after screens that leave it
     * on 'center', which is how a left-aligned label ended up centred.
     */
    ctx.textAlign = 'left';
    const short = this.floorName
      ? this.floorName.trim().split(/\s+/).slice(-1)[0].toUpperCase()
      : '';
    // x = 12, the true left edge. It was indented past the portrait, which was only ever
    // needed while the portrait started at y = 10 — it starts at MAP_TOP now, so the label's
    // own line is clear and there is no reason for it to sit in the middle of the screen.
    ink(short ? `${depth} - ${short}` : depth, 12, ROW_TOP, 'rgba(240,228,196,0.9)');

    /**
     * The middle of this row's INK, for the cog to line up on.
     *
     * Measured off a digit rather than derived from the font size: with `textBaseline`
     * on 'top' the alignment point is the em box's top, and how far below it the digits
     * actually start is the font's business, not arithmetic we can do here. A guess is
     * what left the cog four pixels high of the star count it sits beside.
     */
    const m = ctx.measureText('0');
    this.topRowMid = ROW_TOP + (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2;

    ctx.textAlign = 'right';
    // Run total plus the bank. Showing only the run made banked stars look lost.
    //
    // Right edge is STARS_RIGHT rather than W - 12 because the cog now owns the
    // corner. Pulling the readout in was the right way round: the star count is the
    // number the player watches and the cog is a thing they press twice a session, so
    // the count keeps the position it always had relative to the minimap under it and
    // only gives up the sliver it was never using.
    /**
     * The BANK plus this run, as one number, and nothing else.
     *
     * There was a second line under it — `+N this run` — and it was answering a question
     * nobody asks: the run's own subtotal is not spendable, not a goal, and not different
     * from the total in any way the player acts on. It was also the smallest text on the
     * screen, which is a lot of pixels to spend on a figure that changes nothing.
     */
    const total = this.bankedStars + this.state.stars;
    ink(`✦ ${total}`, STARS_RIGHT(W), ROW_TOP, GOLD);
    ctx.textAlign = 'left';
  }

  /**
   * THE COG, in the top-right corner above the minimap.
   *
   * Placed there because it is the one piece of chrome that is not about the run: the
   * depth name, the star count, the minimap and the bar all answer "how is this run
   * going", and a control that can end every run you have ever banked does not belong
   * in that row. The corner above the map is the only spot on the screen that is
   * permanently free of the world and of the book.
   *
   * Hidden while a modal is up (`offers`, the bestiary, the tree). A cog drawn over
   * the altar's own card would be a second thing to press on a screen whose whole job
   * is asking one question.
   */
  /**
   * ON THE STAR COUNT'S LINE, and the same weight as it.
   *
   * It was set at 17px against a bold 17px row and centred in its own 28px box at
   * y = 6, which put it both smaller than the figure beside it and four pixels higher —
   * two ways of looking like it belongs to a different row than the one it sits in. The
   * ⚙ glyph is also small for its em, so matching the row's type size is not enough:
   * `COG_SIZE` is the size the glyph is DRAWN at and it is deliberately larger than the
   * row's, which is what makes the two read as the same size.
   *
   * Aligned by MEASUREMENT rather than by a nudge. `topRowMid` is the middle of the
   * star count's own ink, recorded by `drawTopBar` as it draws, and the cog's ink is
   * centred on it — so the two stay level if either type size ever changes again.
   */
  private drawSettingsCog(ctx: CanvasRenderingContext2D, W: number): void {
    if (this.offers || this.bestiaryOpen) return;
    ctx.font = `${COG_SIZE}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText('⚙');
    const cx = W - 12 - m.width / 2;
    // Baseline that puts the glyph's own box centre on the row's.
    const by = this.topRowMid + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    ctx.fillStyle = GOLD;
    ctx.fillText('⚙', cx, by);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    // DRAW SMALL, HIT BIG: 44px square, the iOS minimum, centred on the glyph. The cog
    // is ~22px of ink and a thumb is not, and this one sits in the screen corner where
    // a miss has nothing else to land on.
    this.hits.push({ rect: [cx - 22, this.topRowMid - 22, 44, 44], action: { kind: 'settings' } });
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

    const SPAN = MAP_SPAN;                // tiles either side of the player
    const CELL = MAP_CELL;                // px per tile — big enough to count
    const N = SPAN * 2 + 1;
    const SIZE = MAP_SIZE;
    const ox = W - SIZE - 10, oy = MAP_TOP;

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
        const kind = g.inside(tx, ty) ? g.tiles[g.idx(tx, ty)] : Tile.Wall;
        const wall = kind === Tile.Wall;

        /**
         * A GAP is drawn hollow: the floor tone as an outline, nothing inside.
         *
         * It cannot be a wall cell and it cannot be a floor cell, because either one
         * is a lie about a route — solid says "no way through" of something you can
         * see and shoot across, and floor says "walk here" of something you cannot
         * enter. Hollow is the only reading that needs no legend: the map says there
         * is open space there and no ground under it.
         */
        if (kind === Tile.Gap) {
          ctx.strokeStyle = '#6a5c48';
          ctx.lineWidth = 1;
          ctx.strokeRect(cx + 1.5, cy + 1.5, CELL - 3, CELL - 3);
          continue;
        }

        // Three levels, not two: wall, floor you have only SEEN, and floor you
        // have actually walked. The map is heading-locked, so without the third
        // level you cannot tell which way you came in after a couple of turns.
        // one-pixel inset gives every cell a hard edge, so the grid is countable
        ctx.fillStyle = wall ? '#2b2029'
          : g.visited[g.idx(tx, ty)] ? '#c9b590'
          : '#6a5c48';
        ctx.fillRect(cx + 1, cy + 1, CELL - 2, CELL - 2);

        /**
         * A BLOCK is floor with something on it, and the map says exactly that: the
         * floor tone, with a solid stone square standing in the middle of it.
         *
         * Not the wall tone edge to edge, which is what it would get for free by
         * being impassable — and which would be a lie the moment you shove it, because
         * the map would then be remembering a wall that is not there any more. Drawn
         * inset instead, so the cell still reads as a square of floor and the mark on
         * it is plainly a thing rather than the room.
         */
        if (kind === Tile.Block) {
          ctx.fillStyle = '#4a4038';
          ctx.fillRect(cx + 2, cy + 2, CELL - 4, CELL - 4);
        }

        /**
         * PORTAL MOUTHS, in the pair's own colour, and no other surface.
         *
         * The map answers one question — which way do I go — so the only surface that
         * belongs on it is the one that is a ROUTE. Iron, water, rubble and fog all
         * change what a tile is worth once you are standing near it, and you can see
         * every one of them from the doorway; putting them up here would be four more
         * colours competing with the thing the map is for. A portal is the exception
         * because its whole value is knowing where the other end came out, which is a
         * fact about the floor plan and nothing to do with what is under your feet.
         *
         * Drawn on `explored` rather than on sight, unlike the fire: a mouth does not
         * go out.
         */
        if (!wall) {
          const pair = g.portals.findIndex((p) => p.a === g.idx(tx, ty) || p.b === g.idx(tx, ty));
          if (pair >= 0) {
            ctx.fillStyle = `#${PORTAL_HUES[pair % PORTAL_HUES.length].toString(16).padStart(6, '0')}`;
            ctx.fillRect(cx + 2, cy + 2, CELL - 4, CELL - 4);
          }
        }

        /**
         * Burning ground, over the floor colour and under everything that moves.
         *
         * On the map at all because the world view cannot show you fire that is
         * behind you or round a corner, and a hazard you have to turn around to
         * check is a hazard you walk into. It is the only floor state the map
         * draws, so it does not need a legend — nothing else up there is orange.
         *
         * Gated on SIGHT rather than on explored, the same rule creatures get
         * (`Hud.onMap`): remembering where a fire was is remembering something
         * that has probably gone out.
         */
        if (!wall && floor.ground.burning(g.idx(tx, ty)) && floor.visible.has(g.idx(tx, ty))) {
          ctx.fillStyle = '#ff7a20';
          ctx.fillRect(cx + 1, cy + 1, CELL - 2, CELL - 2);
        }
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
      const anyObject = this.candidates.some((e) => !isTileTarget(e) && e.kind === 'prop' && !e.animated);
      hint = anyObject
        ? 'Tap an object (violet ring) to animate it'
        : 'No object in sight — find furniture to animate';
    }
    if (!ok) {
      // A refusal is a sentence, not a button. It keeps the plain pill.
      ctx.font = '9.5px ui-monospace, monospace';
      const tw = Math.min(W - 32, ctx.measureText(hint).width + 44);
      const bx = (W - tw) / 2, by = this.bookTop - BELT_BAND - 34 + CARD_BADGE_WAS;
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
    const by = this.bookTop - BELT_BAND - 84 + CARD_BADGE_WAS;
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

    /**
     * DELETED: the caption under the CAST key.
     *
     * It read `✕ ON A CARD PUTS IT BACK`, naming a button that no longer exists, and
     * rewording it to `TAP A CARD TO PUT IT BACK` was the wrong fix — the instruction
     * itself is the clutter. Tapping a thing to pick it up and tapping it again to put
     * it down needs no caption, it is the same gesture as every other toggle in the
     * game, and a permanent line of 8px text under the one button the player presses
     * every turn is a tutorial that never stops running.
     */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  /**
   * GONE. The hand readout was `HAND held/cap` in a pill at the top-left.
   *
   * It existed because hand size is what the whole turn economy is priced against and
   * nothing else on screen ever said it — at a hand of one the player's only encounter with
   * the ceiling was a refused swipe. The on-screen slots say both halves now: how many you
   * have and how many are filled, in the place you are already looking to cast. A number
   * that repeats what a picture already shows is a number competing with it, and this one
   * was competing for the corner the portrait now owns.
   */

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
    if (this.offers || this.bookClosed || this.bookBusy || !this.emptySlots.length) return;

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
      // DRAG, not tap. The gesture is a rip, and naming the wrong verb sends a
      // player to tap the book, get nothing, and conclude the game is broken
      // rather than that they used the wrong gesture.
      this.handHeld > 0 ? 'DRAG ANOTHER PAGE OUT' : 'DRAG A PAGE OUT OF THE BOOK',
      W / 2, lowest + 13,
    );
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * SWIPE TO MOVE, until the player does.
   *
   * Placed in the world strip well above the book rather than beside the hand,
   * because it is about the DUNGEON and everything near the book is about the book.
   * Held back until the book has finished arriving, for the same reason the empty
   * slots are: two instructions competing during the opening animation is how a
   * player ends up following neither.
   */
  /**
   * The COMPASS: one arrow, pointing at the next thing worth walking to.
   *
   * A floor gave no direction at all. The altar is the run's only progression lever
   * and finding it before the boss was luck — the minimap shows a 9×9 window of what
   * you have already seen, which answers "is there a wall beside me" and cannot
   * answer "where is the thing I need". A player who missed the altar lost the
   * floor's only rank-up and nothing told them it was there.
   *
   * ## Bearing, and nothing else
   *
   * This is the phase's whole design problem: the altar is usually in a room the
   * player has not entered, so an arrow that points at it is pointing at something
   * unseen — and an arrow that only points at what has been found is useless, because
   * the altar you have already found is the one you do not need pointing at.
   *
   * The resolution is that DIRECTION is not LAYOUT. One angle reveals a single number
   * about the floor; it says "that way" and never how far, what is between, or what
   * shape the room is. Distance was considered and rejected: bearing plus distance
   * over two steps triangulates the exact tile, which is a revealed map wearing one
   * arrow.
   *
   * Rotated into the player's frame, like the minimap, so up is always forward.
   */
  /**
   * DELETED: `drawBestiaryPill`.
   *
   * A gold `\u2726 N` pill under the minimap, and the only handle on the bestiary. It read
   * as a control with a number on it in the corner where every OTHER number is about
   * the run \u2014 the star count directly above it is also a gold \u2726 and a figure \u2014 so the
   * thing it actually said was "you have five of something important", four rows under
   * the readout that says how many stars you have. Two gold star-and-a-number badges
   * stacked in one corner, meaning unrelated things, is one badge too many.
   *
   * The bestiary screen itself is untouched (`drawBestiary`) and has no entry point in
   * the HUD now. It wants a home somewhere that is about the collection rather than
   * about the run \u2014 the star tree's screen is the obvious one \u2014 and until it gets one
   * it is dark rather than deleted.
   */

  /**
   * THE BESTIARY: every fusion this player has ever found.
   *
   * Free, and the only screen in the game with no price on it anywhere. It records
   * the FUSION half only — the animation half fills as props are animated, and
   * animating needs an ingredient off a belt that is currently switched off behind
   * `BELT_ENABLED`. Rather than ship a permanently empty column, the sections are
   * independent and only the ones that can fill are drawn; the other appears by
   * itself the day the flag flips back.
   */
  private drawBestiary(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    ctx.fillStyle = 'rgba(8,5,12,0.92)';
    // The scrim covers the PHYSICAL screen, not the safe box the rest of this panel
    // lays out in: a wash inset with the chrome would leave a strip of live dungeon
    // above and below the modal. Hence the negative origin and `sh`.
    ctx.fillRect(0, -this.engine.insetTop, W, this.engine.sh);

    ctx.textAlign = 'center';
    ctx.font = 'bold 13px ui-monospace, monospace';
    ctx.fillStyle = GOLD;
    ctx.fillText('WHAT YOU HAVE LEARNED', W / 2, H * 0.13);
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(232,217,176,0.5)';
    // Said out loud, because it is a promise and not a description.
    ctx.fillText('kept across every run \u00b7 never spent', W / 2, H * 0.13 + 16);

    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(232,217,176,0.75)';
    ctx.textAlign = 'left';
    ctx.fillText(`FUSIONS  ${this.bestiary.length}`, 22, H * 0.13 + 44);
    ctx.strokeStyle = 'rgba(255,207,92,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(22, H * 0.13 + 52.5); ctx.lineTo(W - 22, H * 0.13 + 52.5);
    ctx.stroke();

    ctx.font = '11px ui-monospace, monospace';
    let y = H * 0.13 + 74;
    for (const name of this.bestiary) {
      if (y > H - 90) break;
      ctx.fillStyle = '#fff4dc';
      ctx.fillText(name, 30, y);
      y += 18;
    }

    const label = 'CLOSE';
    ctx.font = 'bold 11px ui-monospace, monospace';
    const tw = ctx.measureText(label).width + 40;
    const bx = (W - tw) / 2, by = H - 76;
    rr(ctx, bx, by, tw, 30, 15);
    ctx.fillStyle = 'rgba(26,18,32,0.96)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,207,92,0.7)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff4dc';
    ctx.fillText(label, W / 2, by + 15);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    this.hits.push({ rect: [bx, by, tw, 30], action: { kind: 'bestiary' } });
  }

  /**
   * The FOV a pointer at (x, y) is asking for, or null if it is not on the slider.
   *
   * The vertical band is far taller than the 6px bar — a slider you have to hit within
   * three pixels is a slider you fight — and the horizontal read is CLAMPED rather than
   * rejected, so a drag that wanders off the end of the track pins to the end instead
   * of letting go of the knob.
   */
  fovAt(x: number, y: number): number | null {
    const t = this.fovTrack;
    if (!t || !this.settingsOpen) return null;
    if (y < t.y - 14 || y > t.y + 20) return null;
    if (x < t.x - 16 || x > t.x + t.w + 16) return null;
    const [lo, hi] = this.fovRange;
    const f = Math.max(0, Math.min(1, (x - t.x) / t.w));
    return Math.round(lo + (hi - lo) * f);
  }

  /**
   * SETTINGS. One option today, and built as a list so the second one costs nothing.
   *
   * The reset row is a TWO-TAP control and the two states say different sentences:
   * unarmed it names what it does, armed it names what you lose. That is deliberately
   * not a yes/no dialog — a dialog is dismissed by reflex, where a row that has visibly
   * changed under your thumb has to be read. The count of what is about to go is in the
   * armed label, because "reset progress" is abstract and "31 stars" is not.
   */
  private drawSettings(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    ctx.fillStyle = 'rgba(8,5,12,0.92)';
    // The scrim covers the PHYSICAL screen, not the safe box the rest of this panel
    // lays out in: a wash inset with the chrome would leave a strip of live dungeon
    // above and below the modal. Hence the negative origin and `sh`.
    ctx.fillRect(0, -this.engine.insetTop, W, this.engine.sh);

    ctx.textAlign = 'center';
    ctx.font = 'bold 13px ui-monospace, monospace';
    ctx.fillStyle = GOLD;
    ctx.fillText('SETTINGS', W / 2, H * 0.13);

    // ---- field of view ------------------------------------------------------
    const [lo, hi] = this.fovRange;
    const tw2 = Math.min(W - 80, 230);
    const tx = (W - tw2) / 2, ty = H * 0.13 + 40;
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(232,217,176,0.75)';
    ctx.fillText(`FIELD OF VIEW   ${Math.round(this.fov)}°`, W / 2, ty - 14);

    // The track. Drawn as a thin filled bar rather than a groove because the fill IS
    // the readout — the number above says the value and the bar says where in the range
    // it sits, which is the question a slider is actually asked.
    const frac = (this.fov - lo) / (hi - lo);
    rr(ctx, tx, ty, tw2, 6, 3);
    ctx.fillStyle = 'rgba(20,14,26,0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,207,92,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (frac > 0) {
      rr(ctx, tx, ty, Math.max(4, tw2 * frac), 6, 3);
      ctx.fillStyle = 'rgba(255,207,92,0.55)';
      ctx.fill();
    }
    const kx = tx + tw2 * frac;
    ctx.beginPath();
    ctx.arc(kx, ty + 3, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff4dc';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,80,20,0.9)';
    ctx.stroke();

    ctx.font = '8px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(232,217,176,0.4)';
    ctx.textAlign = 'left';
    ctx.fillText('narrow', tx, ty + 14);
    ctx.textAlign = 'right';
    ctx.fillText('wide', tx + tw2, ty + 14);
    ctx.textAlign = 'center';

    /**
     * Track geometry kept for the drag rather than pushed as a hit region.
     *
     * A slider is the one control on this screen that needs the POINTER POSITION and
     * not just "was I pressed" — `UiAction` carries an intent, and an intent cannot say
     * "sixty-one percent along". So `main.ts` resolves it through `fovAt` on both press
     * and move, which is also what makes it draggable rather than tap-only.
     */
    this.fovTrack = { x: tx, y: ty, w: tw2 };

    // ---- invert gestures ----------------------------------------------------
    /**
     * A real checkbox, because this is a boolean and a boolean should look like one. The
     * label says what the setting DOES rather than naming the flag — "invertGestures" is
     * true of the code and meaningless to a player mid-swipe.
     */
    const cbY = ty + 34;
    const box = 14;
    const cbLabel = 'INVERT SWIPE & DRAG';
    ctx.font = 'bold 11px ui-monospace, monospace';
    const cbTextW = ctx.measureText(cbLabel).width;
    const cbW = box + 8 + cbTextW;
    const cbX = Math.round((W - cbW) / 2);
    rr(ctx, cbX, cbY, box, box, 3);
    ctx.fillStyle = this.invertGestures ? 'rgba(255,207,92,0.85)' : 'rgba(20,14,26,0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,207,92,0.6)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (this.invertGestures) {
      // A tick, drawn rather than typed: a ✓ glyph at 14px lands differently in every font
      // the HUD might fall back to, and this box is 14px.
      ctx.strokeStyle = 'rgba(26,16,6,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cbX + 3.5, cbY + 7.5);
      ctx.lineTo(cbX + 6, cbY + 10.5);
      ctx.lineTo(cbX + 10.5, cbY + 4);
      ctx.stroke();
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(232,217,176,0.9)';
    ctx.fillText(cbLabel, cbX + box + 8, cbY + 3);
    ctx.textAlign = 'center';
    this.hits.push({
      rect: [cbX - 10, cbY - 8, cbW + 20, box + 16],
      action: { kind: 'invertGestures' },
    });

    // ---- reset -------------------------------------------------------------
    const armed = this.resetArmed;
    const label = armed ? 'TAP AGAIN TO WIPE' : 'RESET PROGRESS';
    const sub = armed
      ? `${this.bankedStars} stars, every node, and the bestiary`
      : 'every star, node and fusion you have banked';

    /**
     * Below the slider, not beside it. These two y values used to be +20 and +48, from
     * when reset was the only thing on the screen, and the slider landed straight on
     * top of the subtitle. Stacked off the track's own bottom edge so adding a third
     * setting moves one number.
     */
    const resetTop = cbY + 46;
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = armed ? 'rgba(255,138,138,0.85)' : 'rgba(232,217,176,0.5)';
    ctx.fillText(sub, W / 2, resetTop);

    ctx.font = 'bold 11px ui-monospace, monospace';
    const rw = Math.max(ctx.measureText(label).width + 44, 190);
    const rx = (W - rw) / 2, ry = resetTop + 20;
    rr(ctx, rx, ry, rw, 32, 8);
    ctx.fillStyle = armed ? 'rgba(58,16,20,0.96)' : 'rgba(26,18,32,0.96)';
    ctx.fill();
    ctx.strokeStyle = armed ? 'rgba(255,110,110,0.9)' : 'rgba(255,207,92,0.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = armed ? '#ffdede' : '#fff4dc';
    ctx.fillText(label, W / 2, ry + 16);
    ctx.textBaseline = 'top';
    this.hits.push({ rect: [rx, ry, rw, 32], action: { kind: 'resetProgress' } });

    // CLOSE sits where the bestiary's does, because they are the same kind of screen
    // and a player who has closed one has learnt where the other closes.
    const close = 'CLOSE';
    ctx.font = 'bold 11px ui-monospace, monospace';
    const tw = ctx.measureText(close).width + 40;
    const bx = (W - tw) / 2, by = H - 76;
    rr(ctx, bx, by, tw, 30, 15);
    ctx.fillStyle = 'rgba(26,18,32,0.96)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,207,92,0.7)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff4dc';
    ctx.fillText(close, W / 2, by + 15);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    this.hits.push({ rect: [bx, by, tw, 30], action: { kind: 'settings' } });
  }

  /**
   * THE ROSTER: six faces, two rows of three, and nothing else on the screen.
   *
   * No card, no page, no sigil well. The portrait IS the button, drawn whole at its own
   * aspect so nothing is cropped, and the only chrome is a one-pixel frame that goes gold
   * when the wizard is yours and stays dead grey when they are not.
   *
   * Locked faces are DRAWN, at a fraction of their brightness, with the name of whoever
   * frees them underneath. That is the difference between a roster and a menu: a menu
   * shows you your options, a roster shows you the cast and which of them you have met.
   */
  private drawRoster(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const list = this.roster;
    if (!list) return;
    ctx.fillStyle = 'rgba(6,4,9,0.96)';
    // The scrim covers the PHYSICAL screen, not the safe box the rest of this panel
    // lays out in: a wash inset with the chrome would leave a strip of live dungeon
    // above and below the modal. Hence the negative origin and `sh`.
    ctx.fillRect(0, -this.engine.insetTop, W, this.engine.sh);

    if (this.rosterPeek) { this.drawWizardProfile(ctx, W, H, this.rosterPeek); return; }

    ctx.textAlign = 'center';
    // NO TITLE. Six faces in a grid do not need to be told they are a choice, and the
    // heading was costing the portraits 44px of the only screen they have.

    /**
     * TWO COLUMNS, THREE ROWS, filling the screen.
     *
     * 3x2 was tried and left the bottom half of a portrait phone empty, which on the one
     * screen that has to sell six strangers is the worst place in the game to waste. The
     * grid is sized off the AVAILABLE HEIGHT and the portraits take whatever that gives
     * them, rather than being sized off the column width and leaving the remainder blank.
     */
    const COLS = 2, ROWS = 3;
    const gap = 8;
    const y0 = 12;
    const bottom = 12;
    /**
     * The caption sits ON the portrait, not under it.
     *
     * Which is what lets the faces be as big as the screen allows: reserving a strip under
     * each one for two lines of text spent a sixth of the grid on chrome. Drawn over the
     * bottom of the picture with an OUTLINE rather than a gradient scrim — the same trick
     * the depth label uses over the world, and a gradient here would be a soft edge laid
     * across pixel art that has none anywhere else.
     */
    const rowH = Math.floor((H - y0 - bottom) / ROWS);
    let ch = rowH - gap;
    let cw = Math.round(ch * PORTRAIT_ASPECT);
    // Clamped by width too, so a wide viewport does not produce columns that overlap.
    const maxW = Math.floor((W - 24 - gap * (COLS - 1)) / COLS);
    if (cw > maxW) { cw = maxW; ch = Math.round(cw / PORTRAIT_ASPECT); }
    const x0 = Math.round((W - (cw * COLS + gap * (COLS - 1))) / 2);
    const pitch = rowH;

    list.forEach((row, i) => {
      const cx = x0 + (i % COLS) * (cw + gap);
      const cy = y0 + Math.floor(i / COLS) * pitch;

      ctx.save();
      ctx.beginPath();
      rr(ctx, cx, cy, cw, ch, 3);
      ctx.fillStyle = 'rgba(10,7,13,0.95)';
      ctx.fill();
      ctx.clip();
      /**
       * Locked faces are DESATURATED, not dimmed away.
       *
       * They were at 26% alpha and that hid the character, which defeats the point of
       * showing the whole cast — you are meant to look at Vess and want him. Greyscale
       * says "not yours yet" while leaving every feature legible, and the slight alpha is
       * only there to push them behind the one face that IS yours.
       */
      if (row.locked) ctx.globalAlpha = 0.8;
      drawPortrait(ctx, row.wizard.portrait, cx, cy, cw, ch);
      if (row.locked) desaturate(ctx, cx, cy, cw, ch);
      ctx.globalAlpha = 1;
      ctx.restore();

      rr(ctx, cx, cy, cw, ch, 3);
      ctx.strokeStyle = row.locked ? 'rgba(140,132,150,0.5)' : 'rgba(255,207,92,0.85)';
      ctx.lineWidth = row.locked ? 1 : 2;
      ctx.stroke();

      const ink = (text: string, ty: number, fill: string, font: string) => {
        ctx.font = font;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(6,4,8,0.85)';
        ctx.strokeText(text, cx + cw / 2, ty);
        ctx.fillStyle = fill;
        ctx.fillText(text, cx + cw / 2, ty);
      };
      ink(row.wizard.name, cy + ch - 34,
        row.locked ? 'rgba(198,192,208,0.9)' : '#fff4dc', 'bold 15px ui-monospace, monospace');
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillStyle = row.locked ? 'rgba(170,164,180,0.8)' : 'rgba(255,207,92,0.85)';
      // Locked: say who frees them. That one line is the whole progression system on
      // screen, and it costs nothing because `Wizard.frees` already knows.
      const sub = row.locked
        ? (row.freedBy ? `FREED BY ${row.freedBy}` : 'LOCKED') : row.wizard.title;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(6,4,8,0.85)';
      ctx.strokeText(sub, cx + cw / 2, cy + ch - 17);
      ctx.fillText(sub, cx + cw / 2, cy + ch - 17);

      // Locked cards still take the tap. A face you cannot use that also does not respond
      // reads as a broken button rather than as a locked one.
      this.hits.push({
        rect: [cx, cy, cw, ch],
        action: { kind: 'wizardPeek', id: row.wizard.id },
      });
    });
    ctx.textAlign = 'left';
  }

  /**
   * One wizard, full height, with their reason and their own words — and a CHOOSE button
   * that is the ONLY thing in this flow that starts a run.
   *
   * Split from the grid because picking a character off a thumbnail is picking a colour.
   * The profile is where the three questions actually get answered, so it is the screen
   * that has to exist before the run begins, and the grid is just the way in.
   */
  private drawWizardProfile(
    ctx: CanvasRenderingContext2D, W: number, H: number, w: Wizard,
  ): void {
    const locked = !!this.roster?.find((r) => r.wizard.id === w.id)?.locked;
    const freed = this.roster?.find((r) => r.wizard.id === w.id)?.freedBy ?? null;

    /**
     * TWO THINGS SIDE BY SIDE AT THE TOP: who you are, and what you cast.
     *
     * In that order and in that priority. The previous version stacked a portrait, then a
     * name, then a line of prose, then more prose, then more — which buried the one fact
     * the choice actually turns on. Both columns get a caption directly under the thing it
     * captions: the name under the face, the spell's rules under the page. Nothing else
     * competes for the top of the screen.
     */
    const gap = 10;
    // Big. The face and the page are the screen's whole job, so they take the room the
    // prose gave back when it went down to one sentence.
    /**
     * THE ROW FILLS WHAT IS LEFT, and the whole block is CENTRED.
     *
     * Laying this out from a fixed top at a fixed size left half the screen empty three
     * times running, and the reason is structural rather than a bad number: with a fixed
     * top and fixed heights the leftover has to go somewhere, and it always went to the
     * bottom. So the copy and the buttons declare what they need, the portrait and the page
     * take everything that remains, and if the WIDTH clamp then caps the row the surplus is
     * split top and bottom instead of dumped under the button.
     */
    const RESERVE = 190;
    const aspectSum = PORTRAIT_ASPECT + CARD_W / CARD_H;
    const maxRow = W - 24 - gap;
    let topH = Math.max(90, H - 24 - RESERVE);
    if (topH * aspectSum > maxRow) topH = Math.floor(maxRow / aspectSum);
    const pw = Math.round(topH * PORTRAIT_ASPECT);
    const cardW = Math.round(topH * (CARD_W / CARD_H));
    const rowW = pw + gap + cardW;
    const px = Math.round((W - rowW) / 2);
    const py = Math.max(12, Math.round((H - (topH + RESERVE)) / 2));
    const cardX = px + pw + gap;

    ctx.save();
    ctx.beginPath();
    rr(ctx, px, py, pw, topH, 4);
    ctx.fillStyle = 'rgba(10,7,13,0.95)';
    ctx.fill();
    ctx.clip();
    if (locked) ctx.globalAlpha = 0.85;
    drawPortrait(ctx, w.portrait, px, py, pw, topH);
    if (locked) desaturate(ctx, px, py, pw, topH);
    ctx.globalAlpha = 1;
    ctx.restore();
    rr(ctx, px, py, pw, topH, 4);
    ctx.strokeStyle = locked ? 'rgba(120,112,130,0.4)' : 'rgba(255,207,92,0.8)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // The real page, through the same generator the altar uses — a card drawn any other
    // way here would be a second kind of spell card in the game.
    if (this.startCard) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.offerCanvas(this.startCard), cardX, py, cardW, topH);
      ctx.imageSmoothingEnabled = true;
    }

    ctx.textAlign = 'center';
    const pcx = px + pw / 2, kcx = cardX + cardW / 2;
    /**
     * ONE BASELINE GRID for both columns.
     *
     * They were laid out independently — the name at cy-4 and the spell at cy-2, the title at
     * cy+15 and the effect at cy+14 — so two captions meant to read as a matched pair sat two
     * pixels out of step, and the gaps below them came off a third set of numbers again. Both
     * columns hang off NAME_Y and SUB_Y now, and everything under them measures from those.
     */
    /**
     * BASELINE SET EXPLICITLY, and a real gap under the art.
     *
     * These captions were drawing up into the frames above them, and the gap was only half the
     * cause — `textBaseline` is left on 'alphabetic' by code that runs earlier, so a caption
     * placed at NAME_Y grew UPWARD from that line instead of downward off it. Every other block
     * in this file that sits under something sets it; this one assumed.
     */
    ctx.textBaseline = 'top';
    const NAME_Y = py + topH + 20;
    const SUB_Y = NAME_Y + 22;

    ctx.font = 'bold 17px ui-monospace, monospace';
    ctx.fillStyle = '#fff4dc';
    ctx.fillText(w.name, pcx, NAME_Y);
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,207,92,0.85)';
    ctx.fillText(w.title.toUpperCase(), pcx, SUB_Y);

    if (this.startSpell) {
      ctx.font = 'bold 15px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(180,220,255,0.95)';
      ctx.fillText(this.startSpell.name.toUpperCase(), kcx, NAME_Y);
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(196,210,228,0.85)';
      this.wrapped(ctx, this.startSpell.effect, kcx, SUB_Y, cardW - 4, 13);
    }

    /**
     * ONE SENTENCE. Why they are here and what they mean to do.
     *
     * The backstory and the why-play paragraphs are still on the wizard and are still worth
     * having, but they do not belong on the screen you are trying to get off. A profile
     * that has to be read is a profile that gets skipped.
     */
    let y = SUB_Y + 40;
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(236,226,204,0.94)';
    y = this.wrapped(ctx, w.reason, W / 2, y, W - 44, 18, H - 88);
    y += 10;
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(205,195,220,0.78)';
    y = this.wrapped(ctx, `“${w.line}”`, W / 2, y, W - 44, 16, H - 88);

    // CHOOSE, or the reason you cannot.
    const label = locked ? (freed ? `FREED BY ${freed}` : 'LOCKED') : 'ENTER THE DUNGEON';
    ctx.font = 'bold 11px ui-monospace, monospace';
    const bw = Math.max(ctx.measureText(label).width + 44, 170);
    // Under the copy, not pinned to the bottom of the screen. Pinned left a dead band
    // most of the screen tall once the prose came down to a sentence.
    const bx = (W - bw) / 2, by = Math.min(H - 56, y + 24);
    rr(ctx, bx, by, bw, 32, 8);
    ctx.fillStyle = locked ? 'rgba(22,20,26,0.95)' : 'rgba(38,26,12,0.96)';
    ctx.fill();
    ctx.strokeStyle = locked ? 'rgba(120,112,130,0.4)' : 'rgba(255,207,92,0.9)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = locked ? 'rgba(150,144,160,0.65)' : '#fff4dc';
    ctx.fillText(label, W / 2, by + 16);
    ctx.textBaseline = 'top';
    if (!locked) {
      this.hits.push({ rect: [bx, by, bw, 32], action: { kind: 'wizardPick', id: w.id } });
    }

    const back = 'BACK';
    ctx.font = '10px ui-monospace, monospace';
    const kw = ctx.measureText(back).width + 32;
    const kx = (W - kw) / 2, ky = by + 38;
    ctx.fillStyle = 'rgba(200,190,210,0.7)';
    ctx.fillText(back, W / 2, ky + 6);
    this.hits.push({ rect: [kx, ky, kw, 20], action: { kind: 'wizardBack' } });
    ctx.textAlign = 'left';
  }

  /**
   * Centre-wrapped paragraph, bounded below. Returns the y under the last line drawn.
   *
   * `maxY` is not optional decoration — it is what stops a long paragraph drawing through
   * whatever sits under it. Callers pass the top of the next fixed element.
   */
  private wrapped(
    ctx: CanvasRenderingContext2D, text: string, cx: number, y: number,
    maxW: number, lh: number, maxY = Infinity,
  ): number {
    const words = text.split(' ');
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxW && line) {
        if (y + lh > maxY) return y;
        ctx.fillText(line, cx, y);
        y += lh;
        line = word;
      } else line = next;
    }
    if (line && y + lh <= maxY) { ctx.fillText(line, cx, y); y += lh; }
    return y;
  }

  /**
   * THE RESCUE: two portraits facing each other, and one line from the person you freed.
   *
   * Face to face rather than a banner, because this is the only moment in the game two wizards
   * are in the same place — everywhere else the roster is a menu of people you are not. Yours
   * on the left looking right, theirs on the right, their words underneath.
   */
  private drawRescue(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const r = this.rescued;
    if (!r) return;
    ctx.fillStyle = 'rgba(6,4,9,0.94)';
    // The scrim covers the PHYSICAL screen, not the safe box the rest of this panel
    // lays out in: a wash inset with the chrome would leave a strip of live dungeon
    // above and below the modal. Hence the negative origin and `sh`.
    ctx.fillRect(0, -this.engine.insetTop, W, this.engine.sh);

    const ph = Math.round(H * 0.24);
    const pw = Math.round(ph * PORTRAIT_ASPECT);
    const gap = 14;
    const total = pw * 2 + gap;
    const x0 = Math.round((W - total) / 2);
    const py = Math.round(H * 0.16);

    const face = (id: string, x: number, gold: boolean) => {
      ctx.save();
      ctx.beginPath();
      rr(ctx, x, py, pw, ph, 4);
      ctx.fillStyle = 'rgba(10,7,13,0.95)';
      ctx.fill();
      ctx.clip();
      drawPortrait(ctx, id, x, py, pw, ph);
      ctx.restore();
      rr(ctx, x, py, pw, ph, 4);
      ctx.strokeStyle = gold ? 'rgba(255,207,92,0.85)' : 'rgba(160,150,175,0.55)';
      ctx.lineWidth = gold ? 2 : 1.2;
      ctx.stroke();
    };
    if (r.by) face(r.by.portrait, x0, false);
    face(r.wizard.portrait, x0 + pw + gap, true);

    ctx.textAlign = 'center';
    let y = py + ph + 22;
    ctx.font = 'bold 20px ui-monospace, monospace';
    ctx.fillStyle = '#fff4dc';
    ctx.fillText(`${r.wizard.name} IS FREE`, W / 2, y);
    y += 30;
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(232,217,176,0.92)';
    y = this.wrapped(ctx, `“${r.wizard.rescueLine ?? ''}”`, W / 2, y, W - 44, 18, H - 96);
    y += 16;
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,207,92,0.8)';
    ctx.fillText(`${r.wizard.name.toUpperCase()} JOINS THE ROSTER`, W / 2, y);

    const label = 'GO ON';
    ctx.font = 'bold 12px ui-monospace, monospace';
    const bw = Math.max(ctx.measureText(label).width + 44, 150);
    const bx = (W - bw) / 2, by = Math.min(H - 56, y + 28);
    rr(ctx, bx, by, bw, 32, 8);
    ctx.fillStyle = 'rgba(38,26,12,0.96)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,207,92,0.9)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff4dc';
    ctx.fillText(label, W / 2, by + 16);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    this.hits.push({ rect: [bx, by, bw, 32], action: { kind: 'rescueDone' } });
  }

  private drawCompass(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const goal = this.compassGoal;
    if (!goal) return;
    /**
     * HIDDEN whenever anything else owns this band.
     *
     * Bottom centre above the grimoire is also where the CAST bar and the big CAST button
     * live, so a held card put the arrow straight through the most important button on the
     * screen. `bookClosed` alone did not cover it — the book is CLOSED while you are holding
     * a torn page, which is exactly when CAST is up.
     *
     * So: no compass while the book is open, and none while the hand has anything in it. The
     * arrow is for walking, and neither of those is walking.
     */
    if (!this.bookClosed || this.handHeld > 0 || this.runEnd || this.offers) return;
    const m = this.map?.();
    if (!m) return;

    const dx = goal.x - m.x, dy = goal.y - m.y;
    if (!dx && !dy) return;

    // World -> player-relative, the same rotation the minimap applies, so the two
    // readouts can never disagree about which way is forward.
    const [fx, fy] = DIR_VEC[m.dir];
    const [rx, ry] = DIR_VEC[((m.dir + 1) % 4) as Dir];
    const ahead = dx * fx + dy * fy;
    const side = dx * rx + dy * ry;
    const angle = Math.atan2(side, ahead);

    /**
     * BOTTOM CENTRE, just above the grimoire.
     *
     * It sat at (W - 62, 196), which is the right-hand edge halfway down — directly under
     * the minimap, so the two rotating readouts stacked into one column and the corner that
     * is already the busiest on screen got a third thing in it. Centred over the book, the
     * arrow is on the axis the player is actually walking along.
     */
    const cx = W / 2, cy = Math.min(H - 26, this.bookTop - 26), r = 15;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.arc(0, 0, r + 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14,9,18,0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(185,140,255,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.62, r * 0.7);
    ctx.lineTo(0, r * 0.34);
    ctx.lineTo(-r * 0.62, r * 0.7);
    ctx.closePath();
    ctx.fillStyle = goal.colour;
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,5,10,0.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // What it is pointing AT, because an unlabelled arrow is a direction without a
    // reason and the player has to decide whether following it is worth the turns.
    ctx.textAlign = 'center';
    ctx.font = 'bold 8px ui-monospace, monospace';
    ctx.fillStyle = goal.colour;
    ctx.fillText(goal.label, cx, cy + r + 10);
    ctx.textAlign = 'left';
  }

  /**
   * A tap that resolved to nothing at all.
   *
   * Called from the tap path in `main.ts`. Three inside `TAP_WINDOW` is a player
   * pressing the screen and getting no answer, which is the one moment they are
   * definitely asking how this works — so the instruction comes back rather than
   * waiting to be discovered. It costs nothing to anybody playing correctly, because
   * they never trigger it.
   */
  idleTap(): void {
    if (this.offers || this.roster || this.settingsOpen || this.bestiaryOpen) return;
    this.tapRun = this.tapRunT > 0 ? this.tapRun + 1 : 1;
    this.tapRunT = TAP_WINDOW;
    if (this.tapRun >= 3) { this.nudgeT = NUDGE_SHOW; this.tapRun = 0; }
  }

  private drawMoveHint(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    /**
     * SHOWN AT THE START OF THE FIRST FLOOR, or whenever the player is visibly stuck.
     *
     * The opening prompt is depth 1 only. It is the first sentence in the game and it
     * exists because nothing else says the world answers a swipe — by the second floor
     * that has been learnt, and an instruction that keeps reappearing reads as the game
     * nagging rather than helping.
     *
     * `nudgeT` is the other way in: three taps that hit nothing, on any floor. See
     * `idleTap`.
     */
    const opening = !this.hasMoved && this.state.depth <= 1;
    if ((!opening && this.nudgeT <= 0) || this.offers) return;

    /**
     * Positioned off the CANVAS, not off the book.
     *
     * `bookTop` is 0 until the book has been measured, and the book is not measured
     * until it has finished arriving — so anchoring to it put this hint at y = -74
     * for the whole of the opening, which is exactly the stretch it exists for. The
     * world strip is a stable fraction of the frame whatever the book is doing.
     */
    const y = H * 0.60;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // The same slow pulse the empty slots breathe at, so the two instructions on
    // screen read as one voice rather than as two things blinking at each other.
    const pulse = 0.5 + Math.sin(this.engine.time * 2.4) * 0.5;
    ctx.globalAlpha = 0.45 + pulse * 0.4;
    /**
     * ONE instruction, not two. The aiming half was a second thing to learn at the
     * moment the player has learnt nothing, and a hint that lists options is a hint
     * nobody finishes reading — the reticle teaches aiming on its own the first time
     * something is in front of you.
     */
    /**
     * 2x, and OUTLINED. This is the first instruction in the game and it was 13px of
     * low-contrast parchment laid straight over a lit dungeon floor — the one line a player
     * must read was competing with the busiest texture on the screen. The outline is the
     * same trick the depth label and the roster captions use.
     */
    /**
     * The instruction follows the BOOK, because the book decides which gesture is even
     * available. Open, a swipe is a page coming out and the answer to "nothing is
     * happening" is that you cast with it; closed, a swipe is a step. Telling somebody
     * to swipe to move while the grimoire fills the bottom of the screen and eats the
     * gesture is worse than saying nothing.
     */
    const line = this.bookClosed ? 'SWIPE TO MOVE' : 'SWIPE TO CAST';
    ctx.font = 'bold 24px ui-monospace, monospace';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(6,4,8,0.85)';
    ctx.strokeText(line, W / 2, y);
    ctx.fillStyle = '#fff4dc';
    ctx.fillText(line, W / 2, y);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * The hand's cards, as hit regions.
   *
   * Nothing is DRAWN here any more — the cards themselves are 3D, and the one thing
   * this used to paint was the ✕ badge that is now gone. What is left is the tap
   * target for each card, which is what removes it.
   */
  private drawFanCards(): void {
    if (this.offers) return;            // the modal owns every tap; see drawBelt
    for (const c of this.handCards) {
      /**
       * Pushed in FAN ORDER, which is what resolves an overlap: `slot()` steps each
       * card toward the camera by its index, so the highest index is the one drawn on
       * top — and `hit` scans backwards, so the highest index is also the first tested.
       * The card the player can see is the card that answers.
       */
      this.hits.push({ rect: [c.x, c.y, c.w, c.h], action: { kind: 'card', index: c.index } });

      /**
       * DELETED: the red ✕ badge.
       *
       * A disc perched just outside each card's top-right corner, whose action was
       * `{ kind: 'card' }` — the very same action the card's own rect already carries.
       * It was a second button for a thing the card does when you tap it, drawn in the
       * one colour on the screen that means destructive, hanging off the paper rather
       * than on it. Removing a card is still exactly what tapping it does.
       *
       * It also cost the band its top: the badge sat ABOVE the card, so the CAST key
       * and its heading had to clear the badge rather than the cards, and the space
       * went back to them when it went — see `CARD_BADGE_WAS`.
       */
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
  /**
   * The log, stacked UP from whatever the band below it is not using.
   *
   * Three separate reviews flagged this band overdrawing itself, and the log is the
   * part that has to yield: it is the only element in there that is a record rather
   * than a control. The cast bar and the large CAST are things the player is about
   * to press, so they own their rows and the log starts above whichever of them is
   * on screen.
   *
   * The line CAP moves with it. Stacking a fixed six lines up from a raised floor
   * just moves the collision to the top of the band, where the shout is — so when
   * the cast UI is up, the log keeps only what fits.
   */
  private drawLog(ctx: CanvasRenderingContext2D, W: number): void {
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';

    // The large CAST is the tallest thing that shares this band; the cast bar is
    // shorter. Measured off the same constants they lay themselves out with, so the
    // three cannot disagree about where the boundary is.
    const casting = !!this.currentCast();
    const reserved = casting ? (this.handFull() ? 104 : 42) : 0;
    const bottom = this.bookTop - BELT_BAND - 74 - reserved;
    const room = Math.max(1, Math.floor((bottom - this.shoutFloor()) / 12));
    const lines = this.log.slice(Math.max(0, this.log.length - room));
    const n = lines.length;
    lines.forEach((l, i) => {
      const age = Math.max(0, 1 - Math.max(0, l.t - 3.4) / 1.6);
      ctx.globalAlpha = 0.85 * age;
      ctx.fillStyle = hexCss(l.colour);
      ctx.fillText(l.text, W / 2, bottom - (n - 1 - i) * 12);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  /**
   * The lowest line the log may occupy without running into the shout.
   *
   * The shout is a full-width announcement — a discovery, a fusion name — and it is
   * the one thing in this band the player is meant to read at a glance rather than
   * scan. So it wins, and the log stops under it.
   */
  private shoutFloor(): number {
    return this.shout || this.discover ? this.bookTop * 0.42 : 0;
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
    // Full-screen, for the same reason a modal's scrim is: an edge wash inset with the
    // chrome would draw its own visible edge across the screen.
    ctx.drawImage(buf, 0, 0, bw, bh, 0, -this.engine.insetTop, W, this.engine.sh);
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
    // Full-screen, for the same reason a modal's scrim is: an edge wash inset with the
    // chrome would draw its own visible edge across the screen.
    ctx.drawImage(buf, 0, 0, bw, bh, 0, -this.engine.insetTop, W, this.engine.sh);
    ctx.restore();
  }

  /**
   * THE PORTRAIT IS THE HEALTH BAR. Baldur's Gate, top-left, mirroring the minimap.
   *
   * There is no separate bar any more, and that is the cleanup: a bar, a name, an hp
   * figure and a portrait were four things in one corner all saying "you", stacked into a
   * strip 34px tall that the depth label kept colliding with. One object says all of it.
   *
   * Remaining health FILLS FROM THE BOTTOM. The living part of the portrait is drawn at
   * full colour and the lost part is drained — desaturated, darkened, and washed red — so
   * the character visibly bleeds out of the frame as the run goes badly. It reads at a
   * glance without a number, which is the whole reason BG did it this way.
   *
   * Sized and placed off the MINIMAP's own numbers rather than its own, so the two corners
   * are the same height and stay that way if the map ever changes.
   */
  private drawVitals(ctx: CanvasRenderingContext2D, W: number): void {
    const w = this.wizard;
    const n = this.threats.size;
    const frac = Math.max(0, Math.min(1, this.state.hp / this.state.maxHp));

    // No wizard yet (the roster is still up): keep the old bar so the run start is never
    // a screen with no vitals at all.
    if (!w) {
      const bw = W * 0.34;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      rr(ctx, 12, 28, bw, 9, 4); ctx.fill();
      ctx.fillStyle = frac > 0.34 ? '#c9382a' : '#ff5a3c';
      rr(ctx, 13, 29, Math.max(0, (bw - 2) * frac), 7, 3); ctx.fill();
      return;
    }

    const ph = MAP_SIZE;
    const pw = Math.round(ph * PORTRAIT_ASPECT);
    const px = 12, py = MAP_TOP;

    rr(ctx, px, py, pw, ph, 4);
    ctx.fillStyle = 'rgba(8,5,11,0.92)';
    ctx.fill();

    const ix = px + 2, iy = py + 2, iw = pw - 4, ih = ph - 4;
    /**
     * The drained band — what you have LOST — and it rises from the BOTTOM.
     *
     * It used to hang from the top edge and drain downward, which is the intuitive
     * reading of a meter and the wrong one for a portrait: the first thing damage ate
     * was the face, so a wizard on half health had no head. Baldur's Gate fills its
     * portraits the other way round for exactly that reason — the red climbs out of the
     * bottom of the frame and the face is the last thing to go under, which also means
     * the closer you are to dying the more obviously wrong the picture looks.
     */
    const lost = Math.round(ih * (1 - frac));
    const lostTop = iy + ih - lost;

    ctx.save();
    ctx.beginPath();
    rr(ctx, ix, iy, iw, ih, 3);
    ctx.clip();
    drawPortrait(ctx, w.portrait, ix, iy, iw, ih);
    if (lost > 0) {
      // Drain in two passes: pull the colour out of the lost band, then wash it red. One
      // pass could do either but not both, and the desaturation is what makes it read as
      // absence rather than as a red light shining on a healthy face.
      ctx.save();
      ctx.beginPath();
      ctx.rect(ix, lostTop, iw, lost);
      ctx.clip();
      /**
       * LIGHTER UNDER THE WATERLINE, not darker.
       *
       * It was three passes and two of them took light out: grayscale, then a dark red
       * wash, then a near-black `rgba(4,2,6,0.42)` on top. On an already-dim portrait
       * that stacked to essentially black, so the drained band read as a hole cut in the
       * card rather than as a face under water — and the lower your health, the more of
       * the frame was simply missing.
       *
       * So the band is LIFTED first and tinted once. `brightness` above 1 in the filter
       * does the lifting on the portrait itself, which keeps the face readable all the
       * way down to a sliver of health, and a single bright wash carries the red. One
       * pass that adds light beats two that remove it.
       */
      drawPortrait(ctx, w.portrait, ix, iy, iw, ih);
      desaturate(ctx, ix, lostTop, iw, lost);
      brighten(ctx, ix, lostTop, iw, lost, 0.16);
      ctx.fillStyle = 'rgba(216,62,48,0.44)';
      ctx.fillRect(ix, lostTop, iw, lost);
      ctx.restore();
      // The waterline, so the level is readable even at a glance. On the TOP edge of the
      // band now, because that is the edge that moves.
      ctx.fillStyle = 'rgba(255,90,60,0.9)';
      ctx.fillRect(ix, lostTop, iw, 1.5);
    }
    ctx.restore();

    /**
     * THE TELEGRAPH, on the frame: it pulses while anything can reach you.
     *
     * Moved off the old bar and onto the portrait's own edge, because the bar it used to
     * pulse no longer exists — and the frame is a better host anyway, being the biggest
     * closed shape on the screen that is not the world.
     */
    rr(ctx, px, py, pw, ph, 4);
    if (n > 0) {
      const pulse = 0.5 + Math.sin(this.engine.time * 7) * 0.5;
      ctx.globalAlpha = 0.5 + pulse * 0.5;
      ctx.strokeStyle = '#ff3a2a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = 'rgba(255,207,92,0.6)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // Name and figure INSIDE the frame, outlined against the art the way the roster's
    // captions are — a caption in a strip under the portrait is what made this corner
    // tall in the first place.
    ctx.textAlign = 'center';
    const ink = (text: string, ty: number, font: string, fill: string) => {
      ctx.font = font;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(4,2,6,0.9)';
      ctx.strokeText(text, px + pw / 2, ty);
      ctx.fillStyle = fill;
      ctx.fillText(text, px + pw / 2, ty);
    };
    ink(w.name, py + ph - 26, 'bold 11px ui-monospace, monospace', '#fff4dc');
    ink(`${Math.max(0, this.state.hp)}/${this.state.maxHp}`, py + ph - 14,
      '10px ui-monospace, monospace', frac > 0.34 ? 'rgba(255,225,200,0.95)' : '#ff8a70');
    ctx.textAlign = 'left';
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
    const lever = e.kind === 'lever';
    /**
     * A lever says what it will DO, because unlike an altar it can be undone and the
     * player has to know which way they are about to move it.
     *
     * PULL and PUSH BACK, not THROW and RELEASE. "Throw" is the correct word for a
     * switch and the wrong word for THIS game: you throw a spell here, by tearing a
     * page out and hurling it, and that verb is the first one the player is taught.
     * A prompt reading TAP TO THROW next to a lever is a prompt that has to be
     * disambiguated by context every single time it appears. The two words that are
     * left are the physical ones, they name opposite directions of the same gesture,
     * and neither of them means anything else in this dungeon — which is the entire
     * requirement for a two-word label on a button.
     *
     * They also match what everything under the UI already calls it: `pullLever`,
     * `BossDoor.pulled`, and the sprite is `lever_pulled`.
     */
    const label = lever ? (e.spriteId === 'lever_pulled' ? 'TAP TO PUSH BACK' : 'TAP TO PULL')
      : chest ? 'TAP TO OPEN' : 'TAP THE ALTAR';
    ctx.font = 'bold 11px ui-monospace, monospace';
    const tw = ctx.measureText(label).width + 40;
    const bx = (W - tw) / 2, by = this.bookTop - 300;
    const pulse = 0.72 + Math.sin(t * 3.4) * 0.22;
    rr(ctx, bx, by, tw, 28, 14);
    ctx.fillStyle = lever ? 'rgba(52,38,10,0.9)' : chest ? 'rgba(56,40,14,0.9)' : 'rgba(40,24,60,0.9)';
    ctx.fill();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = lever || chest ? '#ffcf5c' : '#b98cff';
    ctx.lineWidth = 1.7;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = lever || chest ? '#fff0c8' : '#e8d8ff';
    ctx.fillText(label, W / 2, by + 14.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    this.hits.push({
      rect: [bx, by, tw, 28],
      action: lever ? { kind: 'target', entity: e }
        : chest ? { kind: 'chest', entity: e } : { kind: 'altar', entity: e },
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
    /**
     * A VEIL, not a curtain.
     *
     * It was a flat 0.86 black and it hid the altar completely — the one moment in a
     * run where the room matters most, and the stone with the open book and the
     * flames above it was painted out to make space for cards describing what that
     * stone is offering. Darkened enough that the type holds, clear enough that you
     * can still see what you are standing at.
     *
     * Heavier at the top and bottom than through the middle, so the two bands that
     * carry text get their contrast and the altar itself stays visible in the gap.
     */
    const veil = ctx.createLinearGradient(0, 0, 0, H);
    veil.addColorStop(0, 'rgba(8,5,12,0.82)');
    veil.addColorStop(0.42, 'rgba(8,5,12,0.62)');
    veil.addColorStop(0.72, 'rgba(8,5,12,0.42)');
    veil.addColorStop(1, 'rgba(8,5,12,0.78)');
    ctx.fillStyle = veil;
    // The scrim covers the PHYSICAL screen, not the safe box the rest of this panel
    // lays out in: a wash inset with the chrome would leave a strip of live dungeon
    // above and below the modal. Hence the negative origin and `sh`.
    ctx.fillRect(0, -this.engine.insetTop, W, this.engine.sh);

    ctx.textAlign = 'center';
    ctx.font = 'bold 12px ui-monospace, monospace';
    // Outlined, because the veil is thin enough now that a torch behind the title
    // can reach it — the same trick the depth row uses over the world.
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(6,4,9,0.85)';
    ctx.strokeText(this.offerTitle, W / 2, H * 0.13);
    ctx.fillStyle = '#b98cff';
    ctx.fillText(this.offerTitle, W / 2, H * 0.13);
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(232,217,176,0.55)';
    ctx.fillText(this.offerSubtitle, W / 2, H * 0.13 + 16);

    /**
     * THREE COLUMNS, LEFT TO RIGHT. Not a list.
     *
     * A vertical stack reads as a ranking — first place, second, third — and these
     * are peers. Side by side is the shape of a choice.
     *
     * The card is drawn at exactly `CARD_SCALE`, never fitted to the column, because
     * it is pixel art: a fractional scale shimmers and reads as a rendering fault
     * rather than as a small page. The COLUMN flexes around the card instead.
     */
    const gap = 8;
    const margin = 10;
    /**
     * The card fills whatever the column can give it, rather than sitting at a fixed
     * scale inside one.
     *
     * The first version drew at a fixed 2× of a small authored card, and it was too
     * small on every screen — a page you have to lean toward is not the object the
     * grimoire taught you. So the width is whatever three columns and their gutters
     * leave, and the height follows the page's own aspect. Also capped against the
     * available HEIGHT, because the modal still has to fit a headline, a body and a
     * price under each card.
     */
    const byWidth = (W - margin * 2 - gap * (offers.length - 1)) / offers.length;
    const byHeight = (H * 0.38) * (CARD_W / CARD_H);
    const cardW = Math.floor(Math.min(byWidth, byHeight));
    const cardH = Math.round(cardW * (CARD_H / CARD_W));
    const rowW = cardW * offers.length + gap * (offers.length - 1);
    const x0 = (W - rowW) / 2;
    const top = H * 0.22;

    offers.forEach((o, i) => {
      const x = x0 + i * (cardW + gap);
      const sel = o.golden;

      /**
       * The golden card is the only one that glows, and it is worth the exception:
       * it is the one thing in a roll that crosses a run boundary at all, and it
       * shows up in maybe half a run's altars. It cannot be a card you skim.
       */
      if (sel) {
        const pulse = 0.6 + Math.sin(this.engine.time * 2.4) * 0.4;
        ctx.save();
        ctx.shadowColor = `rgba(255,207,92,${0.35 + pulse * 0.35})`;
        ctx.shadowBlur = 10 + pulse * 12;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.offerCanvas(o), x, top, cardW, cardH);
      if (sel) ctx.restore();

      /**
       * A FACE, over the card's emblem, when the card is a person.
       *
       * Drawn on top of the authored card rather than baked into `offerCanvas` because
       * the card art is generated from the SPELL — the roster screen is the one place
       * that knows a page has a person attached, and pushing that knowledge down into
       * the card generator would put wizards inside the altar's own offers.
       *
       * It lands on the emblem's footprint, so the composition of the card is unchanged:
       * title above, portrait where the sigil was, page name and reason below.
       */
      if (o.portrait) {
        const iw = Math.round(cardW * 0.62);
        const ih = Math.round(cardH * 0.44);
        const ix = Math.round(x + (cardW - iw) / 2);
        const iy = Math.round(top + cardH * 0.19);
        ctx.save();
        ctx.beginPath();
        rr(ctx, ix, iy, iw, ih, 2);
        ctx.fillStyle = 'rgba(12,8,14,0.95)';
        ctx.fill();
        ctx.clip();
        drawPortrait(ctx, o.portrait, ix, iy, iw, ih);
        ctx.restore();
        rr(ctx, ix, iy, iw, ih, 2);
        ctx.strokeStyle = 'rgba(60,40,24,0.9)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      /**
       * The tag above and the body below, both centred on the card's own column.
       * Copy that used to sit INSIDE the row now sits under the object it describes,
       * which is what lets the object be the thing the eye lands on first.
       */
      /**
       * The copy is sized to be READ, not to fit.
       *
       * It started at 8px monospace under a card that fills a third of the screen,
       * which made the one screen in the game meant to be read the one with the
       * smallest type on it. The card can afford to lose a few pixels of height for
       * copy that does not need leaning toward.
       */
      ctx.textAlign = 'center';
      ctx.font = 'bold 10px ui-monospace, monospace';
      ctx.fillStyle = o.kind === 'sacrifice' ? 'rgba(255,150,110,0.95)'
        : o.golden ? 'rgba(255,207,92,0.9)'
        : hexCss(o.colour, 0.9);
      // An offer may carry no tag at all, and then nothing is drawn there. A line
      // that is the same on all three cards is not a label, it is decoration in the
      // one place the player is reading — see `offerStartPage`.
      if (o.tag) ctx.fillText(o.tag.toUpperCase(), x + cardW / 2, top - 10);

      let ty = top + cardH + 20;
      ctx.font = 'bold 16px ui-serif, Georgia, serif';
      ctx.fillStyle = o.golden ? GOLD : '#fff4dc';
      for (const ln of wrapLines(ctx, o.name, cardW - 2)) {
        ctx.fillText(ln, x + cardW / 2, ty);
        ty += 18;
      }

      ty += 2;
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(226,216,200,0.82)';
      for (const ln of wrapLines(ctx, o.detail, cardW - 2)) {
        ctx.fillText(ln, x + cardW / 2, ty);
        ty += 13;
      }

      /**
       * The price, in an alarm colour under the card it belongs to. Only the rank-3
       * sacrifice has one — it is the only offer that takes something away for good
       * — and a player who meets that price in the log afterwards was tricked.
       */
      if (o.cost) {
        ty += 6;
        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.fillStyle = '#ffc0a4';
        for (const ln of wrapLines(ctx, o.cost, cardW - 2)) {
          ctx.fillText(ln, x + cardW / 2, ty);
          ty += 13;
        }
      }

      /**
       * The seal and the pips sit at the FOOT of the object, not its head. A scroll's
       * top is a rolled end — a solid bar — and a badge landing on it read as damage
       * to the drawing rather than as a mark on it.
       */
      if (o.golden) this.drawSeal(ctx, x + cardW - 6, top + cardH - 20, 'NEXT RUN');
      else if (o.toRank > 0) this.drawRankPips(ctx, x + cardW - 6, top + cardH - 18, o);

      // The whole column is the target, card and copy alike — a tap that lands on
      // the words describing a thing meant to choose that thing.
      this.hits.push({ rect: [x - gap / 2, top - 18, cardW + gap, ty - top + 18], action: { kind: 'offer', offer: o } });
    });

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * The offer's object, rasterised once and kept.
   *
   * Cached on the offer's identity because a roll is stable while the modal is open
   * and this redraws every frame — re-authoring three cards at 60Hz would be the
   * most expensive thing on the screen by a wide margin.
   */
  private offerCanvas(o: AltarOffer): HTMLCanvasElement {
    const key = `${o.kind}:${o.id}:${o.golden}:${o.toRank}`;
    let c = this.offerArt.get(key);
    if (!c) {
      const spell = o.id ? ALL_PAGES.find((pg) => pg.gameId === o.id) : undefined;
      // A SPELL is a page; everything else is a scroll. The shape answers "is this a
      // spell?" before a word of the copy is read. A sacrifice is a scroll even though
      // it names a page, because what it hands over is a transaction and not a sheet —
      // and so is a `star`, which names the maxed page it was rolled for but pays in
      // currency. Both carry an `o.id`, so the kind has to be asked, not the id.
      const sheet = spell && o.kind !== 'sacrifice' && o.kind !== 'star';
      /**
       * The name AT THE RANK BEING OFFERED, not the rank-1 name on the spell record.
       * `toRank` is 0 for the offers that hand a page over at rank 1 — a golden, a
       * blessing's wider book, the mouth's one page — and `rankName` floors those to
       * rung 1, so the one expression covers every page card there is.
       */
      const pix = sheet
        ? pageCard(spell, ALL_PAGES.indexOf(spell), o.golden, rankName(o.id, o.toRank))
        : scrollCard(o.colour, o.kind, OFFER_LABEL[o.kind] ?? o.kind, o.golden);
      c = pix.toCanvas();
      this.offerArt.set(key, c);
    }
    return c;
  }

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
    // The scrim covers the PHYSICAL screen, not the safe box the rest of this panel
    // lays out in: a wash inset with the chrome would leave a strip of live dungeon
    // above and below the modal. Hence the negative origin and `sh`.
    ctx.fillRect(0, -this.engine.insetTop, W, this.engine.sh);
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
