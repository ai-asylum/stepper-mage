/**
 * THROWAWAY — texel-step authoring harness. Delete when the phase ships.
 *
 * Dumps the raw tile textures for every theme at every pixel step, each one
 * NEAREST-magnified to the same world size, so the four densities can be judged
 * side by side at the size a nearby wall actually occupies on screen.
 *
 *   node tools/texsheet.mjs                 # all five themes, sheet A + B
 *   node tools/texsheet.mjs --theme vault
 *   node tools/texsheet.mjs --game          # in-game shots: wall/floor/ceil/corridor
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const has = (k) => args.includes(`--${k}`);

const PORT = 5199;
const OUT = path.resolve('_shots/step');
mkdirSync(OUT, { recursive: true });
const url = `http://localhost:${PORT}/`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game, null, { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(1500);

const write = (name, dataUrl) => {
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', file);
};

if (has('game')) {
  const themes = await page.evaluate(async () => {
    const t = await import('/src/art/theme.ts');
    return t.THEMES.map((x) => x.id);
  });
  const depths = arg('depths', '1,2,3,4,5').split(',').map(Number);
  const steps = arg('steps', '144,72,36,18').split(',').map(Number);
  for (const d of depths) {
    await page.evaluate((dd) => window.__game.goToDepth(dd), d);
    await page.waitForTimeout(2500);
    for (const s of steps) {
      await page.evaluate((ss) => window.__game.setPixels(ss), s);
      await page.waitForTimeout(3000);
      const views = await page.evaluate(() => window.__game.bestViews());
      const v = views.find((x) => x.name === 'corridor') ?? views[0];
      await page.evaluate(([x, y, dir]) => window.__game.place(x, y, dir), [v.x, v.y, v.dir]);
      await page.waitForTimeout(1600);
      const clip = { x: 0, y: 0, width: 390, height: 500 };
      await page.screenshot({ path: path.join(OUT, `game-${themes[d - 1]}-${s}.png`), clip });
      // Nose to the wall: the flat face, straight on, with the floor and the ceiling
      // meeting it. `bestViews` only ever offers depth.
      const near = await page.evaluate(() => {
        // A wall three tiles ahead with room to the sides: the face fills the middle
        // of the frame and the floor and ceiling run up to it. `bestViews` only ever
        // offers the longest corridor, which frames a ceiling.
        const g = window.__game.floor.grid;
        let best = null;
        for (let y = 0; y < g.h; y++) {
          for (let x = 0; x < g.w; x++) {
            if (!g.walkable(x, y)) continue;
            for (let d = 0; d < 4; d++) {
              if (g.rayTiles(x, y, d, 20).length !== 3) continue;
              let open = 0;
              for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) if (g.walkable(x + dx, y + dy)) open++;
              }
              if (!best || open > best.open) best = { x, y, dir: d, open };
            }
          }
        }
        return best;
      });
      if (near) {
        await page.evaluate(([x, y, dir]) => window.__game.place(x, y, dir), [near.x, near.y, near.dir]);
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(OUT, `face-${themes[d - 1]}-${s}.png`), clip });
      }
      console.log('shot', themes[d - 1], s);
    }
  }
} else if (has('one')) {
  // --one theme,step,face,variant[,mag] : a single face, big, for a close look.
  const [id, step, face, vi, mag] = arg('one', 'library,18,wall,0,32').split(',');
  await page.evaluate((ss) => window.__game.setPixels(Number(ss)), step);
  await page.waitForTimeout(1200);
  const dataUrl = await page.evaluate(async ([themeId, faceName, variant, m]) => {
    const T = await import('/src/art/theme.ts');
    const TL = await import('/src/art/tiles.ts');
    const theme = T.THEMES.find((t) => t.id === themeId);
    const set = TL.buildTileSet(theme, `${themeId}-sheet`);
    const src = faceName === 'wall' ? set.walls[+variant]
      : faceName === 'floor' ? set.floors[+variant] : set.ceils[+variant];
    return src.scale(+(m || 32)).toCanvas().toDataURL('image/png');
  }, [id, face, vi ?? 0, mag ?? 32]);
  write(`one-${id}-${step}-${face}${vi ?? 0}`, dataUrl);
} else {
  const only = arg('theme', '');
  const steps = [144, 72, 36, 18];
  // The step MUST be set through __game: vite stamps `?t=` on modules it has
  // hot-reloaded, so a dynamic `import('/src/art/steps.ts')` here is a second
  // module instance with its own `active` and setting it does nothing at all.
  // `tiles.ts` imported dynamically resolves `./steps` to the same stamped URL the
  // app uses, so building through it and stepping through __game agree.
  await page.evaluate(() => { window.__acc = {}; });
  for (const s of steps) {
    await page.evaluate((ss) => window.__game.setPixels(ss), s);
    await page.waitForTimeout(1200);
    const got = await page.evaluate(async (ss) => {
      const T = await import('/src/art/theme.ts');
      const TL = await import('/src/art/tiles.ts');
      if (window.__game.pixels().step !== ss) throw new Error('step did not take');
      for (const theme of T.THEMES) {
        (window.__acc[theme.id] ??= {})[ss] = TL.buildTileSet(theme, `${theme.id}-sheet`);
      }
      return T.THEMES.map((t) => t.id);
    }, s);
    console.log('built', s, got.length, 'themes');
  }
  const ids = await page.evaluate(() => Object.keys(window.__acc));
  for (const id of ids) {
    if (only && only !== id) continue;
    for (const which of ['a', 'b']) {
      const dataUrl = await page.evaluate(async ([themeId, kind]) => {
        const TL = await import('/src/art/tiles.ts');
        const PX = await import('/src/art/pixel.ts');
        const steps = [144, 72, 36, 18];
        const MAGS = { 144: 2, 72: 4, 36: 8, 18: 16 };
        const CELL = 288;
        const rows = kind === 'a'
          ? [['wall', 0], ['floor', 0], ['ceil', 0]]
          : [['wall', 1], ['wall', 3], ['wall', 4]];
        const RH = Math.round(CELL * TL.WALL_H) + 2;
        const sheet = new PX.Pix(steps.length * (CELL + 2), rows.length * RH, PX.hex(0x101010));
        steps.forEach((s, si) => {
          const set = window.__acc[themeId][s];
          rows.forEach(([face, vi], ri) => {
            const src = face === 'wall' ? set.walls[vi]
              : face === 'floor' ? set.floors[vi % 4] : set.ceils[vi % 3];
            sheet.blit(src.scale(MAGS[s]), si * (CELL + 2) + 1, ri * RH + 1, { mode: 'set' });
          });
        });
        return sheet.toCanvas().toDataURL('image/png');
      }, [id, which]);
      write(`${which}-${id}`, dataUrl);
    }
  }
  // Mean luma per face per step: switching the chip should not change how bright the
  // room is, and the eye is bad at judging that across four magnifications.
  const luma = await page.evaluate(() => {
    const out = {};
    for (const [id, byStep] of Object.entries(window.__acc)) {
      out[id] = {};
      for (const [s, set] of Object.entries(byStep)) {
        const mean = (ps) => {
          let sum = 0, n = 0;
          for (const p of ps) {
            for (let i = 0; i < p.data.length; i++) {
              const c = p.data[i];
              sum += 0.299 * (c & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * ((c >> 16) & 255);
              n++;
            }
          }
          return Math.round(sum / n);
        };
        out[id][s] = { w: mean(set.walls), f: mean(set.floors), c: mean(set.ceils) };
      }
    }
    return out;
  });
  console.log('mean luma (wall/floor/ceil):');
  for (const [id, byStep] of Object.entries(luma)) {
    console.log(' ', id.padEnd(9), [144, 72, 36, 18]
      .map((s) => `${s}:${byStep[s].w}/${byStep[s].f}/${byStep[s].c}`).join('  '));
  }
}

if (errors.length) {
  console.log('--- page errors ---');
  for (const e of errors.slice(0, 10)) console.log(e);
  process.exitCode = 1;
}
await browser.close();
