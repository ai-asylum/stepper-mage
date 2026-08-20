# The Star Tree — content proposal

Companion to [star-tree-research.md](star-tree-research.md), which answers a
different question. That document is about **how the tree is drawn** — the
constellation rail, the ring geometry, the pinned route — and its recommendation
stands. This one is about **what the nodes should be**, because the game the tree
was written for is no longer the game being played.

Revised after design review. Two nodes from the first draft are **deleted, not
parked** — see §5. Nothing in `src/meta/tree.ts` has been changed.

---

## 0. The recommendation, up front

Cut the tree to **nine nodes**, delete everything pointing at a feature the build
cannot reach, and re-cut the survivors around what the game actually is.

One rule over all of it:

> **The tree buys ACCESS and OPTIONS. It never buys a number.**

Exactly one node bends that rule and it is a pacing node rather than a power one
(§3). Everything else hands the player a verb they did not have, or moves where a
run starts along an axis they already understand.

The largest single change is not a node at all. It is that **harvesting gets an
inventory**, which turns the belt from a shelved feature into the thing the tree
teaches — and pulls the golem chain back into reach on the way.

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

## 2. Harvesting gets an inventory

This is the centre of the proposal. It replaces the first draft's worst idea
(§5) and it resolves three separate problems at once.

### 2.1 Fixtures get depth

A harvestable object holds a **finite** number of draws, set by how valuable its
element is:

| Fixture | Draws | Reads as |
|---|---|---|
| Water barrel, cistern, fountain | ~100 | effectively bottomless |
| Oil drum | ~20 | a resource you plan around |
| Candelabra, torch, brazier | ~5 | a thing you can use up |

The numbers are the design language, not a balance table: depth *is* the rarity
signal, so the player learns what fire is worth by finding out that candles run
out and water does not.

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

### 2.2 The belt is the sides of the screen

Not a second bar. Three slots **vertically down the left edge**, hanging under
the player portrait, where nothing else lives. The book owns the bottom, the
depth banner owns the top, and a strip above or below the book was always going
to fight one of them.

That placement also carries a meaning the old strip did not: the portrait is
*you*, and the belt is what you are carrying — a column of things on your person,
beside the picture of your person.

### 2.3 The UX, decided rather than left open

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

**Stowing back is the reverse swipe** — a held card pushed toward the belt — with
a tap as the same shortcut.

**Belt swipes belong to the belt.** The world reads a swipe as walking or turning,
so the belt needs the zone claim the book already has (`overBook` in `main.ts`): a
gesture that starts on a slot is the belt's, whatever it does next. Without that,
every draw is also a step.

**Belt contents survive a cast; hand contents are spent.** That is the line
between the two containers and it is the whole reason the belt is worth having.

### 2.4 Stacks, and what a stack is worth

A belt slot holds a **stack of one substance**, and the cap is per substance —
the second rarity dial after fixture depth, and it must agree with the first.

| Substance | Stack | Fixture depth | Reads as |
|---|---|---|---|
| Water | 20 | ~100 | carry as much as you like |
| Stone | 10 | ~40 | plentiful, heavy |
| Oil | 5 | ~20 | worth planning a room around |
| Fire | 3 | ~5 | you are carrying an open flame |
| Starlight | 2 | ~3 | precious |
| Golem draught | 2 | ~2 | the reason the cap exists |

The two numbers say the same thing twice on purpose: a candle is shallow *and*
fire stacks small, water is bottomless *and* stacks deep. A player who never
reads a number still learns the hierarchy, because the shallow things run out in
both directions.

Three slots at these caps is a real inventory — 60 water or 6 starlight — without
ever being a warehouse. And a cap of 2 on the golem draught is what keeps §4
honest: the limiter on golems is how much draught you can carry, not a cooldown.

### 2.5 Inventory management

Four verbs, and the common one stays a single tap.

**Harvest auto-stacks.** A draw joins an existing stack of the same substance
with room; failing that it takes the first empty slot; failing that it is refused
by name — *"your belt is full of oil"* — because a refusal that does not say what
is in the way is a refusal the player cannot act on.

