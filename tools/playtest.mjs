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
 *
 * The belt is currently FLAGGED OFF (`BELT_ENABLED` in src/flags.ts), which is why
 * section 2's belt claim is gated on `belt().enabled` rather than deleted or relaxed.
 * Everything else in this file is about elements and holds in both states.
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
  out.belt = {
    capacity: g.belt().capacity, locked: g.belt().locked, enabled: g.belt().enabled,
  };
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
//
// GATED ON THE FLAG (`BELT_ENABLED` in src/flags.ts), and skipped rather than relaxed.
// The claim is "locked UNTIL the node is bought", which is a statement about a purchase
// that exists; with the feature off there is no node to buy and the same two numbers
// would be passing for a different reason. Gating it means flipping the flag back
// re-arms the assertion instead of leaving a check that quietly proves nothing.
if (ingredients.belt.enabled) {
  check('the belt is locked on a default save, so no ingredient can be kept yet',
    ingredients.belt.locked === true && ingredients.belt.capacity === 0,
    JSON.stringify(ingredients.belt));
  note('the belt and the golem path are driven separately',
    'both need the hand-size-2 and belt nodes bought — see Roadmap/Ingredient_Belt.md');
} else {
  note('SKIPPED: the belt is flagged off', 'BELT_ENABLED=false in src/flags.ts');
  check('with the belt off the strap has no loops at all',
    ingredients.belt.capacity === 0 && ingredients.belt.locked === true,
    JSON.stringify(ingredients.belt));
}

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

console.log('\n=== 3c. facing: a body turns toward what it acts on ===');
/**
 * Facing is entity state with no art behind it yet, so this is the only thing that
 * can say it works. It asserts the two writes that exist — a body turns to step and
 * turns to attack — and the one NON-write that the swap depends on: being walked
 * past must not turn a creature round, or the player is never actually behind it.
 */
const facing = await ev(async () => {
  const g = window.__game;
  const grid = g.floor.grid;
  const dirs = [[0, 0, 1], [1, -1, 0], [2, 0, -1], [3, 1, 0]];
  const home = { x: g.stepper.x, y: g.stepper.y, dir: g.stepper.dir };
  const out = { spawnAllValid: g.floor.entities.every((e) => e.facing >= 0 && e.facing <= 3) };

  const e = g.floor.entities.find((x) => x.alive && x.hostile);
  if (!e) return out;

  // Stand next to it and let the round run: it should attack, and turn to do it.
  for (const [d, dx, dy] of dirs) {
    const px = e.sprite.tx + dx, py = e.sprite.ty + dy;
    if (!grid.walkable(px, py) || g.floor.solidAt(px, py)) continue;
    g.place(px, py, d);
    // The facing that points from the creature back at the player.
    out.want = (d + 2) % 4;
    e.facing = (out.want + 2) % 4;          // start it looking the wrong way
    await g.combat.playerStepped(px, py);
    out.after = e.facing;
    break;
  }

  // Being walked past must not spin it round.
  if (out.after !== undefined) {
    const before = e.facing;
    g.place(home.x, home.y, home.dir);
    out.unchangedByPlayerMove = e.facing === before;
  }
  g.place(home.x, home.y, home.dir);
  return out;
});
console.log(facing);
check('every body spawns with a valid facing', facing.spawnAllValid === true,
  JSON.stringify(facing));
check('a body turns toward the player when it acts', facing.after === facing.want,
  `want ${facing.want}, got ${facing.after}`);
check('the player moving does not turn a body', facing.unchangedByPlayerMove === true,
  JSON.stringify(facing));

console.log('\n=== 3d. the drawn view follows the facing ===');
/**
 * The art half of facing. Rotates a hostile through all four directions from a
 * fixed vantage and asserts which frame the renderer picked, including the mirror:
 * one profile has to serve both sides or the roster doubles.
 */
