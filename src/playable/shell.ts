/**
 * The ad chrome that wraps the game inside a playable: the store CTA, the
 * wordmark, and the AppLovin analytics grid.
 *
 * On a cadence the offer TAKES THE SCREEN: the HUD canvas is hidden, the room
 * dims to a backdrop, and the wordmark and two buttons are all that is left.
 *
 * It used to be an in-world panel over the grimoire's half of the frame with
 * the game live behind it. That failed on both halves of the promise — the
 * wordmark landed on top of whatever the HUD was drawing (the altar's three
 * cards, most visibly), and because the game binds its pointer handlers to
 * `#stage`, every tap on the offer ALSO reached the dungeon underneath. The
 * player kept playing a game they could not see.
 *
 * The shell reads the game through the debug handle `src/main.ts` already
 * publishes on `window.__game` rather than hooking the loop, and it writes
 * exactly one thing back: it shuts the grimoire while the offer is up, and
 * restores it afterwards. That is the same flag the game's own spellbook tab
 * toggles, so the ad drives the game only through a control the player already
 * has — never through anything that could make the demo behave differently from
 * the shipped build. Input is stopped the same way: by swallowing events on the
 * way to the game's own listeners, never by disabling them.
 */
import { THEMES } from '../art/theme';
import { buildCtaPlate, buildDismissPlate, buildLogo, fitScale } from './art';

/**
 * The real Play listing, injected by `scripts/build-playable.mjs`.
 *
 * NEVER a fake-door / *.vercel.app URL: that detours the click out of store
 * attribution, so the network bills the click and the install never maps back.
 */
declare const __PLAYABLE_STORE_URL__: string | undefined;

/** The shipping name, matching `capacitor.config.ts` and the Play listing. */
const TITLE = 'UNBOUND';
const SUBTITLE = 'DESCENT';

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
    hud?: { bookClosed?: boolean };
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

/**
 * Size a generated plate at an exact integer upscale of its own art.
 *
 * Separate from painting it: the data URL is built once, but the size is
 * recomputed on every layout, and re-encoding a canvas eight times a second to
 * change a width would be an absurd way to spend an ad's frame budget.
 */
function size(el: HTMLElement, art: HTMLCanvasElement, scale: number): void {
  el.style.width = `${art.width * scale}px`;
  el.style.height = `${art.height * scale}px`;
}

export function installShell(): void {
  track('LOADED');

  const stage = document.getElementById('stage') as HTMLElement;
  const zone = document.getElementById('cta-zone') as HTMLElement;
  const ctaBtn = document.getElementById('cta') as HTMLButtonElement;
  const dismissBtn = document.getElementById('cta-dismiss') as HTMLButtonElement;
  const logo = document.getElementById('logo') as HTMLElement;
  const card = document.getElementById('endcard') as HTMLElement;
  const verdict = document.getElementById('ec-verdict') as HTMLElement;
  const again = document.getElementById('ec-again') as HTMLButtonElement;

  // ---- pixel art -------------------------------------------------------
  const ctaArt = buildCtaPlate(58, 15);
  const dismissArt = buildDismissPlate(42, 8);
  const mark = buildLogo(TITLE, SUBTITLE);
  ctaBtn.style.backgroundImage = `url(${ctaArt.toDataURL()})`;
  dismissBtn.style.backgroundImage = `url(${dismissArt.toDataURL()})`;
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
   * Size the three plates to the stage.
   *
   * The column itself is centred by CSS — there is nothing left to chase now
   * that the offer owns the screen instead of borrowing the grimoire's corner
   * of it. Each plate takes the largest WHOLE upscale of its art that still
   * fits: the store button is allowed to go bigger than the art's authored 4x,
   * because on a phone it is the only thing on screen that must be hit.
   */
  function layout(): void {
    const sw = w.__game?.engine?.sw ?? window.innerWidth;
    size(logo, mark, fitScale(mark.width, sw));
    size(ctaBtn, ctaArt, fitScale(ctaArt.width, sw, 6));
    size(dismissBtn, dismissArt, fitScale(dismissArt.width, sw, 5));
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
    // Shut the grimoire on the way in so the player is handed back a closed
    // book, not a half-cast spell they had already forgotten choosing.
    bookWasOpen = !w.__game?.book?.closed;
    setBookClosed(true);
    layout();
    // `offering` on the stage is what hides the HUD canvas. The world keeps
    // rendering underneath, dimmed by the zone's scrim — a still frame behind
    // the wordmark is the point, an empty black rectangle is not.
    stage.classList.add('offering');
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
    stage.classList.remove('offering');
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
   * Whether the card is on screen RIGHT NOW, which is not the same as `shown`:
   * `shown` latches forever so the card is offered once per session, and
   * blocking the keyboard on it would leave the game deaf after "keep playing".
   */
  let cardUp = false;

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
      cardUp = true;
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
    cardUp = false;
    card.classList.remove('show');
    window.setTimeout(() => { card.style.display = 'none'; }, 400);
  });

  // ---- the offer owns the input while it is up --------------------------
  //
  // The game binds pointer/wheel to `#stage` and keys to `window`, and both the
  // zone and the card are children of `#stage` — so without this, every tap on
  // the offer landed in the dungeon as well. Two shields, because there are two
  // targets to shield from:
  //
  //   - Bubble-phase on the overlays. A button's own handler runs at the target
  //     first, so Play Free and Keep Playing still work; everything above them
  //     stops here and never reaches #stage.
  //   - Capture-phase on window for keys, which no element can stand in front
  //     of. Capture runs before the game's bubble-phase listener, so this is the
  //     only place they CAN be stopped.
  const swallow = (e: Event): void => { e.stopPropagation(); };
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'click'] as const) {
    zone.addEventListener(type, swallow);
    card.addEventListener(type, swallow);
  }
  window.addEventListener('keydown', (e) => {
    if (!offering && !cardUp) return;
    // Except for the offer's own buttons: a focused Play Free still has to take
    // Enter and Space, and blanket-preventing keys would swallow exactly the two
    // presses the offer exists to receive.
    const target = e.target as Node | null;
    if (target && (zone.contains(target) || card.contains(target))) return;
    e.stopPropagation();
    e.preventDefault();
  }, { capture: true });

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

    /**
     * IS THE NAG DUE? One answer, asked by both triggers.
     *
     * This used to be two rules and only one of them had a cadence. Shutting the
     * grimoire fired the offer unconditionally, on the theory that a closed book
     * frees the bottom of the screen — which is true, and would be fine in a game
     * where the book stays open. In THIS game the book is shut for most of every
     * turn: it only rises while a target is selected, so it closes again on
     * essentially every action, and the offer re-armed every time. Dismissing it put
     * it back within a second or two, which is why it read as permanently on screen.
     *
     * So the book closing is now an OPPORTUNITY to interrupt rather than a reason to.
     * It takes the space when the space comes free AND the nag is actually owed.
     */
    const due = Date.now() - cadenceFrom >= NAG_SECONDS * 1000
      || actions() - actionBase >= NAG_ACTIONS;

    // Nothing at all before the player has touched it once. `started` also gates the
    // very first tick, where a book that boots shut would otherwise fire the offer
    // over the top of the opening frame.
    const closed = !!g.hud?.bookClosed;
    if (started && due && closed && !wasBookClosed) showOffer();
    wasBookClosed = closed;

    if (offering) { layout(); return; }
    if (!started) return;
    if (due) showOffer();
  }, 120);
}
