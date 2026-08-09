/**
 * What is on the FLOOR, as opposed to what is on a creature.
 *
 * This is a new kind of thing in the game. Everything that persists today lives on
 * a body as a status and dies with it; nothing has ever lived on a tile. Burning
 * ground is the first, and it is deliberately its own small module rather than
 * another field on `Floor`, because the parts that can go wrong — the ageing, the
 * clearing, and everything downstream that has to ask "is this tile dangerous" —
 * are the same three questions any future ground state will ask. Frost is the
 * obvious next candidate and the obvious way for this to become five systems
 * instead of one.
 *
 * Keyed by tile index, which is the same key `Grid.flood` and `Grid.fill` speak, so
 * a volume's tiles become burning tiles without a translation step in between.
 */
import type { FillTile } from '../dungeon/grid';
import { FIRE_TURNS } from './tuning';

/**
 * Rounds of fuel a tile loses per step out from the middle of the blast, and the
 * floor under it. The falloff is what shrinks a fire inward instead of switching
 * the whole patch off at once; the floor is what stops the outer ring of a big
 * volume being lit for zero rounds and flickering out on the frame it appears.
 */
const FALLOFF = 2;
const MIN_TURNS = 2;

export class Ground {
  /** Tile index -> rounds of fire left on it. */
  private fire = new Map<number, number>();

  /** Is this tile on fire right now? */
  burning(i: number): boolean {
    return this.fire.has(i);
  }

  /** Every burning tile, for the renderer and the minimap. */
  fires(): Iterable<number> {
    return this.fire.keys();
  }

  /** Every burning tile with the height it should be drawn at. */
  *flames(): Iterable<{ i: number; level: 1 | 2 | 3 }> {
    for (const i of this.fire.keys()) yield { i, level: this.level(i) };
  }

  get count(): number { return this.fire.size; }

  /**
   * Set tiles alight, hottest at the middle.
   *
   * `tiles` is expected in `Grid.fill` order — origin first, then outward — and the
   * duration is spent against that ordering: the centre gets the full burn and every
   * ring out gets `FALLOFF` rounds less, floored so no tile is lit for nothing.
   *
   * This is what makes a fire DIE like a fire. Lighting every tile with the same
   * countdown means the whole patch vanishes on one frame, which reads as the effect
   * being switched off rather than as burning out. Fuelling the edges less means the
   * outside goes dark first and the fire shrinks toward its middle, and — because
   * height is drawn from the same number — the patch is already a dome on the round
   * it lands rather than a slab that suddenly deflates.
   *
   * Re-lighting takes the HIGHER of the two, rather than refreshing or stacking. Two
   * volumes overlapping should leave one fire whose middles are both still middles,
   * and `Math.max` is the only rule that keeps a second cast from flattening the
   * dome the first one made.
   */
  ignite(tiles: readonly FillTile[], turns: number): void {
    for (const { i, d } of tiles) {
      const fuel = Math.max(MIN_TURNS, turns - d * FALLOFF);
      this.fire.set(i, Math.max(this.fire.get(i) ?? 0, fuel));
    }
  }

  /**
   * Put fire out on these tiles, completely.
   *
   * Gust clears what it reaches rather than reducing it — "one shot maybe" was the
   * shape asked for, and a gust that halves a fire is a gust nobody casts.
   */
  extinguish(tiles: Iterable<number>): number {
    let cleared = 0;
    for (const i of tiles) if (this.fire.delete(i)) cleared++;
    return cleared;
  }

  /**
   * How tall this tile's flame is, 1 to 3.
   *
   * Height is remaining fuel and nothing else, so a fire visibly gutters as it runs
   * down and the player can read how long they have left to walk through it. Three
   * levels rather than a continuous scale because the world is drawn in texels and a
   * smoothly shrinking sprite in a pixel-art scene reads as a bug.
   */
  level(i: number): 1 | 2 | 3 {
    const t = this.fire.get(i) ?? 0;
    if (t > FIRE_TURNS * 0.6) return 3;
    if (t > FIRE_TURNS * 0.25) return 2;
    return 1;
  }

  /** One round older. Tiles that run out stop burning. */
  age(): void {
    for (const [i, turns] of [...this.fire]) {
      if (turns <= 1) this.fire.delete(i);
      else this.fire.set(i, turns - 1);
    }
  }

  clear(): void { this.fire.clear(); }
}
