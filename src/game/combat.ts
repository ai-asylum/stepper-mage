/**
 * Turn-based combat.
 *
 * The loop: the player takes ONE action, then every hostile and every allied
 * golem acts, then statuses tick. Turning in place is free — you should never be
 * punished for looking around, and on a phone that would make the camera
 * controls feel like a resource.
 *
 * There is NO mana. The cost of a spell is paid in turns while you ASSEMBLE it:
 * every component you take (tearing a page, and later harvesting or drawing off
 * the belt) hands the room a free action, and releasing the cast is free. That
 * puts the price on the decision rather than on the trigger — a fusion is an
 * investment of rounds you spent standing there, so it can be strictly stronger
 * than a single page without being strictly better.
 *
 * Every number that governs the TEMPO is in `tuning.ts`, sized for that loop at a
 * hand of one — the engage radius, the interaction multipliers, the SHATTER
 * threshold, the denial cap and the round pacing all live there. If a fight feels
 * wrong it is a tuning number that is wrong. (The BFS expansion cap in
 * `stepToward` is the one bare number left, and it bounds an algorithm rather
 * than a fight.)
 */
import { Rng } from '../core/rng';
import { DIR_VEC, type Grid } from '../dungeon/grid';
import type { Entity, Floor } from './floor';
import {
  STATUS_META, displayName, resolveCast,
  type CastTarget, type ResolvedCast, type StatusId,
} from '../spells/spells';
import {
  ACT_PACE_MS, BOSS_DENIAL_BRACE, BURNING_DOT, CONDUCTION_ARC_RANGE,
  CONDUCTION_ARC_SHARE, CONDUCTION_MULT, DAMAGE_JITTER, DECAY_DOT, DEEP_FREEZE_MULT,
  DENIAL_BRACE, ENGAGE_RADIUS, GOLEM_AGGRO, ROUND_PACE_MS, SHATTER_DAMAGE,
  SHATTER_MULT, bossDamage, enemyDamage,
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
}

/**
 * `deny` is any action that did not happen: a cast the rules refused, or a body
 * that lost its round to a status. The two are told apart by `at` — a refusal
 * answers something the player just did and belongs in the log, a lost round
 * belongs over the body that lost it.
 */
export type LogKind = 'cast' | 'hit' | 'status' | 'death' | 'info' | 'deny' | 'discover';

/** What a component-turn was spent on. Harvest and belt land in later phases. */
export type TurnCause = 'tear' | 'harvest' | 'belt';

export interface GameEvent {
  kind: LogKind;
  text: string;
  colour?: number;
  /** World tile to anchor a floater over, if any. */
  at?: { x: number; y: number };
  amount?: number;
}

export class Combat {
  readonly state: PlayerState;
  private combatants = new Map<Entity, Combatant>();
  private rng: Rng;
  /** Rooms whose encounter has been triggered. */
  private engaged = new Set<number>();
  bossDead = false;
  /**
   * Rounds spent this run. Nothing in the game reads it — every price is paid
   * through `takeTurn`, so this is simply the one honest count of "the player
   * did something", which the playable ad paces its CTA against.
   */
  turns = 0;
  /** Fusion names already announced this run. */
  private discovered = new Set<string>();

  onEvent: (e: GameEvent) => void = () => {};
  /** Fired so the renderer can throw a projectile / burst. */
  onCastFx: (cast: ResolvedCast, from: Entity | null, targets: Entity[]) => void = () => {};
  onPlayerHurt: (amount: number) => void = () => {};

  constructor(private floor: Floor, state: PlayerState, seed: string) {
    this.state = state;
    this.rng = new Rng(`${seed}-combat`);
    for (const e of floor.entities) this.register(e);
  }

