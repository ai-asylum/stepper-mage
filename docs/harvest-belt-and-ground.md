# Harvesting, the belt, and standing in it

Core-game design. The [star tree proposal](star-tree-proposal.md) is about which
NODES should exist; this is about the mechanics some of those nodes unlock, which
are the game's own business whether or not the tree ever sells them.

Deliverable is a proposal. No code has been changed.

---

## 1. Harvesting gets an inventory

Harvesting is a one-shot today: adjacent, facing, one hand slot, and the fixture
never runs down. Giving it an inventory resolves three problems at once — the belt
has no reason to exist, the golems have no ingredient, and a harvest cannot be
planned.

### 1.1 Fixtures get depth

A harvestable object holds a **finite** number of draws, set by how valuable its
element is:

| Fixture | Draws | Reads as |
|---|---|---|
| Water barrel, cistern, fountain | ~100 | effectively bottomless |
| Oil drum | ~20 | a resource you plan around |
| Candelabra, torch, brazier | ~5 | a thing you can use up |

The numbers are the design language, not a balance table: depth *is* the rarity
signal, so the player learns what fire is worth by finding out that candles run
out and water does not. They are set against pouch weight in §1.4 — a candle's
five draws are exactly one small pouch of fire.

**This is a deliberate reversal of a rejected rule, and it is the coherent one.**
`docs/DESIGN.md` rejects depleting fixtures with: *"Fixtures are non-depleting
and non-storable; those two rules hold each other up."* That is exactly right —
and it means the moment harvest becomes **storable** the other rule has to give,
or a candelabra becomes an unlimited fire faucet with a pouch under it. Depth is
what buys storability. The pillar is not being broken; its other half is being
paid for.

Empty must read in the world, not in a widget: a snuffed candelabra, a dry
barrel with its lid off. A pip counter on a fixture is a readout, and this game
has no other readouts in the world.

### 1.2 The belt is the sides of the screen

Not a second bar. Three slots **vertically down the left edge**, hanging under
the player portrait, where nothing else lives. The book owns the bottom, the
depth banner owns the top, and a strip above or below the book was always going
to fight one of them.

That placement also carries a meaning the old strip did not: the portrait is
*you*, and the belt is what you are carrying — a column of things on your person,
beside the picture of your person.

**And it rolls up into the portrait when the book is away.** The belt unrolls
downward out of the portrait when the grimoire is open and rolls back up into it
when the grimoire is closed — one piece of furniture with the book, on the book's
own signal (`hud.bookClosed`), with the same easing so the two read as one motion.

That is not decoration, it is the left edge being contested. Walking and turning
are swipes in the world area, and the left edge is where a thumb naturally lands
for them; a column of touch targets living there permanently would eat movement
gestures during the part of the game that is nothing but movement. Collapsing
removes the hit rects and the clutter together, so while you are stepping the
screen is the dungeon.

The portrait becomes the belt's **handle**: tap it to unroll, tap it again to roll
up, so the belt is reachable without opening the book. And it must keep a **count
badge** while collapsed — a small numeral of what you are carrying — because a
container that hides how full it is turns "can I harvest this" into a guess.

One edge worth getting right: a **harvest that lands while the belt is rolled up
should unroll it for a beat and let it roll back**. The player has to see where the
thing went, or the harvest reads as having done nothing — which is the same defect
as a lever that moves a door nobody watched.

### 1.3 The UX, decided rather than left open

The messy part is fill order and movement, so here is a rule set. It borrows the
book's gestures rather than inventing any: the belt is the second container full
of castable things, and it should be worked the same way as the first.

**Harvest fills the hand while the hand has room; the belt takes the overflow.**
The hand is what you cast from, so the first draw goes where it can be used. Once
the hand is full, further draws stow. Nothing is ever refused for being full
while a belt slot is empty, which is the failure the current "your hand is full"
refusal would otherwise produce constantly.

**Drawing from the belt is a SWIPE OUT OF IT, on the belt's own axis.** Tearing a
page is a swipe up out of the book; drawing an ingredient is a swipe sideways out
of the belt. Same verb — *pull the thing out of the container it lives in* — and
the axis is whichever way the container faces: the book lies along the bottom, so
its pages come up; the belt runs down the left edge, so its pouches come out to
the right, toward the hand.

