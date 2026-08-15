/**
 * What is on the FLOOR, as opposed to what is on a creature.
 *
 * This is a new kind of thing in the game. Everything that persists today lives on
 * a body as a status and dies with it; nothing has ever lived on a tile. Burning
 * ground was the first, and it is deliberately its own small module rather than
 * another field on `Floor`, because the parts that can go wrong — the ageing, the
 * clearing, and everything downstream that has to ask "is this tile dangerous" —
 * are the same questions every ground state asks.
 *
 * There are three now. Fire, and the two things that pour out of a broken container:
 * OIL, which is not dangerous until it meets a flame, and WATER, which is not
 * dangerous at all and is how you make a fire stop being. They share one map because
 * a tile holds ONE substance — a puddle that was also on fire would need a rule for
 * what that means, and the interesting answer is that the two react and leave a
 * third thing behind rather than coexisting.
 *
 * Keyed by tile index, which is the same key `Grid.flood` and `Grid.fill` speak, so
 * a volume's tiles become covered tiles without a translation step in between.
 */
import type { FillTile } from '../dungeon/grid';
import type { Element } from '../spells/spells';
import { FIRE_TURNS, SPILL_TURNS, PLANT_TURNS } from './tuning';

/**
 * Rounds of life a tile loses per step out from the middle of the spill, and the
 * floor under it. The falloff is what shrinks a patch inward instead of switching
 * the whole thing off at once; the floor is what stops the outer ring of a big
 * volume living zero rounds and flickering out on the frame it appears.
 */
const FALLOFF = 2;
const MIN_TURNS = 2;

/** What is lying on a tile. One per tile — see the header. */
export type Substance = 'fire' | 'oil' | 'water' | 'ice' | 'bramble' | 'briar';

/**
 * What happens when a substance arrives on a tile that already holds another.
 *
 * The whole reason spills are worth having. A barrel is not a pool of damage, it is
 * a way to change what the floor will do to the next spell — and these three rows
 * are the entire vocabulary:
 *
 *  - **oil meets fire: it goes up.** The tile burns, and burns from full, so oil
 *    poured into an old guttering fire is how you make a big one. This is the play
 *    the barrels exist for.
 *  - **water meets fire: steam.** Both are spent and the tile is left bare. Water is
 *    the only thing in the game besides Gust that puts fire out, and unlike Gust it
 *    does not cost a turn — it costs a barrel, which you had to have positioned.
 *  - **anything else: the newcomer wins.** Oil onto water is oil floating on it, and
 *    the useful reading of that is simply "the tile is oily now".
 *
 * Returns the substance the tile is left holding, or null for a bare tile.
 */
