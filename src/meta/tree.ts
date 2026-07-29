/**
 * The star tree — what stars buy, and what depends on what.
 *
 * A tree and not a shop list because some purchases are genuinely INERT without
 * another. The belt below hand size 2 is the example the whole shape comes from:
 * every ingredient shapes a cast and never supplies an element, and the invariant
 * is that every cast contains at least one element (`docs/DESIGN.md`, Three
 * sources) — so a hand of one holding an ingredient is holding a cast that cannot
 * legally exist. Expressing that as an EDGE means the game never has to rely on
 * the player buying in the right order, and never has to sell a purchase that does
 * nothing until a second one arrives.
 *
 * Every node changes behaviour rather than a number. Nothing here is +damage,
 * +health, +stars-per-floor or a wider altar roll — the last is rejected outright
 * in `docs/DESIGN.md` because it makes the terminal state of the economy arrive
 * sooner. Capability, capacity and persistence only.
 *
 * `handSize`, `slots`, `beltSlots` and `golemsKept` are CEILINGS a node raises the
 * corresponding field to, resolved by taking the maximum over the owned set. That
 * is deliberate: a count of owned nodes has to be kept in step with a refund by
 * hand, whereas a max over what is owned cannot go stale — remove the node and the
 * ceiling falls back on its own.
 */

export type NodeId =
  | 'hand2' | 'hand3'
  | 'belt3' | 'belt6'
  | 'golemKeep1' | 'golemInfusion' | 'golemKeep2'
  | 'corpseRaising'
  | 'altarPages'
  | 'blessing' | 'blessingWider'
  | 'slots4';

export interface TreeNode {
  readonly id: NodeId;
  readonly name: string;
  /** What owning it changes, stated as the rule and never as a number. */
  readonly effect: string;
  /** Real prerequisite edges. Every one of these is a dependency, not an order. */
  readonly requires: readonly NodeId[];
  readonly price: number;
  /**
   * Whether the effect lands TODAY.
   *
   * A `false` node is still bought, refunded, priced and persisted — it is the
   * phase that builds the system it belongs to which reads it back (through
   * `hasNode`), and that phase is named in `lands`. Recording the purchase now is
   * what lets the tree be the whole tree instead of the third of it that happens
   * to have somewhere to land.
   */
  readonly live: boolean;
  readonly lands?: string;
  /** Raises the fusion ceiling to this. */
  readonly handSize?: number;
  /** Raises the starting book's size to this. */
  readonly slots?: number;
  /** Raises the belt to this many loops. Phase 5 reads it. */
  readonly beltSlots?: number;
  /** How many golems survive the stairs. Phase 6 reads it. */
  readonly golemsKept?: number;
  /** A kept golem keeps its rank and elemental infusion. Phase 6 reads it. */
  readonly golemInfusion?: true;
}

/**
 * PROVISIONAL AND UNBLESSED. `docs/DESIGN.md` lists "Prices for every tree node"
 * under `## Open — not decided`, so none of these numbers is settled and none of
 * them may be quoted as design. They are here because a tree cannot exist without
 * prices, they are in one table so replacing them is one edit, and they are
 * derived from MEASURED star income rather than taste. Measured over the routed
 * hand-size-1 line `tools/fullrun.mjs` plays, income taken every floor:
 *
 *  - a run that DIES on floor 4 or 5 banks 68 stars on average (50-88 across four
 *    deaths), because death banks everything already earned;
 *  - a full five-floor CLEAR banks 113 (109-124 across four), the +25 for taking
 *    the vault included.
 *
 * So the unit these are priced in is one run ≈ 70 stars, and `hand2` at 40 lands
 * after the first run whether it went well or not. That is deliberate rather than
 * generous: hand size 2 is where fusion gets SOLD instead of taught, and a player
 * who has not reached it has not met the game. Past it, a tier costs about a run,
 * a headline tier about two, and the whole tree is on the order of ten clears.
 */
const PRICES: Readonly<Record<NodeId, number>> = {
  hand2: 40,
  slots4: 60,
  belt3: 70,
  altarPages: 70,
  corpseRaising: 90,
  blessing: 90,
  golemKeep1: 110,
  hand3: 140,
  belt6: 140,
  blessingWider: 150,
  golemInfusion: 160,
  golemKeep2: 220,
};

/** The fusion ceiling with nothing owned. One, and the reason is in `docs/DESIGN.md`. */
export const BASE_HAND_SIZE = 1;
/** How big the starting book is with nothing owned. */
export const BASE_SLOTS = 3;

