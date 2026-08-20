/**
 * Feature flags: shipped features that are currently parked.
 *
 * A flag in here is not a config knob and not a difficulty setting. It exists so a
 * finished feature can be turned OFF without being unwound — nothing is deleted,
 * every path stays compiled and reachable, and flipping the boolean is the whole job.
 * One boolean per feature, read from everywhere, with no per-feature sub-switches
 * underneath it: two switches for one feature is a state nobody tests.
 */

/**
 * The ingredient belt — the strip, its drops, and the tree chain that buys it.
 *
 * OFF pending a rethink of the strip's UX and UI. The phase shipped and stays shipped
 * (`Roadmap/Ingredient_Belt.md`); this is a retreat, not a deletion. With it false:
 * the strip does not draw and `BELT_BAND` relaxes to 0, no source pays an ingredient,
 * nothing can be drawn into the hand, `derivedBeltSlots` is 0, and `belt3`/`belt6`
 * plus everything downstream of them cannot be bought and say why.
 *
 * What it deliberately does NOT do is touch `meta`. A save that already owns a belt
 * node keeps it and keeps its refund, so no player loses stars to a flag — the gate is
 * on the PURCHASE, not on the owned set.
 *
 * KNOWN CONSEQUENCE, not a bug: object animation is a belt ingredient, so golems are
 * unreachable while this is false. The animate paths in `spells.ts` and `combat.ts`
 * are intact and simply never reached; what was removed is everything that ADVERTISED
 * an animation to the player, because that advertisement would now be a lie.
 */
/*
 * Annotated `boolean` and not left to infer the literal `false`, deliberately. A flag
 * inferred as `false` typechecks its two states DIFFERENTLY — every `BELT_ENABLED ?
 * a : b` collapses to one branch's type and every guarded block becomes unreachable —
 * so the build would only prove the state it is currently in, and a flag that compiles
 * one way round is a flag nobody can flip. The emitted JS is `false` either way, so the
 * bundler still folds the dead branches out.
 */
export const BELT_ENABLED: boolean = true;
