# Stepper Mage — Design

The settled design. Anything here has been decided; anything not here is open.

## The fantasy

No weapons, no armour. You have a grimoire, a belt of ingredients, and whatever
the room happens to contain. You leaf the book with your thumb, **tear pages out**,
and fuse what you're holding into one cast.

## Three sources, three questions

Non-overlap is enforced by construction, not by inspection. Each source answers a
different question, and no source may answer another's.

| Source | Job | Economy |
|---|---|---|
| **Page** | supplies an **element** — a damage type and its status | infinite, ranks 1-3 |
| **Fixture** | supplies an **element the room owns** | free, adjacent and facing, unlimited, not storable |
| **Ingredient** | **shapes a cast**, never supplies an element | consumed, generous drops |

A page has exactly one job and an ingredient has exactly one job, so they cannot
collide. This is why all shaping (Animate, Growth, Multishot) lives on the belt and
not in the book — while shapers were pages, every candidate ingredient kept
duplicating one.

**The invariant: every cast must contain at least one element.** No ingredient is
ever a complete spell on its own.

## Hand size

**Starts at 1.** Because animation needs an element beside it, and every ingredient
needs an element beside it, hand size gates the whole game:

| Hand | What you have |
|---|---|
| **1** | five elements, fixture harvesting, object reactions. No golems, no shaping, no ingredients. |
| **2** | pair fusions **and** golems **and** every ingredient |
| **3** | triples, or element + two ingredients |

**Starting at 1 is the reason the game needs no fusion tutorial.** The shop teaches
the mechanic by selling it: the player buys hand size 2, tries holding two pages, and
works out combining for themselves. Nothing has to explain it, nothing has to prompt
it, and the discovery belongs to the player rather than to a tooltip. A game that
opens at hand size 2 has to teach fusion; a game that opens at 1 sells it.

Since **a cast costs one turn whatever it holds** (see **Turn economy**), each slot is
also a straight multiplier on what a turn is worth. That makes hand size the most
powerful thing on the star tree by a distance, and it is worth noticing that it is the
one node whose payout is partly a number — the tree's own rule is *change behaviour,
not a number*, and hand size now does both. It is not a violation to fix by nerfing:
the number it changes is how much of the game you can express at once, which is the
behaviour.

## Turn economy

**A cast costs one turn. Moving costs one turn. Nothing else costs anything.**

- Releasing the cast: 1 turn.
- Stepping to a new tile: 1 turn.
- Tearing a page, harvesting from a fixture, taking an ingredient off the belt: free.
- Putting any of them back: free.
- Turning in place: free.

**A hostile gets a move AND an attack in the same round.** The player gets one action;
a creature gets both, so its threat range is two tiles rather than one and backing away
no longer costs it a turn to re-close. Golems get the same budget, because a golem is
the mirror of the thing it fights and a rule that applied to one side and not the other
is the kind of inconsistency a player cannot learn.

This is a tempo rule, not a difficulty rule. It was priced back out on the player's
side — the bar went 40 to 46 and per-hit damage came down a fifth — so a fight costs
about what it did before while reading very differently. The measurement is in
`src/game/tuning.ts` under `PLAYER_MAX_HP`, including the two levers that turned out
not to be levers.

The earlier rule was the exact opposite — every component cost a turn and the cast
was free — and it had a trap in it. Taking a component charged a turn and *returning*
one charged nothing, so leafing through the book and changing your mind handed the
room free rounds and could kill you for it. Punishing a change of mind is the worst
thing a turn economy can do, and no amount of tuning fixes a rule that does it.

Consequences, which are the rule and not decoration:

- **The unit of the game is the cast.** One action, one round: the room answers what
  you just did, once, and it answers *after* the spell lands — so a body killed by a
  cast never gets to reply to it. Everything in `src/game/tuning.ts` is sized against
  that ordering.
