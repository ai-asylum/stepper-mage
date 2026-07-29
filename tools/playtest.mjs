/**
 * Scripted playtest. Drives the real game through its own public surface and
 * screenshots each beat, so the core loop is verified rather than assumed.
 *
 * Every beat here is ELEMENTS ONLY, and that is now a statement about the DEFAULT
 * SAVE rather than about the game: the five ingredients exist and have no page, so
 * nothing in the book can tear one, and the belt they come off is locked until the
 * star tree node is bought. So this file measures a first run — no belt, no golems —
 * and the ingredient rule it asserts is the one that holds at every hand size: an
 * ingredient has no page and is never castable alone.
 *
 * The belt itself, and the golem path it restores, are driven in the belt harness
 * (Roadmap/Ingredient_Belt.md) — reaching them needs two purchases, which is a
 * different measurement from "what does floor 1 hand a new player".
 */
import { serve, launch, openGame, check, note, finish } from './harness.mjs';

const stopServer = await serve();
const browser = await launch();
const { page, errors, shot, ev } = await openGame(browser, { prefix: 'pt', wait: 2600 });

/** Ids that exist for `resolveCast` but have no page — nothing can tear these. */
const INGREDIENTS = ['animate', 'moss', 'grow', 'split', 'sand'];

console.log('\n=== 1. state at spawn ===');
const spawn = await ev(() => {
  const g = window.__game;
  return {
    depth: g.state.depth, hp: g.state.hp, maxHp: g.state.maxHp,
    handSize: g.meta.handSize, pages: g.state.pages, ranks: g.state.ranks,
    book: g.bookPages(),
    entities: g.floor.entities.length,
    props: g.floor.entities.filter((e) => e.kind === 'prop').length,
    enemies: g.floor.entities.filter((e) => e.kind === 'enemy').length,
    candidates: g.hud.candidates.length,
  };
});
console.log(spawn);
check('hand size starts at 1', spawn.handSize === 1, `got ${spawn.handSize}`);
check('the starting book holds only elements',
  spawn.book.every((id) => !INGREDIENTS.includes(id)), spawn.book.join(','));
check('the player spawns alive', spawn.hp > 0 && spawn.hp === spawn.maxHp, `${spawn.hp}/${spawn.maxHp}`);

console.log('\n=== 2. the ingredient rule ===');
const ingredients = await ev(async (INGREDIENTS) => {
  const g = window.__game;
  g.grantAll();
  const out = { book: g.bookPages(), refusals: {}, torn: {} };
  out.belt = { capacity: g.belt().capacity, locked: g.belt().locked };
  for (const id of INGREDIENTS) {
    out.refusals[id] = g.combat.preview([id], { kind: 'enemy' }).refusal ?? null;
    g.fan.clear();
    await g.selectPages([id]);
    out.torn[id] = g.fan.count;
  }
  out.refusals['grow+split'] = g.combat.preview(['grow', 'split'], { kind: 'enemy' }).refusal ?? null;
  out.refusals['sand+grow'] = g.combat.preview(['sand', 'grow'], { kind: 'enemy' }).refusal ?? null;
  g.fan.clear();
  return out;
}, INGREDIENTS);
console.log(ingredients);
check('a full book is five element pages', ingredients.book.length === 5, ingredients.book.join(','));
check('no ingredient has a page to tear',
  INGREDIENTS.every((id) => ingredients.torn[id] === 0), JSON.stringify(ingredients.torn));
check('a hand of ingredients alone is refused',
  [...INGREDIENTS, 'grow+split', 'sand+grow'].every((k) => !!ingredients.refusals[k]),
  JSON.stringify(ingredients.refusals));
// Replaces the note that said golems were unreachable. They are reachable now — the
// belt exists — so what is true of a DEFAULT save is the claim worth making, and it
// is the reason nothing rises later in this file.
check('the belt is locked on a default save, so no ingredient can be kept yet',
  ingredients.belt.locked === true && ingredients.belt.capacity === 0,
  JSON.stringify(ingredients.belt));
note('the belt and the golem path are driven separately',
  'both need the hand-size-2 and belt nodes bought — see Roadmap/Ingredient_Belt.md');

console.log('\n=== 3. walk to a prop and target it ===');
const propInfo = await ev(() => {
  const g = window.__game;
  const prop = g.floor.entities.find((e) => e.kind === 'prop' && !e.animated);
  if (!prop) return null;
  // stand next to it, facing it
  const grid = g.floor.grid;
  for (const [d, dx, dy] of [[0, 0, 1], [1, -1, 0], [2, 0, -1], [3, 1, 0]]) {
    const px = prop.sprite.tx + dx * 2, py = prop.sprite.ty + dy * 2;
    if (grid.walkable(px, py)) { g.place(px, py, d); break; }
  }
  g.hud.target = prop;
  return { sprite: prop.spriteId, hp: prop.hp, tx: prop.sprite.tx, ty: prop.sprite.ty };
});
console.log(propInfo);
check('there is furniture to aim at', !!propInfo, propInfo ? propInfo.sprite : 'no prop on floor 1');
await page.waitForTimeout(700);
await shot('01-targeting-prop');

