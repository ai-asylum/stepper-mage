# Tile Vocabulary

**Player-facing:** yes
**Status:** shipped
**Started:** 2026-08-10

What a tile DOES to a spell, as opposed to what shape the floor is.

## Why this phase

A floor changes what the player should cast only through its creatures. Every tile is
inert: it holds you up or it does not. So the only question a room asks is "what is
weak to what", and once that is answered the room is answered.

A tile that conducts, or hides, or refuses to burn asks a second question the affinity
table cannot answer — and it asks it visibly, which is the part that matters. A rule
the player has to be told is a theme; a rule they can see in the floor is a mechanic.

## Settled decisions

- **Every surface must be legible in the tile itself.** If the player has to be told,
  it does not ship.
- **Iron plating conducts.** Spark chains along the plate to everything standing on
  it, the player included, and the plating is drawn as a shape so the circuit can be
  read before casting.
- **Fog cuts sight to two tiles.** Ranged creatures become lethal and the compass
  becomes more useful than the map.
- **Shallow water: spark chains, fire will not take.** The flooded floor as a TILE, so
  any layout can have a wet quarter and two strategies in one map.
- **Rubble costs two moves, and gust clears it.** A slow tile the player can edit.
- **Portals are a PAIR of tiles, lit the same colour.** Step on one, arrive at the
  other. That is the whole feature.
- **A floor mixes surfaces.** The layout is a floor's identity, not these.

## Settled here — the two that were open

**FOG IS A TILE**, and the bank is a whole room. As a floor-wide setting it would have
been one line and a worse object: a floor that is entirely fogged has no doorway to
stand in and decide about, and "sight is short here" stops being something you can
choose to walk into. As a room it has a shoreline you can see from outside, which is
the difference between a mechanic and a weather effect. It is drawn in two halves for
exactly that reason — the tile texture bleaches the ground so the bank READS from
across the room, and a second falloff keyed to the camera's own tile dissolves the
world once you are in it.

**A VOLUME DOES NOT CROSS A PORTAL.** It is cheap to implement and it would look
better than anything else on the list, and it is still wrong: a spell's volume is the
one thing in this game whose reach the player reads directly off the floor in front of
them, and a fill that can come out the far mouth makes the tile you are standing on
worth more than any combo in the book. Fire erupting from the other end of the floor is
a great five seconds and a permanently unreadable rule. The portal moves BODIES, which
is the whole feature, and the two floors that carry one are the two whose layouts took
footing away.

Third thing settled, which was not listed as open because nobody had noticed it was a
question: **RUBBLE COSTS A TURN, NOT A SWIPE.** "Two moves to cross" reads naturally as
a first press that refuses and a second that goes, and that is the one implementation
this must not have — a press that visibly does nothing is indistinguishable from an
input the touchscreen ate, and the lesson the player takes from it is to distrust the
control rather than to respect the terrain. One swipe crosses it. What the tile costs
is the room's answer, charged twice: the stride STOPS half a tile in, the round runs
with the player still counting as standing on the near side, and then the step
finishes and the round runs again. A body two tiles off gets to close and swing while
you are climbing.

## Out of scope

- Ground substances a CAST leaves behind. Fire, oil and water exist and are
  Burning_Ground's.
- The shape of the floor — Layout_Generators.
- Anything on a clock — Timing_And_Hazards.

## Implementation

Tasks live in [_todo.md](_todo.md) under this phase's heading. Design rationale is
in [docs/DESIGN.md](../docs/DESIGN.md); do not restate it here.

**`Ground` is the wrong home.** It holds what a cast left behind, which ages and
clears. A surface is part of the floor and never expires, so it belongs on the `Grid`
beside `variant` and `roomOf` — a second byte per tile.

**The conduction rule already exists** as `CONDUCTION_ARC` in `combat.ts`. An iron
plate is that arc with a different reach test, and should extend it rather than copy
it.

**Fog fights the light bake.** `bakeLight` is per-tile and static, and so is fog — the
cheap version is a field the fragment shader reads, not a volumetric anything.

### What shipped

