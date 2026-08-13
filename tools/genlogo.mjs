/**
 * Format the GENERATED art into the sizes the store and the shell need.
 *
 *   node tools/genlogo.mjs
 *
 * Inputs (all generated through Scenario, never drawn here):
 *   store/logo.png              the square logo
 *   art/_work/raw/feature-a.png the wide banner
 *   art/_work/raw/appicon.png   the launcher grimoire
 *
 * Outputs:
 *   assets/splash.png, assets/splash-dark.png   2732² for capacitor-assets
 *   assets/icon.png, assets/icon-foreground.png
 *   store/feature-graphic.png                   1024×500 for Play
 *
 * This file used to DRAW the splash and the banner with the Pix toolkit. It
 * does not any more: art is generated, and this only crops, scales and centres
 * it. Nothing here invents a pixel.
 *
 * Headless because scaling and cropping want a real canvas, and NEAREST is
 * forced throughout — the source is pixel art and a smooth resample turns it
 * into a blurry photograph of pixel art.
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const SPLASH = 2732;
const LOGO = path.resolve('store/logo.png');
const BANNER = path.resolve('art/_work/raw/feature-a.png');
const ICON_SRC = path.resolve('art/_work/raw/appicon.png');
const OUT = path.resolve('assets');
mkdirSync(OUT, { recursive: true });
mkdirSync(path.resolve('store'), { recursive: true });

for (const f of [LOGO, BANNER]) {
  if (!existsSync(f)) throw new Error(`missing ${f} — generate it first (tools/genlogoart.mjs)`);
}

const PORT = 5193;
const url = `http://localhost:${PORT}/`;
let server = null;
try { await fetch(url); } catch {
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore', detached: false,
  });
}
const t0 = Date.now();
for (;;) {
  try { if ((await fetch(url)).ok) break; } catch { /* not up */ }
  if (Date.now() - t0 > 30000) throw new Error('dev server never came up');
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });

const b64 = (f) => readFileSync(f).toString('base64');

const out = await page.evaluate(async ({ logoB64, bannerB64, splashSize }) => {
  const load = async (b) => {
    const im = new Image();
    im.src = `data:image/png;base64,${b}`;
    await im.decode();
    return im;
  };
  const logo = await load(logoB64);
  const banner = await load(bannerB64);

  // ---- splash: the logo centred on the manifest's ink ----------------------
  // capacitor-assets derives every density and both orientations by
  // CENTRE-CROPPING this square, so the logo is kept to the middle third —
  // anything near an edge is guaranteed to be cut on some device.
  const sc = document.createElement('canvas');
  sc.width = splashSize; sc.height = splashSize;
  const sctx = sc.getContext('2d');
  sctx.imageSmoothingEnabled = false;
  /**
   * Fill with the LOGO'S OWN corner colour, not the manifest ink.
   *
   * They are both "near black" and they are not the same near black, so filling
   * with #0a0710 drew a visible dark square around the logo on every density.
   * Sampling means the plate and the art agree by construction, whatever the
   * next generation's background happens to be.
   */
  const probe = document.createElement('canvas');
  probe.width = logo.width; probe.height = logo.height;
  const pctx = probe.getContext('2d');
  pctx.drawImage(logo, 0, 0);
  const [r, g, b] = pctx.getImageData(1, 1, 1, 1).data;
  sctx.fillStyle = `rgb(${r},${g},${b})`;
  sctx.fillRect(0, 0, splashSize, splashSize);
  // Whole-number upscale: the source is pixel art, and a fractional scale
  // resamples it off its own grid.
  const k = Math.max(1, Math.floor((splashSize * 0.42) / logo.width));
  const lw = logo.width * k, lh = logo.height * k;
  sctx.drawImage(logo, Math.round((splashSize - lw) / 2), Math.round((splashSize - lh) / 2), lw, lh);

  // ---- feature graphic: centre band of the banner, 1024×500 ---------------
  // The banner is 3:2 and Play wants 2.048:1, so a band is cropped rather than
  // the image squashed. Taken from the middle so the title and the corridor
  // both survive.
  const FW = 1024, FH = 500;
  const bandH = Math.round(banner.width / (FW / FH));
  const bandY = Math.round((banner.height - bandH) / 2);
  const fc = document.createElement('canvas');
  fc.width = FW; fc.height = FH;
  const fctx = fc.getContext('2d');
  fctx.imageSmoothingEnabled = false;
  fctx.drawImage(banner, 0, bandY, banner.width, bandH, 0, 0, FW, FH);

  return {
    splash: sc.toDataURL('image/png'),
    feature: fc.toDataURL('image/png'),
    logoScale: k,
    band: `${banner.width}×${bandH} @y${bandY}`,
  };
}, { logoB64: b64(LOGO), bannerB64: b64(BANNER), splashSize: SPLASH });

const write = (dataUrl, file) => {
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  writeFileSync(file, buf);
  console.log(`  ${file}  ${(buf.length / 1024).toFixed(0)} KB`);
};
const splashBuf = Buffer.from(out.splash.split(',')[1], 'base64');
for (const name of ['splash.png', 'splash-dark.png']) {
  writeFileSync(path.join(OUT, name), splashBuf);
  console.log(`  assets/${name}  ${SPLASH}×${SPLASH}  ${(splashBuf.length / 1024).toFixed(0)} KB  (logo ×${out.logoScale})`);
}
write(out.feature, path.resolve('store/feature-graphic.png'));
console.log(`  banner crop: ${out.band}`);

if (existsSync(ICON_SRC)) {
  copyFileSync(ICON_SRC, path.join(OUT, 'icon.png'));
  copyFileSync(ICON_SRC, path.join(OUT, 'icon-foreground.png'));
  console.log('  assets/icon.png  (from art/_work/raw/appicon.png)');
}

await browser.close();
if (server) server.kill();
