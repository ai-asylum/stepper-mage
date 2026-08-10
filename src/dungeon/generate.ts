/**
 * The shared pass: everything about a floor that is NOT its shape.
 *
 * A layout generator carves tiles and declares rooms (`layouts.ts`). It does not
 * decide where the boss is, does not guarantee its own connectivity and does not hang
 * its own torches — because the moment a floor needs its own populate, its own
 * lighting or its own minimap path, it has stopped being a floor the rest of the game
 * understands. The whole point of thirteen generators behind one interface is that
 * everything downstream keeps reading a `Grid` and cannot tell which one made it.
 *
 * In order: choose the layout for the depth, carve, STITCH it into one connected
 * space, assign the four room roles by path distance, then variants, torches, bake.
 */
import { Rng } from '../core/rng';
import {
  Grid, Tile, Surface, DIR_VEC, bakeLight,
  type Room, type Dir, type LightSource,
} from './grid';
import { WALL_H } from '../art/tiles';
import { LAYOUTS, layoutFor, recentre, type LayoutId } from './layouts';

export interface GenOpts {
  depth: number;
  seed: string;
  /** Grid grows a little with depth so later floors feel bigger. */
  size?: number;
  /**
   * Force a layout instead of taking the floor's own.
   *
   * The depth table is the real answer and nothing in the game passes this. It exists
   * because three of the thirteen are the bench — written, playable, unassigned — and
   * a generator that cannot be run is a generator nobody can check.
   */
  layout?: LayoutId;
}

export function generate(opts: GenOpts): Grid {
  const rng = new Rng(opts.seed);
  const layout = opts.layout ? LAYOUTS[opts.layout] : layoutFor(opts.depth);
  const base = opts.size ?? Math.min(34, 22 + opts.depth * 2);
  const size = layout.size ? layout.size(base) : base;
  const g = new Grid(size, size);

  layout.carve(g, rng, opts.depth);

  /**
   * A floor with fewer than three rooms has nowhere to put the three things every
   * floor must hold. Reseeding is cheaper and far less fragile than asking thirteen
   * generators each to guarantee a room count against a hostile roll.
   */
  if (g.rooms.length < 3) return generate({ ...opts, seed: opts.seed + 'r' });

  stitch(g);
  const nominated = layout.boss?.(g) ?? null;
  settle(g);
  assignRoles(g, rng, nominated && g.rooms.includes(nominated) ? nominated : null);

  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) g.variant[g.idx(x, y)] = rng.int(0, 255);
  }

  dress(g, rng, opts.depth);
  placeLights(g, rng);
  bakeLight(g);
  return g;
}

/**
 * Join every walkable island into one space, by digging the shortest link.
 *
 * Connectivity used to be a property of the one generator: rooms were chained in the
 * order they were placed, so the floor was connected by construction. That does not
 * survive thirteen shapes. A cave's automaton leaves lagoons, a chasm's crack can cut
 * a corridor that was the only way to a room, and islands are disconnected on purpose
 * until the causeways go in — and "regenerate the whole floor and hope" is the wrong
 * answer to all three, because it throws away a good layout over one tile.
 *
 * The search is a flood from the whole of one component AT ONCE, through walls, until
 * it touches another component; then it walks the parent chain back and carves it.
 * That is the shortest possible link and it costs one pass over the grid, where the
 * obvious nearest-pair search costs the product of two component sizes.
 */
function stitch(g: Grid): void {
  for (let guard = 0; guard < 30; guard++) {
    const comp = components(g);
    if (comp.count <= 1) return;

    const from: number[] = [];
    for (let i = 0; i < comp.of.length; i++) if (comp.of[i] === 1) from.push(i);

    const parent = new Int32Array(g.w * g.h).fill(-1);
    const seen = new Uint8Array(g.w * g.h);
    for (const i of from) seen[i] = 1;
    let hit = -1;
    for (let qi = 0; qi < from.length && hit < 0; qi++) {
      const i = from[qi];
      const cx = i % g.w, cy = (i / g.w) | 0;
      for (const [dx, dy] of DIR_VEC) {
        const nx = cx + dx, ny = cy + dy;
        // never route through the border; the map has to end in wall
        if (nx < 1 || ny < 1 || nx >= g.w - 1 || ny >= g.h - 1) continue;
        const ni = g.idx(nx, ny);
        if (seen[ni]) continue;
        seen[ni] = 1;
        parent[ni] = i;
        if (comp.of[ni] > 1) { hit = ni; break; }
        from.push(ni);
      }
    }
    if (hit < 0) return;
    for (let i = hit; i !== -1 && comp.of[i] !== 1; i = parent[i]) {
      g.tiles[i] = Tile.Floor;
    }
  }
}

