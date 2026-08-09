/**
 * Turn-based combat.
 *
 * The loop: the player takes ONE action, then every hostile and every allied
 * golem acts, then statuses tick. Turning in place is free — you should never be
 * punished for looking around, and on a phone that would make the camera
 * controls feel like a resource.
 *
 * There is NO mana. **A cast costs one turn. Moving costs one turn. Nothing else
 * costs anything** — tearing a page, harvesting a fixture and drawing off the belt
 * are all free, and so is putting any of them back. The price sits on the trigger
 * rather than on the decision, which is what stops the game punishing a change of
 * mind: the previous rule charged for taking a component and refunded nothing for
 * returning one, so drawing and cancelling in a loop handed the room free rounds.
 *
 * The consequence that everything downstream is balanced against: a cast holding
 * three elements costs exactly what a cast holding one costs, so a fusion is not
 * priced in turns at all. It is priced in HAND SLOTS, which come from the star
 * tree. `tuning.ts` is sized against a hand of ONE, the floor of that ladder.
 *
 * Every number that governs the TEMPO is in `tuning.ts` — the engage radius, the
 * interaction multipliers, the SHATTER threshold, the denial cap and the round
 * pacing all live there. If a fight feels wrong it is a tuning number that is
 * wrong. (The BFS expansion cap in `stepToward` is the one bare number left, and
 * it bounds an algorithm rather than a fight.)
 */
import { Rng } from '../core/rng';
import { DIR_VEC, type Grid } from '../dungeon/grid';
import { faceToward, type Entity, type Floor } from './floor';
import { affinityMult, affinityOf, type Affinities } from './affinity';
import {
  STATUS_META, displayName, harvestOf, isFixtureElement, resolveCast,
  isVolume,
  type CastTarget, type Element, type ResolvedCast, type StatusId,
} from '../spells/spells';
import { BOSS_INGREDIENTS, rollDropCount, rollIngredient, type BeltState } from '../spells/belt';
import { BELT_ENABLED } from '../flags';
import {
  ACT_PACE_MS, BOSS_DENIAL_BRACE, BURNING_DOT, CONDUCTION_ARC_RANGE,
  CONDUCTION_ARC_SHARE, CONDUCTION_MULT, DAMAGE_JITTER, DECAY_DOT, DEEP_FREEZE_MULT,
  DENIAL_BRACE, ENGAGE_RADIUS, GOLEM_AGGRO, OIL_FIRE_MULT, ROUND_PACE_MS,
  FIRE_TURNS, GROUND_FIRE_DOT, REACTION_REACH, SHATTER_DAMAGE, SHATTER_MULT, SPELL_REACH,
  bossDamage, enemyDamage,
} from './tuning';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface ActiveStatus { id: StatusId; turns: number; power: number; }

export interface Combatant {
  e: Entity;
  statuses: ActiveStatus[];
  /** Melee statuses this body applies (golem infusions). */
  infuse: StatusId[];
  damage: number;
  /**
   * Is this body IN the fight — did it decide to act on the last round?
   *
   * Written where `enemyRound` makes that decision and nowhere else, because that is
   * the only place the answer exists: a body is engaged when the player is close
   * enough for it to answer, and idle when the round walked past it. The HUD reads it
   * to auto-select the thing directly ahead, so "alerted" and "allowed to hit you"
   * are one fact rather than two that can drift.
   *
   * A body that lost its round to a freeze stays alerted. It is still in the fight —
   * `engaged` counts it — and dropping the reticle off something the moment you
   * denied it would take the target away exactly when the play worked.
   */
  alerted: boolean;
  /**
   * Rounds left during which round-denial cannot make this body skip. See
   * `DENIAL_BRACE` — it is what stops a 2-turn freeze from being permanent
   * against a player who only gets one action per round.
   */
  braced: number;
}

/** A page can be upgraded twice; past that a duplicate draw pays out a star. */
export const MAX_RANK = 3;

/**
 * The statuses that cost a body its whole action — the list `denied` skips on,
 * shared rather than restated because the HUD has to draw the same rule the round
 * enforces. A pip the fight ignores must not look like a pip the fight obeys.
 */
export const DENIAL_STATUSES: readonly StatusId[] = ['frozen', 'shocked', 'stagger'];

export interface PlayerState {
  hp: number;
  maxHp: number;
  /** Page ids in the book. Duplicates are allowed and empower casts. */
  pages: string[];
  /**
   * Rank per owned page, 1..MAX_RANK.
   *
   * Rank is expressed by counting the page as that many COPIES when the cast
   * resolves, which means it reuses the empowerment ladder that already exists
   * (Greater / Mighty) rather than bolting a separate damage multiplier on. A
   * rank-2 Fireball torn once resolves exactly as two torn Fireballs would.
   */
  ranks: Record<string, number>;
  stars: number;
  /**
   * Altar reroll charges in hand.
   *
   * On the RUN and not on `meta`, deliberately: a charge is spare agency over
   * this run's rolls, and one that survived the run would be a second currency
   * the star tree has to price against stars. Banked here, an unspent charge is
   * simply lost with everything else the run found.
   */
  rerolls: number;
  depth: number;
  /**
   * The ingredient belt — what is in the pouches and how many loops there are.
   *
   * On the RUN for the same reason `rerolls` is: `Roadmap/Ingredient_Belt.md` puts
   * ingredients surviving a run out of scope, so an unspent vial is lost with
   * everything else the run found. Its CAPACITY comes from the star tree and is
   * written in one place (`syncBelt` in `main.ts`).
   */
  belt: BeltState;
}

/**
 * `deny` is any action that did not happen: a cast the rules refused, or a body
 * that lost its round to a status. The two are told apart by `at` — a refusal
 * answers something the player just did and belongs in the log, a lost round
 * belongs over the body that lost it.
 */
export type LogKind = 'cast' | 'hit' | 'status' | 'death' | 'info' | 'deny' | 'discover';

export interface GameEvent {
  kind: LogKind;
  text: string;
  colour?: number;
  /** World tile to anchor a floater over, if any. */
  at?: { x: number; y: number };
  amount?: number;
}

// -------------------------------------------------------------- object reactions

/**
 * What an object does when it is hit with the element it answers to.
 *
 * The third of `docs/DESIGN.md`'s three uses per object, and the one that is NOT a
 * fusion: aiming a spell at a candelabra to borrow its fire was rejected, because
 * then the element and the target are the same slot. Here the object IS the target,
 * on purpose, and the payoff is spatial — everything beside it pays.
 */
export interface ReactionDef {
  /**
   * The reticle's promise, before the cast. A reaction the player only ever
   * discovers afterwards reads as the spell having misfired.
   */
  verb: string;
  colour: number;
  /** Dealt to every hostile the reaction reaches, in full — this is not a volley. */
  damage: number;
  status?: StatusId;
  /**
   * Which tiles pay. `around` is all eight neighbours; `ahead` is the one tile on
   * the far side of the object from the player, and `cone` is that tile plus its two
   * shoulders — the object is between you and the payoff, which is the whole reason
   * to shoot the furniture instead of the enemy.
   */
  shape: 'around' | 'ahead' | 'cone';
}

