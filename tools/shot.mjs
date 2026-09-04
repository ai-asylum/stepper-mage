/**
 * Screenshot harness. Boots the dev server in a headless Chrome at a phone
 * viewport, waits for the first frames to settle, and writes PNGs to _shots/.
 *
 * Usage:
 *   node tools/shot.mjs                      # one shot of the default view
 *   node tools/shot.mjs --steps "F,F,R,F"    # drive the player first
 *   node tools/shot.mjs --name lobby --wait 2500
 *   node tools/shot.mjs --seq                # a walk-through strip of shots
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const has = (k) => args.includes(`--${k}`);

const PORT = 5199;
const OUT = path.resolve('_shots');
mkdirSync(OUT, { recursive: true });

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve();
      } catch { /* not up yet */ }
      if (Date.now() - start > timeoutMs) return reject(new Error('dev server never came up'));
      setTimeout(tick, 250);
    };
    tick();
  });
}

const url = `http://localhost:${PORT}/`;
let server = null;
try {
  await fetch(url);
} catch {
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore', detached: false,
  });
}
await waitForServer(url);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

/**
 * These shots are of the ART, and a throwaway browser profile is a first-time
 * player — so without this every one of them carries the guided descent's
 * instruction across the middle of the frame (`src/game/onboarding.ts`). To
 * shoot the flow itself, drop this line or call
 * `window.__game.replayOnboarding()` once the game is up.
 */
await page.addInitScript(() => {
  try { localStorage.setItem('stepper-mage.onboarding.v1', 'done'); } catch { /* private mode */ }
});

await page.goto(url, { waitUntil: 'networkidle' });
// The world is built on boot (procedural textures take a moment); give it room.
await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(Number(arg('wait', 2200)));

const KEY = { F: 'ArrowUp', B: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight' };
async function drive(seq) {
  for (const raw of seq.split(',')) {
    const s = raw.trim().toUpperCase();
    if (!s) continue;
    if (KEY[s]) {
      await page.keyboard.press(KEY[s]);
      await page.waitForTimeout(280);
    } else if (/^\d+$/.test(s)) {
      await page.waitForTimeout(Number(s));
    }
  }
}

const shot = async (name) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('shot:', file);
};

if (has('tour')) {
  // Judge the art from vantage points that actually show depth, not from
  // whatever wall the spawn faces.
  const views = await page.evaluate(() => window.__game.bestViews());
  for (const v of views) {
    await page.evaluate(([x, y, d]) => window.__game.place(x, y, d), [v.x, v.y, v.dir]);
    await page.waitForTimeout(700);
    await shot(`tour-${v.name}-len${v.len}`);
  }
} else if (has('at')) {
  const [x, y, d] = arg('at', '1,1,0').split(',').map(Number);
  await page.evaluate(([x, y, d]) => window.__game.place(x, y, d), [x, y, d]);
  await page.waitForTimeout(700);
  await shot(arg('name', `at-${x}-${y}-${d}`));
} else if (has('seq')) {
  // A short walk so one command produces a strip showing lighting at range,
  // a corner, and a room reveal.
  await shot('01-spawn');
  await drive('F,F');
  await shot('02-forward');
  await drive('R,F,F');
  await shot('03-corner');
  await drive('L,F,F,F');
  await shot('04-deeper');
} else {
  const steps = arg('steps', '');
  if (steps) await drive(steps);
  await shot(arg('name', 'shot'));
}

if (errors.length) {
  console.log('\n--- page errors ---');
  for (const e of errors.slice(0, 12)) console.log(e);
  process.exitCode = 1;
}

await browser.close();
if (server) server.kill();
