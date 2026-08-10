/**
 * The layout generators — fourteen ways to build a floor, one per floor.
 *
 * Every floor used to be the same algorithm: place rectangles, join them with
 * corridors. Ten floors of that is one floor ten times in different colours, and a
 * palette is not a layout. A ring means you can always go round; a gauntlet means you
 * cannot. A cathedral means everything sees you the moment you step in; a labyrinth
 * means nothing does until it is adjacent. That difference is the phase.
 *
 * THE TEST EVERY GENERATOR HAS TO PASS: it changes how you MOVE. If the only
 * difference is what the walls look like, it is a theme and belongs in `theme.ts`.
 * Each one carries its `brief` for exactly that reason — a generator whose brief is
 * about atmosphere rather than about movement has failed its own entry exam.
 *
 * A generator only CARVES and declares rooms. Roles (which room is the boss's, where
 * the altar goes), connectivity repair, lights and the light bake are one shared pass
 * in `generate.ts`, because a floor that needs its own populate or its own lighting is
 * a floor the rest of the game does not understand.
 *
 * SIX TO TEN ROOMS, whatever the shape. Rooms are the unit of population — `populate`
 * walks `grid.rooms` and gives each one props and bodies — so a generator that
 * declares twenty rooms has quietly tripled the floor's enemy count and rebalanced the
 * game. A block of a grid city that nobody can enter is solid stone, not a room.
 */
import { Rng } from '../core/rng';
import { Grid, Tile, DIR_VEC, type Room } from './grid';

export type LayoutId =
  | 'rooms' | 'cave' | 'ring' | 'spiral' | 'hub' | 'gridcity' | 'cathedral'
  | 'gauntlet' | 'labyrinth' | 'warren' | 'islands' | 'chasm' | 'nested';

export interface Layout {
  id: LayoutId;
  /** What it does to the way you move. If you cannot write this line, it is a theme. */
  brief: string;
  /** Grid edge length, when the shape needs a particular one (a maze wants odd). */
  size?(base: number): number;
  /** Carve tiles and declare rooms. Everything else is the shared pass. */
  carve(g: Grid, rng: Rng, depth: number): void;
  /**
   * Which room the boss owns, when the shape has an actual destination.
   *
   * The open question was whether the boss is a generator's problem or a shared pass,
   * and the answer is BOTH, in that order: the shared pass puts it at the far end of
   * the floor by path distance, which is right for every layout that is a spread of
   * rooms, and a layout whose shape names its own end — the eye of a spiral, the apse
   * of a cathedral, the last box of a nest — says so here and is obeyed. A hub's rim
   * says nothing, because a hub has six equally-far ends and picking one is the
   * shared pass's job.
   */
  boss?(g: Grid): Room | null;
}

// ---------------------------------------------------------------------------
// carving vocabulary
// ---------------------------------------------------------------------------

/**
 * Set one tile, never the border.
 *
 * The outermost ring stays wall on every floor: the renderer builds a wall quad per
 * solid neighbour and the flood tests bound on `inside`, so a floor that runs off the
 * edge of the map is a floor with a hole in the world.
 */
function put(g: Grid, x: number, y: number, t: Tile): void {
  if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) return;
  g.tiles[g.idx(x, y)] = t;
}

function dig(g: Grid, x: number, y: number): void { put(g, x, y, Tile.Floor); }
function cut(g: Grid, x: number, y: number): void { put(g, x, y, Tile.Gap); }

/** Carve a solid rectangle and hand back the tiles, for declaring it a room. */
function digRect(g: Grid, x: number, y: number, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      dig(g, i, j);
      if (g.walkable(i, j)) out.push([i, j]);
    }
  }
  return out;
}

/** An L-shaped corridor, one tile wide, in a random order of legs. */
function corridor(g: Grid, rng: Rng, ax: number, ay: number, bx: number, by: number): void {
  let x = ax, y = ay;
  const leg = (tx: number, ty: number) => {
    while (x !== tx) { x += Math.sign(tx - x); dig(g, x, y); }
    while (y !== ty) { y += Math.sign(ty - y); dig(g, x, y); }
  };
  if (rng.chance(0.5)) { leg(bx, y); leg(bx, by); } else { leg(x, by); leg(bx, by); }
}

/** Rectangles overlap test with a 1-tile margin, so two rooms never share a wall. */
function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x - 1 < b.x + b.w + 1 && a.x + a.w + 1 > b.x - 1 &&
         a.y - 1 < b.y + b.h + 1 && a.y + a.h + 1 > b.y - 1;
}

