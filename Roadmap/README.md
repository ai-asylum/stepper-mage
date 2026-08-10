# Roadmap

Phased build for Stepper Mage. One file per phase, named by topic. Design decisions
live in [docs/DESIGN.md](../docs/DESIGN.md); this folder is only about sequencing
and state. Per-phase task lists are in [_todo.md](_todo.md).

Status values: `planned` · `in progress` · `shipped` · `paused`. Only one phase is
`in progress` at a time.

**There is no acceptance harness any more.** `tools/fullrun.mjs` was deleted on
2026-08-09. Several phase docs still quote what it measured; read those as history.
A phase that says it changes the balance is now asserting something nobody has
played — check it before trusting it.

| # | Phase | Player-facing | Status |
|---|---|---|---|
| 1 | [Turn_Economy_And_Hand_Size](Turn_Economy_And_Hand_Size.md) | yes | shipped |
| 2 | [Altar_Reward_Node](Altar_Reward_Node.md) | yes | shipped |
| 3 | [Harvest_And_Room_Elements](Harvest_And_Room_Elements.md) | yes | shipped |
| 4 | [Star_Tree](Star_Tree.md) | yes | shipped |
| 5 | [Casting_And_Movement](Casting_And_Movement.md) | yes | shipped |
| 6 | [Pixel_Art_Overlay](Pixel_Art_Overlay.md) | yes | shipped |
| 7 | [Pixel_Resolution_Steps](Pixel_Resolution_Steps.md) | yes | shipped |
| 8 | [Enemy_Identity](Enemy_Identity.md) | yes | shipped |
| 9 | [Spell_Reach](Spell_Reach.md) | yes | shipped |
| 10 | [Burning_Ground](Burning_Ground.md) | yes | shipped |
| 11 | [Elemental_Spread](Elemental_Spread.md) | yes | shipped |
| 12 | [Dungeon_Shape](Dungeon_Shape.md) | yes | planned |
| 13 | [First_Minutes](First_Minutes.md) | yes | shipped |
| 14 | [Altar_Screen](Altar_Screen.md) | yes | shipped |
| 15 | [Corpse_Raising_And_Golem_Persistence](Corpse_Raising_And_Golem_Persistence.md) | yes | paused |
| 16 | [Guidance_And_Blessings](Guidance_And_Blessings.md) | yes | shipped |
| 17 | [Deeper_Dungeon](Deeper_Dungeon.md) | yes | shipped |
| 18 | [Descent_Unlocks](Descent_Unlocks.md) | yes | planned |
| 19 | [Polish_Pass](Polish_Pass.md) | yes | planned |
| 20 | [Ingredient_Belt](Ingredient_Belt.md) | yes | shipped, flagged off |
