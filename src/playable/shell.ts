/**
 * The ad chrome that wraps the game inside a playable: store CTA, end card, and
 * the AppLovin analytics grid.
 *
 * Everything here is READ-ONLY with respect to the game — it polls the debug
 * handle `src/main.ts` already publishes on `window.__game` rather than hooking
 * into the loop. That is deliberate: the creative must stay the shipped game,
 * and a shell that could mutate state is a shell that will eventually make the
 * ad demo something the store doesn't.
 */
import { THEMES } from '../art/theme';

/**
 * The real Play listing, injected by `scripts/build-playable.mjs`.
 *
 * NEVER a fake-door / *.vercel.app URL: that detours the click out of store
 * attribution, so the network bills the click and the install never maps back.
 */
declare const __PLAYABLE_STORE_URL__: string | undefined;

interface AdContainer {
  ALPlayableAnalytics?: { trackEvent?: (event: string) => void };
  mraid?: { open?: (url: string) => void };
  FbPlayableAd?: { onCTAClick?: () => void };
  onCTAClick?: () => void;
  install?: () => void;
  __PLAYABLE_STORE_URL__?: string;
  __game?: {
    state: { hp: number; depth: number };
    combat?: { bossDead?: boolean };
  };
}

const w = window as Window & AdContainer;

/**
 * Time-in-ad markers, in seconds after first input.
 *
 * AppLovin has no native time-spent metric and its event list is fixed, so the
 * three CHALLENGE_PASS_* events are repurposed as a clock. This grid is
 * ORG-WIDE and must be byte-identical in every ai-asylum playable — a creative
 * binned at 20/30/40s would report "higher engagement" than one binned at
 * 60/180/300s purely from the bins, and campaigns stop being comparable. If it
 * ever changes, it changes in every live playable in the same release.
 */
const TIME_GRID: ReadonlyArray<[seconds: number, event: string]> = [
  [30, 'CHALLENGE_PASS_25'],
  [90, 'CHALLENGE_PASS_50'],
  [300, 'CHALLENGE_PASS_75'],
];

/** Seconds of play before the end card shows itself unprompted. */
const SOFT_TIMEOUT = 75_000;

/**
 * The object only exists inside AppLovin, and there is no guarantee it is
 * injected before this bundle runs — so events are buffered until it appears
 * rather than dropped. LOADED fires first and is the denominator for every
 * other event, so losing it to a race would skew the whole funnel.
 */
const pendingEvents: string[] = [];

function track(event: string): void {
  pendingEvents.push(event);
  flushEvents();
}

function flushEvents(): void {
  const sink = w.ALPlayableAnalytics?.trackEvent;
  if (typeof sink !== 'function') return;
  while (pendingEvents.length) {
    const event = pendingEvents.shift() as string;
    try { sink.call(w.ALPlayableAnalytics, event); } catch { /* container took it away */ }
  }
}

function storeUrl(): string {
  const injected = typeof __PLAYABLE_STORE_URL__ !== 'undefined'
    ? __PLAYABLE_STORE_URL__
    : w.__PLAYABLE_STORE_URL__;
  return injected ?? '';
}

/**
 * Open the store, trying every container hook in order so one build serves on
 * AppLovin, Meta, ironSource and a bare browser without a re-upload round.
 */
function openStore(): void {
  const url = storeUrl();
  // CTA_CLICKED is the REAL tap count — fire it before the container hook, and
  // hold it against the network's inflated "clicks" column.
  track('CTA_CLICKED');
  try {
    if (typeof w.mraid?.open === 'function') { w.mraid.open(url); return; }
    if (typeof w.FbPlayableAd?.onCTAClick === 'function') { w.FbPlayableAd.onCTAClick(); return; }
    if (typeof w.onCTAClick === 'function') { w.onCTAClick(); return; }
    if (typeof w.install === 'function') { w.install(); return; }
    window.open(url, '_blank');
  } catch {
    try { window.open(url, '_blank'); } catch { /* container blocked it */ }
  }
}

export function installShell(): void {
  track('LOADED');

  const cta = document.getElementById('cta') as HTMLButtonElement;
  const card = document.getElementById('endcard') as HTMLElement;
  const verdict = document.getElementById('ec-verdict') as HTMLElement;
  const again = document.getElementById('ec-again') as HTMLButtonElement;

  cta.addEventListener('click', openStore);
  (document.getElementById('ec-cta') as HTMLButtonElement).addEventListener('click', openStore);

  let shown = false;
  let pending = false;
  let dismissed = false;

  /**
   * `resumable` is false once the run is truly over — there is nothing behind
   * the card to go back to, so offering "keep playing" would only show the
   * player the game's own death screen with no way forward.
   */
  function end(line: string, resumable: boolean, delay: number, outcome?: string): void {
    if (shown || pending) return;
    pending = true;
    window.setTimeout(() => {
      pending = false;
      shown = true;
      if (outcome) track(outcome);
      verdict.textContent = line;
      again.style.display = resumable ? '' : 'none';
      card.style.display = 'flex';
      // Force a reflow so the opacity transition has a start value, then reveal
      // synchronously. Doing this in requestAnimationFrame is the idiomatic
      // version, but ad WebViews throttle rAF hard (and stop it entirely while
      // the SDK animates its own chrome) — an end card stuck at opacity 0 is an
      // invisible CTA, which is the one failure this creative cannot have.
      void card.offsetHeight;
      card.classList.add('show');
      track('ENDCARD_SHOWN');
    }, delay);
  }

  again.addEventListener('click', () => {
    track('CHALLENGE_RETRY');
    card.classList.remove('show');
    window.setTimeout(() => { card.style.display = 'none'; }, 400);
    shown = false;
    dismissed = true;
  });

  // ---- first input starts the clock ------------------------------------
  //
  // The grid timers are deliberately NOT cancelled by the end card: a player who
  // taps "keep playing" is still in the ad, and truncating their session at the
  // card would under-report exactly the engagement we are trying to measure.
  let started = false;
  const onFirstInput = (): void => {
    if (started) return;
    started = true;
    track('CHALLENGE_STARTED');
    cta.classList.add('in');
    for (const [seconds, event] of TIME_GRID) {
      window.setTimeout(() => track(event), seconds * 1000);
    }
    window.setTimeout(() => end('Five floors, a boss on each', true, 0), SOFT_TIMEOUT);
  };
  for (const type of ['pointerdown', 'keydown'] as const) {
    window.addEventListener(type, onFirstInput, { once: true, capture: true });
  }

  // ---- end states -------------------------------------------------------
  let lastDepth = 1;
  window.setInterval(() => {
    // Doubles as the drain for anything buffered before the container injected
    // its analytics object.
    flushEvents();
    const g = w.__game;
    if (!g?.state) return;
    // Death is terminal: it shows the card even after a dismissal.
    if (g.state.hp <= 0) {
      end('The dungeon keeps its pages', false, 1400, 'CHALLENGE_FAILED');
      return;
    }
    // Clearing the last floor's boss is the only true win. In a 75s ad it is
    // effectively unreachable, but an unreported win would be a silent hole in
    // the funnel if the demo is ever lengthened.
    if (g.state.depth >= THEMES.length && g.combat?.bossDead) {
      end('The vault is yours', false, 900, 'CHALLENGE_SOLVED');
      return;
    }
    if (dismissed) return;
    if (g.state.depth > lastDepth) {
      lastDepth = g.state.depth;
      end(`Floor ${lastDepth} — it goes much deeper`, true, 900);
    }
  }, 120);
}
