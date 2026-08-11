/**
 * Grid-stepper movement.
 *
 * The player is always ON a tile and always facing a cardinal direction. Motion
 * between tiles is a short eased tween — long enough to read as movement, short
 * enough that holding a direction feels responsive. Everything about the feel of
 * this game is in the constants at the top of this file.
 */
import * as THREE from 'three';
import { Grid, DIR_VEC, Surface, Tile, type Dir } from '../dungeon/grid';
import { STEP_H } from '../art/tiles';

/** Seconds per one-tile step. */
const STEP_TIME = 0.235;
/** Seconds per 90-degree turn. */
const TURN_TIME = 0.17;
/**
 * The framing, which is four numbers that only work together.
 *
 * The hard requirement is that the floor stays readable even while you are
 * standing against a wall — that is how you know you are against it, and how you
 * count tiles. The wall you are touching has its base half a tile away, and from
 * an eye at human height that is a ~65-degree look down: steeper than any sane
 * lens holds at the same time as the horizon. So the eye comes down, the eye sits
 * back, and the lens widens, each paying part of the cost:
 *
 * - `EYE_H` — low. Cheap in distortion, expensive in drama: the world towers.
 * - `PULLBACK` — sitting back off the tile centre. The cheapest of the three; it
 *   costs no distortion at all, only a small camera arc when you turn.
 * - `PITCH` — nearly nothing now. Pitch raises the floor into frame but it takes
 *   the horizon up with it, and past a few degrees the whole frame reads as floor.
 * - The camera's vertical field of view (90, set in `Engine`) plus the lens shift
 *   in `Engine.frameAbove`.
 *
 * Measured at 390x844: the floor at the base of a wall you are touching lands at
 * 68% of the screen, against a grimoire whose top edge is at 74%. The horizon
 * sits at 36% and the ceiling three tiles out at 11%, so the band above the book
 * reads as a room rather than as all floor or all wall.
 *
 * Eye height is ABSOLUTE, in world units, not a fraction of the wall. The framing
 * depends only on how high the eye is off the floor and how far back it sits, so
 * expressing it against the ceiling meant that changing the ceiling silently moved
 * the camera and broke everything above.
 */
const EYE_H = 0.525;
const PULLBACK = 0.30;

/**
 * Downward camera pitch, radians — see the framing note above. Kept near zero
 * because it is a rotation, so it keystones the walls, and because it moves the
 * horizon rather than just the floor.
 */
export const PITCH = -0.03;

export type MoveKind = 'forward' | 'back' | 'left' | 'right';

/**
 * A move, optionally `compound`.
 *
 * A compound move is the two-finger up/down gesture: one action that both steps
 * and turns, so it stays distinct from the one-finger swipe that only steps. It
 * is also the only move allowed to trade tiles with a creature, and the turn is
 * what makes that trade read as "get behind it": on a swap you end up facing the
 * tile you left, which is where the creature now stands with its back to you.
 * With nothing there there is no back to face, so it is a plain 180 either way.
 */
export type MoveInput = { kind: 'move'; m: MoveKind; compound?: boolean };
export type StepInput = MoveInput | { kind: 'turn'; d: -1 | 1 };

export interface Bump {
  /** 0..1 how far into the failed step we got before hitting the wall. */
  t: number;
  dir: Dir;
}

