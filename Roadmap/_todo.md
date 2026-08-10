# Todo

Task rules: ≤25 words, one line, no nesting. `Commit changes.` is the final task of
every phase. Never list tasks for editing this file or a phase doc.

## Phase 1 — Turn_Economy_And_Hand_Size

- [x] Add `meta.handSize` (default 1) and gate `book.canRip` on it instead of the hardcoded 3.
- [x] Reduce the grimoire to five element pages; move Animate, Growth and Multishot to ingredients.
- [x] Refuse any cast that contains no element, ingredients included.
- [x] Charge one turn per component taken: tear, harvest, belt draw. Release the cast for free.
- [x] Make returning a component free, and never drop the hand when the player is hit.
- [x] Run the enemy round on each component taken, so assembling in combat is punished.
- [x] Show assembly cost in the HUD: turns spent this assembly, beside the cast bar.
- [x] Retune enemy damage and HP for the new tempo across all five floors.

### Post-review fixes (Run 1)

- [x] Price the rank ladder against the turn economy so rank is not strictly better than fusing.
- [x] Stop a two-turn freeze refreshing before it expires at one action per round.
- [x] Let the only hand-size-1 freeze reach the SHATTER threshold, or lower the threshold.
- [x] Fix the standoff band where hostiles are targetable but may not act.
- [x] Rebase COMBOS so no pair costs more turns than it beats.
- [x] Give Gust its stagger and make Decay worth the rounds it needs.
- [x] Scale healing with the cost curve and stop the cap discarding floor-1 heals.
- [x] Make `Combat.takeTurn` report whether anything acted, and pace the rounds.
- [x] Count only paid turns in the HUD readout; move it off the log's first row.
- [x] Split "hand full" from "not learned", and surface the hand size.
- [x] Resolve cast legality before the merge so a refusal cannot eat the hand.
- [x] Wrap the turn and cast paths in `try/finally` so a throw cannot soft-lock input.
- [x] Clamp `slots` and `handSize` on load; restore `handSizeBonus` after debug use.
- [x] Refresh targets on the keyboard clear path.
- [x] Repoint the harnesses at element-only scenarios and drop `state.mana`.
- [x] Move the engage radius and SHATTER threshold into tuning; fix the jitter comment.
- [x] Commit changes.

## Phase 2 — Altar_Reward_Node

- [x] Extend `AltarOffer` with heal, stars, rank-up, sacrifice, reroll, golden kinds.
- [x] Guarantee at least one spell option in every roll.
- [x] Implement sacrifice: spend a rank-2 page to take another to rank 3.
- [x] Implement golden pages: claim into a `meta.loadout` slot, displace-choice when full.
- [x] Add reroll charges, banked on the player, spent to re-roll an altar.
- [x] Draw rank pips and the golden treatment on offer cards.
- [x] Commit changes.

## Phase 3 — Harvest_And_Room_Elements

- [x] Add object reactions: oil and fire, water and spark, statue and gust, and the rest of the table.

- [x] Add Stone, Water, Oil, Starlight elements with no book page.
- [x] Tag props with a harvest element; leave bookshelf, lectern, telescope, meat rack, bone pile, fungus animate-only.
- [x] Add a HARVEST pill on the selected fixture, gated on line of sight.
- [x] Add harvested elements to the fan as rank-1 cards that never scale with rank.
- [x] Author Meteor, Glacier, Lodestone, and the Oil and Water interactions.
- [x] Keep fixtures non-depleting; animating one removes it as a tap.
- [x] Commit changes.

## Phase 4 — Star_Tree

- [x] Build the pre-dungeon tree screen with prerequisite edges and refunds.
- [x] Add nodes: hand size 2 and 3, belt 3 and 6, corpse raising, altar pool, loadout slots.
- [x] Add golem-on-descent nodes: keep one, keep its rank and infusion, keep two.
- [x] Make belt nodes require hand size 2, since every ingredient needs something to modify.
- [x] Persist purchases and refunds in `meta`, with save migration.
- [x] Route the death screen into the tree instead of reloading the page.
- [x] Commit changes.

## Phase 5 — Casting_And_Movement

- [x] Charge a turn on cast and on moving only; make taking a component free.
- [x] Retune the balance and the acceptance gate against the new rule.
- [x] Show the grimoire only while a target is selected.
- [x] Auto-select an alerted enemy directly ahead; drop a target that leaves sight.
- [x] Replace the grimoire with a large CAST when every hand slot is full.
- [x] Remove the manual show/hide control and its key binding.
- [x] Move the floor name into the top-left as `DEPTH <n> — <name>`.
- [x] Add two-finger swipes: left and right side-step, up and down move and turn 180.
- [x] Swap places with the creature ahead or behind, ending up facing its back.
- [x] Correct the design doc's turn economy section and everything it concluded.
- [x] Commit changes.

## Phase 6 — Pixel_Art_Overlay

