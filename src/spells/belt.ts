/**
 * The belt: what is in the pouches, and every rule about putting something in one.
 *
 * Kept out of `spells.ts` because that file is the component REGISTRY — what exists
 * and what it does to a cast — while this is the container's rules: how many loops
 * the strap has, what happens when a drop arrives and there is nowhere to keep it,
 * and how a stack is spent. `main.ts` and `combat.ts` both grant ingredients, so
 * both would otherwise re-derive "is there room" and the two answers would drift.
 *
 * Deliberately free of any `src/book/` import, so it can sit on `PlayerState`
 * without dragging the page renderer into the game layer. The page-SHAPED card an
 * ingredient arrives in the hand on is `ingredientCards.ts`, the same split
 * `spells.ts` / `harvestCards.ts` already has.
 *
 * Run-scoped by construction: there is no persistence here at all, because
 * `Roadmap/Ingredient_Belt.md` puts "ingredients surviving a run" out of scope.
 */
import type { Rng } from '../core/rng';
import { INGREDIENT_IDS, SPELL_BY_ID, isIngredient, isFixtureComponent } from './spells';

/** One pouch: which component, and how many are in it. */
export interface BeltSlot {
  id: string;
  count: number;
}

/**
 * HOW BIG A POUCH IS, in units. The tree buys the tier, not the numbers.
 *
 * Capacity is an allowance rather than a slot count so that one table can price
 * every substance against every pouch. The alternative — a per-substance stack cap
 * — needs a second table and then an exception every time the two disagree.
 */
export const POUCH_UNITS = [5, 10, 20] as const;
export type PouchTier = 0 | 1 | 2;

/**
 * WHAT ONE OF A THING WEIGHS, and therefore how many fit.
 *
 * This is the value dial, and it has a fiction behind it so it needs no exceptions:
 * water is light and a pouch holds a lot of it; an open flame costs four units
 * because you are carrying an open flame; golem clay is the heaviest thing in the
 * dungeon, so a 20-unit pouch holds exactly two and a 5-unit pouch cannot hold any.
 * The cap nobody has to remember is the one that falls out of arithmetic.
 *
 * It says the same thing `HARVEST_DEPTH` says in the world (`spells.ts`): what is
 * cheap is deep and light, what is precious is shallow and heavy.
 *
 * Anything absent weighs 1 — the ingredients the belt already held are the baseline
 * this is measured against, not a special case.
 */
const WEIGHT: Readonly<Record<string, number>> = {
  water: 1,
  stone: 1,
  oil: 2,
  flame: 4,
  starlight: 5,
  clay: 10,
};

export function weightOf(id: string): number {
  return WEIGHT[id] ?? 1;
}

/** Units a pouch of this tier holds. */
export function pouchUnits(tier: PouchTier): number {
  return POUCH_UNITS[tier];
}

/** Units a stack is using. */
export function slotUnits(slot: BeltSlot): number {
  return slot.count * weightOf(slot.id);
}

export interface BeltState {
  /** Filled loops, in the order they were filled — the strip's draw order. */
  slots: BeltSlot[];
  /**
   * How many loops the strap has: 0 while the tree node is unbought, then 3 or 6.
   * DERIVED from the owned node set and written in exactly one place (`syncBelt` in
   * `main.ts`), for the reason `applyTree` gives about hand size — a capacity stored
   * twice is a capacity a refund can leave stale.
   */
  capacity: number;
  /**
   * How big each pouch is, as an index into `POUCH_UNITS`. Bought separately from
   * how MANY pouches there are, because the two answer different questions: breadth
   * is how many different things you can carry, depth is how much of one.
   *
   * Derived from the owned node set in the same one place `capacity` is, for the
   * same reason — a capacity stored twice is a capacity a refund can leave stale.
   */
  tier: PouchTier;
  /**
   * DEAD. It counted the components TimeSand had already paid for, and under
   * cast = 1 turn no component costs a turn, so nothing writes it and nothing spends
   * it — it is 0 for the whole run. Kept on the state rather than removed because the
   * belt is switched off behind `BELT_ENABLED` and what the sand becomes instead is an
   * open design decision; see its entry in `spells.ts`. The strip's
   * "NEXT N COMPONENTS FREE" caption reads this, so that caption is dead with it.
   */
  free: number;
  /**
   * Why the belt last refused something, and when, in `performance.now()` ms.
   *
   * The refusal is a RULE and the strap pulse is a reading of it, so the rule
   * records the moment and the renderer decides what to do with it. Without the
   * timestamp a pulse cannot tell "refused just now" from "refused two rooms ago".
   */
  refusal: { why: string; at: number } | null;
}

