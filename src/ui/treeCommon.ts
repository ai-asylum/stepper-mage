/**
 * What the two star-tree views share: the contract with the game, the action they
 * hand back, the colour of each chain, and the route arithmetic.
 *
 * Split out because there are now TWO presentations of the same twelve nodes — the
 * constellation (`ui/tree.ts`) and the card list behind the LIST toggle
 * (`ui/treeList.ts`) — and the thing they must not disagree about is the data. Both
 * read this file; neither reads the other.
 */
import { NODE_BY_ID, TREE, type NodeId } from '../meta/tree';

/** Everything the screen has to be told, read fresh every frame. */
export interface TreeView {
  stars: number;
  owned: readonly string[];
  /** Derived, for the header readouts — the two ceilings that are live today. */
  handSize: number;
  slots: number;
  /**
   * The node the player is saving for, or null. Persisted in `meta` rather than
   * held by the screen, because the whole point of a pinned goal is that it is
   * still there during the run that earns the stars.
   */
  pinned: NodeId | null;
  /**
   * Starting-book pages that selling `id` would give up, by name.
   *
   * A refund is otherwise free and reversible, so it needs no confirmation — but
   * selling a slot node drops a page out of the starting book, and a page dropped
   * is not a page a re-purchase gives back. So it is stated BEFORE the tap, on the
   * rare save that has a page to lose.
   */
  atRisk: (id: NodeId) => string[];
}

/**
 * What a tap resolved to.
 *
 * `select` is deliberately separate from `buy`: on the constellation a tap on a
 * node NEVER spends, it fills the docked panel, and the panel's one button is the
 * only thing that commits. The list view keeps its old behaviour — the card itself
 * buys — because that is what it already was and it is the fallback, not the
 * headline.
 */
export type TreeAction =
  | { kind: 'select'; id: NodeId }
  | { kind: 'deselect' }
  | { kind: 'buy'; id: NodeId }
  | { kind: 'sell'; id: NodeId }
  /** Pin a goal and light the route to it. */
  | { kind: 'pin'; id: NodeId }
  | { kind: 'unpin' }
  /** Swap between the constellation and the card list. */
  | { kind: 'mode' }
  | { kind: 'start' }
  | { kind: 'none' };

/**
 * Colour by family, so the four chains are told apart before a word is read.
 * Exhaustive on purpose: a node added to `meta/tree.ts` without a colour here is
 * a build error rather than a node that draws in the wrong branch's paint.
 */
/**
 * One hue per chain — and none of them may be GOLD.
 *
 * Gold is the currency: the bank, the affordability arc, the complete ring that
 * means "you can buy this". The hand chain used to be gold too, so an OWNED hand
 * node was gold fill under a gold halo, and it out-shouted the star count it was
 * supposed to be spent from. It is rose now — the hand is yours, and it is the one
 * chain that is about you rather than about the dungeon.
 *
 * Corpse rites is deliberately NOT golem green either, though the two are adjacent
 * on the lattice and thematically cousins. At a 36px disc a nine-percent hue
 * difference is no difference, and the skull read as a fourth golem node. Ash
 * violet: a corpse is a body the dungeon supplied, not a servant you made.
 */
export const FAMILY: Readonly<Record<NodeId, number>> = {
  hand2: 0xe8788f, hand3: 0xe8788f,
  belt3: 0xd79a5b, belt6: 0xd79a5b,
  corpseRaising: 0xa98cc4,
  golemKeep1: 0x8ce06a, golemInfusion: 0x8ce06a, golemKeep2: 0x8ce06a,
  altarPages: 0xb98cff,
  blessing: 0x8fc9ff, blessingWider: 0x8fc9ff,
  slots4: 0xe8d9b0,
};

export const NAME_OF = (id: string): string => NODE_BY_ID[id]?.name ?? id;

/** `phase 5 — Ingredient_Belt` as something a screen can say. */
export function landsLabel(lands: string): string {
  return lands.replace(/_/g, ' ').replace(/\s*—\s*/, ' · ').toUpperCase();
}

/**
 * Prerequisite depth. `tier(n) = 0` with no prerequisites, else one past the
 * deepest of them.
 *
 * Computed rather than authored because it is a FACT about `meta/tree.ts` and would
 * go stale the moment an edge moved. The column is the opposite case and is
 * hand-authored in `ui/tree.ts` — see the note there.
 */
export const TIER: Readonly<Record<NodeId, number>> = (() => {
  const out: Partial<Record<NodeId, number>> = {};
  const depth = (id: NodeId): number => {
    const cached = out[id];
    if (cached !== undefined) return cached;
    const n = NODE_BY_ID[id];
    const d = n.requires.length ? 1 + Math.max(...n.requires.map(depth)) : 0;
    out[id] = d;
    return d;
  };
  for (const n of TREE) depth(n.id);
  return out as Record<NodeId, number>;
})();

/** How many tiers the tree has. Five today. */
export const TIERS = Math.max(...TREE.map((n) => TIER[n.id])) + 1;

/**
 * The purchases, in order, that get you from what you own now to `goal`.
 *
 * Every unowned prerequisite of the goal transitively, plus the goal, sorted by
 * tier and then by price — which is a legal purchase order by construction,
 * because a node's prerequisites are all in strictly lower tiers. This is what
 * SAVE FOR THIS pins, and it is the answer to "how do I show a path to something I
 * cannot have yet": not a highlight, a numbered shopping list with a total.
 */
export function routeTo(goal: NodeId, owned: readonly string[]): NodeId[] {
  const need = new Set<NodeId>();
  const visit = (id: NodeId): void => {
    if (owned.includes(id) || need.has(id)) return;
    need.add(id);
    for (const r of NODE_BY_ID[id].requires) visit(r);
  };
  visit(goal);
  return [...need].sort((a, b) =>
    TIER[a] - TIER[b] || NODE_BY_ID[a].price - NODE_BY_ID[b].price);
}

/** What a route costs all in. */
export function routeCost(route: readonly NodeId[]): number {
  return route.reduce((a, id) => a + NODE_BY_ID[id].price, 0);
}