- **Fusion is priced in hand size, not in turns.** Three elements cost exactly what
  one costs, so a fusion is no longer an investment of rounds — it is capability, and
  the price is the slots, which are bought with stars. A three-slot Thunderhead is 24
  on one body, 48 across two and 72 across three against a Fireball turn's ~19 on
  one; better against a group, still worse against a lone target, and now strictly
  better per turn than casting the three separately.
- **Hand size 1 is the baseline the content is sized to** — not a tempo-neutral
  alternative to a bigger hand, which is what it was under the old rule. A hand of
  one is the weakest configuration in the game and it is meant to be: it is the floor
  of the star tree's ladder, the acceptance criterion (once `tools/fullrun.mjs --hand1`,
  deleted 2026-08-09 and judged by playing since)
  is that it can complete a full run, and every slot above it is a multiplier the
  player paid for. Measured, a hand of two takes a depth-5 room from 14.6 HP to 2.9.
- **Indecision is free.** Draw a page, put it back, draw another, walk away holding
  nothing — none of it moves the room. The only thing that costs you is committing.
- **Position is the other half of the economy.** Movement is the only other thing
  that spends a turn, so where you stand and what you can reach is priced against
  what you can cast. See **Reaching**.

Forgiving defaults, deliberately: **returning a component is free**, and **being
hit mid-assembly never drops your hand**.

What this rule gave up, and it is worth naming: assembling out of combat used to be
free power, because the cast that released a pre-loaded triple cost nothing. It costs
one turn now like every other cast, so walking into a room loaded saves you nothing
and *preparation is no longer the reward*. What replaced it is that assembling inside
combat costs nothing either — the tempo of a fight no longer depends on when you
decided.

## Grimoire — 5 pages, elements only

| Page | Owns |
|---|---|
| Fireball | burning |
| Frostbolt | frozen |
| Spark | shocked |
| Gust | stagger + shove |
| Decay | decay |

**Ranks 1–3**, on element pages only. A rank counts the page as that many copies when resolving, so it
reuses the existing `Greater`/`Mighty` empowerment ladder rather than adding a
second damage multiplier. Rank 1→2 is a free altar upgrade. **Rank 2→3 costs a
rank-2 page**, sacrificed.

**Sealed by default.** Pages found in a run are gone when the run ends. A golden
page is the one exception, and only for the single run that follows it.

## Room fixtures — harvest

**Adjacent, and facing it** — non-depleting (the candelabra stays lit), costs a hand
slot and nothing else, and **always rank 1 with no rank scaling** — so owning the page
is strictly better and the fixture is a substitute plus an enabler. What a harvest
costs is the walk: getting adjacent and facing it is turns of movement, and that is the
whole of its price.

Reaching a fixture is a move, not a glance. Line of sight was the earlier rule and
it made the whole room a shelf you could take from without leaving the doorway; it
is the standing-next-to-it that costs you position, and position is what a stepper
trades in. The same rule governs every interaction with an object — see
**Reaching** below.

Four elements that have **no page**, so a fixture is never a redundant copy:

| Element | Sources | Does what no page does |
|---|---|---|
| Stone | statue, gears, anvil, rubble, hoist | heavy; shatters frozen. Enables Meteor (fire), Glacier (frost), Lodestone (spark), Earthquake (gust) |
| Water | water barrel, cauldron, font | applies **soaked** directly — otherwise only via Steam Burst |
| Oil | oil drum, ale barrel | doesn't burn alone; doubles fire damage |
| Starlight | orrery, crystal, star font | pierces frozen shells and resistances |

Fire is the one honest exception (a candelabra obviously gives fire); the rank-1
rule is what keeps it from replacing Fireball.

**No Stone page exists.** Meteor is harvested Stone + your Fireball page.

Animate-only props (no element): bookshelf, lectern, telescope, meat rack, bone
pile, fungus. Some props are components, some are bodies.

### Three uses per object, mutually exclusive

1. **Harvest** its element — adjacent and facing, non-depleting, costs a slot and the
   walk to reach it.
2. **Animate** it — costs an animation ingredient plus an element; it walks off as a
   golem, so it stops being a tap.
