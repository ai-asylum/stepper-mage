/**
 * The dungeon grid and its generator.
 *
 * A floor is rooms joined by corridors on a small integer grid. The player
 * occupies one tile and faces one of four directions — this is a stepper, so
 * every position in the game is an integer and every turn is 90 degrees. That
 * constraint is what makes spell targeting legible on a phone: at any moment
 * there is a small, countable set of things in front of you.
 *
 * Light is BAKED per tile at generation time (`bakeLight`). The player's torch
 * is added per-fragment at render time on top of it, so a room with a lit brazier
 * reads as lit before you walk into it — you can see where you're going, which
 * matters a lot when the alternative is a corridor of identical black squares.
 */
import { Rng } from '../core/rng';

export const enum Tile {
  Wall = 0,
  Floor = 1,
  /** Floor that also holds the descent once the boss is dead. */
  Stairs = 2,
}

export type Dir = 0 | 1 | 2 | 3; // 0=north(-z) 1=east(+x) 2=south(+z) 3=west(-x)

export const DIR_VEC: readonly [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const DIR_NAME = ['north', 'east', 'south', 'west'] as const;

export interface Room {
  x: number; y: number; w: number; h: number;
  kind: 'entrance' | 'altar' | 'boss' | 'normal' | 'treasure';
  /** Tiles inside, cached for placement. */
  tiles: [number, number][];
  cx: number; cy: number;
  /** Set once the player has entered — drives "encounter starts" and the map. */
  seen: boolean;
  cleared: boolean;
  id: number;
}

export interface LightSource {
  x: number; y: number;
  /** World height of the emitter, for the sconce billboard. */
  h: number;
  reach: number;
  strength: number;
  /** Which wall face it is mounted on, or -1 for a free-standing source. */
  face: number;
}

export class Grid {
  readonly w: number;
  readonly h: number;
  readonly tiles: Uint8Array;
  /** Baked light 0..~1.4 per tile. */
  readonly light: Float32Array;
  /** Texture variant index per tile, so neighbours differ. */
  readonly variant: Uint8Array;
  /** Room index per tile, or 255. */
  readonly roomOf: Uint8Array;
  /** 1 once the player has laid eyes on a tile — drives the minimap fog. */
  readonly explored: Uint8Array;

  rooms: Room[] = [];
  lights: LightSource[] = [];
  start: { x: number; y: number; dir: Dir } = { x: 1, y: 1, dir: 2 };
  stairs: { x: number; y: number } | null = null;

  constructor(w: number, h: number) {
    this.w = w; this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.light = new Float32Array(w * h);
    this.variant = new Uint8Array(w * h);
    this.roomOf = new Uint8Array(w * h).fill(255);
    this.explored = new Uint8Array(w * h);
  }

  idx(x: number, y: number): number { return y * this.w + x; }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  at(x: number, y: number): Tile {
    if (!this.inside(x, y)) return Tile.Wall;
    return this.tiles[this.idx(x, y)] as Tile;
  }

  walkable(x: number, y: number): boolean {
    return this.at(x, y) !== Tile.Wall;
  }

  lightAt(x: number, y: number): number {
    if (!this.inside(x, y)) return 0;
    return this.light[this.idx(x, y)];
  }

  roomAt(x: number, y: number): Room | null {
    if (!this.inside(x, y)) return null;
    const r = this.roomOf[this.idx(x, y)];
    return r === 255 ? null : this.rooms[r];
  }

  /** Straight line of sight along a cardinal direction, blocked by walls. */
  rayTiles(x: number, y: number, dir: Dir, max: number): [number, number][] {
    const [dx, dy] = DIR_VEC[dir];
    const out: [number, number][] = [];
    for (let i = 1; i <= max; i++) {
      const nx = x + dx * i, ny = y + dy * i;
      if (!this.walkable(nx, ny)) break;
      out.push([nx, ny]);
    }
    return out;
  }
}

/** Rectangles overlap test with a 1-tile margin so rooms never share a wall. */
function overlaps(a: Room, b: Room): boolean {
  return a.x - 1 < b.x + b.w + 1 && a.x + a.w + 1 > b.x - 1 &&
         a.y - 1 < b.y + b.h + 1 && a.y + a.h + 1 > b.y - 1;
}

export interface GenOpts {
  depth: number;
  seed: string;
  /** Grid grows a little with depth so later floors feel bigger. */
  size?: number;
}

export function generate(opts: GenOpts): Grid {
  const rng = new Rng(opts.seed);
  const size = opts.size ?? Math.min(34, 22 + opts.depth * 2);
  const g = new Grid(size, size);

  // ---- rooms ------------------------------------------------------------
  const wanted = 6 + Math.min(4, Math.floor(opts.depth / 1.5));
  const rooms: Room[] = [];
  let guard = 0;
  while (rooms.length < wanted && guard++ < 700) {
    // The boss room wants to be big; normal rooms vary so combat spaces differ.
    const big = rooms.length === 1;
    const w = big ? rng.int(7, 9) : rng.int(4, 7);
    const h = big ? rng.int(7, 9) : rng.int(4, 7);
    const x = rng.int(1, g.w - w - 2);
    const y = rng.int(1, g.h - h - 2);
    const cand: Room = {
      x, y, w, h, kind: 'normal', tiles: [], cx: x + (w >> 1), cy: y + (h >> 1),
      seen: false, cleared: false, id: rooms.length,
    };
    if (rooms.some((r) => overlaps(cand, r))) continue;
    rooms.push(cand);
  }
  if (rooms.length < 3) return generate({ ...opts, seed: opts.seed + 'r' });
  g.rooms = rooms;

  // carve
  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        g.tiles[g.idx(x, y)] = Tile.Floor;
        g.roomOf[g.idx(x, y)] = r.id;
        r.tiles.push([x, y]);
      }
    }
  }

  // ---- corridors --------------------------------------------------------
  // Connect each room to the previous one (guarantees a spanning path), then add
  // a couple of extra links so the floor has loops rather than being a pure tree
  // — loops matter because retreating is a real tactic once enemies chase.
  const carveCorridor = (ax: number, ay: number, bx: number, by: number) => {
    let x = ax, y = ay;
    const horizFirst = rng.chance(0.5);
    const stepTo = (tx: number, ty: number) => {
      while (x !== tx) { x += Math.sign(tx - x); if (g.tiles[g.idx(x, y)] === Tile.Wall) g.tiles[g.idx(x, y)] = Tile.Floor; }
      while (y !== ty) { y += Math.sign(ty - y); if (g.tiles[g.idx(x, y)] === Tile.Wall) g.tiles[g.idx(x, y)] = Tile.Floor; }
    };
    if (horizFirst) { stepTo(bx, y); stepTo(bx, by); }
    else { stepTo(x, by); stepTo(bx, by); }
  };

  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(rooms[i - 1].cx, rooms[i - 1].cy, rooms[i].cx, rooms[i].cy);
  }
  const extra = 1 + Math.floor(opts.depth / 2);
  for (let i = 0; i < extra; i++) {
    const a = rng.pick(rooms), b = rng.pick(rooms);
    if (a !== b) carveCorridor(a.cx, a.cy, b.cx, b.cy);
  }

  // ---- room roles -------------------------------------------------------
  // Entrance is one end of the longest room-to-room span; the boss sits at the
  // other. Walking the whole floor to reach the boss is the pacing.
  let bestA = rooms[0], bestB = rooms[1], bestD = -1;
  for (const a of rooms) {
    for (const b of rooms) {
      const d = Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
      if (d > bestD) { bestD = d; bestA = a; bestB = b; }
    }
  }
  // the boss gets the bigger of the two ends
  const bossRoom = bestA.w * bestA.h >= bestB.w * bestB.h ? bestA : bestB;
  const entrance = bossRoom === bestA ? bestB : bestA;
  entrance.kind = 'entrance';
  bossRoom.kind = 'boss';

  const rest = rooms.filter((r) => r.kind === 'normal');
  if (rest.length) {
    // The altar goes in the room FURTHEST from the boss that isn't the entrance,
    // so picking up your new spell is a detour you choose, not a gimme on the way.
    let altar = rest[0], far = -1;
    for (const r of rest) {
      const d = Math.abs(r.cx - bossRoom.cx) + Math.abs(r.cy - bossRoom.cy);
      if (d > far) { far = d; altar = r; }
    }
    altar.kind = 'altar';
    const others = rest.filter((r) => r.kind === 'normal');
    if (others.length) rng.pick(others).kind = 'treasure';
  }

  g.start = { x: entrance.cx, y: entrance.cy, dir: rng.int(0, 3) as Dir };
  // stairs are revealed in the boss room once the boss dies
  g.stairs = { x: bossRoom.cx, y: bossRoom.cy };

  // ---- surface variants -------------------------------------------------
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      g.variant[g.idx(x, y)] = rng.int(0, 255);
    }
  }

  placeLights(g, rng, opts.depth);
  bakeLight(g);
  return g;
}