That consistency is worth more than saving the player a gesture. Two containers
that both hold castable components should not be emptied by two unrelated inputs,
and a swipe carries the same tension a tear does — the stack lifts under the
thumb, and a swipe that does not finish puts it back.

**And a tap does it too**, exactly as a tap now tears the open page. The swipe is
the gesture that teaches; the tap is the cheap repeat for the player who already
knows. Both land in the same place, so neither has to be discovered twice.

**Stowing is a SWIPE UP off the hand.** A page comes up out of the book into the
hand; a component carries on up, out of the hand and into the belt. Up is the
put-it-away direction all the way through: the same flick, one stage further
along. A tap on a held component does the same thing, for the same
teach-then-repeat reason.

**Nothing ever destroys a component implicitly.** A tap or a swipe on a held
ingredient means *stow it*, and if the belt cannot take it — no matching stack
with room, no empty slot — the gesture is **refused by name** (*"your belt is full
of oil"*) and the component stays in the hand. It is never silently dropped,
returned to nowhere, or overwritten to make space.

That rule is worth stating because the cheap implementation is the destructive
one: a full belt is easiest to handle by throwing the incoming thing away, and the
player finds out by losing the starlight they walked three rooms for. Losing a
component is a real cost in a game where the room is the pouch, so it has to be a
thing the player *did*, not a thing that happened to them. The only route to
destruction is pouring (§1.5) — explicit, aimed at a tile, and it costs a turn.

**Belt swipes belong to the belt.** The world reads a swipe as walking or turning,
so the belt needs the zone claim the book already has (`overBook` in `main.ts`): a
gesture that starts on a slot is the belt's, whatever it does next. Without that,
every draw is also a step.

**Belt contents survive a cast; hand contents are spent.** That is the line
between the two containers and it is the whole reason the belt is worth having.

### 1.4 Pouches: how many, and how deep

The belt is a column of **pouches bought one at a time, five at most**, and a
pouch's **size** is a separate upgrade — so a player can start with one small pouch
and end with five deep ones.

Two axes, because they answer different questions. **How many pouches** is *how many different
things can I carry* — breadth, and it is what lets a player hold oil and water at
once instead of choosing. **How deep** is *how much of one thing* — depth, and it
is what turns a pouch from a convenience into a supply. A player who wants to set
up oil traps buys depth; a player who wants an answer to everything buys breadth.
Neither is strictly better, which is the test a two-axis upgrade has to pass.

**One pouch holds one substance.** Mixing would make a pouch a bag, and a bag
needs a list to read; a pouch reads at a glance because it is a picture of a
substance with a number on it.

#### Capacity is units, and substances have weight

A pouch tier is an allowance in **units**, and each substance costs a number of
units per draw. That is one table instead of two, and the interesting caps fall
out of it rather than being special-cased:

| Pouch tier | Units |
|---|---|
| Small (the first pouch) | 5 |
| Sturdy | 10 |
| Deep | 20 |

| Substance | Weight | Small | Sturdy | Deep |
|---|---|---|---|---|
| Water | 1 | 5 | 10 | 20 |
| Stone | 1 | 5 | 10 | 20 |
| Oil | 2 | 2 | 5 | 10 |
| Fire | 4 | 1 | 2 | 5 |
| Starlight | 5 | 1 | 2 | 4 |
| Golem clay | 10 | — | 1 | 2 |

Weight is the value dial, and it does the work the old per-substance stack table
did with none of the exceptions. Water is heavy in nothing and deep in everything;
an open flame takes four units because you are carrying an open flame; and the
golem clay's cap of **two, ever** is not a rule anybody has to remember — it is
what weight 10 means in a 20-unit pouch. It also means a fresh player *cannot*


These numbers should agree with fixture depth (§1.1): a candle with five draws in
it fills exactly one small pouch's worth of fire, and a bottomless barrel fills any
pouch you own. The two tables are the same statement about value, said twice.

### 1.5 Golden pouches

A pouch can be **gilded**, and a gilded pouch keeps what is in it into your next
descent — that descent only.

The game already has this word and this rule: a golden page is one you begin the
next run holding, for one run, and it is won at an altar rather than bought. A
golden pouch should be the same object one layer out — gold means *carried
forward, once* — so nothing new has to be taught. The player who has seen a gilded
page knows what a gilded pouch does on sight.

It also fixes something the belt would otherwise introduce. Leftover inventory at
the end of a run currently evaporates: you finish holding eight water and it
counts for nothing, which makes the last floor a place where hoarding is punished
and dumping is correct. A gilded pouch turns that into a decision — spend it now,
or gild it and open the next run with a supply.

**Rules that keep it from being power creep:**

- **Won at an altar, never bought from the tree.** The same path the golden page
  takes. The tree sells access; which pouch is worth carrying forward is a
  judgement about *this* run and belongs in it.
- **One gilded pouch at a time.** Two is the beginning of an inter-run warehouse,
  and the fantasy is a satchel you kept, not a stockroom.
- **One descent only**, exactly as the page. It does not re-gild itself.
- **The contents are frozen at what you had**, not topped up. A gilded deep pouch
  with two oil in it opens the next run with two oil, not ten.

The interesting edge is golem clay: gilding it is the only way to begin a run able
to animate something on floor one, which is a genuinely different opening
and costs a whole altar choice to set up. That is a good trade, and it is worth
watching in play rather than pre-nerfing.

### 1.6 Inventory management

Every gesture, in one place:

| To | Do | Costs |
|---|---|---|
| Put a component **in** the belt | swipe up off the hand, or tap it | free |
| Take one **out** | swipe right out of the pouch, or tap it | free |
| **Move or merge** a stack | long-press the pouch to lift, tap the target pouch | free |
| **Delete** a stack | long-press the pouch to lift, tap the floor — it pours out | one turn |

Deleting is pouring, and pouring **empties the whole stack** onto the tile you are
standing on. To keep part of it, draw the units you want into the hand first and
pour the rest — there is no partial pour and no slider.

**Harvest auto-stacks.** A draw joins an existing stack of the same substance
with room; failing that it takes the first empty slot; failing that it is refused
by name — *"your belt is full of oil"* — because a refusal that does not say what
is in the way is a refusal the player cannot act on. The same rule and the same
refusal apply to stowing from the hand (§1.3): a full belt refuses, it never
makes room by itself.

**Draw is a swipe out, or a tap.** Either way one unit goes to the hand — see
§1.3 for why it is both. This is the action players perform hundreds of times a
run and it must never cost two inputs. It is also the only splitting the belt
needs: drawing one at a time *is* the split, so no slider and no
long-press-to-split.

**Move is long-press, then tap.** Hold a slot to lift its stack — the column
dims to show the drop targets — then tap another slot to place it. Same substance
merges up to the cap and leaves the remainder behind; different substance swaps
the two. Tap the lifted slot again to set it down unchanged.

Long-press-then-tap rather than a drag *between slots specifically*: the slots are
a few dozen pixels apart on the short axis of a phone, so a dragged stack lands in
the wrong pouch on a thumb's wobble. Pulling a stack OUT of the belt is a swipe
because it only has to leave the column; putting one INTO a particular slot has to
be precise, and precision is what a tap gives and a drag does not.

**Pouring is the only way anything is ever destroyed**, and it is the answer to a
full belt: refusal names the substance, you pour something out, you have room.
Water makes a puddle, oil a slick, fire lights the tile under your own feet.

Discard is normally a delete — a bin icon, a confirm, and a small feeling of waste.
Pouring makes room *and* makes terrain, so emptying a pouch is a play: five oil in
a doorway and back away is a setup, and pouring fire on your own tile is a mistake
the game already knows how to punish. It reuses the ground system rather than
adding one, needs no art a poured substance does not already have, and makes the
answer to "my belt is full" a decision instead of an apology.

Clay is the exception to the verb rather than to the rule: it is tipped out, not
poured, and it leaves nothing but a smear on the tile. Every other substance you
empty becomes terrain; the clay just goes. That is the game saying out loud what
weight 10 already implied — this was the expensive thing to be carrying.

**What each verb costs:** drawing is free, moving is free, pouring **costs a
turn**. Free terrain creation would be the strongest thing in the game, and
pouring a slick is exactly the kind of act a room should get an answer to. Nothing
that changes the floor is ever free — same rule as a cast.

### 1.7 What this buys the design

- The belt gets a **reason to exist and a place to be taught**: you unlock it,
  you harvest into it, and the perk itself is the tutorial. That is the
  gradual-tutorial pattern from the research, applied to the one feature that has
  been shelved for lack of an on-ramp.
- **The golems come back** (§3), limited by how much clay a belt can carry.
- Harvesting stops being a one-shot and becomes a thing you *plan*, without ever
  becoming a faucet.

---

## 2. Standing in it arms you

A new verb, and the cheapest one in the design: **while you are standing on a
tile that holds a substance, it fills one hand slot per turn with its element, and
the tile burns down faster for it.**

The card it gives you is **locked** — it cannot be stowed to the belt, and it
cannot be put back. The only way to be rid of it is to cast it or to step off the
tile.

### 2.1 Why this is the right addition

It makes **position a component source**, which is the pillar the whole game is
built on stated one step further. Today the room is a pouch you reach into
(adjacent, facing, one slot). This says the floor you are standing on is *already*
in your hand, and it costs you the thing standing in a substance costs: burning
ground hurts, ice is slick, oil is waiting for a spark. The player who fights from
inside a puddle is paid for it in water and charged for it in every other way.

It also pays for itself. A patch that arms you depletes faster, so the strong
position is temporary by construction — you cannot camp a bonfire and farm it,
which is the failure mode `docs/DESIGN.md` was protecting against when it made
fixtures non-storable.

And it gives the ground reactions a reason to be set up rather than found. Pouring
oil at your feet (§2.5) now does two things: it makes the slick, and it starts
feeding you oil. That is a plan.

### 2.2 The problem to decide: a hand of one

At hand size 1 a locked card is the whole hand. Standing in water fills your only
slot with water, and until you cast it or step out you cannot tear a page at all —
the book is unreachable while your feet are wet.

Two readings, and they are genuinely different games:

**A — it fills only a FREE slot, and at hand 1 that means it takes your only one.**
Terrain becomes sticky: to choose a spell you step out of the puddle first. The
rule is one sentence, it is always true, and it teaches position hard. The risk is
that a new player, whose hand *is* one for the first three floors, meets it as
"the game took my book away" rather than as a trade.

**B — it never takes the last free slot.** At hand 1 the feature is simply off,
and it switches on with **Second Hand** from the tree. The feature then arrives as
a reward, at the moment the player has slots to spare, which is the
gradual-tutorial shape the research argues for (the tree proposal, §1) and the same job the belt is
doing. The cost is a conditional rule — "one per turn, unless it would fill your
last slot" — which is harder to state on a card.

**Recommendation: B.** The first three floors of a new save are the run where the
player is learning that a hand of one cannot fuse; a mechanic that silently
occupies that hand during exactly that stretch teaches the wrong lesson at the
worst time. B also gives Second Hand a second, visible payoff, which that node
needs anyway now that the altars widen the hand on their own.

### 2.3 Numbers and edges

- **One per turn**, at the end of the player's turn, while the tile still holds
  the substance.
- **Depletion:** the tile loses an extra turn of life per card it hands over —
  double rate, so a patch that would have lasted six rounds lasts three if you
  stand in it the whole time. That number is the dial to tune; the shape is that
  standing in it is what spends it.
- **The locked card is spent by casting like any other**, and it fuses like any
  other. That is the point: a locked water plus a torn Flame is a Steam Burst you
  paid for with your position instead of a page.
- **It does not stack past the hand.** Full hand, nothing happens, no refusal
  message — this is ambient, and a refusal every round for standing still would be
  unbearable.
- **Which substances:** all of them, via `SUBSTANCE_ELEMENT`. Ice gives frost,
  bramble and briar give plant, and the two liquids give themselves.
- **It is not a harvest** and must not be priced as one: no adjacency, no facing,
  no cost, but you have to be *in* it. **Long Reach** (tree proposal, chain B) stays about
  reaching fixtures from further away; this is about standing in the consequences.

Implementation sits where the round already ticks — `Combat.tickClock` runs the
hazards and re-reads the plates each round, and `Ground.age` is what already ages
a patch, so both halves have a home. The locked flag belongs on the hand card, not
on the ground: the ground does not care who is standing on it.

---

## 3. The golems, brought back into reach

The golem chain was shelved because Animate needs an ingredient and infinite
Animate was rejected. The belt-with-depth answers both: put the animation
ingredient **in the world as a harvestable**, and depth is the limiter that
`docs/DESIGN.md` was asking for.

**Golem clay** is the ingredient, and the name is the design: clay is a material
you press into a shape, so animating a thing is *packing clay into it* rather than
pouring a potion over it. It comes off earthen decorations — unfired pots, clay
urns, the wet heap beside a kiln, a cracked statue — which is a prop class that can
sit on floor one without explanation and gives the art a reason to put pottery in a
dungeon.

- Harvested like any other fixture element, so animation is reachable on **floor
  one, by a fresh player**, with no tree node required.
- **The carry cap is one or two**, and it is not a cooldown or a cost — it is
  weight (§1.4), which is the same rule the hand already teaches.
- The old `golemKeep*` / `golemInfusion` nodes then become what they were always
  meant to be: not *can you animate*, but *does it survive the floor*.

Sequencing: this lands after chain B ships, because it depends on harvest depth
and on the belt existing. It should re-enter the tree in the same pass that flips
`BELT_ENABLED`.

---

## 4. The map, and the waypoint

Tap the minimap and it opens **full screen**: the floor as you have explored it,
pannable, with the room you are standing in marked. Tap any tile you have seen and
it becomes a **waypoint** — the compass points at it until you get there.

### 4.1 What it is allowed to show

**Only what you have explored.** The map is memory, not vision. `Floor.cull`
already accumulates `grid.explored` per step and keeps `visited` separately, so the
data exists and has the right shape: explored tiles draw as geometry, unvisited
ones stay black, and the difference between "I have seen this room" and "I have
stood in it" is already recorded if it is ever worth drawing differently.

It must never reveal an unexplored room, a hidden cage, or the stairs before they
open. A map that shows you the floor is a different game — this one shows you the
floor *you walked*, which is a memory aid rather than an answer key.

### 4.2 Panning, and why a drag is fine here

Drag to pan. That is not a contradiction of the belt's no-drag rule (§1.3): a drag
is bad when it has to *land* somewhere precise, and panning has no target at all —
you push the picture and it moves. Placing the waypoint is the precise act, and
that is a tap.

No pinch-zoom. The floors are 22–34 tiles square and a fullscreen portrait view at
a fixed scale fits most of one; a second scale to manage is a second thing to get
wrong. If a late floor genuinely does not fit, the answer is a fit-to-screen toggle
— one tap, two states — not continuous zoom.

### 4.3 The waypoint is what the compass was for

This resolves the override question below. A **player-set waypoint outranks
everything**, because it is the one target the game knows the player chose
deliberately. It clears when reached, and setting a new one replaces it — there is
never a list of waypoints, and never two arrows.

That also gives the compass a job it can keep once quests land: quests set a
waypoint like anything else, and the player can always override it by setting their
own. "Override or second compass" stops being a question, because everything is
feeding one arrow through one priority.

### 4.4 Why this is safe to sell on the tree

The **minimap stays free, forever**. What the node buys is the fullscreen view and
the waypoint — a convenience for a player who has already been given the
information. Gating basic legibility behind a purchase would break the invariant
that the game is playable with zero nodes owned; gating a *reading room* for a map
you already have does not.

---

## 5. Open question: the compass

The compass was specified for **quests**, and quests were never built, so it
currently points at one thing and is otherwise idle. There is an obvious use for
it — the cage, the nearest unclaimed altar, the boss door — and one question that
§4 now answers: **override or second arrow?**

**Recommendation: one compass, one arrow, a priority stack — never two.** Two
arrows on a phone screen in a first-person view is two things to interpret at the
moment the player is trying to walk. A single arrow that always means "the thing
you most likely want next" stays readable:

1. A **player-set waypoint** (§4). Always wins — it is the only target the player
   chose on purpose.
2. A quest target, when quests exist.
3. The cage, if this floor holds one and it is still shut (needs **A Louder Cry**).
4. The boss door, once the levers are found and it is open.
5. The nearest unclaimed altar.
6. The stairs, once open.

The arrow should **say what it is pointing at** — a one-word label under it —
because a priority stack the player cannot see is indistinguishable from an arrow
that changes its mind. That label is also what makes the override honest when
quests land: the word changes, so the player knows why the arrow moved.

Star-tree pointing is a different thing and does not belong on the dungeon
compass: the tree is a screen, not a place. If the goal is "remind me what I am
saving for", that is the **pinned route** from
[star-tree-research.md](star-tree-research.md) §0, which already persists into
the run.

---

