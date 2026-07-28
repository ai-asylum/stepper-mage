/**
 * Scripted playtest. Drives the real game through its own public surface and
 * screenshots each beat, so the core loop is verified rather than assumed.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('_shots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404|favicon/.test(m.text())) errors.push(m.text()); });

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game, null, { timeout: 40000 });
await page.waitForTimeout(2600);

const shot = async (n) => { await page.screenshot({ path: path.join(OUT, `pt-${n}.png`) }); console.log('  shot pt-' + n); };
const ev  = (fn, ...a) => page.evaluate(fn, ...a);

console.log('\n=== 1. state at spawn ===');
console.log(await ev(() => {
  const g = window.__game;
  return {
    depth: g.state.depth, hp: g.state.hp, mana: g.state.mana, pages: g.state.pages,
    entities: g.floor.entities.length,
    props: g.floor.entities.filter(e => e.kind === 'prop').length,
    enemies: g.floor.entities.filter(e => e.kind === 'enemy').length,
    candidates: g.hud.candidates.length,
  };
}));

console.log('\n=== 2. walk to a prop and target it ===');
// give every page + mana so the fusion paths can be exercised
await ev(() => window.__game.grantAll());
const propInfo = await ev(() => {
  const g = window.__game;
  const prop = g.floor.entities.find(e => e.kind === 'prop' && !e.animated);
  if (!prop) return null;
  // stand next to it, facing it
  const grid = g.floor.grid;
  for (const [d, dx, dy] of [[0,0,1],[1,-1,0],[2,0,-1],[3,1,0]]) {
    const px = prop.sprite.tx + dx*2, py = prop.sprite.ty + dy*2;
    if (grid.walkable(px, py)) { g.place(px, py, d); break; }
  }
  g.hud.target = prop;
  return { sprite: prop.spriteId, golem: prop.golemId, tx: prop.sprite.tx, ty: prop.sprite.ty };
});
console.log(propInfo);
await page.waitForTimeout(700);
await shot('01-targeting-prop');

console.log('\n=== 3. preview ANIMATE + FIRE on that prop ===');
await ev(() => window.__game.selectPages(['animate', 'fire']));
await page.waitForTimeout(300);
console.log(await ev(() => {
  const c = window.__game.hud.currentCast();
  return { name: c.name, cost: c.cost, output: c.output, damage: c.damage, hp: c.count, infuse: c.infuse, refusal: c.refusal };
}));
await shot('02-cast-preview');

console.log('\n=== 4. cast it ===');
await ev(() => window.__game.castNow());
await page.waitForTimeout(500);
await shot('03-rising');
await page.waitForTimeout(900);
await shot('04-golem');
console.log(await ev(() => {
  const g = window.__game;
  const gol = g.floor.entities.find(e => e.animated);
  return gol ? { spriteId: gol.spriteId, hp: gol.hp, hostile: gol.hostile, state: gol.sprite.state } : 'NO GOLEM';
}));

console.log('\n=== 5. fusion resolution table ===');
console.log(await ev(() => {
  const sets = [['fire'],['fire','frost'],['fire','spark'],['frost','spark'],['gust','spark'],
                ['fire','frost','spark'],['fire','fire'],['fire','grow'],['fire','split'],
                ['fire','grow','grow'],['animate','frost'],['grow']];
  return sets.map(s => {
    const c = window.__game.combat.preview(s, { kind: 'enemy' });
    return `${s.join('+').padEnd(22)} -> ${(c.refusal ? 'DENY: ' + c.refusal : c.name + ' | dmg ' + c.damage + ' x' + c.count + ' | ' + c.cost + ' mana' + (c.authored ? ' [NEW]' : ''))}`;
  });
}));

console.log('\n=== 6. attack an enemy, check statuses ===');
const fight = await ev(async () => {
  const g = window.__game;
  const foe = g.floor.entities.find(e => e.alive && e.kind === 'enemy');
  if (!foe) return 'no enemy on this floor';
  const grid = g.floor.grid;
  for (const [d, dx, dy] of [[0,0,1],[1,-1,0],[2,0,-1],[3,1,0]]) {
    const px = foe.sprite.tx + dx*3, py = foe.sprite.ty + dy*3;
    if (grid.walkable(px, py)) { g.place(px, py, d); break; }
  }
  g.hud.target = foe;
  const before = foe.hp;
  g.selectPages(['fire','frost']);        // Steam Burst -> soaked
  await g.castNow();
  const afterSoak = { hp: foe.hp, statuses: g.combat.statusesOf(foe).map(s=>s.id) };
  g.state.mana = 20;
  g.selectPages(['spark']);               // shock on soaked -> CONDUCTION
  await g.castNow();
  return { before, afterSoak, afterShock: { hp: foe.hp, statuses: g.combat.statusesOf(foe).map(s=>s.id) } };
});
console.log(fight);
await page.waitForTimeout(600);
await shot('05-combat');

console.log('\n=== 7. errors ===');
console.log(errors.length ? errors.slice(0,8) : 'none');
await browser.close();
