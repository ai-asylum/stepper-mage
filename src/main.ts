import * as THREE from 'three';
import { Engine } from './core/engine';
import { Floor, type Entity } from './game/floor';
import { Stepper, PITCH } from './game/stepper';
import {
  Combat, targetsInView, MAX_RANK, type PlayerState, type TurnCause,
} from './game/combat';
import { CastFx } from './spells/vfx';
import { Hud, type AltarOffer } from './ui/hud';
import { Book } from './book/book';
import { Fan } from './book/fan';
import {
  bookScene, camera as bookCam, tickBook, resizeBook, sinks, sfx,
} from './book/bridge';
import { SPELLS as BOOK_PAGES, setBookPages } from './spells/pages';
import { ELEMENT_SPELLS, SPELL_BY_ID, isElement } from './spells/spells';
import { Rng } from './core/rng';
import type { Dir } from './dungeon/grid';
import { THEMES } from './art/theme';
import {
  CHEST_HEAL_BASE, CHEST_HEAL_SPREAD, DESCEND_HEAL, PLAYER_MAX_HP,
} from './game/tuning';

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
  /** How many pages the starting book can hold. */
  slots: number;
  /**
   * How many components you can hold at once — the fusion ceiling.
   *
   * One at the start, because a hand of one is where fusion gets SOLD rather
   * than taught: you buy the second slot, try holding two pages, and work out
   * combining for yourself. Nothing to do with `slots`, which is how big the
   * starting book is.
   */
  handSize: number;
  best: number;
}

const META_KEY = 'stepper-mage.meta.v1';

/**
 * The loadout is a book, and the book holds elements only. Animate used to sit
 * in the starting three, so every save from before the split has an id in here
 * that no longer has a page — those are dropped rather than migrated to
 * something else, because an ingredient is not a page's worth of value.
 */
const DEFAULT_LOADOUT = ['fire', 'frost', 'spark'];

function loadMeta(): Meta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const m = JSON.parse(raw) as Partial<Meta> & { unlocked?: string[] };
      // `unlocked` is the pre-reset field name; migrate it but clamp to the slot
      // count so an old save that had accumulated every page does not carry that
      // advantage into the corrected rules.
      const legacy = Array.isArray(m.unlocked) ? m.unlocked : [];
      const slots = m.slots ?? 3;
      const loadout = (Array.isArray(m.loadout) && m.loadout.length ? m.loadout : legacy)
        .filter(isElement);
      return {
        stars: m.stars ?? 0,
        loadout: loadout.length ? loadout.slice(0, slots) : [...DEFAULT_LOADOUT],
        slots,
        // A save from before the turn economy has no hand size, and it must
        // migrate to ONE rather than to the old hardcoded three — the pre-reset
        // saves paid nothing for those slots.
        handSize: Math.max(1, m.handSize ?? 1),
        best: m.best ?? 0,
      };
    }
  } catch { /* corrupt or unavailable storage: fall through to defaults */ }
  return { stars: 0, loadout: [...DEFAULT_LOADOUT], slots: 3, handSize: 1, best: 0 };
}

function saveMeta(m: Meta): void {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* private mode */ }
}