/**
 * How many ingredients each source hands out.
 *
 * `docs/DESIGN.md` is explicit that these must be GENEROUS: an ingredient costs a
 * hand slot and is consumed, so scarcity means they are hoarded and never used, and
 * an ingredient that is never used is a mechanic that does not exist. So every
 * source pays at least two and a coin-flip pays a third.
 *
 * Counted rather than guessed: a floor has one treasure room and one boss
 * (`game/populate.ts`), so 2.5 + 2.5 per floor lands a five-floor run around 25,
 * plus an altar bundle whenever one wins a slot. Measured against the ~36 casts a
 * cleared run takes (`tools/fullrun.mjs`, the gated line), that is over half the
 * casts in a run able to be a shaped one — which is the point at which a player
 * spends them instead of saving them for a fight that never comes.
 *
 * The altar pays more because it is spending a whole third of a decision that could
 * have been a rank or a heal, and it only ever appears when the belt can take it.
 */
export const CHEST_INGREDIENTS = 2;
export const BOSS_INGREDIENTS = 2;
export const ALTAR_INGREDIENTS = 3;
/** The coin flip on a third, for chests and bosses. */
export const EXTRA_DROP_CHANCE = 0.5;

export function newBelt(capacity: number, tier: PouchTier = 0): BeltState {
  return { slots: [], capacity: Math.max(0, capacity), tier, free: 0, refusal: null };
}

/** How many of this ingredient are on the belt. */
export function beltHeld(belt: BeltState, id: string): number {
  return belt.slots.find((s) => s.id === id)?.count ?? 0;
}

/** Every ingredient on the belt, one entry per pouch. */
export function beltTotal(belt: BeltState): number {
  return belt.slots.reduce((n, s) => n + s.count, 0);
}

/**
 * Why this ingredient cannot go on the belt, or null when it can.
 *
 * Two refusals and not one, because they are fixed by completely different things:
 * a locked strap is a purchase away and a full belt is a cast away. The locked line
 * is `docs/DESIGN.md`'s own wording — the belt renders while locked precisely so the
 * capability advertises itself, and a drop you cannot keep is the moment that
 * advertisement lands.
 */
export const BELT_LOCKED = 'You have nowhere to keep it — your belt has no loops.';

/** Can a pouch hold this at all — ingredients, and anything harvested. */
export function pouchable(id: string): boolean {
  return isIngredient(id) || isFixtureComponent(id);
}

/**
 * How many more of `id` the belt could take right now.
 *
 * Asked of the whole belt rather than of one pouch, because a stack that does not
 * fit in its own pouch may still fit in an empty one — and because every caller
 * wants the same answer: is there room, and how much.
 */
export function beltRoom(belt: BeltState, id: string): number {
  if (!pouchable(id) || belt.capacity <= 0) return 0;
  const w = weightOf(id);
  const units = pouchUnits(belt.tier);
  if (w > units) return 0;                       // too heavy for this tier, at any count
  let room = 0;
  for (const slot of belt.slots) {
    if (slot.id === id) room += Math.floor((units - slotUnits(slot)) / w);
  }
  const empty = Math.max(0, belt.capacity - belt.slots.length);
  return room + empty * Math.floor(units / w);
}

export function beltRefusalFor(belt: BeltState, id: string): string | null {
  if (!pouchable(id)) return 'That is not something a pouch will hold.';
  if (belt.capacity <= 0) return BELT_LOCKED;
  const name = SPELL_BY_ID[id]?.name ?? id;
  /**
   * TOO HEAVY is its own refusal, and it is the one that teaches the tier.
   *
   * Golem clay in a small pouch is not "your belt is full" — the belt may be empty
   * — it is "this pouch is not big enough for that", which points at the upgrade
   * instead of at the contents. Getting these two confused is how a player concludes
   * the game is broken rather than that they need a bigger pouch.
   */
  if (weightOf(id) > pouchUnits(belt.tier)) {
    return `${name} is too heavy for a pouch this size.`;
  }
  if (beltRoom(belt, id) > 0) return null;
  return `Every pouch is full. Drop something before taking ${name}.`;
}

/** Record a refusal so the strap can pulse for it. Returns the same reason. */
export function beltRefuse(belt: BeltState, why: string): string {
  belt.refusal = { why, at: performance.now() };
  return why;
}

/**
 * Put `n` of an ingredient on the belt. Returns the refusal, or null on success.
 *
 * A stack has no cap. One was considered for the count badge's sake and left out:
 * a cap is a scarcity rule, and this is the one economy the design says to err
 * generous on.
 */
