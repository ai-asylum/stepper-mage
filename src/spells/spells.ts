/**
 * The spell system, adapted from ai-asylum/spellbook's data model.
 *
 * What carries over unchanged, because it is the good part:
 *  - Pages are DATA (`SpellDef`); fusions are authored identities (`COMBOS`)
 *    keyed on the DISTINCT SET of selected pages.
 *  - Unauthored sets never fall back to a default. `resolveCast` composes them
 *    systematically — modifiers peel off as forms, elements fold in as extra
 *    statuses — so a handful of authored rows covers hundreds of combinations.
 *  - Duplicates never re-identify a cast, they EMPOWER it (Greater/Mighty).
 *
 * What is new here, and what makes this a dungeon game rather than a lane duel:
 *  - **The target is an ingredient.** `resolveCast` takes the target's kind. An
 *    `animate` page aimed at a bookshelf produces a BOOK GOLEM; the vessel takes
 *    its body from the object, and any element pages in the set infuse it. In
 *    spellbook the vessel's identity came from the spell set alone; here the room
 *    supplies it, which is why every prop is a spell component.
 */

/**
 * What a component DOES to a cast, which for an ingredient is its whole identity.
 *
 * `animate` and `raise` are two roles and not one because `docs/DESIGN.md` makes
 * them two ingredients: object animation works on turn one because every room has
 * props, corpse raising needs a kill first. They differ only in what they may be
 * aimed at, so the role is the difference — and `tempo` is the odd one out, the
 * role for an ingredient that changes what the cast COSTS and nothing about what it
 * is (TimeSand). A tempo component contributes no damage, no status and no element.
 *
 * DEAD as of the cast = 1 turn rebase: components are free, so there is no
 * per-component cost for a tempo component to change and TimeSand does nothing at
 * all. The role is kept rather than deleted because it is the seam any future
 * ingredient that touches the turn economy would use, and because deciding what the
 * sand becomes instead is the designer's call — see its entry below.
 */
export type SpellRole = 'bolt' | 'modifier' | 'animate' | 'raise' | 'tempo';
export type StatusId =
  | 'burning' | 'frozen' | 'soaked' | 'shocked' | 'decay' | 'stagger' | 'oiled'
  /**
   * ROOTED — held where it stands. Costs the MOVE and never the action.
   *
   * Plant had no status at all: it dealt 4 and left terrain, on the argument that
   * everything it is worth is on the floor. That argument only holds if the floor
   * does something the round you cast it, and it did not — the seed took three
   * rounds to harden, so casting Seed at a body meant watching that body walk away
   * and reach you before its own spell existed. A cast has to do its job on the turn
   * you spend it; the growth is what it leaves behind afterwards.
   *
   * Not in `DENIAL_STATUSES`, deliberately. A rooted body still swings at whatever is
   * beside it — being held is not being helpless, and a status that took the action
   * as well would be Frozen wearing leaves.
   */
  | 'rooted';
export type Element =
  | 'fire' | 'frost' | 'spark' | 'gust' | 'rot' | 'plant'
  | 'stone' | 'water' | 'oil' | 'starlight'
  | 'none';

/**
 * The elements that FILL SPACE rather than reaching a distance.
 *
 * A radius is a point effect that reaches some way. A volume flows into every tile
 * it can walk to, wraps corners, pours down hallways, and is dangerous to whoever
 * stands in it — the player included. Neither crosses a wall; that is the whole
 * rule and the only rule (`Roadmap/Spell_Reach.md`).
 *
 * Fire is a volume because it is the most generally useful element in the game and
 * had no cost at the moment of casting; being able to reach back down the hallway
 * you are standing in is that cost. Gust is a volume because it has to be able to
 * reach round a corner to put a fire out, and two things that behave the same way
 * about corners are a loop rather than two rows in a table.
 *
 * Everything else is a radius, and deliberately: if everything wrapped there would
 * be no distinction worth having.
 */
/*
 * Water and oil are volumes too, and were the conspicuous hole in this set: both are
 * substances the floor can hold, both have a full row in `pour`, and neither could
 * ever cover more than the single tile it landed on because `isVolume` said no. A
 * liquid that does not spread is not a liquid.
 */
export const VOLUME_ELEMENTS: ReadonlySet<Element> = new Set<Element>(
  ['fire', 'gust', 'frost', 'plant', 'water', 'oil'],
);

/**
 * Volume elements that fill LESS than the rest — see `FROST_VOLUME_TILES`.
 *
 * Frost is a volume so that a cast lays ice over an area rather than one tile, which
 * is what makes freezing a burning room into a floor you can use a real play. It is
 * NOT the same size as fire, because a fireball and a frost patch doing the same
 * thing at different temperatures is two pages doing one job.
 */
/**
 * Plant is small for a harder reason than frost: it is the one volume that GROWS
 * after it lands. Every tile a seed cast fills is its own seed and creeps a ring of
 * its own, so the cast's footprint is not what the room ends up holding — it is the
 * seed of what the room ends up holding, and at 25 tiles that compounded into most
 * of a dungeon in about three casts. The other lever is `Ground.sow`, which now
 * spends most of the growth budget up front; this is the one that stops the budget
 * being multiplied by an area in the first place.
 */
/*
 * The liquids join frost at the small table rather than fire's. A puddle you can
 * conduct through or slip a fire along is terrain the player wants to stand near,
 * which is exactly the argument frost already makes here — and a 25-tile oil slick
 * is a room-ending accident rather than a play.
 */
const SMALL_VOLUME: ReadonlySet<Element> = new Set<Element>(['frost', 'plant', 'water', 'oil']);

/**
 * The elements that LEAVE SOMETHING ON THE FLOOR, in the order a cast holding
 * several of them resolves.
 *
 * Fire first because it is the one that reacts with the rest; gust before the
 * liquids because a cast that both clears and pours is a cast that clears. A tile
 * holds one substance, so a cast has to leave one thing, and this list is where that
 * is decided rather than in whichever `if` happened to be written first.
 */
// Plant last: anything that burns, blows or pours beats a seed, so a cast holding
// both leaves the louder thing and the bramble never quietly overrides a fire.
export const GROUND_ELEMENTS: readonly Element[] = ['fire', 'gust', 'oil', 'water', 'frost', 'plant'];

/**
 * WHAT TWO ELEMENTS MAKE OF THE FLOOR, which beats the priority list above.
 *
 * `GROUND_ELEMENTS` answers "which of the things I am holding wins", and that is the
 * wrong question whenever the two things together are a THIRD thing. Fire and frost
 * do not leave a choice between burning and ice — they leave a wet floor, and until
 * now fire simply won because it is first in the list. The pairs here are the ones
 * where the combination is more interesting than either half:
 *
 *  - **fire + frost: water.** Steam Burst wets the room instead of lighting it.
 *  - **plant + rot: oil.** Decay renders a thicket down into something that burns —
 *    the one route to oil that does not need a barrel.
 *  - **spark + oil: fire.** A charge into a slick is the obvious ignition, and it was
 *    the conspicuous missing row: spark carried no ground at all, so casting it into
 *    oil consumed the slick and left nothing.
 *
 * THE GROUND COUNTS AS AN INGREDIENT. `Combat` asks this with the substance already
 * on the tile folded in, so aiming Decay at bramble is `plant + rot` exactly as
 * holding both pages is — which is what makes these reactions something you set up
 * on the floor rather than something you have to draw in one hand.
 */
const REACTION_PAIRS: readonly (readonly [Element, Element, Element])[] = [
  ['fire', 'frost', 'water'],
  ['plant', 'rot', 'oil'],
  ['spark', 'oil', 'fire'],
  /*
   * Frost into water is ICE, and it is here rather than left to the priority list
   * because of the page count. `FEEDS` already says frost does not feed water, it
   * freezes it — but "freeze" resolved through the fallback is a POUR, so the
   * two-page gate ate it and a single Frost into a puddle left bare floor. As a
   * reaction it is exempt, which is the only version where the comment in `FEEDS` is
   * true of the game.
   */
  ['frost', 'water', 'frost'],
  /*
   * Gust and stone bring the room DOWN — Earthquake makes debris, it does not tidy
   * up. It is a pair rather than a priority entry because gust otherwise wins
   * outright, and "the eraser" is the wrong reading of a spell that shakes masonry
   * loose. Rubble is the one surface the player can already delete (a gust sweeps
   * it), so this closes that loop: stone is the pen, gust is the eraser.
   */
  ['gust', 'stone', 'stone'],
  /*
   * Fire beats gust, stated here rather than left to the priority list now that the
   * reactions are consulted first. A cast holding both ignites rather than sweeps,
   * and `volumeTiles` prices its shift on exactly that reading.
   */
  ['gust', 'fire', 'fire'],
  /*
   * A blizzard leaves the room ICED, not merely swept. Whiteout is the frost-and-gust
   * spell and it was clearing for the same reason Earthquake was: gust won by default.
   * Laying ice still puts a fire out — `pour` gives the tile to the newcomer — so the
   * eraser half of the cast is not lost, it is simply expressed as a floor you can
   * then conduct through or slip on.
   */
  ['gust', 'frost', 'frost'],
];

/**
 * What this cast leaves on the floor: the reaction if it made one, else the first
 * ground element it holds.
 *
 * Gust is checked before the reactions, not after. It is the eraser and it outranks
 * everything — the same claim `groundUse` already makes — and a gust that swept the
 * room and then poured water into it would be two answers to one question.
 */
export function groundLeaves(elements: readonly Element[]): Element | null {
  /*
   * REACTIONS FIRST, then gust, then the priority list.
   *
   * Gust used to short-circuit ahead of everything, which made it impossible for a
   * pair to say what gust plus something else becomes — and that is exactly what
   * Earthquake is. The two cases gust used to win outright are now rows in the table
   * (`gust + fire` ignites, `gust + stone` brings debris down), so the short-circuit
   * below only catches the casts where gust really is acting alone as the eraser.
   */
  return groundReaction(elements)
    ?? (elements.includes('gust') ? 'gust' : null)
    ?? GROUND_ELEMENTS.find((el) => elements.includes(el))
    ?? null;
}

