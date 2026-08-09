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

  get count(): number { return this.fire.size; }

  /**
   * Set tiles alight.
   *
   * Re-lighting a tile REFRESHES it to the full duration rather than adding to it.
   * A player who keeps casting fire into the same doorway is holding it, not
   * building an ever-deeper fire, and a stacking duration would make the corridor
   * camp strictly better the longer it went on.
   */
  ignite(tiles: Iterable<number>, turns: number): void {
    for (const i of tiles) this.fire.set(i, turns);
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

  /** One round older. Tiles that run out stop burning. */
  age(): void {
    for (const [i, turns] of [...this.fire]) {
      if (turns <= 1) this.fire.delete(i);
      else this.fire.set(i, turns - 1);
    }
  }

  clear(): void { this.fire.clear(); }
}
