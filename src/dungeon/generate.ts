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
  Grid, Tile, Surface, DIR_VEC, bakeLight, sightLine,
  type Room, type Dir, type LightSource, type HazardKind,
} from './grid';
import { WALL_H } from '../art/tiles';
import { LAYOUTS, layoutFor, recentre, type LayoutId } from './layouts';

export interface GenOpts {
  depth: number;
  seed: string;
  /**
   * Does this floor need a sealed room for a captive?
   *
   * Asked for rather than worked out, because whether anybody is behind a gate on floor three
   * depends on the SAVE — who is already freed, and which wizard is being played — and the
   * generator has no business knowing either. It is told, and it answers with geometry.
   */
  wantCaptiveRoom?: boolean;
  /**
   * Can this save SHOVE? Told, for the same reason `wantCaptiveRoom` is told.
   *
   * A portcullis is held up by weight on its plate, and of the three things that can
   * weigh a plate down — your boots, a body, a block of stone — only the block leaves
   * you free to walk through the gap. Shoving stone is `cast.shove`, which is gust and
   * nothing else, and gust is VANE, whose cage is on depth 5 and who is fourth in a
   * chain that starts with Kela on depth 3.
   *
   * So a plate-gated floor built for a save that has not freed Vane is a floor with a
   * mechanism it cannot work: the first two cages in the game sit behind the one lock
   * whose only key is three cages further down. Every page pool is now cut to the
   * roster, which turned that from a bad roll into the guaranteed opening of every new
   * save — but it was always reachable, because a run that never rolled Gust hit it too.
   *
   * When false, nothing that needs a shove is built. The captive still gets a room; it
   * simply is not sealed.
   */
  canShove?: boolean;
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
  /**
   * How many times this floor has already been thrown away and re-seeded.
   *
   * Internal. `lock` can fail on a hostile roll — there may simply be no chokepoint
   * into the boss room with somewhere to stand and see it — and a boss room without a
   * gate is now a floor that does not hold up its own rule, so the answer is a fresh
   * seed rather than a floor that quietly skips the mechanic.
   *
   * Bounded, and that is the whole reason this exists. "Re-roll until it works" is one
   * layout away from a generator that never returns, and the failure mode is the game
   * hanging on the loading screen with no clue why. After `GATE_TRIES` the floor is
   * accepted as it is: a boss room with no gate is a disappointment, and an infinite
   * loop is a bug report.
   */
  tries?: number;
}

/** How many seeds to spend looking for a floor whose boss room can be locked. */
const GATE_TRIES = 10;

/**
 * How far from a shallow floor's boss door its one lever may stand.
 *
 * The cap is what makes the sight line mean something. Without it the furthest visible
 * tile was twenty-six away down a corridor — a straight line the engine calls visible
 * and a player reads as two unrelated rooms.
 */
const SHALLOW_SIGHT = 10;

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

  /**
   * The four dressing passes, unless the layout says it dressed itself. Only the
   * showroom does — see `Layout.dressed`.
   */
  if (!layout.dressed) {
    dress(g, rng, opts.depth);
    raise(g, rng, opts.depth);
    wind(g, rng, opts.depth, !!opts.wantCaptiveRoom, opts.canShove !== false);
    lock(g, rng, opts.depth);
    /**
     * EVERY BOSS ROOM IS LOCKED, or this floor is not the floor.
     *
     * `lock` is allowed to fail — it needs a chokepoint into the boss room and, on a
     * shallow floor, somewhere to stand that can see it — and it used to fail silently,
     * which meant the rule was "most boss rooms have a gate". A rule the player meets
     * four times out of five is not a rule they can learn; it is a thing that sometimes
     * happens. So a floor that could not be locked is thrown away and re-seeded.
     *
     * Before `strew`, so a floor about to be discarded does not pay for its own props,
     * and bounded by `GATE_TRIES` — see the note on `tries`.
     */
    const tries = opts.tries ?? 0;
    if (!g.bossDoor && g.rooms.some((r) => r.kind === 'boss') && tries < GATE_TRIES) {
      return generate({ ...opts, seed: `${opts.seed}g`, tries: tries + 1 });
    }
    strew(g, rng, opts.depth);
  }
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

/**
 * Cut levels into the floor: a sunken room, a raised platform, and a ladder back up.
 *
 * Runs after the surfaces, because a ladder IS a surface and has to be able to claim a
 * tile the others have not taken, and after the roles, because the entrance and the
 * boss room want different treatment. Every drop it makes is walkable both ways at the
 * moment it is made — down over the edge and up the ladder — so this cannot cut a floor
 * in two the way a wall could, which is why it does not have to re-run `stitch`.
 *
 * WHICH FLOORS. Not floor 1, which teaches, and not every floor after — a ledge in
 * every room is a terrain feature nobody notices. Depth 4 up, and only in rooms big
 * enough that the drop has a top and a bottom you can both stand on.
 */
