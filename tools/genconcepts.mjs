/**
 * Render the four wordmark concepts to `_shots/concepts/`.
 *
 *   node tools/genconcepts.mjs
 *
 * Writes one PNG per concept plus a contact sheet, because four marks are only
 * comparable side by side at the same scale — judged one at a time you pick the
 * last one you looked at.
 *
 * Headless for the same reason `genlogo.mjs` is: `Pix` and the text mask need a
 * real canvas.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const PORT = 5196;
const OUT = path.resolve('_shots/concepts');
const SCALE = 5;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

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

const NAMES = [
  ['chiselled', 'conceptChiselled', 'A — CHISELLED'],
  ['branded', 'conceptBranded', 'B — BRANDED'],
  ['seal', 'conceptSeal', 'C — SEAL'],
  ['falling', 'conceptFalling', 'D — FALLING'],
];

const shots = await page.evaluate(async ({ names, scale }) => {
  const m = await import('/src/playable/logoConcepts.ts');
  const out = {};
  for (const [key, fn] of names) {
    const pix = m[fn]('UNBOUND', 'DESCENT');
    out[key] = { url: pix.scale(scale).toCanvas().toDataURL('image/png'), w: pix.w, h: pix.h };
  }
  return out;
}, { names: NAMES.map(([k, f]) => [k, f]), scale: SCALE });

if (errors.length) {
  console.error('page errors:\n  ' + errors.join('\n  '));
  process.exitCode = 1;
}

for (const [key, , label] of NAMES) {
  const { url: u, w, h } = shots[key];
  writeFileSync(path.join(OUT, `${key}.png`), Buffer.from(u.split(',')[1], 'base64'));
  console.log(`  ${label.padEnd(14)} ${key}.png  ${w}×${h} art → ${w * SCALE}×${h * SCALE}`);
}

// Contact sheet, on the game's own ink so the marks are judged against the
// background they will actually sit on.
const sheetUrl = await page.evaluate(async ({ names, scale }) => {
  const m = await import('/src/playable/logoConcepts.ts');
  const made = names.map(([key, fn, label]) => ({
    label, cv: m[fn]('UNBOUND', 'DESCENT').scale(scale).toCanvas(),
  }));
  const pad = 40, labelH = 30;
  const w = Math.max(...made.map((x) => x.cv.width)) + pad * 2;
  const h = made.reduce((a, x) => a + x.cv.height + labelH + pad, pad);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0a0710';
  ctx.fillRect(0, 0, w, h);
  let y = pad;
  for (const { label, cv: c } of made) {
    ctx.fillStyle = '#7a6a52';
    ctx.font = 'bold 18px ui-monospace, Menlo, monospace';
    ctx.fillText(label, pad, y + 18);
    y += labelH;
    ctx.drawImage(c, Math.round((w - c.width) / 2), y);
    y += c.height + pad;
  }
  return cv.toDataURL('image/png');
}, { names: NAMES, scale: SCALE });

writeFileSync(path.join(OUT, 'sheet.png'), Buffer.from(sheetUrl.split(',')[1], 'base64'));
console.log('  contact sheet  _shots/concepts/sheet.png');

await browser.close();
if (server) server.kill();
