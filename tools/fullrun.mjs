/**
 * Two passes over a run, because they answer different questions and only one of
 * them used to exist.
 *
 *  --tour   GOD MODE floor sweep. Grants every page, refills the bar between
 *           floors and fuses three elements per cast. It answers "does every
 *           floor build, populate and let its boss die", and nothing about
 *           whether the game is winnable.
 *  --hand1  The acceptance criterion: "a full run is completable at hand size 1
 *           using elements, fixtures and object reactions alone." Default save,
 *           default loadout, hand size 1, NO hand-size lift and NO HP resets.
 *           It plays the run's INCOME — the altar's free rank-up and the chest's
 *           heal on every floor — because a run that takes neither measures a
 *           game nobody plays. Reporting a death is a valid result.
 *
 * With no flag it runs both, each in its own JS context — the debug
 * `selectPages` lifts the hand ceiling for the whole session, so the honest pass
 * can never share a page with the tour.
 *
 * `--hand1` runs every seed in SEEDS and reports a CLEAR RATE, because one run of
 * a procedural dungeon is a sample and not a measurement. The seeds are fixed, so
 * a change in the numbers is a change in the game rather than a change in the
 * dice, and any seed that fails to clear fails the harness.
 *
 * `--policy=burn|lock|alt|mixed|all` picks the LINE the honest pass plays, because
 * a clear rate is a property of the balance AND of the policy, and reporting one
 * number for "the game" while only ever playing one line confuses the two.
 *
 * With no flag the honest pass plays EVERY line and gates `mixed`. Two decisions
 * there, both load-bearing:
 *
 *  - The criterion is "a full run is COMPLETABLE at hand size 1", not "completable
 *    by spamming one page". `mixed` is the line a player who has read the
 *    interaction table plays, it clears 5/5, and gating it makes this a real
 *    regression detector: break the frost->fire shatter or the denial brace and the
 *    gate goes red for a reason. Gating `burn` instead only ever asserted that the
 *    dumbest available line loses, which it does by design.
 *  - The other three still RUN, and report their clear rates through `note`. The
 *    SPREAD between the lines is the evidence that skill is what clears the run;
 *    a change that flattens it — spam scoring as well as play — is not a gate
 *    failure but it is a design event, and it has to be visible in the output.
 *
 * See POLICY for what each line does and what each one measured.
 *
 * What --hand1 still does NOT model, so read a pass as an upper bound and a
 * failure as robust:
 *  - The WALK. Altars, chests and the boss stand-off are reached with `place`, so
 *    the enemies in the altar and treasure rooms are looted past rather than
 *    fought, and corridors cost nothing. This is the routed line `tuning.ts`
 *    sizes the attrition budget against, not a full clear.
 *  - Fixtures and object reactions. Neither exists yet (see
 *    `Harvest_And_Room_Elements`), so "elements alone" is the whole toolkit here
 *    and the criterion's other two sources are absent by construction.
 *  - Positioning. A policy chooses a PAGE and nothing else: it casts from a fixed
 *    stand-off at the boss, never at the adds, and never kites with Gust's shove,
 *    steps out of reach, uses a prop as cover or animates anything (animation is
 *    an ingredient now, and ingredients need hand size 2). So a policy's clear rate
 *    is a lower bound on what that line is worth in a real player's hands.
 */
import { serve, launch, openGame, check, note, finish } from './harness.mjs';

const args = process.argv.slice(2);
const DEPTHS = 5;

/**
 * The lines the honest pass can play, weakest first, and the one the gate is
 * written against.
 *
 * `mixed` is the gated line because it is the one that answers the acceptance
 * criterion (see the header). The rest are measured every run and never gate:
 * `burn` and `lock` clearing 1/5 is the designed shape of the fight, so failing
 * them would ship a red gate that reports nothing.
 */
const POLICIES = ['burn', 'lock', 'alt', 'mixed'];
const GATED_POLICY = 'mixed';

