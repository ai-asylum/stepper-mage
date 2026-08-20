/**
 * Combat tuning — every number that encodes the TURN ECONOMY, in one place
 * because the next phase that changes the tempo has to find them all.
 *
 * The tempo these are sized for: **a cast is one turn, a step is one turn, and
 * taking a component is free.** So the loop is one enemy round per CAST, the round
 * runs AFTER the cast lands, and a room costs one round per cast it takes to empty
 * it. Everything below is derived from "how many rounds does a fight last, and how
 * many hits land in that time".
 *
 * The rebase that produced these numbers moved the turn off the components and onto
 * the release, and that is worth about one enemy round per fight in the player's
 * favour: a body killed by the cast never answers it, and a status lands in time to
 * touch the very next round rather than the one after. Measured at hand size 1 over
 * the five fixed gate seeds, moving the turn and changing nothing else took the naive
 * Fireball line from clearing 1 seed in 5 to clearing 3, took the skilled line's
 * depth-5 boss fight from 10 HP to 6, and took a depth-5 room from 20.2 HP to 13.9.
 * Every curve below that moved, moved to charge for that round; the whole routed run
 * went from being 111% funded by the bar and the heals to 180%, and is 112% again.
 *
 * Sized against a hand of ONE, deliberately, because that is the floor of the
 * ladder and the acceptance criterion (`tools/fullrun.mjs --hand1`). A cast costs
 * one turn whatever it holds, so hand size is now a straight multiplier on
 * throughput — measured, a hand of two takes a depth-5 room from 16.4 HP to 3.3 —
 * and that multiplier is bought with stars. Content is sized to the floor and the
 * purchase is the power; it is not sized to the ceiling with the floor made to
 * cope.
 *
 * The two invariants worth preserving when these move:
 *  - A cast is the unit of enemy HP. `enemyHp` is written as a number of
 *    Fireballs, not as a curve that looked nice.
 *  - The player bar is measured in HITS, not in HP. Enemy damage is set so a
 *    fight lands a survivable fraction of the bar, because at hand size 1 the
 *    player cannot shorten a fight by spending more per turn.
 */

/**
 * The bar has to absorb a whole fight at one cast per round — fifteen depth-1 mook
 * hits falling to nine by depth 5, or nine depth-1 boss hits falling to five.
 *
 * Those counts are EXACT, not averages, because nothing rolls damage any more (see
 * below, where the jitter used to be). They are also the numbers this bar actually
 * produces, which the previous draft of this comment was not: it said nine falling to
 * six, derived from 4.5 and 6.5, and both figures were left over from a 40-point bar
 * and the old `3 + ⌈d/2⌉` curve. A stale hit count is the most expensive kind of stale
 * comment in this file, because every other curve is quoted against it.
 *
 * 40 -> 46 when hostiles were given a move AND an attack in the same round. The bar
 * is the unit everything else is quoted in and moving it is a last resort, but it is
 * the right lever HERE and the measurement is what says so.
 *
 * `enemyDamage` came down 20% first, which is the matching fix on paper and was not
 * enough: the depth-5 gate seed took exactly 40 from seven mook hits and died with
 * the boss already dead. What was left was the bar, and it was also the honest lever:
 * the change did not make enemies hit harder, it made them act more often, so the
 * matching compensation is absorbing more actions rather than each one mattering less.
 *
 * THIS NUMBER IS NOW THE WHOLE RUN. It used to be a per-floor allowance, because
 * `descendHeal` handed most of it back at every staircase; that heal is gone (see the
 * attrition section), so 46 is the total HP a run gets except for what it finds in
 * chests and altars. Every figure above is still quoted as a fraction of it, but the
 * fraction now compounds across floors instead of resetting, which is the point.
 */
export const PLAYER_MAX_HP = 46;

/**
 * Enemy HP, sized in CASTS. A rank-1 Fireball is 10 and lights a 3-per-turn burn,
 * so one cast plus its first tick is 13 and two casts plus a tick is 23: a depth-1
 * body dies to a single cast, depth 2 to a cast and its burn, and depths 3-5 to
 * two. Two is the ceiling on purpose — every extra cast per body multiplies
 * straight into rounds-in-the-room, and at hand size 1 a round in the room is a
 * round of standing there being hit.
 *
 * Deliberately NOT moved by the rebase, and it was the obvious lever. Raising it
 * would have paid for the free round by making a body take more casts, which
 * breaks the invariant above and breaks a promise the room reactions make on top of
 * it (`REACTIONS` in `combat.ts` sizes the oil drum at 22 so an explosion kills a
 * mook outright at every depth). The free round is bought back on `enemyDamage`
 * instead, where it costs the player HP without costing the fight its shape.
 */
