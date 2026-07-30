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
  of the star tree's ladder, the acceptance criterion (`tools/fullrun.mjs --hand1`)
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

Always at least one spell option. Otherwise any of: heal · stars · rank-up ·
**sacrifice a rank-2 page to reach rank 3** · reroll charge · **golden page**.

A rolled page already at max rank pays **2 stars** instead — the run funds the meta
precisely when the run has nothing left to teach you.

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