function react(
  had: Substance, got: Substance,
): { left: Substance | null; full: boolean } {
  if (had === 'oil' && got === 'fire') return { left: 'fire', full: true };
  if (had === 'fire' && got === 'oil') return { left: 'fire', full: true };
  if (had === 'water' && got === 'fire') return { left: null, full: false };
  if (had === 'fire' && got === 'water') return { left: null, full: false };
  /**
   * ICE, the fourth row, and the only one that is TRAVERSAL rather than damage.
   *
   * Frost onto standing water freezes it, which is the play — a puddle you made or
   * found becomes a floor you slide across, so a movement option exists without a
   * movement spell existing. Fire melts it straight back to the water it was, which
   * keeps the pair reversible and gives fire something to do to a tile besides burn
   * it. Frost onto bare ground still lays ice; it is just a smaller patch.
   */
  if (had === 'water' && got === 'ice') return { left: 'ice', full: true };
  if (had === 'ice' && got === 'fire') return { left: 'water', full: false };
  if (had === 'fire' && got === 'ice') return { left: null, full: false };

  /**
   * THE PLANTS, and they are the only substances that do not expire: a cast lays
   * them and they stay until something takes them away.
   *
   *  - **plant meets fire: it burns.** The tile is left burning from full, and that
   *    fire then runs along whatever else is growing beside it — see `age`. A thicket
   *    you regret is one Flame away from gone, and a thicket between you and a body
   *    with a torch is a mistake.
   *  - **plant meets water: nothing happens to it.** Water does not kill a plant; it
   *    is the one liquid that leaves the tile as it found it.
   *  - **plant onto ice or oil: the newcomer wins**, via the fallback. Nothing grows
   *    out of either, so there is no third thing worth authoring.
   */
  if (had === 'water' && got === 'bramble') return { left: 'bramble', full: true };
  if (had === 'bramble' && got === 'water') return { left: 'bramble', full: true };
  if (had === 'bramble' && got === 'fire') return { left: 'fire', full: true };
  if (had === 'fire' && got === 'bramble') return { left: 'fire', full: false };
  // Briar answers fire and water exactly as the undergrowth does. It is the same
  // plant, thicker — a rule that held for one and not the other would be two plants.
  if (had === 'water' && got === 'briar') return { left: 'briar', full: true };
  if (had === 'briar' && got === 'water') return { left: 'briar', full: true };
  if (had === 'briar' && got === 'fire') return { left: 'fire', full: true };
  if (had === 'fire' && got === 'briar') return { left: 'fire', full: false };
  /**
   * GRASS NEVER OVERWRITES BRIAR. The thicket is the grown thing; the undergrowth a
   * cast throws around itself must not mow it back down.
   *
   * Without this the fallback applied — newcomer wins — so a second Seed landing
   * beside an existing thicket erased it with its own surrounding grass, and the
   * player watched terrain they had spent a cast on get downgraded by the cast meant
   * to extend it. The other direction is already right through the fallback: grass
   * that takes a briar becomes briar.
   */
  if (had === 'briar' && got === 'bramble') return { left: 'briar', full: true };

  return { left: got, full: false };
}

/**
 * What FIRE SPREADS INTO — the fuels, and nothing else.
 *
 * Not a property of the substance list but a list of its own, because "burns" is a
 * smaller claim than "reacts with fire": ice reacts with fire and is not fuel, and a
 * fire that spread into ice would melt a frozen lake from one stray ember.
 */
const FLAMMABLE: ReadonlySet<Substance> = new Set<Substance>(['oil', 'bramble', 'briar']);

/**
 * A substance read back as the ELEMENT it is, so the floor can be an ingredient.
 *
 * The inverse of what `Combat` does when it pours: ice is what frost leaves and
 * bramble is what plant leaves, so a tile holding either answers as the element that
 * put it there. Without this a reaction could only ever fire when the player held
 * both pages at once, which is the version where the floor is scenery.
 */
export const SUBSTANCE_ELEMENT: Record<Substance, Element> = {
  fire: 'fire',
  oil: 'oil',
  water: 'water',
  ice: 'frost',
  bramble: 'plant',
  briar: 'plant',
};

/**
 * What a cast DOES to the ground it is aimed at.
 *
 *  - `grow`   the cast carried the same thing that is already there, so the patch
 *             tops up and spreads instead of being spent. Growth IS the payoff: the
 *             cast resolves on the pages the player held and takes no component.
 *  - `consume` the cast carried something that reacts with it, or simply something
 *             else. The ground joins the cast as its own element and the tile clears.
 *  - `clear`   gust, which puts things out and takes nothing.
 */
export type GroundUse = 'grow' | 'consume' | 'clear';

/**
 * Which elements FEED which substance.
 *
 * Same-element is the obvious half; the interesting half is that OIL feeds fire,
 * because oil is what fire eats — pouring oil onto a burning tile makes a bigger fire
 * rather than a fuelled cast, which is the same claim `react` already makes about a
 * broken barrel. Frost feeds water for the same reason: it is water in another state.
 */
const FEEDS: Record<Substance, readonly Element[]> = {
  fire: ['fire', 'oil'],
  oil: ['oil'],
  // Frost no longer feeds water — it FREEZES it, which is a reaction and not a
  // top-up. Leaving it here would have made the interesting case unreachable.
  water: ['water'],
  ice: ['frost', 'water'],
  // Only itself. Water does not feed bramble, it RIPENS it, which is a reaction —
  // the same distinction frost and water already make one line above.
  bramble: ['plant'],
  // Plant feeds BOTH of its own substances, and the grow path answers with `sow` —
  // briar at the centre, grass around it. It must not be a mismatch: a Seed aimed at
  // a body standing in briar would then be SPENT on the thicket, eating the terrain
  // the player had just made in order to power the cast that was meant to reinforce it.
  briar: ['plant'],
};

