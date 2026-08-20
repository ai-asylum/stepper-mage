# The Star Tree — content proposal

Companion to [star-tree-research.md](star-tree-research.md), which answers a
different question. That document is about **how the tree is drawn** — the
constellation rail, the ring geometry, the pinned route — and its recommendation
stands. This one is about **what the nodes should be**, because the game the tree
was written for is no longer the game being played.

Nothing in `src/meta/tree.ts` has been changed.

The mechanics several of these nodes unlock — harvest depth, the belt and its
inventory, standing in a substance, the golem clay, the compass — are core-game
design and live in [harvest-belt-and-ground.md](harvest-belt-and-ground.md). This
document is only about which stars exist and what they cost.

---

## 0. The recommendation, up front

Re-cut the tree to **sixteen nodes** across five chains — one chain per system the
game actually has — and drop the two that point at nothing.

One rule over all of it:

> **The tree buys ACCESS and OPTIONS. It never buys a number.**

Exactly one node bends that rule and it is a pacing node rather than a power one
(§2). Everything else hands the player a verb they did not have, or moves where a
run starts along an axis they already understand.

The largest single change is not a node at all: **harvesting gets an inventory**
([harvest-belt-and-ground.md](harvest-belt-and-ground.md)), which turns the belt
from a shelved feature into the thing the tree teaches, and pulls the golem chain
back into reach on the way.

---

## 1. What the research says, and what it rules out

The pattern in the genre's own discussion is consistent.