/**
 * The reaction alone, with no fallback — "did these two make a third thing".
 *
 * Separate from `groundLeaves` because `Combat` has to ask a second question the
 * priority list cannot answer: whether the floor changed because of a REACTION or
 * merely because the cast poured something. A reaction is exempt from
 * `GROUND_MIN_PAGES` — one page of Decay into a thicket transmutes ground that was
 * already there rather than creating any, and gating it would have made the whole
 * table unreachable at hand size one.
 */
export function groundReaction(elements: readonly Element[]): Element | null {
  for (const [a, b, out] of REACTION_PAIRS) {
    if (elements.includes(a) && elements.includes(b)) return out;
  }
  return null;
}

/** Does this cast fill space, rather than reach a distance? */
export function isVolume(elements: readonly Element[]): boolean {
  return elements.some((e) => VOLUME_ELEMENTS.has(e));
}

/**
 * How many PAGES a cast must hold before it lays anything on the floor at all.
 *
 * A single page leaves the floor exactly as it found it — no fire, no ice, no
 * bramble, no puddle. Ground is the most expensive thing in this game to be wrong
 * about: it outlives the turn that made it, it stands between the player and where
 * they were going, and the correct play against it is usually to WAIT, which is the
 * one thing a player learning the game will not do. They walk through it and take
 * the damage, and the lesson they draw is that the spell they cast hurt them.
 *
 * So it is not on the first spell anybody casts. It arrives at two pages, by which
 * point the player is choosing to combine things and is ready to own the result.
 */
export const GROUND_MIN_PAGES = 2;

/**
 * How many TILES a volume fills, by empowerment step.
 *
 * A budget of tiles rather than a radius, because a radius is a number nobody can
 * picture and a tile count is one you can see on the floor and read: 1 is the tile
 * it lands on, 9 is that tile and the ring around it, 25 is the ring after that.
 *
 * READ ONE RUNG LOW — see `GROUND_TIER_SHIFT`. The ladder is written as the shape it
 * has always been, and the whole thing is entered a step later than it used to be.
 */
/*
 * ONE, THREE, FIVE — and the old ladder was 1, 9, 25.
 *
 * That is a NINEFOLD jump across two rungs, on a step the player buys by adding a
 * single page. It read as three settings — nothing, a corner of the room, the room —
 * with no rung in between where a volume is a thing you place. Squares of an expanding
 * radius were the wrong unit: `Grid.fill` spends a tile BUDGET, so the count can be
 * any number and does not have to be a ring.
 *
 * Now every step adds two tiles. Three is the tile and its neighbours down a hallway,
 * five is a small pool you can walk around, and the top rung is a hazard rather than a
 * room-deleter. Volumes also compound — fire spreads on fuel, bramble creeps, growth
 * feeds a patch by a whole ring — so the cast's own footprint was never the number
 * that mattered most.
 */
export const VOLUME_TILES = [1, 3, 5] as const;

/**
 * The whole ground ladder, moved one page later.
 *
 * `GROUND_MIN_PAGES` alone would have deleted the bottom rung rather than moved it:
 * a two-page cast would have jumped straight to the nine-tile pour that two pages
 * buys today, so the first ground a player ever makes would be the big one. Shifting
 * instead of gating keeps the shape of the progression — small, then large, then
 * frightening — and simply starts it a page further in. What one page used to lay,
 * two pages lays; what two laid, three lays.
 */
const GROUND_TIER_SHIFT = 1;

/**
 * The same ladder, one rung short, for the small volumes.
 *
 * Frost tops out where fire STARTS being frightening. A frost patch is terrain the
 * player wants to stand near — it is the floor they made to walk on, or to conduct
 * through — so it must not routinely swallow the tile they are standing on the way
 * a late Inferno is supposed to.
 */
export const FROST_VOLUME_TILES = [1, 2, 3] as const;

/** Which tile budget this set of elements spends. */
/**
 * How much a cast's VARIETY is worth on the ladder — one rung per extra element.
 *
 * The step used to be `extraBolt` alone, which counts duplicates and nothing else, and
 * that had a consequence nobody chose: a combo — three different pages, the most
 * expensive and most interesting hand in the game — sat on the bottom rung with the
 * one-pagers, while three copies of the same page climbed to the top. Of 199 spells,
 * exactly three laid more than a single tile, and all three were the same page thrice.
 *
 * Variety pays the same rung repetition does, so a three-page combo reaches the middle
 * of the ladder. Deliberately `distinct - 1` and not `distinct`: two different pages
 * must still come out at one tile, because `GROUND_TIER_SHIFT` is what keeps the first
 * ground a player makes small and a two-page cast is where most players live.
 */
function varietyStep(elements: readonly Element[]): number {
  return new Set(elements).size - 1;
}

function volumeTiles(elements: readonly Element[], step: number): number {
  // A cast holding fire OR gust is a full volume even if it also holds frost: the
  // bigger of the two shapes wins, so a Whiteout covers ground and not a doormat.
  const small = elements.some((e) => SMALL_VOLUME.has(e))
    && !elements.some((e) => VOLUME_ELEMENTS.has(e) && !SMALL_VOLUME.has(e));
  const table = small ? FROST_VOLUME_TILES : VOLUME_TILES;
  /**
   * GUST IS EXEMPT FROM THE SHIFT, because the shift is about what a cast LAYS and
   * gust lays nothing — it is the eraser, and specifically the answer to ground that
   * is burning. Moving the ground ladder later while quietly halving the reach of the
   * one spell that cleans ground up would have made the exact complaint that started
   * this worse, not better: fire is hard to deal with early.
   *
   * Only when it will actually CLEAR, though. `Combat` picks what a cast leaves by
   * the order of `GROUND_ELEMENTS`, where fire comes first — so a cast holding both
   * gust and fire ignites rather than sweeps, and takes the shift like any other fire.
   */
  // Asked of `groundLeaves` rather than restated, because "does this cast clear" and
  // "what does this cast leave" are the same question and they have twice now drifted
  // apart: a gust cast that ignites, or ices, or brings debris down is not an eraser
  // and must take the shift like anything else that puts something on the floor.
  const clears = groundLeaves(elements) === 'gust';
  const shift = clears ? 0 : GROUND_TIER_SHIFT;
  // Clamped at BOTH ends. The shift can push the index below zero — two different
  // pages still empower nothing — and that floor is the bottom rung, not an absence:
  // whether a cast lays ground at all is `GROUND_MIN_PAGES`, asked where the page
  // count is known.
  const rung = step + varietyStep(elements) - shift;
  return table[Math.max(0, Math.min(rung, table.length - 1))];
}

/** A non-volume cast fills the tile it lands on and no more. */
export const POINT_VOLUME = 1;

/**
 * Where a component comes from — `docs/DESIGN.md`'s three sources, as a type.
 *
 * Non-overlap between the sources is the design's load-bearing rule, so it is
 * worth being a field rather than three exported id lists that can drift. It is
 * also the ONLY thing that separates a page element from a harvested one: they
 * are both elements, both castable, and one of them has a rank.
 */
export type SpellSource = 'page' | 'fixture' | 'belt';

export interface SpellDef {
  id: string;
  /**
   * What the page is called at RANK 1 — always `ladder[0]` where there is a ladder.
   *
   * Kept as a plain field rather than derived, because everything that names a
   * spell without knowing a rank reads this: the tree, a refusal message, a
   * fixture that has no rank to know about.
   */
  name: string;
  /**
   * What this element is called at rank 1, 2 and 3.
   *
   * A page's name IS its rank — a Flame you have deepened once is not a stronger
   * Flame, it is a Fireball — so the ladder is authored per element rather than
   * assembled from a `Greater`/`Mighty` prefix. The prefix still exists and still
   * does its job on FUSIONS (`resolveCast`), which is where an adjective is the
   * honest answer: there is no third word for a Steam Burst cast twice as hard.
   *
   * Exactly `MAX_RANK` entries. Only page elements carry one — a fixture is
   * always rank 1 and a harvested Flame is a Flame however many candles are lit.
   */
  ladder?: readonly [string, string, string];
  glyph: string;
  role: SpellRole;
  /**
   * Elements are the castable roots: every cast must contain at least one.
   * Ingredients shape a cast but can never be one, and they come off the belt
   * instead.
   *
   * This is a property of the spell rather than a list of ids on purpose —
   * Stone, Water, Oil and Starlight are sourced from room fixtures and never get
   * a page, so "is an element" cannot mean "is in the book". `source` is what
   * answers that second question.
   */
  kind: 'element' | 'ingredient';
  source: SpellSource;
  element: Element;
  cost: number;
  /** Page tint, used for the sigil, the shout and damage numbers. */
  colour: number;
  /** One line on the page — must fit two short lines of UI text. */
  effect: string;
  flavor: string;
}

/**
 * Every spell in the game. The five PAGE elements are the book — a run starts
 * with a few and altars grant the rest. The five FIXTURE elements are harvested
 * out of the room and have no page anywhere, ever. The ingredients have no page
 * either; they are belt items, kept here because `COMBOS` and `resolveCast`
 * consume everything by id.
 *
 * Pages come first, and that ordering is load-bearing: `ROOT_ID` resolves an
 * element to the spell whose `COMBOS` rows it uses, first declaration winning, so
 * harvested fire lands on the Fireball rows rather than on a second set of its own.
 */
