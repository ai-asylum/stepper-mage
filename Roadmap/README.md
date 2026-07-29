# Roadmap

Phased build for Stepper Mage. One file per phase, named by topic. Design decisions
live in [docs/DESIGN.md](../docs/DESIGN.md); this folder is only about sequencing
and state. Per-phase task lists are in [_todo.md](_todo.md).

Status values: `planned` · `in progress` · `shipped` · `paused`. Only one phase is
`in progress` at a time.

| # | Phase | Player-facing | Status |
|---|---|---|---|
| 1 | [Turn_Economy_And_Hand_Size](Turn_Economy_And_Hand_Size.md) | yes | shipped |
| 2 | [Altar_Reward_Node](Altar_Reward_Node.md) | yes | shipped |
| 3 | [Harvest_And_Room_Elements](Harvest_And_Room_Elements.md) | yes | shipped |
| 4 | [Star_Tree](Star_Tree.md) | yes | planned |
| 5 | [Ingredient_Belt](Ingredient_Belt.md) | yes | planned |
| 6 | [Corpse_Raising_And_Golem_Persistence](Corpse_Raising_And_Golem_Persistence.md) | yes | planned |
| 7 | [Guidance_And_Blessings](Guidance_And_Blessings.md) | yes | planned |
| 8 | [Deeper_Dungeon](Deeper_Dungeon.md) | yes | planned |
| 9 | [Descent_Unlocks](Descent_Unlocks.md) | yes | planned |
| 10 | [Polish_Pass](Polish_Pass.md) | yes | planned |

## Why this order

Turn economy is first because it re-bases the balance of everything downstream —
building content against the old "one cast, one turn" rule would mean retuning it
all later. The altar is second because it is the run's reward hub and it is
self-contained. Harvest is third and needs nothing from the tree. The tree comes
fourth because it is what unlocks the belt, and the belt is **inert below hand
size 2**, which is a real dependency edge rather than a pacing guess.

Descent unlocks are late because with five floors there is nowhere to skip to.

Phase 1 also carries the grimoire's reduction to five element pages, since moving
Animate, Growth and Multishot to the belt changes what a cast costs and there is no
sense tuning the turn economy twice.
