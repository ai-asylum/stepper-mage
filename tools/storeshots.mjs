/**
 * Capture Play-listing screenshots from the locally running game.
 *
 *   node tools/storeshots.mjs
 *
 * Writes `store/shots/NN-<name>.png`.
 *
 * Shoots the `#stage` ELEMENT rather than the viewport. The stage clamps itself
 * to an aspect between 0.42 and 0.52 (`core/engine.ts`) and `#app` insets it for
 * the phone safe area, so a full-page shot is the game inside two sets of black
 * bars — which Play would happily accept and which would look like a mistake.
 * The element rect is the game and nothing else.
 *
 * Play's phone spec: 320–3840px per side, aspect no wider than 2:1. The stage's
 * own 0.52 is 1:1.92, so every shot is in spec by construction.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const PORT = 5197;
const OUT = path.resolve('store/shots');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const url = `http://localhost:${PORT}/`;
let server = null;
try {
  await fetch(url);
} catch {
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore', detached: false,
  });
}
const start = Date.now();
for (;;) {
  try { if ((await fetch(url)).ok) break; } catch { /* not up */ }
  if (Date.now() - start > 30000) throw new Error('dev server never came up');
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 520, height: 1000 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
// Procedural tiles and sprites are built on entry; the first frames are a
// half-lit room.
await page.waitForTimeout(3500);

