/**
 * Verifies the ported grimoire: flip, tear, fan, merge-cast, and the two gates on
 * a tear (you have not learned it / your hand is full).
 *
 * The book is FIVE element pages. All five ingredients are belt items with no page,
 * so the old "tear Animate" beat could not be true — `tearAt` wraps modulo the book's
 * length, so the index that used to mean Animate now means Spark. It is replaced by
 * the assertion that holds permanently: no index in the book yields an ingredient.
 * The belt is where an ingredient comes from now, and it is driven in its own
 * harness (Roadmap/Ingredient_Belt.md); this file is about the BOOK.
 *
 * Order matters here. The hand-size gate runs BEFORE any multi-page
 * `selectPages`, because that debug helper lifts the hand ceiling for the session.
 */
import { serve, launch, openGame, check, note, finish } from './harness.mjs';

const stopServer = await serve();
const browser = await launch();
// The intro cascade has to settle before the book will accept a gesture.
const { page, errors, shot, ev } = await openGame(browser, {
  prefix: 'bk', wait: 4200, freshSave: true,
});

const INGREDIENTS = ['animate', 'moss', 'grow', 'split', 'sand'];

const intro = await ev(() => {
  const g = window.__game;
  return {
    page: g.book.currentSpell.name, index: g.book.index, busy: g.book.busy,
    fan: g.fan.count, handSize: g.meta.handSize, learned: g.state.pages,
  };
});
console.log('after intro:', intro);
check('the book opens on a page', !!intro.page, String(intro.page));
check('hand size is 1 on a fresh save', intro.handSize === 1, String(intro.handSize));
await shot('01-intro-settled');

console.log('\n-- flip forward twice --');
await ev(() => { window.__game.book.swipe(1); });
await page.waitForTimeout(500);
await ev(() => { window.__game.book.swipe(1); });
await page.waitForTimeout(600);
const flipped = await ev(() => ({
  name: window.__game.book.currentSpell.name, index: window.__game.book.index,
}));
console.log('now on:', flipped);
check('flipping moves the book off page 0', flipped.index !== intro.index, JSON.stringify(flipped));
await shot('02-flipped');

console.log('\n-- the book is five element pages --');
const shape = await ev(() => {
  const g = window.__game;
  g.grantAll();
  g.book.refresh();
  const ids = g.bookPages();
  return { ids, atSeven: ids[7 % ids.length] };
});
console.log(shape);
check('a full book is five pages', shape.ids.length === 5, shape.ids.join(','));
check('no page is an ingredient',
  shape.ids.every((id) => !INGREDIENTS.includes(id)), shape.ids.join(','));
// The case this replaces asserted index 7 was Animate. `tearAt` takes the index
// modulo the book's length, so in a five-page book 7 is Spark.
check('index 7 wraps to Spark in a five-page book', shape.atSeven === 'spark', shape.atSeven);

console.log('\n-- canRip gating: unlearned page, then a full hand --');
const gating = await ev(() => {
  const g = window.__game;
  const ids = g.bookPages();
  const learned = {};
  // Only Fireball learned. The BOOK keeps all five pages (setBookPages is not
  // called), which is the point: canRip has to refuse the four it can reach.
  g.state.pages = ['fire'];
  for (let i = 0; i < ids.length; i++) {
    g.fan.clear();
    learned[ids[i]] = g.book.tearAt(i);
  }
  // index 7 is Spark, and Spark is not learned
  g.fan.clear();
  const wrapped = g.book.tearAt(7);

  // Hand full: at hand size 1 the second tear of a learned page is refused.
  g.fan.clear();
  const first = g.book.tearAt(0);
  const second = g.book.tearAt(0);
  const handAfter = g.fan.count;
  g.fan.clear();
  return { learned, wrapped, first, second, handAfter, handSize: g.meta.handSize };
});
console.log(gating);
check('a learned page tears', gating.learned.fire === true, JSON.stringify(gating.learned));
check('every unlearned page is refused',
  ['frost', 'spark', 'gust', 'rot'].every((id) => gating.learned[id] === false),
  JSON.stringify(gating.learned));
check('a wrapped index is gated on what it lands on, not on what it used to be',
  gating.wrapped === false, String(gating.wrapped));
check('at hand size 1 the first tear lands and the second is refused',
  gating.first === true && gating.second === false, `${gating.first} / ${gating.second}`);
check('a refused tear does not grow the hand', gating.handAfter === 1, `fan ${gating.handAfter}`);

console.log('\n-- tear two elements and cast the fusion --');
// The gating tears above each bought the room a round, and a tear is BLOCKED
// (not refused) while one is still resolving. Let them drain.
await page.waitForTimeout(1200);
const torn = await ev(async () => {
  const g = window.__game;
  g.grantAll();
  // stand next to a prop and target it
  const prop = g.floor.entities.find((e) => e.kind === 'prop' && !e.animated);
  const grid = g.floor.grid;
  for (const [d, dx, dy] of [[0, 0, 1], [1, -1, 0], [2, 0, -1], [3, 1, 0]]) {
    const px = prop.sprite.tx + dx * 3, py = prop.sprite.ty + dy * 3;
    if (grid.walkable(px, py)) { g.place(px, py, d); break; }
  }
  await g.selectPages(['fire', 'frost']);
  g.hud.target = prop;
  await new Promise((r) => setTimeout(r, 60));
  return {
    fanCount: g.fan.count, fanIds: g.fan.gameIds,
    preview: g.hud.currentCast()?.name, propHp: prop.hp,
  };
});
console.log(torn);
check('two pages sit in the fan', torn.fanCount === 2, `fan ${torn.fanCount}`);
check('the fan previews the authored fusion', torn.preview === 'Steam Burst', String(torn.preview));
await page.waitForTimeout(900);
await shot('03-torn-fan');

console.log('\n-- cast (fan merges, then the spell fires) --');
await ev(() => window.__game.castNow());
await page.waitForTimeout(700);
await shot('04-merging');
const after = await ev(() => {
  const g = window.__game;
  const prop = g.floor.entities.find((e) => e.kind === 'prop');
  return {
    fanAfter: g.fan.count,
    propHp: prop ? prop.hp : null, propAlive: prop ? prop.alive : null,
    animated: g.floor.entities.filter((e) => e.animated).length,
  };
});
await page.waitForTimeout(1400);
console.log(after);
check('the merge empties the fan', after.fanAfter === 0, `fan ${after.fanAfter}`);
check('the fusion hits the furniture',
  after.propHp === null || after.propHp < torn.propHp || after.propAlive === false,
  `${torn.propHp} -> ${after.propHp}`);
// Was "no page supplies animate". Still nothing rose, but the reason to assert is
// that a hand of two ELEMENTS resolves to a projectile — an animating ingredient is
// the only thing that makes a golem, and this hand never held one.
check('nothing rose — two elements make a bolt, not a body',
  after.animated === 0, String(after.animated));
note('the golem path is driven in the belt harness', 'Roadmap/Ingredient_Belt.md');
await shot('05-after-cast');

finish(errors);
await browser.close();
stopServer();
