/**
 * One dungeon floor, assembled: grid + geometry + the things standing in it.
 *
 * Owns the lifetime of everything floor-scoped so descending is a clean swap —
 * `dispose()` then build the next one. Combat and the spellbook read the entity
 * list from here; nothing else needs to know how a floor is put together.
 */
import * as THREE from 'three';
import { DIR_VEC, Grid, Surface, visibleTiles, type Dir } from '../dungeon/grid';
import { generate } from '../dungeon/generate';
import type { LayoutId } from '../dungeon/layouts';
import { DungeonView } from '../dungeon/render';
import { STEP_H } from '../art/tiles';
import { Sprite, preloadSprites, loadSprite } from '../dungeon/sprites';
import { viewsFor, type SpriteView } from '../art/views';
import { populate, spriteIdsFor, type CaptiveSpot, type Placed, type PlacedKind } from './populate';
import { themeForDepth, type Theme } from '../art/theme';
import { bossHp, enemyHp, isFast, FAST_HP_MULT, FAST_SPEED } from './tuning';
import { Ground } from './ground';
import { FireView } from '../dungeon/fireView';
import { GrowthView, type GrowthKind } from '../dungeon/growthView';
import { ClockView } from '../dungeon/clockView';
import { MurkView } from '../dungeon/murkView';

export interface Entity {
  sprite: Sprite;
  kind: PlacedKind;
  /** Sprite id currently displayed (changes when a prop becomes a golem). */
  spriteId: string;
  /** The golem form this prop rises as, if it is animatable. */
  golemId?: string;
  hp: number;
  maxHp: number;
  alive: boolean;
  roomId: number;
  /** Set once the prop has been animated, so it cannot be animated twice. */
  animated: boolean;
  /** Golems and enemies act; props and scenery do not. */
  hostile: boolean;
  /**
   * Which way this body is turned. Scenery carries one and ignores it.
   *
   * It is state on the ENTITY rather than something derived from the last move,
   * because the two moments it has to survive are moments where nothing moved: a
   * creature that has not acted this round is still facing wherever it was, and a
   * creature the player has swapped past must keep facing the way it was so that
   * the player is genuinely behind it. Deriving facing from a step would quietly
   * reset both.
   */
  facing: Dir;
  /** Set once an altar has given up its page. */
  spent: boolean;
  /** Wizard id, on a `captive` entity only. */
  captiveId?: string;
  /**
   * Does this body fly? A flyer is over the ground terrain — rubble and briar cost it
   * nothing — and pays for everything else exactly as a walker does.
   */
  flies: boolean;
  /**
   * Tiles this body closes per round. One for almost everything; `FAST_SPEED` for the
   * bodies `isFast` picks out.
   *
   * On the entity rather than derived per round because it has to be READABLE — the
   * reticle and the telegraph both need to say "this one is quick" before it proves it,
   * and a body that reveals its speed only by arriving early is a rule the player
   * cannot learn from.
   */
  speed: number;
}

/** Kinds that physically occupy their tile. Stairs are walk-on by design. */
/** How far behind its tile a staircase stands, to lose every sort tie on it. */
const STAIRS_BACK = 0.12;

const SOLID: ReadonlySet<string> = new Set(['altar', 'chest', 'prop', 'enemy', 'boss', 'lever']);

/**
 * Turn a body to look at a tile. A no-op when it is already standing there.
 *
 * The dominant axis wins, which is the only choice a four-way facing can make about
 * a diagonal. Ties go to the horizontal, arbitrarily but consistently — a creature
 * that flickered between two facings while a diagonal target shuffled would read as
 * broken in a way that picking the wrong one of two never does.
 */
export function faceToward(e: Entity, x: number, y: number): void {
  const dx = x - e.sprite.tx, dy = y - e.sprite.ty;
  if (!dx && !dy) return;
  e.facing = (Math.abs(dx) >= Math.abs(dy)
    ? (dx > 0 ? 1 : 3)
    : (dy > 0 ? 2 : 0)) as Dir;
}