const policyArg = (args.find((a) => a.startsWith('--policy=')) ?? '').slice('--policy='.length);
if (policyArg && policyArg !== 'all' && !POLICIES.includes(policyArg)) {
  console.error(`unknown --policy=${policyArg}; expected ${[...POLICIES, 'all'].join(' | ')}`);
  process.exit(2);
}
// Naming one line runs only that line; anything else runs the whole comparison.
const RUN_POLICIES = policyArg && policyArg !== 'all' ? [policyArg] : POLICIES;

// Naming a policy is asking about the honest pass, so it implies it — the tour is
// god mode and has no line to play. With no flag at all, nothing changes.
const only = args.find((a) => a === '--tour' || a === '--hand1')
  ?? (policyArg ? '--hand1' : undefined);

/**
 * Fixed floor seeds for the honest pass. Nothing is special about the strings —
 * what matters is that they never change, so the clear rate below is a property
 * of the balance and not of the clock. Five is enough to tell "the criterion is
 * met" from "one seed in five is survivable" and cheap enough to run on demand.
 */
const SEEDS = ['gate-a', 'gate-b', 'gate-c', 'gate-d', 'gate-e'];

const stopServer = await serve();
const browser = await launch();
const allErrors = [];

/**
 * A stand-off tile: `gap` tiles away in a cardinal direction, facing the target,
 * with enough clear line between the two to actually see it. Defined per
 * `evaluate` body because page functions cannot close over Node scope.
 */
const STAND_OFF = `
  (g, e, gap) => {
    const grid = g.floor.grid;
    for (let want = gap; want >= 1; want--) {
      for (const [d, dx, dy] of [[0,0,1],[1,-1,0],[2,0,-1],[3,1,0]]) {
        const px = e.sprite.tx + dx * want, py = e.sprite.ty + dy * want;
        if (!grid.walkable(px, py)) continue;
        if (grid.rayTiles(px, py, d, want).length < want - 1) continue;
        g.place(px, py, d);
        return want;
      }
    }
    return 0;
  }`;

/**
 * Assemble a hand, retrying while tears are BLOCKED.
 *
 * A tear is refused for exactly two reasons (unlearned, hand full) and blocked
 * for one: the round the previous component bought is still resolving. Blocked
 * looks identical to refused through `selectPages`, and not distinguishing them
 * is how a harness ends up firing an empty cast forty times and calling it a
 * boss fight. Returns false only when the hand never assembled.
 */
const ASSEMBLE = `
  async (g, ids, tries = 12) => {
    for (let t = 0; t < tries; t++) {
      await g.selectPages(ids);
      if (g.fan.count >= ids.length) return true;
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  }`;

/**
 * The floor's income, claimed: the altar's offer and the chest's heal.
 *
 * The altar takes the free rank-up when one is on the table — `docs/DESIGN.md`
 * prices rank 1→2 at nothing, so a player who skips it is playing worse than the
 * game asks. Both nodes are reached with the same one-tile stand-off the tap's own
 * reach rule wants; walking there is not what this pass measures.
 */
const LOOT = `
  (g, standOff) => {
    // chestHeal stays null when the floor HAD no chest, so a zero always means the
    // heal was offered and destroyed by a full bar — the two are different findings.
    const out = { offer: null, chestHeal: null, hp: g.state.hp, ranks: null };
    const altar = g.altars()[0];
    if (altar && standOff(g, altar, 1)) {
      const o = g.takeAltar(altar);
      if (o) out.offer = \`\${o.kind}:\${o.id}\`;
    }
    const chest = g.chests()[0];
    if (chest && standOff(g, chest, 1)) {
      const before = g.state.hp;
      g.openChest(chest);
      out.chestHeal = g.state.hp - before;
    }
    out.ranks = { ...g.state.ranks };
    out.hp = g.state.hp;
    return out;
  }`;

