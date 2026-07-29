import * as THREE from 'three';
import { Engine } from './core/engine';
import { Floor, type Entity } from './game/floor';
import { Stepper, PITCH } from './game/stepper';
import {
  Combat, targetsInView, MAX_RANK, type PlayerState, type TurnCause,
} from './game/combat';
import { CastFx } from './spells/vfx';
import { Hud, type AltarOffer } from './ui/hud';
import { TreeScreen, type TreeAction } from './ui/tree';
import { Book } from './book/book';
import { Fan } from './book/fan';
import {
  bookScene, camera as bookCam, tickBook, resizeBook, sinks, sfx,
} from './book/bridge';
import { SPELLS as BOOK_PAGES, setBookPages, type SpellDef } from './spells/pages';
import {
  ELEMENT_SPELLS, SPELL_BY_ID, displayName, harvestOf, isPageElement,
  type ResolvedCast,
} from './spells/spells';
import { harvestCard, harvestColour } from './spells/harvestCards';
import { Rng } from './core/rng';
import type { Dir } from './dungeon/grid';
import { THEMES } from './art/theme';
import {
  CHEST_HEAL_SPREAD, PLAYER_MAX_HP, chestHealBase, descendHeal, healable,
} from './game/tuning';
import {
  NODE_BY_ID, TREE, derivedBeltSlots, derivedGolemInfusion, derivedGolemsKept,
  derivedHandSize, derivedSlots, buyBlocker, isNodeId, migrateOwned, owns,
  refundBlocker, sanitizeOwned, type NodeId,
} from './meta/tree';

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
 * The only exception is a GOLDEN page, which is claimed into a `loadout` slot —
 * rare enough to be an event, slot-limited so it stays a decision rather than
 * accumulation.
 */
interface Meta {
  stars: number;
  /** The pages you begin every run holding. */
  loadout: string[];
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
}

const META_KEY = 'stepper-mage.meta.v1';

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
  // loadout keeps a slot nobody owns. Trimmed from the FRONT for the same reason
  // `claimGolden` trims from the front: the last page in the book is the one the
  // player chose to put there, and the first ones are the defaults.
  if (m.loadout.length > m.slots) m.loadout = m.loadout.slice(m.loadout.length - m.slots);
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
      });
    }
  } catch { /* corrupt or unavailable storage: fall through to defaults */ }
  return applyTree({
    stars: 0, loadout: [...DEFAULT_LOADOUT], slots: 0, handSize: 0, best: 0, nodes: [],
  });
}

function saveMeta(m: Meta): void {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* private mode */ }
}