/** Load every view a creature ships, at the current step. `front` always exists. */
async function loadViews(id: string): Promise<Map<SpriteView, THREE.Texture>> {
  const m = new Map<SpriteView, THREE.Texture>();
  m.set('front', await loadSprite(id));
  for (const v of viewsFor(id)) m.set(v, await loadSprite(`${id}_${v}`));
  return m;
}

/** Attach a creature's extra views to a sprite that already has its front bound. */
async function attachViews(sprite: Sprite, id: string, front: THREE.Texture): Promise<void> {
  const extra = viewsFor(id);
  if (!extra.length) return;
  const m = new Map<SpriteView, THREE.Texture>([['front', front]]);
  for (const v of extra) m.set(v, await loadSprite(`${id}_${v}`));
  sprite.setViews(m);
}

/**
 * Which drawn view of a body the camera is looking at, and whether to mirror it.
 *
 * The billboard always faces the camera, so "which way is this creature turned" is
 * entirely a question of art: take the direction from the body to the camera, snap
 * it to the grid, and compare it with the body's facing.
 *
 *   same           it is looking at you           front
 *   opposite       it is looking away             back
 *   either side    it is in profile               side, mirrored for one of them
 *
 * The generated profile faces screen-RIGHT (see `tools/genviews.py`), and a body is
 * turned screen-right when its facing is one step anticlockwise of the camera's own
 * view direction — which works out as a relative of 3. So 1 is the mirrored one.
 */
function viewFrom(e: Entity, cam: THREE.Vector3): [SpriteView, boolean] {
  const dx = cam.x - (e.sprite.tx + e.sprite.ox);
  const dz = cam.z - (e.sprite.ty + e.sprite.oz);
  const toCam: Dir = (Math.abs(dx) >= Math.abs(dz)
    ? (dx > 0 ? 1 : 3)
    : (dz > 0 ? 2 : 0)) as Dir;
  const rel = ((e.facing - toCam) % 4 + 4) % 4;
  if (rel === 0) return ['front', false];
  if (rel === 2) return ['back', false];
  return ['side', rel === 1];
}

/**
 * Is this thing an OBJECT a spell can be aimed at — furniture rather than a body?
 *
 * One function because `main.ts` and `hud.ts` both need the answer and a comment in
 * each asking them not to disagree is not a mechanism. They HAVE disagreed before:
 * furniture was crossed out on the reticle and cast at happily by the rules, and
 * object reactions make that gap load-bearing, because the barrel IS the target.
 *
 * A SPENT CHEST counts. Once its lid is open it has stopped being a container and
 * become a wooden box standing in the room, which is exactly what every other prop
 * is — and `docs/DESIGN.md` says every prop is a spell component. Excluding it made
 * the one object the player had definitely noticed the one object they could not
 * use. An unspent chest is excluded because tapping it opens it; that tap has a
 * meaning already and a spell would be fighting it for the same gesture.
 */
export function isCastableObject(e: Entity): boolean {
  if (e.animated) return false;
  if (e.kind === 'prop') return true;
  return e.kind === 'chest' && !!e.spent;
}

export class Floor {
  readonly grid: Grid;
  readonly view: DungeonView;
  readonly theme: Theme;
  readonly group = new THREE.Group();
  readonly entities: Entity[] = [];
  /**
   * Tiles the player can see right now, from the last `cull`.
   *
   * Empty until the first cull, which happens on spawn before anything draws.
   */
  visible: ReadonlySet<number> = new Set();
  /**
   * Has the way down been opened? False until the boss falls.
   *
   * A fact about the FLOOR rather than about the stairs sprite, because the minimap
   * has to answer "does this door exist yet" and the honest source for that is not
   * whether a mesh happens to be visible.
   */
  stairsOpen = false;
  /**
   * What is on the FLOOR — burning tiles today, and the seam any future ground
   * state uses. On the floor and not on `Combat` because it is a property of the
   * PLACE: it is drawn with the room, it is thrown away with the room, and a
   * descent should not need combat's help to forget it.
   */
  readonly ground = new Ground();
  readonly fireView = new FireView();
  /**
   * Broken stone and briar, standing up out of the floor rather than painted on it.
   * Both are difficult terrain and both have to READ as an obstacle from a standing
   * camera, which a floor texture cannot do — see `growthView.ts`.
   */
  readonly growthView = new GrowthView();
  /** Blades, spikes, trapdoors and the countdown on a gate. */
  readonly clockView = new ClockView();
  /** The fog banks, as billboards hanging in the air rather than a tint. */
  readonly murkView = new MurkView();