3. **React** — hit it with the right element and it goes off. The object is the
   intended target and the payoff is **spatial**: everything near it takes the hit.

| Object + element | Reaction |
|---|---|
| Oil drum + fire | explodes — heavy damage to everything adjacent |
| Water barrel + spark | conduction burst — shocks everything adjacent |
| Water barrel + frost | freezes the tile; anything on it is frozen |
| Brazier / candelabra + gust | flame washes the tile in front |
| Statue / rubble + gust | topples onto whatever is beside it |
| Cauldron + fire | boils over — burning on adjacent tiles |
| Bone pile + gust | shrapnel in a small cone |

This is **not** "the object is a fusion ingredient" — that was rejected because the
element and the target would be the same slot. Here the object is the target on
purpose and the enemies around it pay.

## Belt — ingredients

> **Currently disabled behind a feature flag** (`BELT_ENABLED` in `src/flags.ts`),
> pending a rethink of the strip's UX and UI. The design below is unchanged and still
> the design — it is switched off, not withdrawn — and flipping that one boolean
> restores every behaviour described here. While it is off the strip does not draw, no
> source pays an ingredient, and the belt's tree chain (including corpse rites and the
> golem nodes) cannot be bought. Object animation is a belt ingredient, so golems are
> unreachable in that state; see `Roadmap/Ingredient_Belt.md`.

Renders always, in three visual states so the unlock advertises itself:

- **Locked** — bare strap, no loops, unlit.
- **Owned, empty** — loops with open flaps, brass catching light.
- **Filled** — vials and bundles with count badges.

Locked pickup shows *"you have nowhere to keep it"* while the strap pulses. Drops
are **generous** — an ingredient costs a hand slot and is consumed, so scarcity
means they are hoarded and never used.

| Ingredient | Shapes the cast by |
|---|---|
| **[object animation — name TBD]** | the targeted object rises as a golem |
| **Coffin Moss** | a corpse rises as a golem |
| **Growth** | bigger, harder |
| **Multishot** | three targets |
| **TimeSand** | *nothing — see below* |

**TimeSand is inert and needs a new job or deleting.** Its whole function was the turn
cost of components — free to take, and the next two components free too — and under
*cast = 1 turn* components are free already, so there is nothing left for it to
discount. Holding one is a wasted hand slot. It is still in `spells.ts` (marked inert,
so its definition does not advertise a job it no longer has) and it is unreachable
while the belt is flagged off, so nothing is broken; what to do with the fifth
ingredient slot is an open decision and is deliberately not answered here.

Coffin Moss is the **consumable form** of the corpse-raising tree node, the same
relationship the belt itself has: the node unlocks the capability, the ingredient is
the per-use limiter.

Object animation and corpse animation are deliberately **separate ingredients**.
Object animation works on turn one because every room has props; corpse moss needs a
kill first. One opens a fight, the other snowballs it, and which you hold changes how
you want to open a room.

## Altar — a 3-choice reward node

**An altar is where spells come from, and the roll is built to keep saying so.**
Usually all three cards are pages; one non-page card is the common exception and two
is rare. Otherwise any of: heal · ingredient bundle · rank-up · **sacrifice a rank-2
page to reach rank 3** · **golden page**.

**A page you do not own beats every rank-up.** Not a weight, an order: new pages fill
the page slots first and rank-ups take what is left. With five page elements and a
three-page loadout that is roughly two floors of genuinely new spells before the
altar starts offering ranks — which is the point at which a rank IS the prize, rather
than the thing the altar reaches for because it is easy.

**Stars are a backstop, never an option.** The dedicated star payout is reached only
when the page queue and the extras are both exhausted — nothing left to teach, a full
bar, nowhere to put a bundle. A card that hands you meta-currency should mean the
altar had nothing, not that it would rather pay you than teach you.

A rolled page already at max rank still pays **2 stars** instead, and sinks below
every page that has something left to give.