/**
 * Wall sconces in corridors and braziers in rooms. Placement is deliberate:
 * every room gets at least one so it reads on approach, and long corridors get
 * them at intervals so a passage has rhythm instead of being a black tube.
 */
function placeLights(g: Grid, rng: Rng, depth: number): void {
  const isCorridor = (x: number, y: number) => g.walkable(x, y) && g.roomOf[g.idx(x, y)] === 255;

  // rooms: 1-3 sconces on the wall, biased to corners
  for (const r of g.rooms) {
    const n = r.kind === 'boss' ? 4 : r.kind === 'altar' ? 3 : rng.int(1, 2);
    const cands: LightSource[] = [];
    for (const [x, y] of r.tiles) {
      for (let f = 0; f < 4; f++) {
        const [dx, dy] = DIR_VEC[f];
        if (g.walkable(x + dx, y + dy)) continue;
        cands.push({ x, y, h: 1.02, reach: 4.4, strength: 0.85, face: f });
      }
    }
    rng.shuffle(cands);
    // spread them out — no two sconces within 3 tiles
    const taken: LightSource[] = [];
    for (const c of cands) {
      if (taken.length >= n) break;
      if (taken.some((t) => Math.abs(t.x - c.x) + Math.abs(t.y - c.y) < 3)) continue;
      taken.push(c);
    }
    g.lights.push(...taken);
  }

  // corridors: every ~5 tiles, on whichever side has a wall
  const period = 5;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!isCorridor(x, y)) continue;
      if ((x * 7 + y * 13) % period !== 0) continue;
      if (!rng.chance(0.55)) continue;
      for (let f = 0; f < 4; f++) {
        const [dx, dy] = DIR_VEC[f];
        if (g.walkable(x + dx, y + dy)) continue;
        g.lights.push({ x, y, h: 1.02, reach: 3.8, strength: 0.7, face: f });
        break;
      }
    }
  }
  void depth;
}