/**
 * Declare a set of carved tiles a ROOM.
 *
 * A room is not a rectangle — a cave has none and a warren's are barely bigger than
 * the doorway — it is the unit `populate` and the minimap think in. Two things have to
 * be true of every one of them however it was carved, and both used to be true only by
 * accident of everything being a rectangle:
 *
 *  - `cx, cy` IS A WALKABLE TILE OF THE ROOM. `populate` puts the altar and the
 *    descent on it without asking, so a centroid that lands in stone is an altar
 *    inside a wall. The tile nearest the centroid with the most open neighbours wins.
 *  - NO TILE BELONGS TO TWO ROOMS. `roomOf` holds one id, and the second room to claim
 *    a tile would silently steal it from the first.
 */
function addRoom(g: Grid, tiles: [number, number][], min = 4): Room | null {
  if (g.rooms.length >= 60) return null;
  const own = tiles.filter(([x, y]) => g.walkable(x, y) && g.roomOf[g.idx(x, y)] === 255);
  if (own.length < min) return null;

  const r: Room = {
    x: 0, y: 0, w: 0, h: 0,
    kind: 'normal', tiles: own, cx: own[0][0], cy: own[0][1],
    seen: false, cleared: false, id: g.rooms.length,
  };
  for (const [x, y] of own) g.roomOf[g.idx(x, y)] = r.id;
  g.rooms.push(r);
  recentre(g, r);
  return r;
}

/**
 * Recompute a room's bounds and its centre from whatever tiles it still has.
 *
 * Called when the room is declared and AGAIN after every carve is finished, because a
 * later pass can take tiles away from an earlier one: the chasm cuts its crack through
 * a floor that already has rooms on it, and a crack through a room's middle used to
 * leave the altar — and sometimes the player's start tile — inside the void. A room's
 * centre is a promise to `populate`, and a promise made before the last cut is not one.
 */
export function recentre(g: Grid, r: Room): void {
  let x0 = g.w, y0 = g.h, x1 = 0, y1 = 0, sx = 0, sy = 0;
  for (const [x, y] of r.tiles) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    sx += x; sy += y;
  }
  r.x = x0; r.y = y0; r.w = x1 - x0 + 1; r.h = y1 - y0 + 1;
  const mx = sx / r.tiles.length, my = sy / r.tiles.length;

  let best = r.tiles[0], bestScore = Infinity;
  for (const [x, y] of r.tiles) {
    let open = 0;
    for (const [dx, dy] of DIR_VEC) if (g.walkable(x + dx, y + dy)) open++;
    // distance to the centroid, with an elbow-room bonus that outweighs a tile or two
    const score = Math.abs(x - mx) + Math.abs(y - my) - open * 1.5;
    if (score < bestScore) { bestScore = score; best = [x, y]; }
  }
  r.cx = best[0]; r.cy = best[1];
}

/**
 * The wide places in an irregular carve, as rooms.
 *
 * A cave has no rectangles, but it does have somewhere you can stand and turn around
 * and somewhere you cannot, and that is the distinction a room was always drawing.
 * A tile whose whole 3x3 is open is "hall"; clusters of hall, dilated by one so the
 * room includes its own wall, are the chambers. Anything left over is tunnel, which is
 * exactly what a corridor has always been: walkable, `roomOf` 255, nothing lives there.
 */
function pockets(g: Grid): [number, number][][] {
  const hall = new Uint8Array(g.w * g.h);
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      let all = true;
      for (let j = -1; j <= 1 && all; j++) {
        for (let i = -1; i <= 1 && all; i++) if (!g.walkable(x + i, y + j)) all = false;
      }
      if (all) hall[g.idx(x, y)] = 1;
    }
  }

  const seen = new Uint8Array(g.w * g.h);
  const out: [number, number][][] = [];
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const i0 = g.idx(x, y);
      if (!hall[i0] || seen[i0]) continue;
      const q = [i0];
      seen[i0] = 1;
      const group: number[] = [];
      for (let qi = 0; qi < q.length; qi++) {
        const i = q[qi];
        group.push(i);
        const cx = i % g.w, cy = (i / g.w) | 0;
        for (const [dx, dy] of DIR_VEC) {
          const ni = g.idx(cx + dx, cy + dy);
          if (!g.inside(cx + dx, cy + dy) || seen[ni] || !hall[ni]) continue;
          seen[ni] = 1;
          q.push(ni);
        }
      }
      // dilate by one, so the chamber owns the wall it is bounded by
      const tiles = new Set<number>(group);
      for (const i of group) {
        const cx = i % g.w, cy = (i / g.w) | 0;
        for (const [dx, dy] of DIR_VEC) {
          if (g.walkable(cx + dx, cy + dy)) tiles.add(g.idx(cx + dx, cy + dy));
        }
      }
      out.push([...tiles].map((i) => [i % g.w, (i / g.w) | 0] as [number, number]));
    }
  }
  // biggest first, so a room budget spends itself on the chambers that read as rooms
  return out.sort((a, b) => b.length - a.length);
}

