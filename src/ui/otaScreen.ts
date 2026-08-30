/**
 * THE UPDATE SCREEN — the one piece of UI that is not drawn by the game.
 *
 * Everything else the player sees is canvas: the HUD, the book, the cards. This
 * is DOM, and deliberately, for three reasons the canvas cannot satisfy.
 *
 *  - It has to be able to stand over a WebView that is ABOUT TO BE REPLACED.
 *    `fetchAndApplyNow` ends in `CapacitorUpdater.reload()`, which swaps the
 *    running bundle out; a canvas overlay dies with the frame loop that draws
 *    it, and the last thing the player would see is the game frozen mid-frame.
 *  - It has to paint BEFORE the game exists. An update is checked on cold start,
 *    which is ahead of the first floor and can be ahead of `Hud` entirely.
 *  - It has to be legible to the platform. A background download with no
 *    progress and no way to know the app is busy is the thing the stores object
 *    to; this says what is happening, how far along it is, and not to close the
 *    app — in words, not in the game's voice.
 *
 * Every function here is a no-op when the element is missing, so nothing has to
 * check whether it is on a device, in a test, or in a shell whose index.html is
 * older than this module.
 */

const el = (id: string): HTMLElement | null => document.getElementById(id);

/**
 * Nothing may leave the player stranded behind this.
 *
 * The download is the plugin's business once it starts and it does not promise
 * to fail loudly — a stalled socket on a bad connection is silent, and
 * `fetchAndApplyNow` swallows what it can see. So the screen is on a deadline:
 * if no progress arrives and nothing lowers it, it lowers itself and the player
 * carries on with the bundle they already have. A missed update is nothing; a
 * game that never starts is the whole game.
 */
const STALL_MS = 45_000;
let watchdog: ReturnType<typeof setTimeout> | null = null;

/** Restart the deadline. Called on every sign of life. */
function arm(): void {
  if (watchdog) clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    console.warn('[ota-screen] no progress for 45s — releasing the screen');
    hideOta();
  }, STALL_MS);
}

/** Raise the screen. Safe to call repeatedly. */
export function showOta(): void {
  const box = el('ota');
  if (!box) return;
  setOtaProgress(0);
  setOtaTitle('updating');
  box.classList.add('on');
  arm();
}

/**
 * The headline, in lower case like everything else on this screen.
 *
 * Two states worth naming: `updating` while bytes are moving, and `applying`
 * once they have all arrived — the gap between the last percent and the reload
 * is dead air otherwise, and dead air at 100% reads as a hang.
 */
export function setOtaTitle(text: string): void {
  const t = el('ota-title');
  if (t) t.textContent = text;
  arm();
}

/** Move the bar. `pct` is 0–100 and is clamped, because the plugin's is not. */
export function setOtaProgress(pct: number): void {
  const n = Math.max(0, Math.min(100, Math.round(pct)));
  const fill = el('ota-fill');
  const label = el('ota-pct');
  if (fill) fill.style.width = `${n}%`;
  if (label) label.textContent = `${n}%`;
  // Progress is the sign of life the deadline is waiting for.
  arm();
  // A finished download is not a finished update: the bundle still has to be set
  // and the WebView reloaded, and that is the part with no progress to report.
  if (n >= 100) setOtaTitle('applying');
}

/** Lower it. Also cancels the deadline, so a hidden screen holds no timer. */
export function hideOta(): void {
  if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  el('ota')?.classList.remove('on');
}

/** Is it up? Read by the boot overlay, which must not fight it for the screen. */
export function otaVisible(): boolean {
  return !!el('ota')?.classList.contains('on');
}