export function beltAdd(belt: BeltState, id: string, n = 1): string | null {
  const why = beltRefusalFor(belt, id);
  if (why) return beltRefuse(belt, why);
  if (beltRoom(belt, id) < n) {
    return beltRefuse(belt, `There is not room for ${n} ${SPELL_BY_ID[id]?.name ?? id}.`);
  }
  const w = weightOf(id);
  const units = pouchUnits(belt.tier);
  let left = n;
  // Top up the pouches already holding this before opening a new one: a substance
  // spread across two half-empty pouches is two pouches the player cannot use for
  // anything else.
  for (const slot of belt.slots) {
    if (left <= 0) break;
    if (slot.id !== id) continue;
    const fits = Math.floor((units - slotUnits(slot)) / w);
    const take = Math.min(fits, left);
    slot.count += take; left -= take;
  }
  while (left > 0 && belt.slots.length < belt.capacity) {
    const take = Math.min(Math.floor(units / w), left);
    belt.slots.push({ id, count: take });
    left -= take;
  }
  belt.refusal = null;
  return null;
}

/**
 * Empty some or all of one pouch. Returns how many were actually dropped.
 *
 * The pouch panel's DROP, and the only way anything on the belt is destroyed. The
 * caller is what turns the returned count into ground — this function knows about
 * the belt and deliberately nothing about the floor.
 */
export function beltDrop(belt: BeltState, index: number, n: number): number {
  const slot = belt.slots[index];
  if (!slot) return 0;
  const took = Math.max(0, Math.min(n, slot.count));
  slot.count -= took;
  if (slot.count <= 0) belt.slots.splice(index, 1);
  return took;
}

/**
 * Move a whole pouch onto another. Same substance merges up to the cap and leaves
 * the remainder where it was; anything else swaps the two.
 *
 * Returns false when the move would do nothing, so the panel can grey the target
 * rather than offering a button that no-ops.
 */
export function beltMove(belt: BeltState, from: number, to: number): boolean {
  const a = belt.slots[from], b = belt.slots[to];
  if (!a || from === to) return false;
  if (!b) { belt.slots[to] = a; belt.slots.splice(from, 1); return true; }
  if (a.id !== b.id) { belt.slots[from] = b; belt.slots[to] = a; return true; }
  const w = weightOf(a.id);
  const fits = Math.floor((pouchUnits(belt.tier) - slotUnits(b)) / w);
  if (fits <= 0) return false;
  const take = Math.min(fits, a.count);
  b.count += take; a.count -= take;
  if (a.count <= 0) belt.slots.splice(from, 1);
  return true;
}

/**
 * Spend one. Called when a cast actually goes off and never when a hand is
 * assembled — `Roadmap/Ingredient_Belt.md`: consumed only on cast, and taking one
 * out stays returnable.
 */
export function beltConsume(belt: BeltState, id: string): boolean {
  const slot = belt.slots.find((s) => s.id === id);
  if (!slot || slot.count <= 0) return false;
  slot.count--;
  // An empty loop is an empty loop, not a reserved one: dropping it frees the slot
  // for a different ingredient, which is what makes a 3-slot belt a real choice.
  if (slot.count === 0) belt.slots = belt.slots.filter((s) => s !== slot);
  return true;
}

/**
 * Resize the strap. Shrinking trims the loops that no longer exist from the END,
 * because the front of the belt is what the player filled first.
 *
 * Only reachable by a refund, which only happens between runs — a fresh run rebuilds
 * the belt empty — so this is a guard rather than a path anything walks today.
 */
export function beltSetCapacity(belt: BeltState, capacity: number): void {
  belt.capacity = Math.max(0, capacity);
  if (belt.slots.length > belt.capacity) belt.slots.length = belt.capacity;
}

/**
 * Which ingredient a drop is.
 *
 * Uniform across all five, and that is the MINIMUM THAT SHIPS rather than a
 * decision: `docs/DESIGN.md`'s `## Open — not decided` holds both "how common
 * animation ingredients are relative to the rest" and "whether shapers drop at
 * altars or only from chests", and neither may be filled in by inference. Uniform is
 * the only distribution that does not quietly answer them.
 *
 * It does prefer something the belt can actually take, so a full 3-slot belt keeps
 * being paid instead of being told it has no loop free — with a blind fallback, so a
 * LOCKED belt still produces a drop and therefore still produces the refusal that
 * explains itself.
 */
export function rollIngredient(rng: Rng, belt: BeltState): string {
  const fits = INGREDIENT_IDS.filter((id) => beltRefusalFor(belt, id) === null);
  return rng.pick(fits.length ? fits : INGREDIENT_IDS);
}

/** How many an ordinary source pays: `base`, plus a coin flip on one more. */
export function rollDropCount(rng: Rng, base: number): number {
  return base + (rng.chance(EXTRA_DROP_CHANCE) ? 1 : 0);
}