export const enemyHp = (depth: number): number => 28 + depth * 4;

/**
 * How fast a FAST body is, and what it pays for the speed.
 *
 * Two tiles a round instead of one, which is the only stat in the game that changes
 * what a room IS rather than how long it takes: a walker's distance is under the
 * player's control, because stepping away preserves the gap forever. A body that
 * closes two cannot be kited, so the tile you are standing on when you turn a corner
 * is a commitment.
 *
 * It pays for that in HP and in damage, because arriving sooner is already worth
 * rounds. At 0.6 a fast body is two casts rather than three or four, so it reaches you
 * and dies quickly instead of reaching you and staying.
 *
 * Which bodies are fast is derived from the TILE (see `isFast`), not rolled. Drawing it
 * from `populate`'s rng would reshuffle every placement on every floor — the same trap
 * documented on `roomEnemyChance` — so this is a hash of the spawn position, exactly
 * like `Entity.facing` already is. Same seed, same layout, same bodies fast.
 */
export const FAST_SPEED = 2;
export const FAST_HP_MULT = 0.6;
export const FAST_DAMAGE_MULT = 0.75;
export const isFast = (x: number, y: number): boolean => (x * 31 + y * 17) % 3 === 0;

/**
 * Boss HP, sized so the fight is 9-11 casts unranked and 5-8 with a rank-3 page
 * (measured).
 *
 * A rank-3 page used to end a boss in 3-4 because its extra projectiles wrapped
 * back onto the only body in the room; they no longer do (see `spells.ts` — a
 * volley spreads and never doubles up), so rank buys a boss fight a damage
 * multiplier and nothing else.
 *
 * Raised by the rebase — 62 + 12d became 70 + 13d — because the boss lost a whole
 * round to it. The killing cast now lands before the boss answers, so the last round
 * of the fight stopped happening, and it was the round that cost the most: by then
 * the boss is adjacent. Adding about one cast back is what restores the number of
 * ROUNDS SPENT ADJACENT, which is the only part of a boss fight the player pays for.
 *
 * The SLOPE is the term that was cut back, and the depth-5 boss is why. At 70 + 14d it
 * is 140, and 140 is a cliff: measured, the gated line's worst seed took 42 of a
 * 40-point bar and the run ended two HP short, while at 135 the same seed takes 32 and
 * clears with eight to spare. A boss fight that turns on one extra cast of health is a
 * boss fight standing on one number, so the curve sits below the cliff on purpose.
 *
 * That argument got STRONGER when the damage jitter went. It used to mean the deepest
 * boss was decided by a die roll; now it means the deepest boss is decided the same way
 * every single time, so a curve one point over the line is not an unlucky death, it is
 * an unwinnable game. Determinism does not make a cliff safe to stand near — it makes
 * standing near one repeatable.
 *
 * The curve is still deliberately flat. A boss stands at the far end of a big room
 * and has to walk to you, so the first three casts are a shooting gallery and only
 * the back half costs anything; past about eleven casts the extra health lands
 * entirely in the shooting-gallery half and reads as a grind rather than a fight.
 */
export const bossHp = (depth: number): number => 90 + depth * 10;

/**
 * Damage per attack. EXACTLY this — `Combat.enemyRound` adds nothing to it.
 *
 * Set from hits-to-die rather than from a damage curve: clearing a room lands
 * about one hit at depth 1 and about two and a half by depth 5, so a flat-ish
 * per-hit number already produces a steep per-room curve (3% of the bar at depth 1
 * rising to 41% at depth 5, measured). Making the per-hit number climb as fast as
 * the round count does makes the last two floors arithmetically unwinnable.
 *
 * It went 2 + ⌈d/2⌉ -> 3 + ⌈d/2⌉ when the free round was charged for, and back to
 * 2 + ⌈d/2⌉ when hostiles were given a move AND an attack in the same round.
 *
 * That change is why this number came down, and the reasoning is worth keeping
 * because it will come up again: a body two tiles away used to spend its round
 * closing and swing on the next one, so the round it arrived was free. Now it
 * closes and swings together. Over a four-to-six round fight that is one extra
 * landed hit, about 20% more, and it arrives at the START of the fight when the
 * player has the fewest options. Left alone it killed the hand-size-1 gate on
 * floors 3, 4 and 5.
 *
 * Per-hit damage was the lever rather than healing or player HP because the change
 * was about TEMPO, not difficulty: enemies should feel responsive, not deadlier. So
 * hits went up ~20% and damage per hit came down ~20%, and a fight costs about what
 * it did before while reading very differently.
 *
 * Kept flatter than `bossDamage` on purpose: at depth 5 a mook hits for 5 and a
 * boss for 9, and a mook that hits like a boss makes the boss furniture.
 */
