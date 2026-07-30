/**
 * Throwaway: proves the two-finger movement hand. Delete after the phase.
 */
import { openGame, launch, serve, check, note, finish } from './harness.mjs';

const stop = await serve();
const browser = await launch();
const { page, errors, ev } = await openGame(browser, { prefix: 'gest', freshSave: true });
const cdp = await page.context().newCDPSession(page);

await ev(() => {
  const G = window.__game;
  window.__t = {
    spot() {
      const g = G.floor.grid;
      const ok = (a, b) => g.walkable(a, b) && !G.floor.entityAt(a, b);
      for (let y = 2; y < g.h - 2; y++) {
        for (let x = 2; x < g.w - 2; x++) {
          if (ok(x, y) && ok(x, y - 1) && ok(x, y + 1) && ok(x - 1, y) && ok(x + 1, y)) return { x, y };
        }
      }
      return null;
    },
    /** A tile whose north neighbour is a wall, so W has something to fail against. */
    wallSpot() {
      const g = G.floor.grid;
      for (let y = 2; y < g.h - 2; y++) {
        for (let x = 2; x < g.w - 2; x++) {
          if (g.walkable(x, y) && !G.floor.entityAt(x, y) && !g.walkable(x, y - 1)) return { x, y };
        }
      }
      return null;
    },
    put(kind, x, y) {
      const e = G.floor.entities.find((q) => q.kind === kind && q.alive);
      if (!e) return null;
      e.sprite.tx = x; e.sprite.ty = y;
      e.hp = e.maxHp = 9999;
      window.__t.subject = e;
      return { kind: e.kind, x, y };
    },
    clearBodies() {
      for (const e of G.floor.entities) {
        if (e.kind === 'enemy' || e.kind === 'boss') { e.sprite.tx = -99; e.sprite.ty = -99; }
      }
    },
    st() {
      const s = G.stepper;
      const sub = window.__t.subject;
      return {
        x: s.x, y: s.y, dir: s.dir, turns: G.combat.turns, busy: s.busy,
        sx: sub ? sub.sprite.tx : null, sy: sub ? sub.sprite.ty : null,
        book: !G.book.closed, page: G.book.currentSpell.id,
        top: Math.round(G.book.screenTop()),
      };
    },
    reset(x, y, dir) {
      G.state.hp = G.state.maxHp = 999;
      G.place(x, y, dir);
    },
  };
});

const st = () => ev(() => window.__t.st());
const settle = async () => {
  await page.waitForFunction(() => !window.__game.stepper.busy, null, { timeout: 5000 });
  await page.waitForTimeout(1400);
  await page.waitForFunction(() => !window.__game.stepper.busy, null, { timeout: 5000 });
};

