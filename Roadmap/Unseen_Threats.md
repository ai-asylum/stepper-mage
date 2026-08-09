# Unseen Threats

**Player-facing:** yes
**Status:** planned
**Started:** —

Nothing reaches the player from outside their knowledge.

## Why this phase

Three reports that are one failure: **a creature can act on the player while the
player has no way to know it is there.**

A hostile that walks into the open during its own round stays undrawn until the player
next moves — it is standing lit in an empty corridor and simply not painted, and it
closes and swings from there. Move-and-attack made this far worse: a body now crosses
two tiles a round, so it goes from hidden to open inside a single round constantly.

And a creature legitimately at arm's length behind the player is announced only as a
number on the HP bar. The count says one is in reach; nothing says where.

Being surprised should always be the player's fault.

## Settled decisions

- **Culling runs after every enemy round, not only before it.** `Floor.cull` decides
  visibility and is currently called before `enemyRound` and never after. The fix
  belongs at the end of the ROUND rather than at one call site: casting runs a round
  too, so fixing only the movement path leaves casting broken.
- **A hostile within `THREAT_REACH` is on the minimap whether or not it is in sight.**
  This does not undo the wallhack fix. Memory stays banned — you never see where
  something WAS — but presence at arm's length is not seeing through a wall, it is
  knowing something is next to you.
- **The threat telegraph gains a direction.** The damage chevrons already know how to
  point; a threat in reach uses the same shape in its own treatment, so an adjacent
  unseen creature can be turned toward rather than merely counted.

## Out of scope

- Where spells reach, which is Spell_Reach. A blast is bounded by walls whether or not
  anyone is watching; this phase is about the player's knowledge and only that.
- Enemy AI, pathing or aggro range.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading.

**The cull bug is the cheapest fix on the whole roadmap and the most felt.** It is one
call in the right place. It is listed first for that reason.

**The minimap rule needs care not to undo the fix it sits next to.** `Hud.onMap`
currently requires a mover to be in the visible set; the change is to allow EITHER
visible or within reach, and the harness check that no remembered mover is plotted has
to keep passing.

## Acceptance

- No creature can move into the open and act while still undrawn, after a step or
  after a cast.
- A hostile that can reach the player is on the minimap and has a direction on screen,
  whether or not it is in the camera's view.
- The minimap still never shows a creature that is neither visible nor in reach.