  private constructor(
    readonly depth: number, readonly seed: string, layout?: LayoutId,
    wantCaptiveRoom = false, canShove = true,
  ) {
    this.theme = themeForDepth(depth);
    /**
     * A CAPTIVE FLOOR IS REGENERATED UNTIL IT HAS A GATE. No ungated fallback.
     *
     * About a third of shapes can seal a room without stranding the stairs, so a floor that
     * needs one is simply rolled again with a perturbed seed until it can. At that rate 200
     * attempts fail with probability around 1e-35, and each attempt is a few milliseconds of
     * grid work with nothing loaded yet — this runs before any sprite is fetched.
     *
     * The alternative was letting the captive stand in an open room when the shape refused, and
     * that is worse than it looks: the gate IS the encounter. Without it the rescue is a tap on
     * a body in a corridor, and the one time that hero is ever offered is the time it read as
     * nothing at all.
     */
    let g = generate({ depth, seed, layout, wantCaptiveRoom, canShove });
    if (wantCaptiveRoom) {
      for (let n = 1; n < 200 && g.captiveRoom < 0; n++) {
        g = generate({ depth, seed: `${seed}-g${n}`, layout, wantCaptiveRoom, canShove });
      }
    }
    this.grid = g;
    // Shallow water will not take a flame. `Ground` deliberately knows nothing about
    // tiles, so the one place holding both it and the grid is where the rule goes.
    this.ground.refuses = (i, what) =>
      what === 'fire' && this.grid.surface[i] === Surface.Water;
    /**
     * Bramble creeps only where a body could walk. Growth inside a wall is growth the
     * player can neither see nor clamber over, so it would read as the patch simply
     * refusing to spread in that direction — which is exactly what this makes true.
     */
    this.ground.neighbours = (i) => {
      const w = this.grid.w;
      const x = i % w, y = (i / w) | 0;
      const out: number[] = [];
      for (const [dx, dy] of DIR_VEC) {
        const nx = x + dx, ny = y + dy;
        if (this.grid.walkable(nx, ny)) out.push(this.grid.idx(nx, ny));
      }
      return out;
    };
    this.view = new DungeonView(this.grid, this.theme, seed);
    this.group.add(this.view.group);
    this.group.add(this.fireView.group);
    this.group.add(this.growthView.group);
    this.group.add(this.clockView.group);
    this.group.add(this.murkView.group);
    this.clockView.sync(this.grid);
    this.murkView.sync(this.grid);
    this.syncGrowth();
  }

  /** Build a floor, preloading every sprite it needs before returning. */
  static async create(
    depth: number, seed: string, layout?: LayoutId, captive: CaptiveSpot | null = null,
    canShove = true,
  ): Promise<Floor> {
    const f = new Floor(depth, seed, layout, !!captive, canShove);
    // The captive's sprite is preloaded with the theme's, so the room is never built around a
    // body that has not decoded — a gate opening onto an invisible person is worse than no gate.
    await preloadSprites([
      ...spriteIdsFor(f.theme), 'altar_empty', 'chest_open',
      ...(captive ? [captive.sprite] : []),
    ]);
    const placed = populate(f.grid, f.theme, seed, depth, captive);
    for (const p of placed) await f.spawn(p);
    return f;
  }