**No reroll charges.** Removed outright. A charge is a card that pays out in *maybe*
— you give up a certain prize now for the right to ask a later altar for a better
one, which is the worst trade on the table the moment the other two cards are spells.

**Golden page** → **granted at the start of your next run, and that run only.** It
is a gift forwarded one run, not an addition to the starting book: you begin the
next descent already holding it, and the run after that you do not.

Nothing in the game is permanent. A golden page is the one thing that survives a
run boundary, and it survives exactly one — which keeps the reset that makes an
altar choice matter, while giving a good run something to hand its successor.

## Golems persist through the stairs

A tree purchase: when you descend, **your nearest surviving golem comes with you.**

Golems stop being disposable and become something you route around and protect,
which gives the "animate it or harvest it" trade a stake beyond the current room.

Tiers: **one golem** → *it keeps its rank and elemental infusion* → **two golems**.

## Star tree

**A skill tree with prerequisites, refundable.** Prerequisites express real
dependencies (belt needs hand size 2) instead of relying on purchase order, and
refunds let you experiment without regret.

Everything on it must **change behaviour, not a number** — no +damage, no +HP.

- Hand size 2 → **hand size 3**
- **Belt (3 slots)** → belt (6 slots) *(requires hand size 2)*
- **Keep a golem on descent** → it keeps rank and infusion → keep two
- Corpse raising
- Altar pool pages
- Run-start blessing, and more blessing options
- Loadout slots

## Deed gates

**Boss kills only.** Killing floor N's boss unlocks starting at floor N+1, offered
every 5th floor (1 / 6 / 11 …); the player picks from what they've unlocked.
Skipping 5 floors grants **3** catch-up altar draws — fewer than you skipped, so
the deep start is deliberately the weaker path, and it earns fewer stars per run.

Nothing else is deed-gated. Money buys options, deeds buy permission to start deeper.

## Free, never sold

The **grimoire / bestiary** — which prop animates into which golem, which pairs are
authored. Selling a record of something the player already discovered is a paywall
on their own memory.

## Reaching

**Every interaction with an object requires standing next to it and facing it.**
One rule, no exceptions: harvest a fixture, claim an altar, open a chest, take the
stairs down. Spells are the only thing that reach across a room.

The distinction is what separates the two halves of the game. A spell is aimed —
anything you can see, you can hit. An interaction is *reached*, and reaching costs
you the turns to walk there and the facing to commit to it, in a game where turns
are the only currency and facing is most of your information. Interactions that
worked at range let the player strip a floor from its doorway.

Facing matters as much as distance: an altar behind you is not an altar you are at.
The prompt has to describe something the player can see, or it reads as the game
firing at random.

## The room has a clock, and it counts in turns

Every problem used to be "what do I cast at that", because nothing in a room changed on
its own. A hazard on a beat adds the other half of the question — **when** — and it
costs nothing to express, because this game is already a clock: a cast is a turn and a
step is a turn, and the player counts them whether they mean to or not.

- **Turns, never seconds.** A blade that swings every third turn is readable without a
  tooltip and plannable without a UI. One tick, one round, one meaning — a hazard on
  its own timer would drift out of phase the moment anything else took a turn, and it
  would drift out of phase precisely for a player who had learnt it.
- **A wind-up before every strike.** The beat before it goes live, a hazard shows the
  same silhouette at a third of the size. That is what makes it fair rather than
  random, and it is also what makes BAITING possible: something shoved onto the tile on
  the wind-up is still there for the swing.
- **A hazard never asks who stood on it.** It hits creatures exactly as it hits you,
  which turns the room's furniture into a weapon and gives the player another answer to
  a monster that is not damage.
- **A hazard cannot be jammed.** It is a metronome, not a puzzle piece. Something you
  can switch off needs a verb to switch it off with, and then it stops being terrain
  you plan around and becomes a chore you complete.
- **A timed door makes turns the currency, out loud.** Five turns is five actions, and
  walking spends them at exactly the rate casting does. The countdown is drawn on the
  gate, because a number the player has to remember is a number they will misremember
  while being chased.

