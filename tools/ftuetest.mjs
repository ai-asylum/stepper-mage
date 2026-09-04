/**
 * The guided first descent, driven end to end.
 *
 * This repo's tests are its harnesses, so this is the contract for
 * `src/game/onboarding.ts`: every beat is ended by the real thing it claims to
 * wait for, the one gate it holds lifts, the give-up clock releases a beat the
 * room cannot answer, the skip works, and the completion persists.
 *
 * It is the only harness that opts INTO the flow (`openGame({ onboarding: true })`)
 * — every other one measures the game, which is why `openGame` marks the flow
 * complete by default.
 *
 * Where a beat needs the world to cooperate it is driven through the debug
 * surface rather than by walking a generated floor until something turns up:
 * `place` stands the player where the rule can be satisfied and `harvest` takes
 * the same path the pill does. The two beats that are pure input — the step and
 * the turn — go through real key events, because the thing under test there IS
 * the input path.
 */
import { openGame, launch, serve, check, note, finish } from './harness.mjs';

const stop = await serve();
const browser = await launch();
const { page, errors, ev } = await openGame(browser, {
  prefix: 'ftue', freshSave: true, onboarding: true,
});

/** Which beat is up, plus what it is saying and whether the gate is on. */
const beat = () => ev(() => {
  const g = window.__game;
  return {
    id: g.onboarding.step?.id ?? null,
    line: g.onboarding.line,
    live: g.onboarding.live,
    holdsBook: g.onboarding.holdsBook(),
    held: g.fan.count,
  };
});

const key = async (code) => {
  await page.keyboard.press(code);
  await page.waitForTimeout(700);         // a step is 235ms, a turn 170ms
};

console.log('\n=== 1. it opens on the movement beat ===');
const first = await beat();
console.log(first);
check('the flow is live on a fresh save', first.live === true);
check('the first beat is the step', first.id === 'step', String(first.id));
check('and it says so', /SWIPE/.test(first.line ?? ''), String(first.line));
const script = await ev(() => window.__game.onboardingSteps().join(','));
check('the six beats are the script', script === 'step,turn,aim,tear,cast,harvest', script);

console.log('\n=== 2. the book is held for exactly one beat ===');
check('the grimoire refuses a page while the first instruction is up',
  first.holdsBook === true);
const heldTear = await ev(async () => {
  await window.__game.selectPages(['fire']);
  return window.__game.fan.count;
});
check('so a scripted tear takes nothing', heldTear === 0, `held ${heldTear}`);
/**
 * And the refusal lets go on its own, without the step: `HOLD_BOOK_S` is what
 * keeps the gate from outlasting a playable ad. Fast-forwarded, then put back —
 * the beat itself must survive this, because the instruction is not what expires.
 */
const expired = await ev(async () => {
  const g = window.__game;
  g.onboarding.update(9, true);
  const gate = g.onboarding.holdsBook();
  await g.selectPages(['fire']);
  const held = g.fan.count;
  const id = g.onboarding.step?.id ?? null;
  g.returnHand();
  // Back to a fresh first beat, so the real step below is measured against the
  // gate on rather than against this fast-forward.
  g.replayOnboarding();
  return { gate, held, id };
});
check('the gate expires on its own clock', expired.gate === false);
check('and the book takes a page once it has', expired.held === 1, `held ${expired.held}`);
check('while the beat is still the one asking', expired.id === 'step', String(expired.id));

console.log('\n=== 3. a real step ends the step beat ===');
// ArrowUp is the keyboard's plain forward — the same `stepper.press` a swipe
// resolves to. Repeated because a generated floor can put a wall ahead, and a
// bump is not an arrival.
let stepped = null;
for (const code of ['ArrowUp', 'ArrowLeft', 'ArrowUp', 'ArrowLeft', 'ArrowUp']) {
  await key(code);
  stepped = await beat();
  if (stepped.id !== 'step') break;
}
console.log(stepped);
check('the step beat is over once the player has moved', stepped.id !== 'step',
  String(stepped.id));
check('and the book is free again', stepped.holdsBook === false);
const freeTear = await ev(async () => {
  await window.__game.selectPages(['fire']);
  const n = window.__game.fan.count;
  window.__game.returnHand();
  return n;
});
check('a tear lands now', freeTear === 1, `held ${freeTear}`);

console.log('\n=== 4. the beats run in order, each on its own real event ===');
/**
 * The turn beat may already be behind us: a turn is what the loop above used to
 * get out of a corner, and `onTurnDone` is what ends it. Either way the next
 * thing asked for is aiming.
 */
let turned = stepped;
// Retried, like the step loop: a press that arrives while the stepper is still
// finishing the last move is dropped rather than queued, so one keystroke is not
// a statement about whether a turn ends the beat.
for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowLeft']) {
  if (turned.id !== 'turn') break;
  await key(code);
  turned = await beat();
}
check('a completed turn ends the turn beat', turned.id !== 'turn', String(turned.id));

// Aiming is a STATE, not an event — the reticle can be set by a tap or by the
// auto-select, and the beat is over either way.
const aimed = await ev(() => {
  const g = window.__game;
  if (!g.hud.target) g.targetKind('enemy') || g.targetKind('prop');
  return !!g.hud.target;
});
await page.waitForTimeout(140);
const atTear = await beat();
check('a reticle ends the aim beat', aimed && atTear.id !== 'aim', String(atTear.id));
check('and the tear beat is what asks next', atTear.id === 'tear', String(atTear.id));