function raise(g: Grid, rng: Rng, depth: number): void {
  if (depth < 4) return;
  // A layout that shaped its own elevation has already decided; terraces is a
  // staircase and does not want a pit cut into one of its landings.
  for (let i = 0; i < g.height.length; i++) if (g.height[i]) return;

  const rooms = g.rooms.filter((r) => r.kind !== 'entrance' && r.w >= 6 && r.h >= 6);
  if (!rooms.length) return;

  const wanted = depth >= 8 ? 2 : 1;
  let made = 0;
  for (const room of rng.shuffle([...rooms])) {
    if (made >= wanted) break;

    /**
     * A HALF-ROOM, split on one axis, and the SUNKEN half is the far one.
     *
     * Half rather than a patch in the middle, because the ledge has to be a LINE you
     * can be shoved across rather than a hole you can walk round — the shove is one
     * tile, so a drop you can sidestep is a drop that never happens. And the far half
     * sinks rather than the near one, so a player coming in through the door arrives
     * on the high side and gets the overlook before the decision, which is the order
     * the phase is written in.
     */
    const drop = depth >= 8 && rng.chance(0.4) ? 2 : 1;
    // Both ways round, in a random order, because a room can have an exit on the far
    // side of one cut and not the other — a chapel whose only door opens into the
    // sunken half is a chapel you cannot walk to, and which half that is depends
    // entirely on which way the room was sliced.
    for (const vertical of rng.shuffle([true, false])) {
      const cut = vertical
        ? room.x + Math.max(2, Math.floor(room.w / 2))
        : room.y + Math.max(2, Math.floor(room.h / 2));

      /**
       * THE DOORWAYS STAY AT THE TOP.
       *
       * A room's exits are the tiles with a neighbour belonging to something else, and
       * sinking one turns the corridor beyond it into a step up with no ladder under
       * it — which is how the cathedral kept ending up with its altar behind a door
       * you could see and not use. Holding them back makes the pit the room's INTERIOR,
       * which is also the better shape: you fight your way in across the edge instead
       * of arriving at the bottom of it.
       *
       * The check afterwards still runs. This is what makes it usually pass rather
       * than what makes it unnecessary.
       */
      const isDoor = (x: number, y: number) => DIR_VEC.some(([dx, dy]) =>
        g.walkable(x + dx, y + dy) && g.roomOf[g.idx(x + dx, y + dy)] !== room.id);

      /**
       * WHICHEVER HALF THE ROOM'S CENTRE IS NOT IN.
       *
       * The centre is where `populate` puts the altar, the boss and the descent, and
       * none of those belong at the bottom of a pit. Rejecting the room when the
       * centre landed on the wrong side of the cut was the first attempt, and it threw
       * away every big room on the floor — the cathedral's nave is split through its
       * middle by definition, so the one room most worth a ledge never got one.
       * Choosing the other half instead costs a comparison.
       */
      const far = (vertical ? room.cx : room.cy) < cut;
      const want = new Set<number>();
      for (const [x, y] of room.tiles) {
        const beyond = (vertical ? x : y) >= cut;
        if (beyond !== far) continue;
        if (isDoor(x, y)) continue;
        want.add(g.idx(x, y));
      }
      /**
       * ONE PIECE, because one ladder can only serve one piece.
       *
       * The cathedral's nave has two rows of pillars down it, so the far half of that
       * room is not a half, it is three strips — and a pit in three pieces with a
       * ladder in one of them is two pieces you can fall into and not climb out of.
       * The traversal check caught it every time, which meant the nave, the one room
       * on the floor worth a ledge, never got one.
       */
      const low = largestPiece(g, want);
      // A sunken half with nothing in it is a step nobody meets.
      if (low.length < 4) continue;
      for (const i of low) g.height[i] = -drop;

      /**
       * THE LADDER, at the foot of the step and against it.
       *
       * One per drop and no more: the way back has to be a PLACE, because the whole
       * value of dropping is that you gave something up to do it. Chosen on the low
       * side touching the high side, so it is visible from the top — you can see where
       * you will be able to climb out before you decide to go down.
       */
      const feet = low.filter((i) => {
        const x = i % g.w, y = (i / g.w) | 0;
        if (g.surface[i] !== Surface.Plain) return false;
        return DIR_VEC.some(([dx, dy]) =>
          g.walkable(x + dx, y + dy) && g.heightAt(x + dx, y + dy) > g.heightAt(x, y));
      });
      if (!feet.length) {
        for (const i of low) g.height[i] = 0;   // no way back up: put the room back
        continue;
      }
      const ladder = rng.pick(feet);
      g.surface[ladder] = Surface.Ladder;

      /**
       * AND THEN CHECK, because a ledge is a one-way door and a one-way door can shut
       * a floor.
       *
       * Climbing is directional, so height turns reachability into a DIRECTED graph and
       * every intuition from the flat grid stops being safe. The case that broke it was
       * not the obvious one: the sunken half of the cathedral's nave swallowed the tile
       * the altar's chapel opens off, so the chapel was still one step from the player
       * and the step was upward — a room you can see the door of and cannot enter, with
       * the floor's spell inside it.
       *
       * Rather than enumerate the ways that can happen, the pass makes its change and
       * then asks the only two questions that matter: can you still get everywhere, and
       * can you still get BACK from everywhere. If not, the room is put back exactly as
       * it was and another one is tried. One ladder in the wrong place is not worth a
       * clever rule; it is worth an undo.
       */
      if (!traversable(g)) {
        for (const i of low) g.height[i] = 0;
        g.surface[ladder] = Surface.Plain;
        continue;
      }
      made++;
      break;
    }
  }
}

/**
 * Wind the floor's clock: hazards on a beat, and one gate with a plate to open it.
 *
 * Last of the four dressing passes, so it can see the elevation and the surfaces and
 * refuse to sit on top of either. Introduced a kind at a time for the reason every
 * other vocabulary in this game is: a beat you have to learn is only learnable if it
 * is the only new thing in the room.
 *
 * Floors 1-2 have no clock at all. A blade arrives on 3, spikes on 5, the gate on 6,
 * and the trapdoor last on 8 — it is the only one that can take a floor off you, and
 * it should arrive to a player who already trusts that a wind-up means something.
 */
