/**
 * The ad chrome that wraps the game inside a playable: the store CTA, the
 * wordmark, and the AppLovin analytics grid.
 *
 * The CTA is an IN-WORLD interruption, not a screen change. On a cadence it
 * takes over the grimoire's half of the screen — the place the player's thumb
 * already lives — puts the logo up in the world above it, and offers a dismiss
 * exactly where the spellbook tab sits. Everything stays on one screen, and the
 * game keeps running behind it.
 *
 * The shell reads the game through the debug handle `src/main.ts` already
 * publishes on `window.__game` rather than hooking the loop, and it writes
 * exactly one thing back: it shuts the grimoire while the offer is up, and
 * restores it afterwards. That is the same flag the game's own spellbook tab
 * toggles, so the ad drives the game only through a control the player already
 * has — never through anything that could make the demo behave differently from
 * the shipped build.
 */
import { THEMES } from '../art/theme';
import {
  BUTTON_SCALE, buildCtaPlate, buildDismissPlate, buildLogo, fitScale,
} from './art';

/**
 * The real Play listing, injected by `scripts/build-playable.mjs`.
 *
 * NEVER a fake-door / *.vercel.app URL: that detours the click out of store
 * attribution, so the network bills the click and the install never maps back.
 */
declare const __PLAYABLE_STORE_URL__: string | undefined;

/** Working title stays in the repo; the creative ships the real name. */
const TITLE = 'SPELLTORN';
const SUBTITLE = 'DEEP';