async function boot(): Promise<void> {
  const engine = new Engine({ internalHeight: 400, levels: 36 });
  const meta = loadMeta();
  const runSeed = `run-${Date.now() % 100000}`;

  const state: PlayerState = {
    hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP,
    pages: [...meta.loadout],
    ranks: Object.fromEntries(meta.loadout.map((id) => [id, 1])),
    stars: 0,
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
   * Tearing a page out. The only refusals here are "you have not learned this
   * spell" and "your hand is full": the tear's real price is a TURN, and that is
   * charged on the way out (see `spendComponentTurn`) rather than gating the
   * gesture — you can always afford a turn, you just may not like what it buys
   * the room.
   */
  book.canRip = (spell) => {
    if (fan.count >= handSize()) return false;
    return state.pages.includes(spell.gameId);
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

  const tearPage = (index: number): boolean =>
    canTakeComponent() ? book.tearAt(index) : false;

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
    assemblyTurns++;
    busy = true;
    componentTurn = (async () => {
      try {
        await combat.takeTurn(cause);
      } finally {
        busy = false;
      }
      refreshTargets();
      checkDeath();
    })();
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
   * Animate needs an OBJECT; a bolt wants something that can be hurt. Knowing
   * this lets targeting follow the spell instead of making the player discover
   * the mismatch from a refusal message.
   */
  const isLegal = (e: Entity, ids: string[]): boolean => {
    const wantsObject = ids.includes('animate');
    const animatable = e.kind === 'prop' && !e.animated;
    if (wantsObject) return animatable;
    if (!ids.length) return e.hostile || animatable;
    return e.hostile;              // bolts want something that bleeds
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
   * An altar offers a CHOICE of three, on a tap.
   *
   * Three options beat one grant for the obvious reason — a decision is more
   * interesting than a gift — but also because it lets an offer be an UPGRADE to
   * something you already hold. And when a rolled page is already maxed there is
   * nothing left to give, so it pays out a celestial star instead: the run feeds
   * the meta precisely when the run is out of things to teach you.
   */
  const rollAltarOffers = (e: Entity): AltarOffer[] => {
    const rng = new Rng(`${runSeed}-altar-${state.depth}-${e.sprite.tx}-${e.sprite.ty}`);
    // Elements only: an altar grants PAGES, and ingredients have none.
    const owned = state.pages.filter(isElement);
    const unowned = ELEMENT_SPELLS.filter((sp) => !owned.includes(sp.id));
    const offers: AltarOffer[] = [];
    const used = new Set<string>();

    // Bias toward pages you do not have — new options open more fusions than a
    // rank does, so they should be the headline.
    const bag = [
      ...rng.shuffle(unowned.map((sp) => sp.id)),
      ...rng.shuffle(owned.slice()),
    ];

    for (const id of bag) {
      if (offers.length >= 3 || used.has(id)) continue;
      used.add(id);
      const def = SPELL_BY_ID[id];
      if (!def) continue;
      const rank = state.ranks[id] ?? 0;
      if (rank === 0) offers.push({ kind: 'new', id, name: def.name, colour: def.colour, detail: def.effect });
      else if (rank < MAX_RANK) {
        offers.push({
          kind: 'upgrade', id, name: def.name, colour: def.colour,
          detail: `Rank ${rank} → ${rank + 1}. Casts as ${rank + 1} copies.`,
        });
      } else {
        offers.push({
          kind: 'star', id, name: def.name, colour: 0xffcf5c,
          detail: 'Already mastered. Take a celestial star instead.',
        });
      }
    }
    return offers;
  };

  const takeFromAltar = (e: Entity): void => {
    if (e.kind !== 'altar' || e.spent || claimedAltars.has(e)) return;
    const d = Math.abs(e.sprite.tx - stepper.x) + Math.abs(e.sprite.ty - stepper.y);
    if (d > 1) { hud.addLog('Step closer to the altar.'); return; }
    hud.offers = rollAltarOffers(e);
    hud.offerAltar = e;
  };

  /** Apply the offer the player picked, and empty the altar. */
  const chooseOffer = (o: AltarOffer): void => {
    const e = hud.offerAltar;
    hud.offers = null;
    hud.offerAltar = null;
    if (!e) return;
    claimedAltars.add(e);
    void floor.spendAltar(e);

    if (o.kind === 'new') {
      state.ranks[o.id] = 1;
      learnPage(o.id);
      hud.setShout(`${o.name.toUpperCase()} LEARNED`, o.colour);
      hud.addLog(`The altar yields ${o.name}. ${o.detail}`, o.colour);
      // Deliberately NOT persisted. A page found in the dungeon belongs to this
      // run only; next run you are back to your loadout. Golden pages are the
      // one exception and they go through their own claim path.
    } else if (o.kind === 'upgrade') {
      state.ranks[o.id] = Math.min(MAX_RANK, (state.ranks[o.id] ?? 1) + 1);
      hud.setShout(`${o.name.toUpperCase()} RANK ${state.ranks[o.id]}`, o.colour);
      hud.addLog(`${o.name} deepens. ${o.detail}`, o.colour);
    } else {
      state.stars += 2;
      hud.setShout('✦ 2 CELESTIAL STARS', 0xffcf5c);
      hud.addLog(`${o.name} is already mastered — the altar pays in stars.`, 0xffcf5c);
    }

    entityPos(e, tmp);
    fx.rise(tmp, o.colour);
    sfx.shimmer(o.kind === 'star' ? 720 : 880);
    refreshTargets();
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
    const heal = CHEST_HEAL_BASE + rng.int(0, CHEST_HEAL_SPREAD);
    state.stars += stars;
    state.hp = Math.min(state.maxHp, state.hp + heal);
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
      hud.addLog(ev.text, ev.colour ?? 0xd8c9a0);
    };

    combat.onPlayerHurt = () => {
      hud.playerHurt();
      fx.shake = Math.min(1.3, fx.shake + 0.5);
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

  const checkDeath = (): void => {
    if (state.hp > 0 || dead) return;
    dead = true;
    engine.setDesat(0.85);
    meta.stars += state.stars;
    meta.best = Math.max(meta.best, state.depth);
    saveMeta(meta);
  };

  const descend = async (): Promise<void> => {
    if (!combat.bossDead) return;
    const st = floor.entities.find((e) => e.kind === 'stairs');
    if (!st) return;
    const d = Math.abs(st.sprite.tx - stepper.x) + Math.abs(st.sprite.ty - stepper.y);
    if (d > 1) { hud.addLog('The stairs are further in.'); return; }
    if (state.depth >= THEMES.length) {
      hud.setShout('THE VAULT IS YOURS', 0xffe58a);
      hud.addLog('You have taken everything the dungeon had. For now.', 0xffe58a);
      meta.stars += state.stars + 25;
      meta.best = THEMES.length;
      saveMeta(meta);
      dead = true;
      engine.setDesat(0.5);
      return;
    }
    // Heal a little on descent, so a good floor is rewarded but attrition is real.
    state.hp = Math.min(state.maxHp, state.hp + DESCEND_HEAL);
    await enterFloor(state.depth + 1);
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
    hud.update(dt);
  };

  engine.onRender = (ctx) => hud.draw(ctx);

  // ---------------------------------------------------------------------- input

  const doCast = async (): Promise<void> => {
    if (busy || dead || fan.busy) return;
    // Capture the ids first: the merge animation clears the fan on completion.
    const ids = fan.gameIds;
    if (!ids.length) return;

    // Refuse before the animation if the cast is illegal, so the pages stay in
    // hand rather than being spent on a deny.
    const dry = hud.currentCast();
    if (dry?.refusal) {
      combat.onEvent({ kind: 'deny', text: dry.refusal });
      sfx.deny();
      return;
    }

    busy = true;
    // The torn pages converge and merge in a burst of gold, THEN the spell fires.
    await new Promise<void>((resolve) => fan.mergeAndCast(resolve));
    sfx.cast(dry ? 200 + (dry.colour & 255) : 300);
    // Free: assembling the hand already paid, one turn per component.
    await combat.cast(ids, hud.target);
    busy = false;
    refreshTargets();
    checkDeath();
  };

  const act = (a: ReturnType<Hud['hit']>): void => {
    if (dead) {
      // tap anywhere to start a fresh run
      location.reload();
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
      case 'offer': chooseOffer(a.offer); break;
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
  /** Latch so one refused tear makes one sound, not one per pointermove. */
  let deniedThisDrag = false;

  const local = (e: PointerEvent): { x: number; y: number } => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** UI actions that are explicit controls — these always beat a page gesture. */
  const UI_CONTROLS: ReadonlySet<string> =
    new Set(['cast', 'clear', 'descend', 'bookToggle', 'cycle', 'altar', 'chest']);

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
    st = performance.now();
    px0 = x; py0 = y; lastX = x; lastT = st; vx = 0;
    deniedThisDrag = false;
    onBook = overBook(x, y);
    if (onBook) hud.bookClosed = book.closed;
  });

  stage.addEventListener('pointermove', (e) => {
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
      }
    }
  });

  stage.addEventListener('pointerup', (e) => {
    const { x, y } = local(e);
    if (dead) { location.reload(); return; }
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
  stage.addEventListener('pointercancel', () => { onBook = false; book.dragEnd(0); });

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
  keys.KeyR = () => fan.clear();
  keys.KeyB = () => { book.closed = !book.closed; hud.bookClosed = book.closed; };
  for (let i = 1; i <= 9; i++) {
    keys[`Digit${i}`] = () => tearPage(i - 1);
  }
  window.addEventListener('keydown', (e) => {
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
     * size is lifted for the duration so a scripted three-page fusion still
     * works at the real starting hand size of one.
     */
    selectPages: async (ids: string[]) => {
      fan.clear();
      handSizeBonus = Math.max(handSizeBonus, ids.length - meta.handSize);
      for (const id of ids) {
        const i = BOOK_PAGES.findIndex((pg) => pg.gameId === id);
        if (i >= 0 && tearPage(i)) await componentTurn;
      }
    },
    targetKind: (kind: string) => {
      const e = floor.entities.find((x) => x.alive && x.kind === kind);
      if (e) hud.target = e;
      return !!e;
    },
    castNow: () => doCast(),
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