## Height is the second spatial question

Everything used to be at one level, so a fight was a plan view and the player had
exactly one thing to work out: how far away is it. Elevation adds the second, and it
does it without adding a verb — **the weakest spell in the book becomes the strongest
in the right room.** Gust does five damage and shoves one tile; a shove near a two-level
edge does sixteen, and near a four-level edge it ends the fight. That is a direct answer
to every creature being a pile of hit points, and it costs nothing to learn because you
can see the ledge.

Three rules hold it together:

- **Down is free, up is not.** You can step off any edge; you get back up only at a
  ladder. One-way movement with no new verb and no locked door — and because the way
  back is a PLACE you can see from the top, going down is a decision made with the
  information rather than before it.
- **Falling is damage, and it cuts both ways.** Superlinear in the drop, so height is
  worth more than two levels are; identical for the player and for everything else.
  Nothing in the rule asks who fell.
- **Nothing walks off a ledge of its own accord.** Bodies refuse a drop as well as a
  climb, so a fall is always either a shove or a choice. The consequence is the useful
  one: dropping puts you somewhere the room has to go round to reach.

And one thing that does NOT move: **the camera framing.** The eye rides the ground and
nothing else about the lens knows this exists — no pitch, no look-up gesture, no
widening. If something cannot be seen at the fixed framing it should not be up there.

## A layout is not a look

**Every floor is a different shape, and the shape is the argument.** A ring means you
can always go round; a gauntlet means you cannot. A cathedral means everything sees you
the moment you step in; a labyrinth means nothing does until it is adjacent. Ten floors
of one algorithm in ten palettes is one floor ten times, and the player learns it once.

The test a layout has to pass is that **it changes how you MOVE.** If the only
difference is what the walls look like, it is a theme. That test is also what decides
where a floor sits in the run: each one should take away something the floors before it
taught you to rely on — the straight sightline, the way round, the dead end, distance
itself — and it should take it away in a way you can SEE, because a rule you have to be
told is a theme wearing a mechanic's coat.

Two consequences worth writing down, because both were invisible while there was only
one generator:

- **Rooms are the unit the game counts in.** Bodies, props, torches and the minimap's
  sense of "a place" all come off `grid.rooms`, so a shape that declares twenty rooms
  has quietly tripled the floor's difficulty. Room count is a difficulty knob.
- **Far means walked, not measured.** The boss goes at the far end of the floor, and on
  a spiral or a nest the far end is the nearest thing on the map. Anything that reasons
  about distance in this game reasons about path distance.

## The floor is an argument too

A layout decides how you MOVE. A surface decides **what a tile does to a spell** — and
between them they are the only two things that can change what the player should cast
without changing the creatures. Before surfaces, every tile was inert: it held you up
or it did not, so the only question a room asked was "what is weak to what", and once
the affinity table was learnt the room was answered.

**Every surface has to be legible in the tile itself.** That is the entry requirement
and it is what got things cut: a rule the player has to be TOLD is a theme, and a rule
they can see in the floor is a mechanic. Regular beats irregular for this — a plate is
the only thing on a dungeon floor with straight edges and repeating rivets, rubble is
the only thing that casts a shadow, water is the only thing that reflects.

Two design rules fell out of building them:

- **A surface that changes a spell's reach must be visible BEFORE the cast.** Iron
  plating is the whole argument: the arc goes everywhere the metal goes, including into
  you, and the plate is drawn as a shape so the circuit can be read from the doorway.
  Stepping off it is a decision you get to make in advance. A surface whose rule you
  discover by triggering it is a trap, and traps are a different, worse game.
- **What a tile costs should be charged in turns, never in inputs.** Rubble takes two
  of the room's answers to cross and exactly one swipe. A press that visibly does
  nothing is indistinguishable from an input the touchscreen ate, and what the player
  learns from it is to distrust the control rather than to respect the terrain.

## Obstacles have two axes, not one