/**
 * What a cast carrying these elements does to a tile holding this substance.
 *
 * The whole rule in one function, because the alternative is the same decision made
 * three times — at the fuel lookup, at the pour, and in whatever draws the promise —
 * and those three drifting apart is how a mechanic stops being predictable.
 */
export function groundUse(what: Substance, elements: readonly Element[]): GroundUse {
  // Gust is the extinguisher and outranks everything: a cast that both clears and
  // feeds is a cast that clears.
  if (elements.includes('gust')) return 'clear';
  if (elements.some((e) => FEEDS[what].includes(e))) return 'grow';
  return 'consume';
}

/**
 * PLANTS DO NOT GROW OVER TIME. There is no clock on them and no generation count.
 *
 * A cast lays what it lays — briar where it was aimed, bramble around it — and that
 * is the end of it. The version before this one had the plant arrive as a seedling,
 * creep a ring per maturation and harden three rounds later into a grid surface,
 * which meant a spell that did nothing on the turn you spent it and terrain fire
 * could not touch once it set. Both were the same mistake: putting the plant's
 * strength in a clock instead of on the floor.
 */
interface Patch { what: Substance; turns: number }

export class Ground {
  /** Tile index -> what is on it and how long it lasts. */
  private patch = new Map<number, Patch>();

  /**
   * Which tiles refuse which substance, because of what the FLOOR is.
   *
   * One hook rather than a filter at each of the four call sites, so a rule about the
   * floor cannot be true of a cast and false of a broken barrel. Set by `Floor`, which
   * is the only thing that holds both a `Ground` and a `Grid` — this module deliberately
   * knows nothing about tiles beyond their index.
   *
   * There is exactly one rule in it today and it is shallow water refusing fire, which
   * is the whole of that surface: a wet quarter of a room is a quarter you cannot use
   * the game's best-loved verb in, visible from the doorway, and no new mechanic had to
   * be invented to say so.
   */
  refuses: (i: number, what: Substance) => boolean = () => false;

  /**
   * The neighbours of a tile, for spreading. Set by `Floor`, which knows the width
   * and which tiles are walkable; bramble creeping into solid rock would be growth
   * the player can neither see nor walk through.
   */
  neighbours: (i: number) => readonly number[] = () => [];

  /** What is on this tile, if anything. */
  at(i: number): Substance | null {
    return this.patch.get(i)?.what ?? null;
  }

  /** Is this tile on fire right now? */
  burning(i: number): boolean {
    return this.patch.get(i)?.what === 'fire';
  }

  /** Every covered tile with what is on it and the height to draw it at. */
  *patches(): Iterable<{ i: number; what: Substance; level: 1 | 2 | 3 }> {
    for (const [i, p] of this.patch) yield { i, what: p.what, level: this.level(i) };
  }

  /** Every burning tile — the minimap's question, and the fuel lookup's. */
  *fires(): Iterable<number> {
    for (const [i, p] of this.patch) if (p.what === 'fire') yield i;
  }

  get count(): number { return this.patch.size; }