/**
 * The page to cast: Fireball whenever the book has it.
 *
 * Not laziness — it is the max-damage line and stays the max-damage line at every
 * rank. Fireball is 10 up front plus three ticks of 3, so ~19 on one body; no
 * other single page is close (Spark 9, Frostbolt 8, Gust 5, Decay's 20 spread
 * over five rounds). Rank adds 15% per extra copy and spends the rest on WIDTH,
 * so a rank-3 Spark is 12 and still loses to an unranked Fireball — picking by
 * `preview().damage` alone measurably lengthened fights, because that field does
 * not carry the burn.
 *
 * The consequence for the measurement, which is a finding and not a limitation:
 * the altar offers exactly one owned page per roll, so the free rank-up pays into
 * this line only about a third of the time.
 *
 * The fallback is for a loadout without Fireball: heaviest previewed hit.
 */
const BEST_PAGE = `
  (g) => {
    const owned = g.state.pages.filter((id) => (g.state.ranks[id] ?? 0) > 0);
    if (owned.includes('fire')) return 'fire';
    let best = owned[0], bestD = -1;
    for (const id of owned) {
      const d = g.combat.preview([id], { kind: 'boss' }).damage;
      if (d > bestD) { bestD = d; best = id; }
    }
    return best;
  }`;

/**
 * A policy: `(game, name) => (boss) => pageId`, one page per cast, asked fresh
 * every cast so it can read the boss's statuses rather than casting blind.
 *
 * The lines, and why each is worth a number:
 *
 *  burn   Fireball every turn. The max-damage line (see BEST_PAGE) and the baseline
 *         the others are read against. Measured: 1/5 — which is the finding, not a
 *         regression. The criterion asks whether the run can be completed, and a
 *         line that never looks at what its last cast left behind is the floor.
 *
 *  lock   Frostbolt every turn. The denial line: frozen costs a body its action,
 *         rate-limited by BOSS_DENIAL_BRACE, so it trades Fireball's 10-plus-burn
 *         for 8 and a share of the boss's rounds. Note what the shatter valve does
 *         to it — a rank-1 Frostbolt is exactly SHATTER_DAMAGE, so every second
 *         bolt lands on the freeze it just applied, deals 1.5x and STRIPS it
 *         (`Combat.applyCast` suppresses the incoming freeze on a shatter). The
 *         line therefore alternates freeze / shatter and cannot hold a lock.
 *         Measured: 1/5, the same as burn and for the opposite reason — it pays
 *         2.84 HP a round on floor 4 against burn's 4.51, and still loses, because
 *         the fight runs 9-11 rounds instead of 8 and three of the four deaths are
 *         the player's bar running out with the boss still on 22.
 *
 *  alt    Frostbolt whenever the boss is not frozen, Fireball whenever it is. The
 *         line a player reaches from the DISCOVERABLE half of the knowledge alone:
 *         the SHATTER! caption teaches "fire into ice hits harder" and nothing
 *         teaches the brace. It is here to separate the two. Its steady state is
 *         [frost, fire] on repeat, which spends every second freeze on a braced
 *         round: 25% denial against `mixed`'s 33%, for slightly more damage.
 *         Measured: 4/5, and the miss is gate-a floor 5 with the boss on ONE hit
 *         point. So the discoverable half of the knowledge is worth almost the whole
 *         run, and the brace rhythm is worth the last seed. Read that as the
 *         criterion being met by skill and not by arcana — but also as the reason
 *         nothing in the HUD should stay silent about a body losing its round.
 *
 *  mixed  What a player who has read the interaction table does, and THE GATED
 *         LINE — the acceptance criterion is met here or nowhere. The rule, exactly:
 *           1. If the boss is frozen, cast Fireball. Fire on a frozen body is a
 *              SHATTER (10 -> 15) and still lights the burn, where a second
 *              Frostbolt is only 12 and no burn. Fire's melt clause never fires,
 *              because the shatter has already stripped the freeze.
 *           2. Otherwise, if two casts have gone by since the last Frostbolt,
 *              cast Frostbolt. Two is BOSS_DENIAL_BRACE: a boss that loses a round
 *              braces for the next two, so a freeze spent inside those two rounds
 *              is wasted and a bolt landing exactly as the brace runs out denies
 *              one round in three — the cap, which `lock` never reaches.
 *           3. Otherwise, cast Fireball.
 *         Steady state is [frost, fire, fire] on repeat: 33% of the boss's rounds
 *         denied at ~14 damage a round, against burn's 0% at ~13. Measured: 5/5,
 *         and it kills the floor-4 boss in the SAME 8 rounds burn needs while
 *         paying 1.38 HP a round against burn's 4.51 — the shatter is what pays for
 *         the bolt, so the denial is not bought with damage, it rides along free.
 *
 * A line that needs a page the book does not hold degrades to `burn` rather than
 * casting nothing, so a non-default loadout produces a run instead of a stall.
 */
