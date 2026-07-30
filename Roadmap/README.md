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
| 4 | [Star_Tree](Star_Tree.md) | yes | shipped |
| 5 | [Ingredient_Belt](Ingredient_Belt.md) | yes | shipped, flagged off |
| 6 | [Casting_And_Movement](Casting_And_Movement.md) | yes | shipped |
| 7 | [Pixel_Art_Overlay](Pixel_Art_Overlay.md) | yes | shipped |
| 8 | [Enemy_Identity](Enemy_Identity.md) | yes | planned |
| 9 | [Corpse_Raising_And_Golem_Persistence](Corpse_Raising_And_Golem_Persistence.md) | yes | paused |
| 10 | [Guidance_And_Blessings](Guidance_And_Blessings.md) | yes | planned |
| 11 | [Deeper_Dungeon](Deeper_Dungeon.md) | yes | planned |
| 12 | [Descent_Unlocks](Descent_Unlocks.md) | yes | planned |
| 13 | [Polish_Pass](Polish_Pass.md) | yes | planned |

## Why this order

Turn economy was first because it re-bases the balance of everything downstream —
building content against the old "one cast, one turn" rule would mean retuning it all
later. The altar was second because it is the run's reward hub and self-contained.
Harvest was third and needed nothing from the tree. The tree came fourth because it is
what unlocks the belt, and the belt is **inert below hand size 2**, which is a real
dependency edge rather than a pacing guess.

**Casting_And_Movement is sixth for the same reason the first phase was first.** It
changes the turn rule again — to cast = 1 turn — and everything balanced against
pay-per-component has to be re-tuned against it. Doing content first would mean tuning
it twice.

Pixel_Art_Overlay precedes Enemy_Identity because that phase adds attack VFX and an
attack telegraph, and those have to be authored in whichever pipeline wins there.
Enemy_Identity is last of the three because it is much the largest — roughly 120 new
sprite frames against the 63 in the whole game today — and it benefits from both a
settled loop and a settled art direction.

Corpse_Raising_And_Golem_Persistence is **paused**, not merely later. Coffin Moss and
the animation ingredient are both belt ingredients, and the belt is switched off behind
`BELT_ENABLED` pending a UX rethink, so that phase has nothing to build against until
the flag flips back.

Descent unlocks stay late because with five floors there is nowhere to skip to.
