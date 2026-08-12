/**
 * THE ROSTER. Six wizards, one per page element.
 *
 * This file exists because the run-start screen used to ask a MECHANICAL question —
 * "which page do you carry" — and a mechanical question cannot answer WHO AM I. The
 * same choice, relabelled as a person, answers all three of the questions a player
 * means when they say they do not know what they are supposed to be doing: who you
 * are (the name), why you are here (`reason`), and what you want (`quests`).
 *
 * It costs one screen and no new systems. A wizard IS their starting element — there is
 * no stat, no passive and no bonus anywhere on this object, and there must not be one.
 * The moment a wizard carries a number, the roster stops being an identity and becomes
 * a difficulty setting.
 *
 * It also fixes something the design doc worried at from the other side. `docs/DESIGN.md`
 * argues that starting at hand size 1 is what lets the game skip a fusion tutorial, and
 * that is true — but it means a first run contains no fusion, no golems and no
 * ingredients, so it reads as the game with four things missing. As ASH, who casts fire,
 * one slot is not a missing four. It is a temperament.
 */

/** Page element ids, as `spells.ts` spells them. `rot` is Decay and `plant` is Seed. */
export type WizardElement = 'fire' | 'frost' | 'spark' | 'gust' | 'rot' | 'plant';

export interface Quest {
  /** Shown in the log, in the imperative. A NOUN IN A PLACE, never a mechanic. */
  readonly name: string;
  /** The depth it can first be completed at, for ordering and for the log's hint. */
  readonly depth: number;
  /** One line of why, in the character's own terms. */
  readonly detail: string;
}

export interface Wizard {
  readonly id: WizardElement;
  /** Given name, drawn in caps. Short on purpose — it sits under a portrait. */
  readonly name: string;
  /** The epithet. Says the element without naming a mechanic. */
  readonly title: string;
  /**
   * WHY THEY ARE DOWN THERE, in one or two sentences, spoken about them rather than
   * by them. Every wizard's reason is a different SHAPE of want — revenge, the hunt,
   * greed, curiosity, survival, duty — because six characters with six flavours of
   * revenge would be one character with six palettes.
   */
  readonly reason: string;
  /** What they say once, on the selection screen, in their own voice. */
  readonly line: string;
  /**
   * The wizard this one frees, or null.
   *
   * ONE each, deliberately. A roster that one good run unlocks entirely is a roster
   * with no reason to play the second character — so the cast is a chain, and seeing
   * all of it means playing most of it.
   */
  readonly frees: WizardElement | null;
  /** Asset id in `art/manifest.json`. */
  readonly portrait: string;
  /**
   * The quest log. Only ASH has one written; the rest are deliberately empty rather
   * than filled with placeholders, because an empty log draws nothing and a
   * placeholder log teaches the player that the log is noise.
   */
  readonly quests: readonly Quest[];
}

export const WIZARDS: readonly Wizard[] = [
  {
    id: 'fire',
    name: 'ASH',
    title: 'the Firewizard',
    reason: 'A demon burned his town and left him alive in the ashes. Hate has kept him '
      + 'warm ever since.',
    line: 'It left me alive in the ashes of my home. I have carried them down here to give back.',
    frees: 'frost',
    portrait: 'portrait_ash',
    quests: [
      { name: 'THE FIRST ALTAR', depth: 1, detail: 'Visit it.' },
      {
        name: 'THE UNBURNT PAGE', depth: 1,
        detail: 'Take it from the first boss. It names the demon.',
      },
      { name: 'KELA', depth: 3, detail: 'Rescue her.' },
      { name: 'THE DEMON', depth: 10, detail: 'Kill it.' },
    ],
  },
  {
    id: 'frost',
    name: 'KELA',
    title: 'the Wintermaiden',
    reason: 'A demon hunter by trade. Something she killed came back — and frost does not '
      + 'kill, it KEEPS, so she means to put it in ice where it will stay.',
    line: 'I do not kill them. I keep them. It is the only thing that has ever held.',
    frees: 'spark',
    portrait: 'portrait_kela',
    quests: [],
  },
  {
    id: 'spark',
    name: 'ZEL',
    title: 'the Stormwright',
    reason: 'Nobody sent her and nothing was taken from her. There is power down there '
      + 'and she intends to have it.',
    line: 'Everything down here is holding a charge it has not earned.',
    frees: 'gust',
    portrait: 'portrait_zel',
    quests: [],
  },
  {
    id: 'gust',
    name: 'VANE',
    title: 'the Windwalker',
    reason: 'Nobody sent him and nothing was taken from him. It looked like fun. He is the '
      + 'only one down here enjoying himself.',
    line: 'Everyone else came down here to settle something. I came down to see it.',
    frees: 'rot',
    portrait: 'portrait_vane',
    quests: [],
  },
  {
    id: 'rot',
    name: 'VESS',
    title: 'the Plaguebound',
    reason: 'The rot is already in him. The cure is under the library, or there is no cure.',
    line: 'I am further along than any of you. That is why I can go deeper.',
    frees: 'plant',
    portrait: 'portrait_vess',
    quests: [],
  },
  {
    id: 'plant',
    name: 'YEW',
    title: 'the Greenwarden',
    reason: 'Something is growing up out of the dark into the world above. He came down to '
      + 'find the root of it.',
    line: 'It has already reached the surface. I am not here early, I am here late.',
    frees: null,
    portrait: 'portrait_yew',
    quests: [],
  },
];

export const WIZARD_BY_ID: Readonly<Record<string, Wizard>> = Object.fromEntries(
  WIZARDS.map((w) => [w.id, w]),
);

/**
 * The wizard who frees this one, or null for ASH.
 *
 * Derived rather than stored on the object, so the chain has exactly one author and a
 * `frees` edited on one wizard cannot disagree with a `freedBy` on another.
 */
export const freedBy = (id: WizardElement): WizardElement | null =>
  WIZARDS.find((w) => w.frees === id)?.id ?? null;

/**
 * The roster's starting point. ASH, and it has to be someone — a chain with no head
 * would leave a new save with nothing selectable.
 */
export const FIRST_WIZARD: WizardElement = 'fire';