// ---------------------------------------------------------------------------
// the generators
// ---------------------------------------------------------------------------

/**
 * ROOMS AND CORRIDORS. The baseline, and floor 1's, because it teaches the grammar
 * every other floor is a deviation from: a room is where things happen, a corridor is
 * how you get between them, and there is usually more than one way round.
 */
const rooms: Layout = {
  id: 'rooms',
  brief: 'Chambers joined by corridors, with a loop or two. The grammar.',
  carve(g, rng, depth) {
    /**
     * SEVEN, flat, where this used to ask for more as the floors got deeper.
     *
     * Depth already grows the grid, and a bigger grid fits more of the rectangles it
     * tries — so asking for more on top of that was compounding, and floor 9 came out
     * with nine rooms and twenty bodies against floor 10's seven and fourteen. Rooms
     * are the unit `populate` counts in, and the difficulty curve is supposed to be a
     * curve, not a spike two floors from the end. The variance is still there; it
     * comes from how many of the seven find a spot.
     */
    const wanted = 7;
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    let guard = 0;
    while (rects.length < wanted && guard++ < 700) {
      // one room wants to be big — it is the fight the floor is built around
      const big = rects.length === 1;
      const w = big ? rng.int(7, 9) : rng.int(4, 7);
      const h = big ? rng.int(7, 9) : rng.int(4, 7);
      const cand = { x: rng.int(1, g.w - w - 2), y: rng.int(1, g.h - h - 2), w, h };
      if (rects.some((r) => overlaps(cand, r))) continue;
      rects.push(cand);
    }

    const made: Room[] = [];
    for (const r of rects) {
      const room = addRoom(g, digRect(g, r.x, r.y, r.w, r.h));
      if (room) made.push(room);
    }
    // a spanning chain first, so the floor is always walkable end to end...
    for (let i = 1; i < made.length; i++) {
      corridor(g, rng, made[i - 1].cx, made[i - 1].cy, made[i].cx, made[i].cy);
    }
    // ...then loops, because retreating is a real tactic once things chase you
    for (let i = 0; i < 1 + Math.floor(depth / 2) && made.length > 1; i++) {
      const a = rng.pick(made), b = rng.pick(made);
      if (a !== b) corridor(g, rng, a.cx, a.cy, b.cx, b.cy);
    }
  },
};

/**
 * CAVE. Nothing is straight and nothing is square, so the sightline you have been
 * relying on since floor 1 — look down the corridor, count what is in it — stops
 * working. You find things at four tiles, not at twelve.
 */
const cave: Layout = {
  id: 'cave',
  brief: 'No straight line anywhere. You meet things at four tiles, not twelve.',
  carve(g, rng) {
    let solid = new Uint8Array(g.w * g.h).fill(1);
    for (let y = 2; y < g.h - 2; y++) {
      // Tight. A looser fill smooths into one enormous open blob, which the pocket
      // detector correctly reads as ONE room — a cave has to be mostly tunnel for its
      // wide places to be places at all.
      for (let x = 2; x < g.w - 2; x++) solid[g.idx(x, y)] = rng.chance(0.52) ? 1 : 0;
    }

    /**
     * SIX CHAMBERS, PLACED, and the automaton only decides their edges and what joins
     * them. Punched in before the smoothing, because a disc this size survives it —
     * the middle is all open — and the smoothing still eats the rim, so a chamber
     * comes out cave-shaped rather than as a circle somebody stamped.
     *
     * They are placed rather than found because finding them does not work: left to
     * itself the automaton produces one enormous connected open space about half the
     * time, and the pocket detector is right to call that ONE room. A cave floor of
     * four hundred tiles with three rooms on it is a walk with a creature at the end.
     */
    const seats: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const cx = Math.round((g.w / 3) * (0.5 + (i % 3)) + rng.range(-2, 2));
      const cy = Math.round((g.h / 2) * (0.5 + ((i / 3) | 0)) + rng.range(-2, 2));
      seats.push([cx, cy]);
      for (let y = cy - 3; y <= cy + 3; y++) {
        for (let x = cx - 3; x <= cx + 3; x++) {
          if (x < 2 || y < 2 || x >= g.w - 2 || y >= g.h - 2) continue;
          if ((x - cx) ** 2 + (y - cy) ** 2 <= 4.5) solid[g.idx(x, y)] = 0;
        }
      }
    }
    // Four rounds of majority smoothing. The border counts as solid, which is what
    // pulls the cave in off the edge of the map without a separate mask.
    for (let pass = 0; pass < 4; pass++) {
      const next = solid.slice();
      for (let y = 1; y < g.h - 1; y++) {
        for (let x = 1; x < g.w - 1; x++) {
          let n = 0;
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              if (i === 0 && j === 0) continue;
              const px = x + i, py = y + j;
              if (px < 1 || py < 1 || px >= g.w - 1 || py >= g.h - 1) { n++; continue; }
              n += solid[g.idx(px, py)];
            }
          }
          next[g.idx(x, y)] = n >= 5 ? 1 : n <= 3 ? 0 : solid[g.idx(x, y)];
        }
      }
      solid = next;
    }
    for (let y = 1; y < g.h - 1; y++) {
      for (let x = 1; x < g.w - 1; x++) if (!solid[g.idx(x, y)]) dig(g, x, y);
    }
    // Each seat claims what the smoothing left of its chamber. `addRoom` only takes
    // unclaimed tiles, so two chambers the automaton joined into one hall still come
    // out as two rooms with a wide way between them — which is what they look like.
    for (const [cx, cy] of seats) {
      const tiles: [number, number][] = [];
      for (let y = cy - 3; y <= cy + 3; y++) {
        for (let x = cx - 3; x <= cx + 3; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= 9 && g.walkable(x, y)) tiles.push([x, y]);
        }
      }
      addRoom(g, tiles, 5);
    }
    // and anything else wide enough to stand and fight in, if the roll was generous
    if (g.rooms.length < 5) for (const p of pockets(g)) addRoom(g, p, 6);
    // The stitch pass joins whatever the automaton left in pieces.
  },
};