export const SPELLS: SpellDef[] = [
  {
    id: 'fire', name: 'Flame', glyph: '🔥', role: 'bolt', kind: 'element', source: 'page', element: 'fire', cost: 2,
    ladder: ['Flame', 'Fireball', 'Inferno'],
    colour: 0xff7a2b, effect: 'A blazing orb. Sets the target burning.',
    flavor: '"The first spell anyone learns, and the last one they need."',
  },
  {
    id: 'frost', name: 'Frost', glyph: '❄', role: 'bolt', kind: 'element', source: 'page', element: 'frost', cost: 2,
    ladder: ['Frost', 'Frostbolt', 'Blizzard'],
    colour: 0x7ad4ff, effect: 'An ice shard. Freezes the target solid.',
    flavor: '"Cold does not kill. It simply waits with you."',
  },
  {
    id: 'spark', name: 'Spark', glyph: '⚡', role: 'bolt', kind: 'element', source: 'page', element: 'spark', cost: 2,
    ladder: ['Spark', 'Thunderbolt', 'Thunderstorm'],
    colour: 0xffe14a, effect: 'A snapping arc. Conducts through water.',
    flavor: '"Wet things conduct. Remember that, or learn it."',
  },
  {
    id: 'gust', name: 'Gust', glyph: '💨', role: 'bolt', kind: 'element', source: 'page', element: 'gust', cost: 2,
    ladder: ['Gust', 'Gale', 'Cyclone'],
    colour: 0xa8f0d0, effect: 'Staggers the target and shoves it back a tile.',
    flavor: '"Every locked door is only as good as its hinges."',
  },
  {
    id: 'rot', name: 'Decay', glyph: '💀', role: 'bolt', kind: 'element', source: 'page', element: 'rot', cost: 2,
    ladder: ['Decay', 'Blight', 'Plague'],
    colour: 0x9de06a, effect: 'Rot that eats away over several turns.',
    flavor: '"Patience, rendered as a spell."',
  },
  /**
   * PLANT, and the reason it is not Decay wearing leaves.
   *
   * Rot is what happens TO A BODY and nothing else — the slowest damage in the book,
   * carried on the thing you cast it at. Plant is what happens to THE FLOOR: it is
   * the only substance that gets bigger without being fed, creeping a tile a round
   * toward whatever is nearby, and what it finally leaves behind is rubble you have
   * to clamber over. The two share a colour family and nothing else.
   *
   * Its damage is Gust's, and for the same reason: this is a page you cast at a
   * ROOM, not at a body. What it is worth is what the floor looks like three rounds
   * later, and a page that also killed things outright would never be cast for that.
   */
  {
    id: 'plant', name: 'Seed', glyph: '🌿', role: 'bolt', kind: 'element', source: 'page', element: 'plant', cost: 2,
    ladder: ['Seed', 'Thicket', 'Overgrowth'],
    colour: 0x4fbf7a, effect: 'Seeds the ground. It spreads, then hardens into briar.',
    flavor: '"Give it a room and a week. It will not need the week."',
  },

  /**
   * Harvested from room fixtures. No page, no rank, no altar ever offers one —
   * `ELEMENT_SPELLS` is the pool the book and the altar draw from and none of
   * these are in it. What each does is chosen so it is NOT a page's job:
   *
   *  - `flame` is the one honest overlap, because a lit candelabra plainly gives
   *    you fire. It resolves through the fire rows and is always rank 1, and it is
   *    named "Flame" for the same reason the rank-1 fire PAGE is: they are the same
   *    thing, and calling them two things would be the lie. What keeps the page
   *    worth owning is that a page climbs — a candle is a Flame for ever, and a
   *    Flame you have deepened is a Fireball.
   *  - `stone` is raw weight with no status at all — the only element that does
   *    damage and nothing else, and the four authored Stone fusions are the reason
   *    it exists.
   *  - `water` is the only rank-1 source of `soaked` in the game. Three of the
   *    five elemental interactions in `Combat.applyCast` needed a soaked body to
   *    exist first, and nothing at hand size 1 could make one.
   *  - `oil` deals almost nothing and doubles the fire that follows it.
   *  - `starlight` pierces: it is under the SHATTER threshold and breaks ice open
   *    anyway, which is the one thing no page can do at any weight.
   */
  {
    id: 'flame', name: 'Flame', glyph: '🕯', role: 'bolt', kind: 'element', source: 'fixture', element: 'fire', cost: 2,
    colour: 0xff7a2b, effect: 'Fire borrowed from the room. Never more than one.',
    flavor: '"A candle is a page someone else already tore."',
  },
  {
    id: 'stone', name: 'Stone', glyph: '🪨', role: 'bolt', kind: 'element', source: 'fixture', element: 'stone', cost: 2,
    colour: 0xa89880, effect: 'Dead weight. Heavy enough to break ice open.',
    flavor: '"No spell in the book is this stupid, or this reliable."',
  },
  {
    id: 'water', name: 'Water', glyph: '💧', role: 'bolt', kind: 'element', source: 'fixture', element: 'water', cost: 2,
    colour: 0x4e9fbf, effect: 'Barely hurts. Soaks the target for what comes next.',
    flavor: '"Water is not the spell. Water is the argument for the spell."',
  },
  {
    id: 'oil', name: 'Oil', glyph: '🛢', role: 'bolt', kind: 'element', source: 'fixture', element: 'oil', cost: 2,
    colour: 0xc79a3a, effect: 'Will not burn on its own. Doubles fire that follows.',
    flavor: '"Patient, like all good accidents."',
  },
  {
    id: 'starlight', name: 'Starlight', glyph: '✧', role: 'bolt', kind: 'element', source: 'fixture', element: 'starlight', cost: 2,
    colour: 0xdfe8ff, effect: 'Pierces. A frozen shell is no shell at all.',
    flavor: '"It was already old when the doors were hung."',
  },

  /**
   * The belt. Five ingredients, and every one of them SHAPES a cast — none supplies
   * an element and none supplies a status, which is the rule that keeps the belt from
   * becoming a second spellbook (`docs/DESIGN.md`, "Three sources, three questions").
   * `docs/DESIGN.md`'s "Rejected" table cut eight candidate ingredients for breaking
   * exactly that rule, so the note on each of these says which job it owns that no
   * page and no fixture has.
   *
   * `animate`'s NAME is `## Open — not decided` in the design doc. `animate` is a
   * working id describing the mechanic and nothing more; naming it is the designer's
   * call, and inventing a name here would be filling in that section by inference.
   */
  {
    // Owns: turning something in the room into a body on your side. No page and no
    // fixture produces an ally at all, so there is nothing to duplicate.
    id: 'animate', name: 'Animate', glyph: '💫', role: 'animate', kind: 'ingredient', source: 'belt', element: 'none', cost: 3,
    colour: 0xb98cff, effect: 'Wakes an object. It rises and fights for you.',
    flavor: '"Everything wants to stand up. Most things need asking."',
  },
  {
    /**
     * Owns: raising the dead. Deliberately a SECOND ingredient rather than a wider
     * Animate — object animation opens a fight because every room has props, and moss
     * snowballs one because it needs a kill first, so which you are holding changes
     * how you want to open a room.
     *
     * It has nothing to act on in this build, honestly: no entity in the game is a
     * corpse yet (Roadmap/Corpse_Raising_And_Golem_Persistence.md adds them), so
     * every moss cast is refused and says why. The seam is `CastTarget`'s `corpse`
     * kind, which exists here and is produced by nothing.
     */
    id: 'moss', name: 'Coffin Moss', glyph: '🌿', role: 'raise', kind: 'ingredient', source: 'belt', element: 'none', cost: 3,
    colour: 0x6f9a86, effect: 'Spread on the fallen. What died gets up again.',
    flavor: '"It grows best where the lid did not quite shut."',
  },
  {
    // Owns: scale. Growth was a PAGE and moving it to the belt is what made the
    // page/ingredient split airtight (`docs/DESIGN.md`, Rejected — "Shapers as
    // pages"), so a Growth page is the thing this must not be.
    id: 'grow', name: 'Growth', glyph: '🌱', role: 'modifier', kind: 'ingredient', source: 'belt', element: 'none', cost: 2,
    colour: 0x8ce06a, effect: 'Makes the cast bigger and harder hitting.',
    flavor: '"More is a kind of answer."',
  },
  {
    // Owns: target count. Mirrorleaf and Wolfsbane Thread were both cut for
    // duplicating THIS, so Multishot is the owner of the job rather than a copy of
    // one — and it is a spread, so it is worth three bodies and never three hits.
    id: 'split', name: 'Multishot', glyph: '✨', role: 'modifier', kind: 'ingredient', source: 'belt', element: 'none', cost: 3,
    colour: 0xffd9f0, effect: 'Splits the cast across three targets.',
    flavor: '"Why choose?"',
  },
  {
    /**
     * INERT. It owned the PRICE of a cast: taking it was free and it made this cast's
     * next two components free as well. Under cast = 1 turn every component is free
     * already, so there is nothing left for it to discount and holding it does
     * nothing but occupy a hand slot.
     *
     * Left in place rather than deleted, for two reasons and neither of them inertia.
     * The belt is switched off behind `BELT_ENABLED`, so nothing can draw one and no
     * player can be handed a dud; and what the sand should BECOME is a design
     * decision (`docs/DESIGN.md` still lists it in the belt table with its old job),
     * which cannot be filled in here by inference. What is not allowed is a
     * definition that keeps advertising a job it no longer has, so the effect line
     * says what is true.
     *
     * `cost: 0` is left alone: it is the mana-era field, every other ingredient
     * carries one, and nothing reads it.
     */
    id: 'sand', name: 'TimeSand', glyph: '⏳', role: 'tempo', kind: 'ingredient', source: 'belt', element: 'none', cost: 0,
    colour: 0xf0d79a, effect: 'Runs out without spending anything. It has no work left.',
    flavor: '"Borrowed from the hour you were going to need later."',
  },
];

export const SPELL_BY_ID: Record<string, SpellDef> = Object.fromEntries(
  SPELLS.map((s) => [s.id, s]),
);

/**
 * Element -> the spell id whose `COMBOS` rows that element resolves through.
 *
 * Harvested fire and the Fireball page share `element: 'fire'` on purpose — a
 * candelabra gives you fire, not a second kind of fire — so a fusion key is built
 * from the ELEMENT and both land on the same rows. First declaration wins, so the
 * page is the row owner and a fixture can never fork the table.
 */
const ROOT_ID: Partial<Record<Element, string>> = {};
for (const s of SPELLS) {
  if (s.kind === 'element' && !ROOT_ID[s.element]) ROOT_ID[s.element] = s.id;
}

