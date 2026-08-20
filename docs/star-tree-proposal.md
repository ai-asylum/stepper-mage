# The Star Tree — content proposal

Companion to [star-tree-research.md](star-tree-research.md), which answered a
different question. That document is about **how the tree is drawn** — the
constellation rail, the ring geometry, the pinned route — and its
recommendation stands. This one is about **what the nodes should be**, because
the game the tree was written for is no longer the game being played.

Deliverable is a proposal. Nothing in `src/meta/tree.ts` was changed.

---

## 0. The recommendation, up front

Cut the tree from twelve nodes to **nine**, delete every node that points at a
feature the build cannot reach, and re-cut the survivors around the three verbs
the game actually has — **tear, fuse, harvest** — plus the one thing the player
already wants and cannot buy: **the roster**.

The single most important change is a rule, not a node:

> **The tree buys ACCESS and OPTIONS. It never buys a number.**

Every node below either hands the player a verb they did not have, or moves
where a run *starts* along an axis they already understand. None of them
multiply damage, and none of them are a prerequisite for the game being
completable — which is the line the genre's own audience is loudest about.

---

## 1. Why the current tree is out of sync

Measured against the code, not against the design docs.

**Half of it is unreachable.** Six of twelve nodes — `belt3`, `belt6`,
`corpseRaising`, `golemKeep1`, `golemInfusion`, `golemKeep2` — sit behind the
ingredient belt and the golems. `BELT_ENABLED` is `false` in
[src/flags.ts](../src/flags.ts), and object animation is a belt ingredient, so
none of those six do anything today. They are honestly labelled in the data
(`live: false`, with a `lands:` phase) but the player cannot see that label.
From the player's chair, half the sky is priced and inert.

**Two of the live nodes now describe the wrong mechanic.** `hand2` and `hand3`
raise a *ceiling* — but `handSize()` in [src/main.ts](../src/main.ts) is
`max(meta.handSize, min(HAND_MAX, state.pages.length))`, and altars now hand out
second and third copies of a page. The hand widens **inside a run** on its own.
So these two nodes no longer decide whether you can ever hold two cards; they
decide whether you *start* holding two. That is a real thing to sell, and it is
not what the node text says.

**One live node can do nothing at all on a new save.** `slots4` widens the
starting book to four pages, but the book can only hold elements whose wizard
you have freed. On a one-wizard roster the fourth binding buys a slot with
nothing to put in it.

**And the thing the player is actually chasing is not on the tree.** Since the
roster gate landed, the whole shape of progression is *which wizards are out* —
every element in the book is downstream of a cage. The tree, which is the screen
the game shows you between runs and calls progression, does not mention it.

---

## 2. What the research says, and what it rules out

The pattern in the community discussion is consistent and it is not subtle.

