/** Verifies the ported grimoire: flip, tear, fan, merge-cast. */
import { chromium } from 'playwright-core';
import path from 'node:path';
const b = await chromium.launch({ channel:'chrome', headless:true });
const p = await b.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
p.on('console', m => { if (m.type()==='error' && !/404|favicon/.test(m.text())) errs.push(m.text()); });
await p.goto('http://localhost:5199/', { waitUntil:'networkidle' });
await p.waitForFunction(()=>!!window.__game, null, {timeout:40000});
await p.waitForTimeout(4200);   // let the intro cascade settle
const shot = async n => { await p.screenshot({ path: path.join('_shots', `bk-${n}.png`) }); console.log('  shot bk-'+n); };

console.log('after intro:', await p.evaluate(() => {
  const g = window.__game;
  return { page: g.book.currentSpell.name, index: g.book.index, busy: g.book.busy, fan: g.fan.count };
}));
await shot('01-intro-settled');

console.log('\n-- flip forward twice --');
await p.evaluate(() => { window.__game.book.swipe(1); });
await p.waitForTimeout(500);
await p.evaluate(() => { window.__game.book.swipe(1); });
await p.waitForTimeout(600);
console.log('now on:', await p.evaluate(() => window.__game.book.currentSpell.name));
await shot('02-flipped');

console.log('\n-- grant pages + mana, tear Animate and Fireball --');
console.log(await p.evaluate(async () => {
  const g = window.__game;
  g.grantAll();
  // stand next to a prop and target it
  const prop = g.floor.entities.find(e => e.kind==='prop' && !e.animated);
  const grid = g.floor.grid;
  for (const [d,dx,dy] of [[0,0,1],[1,-1,0],[2,0,-1],[3,1,0]]) {
    const px = prop.sprite.tx+dx*3, py = prop.sprite.ty+dy*3;
    if (grid.walkable(px,py)) { g.place(px,py,d); break; }
  }
  g.hud.target = prop;
  g.selectPages(['animate','fire']);
  await new Promise(r=>setTimeout(r,60));
  return { fanCount: g.fan.count, fanIds: g.fan.gameIds, preview: g.hud.currentCast()?.name };
}));
await p.waitForTimeout(900);
await shot('03-torn-fan');

console.log('\n-- cast (fan merges, then the spell fires) --');
await p.evaluate(() => window.__game.castNow());
await p.waitForTimeout(700);
await shot('04-merging');
await p.waitForTimeout(1400);
console.log(await p.evaluate(() => {
  const g = window.__game;
  const gol = g.floor.entities.find(e => e.animated);
  return { fanAfter: g.fan.count, golem: gol ? gol.spriteId : 'NONE', golemHp: gol?.hp };
}));
await shot('05-after-cast');

console.log('\n-- canRip gating (unlearned page / not enough mana) --');
console.log(await p.evaluate(() => {
  const g = window.__game;
  g.fan.clear();
  g.state.pages = ['fire'];          // only Fireball learned
  g.state.mana = 2;
  const pages = g.book;
  const results = {};
  for (const [i, nm] of [[0,'fire(learned,affordable)'],[1,'frost(unlearned)'],[7,'animate(unlearned)']]) {
    g.fan.clear();
    results[nm] = pages.tearAt(i);
  }
  g.fan.clear();
  g.state.mana = 2;
  const a = pages.tearAt(0);          // 2 mana, ok
  const bb = pages.tearAt(0);         // would need 4, refuse
  results['second fireball over budget'] = bb;
  void a;
  return results;
}));

console.log('\nerrors:', errs.length ? errs.slice(0,6) : 'none');
await b.close();