function wind(
  g: Grid, rng: Rng, depth: number, wantCaptiveRoom = false, canShove = true,
): void {
  if (depth < 3) return;

  const sacred = new Set<number>([g.idx(g.start.x, g.start.y)]);
  if (g.stairs) sacred.add(g.idx(g.stairs.x, g.stairs.y));
  for (const r of g.rooms) sacred.add(g.idx(r.cx, r.cy));

  const free = (i: number): boolean => {
    const x = i % g.w, y = (i / g.w) | 0;
    return g.walkable(x, y) && !sacred.has(i) && g.surface[i] === Surface.Plain
      && g.at(x, y) !== Tile.Door && !g.hazards.some((h) => g.idx(h.x, h.y) === i);
  };

  /**
   * Hazards want NARROW tiles — a doorway, a corridor, the one way round a pillar.
   * A blade in the middle of a room is a tile you walk round without noticing, and
   * the whole point is that it should make you count. Where a floor has no narrow
   * tiles the open ones will do, but they are the second choice.
   */
  const narrow: number[] = [];
  const wide: number[] = [];
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const i = g.idx(x, y);
      if (!free(i)) continue;
      let open = 0;
      for (const [dx, dy] of DIR_VEC) if (g.walkable(x + dx, y + dy)) open++;
      (open <= 2 ? narrow : wide).push(i);
    }
  }

  const kinds: HazardKind[] = ['blade'];
  if (depth >= 5) kinds.push('spikes');
  if (depth >= 8) kinds.push('trapdoor');

  const spots = rng.shuffle([...(narrow.length >= 4 ? narrow : [...narrow, ...wide])]);
  const want = Math.min(spots.length, 2 + Math.floor(depth / 3));
  for (let n = 0; n < want; n++) {
    const i = spots[n];
    const x = i % g.w, y = (i / g.w) | 0;
    // Two tiles apart at least, or a pair of blades reads as one long hazard and the
    // player cannot tell which beat belongs to which.
    if (g.hazards.some((h) => Math.abs(h.x - x) + Math.abs(h.y - y) < 3)) continue;
    const kind = rng.pick(kinds);
    /**
     * PERIOD 3 OR 4, LIVE FOR ONE. Long enough to walk through on the idle beat,
     * short enough that waiting for it is a real cost, and never live for two in a
     * row — a hazard you cannot cross at all is a wall that took a turn to explain.
     */
    const period = rng.int(3, 4);
    /**
     * A TRAPDOOR STAYS OPEN LONGER, because it is the one hazard you have to be able
     * to MEET rather than only avoid.
     *
     * A blade or a bed of spikes is a thing you time your way past, and one live beat
     * in four is exactly the right price for that. A trapdoor is a route: it is the
     * fast way down and the only hazard the player will ever deliberately step onto.
     * Live for one beat of four means that if your rhythm is out by a single turn —
     * and it always is, because everything else in the room is also spending your
     * turns — the hole is simply never open when you are standing next to it, and a
     * shortcut you cannot take on purpose is not a shortcut.
     *
     * Half the cycle, so it is open as often as it is shut. It still costs a turn to
     * wait for, and it can still take a floor off you when you did not want one.
     */
    const live = kind === 'trapdoor' ? Math.max(2, period >> 1) : 1;
    g.hazards.push({
      x, y, kind, period, live,
      beat: rng.int(0, period - 1),
      damage: kind === 'trapdoor' ? 0 : 5 + depth,
    });
  }

  /**
   * THE CAPTIVE'S GATE FIRST, when this floor is asked for one.
   *
   * Before the ordinary gate so it gets the pick of the corridors — the two use the same search
   * and the ordinary one would happily take the only door that seals a room. `captiveRoom` is
   * left on the grid for `populate` to read, and stays -1 when no room could be sealed, which is
   * a floor whose shape simply had nowhere to put one.
   */
  /**
   * A CAGE YOU CANNOT OPEN IS WORSE THAN A CAGE WITH NO DOOR.
   *
   * "The gate IS the encounter", so the cage is always sealed. What changes is the KEY:
   * a plate for a save that can shove a block onto it, and a bank of levers for one that
   * cannot. An unsealed room was the first answer here and it was the wrong one — it makes
   * the single appearance of that hero read as a body standing in a corridor.
   */
  if (wantCaptiveRoom) {
    g.captiveRoom = placeCaptiveGate(g, rng, canShove) ?? -1;
  }
  if (depth >= 6 && canShove) placeGate(g, rng);
}

/**
 * One portcullis and the plate that lifts it.
 *
 * The gate goes on a corridor tile and the plate goes in a different room, so getting
 * from one to the other is the arithmetic the phase is about. Two things have to be
 * true and both are checked rather than reasoned about, because a gate is the one
 * piece of furniture in this game that can make a floor unfinishable:
 *
 *  - WITH IT SHUT, the plate is still reachable. Otherwise the player arrives at a
 *    locked gate holding the only key on the far side of it.
 *  - WITH IT OPEN, everything is reachable. Otherwise the gate is not a gate, it is
 *    a wall somebody left a switch next to.
 */
/**
 * A gate that seals a ROOM, for the captive to be behind. Returns the room it sealed.
 *
 * The same search as `placeGate` and deliberately so — the reachability test, the "nothing the
 * run needs may be stranded" rule and the plate distance band are all load-bearing and none of
 * them is different here. Two things change.
 *
 * First, it must gate a ROOM rather than merely gate SOMETHING: the captive stands in a room,
 * so a door that seals six corridor tiles is no use even though `placeGate` would take it.
 * Second, it returns which room, because the gate has to choose the room and not the reverse —
 * the captive is placed by `populate`, long after the grid exists, so generation cannot be told
 * where they will be. It decides where they CAN be instead.
 */