export const enemyDamage = (depth: number): number => 3 + Math.ceil(depth / 2);

/**
 * A boss hits for a bit under two mooks, and never for a third of the bar.
 *
 * 4 + d became 5 + d when the fight started landing one fewer hit, and is 4 + d
 * again now that move-and-attack has handed that hit back — see `enemyDamage` for
 * the full argument. At depth 5 this is 9, every swing is 9, and that is 20% of the
 * bar: five boss hits is the whole run.
 */
export const bossDamage = (depth: number): number => 6 + depth;

/**
 * THERE IS NO DAMAGE JITTER, and this note is here so it does not come back by
 * accident.
 *
 * There was one — `rng.int(-1, 2)`, inclusive, so -1/0/+1/+2 with a mean half a point
 * above the base — and it was removed to make a fight COMPUTABLE. That is the whole
 * argument, and it is a claim about how this game gets balanced rather than about how
 * it plays: while every swing was a die roll, the cost of a room was a distribution,
 * and the only way to learn a distribution is to sample it. That is exactly what the
 * old full-run harness was for, why it had to run hundreds of floors to say anything,
 * and why it took long enough that changing a number here stopped being cheap. Killing
 * the roll kills the need for the instrument: the same room fought the same way now
 * costs the same HP, so a curve can be checked by arithmetic instead of by sampling.
 *
 * It cost the player nothing to read. The jitter was never surfaced — no number on
 * screen was ever quoted with a range — so it was invisible variance, which is the kind
 * that adds no tension and only costs legibility. `THREAT_REACH` had already committed
 * this game to telling the player exactly what is coming; a swing whose size was a
 * secret was the last place that promise was broken.
 *
 * WHAT IT CHANGED IN THE ECONOMY: enemies now hit for their base rather than half a
 * point over it, so every incoming hit is 10-17% lighter and every hits-to-die figure
 * in this file went up by about one hit. That is a real shift in the player's favour and
 * it has deliberately NOT been paid for by raising `enemyDamage` — the whole value of
 * this change is that the next tuning pass can be argued on paper, and folding a
 * compensating bump into the same change would have meant re-tuning against numbers
 * nobody had recomputed yet. The curves above are quoted at their exact new cost; if
 * the run turns out to be over-funded, that is a curve decision to take on its own.
 *
 * The `Math.max(1, …)` floor in `enemyRound` stays. It can no longer trip — every curve
 * here bottoms out at 3 — and it stays as the guard that stops a future negative
 * modifier from turning an attack into a heal.
 */

/**
 * How far a hostile can reach on its coming round — the telegraph's whole rule.
 *
 * TWO, not one, and that is the number the move-and-attack change created: a body
 * closes and swings in the same round, so anything within two tiles can hit you
 * before you act again. It was one for the whole game before that, and it was
 * invisible because it did not need to be seen — a creature two tiles away was
 * simply not a threat this turn.
 *
 * Derived here rather than written twice, because the telegraph promising a
 * different reach from the one `enemyRound` actually uses is worse than no
 * telegraph: it would teach the player a rule the game does not follow.
 */
export const THREAT_REACH = 2;

/**
 * Status damage per tick. Burning is the fast one and decay is the long one, so
 * they share a rate and differ only in duration (see `STATUS_META` in
 * `spells.ts`): burning is 3 ticks, decay is 5. That is what makes Decay worth
 * the rounds it needs in an economy that charges for time — it out-totals a
 * Fireball while paying out slower per round, which is a trade rather than a
 * downgrade.
 *
 * Deliberately flat with depth: against the enemy HP curve these are already
 * 14-30% of a body per tick, and scaling them on top of that would make "light
 * it and walk away" the only play worth making.
 */