  /**
   * Pour a substance over these tiles, thickest at the middle.
   *
   * `tiles` is expected in `Grid.fill` order — origin first, then outward — and the
   * duration is spent against that ordering: the centre gets the full life and every
   * ring out gets `FALLOFF` rounds less, floored so no tile is covered for nothing.
   *
   * This is what makes a fire DIE like a fire. Covering every tile with the same
   * countdown means the whole patch vanishes on one frame, which reads as the effect
   * being switched off rather than as burning out. Fuelling the edges less means the
   * outside goes first and the patch shrinks toward its middle, and — because height
   * is drawn from the same number — it lands as a dome rather than as a slab that
   * suddenly deflates.
   *
   * Where a tile is already covered, `react` decides what is left. Otherwise the new
   * patch takes the HIGHER of the two lifetimes rather than refreshing or stacking:
   * two volumes overlapping should leave one patch whose middles are both still
   * middles, and `Math.max` is the only rule that keeps a second cast from flattening
   * the dome the first one made.
   */
  pour(tiles: readonly FillTile[], what: Substance, turns: number): void {
    for (const { i, d } of tiles) {
      if (this.refuses(i, what)) continue;
      const life = Math.max(MIN_TURNS, turns - d * FALLOFF);
      const had = this.patch.get(i);
      if (!had || had.what === what) {
        this.patch.set(i, { what, turns: Math.max(had?.turns ?? 0, life) });
        continue;
      }
      const { left, full } = react(had.what, what);
      if (!left) { this.patch.delete(i); continue; }
      // A reaction burns from FULL rather than from what is left of either input —
      // oil going up is a new fire, not the remainder of an old one.
      this.patch.set(i, { what: left, turns: full ? FIRE_TURNS : life });
    }
  }

  /** Set tiles alight. The common case, kept as its own name for readability. */
  ignite(tiles: readonly FillTile[], turns = FIRE_TURNS): void {
    this.pour(tiles, 'fire', turns);
    this.flashover(tiles.map((t) => t.i), turns);
  }

