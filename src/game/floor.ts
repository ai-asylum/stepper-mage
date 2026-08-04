/**
 * One dungeon floor, assembled: grid + geometry + the things standing in it.
 *
 * Owns the lifetime of everything floor-scoped so descending is a clean swap —
 * `dispose()` then build the next one. Combat and the spellbook read the entity
 * list from here; nothing else needs to know how a floor is put together.
 */
import * as THREE from 'three';
import { Grid, generate, visibleTiles, type Dir } from '../dungeon/grid';
import { DungeonView } from '../dungeon/render';
import { Sprite, preloadSprites, loadSprite } from '../dungeon/sprites';
import { viewsFor, type SpriteView } from '../art/views';
import { populate, spriteIdsFor, type Placed, type PlacedKind } from './populate';
import { themeForDepth, type Theme } from '../art/theme';
import { bossHp, enemyHp } from './tuning';

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
}

/** Kinds that physically occupy their tile. Stairs are walk-on by design. */
const SOLID: ReadonlySet<string> = new Set(['altar', 'chest', 'prop', 'enemy', 'boss']);

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

  private constructor(readonly depth: number, readonly seed: string) {
    this.theme = themeForDepth(depth);
    this.grid = generate({ depth, seed });
    this.view = new DungeonView(this.grid, this.theme, seed);
    this.group.add(this.view.group);
  }

  /** Build a floor, preloading every sprite it needs before returning. */
  static async create(depth: number, seed: string): Promise<Floor> {
    const f = new Floor(depth, seed);
    await preloadSprites([...spriteIdsFor(f.theme), 'altar_empty', 'chest_open']);
    const placed = populate(f.grid, f.theme, seed, depth);
    for (const p of placed) await f.spawn(p);
    return f;
  }

  private async spawn(p: Placed): Promise<void> {
    const tex = await loadSprite(p.sprite);
    const hostile = p.kind === 'enemy' || p.kind === 'boss';
    const sprite = new Sprite(p.sprite, tex, this.view.uniforms, {
      hover: p.hover,
      seed: (p.x * 31 + p.y * 17 + p.sprite.length) * 0.61,
      // Scenery breathes less than something alive.
      bob: p.kind === 'prop' || p.kind === 'chest' || p.kind === 'stairs' ? 0.25 : 1,
      emissive: p.kind === 'altar' ? 1.5 : p.kind === 'boss' ? 0.95 : 0.85,
    });
    sprite.tx = p.x; sprite.ty = p.y; sprite.ox = p.ox; sprite.oz = p.oz;
    sprite.setTileLight(this.grid.lightAt(p.x, p.y));
    await attachViews(sprite, p.sprite, tex);

    const hp = p.kind === 'boss' ? bossHp(this.depth)
      : p.kind === 'enemy' ? enemyHp(this.depth)
      : 20;

    const e: Entity = {
      sprite, kind: p.kind, spriteId: p.sprite, golemId: p.golem,
      hp, maxHp: hp, alive: true, roomId: p.roomId, animated: false, hostile,
      spent: false,
      // Spawned facing an arbitrary but STABLE direction, derived from the tile so
      // the same seed lays out the same room twice. Arbitrary is the point: a room
      // where every creature happens to be looking at the door has nothing to
      // notice, and the read this phase is buying is "that one has not seen me".
      facing: (((p.x * 7 + p.y * 13 + p.sprite.length) % 4) + 4) % 4 as Dir,
    };
    this.entities.push(e);
    this.group.add(sprite.group);

    // Stairs stay hidden until the boss falls.
    if (p.kind === 'stairs') sprite.group.visible = false;
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
    if (e.kind !== 'prop' || e.animated || !e.golemId) return false;
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

  /** True when a living, solid entity occupies this tile. */
  solidAt(x: number, y: number): boolean {
    for (const e of this.entities) {
      if (!e.alive || !SOLID.has(e.kind)) continue;
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

  revealStairs(): void {
    for (const e of this.entities) {
      if (e.kind === 'stairs') e.sprite.group.visible = true;
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
      if (e.kind === 'stairs' && !e.sprite.group.visible) continue;
      const on = vis.has(this.grid.idx(e.sprite.tx, e.sprite.ty));
      e.sprite.group.visible = on && e.alive;
    }
  }

  update(dt: number, time: number, cam: THREE.Vector3): void {
    this.view.update(time, cam);
    for (const e of this.entities) {
      const [v, flip] = viewFrom(e, cam);
      e.sprite.setView(v, flip);
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
    this.group.clear();
  }
}