  private async spawn(p: Placed): Promise<void> {
    const tex = await loadSprite(p.sprite);
    const hostile = p.kind === 'enemy' || p.kind === 'boss';
    const sprite = new Sprite(p.sprite, tex, this.view.uniforms, {
      hover: p.hover,
      seed: (p.x * 31 + p.y * 17 + p.sprite.length) * 0.61,
      /**
       * MASONRY DOES NOT BREATHE. It shipped at a quarter strength for scenery, which
       * was the right instinct and the wrong answer: a quarter of a sway is still a
       * sway, and a stone plinth that drifts up and down half a texel reads as the
       * whole room being slightly unmoored. Only things with muscles get any.
       */
      bob: p.kind === 'enemy' || p.kind === 'boss' ? 1 : 0,
      emissive: p.kind === 'altar' ? 1.5 : p.kind === 'boss' ? 0.95 : 0.85,
    });
    sprite.tx = p.x; sprite.ty = p.y; sprite.ox = p.ox; sprite.oz = p.oz;
    sprite.setTileLight(this.grid.lightAt(p.x, p.y));
    await attachViews(sprite, p.sprite, tex);

    /**
     * FAST BODIES ARE CHEAPER BODIES. A mook that closes two tiles a round arrives
     * with rounds to spare that a walker never had, so it carries `FAST_HP_MULT` of
     * the health — it reaches you and dies, rather than reaching you and staying.
     * Bosses are never fast: the boss fight is paced by its walk across the room.
     */
    const fast = p.kind === 'enemy' && isFast(p.x, p.y);
    const baseHp = p.kind === 'boss' ? bossHp(this.depth)
      : p.kind === 'enemy' ? enemyHp(this.depth)
      : 20;
    const hp = fast ? Math.round(baseHp * FAST_HP_MULT) : baseHp;

    const e: Entity = {
      sprite, kind: p.kind, spriteId: p.sprite, golemId: p.golem, flies: !!p.flies,
      hp, maxHp: hp, alive: true, roomId: p.roomId, animated: false, hostile,
      spent: false, speed: fast ? FAST_SPEED : 1,
      // Carried through so the rescue can name who it freed without a second lookup table.
      captiveId: p.captiveId,
      // Spawned facing an arbitrary but STABLE direction, derived from the tile so
      // the same seed lays out the same room twice. Arbitrary is the point: a room
      // where every creature happens to be looking at the door has nothing to
      // notice, and the read this phase is buying is "that one has not seen me".
      facing: (((p.x * 7 + p.y * 13 + p.sprite.length) % 4) + 4) % 4 as Dir,
    };
    this.entities.push(e);
    this.group.add(sprite.group);

    // Stairs stay hidden until the boss falls.
    /**
     * THE STAIRCASE STANDS BEHIND WHATEVER IS ON IT, and fire in front.
     *
     * Both sit on the same tile as a body at the same distance from the camera, and
     * three sorts transparent objects on exactly that — a tie resolves arbitrarily and
     * flickers. A staircase is a hole in the floor, so nothing should ever draw behind
     * it; fire is a thing burning in the air, so nothing standing in it should draw in
     * front. See `Sprite.depthBias`.
     */
    if (p.kind === 'stairs') { sprite.depthBias = -STAIRS_BACK; sprite.group.visible = false; }
  }

  /**
   * Swap a prop's art for its golem form — the core verb's visual payoff.
   *
   * `castHp` is what the CAST says the risen body is worth (26 base, half again with
   * Growth); the depth term is this floor's business and stays here with the rest of
   * the floor's numbers. Both halves are needed and neither knows the other: a cast
   * cannot know how deep it was released, and a floor cannot know whether the cast
   * carried Growth.
   *
   * It is a parameter rather than two assignments because there used to be two — this
   * set a depth-scaled figure and `Combat.cast` overwrote it with the cast's — so the
   * depth scaling was dead the whole time the animate path was unreachable, and came
   * back to life as a bug the moment the belt made it reachable again.
   */
  async animateProp(e: Entity, castHp = 26): Promise<boolean> {
    /**
     * A chest wakes too, once it has been opened.
     *
     * `kind` is 'chest' rather than 'prop', so the prop test alone refused it —
     * `isCastableObject` has accepted a spent chest since phase 10 and the cast then
     * died here, which is a reticle promising something the floor would not do. An
     * UNSPENT chest is still refused: tapping it opens it, and that gesture has a
     * meaning already.
     */
    const openable = e.kind === 'prop' || (e.kind === 'chest' && !!e.spent);
    if (!openable || e.animated || !e.golemId) return false;
    const tex = await loadSprite(e.golemId);
    const old = e.sprite;
    const risen = new Sprite(e.golemId, tex, this.view.uniforms, {
      hover: 0, seed: (e.sprite.tx * 13 + e.sprite.ty * 7) * 0.77, bob: 1, emissive: 1.1,
    });
    risen.tx = old.tx; risen.ty = old.ty; risen.ox = old.ox; risen.oz = old.oz;
    risen.setTileLight(this.grid.lightAt(old.tx, old.ty));
    await attachViews(risen, e.golemId, tex);
    this.group.remove(old.group);
    old.dispose();
    this.group.add(risen.group);

    (e as { sprite: Sprite }).sprite = risen;
    e.spriteId = e.golemId;
    e.animated = true;
    e.kind = 'prop';
    e.hostile = false;      // a golem you raised fights FOR you
    e.hp = e.maxHp = castHp + this.depth * 6;
    risen.play('rise');
    return true;
  }