/**
 * Make every room's promises true again, after the last tile has been cut.
 *
 * A generator declares a room when it carves it, but carving is not over: the chasm
 * cuts its crack through a floor that already has rooms on it, and `stitch` digs
 * through whatever is in the way. So a room can lose tiles — including the one it
 * named as its centre, which `populate` puts the altar and the descent on without
 * asking. Ten seeds in forty were putting a room's centre, and twice the player's own
 * start tile, inside the void.
 *
 * Two invariants restored, both of which every generator is entitled to assume and
 * none of them can enforce alone: a room's tiles are all walkable and all its own, and
 * its centre is one of them. A room reduced to scraps stops being a room — it would
 * otherwise still draw a share of the floor's bodies into a corner three tiles wide.
 */
function settle(g: Grid): void {
  for (let i = 0; i < g.tiles.length; i++) {
    const t = g.tiles[i];
    if (g.roomOf[i] !== 255 && (t === Tile.Wall || t === Tile.Gap)) g.roomOf[i] = 255;
  }
  const kept: Room[] = [];
  for (const r of g.rooms) {
    r.tiles = r.tiles.filter(([x, y]) => g.roomOf[g.idx(x, y)] === r.id);
    if (r.tiles.length < 4) {
      for (const [x, y] of r.tiles) g.roomOf[g.idx(x, y)] = 255;
      continue;
    }
    kept.push(r);
  }
  kept.forEach((r, i) => {
    r.id = i;
    for (const [x, y] of r.tiles) g.roomOf[g.idx(x, y)] = i;
    recentre(g, r);
  });
  g.rooms = kept;
}

/** Label walkable tiles by connected component, 1-based. 0 means not walkable. */
function components(g: Grid): { of: Int32Array; count: number } {
  const of = new Int32Array(g.w * g.h);
  let count = 0;
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const i0 = g.idx(x, y);
      if (of[i0] || !g.walkable(x, y)) continue;
      const id = ++count;
      const q = [i0];
      of[i0] = id;
      for (let qi = 0; qi < q.length; qi++) {
        const i = q[qi];
        const cx = i % g.w, cy = (i / g.w) | 0;
        for (const [dx, dy] of DIR_VEC) {
          const nx = cx + dx, ny = cy + dy;
          if (!g.walkable(nx, ny)) continue;
          const ni = g.idx(nx, ny);
          if (of[ni]) continue;
          of[ni] = id;
          q.push(ni);
        }
      }
    }
  }
  return { of, count };
}

/**
 * Entrance, boss, altar, treasure — by PATH distance, not by map distance.
 *
 * The old pass compared room centres with a manhattan subtraction, which is only ever
 * right when rooms are scattered rectangles joined by roughly-straight corridors. On a
 * spiral the eye is four tiles from the outer lap and forty steps away; on a nest the
 * middle is the closest room on the map and the furthest room on foot. Measuring what
 * the player actually walks is what lets one pass serve every shape — and it is the
 * same `flood` the spells and the bodies use, so "far" means one thing in this game.
 *
 * The layout gets the first word on the boss, because a shape with an obvious
 * destination knows its own end better than a measurement does.
 */