/**
 * Keyed on `<what the object is>+<element that arrives>`, and the left half is a
 * FIXTURE ELEMENT ID (`harvestOf`) rather than a sprite id wherever the doc's row
 * is about the object's nature — an oil drum and an ale barrel are both a barrel of
 * something that burns, and a table listing sprites would need a new row for every
 * theme's version of the same object. Sprite ids are used only where the row is
 * about that one object: a cauldron of water boils where a barrel of it does not,
 * and a bone pile is not a tap for anything at all.
 *
 * The damage numbers are sized against `enemyHp` (10 at depth 1, 22 at depth 5): the
 * cast that sets a reaction off spends its own hit on the furniture, so a reaction
 * has to be worth a whole cast against a GROUP and worth nothing against a lone
 * body. An explosion kills a mook outright at any depth and that is the point;
 * standing three enemies around a drum is the best turn in the game, and there is
 * exactly one drum.
 */
const REACTIONS: Record<string, ReactionDef> = {
  'oil+fire': { verb: 'EXPLODES', colour: 0xff8a1a, damage: 22, status: 'burning', shape: 'around' },
  'water+spark': { verb: 'CONDUCTS', colour: 0xffe14a, damage: 14, status: 'shocked', shape: 'around' },
  // Denial rather than damage: the spill freezes and whatever is standing in it is
  // held. Under SHATTER_DAMAGE deliberately, so the ice it makes can still be broken.
  'water+frost': { verb: 'FREEZES THE FLOOR', colour: 0x7ad4ff, damage: 4, status: 'frozen', shape: 'around' },
  'flame+gust': { verb: 'WASHES FLAME', colour: 0xff7a2b, damage: 12, status: 'burning', shape: 'ahead' },
  'stone+gust': { verb: 'TOPPLES', colour: 0xa89880, damage: 16, status: 'stagger', shape: 'around' },
  'f2_prop_cauldron+fire': {
    verb: 'BOILS OVER', colour: 0xd8eaf0, damage: 10, status: 'burning', shape: 'around',
  },
  'f2_prop_bonepile+gust': {
    verb: 'THROWS SHRAPNEL', colour: 0xe8e0c8, damage: 12, shape: 'cone',
  },
};

/**
 * What this object would do if this set of elements arrived, or null.
 *
 * Exported because the HUD has to say it on the reticle before the cast is released
 * — the same table answering both questions is what stops the promise and the payoff
 * from drifting apart.
 */
export function reactionFor(spriteId: string, elements: Element[]): ReactionDef | null {
  const nature = harvestOf(spriteId);
  for (const el of elements) {
    // The object's own row first, so a cauldron is a cauldron before it is water.
    const r = REACTIONS[`${spriteId}+${el}`] ?? (nature ? REACTIONS[`${nature}+${el}`] : undefined);
    if (r) return r;
  }
  return null;
}

/**
 * Whether setting an object off uses it up.
 *
 * `docs/DESIGN.md` leaves this explicitly undecided (`## Open — not decided`), so
 * this is the minimum that ships and it is one constant. TRUE, for two reasons that
 * are not the design's to make: an object that survives being detonated is an
 * unlimited room-wide damage engine, which is the same exploit that got depleting
 * harvests rejected; and "three uses per object, mutually exclusive" is only true if
 * setting it off spends it the way animating it does. Harvesting stays
 * non-depleting — you take nothing FROM the object, which is the rule that pairs
 * with non-storable.
 */
const REACTION_SPENDS_THE_OBJECT = true;

/** Where a reaction went off and what it reached, so the renderer can show it. */
export interface ReactionFx {
  colour: number;
  at: { x: number; y: number };
  tiles: { x: number; y: number }[];
}

export class Combat {
  readonly state: PlayerState;
  private combatants = new Map<Entity, Combatant>();
  private rng: Rng;
  /**
   * A stream of its own for what a boss leaves behind.
   *
   * Not `this.rng`, deliberately: that one rolls the damage jitter every round, so
   * drawing loot from it would shift every later swing on the floor. A drop is not
   * allowed to change a fight, and a separate stream is how that is structural
   * rather than a claim about call order.
   */
  private dropRng: Rng;
  /** Rooms whose encounter has been triggered. */
  private engaged = new Set<number>();
  bossDead = false;
  /**
   * Turns spent this run, incremented inside `enemyRound` because that is what a
   * turn IS — every price in the game is paid by handing the room one round, and
   * there are exactly two things that pay it: releasing a cast and stepping. So
   * this is the one honest count of "the player spent a turn", which the playable
   * ad paces its CTA against.
   *
   * Counting it in the round rather than at the two call sites is deliberate: a
   * third thing that ever costs a turn cannot be added without going through
   * `enemyRound`, so it cannot be added without being counted.
   */
  turns = 0;
  /** Fusion names already announced this run. */
  private discovered = new Set<string>();

  onEvent: (e: GameEvent) => void = () => {};
  /** Fired so the renderer can throw a projectile / burst. */
  onCastFx: (cast: ResolvedCast, from: Entity | null, targets: Entity[]) => void = () => {};
  /**
   * Fired when an object goes off. Separate from `onCastFx` because the blast comes
   * from the OBJECT and not from the player's hands — which is the whole thing the
   * player has to read off it.
   */
  onReactionFx: (fx: ReactionFx) => void = () => {};
  onPlayerHurt: (amount: number, by: Entity | null) => void = () => {};
  /**
   * What the player has learned this run, by sprite id.
   *
   * On the COMBAT and not on the entity, because the entity dies and the lesson
   * should not die with it.
   */
  private learned = new Map<string, Map<Element, Affinities>>();
  /**
   * Fired the first time a species/element pair is found out, and never again for
   * that pair. The HUD turns it into the discovery banner.
   */
  onDiscover: (spriteId: string, element: Element, kind: Affinities) => void = () => {};
  /**
   * A boss's ingredient drop, one call per vial.
   *
   * Routed out rather than applied here: WHAT a boss pays is combat's business and
   * whether there is anywhere to keep it is the belt's, and the refusal has to be
   * said in the player's words by the one place that already says everything else in
   * them. Returns false when the belt would not take it, so the log can be honest.
   */
  onIngredientDrop: (id: string) => boolean = () => false;

  constructor(private floor: Floor, state: PlayerState, seed: string) {
    this.state = state;
    this.rng = new Rng(`${seed}-combat`);
    this.dropRng = new Rng(`${seed}-drops`);
    for (const e of floor.entities) this.register(e);
  }

  private register(e: Entity): void {
    if (!['enemy', 'boss'].includes(e.kind) && !e.animated) return;
    this.combatants.set(e, {
      e, statuses: [], infuse: [], braced: 0, alerted: false,
      damage: e.kind === 'boss' ? bossDamage(this.state.depth) : enemyDamage(this.state.depth),
    });
  }

  statusesOf(e: Entity): ActiveStatus[] {
    return this.combatants.get(e)?.statuses ?? [];
  }

  has(e: Entity, id: StatusId): boolean {
    return this.statusesOf(e).some((s) => s.id === id && s.turns > 0);
  }

  /**
   * Rounds during which round-denial cannot touch this body — see `denied`.
   *
   * Exposed for the HUD. The brace is half of the rhythm a hand-size-1 run is won
   * on (a freeze spent inside it is wasted), and it was the half with no
   * representation anywhere on screen, so the player could see the freeze land and
   * never see why it sometimes bought nothing.
   */
  bracedFor(e: Entity): number {
    return this.combatants.get(e)?.braced ?? 0;
  }