const POLICY = `
  (g, name) => {
    const owns = (id) => g.state.pages.includes(id) && (g.state.ranks[id] ?? 0) > 0;
    const fallback = eval(${JSON.stringify(BEST_PAGE)})(g);
    if (name === 'lock' && owns('frost')) return () => 'frost';
    if (name === 'alt' && owns('frost') && owns('fire')) {
      return (boss) => (g.combat.has(boss, 'frozen') ? 'fire' : 'frost');
    }
    if (name === 'mixed' && owns('frost') && owns('fire')) {
      // Starts at the threshold so the line opens on the bolt, before the boss has
      // closed any distance — a denied approach round is a free shooting-gallery round.
      let sinceFrost = 2;
      return (boss) => {
        if (g.combat.has(boss, 'frozen')) { sinceFrost++; return 'fire'; }
        if (sinceFrost >= 2) { sinceFrost = 0; return 'frost'; }
        sinceFrost++;
        return 'fire';
      };
    }
    return () => fallback;
  }`;

// ------------------------------------------------------------------- the tour

async function tour() {
  console.log('\n########## TOUR (god mode: every page, full bar, three-element fusions)');
  const { page, errors, shot, ev } = await openGame(browser, { prefix: 'fr', wait: 2600 });

  for (let depth = 1; depth <= DEPTHS; depth++) {
    const info = await ev((standOffSrc) => {
      const g = window.__game;
      const standOff = eval(standOffSrc);
      g.grantAll();
      g.state.hp = g.state.maxHp;
      const boss = g.floor.entities.find((e) => e.kind === 'boss');
      if (boss) { standOff(g, boss, 4); g.hud.target = boss; }
      return {
        depth: g.state.depth, theme: g.floor.theme.name,
        entities: g.floor.entities.length,
        enemies: g.floor.entities.filter((e) => e.kind === 'enemy').length,
        props: g.floor.entities.filter((e) => e.kind === 'prop').length,
        bossHp: boss ? boss.hp : null,
        candidates: g.hud.candidates.length,
      };
    }, STAND_OFF);
    console.log(`\nFLOOR ${info.depth}: ${info.theme}`);
    console.log('  ', JSON.stringify(info));
    check(`floor ${depth} builds and populates`,
      info.depth === depth && info.entities > 0 && !!info.theme, JSON.stringify(info));
    check(`floor ${depth} has a boss`, info.bossHp > 0, String(info.bossHp));
    await page.waitForTimeout(900);
    await shot(`d${depth}-boss`);

    if (depth === DEPTHS) break;

    // kill the boss with repeated big fusions, then descend
    const killed = await ev(async (assembleSrc) => {
      const g = window.__game;
      const assemble = eval(assembleSrc);
      const boss = g.floor.entities.find((e) => e.kind === 'boss');
      if (!boss) return null;
      let casts = 0, blocked = 0;
      for (let i = 0; i < 24 && boss.alive && boss.hp > 0; i++) {
        g.state.hp = g.state.maxHp;
        if (!await assemble(g, ['fire', 'frost', 'spark'])) { blocked++; break; }
        g.hud.target = boss;
        await g.castNow();
        casts++;
      }
      return {
        bossHp: Math.max(0, boss.hp), bossDead: g.combat.bossDead,
        stars: g.state.stars, casts, blocked,
      };
    }, ASSEMBLE);
    console.log('   boss:', JSON.stringify(killed));
    check(`floor ${depth} boss dies`, !!killed && killed.bossDead,
      killed ? `hp ${killed.bossHp} after ${killed.casts} casts`
        + (killed.blocked ? ' (hand never assembled)' : '') : 'no boss');
    await page.waitForTimeout(900);
    await shot(`d${depth}-bossdead`);

    const stairs = await ev((standOffSrc) => {
      const g = window.__game;
      const standOff = eval(standOffSrc);
      const st = g.floor.entities.find((e) => e.kind === 'stairs');
      if (!st) return null;
      standOff(g, st, 1);
      g.hud.clearSelection();
      return {
        before: g.state.depth, visible: st.sprite.group.visible,
        adjacent: Math.abs(st.sprite.tx - g.stepper.x) + Math.abs(st.sprite.ty - g.stepper.y) <= 1,
      };
    }, STAND_OFF);
    console.log('   stairs:', JSON.stringify(stairs));
    check(`floor ${depth} stairs are reachable`, !!stairs && stairs.adjacent,
      JSON.stringify(stairs));
    await shot(`d${depth}-stairs`);

    await page.keyboard.press('KeyF');          // the descend hotkey, same code path
    const advanced = await page
      .waitForFunction((d) => window.__game.state.depth === d, depth + 1, { timeout: 20000 })
      .then(() => true).catch(() => false);
    check(`descend from floor ${depth}`, advanced,
      advanced ? '' : `still on ${await ev(() => window.__game.state.depth)}`);
    if (!advanced) break;
    await page.waitForTimeout(1200);
  }

  allErrors.push(...errors);
  await page.close();
}