export const TREE: readonly TreeNode[] = [
  {
    id: 'hand2', name: 'Second Hand', price: PRICES.hand2, requires: [], live: true,
    handSize: 2,
    effect: 'Hold two components at once: pair fusions, golems, and every ingredient.',
  },
  {
    id: 'hand3', name: 'Third Hand', price: PRICES.hand3, requires: ['hand2'], live: true,
    handSize: 3,
    effect: 'Hold three: element triples, or one element and two ingredients.',
  },
  {
    id: 'belt3', name: 'Ingredient Belt', price: PRICES.belt3, requires: ['hand2'],
    live: false, lands: 'phase 5 — Ingredient_Belt', beltSlots: 3,
    effect: 'Three loops on the strap. Ingredients can be picked up and kept.',
  },
  {
    id: 'belt6', name: 'Deep Belt', price: PRICES.belt6, requires: ['belt3'],
    live: false, lands: 'phase 5 — Ingredient_Belt', beltSlots: 6,
    effect: 'Six loops. Carry every shape at once instead of choosing at the drop.',
  },
  {
    // Corpse raising is a CAPABILITY and Coffin Moss is its per-use limiter
    // (`docs/DESIGN.md`, Belt), so the moss needs somewhere to live: the belt.
    id: 'corpseRaising', name: 'Coffin Rites', price: PRICES.corpseRaising,
    requires: ['belt3'], live: false, lands: 'phase 6 — Corpse_Raising_And_Golem_Persistence',
    effect: 'The dead leave a corpse you can raise as a golem, with Coffin Moss.',
  },
  {
    // A golem you keep is a golem you first made, and animation is an ingredient.
    id: 'golemKeep1', name: 'Bound Servant', price: PRICES.golemKeep1,
    requires: ['belt3'], live: false, lands: 'phase 6 — Corpse_Raising_And_Golem_Persistence',
    golemsKept: 1,
    effect: 'Your nearest surviving golem follows you down the stairs.',
  },
  {
    id: 'golemInfusion', name: 'Lasting Infusion', price: PRICES.golemInfusion,
    requires: ['golemKeep1'], live: false,
    lands: 'phase 6 — Corpse_Raising_And_Golem_Persistence', golemInfusion: true,
    effect: 'A golem that follows you keeps its rank and its elemental infusion.',
  },
  {
    id: 'golemKeep2', name: 'Second Servant', price: PRICES.golemKeep2,
    requires: ['golemInfusion'], live: false,
    lands: 'phase 6 — Corpse_Raising_And_Golem_Persistence', golemsKept: 2,
    effect: 'Two golems survive the descent instead of one.',
  },
  {
    id: 'altarPages', name: 'Wider Rites', price: PRICES.altarPages, requires: [],
    live: false, lands: 'phase 8 — Deeper_Dungeon',
    effect: 'Altars draw their spell offers from a deeper pool of pages.',
  },
  {
    id: 'blessing', name: 'Dungeon Mouth Blessing', price: PRICES.blessing, requires: [],
    live: false, lands: 'phase 7 — Guidance_And_Blessings',
    effect: 'Choose one of three blessings before you set foot on the first floor.',
  },
  {
    id: 'blessingWider', name: 'Deeper Blessings', price: PRICES.blessingWider,
    requires: ['blessing'], live: false, lands: 'phase 7 — Guidance_And_Blessings',
    effect: 'More blessings enter the run-start roll.',
  },
  {
    id: 'slots4', name: 'Fourth Binding', price: PRICES.slots4, requires: [], live: true,
    slots: 4,
    // NOTE: the slot this buys has nothing to fill it today. Golden pages used to
    // be what wrote the starting book and they are now a one-run gift that never
    // touches it (`docs/DESIGN.md`, Altar), so no mechanism currently CHOOSES a
    // starting page. Stated flatly rather than papered over with copy that promises
    // one — the missing half is a design question, not a wording problem.
    effect: 'Your starting book binds a fourth page.',
  },
];

export const NODE_BY_ID: Readonly<Record<string, TreeNode>> =
  Object.fromEntries(TREE.map((n) => [n.id, n]));

export function isNodeId(id: unknown): id is NodeId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(NODE_BY_ID, id);
}

/**
 * Owned-set membership, taking a plain string.
 *
 * Callers hold node ids that came out of `localStorage` or off a harness, and
 * asking them to narrow to `NodeId` first would mean the type guard runs before
 * the question every time.
 */
export function owns(owned: readonly string[], id: string): boolean {
  return owned.includes(id);
}

/** The highest ceiling any owned node raises `pick` to, or `base`. */
function ceiling(
  owned: readonly string[], base: number, pick: (n: TreeNode) => number | undefined,
): number {
  let max = base;
  for (const n of TREE) {
    const v = owned.includes(n.id) ? pick(n) : undefined;
    if (v !== undefined && v > max) max = v;
  }
  return max;
}

export function derivedHandSize(owned: readonly string[]): number {
  return ceiling(owned, BASE_HAND_SIZE, (n) => n.handSize);
}

