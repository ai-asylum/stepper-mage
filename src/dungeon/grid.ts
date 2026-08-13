/**
 * The dungeon grid: what a floor IS, and every question the game asks one.
 *
 * A floor is open space on a small integer grid. The player occupies one tile and
 * faces one of four directions — this is a stepper, so every position in the game is
 * an integer and every turn is 90 degrees. That constraint is what makes spell
 * targeting legible on a phone: at any moment there is a small, countable set of
 * things in front of you.
 *
 * WHAT SHAPE that space is is not decided here. Thirteen generators carve it
 * (`layouts.ts`) and one shared pass turns a carve into a playable floor
 * (`generate.ts`); this file is only the data and the questions — `walkable`,
 * `seeThrough`, `flood`, `fill` — and it deliberately does not know which layout it
 * is holding.
 *
 * Light is BAKED per tile at generation time (`bakeLight`). The player's torch
 * is added per-fragment at render time on top of it, so a room with a lit brazier
 * reads as lit before you walk into it — you can see where you're going, which
 * matters a lot when the alternative is a corridor of identical black squares.
 */

export const enum Tile {
  Wall = 0,
  Floor = 1,
  /** Floor that also holds the descent once the boss is dead. */
  Stairs = 2,
  /**
   * Open air you cannot enter. Blocks movement and NOT sight.
   *
   * The second axis of obstacle. Every obstacle before this one blocked both,
   * because a wall was the only obstacle there was — so "I can't go there" and
   * "I can't see there" were the same sentence. A gap splits them: you can look
   * across it, shoot across it, be shot across it, and not cross it.
   *
   * It is bottomless as far as this phase is concerned. A pit you fall INTO is a
   * floor tile several levels down, not a second tile kind — see `height`.
   */
  Gap = 3,
  /**
   * A portcullis. Shut it stops you; open it does not; either way you see through it.
   *
   * A `Tile` and not a `Surface` because it changes WALKABILITY, which is the one
   * thing a surface never does — and see-through on purpose, so the room beyond and
   * the countdown on the bars are both readable from the wrong side of it. A door you
   * cannot see past is a wall with a story.
   */
  Door = 4,
  /**
   * A block of stone standing on the floor. Solid to your feet and to your eyes,
   * and it MOVES — one tile per gust.
   *
   * A `Tile` and not an entity, and that is the decision the whole thing hangs on.
   * Everything that asks the floor a question asks it here: `clearLine` reads the
   * grid, `fill` walks the grid, `flood` walks the grid — so a block is cover, a
   * firebreak and an obstacle from this one line, and none of those three needed a
   * word written about blocks. As an entity it would have been the opposite: three
   * separate special cases, in three files, that have to keep agreeing.
   *
   * The price is that a moving tile cannot be part of the static floor mesh. It is
   * drawn by `ClockView` with the rest of the fixtures that move, and the renderer
   * has to be careful to ask `masonry` rather than `seeThrough` wherever it is
   * deciding what the BUILDING looks like — see below.
   */
  Block = 5,
}

/**
 * What a tile DOES, as opposed to whether you can stand on it.
 *
 * `Tile` is the floor's SHAPE and this is its SURFACE, and they are separate bytes
 * because they answer separate questions: a tile that conducts is still a tile you
 * walk on, and every layout should be able to have a wet quarter without being a
 * different layout. A surface is part of the floor and never expires — which is what
 * makes it the grid's and not `Ground`'s, since `Ground` holds what a cast left behind
 * and ages it away.
 *
 * EVERY ONE OF THESE IS LEGIBLE IN THE TILE. That is the whole entry requirement: a
 * rule the player has to be told is a theme, and a rule they can see in the floor is a
 * mechanic. Anything that could not be drawn did not ship.
 */