/**
 * RING. A corridor all the way round a solid core, with the chambers bulging off it.
 * You can ALWAYS go the other way — which sounds like a kindness until a floor is
 * built on it and every fight has something coming round the far side.
 */
const ring: Layout = {
  id: 'ring',
  brief: 'One loop, no dead ends. Whatever is behind you can come round the front.',
  carve(g, rng) {
    const m = 4;
    const x0 = m, y0 = m, x1 = g.w - 1 - m, y1 = g.h - 1 - m;
    const band: [number, number][] = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const edge = x <= x0 + 1 || x >= x1 - 1 || y <= y0 + 1 || y >= y1 - 1;
        if (!edge) continue;
        dig(g, x, y);
        band.push([x, y]);
      }
    }

    // Chambers bulge off the band, alternately outward into the margin and inward
    // into the core, so the ring reads as a road with places on both sides of it.
    const stops: [number, number][] = [
      [(x0 + x1) >> 1, y0 + 1], [(x0 + x1) >> 1, y1 - 1],
      [x0 + 1, (y0 + y1) >> 1], [x1 - 1, (y0 + y1) >> 1],
      [x0 + 1, y0 + 1], [x1 - 1, y1 - 1],
    ];
    for (let i = 0; i < stops.length; i++) {
      const [sx, sy] = stops[i];
      const out = i % 2 === 0;
      const dx = sx <= x0 + 1 ? -1 : sx >= x1 - 1 ? 1 : 0;
      const dy = sy <= y0 + 1 ? -1 : sy >= y1 - 1 ? 1 : 0;
      const push = out ? 2 : -3;
      const cx = sx + dx * push, cy = sy + dy * push;
      const w = rng.int(4, 5), h = rng.int(4, 5);
      const tiles = digRect(g, cx - (w >> 1), cy - (h >> 1), w, h);
      corridor(g, rng, sx, sy, cx, cy);
      addRoom(g, tiles);
    }
  },
};

/**
 * SPIRAL. One corridor, wound inward, with no shortcut across it. There is exactly
 * one route and you are always either going in or coming out — which turns the walk
 * itself into the pressure, because everything you left alive is between you and the
 * door.
 */