const views = await ev(async () => {
  const g = window.__game;
  const grid = g.floor.grid;
  const dirs = [[0, 0, 1], [1, -1, 0], [2, 0, -1], [3, 1, 0]];
  const home = { x: g.stepper.x, y: g.stepper.y, dir: g.stepper.dir };
  const e = g.floor.entities.find((x) => x.alive && x.hostile);
  if (!e) return null;
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  for (const [d, dx, dy] of dirs) {
    const px = e.sprite.tx + dx * 2, py = e.sprite.ty + dy * 2;
    if (!grid.walkable(px, py) || g.floor.solidAt(px, py)) continue;
    if (grid.rayTiles(px, py, d, 2).length < 1) continue;
    g.place(px, py, d);
    const seen = [];
    for (let f = 0; f < 4; f++) {
      e.facing = f;
      // Back to idle first. A body mid-strike deliberately shows its attack pose
      // whichever way it is turned, and section 3c leaves this one swinging — so
      // without this the facing mapping is measured through the override.
      e.sprite.play('idle');
      await frame();
      seen.push({ f, view: e.sprite.shownView, flip: e.sprite.shownFlipped });
    }
    // And the override itself, which is the other half of the rule.
    e.facing = (d + 2) % 4;
    e.sprite.play('attack');
    await frame();
    const striking = e.sprite.shownView;
    e.sprite.play('idle');
    g.place(home.x, home.y, home.dir);
    // The facing that looks back at the camera, given the player faces `d`.
    return { id: e.spriteId, toward: (d + 2) % 4, seen, striking };
  }
  g.place(home.x, home.y, home.dir);
  return null;
});
console.log(views);
const byF = (f) => views && views.seen.find((s) => s.f === f);
check('facing the player draws the front',
  !!views && byF(views.toward).view === 'front', JSON.stringify(views));
check('facing away draws the back',
  !!views && byF((views.toward + 2) % 4).view === 'back', JSON.stringify(views));
check('a body mid-strike draws its attack pose', !!views && views.striking === 'attack',
  JSON.stringify(views));
check('the two perpendicular facings draw one profile, mirrored',
  !!views
  && byF((views.toward + 1) % 4).view === 'side'
  && byF((views.toward + 3) % 4).view === 'side'
  && byF((views.toward + 1) % 4).flip !== byF((views.toward + 3) % 4).flip,
  JSON.stringify(views));

console.log('\n=== 3e. the minimap does not draw creatures through walls ===');
/**
 * The map and the 3D world have to agree about what you can see. They did not: the
 * map plotted any entity standing on an EXPLORED tile, so a hostile in a room you
 * had already walked through was drawn live from memory — on the map, invisible on
 * screen, and effectively a wallhack.
 *
 * Terrain is different and stays remembered, so this also checks the other half:
 * furniture out of sight is still allowed on the map, because it cannot have moved.
 */
const mini = await ev(async () => {
  const g = window.__game;
  const grid = g.floor.grid;
  // `Hud.onMap` is the real filter the draw loop uses, reached through the instance's
  // constructor so the test cannot drift from the drawing.
  const onMap = g.hud.constructor.onMap;
  const idx = (e) => grid.idx(e.sprite.tx, e.sprite.ty);
  const live = g.floor.entities.filter((e) => e.alive && grid.inside(e.sprite.tx, e.sprite.ty));
  const movers = live.filter((e) => e.hostile || e.animated);
  const hidden = movers.filter((e) => !g.floor.visible.has(idx(e)));
  return {
    visibleCount: g.floor.visible.size,
    // Movers that are OUT of sight but on ground already explored. These are the
    // ones the old rule drew: on the map, nothing on screen.
    hiddenButExplored: hidden.filter((e) => !!grid.explored[idx(e)]).length,
    // ...and how many of those the map still plots. Must be zero.
    hiddenAndPlotted: hidden.filter((e) => onMap(g.floor, e)).length,
    // The map and the 3D world have to agree, body for body.
    disagreements: movers.filter((e) => onMap(g.floor, e) !== e.sprite.group.visible).length,
    // Furniture out of sight is still allowed on the map: it cannot have moved.
    staticPlottedOffScreen: live.filter((e) => !(e.hostile || e.animated)
      && !g.floor.visible.has(idx(e)) && onMap(g.floor, e)).length,
  };
});
console.log(mini);
check('the visible set is populated', mini.visibleCount > 0, JSON.stringify(mini));
check('the scenario actually contains a hidden hostile to catch',
  mini.hiddenButExplored > 0, JSON.stringify(mini));