`Grid.surface` is the second byte, beside `variant` and `roomOf`, exactly as the note
above says — and `Grid.portals` beside it, because a byte can say "portal" and cannot
say WHICH one. Which floor carries which surface is a table (`SURFACES_BY_DEPTH`), not
a roll, and they arrive one at a time: floor 1 is bare, floors 2-4 teach one each, and
The Hollow Crown carries three. The pairings argue with the SHAPE — fog on the gauntlet
is a chain of rooms you cannot see down, and the layout with no way round is the one
where that costs the most.

**Two seams did the work, and neither was new.** The conduction arc was already a
function; it now asks whether the body is standing on something conductive and, if it
is, uses THE PLATE as its reach instead of a radius — every body on the continuous run
of iron or standing water, and the player, who is standing on the floor like anyone
else. Iron and water are one rule with two textures, which is why they are one
function. And `Ground` got a single `refuses` hook rather than a filter at each of its
four call sites, so "shallow water will not take a flame" is true of a cast, of a
broken barrel and of anything added later, without `Ground` learning what a tile is.

**Gust sweeps rubble**, and that is the one surface the player can edit. It matters
more than it sounds: gust has only ever taken things away, and this is the first thing
it does that leaves the room better than it found it — a blocked doorway becomes a cast
you decide whether to spend.

**The renderer treats a surface as another texture a floor quad can go to**, so the
whole floor is still one mesh per texture and a floor carrying three surfaces costs
three more draw calls. Fog is the exception, because it is the only one that is not
really about the ground: it carries a per-corner vertex attribute for the bank's own
pallor and a camera-tile uniform for the blindness, eased per frame so the shoreline is
a threshold you walk through rather than a light switch.

**The minimap draws portals and nothing else.** The map answers one question — which
way do I go — and a portal is the only surface that is a ROUTE. The other four change
what a tile is worth once you are near it and can all be seen from the doorway; four
more colours up there would compete with the thing the map is for.

## Acceptance

- Each surface is identifiable at a glance, with no legend.
- Spark on iron plating reaches everything on the plate and nothing off it.
- Fire refuses to light on shallow water.
- Two portals visibly pair, and stepping on one arrives at the other.
- One floor can carry three surfaces without reading as noise.

### Checked, on generated floors and in the running game

**1000 floors, a hundred seeds of each depth, zero failures** on: no surface on an
unwalkable tile; none on the three sacred tiles (the start, the descent, and any room's
centre, which is where `populate` puts the altar and the boss without asking); every
floor carrying exactly what its table promises; every portal pair being two mouths that
find each other and are connected ON FOOT; and every plate being a connected run of at
least four tiles. The floor still generates connected, and `populate` still places
nothing in stone.

The rules, asserted directly rather than by eye:

- **Iron.** An eight-tile plate whose every tile is iron, with no iron tile adjacent to
  the run that the run does not contain — the plate and the reach are the same set.
- **Water.** Fire refuses on a wet tile and takes on the dry control tile in the same
  call; oil still pours onto water, so it is FIRE that is refused and not the tile that
  is inert.
- **Fog.** A clear corridor returns twenty tiles of sight. With a five-tile bank in it,
  a look from outside returns the clear floor and then exactly two fogged tiles; a look
  from inside returns exactly two. Both directions, one allowance.
- **Portals.** Each mouth finds its twin, a tile that is not a mouth finds nothing, and
  on the chasm floor the pair was seventy-five steps apart on foot.
- **Rubble.** One press, and the round ran twice — first with the player still counting
  as standing on the near side, then on arrival — and they ended up on the tile. The
  control step onto plain floor, same press, ran the round once. No soft-lock either
  side: `canAct` was true again afterwards.

**And looked at.** The foundry's plating reads as flat pale metal with rivets against
the warm broken stone around it, with the seam visible where it stops. Standing in a
doorway of The Choir of Wounds looking into a fog bank, the room beyond is a wall of
pale grey with the props in it reduced to silhouettes, and the boundary is exactly the
doorway; standing inside it, the world is gone at two tiles and the compass is the only
readout left worth having. A portal mouth is a lit purple ring on a darkened tile,
three tiles ahead, with the matching purple cell three rows up the minimap.

**Not checked:** whether a floor carrying three of these is a good floor to play. The
audit can prove they are placed, legible and correctly ruled; it cannot prove that iron
under a fight is interesting, and nothing has played one.