const spiral: Layout = {
  id: 'spiral',
  brief: 'One route in, the same route out, and it is long.',
  // A spiral fills its grid with corridor, where rooms-and-corridors leaves three
  // quarters of it solid. Same edge length would be three times the floor to walk.
  size(base) { return Math.min(base, 27); },
  carve(g, rng) {
    let l = 1, t = 1, r = g.w - 2, b = g.h - 2;
    let x = l, y = t;
    const path: [number, number][] = [];
    dig(g, x, y);
    path.push([x, y]);
    const walk = (tx: number, ty: number) => {
      let guard = 0;
      while ((x !== tx || y !== ty) && guard++ < 400) {
        x += Math.sign(tx - x); y += Math.sign(ty - y);
        dig(g, x, y);
        path.push([x, y]);
      }
    };
    let guard = 0;
    while (r - l >= 5 && b - t >= 5 && guard++ < 20) {
      walk(r, t); walk(r, b); walk(l, b);
      t += 3; walk(l, t);          // up the left side, one lap in
      l += 3; walk(l, t);          // and step across into the new lap
      r -= 3; b -= 3;
    }

    // The eye. The corridor's last tile is inside it, so it needs no door.
    addRoom(g, digRect(g, l, t, Math.max(3, r - l + 1), Math.max(3, b - t + 1)));

    // Widenings along the way — a spiral of pure corridor has nowhere for a fight to
    // happen, and a fight in a one-wide passage is a queue.
    for (let i = 1; i <= 5; i++) {
      const [px, py] = path[Math.floor((path.length * i) / 6)];
      const w = rng.int(3, 4), h = rng.int(3, 4);
      addRoom(g, digRect(g, px - (w >> 1), py - (h >> 1), w, h));
    }
  },
  boss(g) {
    // The eye is the first room declared and the deepest thing on the floor.
    return g.rooms[0] ?? null;
  },
};

/**
 * HUB AND SPOKES. One chamber in the middle and everything else on the end of a
 * dead-end arm. Every trip between two rooms goes back through the middle, so the hub
 * is a place you cross six times and it is never empty by the third.
 */
const hub: Layout = {
  id: 'hub',
  brief: 'Every route crosses the same room. You will be back.',
  carve(g, rng) {
    const cx = g.w >> 1, cy = g.h >> 1;
    addRoom(g, digRect(g, cx - 3, cy - 3, 7, 7));

    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const rad = Math.min(g.w, g.h) * 0.36;
      const rx = Math.round(cx + Math.cos(a) * rad);
      const ry = Math.round(cy + Math.sin(a) * rad);
      const w = rng.int(4, 6), h = rng.int(4, 6);
      const tiles = digRect(g, rx - (w >> 1), ry - (h >> 1), w, h);
      corridor(g, rng, cx, cy, rx, ry);
      addRoom(g, tiles);
    }
  },
};

/**
 * GRID CITY. Streets on a lattice, buildings between them, and only some of the
 * buildings open. Every corner is a right angle and there is always another way round
 * the block — so nothing ever traps you, and nothing you are chasing is ever cornered.
 */
const gridcity: Layout = {
  id: 'gridcity',
  brief: 'Streets on a lattice. Nothing corners you, and you corner nothing.',
  size(base) { return Math.round((Math.min(base, 26) - 1) / 6) * 6 + 1; },
  carve(g, rng) {
    const step = 6;
    for (let s = 1; s <= g.w - 2; s += step) for (let y = 1; y <= g.h - 2; y++) dig(g, s, y);
    for (let s = 1; s <= g.h - 2; s += step) for (let x = 1; x <= g.w - 2; x++) dig(g, x, s);

    // Blocks, and only a few of them open. A building nobody can enter is stone, and
    // a city where every block is a room would put twenty rooms' worth of bodies on
    // one floor.
    const blocks: [number, number][] = [];
    for (let by = 1; by + step <= g.h - 2; by += step) {
      for (let bx = 1; bx + step <= g.w - 2; bx += step) blocks.push([bx, by]);
    }
    for (const [bx, by] of rng.shuffle(blocks).slice(0, 7)) {
      const tiles = digRect(g, bx + 2, by + 2, 3, 3);
      // one door onto one street — a shop has a front
      const f = rng.int(0, 3);
      const [dx, dy] = DIR_VEC[f];
      dig(g, bx + 3 + dx * 2, by + 3 + dy * 2);
      addRoom(g, tiles);
    }
  },
};

/**
 * CATHEDRAL. One enormous hall you enter at one end and can see the whole of. Nothing
 * is hidden and nothing is safe: every body in the nave has line of sight on you from
 * the door, which is the exact opposite of the labyrinth and belongs nowhere near it
 * in the floor order.
 */
