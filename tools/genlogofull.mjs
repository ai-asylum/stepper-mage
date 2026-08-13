/**
 * Compose the finished logo from the generated emblem plus the game's wordmark.
 *
 *   node tools/genlogofull.mjs --emblem art/_work/raw/logo-a.png
 *
 * Writes `store/logo-emblem.png` (art alone, transparent) and
 * `store/logo-full.png` (emblem over the wordmark, on the game's ink).
 *
 * The split is deliberate. The EMBLEM comes from Scenario, which draws far
 * better than anything hand-plotted; the TYPE comes from `art.ts`, because
 * image models still letter unreliably and the game already has a wordmark
 * renderer that every other surface uses. Generating the two together would
 * mean regenerating the art every time the type changes, and paying for it.
 *
 * The model returns art on pure black rather than on alpha, so the background
 * is keyed out by luminance — dropped straight onto ink it shows as a black
 * square, because near-black is not the same black.
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => {
    if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1]]);
    return a;
  }, []),
);
const EMBLEM = path.resolve(args.emblem || 'art/_work/raw/logo-a.png');
const PORT = 5195;
mkdirSync('store', { recursive: true });

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
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'domcontentloaded' });

const emblemB64 = readFileSync(EMBLEM).toString('base64');

const result = await page.evaluate(async (b64) => {
  const art = await import('/src/playable/art.ts');
  const { Pix, Ramp, hex } = await import('/src/art/pixel.ts');

  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();

  // ---- key the black out and trim to the art -----------------------------
  const src = document.createElement('canvas');
  src.width = img.width; src.height = img.height;
  const sctx = src.getContext('2d');
  sctx.drawImage(img, 0, 0);
  const d = sctx.getImageData(0, 0, src.width, src.height);
  const px = d.data;
  let minX = src.width, minY = src.height, maxX = -1, maxY = -1;
  for (let i = 0; i < px.length; i += 4) {
    // Luminance rather than an exact match: the model's "black" is a spread of
    // very dark values, and an equality test leaves a dark confetti halo.
    const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    if (lum < 22) { px[i + 3] = 0; continue; }
    const p = i / 4, x = p % src.width, y = (p / src.width) | 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  sctx.putImageData(d, 0, 0);

  const tw = maxX - minX + 1, th = maxY - minY + 1;
  const trimmedCv = document.createElement('canvas');
  trimmedCv.width = tw; trimmedCv.height = th;
  const tctx = trimmedCv.getContext('2d');
  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(src, minX, minY, tw, th, 0, 0, tw, th);

  // ---- the wordmark, from the game's own renderer -------------------------
  const goldRamp = new Ramp([0x7a4512, 0xc08422, 0xf0a91e, 0xffd977, 0xfff2c4]);
  const inkRamp = new Ramp([0xcbb68c, 0xe3d3ae]);
  const main = art.emboss(art.trimmed(art.textMask('UNBOUND', 16, 2)), goldRamp, 0xfff2c4);
  const small = art.emboss(
    art.trimmed(art.textMask('DESCENT', 10, 7)), inkRamp, 0xf4e8c8,
    { outline: false, shadow: 2 },
  );
  const typePix = new Pix(Math.max(main.w, small.w), main.h + 2 + small.h);
  typePix.blit(main, Math.round((typePix.w - main.w) / 2), 0);
  typePix.blit(small, Math.round((typePix.w - small.w) / 2), main.h + 2);
  void hex;

  // Whole-number upscale so the type stays on its own pixel grid.
  const typeScale = Math.max(1, Math.round((tw * 0.72) / typePix.w));
  const typeCv = typePix.scale(typeScale).toCanvas();

  // ---- lay it out ---------------------------------------------------------
  const pad = Math.round(tw * 0.06);
  const gap = Math.round(tw * 0.015);
  const W = tw + pad * 2;
  const H = th + gap + typeCv.height + pad * 2;

  const mk = (bg) => {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    if (bg) { c.fillStyle = bg; c.fillRect(0, 0, W, H); }
    c.drawImage(trimmedCv, pad, pad);
    c.drawImage(typeCv, Math.round((W - typeCv.width) / 2), pad + th + gap);
    return cv.toDataURL('image/png');
  };

  const emblemOnly = document.createElement('canvas');
  emblemOnly.width = tw; emblemOnly.height = th;
  emblemOnly.getContext('2d').drawImage(trimmedCv, 0, 0);

  return {
    full: mk('#0a0710'),
    fullAlpha: mk(null),
    emblem: emblemOnly.toDataURL('image/png'),
    tw, th, W, H,
  };
}, emblemB64);

if (errors.length) {
  console.error('page errors:\n  ' + errors.join('\n  '));
  process.exitCode = 1;
}

const wr = (dataUrl, file) => {
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`  ${file}`);
};
wr(result.emblem, 'store/logo-emblem.png');
wr(result.full, 'store/logo-full.png');
wr(result.fullAlpha, 'store/logo-full-alpha.png');
console.log(`  emblem ${result.tw}×${result.th}  ·  full ${result.W}×${result.H}`);

await browser.close();
if (server) server.kill();
