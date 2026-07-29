/**
 * One dungeon floor, assembled: grid + geometry + the things standing in it.
 *
 * Owns the lifetime of everything floor-scoped so descending is a clean swap —
 * `dispose()` then build the next one. Combat and the spellbook read the entity
 * list from here; nothing else needs to know how a floor is put together.
 */
import * as THREE from 'three';
import { Grid, generate, visibleTiles } from '../dungeon/grid';
import { DungeonView } from '../dungeon/render';
import { Sprite, preloadSprites, loadSprite } from '../dungeon/sprites';
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
  /** Set once an altar has given up its page. */
  spent: boolean;
}

/** Kinds that physically occupy their tile. Stairs are walk-on by design. */
const SOLID: ReadonlySet<string> = new Set(['altar', 'chest', 'prop', 'enemy', 'boss']);

export class Floor {
  readonly grid: Grid;
  readonly view: DungeonView;
  readonly theme: Theme;
  readonly group = new THREE.Group();
  readonly entities: Entity[] = [];

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

    const hp = p.kind === 'boss' ? bossHp(this.depth)
      : p.kind === 'enemy' ? enemyHp(this.depth)
      : 20;

    const e: Entity = {
      sprite, kind: p.kind, spriteId: p.sprite, golemId: p.golem,
      hp, maxHp: hp, alive: true, roomId: p.roomId, animated: false, hostile,
      spent: false,
    };
    this.entities.push(e);
    this.group.add(sprite.group);

    // Stairs stay hidden until the boss falls.
    if (p.kind === 'stairs') sprite.group.visible = false;
  }

  /** Swap a prop's art for its golem form — the core verb's visual payoff. */
  async animateProp(e: Entity): Promise<boolean> {
    if (e.kind !== 'prop' || e.animated || !e.golemId) return false;
    const tex = await loadSprite(e.golemId);
    const old = e.sprite;
    const risen = new Sprite(e.golemId, tex, this.view.uniforms, {
      hover: 0, seed: (e.sprite.tx * 13 + e.sprite.ty * 7) * 0.77, bob: 1, emissive: 1.1,
    });
    risen.tx = old.tx; risen.ty = old.ty; risen.ox = old.ox; risen.oz = old.oz;
    risen.setTileLight(this.grid.lightAt(old.tx, old.ty));
    this.group.remove(old.group);
    old.dispose();
    this.group.add(risen.group);

    (e as { sprite: Sprite }).sprite = risen;
    e.spriteId = e.golemId;
    e.animated = true;
    e.kind = 'prop';
    e.hostile = false;      // a golem you raised fights FOR you
    e.hp = e.maxHp = 26 + this.depth * 6;
    risen.play('rise');
    return true;
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