const GAP = 45;
async function twoDrag(dx, dy, cx = 195, cy = 380) {
  const pts = (ox, oy) => [
    { x: cx - GAP + ox, y: cy + oy, id: 1, radiusX: 6, radiusY: 6, force: 1 },
    { x: cx + GAP + ox, y: cy + oy, id: 2, radiusX: 6, radiusY: 6, force: 1 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0, 0) });
  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(dx * i / 5, dy * i / 5) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function oneDrag(dx, dy, cx = 195, cy = 380) {
  const p = (ox, oy) => [{ x: cx + ox, y: cy + oy, id: 1, radiusX: 6, radiusY: 6, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: p(0, 0) });
  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: p(dx * i / 5, dy * i / 5) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Pinch: fingers separate vertically, centroid drifts far enough to look like a swipe. */
async function pinch(cx = 195, cy = 430) {
  const pts = (s, oy) => [
    { x: cx, y: cy - s + oy, id: 1, radiusX: 6, radiusY: 6, force: 1 },
    { x: cx, y: cy + s + oy, id: 2, radiusX: 6, radiusY: 6, force: 1 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(30, 0) });
  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(30 + 14 * i, -6 * i) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const spot = await ev(() => window.__t.spot());
await ev(() => window.__t.clearBodies());
note('open tile', JSON.stringify(spot));

// ---------------------------------------------------------- the four gestures
const cases = [
  ['two-finger left  = side-step west, facing kept', [-90, 0], { dx: -1, dy: 0, dir: 0 }],
  ['two-finger right = side-step east, facing kept', [90, 0], { dx: 1, dy: 0, dir: 0 }],
  ['two-finger up    = step north + 180', [0, -90], { dx: 0, dy: -1, dir: 2 }],
  ['two-finger down  = step south + 180', [0, 90], { dx: 0, dy: 1, dir: 2 }],
];
for (const [label, [gx, gy], want] of cases) {
  await ev(([x, y]) => window.__t.reset(x, y, 0), [spot.x, spot.y]);
  const a = await st();
  await twoDrag(gx, gy);
  await settle();
  const b = await st();
  check(label,
    b.x - a.x === want.dx && b.y - a.y === want.dy && b.dir === want.dir,
    `${a.x},${a.y} dir${a.dir} -> ${b.x},${b.y} dir${b.dir}`);
  check(`  one turn only (${label.slice(0, 16).trim()})`, b.turns - a.turns === 1, `turns +${b.turns - a.turns}`);
}

// ---------------------------------------------------------- keyboard mirrors
const keyCases = [
  ['KeyA', { dx: -1, dy: 0, dir: 0 }],
  ['KeyD', { dx: 1, dy: 0, dir: 0 }],
  ['KeyW', { dx: 0, dy: -1, dir: 2 }],
  ['KeyS', { dx: 0, dy: 1, dir: 2 }],
];
for (const [code, want] of keyCases) {
  await ev(([x, y]) => window.__t.reset(x, y, 0), [spot.x, spot.y]);
  const a = await st();
  await page.keyboard.press(code);
  await settle();
  const b = await st();
  check(`${code} matches its gesture`,
    b.x - a.x === want.dx && b.y - a.y === want.dy && b.dir === want.dir,
    `${a.x},${a.y} dir${a.dir} -> ${b.x},${b.y} dir${b.dir}`);
  check(`  one turn only (${code})`, b.turns - a.turns === 1, `turns +${b.turns - a.turns}`);
}

// arrows stay plain
await ev(([x, y]) => window.__t.reset(x, y, 0), [spot.x, spot.y]);
{
  const a = await st();
  await page.keyboard.press('ArrowUp');
  await settle();
  const b = await st();
  check('ArrowUp is still a plain forward step (no 180)',
    b.y - a.y === -1 && b.dir === 0, `${a.y} -> ${b.y} dir${b.dir}`);
}

// ---------------------------------------------------------- swap
for (const kind of ['enemy', 'boss']) {
  for (const [gesture, gy, label] of [[-90, -90, 'W'], [90, 90, 'S']]) {
    void gesture;
    await ev(([x, y]) => window.__t.reset(x, y, 0), [spot.x, spot.y]);
    const ahead = gy < 0 ? -1 : 1;
    const put = await ev(([k, x, y]) => window.__t.put(k, x, y), [kind, spot.x, spot.y + ahead]);
    if (!put) { note(`no ${kind} on this floor`); continue; }
    const a = await st();
    await twoDrag(0, gy);
    await page.waitForTimeout(70);
    const mid = await st();
    await settle();
    const b = await st();
    const swapped = mid.x === a.x && mid.y === a.y + ahead && mid.sx === a.x && mid.sy === a.y;
    // Behind it = it stands on the tile you left, and you are looking at that tile.
    const behind = swapped && (label === 'W' ? b.dir === 2 : b.dir === 0);
    check(`${label} into a ${kind} swaps and leaves the player behind it`,
      swapped && behind,
      `player ${a.x},${a.y} d${a.dir} -> ${mid.x},${mid.y} d${b.dir}; ${kind} ${a.x},${a.y + ahead} -> ${mid.sx},${mid.sy}`);
    check(`  one turn only (${label} swap ${kind})`, b.turns - a.turns === 1, `turns +${b.turns - a.turns}`);
    await ev(() => window.__t.clearBodies());
  }
}

// a non-body is not swappable
{
  const fix = await ev(() => {
    const G = window.__game;
    const e = G.floor.entities.find((q) => q.alive && (q.kind === 'altar' || q.kind === 'chest' || q.kind === 'prop'));
    if (!e) return null;
    const g = G.floor.grid;
    for (const e2 of G.floor.entities) {
      if (!e2.alive || !['altar', 'chest', 'prop'].includes(e2.kind) || e2.animated) continue;
      const x = e2.sprite.tx, y = e2.sprite.ty;
      for (const [d, dx, dy] of [[0, 0, 1], [1, -1, 0], [2, 0, -1], [3, 1, 0]]) {
        if (!g.walkable(x + dx, y + dy) || G.floor.entityAt(x + dx, y + dy)) continue;
        window.__t.subject = e2;
        G.state.hp = G.state.maxHp = 999;
        G.place(x + dx, y + dy, d);
        return { kind: e2.kind, x, y };
      }
    }
    void e; return null;
  });
  if (fix) {
    const a = await st();
    await page.keyboard.press('KeyW');
    await settle();
    const b = await st();
    check(`W into a ${fix.kind} does not swap with it`,
      b.x === a.x && b.y === a.y && b.dir === a.dir, `${a.x},${a.y} -> ${b.x},${b.y} d${b.dir}`);
    check('  a refused compound move costs no turn', b.turns === a.turns, `turns +${b.turns - a.turns}`);
  } else note('no fixture with a walkable south neighbour');
}

// ---------------------------------------------------------- wall
{
  const w = await ev(() => window.__t.wallSpot());
  await ev(([x, y]) => window.__t.reset(x, y, 0), [w.x, w.y]);
  const a = await st();
  await twoDrag(0, -90);
  await settle();
  const b = await st();
  check('W into a wall does not move the player through it',
    b.x === a.x && b.y === a.y && b.dir === a.dir, `at ${a.x},${a.y} dir${a.dir} -> ${b.x},${b.y} dir${b.dir}`);
  check('  a bump costs no turn', b.turns === a.turns, `turns +${b.turns - a.turns}`);
}

// ---------------------------------------------------------- pinch
{
  await ev(([x, y]) => window.__t.reset(x, y, 0), [spot.x, spot.y]);
  const a = await st();
  await pinch();
  await settle();
  const b = await st();
  check('a pinch does not move the player',
    b.x === a.x && b.y === a.y && b.dir === a.dir && b.turns === a.turns,
    `${a.x},${a.y} d${a.dir} t${a.turns} -> ${b.x},${b.y} d${b.dir} t${b.turns}`);
}

// ---------------------------------------------------------- over the book
{
  // The grimoire only shows with something to cast at, so stand an enemy in front.
  await ev(([x, y]) => window.__t.reset(x, y, 0), [spot.x, spot.y]);
  await ev(([x, y]) => window.__t.put('enemy', x, y), [spot.x, spot.y - 1]);
  await ev(([x, y]) => {
    window.__t.reset(x, y, 0);
    const h = window.__game.hud;
    h.target = h.candidates.find((e) => e.hostile) ?? h.candidates[0] ?? null;
  }, [spot.x, spot.y]);
  await page.waitForTimeout(1400);
  const a = await st();
  note('book on screen', `${a.book} top=${a.top} page=${a.page}`);
  if (!a.book) {
    check('grimoire is on screen for the book tests', false);
  } else {
    const by = Math.min(820, a.top + 90);
    // one finger over the book still leafs
    await oneDrag(-130, 0, 195, by);
    await page.waitForTimeout(900);
    const l = await st();
    check('one finger over the book still leafs a page', l.page !== a.page, `${a.page} -> ${l.page}`);
    check('  ...and does not move the player', l.x === a.x && l.y === a.y && l.dir === a.dir);

    // two fingers over the book move instead
    await ev(([x, y]) => window.__t.reset(x, y, 0), [spot.x, spot.y]);
    await page.waitForTimeout(600);
    const c = await st();
    await twoDrag(90, 0, 195, by);
    await settle();
    const d = await st();
    check('two fingers over the book side-step east',
      d.x - c.x === 1 && d.y === c.y && d.dir === c.dir, `${c.x},${c.y} -> ${d.x},${d.y} d${d.dir}`);
    check('  ...and do not leaf the page', d.page === c.page, `${c.page} -> ${d.page}`);
    check('  one turn only (two fingers over book)', d.turns - c.turns === 1, `turns +${d.turns - c.turns}`);
  }
}

finish(errors);
await browser.close();
stop();