/**
 * Element -> its name ladder, taken off whichever spell OWNS that element's rows.
 *
 * Built through `ROOT_ID` and not by scanning for a `ladder` field, so harvested
 * fire climbs the fire PAGE's ladder: a page Flame cast beside a candelabra's is
 * two fires, and two fires is a Fireball whichever hand they came from. That is
 * the same rule that already makes both resolve through one `COMBOS` row, and
 * doing it twice from one lookup is what stops the two from drifting apart.
 */
const LADDER: Partial<Record<Element, readonly [string, string, string]>> = {};
for (const [el, id] of Object.entries(ROOT_ID)) {
  const l = SPELL_BY_ID[id!]?.ladder;
  if (l) LADDER[el as Element] = l;
}

/**
 * What a page is called at a given rank.
 *
 * Clamped rather than validated: rank is read off run state and off saves, and a
 * name is not the place to discover that a number is out of range. An element with
 * no ladder — every fixture — is its own name at every rank, which is true, because
 * nothing the room hands you has one.
 */
export function rankName(id: string, rank: number): string {
  const def = SPELL_BY_ID[id];
  if (!def) return id;
  if (!def.ladder) return def.name;
  return def.ladder[Math.min(Math.max(Math.floor(rank) || 1, 1), def.ladder.length) - 1];
}

/**
 * The pages: what the grimoire holds and what altars may offer.
 *
 * Deliberately NOT every element. A harvested element is an element for casting
 * and nothing else — putting one in this list would put Stone in the book, offer
 * it at an altar and give it a rank, which is the exact thing `docs/DESIGN.md`
 * rejects ("**No Stone page exists.**").
 */
export const ELEMENT_SPELLS: SpellDef[] = SPELLS.filter(
  (s) => s.kind === 'element' && s.source === 'page',
);

/** Elements the ROOM supplies. No page, no rank, not storable. */
export const FIXTURE_SPELLS: SpellDef[] = SPELLS.filter(
  (s) => s.kind === 'element' && s.source === 'fixture',
);

/** Ingredients are belt items: they shape a cast but are never a cast. */
export const INGREDIENT_SPELLS: SpellDef[] = SPELLS.filter((s) => s.kind === 'ingredient');

/** Ids of the five, in belt order. The one list a drop roll and the strip share. */
export const INGREDIENT_IDS: string[] = INGREDIENT_SPELLS.map((s) => s.id);

/** Is this a belt item rather than something the book or the room supplies? */
export function isIngredient(id: string): boolean {
  return SPELL_BY_ID[id]?.kind === 'ingredient';
}

/**
 * Does this hand need an OBJECT to aim at?
 *
 * Asked of the role and not of the id, because the id is a working name that the
 * designer still owns (see the `animate` entry) — `isLegal` in `main.ts` used to
 * gate targeting on the literal string `'animate'`, which made a rename silently
 * break the reticle rather than fail the build.
 */
export function wantsObject(ids: string[]): boolean {
  return ids.some((id) => SPELL_BY_ID[id]?.role === 'animate');
}

/** Does this hand need a CORPSE to aim at? Nothing is one yet — see `moss`. */
export function wantsCorpse(ids: string[]): boolean {
  return ids.some((id) => SPELL_BY_ID[id]?.role === 'raise');
}

/*
 * `isFreeToTake` used to live here and answered "does taking this component skip its
 * turn", which was true of TimeSand and nothing else. Deleted rather than left
 * returning a constant: under cast = 1 turn EVERY component is free to take, so the
 * predicate no longer distinguishes anything and a helper that always agrees is a
 * rule nobody can find. The `tempo` role above is what survives of the idea.
 */

/** Can this be the root of a cast? True for harvested elements too. */
export function isElement(id: string): boolean {
  return SPELL_BY_ID[id]?.kind === 'element';
}

/** Is this an element the book can hold — i.e. one that has a rank? */
export function isPageElement(id: string): boolean {
  const s = SPELL_BY_ID[id];
  return s?.kind === 'element' && s.source === 'page';
}

/**
 * Is this an element that came off a fixture?
 *
 * `Combat.byRank` is the caller that matters. A harvest is always rank 1, and
 * this is how that is a rule rather than a lookup that happens to come up empty.
 */
export function isFixtureElement(id: string): boolean {
  const s = SPELL_BY_ID[id];
  return s?.kind === 'element' && s.source === 'fixture';
}

/** What a cast produces once resolved. */
export type CastOutput = 'projectile' | 'golem' | 'buff';

export interface CastStatus { id: StatusId; power: number; }

interface ComboDef {
  name: string;
  colour: number;
  /** Damage per projectile. */
  damage: number;
  /**
   * Projectiles, which are a SPREAD across distinct bodies and never a focus on
   * one — see `Combat.cast`. So this is "how many bodies does it reach", and a
   * high count against a lone boss is worth exactly one projectile.
   */
  count?: number;
  statuses?: CastStatus[];
  /** Knockback in tiles. */
  shove?: number;
  output?: CastOutput;
  /**
   * A floor of tiles this fusion covers, overriding the ladder.
   *
   * Volume otherwise grows only with DUPLICATE elements, because that is what rank
   * is — so a two-element fusion sits at the bottom rung and covers a single tile no
   * matter what it is made of. That is right for most of them: a Steam Burst is one
   * violent event at one place. It is wrong for the pairs whose whole identity is
   * AREA, where the fusion is the reason the player spent two pages instead of one.
   */
  volume?: number;
}

/** The key for a set of page ids: sorted, deduped, joined. */
export function setKey(ids: string[]): string {
  return [...new Set(ids)].sort().join('+');
}

/**
 * Authored fusion identities. Only sets that deserve a NAME live here; every
 * other combination is composed by `resolveCast`. Keys are sorted set keys.
 *
 * **These are priced in HAND SLOTS, not in turns.** A cast costs one turn whether
 * it holds one element or three, so nothing in this table is paid for in tempo any
 * more. What a fusion costs is the SLOTS it occupies, and slots come from the star
 * tree — so the yardstick is ONE turn of the best single page rather than N of
 * them: a rank-1 Fireball, 10 up front plus three ticks of 3, so ~19 on one body.
 *
 * The shape every row is tuned to, and the reason the table has two kinds of row:
 *  - `count > 1` is a SPREAD. Projectiles never double up on one body, so a
 *    3-count pair is worth three bodies' damage against a room and one body's
 *    against a boss. Measured against 19 × the bodies it reaches, which is why
 *    Whiteout's 13 on a lone target is not a failure — it is 39 across three, and
 *    these rows win on groups and lose badly on one thing.
 *  - `count: 1` is a FOCUS, measured against 19 on a single body, and it has to
 *    beat that by enough that the extra slot bought something real. Steam Burst is
 *    30, so two slots buy 1.6× a Fireball turn; Soulfire's 46 over its ticks is
 *    2.4×. These are the single-target nukes and they overkill a mook on purpose.
 *
 * What the rule NO LONGER asks, and the superseded one did: that a fusion beat the
 * same elements cast one at a time. It cannot ask that, because the fusion is one
 * turn and the sequence is N — measured, 10 of the 21 authored rows out-total their
 * own sequence and every one of them should. Steam Burst lands 30 in one turn where
 * frost-then-fire is 32 over two; the fusion wins the tempo and loses the total, and
 * that is the trade a slot buys. The old rule ("out-damage N Fireballs") was the
 * same sentence written when N slots cost N turns, and it is the only thing in this
 * comment the rebase falsified — no row's numbers had to move, because a yardstick
 * that fell from N × 19 to 19 is one every existing row already clears.
 *
 * A HARVEST is priced identically, because it costs identically: one hand slot and
 * nothing else, exactly like tearing a page. So Stone + Fireball is a two-SLOT cast
 * measured against the same 19. What a harvest saves is a page, not a turn — and
 * being locked to rank 1 is what it pays for that.
 */