export function derivedSlots(owned: readonly string[]): number {
  return ceiling(owned, BASE_SLOTS, (n) => n.slots);
}

/** Zero means the belt is a bare strap — locked, and it says so. */
export function derivedBeltSlots(owned: readonly string[]): number {
  return ceiling(owned, 0, (n) => n.beltSlots);
}

export function derivedGolemsKept(owned: readonly string[]): number {
  return ceiling(owned, 0, (n) => n.golemsKept);
}

export function derivedGolemInfusion(owned: readonly string[]): boolean {
  return TREE.some((n) => n.golemInfusion === true && owned.includes(n.id));
}

/** Nodes that name `id` as a prerequisite, owned or not. */
export function dependents(id: string): NodeId[] {
  return TREE.filter((n) => (n.requires as readonly string[]).includes(id)).map((n) => n.id);
}

/** The prerequisites of `id` that are not owned. */
export function missingPrereqs(id: string, owned: readonly string[]): NodeId[] {
  return (NODE_BY_ID[id]?.requires ?? []).filter((r) => !owned.includes(r));
}

/** Why this cannot be bought right now, or null when it can. */
export function buyBlocker(id: string, owned: readonly string[], stars: number): string | null {
  const node = NODE_BY_ID[id];
  if (!node) return `No such node: ${id}.`;
  if (owned.includes(id)) return `${node.name} is already yours.`;
  const missing = missingPrereqs(id, owned);
  if (missing.length) {
    return `${node.name} needs ${missing.map((m) => NODE_BY_ID[m]?.name ?? m).join(' and ')} first.`;
  }
  if (stars < node.price) return `${node.name} costs ${node.price}. You have ${stars}.`;
  return null;
}

/**
 * Why this cannot be refunded right now, or null when it can.
 *
 * THE REFUND RULE: leaves only. A node cannot be sold while anything that
 * requires it is owned, and the refusal names what to sell first. The
 * alternative — cascading — would make one tap on hand size 2 dismantle the belt,
 * corpse rites and every golem node at once, which is the most destructive action
 * in the meta screen fired by its smallest gesture. Refusing instead keeps the
 * star delta of a refund exactly one price, keeps the owned set closed under
 * prerequisites by construction rather than by repair, and makes the tree teach
 * its own shape: you find out the belt depends on hand size 2 by being told to
 * sell the belt first.
 */
export function refundBlocker(id: string, owned: readonly string[]): string | null {
  const node = NODE_BY_ID[id];
  if (!node) return `No such node: ${id}.`;
  if (!owned.includes(id)) return `${node.name} is not yours.`;
  const held = dependents(id).filter((d) => owned.includes(d));
  if (held.length) {
    return `Sell ${held.map((d) => NODE_BY_ID[d]?.name ?? d).join(' and ')} first —`
      + ` ${held.length === 1 ? 'it needs' : 'they need'} ${node.name}.`;
  }
  return null;
}

/**
 * The owned set a save is allowed to load with: known ids, no duplicates, in tree
 * order, and closed under prerequisites.
 *
 * Unmet prerequisites are PRUNED rather than filled in. A save that owns the belt
 * without hand size 2 is a save no purchase path can produce, so it was
 * hand-edited or half-written — and granting the missing prerequisite would hand
 * out a node nobody paid for, while dropping the dependent only takes away one
 * that never legally existed. Iterated, because pruning a node can orphan another.
 */
export function sanitizeOwned(raw: unknown): NodeId[] {
  const seen = new Set<NodeId>();
  if (Array.isArray(raw)) {
    for (const v of raw) if (isNodeId(v)) seen.add(v);
  }
  for (;;) {
    const orphan = [...seen].find((id) => missingPrereqs(id, [...seen]).length > 0);
    if (!orphan) break;
    seen.delete(orphan);
  }
  return TREE.filter((n) => seen.has(n.id)).map((n) => n.id);
}

/**
 * What an older save owns.
 *
 * Saves from before the tree have no owned set at all, but they DO have a
 * `handSize` and a `slots` that gameplay has been reading all along — so those two
 * numbers are read back as the nodes that would have produced them. That keeps the
 * migration coherent in the only direction that matters: nothing a save could
 * already do is taken away, and the fields stop being independently writable in
 * the same move. In practice this grandfathers almost nothing (a save from the
 * current build is hand size 1 with three slots) — it exists so a save that had
 * been poked at does not load as a player who lost their hand.
 */
export function migrateOwned(raw: unknown, handSize: number, slots: number): NodeId[] {
  if (Array.isArray(raw)) return sanitizeOwned(raw);
  return sanitizeOwned(
    TREE.filter((n) => (n.handSize !== undefined && n.handSize <= handSize)
      || (n.slots !== undefined && n.slots <= slots)).map((n) => n.id),
  );
}