function assignRoles(g: Grid, rng: Rng, nominated: Room | null): void {
  const reach = g.w * g.h;
  const distFrom = (r: Room): Int16Array => g.flood(r.cx, r.cy, reach);
  const at = (d: Int16Array, r: Room): number => {
    const v = d[g.idx(r.cx, r.cy)];
    return v < 0 ? -1 : v;
  };

  let boss = nominated;
  let entrance: Room | null = null;

  if (boss) {
    const d = distFrom(boss);
    for (const r of g.rooms) {
      if (r === boss) continue;
      if (!entrance || at(d, r) > at(d, entrance)) entrance = r;
    }
  } else {
    // The two ends of the longest walk on the floor. Sampled rather than exhaustive
    // once a layout declares a lot of rooms — a warren's twenty would be twenty
    // floods for a pair of tiles nobody can tell apart.
    const probes = g.rooms.length > 10 ? rng.sample(g.rooms, 10) : g.rooms;
    let bestD = -1;
    for (const a of probes) {
      const d = distFrom(a);
      for (const b of g.rooms) {
        if (b === a) continue;
        const v = at(d, b);
        if (v > bestD) { bestD = v; boss = a; entrance = b; }
      }
    }
    // the boss gets the bigger of the two ends; the fight needs the room
    if (boss && entrance && entrance.tiles.length > boss.tiles.length) {
      const t = boss; boss = entrance; entrance = t;
    }
  }

  if (!boss || !entrance) { boss = g.rooms[0]; entrance = g.rooms[1]; }
  boss.kind = 'boss';
  entrance.kind = 'entrance';

  /**
   * The altar goes in the room FURTHEST from the boss that is not the entrance, so
   * picking up your new spell is a detour you choose rather than a gimme on the way.
   */
  const fromBoss = distFrom(boss);
  const rest = g.rooms.filter((r) => r.kind === 'normal');
  if (rest.length) {
    let altar = rest[0];
    for (const r of rest) if (at(fromBoss, r) > at(fromBoss, altar)) altar = r;
    altar.kind = 'altar';
    const others = g.rooms.filter((r) => r.kind === 'normal');
    if (others.length) rng.pick(others).kind = 'treasure';
  }

  g.start = { x: entrance.cx, y: entrance.cy, dir: rng.int(0, 3) as Dir };
  // revealed in the boss room once the boss dies — see `Floor.revealStairs`
  g.stairs = { x: boss.cx, y: boss.cy };
}

/**
 * WHICH SURFACES EACH FLOOR CARRIES.
 *
 * Not rolled, for the same reason the layout is not: a floor should be a place. And
 * introduced one at a time, because every one of them is a rule the player has to
 * learn by looking — dropping four new floor behaviours on somebody at once turns a
 * vocabulary into noise, which is the exact failure the acceptance line about three
 * surfaces is guarding against.
 *
 * FLOOR 1 STAYS BARE. It is the floor that teaches what a floor is, and the layout
 * table leaves it plain for the same reason.
 *
 * The pairings are chosen against the SHAPE, which is what makes them worth having.
 * Fog on the gauntlet means a chain of rooms you cannot see down, and the one layout
 * with no way round is the one where that hurts. Portals on the islands and on the
 * chasm are the two floors that took footing away, given one way across that is not a
 * causeway. Iron in the foundry, water in the vault. The Hollow Crown carries three,
 * because by then all three have been taught.
 */
const SURFACES_BY_DEPTH: Surface[][] = [
  [],                                              //  1 rooms — the grammar, bare
  [Surface.Rubble],                                //  2 warren — cramped and blocked
  [Surface.Water],                                 //  3 cave — it seeps
  [Surface.Iron, Surface.Rubble],                  //  4 grid city — plated and broken
  [Surface.Water, Surface.Iron],                   //  5 cathedral — a flooded vault
  [Surface.Portal, Surface.Iron],                  //  6 islands — a way across
  [Surface.Fog, Surface.Rubble],                   //  7 ring — a loop you cannot see round
  [Surface.Fog, Surface.Water],                    //  8 gauntlet — a chain you cannot see down
  [Surface.Portal, Surface.Rubble],                //  9 chasm — a way over
  [Surface.Iron, Surface.Water, Surface.Fog],      // 10 hub — all three, taught
];

/**
 * Lay the floor's surfaces on it.
 *
 * Runs after the roles are assigned, so it knows which room is the entrance and where
 * the descent is, and before the lights, so a plate of iron gets torches like any
 * other floor. Every surface here is WALKABLE — none of them can cut the floor in two,
 * which is why this can run after `stitch` without re-checking anything.
 *
 * Three tiles are sacred and nothing is ever laid on them: the player's start, the
 * descent, and any room's centre. `populate` puts the altar, the boss and the stairs
 * on a room's centre without asking, and an altar standing in a fog bank is a reward
 * you cannot find.
 */