export const COMBOS: Record<string, ComboDef> = {
  /**
   * Solo identities. For an element with a ladder these names are the RANK-1 rung
   * and `resolveCast` overrides them from the ladder on any solo cast, so they are
   * only ever read when the row is the strongest authored subset under a set that
   * has no row of its own — fire beside stone, say. They are kept in step with
   * `ladder[0]` for exactly that case: a composed cast should not be able to hand
   * the player the word "Fireball" for a fire they never deepened.
   */
  fire: { name: 'Flame', colour: 0xff7a2b, damage: 10, statuses: [{ id: 'burning', power: 1 }] },
  frost: { name: 'Frost', colour: 0x7ad4ff, damage: 8, statuses: [{ id: 'frozen', power: 1 }] },
  /**
   * PRICED PER HIT, and spark gets more hits than anything else in the book.
   *
   * 9 was a single-target bolt's number, from when a shock reached one body and
   * occasionally arced to a second. A chain lands `copies + jumps` times, so the same
   * 9 made a rank-3 Thunderstorm worth 144 against an Inferno's 39. Five puts each
   * rung level with the fire page it is standing next to — 10, 24, 42 against fire's
   * 10, 24, 39 — and leaves spark's edge where it belongs: it SPREADS that total
   * over a room, and every body it touches loses a turn.
   */
  spark: { name: 'Spark', colour: 0xffe14a, damage: 5, statuses: [{ id: 'shocked', power: 1 }] },
  // Gust trades damage for a stagger and a shove — the page that moves a body
  // rather than the page that kills it. It is deliberately under the SHATTER
  // threshold, so gusting a frozen thing leaves it frozen.
  gust: { name: 'Gust', colour: 0xa8f0d0, damage: 5, shove: 1, statuses: [{ id: 'stagger', power: 1 }] },
  // Decay out-totals a Fireball (5 + five ticks of 3 = 20 against 19) and takes
  // five rounds to do it. Slowest payout, largest total: a trade, not a downgrade.
  rot: { name: 'Decay', colour: 0x9de06a, damage: 5, statuses: [{ id: 'decay', power: 1 }] },
  // Gust's number, and no status at all. Everything plant is worth is on the floor
  // it leaves — see the page. A body standing in it takes 4 and a room to walk out of.
  plant: { name: 'Seed', colour: 0x4fbf7a, damage: 4 },

  /**
   * The harvested solos. Every one of them totals less on a body than a page does
   * (a Fireball is 19 once the burn finishes), because a fixture is a substitute
   * for a page you do not own and never an upgrade on one you do.
   *
   * Stone is the exception on the FIRST number and the rule on the total: 12 is the
   * biggest single hit of any one-turn cast in the game, and 12 is also the whole of
   * it, because it applies no status and therefore ticks for nothing. It is above
   * SHATTER_DAMAGE by a clear margin on purpose — "heavy; shatters frozen" is the
   * job `docs/DESIGN.md` gives it.
   */
  stone: { name: 'Stone', colour: 0xa89880, damage: 12 },
  // 4 damage is the point. Water is bought for the soak, and the soak is bought
  // for the cast after it — CONDUCTION, STEAM or a deep freeze.
  water: { name: 'Water', colour: 0x4e9fbf, damage: 4, statuses: [{ id: 'soaked', power: 1 }] },
  // "Does not burn alone." Cast on its own this is the worst thing in the game;
  // cast before fire it is `OIL_FIRE_MULT` on whatever arrives next.
  oil: { name: 'Oil', colour: 0xc79a3a, damage: 3, statuses: [{ id: 'oiled', power: 1 }] },
  /**
   * Starlight is a UTILITY cast, sized beside Gust and Decay at 5 rather than beside
   * Stone at 12, and that is what makes its one trick real. SHATTER_DAMAGE is 8
   * precisely so light casts cannot break ice open (`tuning.ts`), so a piercing cast
   * only means anything if it is light enough to be caught by that rule. At 13 the
   * pierce flag never once changed an outcome and Starlight was a Stone with a
   * better number — which is the overlap `docs/DESIGN.md` forbids by construction.
   *
   * Pierce itself is systemic: `resolveCast` sets it from the ELEMENT and not from
   * this row, so it survives composition into every unauthored set too.
   */
  starlight: { name: 'Starlight', colour: 0xdfe8ff, damage: 7 },

  // element pairs — the discoveries
  'fire+frost': {
    name: 'Steam Burst', colour: 0xbfe8ff, damage: 30,
    statuses: [{ id: 'soaked', power: 1 }, { id: 'stagger', power: 1 }],
  },
  'fire+spark': {
    name: 'Firestorm', colour: 0xffa63a, damage: 13, count: 3,
    statuses: [{ id: 'burning', power: 1 }, { id: 'shocked', power: 0.5 }],
  },
  'fire+gust': {
    name: 'Wildfire', colour: 0xff9440, damage: 19, count: 2,
    statuses: [{ id: 'burning', power: 1.6 }],
  },
  'frost+spark': {
    name: 'Aurora', colour: 0x9ee8ff, damage: 26,
    statuses: [{ id: 'frozen', power: 1 }, { id: 'shocked', power: 1 }],
  },
  /**
   * THE VOLUME FREEZE, and the reason frost alone does not have to be one.
   *
   * Frost on its own lays ice over a small patch and holds the body it was aimed at;
   * this is the version that takes the room. Nine tiles rather than frost's own one
   * at this rung — the gust is what carries it — and `count: 3` so the freeze lands
   * on three bodies instead of one. Gust also means it SHOVES, so the group is held
   * and moved at once, which is a different sentence from either page alone.
   */
  /**
   * WHITEOUT, and not "Blizzard", which is the rank-3 rung of the frost page.
   *
   * Two different spells cannot share a name. A player who has deepened frost twice
   * knows a Blizzard as the thing their own page becomes; handing the same word to a
   * fusion they made out of two different pages says the ladder led here, and it did
   * not. Whiteout is the same weather with the visibility taken away, which is what
   * the gust adds to it.
   */
  'frost+gust': {
    name: 'Whiteout', colour: 0xd6f4ff, damage: 13, count: 3, volume: 5, shove: 1,
    statuses: [{ id: 'frozen', power: 0.8 }],
  },
  'gust+spark': {
    name: 'Tempest', colour: 0xfff0a0, damage: 13, count: 3,
    statuses: [{ id: 'shocked', power: 1 }], shove: 1,
  },
  'fire+rot': {
    name: 'Soulfire', colour: 0xc8ff8a, damage: 22,
    statuses: [{ id: 'burning', power: 1.4 }, { id: 'decay', power: 0.8 }],
  },
  'frost+rot': {
    name: 'Grave Chill', colour: 0xa8e0c0, damage: 22,
    statuses: [{ id: 'frozen', power: 1.2 }, { id: 'decay', power: 0.8 }],
  },
  'rot+spark': {
    name: 'Necrotic Arc', colour: 0xd4ff6a, damage: 22,
    statuses: [{ id: 'decay', power: 0.8 }, { id: 'shocked', power: 1 }],
  },
  'gust+rot': {
    name: 'Spore Wind', colour: 0xb8f090, damage: 13, count: 3,
    statuses: [{ id: 'decay', power: 0.6 }],
  },

  /**
   * THE PLANT PAIRS. Each one answers "what does a room full of briar do about X",
   * and none of them is a damage row wearing a plant hat.
   */
  // Briar burns, and burns well. The fusion is fire's number with plant's spread —
  // and on the FLOOR the fire wins outright (`GROUND_ELEMENTS`), so this is also how
  // you clear a thicket you regret. Highest single number of the five, and the price
  // is that it destroys the terrain you spent a page making.
  'fire+plant': {
    name: 'Wildwood Blaze', colour: 0xffa04a, damage: 24,
    statuses: [{ id: 'burning', power: 1.4 }],
  },
  // Frozen briar: the ice takes the tile, the thorns hold the body. Denial stacked
  // twice, which is why the damage is the lowest of the five.
  'frost+plant': {
    name: 'Thornfrost', colour: 0x8fe0b8, damage: 15,
    statuses: [{ id: 'frozen', power: 1.1 }],
  },
  // Green wood does not conduct — it holds the charge instead of passing it on. Wide
  // and shallow, with the shock spread over a stand of bodies rather than chained.
  'plant+spark': {
    name: 'Greenwood Arc', colour: 0xa8e04a, damage: 11, count: 3,
    statuses: [{ id: 'shocked', power: 1 }],
  },
  // The seeds go where the wind does. Volume is the whole row — this is how a briar
  // gets laid across a room in one cast instead of a tile at a time.
  'gust+plant': {
    name: 'Seedstorm', colour: 0x8fd66a, damage: 10, count: 3, volume: 5, shove: 1,
  },
  // The two green pages together: what grows is already dying, and it spreads that
  // to whatever walks through it. Plant's floor plus rot's slow, patient total.
  'plant+rot': {
    name: 'Creeping Blight', colour: 0x7fc85a, damage: 16,
    statuses: [{ id: 'decay', power: 1.3 }],
  },

  /**
   * Harvest + page. Two SLOTS each, so each is measured against one Fireball turn's
   * ~19 — not against two Fireballs, which is what it was measured against while
   * taking the rock cost a turn of its own.
   *
   * These are the rows the whole harvest phase exists for. Note the shape: the
   * Stone half brings no status of its own, so a Stone fusion is whatever the PAGE
   * does with a rock behind it — which is why the four of them land in four
   * different slots of the table rather than being one row four times.
   */
  // 26 plus a 4-turn burn is 38 against a Fireball turn's 19, and it shatters ice on
  // the way in. The single-target rock, and the heaviest thing two slots buy.
  'fire+stone': {
    name: 'Meteor', colour: 0xff6a3a, damage: 26,
    statuses: [{ id: 'burning', power: 1.4 }],
  },
  // Priced UNDER Aurora, which buys the same shape for the same two slots but
  // spends two PAGES doing it: one less damage and one less round denied. Saving a
  // page is the whole of what a harvest fusion is paid, so it must not also
  // beat the page-only row it substitutes for. Still one or the other and never
  // both — 25 is over SHATTER_DAMAGE, so cast at something already frozen it bursts
  // the shell instead of extending it.
  'frost+stone': {
    name: 'Glacier', colour: 0xa8dcea, damage: 25,
    statuses: [{ id: 'frozen', power: 1 }],
  },
  // A spread, so 20 on a boss and 40 on a pair. Iron draws the arc: two bodies,
  // hard, where Tempest takes three softly.
  'spark+stone': {
    name: 'Lodestone', colour: 0xffd76a, damage: 20, count: 2,
    statuses: [{ id: 'shocked', power: 1 }],
  },
  // The widest thing two slots can buy, and the only shove of 2 in the game — the
  // floor moving is not a knock, it is a distance.
  'gust+stone': {
    name: 'Earthquake', colour: 0xbfae90, damage: 14, count: 3,
    statuses: [{ id: 'stagger', power: 1 }], shove: 2,
  },
  /**
   * Harvest + page, water. One row per interaction water just turned on, so the
   * one-cast version of each play is authored and the two-cast version is the
   * systemic one in `Combat.applyCast`. Both have to exist: the fusion is what a
   * hand of two buys, and the two-cast play is what hand size 1 has instead.
   */
  // Fire into water: the water loses. Steam Burst without the second page, and 21
  // rather than 30 because of WHEN it arrives — 21 plus a burn totals Steam Burst's
  // 30 while Steam Burst lands all 30 at once, and burst is the axis the nuke row is
  // for. Same stagger, no soak left behind.
  'fire+water': {
    name: 'Scald', colour: 0xd8eaf0, damage: 21,
    statuses: [{ id: 'burning', power: 1 }, { id: 'stagger', power: 1 }],
  },
  // Frost into water: DEEP_FREEZE_MULT's one-cast form, so 1.5 is chosen to land on
  // the same three turns the two-cast version gives. The LONG freeze where Glacier
  // is the heavy one, and it leaves the soak, so the shatter that follows can be a
  // Spark instead of a rock.
  'frost+water': {
    name: 'Black Ice', colour: 0x8ab8d8, damage: 22,
    statuses: [{ id: 'frozen', power: 1.5 }, { id: 'soaked', power: 1 }],
  },
  // Spark into water: soaks the room AND shocks it, so the next Spark conducts off
  // three bodies at once. The best enabler in the table and priced as a spread.
  'spark+water': {
    name: 'Voltaic Surge', colour: 0x8ad8ff, damage: 13, count: 3,
    statuses: [{ id: 'shocked', power: 1 }, { id: 'soaked', power: 1 }],
  },
  // "Doubles fire damage", taken literally in both halves: 10 becomes 20 and a
  // 3-turn burn becomes 6. 38 total, and almost all of it arrives late.
  'fire+oil': {
    name: 'Conflagration', colour: 0xff8a1a, damage: 20,
    statuses: [{ id: 'burning', power: 2 }],
  },

  // triples
  'fire+frost+spark': {
    name: 'Thunderhead', colour: 0xcfe8ff, damage: 24, count: 3,
    statuses: [{ id: 'soaked', power: 1 }, { id: 'shocked', power: 1.4 }],
  },
  'fire+gust+spark': {
    /**
     * 18 -> 20, because 18 FAILED the rule the rest of the table is held to.
     *
     * Measured while authoring the seven missing triples: at 18 x 3 it totalled 54
     * against a yardstick of 57 — one turn of this three-slot fusion was worth less
     * than one turn of the best single page across the same three bodies, which is
     * the definition of a row that should not exist. It was the only authored triple
     * that failed, and it failed quietly because nothing had ever compared them all
     * at once.
     */
    name: 'Cinder Cyclone', colour: 0xffb84a, damage: 20, count: 3,
    statuses: [{ id: 'burning', power: 1.5 }, { id: 'shocked', power: 1 }], shove: 1,
  },
  'fire+frost+gust': {
    name: 'Hailfire', colour: 0xdff0ff, damage: 30, count: 2,
    statuses: [{ id: 'soaked', power: 1 }, { id: 'frozen', power: 1 }], shove: 1,
  },

  /**
   * THE SEVEN THAT WERE MISSING.
   *
   * Hand size 3 is the tree's most expensive capability purchase and seven of the ten
   * page-element triples fell through to systematic composition — so a player who
   * bought the third slot and built around Decay got a procedurally named non-event
   * at the exact moment the game should have been at its most generous.
   *
   * Six of the seven contain rot, which is the tell: the authored table was written
   * around fire and never came back for the animancy page. (The doc says all seven
   * do; `frost+gust+spark` does not, and it was missing for the plainer reason that
   * it is the one triple with no fire in it at all.)
   *
   * Priced on the same yardstick as the rest of the table: one turn, measured against
   * 19 × the bodies it reaches. Every row below clears that, and each earns its slot
   * by doing something the pair inside it cannot — rot is the element that keeps
   * paying after the turn ends, so these are the rows where damage is deliberately
   * lower and the TICK is the point.
   */
  'fire+frost+rot': {
    // Rot does not stop for cold, it slows — and a body held still rots on schedule
    // while it burns. The focus row of the seven: two bodies, the biggest tick.
    name: 'Black Frost', colour: 0x9fd8c0, damage: 28, count: 2,
    statuses: [{ id: 'decay', power: 1.6 }, { id: 'frozen', power: 1 }],
  },
  'fire+rot+spark': {
    // Rot lit and charged at once. The spread row: worse on a boss than Soulfire,
    // much better across a room, which is the trade every count-3 row makes.
    name: 'Pyre Blight', colour: 0xc2e04a, damage: 22, count: 3,
    statuses: [{ id: 'decay', power: 1.2 }, { id: 'burning', power: 1.2 }],
  },
  'fire+gust+rot': {
    // Wind carries burning spores. The only rot row that also repositions, which is
    // what makes it the answer to a clump rather than to a line.
    name: 'Spore Storm', colour: 0xb8d07a, damage: 20, count: 3,
    statuses: [{ id: 'decay', power: 1.2 }, { id: 'burning', power: 1 }], shove: 1,
  },
  'frost+gust+spark': {
    // The one triple with no fire in it: weather, and nothing else. Highest raw
    // spread in the table, and it lands no lasting tick at all — the counterpart to
    // the rot rows rather than a rival to them.
    name: 'Stormfront', colour: 0xbfe8ff, damage: 26, count: 3,
    statuses: [{ id: 'shocked', power: 1.2 }, { id: 'soaked', power: 1 }], shove: 1,
  },
  'frost+rot+spark': {
    // Soaked rot conducts, which is the interaction the pair already promises; the
    // triple makes it the identity instead of a lucky order.
    name: 'Necrotic Arc', colour: 0x8fe0c8, damage: 23, count: 3,
    statuses: [{ id: 'decay', power: 1.3 }, { id: 'shocked', power: 1.2 }],
  },
  'frost+gust+rot': {
    // Cold wind over rot. The other focus row: two bodies, held, and rotting for the
    // whole time they are held — the most tempo the seven can buy.
    name: 'Killing Frost', colour: 0xa8e8d8, damage: 32, count: 2,
    statuses: [{ id: 'decay', power: 1.4 }, { id: 'frozen', power: 1 }], shove: 1,
  },
  'gust+rot+spark': {
    // Airborne rot, charged. The widest of the rot rows and the weakest per body,
    // which is the shape a room-clearer should have.
    name: 'Miasma', colour: 0xa8d060, damage: 21, count: 3,
    statuses: [{ id: 'decay', power: 1.2 }, { id: 'shocked', power: 1 }], shove: 1,
  },
};