**Stat-based meta progression is the most disliked shape in the genre.** Players
call permanent stat upgrades "an extremely unsatisfying kind of progression",
object that the game becomes balanced around having them, and describe the loop
as being expected to lose until you have farmed enough to be allowed to play
properly ([ResetEra](https://www.resetera.com/threads/im-starting-to-feel-that-stat-based-meta-progression-is-starting-to-ruin-roguelites-generally-speaking.1509337/),
[Hades II](https://steamcommunity.com/app/1145350/discussions/0/4358999171576511867/?ctp=2)).
The sharp version of the complaint — *it rewards dying* — is what a tree of
multipliers reads as.

**Unlocking options is the accepted alternative.** Dead Cells' runes are the
model: they grant traversal and abilities, i.e. new access, and are permanent and
immediate ([wiki](https://deadcells.wiki.gg/wiki/Runes_and_upgrades)).

**Slay the Spire's unlocks gate complexity, not power**, which is why it survives
being the hardest thing in its genre — more options, not an easier game, and
beatable from run one ([discussion](https://steamcommunity.com/app/2868840/discussions/0/798966340583011639/)).
The extension is meta progression as a **gradual tutorial**: withhold the
advanced mechanic until the player is ready, and let the unlock say "you are
ready now" ([Garden of Learning](https://notes.hamatti.org/gaming/video-games/meta-progression-with-gradual-tutorial-in-roguelike-games)).
That is exactly the job the belt should be given.

**Reversibility makes a tree safe to touch.** Hades' Mirror is repeatedly named
one of the best systems in the genre, and the reasons are exclusive two-variant
nodes plus a cheap, total respec — nothing is ever a trap
([TheGamer](https://www.thegamer.com/hades-mirror-of-night-roguelite-progression/),
[Fextralife](https://hades.wiki.fextralife.com/Mirror_of_Night)). This game
already refunds every node in full and never says so on the screen.

**Ruled out:** damage nodes, health nodes, anything that makes floor one easier,
and anything the game needs before it is fair. The game must stay winnable with
**zero** nodes owned.

---

## 2. The proposal

Five chains, sixteen nodes. Prices in the existing unit — one good run ≈ 70 stars.

### Chain A — THE HAND (start wide)

| Node | Price | Requires | Effect |
|---|---|---|---|
| **Second Hand** | 40 | — | Begin every run able to hold two. |
| **Third Hand** | 140 | Second Hand | Begin able to hold three. |

Keep both, reprice neither, **rewrite both descriptions** to say *begin*. The
current text promises what the altars now give away, so the first purchase reads
as having done nothing.

### Chain B — THE ROOM (harvest and the belt)

Two axes, bought separately — how many pouches, and how deep. See
[harvest-belt-and-ground.md](harvest-belt-and-ground.md) §1.4 for why both exist
and what a pouch holds.

| Node | Price | Requires | Effect |
|---|---|---|---|
| **Long Reach** | 70 | — | Harvest a fixture you are facing from two tiles, not one. |
| **A Pouch** | 90 | — | One small pouch on your belt. Harvest more than you can hold. |
| **Second Pouch** | 110 | A Pouch | Two. |
| **Sturdy Pouches** | 130 | A Pouch | Every pouch holds twice as much. |
| **Third Pouch** | 150 | Second Pouch | Three. |
| **Deep Pouches** | 200 | Sturdy Pouches | Every pouch holds twice as much again. |

Pouches four and five exist in the schema and are **not priced yet** — five is the
ceiling, but the first three plus two depth tiers is already six purchases in one
chain, and a tree wants proving before it is extended. The order the prices imply
is deliberate: breadth first and cheap, depth second and dear, so a new player
buys "I can carry a second thing" before "I can carry ten of one thing".

Six purchases is a lot for one chain. If it needs trimming, **Deep Pouches** folds
into Sturdy as a single tier — the top of a chain is where a node goes without
costing a decision.

A **gilded** pouch — one that keeps its contents into the next descent — is
deliberately **not** on this list. It is won at an altar, like the golden page it
copies; see §1.5 of the mechanics doc.

### Chain C — THE WAY (information, never power)

Renamed from THE CAGES: both nodes here sell knowledge of the floor, which is the
cheapest honest thing a tree can offer, and neither makes a fight easier.

| Node | Price | Requires | Effect |
|---|---|---|---|
| **A Louder Cry** | 60 | — | The compass points at the cage on floors that hold one. |
| **The Chart** | 120 | — | Tap the minimap for a full-screen map, and set a waypoint on it. |

**The Chart** is the fullscreen map and waypoint —
[harvest-belt-and-ground.md](harvest-belt-and-ground.md) §4. The minimap itself
stays free forever; what this buys is the reading room and the pin, which is why
selling it does not break the winnable-at-zero invariant.

Nothing here touches how many wizards a run can free: the roster chain is the
progression, and a node that shortcuts it would be selling the content the stars
were earned in.

### Chain D — THE MOUTH (where a run starts, and what it earns)

| Node | Price | Requires | Effect |
|---|---|---|---|
| **Compound Interest** | 30 | — | Unspent stars earn interest at the end of every run. |
| **Wider Rites** | 70 | — | Altars offer four cards instead of three. |
| **Dungeon Mouth Blessing** | 90 | — | Choose a blessing before the first floor. |

**Compound Interest is deliberately the cheapest thing on the tree**, and should be
affordable almost immediately — inside the first run or two. It is the one node
that touches a number, and pricing it *early* rather than late is what makes it
interesting: the first real decision the tree offers becomes *"buy a wider hand
now, or plant this and buy more later"*, which is a genuine investment choice
instead of a rounding error bolted on at the end.

It stays safe because of what stars can buy. Interest cannot make a floor easier —
it accelerates the rate at which the player acquires **options**, and every option
on this tree is one they could already have earned by playing. Two guards keep it
honest: **5% of the unspent balance, capped at +10 a run**, so hoarding can never
outrun playing, and it is **interest on what is left over** rather than a flat
stipend, so it rewards patience rather than existence.

**A note on the blessing, and a question it raises.** The Dungeon Mouth Blessing is
not an altar object — it is a rite at the mouth, before the first floor, and the
order is fixed in `openTheMouth`: **where to begin → which page → the blessing**.
So the sequence today is that the player picks their one page, the game says *"You
carry Flame, and nothing else"*, and then a blessing may immediately hand them a
second page. That is a contradiction in the game's own voice, and the page choice
is the line that suffers: it is meant to be the run's identity.

Three ways out, in order of preference:

1. **Move the wider-book blessing's page to the first altar** — you begin with one
   page as promised, and the blessing is a promise the dungeon keeps a floor later.
   Keeps both lines true and costs nothing.
2. **Reword the page choice** to "You set out with Flame" and let the blessing be
   what it is. Cheapest, but it gives up the strongest line in the opening.
3. **Drop the wider-book blessing** and let the other two axes (endurance, a deeper
   page) carry the rite. Loses the breadth axis, which is the one a one-wizard
   roster most wants.

### Chain E — THE SERVANTS (the golems, live)

The golem chain comes back, because the thing that shelved it is solved: the
animation clay is **harvested from world decorations**, so animating something
is free from floor one and needs no node at all
([harvest-belt-and-ground.md](harvest-belt-and-ground.md) §3). What the tree sells
is not *can you animate* — it is **does what you animated last**.

| Node | Price | Requires | Effect |
|---|---|---|---|
| **Coffin Rites** | 90 | — | The dead animate too, not only the furniture. |
| **Bound Servant** | 110 | — | Your golem follows you down instead of ending with the floor. |
| **Lasting Infusion** | 160 | Bound Servant | It keeps the element it was infused with. |
| **Second Servant** | 220 | Lasting Infusion | Keep two. |

Prices are the existing ones — they were already sized for this chain and nothing
about their shape has changed. What changes is that they now describe something the
player has already done with their own hands before they are asked to pay for it,
which is the right order: the clay teaches animation on floor one, and the tree
sells permanence once the player knows what they would be keeping.

`corpseRaising` keeps its id and moves off `belt3` as a prerequisite — it depended
on the belt only because the clay used to be a belt ingredient. Now the clay
is a harvest, so the whole chain is free-standing.

### What is deleted

Two nodes: **`blessingWider`** (its phase never landed) and **`slots4`** (the
roster owns the book's width now, so on a one-wizard save it buys a slot with
nothing to put in it).

Deleted from the *tree*, not from the game. The `live: false` mechanism should stay
in the schema, but a node that is not live must not be **drawn**: a priced star
that does nothing teaches the player that the tree lies.

## 3. Invariants worth writing into the code

1. **Winnable at zero.** No node is required to reach depth ten. If a balance
   pass ever depends on an owned node, that is the bug.
2. **Every node is refundable in full, forever.** Already true — say it on the
   screen, because reversibility is most of what makes a tree worth touching.
3. **No node multiplies a number**, with Compound Interest as the single, capped,
   deliberately-last exception.
4. **A node that is not live is not drawn.**

---

## 4. Still open

- **Prices.** Placed by feel against one-run-≈-70-stars, and sixteen nodes is
  enough that the curve matters more than any single number. Wants a pass once run
  length settles.
- **Whether the mouth's wider-book blessing moves to the first altar** (§2). It is
  the cleanest fix for the game promising "and nothing else" and then handing over
  a second page, but it changes what the rite is.
- **Pouches four and five.** In the schema, unpriced. Five is the stated ceiling;
  three plus two depth tiers is what wants proving first.
- **Hades' two-variant nodes.** The most praised idea in the research and unused
  here. It would suit chain B or chain E — exclusive halves of one star — but it
  doubles the content and the nodes should settle first.
