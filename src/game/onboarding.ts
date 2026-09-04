/**
 * THE FIRST DESCENT — the six beats a player who has never held the book is
 * walked through, once ever.
 *
 * `Roadmap/First_Minutes.md` put "the tutorial the game does not have" out of
 * scope and shipped one sentence instead: SWIPE TO MOVE, until the player moves.
 * That sentence is the whole of what the game ever said, and it only covered the
 * first of five verbs — nothing anywhere says that a tap aims, that a page comes
 * out of the book upward, that the pill fires it, or that the candelabra on the
 * wall is a spell component. This is that sentence continued to the end of the
 * loop, and it deliberately REPLACES it rather than sitting beside it: the HUD
 * draws one instruction at a time (`Hud.drawMoveHint`), and two voices competing
 * for the one line at the moment the player knows nothing is worse than either.
 *
 * Three properties, and they are the reason this is a table rather than a
 * cutscene:
 *
 *  - EVERY BEAT IS THE REAL GESTURE. A step is over when the player actually
 *    stepped, turned, aimed, tore, cast or harvested — read off the same events
 *    and the same state gameplay reads. Nothing here is a timer standing in for
 *    a swipe, and nothing here can be satisfied by a beat the player did not
 *    perform.
 *  - NOTHING HERE CAN WEDGE. A dungeon is generated, so half of these lessons
 *    depend on the room: there may be nothing in the cone to aim at and no
 *    fixture within a corridor's walk. So a beat whose gesture is not available
 *    says what to do to reach it (`seek`) instead of repeating an instruction
 *    that cannot be followed, restates itself if that goes unanswered
 *    (`nudge`), and then GIVES UP and hands over the next one (`giveUpS`).
 *    There is a skip on screen the whole time as well.
 *  - THE GAME'S OWN RULES DO THE GATING. This is the part not to reinvent:
 *    `bookOnScreen` in `main.ts` already means the grimoire is only reachable
 *    once something is aimed at, the HARVEST and DESCEND pills already draw only
 *    when they would work, and a cast already needs a component in the hand. The
 *    flow's order is the order the game reveals itself in, so it has almost
 *    nothing left to forbid — see `holdsBook`, which is one gate on one beat
 *    rather than a lock per control.
 *
 * The completion is persisted, so it runs once. It is NOT `stepper-mage.ftue.v1`
 * — that key is the analytics activation flag and has a different lifetime; see
 * the note on it in `main.ts`.
 */

/**
 * The six beats, used both as a step's `id` and as the name of the event that
 * ends it. One union rather than two, because a beat and the thing that proves
 * it are the same idea named twice, and two lists would be two lists to keep in
 * step.
 */
export type OnboardingBeat = 'step' | 'turn' | 'aim' | 'tear' | 'cast' | 'harvest';

/**
 * What the flow may know about the run: five booleans, rebuilt by `main.ts` on
 * the frame they are asked for.
 *
 * Deliberately this narrow. The flow decides what SENTENCE is on screen and
 * nothing else — it holds no reference to the floor, the stepper or the HUD, so
 * there is no path by which a tutorial could change what the game does.
 */
export interface OnboardingWorld {
  /** Is there anything in the cone the reticle could go on? */
  canAim: boolean;
  /** Is the reticle on something? */
  aimed: boolean;
  /** Is the grimoire on screen with room in the hand — would a tear land? */
  bookUp: boolean;
  /** Components held. */
  held: number;
  /** Is a fixture adjacent and faced — would HARVEST work? */
  fixtureInReach: boolean;
}