/**
 * Golem infusion prefixes. An `animate` cast folds any elements in the set into
 * the risen body's touch — the same "leftover elements become melee infusions"
 * rule spellbook uses for its summons. Harvested elements included: a Granite
 * Statue Golem is what you get for animating one fixture with another.
 *
 * `status: null` for the two elements that apply nothing. Handing Stone a stagger
 * so the table could be total would give Gust's job away to the element whose
 * identity is having no status.
 */
const INFUSE: Record<Element, { prefix: string; status: StatusId | null }> = {
  fire: { prefix: 'Cinder', status: 'burning' },
  frost: { prefix: 'Rime', status: 'frozen' },
  spark: { prefix: 'Charged', status: 'shocked' },
  gust: { prefix: 'Gale', status: 'stagger' },
  rot: { prefix: 'Rotting', status: 'decay' },
  // No status: what plant does happens to the FLOOR, and a golem is not a floor.
  // The prefix is all it has to give, which is the same bargain Stone makes.
  plant: { prefix: 'Bramble', status: null },
  stone: { prefix: 'Granite', status: null },
  water: { prefix: 'Drowned', status: 'soaked' },
  oil: { prefix: 'Slick', status: 'oiled' },
  starlight: { prefix: 'Radiant', status: null },
  none: { prefix: '', status: null },
};

/** Human-readable body name for a prop sprite id, e.g. f1_prop_bookshelf -> Book. */
const BODY_NAME: Record<string, string> = {
  f1_prop_bookshelf: 'Book', f1_prop_candelabra: 'Candle', f1_prop_barrel: 'Water',
  f1_prop_lectern: 'Lectern',
  f2_prop_cauldron: 'Cauldron', f2_prop_meatrack: 'Meat Rack', f2_prop_bonepile: 'Bone',
  f2_prop_alebarrel: 'Ale',
  f3_prop_fungus: 'Fungus', f3_prop_root: 'Root', f3_prop_statue: 'Statue',
  f3_prop_planter: 'Planter',
  f4_prop_forge: 'Anvil', f4_prop_gears: 'Gear', f4_prop_oildrum: 'Oil',
  f4_prop_hoist: 'Hoist',
  f5_prop_orrery: 'Orrery', f5_prop_telescope: 'Telescope', f5_prop_crystal: 'Crystal',
  f5_prop_font: 'Font',
};

export function bodyName(propId: string): string {
  return BODY_NAME[propId] ?? 'Stone';
}

/**
 * Which element a prop can be harvested for, or absent for the ones that are only
 * ever a body. Sources are `docs/DESIGN.md`'s "Room fixtures — harvest" table.
 *
 * Keyed by sprite id and NOT a third array beside `theme.props` / `theme.golems`,
 * deliberately. Those two are index-paired and `populate.ts` picks one index into
 * both; a third parallel array is a third thing to keep aligned for no gain, since
 * a prop belongs to exactly one theme and its element is a property of the prop.
 * This is the same shape as `BODY_NAME` above and fails the same safe way — an
 * unlisted prop simply has no tap.
 *
 * The two honest overlaps with a page are both fire, and both are the design's
 * named exception: a lit candelabra gives you fire and so does a live forge. The
 * always-rank-1 rule is what stops either from replacing the Fireball page.
 *
 * Absent on purpose: bookshelf, lectern, telescope, meat rack, bone pile and
 * fungus are named animate-only in the design doc. Root and planter are NOT in the
 * doc's table at all and are animate-only here as the minimum that ships — see
 * `## Open — not decided`, which must not be filled in by inference.
 */
const PROP_ELEMENT: Record<string, Element> = {
  f1_prop_candelabra: 'fire',
  f1_prop_barrel: 'water',
  f2_prop_cauldron: 'water',
  f2_prop_alebarrel: 'oil',
  f3_prop_statue: 'stone',
  f4_prop_forge: 'fire',
  f4_prop_gears: 'stone',
  f4_prop_oildrum: 'oil',
  f4_prop_hoist: 'stone',
  f5_prop_orrery: 'starlight',
  f5_prop_crystal: 'starlight',
  // The doc lists a font under both Water and Starlight; this sprite is the STAR
  // font ("filled with liquid starlight", art/manifest.json), so it is that one.
  f5_prop_font: 'starlight',
  // ---- floors 6-10. Every floor keeps at least one fixture element reachable, and
  // no floor yields the element its own creatures are weakest to for free.
  f6_prop_trough: 'water',
  f6_prop_lantern: 'fire',
  f7_prop_coral: 'stone',
  f7_prop_anchor: 'stone',
  f8_prop_censer: 'fire',
  f8_prop_bell: 'stone',
  f9_prop_kiln: 'fire',
  f9_prop_column: 'stone',
  f9_prop_bellows: 'oil',
  f10_prop_brazier: 'fire',
  f10_prop_reliquary: 'starlight',
  f10_prop_throne: 'stone',
};