  /**
   * Is this body awake and in the fight — moving or attacking rather than idle?
   *
   * Exposed for the reticle. An enemy that is coming for you is the one thing the
   * player must not have to tap to fight, and "coming for you" is a decision the
   * ROUND makes (see `Combatant.alerted`); asking the entity would only ever be a
   * guess about distance that the round could disagree with.
   */
  isAlerted(e: Entity): boolean {
    return this.combatants.get(e)?.alerted === true;
  }

  // ------------------------------------------------------------------ casting

  /**
   * Expand torn pages by their rank, so an upgraded page empowers the cast
   * without the player having to tear the same spell twice.
   *
   * A HARVESTED element is always exactly one copy, whatever else is in the hand.
   * Three things enforce that and it is worth all three, because it is the only
   * thing making the page strictly better than the furniture:
   *  1. A fixture element has its own id (harvested fire is `flame`, not `fire`),
   *     and ids are the `SPELL_BY_ID` key, so it cannot collide with a page.
   *  2. `ELEMENT_SPELLS` — the pool the book, the altar and the loadout draw from —
   *     holds page elements only, so nothing ever writes a rank for a fixture id.
   *  3. This clause, which forces 1 even if the other two were wrong. A rule, not
   *     a lookup that happens to miss.
   */
  private byRank(pages: string[]): string[] {
    const out: string[] = [];
    for (const id of pages) {
      const n = isFixtureElement(id) ? 1 : Math.max(1, this.state.ranks[id] ?? 1);
      for (let i = 0; i < n; i++) out.push(id);
    }
    return out;
  }

  /** Can this selection be cast at this target right now? */
  preview(pages: string[], target: CastTarget): ResolvedCast {
    return resolveCast(this.byRank(pages), target);
  }

  /**
   * FIRE ON THE GROUND IS A COMPONENT.
   *
   * Cast into a burning tile and the fire already there joins the spell as extra
   * fire slots — one per flame level, so a fresh full-height fire is worth three and
   * a guttering one is worth one. They go through `resolveCast` as ordinary fire
   * ids, which means this does not merely make a cast bigger: it can change what the
   * cast IS. Frostbolt into a fire is Steam Burst, and the player never had to be
   * holding fire to get there.
   *
   * This is the harvest rule (`docs/DESIGN.md` — every prop is a spell component)
   * extended to the floor, and it is what stops burning ground being purely a
   * penalty. Fire you laid down last round is fuel you can spend this round, which
   * gives a volume a second reason to exist beyond area denial.
   *
   * PUBLIC because the HUD has to preview the same spell the cast will produce. A
   * fusion the player only discovers after committing the turn reads as the game
   * having changed its mind, which is the same defect the reaction verbs exist to
   * avoid — see `ReactionDef.verb`.
   */
  withGroundFuel(
    pages: string[], targetEntity: Entity | null,
  ): { pages: string[]; fuel: number; at: number } {
    const g = this.floor.grid;
    const at = targetEntity
      ? g.idx(targetEntity.sprite.tx, targetEntity.sprite.ty)
      : g.idx(this.playerTile.x, this.playerTile.y);
    const fuel = this.floor.ground.burning(at) ? this.floor.ground.level(at) : 0;
    return {
      pages: fuel ? [...pages, ...Array<string>(fuel).fill('fire')] : pages,
      fuel,
      at,
    };
  }