export interface OnboardingStep {
  id: OnboardingBeat;
  /**
   * The instruction, in the HUD's own voice: short, imperative, upper case. It
   * is drawn at 24px over a lit dungeon floor and it is the only text a
   * first-time player has read, so anything that does not fit on one line is
   * not an instruction.
   */
  text: string;
  /** The same instruction said harder, once `RESTATE_S` has passed unanswered. */
  nudge: string;
  /**
   * THE EVENT that ends this step, for the beats that are things you DO. Absent
   * on the two that are things you HAVE — see `satisfied`.
   */
  signal?: OnboardingBeat;
  /**
   * THE STATE that ends this step, for the beats a player can already be in.
   *
   * Aiming and holding a page are both states the game can put you in without
   * an event the flow saw: the reticle auto-selects an alerted body directly
   * ahead (`refreshTargets`), and a page can be torn during an earlier beat.
   * Asking the question every frame is what stops the flow from printing TAP A
   * BODY over a body that is already picked.
   */
  satisfied?: (w: OnboardingWorld) => boolean;
  /** Is this step's gesture available right now? Absent means always. */
  ready?: (w: OnboardingWorld) => boolean;
  /** What to do to make it available, shown in place of `text` while it is not. */
  seek?: string;
  /**
   * Seconds before the step stops asking and hands over the next one.
   *
   * Only on the beats the ROOM has to cooperate with. A stepper's floor is
   * generated: there is no promise that a harvestable fixture is anywhere near
   * where the player happens to be standing, and a lesson that waits forever for
   * one is the silent stall this whole file is arranged against.
   */
  giveUpS?: number;
  /**
   * THE GRIMOIRE DOES NOT TAKE A PAGE WHILE THIS BEAT IS UP.
   *
   * The whole of the flow's input gating, declared on the one beat that wants it
   * rather than derived from the running order — see `Onboarding.holdsBook`.
   */
  holdsBook?: true;
}

/** Seconds a step goes unanswered before it restates itself. */
const RESTATE_S = 13;

/**
 * Seconds the one gated beat may keep the grimoire shut — see
 * `Onboarding.holdsBook`.
 *
 * Separate from that beat's `giveUpS`, and much shorter, because the two answer
 * different questions: the give-up is how long an INSTRUCTION may stand, and this
 * is how long a REFUSAL may. The ceiling is set by the harshest surface this code
 * runs on — the playable ad (`src/playable/main.ts` boots the real game) has about
 * fifteen seconds in total, and a creative that spends all of them saying no to
 * the most inviting thing on the screen is a creative that converts nothing.
 */
const HOLD_BOOK_S = 8;