/**
 * HOW MANY DRAWS A FIXTURE HAS IN IT, by the element it yields.
 *
 * Fixtures used to be bottomless, and that was correct while a harvest was also
 * non-storable: `docs/DESIGN.md` rejects depleting them precisely because
 * "fixtures are non-depleting *and* non-storable; those two rules hold each other
 * up". The belt takes the second rule away — a harvest can now be carried — so the
 * first one has to be paid for, or a candelabra is an unlimited fire faucet with a
 * pouch under it.
 *
 * Depth is also the value language, and it is deliberately extreme rather than
 * balanced-looking. A player who never reads a number still learns the hierarchy by
 * running a candle dry in one room and never running a cistern dry at all. It is
 * the same statement pouch weight makes (`belt.ts`), said in the world instead of
 * in the inventory: what is cheap is deep, what is precious is shallow.
 *
 * Keyed by ELEMENT and not by prop, so a new brazier inherits fire's depth without
 * anybody remembering to add a row — the same reason `PROP_ELEMENT` maps to
 * elements rather than to counts.
 */
export const HARVEST_DEPTH: Readonly<Record<Element, number>> = {
  water: 100,
  stone: 40,
  oil: 20,
  fire: 5,
  starlight: 3,
  // Page elements are never harvested from a fixture; the entries exist so the
  // record is total and a lookup can never be undefined. Golem clay joins the
  // shallow end when it lands.
  frost: 0, spark: 0, gust: 0, plant: 0, rot: 0, none: 0,
};

/** How many times this prop can be harvested before it runs dry. */
export function harvestDepthOf(propId: string): number {
  const el = PROP_ELEMENT[propId];
  return el ? (HARVEST_DEPTH[el] ?? 0) : 0;
}

/**
 * The spell id a fixture yields, or null if it is a body and not a tap.
 *
 * Returns an ID rather than an `Element` because the id is what the hand holds and
 * what `resolveCast` consumes — and because harvested fire has to arrive as
 * `flame` and never as `fire`, or `Combat.byRank` would find the player's Fireball
 * rank sitting on it.
 */
/**
 * Is this component something a fixture yields — the things the belt can now hold
 * beside its ingredients?
 *
 * Asked of the id rather than the element because the hand holds ids, and harvested
 * fire arrives as `flame` precisely so it cannot inherit a Fireball rank.
 */
export function isFixtureComponent(id: string): boolean {
  return FIXTURE_SPELLS.some((s) => s.id === id);
}

export function harvestOf(propId: string): string | null {
  const el = PROP_ELEMENT[propId];
  if (!el) return null;
  return FIXTURE_SPELLS.find((s) => s.element === el)?.id ?? null;
}

/**
 * What the cast is being aimed at — the target is part of the fusion.
 *
 * `corpse` is the seam Coffin Moss aims through and NOTHING produces one today; the
 * corpse-raising phase is what puts a body of that kind on the floor. It is here
 * rather than left out so the moss refusal is a rule about the target ("that is not
 * a corpse") instead of a hardcoded "never", which is the version that would rot.
 */
export interface CastTarget {
  kind: 'enemy' | 'boss' | 'prop' | 'golem' | 'chest' | 'corpse' | 'self' | 'none';
  /** For props: the sprite id, so an animate cast can name the body. */
  propId?: string;
}

export interface ResolvedCast {
  name: string;
  colour: number;
  output: CastOutput;
  damage: number;
  count: number;
  statuses: CastStatus[];
  shove: number;
  cost: number;
  /**
   * The distinct elements this cast is made of.
   *
   * Carried through because an OBJECT REACTION is keyed on the element and not on
   * the resolved identity — a barrel answers fire, and it has to answer it whether
   * the fire arrived as Fireball, as Meteor or as a candelabra. Deriving it from
   * `statuses` instead would make Steam Burst topple a statue (it staggers) and
   * would make Stone, which applies nothing, unable to set anything off at all.
   */
  elements: Element[];
  /**
   * Ignores the SHATTER damage threshold — a frozen shell breaks however light the
   * hit is. Set from the presence of starlight in the set rather than from a
   * `COMBOS` row, so it survives composition into every unauthored set as well.
   */
  pierce: boolean;
  /** Statuses the risen golem's melee applies. */
  infuse: StatusId[];
  /** True when an authored row named this cast — drives the discovery caption. */
  authored: boolean;
  /**
   * How many TILES this cast fills where it lands — see `VOLUME_TILES`.
   *
   * On the resolved cast rather than looked up from the elements at the point of
   * use, because empowerment is resolved here and nowhere else: two fires is a
   * bigger volume for the same reason it is a bigger number, and a caller that
   * re-derived it from `elements` would lose the count that made it bigger.
   */
  volume: number;
  /** Why a cast cannot happen, for the deny message. */
  refusal?: string;
}

export function costOf(ids: string[]): number {
  // Duplicates cost full price — empowerment is not free.
  return ids.reduce((n, id) => n + (SPELL_BY_ID[id]?.cost ?? 0), 0);
}

/**
 * Resolve a selection of pages against a target into one cast.
 *
 * Order of resolution:
 *   0. No element, no cast. Ingredients shape a spell; they are never the spell,
 *      so a hand holding only ingredients is refused before anything else runs.
 *   1. An animating ingredient turns the cast into a GOLEM, whose body comes from
 *      the target and whose touch is infused by the elements present.
 *   2. Otherwise an authored `COMBOS` row for the exact element set wins.
 *   3. Otherwise compose: strongest authored subset, scaled, with leftover
 *      elements riding along as reduced-power statuses.
 *   4. Modifiers then peel off as FORMS (Giant / Volley), and duplicates
 *      empower rather than re-identify.
 */