function placeCaptiveGate(g: Grid, rng: Rng, withPlate: boolean): number | null {
  /**
   * SEAL A ROOM'S DOORWAYS. Do not go looking for a corridor that cuts the map.
   *
   * `placeGate`'s approach — try single corridor tiles until one disconnects something — cannot
   * work on this generator and measurably does not: on a depth-3 floor, 77 of 81 candidate
   * tiles seal NOTHING, because the map is carved with loops and one door almost never
   * separates a region. That is also, with the two-open-neighbours filter, why no gate has ever
   * appeared in the game.
   *
   * So the room is chosen first and every mouth into it is shut. A room with one or two
   * doorways is a room you can lock; anything with more is skipped rather than filled with
   * portcullises. Every door shares the ONE plate, which is what makes it a single mechanism
   * rather than a puzzle with several answers.
   */
  const sacred = new Set<number>([g.idx(g.start.x, g.start.y)]);
  if (g.stairs) sacred.add(g.idx(g.stairs.x, g.stairs.y));

  for (const room of rng.shuffle(g.rooms.filter((r) => r.kind !== 'entrance'))) {
    const inside = new Set(room.tiles.map(([x, y]) => g.idx(x, y)));
    if (inside.size < 6) continue;
    if (room.tiles.some(([x, y]) => sacred.has(g.idx(x, y)))) continue;

    // A mouth: walkable, outside the room, and touching it.
    const mouths = new Set<number>();
    for (const [x, y] of room.tiles) {
      for (const [dx, dy] of DIR_VEC) {
        const nx = x + dx, ny = y + dy, ni = g.idx(nx, ny);
        if (!g.walkable(nx, ny) || inside.has(ni)) continue;
        if (g.roomOf[ni] !== 255) continue;              // opens straight into another room
        if (g.surface[ni] !== Surface.Plain) continue;
        if (g.hazards.some((h) => g.idx(h.x, h.y) === ni)) continue;
        if (sacred.has(ni)) continue;
        mouths.add(ni);
      }
    }
    if (!mouths.size || mouths.size > 2) continue;

    const was = [...mouths].map((k) => [k, g.tiles[k]] as const);
    for (const k of mouths) { g.tiles[k] = Tile.Door; g.setDoorLift(k, 0); }
    const shut = reachable(g);
    for (const k of mouths) g.setDoorLift(k, 1);
    const open = reachable(g);
    for (const k of mouths) g.setDoorLift(k, 0);

    // Nothing the run needs may be behind it, and the room itself must actually be shut in.
    let ok = true;
    for (const k of sacred) if (!shut[k]) { ok = false; break; }
    if (ok) {
      let sealed = 0;
      for (const k of inside) if (open[k] && !shut[k]) sealed++;
      if (sealed < 6) ok = false;
    }
    if (!ok) { for (const [k, t] of was) g.tiles[k] = t; continue; }

    /**
     * The candidates are the same tiles either way: reachable with the cage SHUT, in a room
     * that is not the cage, off the run's critical tiles, and not the mouth's own doorstep.
     * A plate and a lever want exactly the same place — somewhere you have to walk to.
     */
    const spots: number[] = [];
    const [mx, my] = [[...mouths][0] % g.w, ([...mouths][0] / g.w) | 0];
    for (let k = 0; k < shut.length; k++) {
      if (!shut[k] || sacred.has(k) || g.surface[k] !== Surface.Plain) continue;
      if (g.roomOf[k] === 255 || inside.has(k)) continue;
      if (g.hazards.some((h) => g.idx(h.x, h.y) === k)) continue;
      const d = Math.abs((k % g.w) - mx) + Math.abs(((k / g.w) | 0) - my);
      if (d >= 3) spots.push(k);
    }
    if (!spots.length) { for (const [k, t] of was) g.tiles[k] = t; continue; }

    if (withPlate) {
      const plate = rng.pick(spots);
      g.surface[plate] = Surface.Plate;
      for (const k of mouths) g.doors.push({ i: k, plate });
      return room.id;
    }

    /**
     * LEVERS INSTEAD, for a save that cannot shove a block onto a plate.
     *
     * One or two, and two only when there is room for two that are not next to each other —
     * a second lever is what stops the cage being a switch beside a door, and it is the
     * boss door's own trick at a smaller scale. A lever is a SURFACE, so it goes on standing
     * floor and `populate` turns it into a fixture you tap.
     *
     * `walkAround` is asked of each, the same question `lock` asks of the boss levers: a
     * handle in a slot with one way in is a handle the player walks a corridor to reach and
     * then walks back out of, and it can be walled in outright by a block laid later.
     */
    /**
     * A lever is SOLID, so it is asked both questions `lock` asks of the boss levers:
     * `walkAround` for the passage case a flood cannot see, and `plugs` for the tile that
     * genuinely cuts the map. Asked with the cage OPEN — the state the floor spends the
     * rest of its life in once the player has thrown them.
     */
    for (const k of mouths) g.setDoorLift(k, 1);
    const openBase = reachable(g);
    const usable = rng.shuffle(spots)
      .filter((k) => walkAround(g, k) && !plugs(g, k, openBase));
    for (const k of mouths) g.setDoorLift(k, 0);
    if (!usable.length) { for (const [k, t] of was) g.tiles[k] = t; continue; }
    const levers = [usable[0]];
    const far = usable.find((k) => {
      const dx = (k % g.w) - (levers[0] % g.w), dy = ((k / g.w) | 0) - ((levers[0] / g.w) | 0);
      return Math.abs(dx) + Math.abs(dy) >= 4;
    });
    if (far !== undefined) levers.push(far);
    for (const k of levers) g.surface[k] = Surface.Lever;
    g.captiveGate = { doors: [...mouths], levers, pulled: new Set<number>() };
    return room.id;
  }
  return null;
}