/**
 * The script, in the order a new player meets the game.
 *
 * It is the order the game already reveals itself in and not a curriculum: the
 * mouth of the dungeon hands you a closed book and an empty corridor, so feet
 * come first; the book only rises once something is aimed at, so aiming comes
 * before tearing; and a cast needs a page in the hand, so it comes last of the
 * five. The sixth is the one thing about this game that no other game teaches —
 * that the room is a component — and it goes at the end because it is the only
 * beat the player can already win the first fight without.
 *
 * There is no fusion beat, on purpose. `docs/DESIGN.md` is explicit that
 * starting at hand size 1 is what lets the game SELL fusion at the star tree
 * rather than teach it, and a tutorial that taught it would be spending the
 * design's one deliberate omission.
 */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    // The old `First_Minutes` line, kept nearly word for word: it is the first
    // sentence in the game, it was verified in play, and there is no reason for
    // a rewrite to be the thing that changes it.
    id: 'step',
    text: 'SWIPE UP TO STEP',
    // Where, not what. The one way to swipe up and have nothing happen is to do
    // it over the grimoire, which leafs a page instead — and the book can be on
    // screen for this beat, because the reticle auto-selects a body that is
    // already coming for you.
    nudge: 'SWIPE UP OVER THE ROOM, ABOVE THE BOOK',
    signal: 'step',
    /**
     * A CEILING ON THE FIRST SENTENCE, so a player who never steps is not read
     * the same line for the rest of the run. Generous — a step is the easiest
     * thing in the game to do by accident — and the point is only that the flow
     * moves on eventually rather than that it moves on soon.
     */
    giveUpS: 30,
    /**
     * And the book keeps its pages while this one sentence is fresh. It is the
     * one beat that needs it and the ONLY beat that has it: see
     * `Onboarding.holdsBook` for why one is enough, and why the refusal lifts on
     * `HOLD_BOOK_S` well before this beat's give-up does.
     */
    holdsBook: true,
  },
  {
    // Facing is not a camera in this game — it is a turn that costs a round and
    // decides everything you can reach (`docs/DESIGN.md`, Reaching). A player who
    // only ever learns forward walks past every fixture and every altar in the
    // dungeon, because an altar behind you is not an altar you are at.
    id: 'turn',
    text: 'SWIPE ACROSS TO TURN',
    nudge: 'SWIPE LEFT OR RIGHT TO FACE THAT WAY',
    signal: 'turn',
  },
  {
    /**
     * AIMING BEFORE THE BOOK, because the book is a function of it.
     *
     * `bookOnScreen` gives the grimoire exactly two reasons to be up: something
     * aimed at, or a fixture in reach. So this beat is not merely first by
     * teaching order — until it is done the next one's gesture does not exist,
     * and asking for a page out of a book that is not on screen is the class of
     * instruction `First_Minutes` deleted.
     *
     * NOT "TAP A BODY", and that is the wording this beat was rewritten for.
     * `canAim` is `hud.candidates`, which is everything `targetsInView` found —
     * creatures, fixtures and ground tiles alike — so a corridor with a bookshelf
     * in it and nothing alive satisfies the beat's readiness while making a
     * sentence about creatures a lie. The mechanic is the tap, and what may be
     * under it is the game's answer rather than this line's.
     */
    id: 'aim',
    text: 'TAP WHAT YOU MEAN TO HIT',
    nudge: 'TAP A CREATURE, A FIXTURE, OR THE FLOOR AHEAD',
    satisfied: (w) => w.aimed,
    ready: (w) => w.canAim,
    seek: 'WALK ON — NOTHING IS IN FRONT OF YOU YET',
    giveUpS: 60,
  },
  {
    /**
     * The gesture the book teaches by feel — and the tap that repeats it, said
     * in the same breath because `main.ts` made them the same act on purpose:
     * "the swipe teaches and the tap repeats".
     */
    id: 'tear',
    text: 'SWIPE THE PAGE UP OUT OF THE BOOK',
    nudge: 'OR JUST TAP THE OPEN PAGE TO TEAR IT',
    satisfied: (w) => w.held > 0,
    // A target can be lost between beats — it walks out of the cone, or it dies
    // to something else — and the book goes down with it.
    ready: (w) => w.bookUp,
    seek: 'AIM AT SOMETHING — THE BOOK OPENS FOR IT',
    giveUpS: 75,
  },
  {
    /**
     * THE UNIT OF THE GAME (`docs/DESIGN.md`, Turn economy): one cast, one
     * round. Everything before this beat was free — a tear costs nothing, a
     * return costs nothing, indecision costs nothing — and this is the first
     * input in the run that hands the room an answer.
     */
    id: 'cast',
    text: 'TAP CAST TO SPEND YOUR TURN',
    nudge: 'THE CAST KEY, ABOVE THE BOOK',
    signal: 'cast',
    // Putting the card back is free and legal, and a player exploring will do
    // it. That empties the hand and there is nothing left to fire.
    ready: (w) => w.held > 0,
    seek: 'TEAR A PAGE OUT FIRST',
    giveUpS: 75,
  },
  {
    /**
     * THE ROOM IS THE THIRD SOURCE, and it is the only one of the three a player
     * would never guess at. A page is obviously a spell and a pouch is obviously
     * a thing you drink; a lit candelabra reads as scenery in every other game
     * ever made, and this one is built on it not being (`docs/DESIGN.md`, Room
     * fixtures).
     *
     * Last, and the most likely of the six to be given up on: harvesting needs a
     * fixture with an element in it, standing adjacent, faced. Animate-only props
     * — bookshelves, lecterns, bone piles — yield nothing, so a generated room can
     * easily hold no answer to this at all. That is what `giveUpS` is for, and
     * why this beat is at the end where abandoning it costs the player nothing.
     */
    id: 'harvest',
    text: 'TAP HARVEST — THE ROOM IS A SPELL TOO',
    nudge: 'STAND NEXT TO IT AND FACE IT, THEN HARVEST',
    signal: 'harvest',
    ready: (w) => w.fixtureInReach,
    seek: 'WALK UP TO A FLAME OR A BARREL AND FACE IT',
    giveUpS: 50,
  },
];

