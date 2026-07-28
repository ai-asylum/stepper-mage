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
import { Grid, DIR_VEC, type Room } from '../dungeon/grid';
import type { Theme } from '../art/theme';

export type PlacedKind = 'prop' | 'enemy' | 'altar' | 'chest' | 'boss' | 'stairs';

export interface Placed {
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
  roomId: number;
}

/** How many enemies a room gets, by depth. Boss rooms get none — the boss is it. */
function enemyCount(rng: Rng, depth: number, room: Room): number {
  if (room.kind === 'boss' || room.kind === 'entrance') return 0;
  const base = room.kind === 'altar' ? 1 : 2;
  return Math.min(4, base + (depth >= 3 ? 1 : 0) + (rng.chance(0.35) ? 1 : 0));
}

export function populate(grid: Grid, theme: Theme, seed: string, depth: number): Placed[] {
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

  for (const room of grid.rooms) {
    // ---- the room's signature fixture --------------------------------------
    if (room.kind === 'altar') {
      out.push({
        kind: 'altar', sprite: 'altar', x: room.cx, y: room.cy,
        ox: 0, oz: 0, hover: 0, roomId: room.id,
      });
      claim(room.cx, room.cy);
    } else if (room.kind === 'boss') {
      // The boss stands at the far end so entering the room frames it.
      const far = room.tiles
        .filter(([x, y]) => free(x, y))
        .sort((a, b) =>
          (Math.abs(b[0] - grid.start.x) + Math.abs(b[1] - grid.start.y)) -
          (Math.abs(a[0] - grid.start.x) + Math.abs(a[1] - grid.start.y)))[0];
      if (far) {
        out.push({
          kind: 'boss', sprite: theme.boss, x: far[0], y: far[1],
          ox: 0, oz: 0, hover: depth === 1 ? 0.12 : 0, roomId: room.id,
        });
        claim(far[0], far[1]);
      }
      out.push({
        kind: 'stairs', sprite: 'stairs_down', x: room.cx, y: room.cy,
        ox: 0, oz: 0, hover: 0, roomId: room.id,
      });
    } else if (room.kind === 'treasure') {
      const spot = rng.pick(wallTiles(room).length ? wallTiles(room) : room.tiles);
      out.push({
        kind: 'chest', sprite: 'chest', x: spot[0], y: spot[1],
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
        roomId: room.id,
      });
      claim(x, y);
    }
  }

  return out;
}

/** Every sprite id a floor needs, for preloading before the floor is shown. */
export function spriteIdsFor(theme: Theme): string[] {
  return [
    'altar', 'altar_empty', 'chest', 'stairs_down',
    ...theme.props, ...theme.golems, ...theme.enemies, theme.boss,
  ];
}