  /**
   * The floor's SURFACE changed under the player, so the geometry has to say so.
   *
   * Only gust clearing rubble does this today, and it is the only thing that can:
   * every other surface is part of the floor for the whole descent. The tile textures
   * are rebuilt along with the quads, which is more than is strictly needed — a
   * surface change moves a tile from one batch to another and invents no new texture —
   * but it is the one build path there is, it costs what entering a floor costs, and
   * it happens at most a handful of times in a run.
   */
  /**
   * Re-place every standing clump: rubble from the GRID, plants from the GROUND.
   *
   * Two sources because they are two different things and not two stages. Rubble is
   * part of the building — the generator lays it and a gust sweeps it. Plants are
   * something a cast put there, so they live in `Ground` with everything else a spell
   * left behind, which is also what lets fire catch them.
   */
  syncGrowth(): void {
    const out: { i: number; kind: GrowthKind }[] = [];
    for (let i = 0; i < this.grid.surface.length; i++) {
      if (this.grid.surface[i] === Surface.Rubble) out.push({ i, kind: 'rubble' });
    }
    for (const p of this.ground.patches()) {
      if (p.what === 'bramble') out.push({ i: p.i, kind: 'plant' });
      else if (p.what === 'briar') out.push({ i: p.i, kind: 'briar' });
    }
    this.growthView.sync(this.grid, out);
  }

  resurface(): void {
    this.view.restep();
  }

  /**
   * Redraw the clock: every hazard's state and every gate's countdown.
   *
   * Called when the beat advances and when a plate is pressed, and from nowhere else.
   * The clock does not animate between turns on purpose — see `ClockView.sync`.
   */
  syncClock(): void {
    this.clockView.sync(this.grid);
  }

  /**
   * A block left one tile and arrived at another.
   *
   * The GRID has already changed — it changed the instant the gust landed, because
   * everything that asks where the walls are has to get the new answer immediately.
   * This is only the picture catching up: the view is told where the stone came from
   * so it can slide out of that tile instead of appearing in the next one.
   */
  slideBlock(from: number, to: number): void {
    this.clockView.slideBlock(this.grid, from, to);
  }

  /**
   * Swap a lever's sprite to its thrown form.
   *
   * The sprite is the whole of the feedback that this lever is done — the player will
   * walk past it again and has to be able to tell at a glance that they already have
   * this one. Async because a step's art is fetched on demand; the caller does not
   * wait, because a lever that pauses the game while a PNG loads would be worse than
   * one that changes a moment late.
   */
  markLever(i: number, pulled: boolean): void {
    const x = i % this.grid.w, y = (i / this.grid.w) | 0;
    const e = this.entities.find((z) => z.kind === 'lever' && z.sprite.tx === x && z.sprite.ty === y);
    const want = pulled ? 'lever_pulled' : 'lever';
    if (!e || e.spriteId === want) return;
    e.spriteId = want;
    /**
     * INSTANT. No `rise` — that animation lifts a thing up out of the floor, which is
     * what a golem does when it wakes and is nonsense for a switch bolted to a plinth.
     * A lever THROWS: the handle is one place, then it is the other.
     */
    void loadViews(want).then((m) => e.sprite.setViews(m));
  }