async function boot(): Promise<void> {
  const engine = new Engine({ internalHeight: 400, levels: 36 });
  const meta = loadMeta();
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

  const state: PlayerState = {
    hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP,
    pages: [...meta.loadout],
    ranks: Object.fromEntries(meta.loadout.map((id) => [id, 1])),
    stars: 0,
    rerolls: 0,
    depth: 1,
  };

  const fx = new CastFx();
  engine.scene.add(fx.group);

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
  engine.onResize = () => resizeBook(engine.sw, engine.sh);

  // The book contains only what the player has learned.
  setBookPages(state.pages);

  const book = new Book();
  const fan = new Fan();

  /** Lifted only by the debug harness, so a scripted fusion still works. */
  let handSizeBonus = 0;
  /**
   * The fusion ceiling, read through one accessor so raising it later (the star
   * tree) is a single write to `meta` and nothing else has to know.
   */
  const handSize = (): number => meta.handSize + handSizeBonus;

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
   * Note what is NOT here: the tear's real price is a TURN, and that is charged on
   * the way out (see `spendComponentTurn`) rather than gating the gesture — you can
   * always afford a turn, you just may not like what it buys the room.
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
    if (!state.pages.includes(id)) state.pages.push(id);
    setBookPages(state.pages);
    book.refresh();
  };

  book.onRip = (spell, worldPos, worldQuat) => {
    fan.add(spell, worldPos, worldQuat);
    // What you just tore out may change what is targetable.
    refreshTargets();
    spendComponentTurn('tear');
  };

  const tearPage = (index: number): boolean => {
    if (!canTakeComponent()) return false;
    if (book.tearAt(index)) return true;
    const spell = BOOK_PAGES[index];
    if (spell) explainRefusal(spell);
    return false;
  };

  /**
   * Take the room's element off a fixture.
   *
   * Priced exactly like a tear, through the same two gates, because it IS a tear as
   * far as the economy is concerned: one hand slot and one turn (`spendComponentTurn`
   * charges the turn on the way out). What it is not is a withdrawal — nothing is
   * taken from the object, which is why the candelabra is still lit afterwards and
   * why this can be done twice. `docs/DESIGN.md` rejects depleting fixtures outright,
   * and that rule is only safe because harvests are also non-storable.
   *
   * Line of sight and nothing else: `hud.candidates` is `targetsInView`, so being
   * able to put a reticle on the thing is the whole requirement. It is magic.
   */
  const harvestFrom = (e: Entity): boolean => {
    if (!canTakeComponent()) return false;
    // `hp <= 0` is a body already playing its death animation.
    if (!e.alive || e.hp <= 0 || e.kind !== 'prop' || e.animated) return false;
    const id = harvestOf(e.spriteId);
    if (!id) return false;
    if (!hud.candidates.includes(e)) {
      hud.addLog('That is not in sight.', 0xffcf5c);
      return false;
    }
    if (fan.count >= handSize()) {
      // Its own line rather than the tear's, because "put the page back" is the wrong
      // instruction for a card that is not one — through the same say-it-once guard,
      // because at a hand of one this is refused constantly.
      speakRefusal('Your hand is full. Cast it, or put it back.');
      sfx.deny();
      return false;
    }
    addHarvestCard(id);
    hud.addLog(
      `You draw ${SPELL_BY_ID[id]?.name ?? id} out of the ${displayName(e.spriteId).toLowerCase()}.`,
      SPELL_BY_ID[id]?.colour,
    );
    // What is in the hand decides what is targetable, exactly as after a tear.
    refreshTargets();
    spendComponentTurn('harvest');
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
  const addHarvestCard = (id: string): void => {
    const card = harvestCard(id);
    if (!card) return;
    // A torn page flies from wherever the page was. This rises into the hand from
    // below the fan, which from inside the book's camera is where the room is.
    fan.add(card, new THREE.Vector3(0, -0.16, -0.34), new THREE.Quaternion());
    const p = fan.pages[fan.pages.length - 1];
    if (!p) return;
    const col = harvestColour(id);
    p.mat.uniforms.uGold.value.setHex(col);
    (p.glow.material as THREE.ShaderMaterial).uniforms.uColor.value.setHex(col);
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
  const tmp = new THREE.Vector3();

  let floor!: Floor;
  let stepper!: Stepper;
  let combat!: Combat;
  let hud!: Hud;
  let busy = false;
  let dead = false;
  /** Altars already claimed, so a floor grants exactly one page. */
  const claimedAltars = new Set<Entity>();
  /**
   * How many times each altar has been RE-rolled.
   *
   * The roll is deterministic per altar on purpose — walk away from three cards
   * and come back, and they are the same three cards — so the only way a reroll
   * charge can buy a different table is by advancing this.
   */
  const altarNonce = new Map<Entity, number>();
  /**
   * At most one golden page per run.
   *
   * Golden pages are the only thing in the game that writes to `meta.loadout`, so
   * the rate they arrive at IS the rate the starting book changes at. A run that
   * could gild three pages turns the loadout back into accumulation, which is the
   * exact thing sealing found pages exists to prevent.
   */
  let goldenClaimed = false;
  /** Skips the golden page's rarity roll, so a harness can drive it. Debug only. */
  let goldenForced = false;
  /** A claimed golden page waiting for the player to say what it displaces. */
  let pendingGolden: string | null = null;

  /** Turns this hand has cost so far. Purely a readout; see the HUD. */
  let assemblyTurns = 0;
  /** The component turn currently resolving, for anything that must wait it out. */
  let componentTurn: Promise<void> = Promise.resolve();

  // ------------------------------------------------------------------ helpers

  /**
   * May a component be taken right now?
   *
   * A "no" here is BLOCKED, never refused: the round a previous component bought
   * is still animating, and the book must not scold you for the game's own
   * animation. Refusals (unlearned page, full hand) live in `book.canRip`.
   */
  const canTakeComponent = (): boolean => !busy && !dead && !fan.busy;

  /**
   * Every component you take costs a turn, and "costs a turn" means the room
   * gets to act — so this is the one place the price is paid. Harvesting from a
   * fixture and drawing off the belt are later phases; they call this and are
   * done, rather than re-deriving what a component costs.
   *
   * Out of combat it is free by construction: an empty room's round does nothing
   * but tick timers, so leafing through the book at rest costs nothing you can
   * see.
   */
  const spendComponentTurn = (cause: TurnCause): void => {
    busy = true;
    componentTurn = (async () => {
      try {
        // Bill the hand only for a round something ACTED in. Counting every
        // component taken advertised a price in an empty room, which is the exact
        // inverse of the rule — so the readout can legitimately show fewer turns
        // than pages held, and that gap IS the reward for assembling out of combat.
        if (await combat.takeTurn(cause)) assemblyTurns++;
      } finally {
        // In `finally` because a throw in the round must not leave input locked:
        // `busy` never clearing soft-locks every gesture in the game, and skipping
        // the follow-ups leaves the reticle and the death check stale.
        busy = false;
        refreshTargets();
        checkDeath();
      }
    })();
    // Nothing on the input path awaits this, so without a handler a throw inside
    // the round is an unhandled rejection that the player never hears about.
    componentTurn.catch((err) => hud.addLog(`The round falters: ${String(err)}`, 0xff6a6a));
  };

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
  const isLegal = (e: Entity, ids: string[]): boolean => {
    const wantsObject = ids.includes('animate');
    const animatable = e.kind === 'prop' && !e.animated;
    if (wantsObject) return animatable;
    return e.hostile || animatable;
  };

  const refreshTargets = (): void => {
    hud.candidates = targetsInView(floor.grid, floor, stepper.x, stepper.y, stepper.dir);
    hud.tornIds = fan.gameIds;
    hud.altarInReach = altarInReach();

    // The DESCEND button only appears when it would actually work.
    const st = floor.entities.find((e) => e.kind === 'stairs');
    hud.setDescendReady(
      combat.bossDead && !!st &&
      Math.abs(st.sprite.tx - stepper.x) + Math.abs(st.sprite.ty - stepper.y) <= 1,
    );

    const ids = fan.gameIds;
    if (hud.target && !hud.candidates.includes(hud.target)) hud.target = null;

    // If what you have torn out cannot be aimed at the current target, move the
    // reticle to something it CAN hit. Tearing Animate with a skeleton selected
    // used to just refuse the cast, which read as the game being broken.
    if (hud.target && !isLegal(hud.target, ids)) hud.target = null;
    if (!hud.target) hud.target = hud.candidates.find((e) => isLegal(e, ids)) ?? null;
  };

  /** Step the reticle to the next legal target — the mobile equivalent of Tab. */
  const cycleTarget = (): void => {
    const ids = fan.gameIds;
    const legal = hud.candidates.filter((e) => isLegal(e, ids));
    if (!legal.length) { hud.target = null; return; }
    const i = hud.target ? legal.indexOf(hud.target) : -1;
    hud.target = legal[(i + 1) % legal.length];
  };

  /**
   * A dedicated star offer pays more than the 2 a maxed page pays.
   *
   * Different jobs: the maxed page's 2 stars is a consolation for a slot nothing
   * else wanted, while this is competing for a slot against a rank, and it has to
   * be worth turning one down. Depth-scaled for the reason chests are — late stars
   * must be worth as much as the floor that yielded them.
   */
  const altarStars = (depth: number): number => 4 + depth * 2;

  /**
   * How often a golden page is on the table at all.
   *
   * Low, because permanence is the one thing a run is not supposed to hand out.
   * Five altars in a full run puts a golden in roughly half of them, which makes
   * it an event you remember rather than a fixture you budget around.
   */
  const GOLDEN_CHANCE = 0.16;

  /**
   * How much heavier the favoured half of the page pool draws — see the bias note
   * in `rollAltarOffers`. Four puts ~1.7 of a two-page roll on the favoured side,
   * which is the difference between "you can steer this" and "you cannot".
   */
  const PAGE_LEAD = 4;

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
    if (rank === 1) {
      return {
        ...base, kind: 'upgrade', name: def.name, tag: 'UPGRADE',
        detail: 'Rank 1 → 2. Casts as two copies.', rank: 1, toRank: 2,
      };
    }
    if (rank < MAX_RANK) {
      if (!spend || spend === id) return null;
      const sp = SPELL_BY_ID[spend];
      return {
        ...base, kind: 'sacrifice', name: def.name, tag: 'SACRIFICE',
        detail: `Rank ${rank} → ${rank + 1}. Casts as ${rank + 1} copies.`,
        cost: `Tears out your rank-2 ${sp?.name ?? spend} for good.`,
        rank, toRank: rank + 1, spendId: spend,
      };
    }
    return {
      ...base, kind: 'star', name: starsName(2), tag: 'CELESTIAL STARS', colour: 0xffcf5c,
      detail: `${def.name} is already mastered. Take a celestial star instead.`,
      amount: 2, rank: MAX_RANK, toRank: 0,
    };
  };

  /**
   * A page you can keep. The gilding is the moment of claiming it, not something
   * the page carries — it lands in the loadout as an ordinary page and starts
   * every later run at rank 1 like any other.
   */
  const goldenOffer = (id: string): AltarOffer => {
    const def = SPELL_BY_ID[id];
    const held = (state.ranks[id] ?? 0) > 0;
    return {
      kind: 'golden', id, name: def?.name ?? id, tag: 'GOLDEN PAGE',
      colour: def?.colour ?? 0xffcf5c,
      detail: held
        ? 'Gilded. It joins the book you begin every run holding.'
        : 'Gilded. Yours now, and in the book you begin every run holding.',
      cost: meta.loadout.length >= meta.slots
        ? 'Your loadout is full — you choose what it replaces.'
        : null,
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
   */
  const rollExtras = (rng: Rng): AltarOffer[] => {
    const pool: AltarOffer[] = [];
    const weights: number[] = [];
    if (state.hp < state.maxHp) {
      // Sized off the descent heal rather than a new curve, so the altar stays
      // inside the attrition budget `tuning.ts` is balanced against. Clamped here
      // rather than on the way in, so the card promises what you will actually get.
      const heal = healable(state.hp, state.maxHp, descendHeal(state.depth));
      pool.push({
        kind: 'heal', id: '', name: `Restore ${heal} Health`, tag: 'MENDING',
        colour: 0x8ce06a,
        detail: `You stand at ${state.hp} of ${state.maxHp}. The altar closes what it can.`,
        cost: null, amount: heal, rank: 0, toRank: 0, maxRank: MAX_RANK, golden: false,
      });
      weights.push(4);
    }
    const stars = altarStars(state.depth);
    pool.push({
      kind: 'stars', id: '', name: starsName(stars), tag: 'CELESTIAL STARS',
      colour: 0xffcf5c,
      detail: 'Banked for the surface. Nothing in the dungeon takes them.',
      cost: null, amount: stars, rank: 0, toRank: 0, maxRank: MAX_RANK, golden: false,
    });
    weights.push(3);
    pool.push({
      kind: 'reroll', id: '', name: 'Reroll Charge', tag: 'FORTUNE', colour: 0x8cc8ff,
      detail: 'Keep it. It turns over any altar\'s three offers, this run only.',
      cost: null, amount: 1, rank: 0, toRank: 0, maxRank: MAX_RANK, golden: false,
    });
    weights.push(3);

    const out: AltarOffer[] = [];
    // A golden page skips the weighting and goes first: when it is on the table it
    // IS the table, and burying it behind a heal would be the wrong emphasis.
    const gild = ELEMENT_SPELLS.filter((sp) => !meta.loadout.includes(sp.id)).map((sp) => sp.id);
    if (!goldenClaimed && gild.length && (goldenForced || rng.chance(GOLDEN_CHANCE))) {
      out.push(goldenOffer(rng.pick(gild)));
    }
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
   * An altar offers a CHOICE of three, on a tap.
   *
   * Three options beat one grant for the obvious reason — a decision is more
   * interesting than a gift — but also because it lets an offer be an UPGRADE to
   * something you already hold. Three and never four: with eight pages a wider
   * roll only makes "every offer is stars" arrive sooner, so widening it is a
   * currency generator in a costume (`docs/DESIGN.md`, Rejected).
   */
  const rollAltarOffers = (e: Entity, nonce = 0): AltarOffer[] => {
    const rng = new Rng(`${runSeed}-altar-${state.depth}-${e.sprite.tx}-${e.sprite.ty}-${nonce}`);
    // Elements only: an altar grants PAGES, and ingredients have none. Deduped
    // because a book may legitimately hold a page twice.
    const owned = [...new Set(state.pages.filter(isPageElement))];
    const unowned = ELEMENT_SPELLS.filter((sp) => !owned.includes(sp.id)).map((sp) => sp.id);
    // A page cannot feed itself, so one rank-2 page buys nothing; it takes two.
    const rank2 = rng.shuffle(owned.filter((id) => (state.ranks[id] ?? 0) === 2));

    /**
     * WHICH pages lead the roll depends on whether fusion is something the player
     * can actually do.
     *
     * A page you do not own is only the better prize while it opens combinations,
     * and at hand size 1 it opens NONE — one page is the whole cast, so a fifth
     * element is a different status effect while a rank is a straight damage
     * increase. Leading with unowned pages there meant a three-page loadout was
     * offered exactly one of its OWN pages per floor, picked at random, so the
     * player could not steer ranks at the one hand size where ranks are all there
     * is. Fusion live at hand 2+ flips it back: then a page you lack is a whole set
     * of casts you cannot make.
     *
     * A weight and not a wall. Grouping the two outright would mean a full
     * three-page loadout is never offered a fourth element while the hand is one,
     * and an element you do not own is still a status you do not have — the bias
     * is about which is usually the headline, not about locking half the book away.
     */
    const fusing = handSize() >= 2;
    const lead = fusing ? unowned : owned;
    const bag = [...owned, ...unowned];
    const weights = bag.map((id) => (lead.includes(id) ? PAGE_LEAD : 1));
    const ordered: string[] = [];
    while (bag.length) {
      const pick = rng.weighted(bag, weights);
      const i = bag.indexOf(pick);
      bag.splice(i, 1);
      weights.splice(i, 1);
      ordered.push(pick);
    }

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
    // A maxed page pays stars, which is not a spell, so that sinks below every page
    // that still has something to teach. Otherwise "at least one spell" could be
    // satisfied by a card that grants no spell.
    const pages = [
      ...offerable.filter((o) => o.kind !== 'star'),
      ...offerable.filter((o) => o.kind === 'star'),
    ];
    const extras = rollExtras(rng);

    /**
     * How many of the three slots are pages. One is the floor — no roll is ever
     * spell-free — and two is the usual shape, so the altar still reads as the
     * place spells come from while everything else it can hand out is genuinely on
     * the table rather than decorating a page draw.
     */
    const pageSlots = Math.max(1, rng.weighted([1, 2, 3], [3, 5, 2]));

    const chosen: AltarOffer[] = [];
    let pi = 0, xi = 0;
    const nextPage = (): AltarOffer | undefined => pages[pi++];
    const nextExtra = (): AltarOffer | undefined => extras[xi++];
    while (chosen.length < 3) {
      // When one side runs dry — a book with nothing left to give, or a full bar
      // with no heal to offer — the other fills, because three is not negotiable.
      const o = chosen.length < pageSlots
        ? nextPage() ?? nextExtra()
        : nextExtra() ?? nextPage();
      if (!o) break;
      chosen.push(o);
    }
    // Shuffled for POSITION only: which offers made it in is already decided, so
    // this just stops the guaranteed spell always being the top card.
    return rng.shuffle(chosen);
  };

  const takeFromAltar = (e: Entity): void => {
    if (e.kind !== 'altar' || e.spent || claimedAltars.has(e)) return;
    const d = Math.abs(e.sprite.tx - stepper.x) + Math.abs(e.sprite.ty - stepper.y);
    if (d > 1) { hud.addLog('Step closer to the altar.'); return; }
    hud.offers = rollAltarOffers(e, altarNonce.get(e) ?? 0);
    hud.offerAltar = e;
  };

  /** What the three cards on the table are, for "did the reroll change anything". */
  const offerSignature = (list: AltarOffer[]): string =>
    list.map((o) => `${o.kind}:${o.id}:${o.amount}`).join('|');

  /**
   * Spend a charge to turn the table over.
   *
   * `rollAltarOffers` is deterministic per altar by design, so a reroll has to
   * advance the seed — and then keep advancing it until the table has actually
   * changed, because a charge spent on the same three cards is a bug the player
   * paid for.
   */
  const rerollOffers = (): void => {
    const e = hud.offerAltar;
    const open = hud.offers;
    if (!e || !open || open.some((o) => o.kind === 'displace')) return;
    if (state.rerolls <= 0) {
      hud.addLog('You have no reroll charges.', 0xffcf5c);
      return;
    }
    const before = offerSignature(open);
    state.rerolls--;
    for (let i = 0; i < 8; i++) {
      const n = (altarNonce.get(e) ?? 0) + 1;
      altarNonce.set(e, n);
      hud.offers = rollAltarOffers(e, n);
      if (offerSignature(hud.offers) !== before) break;
    }
    sfx.shimmer(640);
    hud.addLog(
      `The altar turns over. ${state.rerolls} charge${state.rerolls === 1 ? '' : 's'} left.`,
      0x8cc8ff,
    );
  };

  /**
   * Spend a page for good.
   *
   * The only path in the game that makes the book SMALLER, so it has to undo
   * everything learning a page did: out of `state.pages`, out of `state.ranks`,
   * and back through `setBookPages` / `book.refresh` or the grimoire keeps showing
   * a page whose rank no longer exists. A hand holding it is returned, because
   * nothing else would drop it and casting a page that is no longer yours is worse
   * than losing the turns it cost.
   */
  const burnPage = (id: string): void => {
    state.pages = state.pages.filter((p) => p !== id);
    delete state.ranks[id];
    setBookPages(state.pages);
    book.refresh();
    if (fan.gameIds.includes(id)) fan.clear();
  };

  /**
   * Write a golden page into the permanent loadout.
   *
   * Through the same guards `loadMeta` applies on the way in — element ids only,
   * no duplicates, never more than `slots` — so what this writes is a save the
   * loader would accept. The new page is appended LAST and the trim takes from the
   * front of what was kept, so the thing the player just chose can never be the
   * thing that gets dropped to make room for it.
   */
  const claimGolden = (id: string, drop: string | null): void => {
    const cap = Math.max(1, meta.slots);
    const kept = meta.loadout
      .filter((p) => p !== drop && p !== id && isPageElement(p))
      .slice(0, cap - 1);
    meta.loadout = [...kept, id];
    saveMeta(meta);
    goldenClaimed = true;
  };

  /**
   * The follow-up step a full loadout forces: which page the golden one replaces.
   *
   * A second choice rather than a silent overwrite, because the loadout is the
   * book the player starts every future run with — quietly dropping one of its
   * pages is the single most consequential thing an altar could do without asking.
   */
  const displaceOffers = (id: string): AltarOffer[] => {
    const gold = SPELL_BY_ID[id];
    return meta.loadout.map((drop) => {
      const def = SPELL_BY_ID[drop];
      return {
        kind: 'displace' as const, id: drop, name: def?.name ?? drop, tag: 'REPLACE',
        colour: def?.colour ?? 0xb98cff,
        detail: `${gold?.name ?? id} takes this slot in your starting book.`,
        cost: `You will no longer begin runs holding ${def?.name ?? drop}.`,
        amount: 0, rank: 0, toRank: 0, maxRank: MAX_RANK, golden: false,
      };
    });
  };

  const takeDisplace = (o: AltarOffer): void => {
    const id = pendingGolden;
    hud.offers = null;
    pendingGolden = null;
    if (!id) return;
    claimGolden(id, o.id);
    const gold = SPELL_BY_ID[id];
    hud.setShout(`${(gold?.name ?? id).toUpperCase()} GILDED`, 0xffcf5c);
    hud.addLog(
      `${gold?.name ?? id} takes ${o.name}'s place in your starting book, from the next run on.`,
      0xffcf5c,
    );
    refreshTargets();
  };

  /** Apply the offer the player picked, and empty the altar. */
  const chooseOffer = (o: AltarOffer): void => {
    // Not a roll: the consequence of one already taken, and the altar is spent.
    if (o.kind === 'displace') { takeDisplace(o); return; }

    const e = hud.offerAltar;
    hud.offers = null;
    hud.offerAltar = null;
    if (!e) return;
    claimedAltars.add(e);
    void floor.spendAltar(e);
    const pageName = SPELL_BY_ID[o.id]?.name ?? o.id;

    switch (o.kind) {
      case 'new':
        state.ranks[o.id] = 1;
        learnPage(o.id);
        hud.setShout(`${o.name.toUpperCase()} LEARNED`, o.colour);
        hud.addLog(`The altar yields ${o.name}. ${o.detail}`, o.colour);
        // Deliberately NOT persisted. A page found in the dungeon belongs to this
        // run only; next run you are back to your loadout. Golden pages are the
        // one exception and they go through their own claim path.
        break;
      case 'upgrade':
        state.ranks[o.id] = Math.min(MAX_RANK, (state.ranks[o.id] ?? 1) + 1);
        hud.setShout(`${o.name.toUpperCase()} RANK ${state.ranks[o.id]}`, o.colour);
        hud.addLog(`${o.name} deepens. ${o.detail}`, o.colour);
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
        hud.setShout(`${o.name.toUpperCase()} RANK ${state.ranks[o.id]}`, o.colour);
        hud.addLog(
          `${o.name} reaches rank ${state.ranks[o.id]} — ${SPELL_BY_ID[spend]?.name ?? spend} burns for it.`,
          o.colour,
        );
        break;
      }
      case 'golden':
        // Learned this run too. A permanent page you cannot use until the next run
        // is a reward taken on faith, and the altar has to pay out where it stands.
        if ((state.ranks[o.id] ?? 0) === 0) {
          state.ranks[o.id] = 1;
          learnPage(o.id);
        }
        if (meta.loadout.length < meta.slots) {
          claimGolden(o.id, null);
          hud.setShout(`${o.name.toUpperCase()} GILDED`, 0xffcf5c);
          hud.addLog(`${o.name} is yours for good — it is in your book from the next run on.`, 0xffcf5c);
        } else {
          pendingGolden = o.id;
        }
        break;
      case 'heal': {
        // Recomputed rather than trusted: the offer's number was clamped when the
        // card was built, and the bar has not moved since, but the bar is the
        // authority on what it can take.
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
      case 'reroll':
        state.rerolls += o.amount;
        hud.setShout('REROLL CHARGE', 0x8cc8ff);
        hud.addLog(
          `You pocket a charge. ${state.rerolls} in hand — spend one at any altar.`,
          0x8cc8ff,
        );
        break;
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

    entityPos(e, tmp);
    fx.rise(tmp, o.colour);
    sfx.shimmer(o.golden ? 990 : o.kind === 'star' || o.kind === 'stars' ? 720 : 880);
    refreshTargets();
    // The displace choice opens while the altar's light is still up, so claiming
    // and paying for it read as one moment rather than two unrelated modals.
    if (pendingGolden) hud.offers = displaceOffers(pendingGolden);
  };

  /**
   * Open a chest. Chests are the run's star payout plus a little healing, which
   * is what makes a detour off the path to the boss worth taking.
   */
  const openChest = (e: Entity): void => {
    if (e.kind !== 'chest' || e.spent) return;
    const d = Math.abs(e.sprite.tx - stepper.x) + Math.abs(e.sprite.ty - stepper.y);
    if (d > 1) { hud.addLog('Step closer to the chest.'); return; }
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
    entityPos(e, tmp);
    fx.rise(tmp, 0xffcf5c);
    sfx.shimmer(720);
    refreshTargets();
  };

  /** The nearest unused altar or chest you could reach, for the prompt. */
  const altarInReach = (): Entity | null => {
    for (const e of floor.entities) {
      if (!e.alive || e.spent) continue;
      if (e.kind !== 'altar' && e.kind !== 'chest') continue;
      if (Math.abs(e.sprite.tx - stepper.x) + Math.abs(e.sprite.ty - stepper.y) <= 1) return e;
    }
    return null;
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

    combat.onPlayerHurt = () => {
      hud.playerHurt();
      fx.shake = Math.min(1.3, fx.shake + 0.5);
    };

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

    combat.onCastFx = (cast, _from, targets) => {
      if (cast.output === 'golem') {
        const t = targets[0];
        if (t) { entityPos(t, tmp); tmp.y = 0.05; fx.rise(tmp, cast.colour); }
        return;
      }
      targets.forEach((t, i) => {
        const to = entityPos(t, new THREE.Vector3());
        fx.bolt(muzzle(new THREE.Vector3()), to, cast.colour, {
          delay: i * 0.075,
          size: 0.3 + Math.min(0.35, cast.damage * 0.012),
          onArrive: () => fx.burst(to, cast.colour, 0.9 + Math.min(1, cast.damage / 20)),
        });
      });
      engine.setFlash(0.16, cast.colour);
    };
  };

  // ------------------------------------------------------------- floor loading

  const enterFloor = async (depth: number): Promise<void> => {
    busy = true;
    document.getElementById('boot')?.classList.remove('gone');
    if (floor) { engine.scene.remove(floor.group); floor.dispose(); }

    state.depth = depth;
    const theme = THEMES[Math.min(THEMES.length - 1, depth - 1)];
    floor = await Floor.create(depth, `${runSeed}-floor-${depth}`);
    engine.scene.add(floor.group);

    stepper = new Stepper(floor.grid, floor.grid.start.x, floor.grid.start.y, floor.grid.start.dir);
    combat = new Combat(floor, state, `${runSeed}-floor-${depth}`);
    hud = new Hud(engine, state, combat, () => fan.gameIds, () => { fan.clear(); refreshTargets(); });
    hud.bookClosed = book.closed;
    hud.bankedStars = meta.stars;
    hud.bindMap(() => ({ floor, x: stepper.x, y: stepper.y, dir: stepper.dir }));
    wireCombat();

    stepper.canAct = () => !busy && !dead && !hud.offers;
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
    stepper.onDepart = (fx, fy, tx, ty) => {
      const ally = friendlyAt(tx, ty);
      if (!ally) return;
      ally.sprite.tx = fx; ally.sprite.ty = fy;
      ally.sprite.setTileLight(floor.grid.lightAt(fx, fy));
      ally.sprite.play('walk');
    };
    stepper.onArrive = async (x, y) => {
      floor.cull(x, y);
      refreshTargets();
      busy = true;
      await combat.playerStepped(x, y);
      busy = false;
      refreshTargets();
      checkDeath();
    };
    stepper.onTurnDone = () => refreshTargets();
    stepper.onBump = () => { fx.shake = Math.min(1, fx.shake + 0.22); };

    floor.cull(stepper.x, stepper.y);
    refreshTargets();

    hud.addLog(theme.name, theme.accent);
    hud.setShout(`DEPTH ${'I'.repeat(Math.min(5, depth))}`, theme.accent);
    busy = false;
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
    // The grimoire shuts. An open book under the run-end card is a lit, legible
    // control on a screen that has none, and it is the brightest thing on the frame.
    book.closed = true;
    hud.bookClosed = true;
    hud.runEnd = { kind, depth: state.depth, earned };
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
    const d = Math.abs(st.sprite.tx - stepper.x) + Math.abs(st.sprite.ty - stepper.y);
    if (d > 1) { hud.addLog('The stairs are further in.'); return; }
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
    // Heal on descent, sized off the depth being LEFT, so a good floor is rewarded
    // but attrition is real.
    state.hp += healable(state.hp, state.maxHp, descendHeal(state.depth));
    await enterFloor(state.depth + 1);
  };

  // ---------------------------------------------------------------- the star tree

  /**
   * Everything a purchase or a refund has to settle, in one place.
   *
   * The tree screen and the death-screen routing are a follow-up task; what has to
   * exist first is that buying and selling are a single transaction — derive, save,
   * and reconcile the live run with the new ceiling — so that no caller can perform
   * half of one.
   */
  const afterTreeChange = (): void => {
    applyTree(meta);
    saveMeta(meta);
    // A refund can drop the ceiling below what is already torn out. Returning a
    // component is free and never punished (`docs/DESIGN.md`, Turn economy), so the
    // hand goes back in the book rather than the ceiling being quietly exceeded.
    if (fan.count > handSize()) { fan.clear(); refreshTargets(); }
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
   * destroy is a page: selling the fourth binding gives up the fourth slot, so a
   * golden page sitting in it is reported back rather than vanishing quietly.
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
    /**
     * What a refund would cost beyond stars. Selling a slot node drops pages off
     * the front of the loadout (`applyTree`), and the only page that can be in
     * there is one a golden altar offer put there — so it is named before the tap
     * rather than reported after it.
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

  // ------------------------------------------------------------------- the loop

  engine.onUpdate = (dt) => {
    // hitstop: freeze the world briefly on impact, but keep the UI ticking
    const scale = fx.hitstop > 0 ? 0.12 : 1;
    const wdt = dt * scale;

    stepper.update(wdt);
    stepper.eye(eye, engine.time);

    // screen shake, applied as a positional jitter + roll
    const s = fx.shake * fx.shake;
    const jx = Math.sin(engine.time * 61) * 0.05 * s;
    const jy = Math.sin(engine.time * 47 + 1.7) * 0.05 * s;
    engine.camera.position.set(eye.x + jx, eye.y + jy, eye.z);
    engine.camera.rotation.set(PITCH, stepper.yaw(), stepper.roll() + jx * 0.6, 'YXZ');

    floor.update(wdt, engine.time, eye);
    fx.update(dt, engine.camera.quaternion);
    tickBook(dt, engine.time);
    // Lay the HUD out against the book's real edge too, so the cast bar and the
    // swipe boundary never disagree.
    const top = book.screenTop();
    hud.setBookTop(top);
    // Frame the world for the strip above the book — but only off a settled book.
    // `screenTop` projects live geometry, so during the intro glide and mid-flip it
    // reports an edge the book never actually rests at.
    if (!book.closed && !book.busy && Number.isFinite(top)) engine.frameAbove(top);
    // The assembly's bill is cleared by the hand emptying, however it emptied —
    // and the merge animation empties the fan from inside itself, so watching the
    // count is the only place that catches a cast and a return with one rule.
    if (fan.count === 0) assemblyTurns = 0;
    hud.assemblyTurns = assemblyTurns;
    // The fusion ceiling, on screen. Nothing else in the game states it, and at a
    // hand of one the player would otherwise only ever meet it as a refusal.
    hud.handSize = handSize();
    hud.handHeld = fan.count;
    // Named on the page it belongs to, so "not learned" never has to share a
    // channel with "hand full".
    hud.sealedPage = !book.closed && !state.pages.includes(book.currentSpell.gameId)
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
    if (t && t.alive && t.kind === 'prop' && !t.animated && t.golemId) return null;
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
      // Free: assembling the hand already paid, one turn per component. A false
      // here means the check above missed something and the hand is already gone —
      // it must not be swallowed, or the two ends of the contract drift apart again.
      if (!await combat.cast(ids, hud.target)) {
        hud.addLog('The cast comes apart in your hands.', 0xff9a6a);
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
        if (a.entity.kind === 'altar') { takeFromAltar(a.entity); break; }
        if (a.entity.kind === 'chest' && !a.entity.spent) { openChest(a.entity); break; }
        hud.target = a.entity;
        break;
      case 'cycle': cycleTarget(); break;
      case 'altar': takeFromAltar(a.entity); break;
      case 'harvest': harvestFrom(a.entity); break;
      case 'offer': chooseOffer(a.offer); break;
      case 'reroll': rerollOffers(); break;
      case 'chest': openChest(a.entity); break;
      case 'bookToggle':
        book.closed = !book.closed;
        hud.bookClosed = book.closed;
        sfx.pageFlip();
        break;
      case 'move': stepper.press({ kind: 'move', m: a.m }); break;
      case 'turn': stepper.press({ kind: 'turn', d: a.d }); break;
      case 'descend': void descend(); break;
      default: break;
    }
  };

  const stage = document.getElementById('stage') as HTMLElement;
  let st = 0;
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

  const local = (e: PointerEvent): { x: number; y: number } => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** UI actions that are explicit controls — these always beat a page gesture. */
  const UI_CONTROLS: ReadonlySet<string> =
    new Set(['cast', 'clear', 'descend', 'bookToggle', 'cycle', 'altar', 'chest', 'harvest', 'tree']);

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
    if (treeOpen) {
      treeDown = true; treeY0 = y; treeScroll0 = treeScreen.scroll; treeMoved = 0;
      return;
    }
    st = performance.now();
    px0 = x; py0 = y; lastX = x; lastT = st; vx = 0;
    deniedThisDrag = false;
    onBook = overBook(x, y);
    if (onBook) hud.bookClosed = book.closed;
  });

  stage.addEventListener('pointermove', (e) => {
    if (treeOpen) {
      if (!treeDown) return;
      const dy = local(e).y - treeY0;
      treeMoved = Math.max(treeMoved, Math.abs(dy));
      treeScreen.scrollTo(treeScroll0 - dy);
      return;
    }
    if (!onBook || dead) return;
    const { x, y } = local(e);
    const now = performance.now();
    if (now > lastT) { vx = (x - lastX) / (now - lastT); lastT = now; lastX = x; }
    const dx = x - px0, dy = y - py0;
    // Commit to an axis: horizontal leafs, upward tears.
    if (Math.abs(dx) > Math.abs(dy)) book.flipDrag(dx);
    else if (dy < 0) {
      // A round bought by the last component is still resolving: blocked, not
      // refused, so it stays silent.
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
    const { x, y } = local(e);
    if (treeOpen) {
      treeDown = false;
      // A scroll that happens to end over a card must not buy it.
      if (treeMoved < 10) actTree(treeScreen.hit(x, y));
      return;
    }
    // A finished run resolves its tap through the HUD, so the run-end card's door to
    // the tree is a real control — and `act` sends every other tap the same way.
    if (dead) { act(hud.hit(x, y)); return; }
    const moved = Math.hypot(x - px0, y - py0);

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
        act(ui);
      }
      return;
    }

    // A tap resolves against the HUD (targets, cast, toggles); a swipe moves.
    if (moved < 24) { act(hud.hit(x, y)); return; }
    if (performance.now() - st < 700) {
      const dx = x - px0, dy = y - py0;
      if (Math.abs(dy) > Math.abs(dx)) stepper.press({ kind: 'move', m: dy < 0 ? 'forward' : 'back' });
      else stepper.press({ kind: 'turn', d: dx < 0 ? -1 : 1 });
    }
  });
  stage.addEventListener('pointercancel', () => {
    onBook = false; treeDown = false; book.dragEnd(0);
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
    KeyW: () => stepper.press({ kind: 'move', m: 'forward' }),
    KeyS: () => stepper.press({ kind: 'move', m: 'back' }),
    KeyA: () => stepper.press({ kind: 'move', m: 'left' }),
    KeyD: () => stepper.press({ kind: 'move', m: 'right' }),
    KeyQ: () => stepper.press({ kind: 'turn', d: -1 }),
    KeyE: () => stepper.press({ kind: 'turn', d: 1 }),
    Space: () => void doCast(),
    Escape: () => hud.clearSelection(),
    Tab: () => cycleTarget(),
    KeyF: () => void descend(),
  };
  // Keyboard mirrors the gestures: brackets leaf through, digits tear a page out.
  keys.BracketLeft = () => book.swipe(-1);
  keys.BracketRight = () => book.swipe(1);
  // Same path the HUD's own clear takes: returning the hand changes what is
  // targetable, so the reticle and `hud.tornIds` have to be rebuilt with it.
  keys.KeyR = () => { fan.clear(); refreshTargets(); };
  keys.KeyB = () => { book.closed = !book.closed; hud.bookClosed = book.closed; };
  // Harvest the selected fixture — the keyboard mirror of the HARVEST pill.
  keys.KeyH = () => { if (hud.target) harvestFrom(hud.target); };
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
  document.getElementById('boot')?.classList.add('gone');
  // The book rises into frame and leafs itself onto the first page.
  book.playIntro();

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
     * Assemble a hand outright. Async now: each tear buys the room a round, and
     * the next tear is blocked until that round has finished animating. The hand
     * size is lifted FOR THE DURATION so a scripted three-page fusion still works
     * at the real starting hand size of one — and dropped again in `finally`,
     * because leaving it lifted raised the real tear ceiling for the rest of the
     * session and quietly ran every later check at hand size 3.
     */
    selectPages: async (ids: string[]) => {
      fan.clear();
      handSizeBonus = Math.max(0, ids.length - meta.handSize);
      try {
        for (const id of ids) {
          const i = BOOK_PAGES.findIndex((pg) => pg.gameId === id);
          if (i >= 0 && tearPage(i)) await componentTurn;
        }
      } finally {
        handSizeBonus = 0;
      }
    },
    /**
     * The fixtures in sight that would give up an element, with what each yields.
     *
     * The list IS the acceptance criterion "animating a fixture removes it from the
     * harvest list", so it has to be one call and it has to be derived from the same
     * two things the pill is: what `targetsInView` can see, and `harvestOf`.
     */
    harvestable: () => hud.candidates
      .filter((e) => e.alive && e.kind === 'prop' && !e.animated && !!harvestOf(e.spriteId))
      .map((e) => ({ e, spriteId: e.spriteId, yields: harvestOf(e.spriteId) })),
    /**
     * Harvest the reticle's fixture, or a given one. Same path as the pill, so it
     * pays the same slot and the same turn; await `componentTurn` for the round.
     */
    harvest: async (e?: Entity) => {
      const t = e ?? hud.target;
      if (!t || !harvestFrom(t)) return false;
      await componentTurn;
      return true;
    },
    /**
     * What the HUD would do with a tap here, without doing it — the HUD's controls
     * are laid out from measured text and a measured book edge, so where one IS is
     * only answerable by asking.
     */
    hudAt: (x: number, y: number) => hud.hit(x, y).kind,
    /** Resolve a tap against the HUD, so a drawn control can be proven tappable. */
    tapHud: (x: number, y: number) => {
      const a = hud.hit(x, y);
      act(a);
      return a.kind;
    },
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
    targetKind: (kind: string) => {
      const e = floor.entities.find((x) => x.alive && x.kind === kind);
      if (e) hud.target = e;
      return !!e;
    },
    castNow: () => doCast(),
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
    /** Same reach rule as the tap, so `place` next to it first. Returns the offers. */
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
    /**
     * Take an offer by index, or the object `openAltar` handed back.
     *
     * Also drives the golden page's follow-up step: claiming one with a full
     * loadout replaces `hud.offers` with the displace choice, and picking from that
     * list is the same call again.
     */
    pickOffer: (o: number | AltarOffer) => {
      const list = hud.offers;
      if (!list) return null;
      const pick = typeof o === 'number' ? list[o] : o;
      if (!pick) return null;
      chooseOffer(pick);
      return pick;
    },
    /** Spend a banked charge on the open altar. Returns the new offers. */
    rerollAltar: () => { rerollOffers(); return hud.offers; },
    /** Bank reroll charges outright, so the spend path is drivable on its own. */
    grantRerolls: (n: number) => { state.rerolls = Math.max(0, n); return state.rerolls; },
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
     *  - golden never, because it writes the persisted loadout and opens a second
     *    modal. Driving it is `openAltarKind` plus `pickOffer`, deliberately.
     */
    takeAltar: (e: Entity) => {
      takeFromAltar(e);
      const list = hud.offers;
      if (!list?.length) return null;
      const order = ['upgrade', 'heal', 'new', 'stars', 'reroll', 'star', 'sacrifice'];
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
    openTree: () => { openTree(); return treeOpen; },
    treeOpen: () => treeOpen,
    treeControls: () => treeScreen.controls(),
    treeMessage: () => treeScreen.message,
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
     * runs that would pay for it — the same reason `grantRerolls` exists. Sets
     * rather than adds, and goes through the same transaction, so the bank the HUD
     * shows and the saved bank cannot part company.
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