**Stat-based meta progression is the most disliked shape in the genre.**
Players describe permanent stat upgrades as "an extremely unsatisfying kind of
progression", object that the game becomes balanced around having them, and
characterise the loop as being expected to lose until you have farmed enough to
be allowed to play properly
([ResetEra](https://www.resetera.com/threads/im-starting-to-feel-that-stat-based-meta-progression-is-starting-to-ruin-roguelites-generally-speaking.1509337/),
[Hades II discussion](https://steamcommunity.com/app/1145350/discussions/0/4358999171576511867/?ctp=2)).
The specific complaint — *rewards dying, promotes grinding instead of skill* —
is what a tree of damage multipliers reads as.

**Unlocking options is the accepted alternative.** The same threads land on
"unlocking more stuff you can potentially find on future runs" as fine, and
power unlocks as the thing that undermines the genre. Dead Cells' runes are the
canonical example: they grant traversal and abilities — new *access* — and are
permanent and immediate rather than bought with a currency
([Dead Cells wiki](https://deadcells.wiki.gg/wiki/Runes_and_upgrades)).

**Slay the Spire's unlocks gate complexity, not power**, and that is why it
survives being the hardest thing in its own genre: unlocks give you more
options rather than an easier game, and the game is beatable from run one
([StS 2 discussions](https://steamcommunity.com/app/2868840/discussions/0/798966340583011639/)).
The extension of that idea is meta progression as a **gradual tutorial** — hold
back the advanced mechanic until the player is ready for it, and let the unlock
say "you are ready now"
([Garden of Learning](https://notes.hamatti.org/gaming/video-games/meta-progression-with-gradual-tutorial-in-roguelike-games)).

**Reversibility is what makes a tree safe to experiment in.** Hades' Mirror of
Night is repeatedly cited as one of the best systems in the genre, and the
reasons given are that every node has two exclusive variants and that a full
respec is cheap and refunds everything, so nothing is ever a trap
([TheGamer](https://www.thegamer.com/hades-mirror-of-night-roguelite-progression/),
[Fextralife](https://hades.wiki.fextralife.com/Mirror_of_Night)).
This game already refunds every node in full — that is a real asset and the tree
should lean on it harder, not hide it.

**What that rules out for us:** damage nodes, health nodes, "+1 star per chest",
and anything that makes floor one easier. Also anything that reads as a tax the
player must clear before the game is fair — the game must stay winnable with
**zero** nodes owned, and that should be stated as an invariant and tested.

---

## 3. The proposal

Four chains, nine nodes. Prices are in the existing unit — one good run is
roughly 70 stars, per the note above `PRICES` in
[src/meta/tree.ts](../src/meta/tree.ts).

### Chain A — THE HAND (start wide)

The hand is the game's central gate and its central lesson: a hand of one
cannot fuse, and fusion is the point. In-run widening now exists, so these
nodes stop being "can you ever" and become "do you start there".

| Node | Price | Requires | Effect |
|---|---|---|---|
| **Second Hand** | 40 | — | Begin every run able to hold two. |
| **Third Hand** | 140 | Second Hand | Begin able to hold three. |

Keep both, reprice neither, **rewrite both descriptions** to say *begin*. The
current text promises a capability the altars now give away, which makes the
first purchase feel like it did nothing.

### Chain B — THE ROOM (harvesting)

The dungeon-as-component-pouch is the pillar that separates this from every
other stepper, and the tree says nothing about it. This is where the genuinely
new options live.

| Node | Price | Requires | Effect |
|---|---|---|---|
| **Long Reach** | 70 | — | Harvest a fixture you are facing from two tiles, not one. |
| **Two Draughts** | 110 | Long Reach | A harvest fills two hand slots with the same element instead of one. |
| **Cold Cellar** | 150 | Two Draughts | A harvested element survives one cast — it returns to the hand instead of being spent. |

All three are verbs, not numbers. **Long Reach** loosens the adjacency rule the
game teaches first, which is exactly the "you are ready for this now" unlock the
tutorial-by-unlock argument describes. **Cold Cellar** is the strongest thing on
this list and is deliberately the most expensive: it turns the room from a
one-shot shelf into a resource you can hold, which is a different game.

*Open question for the designer:* Cold Cellar may be too strong beside the
no-storage rule in `docs/DESIGN.md`. The safer version is "the fixture you
harvested does not go quiet for the rest of the floor", if depletion is ever
added.

### Chain C — THE CAGES (the roster)

The missing chain, and the one the player is already chasing. It must not sell
wizards — a wizard is earned by walking to the cage — it sells **the odds of
meeting one**.

| Node | Price | Requires | Effect |
|---|---|---|---|
| **A Louder Cry** | 60 | — | The compass points at the cage once per floor. |
| **Two Cells** | 160 | A Louder Cry | A run may hold two captives, so one descent can free two wizards. |

**A Louder Cry** is information, which is the cheapest honest thing a tree can
sell. **Two Cells** is the answer to the roster being a five-run chain: it is
the node that shortens the longest stretch in the game without handing anyone a
page.

### Chain D — THE MOUTH (where a run starts)

Keep, trimmed. These already work and already sell options rather than power.

| Node | Price | Requires | Effect |
|---|---|---|---|
| **Wider Rites** | 70 | — | Altars offer four cards instead of three. |
| **Dungeon Mouth Blessing** | 90 | — | Choose a blessing before the first floor. |

Drop `blessingWider` (its phase has not landed) and drop `slots4` outright: the
book's width is now the roster's business, and a node that does nothing on a
one-wizard save is the same defect as the golem nodes.

### What is deleted

`belt3`, `belt6`, `corpseRaising`, `golemKeep1`, `golemInfusion`, `golemKeep2`,
`blessingWider`, `slots4`.

Not deleted from the *game* — deleted from the tree until the feature exists.
The `live: false` mechanism should stay in the schema, but a node that is not
live should not be **drawn**. A priced star that does nothing is worse than an
empty sky: it teaches the player that the tree lies.

---

## 4. Invariants worth writing into the code

Three, all cheap, all currently unstated:

1. **Winnable at zero.** No node is required to reach depth ten. If a balance
   pass ever depends on an owned node, that is the bug, not the tree.
2. **Every node is refundable in full, forever.** Already true; say it on the
   screen where the player can read it, because reversibility is most of what
   makes a tree worth touching.
3. **No node multiplies a number.** If a proposed node's effect can be written
   as "×" or "+n damage", it belongs in the run economy, not the tree.

---

## 5. What this does not answer

- **Prices.** The nine above are placed by feel against the one-run-≈-70-stars
  unit. They want a pass once the run length settles.
- **Whether the belt is coming back.** If `BELT_ENABLED` flips on, chain B and
  the old belt chain overlap heavily and one of them should give way — probably
  the belt keeps the ingredient slots and chain B keeps the harvest verbs.
- **The second-variant idea.** Hades' two-per-node structure is the single most
  praised thing in the research and this proposal does not use it. It would suit
  chain B especially (Long Reach *or* Two Draughts as exclusive halves of one
  star). Worth a look, but it doubles the content and the tree cannot afford
  that until the nodes themselves are settled.