export const BURNING_DOT = 3;
export const DECAY_DOT = 3;

/**
 * Enemies per room. This is as much of the tempo as any single stat: every body
 * in the room gets an action for each CAST you release, so a third enemy is a
 * third of the incoming damage on every round of a fight several rounds long.
 * Three is the ceiling, and the third body arrives as a roll that leans on with
 * depth rather than as a step at a fixed floor, so the curve has no cliff in it.
 *
 * NOT MOVED by the rebase, and it was the obvious second lever — a body that dies to
 * the cast is a body that never swung, so the refund is per BODY and bodies are the
 * natural answer. Two measurements talked it out of the file. Raised to 0.3 + 0.1d it
 * overshot: a depth-5 room went to 24.6 HP against the 20.2 it used to cost, because
 * the marginal third body lengthens the fight for the other two as well as adding its
 * own swings, so the curve is far steeper in bodies than it looks. And this roll is
 * drawn from `populate`'s own rng, so changing it reshuffles every placement on every
 * floor — which would have regenerated the fixed seeds `tools/fullrun.mjs --hand1`
 * gates on, and silently turned a re-tune into a new dungeon.
 */
export const ROOM_ENEMIES_BASE = 2;
export const ROOM_ENEMIES_MAX = 3;
export const roomEnemyChance = (depth: number): number => 0.2 + depth * 0.08;

// ----------------------------------------------------------------- engagement

/**
 * How far a hostile will act from — step toward you, or hit you.
 *
 * This is the same number as the default reach of `targetsInView`, and it has to
 * be: anything the player can put a reticle on has to be allowed to answer.
 * While the engage radius was 4 and targeting reached 7 there was a three-tile
 * band — always outside a room, because corridor tiles belong to no room — where
 * every body in a room was a legal target and no body was allowed to move. A
 * whole room, and every boss, could be shot to death from a corridor for zero HP.
 */
export const ENGAGE_RADIUS = 7;

/**
 * How far a cast reaches, as PATH distance through the grid.
 *
 * The same number as `ENGAGE_RADIUS` and for the same reason the engage radius is
 * the same as targeting's: the reticle's promise, the body's right to answer and
 * the spell's reach are one fact, and three numbers that can drift is how the
 * corridor exploit happened the first time.
 *
 * NOT the lever on whether a fight costs anything, and it was mistaken for it once.
 * This bounds how far a blast SPREADS from wherever it lands (`reachFrom` at the cast's
 * centre in `combat.ts`), not how far away you may aim — that is `targetsInView`, and
 * inside your own room it is not bounded by a number at all. Cutting this would nerf
 * volleys and change nothing about how long a body spends walking at you.
 *
 * What CHANGED under `Roadmap/Spell_Reach.md` is not the number but the metric. A
 * volley used to take any hostile alive anywhere on the floor; now it floods out
 * from the blast and a wall stops it. The net is a nerf to a blast fired at a wall
 * and no change at all to one fired down an open room.
 */
export const SPELL_REACH = ENGAGE_RADIUS;

/**
 * How far an object's reaction can reach. Its SHAPE never names a tile further
 * than two out; this is the wall bound applied to the tiles the shape asks for.
 */
export const REACTION_REACH = 2;

/** How far a golem will break off from following you to engage something. */
export const GOLEM_AGGRO = 6;

/**
 * Rounds a body is braced against round-denial after losing one to it.
 *
 * The player gets exactly ONE action per round, so any denial that lasts two
 * rounds refreshes before it expires and the fight simply stops: two bodies could
 * be held forever with alternating Frostbolts, and a wide enough volley held the
 * whole room. Statuses keep their full durations — frozen still pins a body in
 * place for two rounds and still leaves it open to SHATTER — but the SKIP is rate
 * limited, so nothing loses two rounds in a row and a boss loses at most one in
 * three. Denial becomes tempo you buy rather than a lock you close.
 */
export const DENIAL_BRACE = 1;
export const BOSS_DENIAL_BRACE = 2;

// ------------------------------------------------------------------ falling

