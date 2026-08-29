import * as THREE from 'three';
import { Engine } from './core/engine';
import { Floor, isCastableObject, type Entity } from './game/floor';
import { Stepper, PITCH } from './game/stepper';
import {
  WIZARDS, WIZARD_BY_ID, FIRST_WIZARD, freedBy, captiveOn,
  type Wizard, type WizardElement,
} from './game/wizards';
import {
  Combat, DENIAL_STATUSES, targetsInView, MAX_RANK, type PlayerState,
} from './game/combat';
import { CastFx } from './spells/vfx';
import { StunView } from './dungeon/stunView';
import {
  Hud, isTileTarget, sameTarget,
  type AimTarget, type AltarOffer, type HandCard, type UiAction,
} from './ui/hud';
import { TreeScreen, type TreeAction } from './ui/tree';
import { routeCost, routeTo } from './ui/treeCommon';
import { Book } from './book/book';
import { Fan } from './book/fan';
import {
  bookScene, camera as bookCam, projectToScreen, tickBook, resizeBook, sinks, sfx,
} from './book/bridge';
import { PAGE_H, PAGE_W } from './book/pageMaterial';
import { SPELLS as BOOK_PAGES, setBookPages, type SpellDef } from './spells/pages';
import {
  ELEMENT_SPELLS, INGREDIENT_IDS, SPELL_BY_ID, displayName, harvestOf,
  isIngredient, isPageElement, rankName, wantsCorpse, wantsObject,
  type ResolvedCast,
} from './spells/spells';
import { harvestCard, harvestColour } from './spells/harvestCards';
import { ingredientCard, ingredientColour } from './spells/ingredientCards';
import {
  ALTAR_INGREDIENTS, BELT_LOCKED, CHEST_INGREDIENTS, beltAdd, beltConsume, beltHeld,
  beltRefusalFor, beltRefuse, beltSetCapacity, beltTotal, newBelt, rollDropCount,
  rollIngredient, beltDrop, beltMove, pouchable,
} from './spells/belt';
import { BELT_ENABLED } from './flags';
import { Rng } from './core/rng';
import { DIR_VEC, Surface, type Dir } from './dungeon/grid';
import type { LayoutId } from './dungeon/layouts';
import { STEP_H, WALL_H } from './art/tiles';
import { THEMES } from './art/theme';
import { hitFxFor } from './game/hitfx';
import { affinityOf } from './game/affinity';
import type { Element as SpellElement } from './spells/spells';
import { DEFAULT_STEP, setPixelStep } from './art/steps';
import {
  CATCH_UP_DRAWS, CHEST_HEAL_SPREAD, ENGAGE_RADIUS, PLAYER_MAX_HP, THREAT_REACH,
  chestHealBase, fallDamage, healable,
  POUR_TURNS_PER_UNIT, GROUND_ARM_DRAIN, MAX_HP_GIFT,
} from './game/tuning';
import type { StatusId } from './spells/spells';
import { substanceOf, SUBSTANCE_COMPONENT } from './game/ground';
import { setGilded, setPageRanks } from './book/pageTexture';
import {
  NODE_BY_ID, TREE, derivedBeltSlots, derivedGolemInfusion, derivedGolemsKept, derivedPouchTier, derivedHasChart, derivedAltarWidth,
  derivedHandSize, derivedSlots, buyBlocker, isNodeId, migrateOwned, owns,
  refundBlocker, sanitizeOwned, type NodeId,
} from './meta/tree';
import { initAnalytics, track } from './systems/analytics';

/**
 * Persisted meta.
 *
 * `loadout` is the book you START each run with, and it does NOT grow just from
 * finding spells — a run's discoveries are that run's. Every page you pick up at
 * an altar is effectively sealed: it is gone when the run ends. That reset is the
 * whole reason an altar choice matters, and letting found pages accumulate into
 * the starting book quietly dissolved it (you drifted toward starting with
 * everything, and altars stopped mattering).
 *
 * The only thing that crosses a run boundary at all is a GOLDEN page, and it
 * crosses exactly one — see `giftedPage`. Nothing writes `loadout` but the star
 * tree's trim in `applyTree`.
 */
interface Meta {
  stars: number;
  /** The pages you begin every run holding. */
  loadout: string[];
  /**
   * The page a golden altar gilded, waiting for the run after it.
   *
   * A one-shot gift and not a fourth entry in `loadout`: you begin the NEXT
   * descent holding it, and the descent after that you do not. Consumed at run
   * start (see `takeGift`), which is why it is a single id rather than a list —
   * at most one golden page is claimable per run, so at most one can ever be
   * waiting here.
   */
  giftedPage: string | null;
  /**
   * Fusions this player has ever cast, by name.
   *
   * On `meta` and never on the run, because it is the one record that survives a
   * death — and `docs/DESIGN.md` is explicit that knowledge the player earned is
   * NEVER sold back to them. There is deliberately no price, no node and no unlock
   * anywhere near this list; a paywall on your own memory is listed under
   * `## Rejected — do not re-add`.
   */
  bestiary: string[];
  /**
   * The DEPTHS whose boss you have killed. A set, not a high-water mark.
   *
   * `meta.best` is a single number and cannot answer this: a player who reaches floor
   * 7 and dies has killed six bosses, but a player who STARTS at floor 6 and kills
   * that boss has killed one boss, at depth 6, and none above it. Recording the deed
   * per depth is the only shape that survives a deep start — which is exactly what
   * this unlocks, so it would break itself within one run otherwise.
   */
  bossKills: number[];
  /**
   * How many pages the starting book can hold. DERIVED from `nodes` — see
   * `applyTree`, which is the only thing allowed to write it.
   */
  slots: number;
  /**
   * How many components you can hold at once — the fusion ceiling.
   *
   * One at the start, because a hand of one is where fusion gets SOLD rather
   * than taught: you buy the second slot, try holding two pages, and work out
   * combining for yourself. Nothing to do with `slots`, which is how big the
   * starting book is.
   *
   * Also DERIVED from `nodes`, for the same reason and through the same writer.
   */
  handSize: number;
  best: number;
  /** The star tree nodes you own. The only thing on this object that is bought. */
  nodes: NodeId[];
  /**
   * The tree node you are saving for, or null.
   *
   * Persisted rather than held by the tree screen, and that is the whole feature:
   * a goal that only exists while the menu is open is a goal you forget the moment
   * you start the run that would pay for it. The top bar reads it back as
   * `✦ have / need`, so the thing you are banking toward is on screen in the
   * dungeon. Not a purchase and not a permission — nothing gameplay reads gates on
   * it — so it needs no sanitisation beyond "is this a node id".
   */
  pinned: NodeId | null;
  /**
   * The world's texel density, in texels per world unit.
   *
   * The only DISPLAY setting on this object, and it is here rather than in a store of
   * its own because there is exactly one of it and `meta` is already the thing that
   * survives a run. It is not derived, not bought and not gameplay: nothing reads it
   * but `src/art/steps.ts`, which the tile generators ask at build time.
   *
   * Guarded on load by membership rather than by `savedCount`, for the reason `pinned`
   * is: it is one of four values, not a count, and a save claiming PPU 3 would build a
   * three-texel wall rather than a small number.
   */
  /**
   * Vertical field of view, in degrees. The second DISPLAY setting, here for the same
   * reason the texel density is: there is one of it, and `meta` is the thing that
   * survives a run.
   *
   * Clamped on load rather than counted, because a save claiming 400 is a save that
   * turns the dungeon inside out — see `clampFov`.
   */
  fov: number;
  /**
   * The wizards this save has unlocked, in no particular order.
   *
   * NOT a count and not a high-water mark: the roster is a chain (`Wizard.frees`) and a
   * player can only have freed the people they actually reached, so the owned SET is the
   * only shape that survives. Always contains `FIRST_WIZARD` — a save that unlocked
   * nobody would have nothing selectable and no way to start.
   */
  wizards: WizardElement[];
  /**
   * Invert every movement gesture: swipes, the two-finger pair, and the look-drag.
   *
   * ONE flag for all of them rather than one per axis. The gestures were flipped because
   * they disagreed with each other, and a per-axis setting would just let a player rebuild
   * that disagreement — the only sane choice here is "the world follows my finger" or "my
   * finger drives the camera", and that is a single preference.
   *
   * DEFAULTS TO TRUE, so the shipped feel is the inverted one and the code's unsigned
   * direction is the option. Worth knowing when reading the gesture sites: `gsign()` is -1
   * on a fresh save, so the branches there read as the NON-default case.
   */
  invertGestures: boolean;
  /**
   * Wizards this save has FREED, which is not the same list as `wizards`.
   *
   * `wizards` is who you may play; this is who you have cut out of a cage. They diverge on
   * exactly one entry and always will — ASH is playable from the first launch and is never
   * freed by anybody — so collapsing them into one list would either make Ash rescuable or
   * make the first save unplayable.
   */
  freed: WizardElement[];
}

// Deliberately still the old working title. The key is an opaque save handle, not
// a name the player ever sees, and renaming it would orphan every save in the wild
// for no gain — see the note in README.
const META_KEY = 'stepper-mage.meta.v1';

/**
 * The activation flag, and why it is NOT in `Meta`.
 *
 * `ftue_completed` is the only input to FOUNDRY's D0 activation column, and it
 * has to fire exactly once per player, ever. That is a different lifetime from
 * everything in `Meta`: wiping progress (`resetProgress`) is a thing a player
 * does to start over, not a thing that makes them a new activation, so this
 * lives in its own key that the reset deliberately does not remove.
 *
 * This game has no tutorial, so there is no FTUE to finish. The nearest honest
 * reading of "activated" is that the player actually got into a floor rather
 * than bouncing off the boot screen, which is why it fires from `enterFloor`
 * and not from boot — fired at boot it would be 1:1 with `session_start` and
 * the column would read 100% forever, which answers nothing.
 */
const FTUE_KEY = 'stepper-mage.ftue.v1';

/** Fire `ftue_completed` the first time this player reaches a floor, once ever. */
const trackFtueOnce = (depth: number): void => {
  try {
    if (localStorage.getItem(FTUE_KEY)) return;
    localStorage.setItem(FTUE_KEY, '1');
  } catch {
    // Private mode: nothing persists, so firing every session would inflate
    // activation. Staying silent under-counts instead, which is the safer bias.
    return;
  }
  track('ftue_completed', { depth });
};

/**
 * FOV, and why the default moved.
 *
 * 90 was the value the game shipped with, and it is too narrow for a grid: a body one
 * tile diagonal from you sits almost exactly on the edge of a 90-degree frame, so the
 * most common threat in the game — the thing standing at your shoulder — is the one you
 * cannot see. 100 puts a full diagonal comfortably inside the frame.
 *
 * The range is deliberately narrow at the bottom. Below about 85 the diagonal problem
 * comes back and no amount of leaning fixes it; above about 120 the walls shear badly
 * enough at the frame edge that the corridors stop reading as square.
 */
const FOV_MIN = 85;
const FOV_MAX = 120;
const DEFAULT_FOV = 100;
/**
 * The unlocked roster off a save, guarded the way `pinned` is: by membership, not by
 * counting. A hand-edited save naming a wizard that does not exist would otherwise put a
 * card on the selection screen with no portrait behind it.
 *
 * `FIRST_WIZARD` is forced in. A save that somehow unlocked nobody must still be able to
 * begin a run, and "you own the head of the chain" is a rule rather than a stored fact.
 */
function sanitizeWizards(v: unknown): WizardElement[] {
  const ids = new Set<WizardElement>([FIRST_WIZARD]);
  if (Array.isArray(v)) {
    for (const x of v) if (WIZARD_BY_ID[x as string]) ids.add(x as WizardElement);
  }
  return [...ids];
}

const clampFov = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(FOV_MAX, Math.max(FOV_MIN, Math.round(n))) : DEFAULT_FOV;
};

/**
 * The loadout is a book, and the book holds elements only. Animate used to sit
 * in the starting three, so every save from before the split has an id in here
 * that no longer has a page — those are dropped rather than migrated to
 * something else, because an ingredient is not a page's worth of value.
 */
const DEFAULT_LOADOUT = ['fire', 'frost', 'spark'];

/**
 * A saved number is whatever was in localStorage — hand-edited, half-written by a
 * crash, or from a build that stored something else entirely.
 *
 * `handSize` and `slots` are no longer read out of a save as answers — the star
 * tree derives them, see `applyTree` — but they still pass through here on their
 * way into `migrateOwned`, where a NaN would read an old save back as owning the
 * wrong nodes. The failure that put this here is worth keeping in view: a
 * non-numeric `handSize` made every `fan.count >= handSize()` comparison false,
 * which is an unbounded hand.
 */
function savedCount(v: unknown, fallback: number, min: number): number {
  const n = Math.floor(Number(v));
  return Math.max(min, Number.isFinite(n) ? n : fallback);
}

/**
 * Recompute everything the star tree DERIVES, and the only place `handSize` and
 * `slots` are ever written.
 *
 * Both fields already existed and are already read by gameplay — `handSize` every
 * frame through the `handSize()` accessor, `slots` by every golden-page claim — so
 * the one thing this phase must not do is add a second copy of the answer. Owning
 * `hand2` does not SET the hand size; the hand size is a function of the owned set
 * and nothing else, which is what makes it impossible for a refund to leave a
 * stale ceiling behind. There is no write path that could disagree, because there
 * is no other write path.
 *
 * Called on load and after every purchase and refund. Idempotent by construction.
 */
function applyTree(m: Meta): Meta {
  m.nodes = sanitizeOwned(m.nodes);
  m.handSize = derivedHandSize(m.nodes);
  m.slots = derivedSlots(m.nodes);
  // Refunding the fourth binding has to give the fourth page back too, or the
  // loadout keeps a slot nobody owns. Trimmed from the FRONT, because the first
  // entries are the defaults and anything past them was put there deliberately.
  if (m.loadout.length > m.slots) m.loadout = m.loadout.slice(m.loadout.length - m.slots);
  // A goal you have reached is not a goal. Cleared here rather than at the point of
  // sale so it also clears for a save that was hand-edited into owning its own pin.
  if (m.pinned && m.nodes.includes(m.pinned)) m.pinned = null;
  return m;
}

function loadMeta(): Meta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const m = JSON.parse(raw) as Partial<Meta> & { unlocked?: string[] };
      // `unlocked` is the pre-reset field name; migrate it but clamp to the slot
      // count so an old save that had accumulated every page does not carry that
      // advantage into the corrected rules.
      const legacy = Array.isArray(m.unlocked) ? m.unlocked : [];
      const loadout = (Array.isArray(m.loadout) && m.loadout.length ? m.loadout : legacy)
        .filter(isPageElement);
      return applyTree({
        // Counts, not ceilings, but through the same coercion: a NaN here renders
        // as "✦ NaN" and poisons every total it is added to.
        stars: savedCount(m.stars, 0, 0),
        // The fallback comes first, so a save whose loadout filtered down to
        // nothing still starts with a book rather than with one sealed page;
        // `applyTree` is what clamps it to the slots the tree actually grants.
        loadout: loadout.length ? loadout : [...DEFAULT_LOADOUT],
        // Deliberately not given a value here. `applyTree` is their one writer,
        // and a literal would be exactly the second source of truth this phase
        // exists to avoid. A save from before the tree has no owned set, so its
        // saved ceilings are read BACK into one — see `migrateOwned`.
        slots: 0,
        handSize: 0,
        best: savedCount(m.best, 0, 0),
        nodes: migrateOwned(m.nodes, savedCount(m.handSize, 1, 1), savedCount(m.slots, 3, 1)),
        // Through the same guard the loadout gets, so a hand-edited save cannot
        // gift a page that has none — and unlike the loadout it has no fallback,
        // because "no page waiting" is the normal state.
        giftedPage: typeof m.giftedPage === 'string' && isPageElement(m.giftedPage)
          ? m.giftedPage : null,
        bestiary: Array.isArray(m.bestiary) ? m.bestiary.filter((x: unknown) => typeof x === 'string') : [],
        bossKills: Array.isArray(m.bossKills)
          ? m.bossKills.filter((x: unknown) => typeof x === 'number') : [],
        pinned: isNodeId(m.pinned) ? m.pinned : null,
        // A save from before the slider has no fov; `clampFov` reads undefined as the
        // default, so an old save opens at the new 100 rather than at a NaN frustum.
        fov: clampFov(m.fov),
        wizards: sanitizeWizards(m.wizards),
        // Default ON, and absent means ON — a save written before this setting existed
        // should behave like a new one rather than silently opting out.
        invertGestures: m.invertGestures !== false,
        freed: sanitizeWizards(m.freed).filter((id) => id !== FIRST_WIZARD),
      });
    }
  } catch { /* corrupt or unavailable storage: fall through to defaults */ }
  return applyTree({
    stars: 0, loadout: [...DEFAULT_LOADOUT], slots: 0, handSize: 0, best: 0, nodes: [],
    giftedPage: null, pinned: null, bestiary: [], bossKills: [], fov: DEFAULT_FOV,
    wizards: [FIRST_WIZARD], invertGestures: true, freed: [],
  });
}

function saveMeta(m: Meta): void {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* private mode */ }
}