export const enum Surface {
  Plain = 0,
  /** Iron plating. Spark chains along the whole plate — you included. */
  Iron = 1,
  /** Shallow water. Chains like iron, and fire will not take on it. */
  Water = 2,
  /** Broken stone. Two moves to cross, and gust clears it. */
  Rubble = 3,
  /** A fog bank. Sight dies two tiles in, whichever side of it you are on. */
  Fog = 4,
  /** One mouth of a pair. Step on it, arrive at the other. */
  Portal = 5,
  /**
   * A ladder. The one tile you may climb UP from.
   *
   * Down is free everywhere along an edge and up is not, so a level would be a
   * one-way trip without these — and a one-way trip is a locked door wearing a
   * different hat. It is a SURFACE rather than an object because that is what makes
   * it visible from the top of the drop: you can see where you will be able to get
   * back up before you commit to going down.
   */
  Ladder = 6,
  /**
   * A pressure plate. Stand on it and its door opens for a few turns.
   *
   * THE LEVER IS A TILE, and that is the decision worth writing down: a lever on a
   * wall would need a verb, a prompt, a reach test and a tap target, and every one of
   * those is a thing to teach. A plate needs none — this is a stepper, so "put your
   * weight on that" is the one instruction the player already has. It also puts the
   * cost exactly where the phase wants it, because a plate is somewhere ELSE, and
   * getting from it to the door is the arithmetic.
   */
  Plate = 7,
  /**
   * A lever. Stand on it and it stays pulled.
   *
   * The same gesture as a plate and deliberately so — one way to work a mechanism is
   * one thing to learn — but the opposite kind of object. A plate is MOMENTARY and
   * belongs to the clock; a lever is PERMANENT and belongs to the map. What it buys
   * is never power: it opens the boss door and nothing else, which is what makes
   * walking every room a real reason rather than another way to inflate the player.
   */
  Lever = 8,
}

/** How many fogged tiles a line of sight survives. Two, and the second is the last. */
export const FOG_SIGHT = 2;

/**
 * A hazard on a beat, anchored to a tile.
 *
 * Turns and not seconds, because this game is already a clock: a cast is a turn and a
 * step is a turn, and the player counts them whether they mean to or not. So a blade
 * on a three-beat cycle needs no tooltip, no timer bar and no tutorial — you watch it
 * once and you know it forever.
 */
export type HazardKind = 'blade' | 'spikes' | 'trapdoor';

export interface Hazard {
  x: number; y: number;
  kind: HazardKind;
  /** Turns in one full cycle. */
  period: number;
  /** How many beats at the START of the cycle it is dangerous. */
  live: number;
  /** Where in the cycle it is now, 0..period-1. Advanced once per round. */
  beat: number;
  damage: number;
}

/** What a hazard is doing this beat. The three states the art has to tell apart. */
export type HazardState = 'live' | 'winding' | 'idle';

/**
 * Live, about to be live, or resting.
 *
 * The WINDING beat is the whole reason a hazard is fair. It is always the last beat of
 * the cycle, so the tell and the strike are adjacent and the player learns the pair as
 * one event — and it means a hazard can be baited: you can put something on the tile
 * on the wind-up and it is still there for the swing.
 */
export function hazardState(h: Hazard): HazardState {
  if (h.beat < h.live) return 'live';
  if (h.beat === h.period - 1) return 'winding';
  return 'idle';
}

/**
 * A portcullis and the plate that opens it.
 *
 * There is no countdown any more and that is the whole change. `turns` bought eight
 * of them and eight was never a budget anybody could misspend — the plate sat on the
 * only path to the gate, so the mechanic was: step on a tile, a door opens, walk
 * through it. No decision in it, and it needed a readout drawn on the door to be
 * legible at all, which is the tell.
 *
 * A plate HOLDS its gate up. The thing that opens it is the thing that cannot go
 * through it, so it is a problem rather than a toll — and everything behind one is
 * optional by construction, because `placeGate` will not put one where the run needs
 * to go.
 */
export interface Door {
  /** Tile index of the portcullis. */
  i: number;
  /** Tile index of the plate that holds it up. */
  plate: number;
}

/**
 * The boss door, and the levers that fill its sockets.
 *
 * Not a `Door`, because it is the opposite kind of object: a timed gate is a question
 * about turns and this is a question about the MAP. It never shuts once it is open,
 * it is on no clock, and the only way through it is to have walked the rooms the
 * compass never points at.
 *
 * `sockets` is drawn on the door and is the whole of the information the player gets:
 * how many levers there are, and how many are still out there. Never WHERE — knowing
 * the count turns exploring into a countdown you can finish, and knowing the location
 * would turn it into an errand.
 */