  /**
   * Release the assembled cast — **the one place a spell costs a turn.**
   *
   * Returns true if the spell actually went off, and true is therefore also "a
   * round was run". False means the cast was refused: the hand is untouched, the
   * room does not act, and the caller keeps the pages. Assembling cost nothing, so
   * a refusal has to cost nothing either or changing your mind is punished again.
   *
   * The round runs AFTER the effect lands, which is not an implementation detail —
   * it is worth roughly one round a fight, because a body killed by the cast never
   * gets to answer it and a status lands in time to touch the very next round.
   * `tuning.ts` is sized against that ordering.
   *
   * `targetEntity` is the tapped thing. A volley (`count > 1`) spreads across
   * DISTINCT bodies and stops when it runs out of them — extra projectiles are
   * lost rather than wrapping back onto the primary. That single rule is what
   * keeps the rank ladder honest now that rank and hand size are priced in the
   * same unit: both make one turn's cast bigger, rank buys WIDTH plus 15% a copy
   * for one slot, and an extra element buys a whole extra element. "Better against
   * a group, worse against one thing" is true of every volley in the game.
   */
  async cast(pages: string[], targetEntity: Entity | null): Promise<boolean> {
    const target: CastTarget = targetEntity
      ? {
          kind: targetEntity.animated ? 'golem'
            : targetEntity.kind === 'prop' ? 'prop'
            : targetEntity.kind === 'boss' ? 'boss'
            : targetEntity.kind === 'chest' ? 'chest'
            : 'enemy',
          propId: targetEntity.kind === 'prop' && !targetEntity.animated
            ? targetEntity.spriteId : undefined,
        }
      : { kind: 'none' };

    const { pages: withFuel, fuel, at: fuelAt } = this.withGroundFuel(pages, targetEntity);

    const cast = this.preview(withFuel, target);

    /**
     * Scavenged fire feeds the cast but never inflates its VOLUME.
     *
     * Without this the mechanic is a runaway with gain greater than one: fire picked
     * up off a tile made the cast bigger, a bigger cast lit more tiles, and more
     * tiles meant more to pick up next round. Measured, it took the gated line from
     * clearing 5 of 5 seeds to 1, dying as early as floor 1 — the volume outgrew the
     * room and caught the caster every time.
     *
     * Capped to the volume the hand alone would have produced, so the fire still
     * folds into the cast's IDENTITY and its damage — a Frostbolt thrown into a fire
     * is still a Steam Burst, which is the whole point — and only the area is held
     * where the player put it. The loop keeps its payoff and loses its gain.
     */
    if (fuel) cast.volume = Math.min(cast.volume, this.preview(pages, target).volume);

    if (cast.refusal) {
      this.onEvent({ kind: 'deny', text: cast.refusal });
      return false;
    }

    /**
     * The fire is CONSUMED. A tile that could be re-harvested every round would make
     * standing beside a fire strictly better than anything else in the game, and
     * spending it is what makes "when do I cash this in" a decision.
     */
    if (fuel) {
      this.floor.ground.extinguish([fuelAt]);
      this.syncGround();
      this.onEvent({
        kind: 'status',
        text: fuel > 1 ? `THE FIRE FEEDS IT \u00d7${fuel}!` : 'THE FIRE FEEDS IT!',
        colour: 0xff7a2b,
      });
    }

    this.onEvent({
      kind: 'cast', text: cast.name.toUpperCase() + '!', colour: cast.colour,
    });
    // A discovery is a genuine multi-page fusion seen for the first time this
    // run. Firing it for a solo Fireball cheapens the moment to noise.
    const distinctPages = new Set(pages).size;
    if (cast.authored && distinctPages >= 2 && !this.discovered.has(cast.name)) {
      this.discovered.add(cast.name);
      this.onEvent({ kind: 'discover', text: `✦ ${cast.name} discovered ✦`, colour: cast.colour });
    }

    if (cast.output === 'golem') {
      if (!targetEntity) return false;
      // `cast.count` carries the risen body's HP — golems have no volley — and the
      // floor adds its depth term on top. Handed over rather than assigned after,
      // because assigning it here is what used to make the floor's own scaling dead.
      const ok = await this.floor.animateProp(targetEntity, cast.count);
      if (!ok) {
        this.onEvent({ kind: 'deny', text: 'That will not wake.' });
        return false;
      }
      this.register(targetEntity);
      const c = this.combatants.get(targetEntity)!;
      c.damage = cast.damage;
      c.infuse = cast.infuse;
      this.onCastFx(cast, null, [targetEntity]);
      // Waking something is a cast, so it is a turn, so the room answers. Charged
      // here and not once at the bottom because the golem branch returns early —
      // and a summon that bought the player a free round would be the one cast in
      // the game worth spamming.
      await this.enemyRound();
      return true;
    }

    /**
     * Spread a volley across distinct hostiles, primary first — but only across the
     * ones the cast can actually REACH.
     *
     * This used to take any hostile that was alive, anywhere on the floor, which is
     * how a blast in one room killed something in the next. The flood answers it by
     * path: a body on the far side of a wall is simply not in the distance map, and
     * a body round the corner of the doorway you fired past is.
     */
    const centre = targetEntity
      ? { x: targetEntity.sprite.tx, y: targetEntity.sprite.ty }
      : this.playerTile;
    const reach = this.reachFrom(centre.x, centre.y, SPELL_REACH);
    const inReach = (e: Entity) => this.reached(reach, e.sprite.tx, e.sprite.ty);

    const hostiles = this.floor.entities.filter((e) => e.alive && e.hostile && inReach(e));
    const order: Entity[] = [];
    if (targetEntity) order.push(targetEntity);
    for (const h of hostiles) if (h !== targetEntity) order.push(h);
    const targets = order.slice(0, cast.count);

    this.onCastFx(cast, null, targets);

    for (const t of targets) {
      this.applyCast(cast, t);
    }

    /**
     * A VOLUME fills tiles, and the player is standing on one of them or is not.
     *
     * The fill is thrown AWAY from the caster, so an open room takes the whole
     * volume down the room and never reaches back. What brings it back is the room
     * running out of anywhere else to put it — a dead end, a doorway you are
     * standing in, a corner you backed yourself into. That is the lever the phase
     * exists for, and it is a fact about the geometry rather than a tax on casting
     * fire at all: the player who gets burnt made a positioning mistake and can see
     * which one.
     *
     * It can kill. The same rules as an enemy, no exception carved for the person
     * holding the book.
     */
    if (isVolume(cast.elements)) {
      const g = this.floor.grid;
      const away: [number, number] = [
        Math.sign(centre.x - this.playerTile.x),
        Math.sign(centre.y - this.playerTile.y),
      ];
      const filled = g.fill(centre.x, centre.y, cast.volume, away);
      const onPlayer = g.idx(this.playerTile.x, this.playerTile.y);
      if (filled.some((t) => t.i === onPlayer)) this.burnCaster(cast);

      /**
       * The volume LEAVES something behind, and that is also how the player finally
       * gets to see where it went.
       *
       * Fire on the ground is the hazard `Roadmap/Burning_Ground.md` is about, but
       * it is doing a second job here that is worth naming: a volume is invisible at
       * the instant it goes off, so the burning tiles are the only readout of what
       * the blast actually covered. Draw it before tuning it.
       *
       * Gust clears what it reaches, in full — the other half of the loop, and the
       * reason gust is a volume at all.
       */
      if (cast.elements.includes('fire')) this.floor.ground.ignite(filled, FIRE_TURNS);
      if (cast.elements.includes('gust')) this.floor.ground.extinguish(filled.map((t) => t.i));
      this.syncGround();
    }

    await this.enemyRound();
    return true;
  }

  /**
   * The tiles an effect centred here reaches, as path distance.
   *
   * Walls stop it and nothing else does — not rooms, which are not airtight, and
   * not line of sight, which refuses to go round a corner and so models an arrow
   * rather than an explosion. Bodies do not block it either: a blast rolls over
   * the thing it just hit.
   */
  private reachFrom(x: number, y: number, radius: number): Int16Array {
    return this.floor.grid.flood(x, y, radius);
  }

  /**
   * Did a flood get to this tile? Bounds-checked, because a reaction's SHAPE is
   * arithmetic off the object's tile and can name a square outside the grid — and
   * an out-of-range read is `undefined`, which is not -1 and would sail through a
   * bare comparison as if the blast had reached it.
   */
  private reached(dist: Int16Array, x: number, y: number): boolean {
    const g = this.floor.grid;
    return g.inside(x, y) && dist[g.idx(x, y)] !== -1;
  }

  /**
   * The player's own volume, catching the player.
   *
   * Full damage and it can kill — the same rules as the enemy standing next to
   * them. Softening it would be designing out the one thing that gives fire a
   * cost, and a lever nobody respects is not a lever.
   */
  private burnCaster(cast: ResolvedCast): void {
    const dmg = Math.max(1, cast.damage);
    this.state.hp -= dmg;
    this.onPlayerHurt(dmg, null);
    this.onEvent({
      kind: 'hit', text: `Your own ${cast.name.toLowerCase()} catches you for ${dmg}.`,
      colour: cast.colour,
    });
  }

