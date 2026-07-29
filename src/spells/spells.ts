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
export type StatusId = 'burning' | 'frozen' | 'soaked' | 'shocked' | 'decay' | 'stagger';
export type Element = 'fire' | 'frost' | 'spark' | 'gust' | 'rot' | 'none';

export interface SpellDef {
  id: string;
  name: string;
  glyph: string;
  role: SpellRole;
  /**
   * Elements are the castable roots: every cast must contain at least one, and
   * only elements get a page in the grimoire. Ingredients shape a cast but can
   * never be one, and they come off the belt instead.
   *
   * This is a property of the spell rather than a list of ids on purpose —
   * later elements (Stone, Water, Oil, Starlight) are sourced from room
   * fixtures and never get a page, so "is an element" cannot mean "is in the
   * book".
   */
  kind: 'element' | 'ingredient';
  element: Element;
  cost: number;
  /** Page tint, used for the sigil, the shout and damage numbers. */
  colour: number;
  /** One line on the page — must fit two short lines of UI text. */
  effect: string;
  flavor: string;
}

/**
 * Every spell in the game. The five elements are the book's pages — a run starts
 * with a few and altars grant the rest. The ingredients have no page; they are
 * belt items, kept here because `COMBOS` and `resolveCast` consume them by id.
 */
export const SPELLS: SpellDef[] = [
  {
    id: 'fire', name: 'Fireball', glyph: '🔥', role: 'bolt', kind: 'element', element: 'fire', cost: 2,
    colour: 0xff7a2b, effect: 'A blazing orb. Sets the target burning.',
    flavor: '"The first spell anyone learns, and the last one they need."',
  },
  {
    id: 'frost', name: 'Frostbolt', glyph: '❄', role: 'bolt', kind: 'element', element: 'frost', cost: 2,
    colour: 0x7ad4ff, effect: 'An ice shard. Freezes the target solid.',
    flavor: '"Cold does not kill. It simply waits with you."',
  },
  {
    id: 'spark', name: 'Spark', glyph: '⚡', role: 'bolt', kind: 'element', element: 'spark', cost: 2,
    colour: 0xffe14a, effect: 'A snapping arc. Conducts through water.',
    flavor: '"Wet things conduct. Remember that, or learn it."',
  },
  {
    id: 'gust', name: 'Gust', glyph: '💨', role: 'bolt', kind: 'element', element: 'gust', cost: 2,
    colour: 0xa8f0d0, effect: 'Staggers the target and shoves it back a tile.',
    flavor: '"Every locked door is only as good as its hinges."',
  },
  {
    id: 'rot', name: 'Decay', glyph: '💀', role: 'bolt', kind: 'element', element: 'rot', cost: 2,
    colour: 0x9de06a, effect: 'Rot that eats away over several turns.',
    flavor: '"Patience, rendered as a spell."',
  },
  {
    id: 'animate', name: 'Animate', glyph: '💫', role: 'animate', kind: 'ingredient', element: 'none', cost: 3,
    colour: 0xb98cff, effect: 'Wakes an object. It rises and fights for you.',
    flavor: '"Everything wants to stand up. Most things need asking."',
  },
  {
    id: 'grow', name: 'Growth', glyph: '🌱', role: 'modifier', kind: 'ingredient', element: 'none', cost: 2,
    colour: 0x8ce06a, effect: 'Makes the cast bigger and harder hitting.',
    flavor: '"More is a kind of answer."',
  },
  {
    id: 'split', name: 'Multishot', glyph: '✨', role: 'modifier', kind: 'ingredient', element: 'none', cost: 3,
    colour: 0xffd9f0, effect: 'Splits the cast across three targets.',
    flavor: '"Why choose?"',
  },
];

export const SPELL_BY_ID: Record<string, SpellDef> = Object.fromEntries(
  SPELLS.map((s) => [s.id, s]),
);

/** The castable roots — what the grimoire holds and what altars may offer. */
export const ELEMENT_SPELLS: SpellDef[] = SPELLS.filter((s) => s.kind === 'element');

/** Ingredients are belt items: they shape a cast but are never a cast. */
export const INGREDIENT_SPELLS: SpellDef[] = SPELLS.filter((s) => s.kind === 'ingredient');

export function isElement(id: string): boolean {
  return SPELL_BY_ID[id]?.kind === 'element';
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
 * Golem infusion prefixes. An `animate` cast folds any element pages in the set
 * into the risen body's touch — the same "leftover elements become melee
 * infusions" rule spellbook uses for its summons.
 */
const INFUSE: Record<Element, { prefix: string; status: StatusId }> = {
  fire: { prefix: 'Cinder', status: 'burning' },
  frost: { prefix: 'Rime', status: 'frozen' },
  spark: { prefix: 'Charged', status: 'shocked' },
  gust: { prefix: 'Gale', status: 'stagger' },
  rot: { prefix: 'Rotting', status: 'decay' },
  none: { prefix: '', status: 'burning' },
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
  const extraBolt = elements.reduce((n, e) => {
    const id = SPELLS.find((s) => s.element === e)?.id ?? '';
    return n + Math.max(0, (dupes[id] ?? 0) - 1);
  }, 0);

  const base: ResolvedCast = {
    name: '', colour: 0xffffff, output: 'projectile',
    damage: 0, count: 1, statuses: [], shove: 0, cost,
    infuse: [], authored: false,
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
      colour: infuses.length ? SPELLS.find((s) => s.element === infuses[0])!.colour : 0xb98cff,
      output: 'golem',
      damage,
      // `count` carries the golem's HP for the caller — golems have no volley.
      count: hp,
      infuse: infuses.map((e) => INFUSE[e].status),
      authored: infuses.length > 0,
    };
  }

  // ---- 2/3. element identity -------------------------------------------
  const key = setKey(elements.map((e) => SPELLS.find((s) => s.element === e)!.id));
  let combo = COMBOS[key];
  let authored = !!combo;

  if (!combo) {
    // Strongest authored subset, scaled, leftovers as reduced statuses.
    let best: ComboDef | undefined;
    let bestIds: string[] = [];
    const elIds = elements.map((e) => SPELLS.find((s) => s.element === e)!.id);
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
        ...leftovers.map((id) => {
          const solo = COMBOS[id];
          const st = solo?.statuses?.[0];
          return st ? { id: st.id, power: st.power * 0.6 } : { id: 'stagger' as StatusId, power: 0.5 };
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