function placeGate(g: Grid, rng: Rng): boolean {
  const sacred = new Set<number>([g.idx(g.start.x, g.start.y)]);
  if (g.stairs) sacred.add(g.idx(g.stairs.x, g.stairs.y));
  for (const r of g.rooms) sacred.add(g.idx(r.cx, r.cy));

  const corridors: number[] = [];
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const i = g.idx(x, y);
      if (!g.walkable(x, y) || sacred.has(i)) continue;
      if (g.roomOf[i] !== 255 || g.surface[i] !== Surface.Plain) continue;
      if (g.hazards.some((h) => g.idx(h.x, h.y) === i)) continue;
      // A STRAIGHT passage, not merely a tile with two ways out — see `passageAxis`.
      if (!passageAxis(g, x, y)) continue;
      corridors.push(i);
    }
  }

  for (const i of rng.shuffle(corridors).slice(0, 12)) {
    const x = i % g.w, y = (i / g.w) | 0;
    const wasTile = g.tiles[i];
    g.tiles[i] = Tile.Door;
    g.setDoorLift(i, 0);

    // Reachable with the gate SHUT — this is the set the plate has to be inside.
    const shut = reachable(g);
    g.setDoorLift(i, 1);
    const open = reachable(g);
    g.setDoorLift(i, 0);

    /**
     * NOTHING THE RUN NEEDS MAY BE BEHIND IT.
     *
     * This check did not exist and did not need to, because a gate used to open for
     * eight turns: anything behind one was reachable by anybody who walked at it. A
     * plate now HOLDS its gate up, so whoever opens it is standing on the plate and
     * cannot also be walking through the door — a lone player never passes one.
     *
     * So the gate has to be a side door, always. If the stairs or the start end up
     * on the far side of it the floor is simply unfinishable, and that is a bug you
     * would only find on the one seed in forty that produced it.
     */
    let stranded = false;
    for (const j of sacred) if (!shut[j]) { stranded = true; break; }
    if (stranded) { g.tiles[i] = wasTile; continue; }

    // It has to gate something: a door that changes nothing is scenery.
    let gated = 0;
    for (let j = 0; j < open.length; j++) if (open[j] && !shut[j]) gated++;
    if (gated < 6) { g.tiles[i] = wasTile; continue; }

    const plates: number[] = [];
    for (let j = 0; j < shut.length; j++) {
      if (!shut[j] || sacred.has(j) || g.surface[j] !== Surface.Plain) continue;
      if (g.roomOf[j] === 255) continue;                  // a plate belongs in a room
      if (g.hazards.some((h) => g.idx(h.x, h.y) === j)) continue;
      const px = j % g.w, py = (j / g.w) | 0;
      const d = Math.abs(px - x) + Math.abs(py - y);
      // Far enough that the walk costs turns, near enough that it is walkable in the
      // span the gate stays up for.
      if (d >= 4 && d <= 9) plates.push(j);
    }
    if (!plates.length) { g.tiles[i] = wasTile; continue; }

    const plate = rng.pick(plates);
    g.surface[plate] = Surface.Plate;
    g.doors.push({ i, plate });
    return true;
  }
  return false;
}

/**
 * Lock the boss room, and scatter the levers that unlock it.
 *
 * THE REWARD FOR EXPLORING IS ACCESS, never power. The compass points at the altar and
 * then at the boss, so once the altar is claimed the rest of a floor is a corridor —
 * every room the compass does not name is a room with no reason to enter it. A lever
 * fixes that for nothing: it makes the map itself the lock, and it costs the balance
 * of the game precisely zero, because a lever gives the player no damage, no health
 * and no page.
 *
 * The door goes on the way into the boss room and the levers go anywhere else. Two
 * things are then checked rather than assumed, and they are the reason this pass can
 * fail and give up:
 *
 *  - EVERY LEVER IS REACHABLE WITH THE DOOR SHUT. A lever behind its own door is a
 *    floor nobody can finish.
 *  - THE DOOR ACTUALLY GATES THE BOSS. If the room has a second way in, the lock is
 *    scenery and the walk is optional, which is the one thing it must not be.
 */
/**
 * Would something SOLID standing here cut somebody off?
 *
 * A lever is furniture you TAP, not a tile you stand on — see `SOLID` in `game/floor.ts`
 * — so it occupies its tile for the rest of the run. `Grid.walkable` knows nothing about
 * that, because a lever is written as a SURFACE and only becomes a body in `populate`,
 * so every reachability test generation ran said a lever tile was open floor. That is how
 * one ends up plugging a one-wide corridor: nothing in the pipeline ever asked.
 *
 * The same question `strew` asks before it lays a block, against the reachable set the
 * caller is already holding — which matters, because `lock` asks this with the gates shut
 * and "unreachable" then includes everything legitimately behind one.
 */
function plugs(g: Grid, i: number, before: Uint8Array): boolean {
  if (!before[i]) return true;
  const was = g.tiles[i];
  g.tiles[i] = Tile.Wall;
  const after = reachable(g);
  g.tiles[i] = was;
  for (let j = 0; j < before.length; j++) {
    if (before[j] && !after[j] && j !== i) return true;
  }
  return false;
}

/**
 * Is there room to walk AROUND something standing here?
 *
 * The cheap half of the question, and the one the complaint was actually about: a tile
 * with two open neighbours is a passage, and furniture in a passage is a wall whatever
 * the connectivity graph says about loops. Three is a junction or the middle of a room —
 * somewhere a thing can stand and be walked past. `strew` has always asked this of its
 * loose blocks; the lever never did.
 */
/**
 * Is this tile a STRAIGHT one-wide passage — walls on both flanks, open front and back?
 *
 * "Exactly two open neighbours" is what both gate searches used to ask, and it is not
 * the same question. An L-BEND has exactly two open neighbours as well, and they are
 * ADJACENT rather than opposite: open west and open north, say. A portcullis hung there
 * gets its rotation from whichever axis it happened to find first, spans that one, and
 * leaves the other exit wide open beside it — a grille standing in mid-air with the
 * corridor going round it, which is what shipped.
 *
 * So the two openings have to be OPPOSITE. That is a passage; anything else is a corner
 * or a junction, and neither is somewhere a one-tile gate can seal.
 *
 * Returns which way the passage runs, or null. The caller needs the axis anyway to hang
 * the bars along it, and deriving it here from the same test that accepted the tile is
 * what stops the two disagreeing.
 */
function passageAxis(g: Grid, x: number, y: number): 'x' | 'z' | null {
  const w = g.walkable(x - 1, y), e = g.walkable(x + 1, y);
  const n = g.walkable(x, y - 1), s = g.walkable(x, y + 1);
  if (w && e && !n && !s) return 'x';
  if (n && s && !w && !e) return 'z';
  return null;
}

function walkAround(g: Grid, i: number): boolean {
  const x = i % g.w, y = (i / g.w) | 0;
  let open = 0;
  for (const [dx, dy] of DIR_VEC) if (g.walkable(x + dx, y + dy)) open++;
  return open >= 3;
}

