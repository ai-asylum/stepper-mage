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

export type SpellRole = 'bolt' | 'modifier' | 'animate';
export type StatusId =
  | 'burning' | 'frozen' | 'soaked' | 'shocked' | 'decay' | 'stagger' | 'oiled';
export type Element =
  | 'fire' | 'frost' | 'spark' | 'gust' | 'rot'
  | 'stone' | 'water' | 'oil' | 'starlight'
  | 'none';

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
  name: string;
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
    id: 'fire', name: 'Fireball', glyph: '🔥', role: 'bolt', kind: 'element', source: 'page', element: 'fire', cost: 2,
    colour: 0xff7a2b, effect: 'A blazing orb. Sets the target burning.',
    flavor: '"The first spell anyone learns, and the last one they need."',
  },
  {
    id: 'frost', name: 'Frostbolt', glyph: '❄', role: 'bolt', kind: 'element', source: 'page', element: 'frost', cost: 2,
    colour: 0x7ad4ff, effect: 'An ice shard. Freezes the target solid.',
    flavor: '"Cold does not kill. It simply waits with you."',
  },
  {
    id: 'spark', name: 'Spark', glyph: '⚡', role: 'bolt', kind: 'element', source: 'page', element: 'spark', cost: 2,
    colour: 0xffe14a, effect: 'A snapping arc. Conducts through water.',
    flavor: '"Wet things conduct. Remember that, or learn it."',
  },
  {
    id: 'gust', name: 'Gust', glyph: '💨', role: 'bolt', kind: 'element', source: 'page', element: 'gust', cost: 2,
    colour: 0xa8f0d0, effect: 'Staggers the target and shoves it back a tile.',
    flavor: '"Every locked door is only as good as its hinges."',
  },
  {
    id: 'rot', name: 'Decay', glyph: '💀', role: 'bolt', kind: 'element', source: 'page', element: 'rot', cost: 2,
    colour: 0x9de06a, effect: 'Rot that eats away over several turns.',
    flavor: '"Patience, rendered as a spell."',
  },

  /**
   * Harvested from room fixtures. No page, no rank, no altar ever offers one —
   * `ELEMENT_SPELLS` is the pool the book and the altar draw from and none of
   * these are in it. What each does is chosen so it is NOT a page's job:
   *
   *  - `flame` is the one honest overlap, because a lit candelabra plainly gives
   *    you fire. It resolves through the Fireball rows and is always rank 1, which
   *    is the whole of what keeps the page worth owning.
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

  {
    id: 'animate', name: 'Animate', glyph: '💫', role: 'animate', kind: 'ingredient', source: 'belt', element: 'none', cost: 3,
    colour: 0xb98cff, effect: 'Wakes an object. It rises and fights for you.',
    flavor: '"Everything wants to stand up. Most things need asking."',
  },
  {
    id: 'grow', name: 'Growth', glyph: '🌱', role: 'modifier', kind: 'ingredient', source: 'belt', element: 'none', cost: 2,
    colour: 0x8ce06a, effect: 'Makes the cast bigger and harder hitting.',
    flavor: '"More is a kind of answer."',
  },
  {
    id: 'split', name: 'Multishot', glyph: '✨', role: 'modifier', kind: 'ingredient', source: 'belt', element: 'none', cost: 3,
    colour: 0xffd9f0, effect: 'Splits the cast across three targets.',
    flavor: '"Why choose?"',
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
}

/** The key for a set of page ids: sorted, deduped, joined. */
export function setKey(ids: string[]): string {
  return [...new Set(ids)].sort().join('+');
}

/**
 * Authored fusion identities. Only sets that deserve a NAME live here; every
 * other combination is composed by `resolveCast`. Keys are sorted set keys.
 *
 * **These are priced in TURNS.** A set of N elements costs N turns to assemble,
 * so it has to beat N turns of the best single page — otherwise the fusion is a
 * worse Fireball that also costs hand size. The yardstick is a rank-1 Fireball:
 * 10 up front plus three ticks of 3, so ~19 on one body per turn spent.
 *
 * The shape every row is tuned to, and the reason the table has two kinds of row:
 *  - `count > 1` is a SPREAD. Projectiles never double up on one body, so a
 *    3-count pair is worth three bodies' damage against a room and one body's
 *    against a boss. These win on groups and lose badly on one thing.
 *  - `count: 1` is a FOCUS, and has to out-damage N Fireballs on a single body or
 *    it has no niche at all — which is exactly what the old table got wrong.
 *    Steam Burst at 13 lost to two Fireballs' ~29, so nobody would ever hold two
 *    pages. It is now the single-target nuke, and overkills a mook on purpose.
 *
 * A HARVEST is priced identically, because it costs identically: one hand slot and
 * one turn, exactly like tearing a page. So Stone + Fireball is a two-turn cast and
 * is measured against two turns of Fireball (10 + 10, with the burn refreshed once,
 * = ~32 on one body) and not against one. What a harvest saves is a page, not a
 * turn — and being locked to rank 1 is what it pays for that.
 */
