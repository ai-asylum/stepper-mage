import * as THREE from 'three';
import { Engine } from './core/engine';
import { Floor, type Entity } from './game/floor';
import { Stepper, PITCH } from './game/stepper';
import { Combat, targetsInView, type PlayerState } from './game/combat';
import { CastFx } from './spells/vfx';
import { Hud } from './ui/hud';
import { Book } from './book/book';
import { Fan } from './book/fan';
import {
  bookScene, camera as bookCam, tickBook, resizeBook, sinks, sfx,
} from './book/bridge';
import { SPELLS as BOOK_PAGES, setBookPages } from './spells/pages';
import { SPELLS, SPELL_BY_ID } from './spells/spells';
import { Rng } from './core/rng';
import type { Dir } from './dungeon/grid';
import { THEMES } from './art/theme';

/** Persisted meta: stars carry across runs and buy starting pages. */
interface Meta { stars: number; unlocked: string[]; best: number; }

const META_KEY = 'stepper-mage.meta.v1';

function loadMeta(): Meta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const m = JSON.parse(raw) as Meta;
      return {
        stars: m.stars ?? 0,
        unlocked: Array.isArray(m.unlocked) && m.unlocked.length ? m.unlocked : ['fire', 'frost', 'animate'],
        best: m.best ?? 0,
      };
    }
  } catch { /* corrupt or unavailable storage: fall through to defaults */ }
  return { stars: 0, unlocked: ['fire', 'frost', 'animate'], best: 0 };
}

function saveMeta(m: Meta): void {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* private mode */ }
}

async function boot(): Promise<void> {
  const engine = new Engine({ internalHeight: 400, levels: 36 });
  const meta = loadMeta();
  const runSeed = `run-${Date.now() % 100000}`;

  const state: PlayerState = {
    hp: 24, maxHp: 24,
    pages: [...meta.unlocked],
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

  /**
   * Tearing a page out. The only refusals are "you have not learned this spell"
   * and "your hand is full" — there is no cost to pay, so the tear is limited by
   * knowledge and by the three-page fusion ceiling.
   */
  book.canRip = (spell) => {
    if (fan.count >= 3) return false;
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
  };

  const tearPage = (index: number): boolean => book.tearAt(index);

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

  // ------------------------------------------------------------------ helpers

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

  /** An altar grants one page the player does not already hold — on a TAP. */
  const takeFromAltar = (e: Entity): void => {
    if (e.kind !== 'altar' || e.spent || claimedAltars.has(e)) return;
    const d = Math.abs(e.sprite.tx - stepper.x) + Math.abs(e.sprite.ty - stepper.y);
    if (d > 1) { hud.addLog('Step closer to the altar.'); return; }
    {
      claimedAltars.add(e);
      void floor.spendAltar(e);
      const rng = new Rng(`${runSeed}-altar-${state.depth}`);
      const missing = SPELLS.filter((s) => !state.pages.includes(s.id));
      const pick = missing.length ? rng.pick(missing) : rng.pick(SPELLS);
      learnPage(pick.id);
      hud.setShout(`${pick.name.toUpperCase()} LEARNED`, pick.colour);
      hud.addLog(`The altar yields ${pick.name}. ${pick.effect}`, pick.colour);
      entityPos(e, tmp);
      fx.rise(tmp, pick.colour);
      if (!meta.unlocked.includes(pick.id) && meta.unlocked.length < SPELLS.length) {
        // Pages found in the dungeon become available to future runs — the
        // knowledge-as-progression meta, rather than raw power creep.
        meta.unlocked.push(pick.id);
        saveMeta(meta);
      }
      refreshTargets();
    }
  };

  /** The nearest unspent altar you could reach right now, for the prompt. */
  const altarInReach = (): Entity | null => {
    for (const e of floor.entities) {
      if (e.kind !== 'altar' || e.spent || !e.alive) continue;
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
    hud.bindMap(() => ({ floor, x: stepper.x, y: stepper.y, dir: stepper.dir }));
    wireCombat();

    stepper.canAct = () => !busy && !dead;
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
    state.hp = Math.min(state.maxHp, state.hp + 8);
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
        hud.target = a.entity;
        break;
      case 'cycle': cycleTarget(); break;
      case 'altar': takeFromAltar(a.entity); break;
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
  // owns the bottom of the screen ONLY while it is open — closed, the whole
  // screen is the dungeon.
  const BOOK_ZONE = 0.60;

  let onBook = false;
  let px0 = 0, py0 = 0, lastT = 0, lastX = 0, vx = 0;
  /** Latch so one refused tear makes one sound, not one per pointermove. */
  let deniedThisDrag = false;

  const local = (e: PointerEvent): { x: number; y: number } => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Is this pointer position a book gesture rather than a dungeon gesture? */
  const overBook = (x: number, y: number): boolean => {
    if (book.closed) return false;
    if (book.ribbonAt(x, y) !== null) return true;
    return y > stage.clientHeight * BOOK_ZONE;
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
        const ribbon = book.ribbonAt(x, y);
        if (ribbon) { book.goToChapter(ribbon); return; }
        act(hud.hit(x, y));
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
    selectPages: (ids: string[]) => {
      fan.clear();
      for (const id of ids) {
        const i = BOOK_PAGES.findIndex((pg) => pg.gameId === id);
        if (i >= 0) tearPage(i);
      }
    },
    targetKind: (kind: string) => {
      const e = floor.entities.find((x) => x.alive && x.kind === kind);
      if (e) hud.target = e;
      return !!e;
    },
    castNow: () => doCast(),
    grantAll: () => { state.pages = SPELLS.map((s) => s.id); setBookPages(state.pages); book.refresh(); },
    spellNames: () => SPELLS.map((s) => `${s.glyph} ${s.name}`),
    spellById: SPELL_BY_ID,
  };
}

boot().catch((err) => {
  const el = document.getElementById('err');
  if (el) { el.style.display = 'block'; el.textContent = String(err && err.stack ? err.stack : err); }
});