/**
 * THE FIRST GATES ARE TAUGHT, THE LATER ONES ARE WORK.
 *
 * A gate on floor eight is a reason to walk the map: three levers in three rooms, and
 * finding them is the content. The same shape on floor one teaches nothing, because a
 * player who has never seen a portcullis does not know that the thing they are looking
 * for is a lever, or that a lever has anything to do with the door two rooms back.
 *
 * So a shallow floor gets ONE lever and it has to be visible from the door it opens.
 * Standing at the gate you can see the handle; standing at the handle you can see the
 * gate come up. The mechanic explains itself in one screen with no text, and the space
 * that has to exist in front of the boss room for both to be in shot at once is the
 * antechamber — it is not carved as a special room, it is what the sight line demands
 * of whichever threshold gets picked.
 */
function shallowGate(depth: number): boolean {
  return depth < 4;
}

function lock(g: Grid, rng: Rng, depth: number): void {
  const boss = g.rooms.find((r) => r.kind === 'boss');
  if (!boss) return;

  const own = new Set(boss.tiles.map(([x, y]) => g.idx(x, y)));
  /**
   * The door goes on the THRESHOLD: a tile outside the boss room with a neighbour
   * inside it. Putting it on a room tile would leave the player standing in the boss's
   * doorway looking at a gate behind them.
   */
  const thresholds: number[] = [];
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const i = g.idx(x, y);
      if (!g.walkable(x, y) || own.has(i)) continue;
      if (g.surface[i] !== Surface.Plain || g.at(x, y) !== Tile.Floor) continue;
      if (g.hazards.some((h) => g.idx(h.x, h.y) === i)) continue;
      if (g.doors.some((d) => d.i === i || d.plate === i)) continue;
      if (!DIR_VEC.some(([dx, dy]) => own.has(g.idx(x + dx, y + dy)))) continue;
      /**
       * A CHOKEPOINT, not just a tile beside the boss room.
       *
       * A portcullis is one tile wide because it hangs in a doorway. Dropped into one
       * tile of a three-wide opening it is a grille standing in mid-air with a gap
       * either side of it — which is what it looked like, and the complaint was that
       * the art was too narrow. The art is fine; it was being hung in a hole four
       * times its size.
       *
       * Exactly two open neighbours is NOT a passage, which is the correction: an
       * L-bend has two as well and they are adjacent, so the gate spanned one axis and
       * left the other exit open beside it. `passageAxis` wants them opposite.
       */
      if (!passageAxis(g, x, y)) continue;
      thresholds.push(i);
    }
  }
  if (!thresholds.length) return;

  /**
   * A TIMED GATE IS ASSUMED SHUT NOW, not open — and that is a load-bearing flip.
   *
   * It assumed open when a plate bought a countdown: press it, walk through, the
   * gate was a toll and not a wall. A plate now HOLDS its gate up only while
   * something stands on it, so the thing that opens the gate is the thing that
   * cannot go through it. Nobody can pass one alone.
   *
   * Which means a gate must never be on the way to anything the run needs. Checking
   * finishability with them open would let generation put one across the only route
   * to the stairs and call the floor sound; checking with them shut is the honest
   * question — is this floor completable by somebody who never solves a single gate?
   * Everything behind one is therefore optional by construction, which is also what
   * makes it worth putting something there.
   */
  const gatesWere = g.doors.map((d) => g.doorOpen[d.i]);
  for (const d of g.doors) g.setDoorLift(d.i, 0);
  const restore = () => { g.doors.forEach((d, k) => { g.setDoorLift(d.i, gatesWere[k]); }); };

  for (const i of rng.shuffle(thresholds).slice(0, 8)) {
    const was = g.tiles[i];
    g.tiles[i] = Tile.Door;
    g.setDoorLift(i, 0);
    const shut = reachable(g);

    // Does it gate the boss at all? If any boss tile is still reachable with the door
    // shut, the room has another way in and this door is decoration.
    let leaks = false;
    for (const j of own) if (shut[j]) { leaks = true; break; }
    if (leaks) { g.tiles[i] = was; g.setDoorLift(i, 0); continue; }

    /**
     * Levers go in ROOMS, one per room, as far from each other as the floor allows —
     * spread by taking the rooms that are furthest from the boss first, so filling the
     * sockets means crossing the map rather than sweeping one wing of it.
     *
     * EXCEPT ON A SHALLOW FLOOR, where it is the exact opposite: one lever, as close to
     * the door as the room allows, and it must SEE the door. See `shallowGate`.
     */
    const dx0 = i % g.w, dy0 = (i / g.w) | 0;
    const levers: number[] = [];

    if (shallowGate(depth)) {
      /**
       * ONE LEVER, IN THE SPACE THE DOOR LOOKS OUT ON.
       *
       * Not "in a room", which is what the deep rule asks and what this asked first:
       * on a third of floors the space in front of the boss room is a corridor or a
       * junction rather than anything the generator calls a room, so requiring one
       * threw away nine tenths of the seeds and left a boss room with no gate on it —
       * which is the exact failure this pass now re-rolls to avoid.
       *
       * Any tile that can SEE the door will do. That is the whole requirement, and
       * whatever shape holds it is the antechamber: what matters is that the player
       * standing at the gate can see the handle, and standing at the handle can watch
       * the gate come up.
       */
      const spots: { j: number; d: number }[] = [];
      const startI = g.idx(g.start.x, g.start.y);
      for (let j = 0; j < shut.length; j++) {
        if (!shut[j] || j === startI || g.surface[j] !== Surface.Plain) continue;
        if (g.hazards.some((h) => g.idx(h.x, h.y) === j)) continue;
        if (g.doors.some((d) => d.i === j || d.plate === j)) continue;
        const lx = j % g.w, ly = (j / g.w) | 0;
        const d = Math.abs(lx - dx0) + Math.abs(ly - dy0);
        // Two clear of the door, because a lever hung on the portcullis is the same
        // object twice. And no further than the room in front can be — a sight line
        // down thirty tiles of corridor is technically visible and teaches nothing.
        if (d < 2 || d > SHALLOW_SIGHT) continue;
        if (!sightLine(g, lx, ly, dx0, dy0)) continue;
        // A lever is furniture and furniture in a passage is a wall — see `walkAround`.
        if (!walkAround(g, j)) continue;
        spots.push({ j, d });
      }
      if (!spots.length) { g.tiles[i] = was; g.setDoorLift(i, 0); continue; }
      // The furthest tile that can still see the door. Standing back is what puts the
      // handle and the gate in the same view; standing on top of the gate does not.
      // `plugs` is the expensive half and is asked in that order, so it usually runs once.
      spots.sort((a, b) => b.d - a.d);
      const pick = spots.find((s) => !plugs(g, s.j, shut));
      if (!pick) { g.tiles[i] = was; g.setDoorLift(i, 0); continue; }
      levers.push(pick.j);
    } else {
      const fromBoss = g.flood(boss.cx, boss.cy, g.w * g.h);
      const candidates = g.rooms
        .filter((r) => r.kind !== 'boss')
        .map((r) => {
          const tiles = r.tiles
            .map(([x, y]) => g.idx(x, y))
            .filter((j) => shut[j] && g.surface[j] === Surface.Plain
              && j !== g.idx(r.cx, r.cy) && j !== g.idx(g.start.x, g.start.y)
              && !g.hazards.some((h) => g.idx(h.x, h.y) === j)
              // A room has narrow necks too — the tile in its doorway is a room tile.
              && walkAround(g, j));
          return { r, tiles, far: fromBoss[g.idx(r.cx, r.cy)] };
        })
        .filter((c) => c.tiles.length > 0)
        .sort((a, b) => b.far - a.far);

      const wanted = depth >= 8 ? 3 : 2;
      if (candidates.length < wanted) { g.tiles[i] = was; g.setDoorLift(i, 0); continue; }
      /**
       * Shuffled and then confirmed, rather than picked and hoped: `plugs` is a flood
       * per candidate, and taking the first that passes usually costs exactly one.
       *
       * EACH ONE IS ASKED WITH THE PREVIOUS ONES ALREADY STANDING. Two levers can shut a
       * region between them that neither closes alone — the measured case was eleven
       * tiles behind a pair on a depth-six floor — so a lever that has been chosen is
       * held as wall while the next is judged, and the baseline is re-flooded with it in
       * place. Testing them independently is testing a floor that never exists.
       */
      let short = false;
      let base = shut;
      const held: Tile[] = [];
      for (const c of candidates.slice(0, wanted)) {
        const j = rng.shuffle([...c.tiles]).find((k) => walkAround(g, k) && !plugs(g, k, base));
        if (j === undefined) { short = true; break; }
        levers.push(j);
        held.push(g.tiles[j]);
        g.tiles[j] = Tile.Wall;
        base = reachable(g);
      }
      // The wall was scaffolding for the test; the lever goes on as a SURFACE below.
      levers.forEach((j, k) => { g.tiles[j] = held[k]; });
      if (short) { g.tiles[i] = was; g.setDoorLift(i, 0); continue; }
    }
    for (const j of levers) g.surface[j] = Surface.Lever;
    g.bossDoor = { i, levers, pulled: new Set() };
    restore();
    return;
  }
  restore();
}

