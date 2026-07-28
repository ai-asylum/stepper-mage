# Todo

Task rules: ≤25 words, one line, no nesting. `Commit changes.` is the final task of
every phase. Never list tasks for editing this file or a phase doc.

## Phase 1 — Turn_Economy_And_Hand_Size

- [ ] Add `meta.handSize` (default 1) and gate `book.canRip` on it instead of the hardcoded 3.
- [ ] Reduce the grimoire to five element pages; move Animate, Growth and Multishot to ingredients.
- [ ] Refuse any cast that contains no element, ingredients included.
- [ ] Charge one turn per component taken: tear, harvest, belt draw. Release the cast for free.
- [ ] Make returning a component free, and never drop the hand when the player is hit.
- [ ] Run the enemy round on each component taken, so assembling in combat is punished.
- [ ] Show assembly cost in the HUD: turns spent this assembly, beside the cast bar.
- [ ] Retune enemy damage and HP for the new tempo across all five floors.
- [ ] Commit changes.

## Phase 2 — Altar_Reward_Node

- [ ] Extend `AltarOffer` with heal, stars, rank-up, sacrifice, reroll, golden kinds.
- [ ] Guarantee at least one spell option in every roll.
- [ ] Implement sacrifice: spend a rank-2 page to take another to rank 3.
- [ ] Implement golden pages: claim into a `meta.loadout` slot, displace-choice when full.
- [ ] Add reroll charges, banked on the player, spent to re-roll an altar.
- [ ] Draw rank pips and the golden treatment on offer cards.
- [ ] Commit changes.

## Phase 3 — Harvest_And_Room_Elements

- [ ] Add object reactions: oil and fire, water and spark, statue and gust, and the rest of the table.

- [ ] Add Stone, Water, Oil, Starlight elements with no book page.
- [ ] Tag props with a harvest element; leave bookshelf, lectern, telescope, meat rack, bone pile, fungus animate-only.
- [ ] Add a HARVEST pill on the selected fixture, gated on line of sight.
- [ ] Add harvested elements to the fan as rank-1 cards that never scale with rank.
- [ ] Author Meteor, Glacier, Lodestone, and the Oil and Water interactions.
- [ ] Keep fixtures non-depleting; animating one removes it as a tap.
- [ ] Commit changes.

## Phase 4 — Star_Tree

- [ ] Build the pre-dungeon tree screen with prerequisite edges and refunds.
- [ ] Add nodes: hand size 2 and 3, belt 3 and 6, corpse raising, altar pool, loadout slots.
- [ ] Add golem-on-descent nodes: keep one, keep its rank and infusion, keep two.
- [ ] Make belt nodes require hand size 2, since every ingredient needs something to modify.
- [ ] Persist purchases and refunds in `meta`, with save migration.
- [ ] Route the death screen into the tree instead of reloading the page.
- [ ] Commit changes.

## Phase 5 — Ingredient_Belt

- [ ] Draw the belt strip under the book in locked, empty and filled states.
- [ ] Implement the five ingredients: object animation, Coffin Moss, Growth, Multishot, TimeSand.
- [ ] Make TimeSand free to take and zero the turn cost of the next two components.
- [ ] Drop ingredients generously from chests, bosses and altars.
- [ ] Show "you have nowhere to keep it" and pulse the strap when the belt is locked.
- [ ] Consume an ingredient only on cast; taking one out stays returnable.
- [ ] Commit changes.

## Phase 6 — Corpse_Raising_And_Golem_Persistence

- [ ] Carry the nearest surviving golem through the stairs when the node is owned.
- [ ] Preserve the carried golem's rank and infusion at the second tier.
- [ ] Leave a corpse entity where an enemy dies, animatable once the node is bought.
- [ ] Render raised corpses from the enemy sprite with a tint and violet eyes.
- [ ] Crumble raised corpses after five turns.
- [ ] Commit changes.

## Phase 7 — Guidance_And_Blessings

- [ ] Add a compass pointing at unclaimed altar, then living boss, then stairs.
- [ ] Add a run-start blessing: choose one of three at the dungeon mouth.
- [ ] Fill the bestiary as props are animated and fusions discovered, free and never sold.
- [ ] Commit changes.

## Phase 8 — Deeper_Dungeon

- [ ] Author the seven missing element triples.
- [ ] Add floors 6 to 10 with their own palettes, rosters and bosses.
- [ ] Generate the sprite roster for the new floors.
- [ ] Commit changes.

## Phase 9 — Descent_Unlocks

- [ ] Record boss kills in `meta` and unlock the floor above each as a start point.
- [ ] Offer a start-depth choice at run start, every fifth floor.
- [ ] Grant three catch-up altar draws when starting deep.
- [ ] Commit changes.

## Phase 10 — Polish_Pass

- [ ] Stop target markers drawing through walls.
- [ ] Fix golems stalling instead of following.
- [ ] Break the monochrome orange cast; make each floor read as its own palette.
- [ ] Add a chest golem sprite and let Animate target chests.
- [ ] Commit changes.