check('no out-of-sight creature is plotted on the map', mini.hiddenAndPlotted === 0,
  JSON.stringify(mini));
check('the map and the 3D world agree body for body', mini.disagreements === 0,
  JSON.stringify(mini));
check('furniture out of sight is still remembered on the map',
  mini.staticPlottedOffScreen > 0, JSON.stringify(mini));

console.log('\n=== 3f. the telegraph marks what can reach you ===');
/**
 * A hostile now closes AND swings in one round, so its reach is two tiles. The
 * telegraph promises exactly that, and the promise is the point: a warning that
 * fired at a different range from the one `enemyRound` steps by would teach a rule
 * the game does not follow.
 */
const tele = await ev(async () => {
  const g = window.__game;
  const grid = g.floor.grid;
  const dirs = [[0, 0, 1], [1, -1, 0], [2, 0, -1], [3, 1, 0]];
  const home = { x: g.stepper.x, y: g.stepper.y, dir: g.stepper.dir };
  const e = g.floor.entities.find((x) => x.alive && x.hostile);
  if (!e) return null;
  const dist = () => Math.abs(e.sprite.tx - g.stepper.x) + Math.abs(e.sprite.ty - g.stepper.y);
  const out = {};
  // Stand adjacent and run a round, which alerts it and puts it well in reach.
  for (const [d, dx, dy] of dirs) {
    const px = e.sprite.tx + dx, py = e.sprite.ty + dy;
    if (!grid.walkable(px, py) || g.floor.solidAt(px, py)) continue;
    g.place(px, py, d);
    await g.combat.playerStepped(px, py);
    out.near = { d: dist(), flagged: g.hud.threats.has(e), alerted: g.combat.isAlerted(e) };
    break;
  }
  // Now walk it out of reach without letting it act, and the warning must drop.
  const far = g.floor.entities.find((x) => x === e);
  for (let tries = 0; tries < 40 && dist() <= 2; tries++) {
    far.sprite.tx += 1;
    if (!grid.walkable(far.sprite.tx, far.sprite.ty)) { far.sprite.tx -= 1; break; }
  }
  g.place(g.stepper.x, g.stepper.y, g.stepper.dir);
  out.far = { d: dist(), flagged: g.hud.threats.has(e) };
  g.place(home.x, home.y, home.dir);
  return out;
});
console.log(tele);
check('a hostile in reach is telegraphed',
  !!tele && tele.near && tele.near.d <= 2 && tele.near.flagged === true, JSON.stringify(tele));
check('a hostile out of reach is not telegraphed',
  !!tele && tele.far && (tele.far.d <= 2 || tele.far.flagged === false), JSON.stringify(tele));

