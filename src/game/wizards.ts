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
  /**
   * THE BACKSTORY. A paragraph, not a logline.
   *
   * `reason` is the one-line version for a grid tile; this is what the profile page is
   * FOR. A selection screen that gives a name, a face and a sentence has told the player
   * nothing they can care about, which is the whole failure this file exists to fix.
   */
  readonly backstory: string;
  /**
   * WHY YOU WOULD PLAY THEM, in play terms rather than story terms.
   *
   * The other half of a selection screen, and the half most rosters leave out: a player
   * choosing between six strangers needs to know what the next hour is going to be like,
   * not just who they are. Written as what their element makes the run FEEL like — never
   * as a stat line, because no wizard has a stat.
   */
  readonly whyPlay: string;
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
    reason: 'A demon scorched his town from the map and left him in the ashes.',
    backstory: 'Ash was a hedge-mage\'s apprentice in Hallow, a town that is no longer on '
      + 'any map. He was down in the cellar fetching lamp oil when the thing came through '
      + 'the square. He heard it. He never saw it, and he has never forgiven himself for '
      + 'the difference. Everyone he knew was gone inside an hour. Three days later he '
      + 'walked out of the ash with one page in his coat — the only thing in his master\'s '
      + 'library that would not catch — and he has been walking downward ever since, '
      + 'because down is the way it went.',
    whyPlay: 'The bluntest wizard in the dungeon, and the best one to learn it with. Flame '
      + 'hits harder in one cast than anything else you can start with, and it keeps '
      + 'burning after you have stopped paying attention — so Ash kills things that are '
      + 'already dying and moves on. Fire spreads, sticks to oil, eats thickets and blocks '
      + 'a doorway for eight rounds, which makes every room a thing you can set up rather '
      + 'than a thing you shoot. He asks for very little and forgives almost nothing.',
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
    reason: 'She hunts demons. The deepest ones are down here.',
    backstory: 'Kela has killed eleven demons for money and buried all eleven properly. '
      + 'The seventh came back. She found it wearing the face of the man who had paid her '
      + 'to remove it, sitting at his own table, and she understood that killing is not a '
      + 'thing that finishes. So she stopped killing them. Frost does not end a thing, it '
      + 'HOLDS it — and there is a cold place under the library deep enough that nothing '
      + 'put down there ever thaws. She is taking the seventh back to it. She got further '
      + 'than anyone before the third floor stopped her.',
    whyPlay: 'The control wizard, and the only one who can take a turn away from something. '
      + 'Frost pins a body in place and leaves it open to shatter, so Kela decides the '
      + 'ORDER a room happens in rather than how fast it dies. She is slower than Ash and '
      + 'far harder to corner: water freezes deeper, a held enemy is a fight you have '
      + 'postponed, and almost nothing reaches her that she did not allow to.',
    line: 'I do not kill them. I keep them. It is the only thing that has ever held.',
    frees: 'spark',
    portrait: 'portrait_kela',
    quests: [],
  },
  {
    id: 'spark',
    name: 'ZEL',
    title: 'the Stormwright',
    reason: 'There is power down there and she means to have it.',
    backstory: 'Zel was thrown out of two academies, the second one on fire. She is not '
      + 'grieving anybody and nothing was taken from her; she simply worked out, younger '
      + 'than was good for her, that the deep floors of the library hold charges nothing '
      + 'living should be able to hold, and that whoever reaches them first gets to keep '
      + 'what they find. She has no plan for afterwards. She has never needed one before.',
    whyPlay: 'The greedy wizard. Spark is the only element that does not stop at what you '
      + 'aimed at — it floods to the next thing and the next, and on standing water or a '
      + 'plate of iron it stops caring about range entirely. Zel turns a badly arranged '
      + 'room into a single cast, which means she is the wizard who wants MORE enemies, '
      + 'closer together, standing in something wet.',
    line: 'Everything down here is holding a charge it has not earned.',
    frees: 'gust',
    portrait: 'portrait_zel',
    quests: [],
  },
  {
    id: 'gust',
    name: 'VANE',
    title: 'the Windwalker',
    reason: 'He came to see what is down here.',
    backstory: 'Vane has no dead to speak of and no debt anybody is collecting. He walks, '
      + 'and he has walked most places worth walking, and one afternoon he noticed a '
      + 'draught coming up out of a hole in a drowned library — a real wind, from a depth '
      + 'that should have no air in it at all. He has been going down to find out what is '
      + 'breathing ever since, and he is having the time of his life. The others find this '
      + 'difficult to be around.',
    whyPlay: 'The wizard who moves the room instead of hurting it. Gust shoves things a '
      + 'tile, and a tile is everything: a body shoved off a four-level ledge takes more '
      + 'than three casts would have done, and fire put out at the right moment is a route '
      + 'reopened. Vane is the lightest hitter in the roster and the only one who treats '
      + 'the floor plan as a weapon — the most fun to play and the least forgiving of '
      + 'not looking at the room.',
    line: 'Everyone else came down here to settle something. I came down to see it.',
    frees: 'rot',
    portrait: 'portrait_vane',
    quests: [],
  },
  {
    id: 'rot',
    name: 'VESS',
    title: 'the Plaguebound',
    reason: 'He is rotting and looking for the cure.',
    backstory: 'Vess was the physician the town sent for, and he was good at it, right up '
      + 'until the thing he was treating started treating him back. The black is in his '
      + 'arms to the elbow now and climbing. He has read every book above ground on the '
      + 'subject, written two of them, and concluded there is nothing up there at all — '
      + 'which leaves the bottom. He is not frightened. He has simply run out of other places '
      + 'to look, and he is on a clock he can read better than anybody.',
    whyPlay: 'The patient wizard, and the only one who out-totals fire. Decay pays out '
      + 'slowly and for longer, so Vess buys with TIME what Ash buys with damage: light a '
      + 'thing up, walk away, let the room do the rest. He is the wizard for a player who '
      + 'wants to win a fight before it starts, and the one who least minds a long one.',
    line: 'I am further along than any of you. That is why I can go deeper.',
    frees: 'plant',
    portrait: 'portrait_vess',
    quests: [],
  },
  {
    id: 'plant',
    name: 'YEW',
    title: 'the Greenwarden',
    reason: 'The corruption spreading through the world starts here.',
    backstory: 'Yew is the youngest person to go down, and she went because nobody older '
      + 'would listen. She keeps the green on the surface — it is the only work she has '
      + 'ever wanted — and this spring it started coming up wrong: roots in the wrong '
      + 'direction, briar through a stone floor, a hedge that grew toward the cellar. She '
      + 'followed it down through a crack in a drowned library, alone, with a seed pouch '
      + 'and no permission at all. She is not brave about it. She is simply the only one '
      + 'who noticed.',
    whyPlay: 'The wizard who builds the room. Seed lays terrain — thicket that eats a '
      + 'doorway, briar you would not walk into, ground you can grow and then set alight. '
      + 'Yew does the least direct damage of anyone here and has the most say in where a '
      + 'fight happens, so she plays like a gardener: put the room in the right shape a '
      + 'turn early and the fight is already decided.',
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