export interface BossDoor {
  /** Tile index of the door itself. */
  i: number;
  /** Tile indices of every lever that feeds it. */
  levers: number[];
  /** Which of them have been pulled. */
  pulled: Set<number>;
}

/** Do spark and shock run along this surface? */
export function conducts(s: Surface): boolean {
  return s === Surface.Iron || s === Surface.Water;
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

/** A tile a fill reached, and how many steps away it was. */
export interface FillTile { i: number; d: number; }

/**
 * How far a tile may sit off the floor plane, in whole steps.
 *
 * Five levels, and the count is a renderer bill rather than a design wish: every
 * level is another band of quads at every elevation seam, and sprite sorting stops
 * being trivial once things can stand above each other. Two down carries a sunken
 * room and the ledge you shove someone off; two up carries a terrace you can see
 * over from the walkway. Nothing so far has wanted a third.
 *
 * 0 is the plane everything in the game stands on today, so an all-zero height
 * array is exactly the floor the game already had.
 */
export const HEIGHT_MIN = -2;
export const HEIGHT_MAX = 2;

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
  /**
   * 1 once the player has actually STOOD on a tile.
   *
   * Separate from `explored` because the minimap rotates with your heading: after
   * a couple of turns, "seen" and "been" look identical and you lose track of the
   * way you came in. This is the trail.
   */
  readonly visited: Uint8Array;
  /**
   * Elevation per tile in whole steps, `HEIGHT_MIN`..`HEIGHT_MAX`, 0 being the
   * plane the whole game stands on.
   *
   * DATA ONLY for now. Nothing sets it, the renderer draws every tile at 0 and
   * movement does not read it — falling, the shove off a ledge and the ladder are
   * Verticality. It is here because a generator cannot produce a terrace it has no
   * way to say, and that alphabet is what this phase is.
   */
  readonly height: Int8Array;
  /** What each tile DOES — see `Surface`. A second byte beside `variant`. */
  readonly surface: Uint8Array;
  /**
   * 1 where a `Tile.Door` is currently open.
   *
   * A parallel array rather than a lookup in `doors`, because `walkable` is the
   * hottest question in the codebase — every flood, every fill, every step of every
   * body's pathing — and it must not become a linear scan over a list.
   *
   * DERIVED from `doorLift` and never written on its own: a door is open when it is
   * all the way up and shut every other instant of its travel. Keeping the byte is
   * not redundancy, it is the fast answer — `walkable` must not do a float compare
   * over an array the flood fill touches a thousand times a floor.
   */
  readonly doorOpen: Uint8Array;

  /**
   * HOW FAR UP each `Tile.Door` is, 0 shut to 1 gone. The real state of a door.
   *
   * A door used to be a boolean, and a boolean cannot answer the question the
   * mechanic actually asks: a gate with two levers and one of them thrown is
   * neither open nor shut, it is HALF UP, and the player has to be able to see that
   * they are halfway. So the door carries a fraction, every actuator owns a share of
   * it, and `doorOpen` falls out of the top of the range.
   *
   * A half-open door is still shut to your feet. The partial position is
   * information — how much of the mechanism you have solved — and never access.
   */
  readonly doorLift: Float32Array;

  rooms: Room[] = [];
  lights: LightSource[] = [];
  start: { x: number; y: number; dir: Dir } = { x: 1, y: 1, dir: 2 };
  stairs: { x: number; y: number } | null = null;
  /**
   * The portal pairs, as tile indices. A mouth without its twin is a hole in the
   * floor plan, so they are stored as pairs rather than inferred from the surface
   * byte — which can only say "portal", not "which one".
   */
  portals: { a: number; b: number }[] = [];
  /** Everything on a beat. Ticked by the enemy round and nowhere else. */
  hazards: Hazard[] = [];
  /** Portcullises and their plates. */
  doors: Door[] = [];
  /**
   * Room sealed behind the captive's gate, or -1.
   *
   * On the grid because the gate is grid geometry and `populate` needs to know which room it
   * made unreachable — the captive has to stand behind the door rather than merely somewhere.
   */
  captiveRoom = -1;
  /** The way into the boss room, and what opens it. Null on floors that have none. */
  bossDoor: BossDoor | null = null;

  constructor(w: number, h: number) {
    this.w = w; this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.light = new Float32Array(w * h);
    this.variant = new Uint8Array(w * h);
    this.roomOf = new Uint8Array(w * h).fill(255);
    this.explored = new Uint8Array(w * h);
    this.visited = new Uint8Array(w * h);
    this.height = new Int8Array(w * h);
    this.surface = new Uint8Array(w * h);
    this.doorOpen = new Uint8Array(w * h);
    this.doorLift = new Float32Array(w * h);
  }

  idx(x: number, y: number): number { return y * this.w + x; }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  at(x: number, y: number): Tile {
    if (!this.inside(x, y)) return Tile.Wall;
    return this.tiles[this.idx(x, y)] as Tile;
  }

  /**
   * May a body stand here?
   *
   * One of the two seams the whole game asks about a tile. Targeting, the volume
   * flood, enemy pathing and the minimap all come through here or through
   * `seeThrough`, which is why a new tile kind is learned by most of the game
   * without being told about it.
   */
  walkable(x: number, y: number): boolean {
    const t = this.at(x, y);
    if (t === Tile.Wall || t === Tile.Gap || t === Tile.Block) return false;
    // A shut portcullis is as solid as the wall it hangs in — to the flood, to the
    // volume, to every body's pathing and to the player's feet, all from this line.
    if (t === Tile.Door) return this.doorOpen[this.idx(x, y)] === 1;
    return true;
  }

  /**
   * May sight — and anything that travels along sight — cross this tile?
   *
   * The other seam. A wall stops it and so does a block; a gap does not, which is
   * the entire point of a gap.
   */
  seeThrough(x: number, y: number): boolean {
    const t = this.at(x, y);
    return t !== Tile.Wall && t !== Tile.Block;
  }

  /**
   * Is this tile part of the BUILDING, as opposed to something standing in it?
   *
   * The third question, and it exists because a block answers `seeThrough` like a
   * wall and must not be DRAWN like one. The renderer and the light bake both used
   * "can I see through it" as their test for masonry, which was the same question
   * while a wall was the only thing that stopped sight — and the moment a block did
   * too, every tile beside one grew a permanent wall face and a permanent shadow,
   * baked into a mesh that is built once. The block then slid a tile east and left
   * both behind it.
   *
   * So anything that is deciding what the ARCHITECTURE looks like asks this, and
   * anything deciding what can be seen or walked asks the other two. A block is
   * furniture: it occludes, it obstructs, and it is not the room.
   */
  masonry(x: number, y: number): boolean {
    return this.at(x, y) === Tile.Wall;
  }

  /** Every block standing on this floor, as tile indices. */
  blocks(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.tiles[i] === Tile.Block) out.push(i);
    }
    return out;
  }

  /**
   * Move a door to a new position, and keep the fast byte in step with it.
   *
   * The ONE write path for both, so `doorOpen` can never disagree with `doorLift` —
   * which it would within a day if the two were set at the call sites, and the
   * symptom would be a door you can see is shut and can walk through.
   */
  setDoorLift(i: number, lift: number): void {
    const k = Math.max(0, Math.min(1, lift));
    this.doorLift[i] = k;
    this.doorOpen[i] = k >= 1 ? 1 : 0;
  }

  /** Elevation in whole steps. 0 outside the map, so the edge never reads as a drop. */
  heightAt(x: number, y: number): number {
    if (!this.inside(x, y)) return 0;
    return this.height[this.idx(x, y)];
  }

  /** What this tile does. Plain outside the map and plain under a wall. */
  surfaceAt(x: number, y: number): Surface {
    if (!this.inside(x, y)) return Surface.Plain;
    return this.surface[this.idx(x, y)] as Surface;
  }

  /**
   * Every tile of the connected run of conductive surface this tile is part of.
   *
   * The plate IS the reach — that is the whole of iron, and of standing water, and
   * the reason both are one rule. A charge does not care how far it has travelled,
   * it cares whether the metal is continuous, so this is a flood over `conducts` and
   * not a radius. Empty if the tile does not conduct, which is the common case and
   * the caller's cue to fall back to the ordinary arc.
   */
  conductive(x: number, y: number): number[] {
    const s = this.surfaceAt(x, y);
    if (!conducts(s)) return [];
    const out: number[] = [];
    const seen = new Uint8Array(this.w * this.h);
    const start = this.idx(x, y);
    const q = [start];
    seen[start] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi];
      out.push(i);
      const cx = i % this.w, cy = (i / this.w) | 0;
      for (const [dx, dy] of DIR_VEC) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.inside(nx, ny) || this.surfaceAt(nx, ny) !== s) continue;
        const ni = this.idx(nx, ny);
        if (seen[ni]) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    return out;
  }

  /**
   * May a body go from one tile to the next, given what they are standing on?
   *
   * DOWN IS FREE, UP IS NOT. That asymmetry is the whole traversal rule and it buys
   * one-way movement with no new verb and no locked door: you can step off any edge
   * anywhere, and you get back up only where somebody put a ladder. A drop is
   * therefore a decision — the way back is visible from the top before you take it.
   *
   * Level ground and a step down always pass. A step UP passes only from a ladder,
   * and from a ladder it passes however high the step is, because a ladder is the
   * answer to the ledge it is leaning on.
   */
  canClimb(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const rise = this.heightAt(toX, toY) - this.heightAt(fromX, fromY);
    if (rise <= 0) return true;
    return this.surfaceAt(fromX, fromY) === Surface.Ladder;
  }

  /** How far a body falls making this move, in whole levels. 0 for level or up. */
  dropFrom(fromX: number, fromY: number, toX: number, toY: number): number {
    return Math.max(0, this.heightAt(fromX, fromY) - this.heightAt(toX, toY));
  }

  /** The other mouth of the pair this tile belongs to, or -1. */
  portalPair(i: number): number {
    for (const p of this.portals) {
      if (p.a === i) return p.b;
      if (p.b === i) return p.a;
    }
    return -1;
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

  /**
   * Every tile reachable from a point in at most `max` steps, as PATH distance.
   *
   * The one answer in this codebase to "which tiles can be reached from here in N
   * steps". A spell's volume, a body's pathfinding and a reaction's blast all ask
   * the same question and must not each answer it their own way — the wall is what
   * stops an effect, and a wall stops it identically whoever is asking.
   *
   * Returns distance per tile, -1 where unreached. The origin is 0 and is always
   * included, walkable or not: a blast goes off where it goes off.
   *
   * `passable` narrows the expansion beyond walls — bodies also refuse to walk
   * through each other, where a blast happily rolls over them.
   */
  flood(
    x: number, y: number, max: number,
    passable: (px: number, py: number) => boolean = (px, py) => this.walkable(px, py),
  ): Int16Array {
    const dist = new Int16Array(this.w * this.h).fill(-1);
    if (!this.inside(x, y)) return dist;
    const queue: number[] = [this.idx(x, y)];
    dist[queue[0]] = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      const d = dist[i];
      if (d >= max) continue;
      const cx = i % this.w, cy = (i / this.w) | 0;
      for (const [dx, dy] of DIR_VEC) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.inside(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (dist[ni] !== -1) continue;
        if (!passable(nx, ny)) continue;
        dist[ni] = d + 1;
        queue.push(ni);
      }
    }
    return dist;
  }

  /**
   * The tiles an effect of a given VOLUME fills, nearest first.
   *
   * Volume is a BUDGET OF TILES, not a radius — a Fireball is 1, which is the tile
   * it lands on and nothing else, and the next one up is 9, which is that tile plus
   * the eight it reaches first. Sized this way because a radius is a number nobody
   * can picture and a tile count is one you can look at on the floor and read.
   *
   * The order is the flood's, so the budget is spent on the NEAREST tiles and a
   * volume against a wall pools sideways instead of stopping short. It goes where a
   * body could walk; that is the whole rule and the only rule — which is what makes
   * a gap a firebreak without a line of code about fire or gaps. Fire fills the
   * floor, a gap is not floor, so the burn stops at the edge and pools along it.
   *
   * Returns each tile with its PATH DISTANCE from the origin, nearest first, at
   * most `volume` of them. The distance is carried out rather than left for the
   * caller to re-derive, because the flood is the only thing that knows it — a fill
   * wraps corners, so a tile three steps down a hallway is at distance 3 and two
   * tiles apart on the map.
   */
  fill(x: number, y: number, volume: number, away?: [number, number]): FillTile[] {
    if (volume <= 0 || !this.inside(x, y)) return [];
    const origin = this.idx(x, y);
    const seen = new Uint8Array(this.w * this.h);
    const out: FillTile[] = [];

    // The frontier is grown one tile at a time and always from a tile already
    // taken, so the fill is connected however the bias reorders it.
    const frontier: number[] = [origin];
    const step = new Int16Array(this.w * this.h);
    seen[origin] = 1;

    /**
     * How much a tile is in the direction the blast was thrown.
     *
     * Ties inside a ring are broken on this, so the budget is spent AWAY from the
     * caster first: a fireball thrown down an open room pushes its volume down the
     * room, and only a room with nowhere left to put it pools back over the person
     * who threw it. The self-hit becomes a fact about the geometry — you fired into
     * a dead end — rather than a tax on casting fire at all.
     */
    const forward = (i: number): number => {
      if (!away) return 0;
      return ((i % this.w) - x) * away[0] + (((i / this.w) | 0) - y) * away[1];
    };
    const rank = (i: number): number => this.dist2(i, origin) - forward(i) * 4;

    while (out.length < volume && frontier.length) {
      let best = 0;
      for (let k = 1; k < frontier.length; k++) {
        if (rank(frontier[k]) < rank(frontier[best])) best = k;
      }
      const i = frontier.splice(best, 1)[0];
      out.push({ i, d: step[i] });
      const cx = i % this.w, cy = (i / this.w) | 0;
      for (const [dx, dy] of DIR_VEC) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.inside(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (seen[ni] || !this.walkable(nx, ny)) continue;
        seen[ni] = 1;
        step[ni] = step[i] + 1;
        frontier.push(ni);
      }
    }
    return out;
  }

  /** Squared tile distance between two indices — a tie-break, never a reach test. */
  private dist2(a: number, b: number): number {
    const dx = (a % this.w) - (b % this.w);
    const dy = ((a / this.w) | 0) - ((b / this.w) | 0);
    return dx * dx + dy * dy;
  }

  /** Straight line of sight along a cardinal direction, blocked by walls and by fog. */
  rayTiles(x: number, y: number, dir: Dir, max: number): [number, number][] {
    const [dx, dy] = DIR_VEC[dir];
    const out: [number, number][] = [];
    let murk = 0;
    for (let i = 1; i <= max; i++) {
      const nx = x + dx * i, ny = y + dy * i;
      // Sight, so a gap is passed and RETURNED — a chasm you cannot cross is still
      // something you have laid eyes on, and the far side of it is too.
      if (!this.seeThrough(nx, ny)) break;
      /**
       * FOG IS COUNTED, not distanced. Two fogged tiles is as far as a look gets,
       * whichever side of the bank you are standing on: from outside you see two
       * tiles into it, and from inside you see two tiles of anything. The tile that
       * spends the last of the allowance is still SEEN — you can make out the thing
       * at the edge of the murk, you just cannot see past it.
       */
      if (this.surfaceAt(nx, ny) === Surface.Fog) murk++;
      out.push([nx, ny]);
      if (murk >= FOG_SIGHT) break;
    }
    return out;
  }
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
        // Light crosses a gap. It is open air, not an obstacle — a brazier on one
        // side of a chasm has to light the far lip, or half the room goes black for
        // a reason the player can see straight through.
        //
        // AND IT CROSSES A BLOCK, which is a lie told on purpose. A block genuinely
        // stops light; this pass runs once, at generation, and a block is the one
        // solid thing on the floor that moves — so an honest shadow here would be a
        // dark patch of floor left standing where a block USED to be, for the rest of
        // the descent. The torch is per-fragment and does the honest half.
        if (g.masonry(nx, ny)) continue;
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