**Draw is a swipe out, or a tap.** Either way one unit goes to the hand — see
§2.3 for why it is both. This is the action players perform hundreds of times a
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

**Remove is POUR IT OUT.** While a stack is lifted, tap the floor: the stack
empties onto the tile you are standing on as ground. Water makes a puddle, oil a
slick, fire lights the tile under your own feet.

This is the part worth arguing for. Discard is normally a delete — a bin icon, a
confirm, and a small feeling of waste. Pouring makes room *and* makes terrain, so
emptying a slot is a play: dumping five oil in a doorway and backing away is a
setup, and pouring fire on your own tile is a mistake the game already knows how
to punish. It reuses the ground system rather than adding a system, it needs no
new art beyond what a poured substance already draws, and it means the answer to
"my belt is full" is a decision instead of an apology.

The golem draught pours as nothing — a wasted slot and a stain. That is the game
saying out loud what the cap of 2 implies.

**What each verb costs:** drawing is free, moving is free, pouring **costs a
turn**. Free terrain creation would be the strongest thing in the game, and
pouring a slick is exactly the kind of act a room should get an answer to. Nothing
that changes the floor is ever free — same rule as a cast.

### 2.6 What this buys the design

- The belt gets a **reason to exist and a place to be taught**: you unlock it,
  you harvest into it, and the perk itself is the tutorial. That is the
  gradual-tutorial pattern from the research, applied to the one feature that has
  been shelved for lack of an on-ramp.
- **The golems come back** (§4), limited by how much draught a belt can carry.
- Harvesting stops being a one-shot and becomes a thing you *plan*, without ever
  becoming a faucet.

---

## 3. The proposal

Four chains, nine nodes. Prices in the existing unit — one good run ≈ 70 stars.

### Chain A — THE HAND (start wide)

| Node | Price | Requires | Effect |
|---|---|---|---|
| **Second Hand** | 40 | — | Begin every run able to hold two. |
| **Third Hand** | 140 | Second Hand | Begin able to hold three. |

Keep both, reprice neither, **rewrite both descriptions** to say *begin*. The
current text promises what the altars now give away, so the first purchase reads
as having done nothing.

### Chain B — THE ROOM (harvest and the belt)

| Node | Price | Requires | Effect |
|---|---|---|---|
| **Long Reach** | 70 | — | Harvest a fixture you are facing from two tiles, not one. |
| **The Belt** | 90 | — | Three slots down your left side. Harvest more than you can hold. |
| **Deep Belt** | 160 | The Belt | Five slots. |

**Long Reach** loosens the adjacency rule the game teaches first — the "you are
ready for this now" unlock. **The Belt** is the on-ramp described above and
absorbs the old `belt3`/`belt6` pair, which were priced at 70/140 for the same
capacities; the small increase is because the belt now does something.

### Chain C — THE CAGES (the roster)

The missing chain. It must **not** sell wizards, and it must not touch how many
you can free — a wizard is earned by walking to a cage, and the chain's length is
the progression.

| Node | Price | Requires | Effect |
|---|---|---|---|
| **A Louder Cry** | 60 | — | The compass points at the cage on floors that hold one. |

Information, which is the cheapest honest thing a tree can sell. One node, not
two — see §5.

### Chain D — THE MOUTH (where a run starts, and what it earns)

| Node | Price | Requires | Effect |
|---|---|---|---|
| **Wider Rites** | 70 | — | Altars offer four cards instead of three. |
| **Dungeon Mouth Blessing** | 90 | — | Choose a blessing before the first floor. |
| **Compound Interest** | 100 | — | Unspent stars earn interest at the end of every run. |

**Compound Interest** is the one node that touches a number, and it is included
because it is about *pacing*, not power: it cannot make a floor easier, and
everything it accelerates toward is another option.

Interest on the **unspent** balance is the right shape — better than "+1 star per
run", which is a trickle nobody thinks about. Interest makes banking a decision:
hold 200 stars and the tree pays you for patience, or spend now and take the node
this run. That is a real choice on a screen whose job is choices.

Two things it needs, or it inverts the game: a **cap** (5% of the balance, at
most +10 a run) so hoarding cannot outrun playing, and it must be **the last
thing** priced, because a compounding currency node bought early distorts every
price after it. If either feels shaky in play, this is the node to cut — it is
the only one whose absence costs the player no options.