console.log('\n=== 4. one cast, one turn: Fireball on the furniture ===');
const solo = await ev(async () => {
  const g = window.__game;
  const prop = g.floor.entities.find((e) => e.kind === 'prop' && !e.animated);
  // `combat.turns` is the honest round counter — every price is paid through it,
  // and since the rebase there are exactly two things that pay: a cast and a step.
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
// INVERTED for cast = 1 turn. These two checks used to read "one page costs one turn"
// and "releasing the cast is free"; they are the same two measurements with the
// answers swapped, which is the whole of the rebase stated as a test.
check('tearing a page costs no turn', solo.tornTurns === 0, `${solo.tornTurns} turns`);
check('releasing the cast costs one turn', solo.castTurns === 1, `${solo.castTurns} turns`);
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

console.log('\n=== 4b. draw and cancel in a loop, standing in a fight ===');
/**
 * The rebase's whole reason for existing, as a measurement. Under the superseded rule
 * a tear bought the room a round and putting the page back bought nothing back, so
 * this loop handed a room twelve free rounds and could kill you for changing your mind.
 * Run from a tile ADJACENT to a live hostile, because out of combat the old rule was
 * free too — the trap only sprang where it mattered.
 */
const indecision = await ev(async () => {
  const g = window.__game;
  const foe = g.floor.entities.find((e) => e.alive && e.hostile);
  if (!foe) return null;
  const grid = g.floor.grid;
  for (const [d, dx, dy] of [[0, 0, 1], [1, -1, 0], [2, 0, -1], [3, 1, 0]]) {
    const px = foe.sprite.tx + dx, py = foe.sprite.ty + dy;
    if (grid.walkable(px, py)) { g.place(px, py, d); break; }
  }
  g.returnHand();
  const t0 = g.combat.turns;
  const hp0 = g.state.hp;
  const foeHp0 = foe.hp;
  for (let i = 0; i < 6; i++) {
    await g.selectPages(['fire']);
    if (g.fan.count !== 1) return { held: g.fan.count, aborted: i };
    g.returnComponent(0);
  }
  const out = {
    turns: g.combat.turns - t0, hpLost: hp0 - g.state.hp,
    foeHurt: foeHp0 - foe.hp, held: g.fan.count,
    dist: Math.abs(foe.sprite.tx - g.stepper.x) + Math.abs(foe.sprite.ty - g.stepper.y),
  };
  g.returnHand();
  return out;
});
console.log(indecision);
check('six draw-and-cancel cycles beside a hostile spend no turn',
  !!indecision && indecision.turns === 0, indecision ? `${indecision.turns} turns` : 'no hostile');
check('and cost no HP', !!indecision && indecision.hpLost === 0,
  indecision ? `${indecision.hpLost} HP` : '');
check('and leave the hand empty and the hostile untouched',
  !!indecision && indecision.held === 0 && indecision.foeHurt === 0,
  indecision ? `held ${indecision.held}, foe took ${indecision.foeHurt}` : '');

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
      // The price is ONE TURN, whatever the set holds. There is no mana, and there is
      // no per-component charge either: what a set costs is the hand SLOTS it fills,
      // which is `s.length` and is not a turn count.
      turns: 1,
      slots: s.length,
      refusal: c.refusal ?? null,
      name: c.name, damage: c.damage, count: c.count, authored: c.authored,
    };
  };
  return { elems: elems.map(row), ingrs: ingrs.map(row) };
}, [ELEMENT_SETS, INGREDIENT_SETS]);
for (const r of [...table.elems, ...table.ingrs]) {
  console.log(`  ${r.set.padEnd(20)} ${r.slots}sl/${r.turns}t -> ${
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
  const fusionAssembly = g.combat.turns - t0;
  g.hud.target = foe;
  const t1 = g.combat.turns;
  await g.castNow();
  const fusionCast = g.combat.turns - t1;
  const afterSoak = { hp: foe.hp, statuses: g.combat.statusesOf(foe).map((s) => s.id) };
  await g.selectPages(['spark']);                // shock on soaked -> CONDUCTION
  g.hud.target = foe;
  const t2 = g.combat.turns;
  await g.castNow();
  const soloCast = g.combat.turns - t2;
  return {
    kind: foe.kind, before, afterSoak, fusionAssembly, fusionCast, soloCast,
    afterShock: { hp: foe.hp, statuses: g.combat.statusesOf(foe).map((s) => s.id) },
    playerHp: g.state.hp,
  };
});
console.log(fight);
check('a fusion lands on the target', !!fight && fight.afterSoak.hp < fight.before,
  fight ? `${fight.before} -> ${fight.afterSoak.hp}` : 'no body to fight');
// INVERTED for cast = 1 turn. This check used to read "a two-page fusion costs two
// turns"; it is now the acceptance criterion "a three-page fusion and a one-page cast
// both cost exactly one turn", measured on a pair because a pair is what floor 1 can
// assemble. Assembling it is free and releasing it costs exactly what a single page
// costs, which is the whole of what fusion no longer being priced in turns means.
check('assembling a two-page fusion costs nothing', !!fight && fight.fusionAssembly === 0,
  fight ? `${fight.fusionAssembly} turns` : '');
check('a two-page fusion and a one-page cast both cost one turn',
  !!fight && fight.fusionCast === 1 && fight.soloCast === 1,
  fight ? `fusion ${fight.fusionCast}, solo ${fight.soloCast}` : '');
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
