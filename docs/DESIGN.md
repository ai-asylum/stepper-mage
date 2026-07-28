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
| **Fixture** | supplies an **element the room owns** | free, line of sight, unlimited, not storable |
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

## Turn economy

**Every component selected costs a turn. The cast itself is free.**

- Tearing a page: 1 turn.
- Harvesting from a fixture: 1 turn.
- Taking an ingredient off the belt: 1 turn.
- Releasing the cast: free.

So a three-page fusion costs three turns of assembly. Consequences that make this
the load-bearing rule of the whole game:

- **Hand size 1 is a complete game**, not a punishment — one page, one turn, free
  cast is the same tempo as any other action.
- **Fusions are investments, not free power.** Three Fireballs over three turns is
  ~30 on one target; a three-turn Thunderhead is ~36 across three with statuses.
  Better against a group, worse against one thing.
- **Preparation is the reward.** Turns only cost you when something is acting, so
  assembling out of combat is free. Walk in with a triple loaded and release it for
  nothing. Assemble mid-fight and you eat three rounds standing there tearing paper.
- **Retreating with a loaded hand becomes a real tactic.**

Forgiving defaults, deliberately: **returning a component is free**, and **being
hit mid-assembly never drops your hand** (you already paid in turns).

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

**Sealed by default.** Pages found in a run are gone when the run ends. The only
exception is a golden page.

## Room fixtures — harvest

Line of sight, non-depleting (the candelabra stays lit), costs a hand slot and a
turn, and **always rank 1 with no rank scaling** — so owning the page is strictly
better and the fixture is a substitute plus an enabler.

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

1. **Harvest** its element — line of sight, non-depleting, costs a slot and a turn.
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
| **TimeSand** | free to take, and this cast's next two components are free too |

TimeSand must be free to take. If the sand itself costs a turn, you pay a turn *and*
a hand slot to save two — marginal. Free, it turns a 3-slot cast into a 0-turn cast.

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

**Golden page** → claimed into a `meta.loadout` slot, permanent from next run as a
normal page. If slots are full you choose what it displaces. Golden pages *are* the
mechanism behind "choose your starting spellbook" — one system, not two.

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