  /**
   * OIL GOES UP ALL AT ONCE — the whole connected slick, on the frame it catches.
   *
   * The per-round creep in `age` is right for a thicket: a hedge burning along its
   * own length is something you watch and something you can outrun. It is wrong for
   * oil, which is the substance whose entire promise is that lighting one end lights
   * all of it. Waiting a round per tile made a slick you poured in front of something
   * a fire that arrived after it had walked out of it.
   *
   * ONLY OIL travels this way. Bramble and briar stay on the slow creep, so the two
   * fuels read as two different things — a fuse and a hedge — rather than one rule
   * with a speed setting.
   *
   * Breadth-first from every tile that just caught, which is why the seen set is
   * seeded with them: the flood is over the slick, and a tile already burning is not
   * a tile the fire has to cross.
   */
  private flashover(from: readonly number[], turns: number): void {
    const seen = new Set<number>(from);
    const queue = [...from];
    for (let head = 0; head < queue.length; head++) {
      for (const n of this.neighbours(queue[head])) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (this.patch.get(n)?.what !== 'oil') continue;
        if (this.refuses(n, 'fire')) continue;
        this.patch.set(n, { what: 'fire', turns });
        queue.push(n);
      }
    }
  }

  /** Spill a container's contents. */
  spill(tiles: readonly FillTile[], what: Substance): void {
    this.pour(tiles, what, SPILL_TURNS);
  }

  /**
   * Plant. BRIAR ON THE TILE IT WAS AIMED AT, bramble on everything around it.
   *
   * The gradient is SPATIAL, not temporal. What the cast catches is the thing you
   * aimed the cast at — one tile of standing thicket, which is difficult ground and
   * holds a body — and what it leaves around that is undergrowth: something to see,
   * something that burns, and nothing that entangles. A cast whose whole volume held
   * bodies would be a wall you can plant.
   *
   * `d` is the fill's distance from the centre, which the volume already carries, so
   * the target tile costs nothing to identify.
   *
   * Its own name rather than a `spill`, because a spill is a liquid running out and
   * this is two substances laid in one shape.
   */
  sow(tiles: readonly FillTile[]): void {
    for (const t of tiles) {
      this.pour([t], t.d === 0 ? 'briar' : 'bramble', PLANT_TURNS);
    }
  }

  /**
   * Clear these tiles completely, whatever was on them.
   *
   * Gust clears what it reaches rather than reducing it — "one shot maybe" was the
   * shape asked for, and a gust that halves a fire is a gust nobody casts. It takes
   * a puddle with it too, which is right: a gust that blew out a fire but left the
   * oil would be the single most confusing object in the game.
   */
  extinguish(tiles: Iterable<number>): number {
    let cleared = 0;
    for (const i of tiles) if (this.patch.delete(i)) cleared++;
    return cleared;
  }

  /**
   * How tall this tile's patch is drawn, 1 to 3.
   *
   * Height is remaining life and nothing else, so a fire visibly gutters as it runs
   * down and the player can read how long they have left to walk through it. Three
   * levels rather than a continuous scale because the world is drawn in texels and a
   * smoothly shrinking sprite in a pixel-art scene reads as a bug.
   */
  level(i: number): 1 | 2 | 3 {
    const p = this.patch.get(i);
    if (!p) return 1;
    // A plant has no remaining life to draw, so it is always drawn whole.
    if (p.what === 'bramble' || p.what === 'briar') return 3;
    const full = p.what === 'fire' ? FIRE_TURNS : SPILL_TURNS;
    if (p.turns > full * 0.6) return 3;
    if (p.turns > full * 0.25) return 2;
    return 1;
  }

  /**
   * Feed a patch: top it back up to full and let it spread to its neighbours.
   *
   * The reward for casting the same element into ground that already holds it. It
   * spreads by ONE ring rather than by the cast's volume, because growth should be
   * something you do repeatedly and deliberately — a single cast that doubled a fire
   * would make the first one the only one worth making.
   */
  feed(tiles: readonly FillTile[], what: Substance): number {
    let grown = 0;
    const full = what === 'fire' ? FIRE_TURNS : SPILL_TURNS;
    for (const { i } of tiles) {
      if (this.refuses(i, what)) continue;
      const had = this.patch.get(i);
      if (had && had.what !== what) continue;
      if (!had) grown++;
      this.patch.set(i, { what, turns: full });
    }
    return grown;
  }

  /**
   * One round older. Tiles that run out are bare again — EXCEPT bramble, which is
   * the one substance that does not expire but ARRIVES.
   *
   * Everything else on this map is something a spell left behind, burning down to
   * nothing. Brambles are alive: every round they creep one tile outward, and when
   * their clock runs out they do not vanish, they harden into briar. That inversion
   * is the whole of what plant is for — fire is a hazard you wait out, and a thicket
   * is a hazard that is still there when you come back.
   *
   * The spread is collected before anything is written, so growth from this round
   * cannot itself grow this round — otherwise a single seed floods the room on the
   * first tick instead of walking outward a ring at a time.
   */
  age(): void {
    /**
     * FIRE TRAVELS ON FUEL, and this is the whole rule.
     *
     * A burning tile sets light to any neighbour holding oil or plant. It needs no
     * generation cap the way the old bramble creep did, because the FUEL is the cap:
     * fire walks the length of a slick or a thicket and stops dead where that runs
     * out. Nothing catches bare ground, so a room does not burn down.
     *
     * Collected before anything is written, so a tile lit this round does not also
     * spread this round — otherwise a slick goes up end to end on the first tick
     * instead of running along itself a tile at a time, which is the part worth
     * watching and the part you can outrun.
     */
    const caught: number[] = [];
    for (const [i, p] of this.patch) {
      if (p.what !== 'fire') continue;
      for (const n of this.neighbours(i)) {
        const fuel = this.patch.get(n);
        if (!fuel || !FLAMMABLE.has(fuel.what)) continue;
        if (this.refuses(n, 'fire')) continue;
        caught.push(n);
      }
    }

    for (const [i, p] of [...this.patch]) {
      // Plants are not on a clock. They sit there until fire takes them or a gust
      // tears them out, which is what makes them terrain rather than weather.
      if (p.what === 'bramble' || p.what === 'briar') continue;
      if (p.turns > 1) { p.turns--; continue; }
      this.patch.delete(i);
    }

    // Lit AFTER the ageing pass, so a tile that just caught burns from full rather
    // than being aged on the turn it went up.
    for (const i of caught) this.patch.set(i, { what: 'fire', turns: FIRE_TURNS });
    // And a slick that catches from the room's own fire flashes over exactly as one
    // lit by a cast does — the rule is about oil, not about who struck the match.
    this.flashover(caught, FIRE_TURNS);
  }

  clear(): void { this.patch.clear(); }
}