/**
 * What a drop costs, per level, and how fast it gets worse.
 *
 * SUPERLINEAR ON PURPOSE. A one-level step down is a jolt you take without thinking
 * about it — 4 — and the deepest drop the grid can say is four levels, at 4x16 = 64,
 * which is more than the player has. That curve is what makes a ledge a WEAPON: gust
 * costs five damage and shoves one tile, so shoving something off a two-level edge
 * beats casting it three times, and shoving it off a four is the whole fight. A
 * linear scale would have made height a rounding error on the damage table instead of
 * a reason to look at the room.
 *
 * It cuts both ways at exactly the same rate. Nothing here asks who fell.
 */
export const FALL_PER_LEVEL = 4;
export const FALL_EXP = 2;
export function fallDamage(levels: number): number {
  if (levels <= 0) return 0;
  return Math.round(FALL_PER_LEVEL * Math.pow(levels, FALL_EXP));
}

// ------------------------------------------------- elemental interactions

/** CONDUCTION: shock on a soaked body hits harder before the charge travels on. */
export const CONDUCTION_MULT = 1.5;

/**
 * How far the charge looks for the next thing to jump to, as path distance.
 *
 * Generous, because REACH IS WHAT SPARK IS. The old arc capped at 3 and stopped after
 * one hop, which made it a slightly wider bolt; a chain that gives up at three tiles
 * is the same page with more code behind it. Walls still stop it — the search is a
 * flood, so a charge never crosses one — and a continuous plate of iron or standing
 * water ignores this number entirely, which is the whole point of standing on metal.
 */
export const CHAIN_RANGE = 9;

/**
 * Milliseconds between jumps.
 *
 * The chain has to be WATCHED, not totalled. Sized against `ACT_PACE_MS`, which is
 * what a body acting already costs, so a long chain reads in the same rhythm as a
 * busy enemy round rather than as the game hanging.
 */
export const CHAIN_JUMP_MS = 110;

/**
 * SHATTER: a hit this heavy on a frozen body breaks the shell open.
 *
 * Eight is exactly a rank-1 Frostbolt, and that is the whole point — at hand size
 * 1 the only thing that freezes is Frostbolt, so if the threshold sits above it
 * the valve that ends a freeze can never trip. The 5-damage utility pages (Gust,
 * Decay) stay below it, so "a heavy hit" still means something.
 */
export const SHATTER_DAMAGE = 8;
export const SHATTER_MULT = 1.5;

/** Frost bites deeper through water. */
export const DEEP_FREEZE_MULT = 1.6;

/**
 * IGNITE: fire meeting harvested oil on a body.
 *
 * Two exactly, because `docs/DESIGN.md` gives Oil the job "doubles fire damage"
 * and this is that sentence. It is the largest interaction multiplier in the file
 * and it is allowed to be, because unlike the others it is not free: soaked and
 * frozen ride along on casts that were worth making anyway, while oil is a whole
 * hand slot spent on 3 damage and a promise. Note that the rebase made it CHEAPER
 * — harvesting the oil no longer costs a turn — so what it is paid for is the slot
 * alone, and at hand size 1 the slot is the whole hand.
 */
export const OIL_FIRE_MULT = 2;

// ------------------------------------------------------------------- pacing

/**
 * How long a round takes to read, in milliseconds.
 *
 * An action now buys exactly ONE round, which makes this more load-bearing than it
 * was and not less: where three rounds in a row could be read as "something is
 * happening" even if each was instant, a single round resolving inside one
 * microtask is a room that answered without appearing to. Only bodies that
 * actually act are paced, so an empty room stays instant.
 *
 * Kept short on purpose. `main.ts` blocks input for the round, so every
 * millisecond here is also a millisecond the player cannot step, and stepping away
 * is the answer to a fight going badly. A three-body room is ~240ms of round, which
 * staggers the bodies visibly without stalling the stepper.
 */
export const ACT_PACE_MS = 60;
export const ROUND_PACE_MS = 60;