/**
 * Where the completion lives.
 *
 * Versioned in the key rather than in a field, so a later rewrite of the script
 * is a new key and every player sees the new one exactly once — which is the
 * only migration a first-run flow can honestly have.
 *
 * It is a `stepper-mage.` key, so `collectSave` carries it in a beta checkpoint;
 * it is also in that module's `EXCLUDED` list, for the reason the activation flag
 * is — a save rolled back to before this shipped must not make a player who has
 * already been taught sit through it again.
 */
export const ONBOARDING_KEY = 'stepper-mage.onboarding.v1';

const read = (): string | null => {
  try { return localStorage.getItem(ONBOARDING_KEY); } catch { return null; }
};

const write = (v: string): void => {
  try { localStorage.setItem(ONBOARDING_KEY, v); } catch { /* private mode */ }
};

/**
 * The live flow: which beat is up, what it says, and when it is over.
 *
 * A class and not a module of functions because there is one of these per
 * session and it has a clock. It owns no game state and cannot write any — the
 * game asks it for a line and tells it what the player did, and that is the
 * whole of the contract.
 */
export class Onboarding {
  /** Fired as each beat becomes the live one, including the first. */
  onStep: ((step: OnboardingStep, index: number) => void) | null = null;
  /** Fired once, whichever way the flow ended. */
  onEnd: ((how: 'done' | 'skipped', reached: number) => void) | null = null;

  private i = 0;
  /** Seconds this beat has been up and askable. */
  private t = 0;
  private ended: 'done' | 'skipped' | null = null;
  /** Has the first beat been announced? See `update`. */
  private opened = false;

  /**
   * @param world  the five booleans, read fresh whenever they are needed.
   * @param learnt this save has played before, so there is nothing to teach.
   *
   * `learnt` is what keeps this off an EXISTING player's screen. The completion
   * key is absent from every save written before it existed, so without it the
   * flow would open on somebody with ten runs behind them and tell them how to
   * walk. A save that has finished a run has been taught by playing, which is
   * the strongest evidence available and the only kind there is.
   */
  constructor(private world: () => OnboardingWorld, learnt = false) {
    const saved = read();
    if (saved === 'done' || saved === 'skipped') this.ended = saved;
    else if (learnt) { this.ended = 'done'; write('done'); }
  }

  /** Is the flow still running? */
  get live(): boolean {
    return this.ended === null;
  }

  get step(): OnboardingStep | null {
    return this.live ? ONBOARDING_STEPS[this.i] ?? null : null;
  }

  /**
   * The one line to draw, or null when there is nothing to say.
   *
   * Three sentences per beat and only ever one of them on screen: what to do,
   * what to do to be ABLE to do it, or the same thing said harder. The order
   * matters — a step whose gesture is unavailable must not restate an
   * instruction that cannot be followed, however long it has been up.
   */
  get line(): string | null {
    const step = this.step;
    if (!step) return null;
    if (step.ready && !step.ready(this.world())) return step.seek ?? step.text;
    return this.t >= RESTATE_S ? step.nudge : step.text;
  }