function easeStep(t: number): number {
  // Fast out of the gate, settling at the end — a walking footfall, not a slide.
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function easeTurn(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export class Stepper {
  x: number;
  y: number;
  dir: Dir;

  /** True while a step or turn tween is running — input is queued, not dropped. */
  get busy(): boolean { return this.moveT < 1 || this.turnT < 1; }

  private fromX: number;
  private fromY: number;
  private moveT = 1;
  private moveKind: MoveKind = 'forward';
  /**
   * How far into this step the stride pauses, or 1 for a step that does not.
   *
   * Rubble is the only thing that sets it. Half a tile in is where a clamber reads
   * best: far enough that the player is visibly committed and standing IN the stuff,
   * near enough that they have not arrived, so the round that fires there is one they
   * take while off balance.
   */
  private holdAt = 1;
  /** Paused at `holdAt`, waiting for `release`. */
  private holding = false;
  /** Stretches this step's duration. Only a slide sets it — see `startMove`. */
  private moveScale = 1;
  /** This step ends in a bottomless gap. See `onPlunge`. */
  private plunging = false;

  private fromYaw: number;
  private toYaw: number;
  private turnT = 1;
  /**
   * How far this turn rotates, signed. Carried explicitly because a 180 is
   * ambiguous to `shortAngle` — both ways round are exactly PI — so the spin
   * direction has to be chosen rather than fallen into.
   */
  private turnDelta = 0;

  /** A queued input, so a tap during a step still lands. */
  private queued: StepInput | null = null;

  /** Wall-bump nudge, drives a small recoil + thud. */
  bump = 0;
  private bumpDir = 0;

  /** Accumulated bob phase — keeps the head bob continuous across steps. */
  private bobPhase = 0;
  /** Fires when a step completes on a new tile. */
  onArrive: ((x: number, y: number) => void) | null = null;
  /**
   * Fired PART-WAY through a step that has to be taken in two.
   *
   * The step stops dead where it is and does not finish until `release` is called,
   * so the game can run a round of enemies while the player is mid-stride. One swipe
   * still means one step — the input is never refused and never has to be repeated,
   * which is the whole reason this exists rather than a first press that bounces off:
   * a press that visibly does nothing is indistinguishable from a dropped swipe, and
   * the player would learn to distrust the control instead of the terrain.
   *
   * If nothing is listening, nothing ever holds — the hold is only ever armed for a
   * caller that has said it will release it.
   */
  onHalfway: ((x: number, y: number) => void) | null = null;
  onBump: ((b: Bump) => void) | null = null;
  /**
   * Fired the instant a step is committed, with both tiles. The game uses this to
   * SWAP places with a friendly golem standing in the destination — your own
   * summons following you around must never be able to wall you in.
   */
  onDepart: ((fromX: number, fromY: number, toX: number, toY: number) => void) | null = null;
  onTurnDone: (() => void) | null = null;
  /** Gate: return false to refuse input (e.g. during an enemy turn). */
  canAct: () => boolean = () => true;
  /**
   * Extra occupancy test on top of the wall grid: altars, furniture and
   * creatures are solid. Walking THROUGH an altar is why it was possible to
   * collect a spell without ever seeing the thing you collected it from.
   */
  blocked: (x: number, y: number) => boolean = () => false;
  /**
   * Is the thing on this tile a body a compound move may trade places with? The
   * wall grid still refuses, so this only ever loosens `blocked`, never the map.
   */
  swappable: (x: number, y: number) => boolean = () => false;
  /**
   * Is this tile ICE — does landing on it carry you on?
   *
   * A hook rather than a grid read, because ice is not part of the floor: it is frost
   * cast onto standing water, so it lives in `Ground` with everything else a spell
   * left behind, and the stepper deliberately knows nothing about `Ground`.
   */
  slippery: (x: number, y: number) => boolean = () => false;
  /**
   * Is this tile SNAGGED — is there briar growing on it?
   *
   * A hook for the same reason `slippery` is one: a plant is a patch in `Ground`, not
   * a surface in the grid, and the stepper knows nothing about `Ground`. Briar only,
   * never the bramble around it: one tile of a plant cast is difficult ground and the
   * rest is undergrowth, or every cast would be a wall.
   */
  snagged: (x: number, y: number) => boolean = () => false;
  /**
   * Fired when the step just taken was into a bottomless gap.
   *
   * The one move the grid says no to that the PLAYER is allowed to make anyway. A
   * chasm you can only ever bump into is a wall you can see across; a chasm you can
   * step off is a decision, and the whole of `Grid_Vocabulary` rests on a gap being a
   * thing you can see across and choose not to cross. Choosing to cross is fatal, and
   * that is the point.
   *
   * Only ever the player. `walkable` still says no to every flood, every volume and
   * every body's pathing, so nothing else in the game can walk into one — which is
   * what keeps the rest of the codebase's assumptions about gaps true.
   */
  onPlunge: ((x: number, y: number) => void) | null = null;

  constructor(private grid: Grid, x: number, y: number, dir: Dir) {
    this.x = x; this.y = y; this.dir = dir;
    this.fromX = x; this.fromY = y;
    this.fromYaw = this.toYaw = dirYaw(dir);
  }

  /** Eye height above the floor, in world units. See `EYE_H`. */
  eyeHeight = EYE_H;

  /** How far back from the tile centre the eye sits. See `PULLBACK`. */
  pullback = PULLBACK;

  /**
   * How far along the step we are, eased.
   *
   * A held step is TWO STEPS, and each half is eased from rest to rest, so the
   * player sees a footfall into the obstacle and a second one out of it. Easing the
   * whole crossing as one curve and pausing partway through it — which is what this
   * did — reads as a frame hitch, not as difficult ground.
   */
  private travel(): number {
    const t = Math.min(1, this.moveT);
    if (this.holdAt >= 1) return easeStep(t);
    return t <= this.holdAt
      ? easeStep(t / this.holdAt) * this.holdAt
      : this.holdAt + easeStep((t - this.holdAt) / (1 - this.holdAt)) * (1 - this.holdAt);
  }

  /** Where the camera should be right now, in world space. */
  eye(out: THREE.Vector3, time: number): void {
    const p = this.travel();
    const x = this.fromX + (this.x - this.fromX) * p;
    const z = this.fromY + (this.y - this.fromY) * p;

    // Head bob: a vertical figure-of-eight, only while moving, plus a slow idle
    // sway so standing still never looks frozen.
    const moving = this.moveT < 1;
    const bobAmt = moving ? 0.022 : 0.004;
    const bob = Math.sin(this.bobPhase * Math.PI * 2) * bobAmt;
    const sway = Math.sin(this.bobPhase * Math.PI) * (moving ? 0.012 : 0.003);
    const idle = Math.sin(time * 1.1) * 0.003;

    // wall bump: shove the eye toward the wall and back
    const [bdx, bdy] = DIR_VEC[this.bumpDir as Dir] ?? [0, 0];
    const bk = this.bump * 0.09;

    /**
     * THE EYE RIDES THE GROUND, interpolated across the step like the position is.
     *
     * Which is the whole of the camera's part in verticality, and it is deliberately
     * all of it: the eye goes up and down, and the FRAMING — pitch, pullback, height
     * above the floor — never moves. `First_Minutes` settled that the camera does not
     * pitch, and a drop is not a reason to reopen it. Walking off a ledge lowers you
     * by the drop and shows you more of what is ahead because you are lower, not
     * because the lens tilted.
     *
     * Eased with the same curve as x and z, so a step down is one motion rather than
     * a slide followed by a lurch.
     */
    const eg = this.groundAt(this.fromX, this.fromY);
    const dg = this.groundAt(this.x, this.y);
    /**
     * AN L, NOT A DIAGONAL. Forward, then down; or up, then forward.
     *
     * Interpolating the height across the whole step sends the eye along the
     * hypotenuse, which is a thing no body does — you do not sink through the ledge
     * on your way off it, you walk to the edge and then you drop. Holding the old
     * level for the first third and the new one for the last third puts the whole
     * change in the middle, so the move reads as two straight lines with a corner in
     * it. Going up it reads as the step onto the ledge; going down, as the drop off it.
     *
     * `easeStep` is deliberately not reused for the vertical part: the horizontal
     * curve is a footfall, settling at the end, and a fall that settled would float.
     */
    const HOLD = 0.34;
    const v = p <= HOLD ? 0 : p >= 1 - HOLD ? 1 : (p - HOLD) / (1 - HOLD * 2);
    const ground = eg + (dg - eg) * v;

    const yaw = this.yaw();
    const back = Math.min(0.45, this.pullback);
    out.set(
      x + sway * Math.cos(yaw) + bdx * bk + Math.sin(yaw) * back,
      ground + this.eyeHeight + bob + idle,
      z - sway * Math.sin(yaw) + bdy * bk + Math.cos(yaw) * back,
    );
  }

  /** World height of the floor at a tile. */
  private groundAt(x: number, y: number): number {
    return this.grid.heightAt(x, y) * STEP_H;
  }

  yaw(): number {
    const t = easeTurn(Math.min(1, this.turnT));
    return this.fromYaw + this.turnDelta * t;
  }

  /** Extra camera roll — sells the bump and the stride. */
  roll(): number {
    const moving = this.moveT < 1;
    return (moving ? Math.sin(this.bobPhase * Math.PI * 2) * 0.006 : 0) - this.bump * 0.03;
  }

  press(input: StepInput): void {
    if (!this.canAct()) return;
    if (this.busy) { this.queued = input; return; }
    if (input.kind === 'turn') this.startTurn(input.d);
    else this.startMove(input.m, input.compound);
  }

  private startTurn(d: -1 | 1, quarters: 1 | 2 = 1): void {
    this.dir = (((this.dir + d * quarters) % 4) + 4) % 4 as Dir;
    this.fromYaw = this.yaw();
    this.toYaw = dirYaw(this.dir);
    this.turnDelta = quarters === 2 ? d * Math.PI : shortAngle(this.fromYaw, this.toYaw);
    this.turnT = 0;
  }

  /**
   * Let a held step finish. Safe to call when nothing is held, and safe to call
   * twice — a soft-locked stepper is a soft-locked game, so this never asserts.
   */
  release(): void {
    this.holding = false;
    this.holdAt = 1;
  }

  /** Turn to a facing by the shortest route, spinning clockwise for a 180. */
  private turnTo(d: Dir): void {
    const q = ((((d - this.dir) % 4) + 4) % 4);
    if (q === 0) return;
    if (q === 2) this.startTurn(1, 2);
    else this.startTurn(q === 1 ? 1 : -1);
  }

  /** The direction a given move actually travels, given current facing. */
  private moveDir(m: MoveKind): Dir {
    const off = m === 'forward' ? 0 : m === 'right' ? 1 : m === 'back' ? 2 : 3;
    return ((this.dir + off) % 4) as Dir;
  }

  private startMove(m: MoveKind, compound = false): void {
    const d = this.moveDir(m);
    const [dx, dy] = DIR_VEC[d];
    const nx = this.x + dx, ny = this.y + dy;
    // A ledge you cannot climb refuses exactly like a wall does — same bump, same
    // recoil. The player learns "that is too high" from the same feedback that
    // teaches them "that is solid", which is one lesson instead of two.
    // A gap is steppable ONLY by the player, and only if somebody is listening for
    // what happens next. See `onPlunge`.
    const intoGap = !!this.onPlunge && this.grid.at(nx, ny) === Tile.Gap;
    const open = intoGap
      || (this.grid.walkable(nx, ny) && this.grid.canClimb(this.x, this.y, nx, ny));
    // A compound move trades tiles with a body, so `blocked` must not veto it.
    // The wall grid is never loosened: nothing swaps you through a wall or off
    // the map, only past something standing on a tile you could have walked to.
    const swap = compound && open && this.swappable(nx, ny);
    if (!open || (this.blocked(nx, ny) && !swap)) {
      this.bump = 1;
      this.bumpDir = d;
      this.onBump?.({ t: 0, dir: d });
      return;
    }
    this.fromX = this.x; this.fromY = this.y;
    this.x = nx; this.y = ny;

    /**
     * ICE CARRIES YOU ON, and the whole slide is ONE turn.
     *
     * Which is the entire reason frost is traversal rather than decoration: the cast
     * that laid the ice buys back the turns the walk would have cost, so a spell
     * becomes a movement option without a movement spell existing. You slide while
     * the tile under you is ice and stop on the first tile that is not, or against
     * whatever is in the way — the rule everybody already knows from every other game
     * with ice in it, which is worth more here than a cleverer one.
     *
     * Refused by exactly the things that refuse a step: a wall, a shut gate, a ledge
     * you cannot climb, a body. A slide is not a licence to pass through anything.
     */
    this.plunging = intoGap;
    let slid = 0;
    while (!intoGap && this.slippery(this.x, this.y) && slid < 8) {
      const sx = this.x + dx, sy = this.y + dy;
      if (!this.grid.walkable(sx, sy) || !this.grid.canClimb(this.x, this.y, sx, sy)) break;
      if (this.blocked(sx, sy)) break;
      this.x = sx; this.y = sy;
      slid++;
    }

    this.moveT = 0;
    this.moveKind = m;
    /**
     * A longer slide takes longer, but sub-linearly — the glide has to read as one
     * motion rather than as four steps played fast, and a slide that took four times
     * as long as a step would hand the room four turns' worth of waiting for one.
     */
    /**
     * A CLIMB TAKES LONGER THAN A WALK.
     *
     * Stepping up a level covered the same distance in the same time as crossing flat
     * ground, which reads as hopping onto a ledge rather than climbing it — and the
     * ledge is now most of a storey. Scaled by the RISE only: dropping stays quick,
     * because falling is quick, and slowing a fall would take the weight out of the
     * one movement this phase wanted to feel heavy.
     */
    const rise = Math.max(0, this.grid.heightAt(this.x, this.y) - this.grid.heightAt(this.fromX, this.fromY));
    this.moveScale = slid ? 1 + slid * 0.35 : 1 + rise * 0.85;
    /**
     * THE COST IS THE EDGE, not the tile.
     *
     * Getting INTO rubble or briar costs the double move, and so does getting OUT of
     * it — but moving from one briar tile to the next does not, because you are
     * already in it and there is no second edge to fight through. Charging per tile
     * instead made a wide patch cost its own area, which turns a thicket into a wall
     * the moment it is more than one tile across; charging on the boundary makes it
     * a thing with an inside, which is what terrain is.
     */
    const hard = (x: number, y: number): boolean =>
      this.grid.surfaceAt(x, y) === Surface.Rubble || this.snagged(x, y);
    this.holdAt = this.onHalfway && !slid && hard(this.fromX, this.fromY) !== hard(nx, ny)
      ? 0.5 : 1;
    /**
     * AND IT TAKES TWICE AS LONG TO WATCH.
     *
     * The crossing already cost two rounds — one handed over at the hold, one on
     * arrival — and read as none of it: the whole thing played inside a single
     * step's worth of time, as one glide with a hitch in the middle, so the player
     * paid a turn they could not see. Doubling the duration is what makes the price
     * legible, and `eye` eases the two halves separately so each one lands as its
     * own footfall rather than as a stutter in one motion.
     */
    if (this.holdAt < 1) this.moveScale *= 2;
    this.holding = false;
    this.onDepart?.(this.fromX, this.fromY, nx, ny);
    // The turn rides along with the step — one action, one round. See `MoveInput`.
    if (compound) this.turnTo(swap ? (((d + 2) % 4) as Dir) : (((this.dir + 2) % 4) as Dir));
  }

  update(dt: number): void {
    if (this.moveT < 1 && !this.holding) {
      this.moveT = Math.min(this.holdAt, this.moveT + dt / (STEP_TIME * this.moveScale));
      // one full bob cycle per step, so footfalls land on arrival
      this.bobPhase += dt / STEP_TIME;
      if (this.holdAt < 1 && this.moveT >= this.holdAt) {
        // Stop mid-stride and hand the round over. `fromX/fromY` is the tile the
        // player still counts as standing on: they are climbing INTO the rubble, not
        // out of it, and the room answers from where they actually are.
        this.holding = true;
        this.onHalfway?.(this.fromX, this.fromY);
      } else if (this.moveT >= 1) {
        this.bobPhase = Math.round(this.bobPhase);
        if (this.plunging) {
          this.plunging = false;
          this.onPlunge?.(this.x, this.y);
        } else {
          this.onArrive?.(this.x, this.y);
        }
      }
    } else if (this.moveT >= 1) {
      this.bobPhase += dt * 0.22; // idle breathing
    }

    if (this.turnT < 1) {
      this.turnT = Math.min(1, this.turnT + dt / TURN_TIME);
      if (this.turnT >= 1) {
        this.fromYaw = this.toYaw;
        this.turnDelta = 0;
        this.onTurnDone?.();
      }
    }

    if (this.bump > 0) this.bump = Math.max(0, this.bump - dt * 5.5);

    if (!this.busy && this.queued) {
      const q = this.queued;
      this.queued = null;
      if (q.kind === 'turn') this.startTurn(q.d);
      else this.startMove(q.m, q.compound);
    }
    void this.moveKind;
  }

  /** Snap to a tile with no tween — used on floor entry. */
  place(x: number, y: number, dir: Dir): void {
    this.x = this.fromX = x;
    this.y = this.fromY = y;
    this.dir = dir;
    this.fromYaw = this.toYaw = dirYaw(dir);
    this.turnDelta = 0;
    this.moveT = 1; this.turnT = 1; this.bump = 0;
  }
}

/** Yaw so that dir 0 (north, -z) looks down -z. */
export function dirYaw(d: Dir): number {
  return [0, -Math.PI / 2, Math.PI, Math.PI / 2][d];
}

function shortAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
