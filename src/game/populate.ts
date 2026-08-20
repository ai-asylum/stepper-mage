/**
 * Floor population — what actually stands in each room.
 *
 * Placement is rule-driven rather than uniformly random, because the room's
 * CONTENTS are the puzzle: props are the spell components, so every combat room
 * needs at least one animatable thing in it or the core verb has nothing to bite
 * on. Props hug the walls (they are scenery you reach past), enemies hold the
 * open middle (they are what you have to get through).
 */
import { Rng } from '../core/rng';
import { Grid, DIR_VEC, Surface, Tile, type Room } from '../dungeon/grid';
import type { Theme } from '../art/theme';
import { ROOM_ENEMIES_BASE, ROOM_ENEMIES_MAX, roomEnemyChance } from './tuning';

export type PlacedKind = 'prop' | 'enemy' | 'altar' | 'chest' | 'boss' | 'stairs' | 'lever'
  | 'captive';

export interface Placed {
  /** Wizard id, on a `captive` placement only. */
  captiveId?: string;
  kind: PlacedKind;
  /** Sprite id in public/art. */
  sprite: string;
  /** For props: the golem sprite it animates into. */
  golem?: string;
  x: number;
  y: number;
  /** Sub-tile offset so two things on adjacent tiles do not visually merge. */
  ox: number;
  oz: number;
  hover: number;
  /**
   * Does this thing fly? Ground terrain does not apply to it.
   *
   * Recorded rather than derived from `hover`, which is a DRAWING — the depth-1 boss
   * floats a little for effect and walks like everything else — so reading the float
   * back as "flies" would exempt it from the floor by accident.
   */
  flies?: boolean;
  roomId: number;
}

/**
 * How many enemies a room gets, by depth. Boss rooms get none — the boss is it.
 * The altar room gets one fewer, so the room you go to for a page is the one you
 * can afford to reach.
 *
 * See `tuning.ts`: the count is a tempo number, not a difficulty knob. Every body
 * in here acts once per cast you release.
 */
function enemyCount(rng: Rng, depth: number, room: Room): number {
  if (room.kind === 'boss' || room.kind === 'entrance') return 0;
  const base = room.kind === 'altar' ? ROOM_ENEMIES_BASE - 1 : ROOM_ENEMIES_BASE;
  return Math.min(ROOM_ENEMIES_MAX, base + (rng.chance(roomEnemyChance(depth)) ? 1 : 0));
}

/**
 * A captive to place on this floor, or null. Passed IN rather than worked out here, because
 * who is behind the gate depends on the save (who is already freed) and on the wizard being
 * played — neither of which the dungeon generator knows or should learn.
 */
export interface CaptiveSpot {
  /** Wizard id, so the entity can be traced back to the roster. */
  id: string;
  /** Full-body sprite. */
  sprite: string;
}

/**
 * The clay source, shared by every theme.
 *
 * Not a themed prop: `theme.props` is index-paired with `theme.golems` and this has no
 * golem form on purpose. One id, so a floor at any depth can supply the one component
 * that makes a body.
 */
const CLAY_PROP = 'prop_unfinished_golem';