interface AdContainer {
  ALPlayableAnalytics?: { trackEvent?: (event: string) => void };
  mraid?: { open?: (url: string) => void };
  FbPlayableAd?: { onCTAClick?: () => void };
  onCTAClick?: () => void;
  install?: () => void;
  __PLAYABLE_STORE_URL__?: string;
  __game?: {
    state: { hp: number; depth: number };
    combat?: { bossDead?: boolean; turns?: number };
    hud?: { bookClosed?: boolean; bookTop?: number };
    book?: { closed: boolean };
    engine?: { sw: number; sh: number };
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

/** The CTA re-offers itself on whichever of these comes first. */
const NAG_SECONDS = 15;
const NAG_ACTIONS = 15;

/** Geometry of the grimoire tab, mirrored from `Hud.drawBookToggle`. */
const TAB_H = 26;
const TAB_GAP = 8;

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

/** Paint a generated plate onto a button at an exact integer upscale. */
function plate(el: HTMLElement, art: HTMLCanvasElement, scale: number): void {
  el.style.backgroundImage = `url(${art.toDataURL()})`;
  el.style.width = `${art.width * scale}px`;
  el.style.height = `${art.height * scale}px`;
}

export function installShell(): void {
  track('LOADED');

  const zone = document.getElementById('cta-zone') as HTMLElement;
  const ctaBtn = document.getElementById('cta') as HTMLButtonElement;
  const dismissBtn = document.getElementById('cta-dismiss') as HTMLButtonElement;
  const logo = document.getElementById('logo') as HTMLElement;
  const card = document.getElementById('endcard') as HTMLElement;
  const verdict = document.getElementById('ec-verdict') as HTMLElement;
  const again = document.getElementById('ec-again') as HTMLButtonElement;

  // ---- pixel art -------------------------------------------------------
  plate(ctaBtn, buildCtaPlate(58, 15), BUTTON_SCALE);
  plate(dismissBtn, buildDismissPlate(42, 8), BUTTON_SCALE);
  const mark = buildLogo(TITLE, SUBTITLE);
  logo.style.backgroundImage = `url(${mark.toDataURL()})`;

  ctaBtn.addEventListener('click', openStore);
  (document.getElementById('ec-cta') as HTMLButtonElement).addEventListener('click', openStore);

  // ---- the in-world CTA ------------------------------------------------
  let offering = false;
  /**
   * Wall-clock stamp the current cadence started at.
   *
   * Deliberately NOT a per-tick accumulator: background tabs and ad WebViews
   * clamp timers to about a second, so adding a fixed step per tick made the
   * 15-second offer take over two minutes to appear.
   */
  let cadenceFrom = 0;
  let actionBase = 0;
  let started = false;

  const actions = (): number => w.__game?.combat?.turns ?? 0;

  /**
   * Park the CTA over the grimoire's footprint and the dismiss over its tab.
   *
   * `hud.bookTop` moves with the book, and when the book is shut it collapses
   * to almost nothing — so the offer is clamped to a minimum height. Otherwise
   * closing the spellbook, which is exactly when we most want to show the CTA,
   * would be when it had the least room to exist in.
   */
  function layout(): void {
    const g = w.__game;
    const h = g?.engine?.sh ?? window.innerHeight;
    const sw = g?.engine?.sw ?? window.innerWidth;
    const tabTop = h - TAB_H - TAB_GAP;
    const bookTop = g?.hud?.bookTop ?? Math.round(h * 0.62);
    zone.style.top = `${Math.min(bookTop, tabTop - 150)}px`;
    zone.style.bottom = `${TAB_H + TAB_GAP + 6}px`;
    dismissBtn.style.bottom = `${TAB_GAP}px`;

    const scale = fitScale(mark.width, sw);
    logo.style.width = `${mark.width * scale}px`;
    logo.style.height = `${mark.height * scale}px`;
  }

  /**
   * Whether the grimoire was open when the offer interrupted, so "keep playing"
   * hands the player back the screen they actually had rather than a fixed one.
   */
  let bookWasOpen = false;

  /** Drive the book through the same flag its own tab toggles. */
  function setBookClosed(closed: boolean): void {
    const g = w.__game;
    if (!g?.book || !g.hud) return;
    g.book.closed = closed;
    g.hud.bookClosed = closed;
  }

  function showOffer(): void {
    if (offering) return;
    offering = true;
    // Shut the grimoire rather than covering it: the offer wants the bottom of
    // the screen, and a CTA sitting on top of an open book reads as a misplaced
    // dialog instead of the game handing the space over.
    bookWasOpen = !w.__game?.book?.closed;
    setBookClosed(true);
    layout();
    zone.classList.add('show');
    logo.classList.add('show');
    dismissBtn.classList.add('show');
  }

  function hideOffer(): void {
    if (!offering) return;
    offering = false;
    cadenceFrom = Date.now();
    actionBase = actions();
    if (bookWasOpen) setBookClosed(false);
    zone.classList.remove('show');
    logo.classList.remove('show');
    dismissBtn.classList.remove('show');
  }

  dismissBtn.addEventListener('click', hideOffer);

  // ---- first input starts the clock ------------------------------------
  //
  // The grid timers are deliberately NOT cancelled by the end card: a player who
  // taps "keep playing" is still in the ad, and truncating their session at the
  // card would under-report exactly the engagement we are trying to measure.
  const onFirstInput = (): void => {
    if (started) return;
    started = true;
    actionBase = actions();
    cadenceFrom = Date.now();
    track('CHALLENGE_STARTED');
    for (const [seconds, event] of TIME_GRID) {
      window.setTimeout(() => track(event), seconds * 1000);
    }
  };
  for (const type of ['pointerdown', 'keydown'] as const) {
    window.addEventListener(type, onFirstInput, { once: true, capture: true });
  }

  // ---- end card (terminal states only) ---------------------------------
  let shown = false;
  let pending = false;

  /**
   * `resumable` is false once the run is truly over — there is nothing behind
   * the card to go back to, so offering "keep playing" would only show the
   * player the game's own death screen with no way forward.
   */
  function end(line: string, resumable: boolean, delay: number, outcome: string): void {
    if (shown || pending) return;
    pending = true;
    window.setTimeout(() => {
      pending = false;
      shown = true;
      hideOffer();
      track(outcome);
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
  });

  // ---- the tick ---------------------------------------------------------
  let wasBookClosed = false;

  window.setInterval(() => {
    // Doubles as the drain for anything buffered before the container injected
    // its analytics object.
    flushEvents();
    const g = w.__game;
    if (!g?.state) return;

    if (g.state.hp <= 0) {
      end('The dungeon keeps its pages', false, 1400, 'CHALLENGE_FAILED');
      return;
    }
    // Clearing the last floor's boss is the only true win. In a short ad it is
    // effectively unreachable, but an unreported win would be a silent hole in
    // the funnel if the demo is ever lengthened.
    if (g.state.depth >= THEMES.length && g.combat?.bossDead) {
      end('The vault is yours', false, 900, 'CHALLENGE_SOLVED');
      return;
    }
    if (shown) return;

    // Shutting the spellbook frees the bottom of the screen — take it.
    const closed = !!g.hud?.bookClosed;
    if (closed && !wasBookClosed) showOffer();
    wasBookClosed = closed;

    if (offering) { layout(); return; }
    if (!started) return;

    const elapsed = Date.now() - cadenceFrom;
    if (elapsed >= NAG_SECONDS * 1000 || actions() - actionBase >= NAG_ACTIONS) showOffer();
  }, 120);
}