let n = 0;
const shot = async (name) => {
  n += 1;
  // SWIPE TO MOVE hangs over the middle of the frame until the player moves, and
  // `place()` teleports without counting as a move. Cleared HERE rather than once
  // at the top because `enterFloor` builds a fresh HUD, so every floor change
  // brings the tutorial caption back — which is exactly how it survived the first
  // fix and landed across the best shot in the set.
  await page.evaluate(() => { window.__game.hud.hasMoved = true; });
  await page.waitForTimeout(250);
  const file = path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`);
  await page.locator('#stage').screenshot({ path: file });
  console.log(`  ${path.basename(file)}`);
};

/** Stand where the art reads: the longest sightline on the floor. */
const bestView = async (i = 0) => {
  const v = await page.evaluate((k) => {
    const views = window.__game.bestViews();
    return views[Math.min(k, views.length - 1)];
  }, i);
  await page.evaluate(([x, y, d]) => window.__game.place(x, y, d), [v.x, v.y, v.dir]);
  await page.waitForTimeout(900);
  return v;
};

/**
 * Get past the wizard roster into an actual run.
 *
 * The roster opens on boot, and a card TAP only peeks — the confirm button is
 * drawn centred under the copy, so it is found by scanning the hit map rather
 * than by recomputing `hud.ts`'s geometry here. Two copies of that arithmetic is
 * how a capture script silently starts shooting the wrong screen.
 */
await page.evaluate(() => window.__game.tapHud(150, 185));
await page.waitForTimeout(900);
const pickY = await page.evaluate(() => {
  for (let y = 200; y < 990; y += 4) {
    if (window.__game.hudAt(260, y) === 'wizardPick') return y;
  }
  return -1;
});
if (pickY < 0) throw new Error('never found the wizard confirm button');
await page.evaluate((y) => window.__game.tapHud(260, y), pickY);
await page.waitForTimeout(1500);

/**
 * Pin the dungeon.
 *
 * `runSeed` is `Date.now()`-derived, so every capture run built a different
 * floor and `bestViews()` pointed somewhere else — one pass framed a boss, the
 * next framed the back of a lamp post. A fixed seed makes the shots
 * reproducible, which is the only way "retake it, that one is blocked" is a
 * thing anyone can act on.
 */
await page.evaluate(async () => { await window.__game.setSeed('store-shots-2'); });
await page.waitForTimeout(4000);

// A full book reads as a game with content; an empty one reads as a demo.
await page.evaluate(() => window.__game.grantAll());
await page.evaluate(() => window.__game.grantStars(24));
await page.waitForTimeout(800);

await bestView(0);
await shot('descent');

// The grimoire open, mid-hand: the one screen that says what the game IS.
await page.evaluate(async () => { await window.__game.selectPages(['fire', 'frost']); });
await page.waitForTimeout(1800);
await shot('grimoire');
await page.evaluate(() => window.__game.returnHand());
await page.waitForTimeout(900);

/**
 * The altar chooser — the run's decision point.
 *
 * Claiming an altar is gated on reach ("adjacent, and faced"), and `place()` does
 * not care where the altar is, so the first attempt just photographed the refusal
 * caption. Rather than reimplement `inReach` and the DIR_VEC mapping out here,
 * stand on each of the four neighbours in each of the four facings and let the
 * game itself say which one worked — it returns the offers or it returns null.
 */
const gotAltar = await page.evaluate(() => {
  const g = window.__game;
  const a = g.altars();
  if (!a.length) return false;
  const alt = a[0];
  const tx = alt.sprite.tx, ty = alt.sprite.ty;
  for (const [ox, oy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const px = tx - ox, py = ty - oy;
    if (!g.floor.grid.walkable(px, py)) continue;
    for (let d = 0; d < 4; d++) {
      g.place(px, py, d);
      if (g.openAltar(alt)) return true;
    }
  }
  return false;
});
if (!gotAltar) console.log('  ! altar never opened');
await page.waitForTimeout(1400);
if (gotAltar) await shot('altar');
await page.evaluate(() => { window.__game.hud.offers = null; });
await page.waitForTimeout(500);

/**
 * The star tree — the reason to come back.
 *
 * `openTree` returns early unless `dead`: the tree is the screen a run ends on,
 * not a pause menu. So the run has to be ended first, and the end card cleared,
 * or the shot is the death card with the tree behind it.
 */
await page.evaluate(() => window.__game.endRun('died'));
// The death sequence runs a 1.5s fall before it settles, and `openTree` is a
// no-op until the run is actually over — a single call right after `endRun`
// lands inside that window about half the time. Poll instead of guessing a
// sleep long enough to cover it.
let treeUp = false;
for (let i = 0; i < 20 && !treeUp; i++) {
  treeUp = await page.evaluate(() => {
    const g = window.__game;
    g.hud.runEnd = null;
    return !!g.openTree();
  });
  if (!treeUp) await page.waitForTimeout(300);
}
if (!treeUp) console.log('  ! star tree never opened');
await page.waitForTimeout(1200);
await shot('startree');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
await page.waitForTimeout(3500);
await page.evaluate(() => window.__game.tapHud(150, 185));
await page.waitForTimeout(900);
const y2 = await page.evaluate(() => {
  for (let y = 200; y < 990; y += 4) if (window.__game.hudAt(260, y) === 'wizardPick') return y;
  return -1;
});
await page.evaluate((y) => window.__game.tapHud(260, y), y2);
await page.waitForTimeout(1500);
await page.evaluate(() => window.__game.grantAll());

// Depth changes the palette (`art/theme.ts`), so a deep floor is a visibly
// different room rather than the same stone twice.
await page.evaluate(() => window.__game.goToDepth(6));
await page.waitForTimeout(4500);
/**
 * Frame a CREATURE, not the longest corridor.
 *
 * `bestViews()` optimises for sightline length, which reliably finds the emptiest
 * room on the floor — a big handsome shot of nothing. A store screenshot needs a
 * subject, so this walks back down each axis from a live hostile until the tiles
 * between are clear and stands there facing it.
 */
const framedEnemy = await page.evaluate(() => {
  const g = window.__game;
  const grid = g.floor.grid;
  const foes = g.floor.entities.filter((e) => e.alive && e.hostile);
  if (!foes.length) return false;
  const UNITS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  // No assumption about which facing index means which direction: stand on each
  // candidate tile, then ask the grid's own raycast which of the four facings
  // actually has the creature in it. Deriving the mapping by hand is what put
  // the camera inside a hedge twice.
  for (const foe of foes) {
    const tx = foe.sprite.tx, ty = foe.sprite.ty;
    for (const [dx, dy] of UNITS) {
      // Never closer than four tiles: a creature sprite at two tiles fills the
        // whole frame and photographs as abstract noise.
        for (const back of [6, 5, 4]) {
        const px = tx + dx * back, py = ty + dy * back;
        if (!grid.walkable(px, py)) continue;
        for (let look = 0; look < 4; look++) {
          const ray = grid.rayTiles(px, py, look, back + 1);
          if (!ray.some(([rx, ry]) => rx === tx && ry === ty)) continue;
          g.place(px, py, look);
          return { x: px, y: py, look, back, foe: foe.spriteId };
        }
      }
    }
  }
  return false;
});
console.log('  framed:', JSON.stringify(framedEnemy));
if (!framedEnemy) { console.log('  ! no creature to frame — falling back'); await bestView(0); }
await page.waitForTimeout(1200);
await shot('deep');

if (errors.length) {
  console.log('\n--- page errors ---');
  for (const e of errors.slice(0, 10)) console.log(e);
  process.exitCode = 1;
}

const box = await page.locator('#stage').boundingBox();
console.log(`\nstage ${Math.round(box.width)}×${Math.round(box.height)} css → `
  + `${Math.round(box.width * 2)}×${Math.round(box.height * 2)} px `
  + `(ratio 1:${(box.height / box.width).toFixed(2)})`);

await browser.close();
if (server) server.kill();
