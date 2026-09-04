/**
 * Shared plumbing for the verification harnesses.
 *
 * This repo has no test suite, so `playtest`, `booktest` and `fullrun` ARE the
 * contract — which is why the assertion ledger lives here instead of being
 * re-improvised three times. A harness that prints a wrong answer and exits 0 is
 * worse than no harness at all, so every conclusion goes through `check`, and
 * `finish` is what makes the shell notice.
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * 5199 unless told otherwise. Overridable because `serve()` REUSES anything
 * already listening — so a stale dev server from another checkout does not make
 * the harnesses fail, it makes them quietly measure a different app.
 */
export const PORT = Number(process.env.HARNESS_PORT ?? 5199);
export const URL = `http://localhost:${PORT}/`;
export const OUT = path.resolve('_shots');
mkdirSync(OUT, { recursive: true });

function waitForServer(timeoutMs = 40000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(URL);
        if (r.ok) return resolve();
      } catch { /* not up yet */ }
      if (Date.now() - start > timeoutMs) return reject(new Error('dev server never came up'));
      setTimeout(tick, 250);
    };
    tick();
  });
}

/**
 * Reuse a dev server if one is already listening, and only tear down one we
 * started ourselves — otherwise running a harness kills the server someone was
 * using. Same shape as `shot.mjs`.
 */
export async function serve() {
  let own = null;
  try {
    await fetch(URL);
  } catch {
    own = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  }
  await waitForServer();
  return () => { if (own) own.kill(); };
}

export function launch() {
  return chromium.launch({ channel: 'chrome', headless: true });
}

/**
 * Mark the guided first descent complete, so a harness measures the GAME.
 *
 * Every harness runs in a throwaway browser profile, which is an empty
 * localStorage, which is a first-time player — so without this each one boots
 * into the tutorial (`src/game/onboarding.ts`): an instruction across the middle
 * of every screenshot, and the flow's one gate holding the book shut until its
 * tear beat, which `selectPages` goes through.
 *
 * Written as an init script rather than after boot, because the flow reads the
 * key in its constructor. Pass `onboarding: true` to `openGame` to measure the
 * flow itself; `window.__game.replayOnboarding()` is the other way in.
 */
export const SKIP_ONBOARDING = () => {
  try { localStorage.setItem('stepper-mage.onboarding.v1', 'done'); } catch { /* private mode */ }
};

/**
 * A game in a fresh JS context.
 *
 * `freshSave` wipes localStorage before the app boots, which matters to anything
 * measuring the DEFAULT configuration: `meta.handSize` is persisted, so a stale
 * save silently changes the thing under test.
 *
 * `onboarding` opts INTO the guided first descent. Off by default, and that is
 * the deliberate direction: a harness asserting the core loop is not asserting
 * the tutorial, and the tutorial's own gate would refuse half of what one drives.
 */
export async function openGame(
  browser, { prefix = 'h', wait = 2600, freshSave = false, onboarding = false } = {},
) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|favicon/.test(m.text())) errors.push(m.text());
  });
  if (freshSave) {
    await page.addInitScript(() => { try { localStorage.clear(); } catch { /* private mode */ } });
  }
  // After the wipe, or `freshSave` would clear it straight back out again.
  if (!onboarding) await page.addInitScript(SKIP_ONBOARDING);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 40000 });
  await page.waitForTimeout(wait);
  const shot = async (n) => {
    await page.screenshot({ path: path.join(OUT, `${prefix}-${n}.png`) });
    console.log(`  shot ${prefix}-${n}`);
  };
  return { page, errors, shot, ev: (fn, ...a) => page.evaluate(fn, ...a) };
}

const ledger = [];

/** State a conclusion. This is the only way a harness is allowed to claim one. */
export function check(label, ok, detail = '') {
  ledger.push({ label, ok: !!ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  return !!ok;
}

/** An observation that is not a claim — measurements, capabilities not yet built. */
export function note(label, detail = '') {
  console.log(`  note  ${label}${detail ? '  — ' + detail : ''}`);
}

export function finish(errors = []) {
  check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  const failed = ledger.filter((r) => !r.ok);
  console.log(`\n${ledger.length} checks, ${failed.length} failed`);
  for (const f of failed) console.log('  FAILED: ' + f.label);
  if (failed.length) process.exitCode = 1;
}