/**
 * THE BEAT BETWEEN YOUR ACTION AND THE ROOM'S ANSWER.
 *
 * A turn is two things happening in order — you act, then they do — and without a
 * gap between them it does not read as two things at all. The body was struck and
 * struck back inside the same frame, so what the player saw was a single exchange
 * they were somehow on the losing side of, rather than a hit landing and then being
 * answered. Nothing about the rules was unclear; the presentation simply never let
 * the first half finish before the second started.
 *
 * Bigger than `ACT_PACE_MS` by a lot, and it has to be: 60ms staggers bodies WITHIN
 * a phase, where the eye is reading them as one group moving. This separates two
 * phases, which is a beat the player is meant to notice.
 *
 * It is also input latency — `main.ts` blocks input for the round, and stepping away
 * is the answer to a fight going badly, so this is time the player cannot escape in.
 * That is the whole tension in the number. It is spent ONCE per round rather than
 * per body, and only when something is actually going to act, so a room with nothing
 * awake in it still answers instantly.
 */
export const TURN_GAP_MS = 260;

/**
 * A moment after the player's attack LANDS before the beat above starts counting.
 *
 * The bolt's flight is waited out in full — that is the attack happening — and this is
 * the bite of the impact on the end of it. Not the whole burst: the flash reads the
 * instant it appears and its tail can happily overlap the beat, where waiting the full
 * 300ms of it would put nearly a second between casting and being answered.
 */
export const CAST_LAND_MS = 120;

// ---------------------------------------------------------------- attrition

/**
 * THE BAR IS THE RUN'S BUDGET, NOT THE FLOOR'S. Nothing hands it back for free.
 *
 * There was a `descendHeal` here — 3 + 4d, paid for walking down the stairs — and it
 * is gone. Taking the stairs now costs nothing and pays nothing; the HP you finished a
 * floor on is the HP you start the next one with.
 *
 * The curve was the argument against itself. Its slope was +4 per depth against +1 for
 * `bossDamage` and +0.5 for `enemyDamage`, and the bar it filled is a flat 46 — so the
 * reward for descending grew four times faster than the cost of the floor you descended
 * into, and past about depth 8 the heal (35+) simply refilled the whole bar no matter
 * what the floor had done to you. Depth was a REWARD. That is the wrong sign for the
 * one axis the whole game is built along, and no value of `descendHeal` fixes it,
 * because a heal that scales with depth is the sign error rather than a bad number.
 *
 * What replaces it is nothing, deliberately. Healing is now something you FIND — a
 * chest, or an altar that offers mending instead of power — so it is a reward for
 * exploring a floor rather than a refund for leaving it. That also means the depth you
 * reach is decided by the bar and the bar alone, which is what makes reaching depth 7
 * an achievement rather than a formality.
 *
 * Read the two curves below as the ONLY income in the game.
 */
export const chestHealBase = (depth: number): number => 2 + depth * 2;
export const CHEST_HEAL_SPREAD = 4;

/**
 * How much of a heal the bar can actually take.
 *
 * Call sites heal by THIS rather than by clamping afterwards, so the number in
 * the log is the number the player got. The old form threw away most of the
 * descent heal on floor 1 — the one floor with nothing to spend it on — and still
 * announced the full amount.
 */
export const healable = (hp: number, maxHp: number, amount: number): number =>
  Math.max(0, Math.min(amount, maxHp - hp));

/**
 * How many rounds fire stays on the ground if nobody puts it out.
 *
 * Long enough that a burning doorway is a route you have to plan around for the
 * rest of the fight rather than an inconvenience you wait out — three rounds was
 * tried first and read as a flicker, because at one action per round the player
 * spends three rounds just getting somewhere. Eight is about two thirds of a room
 * fight, so fire cast early is still there when the fight ends.
 *
 * It is also what makes the other half of the loop worth a turn. Gust costs a whole
 * round, and clearing a fire that was about to go out by itself is the failure mode
 * that would make casting it pointless; the fire has to outlive the player's
 * patience before putting it out is a real decision.
 */
export const FIRE_TURNS = 8;

/**
 * Damage per round PER FLAME LEVEL for standing in fire — so 2, 4 or 6 depending on
 * how tall the flame still is.
 *
 * Sized against the bar in hits rather than against enemy damage, which is the rule
 * the rest of this file follows: a full-height fire costs 6, a depth-1 mook hits for
 * 3, so standing in a fresh fire is worth about two hits a round and is never the
 * right answer. Crossing a guttering one for 2 usually is. That gap is the whole
 * mechanic — fire has to be bad enough to route around and cheap enough that routing
 * around it is a choice rather than a rule.
 */
export const GROUND_FIRE_DOT = 2;