### What is deleted

`corpseRaising`, `golemKeep1`, `golemInfusion`, `golemKeep2` (until §4),
`blessingWider` (phase never landed), `slots4` (the roster owns the book's width
now).

Deleted from the *tree*, not from the game. The `live: false` mechanism should
stay in the schema, but a node that is not live must not be **drawn**: a priced
star that does nothing teaches the player that the tree lies.

---

## 4. The golems, brought back into reach

The golem chain was shelved because Animate needs an ingredient and infinite
Animate was rejected. The belt-with-depth answers both: put the animation
ingredient **in the world as a harvestable**, and depth is the limiter that
`docs/DESIGN.md` was asking for.

- The ingredient is harvested from world objects — so it is reachable on **floor
  one, by a fresh player**, with no tree node required.
- **Cap the carry at one or two.** The limit is not a cooldown or a cost, it is
  how many you can be holding, which is the same rule the hand already teaches.
- The old `golemKeep*` / `golemInfusion` nodes then become what they were always
  meant to be: not *can you animate*, but *does it survive the floor*.

Sequencing: this lands after chain B ships, because it depends on harvest depth
and on the belt existing. It should re-enter the tree in the same pass that flips
`BELT_ENABLED`.

---

## 5. Two nodes from the first draft, and why they are gone

**"Two Draughts" — a harvest fills two hand slots with the same element.**
Deleted. It spends the player's scarcest resource — hand slots — on redundancy,
and the hand exists to be filled with *different* things: a hand of two identical
elements is a worse version of a hand of two, and the player would never choose
it. The belt is the correct answer to "I want more than one draw", because it
stores instead of crowding.

**"Two Cells" — two captives per run.** Deleted. The roster chain is the
progression: five wizards, one per descent, each freeing the next. A node that
frees two at once collapses that into a purchase, and it is exactly the shape the
research warns about — spending currency to skip the content the currency was
earned in.

---

## 6. Open question: the compass

The compass was specified for **quests**, and quests were never built, so it
currently points at one thing and is otherwise idle. There is an obvious use for
it — the cage (chain C), the nearest unclaimed altar, the boss door, the star
tree — and one real question: **override or second arrow?**

**Recommendation: one compass, one arrow, a priority stack — never two.** Two
arrows on a phone screen in a first-person view is two things to interpret at the
moment the player is trying to walk. A single arrow that always means "the thing
you most likely want next" stays readable:

1. A quest target, when quests exist. Always wins.
2. The cage, if this floor holds one and it is still shut (needs **A Louder Cry**).
3. The boss door, once the levers are found and it is open.
4. The nearest unclaimed altar.
5. The stairs, once open.

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

## 7. Invariants worth writing into the code

1. **Winnable at zero.** No node is required to reach depth ten. If a balance
   pass ever depends on an owned node, that is the bug.
2. **Every node is refundable in full, forever.** Already true — say it on the
   screen, because reversibility is most of what makes a tree worth touching.
3. **No node multiplies a number**, with Compound Interest as the single, capped,
   deliberately-last exception.
4. **A node that is not live is not drawn.**

---

## 8. Still open

- **Prices.** Placed by feel against one-run-≈-70-stars; they want a pass once
  run length settles.
- **Harvest depths.** The 100/20/5 sketch is a language, not a table. Candles at
  5 is the number most likely to be wrong in either direction.
- **Whether stowing costs a turn.** Drawing and moving are free above, which
  makes a mid-fight stow-and-swap a way to have six things available. The limiter
  is meant to be the hand's width, but if swapping every round turns out to read
  as free power, stowing is where the turn should be charged — not drawing.
- **Stack caps against the volume ladder.** 20 water in three slots is 60 units of
  ground the player can lay without casting. Pouring costs a turn each, which is
  the brake, but the numbers in §2.4 want a pass once pouring exists.
- **Hades' two-variant nodes.** The most praised idea in the research and unused
  here. It would suit chain B (Long Reach *or* something else as exclusive halves
  of one star), but it doubles the content and the nodes should settle first.
