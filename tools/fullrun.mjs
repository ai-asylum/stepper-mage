/** Drives a whole run: clear floor 1's boss, descend, and sample every floor. */
import { chromium } from 'playwright-core';
import path from 'node:path';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type()==='error' && !/404|favicon/.test(m.text())) errors.push(m.text()); });
await page.goto('http://localhost:5199/', { waitUntil:'networkidle' });
await page.waitForFunction(()=>!!window.__game, null, {timeout:40000});
await page.waitForTimeout(2600);
const shot = async n => { await page.screenshot({ path: path.join('_shots', `fr-${n}.png`) }); console.log('  shot fr-'+n); };

for (let depth = 1; depth <= 5; depth++) {
  const info = await page.evaluate(async () => {
    const g = window.__game;
    g.grantAll();
    g.state.hp = g.state.maxHp;
    // stand off from the boss and look at it
    const boss = g.floor.entities.find(e => e.kind === 'boss');
    const grid = g.floor.grid;
    if (boss) {
      for (const [d,dx,dy] of [[0,0,1],[1,-1,0],[2,0,-1],[3,1,0]]) {
        const px = boss.sprite.tx + dx*4, py = boss.sprite.ty + dy*4;
        if (grid.walkable(px,py) && grid.rayTiles(px,py,d,4).length>=3) { g.place(px,py,d); break; }
      }
      g.hud.target = boss;
    }
    return {
      depth: g.state.depth, theme: g.floor.theme.name,
      entities: g.floor.entities.length,
      enemies: g.floor.entities.filter(e=>e.kind==='enemy').length,
      props: g.floor.entities.filter(e=>e.kind==='prop').length,
      bossHp: boss ? boss.hp : null,
      candidates: g.hud.candidates.length,
    };
  });
  console.log(`\nFLOOR ${info.depth}: ${info.theme}`);
  console.log('  ', JSON.stringify(info));
  await page.waitForTimeout(900);
  await shot(`d${depth}-boss`);

  if (depth === 5) break;

  // kill the boss with repeated big fusions, then descend
  const killed = await page.evaluate(async () => {
    const g = window.__game;
    const boss = g.floor.entities.find(e => e.kind === 'boss');
    if (!boss) return 'no boss';
    for (let i = 0; i < 40 && boss.alive && boss.hp > 0; i++) {
      g.state.mana = 20; g.state.hp = g.state.maxHp;
      g.hud.target = boss;
      g.selectPages(['fire','frost','spark']);
      await g.castNow();
      await new Promise(r => setTimeout(r, 40));
    }
    return { bossHp: boss.hp, bossDead: g.combat.bossDead, stars: g.state.stars };
  });
  console.log('   boss:', JSON.stringify(killed));
  await page.waitForTimeout(900);
  await shot(`d${depth}-bossdead`);

  const descended = await page.evaluate(async () => {
    const g = window.__game;
    const st = g.floor.entities.find(e => e.kind === 'stairs');
    if (!st) return 'no stairs';
    const grid = g.floor.grid;
    // step next to the stairs
    for (const [d,dx,dy] of [[0,0,1],[1,-1,0],[2,0,-1],[3,1,0]]) {
      const px = st.sprite.tx+dx, py = st.sprite.ty+dy;
      if (grid.walkable(px,py)) { g.place(px,py,d); break; }
    }
    const before = g.state.depth;
    // find the DESCEND hit and use the real UI path
    g.hud.clearSelection();
    await new Promise(r => setTimeout(r, 120));
    return { before, stairsVisible: st.sprite.group.visible };
  });
  console.log('   stairs:', JSON.stringify(descended));
  await shot(`d${depth}-stairs`);

  // click DESCEND through the actual button
  const btn = await page.evaluate(() => {
    const g = window.__game;
    g.hud.draw(g.engine.ui);            // rebuild hit rects
    const h = g.hud.hit ? null : null; void h;
    return true;
  });
  void btn;
  await page.keyboard.press('KeyF');    // the descend hotkey, same code path
  await page.waitForTimeout(3200);
}

console.log('\nerrors:', errors.length ? errors.slice(0,10) : 'none');
await browser.close();
