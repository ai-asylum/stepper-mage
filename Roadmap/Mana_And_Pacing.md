# Mana And Pacing

**Player-facing:** yes
**Status:** planned
**Started:** —

Movement pays for casting. **This reverses the game's oldest settled rule.**

## Why this phase

Standing still and casting is optimal. There is no reason to ever move except to
reach something, so every mechanic that depends on the player circulating — ground
fire, ledges, timed blades, sliding on ice, timed doors — is toothless against a
player who plants their feet.

That is also the root of the game being too easy, and it is not a number that can be
tuned. It is the shape of the economy: a cast costs a turn, a turn costs nothing, so
casts are free in the only currency that exists.

Mana per move inverts it. Movement becomes the thing that pays for casting, so the
player is always circulating, and every positioning mechanic in the dungeon phases
starts to bite.

## Settled decisions

- **Gain mana by moving, spend it by casting.** One per spell.
- **Max mana and regen rate are upgradable**, which gives the star tree two honest
  axes that are pacing rather than raw power — it mostly sells "cast more at once"
  today.
- **Retreating is a reload.** Kiting stops being a wasted turn, which makes running
  away a real option for the first time.
- **A corridor is a resource and a tight room is a drain.** Layout affects pacing
  without a floor having to do anything.
- **Life steal exists, and it is Decay's.** A focus row — `count: 1`, the worst damage
  in the book, returns HP. You cast it when you are hurt, choosing to kill slower to
  stay standing. It is the counterweight to an economy that forces you into the open.

## Open — not decided

- **What a turn still costs.** Today a cast costs one turn and that IS the price. If
  mana is the price, either a cast stops costing a turn, or it has two prices and the
  tuning gets murky. Cleanest reading: mana is the price of casting, the turn is the
  price of everything, and a cast stops being special.
- **The regen rate.** One per move is generous; one per two or three moves is a
  different game and is the upgradable axis.

## Out of scope

- Rebalancing content against the new economy — Difficulty_Rebase.
- New spells other than the life-steal combo.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

**Read the header of `combat.ts` before touching anything.** It states *there is NO
mana* in a load-bearing comment, and `tuning.ts` is sized against "a cast is one turn,
a step is one turn, taking a component is free". Both documents are the previous answer
to this exact question, and the reasoning in them is worth reading before overturning
it — the free-turn attrition exploit they describe is what a component cost used to
cause.

**Every number in `tuning.ts` is fitted to the current economy.** Enemy HP is written
in casts; enemy damage is written in hits per fight. Both assume a fixed number of
casts per room, and mana changes that number.

**The HUD has nowhere to put a mana bar.** The left column is depth, health, hand and
the pinned goal; the strip under the minimap is the bestiary's now.

## Acceptance

- Standing still and casting is no longer possible indefinitely.
- Moving is the only way to recover mana, and the player does it deliberately.
- The star tree sells max mana and regen, and both change how a fight feels rather
  than how hard it hits.
- Decay's life-steal combo is the worst damage in the book and still worth casting.
- `combat.ts` and `docs/DESIGN.md` no longer claim there is no mana.