/**
 * Flood light out from every source with distance falloff, occluded by walls.
 *
 * This is a breadth-first spread rather than true line of sight: light bends
 * around a corner a little, which is both cheaper and looks better than hard
 * shadow edges on a grid this coarse.
 */
export function bakeLight(g: Grid): void {
  g.light.fill(0);
  const q: number[] = [];
  const level: Float32Array = new Float32Array(g.w * g.h);

  for (const L of g.lights) {
    level.fill(0);
    const start = g.idx(L.x, L.y);
    level[start] = L.strength;
    q.length = 0;
    q.push(start);
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi];
      const cx = i % g.w, cy = (i / g.w) | 0;
      const cur = level[i];
      if (cur <= 0.02) continue;
      // falloff per tile step, tuned so `reach` is roughly where it dies out
      const next = cur - L.strength / L.reach;
      if (next <= 0.02) continue;
      for (const [dx, dy] of DIR_VEC) {
        const nx = cx + dx, ny = cy + dy;
        if (!g.walkable(nx, ny)) continue;
        const ni = g.idx(nx, ny);
        if (level[ni] >= next) continue;
        level[ni] = next;
        q.push(ni);
      }
    }
    for (let i = 0; i < level.length; i++) {
      if (level[i] > 0) g.light[i] = Math.min(1.5, g.light[i] + level[i]);
    }
  }
}

/** Tiles the player can currently see (cardinal corridors + current room). */
export function visibleTiles(g: Grid, px: number, py: number): Set<number> {
  const out = new Set<number>();
  const room = g.roomAt(px, py);
  if (room) for (const [x, y] of room.tiles) out.add(g.idx(x, y));
  out.add(g.idx(px, py));
  for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
    for (const [x, y] of g.rayTiles(px, py, d, 12)) {
      out.add(g.idx(x, y));
      const r = g.roomAt(x, y);
      if (r) for (const [rx, ry] of r.tiles) out.add(g.idx(rx, ry));
    }
  }
  return out;
}