  /**
   * Land one projectile on one entity, running the elemental interactions.
   * These are the plays worth learning — soak something, then shock it.
   */
  private applyCast(cast: ResolvedCast, t: Entity): void {
    let damage = cast.damage;
    const c = this.combatants.get(t);
    let glow = cast.colour;

    const brings = (id: StatusId) => cast.statuses.some((s) => s.id === id);

    if (c) {
      // CONDUCTION: shock on a soaked body hits harder and arcs onward.
      if (brings('shocked') && this.has(t, 'soaked')) {
        damage = Math.round(damage * CONDUCTION_MULT);
        glow = 0xffe14a;
        this.onEvent({ kind: 'status', text: 'CONDUCTION!', colour: 0xffe14a });
        // The arc walks the grid like everything else. A charge does not jump
        // through a wall to a body in the next room.
        const arc = this.reachFrom(t.sprite.tx, t.sprite.ty, CONDUCTION_ARC_RANGE);
        const other = this.floor.entities.find(
          (o) => o !== t && o.alive && o.hostile &&
            this.reached(arc, o.sprite.tx, o.sprite.ty),
        );
        if (other) {
          this.damage(other, Math.round(damage * CONDUCTION_ARC_SHARE), 0xffe14a);
          this.addStatus(other, 'shocked', 1);
        }
      }
      // STEAM: fire on a soaked body boils the water off instead of burning it.
      if (brings('burning') && this.has(t, 'soaked')) {
        this.removeStatus(t, 'soaked');
        this.addStatus(t, 'stagger', 1);
        this.onEvent({ kind: 'status', text: 'STEAM!', colour: 0xbfe8ff });
      }
      /**
       * IGNITE: fire and oil meet on a body, and it does not matter which arrived
       * first — one clause for both orders, because a player who lights something
       * and then oils it has made the same play backwards and should get the same
       * answer. The oil is spent either way, so this is one flare and not a
       * standing multiplier.
       *
       * Ahead of the shatter check on purpose: a doubled hit that clears
       * SHATTER_DAMAGE should break the ice, and oil into fire is the cheapest way
       * a hand of one ever gets to that threshold.
       */
      const ignited = (brings('burning') && this.has(t, 'oiled'))
        || (brings('oiled') && this.has(t, 'burning'));
      if (ignited) {
        damage = Math.round(damage * OIL_FIRE_MULT);
        this.removeStatus(t, 'oiled');
        glow = 0xffb04a;
        this.onEvent({ kind: 'status', text: 'IGNITE!', colour: 0xffb04a });
      }
      /**
       * SHATTER: a heavy hit on a frozen body breaks it open — and the shell does
       * NOT re-form from the same cast.
       *
       * Both halves matter. The threshold is a rank-1 Frostbolt exactly, because
       * at hand size 1 Frostbolt is the only thing that freezes and a valve the
       * one freezing tool cannot reach is not a valve. And suppressing the
       * incoming freeze is what makes frost-on-frost a CHOICE rather than a lock:
       * the second bolt either burst-damages a frozen body or holds it, never both.
       *
       * `cast.pierce` is the threshold's one exemption, and the only thing
       * Starlight does that no page can: a piercing hit opens the shell however
       * light it is. It is still an either/or — piercing a freeze spends it.
       */
      const shattered = this.has(t, 'frozen') && (cast.pierce || damage >= SHATTER_DAMAGE);
      if (shattered) {
        damage = Math.round(damage * SHATTER_MULT);
        this.removeStatus(t, 'frozen');
        glow = 0x7ad4ff;
        this.onEvent({ kind: 'status', text: 'SHATTER!', colour: 0x7ad4ff });
      }
      // Fire melts a freeze rather than stacking with it.
      if (brings('burning') && this.has(t, 'frozen')) this.removeStatus(t, 'frozen');
      // Frost bites deeper through water.
      const deepFreeze = brings('frozen') && this.has(t, 'soaked');

      for (const s of cast.statuses) {
        if (s.id === 'frozen' && shattered) continue;
        // The oil just went up, so it is not also left sitting on the body.
        if (s.id === 'oiled' && ignited) continue;
        const mult = s.id === 'frozen' && deepFreeze ? DEEP_FREEZE_MULT : 1;
        this.addStatus(t, s.id, Math.max(1, Math.round(STATUS_META[s.id].turns * s.power * mult)));
      }
    }

    /**
     * AFFINITY, applied last so it scales the whole cast — combos included.
     *
     * A cast can carry several elements (Meteor is fire and stone), and the BEST of
     * them wins rather than the product. Multiplying them would make a two-element
     * cast against a creature that resists one of them worse than either element
     * alone, which is exactly backwards: a fusion is supposed to be the answer to a
     * body you cannot solve with one page.
     */
    // Learn EVERY element the cast carried, including the ones that changed nothing.
    // An ordinary result is a result: it is the difference between "I tried frost on
    // these and it was nothing special" and "I have never tried frost on these".
    if (damage > 0) for (const el of cast.elements) {
      this.learn(t, el, affinityOf(t.spriteId, el));
    }
    const mult = cast.elements.length
      ? Math.max(...cast.elements.map((el) => affinityMult(t.spriteId, el)))
      : 1;
    if (mult !== 1 && damage > 0) {
      damage = Math.max(1, Math.round(damage * mult));
      const weak = mult > 1;
      this.onEvent({
        kind: 'status',
        text: weak ? 'WEAK!' : 'RESISTED',
        colour: weak ? 0xffd166 : 0x8aa0b8,
      });
      glow = weak ? 0xffd166 : glow;
    }

    this.damage(t, damage, glow);

    if (cast.shove) this.shove(t, cast.shove);

    // Last, so the object has already taken the hit it was aimed at: the primary
    // damage is the player's, and what follows is the room's.
    this.react(cast, t);
  }

  /**
   * The object goes off.
   *
   * Announced as `<OBJECT> · <VERB>` through the `status` channel that carries
   * SHATTER and CONDUCTION, because the one thing that has to survive the noise of a
   * cast resolving is that the BARREL did this and not the spell. The damage lands
   * as ordinary floaters over the bodies beside it, which is the same sentence said
   * spatially.
   */
  private react(cast: ResolvedCast, t: Entity): void {
    if (t.kind !== 'prop' || t.animated || !t.alive) return;
    const r = reactionFor(t.spriteId, cast.elements);
    if (!r) return;

    // A reaction obeys the same bound as the cast that set it off: the shape says
    // which tiles it WANTS, the flood says which of them it can get to. A barrel
    // against a wall no longer sprays through it.
    const blast = this.reachFrom(t.sprite.tx, t.sprite.ty, REACTION_REACH);
    const tiles = this.reactionTiles(t, r.shape).filter((p) => this.reached(blast, p.x, p.y));

    this.onEvent({
      kind: 'status',
      text: `${displayName(t.spriteId).toUpperCase()} · ${r.verb}!`,
      colour: r.colour,
    });
    this.onReactionFx({
      colour: r.colour,
      at: { x: t.sprite.tx, y: t.sprite.ty },
      tiles,
    });

    for (const tile of tiles) {
      const v = this.floor.entityAt(tile.x, tile.y);
      // Hostiles only. `docs/DESIGN.md` is specific that this is a play against a
      // group — "the enemies around it pay" — and nothing else in this game has
      // friendly fire to be consistent with.
      if (!v || !v.alive || !v.hostile) continue;
      if (r.status) this.addStatus(v, r.status, STATUS_META[r.status].turns);
      this.damage(v, r.damage, r.colour);
    }

    // `damage` may already have killed it on the way in; killing twice would log
    // the same death twice.
    if (REACTION_SPENDS_THE_OBJECT && t.hp > 0) this.kill(t);
  }

