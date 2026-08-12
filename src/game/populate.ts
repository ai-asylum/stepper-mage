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
import { Grid, DIR_VEC, Surface, type Room } from '../dungeon/grid';
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

export function populate(
  grid: Grid, theme: Theme, seed: string, depth: number, captive: CaptiveSpot | null = null,
): Placed[] {
  const rng = new Rng(`${seed}-pop`);
  const out: Placed[] = [];
  const taken = new Set<number>();

  const claim = (x: number, y: number) => taken.add(grid.idx(x, y));
  const free = (x: number, y: number) =>
    grid.walkable(x, y) && !taken.has(grid.idx(x, y)) &&
    !(x === grid.start.x && y === grid.start.y);

  /** Tiles of a room that touch a wall — where scenery belongs. */
  const wallTiles = (room: Room) =>
    room.tiles.filter(([x, y]) =>
      free(x, y) && DIR_VEC.some(([dx, dy]) => !grid.walkable(x + dx, y + dy)));

  /** Tiles with room to move — where creatures belong. */
  const openTiles = (room: Room) =>
    room.tiles.filter(([x, y]) => {
      if (!free(x, y)) return false;
      let open = 0;
      for (const [dx, dy] of DIR_VEC) if (grid.walkable(x + dx, y + dy)) open++;
      return open >= 3;
    });

  /**
   * THE CAPTIVE, in the first room that is not the entrance, the altar, the boss or the
   * stairs.
   *
   * A room off the critical path on purpose: the gate has to be optional. A player who cannot
   * open it — wrong element, wrong wizard — must still be able to finish the floor, so the
   * one thing the room may never contain is the way down.
   */
  // Nothing to place when the generator could not seal a room on this floor's shape.
  let captivePlaced = !captive || grid.captiveRoom < 0;
  for (const room of grid.rooms) {
    if (!captivePlaced && captive && room.id === grid.captiveRoom) {
      const spot = openTiles(room)[0];
      if (spot) {
        out.push({
          kind: 'captive', sprite: captive.sprite, x: spot[0], y: spot[1],
          ox: 0, oz: 0, hover: 0, roomId: room.id, captiveId: captive.id,
        });
        claim(spot[0], spot[1]);
        captivePlaced = true;
      }
    }

    // ---- the room's signature fixture --------------------------------------
    if (room.kind === 'altar') {
      out.push({
        kind: 'altar', sprite: 'altar', x: room.cx, y: room.cy,
        ox: 0, oz: 0, hover: 0, roomId: room.id,
      });
      claim(room.cx, room.cy);
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
      const spot = rng.pick(wallTiles(room).length ? wallTiles(room) : room.tiles);
      out.push({
        kind: 'chest', sprite: 'chest', x: spot[0], y: spot[1],
        // A SPENT chest is furniture, and every prop in this game is a spell
        // component — so it carries a risen form like the rest of them. Targeting
        // has accepted an open chest since phase 10; this is the body it wakes as.
        golem: 'g_chest',
        ox: 0, oz: 0, hover: 0, roomId: room.id,
      });
      claim(spot[0], spot[1]);
    }

    // ---- props: the spell components ---------------------------------------
    // Every non-entrance room gets at least one, so "animate something" is
    // always a legal move.
    const wants = room.kind === 'entrance' ? 1
      : room.kind === 'boss' ? 3
      : rng.int(2, 3);
    const spots = rng.shuffle(wallTiles(room));
    for (let i = 0; i < wants && i < spots.length; i++) {
      const [x, y] = spots[i];
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
      claim(x, y);
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
   * It does NOT claim its tile. You throw a lever by standing on it, so a lever that
   * blocked its own tile would be a lever nobody can reach.
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
    ...theme.props, ...theme.golems, ...theme.enemies, theme.boss,
  ];
}
