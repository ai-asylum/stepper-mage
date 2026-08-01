/**
 * THROWAWAY — proves the 144 step is byte-identical after the coarse steps were
 * authored. Delete with tools/texsheet.mjs.
 *
 * Hashes every tile texture actually bound into the scene, on every floor, at step
 * 144, in two builds: the dev server on 5199 (current source) and a static copy of
 * the pre-change `dist/` on 5198.
 *
 *   python3 -m http.server 5198 --directory <dist-before> &
 *   node tools/diff144.mjs
 */
import { chromium } from 'playwright-core';

const SEED = 'diff144';
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function hashes(url) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 40000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__game.setPixels(144));
  await page.waitForTimeout(1500);
  await page.evaluate((s) => window.__game.setSeed(s), SEED);
  await page.waitForTimeout(2500);
  const out = {};
  for (let d = 1; d <= 5; d++) {
    await page.evaluate((dd) => window.__game.goToDepth(dd), d);
    await page.waitForTimeout(3000);
    out[d] = await page.evaluate(() => {
      const seen = new Set(), list = [];
      window.__game.engine.scene.traverse((o) => {
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        const imgs = [];
        for (const m of mats) {
          if (m.map && m.map.image) imgs.push(m.map.image);
          // The masonry rides a ShaderMaterial, so its texture is in a uniform and not
          // in `material.map`.
          for (const u of Object.values(m.uniforms || {})) {
            if (u && u.value && u.value.isTexture && u.value.image) imgs.push(u.value.image);
          }
        }
        for (const img of imgs) {
          if (!img.width || seen.has(img)) continue;
          seen.add(img);
          const cv = document.createElement('canvas');
          cv.width = img.width; cv.height = img.height;
          const cx = cv.getContext('2d');
          cx.drawImage(img, 0, 0);
          const d32 = new Uint32Array(cx.getImageData(0, 0, img.width, img.height).data.buffer);
          let h = 0x811c9dc5;
          for (let i = 0; i < d32.length; i++) {
            h ^= d32[i]; h = Math.imul(h, 0x01000193) >>> 0;
          }
          list.push(`${img.width}x${img.height}:${h.toString(16)}`);
        }
      });
      return list.sort();
    });
  }
  if (errs.length) console.log('page errors on', url, errs.slice(0, 4));
  await page.close();
  return out;
}

const before = await hashes('http://localhost:5198/');
const after = await hashes('http://localhost:5199/');
let bad = 0;
for (let d = 1; d <= 5; d++) {
  const a = JSON.stringify(before[d]), b = JSON.stringify(after[d]);
  const n = before[d].length;
  if (a === b) { console.log(`depth ${d}: IDENTICAL (${n} textures)`); continue; }
  bad++;
  console.log(`depth ${d}: DIFFERENT (${before[d].length} vs ${after[d].length})`);
  for (let i = 0; i < Math.max(before[d].length, after[d].length); i++) {
    if (before[d][i] !== after[d][i]) console.log('  ', before[d][i], '!=', after[d][i]);
  }
}
console.log(bad ? `\n${bad} depth(s) changed at 144` : '\n144 is byte-identical on every floor');
process.exitCode = bad ? 1 : 0;
await browser.close();
