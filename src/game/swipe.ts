/**
 * WHAT COUNTS AS A SWIPE — one definition, read by the input handler and by the
 * settings panel that names it.
 *
 * This lived in `main.ts`, which is the entry point: the HUD cannot import from it
 * without a cycle, so the panel printed a percentage while the game measured
 * pixels, and the two could never disagree out loud. They are the same numbers now.
 */

/**
 * HOW FAR A FINGER HAS TO TRAVEL BEFORE IT IS A MOVE.
 *
 * A press that travels less than this is a tap and resolves against the HUD;
 * anything more is a swipe and steps or turns you. It was fixed at 24px, and a
 * swipe that fell short did nothing at all — no step, and no tap either, because
 * there was nothing under the finger to hit. Silent, and indistinguishable from
 * the game ignoring you.
 *
 * DISTANCE, AND ONLY DISTANCE. The same setting used to widen a time window as
 * well — how long the finger was allowed to take — so it meant two things at once
 * and felt like it was measuring how hard or how fast you flicked. It never
 * measured pressure and now it cannot: the window is the constant below.
 *
 * Stored 0..100 so no save needs migrating; the panel prints the pixels. 50 is the
 * default and is exactly the old 24px, so an untouched save plays identically.
 *
 * The ends are wider than the 38/10 they replaced, which could not be told apart:
 * the slider's whole travel moved the threshold by 28px, most of it in a range any
 * deliberate swipe clears anyway.
 */
export const SWIPE_SENS_DEFAULT = 50;
/** Travel in px at sensitivity 0 and 100. Chosen so the midpoint is exactly 24. */
export const SWIPE_PX_AT_0 = 40;
export const SWIPE_PX_AT_100 = 8;

/**
 * HOW LONG THE FINGER MAY TAKE — a constant, and not the slider's business.
 *
 * This ran 550ms..1000ms off the same setting, which is what made the control read
 * as "how hard did you flick": at a low setting a slow, deliberate swipe was thrown
 * away however far it travelled, so moving the slider changed whether a gesture
 * worked for a reason that had nothing to do with distance.
 *
 * A window still exists, and generously, because it is what separates a swipe from
 * a PEEK — the world-area drag that turns your head without turning you. Without
 * one, every look around a room would end in a step. 900ms is longer than the old
 * scale's midpoint, so the careful swipe that used to fail now lands.
 */
export const SWIPE_WINDOW_MS = 900;

export const clampSwipeSens = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n)
    ? Math.min(100, Math.max(0, Math.round(n)))
    : SWIPE_SENS_DEFAULT;
};

/** Pixels of travel required, for a given setting. */
export const swipeTravel = (sens: number): number =>
  SWIPE_PX_AT_0 + (SWIPE_PX_AT_100 - SWIPE_PX_AT_0) * (sens / 100);

/** The same number, rounded, for the readout that has to name it. */
export const swipeTravelPx = (sens: number): number => Math.round(swipeTravel(sens));