- [x] Prove page text is readable as pixel art before retexturing anything.
- [x] Author the book's covers, spine and ribbons through `Pix`, nearest-filtered.
- [x] Author the page faces through `Pix`, keeping the model and the curl shader.
- [x] Redraw the twelve tree pictograms as pixel art blitted at an integer scale.
- [x] Snap a flat field to a ramp step and dither only a falloff, in the world as
      well as the book — an ordered dither over a flat tone is a checkerboard.
- [x] Commit changes.

## Phase 7 — Pixel_Resolution_Steps

- [x] Make PPU a runtime value; rebuild every texture and sprite size when it changes.
- [x] Author the masonry, bevel, AO and crack constants for each of the four steps.
      The table is `STEP_ART` in `src/art/steps.ts`; 144 is authored, the other three
      are marked placeholders.
- [x] Author each theme's detail vocabulary at each step, judged by eye not by scale.
      Same table, the `detail` group.
- [x] Re-derive every sprite at each step from the cached raws, keeping world size fixed.
      Shipped at 144, 72 and 36; the 18 roster was generated, judged unidentifiable and
      cut, so the 18 world draws creatures from 36. See the phase doc.
- [x] Add a persisted resolution setting with all four steps, and a way to reach it.
- [x] Decide whether the book and tree atlases follow the step, and do what you decide.
      They do not — see the phase doc's settled decisions.
- [x] Commit changes.

## Phase 8 — Enemy_Identity

- [x] Decide what "physical" resolves to, and size the sprite run before generating.
      Gust and stone, no new element; 40 frames for hostile back+side first. Phase doc.
- [x] Give every entity a facing, and set it when a creature moves or attacks.
- [x] Generate back and side frames for the twenty hostiles, from the front by reference.
- [x] Generate attack frames for the twenty hostiles.
- [x] Pick the drawn frame from the angle between a creature's facing and the camera.
- [x] Telegraph an enemy that is about to act, before it acts.
- [x] Play an attack pose and a screen effect when an enemy hits the player.
- [x] Give creatures elemental weaknesses and resistances that change damage taken.
- [x] Teach a creature's element by fighting it, without a tooltip.
- [x] Commit changes.

### Post-review fixes (Run 1)

- [x] Play the attack strike only for an attacker directly ahead and visible.
- [x] Add a directional damage indicator, researched against how other games do it.
- [x] Commit changes.

## Phase 9 — Spell_Reach

- [ ] Decide which spells are volumes and which are radii, and write the table.
- [ ] Flood the grid from the blast centre by path distance; splash, arcs and reactions.
- [ ] Let a volume reach and damage the player.
- [ ] Retune the balance and the acceptance gate against the shorter effective reach.
- [x] Commit changes.

## Phase 10 — Burning_Ground

- [ ] Add a floor layer that holds burning tiles and ages them each round.
- [ ] Draw burning ground so it is unmistakable at 72 texels on a brown floor.
- [ ] Make standing in fire cost something, for creatures and the player alike.
- [ ] Let one Gust clear the fire it reaches.
- [ ] Decide whether enemies avoid burning tiles, and record the decision either way.
- [x] Commit changes.

## Phase 11 — Elemental_Spread

- [x] Measure, per floor, how many creatures each element beats. Four of five floors
      broke the three-page rule, not just floor 3. Table in the phase doc.
- [x] Reassign affinities per floor so no floor is solvable with one element.
- [x] Spread every floor across at least three pages; fix floor 3's four-of-four fire.
- [ ] Look at the cast readout, discovery banner and nameplate marks at 375px.
      BLOCKED: no debug seam holds a target long enough to open the book — see the doc.
- [x] Retune the gate and the `mixed` policy's page choice against the new table.
      Moot: the gate and its policies were deleted with `fullrun.mjs` on 2026-08-09.
- [x] Commit changes.

## Phase 12 — Dungeon_Shape

- [x] Spawn bosses at the centre of their room so they cannot wedge behind furniture.
      Nearest tile to the centre with three free neighbours, via `openTiles`.
- [x] Move the way down to the boss's position when it dies. `Floor.revealStairs(at)`.
- [x] Keep the stairs off the minimap until the boss falls. `Floor.stairsOpen`.
- [x] Stop a corpse blocking the tile its own staircase opened on. Found by walking it.
- [ ] Verify descending both by walking in and by tapping.
      WALK-IN VERIFIED: depth 1 -> 2 on a real step. Tapping still unverified — both
      attempts were invalid tests, not evidence. See the phase doc.
- [x] Commit changes.

## Phase 13 — First_Minutes

- [x] Lock the world to 72 texels and delete the chip, the setting and its harness.
- [x] Stop the camera changing pitch when the grimoire rises. Never a measurement —
      the settled shift is 0.132 at every viewport, so it is a constant now.
      Needs the settled `frameShift` read off a running loop — see the phase doc.
- [x] Hide the empty hand slots while the book plays its intro. `Hud.bookBusy`.
- [x] Add a movement hint that clears on the first step and never returns.
- [x] Commit changes.

## Phase 14 — Altar_Screen

- [x] Lay the three offers out as columns, left to right.
- [x] Draw a spell offer as a spell-book page at card size. It is the REAL page —
      `actionPage`, the same call the book makes. A lookalike was tried and rejected.