  /**
   * Which tiles a reaction reaches.
   *
   * `ahead` and `cone` are measured from the PLAYER through the object, so the blast
   * carries on away from you. Diagonals resolve to the dominant axis rather than to
   * a diagonal, because the room is a grid and a cone off a diagonal covers tiles
   * that do not read as being in front of anything.
   */
  private reactionTiles(t: Entity, shape: ReactionDef['shape']): { x: number; y: number }[] {
    const ox = t.sprite.tx, oy = t.sprite.ty;
    if (shape === 'around') {
      const out: { x: number; y: number }[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx || dy) out.push({ x: ox + dx, y: oy + dy });
        }
      }
      return out;
    }
    const ax = ox - this.playerTile.x, ay = oy - this.playerTile.y;
    const [dx, dy] = Math.abs(ax) >= Math.abs(ay)
      ? [Math.sign(ax) || 1, 0]
      : [0, Math.sign(ay) || 1];
    const front = { x: ox + dx, y: oy + dy };
    if (shape === 'ahead') return [front];
    // the two shoulders of the front tile, which is as wide as a cone gets on a grid
    return [front, { x: front.x + dy, y: front.y + dx }, { x: front.x - dy, y: front.y - dx }];
  }

  private shove(t: Entity, tiles: number): void {
    // Frozen things are immovable — a nice reason not to freeze a thing you
    // wanted to reposition.
    if (this.has(t, 'frozen')) return;
    const g = this.floor.grid;
    const px = this.playerTile.x, py = this.playerTile.y;
    const dx = Math.sign(t.sprite.tx - px), dy = Math.sign(t.sprite.ty - py);
    for (let i = 0; i < tiles; i++) {
      const nx = t.sprite.tx + dx, ny = t.sprite.ty + dy;
      if (!g.walkable(nx, ny) || this.floor.entityAt(nx, ny)) break;
      t.sprite.tx = nx; t.sprite.ty = ny;
      t.sprite.setTileLight(g.lightAt(nx, ny));
    }
  }

  /**
   * Remember that this KIND of creature answered that way.
   *
   * Keyed by sprite id, not by entity: the lesson is about bone hounds, and having
   * to re-learn it on the second hound in the same room would teach nothing except
   * that the game is not paying attention. It lasts the run — the persistent version
   * is the bestiary, which is Guidance_And_Blessings.
   *
   * Only WHICH WAY it went is stored, not which element did it. The nameplate says
   * "you have found a weakness"; finding it again is the player's memory, which is
   * the part worth having.
   */
  private learn(t: Entity, element: Element, kind: Affinities): void {
    let m = this.learned.get(t.spriteId);
    if (!m) { m = new Map(); this.learned.set(t.spriteId, m); }
    if (m.has(element)) return;                 // already known; not a discovery
    m.set(element, kind);
    this.onDiscover(t.spriteId, element, kind);
  }

  /**
   * What this run knows about one species and one element, or null for unknown.
   *
   * PLAIN is recorded as well as weak and resist, which it was not at first. Without
   * it a matchup you have already tested and found ordinary looks exactly like one
   * you have never tried, so the player re-tests it — and the whole point of showing
   * `???` is that the unknown is legible.
   */
  known(spriteId: string, element: Element): Affinities | null {
    return this.learned.get(spriteId)?.get(element) ?? null;
  }

  /** What the player has discovered about this creature, for the HUD. */
  lore(spriteId: string): { weak: boolean; resist: boolean } | null {
    const m = this.learned.get(spriteId);
    if (!m) return null;
    const vals = [...m.values()];
    return { weak: vals.includes('weak'), resist: vals.includes('resist') };
  }

  damage(t: Entity, amount: number, colour = 0xffffff): void {
    if (!t.alive || amount <= 0) return;
    t.hp -= amount;
    t.sprite.play('hit');
    this.onEvent({
      kind: 'hit', text: String(amount), amount, colour,
      at: { x: t.sprite.tx, y: t.sprite.ty },
    });
    if (t.hp <= 0) this.kill(t);
  }

  private kill(t: Entity): void {
    t.hp = 0;
    t.sprite.play('die');
    t.hostile = false;
    this.combatants.delete(t);
    this.onEvent({ kind: 'death', text: `${label(t)} falls.` });

    if (t.kind === 'boss') {
      this.bossDead = true;
      this.floor.revealStairs();
      this.state.stars += 3 + this.state.depth;
      this.onEvent({
        kind: 'info', text: 'The stairs grind open below.', colour: 0xffe58a,
      });
      this.dropIngredients();
    } else if (t.kind === 'enemy') {
      this.state.stars += 1;
    }
  }

  /**
   * What a boss leaves behind, besides the stairs.
   *
   * Rolled off combat's own seeded rng so a floor pays the same drop twice for the
   * same seed, which is what makes a harness able to assert about it. Generous by
   * design — see `belt.ts` on why scarcity here means the mechanic never gets used.
   */
  private dropIngredients(): void {
    // Flagged off, a boss pays stars and the stairs and nothing else. `dropRng` is this
    // roll's alone (`${seed}-drops`), so declining to draw from it moves nothing else.
    if (!BELT_ENABLED) return;
    const n = rollDropCount(this.dropRng, BOSS_INGREDIENTS);
    for (let i = 0; i < n; i++) {
      this.onIngredientDrop(rollIngredient(this.dropRng, this.state.belt));
    }
  }

  addStatus(t: Entity, id: StatusId, turns: number): void {
    const c = this.combatants.get(t);
    if (!c) return;
    const cur = c.statuses.find((s) => s.id === id);
    if (cur) cur.turns = Math.max(cur.turns, turns);
    else c.statuses.push({ id, turns, power: 1 });
    this.paint(t);
  }

  removeStatus(t: Entity, id: StatusId): void {
    const c = this.combatants.get(t);
    if (!c) return;
    c.statuses = c.statuses.filter((s) => s.id !== id);
    this.paint(t);
  }

  /** Push the dominant status onto the sprite as a colour tint. */
  private paint(t: Entity): void {
    const st = this.statusesOf(t).filter((s) => s.turns > 0);
    if (!st.length) { t.sprite.setTint(0xffffff, 0); return; }
    const worst = st[st.length - 1];
    t.sprite.setTint(STATUS_META[worst.id].colour, 0.34);
  }

  // ----------------------------------------------------------------- the round

  playerTile = { x: 0, y: 0 };

  /** Called when the player steps — movement is an action, so enemies answer. */
  async playerStepped(x: number, y: number): Promise<void> {
    this.playerTile = { x, y };
    const room = this.floor.grid.roomAt(x, y);
    if (room && !this.engaged.has(room.id)) {
      this.engaged.add(room.id);
      const foes = this.floor.entities.filter(
        (e) => e.alive && e.hostile && e.roomId === room.id).length;
      if (foes > 0) {
        this.onEvent({
          kind: 'info',
          text: room.kind === 'boss' ? 'Something enormous stirs.' : `${foes} hostile${foes > 1 ? 's' : ''}.`,
          colour: room.kind === 'boss' ? 0xff6a6a : undefined,
        });
      }
    }
    await this.enemyRound();
  }

  /**
   * Every hostile and every allied golem takes its turn, then statuses tick.
   *
   * **This is the turn.** There is exactly one round in the game and both prices
   * are paid through it — a cast and a step — which is why the counter lives here
   * rather than at the call sites. There is no third caller and adding one would be
   * adding a third thing that costs a turn.
   *
   * Paced with a real delay per acting body, because a round that resolves inside
   * one microtask is a round nobody can see, and now that an action buys exactly
   * ONE round that round is the only beat the player has to read the room by.
   * Nothing acting means nothing to pace, so an empty room stays instant.
   *
   * Returns true if anything was engaged.
   */
  private async enemyRound(): Promise<boolean> {
    this.turns++;
    const g = this.floor.grid;
    const px = this.playerTile.x, py = this.playerTile.y;
    let engaged = false;

    for (const [e, c] of [...this.combatants]) {
      if (!e.alive) continue;

      if (e.hostile) {
        const d = Math.abs(e.sprite.tx - px) + Math.abs(e.sprite.ty - py);
        // Act from anywhere the player could target from — see ENGAGE_RADIUS.
        const sameRoom = g.roomAt(px, py)?.id === e.roomId;
        if (!sameRoom && d > ENGAGE_RADIUS) { c.alerted = false; continue; }

        // The round counts against the player from here: this body is in the
        // fight even if a status is about to take its action away. Which is also
        // exactly what the reticle means by ALERTED — see `Combatant.alerted`.
        engaged = true;
        c.alerted = true;
        if (this.denied(c)) { this.announceDenial(c); continue; }

        // A move AND an attack, not one or the other. A body two tiles out closes
        // and swings in the same round, so its threat range is 2 rather than 1 and
        // backing off no longer costs it a turn to re-close.
        if (d > 1) this.stepToward(e, px, py);
        if (Math.abs(e.sprite.tx - px) + Math.abs(e.sprite.ty - py) <= 1) {
          faceToward(e, px, py);
          e.sprite.play('attack');
          const dmg = Math.max(1, c.damage + this.rng.int(DAMAGE_JITTER[0], DAMAGE_JITTER[1]));
          this.state.hp -= dmg;
          this.onPlayerHurt(dmg, e);
          this.onEvent({
            kind: 'hit', text: `${label(e)} hits you for ${dmg}.`, colour: 0xff6a6a,
          });
        }
        await delay(ACT_PACE_MS);
      } else if (e.animated) {
        /**
         * An allied golem. It engages anything within reach, and otherwise
         * FOLLOWS you — a golem that stands where it was woken is scenery, and
         * the whole point of animating the room is taking it with you.
         */
        const foe = this.nearestHostile(e);
        const foeDist = foe
          ? Math.abs(e.sprite.tx - foe.sprite.tx) + Math.abs(e.sprite.ty - foe.sprite.ty)
          : Infinity;

        // Heeling is not fighting, so a golem trotting after you must not make an
        // empty room bill the player for a round.
        if (foe && foeDist <= GOLEM_AGGRO) engaged = true;
        if (this.denied(c)) { this.announceDenial(c); continue; }

        // Same budget as a hostile — a move and an attack. A golem is the mirror of
        // the thing it fights, and a rule that applied to one side and not the other
        // would be the kind of inconsistency a player cannot learn.
        if (foe && foeDist <= GOLEM_AGGRO) {
          if (foeDist > 1) this.stepToward(e, foe.sprite.tx, foe.sprite.ty);
          const near = Math.abs(e.sprite.tx - foe.sprite.tx)
            + Math.abs(e.sprite.ty - foe.sprite.ty);
          if (near <= 1) {
            faceToward(e, foe.sprite.tx, foe.sprite.ty);
            e.sprite.play('attack');
            this.damage(
              foe,
              Math.max(1, c.damage + this.rng.int(DAMAGE_JITTER[0], DAMAGE_JITTER[1])),
              0xb98cff,
            );
            for (const inf of c.infuse) this.addStatus(foe, inf, STATUS_META[inf].turns);
          }
          await delay(ACT_PACE_MS);
        } else {
          // heel: close to the player but never onto their tile
          const d = Math.abs(e.sprite.tx - px) + Math.abs(e.sprite.ty - py);
          if (d > 1) this.stepToward(e, px, py);
        }
      }
    }

    this.tickStatuses();
    this.tickGround();
    /**
     * Re-cull, because bodies MOVED.
     *
     * `Floor.cull` does two things in one pass: it computes the set of visible tiles,
     * and it sets each sprite's visibility from where that sprite is at that instant.
     * It was only ever called before a round. So a creature that walked into the open
     * during its own round kept the `false` it was given while it was still behind a
     * wall, and stood there lit and undrawn until the player next stepped.
     *
     * The symptom names the bug: it appeared ON THE MINIMAP and not on screen. The map
     * tests the creature's CURRENT tile against the tile set and said yes; the sprite
     * carried a flag from before it moved and said no.
     *
     * Here rather than at the call sites because casting runs a round too — fixing
     * only the movement path would leave it broken for exactly the turns the player
     * spends standing still.
     */
    // Guarded: a round can be driven before the player has been placed on a tile,
    // and an exception here would abort the whole cast path rather than merely skip
    // a redraw — which is how it first showed up, as casts dealing zero damage.
    const pt = this.playerTile;
    if (pt && this.floor.grid.inside(pt.x, pt.y)) this.floor.cull(pt.x, pt.y);
    if (engaged) await delay(ROUND_PACE_MS);
    return engaged;
  }

  /**
   * Does this body lose its action this round?
   *
   * Frozen, shocked and staggered all cost a body its turn — but the player only
   * gets ONE action per round, so an unlimited 2-turn freeze refreshes before it
   * expires and the fight simply never resumes. Two bodies could be held forever,
   * and a rank-2 volley held every hostile in the room. So a body that loses a
   * round braces against the next one (`DENIAL_BRACE`, doubled for a boss): the
   * statuses keep their durations and every other effect, and only the SKIP is
   * capped. Denial is tempo you rent, never a lock you close.
   */
  private denied(c: Combatant): boolean {
    if (c.braced > 0) { c.braced--; return false; }
    if (!DENIAL_STATUSES.some((s) => this.has(c.e, s))) return false;
    c.braced = c.e.kind === 'boss' ? BOSS_DENIAL_BRACE : DENIAL_BRACE;
    return true;
  }

  /**
   * Say that a body just lost its round, and to what.
   *
   * World-anchored rather than logged: a room of three frozen bodies is three
   * floaters over three heads, where three log lines a round would bury everything
   * else the log has to say. Called at the `denied` sites instead of from inside
   * it, so the rule and its announcement stay separable.
   */
  private announceDenial(c: Combatant): void {
    const id = DENIAL_STATUSES.find((s) => this.has(c.e, s));
    if (!id) return;
    this.onEvent({
      kind: 'deny',
      // Separator matches the CAST pill's, so the world captions read as one voice.
      text: `${STATUS_META[id].name.toUpperCase()} · SKIPS`,
      colour: STATUS_META[id].colour,
      at: { x: c.e.sprite.tx, y: c.e.sprite.ty },
    });
  }

  private nearestHostile(from: Entity): Entity | null {
    let best: Entity | null = null, bd = Infinity;
    for (const e of this.floor.entities) {
      if (!e.alive || !e.hostile) continue;
      const d = Math.abs(e.sprite.tx - from.sprite.tx) + Math.abs(e.sprite.ty - from.sprite.ty);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /**
   * One step toward a goal, using a breadth-first search over the grid.
   *
   * Greedy stepping does not work here. Furniture is solid, so a body is very
   * often in a pocket where every direction that reduces the straight-line
   * distance is blocked — and a greedy walker in that spot simply stops, which is
   * why golems sat still instead of following. BFS costs nothing on a grid this
   * small and lets them round a corner.
   */
  private stepToward(e: Entity, tx: number, ty: number): void {
    const g = this.floor.grid;
    const sx = e.sprite.tx, sy = e.sprite.ty;
    if (sx === tx && sy === ty) return;

    const free = (x: number, y: number): boolean => {
      if (!g.walkable(x, y)) return false;
      if (x === this.playerTile.x && y === this.playerTile.y) return false;
      const occ = this.floor.entityAt(x, y);
      return !occ || occ === e || occ.kind === 'stairs';
    };

    // Flood out from the GOAL, so every reachable tile learns its distance; then
    // the body just walks downhill. Searching from the goal means one pass
    // serves whichever neighbour it ends up standing on — and the goal tile is
    // the flood's origin, which is why the body it is chasing standing there
    // does not block the search that is looking for it.
    const W = g.w;
    const dist = g.flood(tx, ty, 24, free);

    let best: [number, number] | null = null;
    let bestD = dist[sy * W + sx];
    if (bestD === -1) bestD = Infinity;
    for (const [dx, dy] of DIR_VEC) {
      const nx = sx + dx, ny = sy + dy;
      if (!free(nx, ny)) continue;
      const d = dist[ny * W + nx];
      if (d === -1) continue;
      if (d < bestD) { bestD = d; best = [nx, ny]; }
    }
    if (!best) return;

    // Face the step BEFORE taking it, while the old tile is still the origin.
    faceToward(e, best[0], best[1]);
    e.sprite.tx = best[0]; e.sprite.ty = best[1];
    e.sprite.setTileLight(g.lightAt(best[0], best[1]));
    e.sprite.play('walk');
  }

  /**
   * Ground state ages one round, and the view is told.
   *
   * After `tickStatuses` rather than before, so a body that is standing in fire is
   * burnt by ground that is still alight this round and only then finds out the
   * fire went out. The other order gives the last round of every fire away free.
   */
  private tickGround(): void {
    this.scorchStanders();
    this.floor.ground.age();
    this.syncGround();
  }

  /**
   * Everything standing in fire pays for it, creature and player alike.
   *
   * Scaled by the flame's HEIGHT rather than flat, so the same number that draws a
   * guttering fire also prices it: walking through the edge of an old burn is a
   * scratch, and standing in the middle of a fresh one is most of a hit. That gives
   * the player something to read before they commit a step, which a flat number
   * would not — every burning tile would look equally bad and the drawing would be
   * decoration.
   *
   * Deliberately NOT the `burning` status. That is a thing a spell does to a body
   * and it follows the body around; this is a property of the TILE, and a creature
   * that steps out of a fire has stepped out of it. Two channels that both mean
   * "on fire" would also stack into a number nobody predicted.
   */
  private scorchStanders(): void {
    const g = this.floor.grid;
    const ground = this.floor.ground;
    if (!ground.count) return;

    for (const e of [...this.floor.entities]) {
      // BODIES only. An altar, a chest or a stair is furniture standing on a tile,
      // not something that can be hurt by it — and `damage` would happily kill an
      // altar, which quietly ends a run's progression without ending the run.
      if (!e.alive || !(e.hostile || e.animated)) continue;
      const i = g.idx(e.sprite.tx, e.sprite.ty);
      if (!ground.burning(i)) continue;
      this.damage(e, GROUND_FIRE_DOT * ground.level(i), 0xff7a2b);
    }

    const pi = g.idx(this.playerTile.x, this.playerTile.y);
    if (ground.burning(pi)) {
      const dmg = GROUND_FIRE_DOT * ground.level(pi);
      this.state.hp -= dmg;
      this.onPlayerHurt(dmg, null);
      this.onEvent({ kind: 'hit', text: `The burning ground sears you for ${dmg}.`, colour: 0xff7a2b });
    }
  }

  /** Push the ground layer at the thing that draws it. One truth, one direction. */
  private syncGround(): void {
    this.floor.fireView.sync(this.floor.ground.flames(), this.floor.grid.w);
  }

  private tickStatuses(): void {
    for (const [e, c] of [...this.combatants]) {
      if (!e.alive) continue;
      for (const s of c.statuses) {
        if (s.turns <= 0) continue;
        if (s.id === 'burning') this.damage(e, BURNING_DOT, STATUS_META.burning.colour);
        else if (s.id === 'decay') this.damage(e, DECAY_DOT, STATUS_META.decay.colour);
        s.turns--;
      }
      c.statuses = c.statuses.filter((s) => s.turns > 0);
      this.paint(e);
    }
  }

  /** Your animated golems, for the party bar. */
  get party(): Entity[] {
    return this.floor.entities.filter((e) => e.alive && e.animated);
  }

  /** Hostiles still standing on this floor. */
  get hostilesLeft(): number {
    return this.floor.entities.filter((e) => e.alive && e.hostile).length;
  }
}

function label(e: Entity): string {
  return displayName(e.spriteId);
}

/**
 * Is the straight line between two tiles free of wall?
 *
 * Endpoints excluded — the thing being looked at may stand anywhere, and the tile
 * being looked FROM is the player's own. Sampled along the line and permissive at a
 * corner (a line that grazes the join between two tiles passes if either is open),
 * because the two failures are not symmetrical: sight leaking one tile round a
 * doorframe is invisible, and a marker blinking off a creature you can plainly see
 * reads as the targeting system being broken.
 */
function clearLine(grid: Grid, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const px = x0 + dx * t, py = y0 + dy * t;
    if (grid.walkable(Math.round(px), Math.round(py))) continue;
    if (grid.walkable(Math.floor(px), Math.floor(py))) continue;
    if (grid.walkable(Math.ceil(px), Math.ceil(py))) continue;
    return false;
  }
  return true;
}

