# The Star Tree — design research and recommendation

Written brief. Deliverable is a recommendation, not code. Nothing in the repo was
modified.

---

## 0. The recommendation, up front

Draw the twelve nodes as a **constellation on a fixed 5-column rail**: five
columns, one row per prerequisite tier, growing **upward** out of the thumb zone.
Nodes are **discs with a pictogram and a short nickname**, not text cards. All
prose leaves the graph and lives in **one docked detail panel** above the CTA,
describing only the node you tapped. State is carried by **ring geometry** so it
reads without labels and without depending on colour. A locked node's panel button
reads **SAVE FOR THIS**, which pins a **route**: the edges from your owned frontier
to the goal light with purchase-order numerals and a running total, and the pin
persists into the run.

Three channels, kept orthogonal — this is the core of the visual design:

| Channel | Carries | Precedent |
|---|---|---|
| **Disc shape** | what kind of node it is (capability / capacity / persistence) | Diablo 4: square = active skill, circle = upgrade to one |
| **Colour** | which chain it belongs to | PoE colour-codes tree regions by attribute |
| **Ring geometry** | state: locked / saving / affordable / owned | Dead Cells' Boss Cell doors: requirement *and* satisfaction on one object |

The load-bearing arithmetic, all of it verified against the repo rather than
assumed:

- The twelve nodes form **5 tiers, never wider than 4**. A 5-column lattice at a
  76px row pitch is **~360px tall** — the entire tree fits on one screen with
  **zero scroll**.
- At ~25 nodes: ~8 tiers, ~670px of content in a ~578px body → **1.15 screens**,
  one flick. Still no pinch, no 2D pan.
- Today's screen is **~1290–1350px of content in a 670px body** (measured from
  `layout()` and confirmed against the screenshots), so this is roughly a
  **3x density gain** and a change from two screens to none.

Two things that matter more than the layout, per §2.4: the **affordability arc**
on every unaffordable node, and the **pinned route**. The layout fixes a
legibility bug. Those two fix the motivational one.

**Honest caveat that shapes everything below:** there is essentially **no portrait
mobile precedent for a scrolling spatial tree**. Of the genuinely portrait games
surveyed, exactly one shows node-to-node links at all, and it is a 7-node hex
cluster that never scrolls. This recommendation departs from the portrait
convention rather than following it, and §3.5 argues why that is correct *here*
specifically and not in general.

---

## 1. What is actually wrong with the current screen

I measured rather than trusting the description. Screenshots at `_shots/tree/` are
780x1688, i.e. 390x844 at DPR 2.

From `src/ui/tree.ts` `layout()`, a card is
`38 + (needs?12) + bodyLines*11 + 5 + (band? lines*10+9) + (risk?12) + (owned?28) + 6`
plus `GAP = 10`. Real cards measure **72–107 CSS px**, owned ones ~120. The body
region is `H - 92 - 82 = 670px`. So twelve nodes are **~1290–1350px in a 670px
viewport** — just under two screens, with **five to six cards visible**.

The user's "barely three" undercounts. The complaint is still right and the count
is not the reason. Five distinct mechanisms:

### 1.1 A single column deletes siblinghood

A tree carries exactly two relations: **ancestry** (this needs that) and
**siblinghood** (these are the alternatives at one depth). A choice is only ever
made *across siblings*. An indented list preserves ancestry perfectly and destroys
siblinghood, because depth-first order separates two siblings by the entire subtree
of the first.

In `02-tree-nothing-owned.png` the player has 47 stars, owns nothing, and can see
**one of the four roots**. `slots4` (60), `altarPages` (70) and `blessing` (90) are
~700px below, underneath a chain of golem nodes they cannot buy. **The screen never
once shows the player the decision they are making.** That is the mechanism — not
"it's a list", but "the alternatives are never co-visible".

The code already documents the symptom without naming the cause: roots are sorted
cheapest-first because otherwise "the second-cheapest node in the tree [was] at the
bottom of the screen, under five cards it does not connect to."

### 1.2 A list has one ordering; this screen needs three

`04-tree-scrolled.png` is the proof. 95 stars, nothing owned, and all three
affordable purchases (`slots4` 60, `altarPages` 70, `blessing` 90) sit at the
**bottom** of a two-screen scroll, below four locked golem nodes priced 110–220.
Depth-first topology is the sort key and topology is uncorrelated with
affordability.