/**
 * Tiles the player can currently see (cardinal corridors + current room).
 *
 * IN FOG, THE ROOM REVEAL IS OFF. Walking into a room hands you the whole of it,
 * which is right — you looked around — and would quietly undo the one thing fog does
 * if it kept happening inside a bank. Standing in the murk you get the rays and
 * nothing else, so the map fills in two tiles at a time as you feel your way through,
 * and the compass becomes the more useful of the two readouts. That last part is the
 * point of the surface rather than a side effect of it.
 */
/**
 * Is the straight line between two tiles free of anything you cannot see past?
 *
 * The geometric half of sight, and nothing else — no fog allowance, no room rule, no
 * cone. `Combat` wraps it with those to answer "may the player put a reticle on this",
 * which is a question about a run in progress; generation and the cutscene camera ask
 * only about the masonry, and both used to carry their own copy of this loop.
 *
 * Endpoints excluded. Both callers are asking about a thing that STANDS on a tile — a
 * lever, a portcullis, a camera — rather than about the tile itself, and a subject that
 * occludes itself is never what is meant. Permissive at a corner, because a line that
 * grazes the join between two tiles passes if either is open: sight leaking a tile round
 * a doorframe is invisible, and refusing a view that is plainly there is not.
 */
export function sightLine(g: Grid, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const px = x0 + dx * t, py = y0 + dy * t;
    if (g.seeThrough(Math.round(px), Math.round(py))) continue;
    if (g.seeThrough(Math.floor(px), Math.floor(py))) continue;
    if (g.seeThrough(Math.ceil(px), Math.ceil(py))) continue;
    return false;
  }
  return true;
}