const cathedral: Layout = {
  id: 'cathedral',
  brief: 'One hall. Everything in it can see you from the door, and does.',
  size(base) { return Math.min(base, 28); },
  carve(g, rng) {
    const m = 3;
    const nave = digRect(g, m, m + 3, g.w - m * 2, g.h - m * 2 - 6);
    // two rows of pillars down the length — they break the volume of a spell and
    // nothing else, which is what a pillar is for
    for (let y = m + 5; y < g.h - m - 5; y += 3) {
      for (const px of [m + 3, g.w - m - 4]) g.tiles[g.idx(px, y)] = Tile.Wall;
    }
    addRoom(g, nave.filter(([x, y]) => g.walkable(x, y)));

    // the narthex you come in by, and the apse the floor is pointed at
    const narthex = digRect(g, (g.w >> 1) - 3, m, 6, 4);
    corridor(g, rng, g.w >> 1, m + 2, g.w >> 1, m + 4);
    addRoom(g, narthex);

    const apse = digRect(g, (g.w >> 1) - 3, g.h - m - 5, 6, 4);
    corridor(g, rng, g.w >> 1, g.h - m - 6, g.w >> 1, g.h - m - 4);
    addRoom(g, apse);

    // side chapels, off the nave through a single door each
    for (let i = 0; i < 3; i++) {
      const side = i % 2 === 0;
      const y = m + 6 + i * Math.floor((g.h - m * 2 - 12) / 3);
      const w = 4, h = 4;
      const x = side ? m - 3 : g.w - m - 1;
      const tiles = digRect(g, x, y, w, h);
      corridor(g, rng, side ? x + w : x - 1, y + 1, side ? m + 1 : g.w - m - 2, y + 1);
      addRoom(g, tiles);
    }
  },
  boss(g) {
    // the apse: third room declared, and the one the whole nave points at
    return g.rooms[2] ?? null;
  },
};

/**
 * GAUNTLET. A chain of chambers, each joined only to the next. There is no way round
 * anything — the loop the ring is built on is deleted, and every retreat is back
 * through a room you have already fought in and every advance is a door you cannot
 * see past.
 */
const gauntlet: Layout = {
  id: 'gauntlet',
  brief: 'A chain, no loops. Forward is the only direction that is not backward.',
  size(base) { return Math.min(base, 26); },
  carve(g, rng) {
    const cols = 3, rowH = Math.floor((g.h - 2) / 3);
    const cells: [number, number][] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < cols; c++) {
        // boustrophedon, so consecutive chambers are always adjacent
        const cc = r % 2 === 0 ? c : cols - 1 - c;
        cells.push([1 + cc * Math.floor((g.w - 2) / cols), 1 + r * rowH]);
      }
    }
    let prev: Room | null = null;
    // Seven of the nine. The chain is in walking order, so the tail is the part to
    // drop — and nine chambers is nine rooms' worth of bodies, which is a different
    // floor from the one the number was chosen for.
    for (const [bx, by] of cells.slice(0, 7)) {
      const w = Math.floor((g.w - 2) / cols) - 2, h = rowH - 2;
      const room = addRoom(g, digRect(g, bx + 1, by + 1, Math.max(4, w), Math.max(4, h)));
      if (room && prev) corridor(g, rng, prev.cx, prev.cy, room.cx, room.cy);
      if (room) prev = room;
    }
  },
};

/**
 * LABYRINTH. One-wide passages, no loops, and nothing sees you until it is adjacent —
 * which cuts against every habit the floors before it taught. You cannot scout, you
 * cannot count what is in the room, and the reticle only ever has one thing on it.
 */
const labyrinth: Layout = {
  id: 'labyrinth',
  brief: 'One-wide, no sightlines. Nothing sees you until it is next to you.',
  // Odd, because the maze lattice sits on odd coordinates — and small, because a
  // perfect maze uses half its grid and every tile of it has to be walked.
  size(base) { const s = Math.min(base, 23); return s % 2 === 0 ? s + 1 : s; },
  carve(g, rng) {
    // recursive backtracker over the odd lattice — a perfect maze, no loops at all
    const stack: [number, number][] = [[1, 1]];
    dig(g, 1, 1);
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const opts: [number, number][] = [];
      for (const [dx, dy] of DIR_VEC) {
        const nx = x + dx * 2, ny = y + dy * 2;
        if (nx < 1 || ny < 1 || nx >= g.w - 1 || ny >= g.h - 1) continue;
        if (g.walkable(nx, ny)) continue;
        opts.push([dx, dy]);
      }
      if (!opts.length) { stack.pop(); continue; }
      const [dx, dy] = rng.pick(opts);
      dig(g, x + dx, y + dy);
      dig(g, x + dx * 2, y + dy * 2);
      stack.push([x + dx * 2, y + dy * 2]);
    }

    // Chambers punched into the maze, because a floor of pure one-wide passage has
    // nowhere a fight can happen and `openTiles` would find no spawn worth using.
    for (let i = 0; i < 6; i++) {
      const cx = 1 + rng.int(1, ((g.w - 3) >> 2)) * 2 + 1;
      const cy = 1 + rng.int(1, ((g.h - 3) >> 2)) * 2 + 1;
      addRoom(g, digRect(g, cx - 1, cy - 1, 4, 4));
    }
  },
};

/**
 * WARREN. Small chambers packed shoulder to shoulder with doors everywhere. Cramped,
 * and full of loops: everything is two steps from everything, including the things
 * chasing you, so distance stops being a resource.
 */
