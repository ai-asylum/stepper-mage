# Casting And Movement

**Player-facing:** yes
**Started:** —
**Status:** planned

Re-bases the turn rule to **cast = 1 turn**, makes the grimoire appear only when there
is something to cast at, and gives movement a second hand.

## Why this phase

The old rule — every component costs a turn, the cast is free — had a trap in it.
Taking a component charged a turn, returning one was free, so drawing and cancelling
in a loop handed the room free rounds and killed the player for changing their mind.
Punishing a change of mind is the worst thing a turn economy can do.

It goes first for the same reason the original turn-economy phase did: it changes what
everything downstream is balanced against, and content built against the old rule
would need retuning twice.

The casting UX is here rather than in its own phase because it is the same subject.
Where the turn goes decides what the CAST button means, and the book being on screen
with nothing to aim at is the same confusion as not knowing what an action costs.

## Settled decisions

- **Cast = 1 turn.** Taking a component — tear, harvest, belt draw — is free. Moving
  costs a turn. Nothing else does.
- The grimoire is visible **only when a target is selected**.
- An enemy **directly ahead and alerted** (moving or attacking) is auto-selected.
- A target that is no longer visible — behind a wall, out of view — is dropped.
- When every hand slot is full the grimoire slides away and a **large CAST takes its
  place**. There is no manual hide any more.
- Cancelling a held component with the red ✕ brings the grimoire back.
- The floating floor name is deleted; the top-left reads `DEPTH IV — The Drowned
  Library`.
- Two-finger swipes mirror WASD. **A / D side-step**, facing unchanged. **W / S move
  and turn 180** — both of them, because one-finger down already does a plain
  back-step, so a two-finger version that did not turn would be the same gesture
  twice.
- **W / S swap places with the creature in front of or behind you**, leaving you
  behind it and facing its back.
- **Bosses are swappable.** A rule with exceptions cannot be learned.

## Out of scope

- Enemy art, facing sprites, attack poses and attack VFX — Enemy_Identity.
- Elemental weaknesses and resistances — Enemy_Identity.
- Any pixel-art retexturing — Pixel_Art_Overlay.
- The belt, which is switched off behind `BELT_ENABLED`. Its draw path stays gated.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

Note that `docs/DESIGN.md`'s `## Turn economy` section describes the superseded rule
and is corrected as part of this phase. The consequences it draws — that fusions are
investments, that hand size 1 is a complete game, that preparation is the reward —
follow from the old rule and do not survive it. Under cast = 1 turn a three-page
fusion costs the same as a single page, so fusion stops being priced in turns and
hand size becomes capability bought with stars.

## Acceptance

- Drawing and cancelling a component in a loop costs nothing and cannot kill you.
- A three-page fusion and a one-page cast both cost exactly one turn.
- With no target selected the grimoire is not on screen.
- Walking into a room where an enemy is ahead and active selects it without a tap.
- Turning away from the selected target drops it.
- Filling the hand replaces the grimoire with the large CAST; a red ✕ restores it.
- No control anywhere hides or shows the grimoire.
- A two-finger swipe left side-steps; up and down both move and turn 180.
- W into an occupied tile swaps with its occupant, boss included, and leaves the
  player facing its back.
- `tools/fullrun.mjs --hand1` is re-tuned and green against the new rule.