export const COMBOS: Record<string, ComboDef> = {
  // solo identities
  fire: { name: 'Fireball', colour: 0xff7a2b, damage: 10, statuses: [{ id: 'burning', power: 1 }] },
  frost: { name: 'Frostbolt', colour: 0x7ad4ff, damage: 8, statuses: [{ id: 'frozen', power: 1 }] },
  spark: { name: 'Spark', colour: 0xffe14a, damage: 9, statuses: [{ id: 'shocked', power: 1 }] },
  // Gust trades damage for a stagger and a shove — the page that moves a body
  // rather than the page that kills it. It is deliberately under the SHATTER
  // threshold, so gusting a frozen thing leaves it frozen.
  gust: { name: 'Gust', colour: 0xa8f0d0, damage: 5, shove: 1, statuses: [{ id: 'stagger', power: 1 }] },
  // Decay out-totals a Fireball (5 + five ticks of 3 = 20 against 19) and takes
  // five rounds to do it. Slowest payout, largest total: a trade, not a downgrade.
  rot: { name: 'Decay', colour: 0x9de06a, damage: 5, statuses: [{ id: 'decay', power: 1 }] },

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
  'frost+gust': {
    name: 'Blizzard', colour: 0xd6f4ff, damage: 13, count: 3,
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
   * Harvest + page. Two turns each, so each is measured against ~32.
   *
   * These are the rows the whole harvest phase exists for. Note the shape: the
   * Stone half brings no status of its own, so a Stone fusion is whatever the PAGE
   * does with a rock behind it — which is why the four of them land in four
   * different slots of the table rather than being one row four times.
   */
  // 26 + a 4-turn burn = 38 against two Fireballs' 32, and it shatters ice on the
  // way in. The single-target rock.
  'fire+stone': {
    name: 'Meteor', colour: 0xff6a3a, damage: 26,
    statuses: [{ id: 'burning', power: 1.4 }],
  },
  // Priced UNDER Aurora, which buys the same shape for the same two turns but
  // spends two pages doing it: one less damage and one less round denied. Saving a
  // page slot is the whole of what a harvest fusion is paid, so it must not also
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
  // The widest thing two turns can buy, and the only shove of 2 in the game — the
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
    name: 'Cinder Cyclone', colour: 0xffb84a, damage: 18, count: 3,
    statuses: [{ id: 'burning', power: 1.5 }, { id: 'shocked', power: 1 }], shove: 1,
  },
  'fire+frost+gust': {
    name: 'Hailfire', colour: 0xdff0ff, damage: 30, count: 2,
    statuses: [{ id: 'soaked', power: 1 }, { id: 'frozen', power: 1 }], shove: 1,
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
};

/**
 * The spell id a fixture yields, or null if it is a body and not a tap.
 *
 * Returns an ID rather than an `Element` because the id is what the hand holds and
 * what `resolveCast` consumes — and because harvested fire has to arrive as
 * `flame` and never as `fire`, or `Combat.byRank` would find the player's Fireball
 * rank sitting on it.
 */
export function harvestOf(propId: string): string | null {
  const el = PROP_ELEMENT[propId];
  if (!el) return null;
  return FIXTURE_SPELLS.find((s) => s.element === el)?.id ?? null;
}

/** What the cast is being aimed at — the target is part of the fusion. */
export interface CastTarget {
  kind: 'enemy' | 'boss' | 'prop' | 'golem' | 'chest' | 'self' | 'none';
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
 *   1. An `animate` page turns the cast into a GOLEM, whose body comes from the
 *      targeted prop and whose touch is infused by the element pages present.
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
  const mods = defs.filter((d) => d.role === 'modifier').map((d) => d.id);

  // duplicate counts drive empowerment
  const dupes: Record<string, number> = {};
  for (const id of ids) dupes[id] = (dupes[id] ?? 0) + 1;
  const extraGrow = Math.max(0, (dupes.grow ?? 0) - 1);
  const extraSplit = Math.max(0, (dupes.split ?? 0) - 1);
  /**
   * Counted by ELEMENT and not by id, because two ids can now be the same element:
   * a torn Fireball beside a harvested candelabra is two of the same fire and has
   * to empower like two Fireballs would, having cost the same two turns. Counting
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
    pierce: elements.includes('starlight'), infuse: [], authored: false,
  };

  // ---- 0. the element invariant -----------------------------------------
  // Ahead of the animate branch, so even Animate cannot fire on its own: the
  // vessel needs something to be made OF. Every caller resolves through here, so
  // this is the one gate the rule needs.
  if (!elements.length) {
    return { ...base, name: 'Nothing', refusal: 'Nothing to shape — a cast needs an element.' };
  }

  // ---- 1. animate: the target supplies the body -------------------------
  if (hasAnimate) {
    if (target.kind !== 'prop' || !target.propId) {
      return {
        ...base, name: 'Animate', output: 'golem',
        refusal: 'Animate needs an object. Target a thing, not a creature.',
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
     * the multiplier is what it buys against a single body. It used to be +8% and
     * three wrapped projectiles, which meant one turn of rank-3 Fireball put 36 on
     * one target — matching a three-turn Thunderhead at a third of the price and
     * inverting the trade the turn economy exists to create. +15% per extra copy
     * is what leaves a three-turn fusion strictly ahead of a one-turn rank-3 page
     * on every count of bodies, measured.
     */
    count += extraBolt;
    damage = Math.round(damage * (1 + 0.15 * extraBolt));
  }

  const tier = extraGrow + extraSplit + extraBolt;
  if (tier === 1) name = `Greater ${name}`;
  else if (tier >= 2) name = `Mighty ${name}`;

  return {
    ...base,
    name, colour: combo.colour, damage, count, statuses, shove,
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