function dress(g: Grid, rng: Rng, depth: number): void {
  const wanted = SURFACES_BY_DEPTH[Math.max(0, Math.min(SURFACES_BY_DEPTH.length - 1, depth - 1))];
  if (!wanted.length) return;

  const sacred = new Set<number>([g.idx(g.start.x, g.start.y)]);
  if (g.stairs) sacred.add(g.idx(g.stairs.x, g.stairs.y));
  for (const r of g.rooms) sacred.add(g.idx(r.cx, r.cy));

  const lay = (i: number, s: Surface): void => {
    if (sacred.has(i) || g.surface[i] !== Surface.Plain) return;
    g.surface[i] = s;
  };
  const entrance = g.rooms.find((r) => r.kind === 'entrance');
  const elsewhere = g.rooms.filter((r) => r !== entrance);

  for (const s of wanted) {
    if (s === Surface.Iron) {
      /**
       * A PLATE IS A RECTANGLE, AND IT HAS TO SURVIVE BEING CLIPPED.
       *
       * The rectangle is the intent; what actually gets laid is the rectangle minus
       * whatever is not this room, minus the sacred tiles, minus anything an earlier
       * surface already took — and on a floor that lays water first, that had been
       * leaving single tiles of plating behind. A one-tile plate is the worst thing
       * this phase could ship: it LOOKS like a circuit, which is the entire promise
       * of drawing it as a shape, and it conducts to nothing. So the tiles are
       * gathered, cut down to their largest connected piece, and laid only if there
       * is enough of them left to be worth reading as a plate.
       */
      // Walk the rooms until two plates are down, rather than picking two rooms and
      // hoping. A room an earlier surface already flooded yields nothing, and on the
      // floor that lays water first that was leaving a third of the cathedrals with
      // no plating at all — a floor silently short of one of the two things its own
      // table promised it.
      let laid = 0;
      for (const room of rng.shuffle([...elsewhere])) {
        if (laid >= 2) break;
        const w = Math.min(room.w - 1, rng.int(3, 5));
        const h = Math.min(room.h - 1, rng.int(3, 5));
        if (w < 2 || h < 2) continue;
        const x0 = room.x + rng.int(0, Math.max(0, room.w - w));
        const y0 = room.y + rng.int(0, Math.max(0, room.h - h));
        const free = (i: number) =>
          g.roomOf[i] === room.id && !sacred.has(i) && g.surface[i] === Surface.Plain;
        const want = new Set<number>();
        for (let y = y0; y < y0 + h; y++) {
          for (let x = x0; x < x0 + w; x++) {
            const i = g.idx(x, y);
            if (free(i)) want.add(i);
          }
        }
        let plate = largestPiece(g, want);
        if (plate.length < 4) {
          // A room too small to hold a rectangle gets plated wall to wall instead of
          // going without. The grid city's shops are three tiles across, and dropping
          // the plating out of the FOUNDRY because its rooms are small would have
          // quietly deleted that floor's whole second surface.
          const whole = new Set<number>();
          for (const [x, y] of room.tiles) if (free(g.idx(x, y))) whole.add(g.idx(x, y));
          plate = largestPiece(g, whole);
        }
        if (plate.length < 4) continue;
        for (const i of plate) g.surface[i] = Surface.Iron;
        laid++;
      }
    } else if (s === Surface.Water) {
      // Water pools in a QUARTER of a room, not all of it — the point of a flooded
      // corner is that the dry part is a choice you can still make.
      let pools = 0;
      for (const room of rng.shuffle([...elsewhere])) {
        if (pools >= 2) break;
        const from = rng.pick(room.tiles);
        const pool = g.flood(from[0], from[1], rng.int(2, 4),
          (px, py) => g.roomOf[g.idx(px, py)] === room.id);
        let wet = 0;
        for (let i = 0; i < pool.length; i++) {
          if (pool[i] < 0 || sacred.has(i) || g.surface[i] !== Surface.Plain) continue;
          g.surface[i] = Surface.Water;
          wet++;
        }
        if (wet >= 3) pools++;
      }
    } else if (s === Surface.Rubble) {
      /**
       * Rubble goes in the CORRIDORS and the doorways, where it costs the most and
       * reads the clearest. A slow tile in the middle of a room is a tile you walk
       * round without noticing; a slow tile in a one-wide passage is a decision about
       * whether to spend a gust on it.
       */
      const narrow: number[] = [];
      const wide: number[] = [];
      for (let y = 1; y < g.h - 1; y++) {
        for (let x = 1; x < g.w - 1; x++) {
          if (!g.walkable(x, y) || g.roomOf[g.idx(x, y)] !== 255) continue;
          let open = 0;
          for (const [dx, dy] of DIR_VEC) if (g.walkable(x + dx, y + dy)) open++;
          (open <= 2 ? narrow : wide).push(g.idx(x, y));
        }
      }
      // Not every layout HAS one-wide passages — a ring's road is two tiles across
      // and a warren is nearly all room — and a floor that was promised rubble and
      // got four tiles of it was promised nothing.
      const spots = narrow.length >= 6 ? narrow : [...narrow, ...wide];
      for (const i of rng.sample(spots, Math.min(10, Math.max(3, Math.ceil(spots.length / 6))))) {
        lay(i, Surface.Rubble);
        // in short runs, so it reads as a collapse rather than as litter
        const cx = i % g.w, cy = (i / g.w) | 0;
        for (const [dx, dy] of DIR_VEC) {
          if (!rng.chance(0.45) || !g.walkable(cx + dx, cy + dy)) continue;
          if (g.roomOf[g.idx(cx + dx, cy + dy)] !== 255) continue;
          lay(g.idx(cx + dx, cy + dy), Surface.Rubble);
        }
      }
    } else if (s === Surface.Fog) {
      /**
       * A BANK IS A WHOLE ROOM, never the entrance's.
       *
       * A blob of fog with an arbitrary edge inside a room is a smear; a room that is
       * full of it has a doorway you stand in and decide about. And a player who spawns
       * inside one has been blinded before being taught what blinded them.
       */
      for (const bank of rng.shuffle(elsewhere.filter((r) => r.kind !== 'boss'))) {
        let murky = 0;
        for (const [x, y] of bank.tiles) {
          const i = g.idx(x, y);
          if (sacred.has(i) || g.surface[i] !== Surface.Plain) continue;
          g.surface[i] = Surface.Fog;
          murky++;
        }
        // A room the other surfaces already covered leaves a bank of three tiles,
        // which is a puff rather than a place. Try the next room instead.
        if (murky >= 6) break;
      }
    } else if (s === Surface.Portal) {
      /**
       * A PAIR, as far apart on foot as the floor allows.
       *
       * A portal between two rooms you could walk between in four steps is scenery. The
       * mouths go in the two rooms furthest apart BY PATH — the same measurement the
       * boss and the entrance are placed by — which on the two floors that carry them
       * means the pair spans the void or the crack.
       */
      let best: [number, number] | null = null, bestD = -1;
      for (const a of g.rooms) {
        const d = g.flood(a.cx, a.cy, g.w * g.h);
        for (const b of g.rooms) {
          if (b === a) continue;
          const v = d[g.idx(b.cx, b.cy)];
          if (v > bestD) { bestD = v; best = [a.id, b.id]; }
        }
      }
      if (!best) continue;
      const mouth = (room: Room): number => {
        const free = room.tiles.filter(([x, y]) => !sacred.has(g.idx(x, y))
          && g.surface[g.idx(x, y)] === Surface.Plain);
        if (!free.length) return -1;
        const [x, y] = rng.pick(free);
        return g.idx(x, y);
      };
      const a = mouth(g.rooms[best[0]]), b = mouth(g.rooms[best[1]]);
      if (a < 0 || b < 0) continue;
      g.surface[a] = Surface.Portal;
      g.surface[b] = Surface.Portal;
      g.portals.push({ a, b });
    }
  }
}