  /**
   * Tick the beat's clock and answer the state-shaped beats.
   *
   * `awake` is false while a modal owns the screen — the roster at the mouth, an
   * altar's three cards, the settings panel, a cut, a finished run. Those are
   * time the player is not being asked to perform a gesture, so charging the
   * clock for them would restate an instruction they cannot even see, and give
   * up on beats they never had a chance at.
   */
  update(dt: number, awake: boolean): void {
    if (!this.live || !awake) return;
    if (!this.opened) {
      this.opened = true;
      this.onStep?.(ONBOARDING_STEPS[0], 0);
    }
    const step = this.step;
    if (!step) return;
    if (step.satisfied?.(this.world())) { this.advance(); return; }
    this.t += dt;
    if (step.giveUpS !== undefined && this.t >= step.giveUpS) this.advance();
  }

  /**
   * The player did something. Ends the current beat if that is what it was
   * waiting for, and is otherwise ignored.
   *
   * Ignored and not queued, deliberately: a cast that happens during the tear
   * beat does not also tick the cast beat off, because the beat after it is
   * still going to ask for one and a lesson credited before it was taught is a
   * lesson skipped. The state-shaped beats (`satisfied`) are the two where doing
   * it early genuinely does count, and they say so.
   */
  note(beat: OnboardingBeat): void {
    if (this.live && this.step?.signal === beat) this.advance();
  }

  /**
   * WILL THE BOOK REFUSE A PAGE RIGHT NOW?
   *
   * The whole of the flow's input gating, and it is one question about one beat
   * rather than a system, because the game already does the rest of the job. The
   * script's order is the order the game reveals itself in: `bookOnScreen` keeps
   * the grimoire down until something is aimed at, so there is nothing to tear
   * before the aim beat; the CAST key is not drawn until a component is held. A
   * lock per control would be a second copy of rules that already hold.
   *
   * What is left is the one case where the world hands a first-timer a control
   * ahead of the script: a hostile already coming for you at the mouth is
   * auto-aimed (`refreshTargets`), which raises the book under a thumb that is
   * still being told how to walk. Refusing it there is the same call
   * `Hud.bookBusy` makes about the empty hand slots — two instructions at the
   * moment the player has read none is one too many.
   *
   * IT LASTS ONE BEAT AND `HOLD_BOOK_S` SECONDS, whichever ends first, and that
   * is deliberate rather than lazy. The refusal is only worth what it buys — one
   * clear instruction — and it is spent the instant that instruction has been
   * obeyed. Held through the turn and aim beats it would be several seconds of
   * the game saying no to the most inviting thing on the screen; held for the
   * whole of the beat's give-up it would outlast an entire playable ad, which
   * runs this same code (`src/playable/`) with about fifteen seconds to work in.
   * So a player who ignores the line gets the book anyway, and the flow goes on
   * asking for the step without holding anything hostage for it.
   */
  holdsBook(): boolean {
    return !!this.step?.holdsBook && this.t < HOLD_BOOK_S;
  }

  /** Take the way out. */
  skip(): void {
    if (this.live) this.finish('skipped');
  }

  /**
   * Run it again from the top — the debug replay, reached through
   * `window.__game.replayOnboarding()`.
   *
   * It clears the key as well as the in-memory state, so a reload replays it
   * too. Anything less makes "replay the tutorial" a thing you can only do once
   * per page load, which is the wrong half of the feature.
   */
  replay(): void {
    try { localStorage.removeItem(ONBOARDING_KEY); } catch { /* private mode */ }
    this.ended = null;
    this.i = 0;
    this.t = 0;
    this.opened = false;
  }

  private advance(): void {
    this.i++;
    this.t = 0;
    if (this.i >= ONBOARDING_STEPS.length) { this.finish('done'); return; }
    this.onStep?.(ONBOARDING_STEPS[this.i], this.i);
  }

  private finish(how: 'done' | 'skipped'): void {
    const reached = this.i;
    this.ended = how;
    write(how);
    this.onEnd?.(how, reached);
  }
}