/**
 * The blocks: stone you cannot break, cannot climb and can only shove.
 *
 * Two placements, and they are different objects wearing the same tile. One is the
 * ANSWER TO A PLATE — a block lined up with a gate's plate, two or three tiles out,
 * with a clear run between them and somewhere to stand behind it. That turns the
 * plate from a problem with no solution into a problem with one: the thing that holds
 * the gate up cannot be you, so it has to be this. Without it a lone player never
 * passes a timed gate at all, which is why `placeGate` has to keep everything behind
 * one optional.
 *
 * The rest are LOOSE, in rooms, and they are there for the other two jobs a block
 * does for free by being a tile: cover that breaks line of sight, and a firebreak.
 * They go where a body has room — three open neighbours — so one never starts life
 * standing in a doorway.
 *
 * NOTHING IS PLACED THAT COSTS THE FLOOR A ROUTE. Every candidate is written in,
 * flooded, and taken back out again if a single tile that was reachable stopped
 * being reachable. It is the same check `lock` makes about its door and it is here
 * for the same reason: a block is the one piece of furniture that can wall a floor
 * off, and the push has its own half of this rule (see `Combat.pushBlock`).
 */
function strew(g: Grid, rng: Rng, depth: number): void {
  if (depth < 3) return;

  const sacred = new Set<number>([g.idx(g.start.x, g.start.y)]);
  if (g.stairs) sacred.add(g.idx(g.stairs.x, g.stairs.y));
  // Room centres carry the altar, the boss and the stairs — `populate` puts them
  // there without asking whether the tile is free.
  for (const r of g.rooms) sacred.add(g.idx(r.cx, r.cy));
  for (const h of g.hazards) sacred.add(g.idx(h.x, h.y));
  for (const d of g.doors) { sacred.add(d.i); sacred.add(d.plate); }
  if (g.bossDoor) {
    sacred.add(g.bossDoor.i);
    for (const j of g.bossDoor.levers) sacred.add(j);
  }
  /**
   * The captive cage's levers are as load-bearing as the boss door's, and for a harder
   * reason: they are the ONLY way that room opens. A block laid on one buries the handle,
   * and a block laid beside one can wall it into a slot — which is what `leverTiles` below
   * is holding as solid while it tests, so both banks belong in it.
   */
  if (g.captiveGate) {
    for (const d of g.captiveGate.doors) sacred.add(d);
    for (const j of g.captiveGate.levers) sacred.add(j);
  }

  /** A tile a block may be laid on: ordinary, empty, standing floor. */
  const bare = (i: number): boolean => {
    const x = i % g.w, y = (i / g.w) | 0;
    return g.at(x, y) === Tile.Floor && g.surface[i] === Surface.Plain && !sacred.has(i);
  };

  /**
   * Write one in, and take it straight back out if it cost anybody a route.
   *
   * WITH THE LEVERS STANDING, because they are solid and this pass runs after `lock`.
   * A block laid beside a lever narrows the tile the lever is on, and `lock` had already
   * checked that tile against the floor as it was a moment earlier — so the two passes
   * each made a sound decision and the pair of them walled the handle in. The levers are
   * held as wall for the duration of the test, which is what they will be to the player.
   */
  const leverTiles = [
    ...(g.bossDoor ? g.bossDoor.levers : []),
    ...(g.captiveGate ? g.captiveGate.levers : []),
  ];
  const withLevers = <T>(f: () => T): T => {
    const was = leverTiles.map((j) => g.tiles[j]);
    for (const j of leverTiles) g.tiles[j] = Tile.Wall;
    const out = f();
    leverTiles.forEach((j, k) => { g.tiles[j] = was[k]; });
    return out;
  };

  const put = (i: number): boolean => {
    const before = withLevers(() => reachable(g));
    if (!before[i]) return false;
    g.tiles[i] = Tile.Block;
    const after = withLevers(() => reachable(g));
    for (let j = 0; j < before.length; j++) {
      if (before[j] && !after[j] && j !== i) { g.tiles[i] = Tile.Floor; return false; }
    }
    /**
     * AND IT MUST NOT NARROW A LEVER, which connectivity alone does not catch: where the
     * floor loops, walling a handle into a two-neighbour slot strands nobody and still
     * leaves the player walking the long way round a switch. `lock` asked `walkAround`
     * of these tiles against the floor as it stood a pass ago; a block dropped next to
     * one is what changes the answer afterwards.
     */
    for (const j of leverTiles) {
      if (!walkAround(g, j)) { g.tiles[i] = Tile.Floor; return false; }
    }
    return true;
  };

  for (const d of g.doors) {
    const px = d.plate % g.w, py = (d.plate / g.w) | 0;
    const level = g.heightAt(px, py);
    const spots: number[] = [];
    for (const [dx, dy] of DIR_VEC) {
      for (let k = 2; k <= 3; k++) {
        const bx = px + dx * k, by = py + dy * k;
        // Somewhere to stand and push FROM, one further out along the same line.
        if (!g.walkable(bx + dx, by + dy)) continue;
        if (!g.inside(bx, by) || !bare(g.idx(bx, by))) continue;
        // The whole run, block to plate, has to be clear and dead level: a shove
        // stops at the first thing in the way and will not go uphill.
        let clear = g.heightAt(bx, by) === level && g.heightAt(bx + dx, by + dy) === level;
        for (let s = 1; s < k && clear; s++) {
          const sx = px + dx * s, sy = py + dy * s;
          clear = g.walkable(sx, sy) && g.heightAt(sx, sy) === level
            && g.surface[g.idx(sx, sy)] === Surface.Plain;
        }
        if (clear) spots.push(g.idx(bx, by));
      }
    }
    for (const i of rng.shuffle(spots)) if (put(i)) break;
  }

  const loose: number[] = [];
  for (const r of g.rooms) {
    if (r.kind === 'boss') continue;
    for (const [x, y] of r.tiles) {
      const i = g.idx(x, y);
      if (!bare(i)) continue;
      let open = 0;
      for (const [dx, dy] of DIR_VEC) if (g.walkable(x + dx, y + dy)) open++;
      if (open >= 3) loose.push(i);
    }
  }
  let wanted = 1 + (depth >= 7 ? 1 : 0) + (rng.chance(0.5) ? 1 : 0);
  for (const i of rng.shuffle(loose)) {
    if (wanted <= 0) break;
    if (put(i)) wanted--;
  }
}

