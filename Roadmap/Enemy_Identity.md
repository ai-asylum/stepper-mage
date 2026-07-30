# Enemy Identity

**Player-facing:** yes
**Status:** planned
**Started:** —

Creatures get facing, attack poses, attack VFX, a telegraph before they act, and
elements they are weak and resistant to.

## Why this phase

Two problems that are really one: you cannot read the creature in front of you.

An enemy's facing is invisible and means nothing, so the swap that leaves you at its
back has nothing to show for it. And every enemy takes the same damage from
everything, so Fireball is correct against all of them and the five elements collapse
into one. A spell system with five elements and no reason to choose between them is a
spell system with one element.

Facing and elements are the same fix from two directions. Both are creature state the
player has to be able to see and then exploit.

## Settled decisions

- Every creature gets **facing** — at minimum a front and a back, chosen by the angle
  between its facing and the camera. Enemies need a direction on the entity; they have
  none today.
- Every creature gets an **attack pose**.
- An enemy attack plays a **screen VFX** — a claw swipe, a beam, whatever suits the
  creature.
- An enemy about to act is **telegraphed before it acts**.
- Creatures have **elemental weaknesses and resistances**. Paper and library stock is
  weak to fire; bone resists fire and is weak to physical blows.
- A creature's element is **learned by fighting it**, not read off a tooltip.

## Out of scope

- New floors, new creatures, new spells or new fusions.
- The bestiary screen, which is Guidance_And_Blessings.
- Any change to the turn rule — that is settled in Casting_And_Movement.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

Two things to resolve before building rather than during:

**"Weak to physical blows" has no channel to land in.** The game has no physical
damage. The five pages are fire, frost, spark, gust and decay; the four fixture
elements are stone, water, oil and starlight. Stone is the closest thing to a physical
blow and Gust shoves. So bone-weak-to-physical either resolves to Stone, or it means
adding a physical channel — which is a new element and touches the three-sources rule.

**The sprite count is the real cost.** 35 creatures and 5 bosses, at front, back and
attack, is roughly 120 frames against the 63 that exist in the whole game today. That
is a Scenario generation run, and the manifest is the content bible it has to go
through. Sizing that honestly, and deciding whether every creature needs a back or
only the ones you can get behind, comes first.

## Acceptance

- A creature facing away from the player is visibly facing away.
- Swapping past a creature leaves you looking at its back, and that reads.
- An enemy that is about to attack is distinguishable from one that is not, before it
  attacks.
- An enemy attack produces an attack pose and a screen effect.
- The same spell does visibly different damage to two different creatures.
- A player who has fought a creature can tell what it resists without leaving the run.
- Fireball is not the correct answer to every enemy on a floor.