/** The biggest 4-connected piece of a set of tiles. A plate is one piece or it is nothing. */
function largestPiece(g: Grid, tiles: Set<number>): number[] {
  const seen = new Set<number>();
  let best: number[] = [];
  for (const start of tiles) {
    if (seen.has(start)) continue;
    const piece: number[] = [];
    const q = [start];
    seen.add(start);
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi];
      piece.push(i);
      const cx = i % g.w, cy = (i / g.w) | 0;
      for (const [dx, dy] of DIR_VEC) {
        const ni = g.idx(cx + dx, cy + dy);
        if (!g.inside(cx + dx, cy + dy) || seen.has(ni) || !tiles.has(ni)) continue;
        seen.add(ni);
        q.push(ni);
      }
    }
    if (piece.length > best.length) best = piece;
  }
  return best;
}

/**
 * Wall sconces in corridors and braziers in rooms. Placement is deliberate: every
 * room gets at least one so it reads on approach, and long corridors get them at
 * intervals so a passage has rhythm instead of being a black tube.
 */
function placeLights(g: Grid, rng: Rng): void {
  const isCorridor = (x: number, y: number) => g.walkable(x, y) && g.roomOf[g.idx(x, y)] === 255;

  for (const r of g.rooms) {
    /**
     * LIGHT A ROOM UNTIL IT IS LIT, rather than to a fixed count.
     *
     * "One or two sconces, three at an altar" was a fine constant while every room was
     * a five-by-five box. A cathedral's nave is four hundred tiles and got the same
     * two torches — a quarter of the biggest room in the game lit and the rest a black
     * field you walk into hoping. A per-area budget fixes the nave and still fails the
     * nested rings, which are two tiles wide and forty long: same area, nothing like
     * the same shape, and a disc of torchlight covers a tenth as much of it.
     *
     * So the stop condition is COVERAGE, which is the thing actually wanted and does
     * not care what shape the room is: keep hanging sconces, still no two within three
     * tiles of each other, until nearly every tile of the room is within a sconce's
     * reach. The old constant survives as the FLOOR of the budget — a boss room gets
     * its four however small it is, because that room is a stage.
     */
    const base = r.kind === 'boss' ? 4 : r.kind === 'altar' ? 3 : rng.int(1, 2);
    const cands: LightSource[] = [];
    for (const [x, y] of r.tiles) {
      for (let f = 0; f < 4; f++) {
        const [dx, dy] = DIR_VEC[f];
        // a sconce needs a WALL to hang on, not merely something you cannot walk into
        if (g.seeThrough(x + dx, y + dy)) continue;
        cands.push({ x, y, h: WALL_H * 0.49, reach: 4.4, strength: 0.85, face: f });
      }
    }
    rng.shuffle(cands);
    const covered = new Set<number>();
    const taken: LightSource[] = [];
    for (const c of cands) {
      if (taken.length >= 16) break;
      if (taken.length >= base && covered.size >= r.tiles.length * 0.85) break;
      // spread them out — no two sconces within 3 tiles
      if (taken.some((t) => Math.abs(t.x - c.x) + Math.abs(t.y - c.y) < 3)) continue;
      taken.push(c);
      for (const [x, y] of r.tiles) {
        if (Math.abs(x - c.x) + Math.abs(y - c.y) <= 4) covered.add(g.idx(x, y));
      }
    }

    /**
     * A ROOM WITH NO WALLS STILL GETS A LIGHT.
     *
     * "Every room gets at least one" was implemented as "hang it on a wall", which
     * held for as long as every room was a rectangle cut out of solid rock. An island
     * is bounded by void on all four sides and has no wall to hang anything on, so it
     * generated in total darkness — a room you cannot see is a room you will not walk
     * into. `face: -1` is the free-standing brazier the type has always allowed for.
     */
    if (!taken.length) {
      taken.push({ x: r.cx, y: r.cy, h: WALL_H * 0.35, reach: 5, strength: 0.8, face: -1 });
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
        if (g.seeThrough(x + dx, y + dy)) continue;
        g.lights.push({ x, y, h: WALL_H * 0.49, reach: 3.8, strength: 0.7, face: f });
        break;
      }
    }
  }
}
