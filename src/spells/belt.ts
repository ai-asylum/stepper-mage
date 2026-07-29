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
import { INGREDIENT_IDS, SPELL_BY_ID, isIngredient } from './spells';

/** One pouch loop: which ingredient, and how many are in it. */
export interface BeltSlot {
  id: string;
  count: number;
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
   * Components TimeSand has already paid for.
   *
   * On the belt rather than beside the turn counter because it is one ingredient's
   * effect and nothing else in the game produces it. Spent by `spendComponentTurn`
   * and cleared when the hand empties, so it is scoped to the cast being assembled.
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

export function newBelt(capacity: number): BeltState {
  return { slots: [], capacity: Math.max(0, capacity), free: 0, refusal: null };
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

export function beltRefusalFor(belt: BeltState, id: string): string | null {
  if (!isIngredient(id)) return 'That is not something a pouch will hold.';
  if (belt.capacity <= 0) return BELT_LOCKED;
  if (beltHeld(belt, id) > 0) return null;
  if (belt.slots.length >= belt.capacity) {
    return `Every loop is full. Spend something before taking ${SPELL_BY_ID[id]?.name ?? id}.`;
  }
  return null;
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
  const slot = belt.slots.find((s) => s.id === id);
  if (slot) slot.count += n;
  else belt.slots.push({ id, count: n });
  belt.refusal = null;
  return null;
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
