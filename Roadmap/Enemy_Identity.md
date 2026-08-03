# Enemy Identity

**Player-facing:** yes
**Status:** in progress
**Started:** 2026-08-03

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
- **"Physical" resolves to gust and stone. No new element.** Resistances are a table of
  element to multiplier, so "weak to physical blows" is spelled "weak to gust, weak to
  stone" and nothing has to be added to `Element` or to the three-sources rule.

  Stone alone was the obvious answer and it is wrong: stone is a FIXTURE element, and
  the only props that yield it are the floor-3 statue and the floor-4 gears and hoist.
  Floor 2 is the Ossuary Kitchens — the floor made of bone — and it harvests water and
  oil. Bone-weak-to-stone would have been unexploitable on the one floor it is about.

  Gust carries it because it is a book page, so it is available on every floor from the
  first turn. It is also already the impact element: it is the one that staggers. Stone
  rides along as the fixture-sourced version of the same blow, a bonus where a floor
  happens to have one, never the only key to a door.
- **Left and right are the same drawing, mirrored.** A grid stepper only ever shows a
  creature at four relative angles, and two of them are the same profile seen from
  opposite sides. Flipping the quad's UV costs nothing and removes a whole pose from
  every creature in the roster.

## Out of scope

- New floors, new creatures, new spells or new fusions.
- The bestiary screen, which is Guidance_And_Blessings.
- Any change to the turn rule — that is settled in Casting_And_Movement.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

Two things to resolve before building rather than during:

**The sprite run, sized.** Forty things in the roster move and attack: 15 enemies, 5
bosses and 20 golems. Everything else is scenery. A front already exists for all of
them, so a full set of front, side, back and attack is three new frames each — 120
generations against the 65 sprites in the whole game today.

Mirroring takes the first bite: without it a creature needs a left AND a right and the
run is 160. It is 120 because left is right flipped.

The rest of the trim is ordering, not cutting:

1. **Back and side for the 20 hostiles — 40 frames.** This is the phase. Facing has no
   signal at all today, so this is the only tier that buys an acceptance criterion
   nothing else can.
2. **Attack frames for the 20 hostiles — 20 frames.** Lower priority than it looks:
   `Sprite` already animates an attack by TRANSFORM — anticipation, lunge, squash —
   so an attack already reads as an attack. A drawn pose makes it better; facing makes
   it possible.
3. **Golems, 60 frames, as a follow-up.** They are swappable (`bodyAt` includes an
   animated prop) and you walk behind them constantly, so they genuinely want the same
   treatment. No acceptance criterion in this phase mentions them.

**Generate every new angle with `--reference` against the existing front.** This is
the technique the whole run depends on and it is not optional. Pixel_Resolution_Steps
established, at the cost of six wasted generations, that changing a prompt changes what
the model returns even on the same seed — the floor-1 boss came back as a winged figure
instead of an open book with an eye. A back view generated from a prompt would be a
different creature seen from behind. It has to be an edit of the front.

## Acceptance

- A creature facing away from the player is visibly facing away.
- Swapping past a creature leaves you looking at its back, and that reads.
- An enemy that is about to attack is distinguishable from one that is not, before it
  attacks.
- An enemy attack produces an attack pose and a screen effect.
- The same spell does visibly different damage to two different creatures.
- A player who has fought a creature can tell what it resists without leaving the run.
- Fireball is not the correct answer to every enemy on a floor.