async function boot(): Promise<void> {
  /**
   * Telemetry, before anything that could throw.
   *
   * First two statements of boot on purpose: a crash in the engine constructor is
   * exactly the event worth having a session for, and analytics brought up after it
   * would record every session BUT the broken ones. Neither call can fail the boot —
   * both no-op without their key and both swallow their own errors (`systems/`), so
   * the worst case here is a run with no telemetry rather than a run with no game.
   *
   * AppsFlyer is dynamically imported so the web bundle never pulls the native
   * plugin in; it returns immediately off-device.
   */
  initAnalytics();
  void import('./systems/appsflyer').then((m) => m.initAppsFlyer());
  track('session_start');

  const engine = new Engine({ internalHeight: 400, levels: 36 });
  const meta = loadMeta();
  // Before anything is built, like the texel density: the frustum decides what the
  // first frame frames, and applying it later would show one frame at the engine's
  // own 90 before snapping to the player's.
  engine.setFov(meta.fov);
  /**
   * The saved texel density, in force before anything is built.
   *
   * First statement after the load on purpose: every tile texture and every sprite
   * quad reads the step at construction time, so a floor built before this line would
   * be built at the default and then need rebuilding. Nothing between here and
   * `enterFloor(1)` touches the world.
   */
  // Clamped to what this build ships. A save carrying 144 is legitimate — the full
  // game offers it — and the same save opened in the playable, which does not embed
  // that roster, would ask for sprites that are not in the file.
  /**
   * The world is LOCKED to one texel density (`Roadmap/First_Minutes.md`).
   *
   * Set once here and never again. 72 is the step where nothing is out of register —
   * creatures come from the 72 roster, so the stone and the sprites share a density —
   * and it was already the default. The chip that offered the other three, the
   * persisted setting behind it and the cycle gesture are all deleted rather than
   * hidden behind a constant, because a dead setting left in place is how a setting
   * comes back.
   */
  setPixelStep(DEFAULT_STEP);
  /**
   * Everything procedural on this run derives from here: the floor layout, the
   * altar roll and the chest roll.
   *
   * `let`, not `const`, so the debug surface can pin it. A `Date.now()` seed means
   * a harness asking "is a run winnable at hand size 1" samples a different
   * dungeon every time, which is a distribution and never a regression gate. Every
   * read is at CALL time (`enterFloor`, `rollAltarOffers`, `openChest`), so
   * replacing it genuinely changes the next floor built rather than being captured.
   */
  let runSeed = `run-${Date.now() % 100000}`;

  /**
   * Take the golden page the last run left, if it left one.
   *
   * Consumed HERE — at run start, and SAVED before the run has drawn a frame —
   * rather than when the next run is set up. A run begins exactly once per page
   * load (a finished run reaches the next one through `location.reload()`), so
   * this is the only boundary that exists to hang the "and that run only" half of
   * the rule on. Clearing it at the END of the run instead would hand the same
   * gift out again to anyone who shut the tab mid-descent, which is a permanent
   * page reached by closing a window.
   */
  const takeGift = (): string | null => {
    const id = meta.giftedPage;
    if (!id) return null;
    meta.giftedPage = null;
    saveMeta(meta);
    /**
     * No longer filtered against the loadout. The loadout is a MENU now rather than
     * the book — you leave the mouth with one page out of it — so a gift that names
     * a page on the menu is still a real second page. `offerStartPage` is what keeps
     * it from being wasted: the gifted page is struck off the menu, because being
     * offered a choice you have already been given is not a choice.
     */
    return id;
  };
  /** Kept for the log line the first floor raises: a gift has to be announced. */
  const gifted = takeGift();
  /**
   * A GIFT ARRIVES AS AN ORDINARY PAGE. The gold belonged to the run that won it.
   *
   * This used to gild whatever the last run left, which put the mark on the descent
   * that had not earned it and left the descent that had looking like every other:
   * you took the rarest thing the altar offers, and the book you were holding when you
   * took it did not change at all. The gold goes on at the altar now (see the `golden`
   * case in `chooseOffer`) and comes off with the run, so what crosses the boundary is
   * the PAGE and not the trophy.
   *
   * Called with null rather than skipped, because the gilded set outlives a reload in
   * module scope and a run that began with no gift must not inherit the last one's.
   */
  setGilded(null);
  /**
   * A run now BEGINS EMPTY, or holding nothing but last run's gift.
   *
   * The book used to open with all three of `meta.loadout` in it, which is what made
   * every run's first floor the same floor (`Roadmap/Guidance_And_Blessings.md`). The
   * loadout is now the menu the mouth offers and the player leaves with ONE page off
   * it — see `offerStartPage`, which runs before the first turn is ever taken.
   */
  const startPages = gifted ? [gifted] : [];

  const state: PlayerState = {
    hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP,
    pages: startPages,
    ranks: Object.fromEntries(startPages.map((id) => [id, 1])),
    stars: 0,
    depth: 1,
    // Empty, and as wide as the tree has paid for. A run never inherits a vial.
    belt: newBelt(derivedBeltSlots(meta.nodes), derivedPouchTier(meta.nodes)),
  };

  /**
   * Re-derive how many loops the strap has.
   *
   * The belt's capacity is a function of the owned node set and nothing else, which
   * is the same rule `applyTree` states for hand size and for the same reason: a
   * refund must not be able to leave a stale ceiling behind. This is the only writer.
   */
  const syncBelt = (): void => {
    beltSetCapacity(state.belt, derivedBeltSlots(meta.nodes));
    // The tier moves with the count and through the same one writer, or a refunded
    // depth node leaves pouches that are still deep.
    state.belt.tier = derivedPouchTier(meta.nodes);
  };

  const fx = new CastFx();
  engine.scene.add(fx.group);
  /**
   * Circling stars over anything that will lose its round. The tint and the "SKIPS"
   * floater both say it too late or too quietly — see `stunView.ts`.
   */
  const stunView = new StunView();
  engine.scene.add(stunView.group);

  /**
   * Every body that is currently denied, as a point to hang a ring over.
   *
   * Read fresh each frame rather than cached on a status change, because a stunned
   * body can still be SHOVED — a ring that lagged a tile behind the thing it belongs
   * to would be worse than no ring at all.
   */
  const stunned = function* (): Iterable<{ x: number; y: number; top: number }> {
    for (const e of floor.entities) {
      if (!e.alive || !e.hostile) continue;
      if (!DENIAL_STATUSES.some((id) => combat.has(e, id))) continue;
      yield {
        x: e.sprite.tx + e.sprite.ox,
        y: e.sprite.ty + e.sprite.oz,
        top: e.sprite.hover + e.sprite.h,
      };
    }
  };

  // ---- the grimoire ------------------------------------------------------
  // Rendered in its own scene at full resolution over the pixelated dungeon.
  // MeshToonMaterial needs real lights, so the book carries its own two-light
  // rig — it is lit by the spell it is holding, not by the room.
  bookScene.add(new THREE.AmbientLight(0xfff0d8, 1.15));
  const bookKey = new THREE.DirectionalLight(0xffe6bb, 1.9);
  bookKey.position.set(-0.4, 0.9, 0.7);
  bookScene.add(bookKey);
  const bookRim = new THREE.DirectionalLight(0x8fa6ff, 0.7);
  bookRim.position.set(0.6, -0.3, 0.4);
  bookScene.add(bookRim);
  engine.overlayScene = bookScene;
  engine.overlayCamera = bookCam;
  resizeBook(engine.sw, engine.sh);
  // Only the book relayouts on a resize now. The camera's framing is a constant, so
  // there is no measurement left for a viewport change to invalidate.
  engine.onResize = () => { resizeBook(engine.sw, engine.sh); };

  // The book contains only what the player has learned.
  setBookPages(state.pages);

  const book = new Book();
  const fan = new Fan();

  /** Lifted only by the debug harness, so a scripted fusion still works. */
  let handSizeBonus = 0;
  /**
   * THE FUSION CEILING: one hand per page you have found, up to three.
   *
   * Earned IN THE RUN rather than only bought between them. You begin holding one page and
   * one slot, and the second page you find is also the second hand — so the thing that
   * teaches fusion is the thing that enables it, in the same moment, with no shop trip in
   * between. `docs/DESIGN.md` argued that a hand of one is what SELLS fusion; this keeps
   * that and stops it being a wall, because a first run now reaches hand 2 on its own.
   *
   * The star tree becomes a HEAD START rather than the only road: `meta.handSize` is a
   * floor, so owning `hand2` means you begin at two instead of climbing to it. That is why
   * this is a `max` and not a sum — adding them would put a tree-owner at four, and three
   * is the ceiling the whole turn economy is priced against.
   *
   * Read through one accessor, as before, so nothing else has to know any of this.
   */
  const HAND_MAX = 3;
  const handSize = (): number => Math.max(
    meta.handSize,
    Math.min(HAND_MAX, state.pages.length),
  ) + handSizeBonus;

  /**
   * Why the open page will not tear, or null when it will.
   *
   * The two refusals are NOT the same event to the player and collapsing them into
   * one silent snap-back was why the commonest gesture in the game had no
   * explanation: at hand size 1 a full hand is the STEADY state, so a second
   * upward swipe is something you do constantly and it needs saying out loud. An
   * unlearned page is a property of the page instead, so it is shown on the page
   * (`book.isSealed`, and the HUD's sealed note) rather than said again per swipe.
   *
   * Note what is NOT here, and no longer is anywhere: a price. Tearing a page is
   * free — the turn is charged on the CAST (`Combat.cast`) — so a full hand is the
   * only thing a tear can ever be refused for, and refusing it is the game saying
   * "cast what you are holding first" rather than the game taking a round off you.
   */
  const ripRefusal = (spell: SpellDef): string | null => {
    if (!state.pages.includes(spell.gameId)) return `${spell.name} is not yours yet.`;
    const n = handSize();
    if (fan.count >= n) {
      return n === 1
        ? 'Your hand holds one page. Cast it, or put it back.'
        : `Your hands are full at ${n} pages. Cast them, or put one back.`;
    }
    return null;
  };

  book.canRip = (spell) => ripRefusal(spell) === null;
  // Seal the page itself when it is a spell you do not have, so the reason is on
  // the thing being refused and not only in the log.
  book.isSealed = (spell) => !state.pages.includes(spell.gameId);

  /**
   * Say why a tear was refused — once per refused gesture, and not again while the
   * same line is still on screen. A full hand is the steady state at hand size 1,
   * so an unguarded message would fill all four log slots with copies of itself.
   */
  let spokenRefusal = '';
  let spokenAt = 0;
  /** Say it once. Shared with the harvest pill, which is refused for the same reason. */
  const speakRefusal = (why: string): void => {
    const now = performance.now();
    // 5s is how long `Hud.addLog` keeps a line, so this re-speaks once it has faded.
    if (why === spokenRefusal && now - spokenAt < 5000) return;
    spokenRefusal = why;
    spokenAt = now;
    hud.addLog(why, 0xffcf5c);
  };
  const explainRefusal = (spell: SpellDef): void => {
    const why = ripRefusal(spell);
    if (why) speakRefusal(why);
  };

  /** Learn a page mid-run: rebuild the book and re-sync it. */
  const learnPage = (id: string): void => {
    /**
     * A SECOND COPY IS A SECOND PAGE, not a no-op.
     *
     * This deduped, and everything downstream disagreed with it. `handSize` counts
     * `state.pages`, so the book widening is what buys the hand that holds two cards;
     * `varietyStep` and the volume ladder are written around repetition being a real hand
     * ("three copies of the same page" is discussed there as the top rung); and
     * `tornIds` is a LIST that counts duplicates rather than a set. So a duplicate grant —
     * the mouth's wider-book blessing on a save whose roster is one element, which is now
     * every new save — silently paid out nothing at all: same book, same hand of one.
     *
     * Ranks stay keyed by id and both copies share one, which is correct: a rank is how
     * deeply the wizard knows Flame, not a property of the sheet it is written on.
     */
    state.pages.push(id);
    // Before the refresh, not after: the rank is what decides the name printed on the
    // sheet, so the stale art has to be evicted while the book is still being rebuilt.
    // Every caller writes `state.ranks[id]` immediately before calling this.
    setPageRanks(state.ranks);
    setBookPages(state.pages);
    book.refresh();
  };

  /**
   * Tell the grimoire what rank it holds each page at, and rebuild only if that moved.
   *
   * Ranks are written from eight places — every altar outcome, the mouth blessing, the
   * start page, a burn, the debug harness — and a page's printed NAME is a function of
   * its rank, so every one of those writes can invalidate page art. Rather than
   * remembering to refresh at each, this is called after each and does nothing unless
   * a rank actually changed; `setPageRanks` owns the diff and the cache eviction.
   */
  const syncPageRanks = (): void => {
    if (setPageRanks(state.ranks)) book.refresh();
  };

  book.onRip = (spell, worldPos, worldQuat) => {
    fan.add(spell, worldPos, worldQuat);
    // What you just tore out may change what is targetable. That is the WHOLE
    // follow-up now: a tear buys the room nothing, so there is no round to run.
    refreshTargets();
  };

  const tearPage = (index: number): boolean => {
    if (!canTakeComponent()) return false;
    if (book.tearAt(index)) return true;
    const spell = BOOK_PAGES[index];
    if (spell) explainRefusal(spell);
    return false;
  };

  // ------------------------------------------------------------------ reaching

  /**
   * Is this object REACHABLE — adjacent, and faced?
   *
   * The one rule behind every interaction in the game (`docs/DESIGN.md`,
   * Reaching): harvesting a fixture, claiming an altar, opening a chest and taking
   * the stairs all ask this and nothing else. Spells are the only thing that still
   * crosses a room.
   *
   * "Adjacent and facing" collapses to ONE tile — the one directly ahead — so
   * diagonals never count at any facing, which is the whole point: reaching costs
   * you the turns to walk there and the facing to commit to it.
   *
   * Read off `stepper.x` / `stepper.y` deliberately. The eye sits `PULLBACK`
   * behind the tile centre (`game/stepper.ts`) and that is a camera offset, not a
   * position — measuring reach from it would make the rule depend on the lens.
   *
   * The tile you are standing on counts too. Nothing solid can share it, so this
   * only ever answers for the stairs, which are a hole in the floor you can stand
   * on: being on top of them is not reaching across a room, and losing DESCEND by
   * walking onto them would read as a fault.
   */
  const inReach = (e: Entity): boolean => {
    const dx = e.sprite.tx - stepper.x, dy = e.sprite.ty - stepper.y;
    if (dx === 0 && dy === 0) return true;
    const [fx, fy] = DIR_VEC[stepper.dir];
    return dx === fx && dy === fy;
  };

  /**
   * Why an object is out of reach, in the player's words, or null when it is not.
   *
   * Two refusals and not one, because "step closer" said to someone already
   * standing beside the altar is the game describing a world the player cannot
   * see. Distance and facing fail for different reasons and are fixed by
   * different inputs.
   */
  const reachRefusal = (e: Entity, thing: string): string | null => {
    if (inReach(e)) return null;
    const d = Math.abs(e.sprite.tx - stepper.x) + Math.abs(e.sprite.ty - stepper.y);
    return d > 1 ? `Step closer to the ${thing}.` : `Turn to face the ${thing}.`;
  };

  /**
   * Take the room's element off a fixture.
   *
   * Priced exactly like a tear, through the same gate, because it IS a tear as far
   * as the economy is concerned: one hand slot and nothing else. What it is not is a
   * withdrawal — nothing is taken from the object, which is why the candelabra is
   * still lit afterwards and why this can be done twice. `docs/DESIGN.md` rejects
   * depleting fixtures outright, and that rule is only safe because harvests are
   * also non-storable.
   *
   * Adjacent and facing, like every other interaction (`inReach`). Line of sight
   * was the earlier rule — "it is magic" — and it made the whole room a shelf you
   * could take from without leaving the doorway, which is the position cost a
   * stepper is supposed to pay.
   */
  const harvestFrom = (e: Entity): boolean => {
    if (!canTakeComponent()) return false;
    // `hp <= 0` is a body already playing its death animation.
    if (!e.alive || e.hp <= 0 || e.kind !== 'prop' || e.animated) return false;
    const id = harvestOf(e.spriteId);
    if (!id) return false;
    /**
     * AND IT HAS TO HAVE SOMETHING LEFT IN IT.
     *
     * Refused in the fixture's own words rather than with a generic denial, because
     * "the candelabra is burnt out" teaches the rule and "you cannot do that" teaches
     * nothing. This is the first thing in the game that a player can use up, so the
     * first time it happens has to explain itself.
     */
    if (e.draws !== undefined && e.draws <= 0) {
      speakRefusal(`The ${displayName(e.spriteId).toLowerCase()} has nothing left.`);
      return false;
    }
    const why = reachRefusal(e, displayName(e.spriteId).toLowerCase());
    if (why) {
      hud.addLog(why, 0xffcf5c);
      return false;
    }
    if (fan.count >= handSize()) {
      /**
       * A FULL HAND IS ONLY A REFUSAL WHEN THE BELT CANNOT TAKE IT EITHER.
       *
       * The hand is what you cast from, so a draw goes there while there is room; past
       * that the belt takes the overflow. Refusing a harvest for a full hand while a
       * pouch stands empty is the failure this ordering exists to prevent — and at a
       * hand of one, which is where a new save lives for three floors, it would be the
       * normal case rather than an edge.
       */
      if (BELT_ENABLED && state.belt.capacity > 0) {
        const why2 = beltRefusalFor(state.belt, id);
        if (!why2) {
          beltAdd(state.belt, id, 1);
          if (e.draws !== undefined) e.draws--;
          hud.addLog(
            `You draw ${SPELL_BY_ID[id]?.name ?? id} into your belt.`,
            SPELL_BY_ID[id]?.colour,
          );
          // Rolled up, the player cannot see where it went — so it unrolls for a beat.
          hud.beltFlashUntil = performance.now() + 1400;
          if (e.draws === 0) {
            hud.addLog(`The ${displayName(e.spriteId).toLowerCase()} is spent.`, 0x9aa3ad);
          }
          return true;
        }
        speakRefusal(beltRefuse(state.belt, why2));
        sfx.deny();
        return false;
      }
      // Its own line rather than the tear's, because "put the page back" is the wrong
      // instruction for a card that is not one — through the same say-it-once guard,
      // because at a hand of one this is refused constantly.
      speakRefusal('Your hand is full. Cast it, or put it back.');
      sfx.deny();
      return false;
    }
    addHarvestCard(id);
    /**
     * The draw is spent HERE, after every refusal above has had its chance — so a
     * harvest that did not happen never costs the fixture anything.
     */
    if (e.draws !== undefined) e.draws--;
    hud.addLog(
      `You draw ${SPELL_BY_ID[id]?.name ?? id} out of the ${displayName(e.spriteId).toLowerCase()}.`,
      SPELL_BY_ID[id]?.colour,
    );
    /**
     * AND IT SAYS SO WHEN IT GOES OUT, once, on the draw that emptied it.
     *
     * The world is where this should read — a snuffed candelabra, a barrel with its
     * lid off — and that art does not exist yet. A line is the honest placeholder:
     * it is said at the exact moment the fixture changes state, so when the sprite
     * swap lands it replaces the line rather than being added beside it.
     */
    if (e.draws === 0) {
      hud.addLog(`The ${displayName(e.spriteId).toLowerCase()} is spent.`, 0x9aa3ad);
    }
    // What is in the hand decides what is targetable, exactly as after a tear.
    refreshTargets();
    return true;
  };

  /**
   * Put a harvested element in the hand as a card.
   *
   * The `Fan` holds pages torn out of the book and a harvest has no page, so it is
   * handed a page-SHAPED card instead (`spells/harvestCards.ts`) — the cheapest route
   * that leaves `src/book/` verbatim. The two uniforms are what make it read as
   * borrowed rather than owned: gold is the book's colour, on every page edge and in
   * every merge glow, so a card from the room wears the element's instead.
   */
  const addHarvestCard = (id: string, locked = false): void => {
    const card = harvestCard(id);
    if (!card) return;
    // A torn page flies from wherever the page was. This rises into the hand from
    // below the fan, which from inside the book's camera is where the room is.
    fan.add(card, new THREE.Vector3(0, -0.16, -0.34), new THREE.Quaternion(), locked);
    const p = fan.pages[fan.pages.length - 1];
    if (!p) return;
    const col = harvestColour(id);
    p.mat.uniforms.uGold.value.setHex(col);
    (p.glow.material as THREE.ShaderMaterial).uniforms.uColor.value.setHex(col);
  };

  /**
   * STANDING IN IT ARMS YOU.
   *
   * Once per round, the substance under the player's feet fills a hand slot with its
   * element — and the tile burns down faster for it. The card is LOCKED: it cannot be
   * stowed or put back, and the only ways to be rid of it are to cast it or to step
   * off the tile.
   *
   * This is the pillar stated one step further. The room is already a pouch you reach
   * into; this says the floor you are standing on is already in your hand, and it
   * charges what standing in a substance charges — burning ground hurts, ice is slick,
   * oil is waiting for a spark. It also pays for itself: a patch that arms you drains
   * faster, so the strong position is temporary by construction and nobody can camp a
   * bonfire and farm it.
   *
   * IT NEVER TAKES THE LAST FREE SLOT. At a hand of one — where a new save lives for
   * three floors — a locked card would BE the whole hand, and the book would be
   * unreachable while the player's feet were wet. The mechanic switches itself on with
   * `hand2` instead, arriving as a reward at the moment there are slots to spare, which
   * is the same job the belt's unlock does.
   */
  const standingArms = (): void => {
    if (dead || loading || busy) return;
    const cap = handSize();
    // The last free slot is never taken: at a hand of one this is the whole feature
    // being off, which is deliberate.
    if (cap < 2 || fan.count >= cap - 1) return;
    const g = floor.grid;
    const i = g.idx(stepper.x, stepper.y);
    const what = floor.ground.at(i);
    if (!what) return;
    const id = SUBSTANCE_COMPONENT[what];
    if (!id) return;
    addHarvestCard(id, true);
    hud.tornIds = fan.gameIds;
    hud.addLog(
      `The ${what} under you fills your hand.`, SPELL_BY_ID[id]?.colour ?? 0xffcf5c,
    );
    /**
     * And the tile pays for it. Doubling the drain is what stops a big patch being a
     * supply: whatever it would have lasted, standing in it halves.
     */
    floor.ground.drain(i, GROUND_ARM_DRAIN);
    combat.syncGround();
    refreshTargets();
  };

  // -------------------------------------------------------------------- the belt

  /**
   * How many of this ingredient could still be drawn.
   *
   * The belt is not decremented when a vial is taken OUT, because consumption
   * happens on the cast and a hand can always be put back (`Roadmap/Ingredient_Belt.md`).
   * So "what is left to draw" is the stack minus what is already in the hand, and
   * this is the subtraction that stops two draws from spending one vial.
   */
  const beltAvailable = (id: string): number =>
    beltHeld(state.belt, id) - fan.gameIds.filter((h) => h === id).length;

  /**
   * Put an ingredient in the hand as a card.
   *
   * The same route a harvest takes (`addHarvestCard`) for the same reason — the fan
   * holds page-shaped things and `src/book/` is not to be restructured — with the
   * belt's own card art (`spells/ingredientCards.ts`) and its own halo colour, so a
   * hand holding a page, a harvest and a vial reads as three different objects.
   */
  const addIngredientCard = (id: string): void => {
    const card = ingredientCard(id);
    if (!card) return;
    // Rises from BELOW the fan and a little to the side of where a harvest comes
    // from: the belt is a separate object under the grimoire, not a page of it.
    fan.add(card, new THREE.Vector3(0.06, -0.19, -0.34), new THREE.Quaternion());
    const p = fan.pages[fan.pages.length - 1];
    if (!p) return;
    const col = ingredientColour(id);
    p.mat.uniforms.uGold.value.setHex(col);
    (p.glow.material as THREE.ShaderMaterial).uniforms.uColor.value.setHex(col);
  };

  /**
   * Draw one off the belt — a single tap, where the book is flip-and-tear.
   *
   * Priced exactly like a tear and a harvest, through the same gate: one hand slot
   * and nothing else. TimeSand used to be the exception here — it zeroed the turn
   * cost of the next two components — and under cast = 1 turn there is no component
   * turn left for it to zero, so there is no exception and no special case. See its
   * entry in `spells.ts`: the ingredient is inert and says so.
   *
   * Nothing is removed from the belt. That is the settled rule and it is what makes
   * returning a hand free: the stack is only spent when the cast actually goes off
   * (`consumeIngredients`).
   */
  const takeIngredient = (id: string): boolean => {
    /**
     * Flagged off: nothing comes off the belt into the hand.
     *
     * SILENT, unlike every other refusal in here. The others speak because there is a
     * strap on screen to pulse and a rule the player can act on; with the strip gone
     * this is only reachable through the debug surface, and a caption about a belt the
     * player cannot see would be the game explaining a control it never offered.
     */
    if (!BELT_ENABLED) return false;
    // Harvested substances live in pouches now too, so the guard is "can a pouch
    // hold it" rather than "is it an ingredient".
    if (!canTakeComponent() || !pouchable(id)) return false;
    const name = SPELL_BY_ID[id]?.name ?? id;
    /**
     * A locked strap says so out loud, and records the moment so the strip can pulse
     * for it — `docs/DESIGN.md` renders the belt while locked precisely so the
     * capability advertises itself, and being told why is the other half of that.
     */
    if (state.belt.capacity <= 0) {
      speakRefusal(beltRefuse(state.belt, BELT_LOCKED));
      sfx.deny();
      return false;
    }
    if (beltAvailable(id) <= 0) {
      // Distinguishes "you have none" from "the ones you have are already in your
      // hand", because the second is fixed by casting and the first is not.
      speakRefusal(beltRefuse(state.belt, beltHeld(state.belt, id) > 0
        ? `Your last ${name} is already in your hand.`
        : `You have no ${name}.`));
      sfx.deny();
      return false;
    }
    if (fan.count >= handSize()) {
      speakRefusal('Your hand is full. Cast it, or put it back.');
      sfx.deny();
      return false;
    }
    /**
     * An ingredient arrives on a vial card and a harvested substance on a harvest card
     * — the two read as different objects in the hand, and the belt now holds both, so
     * which card is drawn follows what the thing IS rather than where it came from.
     */
    if (isIngredient(id)) addIngredientCard(id);
    else addHarvestCard(id);
    hud.addLog(`You draw ${name} off your belt.`, SPELL_BY_ID[id]?.colour);
    // What is in the hand decides what is targetable — and for an animating
    // ingredient it decides it completely.
    refreshTargets();
    return true;
  };

  /**
   * STOW WHAT IS IN YOUR HAND, into the belt.
   *
   * The reverse of `takeIngredient` and the other half of the swipe pair: a page comes
   * up out of the book into the hand, and a component carries on up, out of the hand
   * into a pouch.
   *
   * NOTHING IS DESTROYED HERE. If no pouch can take it the component stays in the
   * hand and the belt says why — the cheap implementation is the destructive one, and
   * a player who loses the starlight they walked three rooms for to an automatic
   * discard has been robbed by a convenience. Dropping is a separate, deliberate,
   * turn-costing verb (`dropFromPouch`).
   */
  const stowComponent = (index: number): boolean => {
    if (!BELT_ENABLED) return false;
    const card = fan.gameIds[index];
    if (!card) return false;
    /**
     * A card the FLOOR gave you does not come off your hand. Cast it, or step off the
     * tile — see `standingArms`. Said out loud rather than silently ignored, because a
     * tap that does nothing reads as a tap the game missed.
     */
    if (fan.isLocked(index)) {
      speakRefusal('The floor is filling your hand. Cast it, or step away.');
      return false;
    }
    if (!pouchable(card)) {
      speakRefusal('A pouch will not hold a page.');
      return false;
    }
    const why = beltRefusalFor(state.belt, card);
    if (why) { speakRefusal(beltRefuse(state.belt, why)); sfx.deny(); return false; }
    // The card leaves the hand only once the belt has accepted it, so a refusal in
    // `beltAdd` can never lose the component between the two containers.
    if (beltAdd(state.belt, card, 1)) return false;
    fan.removeAt(index);
    hud.tornIds = fan.gameIds;
    hud.addLog(`You stow ${SPELL_BY_ID[card]?.name ?? card}.`, SPELL_BY_ID[card]?.colour);
    refreshTargets();
    return true;
  };

  /**
   * Empty some of a pouch onto the tile the player is standing on.
   *
   * The only destructive verb on the belt, and it pays a turn for it: what it leaves
   * is GROUND, and nothing that changes the floor is ever free. How much you drop is
   * how much terrain you get, which is what makes the panel's amount a decision rather
   * than a chore.
   */
  const dropFromPouch = async (index: number, n: number): Promise<void> => {
    const slot = state.belt.slots[index];
    if (!slot || busy || loading) return;
    const id = slot.id;
    const took = beltDrop(state.belt, index, n);
    if (!took) return;
    const name = SPELL_BY_ID[id]?.name ?? id;
    hud.beltPanel = null;
    hud.beltDropAmount = 0;
    /**
     * Poured as the substance the component IS — `SUBSTANCE_OF` is the same lookup the
     * cast path uses, so a dropped flame lights a tile by exactly the rule a cast
     * would. Anything with no ground form (the clay, when it lands) leaves nothing but
     * the log line, which is the game saying out loud that it was the precious thing.
     */
    const what = substanceOf(id);
    if (what) {
      const i = floor.grid.idx(stepper.x, stepper.y);
      floor.ground.pour([{ i, d: 0 }], what, POUR_TURNS_PER_UNIT * took);
      combat.syncGround();
      hud.addLog(`You empty ${took} ${name} onto the floor.`, SPELL_BY_ID[id]?.colour);
    } else {
      hud.addLog(`You tip ${took} ${name} out. It is wasted.`, 0x9aa3ad);
    }
    // A turn, once, whatever the amount: the floor changed.
    busy = true;
    try { await combat.playerActed(); } finally { busy = false; }
    refreshTargets();
  };

  /**
   * Put one on the belt. The single grant path: chests, bosses and altars all land
   * here, so the refusal, the log line and the pulse are written once.
   */
  const grantIngredient = (id: string): boolean => {
    /**
     * Flagged off: no source pays an ingredient. The three callers skip their rolls
     * outright, so this is the backstop that also covers the debug grant — and it
     * returns before `beltAdd`, because the locked-strap refusal it would otherwise
     * record explains a strip that is not on screen.
     */
    if (!BELT_ENABLED) return false;
    const name = SPELL_BY_ID[id]?.name ?? id;
    const why = beltAdd(state.belt, id);
    if (why) {
      /**
       * Through the say-it-once guard, and WITHOUT the ingredient's name in front of
       * it, so a chest that pays three onto a locked belt says the reason once rather
       * than three times in three different names — which would bury the chest's own
       * line in a log that holds four. The full-belt refusal already names what it
       * turned away, because there the name is the actionable half.
       */
      speakRefusal(why);
      return false;
    }
    const n = beltHeld(state.belt, id);
    hud.addLog(`${name} goes on your belt${n > 1 ? ` — ${n} now` : ''}.`,
      SPELL_BY_ID[id]?.colour);
    return true;
  };

  /**
   * Spend the ingredients a cast just used.
   *
   * Called only after `combat.cast` has reported that the spell went off, which is
   * the one place a vial may be destroyed: a refused cast consumes nothing, and a
   * returned hand consumes nothing, because neither reaches here. One call per CARD
   * rather than per distinct id, so a hand of two Growth spends two.
   */
  const consumeIngredients = (ids: string[]): void => {
    for (const id of ids) if (isIngredient(id)) beltConsume(state.belt, id);
  };

  /**
   * Put the whole hand back. Free, and it consumes nothing.
   *
   * One helper rather than three copies of `fan.clear(); refreshTargets()`, so that
   * every route out of a loaded hand ends in the same two facts: nothing is spent
   * and what is targetable is recomputed. There is no bill to clear any more — a
   * hand costs nothing to assemble, so putting it back cannot owe anything.
   */
  const returnHand = (keepLocked = true): void => {
    // The player's own CLEAR keeps what the floor gave them; only a floor change takes
    // everything, because the tile that was arming them is not on the next floor.
    fan.clear(keepLocked);
    refreshTargets();
  };

  /**
   * Put ONE component back — the tap on its card in the fan.
   *
   * Free, and now free in the strongest sense the game can offer: taking the
   * component cost nothing either, so a draw-and-cancel loop is exactly a no-op. That
   * is the whole point of the rebase — under the old rule the draw bought the room a
   * round and the cancel bought nothing back, so leafing indecisively through the book
   * could kill you.
   *
   * Where the component goes is the only thing that differs by source, and all three
   * answers were already settled by something else:
   *  - a PAGE goes back into the book, and there is nothing to do for it: the book
   *    regrows the page the instant it tears one (`Book.tear` sets `uReveal`/`regrowT`),
   *    so the fan was the only thing still holding it.
   *  - an INGREDIENT goes back on the belt, and there is nothing to do for that either:
   *    the belt is never decremented when a vial is drawn, only when a cast goes off
   *    (`consumeIngredients`), so the count restores itself the moment the card leaves
   *    the hand — `beltAvailable` and the pouch badge both subtract what the hand holds.
   *  - a HARVESTED element is DISCARDED. Fixtures are non-storable and `docs/DESIGN.md`
   *    rejects banking one outright, so there is nowhere to put it; the candelabra is
   *    still lit, and the way to get it back is to be standing at it and take it again.
   */
  const returnComponent = (index: number): boolean => {
    if (dead || fan.busy) return false;
    // The floor's own card cannot be put back — the tile is holding your hand open.
    if (fan.isLocked(index)) {
      speakRefusal('The floor is filling your hand. Cast it, or step away.');
      return false;
    }
    const id = fan.gameIds[index];
    const spell = fan.removeAt(index);
    if (!spell) return false;
    const def = SPELL_BY_ID[id];
    const name = def?.name ?? spell.name;
    if (def?.source === 'belt') {
      hud.addLog(`${name} goes back in its pouch.`, def.colour);
    } else if (def?.source === 'fixture') {
      hud.addLog(`The ${name} slips away — harvest it again when you need it.`, def.colour);
    } else {
      hud.addLog(`${name} goes back into the book.`, def?.colour);
    }
    sfx.pageFlip();
    // Same follow-up as `returnHand`: what the hand holds decides what is targetable,
    // and for an animating ingredient it decides it completely.
    refreshTargets();
    return true;
  };

  const cardPos = new THREE.Vector3();

  /**
   * Where each card of the fan is on screen, in fan order.
   *
   * The fan is 3D geometry parented to the BOOK's camera, not a HUD rect, so the only
   * honest answer is to project it — the same trick `Sprite.screenBox` uses for a
   * creature: project the centre, project a point one half-height above it, and read
   * the pixel scale off the difference. Both the centre and the size come off the LIVE
   * transform (the mesh is offset by `-PAGE_W/2`, so the group's origin is the card's
   * centre, and the group's scale is the fan's shrink), which is what keeps the box on
   * a card that is still flying in or hovering.
   */
  const handCardBoxes = (): HandCard[] => {
    const out: HandCard[] = [];
    const mid = { x: 0, y: 0 }, top = { x: 0, y: 0 };
    for (let i = 0; i < fan.pages.length; i++) {
      const g = fan.pages[i].group;
      g.getWorldPosition(cardPos);
      if (!projectToScreen(cardPos.x, cardPos.y, cardPos.z, mid)) continue;
      if (!projectToScreen(cardPos.x, cardPos.y + PAGE_H * 0.5 * g.scale.y, cardPos.z, top)) continue;
      const h = Math.abs(mid.y - top.y) * 2;
      const w = h * (PAGE_W / PAGE_H);
      out.push({ index: i, x: mid.x - w / 2, y: mid.y - h / 2, w, h, rot: g.rotation.z });
    }
    return out;
  };

  /**
   * The slots the hand has NOT filled, in screen space.
   *
   * Projected from `fan.ghost`, which is `fan.landed` — the very function `update`
   * drives the real cards through. An outline is a slot in its empty state.
   *
   * It used to read `fan.slot`, which is only the RESTING place. A landed card then
   * picks up a hover bob, a hover roll and a fixed pitch in `update`, and an outline
   * picked up none of them: measured side by side and fully settled, the card sat at
   * rot 0.116 where its outline said 0.090, five pixels lower and two pixels shorter.
   * Close enough to look like a bug and not close enough to be one you could name.
   */
  const emptySlotBoxes = (): HandCard[] => {
    const cap = Math.max(handSize(), 1);
    const out: HandCard[] = [];
    const mid = { x: 0, y: 0 }, top = { x: 0, y: 0 };
    for (let i = fan.pages.length; i < cap; i++) {
      // The fan's own slot transform and its own settled scale, so neither where a
      // card lands nor how big it ends up is duplicated here. The position is
      // camera-local, which is the space `projectToScreen` already takes for the
      // real cards — converting it to world first produced points that would not
      // project at all.
      const s = fan.ghost(i, engine.time);
      if (!projectToScreen(s.pos.x, s.pos.y, s.pos.z, mid)) continue;
      if (!projectToScreen(s.pos.x, s.pos.y + PAGE_H * 0.5 * s.scale, s.pos.z, top)) continue;
      const h = Math.abs(mid.y - top.y) * 2;
      const w = h * (PAGE_W / PAGE_H);
      out.push({ index: i, x: mid.x - w / 2, y: mid.y - h / 2, w, h, rot: s.rotZ });
    }
    return out;
  };

  // The ported book throws its own sparkles and shakes; route them at the game.
  // The book works in hand-scale units (~0.4m from the eye); CastFx works in
  // dungeon scale, so these are scaled up to stay visible.
  sinks.sparkle = (pos, count, spread) => fx.burst(pos, 0xffc23e, 0.25 + count * 0.02 + spread);
  sinks.flash = (pos, colour, size) => fx.burst(pos, colour, 0.3 + size * 6);
  sinks.ring = (pos, colour, size) => fx.burst(pos, colour, 0.4 + size * 5);
  sinks.shake = (a) => { fx.shake = Math.min(1.4, fx.shake + a * 2.6); };
  sinks.hitstop = (d) => { fx.hitstop = Math.max(fx.hitstop, d); };

  const eye = new THREE.Vector3();
  /**
   * THE CUTSCENE. A real one: the camera leaves the player and goes to look.
   *
   * The first version only turned the player's own head and snapped it back, which is
   * why nobody ever saw the door open — the eye stayed in a corridor with a wall in
   * the way and the whole thing was over before it registered. A cut has to be able to
   * show you something you are not standing near, which means the camera has to LEAVE,
   * and if it leaves then the player must not be able to walk about underneath it.
   *
   * Three phases and they are the three a cut needs: fly out, HOLD on the subject, fly
   * home. The hold is the part that was missing and it is the part that does the work.
   * Input is refused for the whole of it — `cineLock` is read by `canAct` and by the
   * tap handler — so it cannot be interrupted and nothing can move while it plays.
   */
  /**
   * ONE TRANSITION, PLAYED FORWARD AND THEN PLAYED BACKWARDS.
   *
   * The trip out and the trip home used to be different lengths with different
   * shapes, which is why the return never read as a return — it was a second,
   * shorter move that happened to end where the first one started. Reversing the
   * same transition is what makes the shot a round trip: whatever the eye did on the
   * way out, it undoes, at the same rate, in the same time.
   *
   * `ease` is symmetric about its midpoint, so `1 - ease(t/T)` IS `ease((T-t)/T)` —
   * the position curve is already a true reverse and needs nothing done to it.
   */
  const CINE_MOVE = 1.15;
  /**
   * How long the flight takes, given how far it has to walk.
   *
   * `CINE_MOVE` was written for a straight hop of two or three tiles. The route is
   * pathfound now and the measured median is FOURTEEN tiles with a tail out to
   * fifty-six, and fourteen tiles in 1.15s is a corridor going past too fast to read —
   * which defeats the entire reason for following the route, that the player is
   * supposed to learn the way from it.
   *
   * So it is per-tile with a floor and a ceiling. The floor keeps a short hop feeling
   * like the snap it always was; the ceiling stops a fifty-tile route becoming a
   * sightseeing tour nobody asked for, and a long way round is then simply travelled
   * faster than a short one, which is the right compromise when the alternative is a
   * shot that outstays its welcome.
   */
  const cineMoveFor = (tiles: number): number =>
    Math.max(CINE_MOVE, Math.min(CINE_MOVE * 2.6, 0.16 * tiles + 0.5));
  /**
   * HOW LONG THE LOOK TAKES, which is NOT how long the move takes.
   *
   * Turning across the whole flight is the same mistake as not turning at all, one
   * step further on. The eye ends up rotating a degree or two per frame for a second
   * and a bit, which is slow enough that at no point does it read as a turn — it
   * reads as the world drifting, and you still arrive without having been told which
   * way you went.
   *
   * A turn is a thing you do and then stop doing. Going out it comes FIRST: the look
   * swings over the front of the move and is finished well before the eye is, so the
   * rest of the flight happens under a camera already pointed at the subject. Long
   * enough to be watched — 0.45s for a right angle is a head turn, not a cut.
   *
   * Coming home it is the same turn in reverse, which puts it LAST. The eye holds on
   * the subject while it travels and only turns over the tail of the slide, so the
   * door stays in frame until you are nearly back and the corridor arrives exactly as
   * control does. Turning first on the way back would mean the last thing you see of
   * the thing you were sent to watch is the moment you stop watching it.
   */
  const CINE_LOOK = 0.45;
  /**
   * THE BEAT. The camera arrives and then NOTHING HAPPENS for most of a second.
   *
   * This is the whole difference between a cut that shows you a door and a cut that
   * shows you a door opening. The first version fired the door on the same frame the
   * camera stopped, so the eye was still travelling when the gate moved: you never saw
   * the shut door, so you never saw it open — you saw one arrival, and afterwards
   * there was a hole. A held frame with nothing in it is not dead time, it is the
   * establishing shot, and it is the only reason the next three seconds mean anything.
   */
  const CINE_BEAT = 0.8;
  /**
   * How long the gate takes to grind out of the way. Slow on purpose: a portcullis is
   * a ton of iron on a winch, and the one thing it must never look like is a toggle.
   */
  const CINE_OPEN = 2.6;
  /** The pause after it lands, before the player is offered the way out of the cut. */
  const CINE_SETTLE = 0.45;
  /**
   * The cut, as an explicit state machine rather than one countdown.
   *
   * The countdown version was unwatchable and, worse, untestable: it was over in about
   * a second whatever happened, so there was no moment you could stop and check that
   * the camera had gone anywhere at all. It now HOLDS on the subject until the player
   * taps, which is both the better cut — you look at the thing for as long as you want
   * to — and the thing that makes it possible to confirm it works.
   */
  type CinePhase = 'out' | 'beat' | 'open' | 'hold' | 'back';
  /**
   * `onArrive` fires the instant the camera stops, not when the cut is triggered.
   *
   * Which is the difference between showing a door open and showing an open door. The
   * gate used to swing the moment the lever was thrown — twenty tiles away, off
   * screen — so by the time the camera got there the only thing to see was a hole
   * somebody had already made.
   */
  let cine:
    | { phase: CinePhase; t: number; onArrive?: () => void; onOpen?: (k: number) => void }
    | null = null;
  const cineAt = new THREE.Vector3();
  const cineEye = new THREE.Vector3();
  const cineFrom = new THREE.Vector3();
  /**
   * WHERE THE PLAYER WAS LOOKING when the cut started, and where it is looking now.
   *
   * The eye's POSITION was interpolated and its ORIENTATION was not: `lookAt` was
   * applied at full strength from the first frame, so the camera snapped to face the
   * door and then slid toward it. Which threw away the one thing the cut is for —
   * knowing WHICH WAY the thing that just moved is. A swing tells you it is off to
   * your left; a cut to it tells you only that it exists. The same pop happened in
   * reverse at the end, with the eye sliding home while still facing the door and
   * then snapping back to the corridor.
   *
   * Slerped on the same eased `k` the position uses, so the look leaves and returns
   * with the move rather than beside it.
   */
  /**
   * The flight, as world points: the eye, the tiles it walks, the vantage.
   *
   * One array for both directions — `cineWalk` reads it forwards on the way out and
   * backwards on the way home, so the return can never disagree with the departure.
   */
  const cinePath: THREE.Vector3[] = [];
  /** This flight's duration, from `cineMoveFor`. The return reuses it, so it is symmetric. */
  let cineMove = CINE_MOVE;
  const cineFromQ = new THREE.Quaternion();
  const cineToQ = new THREE.Quaternion();
  /**
   * Look at what you just opened.
   *
   * Only ever called when the player threw the last lever, so the cut is always a
   * consequence of an action and never a thing the camera decided. If the door is
   * behind a wall the player still gets the turn and the sound of it — knowing WHICH
   * WAY the thing that opened is is most of what the cut is for.
   */
  const cutToward = (
    tx: number,
    ty: number,
    onArrive?: () => void,
    onOpen?: (k: number) => void,
  ): void => {
    cineAt.set(tx, 0.5, ty);
    /**
     * The vantage is computed ONCE, here, not per frame.
     *
     * Recomputing it every frame off a `from` that was itself being re-copied was the
     * bug that made the whole thing look like nothing happened: the target kept
     * sliding as the camera approached it, so the interpolation chased its own tail
     * and the eye barely left the player.
     */
    cineFrom.copy(engine.camera.position);
    // The player's own facing, captured before anything moves. They cannot turn
    // during a cut, so this is still true when the shot swings back onto it.
    cineFromQ.copy(engine.camera.quaternion);
    const dx = cineFrom.x - cineAt.x, dz = cineFrom.z - cineAt.z;
    const len = Math.max(0.001, Math.hypot(dx, dz));

    /**
     * STAND IN FRONT OF IT AND LOOK AT IT. That is the whole rule now.
     *
     * Three cleverer versions of this put the eye in a wall. A fixed offset along the
     * line to the player sat inside the masonry beside the chokepoint. An angle search
     * placed the eye at an arbitrary float point, and a float point whose tile is open
     * can be a hand's width from a wall face. A scored tile search fixed the masonry and
     * then filmed the shot from whatever oblique corner scored best — which is how a
     * barrel, and then a wall, ended up filling the frame anyway.
     *
     * Every one of those was solving a harder problem than the shot needs. A portcullis
     * hangs in a chokepoint; a chokepoint has exactly one way in from the player's side;
     * that approach tile is, by construction, open, in the corridor, and looking straight
     * down the axis at the gate. There is nothing to choose. Back off along that same
     * axis while the corridor allows it, and the camera is in the passage the player
     * walked, pointing at the thing that is about to move.
     *
     * No scoring, no fan of candidate angles, and therefore no oblique shot to go wrong.
     */
    const g0 = floor.grid;
    const sx = Math.round(cineAt.x), sz = Math.round(cineAt.z);

    /**
     * Which side of the gate the player is on, by path distance with the gate itself
     * held shut — the neighbour they could actually walk to. Asked rather than assumed,
     * because a threshold's two open neighbours are otherwise indistinguishable and
     * guessing puts the camera inside the boss room half the time.
     */
    const away = g0.flood(stepper.x, stepper.y, g0.w * g0.h,
      (qx, qy) => g0.walkable(qx, qy) && !(qx === sx && qy === sz));
    /**
     * AND THE SHOT IS TAKEN ON THE GATE'S OWN AXIS, square to the bars.
     *
     * The vantage is the neighbour on the player's side, and in a one-wide corridor both
     * of a door's open neighbours lie along the passage — so this came out flat-on by
     * luck of the geometry rather than by rule. Where the geometry did not cooperate the
     * nearest reachable neighbour could be a tile beside the threshold, and the camera
     * filmed the portcullis edge-on: a bar's width of moving metal, with the room behind
     * it filling the frame. A gate is a flat thing that rises, so the one shot that shows
     * the mechanism is the one square to its face.
     *
     * The axis is read the same way the DRAWN orientation is (`gateAcross`), because the
     * camera and the bars disagreeing is exactly how a shot ends up looking along the
     * plane of the thing it is pointing at. Restricted to that axis and then decided by
     * reachability, so of the two ends of the passage the shot still comes from the side
     * the player is standing on.
     */
    const axisX = (() => {
      const w = g0.walkable(sx - 1, sz), e = g0.walkable(sx + 1, sz);
      const n = g0.walkable(sx, sz - 1), so = g0.walkable(sx, sz + 1);
      if (w && e && !n && !so) return true;
      if (n && so && !w && !e) return false;
      return null;                       // not a straight passage: take any side
    })();
    let ax = 0, az = 0, bestD = Infinity;
    for (const [ddx, ddz] of DIR_VEC) {
      // Off-axis tiles are not candidates at all — a side-on shot is worse than a
      // slightly worse-placed square one.
      if (axisX === true && ddx === 0) continue;
      if (axisX === false && ddz === 0) continue;
      const nx = sx + ddx, nz = sz + ddz;
      if (!g0.inside(nx, nz) || !g0.walkable(nx, nz)) continue;
      const d = away[g0.idx(nx, nz)];
      if (d < 0 || d >= bestD) continue;
      bestD = d; ax = ddx; az = ddz;
    }
    // No reachable side at all — keep the old offset rather than film from nowhere.
    let vx = cineAt.x + (dx / len) * 2.0, vz = cineAt.z + (dz / len) * 2.0;
    if (bestD < Infinity) {
      vx = sx + ax; vz = sz + az;
      // One more step back if the corridor keeps going and nothing is standing in it, so
      // the gate is framed rather than pressed against the lens.
      const fx2 = sx + ax * 2, fz2 = sz + az * 2;
      if (g0.inside(fx2, fz2) && g0.walkable(fx2, fz2) && !floor.solidAt(fx2, fz2)) {
        vx = fx2; vz = fz2;
      }
    }
    /**
     * Nearly level with the gate rather than looking down on it.
     *
     * The old 1.3 lift was for a shot from across a room. From two tiles down a corridor
     * it tips the frame into the floor and puts the top of the portcullis — the part that
     * MOVES — at the very edge of the picture. A portcullis rises, so the camera wants to
     * be looking at the middle of it.
     */
    cineEye.set(vx, cineAt.y + 0.75, vz);
    /**
     * UNDER THE CEILING, always. The vantage lifts to look down at the subject and
     * the lift was unbounded, so in any room with a normal roof the camera rose
     * straight through it and filmed the scene from inside the masonry.
     */
    let hi = 0;
    for (let j = -3; j <= 3; j++) {
      for (let i = -3; i <= 3; i++) {
        const nx = Math.round(cineAt.x) + i, ny = Math.round(cineAt.z) + j;
        if (g0.inside(nx, ny)) hi = Math.max(hi, g0.height[g0.idx(nx, ny)]);
      }
    }
    cineEye.y = Math.min(cineEye.y, hi * STEP_H + WALL_H - 0.18);

    /**
     * THE FLIGHT IS A WALK, along tiles the player could actually take.
     *
     * It was a straight line from the eye to the vantage, which in a dungeon means
     * through however much masonry lies between — the camera left the room through a
     * wall, crossed the stone, and arrived. Fixing where it LANDS did nothing about the
     * journey, and the journey is most of what the player sees.
     *
     * So the path is pathfound, on the same terms the player's feet get: `walkable`, and
     * nothing solid standing on it. That buys two things at once. The camera cannot clip
     * anything on the way, and the shot now SHOWS THE ROUTE — it leaves down the corridor
     * you have to walk, turns the corners you have to turn, and arrives at the gate. The
     * cut stopped being "here is a door somewhere" and became "here is the way".
     *
     * Flooded from the VANTAGE so the descent from the player's tile is a shortest path,
     * and the same polyline is walked backwards on the return, so the way home is the way
     * out in reverse rather than a second guess at it.
     */
    cinePath.length = 0;
    cinePath.push(cineFrom.clone());
    /**
     * FURNITURE-FREE FIRST, WALLS-ONLY SECOND, straight line last.
     *
     * A route that dodges the barrels is the one to want, but it can genuinely not
     * exist — a corridor with a chest in it has no furniture-free path through, and
     * falling straight back to a line through the masonry throws away the corridor as
     * well as the barrel. Walls-only still follows the passages the player walks; it just
     * clips a cask on the way, which is a far smaller lie than crossing a wall.
     *
     * The player's own tile is admitted whatever it says, because they are standing on it.
     */
    const here = g0.idx(stepper.x, stepper.y);
    const passClear = (px: number, py: number): boolean =>
      g0.idx(px, py) === here || (g0.walkable(px, py) && !floor.solidAt(px, py));
    const passWalls = (px: number, py: number): boolean =>
      g0.idx(px, py) === here || g0.walkable(px, py);
    let dmap = g0.flood(vx, vz, g0.w * g0.h, passClear);
    if (!g0.inside(stepper.x, stepper.y) || dmap[here] < 0) {
      dmap = g0.flood(vx, vz, g0.w * g0.h, passWalls);
    }
    let cx = stepper.x, cy = stepper.y;
    if (g0.inside(cx, cy) && dmap[g0.idx(cx, cy)] >= 0) {
      // Downhill on the distance field, one tile at a time. Guarded because a malformed
      // field would otherwise spin here, and a hang inside a cutscene is unrecoverable.
      for (let guard = 0; (cx !== vx || cy !== vz) && guard < 400; guard++) {
        let bd = dmap[g0.idx(cx, cy)];
        let nx = -1, ny = -1;
        for (const [ddx, ddy] of DIR_VEC) {
          const ax = cx + ddx, ay = cy + ddy;
          if (!g0.inside(ax, ay)) continue;
          const d = dmap[g0.idx(ax, ay)];
          if (d < 0 || d >= bd) continue;
          bd = d; nx = ax; ny = ay;
        }
        if (nx < 0) break;
        cx = nx; cy = ny;
        cinePath.push(new THREE.Vector3(cx, 0, cy));
      }
    }
    // The last tile IS the vantage, so it becomes the vantage rather than a point beside
    // it — otherwise the flight ends on a needless vertical hop.
    if (cinePath.length > 1) cinePath.pop();
    cinePath.push(cineEye.clone());
    /**
     * Height is spread along the whole flight rather than taken at the end: the eye
     * rises out of the player's head and settles into the vantage's lift as it travels,
     * which is what makes it read as a camera lifting away rather than a camera being
     * teleported upward at the door.
     */
    const total = cinePath.length - 1;
    for (let j = 1; j < total; j++) {
      cinePath[j].y = cineFrom.y + (cineEye.y - cineFrom.y) * (j / total);
    }

    cineMove = cineMoveFor(Math.max(0, cinePath.length - 2));
    cine = { phase: 'out', t: 0, onArrive, onOpen };
    hud.cinema = true;
    hud.cinePrompt = null;
  };

  /**
   * Where the camera is, a fraction `k` of the way along the flight.
   *
   * By ARC LENGTH and not by index, so the eye moves at one speed whatever shape the
   * route is: paced per-segment, a flight round four short corners would crawl and a
   * long straight run would sprint. `k` runs backwards on the return and needs no
   * special case, which is the point of keeping one polyline for both directions.
   */
  const cineWalk = (k: number, out: THREE.Vector3): void => {
    if (cinePath.length < 2) { out.copy(cineEye); return; }
    let span = 0;
    for (let j = 1; j < cinePath.length; j++) span += cinePath[j].distanceTo(cinePath[j - 1]);
    if (span <= 1e-6) { out.copy(cinePath[cinePath.length - 1]); return; }
    let want = Math.max(0, Math.min(1, k)) * span;
    for (let j = 1; j < cinePath.length; j++) {
      const seg = cinePath[j].distanceTo(cinePath[j - 1]);
      if (want <= seg || j === cinePath.length - 1) {
        out.lerpVectors(cinePath[j - 1], cinePath[j], seg > 1e-6 ? want / seg : 1);
        return;
      }
      want -= seg;
    }
  };
  /** End the hold. Any tap does this while the cut is parked on its subject. */
  const cineRelease = (): boolean => {
    if (!cine || cine.phase !== 'hold') return false;
    cine = { phase: 'back', t: 0 };
    return true;
  };
  /**
   * THE FALL. Not an event — a second and a half of it.
   *
   * It was a `setTimeout`: drop the eye to -2.6 in one frame, wait 700ms, put it back
   * and show the death card. Three things wrong with that, and the third is the one
   * that matters. The drop was instant, so there was no fall, only a cut to a lower
   * camera. It faded to nothing, so the moment you died was the moment a card
   * appeared. And it PUT THE CAMERA BACK, which meant the death screen opened with
   * the eye rising out of the hole it had just fallen into — the game undoing the
   * thing it had just done, in front of the player, on the screen that says it is
   * over.
   *
   * So: a real drop, accelerating, with the light going out of the room on the way
   * down. Where the camera stops is where it stays.
   */
  const PLUNGE_T = 1.5;
  let plunge: { t: number; from: number } | null = null;

  /** Set by the boot sequence once `enterFloor` exists. See the showroom binding. */
  let showroom: () => Promise<void> = async () => {};
  /** Set by the boot sequence once the floor and combat exist. */
  let throwLever: (e: Entity) => void = () => {};
  /**
   * CUT TO THE DOOR AND WATCH IT MOVE. Every actuation, both directions, no
   * exceptions.
   *
   * Only the last lever used to get a cut, and only in the opening direction, which
   * made every other actuation an act of faith: you throw a switch, a caption
   * appears, and nothing you can see has changed. If the mechanism is the fun then
   * the mechanism has to be SHOWN — so throwing the first of two levers cuts to the
   * gate and shows it grind halfway up, putting it back cuts to the gate and shows it
   * grind back down, and stepping off a plate cuts to the gate and shows it fall.
   *
   * A no-op is not shown, because a cut that flies across the dungeon to show you
   * nothing happening is the one thing worse than no cut at all.
   */
  let showDoor: (i: number, from: number, to: number) => void = () => {};
  const tmp = new THREE.Vector3();

  let floor!: Floor;
  let stepper!: Stepper;
  let combat!: Combat;
  let hud!: Hud;
  let busy = false;
  let dead = false;
  /**
   * A floor swap is in progress, so `floor`, `combat`, `stepper` and `hud` are all
   * about to be replaced.
   *
   * Its own flag rather than a second reading of `busy`, because the two now mean
   * different things: `busy` means "a round or a merge is resolving", which no longer
   * blocks a component, and this means "the objects a component would touch do not
   * exist yet", which always must.
   */
  let loading = false;
  /** The book's state last frame, so the belt can notice it MOVING rather than being. */
  let bookWas = true;
  /** Altars already claimed, so a floor grants exactly one page. */
  const claimedAltars = new Set<Entity>();
  /**
   * How many times each altar has been RE-rolled.
   *
   * The roll is deterministic per altar on purpose — walk away from three cards and
   * come back, and they are the same three cards. Nothing in the game advances this
   * any more, now that reroll charges are gone; it survives for the debug harness,
   * which needs to reach a roll containing a given offer kind without a charge to
   * spend, and that is exactly what advancing the nonce does.
   */
  const altarNonce = new Map<Entity, number>();
  /**
   * At most one golden page per run.
   *
   * A golden page is the only thing a run can hand to the run after it, and one
   * is a gift where three would be a starting book assembled a floor at a time —
   * the same accumulation that sealing found pages exists to prevent, just moved
   * one run down. `meta.giftedPage` holds one id for exactly this reason.
   */
  let goldenClaimed = false;
  /** Skips the golden page's rarity roll, so a harness can drive it. Debug only. */
  let goldenForced = false;

  // ------------------------------------------------------------------ helpers

  /**
   * May a component be taken right now?
   *
   * A "no" here is BLOCKED, never refused: nothing the player did was against the
   * rules, the game is simply mid-animation. Refusals (unlearned page, full hand)
   * live in `book.canRip` and speak.
   *
   * Note what this deliberately does NOT test: `busy`. A component costs nothing, so
   * a round already in flight is not a reason to refuse one — you may tear, harvest
   * and draw while the room is still answering your last cast, and the merge is what
   * has to wait, not the hand. `fan.busy` is still here because a hand already flying
   * into a cast cannot be added to, and `loading` is because a floor swap is
   * replacing `floor`, `combat` and `hud` underneath everything a tear touches.
   */
  const canTakeComponent = (): boolean => !loading && !dead && !fan.busy;

  /** World position of an entity's centre of mass, for aiming VFX at it. */
  const entityPos = (e: Entity, out: THREE.Vector3): THREE.Vector3 =>
    out.set(
      e.sprite.tx + e.sprite.ox,
      e.sprite.hover + e.sprite.h * 0.55,
      e.sprite.ty + e.sprite.oz,
    );

  /** Just below and ahead of the eye — reads as coming from the player's hands. */
  const muzzle = (out: THREE.Vector3): THREE.Vector3 => {
    const yaw = stepper.yaw();
    return out.set(
      eye.x - Math.sin(yaw) * 0.3,
      eye.y - 0.16,
      eye.z - Math.cos(yaw) * 0.3,
    );
  };

  /**
   * Is this a legal target for the pages currently torn out?
   *
   * Animate needs an OBJECT; a bolt takes anything that is not on your side.
   * Knowing this lets targeting follow the spell instead of making the player
   * discover the mismatch from a refusal message.
   *
   * Furniture counts. A bookshelf in a doorway is a problem a Fireball should be
   * able to solve, and refusing the target silently moved the reticle elsewhere —
   * so the cast went off, the shelf stood there, and the game looked broken. Your
   * own golems are excluded: they are on your side.
   */
  /**
   * What the compass points at, in priority order.
   *
   * An UNCLAIMED ALTAR first, because it is the run's only progression lever and the
   * only thing on a floor a player can miss permanently — the boss and the stairs
   * both come to you or wait for you, and a missed altar is a lost rank-up nothing
   * ever mentions. Then the boss while it lives. Then the way down.
   *
   * Deliberately NOT gated on having seen the thing. That is the whole point: the
   * altar you have already found is the one you do not need pointing at. What keeps
   * this from being a revealed map is that only the BEARING leaves this function —
   * see `Hud.drawCompass`.
   */
  const compassGoal = (): { x: number; y: number; label: string; colour: string } | null => {
    /**
     * A PLAYER'S OWN MARK OUTRANKS EVERYTHING.
     *
     * It is the one target the player chose deliberately, so nothing the game would
     * rather they looked at gets to argue with it — and it is what makes ONE arrow
     * enough. Cleared on arrival, because an arrow still pointing at the tile you are
     * standing on is an arrow that has stopped meaning anything.
     */
    const wp = hud.waypoint;
    if (wp) {
      if (wp.x === stepper.x && wp.y === stepper.y) hud.waypoint = null;
      else return { x: wp.x, y: wp.y, label: 'MARK', colour: '#8ce0ff' };
    }
    const altar = floor.entities.find((e) => e.kind === 'altar' && e.alive && !e.spent);
    if (altar) {
      return { x: altar.sprite.tx, y: altar.sprite.ty, label: 'ALTAR', colour: '#b98cff' };
    }
    const boss = floor.entities.find((e) => e.kind === 'boss' && e.alive && e.hp > 0);
    if (boss) return { x: boss.sprite.tx, y: boss.sprite.ty, label: 'BOSS', colour: '#ff6a6a' };
    const stairs = floor.stairsOpen
      ? floor.entities.find((e) => e.kind === 'stairs')
      : undefined;
    if (stairs) {
      return { x: stairs.sprite.tx, y: stairs.sprite.ty, label: 'DOWN', colour: '#8ce0ff' };
    }
    return null;
  };

  const isLegal = (t: AimTarget, ids: string[]): boolean => {
    /**
     * A BURNING TILE is a legal target for anything with an element in it.
     *
     * It is not a body and nothing about the hand has to be aimed at it — what it
     * offers is the fire itself, as fuel, and the ability to throw the next cast at
     * a patch of ground rather than at a creature. The two ingredient rules below
     * still refuse it, because a tile is neither an object to animate nor a corpse.
     */
    if (isTileTarget(t)) return !wantsCorpse(ids) && !wantsObject(ids);
    const e = t;
    /**
     * Coffin Moss raises the DEAD, and nothing on a floor is a corpse yet — the
     * corpse-raising phase is what puts one there. So a hand holding moss has no
     * legal target at all, the reticle clears, and the cast bar is what says why.
     * First, because it is the narrowest rule in here.
     */
    if (wantsCorpse(ids)) return false;
    const animatable = isCastableObject(e);
    // Asked of the ingredient's ROLE and not of the literal id `animate`, which is a
    // working name the designer still owns (`docs/DESIGN.md`, Open) — gating the
    // reticle on the string meant renaming it would silently break targeting.
    if (wantsObject(ids)) return animatable;
    return e.hostile || animatable;
  };

  /**
   * Is this thing straight in front of the player, at any distance?
   *
   * `inReach`'s rule — the ONE tile the facing points at — extended down the ray it
   * points along, and read off the same `DIR_VEC` so the two cannot disagree about
   * what "ahead" means. Nothing lateral counts at any facing, which is what keeps
   * auto-selection a statement about where the player is looking rather than a
   * second, softer version of `targetsInView`'s cone.
   */
  const directlyAhead = (e: Entity): boolean => {
    const dx = e.sprite.tx - stepper.x, dy = e.sprite.ty - stepper.y;
    const [fx, fy] = DIR_VEC[stepper.dir];
    return dx * fy - dy * fx === 0 && dx * fx + dy * fy > 0;
  };

  const refreshTargets = (): void => {
    hud.candidates = targetsInView(floor.grid, floor, stepper.x, stepper.y, stepper.dir);
    /**
     * Who can hit you before you act again.
     *
     * Computed here, off `combat`, because "alerted" is a decision the ROUND makes
     * and distance is the same measure `enemyRound` steps by — a telegraph derived
     * from anything else would eventually promise a reach the game does not honour.
     *
     * It deliberately includes bodies that are NOT visible. Something around a
     * corner two tiles away really can reach you, and a warning that only fires for
     * threats you can already see is a warning for the case that needed it least.
     */
    hud.threats = new Set(floor.entities.filter((e) =>
      e.alive && e.hostile && combat.isAlerted(e)
      && Math.abs(e.sprite.tx - stepper.x) + Math.abs(e.sprite.ty - stepper.y) <= THREAT_REACH));
    hud.tornIds = fan.gameIds;
    // Every prompt for an INTERACTION is recomputed here, off the same predicate
    // the interaction itself uses, so a control cannot be lit while the rule would
    // refuse it. Turning away takes all three of them off the screen.
    hud.altarInReach = altarInReach();
    hud.harvestInReach = harvestInReach();

    // The DESCEND button only appears when it would actually work.
    const st = floor.entities.find((e) => e.kind === 'stairs');
    hud.setDescendReady(combat.bossDead && !!st && inReach(st));

    const ids = fan.gameIds;
    // A target you can no longer SEE is dropped — out of the cone, out of reach, or
    // behind a wall, all three of which `targetsInView` now answers in one place.
    // `sameTarget` and not `includes`, because a tile target is a fresh object every
    // time this list is rebuilt — comparing by reference dropped the reticle on the
    // very next frame.
    if (hud.target && !hud.candidates.some((c) => sameTarget(c, hud.target))) hud.target = null;

    // If what you have torn out cannot be aimed at the current target, drop the
    // reticle. Tearing Animate with a skeleton selected used to just refuse the cast,
    // which read as the game being broken.
    if (hud.target && !isLegal(hud.target, ids)) hud.target = null;

    /**
     * AUTO-SELECT, and only for the one case that must not need a tap: an enemy that
     * is directly ahead and alerted — coming for you or already hitting you.
     *
     * Narrow on purpose. It used to select the nearest legal candidate unconditionally,
     * which since the grimoire became a function of having a target would mean the book
     * opened for the bookshelf you happened to walk past; and props hug walls while
     * bodies hold the open middle, so "nearest" reliably picked the furniture. Tapping
     * is how everything else is chosen, and nothing here overrides a live target —
     * the two clauses above are the only things that ever take one away.
     */
    if (!hud.target) {
      // Bodies only: auto-select exists for the one case that must not need a tap,
      // an enemy already coming for you. A tile never qualifies.
      hud.target = hud.candidates.find(
        (e): e is Entity => !isTileTarget(e)
          && e.hostile && combat.isAlerted(e) && directlyAhead(e) && isLegal(e, ids)) ?? null;
    }
  };

  /**
   * Is the grimoire on screen? **The one place this is answered.**
   *
   * Visibility is DERIVED and there is no control that sets it, which is the whole
   * point of the rule: a book you could hide by hand is a book that can disagree
   * with the state that is supposed to govern it. Three clauses:
   *
   *  - SOMETHING TO AIM AT, or the book is a lit control in the sightline of a room
   *    you are only walking through. A target OR a fixture in reach — harvesting is
   *    the tile you are facing and needs no reticle, so "no target, no book" alone
   *    would lock a player out of taking a candelabra's fire and fusing a page with
   *    it in an empty room. The HARVEST pill draws itself either way; what the book
   *    adds there is the page.
   *  - ROOM IN THE HAND. A full hand cannot take another component, so the book has
   *    nothing left to offer and the large CAST takes its place (`Hud.drawBigCast`).
   *    Cancelling a card with the red ✕ falls straight out of this: the hand is no
   *    longer full, so the book comes back with no path of its own.
   *  - A LIVE RUN. The run-end card owns the frame, and an open book under it is the
   *    brightest thing on a screen that says the run is over.
   */
  const bookOnScreen = (): boolean =>
    !dead && fan.count < handSize() && (!!hud.target || !!hud.harvestInReach);

  /** Step the reticle to the next legal target — the mobile equivalent of Tab. */
  const cycleTarget = (): void => {
    const ids = fan.gameIds;
    const legal = hud.candidates.filter((e) => isLegal(e, ids));
    if (!legal.length) { hud.target = null; return; }
    const i = hud.target ? legal.findIndex((c) => sameTarget(c, hud.target)) : -1;
    hud.target = legal[(i + 1) % legal.length];
  };

  /**
   * A dedicated star offer pays more than the 2 a maxed page pays.
   *
   * Different jobs: the maxed page's 2 stars is a consolation for a slot nothing
   * else wanted, while this is the whole altar coming up empty — no page left to
   * teach, a full bar, nowhere to put a bundle. Depth-scaled for the reason chests
   * are: late stars must be worth as much as the floor that yielded them.
   */
  const altarStars = (depth: number): number => 4 + depth * 2;

  /**
   * What the endurance blessing adds to the bar.
   *
   * Eight on a base of `PLAYER_MAX_HP` is a shade under a fifth, which is about one
   * extra exchange with a floor-three enemy — enough to be the reason a run
   * survives, never enough to be the only card worth taking.
   */

  /**
   * How often a golden page is on the table at all.
   *
   * Low, because permanence is the one thing a run is not supposed to hand out.
   * Five altars in a full run puts a golden in roughly half of them, which makes
   * it an event you remember rather than a fixture you budget around.
   */
  const GOLDEN_CHANCE = 0.16;

  /** Anything with a number in the headline says it the same way. */
  const starsName = (n: number): string => `✦  +${n} Stars`;

  /**
   * What one page is worth at the rank it is currently at, or null when it has
   * nothing left to give.
   *
   * The ladder is not uniform and that is the point: 1→2 is free, 2→3 is bought
   * with another rank-2 page, and past that the page pays stars. A rank-2 page
   * with no spare rank-2 page to feed it therefore returns NULL rather than
   * degrading into a free upgrade — the price of rank 3 is the whole reason an
   * eight-page book feels tight, so it cannot be waived just because the roll
   * happened to land on that page.
   */
  /**
   * A SECOND COPY OF A PAGE YOU ALREADY HOLD.
   *
   * The card a book with nothing new left to learn needs, and on a one-wizard roster that
   * is every altar from the first one. `unowned` is empty there — the page pools are cut to
   * the freed roster — so every offer was a rank-up, and a rank-up leaves the hand one card
   * wide. A hand of one cannot fuse, and fusion is the game; the player was being handed
   * bigger single casts forever and never the thing the tutorial is about.
   *
   * Capped by `HAND_MAX` and nothing else: the hand is the book's length, so any cap below
   * it is a cast slot the player cannot reach.
   */
  const copyOffer = (id: string): AltarOffer | null => {
    const def = SPELL_BY_ID[id];
    if (!def) return null;
    /**
     * UP TO THE HAND CEILING, not up to two.
     *
     * This capped at one extra sheet, on the reasoning that three Flames in a book of one
     * element has stopped being a choice. That reasoning was about the BOOK and the cap
     * lands on the HAND: `handSize` is `state.pages.length`, so refusing the third copy
     * refused the third slot, and a one-wizard save was held at a two-card hand with an
     * altar that had nothing to say about it. Three copies is a legal hand the volume
     * ladder is written for, and the ceiling that matters is `HAND_MAX`, which is the
     * number the whole turn economy is priced against.
     */
    const held = state.pages.filter((p) => p === id).length;
    if (held < 1) return null;
    /**
     * ONLY WHEN IT ACTUALLY GIVES YOU A SLOT.
     *
     * The card's whole promise is a wider hand, and the hand is
     * `max(meta.handSize, min(HAND_MAX, pages.length))` — so a copy widens nothing
     * whenever the tree is already the binding constraint. A player who has bought Hand
     * III and holds one page has three slots and no use for a second Flame's WIDTH; they
     * were being offered it at every altar anyway, which is a card that reads as
     * progress and is furniture.
     *
     * Asked as "would the hand be bigger after this" rather than as a page count, so it
     * covers both limits at once: the book's ceiling (`HAND_MAX`) and the tree's.
     */
    const wouldBe = Math.min(HAND_MAX, state.pages.length + 1);
    if (wouldBe <= handSize()) return null;
    return {
      id, colour: def.colour, cost: null, amount: 0, maxRank: MAX_RANK, golden: false,
      kind: 'copy', name: def.name,
      // The card says WHICH copy it is, because "second copy" on the third sheet is the
      // altar miscounting a book the player can see.
      tag: held === 1 ? 'SECOND COPY' : 'THIRD COPY',
      detail: held === 1
        ? `A second ${def.name} for the book. Your hand widens to hold both.`
        : `A third ${def.name} for the book. Your hand widens to hold all three.`,
      rank: state.ranks[id] ?? 1, toRank: 0,
    };
  };

  const pageOffer = (id: string, spend: string | null): AltarOffer | null => {
    const def = SPELL_BY_ID[id];
    if (!def) return null;
    const rank = state.ranks[id] ?? 0;
    const base = { id, colour: def.colour, cost: null, amount: 0, maxRank: MAX_RANK, golden: false };
    if (rank === 0) {
      return {
        ...base, kind: 'new', name: def.name, tag: 'NEW SPELL', detail: def.effect,
        rank: 0, toRank: 1,
      };
    }
    /**
     * A deepened page is a DIFFERENT SPELL by name, so every rung says so: the
     * headline is what the page becomes and the body says what it was. "Rank 1 → 2"
     * on its own is a number that means nothing to a player who has never seen rank
     * 2; "Frost becomes Frostbolt" is the same fact in the game's own words.
     */
    if (rank === 1) {
      return {
        ...base, kind: 'upgrade', name: rankName(id, 2), tag: 'UPGRADE',
        /**
         * "Strikes twice", not "casts as two copies".
         *
         * The old wording read as two SLOTS — a hand of two — which is what the second
         * copy card actually sells, and the two cards sit side by side at the first
         * altar. A player took the upgrade, saw Fireball in the book, and reasonably
         * expected a wider hand. A rank makes ONE page hit harder; a copy makes the hand
         * hold two. The words have to keep those apart.
         */
        detail: `${rankName(id, 1)} becomes ${rankName(id, 2)}. One page, strikes twice.`,
        rank: 1, toRank: 2,
      };
    }
    if (rank < MAX_RANK) {
      if (!spend || spend === id) return null;
      const sp = SPELL_BY_ID[spend];
      return {
        ...base, kind: 'sacrifice', name: rankName(id, rank + 1), tag: 'SACRIFICE',
        detail: `${rankName(id, rank)} becomes ${rankName(id, rank + 1)}. `
          + `One page, strikes ${rank + 1} times.`,
        cost: `Tears out your rank-2 ${sp ? rankName(spend, 2) : spend} for good.`,
        rank, toRank: rank + 1, spendId: spend,
      };
    }
    return {
      ...base, kind: 'star', name: starsName(2), tag: 'CELESTIAL STARS', colour: 0xffcf5c,
      detail: `${rankName(id, MAX_RANK)} is already mastered. Take a celestial star instead.`,
      amount: 2, rank: MAX_RANK, toRank: 0,
    };
  };

  /**
   * A page forwarded one run. The gilding is the moment of claiming it, not
   * something the page carries — next run it is an ordinary rank-1 page in your
   * hands, and the run after that it is gone.
   *
   * No `cost`. The card's price band is drawn as an alarm, for the two offers that
   * take something away for good, and a gift that expires is not one of those —
   * "that run only" is a limit on the gift and belongs in the same breath as it.
   */
  const goldenOffer = (id: string): AltarOffer => {
    const def = SPELL_BY_ID[id];
    const held = (state.ranks[id] ?? 0) > 0;
    return {
      kind: 'golden', id, name: def?.name ?? id, tag: 'GOLDEN PAGE',
      colour: def?.colour ?? 0xffcf5c,
      detail: held
        ? 'Gilded. You begin your next descent holding it — that descent only.'
        : 'Gilded. Yours now, and again when your next descent begins — that descent only.',
      cost: null,
      amount: 0, rank: state.ranks[id] ?? 0, toRank: 0, maxRank: MAX_RANK, golden: true,
    };
  };

  /**
   * The offers that are not about a page, in the order a roll should take them.
   *
   * Ordered by weighted draw rather than filtered by one, so the weights decide
   * what the FIRST extra slot gets and a roll with two extra slots still shows two
   * different things. Healing is only here when there is damage to undo — an offer
   * that would do nothing is a wasted third of the decision.
   *
   * STARS ARE NOT IN THE WEIGHTED POOL. They are appended after it, so a star
   * payout can only ever reach the table when every other extra has been used up —
   * a full health bar, a belt with nowhere to put a bundle. An altar is where
   * spells come from, and a card that hands you meta-currency instead is the
   * backstop for a slot with nothing to say, not a thing that competes for one.
   */
  const rollExtras = (rng: Rng): AltarOffer[] => {
    const pool: AltarOffer[] = [];
    const weights: number[] = [];
    /**
     * FULL HEALTH GETS A BIGGER BAR INSTEAD OF A WASTED CARD.
     *
     * A heal offered to a player standing at full health is a card that grants nothing,
     * and it was simply withheld — which is worse than it sounds at the one altar where
     * everybody is always full: the rite before the first floor. So the same slot pays
     * MAX health instead, which is the one thing a mending card can honestly give
     * somebody who has nothing to mend.
     *
     * Both, and in that order, so the bar is bigger AND full — raising the ceiling alone
     * would hand the player a bar that starts already missing what they just took.
     */
    if (state.hp >= state.maxHp) {
      pool.push({
        kind: 'heal', id: '', name: `A Deeper Well`, tag: 'MENDING',
        colour: 0x8ce06a,
        detail: `Nothing to close. The altar makes room instead: ${MAX_HP_GIFT} more health, kept for the descent.`,
        cost: null, amount: MAX_HP_GIFT, rank: 0, toRank: 0, maxRank: MAX_RANK, golden: false,
      });
      weights.push(4);
    }
    if (state.hp < state.maxHp) {
      // Sized off the CHEST curve rather than a new one, because an altar heal and a
      // chest heal are the same kind of thing now that the descent heal is gone: HP you
      // FOUND. Taken flat, without the chest's spread, because an altar card names the
      // number up front and has to be able to keep the promise. Clamped here rather
      // than on the way in, so the card promises what you will actually get.
      const heal = healable(state.hp, state.maxHp, chestHealBase(state.depth));
      pool.push({
        kind: 'heal', id: '', name: `Restore ${heal} Health`, tag: 'MENDING',
        colour: 0x8ce06a,
        detail: `You stand at ${state.hp} of ${state.maxHp}. The altar closes what it can.`,
        cost: null, amount: heal, rank: 0, toRank: 0, maxRank: MAX_RANK, golden: false,
      });
      weights.push(4);
    }
    /**
     * A bundle of one ingredient.
     *
     * `Roadmap/Altar_Reward_Node.md` put this out of scope "until the belt"; the belt
     * is here. Only offered when the belt can actually take it — a locked strap or a
     * belt with no free loop would make this a wasted third of the decision, which is
     * the same rule the heal follows. WHICH ingredient is a uniform draw, because both
     * "how common animation ingredients are" and "whether shapers drop at altars"
     * are `## Open — not decided` and a weighting here would answer them by stealth.
     *
     * Three rather than the two a chest pays, because this one is spending a slot that
     * could have been a rank or a floor's worth of health.
     */
    // Flagged off, the kind must not roll at all: an offer for the belt would be a third
    // of the decision spent on a thing the player has no belt to put it on. Stated as its
    // own guard rather than left to `beltRefusalFor` — a capacity of 0 already empties
    // this list, but then the reason the card is gone would be an accident of arithmetic.
    const keepable = BELT_ENABLED
      ? INGREDIENT_IDS.filter((id) => beltRefusalFor(state.belt, id) === null)
      : [];
    if (keepable.length) {
      const pick = rng.pick(keepable);
      const def = SPELL_BY_ID[pick];
      pool.push({
        kind: 'ingredient', id: pick, name: `${def.name} ×${ALTAR_INGREDIENTS}`,
        tag: 'FOR THE BELT', colour: def.colour,
        detail: `${def.effect} Consumed on casting, and never a spell on its own.`,
        cost: null, amount: ALTAR_INGREDIENTS, rank: 0, toRank: 0, maxRank: MAX_RANK,
        golden: false,
      });
      // Under the heal, which is the one extra that stops a run ending. A hand of
      // consumables is a real prize; it is not the prize you needed.
      weights.push(3);
    }

    const out: AltarOffer[] = [];
    while (pool.length) {
      const pick = rng.weighted(pool, weights);
      const i = pool.indexOf(pick);
      pool.splice(i, 1);
      weights.splice(i, 1);
      out.push(pick);
    }
    return out;
  };

  /**
   * THE BACKSTOP. Not in `rollExtras`, and that distinction is the whole point.
   *
   * Appending it to the extras list was not enough: the fill loop hands a non-page
   * slot to the extras queue first and only falls back to the pages queue when the
   * extras run dry, so a stars card sitting at the tail of that queue still beat an
   * unclaimed page. Measured on the opening floor that produced a star payout in
   * roughly half of all rolls while four new spells went unoffered.
   *
   * So it lives outside both queues and is reached only when BOTH are exhausted —
   * no page left to teach, no heal to give, nowhere to put a bundle. Reaching it
   * means the altar genuinely had nothing, which is the only honest time to answer
   * "what does this stone have for me" with meta-currency.
   */
  const starsBackstop = (): AltarOffer => ({
    kind: 'stars', id: '', name: starsName(altarStars(state.depth)), tag: 'CELESTIAL STARS',
    colour: 0xffcf5c,
    detail: 'Banked for the surface. Nothing in the dungeon takes them.',
    cost: null, amount: altarStars(state.depth), rank: 0, toRank: 0, maxRank: MAX_RANK,
    golden: false,
  });

  /**
   * The golden page, if this altar has one — rolled as a PAGE, not as an extra.
   *
   * It used to live at the head of `rollExtras`, which had two consequences the
   * player felt directly. It spent one of the roll's non-page slots on what is
   * plainly a spell, and it was drawn from `ELEMENT_SPELLS` with no idea what the
   * page slots were about to offer — so with five page elements and a three-page
   * loadout, `gild` is almost exactly the set of pages the roll already favours,
   * and a page sitting next to its own gilded twin was the common case rather than
   * a freak roll. Rolled here and excluded from the ordinary page draw below, both
   * go away: it takes a page slot because it is a page, and it is the only card on
   * the table for that page.
   */
  const rollGolden = (rng: Rng): AltarOffer | null => {
    // Never a page the starting book already holds — you would begin the next run
    // holding that one anyway, so gilding it is a card that grants nothing.
    const gild = rosterPages().filter((sp) => !meta.loadout.includes(sp.id)).map((sp) => sp.id);
    if (goldenClaimed || !gild.length) return null;
    if (!goldenForced && !rng.chance(GOLDEN_CHANCE)) return null;
    return goldenOffer(rng.pick(gild));
  };

  /**
   * An altar offers a CHOICE of three, on a tap.
   *
   * Three options beat one grant for the obvious reason — a decision is more
   * interesting than a gift — but also because it lets an offer be an UPGRADE to
   * something you already hold. Three and never four: with eight pages a wider
   * roll only makes "every offer is stars" arrive sooner, so widening it is a
   * currency generator in a costume (`docs/DESIGN.md`, Rejected).
   */
  const rollAltarOffers = (e: Entity | null, nonce = 0): AltarOffer[] => {
    /**
     * `e` is null for a CATCH-UP rite at the dungeon mouth, which is a real draw off
     * the same table with no stone in front of the player. The seed falls back to the
     * depth alone, so the three owed rolls differ by nonce and nothing else.
     */
    const where = e ? `${e.sprite.tx}-${e.sprite.ty}` : 'mouth';
    const rng = new Rng(`${runSeed}-altar-${state.depth}-${where}-${nonce}`);
    /**
     * The gilded page is drawn FIRST, because everything below has to know about it.
     * It occupies a page slot and its element is struck out of the ordinary draw, so
     * a page can never appear beside its own golden twin.
     */
    const golden = rollGolden(rng);
    // Elements only: an altar grants PAGES, and ingredients have none. Deduped
    // because a book may legitimately hold a page twice.
    const owned = [...new Set(state.pages.filter(isPageElement))];
    const unowned = rosterPages().filter((sp) => !owned.includes(sp.id)).map((sp) => sp.id);
    // A page cannot feed itself, so one rank-2 page buys nothing; it takes two.
    const rank2 = rng.shuffle(owned.filter((id) => (state.ranks[id] ?? 0) === 2));

    /**
     * A PAGE YOU DO NOT OWN OUTRANKS EVERY RANK-UP. Not a weight — an order.
     *
     * This was a 4:1 bias that flipped on hand size, and the flip was the problem:
     * a rank-up is a number going up, and there are only five page elements, so a
     * bias meant an altar could always find a reason to offer you the same three
     * upgrades you have been offered all run. New pages come first and upgrades take
     * what is left, which makes a rank-up something the altar falls back to once
     * your book is nearly complete rather than the thing it opens with. With five
     * elements and a three-page loadout that is two floors of genuinely new spells,
     * then rank-ups because there is nothing else — which is when a rank-up is
     * actually the prize.
     *
     * Shuffled within each tier, so WHICH new page and WHICH upgrade still varies.
     */
    /**
     * COPIES RANK WITH NEW PAGES, above every rank-up, and only when there is nothing new.
     *
     * Same order the comment below argues for and for the same reason: what the player
     * needs from an altar is a spell they cannot already cast, and on a one-element roster
     * a second copy is the only card that delivers one — Flame twice is a fusion, and a
     * deeper Flame is the same cast bigger.
     */
    const copies = unowned.length
      ? []
      : rng.shuffle(owned).map((id) => copyOffer(id)).filter((o): o is AltarOffer => o !== null);
    const gone = golden ? [golden.id] : [];
    const ordered = [
      ...rng.shuffle(unowned.filter((id) => !gone.includes(id))),
      ...rng.shuffle(owned.filter((id) => !gone.includes(id))),
    ];

    /**
     * At most ONE sacrifice and at most one star payout per roll.
     *
     * Both are single propositions, not a menu: "you may buy rank 3" and "there is
     * nothing left to give you". Three sacrifice cards is three versions of the
     * same transaction and it eats the choice width the altar exists for; three
     * star cards IS the star faucet this phase was written to stop, and it is what
     * a book of maxed pages produces if nothing caps it. Capped here rather than by
     * making the offers rarer, because one of each is exactly right.
     */
    const once = new Set<string>();
    const offerable = ordered
      .map((id) => pageOffer(id, rank2.find((p) => p !== id) ?? null))
      .filter((o): o is AltarOffer => o !== null)
      .filter((o) => {
        if (o.kind !== 'sacrifice' && o.kind !== 'star') return true;
        if (once.has(o.kind)) return false;
        once.add(o.kind);
        return true;
      });
    // The gilded page leads, and `pageSlots` is never below 1, so a golden that
    // rolled always reaches the table: when it is on the table it IS the table.
    // A maxed page pays stars, which is not a spell, so that sinks below every page
    // that still has something to teach. Otherwise "at least one spell" could be
    // satisfied by a card that grants no spell.
    const pages = [
      ...(golden ? [golden] : []),
      ...copies,
      ...offerable.filter((o) => o.kind !== 'star'),
      ...offerable.filter((o) => o.kind === 'star'),
    ];
    const extras = rollExtras(rng);

    /**
     * How many of the three slots are pages. THREE is now the common shape and one
     * is the rare one, where it used to be the other way about.
     *
     * An altar is the place spells come from. Every non-page slot is that promise
     * being spent on something else, and at 3/5/2 the average roll put more than one
     * card on heals, charges and payouts — so the stone you crossed a floor for
     * routinely offered a single spell and two consolations. Weighted this way it
     * averages a shade over two and a half pages, and a roll with two non-page cards
     * takes a 1-in-10 to happen at all.
     */
    const pageSlots = Math.max(1, rng.weighted([1, 2, 3], [1, 4, 5]));

    const chosen: AltarOffer[] = [];
    let pi = 0, xi = 0;
    const nextPage = (): AltarOffer | undefined => pages[pi++];
    const nextExtra = (): AltarOffer | undefined => extras[xi++];
    /**
     * Three cards, or four with Wider Rites. The width is a purchase, and the only one
     * — `derivedAltarWidth` refuses a fifth for the reason `docs/DESIGN.md` gives.
     */
    const width = derivedAltarWidth(meta.nodes);
    while (chosen.length < width) {
      // When one side runs dry — a book with nothing left to give, or a full bar
      // with no heal to offer — the other fills, because three is not negotiable.
      const o = chosen.length < pageSlots
        ? nextPage() ?? nextExtra()
        : nextExtra() ?? nextPage();
      if (o) { chosen.push(o); continue; }
      // Both dry. One stars card and then stop: a slot with nothing in it is better
      // than a second identical payout, which is a menu pretending to be a choice.
      chosen.push(starsBackstop());
      break;
    }
    // Shuffled for POSITION only: which offers made it in is already decided, so
    // this just stops the guaranteed spell always being the top card.
    return rng.shuffle(chosen);
  };

  const takeFromAltar = (e: Entity): void => {
    if (e.kind !== 'altar' || e.spent || claimedAltars.has(e)) return;
    const why = reachRefusal(e, 'altar');
    if (why) { hud.addLog(why); return; }
    hud.offers = rollAltarOffers(e, altarNonce.get(e) ?? 0);
    hud.offerAltar = e;
  };

  /**
   * Spend a page for good.
   *
   * The only path in the game that makes the book SMALLER, so it has to undo
   * everything learning a page did: out of `state.pages`, out of `state.ranks`,
   * and back through `setBookPages` / `book.refresh` or the grimoire keeps showing
   * a page whose rank no longer exists. A hand holding it is returned, because
   * nothing else would drop it and casting a page that is no longer yours is worse
   * than dropping it — and dropping it costs nothing, because holding it cost nothing.
   */
  const burnPage = (id: string): void => {
    state.pages = state.pages.filter((p) => p !== id);
    delete state.ranks[id];
    setPageRanks(state.ranks);
    setBookPages(state.pages);
    book.refresh();
    if (fan.gameIds.includes(id)) fan.clear();
  };

  /**
   * Leave a golden page for the next run.
   *
   * One field and one id, saved immediately, and it never touches `meta.loadout` —
   * the starting book is the star tree's business now, and a gift that entered it
   * would be a permanent page arriving from a run rather than from a purchase.
   * Written the moment it is claimed so the gift survives the tab being shut with
   * the rest of the run in it; `takeGift` is what makes it survive exactly once.
   */
  const giftGolden = (id: string): void => {
    meta.giftedPage = isPageElement(id) ? id : null;
    saveMeta(meta);
    goldenClaimed = true;
  };

  /** Apply the offer the player picked, and empty the altar. */

  /**
   * Offer them, if the star tree has bought the right to be asked.
   *
   * Without the `blessing` node nothing is offered AND nothing hints that anything
   * was missed — a locked door the player can see is a worse experience than a door
   * they do not know about, and the tree is where the door is bought.
   */
  /**
   * The start depths this player has EARNED, offered every fifth floor.
   *
   * Floor 1 always. Beyond that, floor 6 needs the depth-5 boss dead and floor 11 the
   * depth-10 boss — so the offer is 1 / 6 / 11 and nothing between, because a choice
   * of ten floors is a menu rather than a decision.
   *
   * Read off `bossKills` and not off a high-water mark: a player who starts at 6 and
   * kills that boss has proved they can reach 7, not that they ever walked floors 2
   * to 5 — and `THEMES.length` bounds it, so an unreachable eleventh floor is never
   * offered however many bosses fall.
   */
  const startDepths = (): number[] => {
    const out = [1];
    for (const d of [6, 11]) {
      if (d <= THEMES.length && meta.bossKills.includes(d - 1)) out.push(d);
    }
    return out;
  };

  /**
   * Choose where to begin, when there is a choice.
   *
   * Reuses the altar's chooser for the third time, which is the point of it having
   * been built as three objects and a caption: the gesture is the same question every
   * time. A player with nothing unlocked is never asked — one option is not a choice
   * and a modal that can only be dismissed is a toll.
   */
  const offerStartDepth = (): boolean => {
    const depths = startDepths();
    if (depths.length < 2) return false;
    hud.offerTitle = 'HOW DEEP DO YOU BEGIN';
    hud.offerSubtitle = 'the deep road pays less \u00b7 you skip its floors';
    hud.offers = depths.map((d) => ({
      kind: 'startDepth', id: '', name: THEMES[d - 1].name,
      tag: d === 1 ? 'the long road' : `depth ${d}`,
      colour: d === 1 ? 0xffcf5c : 0xb98cff,
      detail: d === 1
        ? 'Begin at the mouth, as always. Every floor, every altar, every star.'
        : `Skip ${d - 1} floors. Three catch-up draws, and the stars of those floors are lost with them.`,
      cost: null, amount: d, rank: 0, toRank: 0, maxRank: MAX_RANK, golden: false,
    }));
    return true;
  };

  /**
   * Where this run begins. 1 until the mouth's chooser says otherwise.
   */
  let startDepth = 1;
  /**
   * Who this run is. Held here rather than on the HUD because the HUD is rebuilt on every
   * floor — see `enterFloor` — and the wizard is a fact about the RUN, so the per-floor
   * rebuild reads it back from here rather than the identity being lost at the stairs.
   */
  let startWizard: Wizard | null = null;

  /** Wait for the open chooser to be answered. The mouth is the only place that
   *  blocks on one — everywhere else the modal simply owns the taps until it closes. */
  /**
   * Wait until the player has answered whatever the screen is asking.
   *
   * Watches the ROSTER as well as the offer cards, and that is not a nicety: the page
   * question is asked through `hud.roster` and every other question through
   * `hud.offers`, so polling only the latter resolved the moment the roster went up —
   * before the player had picked anyone.
   *
   * The consequence was invisible and quite bad. The blessings were then rolled against
   * an EMPTY book, so "a wider book" could offer the very element the player was about
   * to choose as their starting page: the one card whose whole job is to widen the run
   * handed you a second copy of your only spell. Two things wrong at once — the wrong
   * page, and a card whose text disagreed with what it granted.
   */
  const waitForChoice = (): Promise<void> => new Promise((resolve) => {
    const tick = (): void => {
      if (!hud.offers && !hud.roster) { resolve(); return; }
      setTimeout(tick, 60);
    };
    tick();
  });

  /**
   * THE CATCH-UP: three altar draws for the floors you skipped.
   *
   * Fewer than you skipped, deliberately — five floors' worth of altars is five
   * rank-ups, and three is what makes the deep road the WEAKER path rather than a
   * shortcut. `Roadmap/Descent_Unlocks.md` is explicit about that, and the lost star
   * income of the skipped floors is the other half of the same trade.
   *
   * Delivered as three consecutive rolls of the altar's own chooser, which is the
   * surface the doc asked for: no new screen, and the player already knows the
   * gesture.
   */
  const grantCatchUp = (): void => {
    catchUpDraws = CATCH_UP_DRAWS;
    hud.addLog(
      `You begin deep. ${CATCH_UP_DRAWS} rites owed for the floors you skipped.`,
      0xb98cff,
    );
  };

  let catchUpDraws = 0;
  /**
   * The nonce the mouth's rite rolls on.
   *
   * Its own number so it cannot collide with a catch-up draw (`payCatchUp` counts down
   * from `CATCH_UP_DRAWS`) — two rolls sharing a nonce on the same depth would be the
   * same three cards twice.
   */
  const BLESSING_NONCE = 99;

  /** Roll the owed rites, one chooser at a time, before the run begins. */
  const payCatchUp = async (): Promise<void> => {
    while (catchUpDraws > 0) {
      catchUpDraws--;
      hud.offerTitle = `A RITE OWED \u00b7 ${catchUpDraws + 1} LEFT`;
      hud.offerSubtitle = 'for the floors you did not walk';
      hud.offers = rollAltarOffers(null, catchUpDraws);
      await waitForChoice();
    }
    hud.offerTitle = 'THE ALTAR OFFERS';
    hud.offerSubtitle = 'choose one';
  };

  /**
   * A REAL ALTAR DRAW, before the first floor.
   *
   * The blessing is an altar offering you get at the start — the same table an altar in
   * the dungeon rolls, with the same cards: a spell you do not have, a rank on one you
   * do, stars, an ingredient bundle. Not a separate menu of three fixed axes.
   *
   * The three fixed cards were the wrong shape for this node twice over. One of them
   * could only ever hand you a page, which on a narrow roster meant a second copy of
   * the spell you had just chosen; and a bespoke table meant the one screen that looks
   * like an altar behaved like nothing else in the game. `rollAltarOffers(null, ...)` is
   * exactly this draw and already exists — it is what the deep-start rites use, an altar
   * roll with no stone in front of the player.
   *
   * Rolled here rather than at boot, so it draws against the book the player has just
   * chosen: an altar offers ranks on what you hold and pages you lack, and it cannot do
   * either with an empty grimoire.
   */
  const offerBlessings = (): boolean => {
    if (!owns(meta.nodes, 'blessing')) return false;
    hud.offerTitle = 'A RITE AT THE MOUTH';
    hud.offerSubtitle = 'choose one, before the first floor';
    hud.offers = rollAltarOffers(null, BLESSING_NONCE);
    return true;
  };

  /**
   * THE ONE PAGE YOU SET OUT WITH.
   *
   * The first question the mouth asks, and the reason the loadout stopped being the
   * book. Three pages in the book at hand size 1 meant the opening cast was picked
   * from a menu nobody chose; one page chosen deliberately means the run has a
   * SUBJECT before the first tile, and the altar's second page is an answer to a
   * question the player actually asked.
   *
   * THE MENU IS ROLLED, not listed.
   *
   * It used to be `meta.loadout`, which nothing writes any more — so it was the same
   * three cards, in the same order, at the mouth of every run this game has ever
   * begun. A question whose three answers never change is not a question the second
   * time it is asked; it is a keypress on the way to the first floor.
   *
   * Drawn off the whole page pool on the RUN's seed, so the pick you make is a
   * reaction to what the dungeon offered rather than a habit. What the star tree
   * buys here is the WIDTH of the menu — `meta.slots`, the same number that used to
   * be the size of the starting book — which keeps the binding worth paying for
   * while leaving which pages appear to the roll.
   *
   * Minus anything last run already gifted, so the gift widens the book instead of
   * paying for a rung of it twice.
   *
   * Granted silently when it is not a choice. A tree trimmed to a single binding, or
   * a gift that leaves one page on the menu, produces a modal with one card and no
   * decision, which is the toll `offerStartDepth` refuses to charge for the same
   * reason.
   */
  /**
   * THE PAGES THIS SAVE HAS A WIZARD FOR.
   *
   * A wizard IS an element — that is already the rule the mouth screen derives identity
   * from — and until now it was the ONLY thing a wizard was. Every page pool in the game
   * (the start menu, the altar draw, the golden page, the mouth blessings) rolled over
   * all six elements from the first run, so a save that had never opened a cage could
   * still be holding Decay on floor two. That made the roster cosmetic: freeing Kela won
   * you a portrait and a different opening page, and nothing you could not already cast.
   *
   * So the pools are cut to the roster. Six elements is the END state of the chain, not
   * its start, and every cage on the way down is now the only way to widen what the book
   * can ever contain.
   *
   * HARVESTS ARE UNTOUCHED, deliberately. Drawing frost off a frozen fountain before you
   * have freed Kela is the game showing you what is behind the next cage — it lasts one
   * cast, cannot be stored and cannot be ranked, which is the difference between a taste
   * and a page. The dungeon staying a component pouch is a pillar (`docs/DESIGN.md`); the
   * BOOK is what the roster gates.
   */
  const rosterPages = () => {
    /**
     * BOTH LISTS, because a rescue writes two and the pool must not depend on which.
     *
     * `meta.wizards` is who you may PLAY and `meta.freed` is who you have cut out of a
     * cage; `rescue` pushes to both, so they should never disagree. This read the playable
     * list alone, which means any save where they HAVE drifted — an older save, a partial
     * write, a rescue recorded before both lists existed — silently keeps the pages of a
     * wizard the player can see on their own roster screen. That is unfalsifiable from
     * inside the game: the hero is standing there freed and the altar acts as though they
     * are still behind the gate.
     *
     * The union costs nothing and makes the rule the player was told: the element is
     * available from the moment its wizard is out, and it stays available.
     */
    const have = new Set<string>([...meta.wizards, ...meta.freed, FIRST_WIZARD]);
    return ELEMENT_SPELLS.filter((sp) => have.has(sp.id));
  };

  const startPageMenu = (): string[] => {
    const pool = rosterPages().map((sp) => sp.id).filter((id) => id !== gifted);
    return new Rng(`${runSeed}-start-page`).sample(pool, meta.slots);
  };

  /**
   * The page you begin the run with — and therefore WHO YOU ARE.
   *
   * The one choke point for both, deliberately. A wizard IS their starting element (see
   * `wizards.ts`), so the identity is derived from the page here rather than stored
   * alongside it; there is no way to end up as Ash holding Frost, because there is no
   * second thing to keep in step.
   */
  const grantStartPage = (id: string): void => {
    state.ranks[id] = 1;
    learnPage(id);
    startWizard = WIZARD_BY_ID[id] ?? null;
    hud.wizard = startWizard;
  };

  const offerStartPage = (): boolean => {
    const menu = startPageMenu();
    if (menu.length < 2) {
      // Nothing to ask. Take the one there is, or — for a save whose loadout has
      // filtered down to nothing at all — the default book's first page, because a
      // run that begins with an empty grimoire cannot cast and cannot recover.
      grantStartPage(menu[0] ?? DEFAULT_LOADOUT[0]);
      return false;
    }
    /**
     * WHO ARE YOU, not which page — and ALL of them, every time.
     *
     * The roster is deliberately not built from `menu`. `startPageMenu` answers "which
     * pages may this save begin with", which was the right question while this screen was
     * a random draw of three cards and is the wrong one now: a cast list that shows only
     * what you have earned cannot tell you what you are working toward. So every wizard is
     * here in chain order, and ownership becomes a `locked` flag rather than a filter.
     */
    hud.roster = WIZARDS.map((wizard) => {
      const by = freedBy(wizard.id);
      return {
        wizard,
        locked: !meta.wizards.includes(wizard.id),
        freedBy: by ? (WIZARD_BY_ID[by]?.name ?? null) : null,
      };
    });
    hud.rosterPeek = null;
    return true;
  };

  /**
   * Commit to a wizard. The one door out of the roster screen.
   *
   * Refuses a locked pick rather than trusting the button not to be there — the hit region
   * is built by the drawing code, and a screen that is safe only because of what it drew
   * last frame is a screen one layout change away from handing out the whole cast.
   */
  const pickWizard = (id: string): void => {
    if (!meta.wizards.includes(id as WizardElement)) return;
    hud.roster = null;
    hud.rosterPeek = null;
    grantStartPage(id);
  };

  const chooseOffer = (o: AltarOffer): void => {
    /**
     * A blessing has no altar behind it, so it resolves before the altar guard —
     * and restores the chooser's captions on the way out, because the next thing to
     * open it is an altar and it must not inherit this one's title.
     */
    /**
     * WHERE TO BEGIN. Resolved before the altar guard for the same reason a blessing
     * is: there is no altar at the dungeon mouth.
     */
    if (o.kind === 'startDepth') {
      hud.offers = null;
      hud.offerTitle = 'THE ALTAR OFFERS';
      hud.offerSubtitle = 'choose one';
      startDepth = o.amount;
      return;
    }
    /**
     * THE ONE PAGE. Resolved before the altar guard with the other two mouth
     * questions, and for the same reason: there is no stone in front of the player.
     */
    if (o.kind === 'startPage') {
      hud.offers = null;
      hud.offerTitle = 'THE ALTAR OFFERS';
      hud.offerSubtitle = 'choose one';
      grantStartPage(o.id);
      /**
       * "You set out with", not "and nothing else".
       *
       * The old line claimed the book held one page and one page only, and the wider-book
       * blessing offered on the very next card can add a second — so the game contradicted
       * itself in two breaths. Deferring the blessing's page to the first altar was tried
       * and was worse: an altar handing out a spell is what an altar already does, so the
       * blessing stopped being "start wide" and became "the first altar is bigger", which
       * is not a thing anybody would buy.
       *
       * The page choice is still the run's subject; it just no longer swears it is alone.
       */
      hud.addLog(`You set out with ${o.name}.`, o.colour);
      hud.setShout(o.name.toUpperCase(), o.colour);
      return;
    }

    const e = hud.offerAltar;
    hud.offers = null;
    hud.offerAltar = null;
    /**
     * An altar-less draw is a real draw. The catch-up rites at the dungeon mouth roll
     * the same table through the same chooser with no stone in front of the player, so
     * the reward below has to land whether or not there is an altar to spend — this
     * used to `return` and silently swallow the offer the player had just picked.
     */
    if (e) {
      claimedAltars.add(e);
      void floor.spendAltar(e);
    }
    // At the rank the player actually holds it, so "already mastered" names the
    // mastered thing — an Inferno, not the Flame it was three altars ago.
    const pageName = SPELL_BY_ID[o.id] ? rankName(o.id, state.ranks[o.id] ?? 1) : o.id;

    switch (o.kind) {
      /**
       * A SECOND COPY. The rank is left exactly where it was — this is another sheet of
       * the same page, not a rung — and `learnPage` pushes it, which is what widens the
       * hand (`handSize` counts `state.pages`).
       */
      case 'copy':
        learnPage(o.id);
        hud.setShout(`A SECOND ${o.name.toUpperCase()}`, o.colour);
        hud.addLog(
          `The altar yields a second ${o.name}. Your hand widens to hold it.`, o.colour,
        );
        break;
      case 'new':
        state.ranks[o.id] = 1;
        learnPage(o.id);
        hud.setShout(`${o.name.toUpperCase()} LEARNED`, o.colour);
        hud.addLog(`The altar yields ${o.name}. ${o.detail}`, o.colour);
        // Deliberately NOT persisted. A page found in the dungeon belongs to this
        // run only; next run you are back to your loadout. Golden pages are the
        // one exception and they go through their own claim path.
        break;
      /**
       * The shout is the NEW NAME and nothing else. `o.name` already is it — the
       * offer was built as the rung it takes you to — so the old "<page> RANK 2"
       * would now read "FROSTBOLT RANK 2", which says the same thing twice and in
       * two vocabularies.
       */
      case 'upgrade':
        state.ranks[o.id] = Math.min(MAX_RANK, (state.ranks[o.id] ?? 1) + 1);
        hud.setShout(o.name.toUpperCase(), o.colour);
        hud.addLog(o.detail, o.colour);
        break;
      case 'sacrifice': {
        const spend = o.spendId;
        // The modal owns every tap while it is open, so the book cannot have moved
        // under this offer. Guarded anyway: silently ranking up for free would
        // waive the one price the design is explicit about.
        if (!spend || spend === o.id || (state.ranks[spend] ?? 0) < 2) {
          hud.addLog('The sacrifice finds nothing to take. The altar closes.', 0xff9a6a);
          break;
        }
        state.ranks[o.id] = Math.min(MAX_RANK, (state.ranks[o.id] ?? 1) + 1);
        burnPage(spend);
        hud.setShout(o.name.toUpperCase(), o.colour);
        hud.addLog(
          `${o.detail} ${rankName(spend, 2)} burns for it.`,
          o.colour,
        );
        break;
      }
      case 'golden':
        // Learned this run too. A page you cannot use until the next run is a
        // reward taken on faith, and the altar has to pay out where it stands.
        if ((state.ranks[o.id] ?? 0) === 0) {
          state.ranks[o.id] = 1;
          learnPage(o.id);
        }
        giftGolden(o.id);
        /**
         * AND IT TURNS GOLD IN YOUR HAND, NOW, ON THE RUN THAT WON IT.
         *
         * The gild used to be applied at the START of the next run, to the page this
         * one left behind — so the descent where you actually beat the odds and took
         * the rarest card on the table showed you nothing, and a later descent you
         * had not earned opened on a gold sheet for no reason it could name. The
         * trophy has to coincide with the moment or it is not a trophy.
         *
         * `book.refresh` explicitly: `learnPage` only runs for a page not already
         * held, and `syncPageRanks` below rebuilds only when a RANK moved, so a
         * golden claimed on a page the run is already carrying would change the art
         * and never redraw it.
         */
        setGilded(o.id);
        book.refresh();
        hud.setShout(`${o.name.toUpperCase()} GILDED`, 0xffcf5c);
        hud.addLog(
          `${o.name} is gilded — you begin your next descent holding it, that descent only.`,
          0xffcf5c,
        );
        break;
      case 'heal': {
        /**
         * MENDING, or a bigger bar when there is nothing to mend.
         *
         * Which one is decided HERE off the bar rather than off a second offer kind,
         * because it is the same card answering the same question — what can this altar
         * do about your health — and two kinds would be two places for the answer to
         * drift. Recomputed rather than trusted for the same reason it always was: the
         * bar is the authority on what it can take.
         */
        if (state.hp >= state.maxHp) {
          state.maxHp += o.amount;
          state.hp += o.amount;
          hud.setShout(`+${o.amount} MAX HEALTH`, 0x8ce06a);
          hud.addLog(
            `Nothing to close, so the altar makes room. +${o.amount} max health.`, 0x8ce06a,
          );
          break;
        }
        const got = healable(state.hp, state.maxHp, o.amount);
        state.hp += got;
        hud.setShout(`+${got} HEALTH`, 0x8ce06a);
        hud.addLog(`The altar's light closes your wounds. +${got} health.`, 0x8ce06a);
        break;
      }
      case 'stars':
        state.stars += o.amount;
        hud.setShout(`✦ ${o.amount} CELESTIAL STARS`, 0xffcf5c);
        hud.addLog(`The altar pays ${o.amount} stars into the bank.`, 0xffcf5c);
        break;
      case 'ingredient': {
        // Through the same one grant path everything else uses, so the belt's own
        // rules apply — and counted, because a full loop can refuse part of a bundle
        // and the shout must not promise three when two landed.
        let got = 0;
        for (let i = 0; i < o.amount; i++) if (grantIngredient(o.id)) got++;
        const name = SPELL_BY_ID[o.id]?.name ?? o.id;
        hud.setShout(got ? `${name.toUpperCase()} ×${got}` : 'NOWHERE TO KEEP IT', o.colour);
        break;
      }
      /**
       * No `reroll` case, because rerolls are gone from the game root and branch.
       *
       * A charge was a card that paid out in maybe: you gave up a certain prize for
       * the right to ask a later altar for a better one, which is the worst trade on
       * a table whose other two cards are spells. Removed whole — the offer, the
       * mouth blessing that banked one, the HUD pill, the modal button, the spend
       * path and the `rerolls` field on the run itself. Nothing to leave inert.
       */
      case 'star':
        // Still the settled rule: a rolled page with no rank left to give pays 2
        // stars, so the run funds the meta exactly when it has nothing left to
        // teach you. The page it was rolled for is named, or the payout reads as
        // arriving from nowhere.
        state.stars += o.amount;
        hud.setShout(`✦ ${o.amount} CELESTIAL STARS`, 0xffcf5c);
        hud.addLog(`${pageName} is already mastered — the altar pays in stars.`, 0xffcf5c);
        break;
      default:
        break;
    }

    // Every rank-writing branch above funnels through here, so one call covers the
    // upgrade, the sacrifice, the golden and the new page — and does nothing at all
    // for the heal, the bundle and the two payouts, which move no rank.
    syncPageRanks();

    // A catch-up rite has no stone to rise from; the shimmer still plays.
    if (e) {
      entityPos(e, tmp);
      fx.rise(tmp, o.colour);
    }
    sfx.shimmer(o.golden ? 990 : o.kind === 'star' || o.kind === 'stars' ? 720 : 880);
    refreshTargets();
  };

  /**
   * Open a chest. Chests are the run's star payout plus a little healing, which
   * is what makes a detour off the path to the boss worth taking.
   */
  const openChest = (e: Entity): void => {
    if (e.kind !== 'chest' || e.spent) return;
    const why = reachRefusal(e, 'chest');
    if (why) { hud.addLog(why); return; }
    void floor.openChest(e);
    const rng = new Rng(`${runSeed}-chest-${state.depth}-${e.sprite.tx}-${e.sprite.ty}`);
    const stars = 3 + rng.int(0, 2) + state.depth;
    // Healed by what the bar can actually take, so the log reports what you got
    // rather than what was offered.
    const heal = healable(state.hp, state.maxHp,
      chestHealBase(state.depth) + rng.int(0, CHEST_HEAL_SPREAD));
    state.stars += stars;
    state.hp += heal;
    hud.setShout(`✦ ${stars} CELESTIAL STARS`, 0xffcf5c);
    hud.addLog(`The chest yields ${stars} stars and ${heal} health.`, 0xffcf5c);
    /**
     * And ingredients, generously.
     *
     * Granted even when the belt is locked, deliberately: the refusal is the moment
     * the capability advertises itself ("you have nowhere to keep it", with the strap
     * pulsing), and suppressing the drop would hide the belt from every player who
     * has not bought it — which is the opposite of what the design asks the locked
     * strip to do.
     *
     * Unless the belt is flagged off, in which case there is no strip for the refusal to
     * advertise. Skipping the ROLL and not just the grant keeps the chest's stars and
     * heal identical either way: both were already drawn off `rng` above, and nothing
     * after this line touches it.
     */
    if (BELT_ENABLED) {
      for (let i = rollDropCount(rng, CHEST_INGREDIENTS); i > 0; i--) {
        grantIngredient(rollIngredient(rng, state.belt));
      }
    }
    entityPos(e, tmp);
    fx.rise(tmp, 0xffcf5c);
    sfx.shimmer(720);
    refreshTargets();
  };

  /** The unused altar or chest you are standing at and facing, for the prompt. */
  const altarInReach = (): Entity | null => {
    for (const e of floor.entities) {
      if (!e.alive || e.spent) continue;
      /**
       * A LEVER PROMPTS LIKE AN ALTAR DOES.
       *
       * It is worked by the same gesture, from the same one tile, under the same
       * reach rule — so it gets the same affordance rather than a second one. Without
       * it a lever is a piece of scenery you have to guess is tappable, which is the
       * exact problem the altar prompt was added to solve.
       */
      if (e.kind !== 'altar' && e.kind !== 'chest' && e.kind !== 'lever') continue;
      if (inReach(e)) return e;
    }
    return null;
  };

  /**
   * The fixture you are standing at and facing, for the HARVEST pill.
   *
   * One tile, so one answer — which is what lets the pill stop being tied to the
   * reticle. Under line of sight the pill had to follow the selected object,
   * because "which of the six things in this room" had no other answer; the reach
   * rule answers it, and requiring a tap on the thing you are already nose to nose
   * with would have been the reticle standing in for a rule that no longer needs it.
   */
  const harvestInReach = (): Entity | null => {
    const [fx, fy] = DIR_VEC[stepper.dir];
    const e = floor.entityAt(stepper.x + fx, stepper.y + fy);
    if (!e || !e.alive || e.hp <= 0 || e.kind !== 'prop' || e.animated) return null;
    // A spent fixture is furniture. The pill that offers a harvest must go quiet
    // with the fixture, or the game keeps offering something it will then refuse —
    // the same defect as a crossed-out-but-castable target.
    if (e.draws !== undefined && e.draws <= 0) return null;
    return harvestOf(e.spriteId) ? e : null;
  };

  const wireCombat = (): void => {
    combat.playerTile = { x: stepper.x, y: stepper.y };

    combat.onEvent = (ev) => {
      if (ev.kind === 'cast') { hud.setShout(ev.text, ev.colour ?? 0xffffff); return; }
      if (ev.kind === 'discover') { hud.setDiscovery(ev.text, ev.colour ?? 0xffffff); return; }
      if (ev.kind === 'hit' && ev.at && ev.amount !== undefined) {
        hud.addFloat(ev.text, ev.colour ?? 0xffffff, ev.at.x, ev.at.y, ev.amount >= 14);
        return;
      }
      if (ev.kind === 'status') { hud.setDiscovery(ev.text, ev.colour ?? 0xffffff); return; }
      // A body that lost its round floats over that body; a refused cast (no `at`)
      // still logs, because it answers something the player just pressed. Denial is
      // per-body and can happen three times in one round, so it must never take the
      // screen-centre caption `status` uses for once-per-cast interactions.
      if (ev.kind === 'deny' && ev.at) {
        hud.addFloat(ev.text, ev.colour ?? 0xffffff, ev.at.x, ev.at.y);
        return;
      }
      hud.addLog(ev.text, ev.colour ?? 0xd8c9a0);
    };

    /**
     * THE FLOOR OPENED. You are on the next one.
     *
     * A trapdoor is the one thing in the game that takes a floor off you without the
     * boss falling, and that is deliberate: `Verticality` refused to let a ledge do
     * it so that the two reads stay apart — a drop inside a floor is damage you chose
     * and this is the ground giving way. It costs the rest of the floor: the altar
     * you had not claimed, the boss you had not killed, and whatever they were worth.
     *
     * `fallThrough` and NOT `descend`, which is the whole of why none of the above was
     * ever true in a running game — `descend` refuses to move anybody whose boss is
     * still alive, so this fired the caption and did nothing else.
     */
    combat.onPitfall = () => {
      hud.addLog('The floor opens. You go down with it.', 0x9aa3ad);
      fx.shake = Math.min(1.5, fx.shake + 0.9);
      void fallThrough();
    };
    /**
     * The one door a CAST can open: a block shoved onto a plate. Watched exactly the
     * way a lever and a boot on a plate are, through the same cut.
     */
    combat.onDoorMoved = (i, from, to) => { showDoor(i, from, to); };
    combat.onPlayerHurt = (amount, by) => {
      /**
       * The STRIKE only plays for something you are looking at.
       *
       * A claw rake across the screen is a first-person shot of the thing hitting
       * you, and playing it for a creature behind you shows a blow that is not in
       * frame — the effect claims to be the world and is not. So it is gated on the
       * attacker being directly ahead AND visible, which is the same pair of
       * questions the renderer asks before drawing the creature at all.
       *
       * The DIRECTION is reported for every hit regardless, because the case the
       * strike cannot cover is exactly the case the player most needs told about.
       */
      const ahead = !!by && directlyAhead(by)
        && floor.visible.has(floor.grid.idx(by.sprite.tx, by.sprite.ty));
      hud.playerHurt(ahead && by ? hitFxFor(by.spriteId) : null);
      if (by) {
        // Relative to the way the player is FACING, not to the compass: the screen
        // is the player's frame of reference and north means nothing to it.
        const dx = by.sprite.tx - stepper.x, dy = by.sprite.ty - stepper.y;
        const world = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
        hud.damageFrom((world - stepper.dir + 4) % 4, amount);
      }
      fx.shake = Math.min(1.3, fx.shake + 0.5);
    };

    // A boss pays in ingredients as well as stars. Combat decides what falls; the
    // belt decides whether it can be kept, and `grantIngredient` says either way.
    combat.onIngredientDrop = (id) => grantIngredient(id);

    /**
     * An object going off. Deliberately NOT shaped like a cast: no bolt leaves the
     * player's hands, the burst is centred on the OBJECT and then answers on every
     * tile it reached. That silhouette — one big flash out there, small ones around
     * it — is what says the barrel did this rather than the spell.
     */
    combat.onReactionFx = (r) => {
      tmp.set(r.at.x, 0.55, r.at.y);
      fx.burst(tmp, r.colour, 2.1);
      for (const tile of r.tiles) {
        fx.burst(new THREE.Vector3(tile.x, 0.5, tile.y), r.colour, 0.7);
      }
      engine.setFlash(0.24, r.colour);
    };

    combat.onCastFx = (cast, from, targets) => {
      if (cast.output === 'golem') {
        const t = targets[0];
        if (t) { entityPos(t, tmp); tmp.y = 0.05; fx.rise(tmp, cast.colour); }
        // A golem rising is the whole of that cast's animation, and it is worth a beat
        // of its own — the thing stands up, and THEN the room answers.
        return t ? 0.45 : 0;
      }
      /**
       * A bolt leaves the player's hands unless the cast names something else to
       * leave FROM — which is how a chain draws. Each jump is thrown from the link it
       * just came off, so the path the charge took is a thing the player watches
       * happen rather than a set of numbers appearing at once.
       */
      const origin = from
        ? entityPos(from, new THREE.Vector3())
        : muzzle(new THREE.Vector3());
      /**
       * The LAST bolt's arrival, which is when this cast is over.
       *
       * Taken from `fx.bolt`'s own return rather than recomputed here: the flight time
       * is a function of distance and belongs to the effects layer, and a second copy of
       * the formula would drift the day the bolt speed changes. A volley staggers its
       * bolts by 0.075s each, so the last one is the one that matters.
       */
      let lands = 0;
      targets.forEach((t, i) => {
        const to = entityPos(t, new THREE.Vector3());
        lands = Math.max(lands, fx.bolt(origin.clone(), to, cast.colour, {
          delay: i * 0.075,
          size: 0.3 + Math.min(0.35, cast.damage * 0.012),
          onArrive: () => fx.burst(to, cast.colour, 0.9 + Math.min(1, cast.damage / 20)),
        }));
      });
      engine.setFlash(0.16, cast.colour);
      return lands;
    };

    /**
     * A chain jump: a bolt standing in the gap between two bodies, not a thing
     * crossing it. Aimed at the upper body of both so it runs between chests rather
     * than between two patches of floor, and answered with a small burst at the far
     * end so the arrival lands as a hit and not just as light.
     */
    /**
     * Every round, the floor under the player offers what it is made of.
     *
     * Wired here with the rest of the combat callbacks, and fired by `enemyRound` after
     * the room has acted, so anything the round did to the ground is already true.
     */
    combat.onRoundEnd = () => standingArms();

    combat.onChainFx = (from, to, colour) => {
      const a = entityPos(from, new THREE.Vector3());
      const b = entityPos(to, new THREE.Vector3());
      fx.chain(a, b, colour);
      fx.burst(b, colour, 0.7);
      engine.setFlash(0.1, 0xffe14a);
    };
  };

  // ------------------------------------------------------------- floor loading

  const enterFloor = async (depth: number, layout?: LayoutId): Promise<void> => {
    // `loading` and not only `busy`: a component may now be taken while a round is
    // in flight, and the one state in which it may not is this one, where the floor
    // a tear would refresh its targets against is being replaced.
    loading = true;
    busy = true;
    document.getElementById('boot')?.classList.remove('gone');
    /**
     * WHO FOLLOWS YOU DOWN.
     *
     * Read off the OLD floor before it is disposed, because after that the entities are
     * gone and their combatants with them. A servant is not carried as a sprite id — it
     * is carried as what the player MADE: the body it was woken in, the health it has
     * left, the damage the cast gave it, and the status its infusion applies.
     *
     * `golemsKept` is how many, and `golemInfusion` is whether the infusion survives the
     * stairs or is left behind with the floor. Both come off the tree, and with neither
     * node owned this list is empty and nothing about a descent changes.
     */
    const carried: { sprite: string; hp: number; maxHp: number; damage: number; infuse: StatusId[] }[] = [];
    if (floor) {
      const keep = derivedGolemsKept(meta.nodes);
      if (keep > 0) {
        const mine = floor.entities.filter(
          (e) => e.alive && e.animated && !e.hostile && e.hp > 0);
        // Strongest first, so a player who has two and may keep one keeps the one worth
        // keeping rather than whichever the array happened to hold first.
        mine.sort((a, b) => b.hp - a.hp);
        for (const e of mine.slice(0, keep)) {
          const c = combat.combatantOf(e);
          carried.push({
            sprite: e.spriteId,
            hp: e.hp,
            maxHp: e.maxHp,
            damage: c?.damage ?? 0,
            infuse: derivedGolemInfusion(meta.nodes) ? [...(c?.infuse ?? [])] : [],
          });
        }
      }
    }
    if (floor) {
      /**
       * Everything comes out of the hand, the floor's own card included: the tile that
       * was holding it open is not on the next floor.
       *
       * Here rather than at the top of `enterFloor`, because on the FIRST floor there is
       * no `floor` yet and `refreshTargets` reads its grid — which is exactly how this
       * crashed the boot when it was written two lines earlier.
       */
      returnHand(false);
      // The mark belongs to a floor, not to a run.
      hud.waypoint = null;
      hud.chartOpen = false;
      engine.scene.remove(floor.group);
      floor.dispose();
    }

    state.depth = depth;
    // The progression event the retention gates read. Depth is the only number that
    // says how far a session actually got, and it is written here rather than at the
    // stairs so a deep START (`Descent_Unlocks`) counts as the floor it opens on.
    track('floor_entered', { depth });
    trackFtueOnce(depth);
    const theme = THEMES[Math.min(THEMES.length - 1, depth - 1)];
    /**
     * WHO IS BEHIND THE GATE on this floor, decided here rather than in the generator.
     *
     * It depends on the save (who is already freed) and on the wizard being played (only
     * their own captive appears), and the dungeon generator knows neither and should not
     * learn them — it builds rooms, not progression.
     */
    const captiveWizard = startWizard
      ? captiveOn(depth, startWizard.id, meta.freed)
      : null;
    floor = await Floor.create(
      depth, `${runSeed}-floor-${depth}`, layout,
      captiveWizard && captiveWizard.captiveSprite
        ? { id: captiveWizard.id, sprite: captiveWizard.captiveSprite }
        : null,
      /**
       * WHETHER THIS SAVE CAN WORK A PLATE, which decides whether the floor is allowed to
       * build one. Gust is the only cast with `shove` and a block is the only weight that
       * holds a gate up and lets you past it, so `canShove` is exactly "has Vane been
       * freed" — see `GenOpts.canShove` for why a floor must not gate on it otherwise.
       */
      meta.wizards.includes('gust'),
    );
    engine.scene.add(floor.group);

    stepper = new Stepper(floor.grid, floor.grid.start.x, floor.grid.start.y, floor.grid.start.dir);
    combat = new Combat(floor, state, `${runSeed}-floor-${depth}`);
    /**
     * AND THEY ARRIVE WITH YOU, beside the stairs you both came down.
     *
     * After `combat` exists, because a golem is half floor and half combatant: the floor
     * can place the sprite and only combat can make it the same servant again
     * (`enlistGolem`). Placed on the tiles around the start, skipping anything occupied,
     * so two servants do not stack and neither lands inside the furniture.
     *
     * A servant that cannot be fitted is simply lost. That is better than the
     * alternatives — stacking bodies, or holding a queue of golems that appear later —
     * and it cannot happen in practice: the start tile is walkable by construction and
     * it has open neighbours or the floor could not be entered.
     */
    for (const g of carried) {
      const spot = [...DIR_VEC]
        .map(([dx, dy]) => ({ x: floor.grid.start.x + dx, y: floor.grid.start.y + dy }))
        .find((q) => floor.grid.walkable(q.x, q.y) && !floor.entityAt(q.x, q.y));
      if (!spot) continue;
      const e = await floor.place({
        kind: 'prop', sprite: g.sprite, x: spot.x, y: spot.y,
        ox: 0, oz: 0, hover: 0, roomId: floor.grid.roomAt(spot.x, spot.y)?.id ?? 0,
      });
      if (!e) continue;
      // The body it was, not a fresh prop: animated (so it acts), friendly, and holding
      // the health it walked down with.
      e.animated = true;
      e.hostile = false;
      e.hp = g.hp;
      e.maxHp = g.maxHp;
      combat.enlistGolem(e, g.damage, g.infuse);
      hud.addLog(`${displayName(g.sprite)} came down with you.`, 0x8ce06a);
    }
    hud = new Hud(engine, state, combat, () => fan.gameIds, returnHand);
    hud.bookClosed = book.closed;
    // The floor's name, permanently in the top-left beside the depth. It used to
    // arrive as a shout across the middle of the screen and a log line, both of which
    // faded — so a player who looked away for two seconds could not find out where
    // they were at all.
    hud.floorName = theme.name;
    // The bestiary is meta's, so it is handed over on every floor rather than once.
    hud.bestiary = meta.bestiary;
    hud.bankedStars = meta.stars;
    // Handed over with the rest of meta's readouts, and on every floor for the same
    // reason they are: the HUD is rebuilt per floor and a slider that drew 100 while the
    // camera was at 115 would be the one control in the game that lies.
    hud.fov = meta.fov;
    hud.fovRange = [FOV_MIN, FOV_MAX];
    hud.invertGestures = meta.invertGestures;
    // Re-seeded per floor with the rest of the run's readouts, so the portrait beside the
    // health bar survives the stairs.
    hud.wizard = startWizard;
    hud.pinGoal = pinReadout();
    hud.bindMap(() => ({ floor, x: stepper.x, y: stepper.y, dir: stepper.dir }));
    hud.loreFor = (id) => combat.lore(id);
    hud.knownFor = (id, el) => combat.known(id, el as SpellElement);
    /**
     * A discovery is announced by NAME — both the creature and the element.
     *
     * Explicit on purpose, and a change of mind: the first version showed only THAT
     * a weakness existed and made the player remember which, on the theory that it
     * felt more earned. In play it was invisible, and a lesson nobody notices is not
     * earned, it is lost. Discovery is still earned — nothing is shown that has not
     * been hit — but recall is free.
     */
    /**
     * The bestiary fills itself. No node, no price, no unlock — it is free the first
     * time and free forever, which is the whole position the design takes on it.
     */
    /**
     * A boss kill is a DEED and goes straight to disc.
     *
     * Not banked until the run ends: dying on the floor below is not a reason to lose
     * proof of the fight you won, and a permission you can be robbed of by bad luck is
     * not permission.
     */
    combat.onBossKilled = (depth) => {
      if (meta.bossKills.includes(depth)) return;
      meta.bossKills.push(depth);
      saveMeta(meta);
    };

    combat.onFusion = (name) => {
      if (meta.bestiary.includes(name)) return;
      meta.bestiary.push(name);
      saveMeta(meta);
      hud.bestiary = meta.bestiary;
    };

    combat.onDiscover = (spriteId, element, kind) => {
      if (kind === 'plain') return;             // "nothing special" is not news
      const who = displayName(spriteId).toUpperCase();
      const what = element.toUpperCase();
      hud.discovered(
        kind === 'weak' ? `${who} · WEAK TO ${what}` : `${who} · RESISTS ${what}`,
        kind === 'weak' ? 0xffd166 : 0x8aa0b8,
      );
    };
    wireCombat();

    // `cineLock` is the cutscene: it cannot be interrupted, so nothing may act.
    // The cut cannot be interrupted, so nothing may act while one is playing.
    stepper.canAct = () => !busy && !dead && !hud.offers && !cine && !plunge;
    /**
     * Furniture, altars and hostiles are solid. Your OWN golems are not — walking
     * into one swaps places with it, so a summon that follows you can never trap
     * you in a corridor or a doorway.
     */
    const friendlyAt = (x: number, y: number): Entity | null => {
      const e = floor.entityAt(x, y);
      return e && e.alive && e.animated && !e.hostile ? e : null;
    };
    stepper.blocked = (x, y) => floor.solidAt(x, y) && !friendlyAt(x, y);
    /**
     * What a two-finger W/S will trade tiles with: a BODY. Enemies, the boss and
     * your own golems. Bosses included on purpose — a rule with exceptions cannot
     * be learned. An altar, a chest, the stairs and an un-animated prop are not
     * bodies: they have nowhere to walk to, and shoving a bookshelf a tile down
     * the corridor is not a move, it is a glitch.
     */
    const bodyAt = (x: number, y: number): Entity | null => {
      const e = floor.entityAt(x, y);
      if (!e || !e.alive) return null;
      const body = e.kind === 'enemy' || e.kind === 'boss' || (e.kind === 'prop' && e.animated);
      return body ? e : null;
    };
    stepper.swappable = (x, y) => bodyAt(x, y) !== null;
    // Frost on standing water is a floor you keep going on. See `Stepper.slippery`.
    stepper.slippery = (x, y) => floor.ground.at(floor.grid.idx(x, y)) === 'ice';
    /**
     * BRIAR COSTS YOU A BEAT, the same one rubble costs. See `Stepper.snagged`.
     *
     * Briar only — the bramble a cast throws around it is undergrowth, and a plant
     * cast whose whole volume was difficult ground would be a wall the player can
     * lay across a room.
     */
    stepper.snagged = (x, y) => floor.ground.at(floor.grid.idx(x, y)) === 'briar';
    /**
     * The tile the current step started on, for the arrival to measure the drop
     * against. `onArrive` is only told where you landed, and by then the stepper's
     * own `fromX/fromY` have been reused by whatever was queued next.
     */
    let cameFrom = { x: stepper.x, y: stepper.y };
    stepper.onDepart = (fx, fy, tx, ty) => {
      cameFrom = { x: fx, y: fy };
      // The golem shuffle and the two-finger swap are the same move, so they are
      // the same code: whoever is standing in the destination takes the tile you
      // left. A plain step can only ever get here with a friendly golem there —
      // `blocked` refuses everything else — so no test for which move this was.
      const other = bodyAt(tx, ty);
      if (!other) return;
      other.sprite.tx = fx; other.sprite.ty = fy;
      other.sprite.setTileLight(floor.grid.lightAt(fx, fy));
      other.sprite.play('walk');
    };
    /**
     * RUBBLE IS CROSSED IN TWO HALVES, on ONE swipe.
     *
     * The cost is a turn — the only currency this game has — and it is charged by
     * running the room's round twice for the one step: once here, with the player
     * stopped half a tile in and still counting as standing on the near side, and
     * once on arrival like any other step. So a body that was two tiles away gets to
     * close and swing while you are climbing, which is exactly what a slow tile is
     * supposed to mean.
     *
     * What it is NOT is a step that takes two swipes. The player never has to repeat
     * an input, because an input that visibly did nothing is indistinguishable from
     * one the touchscreen ate, and the lesson learnt from that is to distrust the
     * control rather than to respect the terrain.
     */
    stepper.onHalfway = async (fromX, fromY) => {
      busy = true;
      // Named for what is actually underfoot. The obstacle is the tile being ENTERED
      // — `fromX,fromY` is the near side the player is still counted as standing on —
      // and `stepper` already holds the destination, committed at the start of the
      // step.
      const rock = floor.grid.surfaceAt(stepper.x, stepper.y) === Surface.Rubble;
      hud.addLog(
        rock ? 'You clamber into the rubble.' : 'You tear into the briar.',
        rock ? 0xa89880 : 0x8fd07a,
      );
      try {
        await combat.playerStepped(fromX, fromY);
      } finally {
        // In a `finally` and not after the await: a throw in the round would
        // otherwise leave the player frozen mid-stride with no way to finish the step.
        busy = false;
        stepper.release();
      }
      refreshTargets();
      checkDeath();
    };
    stepper.onArrive = async (x, y) => {
      // The movement hint has done its job the instant the player moves once.
      hud.hasMoved = true;
      floor.cull(x, y);
      refreshTargets();
      busy = true;

      /**
       * THE PLAYER PAYS FOR THE DROP THEY CHOSE TO TAKE.
       *
       * Before the round, unlike the rubble clamber and the descent: you land hurt,
       * and then the room answers you standing there hurt. It can kill — the same
       * rule the caster's own fireball gets, and for the same reason. A ledge that
       * could not kill you would not be a thing you think about at 8 HP, and thinking
       * about it at 8 HP is the entire content of the mechanic.
       *
       * Nothing here is a special case for the player. `fallDamage` is the same
       * function the shove uses, asked the same question.
       */
      /**
       * THE PLATES ARE RE-READ ON EVERY ARRIVAL, not only when one is stepped ONTO.
       *
       * Which is the whole of the hold-to-open rule: the interesting half is stepping
       * OFF, and "you left the plate" is not an event anybody would fire — it is the
       * absence of one. Asking the question after every step catches both, and
       * catches a body walking off a plate too.
       */
      {
        const g = floor.grid;
        /**
         * THE TILE YOU ARE ON, BEFORE ASKING WHAT IS UNDER YOUR FEET.
         *
         * `combat.playerTile` was not written until `playerStepped`, forty lines
         * below, so this block asked "is anything standing on the plate" using the
         * tile the player had just LEFT. The stale answer always agreed with the
         * lift the door already had, `refreshPlates` always returned false, and the
         * camera cut for a plate gate never fired once — not late, not wrong,
         * NEVER. The gate then snapped open a moment later inside `tickClock`,
         * which re-asks the same question with the tile finally updated, so the
         * state was right and only the thing the player was supposed to watch was
         * missing. Stepping onto a plate is the actuation; this is where it happens
         * and this is where it has to be seen.
         */
        combat.playerTile = { x, y };
        const before = g.doors.map((d) => g.doorLift[d.i]);
        if (combat.refreshPlates()) {
          const moved = g.doors.findIndex((d, k) => g.doorLift[d.i] !== before[k]);
          if (moved >= 0) showDoor(g.doors[moved].i, before[moved], g.doorLift[g.doors[moved].i]);
        }
      }

      /**
       * A LADDER IS A CLIMB IN BOTH DIRECTIONS.
       *
       * `canClimb` already reads the ladder to allow going UP from it; going DOWN
       * onto one is the same act and must cost the same nothing. Charging fall damage
       * for it made the one safe route down the one route nobody would use, and made
       * a ladder look like decoration next to a ledge you would jump off anyway.
       *
       * The shove is deliberately not included. Being pushed off a ledge is not
       * climbing down it, whatever happens to be bolted to the wall.
       */
      const fell = floor.grid.surfaceAt(x, y) === Surface.Ladder
        ? 0 : floor.grid.dropFrom(cameFrom.x, cameFrom.y, x, y);
      if (fell > 0) {
        const dmg = fallDamage(fell);
        state.hp -= dmg;
        fx.shake = Math.min(1.4, fx.shake + 0.35 + fell * 0.2);
        fx.hitstop = Math.max(fx.hitstop, 0.06 + fell * 0.02);
        hud.addLog(
          fell > 1 ? `You drop ${fell} levels. ${dmg} damage.` : `You drop down. ${dmg} damage.`,
          0xc9b590,
        );
        // No attacker: the strike overlay is a shot of the thing hitting you, and
        // the floor is not a thing that hits you.
        hud.playerHurt(null);
      }
      await combat.playerStepped(x, y);
      busy = false;
      refreshTargets();
      checkDeath();

      /**
       * A PORTAL MOVES YOU WHEN YOU STAND ON IT. That is the whole feature.
       *
       * After the round, like the stairs and for the same reason: the step that
       * carried you onto the mouth is still a turn the room gets to answer. Arriving
       * is a `place`, not a step, so the far mouth does not fire this again and bounce
       * you back — stepping onto it a second time is a second, deliberate trip.
       */
      const here = floor.grid.idx(x, y);
      if (state.hp > 0 && floor.grid.surfaceAt(x, y) === Surface.Portal) {
        const to = floor.grid.portalPair(here);
        if (to >= 0) {
          const tx = to % floor.grid.w, ty = (to / floor.grid.w) | 0;
          fx.burst(new THREE.Vector3(x, 0.5, y), 0xb98cff, 1.4);
          stepper.place(tx, ty, stepper.dir);
          fx.burst(new THREE.Vector3(tx, 0.5, ty), 0xb98cff, 1.4);
          combat.playerTile = { x: tx, y: ty };
          floor.cull(tx, ty);
          refreshTargets();
          hud.addLog('The pair takes you.', 0xb98cff);
        }
      }
      /**
       * WALKING IN IS DESCENDING. The stairs are the one thing in the dungeon you
       * can stand on — `SOLID` leaves them out on purpose — and standing on a
       * staircase and then having to find a button is the game asking twice.
       *
       * After the round and after the death check, both deliberately: the step that
       * carried you onto the stairs is still a turn the room answers, and dying on
       * it should not be overtaken by the next floor loading.
       */
      if (state.hp > 0) {
        const st = floor.entities.find((e) => e.kind === 'stairs');
        if (st && st.sprite.group.visible && st.sprite.tx === x && st.sprite.ty === y) {
          await descend();
        }
      }
    };
    /**
     * Walk into the gallery. Depth 6 for its palette and nothing else — the layout is
     * hand-built and takes none of the depth's dressing (see `Layout.dressed`).
     *
     * The player is put at the top of the spine looking down it, because the whole
     * point is a walk past the bays rather than a spawn in the middle of one.
     */
    showroom = async () => {
      await enterFloor(6, 'showroom');
      const g = floor.grid;
      const spine = (g.w >> 1) + 1;
      let y = 2;
      while (y < g.h - 2 && !g.walkable(spine, y)) y++;
      /**
       * NOTHING IN HERE FIGHTS BACK. Not two bodies, not one — none.
       *
       * Twelve bays is twelve rooms and `populate` gives every room its bodies, which
       * is twenty-five of them plus a boss in the vault: a fight, not a gallery. Two
       * were kept so a creature could be seen standing on a plate or shoved off a
       * ledge, and that was the wrong trade. The spine is ONE room down its whole
       * length, so a hostile anywhere on it is in the same room as the player wherever
       * they stand — `enemyRound` engages it every single turn — and the walk past the
       * bays this floor exists for is a running fight from the first step. You cannot
       * look at a blade while something is hitting you.
       *
       * A body is the one thing here that can be put back on demand: `putEntity` in
       * the debug harness drops one wherever it is wanted, which is a better way to see
       * a creature on a plate than having two of them hunt you the whole time.
       *
       * Removed here rather than in `populate`, which has no business knowing that one
       * of its floors is a debug room.
       */
      for (let i = floor.entities.length - 1; i >= 0; i--) {
        const e = floor.entities[i];
        if (e.kind !== 'enemy' && e.kind !== 'boss') continue;
        e.alive = false;
        e.sprite.group.visible = false;
        floor.entities.splice(i, 1);
      }
      /**
       * The way down, which the boss was holding. Stairs are generated hidden and
       * revealed where the boss falls, so removing it without this leaves the gallery
       * with no staircase in it — one of the things worth looking at, and the one that
       * would otherwise be missing for a reason nobody could see.
       */
      floor.revealStairs();

      stepper.place(spine, y, 2);
      combat.playerTile = { x: spine, y };
      floor.cull(spine, y);
      refreshTargets();
      hud.addLog('THE SHOWROOM — one bay per feature. ` or F1 to rebuild it.', 0xffc23e);
    };

    /**
     * Throw the lever you tapped, if you are standing next to it.
     *
     * The same REACH rule every fixture obeys (`docs/DESIGN.md`): adjacent, and only
     * adjacent. A lever worked from across the room would be the one interaction in
     * the game that reaches, and reaching is what spells are for.
     */
    showDoor = (i: number, from: number, to: number): void => {
      if (Math.abs(to - from) < 0.001) return;
      const g = floor.grid;
      // Hold it where it WAS while the camera travels, so the move is watched and
      // not discovered — the rule has already changed, only the picture is waiting.
      floor.clockView.setLift(i, from);
      cutToward(
        i % g.w,
        (i / g.w) | 0,
        undefined,
        (u) => { floor.clockView.setLift(i, from + (to - from) * u); },
      );
    };

    throwLever = (e: Entity): void => {
      const d = Math.abs(e.sprite.tx - stepper.x) + Math.abs(e.sprite.ty - stepper.y);
      if (d > 1) {
        hud.addLog('Too far. Stand next to it.', 0x9aa3ad);
        return;
      }
      const g = floor.grid;
      /**
       * WHICH MECHANISM THIS HANDLE BELONGS TO, asked before it is thrown.
       *
       * Two banks of levers exist on a floor now — the boss door's, and the captive cage's
       * when the save cannot shove a block onto a plate — so the door to cut to is whichever
       * one owns the tile under the player's finger. Read here rather than inside
       * `pullLever` because the cut is a camera decision and the lever is a rules one.
       *
       * Every door of the mechanism is watched, not just the first: a cage with two mouths
       * grinds both up together, and showing one of them is showing half the actuation.
       */
      const cg = g.captiveGate;
      const i = g.idx(e.sprite.tx, e.sprite.ty);
      const watched = cg && cg.levers.includes(i)
        ? cg.doors
        : (g.bossDoor && g.bossDoor.levers.includes(i) ? [g.bossDoor.i] : null);
      if (!watched) return;
      const before = watched.map((k) => g.doorLift[k]);
      const r = combat.pullLever(e.sprite.tx, e.sprite.ty);
      if (r === null) return;
      watched.forEach((k, n) => showDoor(k, before[n], g.doorLift[k]));
    };

    /**
     * You stepped off the edge. That is the end of the run.
     *
     * Not fall damage — a bottomless pit has no bottom to be hurt by, and scaling it
     * would be pricing a distance that does not exist. `Verticality` deliberately kept
     * a LEDGE survivable so that dropping off one stays a tactic; this is the other
     * thing, and it has to be absolute or the chasm floors stop meaning anything.
     *
     * The camera goes down with you before the screen does, because a death you do not
     * see the cause of reads as the game taking your run away rather than as you
     * having walked into a hole you could see.
     */
    stepper.onPlunge = () => {
      if (plunge) return;
      hud.addLog('You step out over nothing.', 0x9aa3ad);
      fx.shake = Math.min(0.7, fx.shake + 0.4);
      plunge = { t: 0, from: stepper.eyeHeight };
    };
    stepper.onTurnDone = () => refreshTargets();
    stepper.onBump = () => { fx.shake = Math.min(1, fx.shake + 0.22); };

    floor.cull(stepper.x, stepper.y);
    refreshTargets();

    // The gift has to be SAID on the floor it arrives on. It was claimed at an
    // altar in a run that has already ended, so a page silently appearing in the
    // book is the player finding a spell they cannot account for.
    if (depth === 1 && gifted) {
      hud.addLog(
        `The gilded ${SPELL_BY_ID[gifted]?.name ?? gifted} is in your book — for this descent.`,
        0xffcf5c,
      );
    }
    busy = false;
    loading = false;
    document.getElementById('boot')?.classList.add('gone');
  };

  /**
   * The one place a run ends, whichever way it ended.
   *
   * Both endings bank, both shut the book and both put up the same card — which is
   * what makes the tree the single destination. `earned` is passed rather than read
   * off `state`, because the vault pays a bonus the run never held.
   */
  const endRun = (kind: 'died' | 'won', earned: number): void => {
    dead = true;
    meta.stars += earned;
    meta.best = Math.max(meta.best, state.depth);
    saveMeta(meta);
    // Both endings, through the one exit, so "how do runs end" is answerable without
    // having to reconcile two events that would drift apart.
    track('run_ended', { kind, depth: state.depth, earned, best: meta.best });
    // The grimoire shuts, and it does so through `bookOnScreen` — `dead` is one of
    // its clauses — rather than by being closed from here. Two writers would be two
    // answers, and this is the one that used to be the second.
    hud.runEnd = { kind, depth: state.depth, earned };
  };

  /**
   * WIPE THE SAVE, on the second tap.
   *
   * Arms on the first press and only fires on the second, because there is no undo
   * behind it — `META_KEY` is the single place every banked star, owned node and
   * recorded fusion lives, and once it is gone the run history is gone with it.
   *
   * It RELOADS rather than resetting the live objects. Almost everything derived from
   * the save is read once at boot — the loadout, the derived hand size and slot count,
   * the gifted page, the texel density — so resetting in place would mean re-deriving
   * all of it correctly from here and would quietly rot the day another field joined
   * the save. The reload is the same path a first-ever launch takes, which makes "reset"
   * mean exactly "be a new player" with no second definition to keep in step.
   */
  /**
   * FREE A CAPTIVE. Once ever, per hero, across the whole save.
   *
   * Three writes and they must not come apart: the deed goes in `meta.freed` so the room stops
   * generating, the wizard goes in `meta.wizards` so they can be played, and the card comes up
   * so the player is told by the person rather than by a toast. Saved immediately — a rescue
   * lost to a crash on the way to the stairs is the worst possible thing to have to do twice,
   * because it can only be done once.
   */
  const rescue = (e: Entity): void => {
    const id = e.captiveId as WizardElement | undefined;
    const w = id ? WIZARD_BY_ID[id] : null;
    if (!w || !id || meta.freed.includes(id)) return;
    /**
     * ADJACENT AND FACING, like every other thing in this dungeon you reach out and
     * touch.
     *
     * This was the one interaction that skipped `reachRefusal`, so a captive could be
     * cut loose from across the room — or through the doorway of a room you had not
     * entered — the moment their marker could be tapped. That makes the cell free,
     * which is the opposite of what a cell is for: the walk to the cage IS the rescue,
     * and the gate, the plate and the block puzzle in front of it are the price the
     * floor charges for a wizard.
     *
     * Same refusal as the altar and the chest, in the same words, because a captive is
     * a fixture you operate and the player has already learned this sentence.
     */
    const why = reachRefusal(e, w.name.toLowerCase());
    if (why) { hud.addLog(why, 0xffcf5c); return; }
    meta.freed.push(id);
    if (!meta.wizards.includes(id)) meta.wizards.push(id);
    saveMeta(meta);
    e.alive = false;
    e.sprite.group.visible = false;
    hud.rescued = { wizard: w, by: startWizard };
    hud.addLog(`${w.name} is free.`, 0xffcf5c);
  };

  const resetProgress = (): void => {
    if (!hud.resetArmed) { hud.resetArmed = true; return; }
    try { localStorage.removeItem(META_KEY); } catch { /* private mode: nothing saved */ }
    location.reload();
  };

  const checkDeath = (): void => {
    if (state.hp > 0 || dead) return;
    engine.setDesat(0.85);
    endRun('died', state.stars);
  };

  const descend = async (): Promise<void> => {
    if (!combat.bossDead) return;
    const st = floor.entities.find((e) => e.kind === 'stairs');
    if (!st) return;
    // The stairs keep their own distance line — it is about the floor and not
    // about a step — and gain a facing one, which is a different instruction.
    if (!inReach(st)) {
      const d = Math.abs(st.sprite.tx - stepper.x) + Math.abs(st.sprite.ty - stepper.y);
      hud.addLog(d > 1 ? 'The stairs are further in.' : 'Turn to face the stairs.');
      return;
    }
    if (state.depth >= THEMES.length) {
      engine.setDesat(0.5);
      // Winning ends the run too, and it ends it holding the biggest bank the game
      // ever hands out — so it leads to the tree by the same card and the same tap.
      // Anything else makes the best outcome in the game the one dead end in it.
      // The shout and the log line this used to raise are now ON that card: neither
      // draws under it, and announcing the vault twice in two fonts read as a fault.
      endRun('won', state.stars + 25);
      return;
    }
    // NO HEAL. The stairs cost nothing and pay nothing — the HP you finish a floor on
    // is the HP you start the next one with. See the attrition section of `tuning.ts`:
    // the old descent heal grew faster with depth than any damage curve did, which made
    // going deeper a reward. Healing is something you find now, not something you are
    // handed for leaving.
    await enterFloor(state.depth + 1);
  };

  /**
   * THE FLOOR OPENED UNDER YOU. Not the same act as taking the stairs, and it must
   * not go through the same function.
   *
   * It did. `onPitfall` called `descend`, and `descend` opens with
   * `if (!combat.bossDead) return` — so a trapdoor could only ever drop somebody who
   * had already killed the boss and was standing next to a staircase they had chosen
   * not to use. Everywhere else it played the caption, shook the screen, and left the
   * player standing on a hole. The hazard was inert for the whole of its useful life
   * and the log line was the only evidence it existed, which is exactly why it read as
   * "I do not fall down the hole at all".
   *
   * Nothing is checked here on purpose. There is no boss test, because the floor
   * opening is not a reward for clearing it; there is no reach test, because you are
   * not walking to anything; and there is NO HEAL, because the descent heal is what a
   * floor pays you for finishing it and this is the opposite of finishing one. It
   * costs the altar you had not claimed, the boss you had not killed, and whatever
   * they were worth.
   *
   * The last floor has nothing under it. A trapdoor there is a hole with a cellar at
   * the bottom rather than a way on, which is what the shaft has always been drawn as.
   */
  const fallThrough = async (): Promise<void> => {
    if (state.depth >= THEMES.length) return;
    await enterFloor(state.depth + 1);
  };

  // ------------------------------------------------------------- the pixel step

  // ---------------------------------------------------------------- the star tree

  /**
   * Everything a purchase or a refund has to settle, in one place.
   *
   * The tree screen and the death-screen routing are a follow-up task; what has to
   * exist first is that buying and selling are a single transaction — derive, save,
   * and reconcile the live run with the new ceiling — so that no caller can perform
   * half of one.
   */
  /**
   * The pinned goal as the top bar wants it: a name and what the whole ROUTE costs.
   *
   * The route total and not the node's own price, because a pin on Second Servant
   * with nothing owned is a bill for five nodes, and a readout that promised ✦ 220
   * would be lying by a factor of three.
   */
  const pinReadout = (): { name: string; need: number } | null => {
    if (!meta.pinned) return null;
    return {
      name: NODE_BY_ID[meta.pinned].name,
      need: routeCost(routeTo(meta.pinned, meta.nodes)),
    };
  };

  const afterTreeChange = (): void => {
    applyTree(meta);
    saveMeta(meta);
    // The strap is as wide as the tree says and never wider. Reconciled here for the
    // reason the hand ceiling is: a refund that left the old capacity behind would
    // hand out loops nobody owns.
    syncBelt();
    // The pinned goal is a readout in the run, not just in the menu, so every
    // transaction that could move it has to refresh it.
    hud.pinGoal = pinReadout();
    // A refund can drop the ceiling below what is already torn out. Returning a
    // component is free and never punished (`docs/DESIGN.md`, Turn economy), so the
    // hand goes back in the book rather than the ceiling being quietly exceeded.
    if (fan.count > handSize()) returnHand();
    hud.bankedStars = meta.stars;
  };

  interface TreeResult {
    ok: boolean;
    reason: string | null;
    stars: number;
    owned: NodeId[];
    handSize: number;
    slots: number;
    /** Starting-book pages a refund gave up. Empty for everything but `slots4`. */
    dropped: string[];
  }

  const treeResult = (ok: boolean, reason: string | null, dropped: string[] = []): TreeResult => ({
    ok, reason, dropped,
    stars: meta.stars, owned: [...meta.nodes], handSize: meta.handSize, slots: meta.slots,
  });

  const buyNode = (id: string): TreeResult => {
    const why = buyBlocker(id, meta.nodes, meta.stars);
    if (why || !isNodeId(id)) return treeResult(false, why ?? `No such node: ${id}.`);
    meta.stars -= NODE_BY_ID[id].price;
    meta.nodes = [...meta.nodes, id];
    afterTreeChange();
    return treeResult(true, null);
  };

  /**
   * Sell a node back at exactly what it cost.
   *
   * Refused while anything that requires it is owned — see `refundBlocker` for why
   * that is the rule rather than a cascade. The one thing a legal refund can still
   * destroy is a page: selling the fourth binding gives up the fourth slot, so
   * whatever was in it is reported back rather than vanishing quietly. Only a save
   * from before the reset can have a page in there today — nothing in the game
   * writes `loadout` any more — and reporting it is still cheaper than a save that
   * loses a page without saying so.
   */
  const refundNode = (id: string): TreeResult => {
    const why = refundBlocker(id, meta.nodes);
    if (why || !isNodeId(id)) return treeResult(false, why ?? `No such node: ${id}.`);
    const before = meta.loadout;
    meta.stars += NODE_BY_ID[id].price;
    meta.nodes = meta.nodes.filter((n) => n !== id);
    afterTreeChange();
    return treeResult(true, null, before.filter((p) => !meta.loadout.includes(p)));
  };

  /**
   * The tree screen, and whether it currently owns the frame.
   *
   * It is a MODE rather than an overlay: while it is up the HUD is not drawn, not
   * hit-tested and not laid out, because a run that has ended has no controls worth
   * routing and two live hit-test surfaces on one canvas is the bug that would come
   * of drawing both.
   */
  let treeOpen = false;
  const treeScreen = new TreeScreen(() => ({
    stars: meta.stars,
    owned: meta.nodes,
    handSize: meta.handSize,
    slots: meta.slots,
    pinned: meta.pinned,
    /**
     * What a refund would cost beyond stars. Selling a slot node drops pages off
     * the front of the loadout (`applyTree`), so anything that would fall off is
     * named before the tap rather than reported after it.
     */
    atRisk: (id) => {
      const lose = meta.loadout.length - derivedSlots(meta.nodes.filter((n) => n !== id));
      return lose <= 0 ? [] : meta.loadout.slice(0, lose).map((p) => SPELL_BY_ID[p]?.name ?? p);
    },
  }));

  /** Only ever from a finished run: the tree is between runs, not inside one. */
  const openTree = (): void => {
    if (!dead || treeOpen) return;
    treeOpen = true;
    treeScreen.open();
  };

  const actTree = (a: TreeAction): void => {
    switch (a.kind) {
      /**
       * Selection is not a transaction, so it goes nowhere near `buyNode`. A tap on
       * a node fills the docked panel and nothing else; the panel's one button is
       * the only thing on the screen that spends. Clearing the message with it is
       * deliberate — a refusal is about the node you just tried, and leaving it up
       * while the panel describes a different node makes the screen contradict
       * itself.
       */
      case 'select':
        treeScreen.selected = a.id;
        treeScreen.message = null;
        sfx.pageFlip();
        break;
      case 'deselect':
        treeScreen.selected = null;
        treeScreen.message = null;
        break;
      /**
       * Pin a goal. Saved immediately, because the point of the pin is that it
       * survives into the run — and a run is reached from here by a page reload, so
       * anything not written to storage is a pin the player never sees again.
       */
      case 'pin':
        meta.pinned = a.id;
        afterTreeChange();
        // Deselected on purpose and with no message: the panel's idle state IS the
        // confirmation — it becomes the route, its node count and its running total,
        // which says more than a sentence would and says it for as long as the pin
        // lasts.
        treeScreen.selected = null;
        treeScreen.message = null;
        sfx.shimmer(520);
        break;
      case 'unpin':
        meta.pinned = null;
        afterTreeChange();
        treeScreen.message = null;
        sfx.pageFlip();
        break;
      case 'mode':
        treeScreen.mode = treeScreen.mode === 'sky' ? 'list' : 'sky';
        treeScreen.selected = null;
        sfx.pageFlip();
        break;
      case 'buy': {
        const r = buyNode(a.id);
        if (r.ok) sfx.shimmer(760);
        else sfx.deny();
        treeScreen.say(
          r.ok ? `${NODE_BY_ID[a.id].name} is yours — ✦ ${NODE_BY_ID[a.id].price} spent.`
            : r.reason ?? '',
          !r.ok,
        );
        break;
      }
      case 'sell': {
        const r = refundNode(a.id);
        if (r.ok) sfx.pageFlip();
        else sfx.deny();
        treeScreen.say(
          r.ok
            ? `${NODE_BY_ID[a.id].name} sold — ✦ ${NODE_BY_ID[a.id].price} back.`
              + (r.dropped.length
                ? ` Your book gave up ${r.dropped.map((p) => SPELL_BY_ID[p]?.name ?? p).join(' and ')}.`
                : '')
            : r.reason ?? '',
          !r.ok,
        );
        break;
      }
      /**
       * A fresh run is a RELOAD, deliberately.
       *
       * Everything a run holds lives in `boot`'s closure — the floor, the stepper,
       * the combat, the book's pages, the fan, the seed, the depth — and there is no
       * existing path that resets them together. Reloading re-reads `meta` from
       * storage, which every purchase has already written, so the reload is honest:
       * you spent, and the dungeon is new. A partial reset of half a dozen closures
       * would be the more impressive answer and the one that leaves a stale floor
       * standing.
       */
      case 'start': location.reload(); break;
      case 'none': break;
    }
  };

  await enterFloor(1);

  /**
   * THE BUNDLE RAN, so the updater may keep it.
   *
   * Fired here rather than at the top of boot because it is a liveness claim: a
   * downloaded bundle is installed optimistically and reverted unless something
   * certifies it within `appReadyTimeout`, and a call made before the first floor
   * exists certifies nothing. A floor is built, so this bundle works.
   *
   * Every boot, including boots of the copy inside the AAB — see `notifyBootOk`.
   */
  void import('./systems/liveUpdates').then(async (m) => {
    await m.notifyBootOk();
    // And ask what it is serving, so the settings stamp can disagree with itself out
    // loud when a staged bundle is not the one running. Null off-device.
    hud.bundleVersion = await m.currentBundle();
  });

  /**
   * THE MOUTH, in order: where to begin, which page, then what else.
   *
   * Depth first, because a blessing chosen before knowing which floor you land on is
   * a choice made without the information that decides it. The page second, because
   * it is the run's SUBJECT and every blessing is a comment on it — "a wider book"
   * is a second element, "a deeper page" is the one you just chose at rank 2, and
   * both are unreadable until the player knows what they are holding.
   *
   * Runs AFTER `engine.start()` and is deliberately not awaited here. It blocks on
   * the player answering a modal, and the modal is drawn by the render loop — so
   * awaiting it during boot deadlocks: the chooser cannot be seen, so it cannot be
   * answered, so the loop it is waiting for never starts. That is exactly what it did
   * the first time, and it bricked every save with a deep start unlocked.
   */
  const openTheMouth = async (): Promise<void> => {
    let owed = false;
    if (offerStartDepth()) {
      await waitForChoice();
      if (startDepth > 1) {
        await enterFloor(startDepth);
        grantCatchUp();
        owed = true;
      }
    }
    /**
     * The page comes before the owed rites and not after, because a rite is a draw
     * against the BOOK: `rollAltarOffers` offers ranks on pages you hold and new
     * pages you do not, and an empty grimoire gives it nothing to deepen. A deep
     * starter used to be handed three rank-ups for a book that did not exist yet.
     */
    if (offerStartPage()) await waitForChoice();
    if (owed) await payCatchUp();
    if (offerBlessings()) await waitForChoice();
    /**
     * NOW the book rises — every question that can put a page in it has been
     * answered. It used to play at boot, which meant it leafed itself open on a
     * Flame the player had not chosen and could not yet have: the fallback page
     * `setBookPages` shows an empty grimoire. Rising last also means the intro's
     * flip cascade is honest, because a blessing that widened the book has already
     * widened it, and a book of one does not flip at all (`Book.canFlip`).
     */
    book.playIntro();
  };

  // ------------------------------------------------------------------- the loop

  /**
   * FREE LOOK and the ENEMY LEAN — two view-only yaw offsets. See where they are
   * applied for why neither may touch `stepper.dir`.
   *
   * The peek is driven by the live drag in the world area, which is a channel that was
   * genuinely free: a one-finger drag up there resolves entirely on RELEASE (see the
   * `pointerup` swipe), and `pointermove` returned early for anything that did not
   * start on the book. So peeking costs the movement gesture nothing — the same drag
   * that looks around still steps or turns when you let go of it.
   *
   * Capped small on purpose. A look that could reach behind you would make facing
   * ambiguous, and facing is the thing the reticle is a promise about.
   */
  const PEEK_YAW_MAX = 0.40;      // ~23 degrees
  const PEEK_PITCH_MAX = 0.13;    // ~7.5 degrees
  /** Screen px of drag that reaches the cap. */
  const PEEK_SPAN = 220;
  const PEEK_EASE = 11;
  /**
   * THE LEAN, and it is meant to be seen.
   *
   * It was ~6 degrees taken at a third of the angle, which is a lean you can only find
   * by looking for it — the head barely moved and the tell it exists to give was doing
   * no work. 16 degrees at 0.6 of the angle is a head genuinely turning toward the
   * thing, and the ease is faster so it arrives while the body is still worth looking
   * at rather than drifting there over most of a second.
   *
   * The cap is still a cap, and this is what bounds it: the camera's yaw is
   * `stepper.yaw() + peekYaw + enemyLean`, and the targeting cone is 45 degrees to the
   * side (`side > ahead` in `targetsInView`). A full lean stacked on a full peek is
   * ~39 degrees, so the camera can still never point at something it is not allowed to
   * put a reticle on. That is the invariant to hold if these are pushed further.
   */
  const LEAN_MAX = 0.28;          // ~16 degrees
  const LEAN_EASE = 6;
  /** How much of the angle to a body the camera actually takes. */
  const LEAN_FRAC = 0.6;

  let peekYaw = 0, peekPitch = 0, peekYawTarget = 0, peekPitchTarget = 0;
  let enemyLean = 0;
  /** Latched while the FOV knob is held, so a drag off the track keeps the grab. */
  let fovDrag = false;

  /**
   * The sign every gesture is read through — see `Meta.invertGestures`.
   *
   * A function and not a captured constant, because the setting is togglable mid-run and a
   * value read once at boot would leave the checkbox lying until the next reload.
   */
  const gsign = (): number => (meta.invertGestures ? -1 : 1);

  /**
   * The one writer for field of view. Camera, save and HUD in the same call, because
   * three places holding the number is three places for it to disagree — and the one
   * that would have gone stale silently is the HUD, which draws the knob.
   *
   * Saves on every change rather than on release. A slider is dragged and then the
   * player goes back to playing; there is no "done" event to hang a write on, and
   * `saveMeta` is a single small `setItem`.
   */
  const setFov = (deg: number): void => {
    meta.fov = clampFov(deg);
    engine.setFov(meta.fov);
    hud.fov = meta.fov;
    saveMeta(meta);
  };

  /** Signed shortest way round from a to b, in radians. */
  const angleDelta = (a: number, b: number): number => {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  };

  /**
   * Where the lean wants to be: a fraction of the angle to the nearest hostile the
   * player can SEE, clamped, and zero when there is nothing to lean at.
   *
   * Nearest rather than most dangerous, because the lean is answering "what is at my
   * shoulder" and not "what should I worry about" — the second is the player's job and
   * a camera with an opinion about it would be arguing with them.
   *
   * FOUR CLAUSES, and the last one is the one that makes the other three safe:
   *
   *  - ANY hostile, not only an ALERTED one. Waking up is the creature's business, and
   *    gating the camera on it meant the head never turned toward the thing you were
   *    walking into, only toward the thing already coming for you. A sleeper you can
   *    see is exactly what a glance is for.
   *  - ACTUALLY BEING DRAWN. `sprite.group.visible` is set by `Floor.cull` off
   *    `visibleTiles`, and it is the game's one answer to "is this on screen" — the
   *    outline pass and the minimap both ask it, so a body the camera leans at is a
   *    body with a sprite and a dot. It is STRICTER than a clear line and that is the
   *    whole point: `clearLine` is permissive at corners and knows nothing about the
   *    corridor-and-room rule, so it passes bodies standing round the far side of a
   *    wall the player is looking straight down. Two attempts at this clause missed,
   *    both by inventing a new test instead of asking the one that already decides
   *    what gets rendered.
   *  - AT TARGETABLE RANGE. `THREAT_REACH + 2` is four tiles: the lean only existed
   *    once something was nearly on top of you. `ENGAGE_RADIUS` is the distance the
   *    game already calls "close enough to matter".
   *  - AND IN FRAME. Being drawn is not the same as being in the picture: the cull is
   *    about the floor's geometry and says nothing about where the lens points. The
   *    frame edge is DERIVED rather than written down, because the field of view is a
   *    setting the player drags — `camera.fov` is vertical, the frame is portrait, and
   *    the horizontal half-angle falls out of the aspect (~25 degrees at the default
   *    90). This is also why the 45-degree targeting cone was the wrong bound to
   *    borrow: a reticle can sit on things well outside the picture.
   *
   * The frame angle is measured off `stepper.yaw()` and not off the live camera,
   * deliberately: the lean IS part of the camera's own yaw, so gating it on where the
   * camera currently points would feed back on itself — leaning a body into frame
   * would keep it qualifying, and leaning one out would drop it. Facing is the stable
   * thing to ask.
   */
  const leanTarget = (): number => {
    // Horizontal half-FOV: hfov/2 = atan(tan(vfov/2) * aspect).
    const edge = Math.atan(
      Math.tan((engine.camera.fov * Math.PI) / 360) * (engine.rw / engine.rh),
    );
    let bestOff = 0;
    let bestD = Infinity;
    for (const e of floor.entities) {
      if (!e.alive || !e.hostile || !e.sprite.group.visible) continue;
      const dx = e.sprite.tx - stepper.x, dz = e.sprite.ty - stepper.y;
      if (!dx && !dz) continue;
      const d = Math.abs(dx) + Math.abs(dz);
      if (d > ENGAGE_RADIUS || d >= bestD) continue;
      // Forward is (-sin yaw, -cos yaw) — see `Stepper.eye`, where the pullback pushes
      // the eye BACKWARD along (+sin, +cos). So the yaw facing an offset is atan2(-dx,-dz).
      const off = angleDelta(stepper.yaw(), Math.atan2(-dx, -dz));
      /**
       * Against the body's OWN WIDTH, not against its centre.
       *
       * A tile is a unit across, so it subtends 27 degrees at one pace and six at five.
       * Testing the centre alone was wrong in precisely the case that matters most: a
       * body closing on you gets larger and more obviously on screen while its centre
       * swings OUTSIDE the frustum, so the lean cut out at the moment the thing
       * arrived — target it, hit it, watch it step in, and the camera lets go of it
       * while it is still plainly there at the edge of the picture.
       *
       * Measured: a body one pace ahead and one to the side has its centre 45 degrees
       * off, outside a 38-degree half-frame, and is unmistakably in shot.
       */
      const half = Math.atan(0.5 / Math.max(0.5, Math.hypot(dx, dz)));
      if (Math.abs(off) - half > edge) continue;
      bestD = d; bestOff = off;
    }
    return Math.min(LEAN_MAX, Math.max(-LEAN_MAX, bestOff * LEAN_FRAC));
  };

  engine.onUpdate = (dt) => {
    /**
     * The tree's own clock. It has exactly two moving things — an affordable node's
     * breath and the pinned route's spark — and no other surface in the game needs a
     * tick that the HUD's does not already provide. Additive rather than an early
     * return: the world behind the tree is hidden by an opaque fill, not torn down,
     * and stopping its update while the screen is up would be a second code path
     * through the loop for no visible gain.
     */
    if (treeOpen) treeScreen.update(dt);
    // hitstop: freeze the world briefly on impact, but keep the UI ticking
    const scale = fx.hitstop > 0 ? 0.12 : 1;
    const wdt = dt * scale;

    stepper.update(wdt);
    stepper.eye(eye, engine.time);

    /**
     * THE PEEK, eased toward whatever the live drag is asking for and back to zero the
     * moment the finger leaves.
     *
     * Eased rather than assigned so that letting go SPRINGS BACK instead of cutting —
     * a hard snap to centre on release reads as a bug, and the return is the half of
     * the gesture that tells you the look was borrowed rather than a turn. Both ends go
     * through the same lerp for that reason: there is one motion here, not a drag and a
     * separate animation.
     */
    peekYaw += (peekYawTarget - peekYaw) * Math.min(1, wdt * PEEK_EASE);
    peekPitch += (peekPitchTarget - peekPitch) * Math.min(1, wdt * PEEK_EASE);

    /**
     * THE LEAN toward whatever is closest and awake.
     *
     * Deliberately tiny (`LEAN_MAX`, about six degrees) and deliberately NOT a look-at:
     * it takes a fraction of the angle to the body, so a creature at your shoulder
     * nudges the frame enough to bring it into view without the camera ever appearing
     * to act on its own. A full look-at would be the camera playing the game.
     *
     * Only ALERTED bodies pull. A sleeping creature across the room is scenery, and a
     * camera that drifted toward it would be telling the player something the game has
     * decided they do not know yet.
     */
    enemyLean += (leanTarget() - enemyLean) * Math.min(1, wdt * LEAN_EASE);

    /**
     * THE CUT: a brief look at the door you just opened, then straight back.
     *
     * The one scripted camera move in the game, and it is allowed to exist for one
     * reason — the player DID something and the result is somewhere they are not
     * looking. It is the exact opposite of a framing that drifts on its own, which
     * `First_Minutes` settled against and this does not reopen: it is triggered by an
     * action, it is under a second, and it hands control back to exactly the eye the
     * stepper was going to produce anyway.
     *
     * The eye does not travel. It stays where the player is standing and only the
     * LOOK turns, which keeps the cut cheap, keeps the player oriented, and means
     * there is nothing to restore when it ends — the position was never taken away.
     */
    /**
     * FALLING. Runs before the cut and before the stepper's own eye, because while it
     * lasts it OWNS the camera and nothing else may have an opinion about it.
     *
     * The drop accelerates — t squared, which is what falling is — and the light goes
     * with it: exposure down to nothing over the same second and a half, so the room
     * does not just recede, it stops being lit. The last thing visible is the lip of
     * the pit going up past you.
     *
     * When it lands there is no landing. The eye is left where the fall left it and
     * the exposure is left at zero, and THAT is the state the death card opens over.
     * Putting either of them back is the game telling the player it did not mean it.
     */
    if (plunge) {
      plunge.t += dt;
      const u = Math.min(1, plunge.t / PLUNGE_T);
      stepper.eyeHeight = plunge.from - 26 * u * u;
      // the shaft closes over you before the screen does
      engine.setExposure(Math.max(0, 1 - u * u * 1.35));
      if (u >= 1) {
        plunge = null;
        state.hp = 0;
        checkDeath();
      }
    }

    if (cine) {
      cine.t += dt;
      const ease = (k: number): number =>
        (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

      let k = 1;
      /**
       * The LOOK's own progress, ahead of the move's. See `CINE_LOOK`: the turn
       * is over the front of the flight and finished before it, never spread across
       * the whole of it.
       */
      let kLook = 1;
      /** How hard the camera is trembling right now. Only the grind produces any. */
      let rumble = 0;
      if (cine.phase === 'out') {
        k = ease(Math.min(1, cine.t / cineMove));
        kLook = ease(Math.min(1, cine.t / CINE_LOOK));
        if (cine.t >= cineMove) {
          cine = { phase: 'beat', t: 0, onArrive: cine.onArrive, onOpen: cine.onOpen };
        }
      } else if (cine.phase === 'beat') {
        /**
         * PARKED, AND NOTHING IS HAPPENING. Read the shut door.
         *
         * There is deliberately no motion in this phase at all — not a slow push in,
         * not a settle. The player has just been flown somewhere they were not, and
         * the first thing they have to do is work out what they are looking at. Any
         * movement here would be answered before the question landed.
         */
        if (cine.t >= CINE_BEAT) {
          const arrived = cine.onArrive;
          cine = { phase: 'open', t: 0, onOpen: cine.onOpen };
          // The rule flips now; the PICTURE takes the next two and a half seconds.
          arrived?.();
        }
      } else if (cine.phase === 'open') {
        /**
         * THE GRIND. A ton of iron on a winch, and the camera feels it.
         *
         * The lift is linear rather than eased, because a portcullis on a chain does
         * not accelerate — the winch turns at the speed the winch turns. The tremble
         * runs the whole way and dies at the top, so the shot ends on stillness
         * instead of ending on a cut.
         */
        const u = Math.min(1, cine.t / CINE_OPEN);
        cine.onOpen?.(u);
        rumble = u < 1 ? 0.5 + 0.5 * Math.sin(u * Math.PI) : 0;
        if (cine.t >= CINE_OPEN + CINE_SETTLE) {
          cine = { phase: 'hold', t: 0 };
          // Only NOW is there anything to skip — and only now is it offered.
          hud.cinePrompt = 'TAP TO CONTINUE';
        }
      } else if (cine.phase === 'back') {
        k = 1 - ease(Math.min(1, cine.t / cineMove));
        // The outward turn, reversed: it happens at the END of the move rather than
        // the start, so the lag is everything the turn does not need.
        const lag = cineMove - CINE_LOOK;
        kLook = 1 - ease(Math.min(1, Math.max(0, cine.t - lag) / CINE_LOOK));
        if (cine.t >= cineMove) { cine = null; hud.cinema = false; hud.cinePrompt = null; }
      }

      if (cine) {
        // Along the pathfound route, not through the wall between here and there.
        cineWalk(k, engine.camera.position);
        /**
         * The tremble is added AFTER the vantage and is deliberately tiny — a couple
         * of centimetres and a hair of roll. Screen shake at the scale the game uses
         * for a fireball would read as an earthquake; what this has to read as is a
         * heavy thing moving somewhere near you.
         */
        if (rumble > 0) {
          engine.camera.position.x += Math.sin(engine.time * 43) * 0.018 * rumble;
          engine.camera.position.y += Math.sin(engine.time * 57 + 1.1) * 0.022 * rumble;
        }
        /**
         * The look SWINGS, on the same curve as the move.
         *
         * `lookAt` writes the orientation that faces the subject; the slerp then puts
         * the camera a fraction of the way there, so at k=0 it is still looking
         * exactly where the player is looking and at k=1 it is on the door. Taking
         * the target from the real camera rather than from a probe object is
         * deliberate: `Object3D.lookAt` points +Z at the subject and a CAMERA's points
         * -Z, so a stand-in would have come out backwards.
         */
        engine.camera.lookAt(cineAt);
        cineToQ.copy(engine.camera.quaternion);
        engine.camera.quaternion.slerpQuaternions(cineFromQ, cineToQ, kLook);
        if (rumble > 0) engine.camera.rotation.z += Math.sin(engine.time * 31) * 0.007 * rumble;
        // The world still has to tick — a frozen room behind a moving camera reads as
        // a screenshot, and the door the cut exists to show is opening right now.
        floor.update(wdt, engine.time, engine.camera.position);
        fx.update(dt, engine.camera.quaternion);
        stunView.update(dt, stunned(), engine.camera.quaternion);
        return;
      }
    }

    // screen shake, applied as a positional jitter + roll
    const s = fx.shake * fx.shake;
    const jx = Math.sin(engine.time * 61) * 0.05 * s;
    const jy = Math.sin(engine.time * 47 + 1.7) * 0.05 * s;
    engine.camera.position.set(eye.x + jx, eye.y + jy, eye.z);
    /**
     * FACING PLUS TWO OFFSETS, and the offsets are VIEW ONLY.
     *
     * `stepper.yaw()` is the game state — `inReach`, `targetsInView` and every reticle
     * in the game are computed off `stepper.dir`, so the peek and the lean must never
     * write to it. Turning your head is not turning around: you can lean far enough to
     * see a body and still not be allowed to cast at it, which is the honest reading of
     * a game where facing is a move you spend a turn on.
     */
    engine.camera.rotation.set(
      PITCH + peekPitch,
      stepper.yaw() + peekYaw + enemyLean,
      stepper.roll() + jx * 0.6,
      'YXZ',
    );

    floor.update(wdt, engine.time, eye);
    fx.update(dt, engine.camera.quaternion);
    stunView.update(dt, stunned(), engine.camera.quaternion);
    /**
     * The grimoire's visibility, applied. `Book.closed` is a plain field and the book
     * animates its own glide from it (`closeT`), so driving it from derived state gets
     * the slide for free — and reading it back into the HUD in the same breath is what
     * stops the layout and the geometry from ever describing different books.
     *
     * Held while the book is BUSY, which covers the intro: the rise-and-cascade is the
     * game's opening beat and it also gives `frameAbove` below its one settled
     * measurement to latch onto, after which the book may come and go without the world
     * moving under it.
     */
    if (!book.busy) book.closed = !bookOnScreen();
    /**
     * THE BELT FOLLOWS THE BOOK, and the portrait's override lasts until the book
     * itself next moves.
     *
     * Without the reset, one tap on the portrait would pin the belt open or shut for
     * the rest of the run and the two pieces of furniture would stop agreeing. With it,
     * the override is a decision about NOW — hold the pouches open while you walk this
     * corridor — and opening the book puts the pair back in step.
     */
    if (book.closed !== bookWas) { hud.beltWanted = null; bookWas = book.closed; }
    hud.bookClosed = book.closed;
    hud.bookBusy = book.busy;
    hud.compassGoal = compassGoal();
    tickBook(dt, engine.time);
    // Lay the HUD out against the book's real edge too, so the cast bar and the
    // swipe boundary never disagree.
    const top = book.screenTop();
    hud.setBookTop(top);
    /**
     * The camera's framing is a CONSTANT and is never measured — see `FRAME_SHIFT`
     * in `engine.ts`. This is where a measurement used to live: it read the book's
     * resting top edge, waited for two frames to agree, and shifted the frustum, so
     * the world moved the first time the grimoire settled. `Roadmap/First_Minutes.md`
     * is specific that whatever the framing is at the dungeon mouth is what it is for
     * the rest of the run.
     */
    // The fusion ceiling, on screen. Nothing else in the game states it, and at a
    // hand of one the player would otherwise only ever meet it as a refusal.
    hud.handSize = handSize();
    // The minimap is free forever; the chart and its pin are what the tree sells.
    hud.hasChart = derivedHasChart(meta.nodes);
    hud.handHeld = fan.count;
    // The fan's cards, projected so one of them can be tapped back. Nothing while the
    // hand is merging: a card already flying into the cast cannot be taken back, and
    // the fan cannot un-merge.
    fan.capacity = Math.max(handSize(), 1);
    hud.handCards = fan.busy ? [] : handCardBoxes();
    hud.emptySlots = fan.busy ? [] : emptySlotBoxes();
    // Named on the page it belongs to, so "not learned" never has to share a
    // channel with "hand full".
    // `revealed` first: before the mouth's page question is answered the book is
    // showing `setBookPages`' fallback page, which the player does not hold and has
    // not been offered, so "that page is sealed" would be scolding them for a page
    // that is not theirs to have yet.
    hud.sealedPage = book.revealed && !book.closed
      && !state.pages.includes(book.currentSpell.gameId)
      ? book.currentSpell.name
      : null;
    hud.update(dt);
  };

  engine.onRender = (ctx) => {
    if (treeOpen) treeScreen.draw(ctx, engine.sw, engine.sh);
    else hud.draw(ctx);
  };

  // ---------------------------------------------------------------------- input

  /**
   * The one legality question `Combat.preview` cannot answer: animating depends on
   * the tapped body being something `Floor` will actually raise, and that is the
   * only way `combat.cast` can still refuse a cast the preview passed.
   */
  const wakeRefusal = (dry: ResolvedCast | null): string | null => {
    if (dry?.output !== 'golem') return null;
    const t = hud.target;
    // A tile is never furniture, so an animate cast aimed at burning ground is
    // refused here with the same sentence a creature gets.
    // The same test `Floor.animateProp` applies, because these two disagreeing is
    // precisely what the reticle's promise must never do — a spent chest is furniture.
    if (t && !isTileTarget(t) && t.alive && !t.animated && t.golemId
      && (t.kind === 'prop' || (t.kind === 'chest' && t.spent))) {
      return null;
    }
    return 'Nothing there will wake. Aim it at furniture.';
  };

  const doCast = async (): Promise<void> => {
    if (busy || dead || fan.busy) return;
    // Capture the ids first: the merge animation clears the fan on completion.
    const ids = fan.gameIds;
    if (!ids.length) return;

    // EVERY reason this cast could fail has to be found here, before the merge.
    // The merge animation empties the fan from inside itself and the fan cannot
    // un-merge, so a refusal discovered afterwards is a component lost to nothing —
    // and losing a component to anything but a cast or a return is the one thing
    // this phase forbids outright.
    const dry = hud.currentCast();
    const refusal = dry?.refusal ?? wakeRefusal(dry);
    if (refusal) {
      combat.onEvent({ kind: 'deny', text: refusal });
      sfx.deny();
      return;
    }

    busy = true;
    try {
      // The torn pages converge and merge in a burst of gold, THEN the spell fires.
      await new Promise<void>((resolve) => fan.mergeAndCast(resolve));
      sfx.cast(dry ? 200 + (dry.colour & 255) : 300);
      // THE price. `Combat.cast` runs the enemy round itself, so this await is the
      // turn — and a false here means the check above missed something and the hand
      // is already gone, which must not be swallowed or the two ends of the contract
      // drift apart again. A false also means no round ran, which is correct: a
      // refused cast is not a spent turn.
      if (!await combat.cast(ids, hud.target)) {
        hud.addLog('The cast comes apart in your hands.', 0xff9a6a);
      } else {
        // The one place a vial is destroyed: the spell has gone off. A refused cast
        // never reaches here, which is how "consumed only on cast" is a structural
        // fact rather than a rule someone has to remember at four call sites.
        consumeIngredients(ids);
      }
    } finally {
      // A throw anywhere above used to leave `busy` true forever, which locks every
      // gesture in the game — including the ones that would let you walk away.
      busy = false;
      refreshTargets();
      checkDeath();
    }
  };

  const act = (a: ReturnType<Hud['hit']>): void => {
    /**
     * A CUT SWALLOWS THE TAP THAT ENDS IT, and every other tap while it plays.
     *
     * First, so nothing underneath can act on a gesture the player meant for the
     * cutscene — this is the whole of "cannot be interrupted": the camera finishes
     * its move, the tap that releases the hold does nothing else, and the world does
     * not receive input it would have to undo.
     */
    if (cine) { cineRelease(); return; }

    // Before the finished-run branch: the pixel chip is the one control on this screen
    // that is not about the run, so a run that has ended must not swallow it on its way
    // to the tree.
    if (dead) {
      /**
       * A finished run has exactly one way on: the star tree, where the stars it
       * just banked are spent. Any tap takes it — the run-end card's button (a
       * `tree` action) is the affordance, not the only route, which is why there is
       * no case for it below.
       */
      openTree();
      return;
    }
    switch (a.kind) {
      case 'cast': void doCast(); break;
      case 'clear': hud.clearSelection(); break;
      case 'target':
        /**
         * A tile is only ever a target — none of the furniture gestures below can
         * apply to one, so it short-circuits them all.
         *
         * AND TAPPING IT AGAIN PUTS IT BACK DOWN. A ground target was a one-way door:
         * once the reticle was on a patch of floor the only ways off it were to cycle
         * round every other candidate or to cast, so a misplaced tap committed the
         * player to a tile they did not want. Tapping a thing to pick it up and
         * tapping it again to drop it is what every other toggle in this game does.
         *
         * TILES ONLY, deliberately. A body is the thing you are in a fight with, and
         * the tap that lands on it in the middle of one has to mean "that one" every
         * single time — a second tap silently clearing the reticle is a cast that does
         * not happen at the moment the player most needs it to.
         */
        if (isTileTarget(a.entity)) {
          hud.target = sameTarget(hud.target, a.entity) ? null : a.entity;
          break;
        }
        if (a.entity.kind === 'altar') { takeFromAltar(a.entity); break; }
        if (a.entity.kind === 'chest' && !a.entity.spent) { openChest(a.entity); break; }
        // The stairs are a door, not a target. Tapping them is the same gesture as
        // tapping an altar or a chest — the thing under your finger is the thing you
        // meant, and selecting a staircase to cast at it was never useful.
        if (a.entity.kind === 'stairs') { void descend(); break; }
        /**
         * A LEVER IS THROWN BY TAPPING IT, like every other fixture in the room.
         *
         * It shipped as a tile you stood on, which was wrong twice over: you cannot
         * point at a thing you are standing on, and standing on something is not how
         * anything else in this game is operated. An altar, a chest and a staircase
         * are all "the thing under your finger is the thing you meant", and a lever
         * is a thing you pull.
         */
        if (a.entity.kind === 'lever') { throwLever(a.entity); break; }
        /**
         * A CAPTIVE IS TAPPED, NOT AIMED AT.
         *
         * Routed here rather than through a separate reticle rule, because the reticle already
         * decides what is in front of you and a second system deciding it again is how the
         * crossed-out-but-castable furniture bug happened. A body you can free is simply a
         * target whose tap means something other than "aim".
         */
        if (a.entity.kind === 'captive') { rescue(a.entity); break; }
        hud.target = a.entity;
        break;
      /**
       * The chart, and the waypoint on it.
       *
       * Opening it clears nothing: the pin survives being looked at, closed, and looked
       * at again, because it is a decision the player made about the floor rather than a
       * mode they are in.
       */
      case 'chart': hud.chartOpen = !hud.chartOpen; break;
      case 'waypoint': {
        const at = hud.waypoint;
        // Tapping the pin again clears it — the same toggle a tile target already is.
        hud.waypoint = at && at.x === a.x && at.y === a.y ? null : { x: a.x, y: a.y };
        hud.addLog(hud.waypoint ? 'Marked.' : 'Mark cleared.', 0x8ce0ff);
        break;
      }
      case 'cycle': cycleTarget(); break;
      case 'bestiary': hud.bestiaryOpen = !hud.bestiaryOpen; break;
      /**
       * Toggling ALWAYS disarms the reset row. A panel reopened later must not still
       * be holding a tap from a minute ago, or the second half of a confirmation the
       * player abandoned lands on whatever they press first next time.
       */
      case 'settings':
        hud.settingsOpen = !hud.settingsOpen;
        hud.resetArmed = false;
        break;
      case 'resetProgress': resetProgress(); break;
      case 'invertGestures':
        meta.invertGestures = !meta.invertGestures;
        hud.invertGestures = meta.invertGestures;
        saveMeta(meta);
        break;
      // Looking is free and picking is not, which is why they are two actions. A tap on a
      // face used to START A RUN, and a roster you can begin a run by brushing is a roster
      // nobody reads.
      case 'wizardPeek': {
        hud.rosterPeek = WIZARD_BY_ID[a.id] ?? null;
        const sp = SPELL_BY_ID[a.id];
        hud.startSpell = sp ? { name: sp.name, effect: sp.effect } : null;
        hud.startCard = sp ? {
          kind: 'startPage', id: a.id, name: sp.name, tag: '', colour: sp.colour,
          detail: sp.effect, cost: null, amount: 0, rank: 1, toRank: 0,
          maxRank: MAX_RANK, golden: false,
        } : null;
        break;
      }
      case 'wizardBack': hud.rosterPeek = null; break;
      case 'wizardPick': pickWizard(a.id); break;
      case 'rescue': rescue(a.entity); break;
      case 'rescueDone': hud.rescued = null; break;
      case 'altar': takeFromAltar(a.entity); break;
      case 'harvest': harvestFrom(a.entity); break;
      case 'belt':
        // A plain tap draws one out — the cheap repeat of the swipe. Long-press is what
        // opens the panel, and that is decided in the pointer handler, not here.
        takeIngredient(a.id);
        break;
      /**
       * THE PORTRAIT IS THE BELT'S HANDLE. It overrides the book-follows default until
       * the book itself next moves, so a player who wants the pouches while walking can
       * have them and is not fighting the automatic behaviour to keep them.
       */
      case 'beltToggle':
        hud.beltWanted = !(hud.beltWanted ?? !hud.bookClosed);
        break;
      case 'beltOpen':
        hud.beltPanel = a.index;
        // Defaulted to the whole stack, because making room is the common case.
        hud.beltDropAmount = state.belt.slots[a.index]?.count ?? 0;
        break;
      case 'beltClose': hud.beltPanel = null; break;
      case 'beltAmount': hud.beltDropAmount = a.n; break;
      case 'beltMove': {
        const from = hud.beltPanel;
        if (from === null) break;
        if (beltMove(state.belt, from, a.to)) {
          // The panel follows the stack it was opened on: after a merge the pouch may
          // be gone, and a panel pointing at nothing closes rather than showing a hole.
          hud.beltPanel = state.belt.slots[a.to] ? a.to : null;
          hud.beltDropAmount = state.belt.slots[a.to]?.count ?? 0;
        }
        break;
      }
      case 'beltDrop': {
        const at = hud.beltPanel;
        if (at !== null) void dropFromPouch(at, a.n);
        break;
      }
      /**
       * A tap on a held card STOWS it, and never destroys it. If no pouch can take it
       * the component stays in the hand and the belt says why — see `stowComponent`.
       * With no belt at all this falls back to what it always did: put the page back.
       */
      case 'card':
        if (BELT_ENABLED && state.belt.capacity > 0 && pouchable(fan.gameIds[a.index] ?? '')) {
          stowComponent(a.index);
        } else {
          returnComponent(a.index);
        }
        break;
      case 'offer': chooseOffer(a.offer); break;
      case 'chest': openChest(a.entity); break;
      case 'move': stepper.press({ kind: 'move', m: a.m }); break;
      case 'turn': stepper.press({ kind: 'turn', d: a.d }); break;
      case 'descend': void descend(); break;
      default: break;
    }
  };

  const stage = document.getElementById('stage') as HTMLElement;
  let st = 0;
  /** How long a press has to be held on a pouch before its panel opens. */
  const LONG_PRESS_MS = 340;
  /** The pouch a press started on, so the belt keeps the gesture. */
  let beltGrab: { index: number; id: string } | null = null;
  /** Pending long-press timer, cleared by movement or release. */
  let longPress = 0;
  const cancelLongPress = (): void => {
    if (longPress) { clearTimeout(longPress); longPress = 0; }
  };
  /**
   * Gesture routing. The grimoire owns the bottom third of the screen: drags
   * there flip and tear pages. Above it, drags move the player and taps hit the
   * HUD or select a target.
   */
  // Swipe is the only movement input: left/right turns, up/down steps. The book
  // owns the screen BELOW ITS OWN TOP EDGE while open — measured from the book's
  // projected geometry, not guessed, so the swipe zone and the visible cover line
  // up exactly.

  let onBook = false;
  let px0 = 0, py0 = 0, lastT = 0, lastX = 0, vx = 0;
  /**
   * The tree screen's drag, which is a SCROLL and not a gesture.
   *
   * It is the one scrollable surface in the game — twelve cards do not fit on a
   * phone — so it needs its own pointer branch rather than a share of the dungeon's:
   * `treeMoved` is what separates a drag from a tap, and without it every scroll
   * ends by buying whatever card the thumb came to rest on.
   */
  let treeDown = false, treeY0 = 0, treeScroll0 = 0, treeMoved = 0;
  /** Latch so one refused tear makes one sound, not one per pointermove. */
  let deniedThisDrag = false;

  /**
   * The second movement hand: two fingers, mirroring WASD.
   *
   * Two is the only channel left. One finger above the book turns and steps, one
   * finger on the book leafs and tears, and the book is most of the bottom of the
   * screen — so a second hand that worked anywhere had to be a second FINGER. The
   * pair is therefore read before `overBook` gets a look in, and a first finger
   * that had already started leafing gives the page back when the second lands.
   */
  const touches = new Map<number, { x: number; y: number }>();
  let two: { ids: [number, number]; cx0: number; cy0: number; spread0: number } | null = null;
  /** Latched while a two-finger contact is live, so its releases fire nothing else. */
  let twoClaimed = false;
  /** Centroid travel a two-finger drag needs before it is a drag and not a tap. */
  const TWO_MIN = 26;

  const twoBegin = (): void => {
    const ids = [...touches.keys()];
    if (ids.length !== 2) { two = null; return; }
    const a = touches.get(ids[0])!, b = touches.get(ids[1])!;
    two = {
      ids: [ids[0], ids[1]],
      cx0: (a.x + b.x) / 2, cy0: (a.y + b.y) / 2,
      spread0: Math.hypot(a.x - b.x, a.y - b.y),
    };
  };

  /**
   * Resolve the pair on the first release. The fingers rarely agree, so the
   * gesture is their average — and a pinch is rejected by comparing how far they
   * moved relative to EACH OTHER against how far they moved together. That has to
   * be the test rather than a centroid-only one, because two fingers pinching
   * never keep their midpoint perfectly still.
   */
  const twoEnd = (): void => {
    const g = two;
    two = null;
    if (!g) return;
    const a = touches.get(g.ids[0]), b = touches.get(g.ids[1]);
    if (!a || !b) return;
    const dx = (a.x + b.x) / 2 - g.cx0, dy = (a.y + b.y) / 2 - g.cy0;
    const dist = Math.hypot(dx, dy);
    if (dist < TWO_MIN) return;
    if (Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - g.spread0) > dist) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      // Same flip, for the same reason — the two-finger side-step has to agree with the
      // one-finger turn or the two hands disagree about which way left is.
      stepper.press({ kind: 'move', m: dx * gsign() < 0 ? 'right' : 'left' });
    } else {
      // Flipped with the one-finger swipe below — the two hands must not disagree about
      // which way forward is.
      stepper.press({ kind: 'move', m: dy * gsign() < 0 ? 'back' : 'forward', compound: true });
    }
  };

  const local = (e: PointerEvent): { x: number; y: number } => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** UI actions that are explicit controls — these always beat a page gesture. */
  /**
   * `belt` is in here for a reason worth stating: the strip is drawn UNDER the
   * grimoire, which means every pouch sits inside the book's gesture zone. Without
   * this, a tap on a pouch is a page flip.
   *
   * `card` is the other way round and belongs here for the CAST pill's reason rather
   * than the belt's: the fan sits ABOVE the book's top edge, so `overBook` does not
   * claim it — but the lowest card is only ~80px clear of that edge, and the grace
   * band plus the jitter in a real tap is exactly how a cancel becomes a page flip.
   */
  const UI_CONTROLS: ReadonlySet<string> = new Set([
    'cast', 'clear', 'descend', 'cycle', 'altar', 'chest', 'harvest',
    'belt', 'card', 'tree', 'bestiary', 'settings', 'resetProgress',
    'wizardPeek', 'wizardPick', 'wizardBack', 'invertGestures', 'rescue', 'rescueDone',
    // The belt's own controls, for the reason the whole set exists: these sit over the
    // world and the book, and a tap that leaked past them would step the player.
    'beltToggle', 'beltOpen', 'beltClose', 'beltMove', 'beltDrop', 'beltAmount',
  ]);

  /**
   * Is this pointer position a book gesture rather than a dungeon gesture?
   *
   * A HUD control wins outright, wherever it sits. The CAST pill lives right on
   * the book's top edge, so without this a tap a few pixels low was claimed by the
   * book and the natural jitter in a tap turned into a page flip.
   */
  const overBook = (x: number, y: number): boolean => {
    if (hud.offers) return false;          // the offer modal owns every tap
    if (book.closed) return false;
    if (UI_CONTROLS.has(hud.hit(x, y).kind)) return false;
    if (book.ribbonAt(x, y) !== null) return true;
    // a couple of px of grace so the very edge of the cover still grabs
    return y > book.screenTop() - 4;
  };

  stage.addEventListener('pointerdown', (e) => {
    sfx.unlock();                       // browsers gate audio behind a gesture
    const { x, y } = local(e);
    touches.set(e.pointerId, { x, y });
    if (treeOpen) {
      treeDown = true; treeY0 = y; treeScroll0 = treeScreen.scroll; treeMoved = 0;
      return;
    }
    if (touches.size >= 2) {
      twoClaimed = true;
      // The first finger may already be mid-leaf. Two fingers means it was never a
      // page gesture, so the page is put back rather than committed.
      if (onBook) { book.dragEnd(0); onBook = false; }
      if (touches.size === 2) twoBegin(); else two = null;
      return;
    }
    // The slider is grabbed on PRESS, so the knob is already under the thumb by the
    // time the drag starts. Before the book test, because settings covers the book.
    const grabbed = hud.fovAt(x, y);
    if (grabbed !== null) { fovDrag = true; setFov(grabbed); return; }
    st = performance.now();
    px0 = x; py0 = y; lastX = x; lastT = st; vx = 0;
    deniedThisDrag = false;
    /**
     * A PRESS THAT STARTS ON A POUCH BELONGS TO THE BELT, whatever it does next.
     *
     * The same claim the book has (`overBook`): the world reads a swipe as walking or
     * turning, so without this every draw off the belt would also be a step. Recorded
     * on the way down because the decision has to survive the finger moving.
     */
    const onPouch = hud.hit(x, y);
    beltGrab = onPouch.kind === 'belt' ? { index: onPouch.index ?? -1, id: onPouch.id } : null;
    if (beltGrab) {
      /**
       * And a HOLD opens the pouch panel. Fired on a timer rather than measured on
       * release, so the panel appears under a finger that is still down — a long-press
       * that only resolves when you let go feels like a tap that was ignored.
       */
      longPress = window.setTimeout(() => {
        longPress = 0;
        if (!beltGrab || beltGrab.index < 0) return;
        if (!state.belt.slots[beltGrab.index]) return;
        act({ kind: 'beltOpen', index: beltGrab.index });
        sfx.pageFlip();
      }, LONG_PRESS_MS);
    }
    onBook = overBook(x, y);
    if (onBook) hud.bookClosed = book.closed;
  });

  stage.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, local(e));
    // A press that has started travelling is a swipe, not a hold. Cancelled on the
    // first real movement so a drawing gesture never also opens the panel behind it.
    if (longPress) {
      const q = local(e);
      if (Math.hypot(q.x - px0, q.y - py0) > 8) cancelLongPress();
    }
    if (treeOpen) {
      if (!treeDown) return;
      const dy = local(e).y - treeY0;
      treeMoved = Math.max(treeMoved, Math.abs(dy));
      treeScreen.scrollTo(treeScroll0 - dy);
      return;
    }
    if (fovDrag) {
      // Clamped inside `fovAt`, so a thumb that slides past the end of the track pins
      // to the end rather than dropping the knob.
      const v = hud.fovAt(local(e).x, hud.fovTrack ? hud.fovTrack.y : 0);
      if (v !== null) setFov(v);
      return;
    }
    if (twoClaimed) return;
    /**
     * THE PEEK: a world-area drag turns your head without turning you.
     *
     * Placed above the `!onBook` return rather than inside it, because this is the one
     * gesture that wants the drag WHILE it is happening — everything else in the world
     * area is resolved on release, which is exactly why this channel was free. Sign is
     * inverted on both axes so the world follows the finger: drag left and you look
     * left, which is the grab-the-scenery reading rather than the push-the-camera one.
     */
    /**
     * `touches.has` IS the "is this pointer held down" test — the map is filled on
     * `pointerdown` and emptied on `pointerup`. Without it a MOUSE peeks on hover, because
     * `pointermove` fires for a mouse whether or not a button is down, and the camera
     * drifts around after the cursor with nothing pressed. Every other branch in this
     * handler was accidentally safe from that: they all sit behind `onBook`, which is only
     * ever set on a press.
     */
    /**
     * TWO tests for "is this held", and both are wanted.
     *
     * `touches.has` is the codebase's own answer and covers touch. `e.buttons` is the
     * belt: a mouse released OUTSIDE the stage never delivers `pointerup` here, which
     * would leave the id in `touches` and put hover-drift straight back. `buttons` is 1
     * during contact for touch as well, so the pair costs nothing and neither is
     * redundant.
     */
    if (touches.has(e.pointerId) && e.buttons !== 0 && !onBook && !dead && !treeOpen
        && !hud.settingsOpen && !hud.offers) {
      const p = local(e);
      const g = gsign();
      peekYawTarget = Math.max(-PEEK_YAW_MAX, Math.min(PEEK_YAW_MAX,
        (((p.x - px0) * g) / PEEK_SPAN) * PEEK_YAW_MAX));
      peekPitchTarget = Math.max(-PEEK_PITCH_MAX, Math.min(PEEK_PITCH_MAX,
        (((p.y - py0) * g) / PEEK_SPAN) * PEEK_PITCH_MAX));
    }
    if (!onBook || dead) return;
    const { x, y } = local(e);
    const now = performance.now();
    if (now > lastT) { vx = (x - lastX) / (now - lastT); lastT = now; lastX = x; }
    const dx = x - px0, dy = y - py0;
    // Commit to an axis: horizontal leafs, upward tears.
    if (Math.abs(dx) > Math.abs(dy)) book.flipDrag(dx);
    else if (dy < 0) {
      // Mid-merge or mid-floor-swap: blocked, not refused, so it stays silent. A
      // round in flight is no longer a reason to block — see `canTakeComponent`.
      if (!canTakeComponent()) return;
      // pointermove fires dozens of times per swipe; the refusal must sound ONCE
      const r = book.ripDrag(dy);
      if (r === 'refused' && !deniedThisDrag) {
        deniedThisDrag = true;
        sfx.deny();
        explainRefusal(book.currentSpell);
      }
    }
  });

  stage.addEventListener('pointerup', (e) => {
    // The head comes back level whatever the release turns out to mean. Released here
    // and not in the swipe branch below, because a drag that resolves to nothing at all
    // still has to give the view back.
    peekYawTarget = 0; peekPitchTarget = 0;
    const { x, y } = local(e);
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x, y });
    if (two?.ids.includes(e.pointerId)) twoEnd();
    touches.delete(e.pointerId);
    const claimed = twoClaimed;
    // Both fingers have to leave before single-pointer gestures resume, or the
    // trailing release reads as a swipe of its own.
    if (touches.size === 0) { twoClaimed = false; two = null; }
    if (treeOpen) {
      treeDown = false;
      // A scroll that happens to end over a card must not buy it.
      if (treeMoved < 10) actTree(treeScreen.hit(x, y));
      return;
    }
    if (fovDrag) { fovDrag = false; return; }
    if (claimed) return;
    /**
     * SETTINGS EATS THE TAP, and eats the swipe with it.
     *
     * Without this a drag over the panel still reached the swipe branch at the bottom of
     * this handler and stepped the player through a dungeon they cannot see. The panel is
     * a full-screen fill, so anything landing on it is meant for it.
     */
    if (hud.settingsOpen || hud.roster || hud.rescued) { act(hud.hit(x, y)); return; }
    // A finished run resolves its tap through the HUD, so the run-end card's door to
    // the tree is a real control — and `act` sends every other tap the same way.
    if (dead) { act(hud.hit(x, y)); return; }
    const moved = Math.hypot(x - px0, y - py0);

    /**
     * THE BELT'S OWN GESTURES, resolved before the world sees the swipe.
     *
     * A pouch is emptied the way a page is torn — the book lies along the bottom so its
     * pages come UP, the belt runs down the left edge so its pouches come OUT to the
     * right. Same verb, different axis, and both containers hold castable things.
     *
     * A tap does it too, exactly as a tap now tears the open page: the swipe teaches
     * and the tap repeats. The long-press that opens the panel has already fired on its
     * own timer by this point, and cancelled itself if the finger travelled.
     */
    if (beltGrab) {
      const grabbed = beltGrab;
      beltGrab = null;
      cancelLongPress();
      if (hud.beltPanel !== null) return;      // the panel owns its own taps
      const dx = x - px0, dy = y - py0;
      const drew = moved < 14                                  // a tap
        || (Math.abs(dx) > Math.abs(dy) && dx > 18);           // or a pull to the right
      if (drew && grabbed.id) takeIngredient(grabbed.id);
      return;
    }

    if (onBook) {
      onBook = false;
      book.dragEnd(vx);
      if (moved < 12) {
        // A HUD control wins here too, not just in `overBook` — otherwise a tap
        // that starts inside the book's zone can still leak into a chapter jump.
        const ui = hud.hit(x, y);
        if (UI_CONTROLS.has(ui.kind)) { act(ui); return; }
        const ribbon = book.ribbonAt(x, y);
        if (ribbon) { book.goToChapter(ribbon); return; }
        /**
         * A TAP ON THE OPEN PAGE TEARS IT.
         *
         * The upward drag stays — it is the gesture the book teaches, and the tension in
         * the lift is most of what makes a tear read as one. This is the cheap way to say
         * the same thing, and it is what every other fixture in the game already does:
         * the thing under your finger is the thing you meant. On a tall phone, held in
         * one hand, an 78px upward drag is the most expensive input in the game and it is
         * also the one the player performs most often.
         *
         * After the ribbon and the HUD controls, never before: a chapter tab and the CAST
         * pill both sit over the book, and a tap that tore a page instead of jumping to
         * elementalism would be the book's own furniture firing the wrong mechanism.
         *
         * `refused` is explained in words through the same say-it-once channel the drag
         * uses, so a full hand reads identically whichever gesture asked. `blocked` is the
         * book mid-animation and stays silent, exactly as it does for a drag.
         */
        if (ui.kind === 'none' && !book.closed) {
          const r = book.tapTear();
          if (r === 'refused') explainRefusal(book.currentSpell);
          if (r !== 'blocked') return;
        }
        act(ui);
      }
      return;
    }

    /**
     * A tap resolves against the HUD (targets, cast, toggles); a swipe moves.
     *
     * A tap that hits NOTHING is reported. Three of them and the instruction comes
     * back — see `Hud.idleTap`. This is the only signal the game gets that a player is
     * stuck: they are pressing the screen and it is not answering, which is exactly
     * when somebody is trying to work out what the input even is.
     */
    if (moved < 24) {
      const a = hud.hit(x, y);
      if (a.kind === 'none') hud.idleTap();
      act(a);
      return;
    }
    if (performance.now() - st < 700) {
      const dx = x - px0, dy = y - py0;
      if (Math.abs(dy) > Math.abs(dx)) {
        // Same rule as the turn: the world follows the finger. Drag down and the floor
        // comes toward you, which is walking forward.
        stepper.press({ kind: 'move', m: dy * gsign() < 0 ? 'back' : 'forward' });
      }
      // FLIPPED to agree with the peek: a swipe left turns you left, the way the drag
      // already looked left. These two are the same hand on the same pixels and they were
      // moving the world in opposite directions.
      else stepper.press({ kind: 'turn', d: dx * gsign() < 0 ? 1 : -1 });
    }
  });
  stage.addEventListener('pointercancel', (e) => {
    touches.delete(e.pointerId);
    if (touches.size === 0) { twoClaimed = false; two = null; }
    onBook = false; treeDown = false; book.dragEnd(0);
    // A cancelled pointer never reaches `pointerup`, so without this the head stays
    // turned for the rest of the run.
    peekYawTarget = 0; peekPitchTarget = 0;
  });
  // Desktop's scroll, since the tree is taller than any window it will be read in.
  stage.addEventListener('wheel', (e) => {
    if (!treeOpen) return;
    e.preventDefault();
    treeScreen.scrollBy(e.deltaY);
  }, { passive: false });

  const keys: Record<string, () => void> = {
    ArrowUp: () => stepper.press({ kind: 'move', m: 'forward' }),
    ArrowDown: () => stepper.press({ kind: 'move', m: 'back' }),
    ArrowLeft: () => stepper.press({ kind: 'turn', d: -1 }),
    ArrowRight: () => stepper.press({ kind: 'turn', d: 1 }),
    // WASD is the keyboard's two-finger hand, so W/S are the compound moves and
    // the arrows are left as the only plain forward/back. They used to duplicate
    // the arrows, which spent the two most-pressed keys on a binding you already
    // had.
    KeyW: () => stepper.press({ kind: 'move', m: 'forward', compound: true }),
    KeyS: () => stepper.press({ kind: 'move', m: 'back', compound: true }),
    KeyA: () => stepper.press({ kind: 'move', m: 'left' }),
    KeyD: () => stepper.press({ kind: 'move', m: 'right' }),
    KeyQ: () => stepper.press({ kind: 'turn', d: -1 }),
    KeyE: () => stepper.press({ kind: 'turn', d: 1 }),
    Space: () => void doCast(),
    Escape: () => hud.clearSelection(),
    Tab: () => cycleTarget(),
    KeyF: () => void descend(),
    /**
     * THE SHOWROOM. One bay per feature, so they can be LOOKED at.
     *
     * Four phases of dungeon vocabulary shipped proven by assertion and unseen by
     * anybody: gaps, five surfaces, elevation, three hazards, a timed gate and a
     * lever lock. Assertions cannot tell you whether a blade reads as a blade from
     * three tiles back, and finding a generated floor that happened to contain the
     * thing you wanted to look at, then walking to it, was costing more than the
     * looking was worth.
     *
     * TWO KEYS, and the backquote is the one that will actually work.
     *
     * A function key is the right IDEA — no letter is safe, because every letter in
     * this game is a move or a cast and a debug room must never be one fumbled
     * keypress from something the player meant to do. But F1 is the worst of them in
     * practice: macOS binds it to screen brightness unless the "standard function
     * keys" setting is on, so on a laptop it never reaches the page at all, and a
     * Chrome that does receive it opens Help. It is bound anyway for the machines
     * where it works.
     *
     * Backquote is the one to reach for. It is the console key every game has used
     * for thirty years, no browser claims it, and no operating system intercepts it.
     */
    F1: () => void showroom(),
    Backquote: () => void showroom(),
  };
  // Keyboard mirrors the gestures: brackets leaf through, digits tear a page out.
  keys.BracketLeft = () => book.swipe(-1);
  keys.BracketRight = () => book.swipe(1);
  // Same path the HUD's own clear takes: returning the hand changes what is
  // targetable, so the reticle and `hud.tornIds` have to be rebuilt with it.
  keys.KeyR = () => returnHand();
  // Harvest what you are facing — the keyboard mirror of the HARVEST pill. Falls
  // back to the reticle so pressing it at something across the room still SAYS why
  // nothing happened; the pill itself is only ever drawn for a fixture in reach.
  keys.KeyH = () => {
    // A tile has nothing to harvest — burning ground is a component you pick up by
    // casting into it, not by taking it off a fixture.
    const t = hud.target;
    const e = hud.harvestInReach ?? (t && !isTileTarget(t) ? t : null);
    if (e) harvestFrom(e);
  };
  for (let i = 1; i <= 9; i++) {
    keys[`Digit${i}`] = () => tearPage(i - 1);
  }
  window.addEventListener('keydown', (e) => {
    // The tree owns the keyboard while it is up: every other binding drives a run
    // that has already ended.
    if (treeOpen) {
      if (e.code === 'Enter') { e.preventDefault(); location.reload(); }
      else if (e.code === 'ArrowDown') { e.preventDefault(); treeScreen.scrollBy(70); }
      else if (e.code === 'ArrowUp') { e.preventDefault(); treeScreen.scrollBy(-70); }
      return;
    }
    const fn = keys[e.code];
    if (fn) { e.preventDefault(); fn(); }
  });

  engine.start();
  // The mouth's choosers need the loop running to be drawn at all — see `openTheMouth`.
  // The book rises at the END of it, not here: `openTheMouth` calls `playIntro` once
  // the player has actually chosen what is in it.
  void openTheMouth();
  document.getElementById('boot')?.classList.add('gone');

  // ---- screenshot / debug harness ---------------------------------------
  (window as unknown as Record<string, unknown>).__game = {
    engine, state, meta,
    get floor() { return floor; },
    get stepper() { return stepper; },
    get combat() { return combat; },
    get hud() { return hud; },
    place: (x: number, y: number, dir: number) => {
      stepper.place(x, y, ((((dir % 4) + 4) % 4) as Dir));
      combat.playerTile = { x, y };
      floor.cull(x, y);
      refreshTargets();
    },
    /** Vantage points worth judging the art from. */
    bestViews: () => {
      const out: { name: string; x: number; y: number; dir: Dir }[] = [];
      const grid = floor.grid;
      let best = { x: grid.start.x, y: grid.start.y, dir: 0 as Dir, len: -1 };
      for (let y = 0; y < grid.h; y++) {
        for (let x = 0; x < grid.w; x++) {
          if (!grid.walkable(x, y)) continue;
          for (let d = 0; d < 4; d++) {
            const len = grid.rayTiles(x, y, d as Dir, 20).length;
            if (len > best.len) best = { x, y, dir: d as Dir, len };
          }
        }
      }
      out.push({ name: 'corridor', x: best.x, y: best.y, dir: best.dir });
      const want: Record<string, boolean> = { altar: true, boss: true, enemy: true, prop: true };
      for (const e of floor.entities) {
        if (!want[e.kind]) continue;
        want[e.kind] = false;
        for (const [d, dx, dy] of [[0, 0, 1], [1, -1, 0], [2, 0, -1], [3, 1, 0]] as const) {
          const gap = e.kind === 'boss' ? 4 : 3;
          const px = e.sprite.tx + dx * gap, py = e.sprite.ty + dy * gap;
          if (!grid.walkable(px, py)) continue;
          if (grid.rayTiles(px, py, d as Dir, gap).length < gap - 1) continue;
          out.push({ name: e.kind, x: px, y: py, dir: d as Dir });
          break;
        }
      }
      return out;
    },
    book, fan,
    bookPages: () => BOOK_PAGES.map((pg) => pg.gameId),
    /**
     * Assemble a hand outright. Still async, and now trivially so: a tear buys the
     * room nothing, so nothing has to be waited out and the whole hand lands in one
     * turn of the loop. Kept `async` because every harness awaits it. The hand
     * size is lifted FOR THE DURATION so a scripted three-page fusion still works
     * at the real starting hand size of one — and dropped again in `finally`,
     * because leaving it lifted raised the real tear ceiling for the rest of the
     * session and quietly ran every later check at hand size 3.
     *
     * PAGES ONLY, and it CLEARS first. Both were harmless while the book was the only
     * source; now that a hand can mix a page with an ingredient, calling this after
     * drawing a vial throws the vial away. `takeComponents` is the one to use for a
     * mixed hand — this one is left exactly as it was, because three harnesses are
     * written against it clearing.
     */
    selectPages: async (ids: string[]) => {
      fan.clear();
      handSizeBonus = Math.max(0, ids.length - meta.handSize);
      try {
        for (const id of ids) {
          const i = BOOK_PAGES.findIndex((pg) => pg.gameId === id);
          if (i >= 0) tearPage(i);
        }
      } finally {
        handSizeBonus = 0;
      }
      await Promise.resolve();
    },
    /**
     * Assemble a hand out of ANY sources, in the order given, appending to whatever
     * is already held.
     *
     * The mixed-hand version of `selectPages`, and the phase needs one: the whole
     * point of the belt is that a cast is an ingredient PLUS an element, so a helper
     * that can only reach one of the two sources cannot express the core verb. Each
     * component goes through its own real gesture — `tearPage` for a page,
     * `takeIngredient` for a vial — so each pays its own slot, which is now the whole
     * of what a component costs.
     *
     * The ceiling is lifted only as far as the requested TOTAL needs, so a hand that
     * already fits (animate + fire at hand size 2, which is what the tree sells) is
     * assembled at the real ceiling and proves the real thing.
     */
    takeComponents: async (ids: string[]) => {
      handSizeBonus = Math.max(0, fan.count + ids.length - meta.handSize);
      try {
        for (const id of ids) {
          if (isIngredient(id)) { takeIngredient(id); continue; }
          const i = BOOK_PAGES.findIndex((pg) => pg.gameId === id);
          if (i >= 0) tearPage(i);
        }
      } finally {
        handSizeBonus = 0;
      }
      await Promise.resolve();
      return fan.gameIds;
    },
    /**
     * The fixtures IN SIGHT that would give up an element, with what each yields.
     *
     * Sight and not reach, deliberately: this is the list of things worth walking
     * to, and it carries the acceptance criterion "animating a fixture removes it
     * from the harvest list". Whether one can actually be harvested from where you
     * stand is `hud.harvestInReach`, which is the single fixture the pill draws for.
     */
    harvestable: () => hud.candidates
      .filter((e): e is Entity => !isTileTarget(e)
        && e.alive && e.kind === 'prop' && !e.animated && !!harvestOf(e.spriteId)
        && !(e.draws !== undefined && e.draws <= 0))
      .map((e) => ({
        e, spriteId: e.spriteId, yields: harvestOf(e.spriteId), draws: e.draws,
      })),
    /**
     * Harvest the fixture in reach, or a given one. Same path as the pill, so it
     * spends the same slot AND meets the same reach rule. There is no round to wait
     * out any more; still `async` because every harness awaits it.
     */
    harvest: async (e?: Entity) => {
      const t = e ?? hud.harvestInReach;
      if (!t || !harvestFrom(t)) return false;
      await Promise.resolve();
      return true;
    },
    /**
     * The belt, as the renderer sees it: the pouches in strip order, how many loops
     * the strap has, and the last refusal with its timestamp (which is what a strap
     * pulse reads).
     */
    belt: () => ({
      slots: state.belt.slots.map((s) => ({ ...s })),
      capacity: state.belt.capacity,
      locked: state.belt.capacity <= 0,
      /**
       * Whether the FEATURE is on, which is a different question from whether the strap
       * has loops: locked means "buy the node", off means "there is no node to buy". The
       * harnesses gate their belt assertions on this so they skip instead of failing, and
       * so flipping the flag back re-arms them.
       */
      enabled: BELT_ENABLED,
      total: beltTotal(state.belt),
      /**
       * Always 0 now, and reported anyway so it is visibly zero. It counted the free
       * components TimeSand had left, and cast = 1 turn leaves no component turn for
       * the sand to zero — `BeltState.free` and the strip caption that reads it are
       * both dead. See the sand's entry in `spells.ts`.
       */
      free: state.belt.free,
      refusal: state.belt.refusal,
      /** What is left to draw, which is the stack minus what the hand already holds. */
      available: Object.fromEntries(INGREDIENT_IDS.map((id) => [id, beltAvailable(id)])),
    }),
    /**
     * Every ingredient that exists, with the id the hand holds it by.
     *
     * No `free` field any more: every component is free to take, so the question the
     * flag answered no longer distinguishes anything.
     */
    ingredients: () => INGREDIENT_IDS.map((id) => ({
      id, name: SPELL_BY_ID[id].name, role: SPELL_BY_ID[id].role,
      effect: SPELL_BY_ID[id].effect,
    })),
    /**
     * Put ingredients on the belt through the real grant path, refusals included —
     * so a locked belt answers here exactly as it answers a chest. Returns how many
     * were actually kept.
     */
    grantIngredient: (id: string, n = 1) => {
      let got = 0;
      for (let i = 0; i < n; i++) if (grantIngredient(id)) got++;
      return got;
    },
    /**
     * Draw one into the hand. The same path the pouch tap takes, so it spends the
     * same slot and nothing else. Still `async` to match `harvest`, and because every
     * harness awaits it.
     */
    takeIngredient: async (id: string) => {
      if (!takeIngredient(id)) return false;
      await Promise.resolve();
      return true;
    },
    /**
     * Put the hand back. The one return gesture the game has (the CLEAR pill and
     * `R`), here so a harness can prove the half of the rule that matters: returning
     * an ingredient neither consumes it nor moves the room. Nor does taking it, since
     * the rebase — so the round trip is now provably a no-op rather than half of one.
     */
    returnHand: () => {
      returnHand();
      return { held: fan.count, belt: state.belt.slots.map((s) => ({ ...s })) };
    },
    /**
     * The fan's cards as the HUD sees them: what each holds, where it came from, and
     * the screen rect a tap has to land in. The rects are projected from live 3D
     * geometry, so where a card IS is only answerable by asking.
     */
    handCards: () => handCardBoxes().map((c) => ({
      ...c,
      id: fan.gameIds[c.index],
      source: SPELL_BY_ID[fan.gameIds[c.index]]?.source,
    })),
    /**
     * Cancel ONE component. The same path the card tap takes, so it proves the two
     * things this has to be: free, and non-destructive to the belt.
     *
     * `turns` is the RUN's turn counter (`combat.turns`) rather than a per-assembly
     * bill, because there is no longer any such thing as a per-assembly bill. It is
     * reported so a harness can assert the strongest form of the rule: take a
     * component, put it back, and this number has not moved.
     */
    returnComponent: (index: number) => {
      const ok = returnComponent(index);
      return {
        ok, held: fan.gameIds, turns: combat.turns, free: state.belt.free,
        belt: state.belt.slots.map((s) => ({ ...s })),
      };
    },
    /**
     * Why the belt would refuse this, without asking it to — the locked line the
     * strip pulses for.
     */
    beltRefusalFor: (id: string) => beltRefusalFor(state.belt, id),
    /**
     * What the HUD would do with a tap here, without doing it — the HUD's controls
     * are laid out from measured text and a measured book edge, so where one IS is
     * only answerable by asking.
     */
    hudAt: (x: number, y: number) => hud.hit(x, y).kind,
    /** Resolve a tap against the HUD, so a drawn control can be proven tappable. */
    /**
     * Wind a door to a position and watch it go, without finding two levers first.
     *
     * `to` is the fraction, so a two-lever door can be driven to a half and the
     * partial state actually looked at — which is the state that only exists on a
     * floor you have half solved.
     */
    cine: (x: number, y: number, to = 1) => {
      const g = floor.grid;
      const i = g.idx(Math.round(x), Math.round(y));
      const from = g.doorLift[i];
      g.setDoorLift(i, to);
      floor.syncClock();
      showDoor(i, from, to);
    },
    tapHud: (x: number, y: number) => {
      const a = hud.hit(x, y);
      act(a);
      return a.kind;
    },
    /**
     * Fire a UI action directly, bypassing the hit test.
     *
     * The belt's panel is a modal whose buttons move with the stack in it, so driving it
     * by pixel means re-deriving the layout in the test — which tests the arithmetic of
     * the test rather than the behaviour of the game. `tapHud` stays for anything whose
     * POSITION is the thing in question.
     */
    doAction: (a: UiAction) => { act(a); return a.kind; },
    /**
     * Stand a body on a tile.
     *
     * An object reaction is SPATIAL — its whole claim is about who is standing beside
     * the thing — and a procedural room will not put three enemies around a barrel on
     * request. Debug only, and it moves the sprite the same way `shove` does.
     */
    putEntity: (e: Entity, x: number, y: number) => {
      e.sprite.tx = x; e.sprite.ty = y;
      e.sprite.setTileLight(floor.grid.lightAt(x, y));
      refreshTargets();
      return { x: e.sprite.tx, y: e.sprite.ty };
    },
    /** Rebuild at a given depth. Floor 4 is the only place an oil drum exists. */
    goToDepth: (depth: number) => enterFloor(Math.max(1, Math.min(THEMES.length, depth))),
    /**
     * How a creature answers an element, for the balance harness.
     *
     * Exposed because a policy that models "a player who has read the table" cannot
     * model it without the table. Read-only, and it is the same function combat
     * scales damage by, so a policy cannot be tuned against a copy that drifts.
     */
    affinityOf: (spriteId: string, element: string) => affinityOf(spriteId, element as SpellElement),
    targetKind: (kind: string) => {
      const e = floor.entities.find((x) => x.alive && x.kind === kind);
      if (e) hud.target = e;
      return !!e;
    },
    castNow: () => doCast(),
    /**
     * The cast-effects rig itself, so a VFX change can be looked at without playing
     * a turn to reach one. Spawning a chain takes a whole cast, a hand and something
     * to cast at; the effect it draws is a function of two points and a colour.
     */
    fx: () => fx,
    /**
     * The run's seed, readable and settable.
     *
     * Setting it rebuilds the CURRENT depth, because floor 1 is already standing by
     * the time this object exists — a setter that only assigned the string would
     * look like it worked and change nothing until the first descent.
     */
    get seed() { return runSeed; },
    setSeed: async (seed: string) => {
      runSeed = seed;
      await enterFloor(state.depth);
    },
    /**
     * The run's INCOME, which a harness has to be able to drive or it is not
     * measuring this game. Rank 1→2 is a free altar upgrade (see `docs/DESIGN.md`)
     * so a real player always has it, and chest heals are part of the attrition
     * budget `tuning.ts` is sized against — a run that takes neither is a lower
     * bound, not a verdict.
     */
    altars: () => floor.entities.filter(
      (e) => e.kind === 'altar' && e.alive && !e.spent && !claimedAltars.has(e)),
    chests: () => floor.entities.filter((e) => e.kind === 'chest' && e.alive && !e.spent),
    /**
     * Same reach rule as the tap — adjacent AND facing — so `place` on the tile in
     * front of it first, or this refuses exactly the way a tap would. Returns the
     * offers.
     */
    openAltar: (e: Entity) => { takeFromAltar(e); return hud.offers; },
    /**
     * What an altar WOULD offer on a given roll. No reach rule, no state touched,
     * nothing opened.
     *
     * Here because the roll's bias is a claim about a distribution — which pages
     * lead at which hand size — and a distribution cannot be checked one altar at
     * a time. Sample it across nonces instead.
     */
    peekOffers: (e: Entity, nonce = 0) => rollAltarOffers(e, nonce),
    /**
     * Open an altar on a roll that CONTAINS `kind`, without spending charges — it
     * advances the roll's nonce, which is the same thing a reroll does.
     *
     * Every offer kind is gated on something: golden on a rarity roll, heal on
     * being hurt, sacrifice on holding a spare rank-2 page. A reward kind a harness
     * cannot reach is a reward kind nothing in this project verifies, so reaching
     * each one has to be one call. Returns null if `tries` rolls never produced it.
     */
    openAltarKind: (e: Entity, kind: AltarOffer['kind'], tries = 80) => {
      takeFromAltar(e);
      for (let i = 0; i < tries; i++) {
        if (hud.offers?.some((o) => o.kind === kind)) return hud.offers;
        if (!hud.offers) return null;
        const n = (altarNonce.get(e) ?? 0) + 1;
        altarNonce.set(e, n);
        hud.offers = rollAltarOffers(e, n);
      }
      return hud.offers?.some((o) => o.kind === kind) ? hud.offers : null;
    },
    /** Take an offer by index, or the object `openAltar` handed back. */
    pickOffer: (o: number | AltarOffer) => {
      const list = hud.offers;
      if (!list) return null;
      const pick = typeof o === 'number' ? list[o] : o;
      if (!pick) return null;
      chooseOffer(pick);
      return pick;
    },
    /**
     * Put a page in the book at a given rank. The sacrifice only appears when the
     * player holds a spare rank-2 page, which no default loadout ever does.
     */
    setRank: (id: string, rank: number) => {
      // PAGE elements only. A fixture element is an element and would pass an
      // `isElement` guard, and writing a rank for one would put a harvest tap in the
      // book's owned-page list — where the altar would then offer it.
      if (!isPageElement(id)) return null;
      const r = Math.max(0, Math.min(MAX_RANK, Math.floor(rank)));
      if (r === 0) { burnPage(id); return 0; }
      state.ranks[id] = r;
      learnPage(id);
      return r;
    },
    /** Skip the golden page's rarity roll, so its claim path is reachable at will. */
    forceGolden: (on: boolean) => { goldenForced = !!on; return goldenForced; },
    /**
     * Open and claim in one call, taking the run's INCOME.
     *
     * The order is a claim about what a competent player takes at hand size 1, and
     * every step of it is load-bearing:
     *  - the free rank-up first, because `docs/DESIGN.md` prices 1→2 at nothing;
     *  - a HEAL above a new page, because at hand size 1 a fourth element fuses
     *    with nothing while a floor's worth of health is the binding constraint on
     *    the whole run (see `tuning.ts` on the attrition budget);
     *  - the sacrifice LAST, because it burns a page, and a harness that silently
     *    lost the page its line casts would change what every later floor measures.
     *    Unreachable in practice — a roll holds at most one sacrifice and always
     *    holds something else — but the order is what makes that true by rule
     *    rather than by luck;
     *  - golden never, because it writes the persisted save and pays out in the
     *    NEXT run, so a pass that took one would be measuring a different starting
     *    book than the one it claims. Driving it is `openAltarKind` plus
     *    `pickOffer`, deliberately.
     *  - an INGREDIENT never, and for the same class of reason: this order describes a
     *    competent player at hand size 1, and at hand size 1 there is no belt to keep
     *    one on (the node requires hand size 2), so an ingredient is a slot spent on
     *    something the run cannot use. It is not in `order`, so it is only ever taken
     *    when it is the whole roll — which cannot happen, since every roll holds a page.
     */
    takeAltar: (e: Entity) => {
      takeFromAltar(e);
      const list = hud.offers;
      if (!list?.length) return null;
      const order = ['upgrade', 'heal', 'new', 'stars', 'star', 'sacrifice'];
      let pick = list.find((o) => o.kind !== 'golden') ?? list[0];
      for (const kind of order) {
        const found = list.find((o) => o.kind === kind);
        if (found) { pick = found; break; }
      }
      chooseOffer(pick);
      return pick;
    },
    /** Same reach rule. Heals by `chestHealBase(depth)` and pays stars. */
    openChest: (e: Entity) => { openChest(e); },
    /**
     * The star tree, as data plus the two transactions.
     *
     * The tree screen is a follow-up task, so this is the ONLY way the tree can be
     * driven today — and this project's only tests are these harnesses, so a node
     * that cannot be bought from here is a node nothing verifies. `tree()` carries
     * the prices and the edges rather than making a caller import the module, and
     * `live` says whether the effect lands now or is recorded for the phase in
     * `lands`.
     */
    tree: () => TREE.map((n) => ({ ...n, owned: owns(meta.nodes, n.id) })),
    /** Everything the tree currently grants, derived — never stored twice. */
    treeState: () => ({
      stars: meta.stars,
      owned: [...meta.nodes],
      handSize: meta.handSize,
      slots: meta.slots,
      beltSlots: derivedBeltSlots(meta.nodes),
      golemsKept: derivedGolemsKept(meta.nodes),
      golemInfusion: derivedGolemInfusion(meta.nodes),
    }),
    /** The one question a later phase asks: is this owned? */
    hasNode: (id: string) => owns(meta.nodes, id),
    /**
     * The tree SCREEN, as opposed to the tree.
     *
     * `controls` is the load-bearing one: every card is measured from its own copy
     * and the list scrolls, so where a node's card IS this frame is only answerable
     * by asking — the same reason `hudAt` exists. `tapTree` then drives the real
     * dispatch, refusals included.
     */
    /**
     * End the run where it stands.
     *
     * The star tree only ever opens from a FINISHED run — it is between runs, not
     * inside one — so without this there is no scripted route to the screen at all,
     * and this project's only tests are these harnesses. Goes through the real
     * `endRun`, so the bank, the best depth and the card cannot disagree with a
     * genuine death.
     */
    endRun: (kind?: 'died' | 'won') => {
      if (!dead) endRun(kind === 'won' ? 'won' : 'died', state.stars);
      return dead;
    },
    openTree: () => { openTree(); return treeOpen; },
    treeOpen: () => treeOpen,
    treeControls: () => treeScreen.controls(),
    treeMessage: () => treeScreen.message,
    /**
     * The screen's own presentation state, read-only. The three things a harness
     * cannot infer from a bitmap: which view is up, what the panel is describing,
     * and what route is pinned.
     */
    treeUi: () => ({
      mode: treeScreen.mode,
      selected: treeScreen.selected,
      pinned: meta.pinned,
      route: meta.pinned ? routeTo(meta.pinned, meta.nodes) : [],
      routeCost: meta.pinned ? routeCost(routeTo(meta.pinned, meta.nodes)) : 0,
    }),
    treeReveal: (id: string) => (isNodeId(id) ? treeScreen.reveal(id) : false),
    treeScrollBy: (dy: number) => { treeScreen.scrollBy(dy); return treeScreen.scroll; },
    tapTree: (x: number, y: number) => {
      const a = treeScreen.hit(x, y);
      actTree(a);
      return a.kind;
    },
    /** Both return why they refused rather than a bare false. */
    buyNode: (id: string) => buyNode(id),
    refundNode: (id: string) => refundNode(id),
    /**
     * Bank stars outright, so the SPEND path is drivable without first playing the
     * runs that would pay for it. Sets rather than adds, and goes through the same
     * transaction, so the bank the HUD shows and the saved bank cannot part company.
     */
    grantStars: (n: number) => {
      meta.stars = Math.max(0, Math.floor(n));
      afterTreeChange();
      return meta.stars;
    },
    grantAll: () => {
      state.pages = ELEMENT_SPELLS.map((s) => s.id);
      state.ranks = Object.fromEntries(state.pages.map((id) => [id, 1]));
      setBookPages(state.pages); book.refresh();
    },
    spellNames: () => ELEMENT_SPELLS.map((s) => `${s.glyph} ${s.name}`),
    spellById: SPELL_BY_ID,
  };
}

boot().catch((err) => {
  const el = document.getElementById('err');
  if (el) { el.style.display = 'block'; el.textContent = String(err && err.stack ? err.stack : err); }
});