**A wall stops sight and footing. A gap stops only footing.** Until the grid could
say `Gap`, those were one sentence, because a wall was the only obstacle in the game
— which meant every piece of terrain was a thing you could neither cross nor see
past, and the only lever a layout had was where to put the walls.

Splitting them is what makes terrain argue with the player. A chasm across a room is
a room you can read at a glance and have to walk the long way round: the creature on
the far side is fully aimable and completely out of reach, and the ten seconds you
spend going around are ten seconds it spends casting. It also gives fire a boundary
that needs no rule about fire — a volume goes where a body could walk, and a gap is
not somewhere a body can walk, so a burn stops at the lip and pools along it.

This is the same split as **Reaching**, one level down. A spell is aimed and an
interaction is reached; a gap is the piece of floor that says yes to the first and no
to the second. The rule is legible because you can *see* the hole — a floor that
invalidates something you thought was always true has to do it in the tile, not in a
line of text.

## Guidance

A **compass**, pointing at the next thing that matters: unclaimed altar → boss
while alive → stairs once it's dead. One arrow, not a revealed map.

## Rejected — do not re-add

Kept here because each of these was considered and cut for a reason that is not
obvious from the current design, and all of them are the kind of thing that gets
proposed again.

**Altar choice width (3 → 4 options).** Of every unlock considered, it was the only
one that made the *terminal* state of the economy arrive faster — with eight pages,
widening the roll accelerates toward "every offer is stars." Any unlock that speeds
up your economy's end state is a currency generator wearing a costume.

**The object as a fusion ingredient by targeting it.** Aiming a spell at a
candelabra to borrow its fire makes the candelabra the *target* — you get a burning
candelabra and the enemy is untouched. Element and target are the same slot, so they
cannot both be that slot. Harvest exists because of this.

**Depleting fixtures on harvest.** Combined with storability it lets you farm a
candelabra into a pouch for unlimited fire. Fixtures are non-depleting *and*
non-storable; those two rules hold each other up.

**The pouch as part of the grimoire.** A page you tear grows back and a vial does
not. Housing them in one object teaches the wrong economy before the player has read
a word.

**Selling the bestiary.** A paywall on knowledge the player already earned.

**These ingredients**, all cut for duplicating something a page or fixture already
owns:

| Cut | Duplicated |
|---|---|
| Emberbloom (ignites) | Fireball's burning |
| Widow's Cap (rots) | Decay |
| Mirrorleaf (+1 target) | Multishot |
| Dreamspore (skip turn) | frozen / shocked |
| Nightbell (stagger) | Gust |
| Ironvine (ignore frozen) | the Starlight fixture |
| Fourth Finger (+1 hand slot) | the tree's headline hand-size node |
| Wolfsbane Thread (leaps to a 2nd target) | Multishot |

**Moonlace** (cast without line of sight) — cut because line of sight is not
required for targeting in the first place. It invented a constraint in order to
break it.

**Reliquary Jar** (bottle a harvested element) and **Kingsfoil** (golem acts twice) —
cut because neither shapes a cast, so neither meets the definition of an ingredient.
Inventory management and golem behaviour are not spell components.

**Shapers as pages.** Growth, Multishot and Animate were pages. While they were,
every proposed ingredient collided with one of them, and infinite Animate meant
animating every prop in every room. Moving all shaping to the belt makes golems
precious and makes the page/ingredient split airtight.

**Chain Lightning as a fusion.** Spark already chains — shock on a soaked target
leaps to a nearby enemy. Chain Lightning is better as an *upgraded* Spark than as a
new combination.

## Open — not decided

Do not treat anything here as settled, and do not fill it in by inference.

- Name for the object-animation ingredient.
- How common animation ingredients are relative to the rest.
- Whether shapers (Growth, Multishot) drop at altars or only from chests.
- Whether object reactions destroy the object.
- Whether Bloodroot (the cast heals you for a share of damage dealt) is in or out.
- Prices for every tree node.