// ----------------------------------------------------- the honest hand-size-1

/**
 * One seeded run of one policy. `shoot` is off for all but the first, so 25 floors
 * is not 25 PNGs.
 *
 * `gated` is what makes a conclusion a conclusion: the criterion line's results go
 * through `check` and can fail the harness, an alternate's go through `note`. Only
 * the gated line's labels are untagged, so the ledger entries the gate is written
 * against never move when another line is added to the comparison.
 */
async function hand1Seed(seed, shoot, policy, gated) {
  const claim = (label, ok, detail) => (gated
    ? check(label, ok, detail)
    : (note(label + (ok ? ' — yes' : ' — NO'), detail), ok));
  const tag = gated ? `[${seed}]` : `[${policy}/${seed}]`;
  console.log(`\n===== ${policy} / seed ${seed}`);
  const { page, errors, shot, ev } = await openGame(browser, {
    prefix: `h1-${policy}-${seed}`, wait: 2600, freshSave: true,
  });

  // Pin the dungeon BEFORE anything is measured. This rebuilds floor 1 from the
  // new seed, so what follows is reproducible rather than a fresh sample.
  await ev((s) => window.__game.setSeed(s), seed);
  await page.waitForTimeout(1200);

  const start = await ev(() => {
    const g = window.__game;
    return {
      seed: g.seed, handSize: g.meta.handSize, pages: g.state.pages, ranks: g.state.ranks,
      hp: g.state.hp, maxHp: g.state.maxHp, book: g.bookPages(),
    };
  });
  console.log('start:', JSON.stringify(start));
  claim(`${tag} the seed is settable`, start.seed === seed, start.seed);
  claim(`${tag} the run starts at hand size 1`, start.handSize === 1, String(start.handSize));
  claim(`${tag} the run starts on the default loadout at rank 1`,
    start.pages.length === 3 && Object.values(start.ranks).every((r) => r === 1),
    JSON.stringify(start.pages));

  const log = [];
  let died = false;
  let reached = 1;

  for (let depth = 1; depth <= DEPTHS; depth++) {
    reached = depth;

    // Claim the floor's income first, the way the compass points you: altar, then
    // chest, then the boss.
    const loot = await ev(([standOffSrc, lootSrc]) => {
      const g = window.__game;
      return eval(lootSrc)(g, eval(standOffSrc));
    }, [STAND_OFF, LOOT]);
    console.log(`\nFLOOR ${depth} income:`, JSON.stringify(loot));

    /**
     * Fight the boss with ONE page per cast — the whole line at hand size 1. A
     * routed run is what the attrition budget is sized against (see
     * `tuning.ts`), so this kills the boss and whatever engages alongside it
     * rather than clearing every room.
     */
    const fight = await ev(async ([standOffSrc, assembleSrc, policySrc, policyName]) => {
      const g = window.__game;
      const standOff = eval(standOffSrc);
      const assemble = eval(assembleSrc);
      const nextPage = eval(policySrc)(g, policyName);
      const boss = g.floor.entities.find((e) => e.kind === 'boss');
      if (!boss) return null;
      const gap = standOff(g, boss, 4);
      const hpStart = g.state.hp;
      /**
       * Every hit that lands during the fight, counted. Two lines can cost the same
       * HP for opposite reasons — a long fight taking small hits, or a short one
       * taking big ones — so a denial line has to be read as FEWER hits landed and
       * not just as a smaller total, or the mechanism under test is invisible.
       * Wrapped rather than replaced, and restored in `finally`, because the real
       * handler is what shakes the screen for the rest of the run.
       */
      const hits = [];
      const prevHurt = g.combat.onPlayerHurt;
      g.combat.onPlayerHurt = (n) => { hits.push(n); prevHurt(n); };
      const mix = {};
      let casts = 0;
      // How close the boss actually got. A stand-off it never closes is a fight
      // the player wins for free, so this is the number that explains a floor
      // that cost nothing.
      let minDist = Infinity;
      const dist = () => Math.abs(boss.sprite.tx - g.stepper.x) + Math.abs(boss.sprite.ty - g.stepper.y);
      const t0 = g.combat.turns;
      let blocked = false;
      try {
        while (boss.alive && boss.hp > 0 && g.state.hp > 0 && casts < 40) {
          // one page, one turn — and the policy is asked fresh, so it sees the
          // statuses its last cast left behind
          const page = nextPage(boss);
          if (!await assemble(g, [page])) { blocked = true; break; }
          g.hud.target = boss;
          await g.castNow();
          casts++;
          mix[page] = (mix[page] ?? 0) + 1;
          minDist = Math.min(minDist, dist());
        }
      } finally {
        g.combat.onPlayerHurt = prevHurt;
      }
      return {
        policy: policyName, mix, gap, casts, turns: g.combat.turns - t0,
        minDist, endDist: dist(), blocked,
        bossHp: Math.max(0, boss.hp), bossDead: g.combat.bossDead,
        hpStart, hp: g.state.hp,
        hits: hits.length, hitTotal: hits.reduce((n, h) => n + h, 0),
        hostilesLeft: g.floor.entities.filter((e) => e.alive && e.hostile).length,
      };
    }, [STAND_OFF, ASSEMBLE, POLICY, policy]);
    console.log(`FLOOR ${depth} fight:`, JSON.stringify(fight));
    if (shoot || (fight && fight.hp <= 0)) await shot(`d${depth}`);
    if (!fight) { claim(`${tag} floor ${depth} has a boss`, false, 'none found'); break; }
    log.push({
      depth, ...loot, ...fight,
      hpIn: loot.hp - (loot.chestHeal ?? 0), hpLoot: loot.hp,
    });

    claim(`${tag} floor ${depth} hand assembles at hand size 1`, !fight.blocked,
      fight.blocked ? 'a tear never landed' : `${fight.casts} single-page casts`);
    if (fight.hp <= 0) {
      died = true;
      console.log(`  DIED on floor ${depth} after ${fight.casts} casts`);
      break;
    }
    claim(`${tag} floor ${depth} boss dies at hand size 1`, fight.bossDead,
      `hp ${fight.bossHp} left after ${fight.casts} casts`);
    if (!fight.bossDead) break;
    if (depth === DEPTHS) break;

    await ev((standOffSrc) => {
      const g = window.__game;
      const st = g.floor.entities.find((e) => e.kind === 'stairs');
      if (st) eval(standOffSrc)(g, st, 1);
    }, STAND_OFF);
    await page.keyboard.press('KeyF');
    const advanced = await page
      .waitForFunction((d) => window.__game.state.depth === d, depth + 1, { timeout: 20000 })
      .then(() => true).catch(() => false);
    const healed = await ev(() => window.__game.state.hp);
    console.log(`  descend -> depth ${depth + 1}, hp ${healed}`);
    claim(`${tag} descend from floor ${depth} at hand size 1`, advanced, '');
    if (!advanced) break;
    await page.waitForTimeout(1200);
  }

  const cleared = !died && reached === DEPTHS && log.length === DEPTHS
    && log.every((l) => l.bossDead);
  claim(`${tag} a full run is completable at hand size 1`, cleared,
    cleared ? `${log.reduce((n, l) => n + l.casts, 0)} casts total`
      : `${died ? 'died' : 'stopped'} on floor ${reached}`);

  allErrors.push(...errors);
  await page.close();
  return { seed, policy, cleared, died, reached, log };
}

