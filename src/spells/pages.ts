/**
 * Adapter between this game's spell data and the shape ai-asylum/spellbook's
 * book renderer expects.
 *
 * The ported `book/` files are kept as close to verbatim as possible so they
 * stay mergeable with upstream. That means meeting them where they are: their
 * `SpellDef` carries a `school` (which IS the physical chapter of the book), a
 * `colors` triad, and an `id` that keys into their hand-inked `SIGILS` table.
 *
 * So each page here declares the spellbook `id` it borrows its sigil from, and
 * `gameId` points back at this game's own spell. Order matters: chapters are
 * contiguous runs of pages, because they are physical sections with ribbon tabs.
 */
import { ELEMENT_SPELLS, FIXTURE_SPELLS, SPELL_BY_ID } from './spells';

/**
 * `transmutation` currently has no pages — Growth and Multishot were its two,
 * and they are belt ingredients now. The value stays because it is a key in the
 * ported `style/palette.ts` chapter colours, and because a later element may
 * claim the chapter; `CHAPTERS` is derived from the pages that exist, so an
 * unused school simply never produces a tab.
 */
export type SpellSchool = 'elementalism' | 'transmutation' | 'animancy';
export type SpellRole = 'bolt' | 'modifier' | 'summon';

export interface SpellColors { main: string; glow: string; deep: string; }

export interface SpellDef {
  /** The spellbook sigil key (fireball, frostbolt, summon…). */
  id: string;
  /** This game's spell id — what `resolveCast` actually consumes. */
  gameId: string;
  name: string;
  school: SpellSchool;
  role: SpellRole;
  cost: number;
  colors: SpellColors;
  effect: string;
  flavor: string;
}

export interface Chapter {
  school: SpellSchool;
  name: string;
  firstIndex: number;
}

/**
 * gameId -> { sigil id, school }
 *
 * ELEMENTS ONLY. The book is the element registry made physical — Animate,
 * Growth and Multishot are ingredients carried on the belt, so they have no page
 * and no sigil here, which is what keeps `setBookPages` from ever surfacing one.
 */
const MAP: Record<string, { sigil: string; school: SpellSchool }> = {
  fire: { sigil: 'fireball', school: 'elementalism' },
  frost: { sigil: 'frostbolt', school: 'elementalism' },
  spark: { sigil: 'spark', school: 'elementalism' },
  gust: { sigil: 'gust', school: 'elementalism' },
  rot: { sigil: 'decay', school: 'animancy' },
  // Reuses the authored `growth` sigil, which is a sprouting mark and exactly what
  // this page is — it had no page of its own before, because Growth is a belt
  // modifier and belt items carry no sheet.
  plant: { sigil: 'growth', school: 'animancy' },
};

/** Page order — grouped by school so each chapter is one physical run. */
const ORDER = ['fire', 'frost', 'spark', 'gust', 'rot', 'plant'];

function hex(n: number): string {
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}

function lighten(n: number, k: number): number {
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v: number) => Math.round(v + (255 - v) * k);
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

function darken(n: number, k: number): number {
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v: number) => Math.round(v * (1 - k));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

/**
 * The book's three-tone triad from one game colour. Exported because a harvested
 * element gets a page-shaped card too (`harvestCards.ts`) and it has to be mixed
 * the same way, or a borrowed element would read as a different KIND of card
 * rather than as the same card borrowed.
 */
export function colorsOf(colour: number): SpellColors {
  return {
    main: hex(colour),
    glow: hex(lighten(colour, 0.35)),
    deep: hex(darken(colour, 0.45)),
  };
}

function roleOf(gameId: string): SpellRole {
  const r = SPELL_BY_ID[gameId]?.role;
  return r === 'animate' ? 'summon' : r === 'modifier' ? 'modifier' : 'bolt';
}

/** Every page that exists in the game, in chapter order. */
export const ALL_PAGES: SpellDef[] = ORDER.map((gameId) => {
  const g = SPELL_BY_ID[gameId];
  const m = MAP[gameId];
  return {
    id: m.sigil,
    gameId,
    name: g.name,
    school: m.school,
    role: roleOf(gameId),
    cost: g.cost,
    colors: colorsOf(g.colour),
    effect: g.effect,
    flavor: g.flavor,
  };
});

/**
 * The player's ACTUAL book: only the pages they have learned.
 *
 * Deliberately a mutable array rather than a fresh one per change, because the
 * ported `book/` files hold a module reference to it and index into it. Showing
 * locked pages was worse than not showing them — a page you cannot tear is just
 * a dead end you keep leafing past.
 */
export const SPELLS: SpellDef[] = [];

/** Rebuild the book in place from the ids the player holds. */
export function setBookPages(ids: string[]): void {
  const want = new Set(ids);
  const next = ALL_PAGES.filter((p) => want.has(p.gameId));
  SPELLS.length = 0;
  SPELLS.push(...(next.length ? next : ALL_PAGES.slice(0, 1)));
  CHAPTERS.length = 0;
  CHAPTERS.push(...SPELLS.reduce<Chapter[]>((list, s, i) => {
    if (!list.some((c) => c.school === s.school)) {
      list.push({ school: s.school, name: s.school[0].toUpperCase() + s.school.slice(1), firstIndex: i });
    }
    return list;
  }, []));
}

/** Chapters of the player's book, rebuilt by `setBookPages`. */
export const CHAPTERS: Chapter[] = ALL_PAGES.reduce<Chapter[]>((list, s, i) => {
  if (!list.some((c) => c.school === s.school)) {
    list.push({
      school: s.school,
      name: s.school[0].toUpperCase() + s.school.slice(1),
      firstIndex: i,
    });
  }
  return list;
}, []);

/**
 * Sanity, in both directions, because the book is now defined as much by what it
 * must NOT contain as by what it must.
 *
 * `ELEMENT_SPELLS` is page elements only (`spells.ts`), so the first check still
 * says what it always said: an element with a page and no `ORDER` entry is an
 * element the player can never cast. The second is the new half — Stone, Water,
 * Oil and Starlight are harvested from fixtures and have no page anywhere, ever
 * (`docs/DESIGN.md`, "**No Stone page exists.**"), so a fixture element appearing
 * here would be the rule quietly breaking rather than failing.
 */
{
  const missing = ELEMENT_SPELLS.map((s) => s.id).filter((id) => !ORDER.includes(id));
  if (missing.length) {
    console.warn(`[pages] elements missing from ORDER: ${missing.join(', ')}`);
  }
  const forbidden = FIXTURE_SPELLS.map((s) => s.id).filter((id) => ORDER.includes(id));
  if (forbidden.length) {
    console.warn(`[pages] harvested elements must have NO page: ${forbidden.join(', ')}`);
  }
}