console.log('\n=== 3b. reaching: harvest is adjacent AND facing ===');
/**
 * The one rule behind every interaction (`docs/DESIGN.md`, Reaching). Read-only —
 * nothing here spends a turn or a slot, and the player is put back where section 3
 * left them, because the beats after this one cast from that spot.
 */
const reach = await ev(() => {
  const g = window.__game;
  const grid = g.floor.grid;
  const home = { x: g.stepper.x, y: g.stepper.y, dir: g.stepper.dir };
  const dirs = [[0, 0, 1], [1, -1, 0], [2, 0, -1], [3, 1, 0]];
  /** Stand `gap` tiles from `e`, facing it. */
  const face = (e, gap) => {
    for (const [d, dx, dy] of dirs) {
      const px = e.sprite.tx + dx * gap, py = e.sprite.ty + dy * gap;
      if (!grid.walkable(px, py)) continue;
      if (grid.rayTiles(px, py, d, gap).length < gap - 1) continue;
      g.place(px, py, d);
      return true;
    }
    return false;
  };
  let out = null;
  for (const e of g.floor.entities) {
    if (e.kind !== 'prop' || e.animated || !e.alive) continue;
    if (!face(e, 1) || g.hud.harvestInReach !== e) continue;
    out = { fixture: e.spriteId, facing: !!g.hud.harvestInReach };
    // Adjacent, turned around: the distance is unchanged and the pill must go.
    g.place(g.stepper.x, g.stepper.y, (g.stepper.dir + 2) % 4);
    out.turnedAway = !!g.hud.harvestInReach;
    // Across the room, with the reticle ON it: spells reach, interactions do not.
    out.across = null;
    for (let want = 4; want >= 2 && out.across === null; want--) {
      if (!face(e, want)) continue;
      g.hud.target = e;
      out.across = !!g.hud.harvestInReach;
      out.stillVisible = g.harvestable().some((h) => h.e === e);
    }
    break;
  }
  g.place(home.x, home.y, home.dir);
  return out;
});
console.log(reach);
check('a fixture you stand at and face offers a harvest', !!reach && reach.facing,
  JSON.stringify(reach));
check('turning away from it withdraws the offer', !!reach && reach.turnedAway === false,
  JSON.stringify(reach));
check('line of sight alone is not reach', !!reach && reach.across === false && !!reach.stillVisible,
  JSON.stringify(reach));

console.log('\n=== 4. one page, one turn: Fireball on the furniture ===');
const solo = await ev(async () => {
  const g = window.__game;
  const prop = g.floor.entities.find((e) => e.kind === 'prop' && !e.animated);
  // `combat.turns` is the honest round counter — every price is paid through it.
  const t0 = g.combat.turns;
  await g.selectPages(['fire']);
  const tornTurns = g.combat.turns - t0;
  // After the tear: tearing runs `refreshTargets`, which may move the reticle.
  g.hud.target = prop;
  const c = g.hud.currentCast();
  const preview = {
    name: c.name, output: c.output, damage: c.damage, count: c.count,
    refusal: c.refusal ?? null,
  };
  const before = prop.hp;
  const t1 = g.combat.turns;
  await g.castNow();
  await new Promise((r) => setTimeout(r, 200));
  return {
    preview, before, after: prop.hp, alive: prop.alive, fanAfter: g.fan.count,
    tornTurns, castTurns: g.combat.turns - t1,
  };
});
console.log(solo);
await shot('02-cast-preview');
check('a single element page previews as a projectile',
  solo.preview.output === 'projectile' && !solo.preview.refusal, JSON.stringify(solo.preview));
check('furniture takes the hit', solo.after < solo.before || !solo.alive,
  `${solo.before} -> ${solo.after}`);
check('the cast spends the hand', solo.fanAfter === 0, `fan ${solo.fanAfter}`);
check('one page costs one turn', solo.tornTurns === 1, `${solo.tornTurns} turns`);
check('releasing the cast is free', solo.castTurns === 0, `${solo.castTurns} turns`);
await page.waitForTimeout(600);
await shot('03-after-bolt');
const golem = await ev(() => {
  const g = window.__game;
  const gol = g.floor.entities.find((e) => e.animated);
  return gol ? gol.spriteId : null;
});
// Not "no page can supply animate" any more — the honest reason is that this run
// never held an ingredient, because its belt has no loops to keep one in.
check('nothing animated — the hand held only elements', golem === null, String(golem));