/** `{fire: 8, frost: 4}` -> `fire 8 + frost 4`, so the line played is in the log. */
function mixText(mix) {
  return Object.entries(mix ?? {}).map(([id, n]) => `${id} ${n}`).join(' + ') || 'nothing';
}

async function hand1Policy(policy, gated) {
  console.log(`\n########## HAND SIZE 1 / policy ${policy}`
    + (gated ? ' (GATED — this line is the acceptance criterion)'
      : ` (measured only; the gate is written against \`${GATED_POLICY}\`)`)
    + ' — default save, default loadout, altar ranks + chest heals, no HP resets');
  const runs = [];
  for (let i = 0; i < SEEDS.length; i++) {
    runs.push(await hand1Seed(SEEDS[i], i === 0 && gated, policy, gated));
  }

  console.log(`\n--- ${policy}: hand size 1, routed, altar ranks and chest heals taken ---`);
  for (const r of runs) {
    console.log(`\n  ${r.seed}: ${r.cleared ? 'CLEARED' : `${r.died ? 'DIED' : 'stopped'} on floor ${r.reached}`}`);
    for (const l of r.log) {
      console.log(`    floor ${l.depth}: hp ${l.hpIn} -> ${l.hpLoot} (altar ${l.offer ?? 'none'},`
        + ` chest ${l.chestHeal === null ? 'none' : `+${l.chestHeal}`})`
        + ` -> ${l.hp} after ${l.casts} casts [${mixText(l.mix)}] over ${l.turns} turns,`
        + ` took ${l.hitTotal} in ${l.hits} hits,`
        + ` boss closed ${l.gap}->${l.minDist}, boss ${l.bossDead ? 'dead' : `alive on ${l.bossHp}`}`);
    }
  }
  const clears = runs.filter((r) => r.cleared).length;
  note(`[${policy}] clear rate at hand size 1`,
    `${clears}/${runs.length} fixed seeds cleared all ${DEPTHS} floors`);
  note(`[${policy}] depths reached`, runs.map((r) => r.reached).sort((a, b) => a - b).join(', '));
  return runs;
}