  /**
   * Rebuild everything that was built at a texel density, keeping the floor.
   *
   * The pixel step's one write path into a live run. It is NOT `Floor.create` again:
   * the layout is deterministic from the seed and would come back identical, but
   * every hit point, every risen golem, every spent altar and the whole explored set
   * live on the entities and the grid, so recreating the floor would quietly reset a
   * run mid-descent. This rebuilds the two things the step actually decides — the
   * tile textures and the sprite quads — and touches nothing else.
   */
  async restep(): Promise<void> {
    this.view.restep();
    this.fireView.restep();
    this.growthView.restep();
    this.syncGrowth();
    this.clockView.restep();
    this.clockView.sync(this.grid);
    this.murkView.restep();
    this.murkView.sync(this.grid);
    // Fetch the whole roster at the new step before touching a single sprite, so
    // the floor changes density all at once instead of creature by creature as
    // each PNG lands. `Sprite.id` is authoritative here rather than `spriteId` —
    // it is what the quad is actually showing after a prop has risen as a golem.
    const ids = [...new Set(this.entities.map((e) => e.sprite.id))];
    const art = new Map(await Promise.all(ids.map(async (id) =>
      [id, await loadViews(id)] as const)));
    for (const e of this.entities) {
      const views = art.get(e.sprite.id);
      if (views) e.sprite.setViews(views);
    }
  }

  /**
   * True when a living, solid entity occupies this tile.
   *
   * A body at zero HP is NOT solid, even though `alive` is still true. Those two
   * facts are different and the gap between them is a whole second: `alive` is
   * cleared when the death animation finishes (see `update`), so between the killing
   * blow and the end of the slump there is a corpse standing in the doorway.
   *
   * That gap did not matter while the stairs were generated at the room's centre,
   * away from the fight. It matters now that they open where the boss FELL — the
   * player kills the boss, steps onto the staircase that just appeared under it, and
   * bumps into the thing they have already killed. Found by walking it; nothing else
   * would have caught it.
   *
   * Everything spawns with positive HP, so `hp <= 0` means killed rather than
   * "happens to have no health bar".
   */
  solidAt(x: number, y: number): boolean {
    for (const e of this.entities) {
      if (!e.alive || e.hp <= 0 || !SOLID.has(e.kind)) continue;
      if (e.sprite.tx === x && e.sprite.ty === y) return true;
    }
    return false;
  }

  /**
   * Empty an altar: swap it for the spent sprite so a used altar is visibly
   * used. A room you have already looted should look looted.
   */
  async spendAltar(e: Entity): Promise<void> {
    if (e.kind !== 'altar' || e.spent) return;
    e.spent = true;
    const tex = await loadSprite('altar_empty');
    const old = e.sprite;
    const dead = new Sprite('altar_empty', tex, this.view.uniforms, {
      hover: 0, seed: old.tx * 5 + old.ty * 3, bob: 0.2, emissive: 0.2,
    });
    dead.tx = old.tx; dead.ty = old.ty; dead.ox = old.ox; dead.oz = old.oz;
    dead.setTileLight(this.grid.lightAt(old.tx, old.ty));
    this.group.remove(old.group);
    old.dispose();
    this.group.add(dead.group);
    (e as { sprite: Sprite }).sprite = dead;
    e.spriteId = 'altar_empty';
  }

  /** Open a chest: swap to the plundered sprite so a looted room looks looted. */
  async openChest(e: Entity): Promise<void> {
    if (e.kind !== 'chest' || e.spent) return;
    e.spent = true;
    const tex = await loadSprite('chest_open');
    const old = e.sprite;
    const opened = new Sprite('chest_open', tex, this.view.uniforms, {
      hover: 0, seed: old.tx * 7 + old.ty * 11, bob: 0.2, emissive: 0.25,
    });
    opened.tx = old.tx; opened.ty = old.ty; opened.ox = old.ox; opened.oz = old.oz;
    opened.setTileLight(this.grid.lightAt(old.tx, old.ty));
    this.group.remove(old.group);
    old.dispose();
    this.group.add(opened.group);
    (e as { sprite: Sprite }).sprite = opened;
    e.spriteId = 'chest_open';
  }

  entityAt(x: number, y: number): Entity | null {
    for (const e of this.entities) {
      if (e.alive && e.sprite.tx === x && e.sprite.ty === y) return e;
    }
    return null;
  }