export function resolveCast(ids: string[], target: CastTarget): ResolvedCast {
  const cost = costOf(ids);
  const distinct = [...new Set(ids)];
  const defs = distinct.map((id) => SPELL_BY_ID[id]).filter(Boolean);

  const elements = defs.filter((d) => d.kind === 'element').map((d) => d.element);
  const hasAnimate = defs.some((d) => d.role === 'animate');
  const hasRaise = defs.some((d) => d.role === 'raise');
  const mods = defs.filter((d) => d.role === 'modifier').map((d) => d.id);

  // duplicate counts drive empowerment
  const dupes: Record<string, number> = {};
  for (const id of ids) dupes[id] = (dupes[id] ?? 0) + 1;
  const extraGrow = Math.max(0, (dupes.grow ?? 0) - 1);
  const extraSplit = Math.max(0, (dupes.split ?? 0) - 1);
  /**
   * Counted by ELEMENT and not by id, because two ids can now be the same element:
   * a torn Fireball beside a harvested candelabra is two of the same fire and has
   * to empower like two Fireballs would, having cost the same two slots. Counting
   * ids would have paid the player nothing for the second component.
   */
  const elCount: Partial<Record<Element, number>> = {};
  for (const id of ids) {
    const d = SPELL_BY_ID[id];
    if (d?.kind === 'element') elCount[d.element] = (elCount[d.element] ?? 0) + 1;
  }
  const extraBolt = Object.values(elCount).reduce((n, c) => n + (c - 1), 0);

  const base: ResolvedCast = {
    name: '', colour: 0xffffff, output: 'projectile',
    damage: 0, count: 1, statuses: [], shove: 0, cost,
    elements: [...new Set(elements)],
    volume: isVolume(elements) ? volumeTiles(elements, extraBolt) : POINT_VOLUME,
    pierce: elements.includes('starlight'), infuse: [], authored: false,
  };

  // ---- 0. the element invariant -----------------------------------------
  // Ahead of the animate branch, so even Animate cannot fire on its own: the
  // vessel needs something to be made OF. Every caller resolves through here, so
  // this is the one gate the rule needs.
  if (!elements.length) {
    return { ...base, name: 'Nothing', refusal: 'Nothing to shape — a cast needs an element.' };
  }

  // ---- 1. animation: the target supplies the body -----------------------
  /**
   * Two ingredients share this branch because they build the same thing out of
   * different bodies — an object for `animate`, a corpse for `raise` — and what a
   * golem IS should not fork on which ingredient woke it. They differ only in what
   * they will accept, which is the whole of `docs/DESIGN.md`'s reason for them being
   * two ingredients: one works on turn one, the other needs a kill first.
   */
  if (hasAnimate || hasRaise) {
    const accepted = (hasAnimate && target.kind === 'prop')
      || (hasRaise && target.kind === 'corpse');
    if (!accepted || !target.propId) {
      return {
        ...base, name: hasAnimate ? 'Animate' : 'Coffin Moss', output: 'golem',
        refusal: hasAnimate
          ? 'Animate needs an object. Target a thing, not a creature.'
          // Always taken today: nothing in the game is a corpse until the
          // corpse-raising phase puts one on the floor. See the `moss` entry.
          : 'Nothing here has fallen. Coffin Moss only raises the dead.',
      };
    }
    const body = bodyName(target.propId);
    const infuses = elements.filter((e) => e !== 'none');
    const prefix = infuses.length === 1 ? INFUSE[infuses[0]].prefix
      : infuses.length > 1 ? 'Chimeric'
      : '';
    const name = `${prefix ? prefix + ' ' : ''}${body} Golem`;
    let damage = 8 + infuses.length * 2;
    let hp = 26;
    if (mods.includes('grow')) { damage = Math.round(damage * 1.6); hp = Math.round(hp * 1.5); }
    damage += extraGrow * 3;
    return {
      ...base,
      name: mods.includes('grow') ? `Giant ${name}` : name,
      colour: infuses.length ? SPELL_BY_ID[ROOT_ID[infuses[0]]!].colour : 0xb98cff,
      output: 'golem',
      damage,
      // `count` carries the golem's HP for the caller — golems have no volley.
      count: hp,
      infuse: infuses
        .map((e) => INFUSE[e].status)
        .filter((s): s is StatusId => s !== null),
      authored: infuses.length > 0,
    };
  }

  // ---- 2/3. element identity -------------------------------------------
  const key = setKey(elements.map((e) => ROOT_ID[e]!));
  let combo = COMBOS[key];
  let authored = !!combo;

  if (!combo) {
    // Strongest authored subset, scaled, leftovers as reduced statuses.
    let best: ComboDef | undefined;
    let bestIds: string[] = [];
    const elIds = elements.map((e) => ROOT_ID[e]!);
    for (let i = 0; i < elIds.length; i++) {
      for (let j = i + 1; j <= elIds.length; j++) {
        const sub = elIds.slice(i, j);
        const c = COMBOS[setKey(sub)];
        if (c && (!best || c.damage > best.damage)) { best = c; bestIds = sub; }
      }
    }
    if (!best) best = COMBOS[elIds[0]];
    const leftovers = elIds.filter((id) => !bestIds.includes(id));
    combo = {
      ...best,
      damage: Math.round(best.damage * (1 + leftovers.length * 0.18)),
      statuses: [
        ...(best.statuses ?? []),
        ...leftovers.flatMap((id) => {
          const st = COMBOS[id]?.statuses?.[0];
          // An element with no status of its own leaves nothing behind. Stone and
          // Starlight are DEFINED by not applying one, so inventing a stagger to
          // keep this branch total would hand Gust's job to both of them.
          return st ? [{ id: st.id, power: st.power * 0.6 }] : [];
        }),
      ],
    };
    void elements;
    authored = false;
  }

  let name = combo.name;
  let damage = combo.damage;
  let count = combo.count ?? 1;
  let statuses = (combo.statuses ?? []).map((s) => ({ ...s }));
  let shove = combo.shove ?? 0;

  /**
   * A SOLO cast is named off the element's ladder, by how many copies are in it.
   *
   * Only solo. A fusion has an authored identity of its own and duplicates inside
   * one are still `Greater`/`Mighty` — there is no third word for a Steam Burst
   * thrown twice as hard, and inventing one per pair would be forty names to keep
   * true. So the ladder owns "how deep is this page" and the prefix owns "how hard
   * did you throw this fusion", which are two different questions.
   *
   * The copy count is the ELEMENT's, so a rank-1 page beside a lit candelabra is a
   * Fireball for the same reason a rank-2 page is: two fires arrived, and where
   * they came from was never what the name was about.
   */
  const distinctEls = [...new Set(elements)];
  const ladder = distinctEls.length === 1 ? LADDER[distinctEls[0]] : undefined;
  if (ladder) {
    name = ladder[Math.min(elCount[distinctEls[0]] ?? 1, ladder.length) - 1];
  }

  // ---- 4. modifier forms + empowerment ---------------------------------
  if (mods.includes('grow')) {
    damage = Math.round(damage * 1.6);
    for (const s of statuses) s.power *= 1.35;
    name = `Giant ${name}`;
  }
  if (mods.includes('split')) {
    count += 2;
    damage = Math.round(damage * 0.62);
    name = `${name} Volley`;
  }
  if (extraGrow) {
    damage = Math.round(damage * (1 + 0.45 * extraGrow));
    for (const s of statuses) s.power *= 1 + 0.3 * extraGrow;
  }
  if (extraSplit) count += 2 * extraSplit;
  if (extraBolt) {
    /**
     * Empowerment from duplicate element pages — which is how RANK is expressed,
     * a rank-3 page resolving as three copies of itself.
     *
     * The split between the two lines is the whole reason the rank ladder is not
     * strictly better than fusing. The extra projectiles are a spread and never
     * double up (`Combat.cast`), so a rank-3 page widens a cast to three bodies;
     * the multiplier is what it buys against a single body.
     *
     * Rank and hand size are priced in the SAME unit since the rebase — both make
     * one turn's cast bigger — so the two are directly comparable for the first
     * time, and +15% is what keeps the comparison honest: a rank-3 Fireball is one
     * slot for 13×3 (22 on one body, 39 across three) against a three-slot
     * Thunderhead's 24×3 (24 on one, 72 across three), so the slots stay strictly
     * ahead on every count of bodies while the ladder stays worth climbing. They
     * also COMPOSE — a rank-3 page inside a triple is Mighty Thunderhead, 31×5 — so
     * the ladder is a multiplier on fusing and never a substitute for it. (At +8%
     * and three WRAPPED projectiles, which is what this used to be, a rank-3
     * Fireball put 36 on one target and beat the triple outright.)
     */
    count += extraBolt;
    damage = Math.round(damage * (1 + 0.15 * extraBolt));
  }

  /**
   * `extraBolt` is deliberately absent where a ladder already spoke for it. A
   * rank-2 Flame is a Fireball, not a Greater Fireball — the ladder IS the
   * empowerment name — and leaving the duplicate in the tier would have named it
   * both ways at once. What still counts is Giant and Volley, because those come
   * off the belt and the ladder knows nothing about them.
   */
  const tier = extraGrow + extraSplit + (ladder ? 0 : extraBolt);
  if (tier === 1) name = `Greater ${name}`;
  else if (tier >= 2) name = `Mighty ${name}`;

  return {
    ...base,
    name, colour: combo.colour, damage, count, statuses, shove,
    // An authored floor, never a ceiling: rank still grows the patch past it, so a
    // deepened Whiteout is bigger than a plain one rather than pinned to the row.
    volume: Math.max(base.volume, combo.volume ?? 0),
    output: 'projectile', authored: authored && tier === 0,
  };
}

/**
 * Status display metadata, shared by the HUD and the sprite tinting.
 *
 * `turns` is the base duration a `power: 1` cast applies. Burning and decay share
 * a per-tick rate (`tuning.ts`) and differ only here, which is what makes fire the
 * tempo element and rot the total-damage one. The three denial statuses are short
 * because the player only gets one action per round — their uptime is capped again
 * in `Combat.enemyRound`, so duration is about pinning and shattering rather than
 * about how long a body stands still.
 */
export const STATUS_META: Record<StatusId, { name: string; colour: number; turns: number }> = {
  burning: { name: 'Burning', colour: 0xff7a2b, turns: 3 },
  frozen: { name: 'Frozen', colour: 0x7ad4ff, turns: 2 },
  soaked: { name: 'Soaked', colour: 0x4e9fbf, turns: 4 },
  shocked: { name: 'Shocked', colour: 0xffe14a, turns: 1 },
  decay: { name: 'Decaying', colour: 0x9de06a, turns: 5 },
  stagger: { name: 'Staggered', colour: 0xd8c9a0, turns: 1 },
  // Four to match soaked, and for the same reason: both are setup statuses whose
  // payoff is the NEXT cast, so both have to outlive the turn spent assembling it.
  oiled: { name: 'Oiled', colour: 0xc79a3a, turns: 4 },
  // Two, which is the same length as Frozen. It denies less than Frozen does — the
  // move only — and the whole reason to cast it is that the thing cannot close on
  // you, so one turn would be a body that pauses rather than a body that is caught.
  rooted: { name: 'Rooted', colour: 0x4fbf7a, turns: 2 },
};

/**
 * Display names. Sprite ids are pipeline identifiers ("f1_boss"), and showing
 * those to a player is the fastest way to make a game feel unfinished.
 */
const DISPLAY: Record<string, string> = {
  f1_boss: 'The Unbound Index', f2_boss: 'The Marrow Chef', f3_boss: 'Mother Bloom',
  f4_boss: 'The Overseer Engine', f5_boss: 'The Cartographer',
  f1_enemy_ink: 'Ink Wretch', f1_enemy_moth: 'Candle Moth', f1_enemy_wraith: 'Page Wraith',
  f2_enemy_cleaver: 'Cleaver Skeleton', f2_enemy_imp: 'Grease Imp', f2_enemy_hound: 'Bone Hound',
  f3_enemy_hulk: 'Spore Hulk', f3_enemy_creeper: 'Thorn Creeper', f3_enemy_priest: 'Mycelium Priest',
  f4_enemy_slag: 'Slag Golem', f4_enemy_bellows: 'Bellows Fiend', f4_enemy_wasp: 'Cinder Wasp',
  f5_enemy_acolyte: 'Void Acolyte', f5_enemy_husk: 'Star Husk', f5_enemy_sentinel: 'Mirror Sentinel',
  altar: 'Spell Altar', chest: 'Treasure Chest', stairs_down: 'Stairs Down',
  /**
   * Props whose sprite id does not title-case into English. Only these — every other
   * prop reads correctly off the fallback below. Object reactions are why they now
   * matter: a caption saying "OILDRUM · EXPLODES" is naming a file, and the whole
   * job of that caption is to make the player believe the OIL DRUM did it.
   *
   * The two barrels are named apart on purpose. One is water and one is oil, they
   * answer opposite elements, and "Barrel" for both is the one label that could make
   * a reaction look random.
   */
  f1_prop_barrel: 'Water Barrel', f2_prop_alebarrel: 'Ale Barrel',
  f2_prop_bonepile: 'Bone Pile', f2_prop_meatrack: 'Meat Rack',
  f4_prop_oildrum: 'Oil Drum', f5_prop_font: 'Star Font',
};

/** Human-readable name for any sprite id, including props and golem forms. */
export function displayName(spriteId: string): string {
  const direct = DISPLAY[spriteId];
  if (direct) return direct;
  const prop = spriteId.match(/^f\d_prop_(.+)$/);
  if (prop) return titleCase(prop[1]);
  const golem = spriteId.match(/^g_f\d_(.+)$/);
  if (golem) return `${bodyName(`f${spriteId[3]}_prop_${golem[1]}`)} Golem`;
  return titleCase(spriteId.replace(/^[fg]\d_/, ''));
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