- [x] Draw a non-spell offer as a scroll in the same pixel-art hand.
- [x] Add a gold treatment to the page face and use it wherever a golden page is drawn.
      `giltify` in `book/giltify.ts`; `setGilded` puts it in the book for the run.
- [x] Commit changes.

## Phase 15 — Corpse_Raising_And_Golem_Persistence

- [ ] Carry the nearest surviving golem through the stairs when the node is owned.
- [ ] Preserve the carried golem's rank and infusion at the second tier.
- [ ] Leave a corpse entity where an enemy dies, animatable once the node is bought.
- [ ] Render raised corpses from the enemy sprite with a tint and violet eyes.
- [ ] Crumble raised corpses after five turns.
- [ ] Commit changes.

## Phase 16 — Guidance_And_Blessings

- [x] Add a compass pointing at unclaimed altar, then living boss, then stairs.
      Bearing only — no distance, which would triangulate the tile. See the phase doc.
- [x] Add a run-start blessing: choose one of three at the dungeon mouth.
      Reuses the altar's chooser; the `blessing` tree node is now live.
- [x] Fill the bestiary as props are animated and fusions discovered, free and never sold.
      FUSION half only, by decision — the animation half needs the belt. The sections
      are independent, so the other appears by itself when `BELT_ENABLED` returns.
- [x] Commit changes.

## Phase 17 — Deeper_Dungeon

- [ ] Author the seven missing element triples.
- [ ] Add floors 6 to 10 with their own palettes, rosters and bosses.
- [ ] Generate the sprite roster for the new floors.
- [ ] Commit changes.

## Phase 18 — Descent_Unlocks

- [x] Record boss kills in `meta` and unlock the floor above each as a start point.
      A SET of depths, not a high-water mark — the only shape that survives a deep start.
- [x] Offer a start-depth choice at run start, every fifth floor. Reuses the altar's
      chooser; runs after `engine.start()` or boot deadlocks on its own modal.
- [x] Grant three catch-up altar draws when starting deep. Rolled at the mouth with a
      null altar, through the same chooser.
- [x] Fix the income slope: a body pays by depth now, not a flat +1 at every floor.
- [x] Commit changes.

## Phase 19 — Polish_Pass

- [x] Stop target markers drawing through walls. (Closed early by Casting_And_Movement.)
- [x] Re-cull after every enemy round; a body that moves into view is currently never drawn.
- [ ] Fix golems stalling instead of following.
      NOT REPRODUCED. Registration is correct — `Combat.register` is called from the
      animate branch — and reading the heel path found no certain fault. Two attempts
      to reproduce it live were invalid (one never registered the combatant, the other
      timed out mid-await). Needs a real animate cast, which needs the belt.
- [x] Break the monochrome orange cast; make each floor read as its own palette.
      It was the TONEMAP, as the doc guessed. Per-channel ACES bleached hue as soon as
      the torch lit a surface. Luminance-mapped with chroma preserved now.
- [ ] Add a chest golem sprite and let Animate target chests.
      Needs one sprite generated through `tools/genart.py`. The TARGETING half is
      already done: `isCastableObject` accepts a spent chest (phase 10).
- [~] Untangle the HUD text layer: log lines, captions, name plates and cards overdraw each other.
      The LOG now yields — it is the only element in that band that is a record rather
      than a control, so it stacks up from whatever the cast UI is not using and caps
      itself to what fits under the shout. Nameplates and fan cards are untouched.
- [x] Re-check free-turn attrition; the turn rule change may already have dissolved it.
      DISSOLVED, as the doc predicted. `enemyRound` is reached only from a cast or a
      step; taking and returning components never touches it, so there is no loop to
      farm. Closed by Casting_And_Movement without anyone editing this.
- [x] Stop the resting reticle preferring furniture over the creature in the room.
      Already closed. Auto-select is narrowed to a hostile that is ALERTED and
      DIRECTLY AHEAD, so it cannot land on a bookshelf at any distance.
- [x] Give the sixth belt loop and the fourth loadout slot something to hold, or remove them.
      The belt's sixth loop is removed — five ingredients exist, so it sold an empty
      pouch on top of a true claim. The fourth loadout slot is FINE and was a false
      entry: five page elements exist, so four is fillable. The second real offender
      is `altarPages`, which is already correctly `live: false` behind Deeper_Dungeon.
- [x] Step the torch sconce's resolution; it is the last thing in the world drawn at 144.
      `buildSconce` is proportional now and the four steps carry sizes to match.
- [x] Commit changes.

## Phase 20 — Ingredient_Belt

- [x] Draw the belt strip under the book in locked, empty and filled states.
- [x] Implement the five ingredients: object animation, Coffin Moss, Growth, Multishot, TimeSand.
- [x] Make TimeSand free to take and zero the turn cost of the next two components.
- [x] Drop ingredients generously from chests, bosses and altars.
- [x] Show "you have nowhere to keep it" and pulse the strap when the belt is locked.
- [x] Consume an ingredient only on cast; taking one out stays returnable.
- [x] Commit changes.