This has a measured cost. NN/g's scroll research: content above the fold takes
**57% of viewing time**, the second screenful **17%**, and the 100px immediately
above the fold gets **102% more views** than the 100px immediately below it
([NN/g](https://www.nngroup.com/articles/scrolling-and-attention/)). The screen
puts the player's only actionable options in the 17% band.

A 2-D layout gets two orderings free (row = tier, column = chain) and carries the
third (affordability) in ring geometry. A single column must pick one axis and lie
about the rest.

### 1.3 Prose crowds out state, so state becomes prose

Because every card must be read anyway, state is spelled out: `LOCKED`,
`AVAILABLE`, `SAVING UP`, `✓ OWNED`, `NEEDS SECOND HAND FIRST`, `held by what it
unlocked`. `NEEDS … FIRST` appears on **eight of twelve** cards. The phase band
appears on **seven**, costing ~29px each (~175px of total scroll) to communicate a
*development schedule* rather than a purchase. Reading twelve labels is O(n) work
to learn what twelve rings say in one glance.

### 1.4 Depth is encoded at 16px and is therefore invisible

`INDENT = 16` on a 390px screen: "Deep Belt" and "Ingredient Belt" differ by 4% of
the width. The gutter spine is 1.2px at 30% alpha. The structure is technically
present and perceptually absent, and the left ~40px is dead space on the axis the
screen has least of.

### 1.5 Vertical position reads as recommended order

A depth-first column says "do this, then this, then this." It converts a lattice of
alternatives into an instruction list, which is the definition of a checklist. This
is the direct answer to "what makes a tree feel worth exploring rather than a
checklist to grind out": **a list has a reading order and a graph has a frontier.**
A frontier invites a choice; an order invites compliance.

### 1.6 What the current screen gets right

At `10-chain-owned.png` the lit gold path through owned nodes is genuinely legible
and satisfying, and `13-sell-costs-a-page.png` shows the `SELLING GIVES UP
FIREBALL` warning doing real work. The lit path and the transaction-speaks-back
refusals (`say()`) are good and must survive. It is the container that is wrong,
not the instincts.

---

## 2. What makes these screens good — principles

### 2.1 Load-bearing

**A. Co-visible alternatives.** Everything else is downstream. The things the
player is choosing between right now must be on screen together.

**B. A shape that can be remembered, because it never moves.** PoE veterans
navigate ~1,500 nodes not because it is legible but because it is *stable* —
memorised as terrain. NN/g's spatial-memory research makes the mechanism precise:
spatial memory is real but **fuzzy, neighbourhood-level rather than
street-address-level**; it forms relative to boundaries and landmarks; and
critically, **reflowing layouts destroy it while pure scaling preserves it**
([NN/g](https://www.nngroup.com/articles/spatial-memory/)). That single finding
decides two things below: node positions are hand-authored, and narrow screens
*scale* the lattice rather than reflowing it to fewer columns.

Salt and Sanctuary is admired because its branches read as silhouettes — the
dexterity branch "looks like a bow", the greathammer branch a bull
([Steam guide](https://steamcommunity.com/sharedfiles/filedetails/?id=692393175),
[Fextralife](https://saltandsanctuary.wiki.fextralife.com/Tree+of+Skill)).
TheGamer picks Nioh 2 specifically because "nodes you've unlocked look[] like
miniature star constellations" — the shape is *drawn by your own purchases*
([TheGamer](https://www.thegamer.com/best-skill-tree-designs-in-video-games/)).
Shape is the addressing scheme, not decoration.

**C. State legible without reading, in channels that don't collide.** See §4.4.
The failure to avoid is real and documented: a PoE thread reports players unable to
tell whether a dark master node means it is being nullified or is merely cosmetic,
with no dev answer ([PoE
forum](https://www.pathofexile.com/forum/view-thread/3642574)). **Glow-as-state
fails the moment glow is also decoration.** That is the argument for a strict
motion and glow budget, and against a decorative starfield.

**D. A visible, quantified route to something you cannot have yet.** §2.4.

**E. Free, safe refunds — the most consistent finding in the entire survey.**
Hades resets for a Chthonic Key and refunds all Darkness
([TheGamer](https://www.thegamer.com/hades-mirror-of-night-roguelite-progression/)).
Vampire Survivors puts an "enormous" refund button at the **top** of the PowerUp
screen, free and unlimited
([Siliconera](https://www.siliconera.com/how-to-reset-progress-in-vampire-survivors/),
[wiki](https://vampire.survivors.wiki/w/PowerUp)). Magic Survival has a "Collect"
button that reclaims all invested points
([guide](https://www.talkandroid.com/18898-magic-survival-walkthrough-guide-tips/)).
Otherworld Legends gives per-row refund plus **three switchable saved schemes**
([wiki](https://otherworld-legends.fandom.com/wiki/Power_of_Asura)). Survivor.io
salvages 1:1
([BlueStacks](https://www.bluestacks.com/blog/game-guides/survivor-io/sio-beginner-guide-en.html)).
A survey of portrait roguelites credits free respec as *the* reason Vampire
Survivors works one-handed on a phone
([antinomy.me](https://antinomy.me/posts/roguelike-mobile-game-2025/)).

This game already has it, leaves-only. It has an under-appreciated consequence:
**if refunds are free, the screen does not need to be a planning tool.** It needs
to be legible and fast. That argues strongly against importing PoE-style density,
and it argues for making the refund *visible* — right now `SELL` is buried one per
owned card rather than being an obvious global affordance.

**F. Nodes that are verbs, not numbers.** `DESIGN.md`'s rule — "Everything on it
must change behaviour, not a number" — is the strongest asset this screen has, and
it inoculates against the loudest criticism in the genre. On ResetEra and Steam the
complaint is "paying the farm tax", "a pure waste of time with no real progression
except a stats grind"
([ResetEra](https://www.resetera.com/threads/im-starting-to-feel-that-stat-based-meta-progression-is-starting-to-ruin-roguelites-generally-speaking.1509337/page-2),
[Hades II](https://steamcommunity.com/app/1145350/discussions/0/4358999171576511867/?ctp=2)).
Twelve behaviour changes is also *the* argument that an icon-first design is
possible at all: every node depicts something you will do, so a pictogram can carry
it. A +5% node could not.

**G. Restriction, and the courage to keep the tree small.** The best developer
source found in this whole survey is Eleventh Hour Games' own blog on Last Epoch's
passive system. It is explicitly about screen size, and its two key sentences are
verified first-hand:

> "To keep the passive system on a single screen without a massive zoom we have
> created a unique Passive Grid for each class."
>
> "Interesting decisions come from restrictions."

They target "around 16-17 node points" at endgame
([EHG, 2018](https://forum.lastepoch.com/t/passive-skill-systems/1270)). A studio
building an ARPG passive system chose *one screen, no zoom* as a hard constraint
and got a well-liked system out of it. That is the closest thing to external
validation this recommendation has.

### 2.2 Decoration, mostly

- **Organic tree art.** The interesting region of a tree drawing is the middle; the
  interesting region of a dependency graph is the frontier. They fight.
- **Scale as spectacle.** TheGamer praises PoE because its "grandiose scale has a
  beauty of its own", and that is real — but it works because PoE's tree is a
  *promise of years*: ~1,500 nodes against ~124 points, so you can afford ~8% and
  the tree is a **map of roads not taken**
  ([Fextralife](https://pathofexile2.wiki.fextralife.com/Passive+Skills),
  [Game8](https://game8.co/games/Path-of-Exile-2/archives/487065)). Twelve nodes
  cannot fake that and should not try. See §2.3 for why this game is structurally
  the opposite.
- **Per-node flavour prose.** Read once, never again. Belongs behind a tap.
- **Animated glitter and a starfield.** Actively harmful; §3.4.

### 2.3 The single most important structural fact about *this* tree

With free refunds, no point cap, and prices totalling ~1,340 against ~70 stars per
run, the player will eventually own **everything**. So this tree is not a map of
roads not taken. **It is a schedule.** The only decision it ever presents is
*order*.

That reframes the screen's job completely. It is not "help me choose forever" — it
is **"help me choose what to buy next, and give me something to save for."** Every
recommendation below is optimised for that, and it is why the affordability arc and
the pinned route matter more than the prettiness of the layout.

It also means the "illusion of choice" critique
([Blizzard forums](https://us.forums.blizzard.com/en/wow/t/are-the-talent-trees-really-just-an-illusion-of-choice/1906072),
[gamedesigning.org](https://gamedesigning.org/learn/skill-trees/) on ladders vs
trees) does not straightforwardly apply, and should not be answered by adding
mutually exclusive nodes. It should be answered by making *order* feel consequential
— which it genuinely is, because hand size 2 gates the entire game.

### 2.4 The finding that reorders the priorities

From the portrait survey, and it is worth quoting the conclusion because it is
counter to what the brief assumed:

> Across Mighty Doom, Archero 2 and Survivor.io the complaints are grind, RNG,
> currency counts and level-gated purchases. **No verified complaint of the form "I
> can't read the tree" was found** — which suggests the real risk is not node
> legibility but making the *cost/benefit of the next node* legible.

So: fix the layout because it is broken, but understand that the thing which will
make players *love* the screen is next-node clarity. Hence the affordability arc
(§4.4) and the pinned route (§4.6) are the highest-value items in this brief, not
the lattice.

### 2.5 Where sources genuinely disagree

**Should a beloved meta screen even be a tree?** The two most-loved examples in the
genre are not trees. Hades' Mirror of Night is two columns of paired alternates
with no spatial graph. Vampire Survivors' PowerUps are 28 items with, in the wiki's
words, no gating restrictions at all, praised because progress is "tiny individual
increments separated into many little bonuses, so it doesn't feel grindy"
([wiki](https://vampire.survivors.wiki/w/PowerUp),
[analysis](https://jboger.substack.com/p/the-secret-sauce-of-vampire-survivors)).
Magic Survival's Research is a flat list of ~20 perks with **no prerequisites**
([wiki](https://magic-survival-rpg.fandom.com/wiki/Research)). Brotato is a
well-reviewed portrait roguelite with **no meta tree at all**
([TouchArcade](https://toucharcade.com/2023/04/04/brotato-iphone-ipad-android-review/)).

So "list bad, tree good" is **not** supported by the evidence. What is supported is
narrower and sharper:

> A list is fine when the items are independent. It fails when the items have
> dependencies, because a list cannot show two relations at once.

Hades' Mirror has no prerequisite edges; Vampire Survivors' PowerUps have none;
Magic Survival's Research has none. **This tree has edges**, and `meta/tree.ts` is
explicit that they are the reason it is a tree and not a shop: "A tree and not a
shop list because some purchases are genuinely INERT without another." That is what
makes a spatial layout correct *here specifically*, and it is a far better argument
than "trees look cooler". It is also the answer to the portrait survey's closing
challenge — "worth having a reason your tree earns its screen."

**Is a big tree good or bad?** Chris Wilson, on GGG's own internal split: the tree
is "a little infamous for being this gigantic grid that's a little overwhelming",
GGG was "still fighting internally about what we're doing with it", and the two
camps were *simplify the first view so the depth unfolds* versus **"this tree is
iconic"** ([interview](https://gamepedia.com/blogs/2050-interview-chris-wilson-on-path-of-exile-2s-origins)).
Against that: Last Epoch feedback that trees were "very busy with lots of small
icons and text" and feel "crammed into the half a screen it has"
([forum](https://forum.lastepoch.com/t/passive-trees/11006)); Rogue: Genesia
described by its own players as "overcomplicated… almost overwhelming to get into"
and unfavourably compared to Brotato's 17 easily-understood stats
([Steam](https://steamcommunity.com/app/2067920/discussions/0/597399326497483232/));
Loop Hero's camp criticised because the "high overhead perspective makes buildings
appear minute with no distinguishing features", becoming "a muddy blur of brown and
yellow" ([TheGamer](https://www.thegamer.com/loop-hero-review/)) — a direct warning
about small similar glyphs, addressed in §6.1.

Honest read: **density buys longevity and costs first-session legibility.** A 12→25
node tree should buy legibility, because it has no longevity to protect.

**Do numbers help or hurt?** I recommend replacing printed prices on nodes with an
arc. Slay the Spire's playtesting cuts the other way: the team "didn't want to
present too many numbers to players… but they discovered through playtesters that
having the numbers available was more engaging"
([Wikipedia](https://en.wikipedia.org/wiki/Slay_the_Spire)). Real tension; §6.7.

**Is the bottom of the screen the easy zone?** Smashing and the thumb-zone
literature say yes; NN/g's bottom-sheet guidance calls bottom-edge reachability "a
myth" and argues the **middle** is most easily tappable
([NN/g](https://www.nngroup.com/articles/bottom-sheet/)). §3.2 resolves this.

---

## 3. What portrait specifically demands

### 3.1 The canvas is narrower than 390

From `src/core/engine.ts:296-310` the stage is clamped to aspect 0.42–0.52 and
letterboxed, so width is not what you would assume:

| Device | Viewport | Stage after clamp |
|---|---|---|
| iPhone 15 / 14 | 393x852 | 393x852 (a=0.461, in range) |
| iPhone 12 mini | 375x812 | 375x812 |
| iPhone SE 2/3 | 375x667 | **347x667** (a=0.562 > 0.52) |
| iPhone SE 1 | 320x568 | **295x568** |

The design target is **~344 wide, ~667 tall** as the realistic floor, with 295 as
the degraded case. Every number below is checked at all four widths.

### 3.2 Thumb reach and tap targets, with the numbers

Hoober's observational study (UXmatters, 2013) is the primary source: **1,333
observations**, 780 involving touch. Grip split **49% one-handed / 36% cradled /
15% two-handed**; within one-handed use 67% right thumb; cradlers used a thumb 72%
of the time; two-handed use was 90% portrait
([UXmatters](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)).
The frequently-cited "~75% of interactions are thumb-driven" figure is **Josh
Clark's, not Hoober's**, via
[Smashing](https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/).

Minimums: Apple HIG **44x44 pt**; Google **48x48 dp**, ≈9mm physical, separated by
**8dp or more**, with a general 7–10mm recommendation
([Google](https://support.google.com/accessibility/android/answer/7101858),
[Material](https://m2.material.io/develop/web/supporting/touch-target)). Apple's
own page would not render for verification — the 44pt figure is confirmed
second-hand via [Deque](https://dequeuniversity.com/rules/attest-ios/1.0/touch-target-size).

The most useful finding for a graph canvas is **position-dependent sizing**. Per
Hoober's *Touch Design for Mobile Interfaces*, accuracy is worst at the screen
edges, and recommended sizes including padding are **top 11mm (~42px), centre 7mm
(~27px), bottom 12mm (~46px)**
([Smashing 2023](https://www.smashingmagazine.com/2023/04/accessible-tap-target-sizes-rage-taps-clicks/)).
Note this is the opposite of naive intuition: the *bottom edge* needs the largest
targets, not the smallest.

That resolves the disagreement in §2.5. NN/g is right that the extreme bottom edge
is not free, and Smashing is right that the lower region is best. The synthesis:
**aim for the lower-middle, not the bottom edge** — which is exactly where tier 0
lands anyway, because the docked panel and CTA occupy the bottom ~200px. Spotify's
move of its menu from top-left to a bottom nav produced +9% clicks overall and
+30% on menu items, which supports the general direction
([Smashing](https://www.smashingmagazine.com/2020/02/design-mobile-apps-one-hand-usage/)).

**The implementation move that makes all of this moot: draw the disc small, make
the hit rect the whole lattice cell.** A 48px disc inside a 72x76 hit cell is
always ≥46px in both axes even at the 295px floor (cell 53x72). Hoober's
edge-inflated requirements are satisfied automatically, and the visual can be
sized for legibility rather than for fingers.

### 3.3 Navigating a graph bigger than one screen

The canonical taxonomy is Cockburn, Karlson & Bederson, *A Review of
Overview+Detail, Zooming, and Focus+Context Interfaces*, ACM Computing Surveys 2008
([ACM](https://dl.acm.org/doi/10.1145/1456650.1456652)). Ranked by what survives a
thumb:

**Constrained 1-D scroll on a fixed rail — recommended.** The graph never reflows,
columns are a permanent addressing scheme (§2.1B), and "where am I" is one number.
Vertical is also the direction users default to on mobile regardless of intent
([UX Collective](https://uxdesign.cc/best-practices-for-horizontal-lists-in-mobile-21480b9b73e5)).
The nearest thing to a paper on exactly this problem — *Chunky Chains: Graph
Drawings on Small Screens* — independently arrives at the same shape: bound the
width, grow the height, and let vertical scrolling be the only interaction
([arXiv 2607.06029](https://arxiv.org/abs/2607.06029); venue and year unconfirmed,
the PDF carries template placeholders). The general principle from
desktop→mobile visualisation adaptation work is the same: **invert the aspect ratio
and transpose the axes** rather than compressing
([arXiv](https://arxiv.org/pdf/2604.23299)).

**Free 2-D pan + pinch zoom — reject.** This is the PoE/ESO/Skyrim interaction and
it is the source of their navigation complaints. Jul & Furnas' **desert fog** names
the mechanism: at high zoom, orienting features separate until nothing is on screen
and the user cannot tell which direction anything lies
([UIST 1998](https://www.researchgate.net/publication/2806120_Critical_Zones_in_Desert_Fog_Aids_to_Multiscale_Navigation)).
Skyrim's constellation perk menu — the closest existing thing to what is proposed
here — is called "a total mess", "really clumsy" to navigate, with mis-clicks
zooming you into a constellation you did not want
([gamesas](https://www.gamesas.com/what-skyrim-needs-perk-menu-overhaul-t361793.html),
[Steam](https://steamcommunity.com/app/72850/discussions/0/217691032439209384)).
**That is a camera failure, not an aesthetic one — the constellation look is widely
liked. Take the look, refuse the camera.** Pinch also has independent costs: it is
treated as a frustration signal
([FullStory](https://www.fullstory.com/blog/pinch-to-zoom/)) and "pinch" is not
universally understood terminology
([Baymard](https://baymard.com/blog/mobile-image-gestures)).

**Focus+context / fisheye — reject, with a caveat.** Distortion reliably damages
target acquisition: objects appear to move as the focus approaches, and error rates
rise with magnification
([Springer](https://link.springer.com/article/10.1007/s11432-013-4868-8)). Your
targets *are* the things being tapped, so this is disqualifying. The caveat is
real, though: Büring et al. (IEEE TVCG 2006), 24 participants on a PDA-sized
viewport, found **no significant time difference but 20 of 24 preferred the
fisheye**, rating it better for orientation
([PubMed](https://pubmed.ncbi.nlm.nih.gov/17080806/)). Users value preserved
context on small screens more than they value clean interaction. The lesson to
take is not "use fisheye" but "**never let the player lose context**" — which a
one-screen layout achieves by not needing to.

**Overview + detail (minimap) — hold in reserve.** Hornbæk et al. (ToCHI 2002)
found subjects were *faster without* the overview on one map, yet **80% preferred
having it**
([ACM](https://dl.acm.org/doi/abs/10.1145/586081.586086)). Worth adding only if
content ever exceeds ~1.6 screens.

**Semantic zoom, if ever needed**, should follow Microsoft's rules: item layout and
panning direction must **not** change between levels, and the zoomed-out view is
limited to **at most three screens** of panning
([Microsoft](https://learn.microsoft.com/en-us/windows/apps/design/controls/semantic-zoom)).
The recommendation below stays inside that budget by never exceeding ~1.2 screens.

One more thing to steal: NN/g's **illusion of completeness** — content cropped
cleanly at a boundary reads as "there is nothing more"
([NN/g](https://www.nngroup.com/articles/illusion-of-completeness/)). The current
code's edge fades already know this; keep them.

For twelve nodes the honest answer is that **there is no navigation problem to
solve**, because the whole sky fits. Design so that stays true to ~25.

### 3.4 The one thing the celestial metaphor must not do

ESO rebuilt Champion Points as literal constellations, and the feedback is a
checklist of what to avoid: "stars mix with the background and lines connecting
stars aren't visible well"; difficulty "seeing where everything is"; no obvious
visual cue distinguishing node types, with the distinction "very subtle" even in
tooltips; the whole thing "confusing as hell"
([PTS feedback](https://forums.elderscrollsonline.com/en/discussion/559378/pts-update-29-feedback-thread-for-champion-point-system),
[interface issues](https://forums.elderscrollsonline.com/en/discussion/173555/champion-point-interface-issues),
[MMORPG.com](https://www.mmorpg.com/editorials/elder-scrolls-online-champion-point-20-deep-dive-2000120951)).

The mechanism: **a starfield is noise in the same channel as the signal** — small
bright dots on a field of small bright dots. Combined with the PoE glow ambiguity
in §2.1C, the rule is:

> **No starfield. No nebula. No twinkling background. No parallax.** Keep the flat
> `#08060d`. The sky is empty and the nodes are the only stars in it.

This is also the cheapest option in Canvas 2D, which is convenient.

### 3.5 What portrait mobile actually does, and why to depart from it

The survey of genuinely portrait games found a consistent convention, and it is
not a tree:

- **Archero**: 3-column grid of large hexagons in a modal panel, hex ≈25% of screen
  width, icon with the label *below*, no links between nodes. State is carried by
  frame colour in rarity bands; "Max" is printed as a word on the tile. Upgrades
  are **randomly assigned** — Archero deletes the "which first?" decision entirely
  ([Pro Game Guides](https://progameguides.com/mobile/archero-talents-list-all-currently-available-talents/)).
- **Survivor.io**: the only one with visible links — a **7-node hex cluster** (1
  centre + 6 satellites) sitting above the character on the Equipment screen. No
  scroll, no pan. It is a socket graph, not a purchase tree; the primary action
  (Merge) is bottom-anchored
  ([mrguider](https://www.mrguider.org/strategy/survivor-io-tech-parts-tier-list/)).
- **Archero 2**: talent *cards* in a collection grid, gated by **set completion**
  ([wiki](https://archero-2.game-vault.net/wiki/Talent_Cards)).
- **Magic Survival**: ~20 perks, flat, no prerequisites, entry point one tap from
  Start ([wiki](https://magic-survival-rpg.fandom.com/wiki/Research)).
- **Soul Knight Prequel / Soul Knight / Otherworld Legends** are **landscape**, so
  they are not valid portrait references at all. Soul Knight Prequel is still
  instructive: its gating is **threshold-spend** ("spend 8 Skill Points on Archer to
  unlock"), not adjacency
  ([wiki](https://soul-knight-prequel.fandom.com/wiki/Archer)).

The pattern: **portrait mobile replaces adjacency prerequisites with cheaper
gates** — threshold-spend, account-level caps, set completion, or nothing — and
lets cost curves do the shaping instead of topology.

So why not just do that? Because `DESIGN.md` and `meta/tree.ts` already decided,
for a good reason, that the edges are *real*: the belt is inert below hand size 2,
because every ingredient shapes a cast and a hand of one holding an ingredient is a
cast that cannot legally exist. Expressing that as an edge is what stops the game
selling a purchase that does nothing. **Threshold gates cannot express that; they
express order, not dependency.** Given genuine edges, node-link is the right form:
it is empirically good at conveying overall structure for **sparse** graphs, and
degrades sharply with density
([arXiv](https://arxiv.org/pdf/1404.1911)) — and 12–25 nodes with ~11 edges is
firmly in the sweet spot. Participants also *rate* node-link forms as more
understandable than text alternatives ([arXiv](https://arxiv.org/pdf/2003.14274)).

What to take from the convention anyway: **icons with labels beneath them**, **big
targets**, **bottom-anchored commit buttons**, **prominent refunds**, and **shallow
entry**. All are in §4.

---

## 4. The recommendation, specified

### 4.1 Metaphor: yes, celestial — and it earns its place structurally

Not because the currency is called stars (that would be a pun) but because it is
the only metaphor that solves three real layout problems:

1. **The graph has four roots.** `hand2`, `slots4`, `altarPages` and `blessing` are
   independent; only the `hand2` subtree is a real tree (8 of 12 nodes). **A tree
   with four trunks is a broken tree. A sky with four constellations is a normal
   sky.** This also survives the roadmap: new independent chains are new
   constellations, not new trunks.
2. **It legitimises empty space.** The layout needs ~50% of the lattice empty for
   tap targets. Empty space in a tree drawing looks like missing branches; in a sky
   it looks like sky. (Guard against the opposite failure — Cambridge
   Intelligence's "snowstorm", a graph too sparse to read
   ([blog](https://cambridge-intelligence.com/blog/designing-intuitive-data-experiences-with-graph-visualizations/)).
   See §6.6.)
3. **It gives "owned" a native verb.** An unowned node is a dim unnamed star. You
   buy it and it *lights*, and the line to its neighbour is *drawn*. The
   constellation is completed by your purchases — the exact property TheGamer
   singles out in Nioh 2.

Keep the title "THE STAR TREE" (the design doc's word). The drawing is a
constellation. No zodiac, no astrology, no invented lore.

### 4.2 Layout: 5-column rail, one row per tier, growing upward

`tier(n) = 0` if `requires` is empty, else `1 + max(tier(requires))`. For today's
twelve:

| Tier | Nodes | Width |
|---|---|---|
| 0 | `hand2` 40, `slots4` 60, `altarPages` 70, `blessing` 90 | 4 |
| 1 | `belt3` 70, `hand3` 140, `blessingWider` 150 | 3 |
| 2 | `corpseRaising` 90, `golemKeep1` 110, `belt6` 140 | 3 |
| 3 | `golemInfusion` 160 | 1 |
| 4 | `golemKeep2` 220 | 1 |

**Five tiers, never wider than four**, so a 5-column lattice holds it with a spare
column. I verified a greedy placement (each child prefers its parent's column, else
nearest free; tier-0 roots cheapest-first) produces **zero edge crossings**:

```
T0 | hand2 |slots4|altarP|blessi|  .
T1 | belt3 |hand3 |  .   |blessi|  .
T2 | corpse|golemK|belt6 |  .   |  .
T3 |   .   |golemI|  .   |  .   |  .
T4 |   .   |golemK|  .   |  .   |  .
crossings: 0
```

Geometry at all four widths (side margin 14, `pitch = (W-28)/5`):

| | W=295 | W=344 | W=390 | W=439 |
|---|---|---|---|---|
| pitch | 53.4 | 63.2 | 72.4 | 82.2 |
| disc (`clamp(pitch-16, 38, 52)`) | 38 | 47 | 52 | 52 |
| gap between discs | 15.4 | 16.2 | 20.4 | 30.2 |
| **hit cell (pitch x rowPitch)** | **53x72** | **63x76** | **72x76** | **82x76** |

The hit cell clears 48dp in both axes at every width, including the 295px floor.
**Scale the disc; never reflow to fewer columns** — reflowing would destroy spatial
memory (§2.1B) for a gain the hit cell already provides.

Vertical budget at 390x844:

```
0    – 8     safe top
8    – 62    header: title · ✦ bank (large) · HAND / BOOK / OWNED chips · REFUND
62   – 640   the sky            578px  → 5 tiers at 76px = 380px. Fits, no scroll.
640  – 770   docked detail panel 130px (fixed height, never reflows)
770  – 836   ENTER THE DUNGEON  48px + margins
```

At the 667-tall floor the sky still gets ~400px, enough for five tiers at a 72px
row pitch. **Today's tree needs no scrolling at all**, which is the single biggest
change from the screenshot.

**Growing upward**: tier 0 nearest the panel, higher tiers ascending. Rationale —
the frontier you tap most often lands in the lower-middle (§3.2); Diablo II
precedent; Last Epoch's own progression bar rises bottom-to-top
([Maxroll](https://maxroll.gg/last-epoch/resources/passives-and-skills)); and the
celestial metaphor only works one way up. Scroll initialises at the bottom.

**Author the column; do not compute it.** Add an exhaustive
`POS: Readonly<Record<NodeId, number>>` to `ui/tree.ts` — the same pattern the file
already uses for `FAMILY`, where a node added without an entry is a build error.
Keep it in `ui/`, not `meta/`, so the rules file stays free of presentation. The
greedy layout works today but will reshuffle when node 13 arrives, and **a shape
that changes cannot be remembered** (§2.1B). Twelve integers, one edit, and it lets
the designer make the constellations *look* like something.

If a future tier ever needs six nodes, **wrap it across two rows** rather than
adding a sixth column. Wrapping weakens "row = tier" locally; six columns breaks
tap targets globally.

### 4.3 Node representation

A **52px disc** (48 at the 344 floor) with a **~28px pictogram** in Canvas 2D
paths: two fingers / three fingers, a strap with loops, a skull, a standing golem,
an altar slab, a book with four bands, an archway. Cheap because the house already
generates art procedurally, and *possible* only because every node is a behaviour
(§2.1F).

**Shape encodes kind**, following Diablo 4, whose own announcement says "Spend
skill points on square nodes to unlock new active skills… Spend points on circular
upgrade nodes to enhance active skills you've unlocked"
([Blizzard](https://news.blizzard.com/en-us/diablo4/23529210/)). `meta/tree.ts`
already names three kinds — "Capability, capacity and persistence only" — so:

| Kind | Shape | Nodes |
|---|---|---|
| **capacity** (raises a ceiling) | hexagon | `hand2`, `hand3`, `belt3`, `belt6`, `slots4` |
| **capability** (a new thing you can do) | circle | `corpseRaising`, `blessing`, `blessingWider`, `altarPages` |
| **persistence** (survives a boundary) | diamond | `golemKeep1`, `golemInfusion`, `golemKeep2` |

This is worth the effort because it makes the sky readable *by category* before any
colour is decoded, and because it gives the four constellations distinct textures.

Under each disc, a **6.5px monospace nickname**, one or two words, ≤9 characters —
at a 63px pitch a 6.5px monospace fits ~9 characters. `HAND II`, `HAND III`,
`BELT`, `DEEP BELT`, `RITES`, `SERVANT`, `INFUSION`, `2ND SERV`, `ALTARS`,
`BLESSING`, `WIDER`, `4TH BAND`. This is a real cost — the design must supply a
nickname per node — and it is worth paying, both because a pictogram alone is a
guessing game on first open and because Loop Hero's "muddy blur" criticism is
precisely what happens to small similar glyphs without labels. It also matches the
portrait convention (§3.5): every one of those games puts a label under the icon.

Price is **not** printed on the disc; it lives in the ring and the panel. Twelve
printed prices reintroduce the wall of text at 40% of the size. (§6.7 names the
counter-evidence.)

Keep the existing `FAMILY` colour map unchanged, with **one change: owned nodes
light in their family colour, not gold.** Gold is the currency and the
affordability signal. If owned is also gold, a fully-purchased tree collapses into
one undifferentiated gold blob exactly when the player has most invested in it.

### 4.4 State, without labels

Five states. Each is distinguished by **ring geometry as well as colour**, so it
survives colour-blindness and a dim phone:

| State | Disc | Ring / rim | Glyph | Incoming edge |
|---|---|---|---|---|
| **locked** (prereq missing) | near-black fill | **dotted rim** | 18% alpha, silhouette only | **dashed**, 25% alpha |
| **saving up** (reachable, unaffordable) | dark fill, dim rim | **gold arc from 12 o'clock, swept `stars/price`** | 55% alpha | solid family colour, 40% |
| **affordable** | dark fill, 2px family rim | **complete bright ring** | family colour, full | solid 1.5px family colour |
| **owned** | filled, family colour | thin bright ring | knocked out dark | solid 2px family colour |
| **owned but held** (a dependent owns it) | as owned | as owned | as owned | **outgoing** edges drawn bright |

The **affordability arc** is the important one and it is nearly free in Canvas 2D
(`ctx.arc` with an end angle). It turns every unaffordable node into a live gauge
against your current bank: enter with 95 stars and `slots4` reads as a nearly-full
ring, `golemKeep2` as a thin slice. No arithmetic, no `30 SHORT` string, twelve
simultaneous readings.

Precedent and evidence that this is the right gap to close:

- Dead Cells' Boss Cell doors "show the number of Boss Stem Cells required to enter
  and will shine blue if enough are currently active"
  ([wiki](https://deadcells.wiki.gg/wiki/Boss_Stem_Cells)) — requirement *and*
  satisfaction on the same object.
- A Last Epoch player names the exact failure it fixes: "It wasnt very clear how
  many points away from a new passive tier i was"
  ([forum](https://forum.lastepoch.com/t/passive-trees/11006)).
- Last Epoch's own answer is a per-tree progression bar
  ([Maxroll](https://maxroll.gg/last-epoch/resources/passives-and-skills)); putting
  it per-node is strictly more informative on a screen this small.

The fifth state exists because this game's refund rule is leaves-only. Last Epoch's
constrained respec forces the same fourth-state problem — the screen must render
"this cannot be removed because something downstream needs it". Recommendation: **no
extra chrome on the node.** An owned node whose outgoing edges are lit is visibly
load-bearing, and the panel's dimmed `SELL` plus the existing refusal copy ("Sell
Deep Belt first — it needs Ingredient Belt.") carries the rest. Adding a sixth
visual state to save one sentence is a bad trade.

**Motion budget: exactly two moving things.** Affordable nodes breathe (a halo,
~1.4s). The pinned route carries one travelling spark. Nothing else moves — because
glow-as-state fails the moment glow is decoration (§2.1C). `TreeScreen` needs an
`update(dt)` hook, which it currently lacks; `Hud.update(dt)` is the pattern.

**The not-live band.** Seven of twelve nodes are bought-but-inert pending a later
phase, costing a 29px band per card today. Replace with a small **hollow ring pip**
at the disc's 4 o'clock — reusing the existing `drawBand` idiom, deliberately
chosen as "a date, not a warning" — plus one line in the panel. Saves ~175px and
de-noises the sky.

### 4.5 Detail on demand: one docked panel

Tap a node → it becomes **selected** (a bracket around the disc) and the docked
panel fills with: name in the existing 15px serif headline style, the one-line
`effect`, price against your bank, the missing prerequisite in words, the phase note
if not live, the `SELLING GIVES UP FIREBALL` warning if `atRisk` returns anything,
and **one primary button**.

Selection never buys. The button is the only commit, always in the same place:

| Selected state | Button |
|---|---|
| affordable | `BUY  ✦ 140` |
| saving up | `SAVE FOR THIS` |
| locked | `SAVE FOR THIS` (pins the whole route) |
| owned | `SELL  ✦ 140`, dimmed with the existing refusal copy when held |

This makes pinning a **visible button rather than a hidden long-press**, which
matters: the gesture would otherwise be undiscoverable.

Idle state (nothing selected) is not wasted — it shows the **pinned goal and its
progress**. So the layout never reflows: a fixed 130px panel, always present,
always meaningful. This is Shneiderman's mantra applied literally — "Overview
first, zoom and filter, then details-on-demand", from *The Eyes Have It*, IEEE
Symposium on Visual Languages 1996, whose seven data types explicitly include
**tree** and **network**
([PDF](https://hci.stanford.edu/courses/cs448b/papers/shneiderman96eyes.pdf),
[infovis-wiki](https://infovis-wiki.net/wiki/Visual_Information-Seeking_Mantra)).

Deliberately a **docked panel, not a bottom sheet.** NN/g's bottom-sheet guidance
says not to use a sheet for long or always-needed content, warns that vertical
swipe-to-dismiss suffers gesture ambiguity, and insists on a visible close
affordance rather than a grab handle
([NN/g](https://www.nngroup.com/articles/bottom-sheet/)). Always-needed content
should be permanent chrome. Also note the honest cost of progressive disclosure:
NN/g's own research finds an extra tap sometimes helps and sometimes just buries
useful information
([report](https://media.nngroup.com/media/reports/free/Mobile_Intranets_and_Enterprise_Apps.pdf)).
§6.2 addresses that.

Keep the `say()` refusal channel — "the tree teaches its own shape by being asked
and answering" is a good instinct — but render refusals in the panel rather than
the footer, where the eye already is.

Add a small **`REFUND`** affordance in the header. Every game in §2.1E makes the
refund prominent; Vampire Survivors puts an "enormous" one at the top. Today it is
one dim pill per owned card, buried mid-scroll.

### 4.6 The route: how a player saves up

This is the answer to "how do you show a path to something you cannot afford", and
it is the feature most likely to make the screen loved rather than merely tidy.

`SAVE FOR THIS` pins a node. Then:

- Every edge from your owned frontier to the goal renders as a **brighter solid
  path** with one spark travelling along it.
- Each node on the route wears a **small numeral** (1, 2, 3) — the purchase order.
- The panel shows `ROUTE · 3 NODES · ✦ 320 TOTAL · ✦ 130 SHORT`, with a bar.
- Off-route nodes dim slightly — enough that the route is figure and the rest is
  ground, not enough to hide them.

Two extras worth the effort:

1. **Persist the pin and show it during the run** next to the star counter as
   `✦ 190 / 320`. That moves the goal out of the menu and into the run, where the
   motivation to bank stars actually lives.
2. On entering with enough for the next route step, **that** node is the one that
   breathes. The screen answers "what now" before being asked.

The evidence here is unusually strong, and it is not what I first assumed.
Shortest-path highlighting in Path of Exile **is not in the game client** — it is a
pair of checkboxes ("Highlight similar skills", "Highlight shortest paths") on the
*official web planner*
([pathofexile.com](https://www.pathofexile.com/passive-skill-tree)), plus Path of
Building's `Shift` path-trace mode
([PoB help](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/dev/help.txt)).
A PoE2 feedback thread asking for it natively puts the argument better than I could:

> "The tree is massive, and sometimes you lose a lot of time thinking about the
> next steps… If players have to frequently refer to outside tools to better use a
> core function of the game, that's arguably a user experience fail."
> — [PoE forum](https://www.pathofexile.com/forum/view-thread/3651997)

GGG's eventual answer in patch 0.5 was an importable build file that "highlights
routes through the passive skill tree"
([PCGamesN](https://www.pcgamesn.com/path-of-exile-2/patch-notes-return-of-the-ancients)).
So the thing players beg for, third-party tools provide, and the developer
eventually ships is exactly this feature. **A 12–25 node tree can ship the good
part natively, in the base UI, on day one.** That is a real competitive advantage
and it costs perhaps 80 lines.

Note also what search *cannot* do, since it is the obvious alternative: PoE2's
passive filter is a highlight, not a locator — matches get "a faint glow… every
half second", spelling must be exact, and the recommended workflow is to zoom out
first because it is "difficult to see while moving"
([GameRant](https://gamerant.com/path-of-exile-2-poe2-how-use-passive-skill-filter/)).
It substitutes for recall, never for a route. At twelve nodes, search is
unnecessary; a route is not.

### 4.7 Navigation, exhaustively

- **Vertical drag** to scroll, only when content exceeds the body. Keep the
  existing 10px tap-vs-drag threshold from `main.ts`, and keep the edge fades
  (§3.3, illusion of completeness).
- **No pinch, no 2D pan, no zoom.** §3.3.
- **Tap a node** → select. **Tap the panel button** → commit. **Tap empty sky** →
  deselect, panel returns to the pinned-goal idle state.
- Keep the wheel and arrow-key handlers, and keep the harness contract intact:
  `controls()`, `reveal(id)`, `scrollBy()`, `hit(x,y)`, `message`. `controls()`
  should now report node cells and the panel button, with
  `kind: 'select' | 'buy' | 'sell' | 'pin' | 'start'`. Nothing outside `main.ts`
  consumes these yet, so the contract can be widened cheaply — but widen it
  deliberately, because it is the only scripted way to drive this screen.

### 4.8 How it scales to ~25

25 nodes, assuming the roadmap extends existing chains and adds one or two roots:
~8 tiers, average 3.1 wide, peak 5. Content = `8 * 76 + 64 = 672px` in a 578px body
→ **1.15 screens**, one flick, comfortably inside Microsoft's ≤3-screen semantic
zoom budget and far inside node-link's density sweet spot.

The **5-column ceiling is the binding constraint**, not the node count. The lattice
holds `5 x rows` slots and reads well at roughly 50–60% occupancy, so
**5 columns x 10 rows ≈ 25–30 nodes is the graceful maximum.**

Beyond that, **split into tabbed skies by category rather than making one sky
bigger.** That is Last Epoch's answer — a base tree plus separate mastery trees,
chosen explicitly "to keep the passive system on a single screen without a massive
zoom" — and it is why their individual trees stay readable while the total is
large.

---

## 5. Why this fixes the screenshot, item by item

| In the screenshot | After |
|---|---|
| ~100–120px per node spent on prose; 1290–1350px of content, ~2 screens | ~76px per *tier*; ~380px of content, no scroll |
| 5–6 nodes visible, never a complete tier | all 12 nodes and all 5 tiers visible at once |
| four roots spread over ~700px; three affordable ones in the 17%-attention band | four roots side by side in one row, in the lower-middle |
| `NEEDS … FIRST` x8, `LOCKED` x8, phase band x7 | dashed edges, dotted rims, one hollow pip; words only for the selected node |
| depth = a 16px indent (4% of width) | depth = a row |
| `✦ 140 · 30 SHORT` read one card at a time | twelve affordability arcs read in one glance |
| the whole card is a buy target | tap selects; one docked button commits |
| nothing to save for | pinned route, purchase-order numerals, running total, visible during the run |
| `SELL` buried once per owned card | `REFUND` in the header, `SELL` in the panel |
| structure invisible until you own things | structure visible in the first frame |

---

## 6. Real downsides, named

**6.1 Twelve pictograms is real art work, and a bad glyph is worse than a word.**
Loop Hero's camp is the warning: small, similar, low-contrast icons become "a muddy
blur". Mitigations: nicknames under every disc from day one so the glyph never
carries the whole load; shape-by-kind (§4.3) so categories separate even when
glyphs don't; and a two-character monogram fallback (`H2`, `B6`) inside the same
disc for any node whose glyph isn't authored yet. The risk is real and the screen is
only as good as its worst glyph.

**6.2 You lose bulk reading.** A list lets a curious player read all twelve effects
in two flicks; the sky makes them tap twelve times, and NN/g is explicit that an
extra tap sometimes just buries useful information. This is a genuine regression for
a first-session player who wants to understand the economy before spending.
Mitigation: keep the existing card list behind a small `LIST` toggle in the header.
The code exists and deleting it throws away the one thing it is better at. That is
a concession with a maintenance cost, and it should be stated as one rather than
sold as a feature.

**6.3 The 5-column ceiling is hard.** It is set by tap targets at a 267px usable
width and cannot be negotiated by taste. Any future tier wider than five must wrap
across two rows.

**6.4 130px permanently spent on the panel** — 15% of the screen reserved for one
node's worth of text. Justified by the pinned-goal idle state and by never
reflowing, but it is a real cost.

**6.5 Hand-authored columns are a standing obligation.** Adding a node means
choosing its column, and choosing badly means a crossing edge. Ship a lint: assert
no two nodes share a `(tier, col)`, and warn on crossings. Cheap, and it converts a
design mistake into a build error — the same trick `FAMILY` already uses.

**6.6 A constellation of twelve may read as sparse rather than grand.** The look is
borrowed from games whose trees are enormous, and Cambridge Intelligence's
"snowstorm" failure — a graph too sparse to be interesting — is the specific risk.
The mitigation is *not* filler nodes or background stars. It is to let the sky be
small and dark and let the four constellations sit far apart with generous margins.
Still worth prototyping before committing.

**6.7 Removing printed prices may reduce engagement.** I recommend the arc over the
numeral, but Slay the Spire's team found the opposite in playtesting: they
"didn't want to present too many numbers… but they discovered through playtesters
that having the numbers available was more engaging". Cheap hedge: print the price
numeral inside the disc for the **selected** node and for **affordable** nodes only,
and leave the arc to do the work elsewhere. Worth testing rather than deciding from
first principles.

**6.8 This departs from portrait convention.** Every comparable portrait game uses
a 3-column icon grid or a flat list, and several deliberately deleted adjacency
altogether. If the edges turn out to matter less to players than the design doc
believes, the convention is the safer bet and this recommendation is over-built.
The counter-argument is in §3.5 and I think it holds — but it is an argument, not a
measurement.

---

## 7. What I could not verify

- **Reddit was unreachable throughout** (both `reddit.com` and `old.reddit.com`), so
  r/ArcheroGame, r/Survivorio, r/MagicSurvival and r/VampireSurvivors sentiment is
  absent from this brief. Steam thread bodies were also frequently blocked by
  content-warning interstitials, and TouchArcade, GameFAQs and Fandom returned
  403/402 to direct fetches (Fandom was reachable via a browser).
- **Game UI Database is a dead end for this problem.** Its Skill Tree category was
  enumerated: **every asset is 1920x1080**, i.e. PC/console, and none of the target
  portrait games appear in it. There is no portrait skill-tree reference set.
- **Archero 2's column count and node pixel size are unverified** — only the
  card/set-completion structure is confirmed.
- **Vampire Survivors' *mobile* PowerUp layout** (row list vs grid) is unverified. The
  refund behaviour, rank counts and cost formula are confirmed from the wiki; the
  portrait boot behaviour from TouchArcade.
- **Diablo Immortal is not a safe portrait precedent** and I have not treated it as
  one: nothing describes its Paragon node sizes, scroll model or zoom, and I could
  not confirm it supports portrait at all.
- **Apple's 44pt minimum is second-hand.** Apple's HIG page would not render for
  fetching. Google's 48dp is verified from Google's own page.
- **The Cockburn 2008 survey's internal effect sizes** (figures attributed to North
  & Shneiderman 2000 and Tan et al. 2001) could not be extracted from the PDF and
  are not cited above. The same is true of the original wording of Shneiderman
  1996 — the mantra and the 7x7 structure are confirmed via secondary sources.
- **"Chunky Chains" venue and year are unconfirmed**; the PDF carries LIPIcs
  template placeholders.
- **Two systems changed in 2026** beyond reliable verification: Diablo 4's cluster
  point-thresholds were replaced by level gating, and PoE2 0.5 shipped build-file
  import. Both are cited from secondary sources and should be re-checked before
  being quoted as design precedent.
- **No GDC talk exists on skill-tree layout or large node-graph legibility.** The
  nearest is Yang Zhang (NetEase), "UI Design from PC Game to Mobile Game", GDC
  China 2015 — "large and comprehensive to small and perfect"
  ([GDC Vault](https://www.gdcvault.com/play/1023725/UI-Design-from-Pc-Game)).
  Chris Wilson's GDC 2019 talk is about longevity, not the tree.
- **Last Epoch's dev blog: (a), (b) and (d) are verified quotes**, fetched directly.
  The claim that it names competitors' failure modes explicitly is *not* supported —
  the critique of PoE's "Massive Passive Web" and D3's "Pick 4" is implicit.
- **The "barely three nodes visible" premise is not literally right** — it is five to
  six. I kept the diagnosis and corrected the number, because the real defect
  (§1.1) is more damaging than the one named.

---

## 8. Sources

**Repo evidence**
- `docs/DESIGN.md` § Star tree; `Roadmap/Star_Tree.md`
- `src/meta/tree.ts` — 12 nodes, edges, provisional prices, the refund rule
- `src/ui/tree.ts` — the screen being replaced; `layout()` for card heights; `FAMILY`
- `src/ui/hud.ts` — `GOLD`, `PARCH`, `rr`, `wrapLines`, `hexCss`, `update(dt)`
- `src/core/engine.ts:296-310` — the aspect clamp, hence the 344/295 floors
- `src/main.ts` — drag threshold, harness API
- `_shots/tree/02-tree-nothing-owned.png`, `04-tree-scrolled.png`,
  `10-chain-owned.png`, `13-sell-costs-a-page.png`

**Thumb reach and tap targets**
- https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php
- https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/
- https://www.smashingmagazine.com/2023/04/accessible-tap-target-sizes-rage-taps-clicks/
- https://www.smashingmagazine.com/2020/02/design-mobile-apps-one-hand-usage/
- https://support.google.com/accessibility/android/answer/7101858
- https://m2.material.io/develop/web/supporting/touch-target
- https://dequeuniversity.com/rules/attest-ios/1.0/touch-target-size

**Graph navigation and small screens**
- https://dl.acm.org/doi/10.1145/1456650.1456652 (Cockburn et al. 2008)
- https://dl.acm.org/doi/abs/10.1145/586081.586086 (Hornbæk et al. 2002)
- https://www.researchgate.net/publication/2806120_Critical_Zones_in_Desert_Fog_Aids_to_Multiscale_Navigation
- https://pubmed.ncbi.nlm.nih.gov/17080806/ (Büring et al. 2006)
- https://link.springer.com/article/10.1007/s11432-013-4868-8 (fisheye targeting)
- https://learn.microsoft.com/en-us/windows/apps/design/controls/semantic-zoom
- https://arxiv.org/abs/2607.06029 (Chunky Chains)
- https://arxiv.org/pdf/1404.1911 · https://arxiv.org/pdf/2003.14274 (node-link readability)
- https://arxiv.org/pdf/2604.23299 (desktop→mobile adaptation)
- https://cambridge-intelligence.com/blog/designing-intuitive-data-experiences-with-graph-visualizations/
- https://www.fullstory.com/blog/pinch-to-zoom/ · https://baymard.com/blog/mobile-image-gestures

**Attention, memory, disclosure**
- https://www.nngroup.com/articles/spatial-memory/
- https://www.nngroup.com/articles/scrolling-and-attention/
- https://www.nngroup.com/articles/illusion-of-completeness/
- https://www.nngroup.com/articles/bottom-sheet/
- https://www.nngroup.com/articles/progressive-disclosure/
- https://www.nngroup.com/articles/information-scent/
- https://hci.stanford.edu/courses/cs448b/papers/shneiderman96eyes.pdf
- https://infovis-wiki.net/wiki/Visual_Information-Seeking_Mantra
- https://uxdesign.cc/best-practices-for-horizontal-lists-in-mobile-21480b9b73e5

**Developer material**
- https://forum.lastepoch.com/t/passive-skill-systems/1270 (EHG — the keystone source)
- https://forum.lastepoch.com/t/making-last-epoch-skill-design/78179
- https://news.blizzard.com/en-us/diablo4/23529210/ (node shapes, 30–40% target)
- https://gamepedia.com/blogs/2050-interview-chris-wilson-on-path-of-exile-2s-origins
- https://www.pcgamesn.com/path-of-exile-2/patch-notes-return-of-the-ancients
- https://maintainersanonymous.com/games/ (Giovannetti on Ascension)
- https://www.gdcvault.com/play/1023725/UI-Design-from-Pc-Game

**Path preview, search, respec**
- https://www.pathofexile.com/passive-skill-tree (official planner: "Highlight shortest paths")
- https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/dev/help.txt
- https://www.pathofexile.com/forum/view-thread/3651997 ("arguably a user experience fail")
- https://gamerant.com/path-of-exile-2-poe2-how-use-passive-skill-filter/
- https://maxroll.gg/last-epoch/resources/passives-and-skills · https://maxroll.gg/last-epoch/resources/respec-guide
- https://maxroll.gg/poe/getting-started/passive-skill-tree-for-beginners
- https://deadcells.wiki.gg/wiki/Boss_Stem_Cells
- https://www.siliconera.com/how-to-reset-progress-in-vampire-survivors/
- https://www.gameskinny.com/tips/how-to-reset-the-mirror-of-night-in-hades/

**Portrait mobile meta screens**
- https://progameguides.com/mobile/archero-talents-list-all-currently-available-talents/
- https://archero-2.game-vault.net/wiki/Talent_Cards
- https://www.mrguider.org/strategy/survivor-io-tech-parts-tier-list/
- https://www.bluestacks.com/blog/game-guides/survivor-io/sio-beginner-guide-en.html
- https://magic-survival-rpg.fandom.com/wiki/Research
- https://www.talkandroid.com/18898-magic-survival-walkthrough-guide-tips/
- https://vampire.survivors.wiki/w/PowerUp
- https://toucharcade.com/2022/12/09/vampire-survivors-mobile-review-controller-cloud-save-sync-dlc-unlock-iphone-ipad-pro/
- https://toucharcade.com/2023/04/04/brotato-iphone-ipad-android-review/
- https://antinomy.me/posts/roguelike-mobile-game-2025/
- https://soul-knight-prequel.fandom.com/wiki/Archer
- https://otherworld-legends.fandom.com/wiki/Power_of_Asura
- https://www.gameuidatabase.com/index.php?scrn=64 (enumerated; all 1920x1080)

**Criticism and counter-position**
- https://forums.elderscrollsonline.com/en/discussion/559378/pts-update-29-feedback-thread-for-champion-point-system
- https://forums.elderscrollsonline.com/en/discussion/173555/champion-point-interface-issues
- https://www.mmorpg.com/editorials/elder-scrolls-online-champion-point-20-deep-dive-2000120951
- https://www.gamesas.com/what-skyrim-needs-perk-menu-overhaul-t361793.html
- https://steamcommunity.com/app/72850/discussions/0/217691032439209384
- https://forum.lastepoch.com/t/passive-trees/11006
- https://steamcommunity.com/app/2067920/discussions/0/597399326497483232/
- https://www.thegamer.com/loop-hero-review/
- https://www.pathofexile.com/forum/view-thread/3642574 (glow ambiguity)
- https://www.resetera.com/threads/im-starting-to-feel-that-stat-based-meta-progression-is-starting-to-ruin-roguelites-generally-speaking.1509337/page-2
- https://steamcommunity.com/app/1145350/discussions/0/4358999171576511867/?ctp=2
- https://us.forums.blizzard.com/en/wow/t/are-the-talent-trees-really-just-an-illusion-of-choice/1906072
- https://gamedesigning.org/learn/skill-trees/
- https://www.thegamer.com/best-skill-tree-designs-in-video-games/
- https://www.thegamer.com/hades-mirror-of-night-roguelite-progression/
- https://jboger.substack.com/p/the-secret-sauce-of-vampire-survivors
- https://saltandsanctuary.wiki.fextralife.com/Tree+of+Skill
- https://steamcommunity.com/sharedfiles/filedetails/?id=692393175
- https://en.wikipedia.org/wiki/Slay_the_Spire