console.log('\n=== 5. fusion resolution table ===');
const ELEMENT_SETS = [
  ['fire'], ['frost'], ['spark'], ['gust'], ['rot'],
  ['fire', 'frost'], ['fire', 'spark'], ['frost', 'spark'], ['gust', 'spark'], ['fire', 'rot'],
  ['fire', 'frost', 'spark'], ['fire', 'gust', 'spark'], ['fire', 'frost', 'gust'],
  ['fire', 'fire'], ['fire', 'fire', 'fire'],
];
const INGREDIENT_SETS = [
  ['animate'], ['moss'], ['grow'], ['split'], ['sand'],
  ['grow', 'grow'], ['sand', 'split'], ['animate', 'grow'],
];
const table = await ev(([elems, ingrs]) => {
  const g = window.__game;
  const row = (s) => {
    const c = g.combat.preview(s, { kind: 'enemy' });
    return {
      set: s.join('+'),
      // The price is TURNS — one per component taken. There is no mana.
      turns: s.length,
      refusal: c.refusal ?? null,
      name: c.name, damage: c.damage, count: c.count, authored: c.authored,
    };
  };
  return { elems: elems.map(row), ingrs: ingrs.map(row) };
}, [ELEMENT_SETS, INGREDIENT_SETS]);
for (const r of [...table.elems, ...table.ingrs]) {
  console.log(`  ${r.set.padEnd(20)} ${String(r.turns) + 't'} -> ${
    r.refusal ? 'DENY: ' + r.refusal
      : `${r.name} | dmg ${r.damage} x${r.count}${r.authored ? ' [NEW]' : ''}`}`);
}
check('every element set resolves into a cast',
  table.elems.every((r) => !r.refusal && r.damage > 0),
  table.elems.filter((r) => r.refusal || !r.damage).map((r) => r.set).join(','));
check('every ingredient-only set is refused',
  table.ingrs.every((r) => !!r.refusal),
  table.ingrs.filter((r) => !r.refusal).map((r) => r.set).join(','));

console.log('\n=== 6. elemental interaction: soak, then conduct ===');
const fight = await ev(async () => {
  const g = window.__game;
  // The boss, because it is the only body that survives a Steam Burst — a mook
  // dies to it outright and the second half of the interaction never runs.
  const foe = g.floor.entities.find((e) => e.alive && e.kind === 'boss')
    ?? g.floor.entities.find((e) => e.alive && e.kind === 'enemy');
  if (!foe) return null;
  const grid = g.floor.grid;
  for (const [d, dx, dy] of [[0, 0, 1], [1, -1, 0], [2, 0, -1], [3, 1, 0]]) {
    const px = foe.sprite.tx + dx * 3, py = foe.sprite.ty + dy * 3;
    if (grid.walkable(px, py)) { g.place(px, py, d); break; }
  }
  const before = foe.hp;
  const t0 = g.combat.turns;
  await g.selectPages(['fire', 'frost']);        // Steam Burst -> soaked
  const fusionTurns = g.combat.turns - t0;
  g.hud.target = foe;
  await g.castNow();
  const afterSoak = { hp: foe.hp, statuses: g.combat.statusesOf(foe).map((s) => s.id) };
  await g.selectPages(['spark']);                // shock on soaked -> CONDUCTION
  g.hud.target = foe;
  await g.castNow();
  return {
    kind: foe.kind, before, afterSoak, fusionTurns,
    afterShock: { hp: foe.hp, statuses: g.combat.statusesOf(foe).map((s) => s.id) },
    playerHp: g.state.hp,
  };
});
console.log(fight);
check('a fusion lands on the target', !!fight && fight.afterSoak.hp < fight.before,
  fight ? `${fight.before} -> ${fight.afterSoak.hp}` : 'no body to fight');
check('a two-page fusion costs two turns', !!fight && fight.fusionTurns === 2,
  fight ? `${fight.fusionTurns} turns` : '');
check('Steam Burst soaks', !!fight && fight.afterSoak.statuses.includes('soaked'),
  fight ? fight.afterSoak.statuses.join(',') : '');
// Spark is 9 at rank 1; conduction is x1.5, so a conducted hit cannot be under 12.
check('shock on a soaked body conducts',
  !!fight && fight.afterSoak.hp - fight.afterShock.hp >= 12,
  fight ? `spark dealt ${fight.afterSoak.hp - fight.afterShock.hp}` : '');
await page.waitForTimeout(600);
await shot('04-combat');

console.log('\n=== 7. result ===');
finish(errors);
await browser.close();
stopServer();