/**
 * Everything the player can SEE, nearest first — the tap-target candidates.
 *
 * Visibility is the whole rule now, because the grimoire itself is gated on having
 * something to aim at (`Roadmap/Casting_And_Movement.md`): a candidate the player
 * cannot see is a book that opens for nothing. Three clauses, and each one is a hole
 * that was open before:
 *
 *  - IN FRONT. A cone about as wide as it is deep, which is generous against the real
 *    lens (90° vertical on a portrait frame is only ~50° across) and is what makes
 *    "turning away drops the target" true. Everything in the room you stand in used
 *    to qualify at any angle, so a body directly behind you kept its reticle.
 *  - NOT THROUGH A WALL. The forward ray stopped at the first wall but then added
 *    whole rooms it had reached the edge of, so a marker drew over anything in a room
 *    the player could not see into — the `Stop target markers drawing through walls`
 *    defect. `clearLine` is asked of every candidate, which closes it for the room
 *    case as well as for the corridor one.
 *  - WITHIN REACH unless you share a room with it, unchanged and for the unchanged
 *    reason: a body you can put a reticle on has to be a body that is allowed to
 *    answer, and `enemyRound` engages at `ENGAGE_RADIUS` outside its own room.
 */
export function targetsInView(
  grid: Grid, floor: Floor, x: number, y: number, dir: 0 | 1 | 2 | 3,
  reach = ENGAGE_RADIUS,
): Entity[] {
  const room = grid.roomAt(x, y);
  const [fx, fy] = DIR_VEC[dir];
  const [rx, ry] = DIR_VEC[(dir + 1) % 4];
  const out: Entity[] = [];

  for (const e of floor.entities) {
    if (!e.alive || e.kind === 'stairs') continue;
    const dx = e.sprite.tx - x, dy = e.sprite.ty - y;
    const ahead = dx * fx + dy * fy;
    const side = Math.abs(dx * rx + dy * ry);
    if (ahead < 1 || side > ahead) continue;
    if ((!room || e.roomId !== room.id) && Math.abs(dx) + Math.abs(dy) > reach) continue;
    if (!clearLine(grid, x, y, e.sprite.tx, e.sprite.ty)) continue;
    out.push(e);
  }

  // nearest first, so auto-target picks the immediate threat
  out.sort((a, b) =>
    (Math.abs(a.sprite.tx - x) + Math.abs(a.sprite.ty - y)) -
    (Math.abs(b.sprite.tx - x) + Math.abs(b.sprite.ty - y)));
  return out;
}