const warren: Layout = {
  id: 'warren',
  brief: 'Everything is two steps from everything. Distance stops being a resource.',
  /**
   * SMALL, and that is the point twice over. A warren is defined by how close its
   * chambers are, so spreading nine of them over a full-size grid would make it a
   * bad rooms-and-corridors — and rooms are the unit `populate` counts in, so the
   * six-by-six lattice this used to lay down was thirty-six rooms and a hundred
   * bodies on one floor.
   */
  size(base) { return Math.min(base, 24); },
  carve(g, rng) {
    const cell = 6;
    const cols = Math.floor((g.w - 2) / cell), rowsN = Math.floor((g.h - 2) / cell);
    // Two of the nine cells stay solid rock — it keeps the room count in the band the
    // rest of the floors sit in, and a warren with a lump of bedrock in it reads more
    // like a warren than a tidy three-by-three does.
    const skip = new Set(rng.sample([...Array(cols * rowsN).keys()], 2));
    const made: (Room | null)[] = [];
    for (let r = 0; r < rowsN; r++) {
      for (let c = 0; c < cols; c++) {
        if (skip.has(r * cols + c)) { made.push(null); continue; }
        const x = 1 + c * cell + rng.int(0, 1), y = 1 + r * cell + rng.int(0, 1);
        const w = rng.int(3, 4), h = rng.int(3, 4);
        made.push(addRoom(g, digRect(g, x, y, w, h)));
      }
    }
    // Doors to the right and to the below neighbour — a lattice of loops, not a tree.
    for (let r = 0; r < rowsN; r++) {
      for (let c = 0; c < cols; c++) {
        const a = made[r * cols + c];
        if (!a) continue;
        const right = c + 1 < cols ? made[r * cols + c + 1] : null;
        const down = r + 1 < rowsN ? made[(r + 1) * cols + c] : null;
        if (right && rng.chance(0.85)) corridor(g, rng, a.cx, a.cy, right.cx, right.cy);
        if (down && rng.chance(0.85)) corridor(g, rng, a.cx, a.cy, down.cx, down.cy);
      }
    }
  },
};

/**
 * ISLANDS. Plateaus in a void, joined by causeways one tile wide. You can see the
 * entire floor from the first island and walk to almost none of it — the phase's whole
 * argument in one layout, because sight and footing are finally different questions
 * and this is the floor that asks them separately.
 */
const islands: Layout = {
  id: 'islands',
  brief: 'You can see the whole floor and walk to almost none of it.',
  // Roomier than most: nearly all of this grid is void, so the same edge length is a
  // fraction of the floor to stand on.
  size(base) { return Math.min(36, base + 6); },
  carve(g, rng) {
    for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) cut(g, x, y);

    const plates: Room[] = [];
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    let guard = 0;
    while (rects.length < 7 && guard++ < 600) {
      const w = rng.int(4, 7), h = rng.int(4, 7);
      const cand = { x: rng.int(2, g.w - w - 3), y: rng.int(2, g.h - h - 3), w, h };
      // clear void between plateaus, or two of them read as one shore
      if (rects.some((r) => overlaps(cand, r))) continue;
      rects.push(cand);
    }
    for (const r of rects) {
      const room = addRoom(g, digRect(g, r.x, r.y, r.w, r.h));
      if (room) plates.push(room);
    }
    // Causeways: a chain, so the floor is crossable, and nothing more. The stitch pass
    // would join them anyway; doing it here means they are one tile wide on purpose.
    for (let i = 1; i < plates.length; i++) {
      corridor(g, rng, plates[i - 1].cx, plates[i - 1].cy, plates[i].cx, plates[i].cy);
    }
  },
};

/**
 * CHASM. An ordinary floor with a crack through it. Two or three bridges, and every
 * one of them is a place where the thing on the far side can see you the whole way
 * across — a corridor you cannot break line of sight in.
 */
const chasm: Layout = {
  id: 'chasm',
  brief: 'A crack across the floor. Three bridges, and no cover on any of them.',
  carve(g, rng, depth) {
    rooms.carve(g, rng, depth);

    // A ragged vertical crack, wandering a tile at a time so it never reads as a wall
    // somebody built. Bridges are left at three heights, spread down the floor.
    const bridges = new Set([
      Math.floor(g.h * 0.22), Math.floor(g.h * 0.52), Math.floor(g.h * 0.8),
    ]);
    let cx = g.w >> 1;
    for (let y = 1; y < g.h - 1; y++) {
      cx = Math.max(4, Math.min(g.w - 5, cx + rng.int(-1, 1)));
      if (bridges.has(y) || bridges.has(y - 1)) continue;
      const wide = rng.chance(0.4) ? 2 : 1;
      for (let i = 0; i < wide; i++) {
        // only floor becomes void — a crack does not eat the bedrock either side
        if (g.at(cx + i, y) === Tile.Floor) cut(g, cx + i, y);
      }
    }
  },
};