const atCast = await ev(async () => {
  await window.__game.selectPages(['fire']);
  await new Promise((r) => setTimeout(r, 160));
  return { id: window.__game.onboarding.step?.id ?? null, held: window.__game.fan.count };
});
check('a page in the hand ends the tear beat', atCast.id === 'cast',
  `${atCast.id}, holding ${atCast.held}`);

const atHarvest = await ev(async () => {
  await window.__game.castNow();
  await new Promise((r) => setTimeout(r, 500));
  return window.__game.onboarding.step?.id ?? null;
});
check('a cast that spent the turn ends the cast beat', atHarvest === 'harvest',
  String(atHarvest));

console.log('\n=== 5. the last beat, and the completion ===');
/**
 * Stand next to a fixture and face it — the reach rule every interaction in the
 * game obeys, so the harvest has to satisfy it exactly as a player would.
 * `harvestInReach` wants the fixture on the tile directly ahead, so the standing
 * tile is the fixture minus the facing vector; `DIR_VEC` is `grid.ts`'s
 * north/east/south/west, copied here because the harness cannot import it.
 */
const done = await ev(async () => {
  const g = window.__game;
  const DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  /**
   * The whole floor's props, not `harvestable()` — that one lists what is IN
   * SIGHT, and where the four scripted steps above left the player facing is not
   * a statement about what the room holds. Which of these actually yields an
   * element is not this harness's opinion to have: `harvest` goes through
   * `harvestFrom`, so a prop that is scenery simply refuses and the loop moves on.
   */
  const props = g.floor.entities.filter((e) => e.kind === 'prop' && e.alive);
  for (const h of props.map((e) => ({ e }))) {
    for (let d = 0; d < 4; d++) {
      const px = h.e.sprite.tx - DIR[d][0], py = h.e.sprite.ty - DIR[d][1];
      if (!g.floor.grid.walkable(px, py) || g.floor.entityAt(px, py)) continue;
      g.place(px, py, d);
      g.returnHand();
      if (!(await g.harvest(h.e))) continue;
      await new Promise((r) => setTimeout(r, 160));
      return {
        id: g.onboarding.step?.id ?? null,
        live: g.onboarding.live,
        line: g.onboarding.line,
        saved: localStorage.getItem('stepper-mage.onboarding.v1'),
      };
    }
  }
  return null;
});
if (done) {
  console.log(done);
  check('a harvest ends the last beat and the flow with it', done.live === false);
  check('nothing is left on screen to say', done.line === null, String(done.line));
  check('and the completion is persisted', done.saved === 'done', String(done.saved));
} else {
  // Not a failure: whether a room holds a fixture with an element in it is a
  // property of the generated floor, and it is exactly the case `giveUpS` exists
  // for. The give-up is asserted directly below.
  note('no reachable fixture on this floor — the harvest beat was not driven');
}

console.log('\n=== 6. nothing can wedge ===');
/**
 * The give-up clock, asserted by fast-forwarding it rather than by waiting 30
 * seconds: `update` is fed the frame delta, so handing it one large one is the
 * same arithmetic the loop does. This is the guard against the failure mode the
 * whole file is arranged against — a beat the room cannot answer, asking forever.
 */
const gaveUp = await ev(() => {
  const g = window.__game;
  g.replayOnboarding();
  const before = g.onboarding.step?.id ?? null;
  // 31s of nothing on a beat whose ceiling is 30.
  g.onboarding.update(31, true);
  return { before, after: g.onboarding.step?.id ?? null };
});
check('a beat nobody answers gives up and hands over the next one',
  gaveUp.before === 'step' && gaveUp.after === 'turn',
  `${gaveUp.before} -> ${gaveUp.after}`);

console.log('\n=== 7. the way out ===');
/**
 * The SKIP pill is drawn from measured text, so where it IS is only answerable by
 * asking. A frame after the replay before asking, because `hudAt` reads the hit
 * regions the last DRAW pushed — the pill has to have been on screen once for
 * there to be anything to hit.
 */
await ev(() => window.__game.replayOnboarding());
await page.waitForTimeout(180);
const skipped = await ev(() => {
  const g = window.__game;
  let hit = null;
  for (let y = 300; y < 900 && !hit; y += 3) {
    for (let x = 120; x < 280; x += 6) {
      if (g.hudAt(x, y) === 'ftueSkip') { hit = { x, y }; break; }
    }
  }
  if (!hit) return { hit: null, live: g.onboarding.live };
  g.tapHud(hit.x, hit.y);
  return {
    hit, live: g.onboarding.live, line: g.onboarding.line,
    saved: localStorage.getItem('stepper-mage.onboarding.v1'),
  };
});
console.log(skipped);
check('the skip is a real drawn control', !!skipped.hit,
  skipped.hit ? '' : 'no ftueSkip region on screen');
check('tapping it ends the flow', skipped.live === false);
check('and that is remembered', skipped.saved === 'skipped', String(skipped.saved));

console.log('\n=== 8. the game plays normally afterwards ===');
// A frame, because the HUD's copy of the line is read by the loop and not pushed
// by the skip — so "nothing left on screen" is only answerable after one tick.
await page.waitForTimeout(140);
const after = await ev(async () => {
  const g = window.__game;
  await g.selectPages(['fire']);
  const held = g.fan.count;
  g.returnHand();
  return {
    held, coach: g.hud.coachLine, skip: g.hud.coachSkip,
    holdsBook: g.onboarding.holdsBook(),
  };
});
check('the grimoire is unconditionally free', after.held === 1, `held ${after.held}`);
check('no gate is left behind', after.holdsBook === false);
check('and no instruction is left on screen', after.coach === null && after.skip === false,
  `${after.coach} / ${after.skip}`);

finish(errors);
await browser.close();
stop();