async function hand1() {
  const byPolicy = new Map();
  for (const p of RUN_POLICIES) {
    // Only the criterion line is ever gated, whatever was asked for. A `--policy`
    // flag selects what gets PLAYED, never what gets asserted: `burn` losing is a
    // measurement this file publishes on purpose, and a flag that could turn it
    // into a harness failure would make the exit code depend on the question asked.
    byPolicy.set(p, await hand1Policy(p, p === GATED_POLICY));
  }

  // policy x seed, one grid, because the whole question is a comparison.
  console.log('\n--- policy x seed: CLEAR, or the floor the run ended on ---');
  const w = Math.max(...RUN_POLICIES.map((p) => p.length + 2), 8);
  console.log(`  ${'policy'.padEnd(w)}  ${SEEDS.map((s) => s.padEnd(7)).join(' ')} clears`);
  const rate = new Map();
  for (const [p, runs] of byPolicy) {
    const cells = runs.map((r) => (r.cleared ? 'CLEAR' : `${r.died ? 'died' : 'stop'} f${r.reached}`).padEnd(7));
    const clears = runs.filter((r) => r.cleared).length;
    rate.set(p, clears);
    const mark = p === GATED_POLICY ? '* ' : '  ';
    console.log(`  ${(mark + p).padEnd(w)}  ${cells.join(' ')} ${clears}/${runs.length}`);
  }
  console.log('  (* = the gated line. Every other row is measured and cannot fail the run.)');

  /**
   * The conclusion, in one place, because a reader who scrolls to the bottom of a
   * 20-run log should not have to work out which number the exit code came from.
   */
  const gatedRate = rate.has(GATED_POLICY) ? `${rate.get(GATED_POLICY)}/${SEEDS.length}` : 'not run';
  note(`gated line: ${GATED_POLICY}`, `${gatedRate} fixed seeds cleared`
    + ' — this, and only this, is what --hand1 asserts about the criterion');
  const others = [...rate].filter(([p]) => p !== GATED_POLICY);
  if (others.length) {
    note('measured lines (no gate)',
      others.map(([p, n]) => `${p} ${n}/${SEEDS.length}`).join(', '));
  }
  if (others.length && rate.has(GATED_POLICY)) {
    /**
     * The spread is the evidence that the criterion is met by SKILL. Alternates
     * scoring what the gated line scores would mean the interactions stopped
     * mattering — not a gate failure, but the thing to notice in this output.
     */
    const best = Math.max(...others.map(([, n]) => n));
    note('policy spread',
      `${GATED_POLICY} ${gatedRate} against the best alternate ${best}/${SEEDS.length}`
      + (rate.get(GATED_POLICY) > best
        ? ' — playing the interactions is worth the difference'
        : ' — WATCH: the lines have flattened, so knowing the interactions no longer pays'));
  }

  /**
   * HP per boss round, per floor, per policy. This is the number a tuning decision
   * gets made from: the clear rate says whether the criterion is met, and this says
   * by how much a line that misses it misses, in the only currency the fight has.
   */
  console.log('\n--- HP paid per boss round on the floors that kill you ---');
  for (const [p, runs] of byPolicy) {
    for (const depth of [4, 5]) {
      const fl = runs.map((r) => r.log.find((l) => l.depth === depth)).filter(Boolean);
      if (!fl.length) { console.log(`  ${p} floor ${depth}: never reached`); continue; }
      const rounds = fl.reduce((n, l) => n + l.casts, 0);
      const paid = fl.reduce((n, l) => n + (l.hpStart - l.hp), 0);
      const hits = fl.reduce((n, l) => n + l.hits, 0);
      console.log(`  ${p} floor ${depth}: ${fl.length} fight(s), ${paid} HP over ${rounds} rounds`
        + ` = ${(paid / rounds).toFixed(2)}/round, ${hits} hits landed`
        + ` (${(hits / rounds).toFixed(2)}/round)`);
    }
  }

  note('not modelled', 'the walk between rooms, fixtures, object reactions, kiting'
    + " — see this file's header");
  note('policy scope', 'every line targets the BOSS and never the adds, and never'
    + ' steps once the fight starts — so this measures the page choice and nothing else');
}

if (!only || only === '--tour') await tour();
if (!only || only === '--hand1') await hand1();

finish(allErrors);
await browser.close();
stopServer();