/**
 * How many rounds a spilled puddle lasts if nothing sets it off.
 *
 * Longer than a fire, because a puddle is not a threat — it is a piece of the room
 * you positioned, and a trap that evaporates before you can spring it is not a trap.
 * The asymmetry is the point: fire is urgent and oil is patient.
 */
export const SPILL_TURNS = 14;

/**
 * How many tiles a broken container empties over.
 *
 * Nine — the same as an empowered volume, which is deliberate: a barrel is worth
 * about what a good cast is worth, and a player who has learnt to read volumes
 * already knows what nine tiles looks like on the floor. Bigger made a single barrel
 * decide a whole room; smaller and the puddle never reached anything worth reaching.
 */
export const SPILL_VOLUME = 9;

/**
 * How many extra steps a body will walk to keep out of a fire.
 *
 * Three, which makes a fire worth going round whenever going round is roughly as
 * short — the common case in a room — and worth walking through when the detour is
 * long or there is no detour at all. Deliberately finite: fire that was simply
 * impassable would let the player seal a corridor and shoot from behind it, which is
 * the same standing-in-a-corridor exploit `ENGAGE_RADIUS` was raised to close.
 */
export const FIRE_DETOUR = 3;

/**
 * How many extra tiles a patch gains when a cast FEEDS it rather than spending it.
 *
 * Eight, which is one ring around a single tile: a base cast takes a 1-tile fire to
 * 9, and an empowered one takes 9 to 17. Sized as a ring rather than as a multiplier
 * so feeding is something you do repeatedly and deliberately — a cast that doubled
 * the patch would make the first feed the only one worth making.
 */
export const GROW_RING = 2;

/**
 * How much DEBRIS one Earthquake can leave.
 *
 * Below the volume ladder's top rung on purpose. Rubble is the only thing a cast
 * leaves that never expires — every patch burns out, dries up or is swept, and this
 * sits on the floor until someone spends a gust on it. A hazard you cannot outwait
 * has to be smaller than one you can.
 */
export const RUBBLE_MAX_TILES = 3;

/**
 * Stars a body pays, by depth.
 *
 * Flat +1 before, which made the pull toward depth a CLIFF rather than a slope — a
 * deferred finding from the turn economy review, and the thing `Descent_Unlocks` says
 * to fix rather than balance against. Depth barely paid until the very end and then
 * paid enormously, so a run's income was almost entirely the completion bonus.
 *
 * A step every three floors: 1 through depth 3, 2 to depth 6, 3 to depth 9, 4 at ten.
 * Stepped rather than linear so the number stays something a player can hold in their
 * head, and so the deep floors are worth walking into on their own account before the
 * bonus at the bottom is reached.
 */
export const bodyStars = (depth: number): number => 1 + Math.floor((depth - 1) / 3);

/**
 * Altar draws granted for starting deep.
 *
 * THREE, against the five floors a deep start skips — fewer than you gave up, which is
 * what makes the deep road the weaker path rather than a shortcut. The other half of
 * that trade is the star income of the skipped floors, which is simply gone.
 */
export const CATCH_UP_DRAWS = 3;

/**
 * The nominal life of a plant patch, in rounds.
 *
 * It is never counted down — `Ground.age` skips plants outright, because a plant is
 * terrain and terrain does not gutter. The number exists only so a plant patch holds
 * the same shape of record as every other patch, and so `feed` has a figure to top
 * one back up to.
 */
export const PLANT_TURNS = 3;

/**
 * How many turns of life one dropped unit is worth.
 *
 * Dropping is not casting: a cast pays a turn for a volume decided by the spell, and
 * this pays a turn for a volume decided by how much you were carrying. Per-unit, so
 * the amount slider means something on the floor — five oil is a slick worth walking
 * around and one is a smear.
 */
export const POUR_TURNS_PER_UNIT = 2;

/**
 * Extra turns of life a tile loses each round it arms the player standing in it.
 *
 * One on top of the ordinary tick, so a patch you stand in lasts half as long as one
 * you walk past. That is the whole self-limit on the mechanic: the strong position is
 * temporary by construction, and nobody can camp a bonfire and farm it.
 */
export const GROUND_ARM_DRAIN = 1;

/**
 * Max health an altar gives when there is nothing to mend.
 *
 * The old dungeon-mouth blessing's number, kept: it was sized for a choice made before
 * the first floor, which is exactly the altar this card now answers most often.
 */
export const MAX_HP_GIFT = 8;