export function visibleTiles(g: Grid, px: number, py: number): Set<number> {
  const out = new Set<number>();
  const blind = g.surfaceAt(px, py) === Surface.Fog;
  const room = g.roomAt(px, py);
  if (room && !blind) for (const [x, y] of room.tiles) out.add(g.idx(x, y));
  out.add(g.idx(px, py));

  /**
   * THE OVERLOOK: standing high, you can see the ground below laid out.
   *
   * "You should know what is coming" without a reveal, a tooltip or a minimap
   * upgrade — you are simply above it. Everything LOWER than you within a good look,
   * with a straight line that no wall crosses; the ledge itself is not an obstacle,
   * which is the entire difference between being on top of it and being under it.
   *
   * A drop is therefore worth walking to the top of before you take it, and the
   * choice to go down is made with the information rather than before it. Fog still
   * wins: a bank you are standing in blinds you at any altitude.
   */
  const high = g.heightAt(px, py);
  if (high > 0 && !blind) {
    const R = 7;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = px + dx, y = py + dy;
        if (!g.inside(x, y) || g.heightAt(x, y) >= high) continue;
        if (!g.seeThrough(x, y)) continue;
        const n = Math.max(Math.abs(dx), Math.abs(dy));
        let clear = true;
        for (let i = 1; i < n && clear; i++) {
          const sx = Math.round(px + (dx * i) / n), sy = Math.round(py + (dy * i) / n);
          // A wall stops the look. A tile no higher than the one you are standing on
          // does not, however tall the step down to it is.
          if (!g.seeThrough(sx, sy) || g.heightAt(sx, sy) > high) clear = false;
        }
        if (clear) out.add(g.idx(x, y));
      }
    }
  }
  for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
    for (const [x, y] of g.rayTiles(px, py, d, 12)) {
      out.add(g.idx(x, y));
      // A room you can see INTO is a room you have seen, unless the look that got
      // you there was spent on murk — a bank two tiles deep does not reveal what is
      // standing on the other side of it.
      if (blind || g.surfaceAt(x, y) === Surface.Fog) continue;
      const r = g.roomAt(x, y);
      if (r) for (const [rx, ry] of r.tiles) out.add(g.idx(rx, ry));
    }
  }
  return out;
}