/**
 * NESTED. Boxes inside boxes, each with one door, and no two doors on the same side.
 * Getting to the middle means walking most of the way round every layer — the floor is
 * short in tiles and long in steps, and you can see the centre from the moment you
 * arrive.
 */
const nested: Layout = {
  id: 'nested',
  brief: 'Boxes in boxes, one door each, never on the same side twice.',
  size(base) { return Math.min(base, 25); },
  carve(g, rng) {
    const layers = 4;
    const step = 3;
    let side = rng.int(0, 3);
    for (let i = 0; i < layers; i++) {
      const m = 1 + i * step;
      const w = g.w - m * 2, h = g.h - m * 2;
      if (w < 5 || h < 5) break;
      // the band between this ring and the next is the walkable layer
      const band: [number, number][] = [];
      for (let y = m; y < m + h; y++) {
        for (let x = m; x < m + w; x++) {
          const inner = x >= m + 2 && x < m + w - 2 && y >= m + 2 && y < m + h - 2;
          if (inner) continue;
          dig(g, x, y);
          band.push([x, y]);
        }
      }
      addRoom(g, band);
      // one door through to the next layer in, never on the side the last one used
      side = (side + rng.int(1, 3)) % 4;
      const [dx, dy] = DIR_VEC[side];
      const doorX = (g.w >> 1) + dx * (Math.floor(w / 2) - 2);
      const doorY = (g.h >> 1) + dy * (Math.floor(h / 2) - 2);
      dig(g, doorX, doorY);
      dig(g, doorX + dx, doorY + dy);
      dig(g, doorX - dx, doorY - dy);
    }
    // the middle
    const m = 1 + layers * step;
    addRoom(g, digRect(g, m, m, Math.max(3, g.w - m * 2), Math.max(3, g.h - m * 2)));
  },
  boss(g) {
    // the innermost box, which is the last room declared
    return g.rooms[g.rooms.length - 1] ?? null;
  },
};

// ---------------------------------------------------------------------------
// the roster
// ---------------------------------------------------------------------------

export const LAYOUTS: Record<LayoutId, Layout> = {
  rooms, cave, ring, spiral, hub, gridcity, cathedral,
  gauntlet, labyrinth, warren, islands, chasm, nested,
};

/**
 * WHICH FLOOR GETS WHICH. The other open question, and it is deliberately not "the
 * order they were written in": the roster and the hazards of a floor follow from its
 * shape, so this table is upstream of two later phases and is the thing they read.
 *
 * The order is an argument, not a shuffle. Floor 1 teaches the grammar. Floors 2-4
 * bend it one axis at a time — cramped, then shapeless, then rigid. Floor 5 is the
 * first floor that takes SIGHT away from you as a resource by giving you too much of
 * it, and floor 6 is the first that takes footing away while leaving sight intact,
 * which is only possible at all since the grid learnt to say gap. Floors 7-8 are the
 * pair the phase doc names as opposites and so are kept adjacent on purpose: a ring
 * you can always escape round, then a chain you cannot. 9 breaks the floor in half,
 * and 10 puts the throne in the middle and makes you cross it six times.
 *
 * TERRACES IS NOT HERE. It is the fourteenth and it needs elevation DRAWN, not merely
 * stored — the renderer puts every tile at y=0 — so it waits for Verticality. Spiral,
 * labyrinth and nested are the bench: written, playable, and unassigned, which is what
 * "fourteen, so there is room to cut two" was for.
 */
const BY_DEPTH: LayoutId[] = [
  'rooms',      //  1 The Drowned Library — the grammar
  'warren',     //  2 The Ossuary Kitchens — cramped, everything adjacent
  'cave',       //  3 The Verdant Rot — nothing straight
  'gridcity',   //  4 The Brass Foundry — rigid, right angles, always a way round
  'cathedral',  //  5 The Celestial Vault — one hall, seen from the door
  'islands',    //  6 The Glass Gardens — all sight, no footing
  'ring',       //  7 The Tidal Vault — you can always go round
  'gauntlet',   //  8 The Choir of Wounds — you cannot
  'chasm',      //  9 The Ashfall Reach — the floor in two halves
  'hub',        // 10 The Hollow Crown — the throne you keep crossing
];

export function layoutFor(depth: number): Layout {
  const id = BY_DEPTH[Math.max(0, Math.min(BY_DEPTH.length - 1, depth - 1))];
  return LAYOUTS[id];
}