  /**
   * Open the way down, at the tile the boss fell on.
   *
   * The stairs used to be generated at the room's centre and simply un-hidden, so
   * the reward for the fight was a walk: the player stood over a corpse at one end
   * of the room and the door was somewhere else. Now the door opens where they are
   * already standing.
   *
   * `stairsOpen` is the fact the minimap reads. Visibility of the sprite would be
   * the same answer today, but it is a rendering detail — the map asking "is this
   * drawn" instead of "does this exist" is exactly the confusion that had it marking
   * a door before the door was there.
   */
  revealStairs(at?: { x: number; y: number }): void {
    this.stairsOpen = true;
    for (const e of this.entities) {
      if (e.kind !== 'stairs') continue;
      if (at) {
        e.sprite.tx = at.x;
        e.sprite.ty = at.y;
        e.sprite.setTileLight(this.grid.lightAt(at.x, at.y));
        e.roomId = this.grid.roomAt(at.x, at.y)?.id ?? e.roomId;
        this.grid.stairs = { x: at.x, y: at.y };
      }
      e.sprite.group.visible = true;
    }
  }

  /** Hide anything the player cannot currently see, so the floor stays cheap. */
  cull(px: number, py: number): void {
    const vis = visibleTiles(this.grid, px, py);
    // Kept, because the minimap needs the same answer. It used to plot creatures on
    // any EXPLORED tile, which drew them live through walls — a wallhack, and the
    // reason enemies showed on the map with nothing on screen. Sharing the set the
    // 3D cull uses is what makes the two physically unable to disagree.
    this.visible = vis;
    // Visibility is recomputed every step anyway, so this is the natural place
    // to accumulate the explored set the minimap draws from. The tile the player
    // is standing on is marked here too rather than off an arrival event, because
    // this one call site also covers spawning, descending and debug teleports.
    for (const i of vis) this.grid.explored[i] = 1;
    if (this.grid.inside(px, py)) this.grid.visited[this.grid.idx(px, py)] = 1;
    for (const e of this.entities) {
      /**
       * THE STAIRS ARE HIDDEN UNTIL THE BOSS FALLS, and after that they are furniture
       * like anything else.
       *
       * This asked `!group.visible` — "is it drawn" — as a stand-in for "has it been
       * opened yet", and the two agree exactly once: before the first time the door
       * leaves the player's sight. Walk away from an open staircase and the ordinary
       * cull below hides it; from then on this guard reads that as "not revealed" and
       * skips it forever, so the way down is invisible for the rest of the floor. It
       * still worked — the tile is a target and a tap descends — which is why it read
       * as a graphical glitch rather than the door being gone.
       *
       * `stairsOpen` is the fact, and `revealStairs` is its one writer. The same
       * distinction that comment already draws for the minimap.
       */
      if (e.kind === 'stairs' && !this.stairsOpen) continue;
      const on = vis.has(this.grid.idx(e.sprite.tx, e.sprite.ty));
      e.sprite.group.visible = on && e.alive;
    }
  }

  update(dt: number, time: number, cam: THREE.Vector3): void {
    this.view.update(time, cam);
    this.fireView.update(time, cam);
    this.clockView.update(cam, this.view.uniforms);
    this.murkView.update(
      time, cam, this.grid,
      this.view.uniforms.uTorch.value as THREE.Color,
      this.view.uniforms.uAmbient.value as number,
    );
    for (const e of this.entities) {
      const [v, flip] = viewFrom(e, cam);
      e.sprite.setView(v, flip);
      e.sprite.setTileMurk(
        this.grid.surfaceAt(e.sprite.tx, e.sprite.ty) === Surface.Fog ? 1 : 0);
      // Standing ON the floor it is standing on, per frame, for the same reason.
      e.sprite.ground = this.grid.heightAt(e.sprite.tx, e.sprite.ty) * STEP_H;
      e.sprite.update(dt, time, cam);
      if (e.sprite.isGone && e.alive) {
        e.alive = false;
        e.sprite.group.visible = false;
      }
    }
  }

  dispose(): void {
    for (const e of this.entities) e.sprite.dispose();
    this.entities.length = 0;
    this.view.dispose();
    this.fireView.dispose();
    this.clockView.dispose();
    this.murkView.dispose();
    this.group.clear();
  }
}