export function populate(
  grid: Grid, theme: Theme, seed: string, depth: number, captive: CaptiveSpot | null = null,
): Placed[] {
  const rng = new Rng(`${seed}-pop`);
  const out: Placed[] = [];
  const taken = new Set<number>();
  /**
   * Has this floor had its unfinished golem yet? One per floor, and one is enough: it
   * holds two clay, which is a deep pouch full and two golems' worth.
   */
  let clayPlaced = false;

  const claim = (x: number, y: number) => taken.add(grid.idx(x, y));

  /**
   * The tiles given to FURNITURE, as distinct from the tiles given to anything.
   *
   * `taken` stops two things sharing a tile and holds bodies as well as scenery. The
   * blocking tests below must not: a creature standing in a doorway walks out of it on
   * its first turn, and counting one as a wall while validating makes the whole floor
   * behind it look already-unreachable — which then lets a shelf that really does cut
   * that region through, because the region was "lost" before the shelf was asked
   * about. Only things that never move belong in here.
   */
  const fixed = new Set<number>();
  const furnish = (x: number, y: number) => { claim(x, y); fixed.add(grid.idx(x, y)); };

  /**
   * THE LEVERS GO IN FIRST, before a single room is furnished.
   *
   * Their entities are emitted at the very bottom of this function, off `Surface.Lever`,
   * which meant every prop in every room was validated by a floor that did not yet know
   * a lever was standing anywhere. Two solid things, each checked against a world without
   * the other, and between them a sealed room. Their TILES are decided in generation, so
   * there is nothing to choose here — only something to declare, and it has to be
   * declared before anything is asked about width or reachability.
   */
  for (let i = 0; i < grid.surface.length; i++) {
    if (grid.surface[i] === Surface.Lever) { taken.add(i); fixed.add(i); }
  }
  const free = (x: number, y: number) =>
    grid.walkable(x, y) && !taken.has(grid.idx(x, y)) &&
    !(x === grid.start.x && y === grid.start.y);

  /**
   * How many ways out a tile has, counting furniture as the wall it is.
   *
   * `SOLID` lists prop, chest, altar and lever — every one of them occupies its tile
   * for the whole run — so a tile whose only other exits are already furnished is a
   * dead end even though the grid calls all of it floor. Counted against `taken`, which
   * is the set of tiles this pass has already given to something solid.
   */
  const ways = (x: number, y: number): number => {
    let open = 0;
    for (const [dx, dy] of DIR_VEC) {
      const nx = x + dx, ny = y + dy;
      if (!grid.walkable(nx, ny) || fixed.has(grid.idx(nx, ny))) continue;
      open++;
    }
    return open;
  };

  /**
   * MAY SOMETHING SOLID STAND HERE — is there room to walk past it?
   *
   * Three ways out. Two is a passage: a doorway, the neck of a room, the one tile round
   * a pillar. Furniture in a passage is a wall, and the complaint was exact — a
   * bookshelf standing in the mouth of a room, with the room behind it unreachable.
   *
   * This is the same rule `generate.ts` applies to levers (`walkAround`) and to its
   * loose blocks. It was the one piece of furniture placement that never asked.
   */
  const roomToPass = (x: number, y: number): boolean => ways(x, y) >= 3;

  /**
   * Everything you can still walk to, with the furniture placed so far standing.
   *
   * GATES COUNT AS OPEN, and this is the whole difference between this working and
   * not. A gate is shut while the floor is being furnished and it is a thing the player
   * LIFTS — so validating against a shut one makes every region behind it look already
   * unreachable, and a shelf dropped in the neck of such a room passes the test by
   * cutting off something the test had already written off. It then cuts it for real the
   * moment the lever is thrown. Measured: props were the culprit in 143 of 150 severed
   * floors, and this was why.
   */
  const reach = (extra: number): Uint8Array => {
    const seen = new Uint8Array(grid.w * grid.h);
    const open = (x: number, y: number): boolean => {
      if (!grid.inside(x, y)) return false;
      const i = grid.idx(x, y);
      if (fixed.has(i) || i === extra) return false;
      // A BLOCK STAYS A WALL here, unlike a gate. A gate is lifted by a lever and is
      // then open for good; a block is shoved, one tile, only if there is somewhere for
      // it to go — so "the player can get past it" is not a promise this pass can make.
      // Counting them open was measured and was worse: 1637 tiles cut across 800 floors,
      // against none when they are treated as the wall they are until someone moves them.
      return grid.at(x, y) === Tile.Door || grid.walkable(x, y);
    };
    if (!open(grid.start.x, grid.start.y)) return seen;
    const q = [grid.idx(grid.start.x, grid.start.y)];
    seen[q[0]] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % grid.w, y = (i / grid.w) | 0;
      for (const [dx, dy] of DIR_VEC) {
        const nx = x + dx, ny = y + dy;
        if (!open(nx, ny) || !grid.canClimb(x, y, nx, ny)) continue;
        const ni = grid.idx(nx, ny);
        if (seen[ni]) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    return seen;
  };

  /**
   * WOULD SOMETHING STANDING HERE CUT ANYBODY OFF?
   *
   * `roomToPass` is the cheap half and it is not sufficient: a T-junction has three ways
   * out and is still the only link between them, so counting exits accepts a tile whose
   * furniture severs the floor. `generate.ts` learned this for levers and pairs its width
   * test with a flood; this is the same pair, for the furniture `populate` owns.
   *
   * Asked in that order, so the flood only runs for tiles that already look wide enough.
   */
  const strands = (x: number, y: number): boolean => {
    const before = reach(-1);
    const i = grid.idx(x, y);
    if (!before[i]) return false;            // already unreachable; not our doing
    const after = reach(i);
    for (let j = 0; j < before.length; j++) {
      if (before[j] && !after[j] && j !== i) return true;
    }
    return false;
  };

  /** May something SOLID stand here at all: wide enough, and it strands nobody. */
  const canFurnish = (x: number, y: number): boolean =>
    roomToPass(x, y) && !strands(x, y);

  /**
   * Tiles of a room that touch a wall — where scenery belongs.
   *
   * A doorway tile touches wall on BOTH sides and was therefore a perfect candidate,
   * which is how a shelf ended up filling the only way into a room. Touching a wall is
   * where scenery looks right; having three ways out is what keeps it scenery rather
   * than architecture.
   */
  const wallTiles = (room: Room) =>
    room.tiles.filter(([x, y]) =>
      free(x, y) && canFurnish(x, y)
      && DIR_VEC.some(([dx, dy]) => !grid.walkable(x + dx, y + dy)));

  /** Tiles with room to move — where creatures belong. */
  const openTiles = (room: Room) =>
    room.tiles.filter(([x, y]) => free(x, y) && roomToPass(x, y));

  /**
   * THE CAPTIVE, in the first room that is not the entrance, the altar, the boss or the
   * stairs.
   *
   * A room off the critical path on purpose: the gate has to be optional. A player who cannot
   * open it — wrong element, wrong wizard — must still be able to finish the floor, so the
   * one thing the room may never contain is the way down.
   */
  // No gate, no captive: `Floor.create` re-rolls the floor until one exists, so reaching here
  // without a sealed room means the caller did not ask for one.
  let captivePlaced = !captive || grid.captiveRoom < 0;
  for (const room of grid.rooms) {
    if (!captivePlaced && captive && room.id === grid.captiveRoom) {
      const spot = openTiles(room).find(([x, y]) => canFurnish(x, y)) ?? openTiles(room)[0];
      if (spot) {
        out.push({
          kind: 'captive', sprite: captive.sprite, x: spot[0], y: spot[1],
          ox: 0, oz: 0, hover: 0, roomId: room.id, captiveId: captive.id,
        });
        furnish(spot[0], spot[1]);
        captivePlaced = true;
      }
    }

    // ---- the room's signature fixture --------------------------------------
    if (room.kind === 'altar') {
      /**
       * The centre unless the centre is a doorway.
       *
       * An altar is `SOLID` like everything else and this took `room.cx, room.cy` with
       * no test at all — fine in a room, and a room's "centre" in an L-shaped or
       * two-tile-wide one can be its own neck. The nearest tile to the centre that can
       * hold furniture is the same fallback the boss already uses, and for the same
       * reason: framing survives being one tile off, and being walled out does not.
       */
      const spot = room.tiles.filter(([x, y]) => free(x, y) && canFurnish(x, y))
        .sort((a, b) =>
          (Math.abs(a[0] - room.cx) + Math.abs(a[1] - room.cy))
          - (Math.abs(b[0] - room.cx) + Math.abs(b[1] - room.cy)))[0]
        ?? [room.cx, room.cy];
      out.push({
        kind: 'altar', sprite: 'altar', x: spot[0], y: spot[1],
        ox: 0, oz: 0, hover: 0, roomId: room.id,
      });
      furnish(spot[0], spot[1]);
    } else if (room.kind === 'boss') {
      /**
       * THE BOSS STANDS IN THE MIDDLE.
       *
       * It used to stand at the tile furthest from the player's entrance, which
       * framed the room nicely and sometimes wedged the boss behind the furniture
       * that had been scattered around it — and a wedged boss turns the fight into a
       * standoff against geometry rather than against a creature. A boss is the one
       * body on a floor that MUST be able to move: it is the only fight the floor is
       * built around, and the room is built around it.
       *
       * The centre is the tile most likely to have room, and `openTiles` is the test
       * for "has room" that creature placement already uses — so the fallback walks
       * outward to the nearest tile with three free neighbours rather than taking any
       * free tile, which is how it got wedged in the first place. Framing survives
       * anyway: the room is entered from an edge, so its middle is still ahead of you.
       */
      const roomy = openTiles(room);
      const spot = roomy.length
        ? roomy.reduce((best, t) =>
            (Math.abs(t[0] - room.cx) + Math.abs(t[1] - room.cy)) <
            (Math.abs(best[0] - room.cx) + Math.abs(best[1] - room.cy)) ? t : best)
        : room.tiles.find(([x, y]) => free(x, y));
      if (spot) {
        out.push({
          kind: 'boss', sprite: theme.boss, x: spot[0], y: spot[1],
          ox: 0, oz: 0, hover: depth === 1 ? 0.12 : 0, roomId: room.id,
        });
        claim(spot[0], spot[1]);
      }
      /**
       * The stairs are generated here and hidden, and MOVED to wherever the boss
       * falls (`Combat.kill`). Generating one and moving it beats spawning one on
       * death, because `entityAt`, the descend reach check and the minimap all
       * already know about this entity.
       */
      out.push({
        kind: 'stairs', sprite: 'stairs_down', x: room.cx, y: room.cy,
        ox: 0, oz: 0, hover: 0, roomId: room.id,
      });
    } else if (room.kind === 'treasure') {
      /**
       * The fallback used to be `room.tiles` — ANY tile, doorway included. A chest is
       * `SOLID` like a shelf, so a treasure room whose walls were all taken would put
       * its chest in the only way in. It falls back to the middle of the room instead,
       * and only to a raw tile if the room has nowhere passable at all.
       */
      const wall = wallTiles(room);
      const mid = room.tiles.filter(([x, y]) => free(x, y) && canFurnish(x, y));
      const spot = rng.pick(wall.length ? wall : mid.length ? mid : room.tiles);
      out.push({
        kind: 'chest', sprite: 'chest', x: spot[0], y: spot[1],
        // A SPENT chest is furniture, and every prop in this game is a spell
        // component — so it carries a risen form like the rest of them. Targeting
        // has accepted an open chest since phase 10; this is the body it wakes as.
        golem: 'g_chest',
        ox: 0, oz: 0, hover: 0, roomId: room.id,
      });
      furnish(spot[0], spot[1]);
    }

    // ---- props: the spell components ---------------------------------------
    // Every non-entrance room gets at least one, so "animate something" is
    // always a legal move.
    const wants = room.kind === 'entrance' ? 1
      : room.kind === 'boss' ? 3
      : rng.int(2, 3);
    /**
     * RE-CHECKED AS THEY GO, because each one narrows the room for the next.
     *
     * `wallTiles` is computed once against the room as it stands, so three props taken
     * off that one list can between them close a neck that each of them individually
     * left open. `roomToPass` counts furniture already placed, so asking it again at the
     * moment of placing is what makes the shelves aware of each other.
     */
    const spots = rng.shuffle(wallTiles(room));
    let put = 0;
    for (let i = 0; i < spots.length && put < wants; i++) {
      const [x, y] = spots[i];
      if (!canFurnish(x, y)) continue;
      put++;
      /**
       * ONE UNFINISHED GOLEM PER FLOOR, whatever the theme.
       *
       * It is the only source of clay, and clay is the only thing that wakes a body — so
       * a floor without one is a floor where animation does not exist. It is placed in
       * the prop loop rather than by its own pass so it competes for the same wall spots
       * everything else does, and it is deliberately NOT in `theme.props`: those lists
       * are index-paired with `theme.golems`, and this thing has no golem form.
       *
       * That absence is the fiction working. `Floor.animateProp` refuses anything with no
       * `golem`, so the half-made body cannot itself be woken — it is raw material, which
       * is exactly why you are taking clay off it.
       */
      const claySource = !clayPlaced && room.kind !== 'entrance'
        && (put === 1 || i === spots.length - 1);
      if (claySource) {
        clayPlaced = true;
        out.push({
          kind: 'prop',
          sprite: CLAY_PROP,
          x, y,
          ox: rng.range(-0.16, 0.16),
          oz: rng.range(-0.16, 0.16),
          hover: 0,
          roomId: room.id,
        });
        furnish(x, y);
        continue;
      }
      const pi = rng.int(0, theme.props.length - 1);
      out.push({
        kind: 'prop',
        sprite: theme.props[pi],
        golem: theme.golems[pi],
        x, y,
        // nudge scenery toward its wall so it does not sit dead centre
        ox: rng.range(-0.16, 0.16),
        oz: rng.range(-0.16, 0.16),
        hover: 0,
        roomId: room.id,
      });
      furnish(x, y);
    }

    // ---- enemies ----------------------------------------------------------
    const n = enemyCount(rng, depth, room);
    const open = rng.shuffle(openTiles(room));
    for (let i = 0; i < n && i < open.length; i++) {
      const [x, y] = open[i];
      const sprite = rng.pick(theme.enemies);
      // wraiths and moths and wasps fly; the rest walk
      const flies = /wraith|moth|wasp|acolyte/.test(sprite);
      out.push({
        kind: 'enemy', sprite, x, y,
        ox: rng.range(-0.12, 0.12), oz: rng.range(-0.12, 0.12),
        hover: flies ? rng.range(0.16, 0.3) : 0,
        flies,
        roomId: room.id,
      });
      claim(x, y);
    }
  }

  /**
   * A LEVER FOR EVERY LEVER TILE, outside the room loop.
   *
   * Placed off `grid.surface` rather than off a room, because the generator already
   * decided where they go and it decided using the whole floor — which rooms are far
   * from the boss, which are reachable with the door shut. Re-deriving that here from
   * room kinds would be a second opinion about the same question.
   *
   * It DOES claim its tile — `SOLID` in `game/floor.ts` lists it. That was not always
   * true: a lever used to be a tile you stood on, and this note used to say the
   * opposite. It became a thing you tap (`main.ts`, the `target` case) and solid with
   * it, and nothing in generation was told — which is how one ended up plugging a
   * one-wide corridor. `walkAround` and `plugs` in `generate.ts` are where that is now
   * answered, and they are the reason this comment has to stay accurate.
   */
  for (let i = 0; i < grid.surface.length; i++) {
    if (grid.surface[i] !== Surface.Lever) continue;
    const x = i % grid.w, y = (i / grid.w) | 0;
    out.push({
      kind: 'lever', sprite: 'lever', x, y,
      ox: 0, oz: 0, hover: 0, roomId: grid.roomOf[i] === 255 ? 0 : grid.roomOf[i],
    });
  }

  return out;
}

/** Every sprite id a floor needs, for preloading before the floor is shown. */
export function spriteIdsFor(theme: Theme): string[] {
  return [
    'altar', 'altar_empty', 'chest', 'chest_open', 'stairs_down', 'lever', 'lever_pulled',
    // Every floor has one, so it preloads with the fixed set rather than with a theme.
    CLAY_PROP,
    ...theme.props, ...theme.golems, ...theme.enemies, theme.boss,
  ];
}