/** Which walkable tiles the start can reach right now, doors as they currently stand. */
function reachable(g: Grid): Uint8Array {
  const seen = new Uint8Array(g.w * g.h);
  const start = g.idx(g.start.x, g.start.y);
  if (!g.walkable(g.start.x, g.start.y)) return seen;
  const q = [start];
  seen[start] = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    const x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of DIR_VEC) {
      const nx = x + dx, ny = y + dy;
      if (!g.walkable(nx, ny) || !g.canClimb(x, y, nx, ny)) continue;
      const ni = g.idx(nx, ny);
      if (seen[ni]) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  return seen;
}

/**
 * Can you still get everywhere from the start, AND back from everywhere?
 *
 * `stitch` answers the first question for a flat floor and is not enough once tiles
 * have elevation: a drop is passable one way, so the floor is a DIRECTED graph and
 * "connected" splits into two questions that can have different answers. The second
 * one is the one that matters most — a tile you can walk into and not walk out of is
 * a run ended by the scenery, which is the single worst thing this phase could ship.
 */
function traversable(g: Grid): boolean {
  const N = g.w * g.h;
  const reach = (forward: boolean): Uint8Array => {
    const seen = new Uint8Array(N);
    const start = g.idx(g.start.x, g.start.y);
    const q = [start];
    seen[start] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi];
      const x = i % g.w, y = (i / g.w) | 0;
      for (const [dx, dy] of DIR_VEC) {
        const nx = x + dx, ny = y + dy;
        if (!g.walkable(nx, ny)) continue;
        // forward: can I step there? backward: could it step to me?
        if (!(forward ? g.canClimb(x, y, nx, ny) : g.canClimb(nx, ny, x, y))) continue;
        const ni = g.idx(nx, ny);
        if (seen[ni]) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    return seen;
  };
  const out = reach(true), back = reach(false);
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      if (!g.walkable(x, y)) continue;
      const i = g.idx(x, y);
      if (!out[i] || !back[i]) return false;
    }
  }
  return true;
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
        // or see past — a torch bolted to a block would travel with the block
        if (!g.masonry(x + dx, y + dy)) continue;
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
        if (!g.masonry(x + dx, y + dy)) continue;
        g.lights.push({ x, y, h: WALL_H * 0.49, reach: 3.8, strength: 0.7, face: f });
        break;
      }
    }
  }
}
