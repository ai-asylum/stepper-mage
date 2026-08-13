/**
 * Render the store art from the game's own procedural wordmark.
 *
 *   node tools/genlogo.mjs
 *
 * Writes `assets/splash.png` and `assets/splash-dark.png` (2732², the size
 * `capacitor-assets` wants) plus `assets/icon.png`, which is the existing
 * 1024 app icon copied into place rather than redrawn.
 *
 * Headless rather than in Node because `Pix` and the wordmark's text mask are
 * built on `document.createElement('canvas')` — porting them to node-canvas
 * would be a second implementation of the logo, which is exactly the drift the
 * shared `buildSplash` exists to prevent. Vite serves the TypeScript, so the
 * page imports the same module the ad does.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const PORT = 5198;
const SIZE = 2732;
const OUT = path.resolve('assets');
const ICON_SRC = path.resolve('art/_work/raw/appicon.png');
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
  try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
  if (Date.now() - start > 30000) throw new Error('dev server never came up');
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'domcontentloaded' });

const dataUrl = await page.evaluate(async (size) => {
  const art = await import('/src/playable/art.ts');
  return art.buildSplash(size, 'UNBOUND', 'DESCENT').toDataURL('image/png');
}, SIZE);

if (errors.length) {
  console.error('page errors:\n  ' + errors.join('\n  '));
  process.exitCode = 1;
}

/**
 * The feature graphic is composed in the page, not in `art.ts`.
 *
 * The wordmark alone left the right 60% of a 1024×500 empty, which reads as
 * unfinished rather than as spacious. The grimoire from the app icon fills it
 * and is already the game's mark, so the banner and the launcher agree. The
 * icon is a served PNG rather than something `Pix` can draw, which is why the
 * compositing happens here where there is a real canvas and a real <img>.
 */
const featureUrl = await page.evaluate(async () => {
  const art = await import('/src/playable/art.ts');
  const base = art.buildFeature(1024, 500, 'UNBOUND', 'DESCENT');
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 500;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0);

  const img = new Image();
  img.src = '/icons/icon-512.png';
  await img.decode();
  // Right of the play-button overlay zone, and inset from the edge so a crop
  // on a narrow listing card cannot clip the book in half.
  // ADDITIVE, so the icon's own black square does not sit on the banner as a
  // visible box. The art is a lit book on near-black, so compositing with
  // 'lighter' keeps the glow and contributes nothing where the icon is dark —
  // the seam that a straight drawImage leaves is the background showing its
  // own edge, not a transparency problem to solve with alpha.
  const s = 400;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(img, 1024 - s - 60, (500 - s) / 2, s, s);
  ctx.globalCompositeOperation = 'source-over';
  return cv.toDataURL('image/png');
});

const png = Buffer.from(dataUrl.split(',')[1], 'base64');
// One image for both themes. The splash is already the manifest's dark
// background, so a separate light variant would either be a different design or
// the same file under two names; Capacitor needs the dark one to exist.
for (const name of ['splash.png', 'splash-dark.png']) {
  writeFileSync(path.join(OUT, name), png);
  console.log(`  assets/${name}  ${SIZE}×${SIZE}  ${(png.length / 1024).toFixed(0)} KB`);
}

const feature = Buffer.from(featureUrl.split(',')[1], 'base64');
writeFileSync(path.resolve('store/feature-graphic.png'), feature);
console.log(`  store/feature-graphic.png  1024×500  ${(feature.length / 1024).toFixed(0)} KB`);

// The icon is NOT redrawn. `art/_work/raw/appicon.png` is a designed grimoire
// that reads at 48px, and a procedural wordmark would not — text is illegible
// at launcher size, which is the one thing an app icon must survive.
if (existsSync(ICON_SRC)) {
  copyFileSync(ICON_SRC, path.join(OUT, 'icon.png'));
  copyFileSync(ICON_SRC, path.join(OUT, 'icon-foreground.png'));
  console.log('  assets/icon.png  (from art/_work/raw/appicon.png)');
} else {
  console.warn(`  ⚠ ${ICON_SRC} missing — icons will stay stock Capacitor`);
}

await browser.close();
if (server) server.kill();