  private register(e: Entity): void {
    if (!['enemy', 'boss'].includes(e.kind) && !e.animated) return;
    this.combatants.set(e, {
      e, statuses: [], infuse: [], braced: 0,
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

  // ------------------------------------------------------------------ casting

  /**
   * Expand torn pages by their rank, so an upgraded page empowers the cast
   * without the player having to tear the same spell twice.
   */
  private byRank(pages: string[]): string[] {
    const out: string[] = [];
    for (const id of pages) {
      const n = Math.max(1, this.state.ranks[id] ?? 1);
      for (let i = 0; i < n; i++) out.push(id);
    }
    return out;
  }

  /** Can this selection be cast at this target right now? */
  preview(pages: string[], target: CastTarget): ResolvedCast {
    return resolveCast(this.byRank(pages), target);
  }

  /**
   * Release the assembled cast. Returns true if the spell actually went off —
   * false means it was refused and the hand is untouched, so the caller can keep
   * the pages. It does NOT mean a turn was spent: the turns were already paid,
   * one per component, when the hand was assembled.
   *
   * `targetEntity` is the tapped thing. A volley (`count > 1`) spreads across
   * DISTINCT bodies and stops when it runs out of them — extra projectiles are
   * lost rather than wrapping back onto the primary. That single rule is what
   * keeps the rank ladder honest: rank counts a page as several copies, so a
   * rank-3 page used to put three projectiles on one body for one turn, which
   * matched a three-turn fusion at a third of the price. Now rank makes a cast
   * WIDER and fusions are what make it deeper, so "better against a group, worse
   * against one thing" is true of every volley in the game — Multishot's included.
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

    const cast = this.preview(pages, target);
    if (cast.refusal) {
      this.onEvent({ kind: 'deny', text: cast.refusal });
      return false;
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
      const ok = await this.floor.animateProp(targetEntity);
      if (!ok) {
        this.onEvent({ kind: 'deny', text: 'That will not wake.' });
        return false;
      }
      targetEntity.hp = targetEntity.maxHp = cast.count;
      this.register(targetEntity);
      const c = this.combatants.get(targetEntity)!;
      c.damage = cast.damage;
      c.infuse = cast.infuse;
      this.onCastFx(cast, null, [targetEntity]);
      return true;
    }

    // spread a volley across distinct hostiles, primary first
    const hostiles = this.floor.entities.filter((e) => e.alive && e.hostile);
    const order: Entity[] = [];
    if (targetEntity) order.push(targetEntity);
    for (const h of hostiles) if (h !== targetEntity) order.push(h);
    const targets = order.slice(0, cast.count);

    this.onCastFx(cast, null, targets);

    for (const t of targets) {
      this.applyCast(cast, t);
    }

    return true;
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
        const other = this.floor.entities.find(
          (o) => o !== t && o.alive && o.hostile &&
            Math.abs(o.sprite.tx - t.sprite.tx) + Math.abs(o.sprite.ty - t.sprite.ty)
              <= CONDUCTION_ARC_RANGE,
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
       * SHATTER: a heavy hit on a frozen body breaks it open — and the shell does
       * NOT re-form from the same cast.
       *
       * Both halves matter. The threshold is a rank-1 Frostbolt exactly, because
       * at hand size 1 Frostbolt is the only thing that freezes and a valve the
       * one freezing tool cannot reach is not a valve. And suppressing the
       * incoming freeze is what makes frost-on-frost a CHOICE rather than a lock:
       * the second bolt either burst-damages a frozen body or holds it, never both.
       */
      const shattered = this.has(t, 'frozen') && damage >= SHATTER_DAMAGE;
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
        const mult = s.id === 'frozen' && deepFreeze ? DEEP_FREEZE_MULT : 1;
        this.addStatus(t, s.id, Math.max(1, Math.round(STATUS_META[s.id].turns * s.power * mult)));
      }
    }

    this.damage(t, damage, glow);

    if (cast.shove) this.shove(t, cast.shove);
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
    } else if (t.kind === 'enemy') {
      this.state.stars += 1;
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
   * Spend a turn on something that is not a step and not a cast — taking a
   * spell component. "It costs a turn" and "the room gets a free action" are the
   * same sentence, so this is deliberately a thin wrapper: there is exactly one
   * round in the game and every price is paid through it.
   *
   * Returns whether the round actually cost anything — true when a hostile was
   * engaged (whether or not it managed to act) or a golem fought. Out of combat
   * it is false, and the HUD needs that: a readout that bills you for every page
   * you leaf through in an empty room advertises the exact opposite of the rule
   * this phase exists to establish.
   *
   * `_cause` is unused today; it is here so a harvest and a belt draw can be
   * told apart from a tear once those exist, without changing every call site.
   */
  async takeTurn(_cause: TurnCause): Promise<boolean> {
    this.turns++;
    return this.enemyRound();
  }

  /**
   * Every hostile and every allied golem takes its turn, then statuses tick.
   *
   * Paced with a real delay per acting body, because a round that resolves inside
   * one microtask is a round nobody can see — and "a three-page fusion visibly
   * costs three enemy rounds" is an acceptance criterion, not a figure of speech.
   * Nothing acting means nothing to pace, so an empty room stays instant.
   *
   * Returns true if anything was engaged.
   */
  private async enemyRound(): Promise<boolean> {
    const g = this.floor.grid;
    const px = this.playerTile.x, py = this.playerTile.y;
    let engaged = false;

    for (const [e, c] of [...this.combatants]) {
      if (!e.alive) continue;

      if (e.hostile) {
        const d = Math.abs(e.sprite.tx - px) + Math.abs(e.sprite.ty - py);
        // Act from anywhere the player could target from — see ENGAGE_RADIUS.
        const sameRoom = g.roomAt(px, py)?.id === e.roomId;
        if (!sameRoom && d > ENGAGE_RADIUS) continue;

        // The round counts against the player from here: this body is in the
        // fight even if a status is about to take its action away.
        engaged = true;
        if (this.denied(c)) { this.announceDenial(c); continue; }

        if (d <= 1) {
          e.sprite.play('attack');
          const dmg = Math.max(1, c.damage + this.rng.int(DAMAGE_JITTER[0], DAMAGE_JITTER[1]));
          this.state.hp -= dmg;
          this.onPlayerHurt(dmg);
          this.onEvent({
            kind: 'hit', text: `${label(e)} hits you for ${dmg}.`, colour: 0xff6a6a,
          });
        } else {
          this.stepToward(e, px, py);
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

        if (foe && foeDist <= 1) {
          e.sprite.play('attack');
          this.damage(
            foe,
            Math.max(1, c.damage + this.rng.int(DAMAGE_JITTER[0], DAMAGE_JITTER[1])),
            0xb98cff,
          );
          for (const inf of c.infuse) this.addStatus(foe, inf, STATUS_META[inf].turns);
          await delay(ACT_PACE_MS);
        } else if (foe && foeDist <= GOLEM_AGGRO) {
          this.stepToward(e, foe.sprite.tx, foe.sprite.ty);
          await delay(ACT_PACE_MS);
        } else {
          // heel: close to the player but never onto their tile
          const d = Math.abs(e.sprite.tx - px) + Math.abs(e.sprite.ty - py);
          if (d > 1) this.stepToward(e, px, py);
        }
      }
    }

    this.tickStatuses();
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

    // BFS out from the goal, so every reachable tile learns its distance; then
    // the body just walks downhill. Searching from the goal means one pass
    // serves whichever neighbour it ends up standing on.
    const W = g.w, H = g.h;
    const dist = new Int16Array(W * H).fill(-1);
    const queue: number[] = [ty * W + tx];
    dist[ty * W + tx] = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      const cx = i % W, cy = (i / W) | 0;
      if (dist[i] > 24) break;                 // far enough; stop expanding
      for (const [dx, dy] of DIR_VEC) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (dist[ni] !== -1) continue;
        // the goal tile itself may be occupied (it is who we are chasing)
        if (!free(nx, ny) && !(nx === tx && ny === ty)) continue;
        dist[ni] = dist[i] + 1;
        queue.push(ni);
      }
    }

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

    e.sprite.tx = best[0]; e.sprite.ty = best[1];
    e.sprite.setTileLight(g.lightAt(best[0], best[1]));
    e.sprite.play('walk');
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
 * Tiles in front of the player, nearest first — the tap-target candidates.
 *
 * `reach` defaults to `ENGAGE_RADIUS` and everything outside the player's own room
 * is held to it, because the two rules have to agree: a body you can put a reticle
 * on has to be a body that is allowed to answer. Corridor tiles belong to no room,
 * so a player standing in one is never "in the same room" as anything — while the
 * reticle reached 7 and hostiles engaged at 4, a corridor was a firing position
 * from which a whole room, boss included, could be emptied for free.
 */
export function targetsInView(
  grid: Grid, floor: Floor, x: number, y: number, dir: 0 | 1 | 2 | 3,
  reach = ENGAGE_RADIUS,
): Entity[] {
  const out: Entity[] = [];
  const add = (e: Entity | null) => {
    if (e && e.alive && e.kind !== 'stairs' && !out.includes(e)) out.push(e);
  };
  /** Only within reach — for anything the player does not share a room with. */
  const addNear = (e: Entity | null) => {
    if (e && Math.abs(e.sprite.tx - x) + Math.abs(e.sprite.ty - y) <= reach) add(e);
  };

  // Everything in the room you are standing in is targetable, at any distance —
  // you share a room with it, so `enemyRound` lets it act whatever the reach says.
  // Restricting to the forward ray meant a bookshelf two steps to your left could
  // not be animated, which quietly broke the core verb depending on your facing.
  const room = grid.roomAt(x, y);
  if (room) for (const [rx, ry] of room.tiles) add(floor.entityAt(rx, ry));

  // Plus a forward cone down a corridor, with a one-tile lateral spread.
  const [dx, dy] = DIR_VEC[dir];
  for (let i = 1; i <= reach; i++) {
    const tx = x + dx * i, ty = y + dy * i;
    if (!grid.walkable(tx, ty)) break;
    for (const [ox, oy] of [[0, 0], [dy, dx], [-dy, -dx]] as const) addNear(floor.entityAt(tx + ox, ty + oy));
    const far = grid.roomAt(tx, ty);
    if (far && far !== room) for (const [rx, ry] of far.tiles) addNear(floor.entityAt(rx, ry));
  }

  // nearest first, so auto-target picks the immediate threat
  out.sort((a, b) =>
    (Math.abs(a.sprite.tx - x) + Math.abs(a.sprite.ty - y)) -
    (Math.abs(b.sprite.tx - x) + Math.abs(b.sprite.ty - y)));
  return out;
}
