/**
 * Grid-stepper movement.
 *
 * The player is always ON a tile and always facing a cardinal direction. Motion
 * between tiles is a short eased tween — long enough to read as movement, short
 * enough that holding a direction feels responsive. Everything about the feel of
 * this game is in the constants at the top of this file.
 */
import * as THREE from 'three';
import { Grid, DIR_VEC, type Dir } from '../dungeon/grid';
import { WALL_H } from '../art/tiles';

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
 * - `EYE` — low. Cheap in distortion, expensive in drama: the world towers.
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
 */
const EYE = 0.25;
const PULLBACK = 0.30;

/**
 * Downward camera pitch, radians — see the framing note above. Kept near zero
 * because it is a rotation, so it keystones the walls, and because it moves the
 * horizon rather than just the floor.
 */
export const PITCH = -0.03;

export type MoveKind = 'forward' | 'back' | 'left' | 'right';

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

  private fromYaw: number;
  private toYaw: number;
  private turnT = 1;

  /** A queued input, so a tap during a step still lands. */
  private queued: { kind: 'move'; m: MoveKind } | { kind: 'turn'; d: -1 | 1 } | null = null;

  /** Wall-bump nudge, drives a small recoil + thud. */
  bump = 0;
  private bumpDir = 0;

  /** Accumulated bob phase — keeps the head bob continuous across steps. */
  private bobPhase = 0;
  /** Fires when a step completes on a new tile. */
  onArrive: ((x: number, y: number) => void) | null = null;
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

  constructor(private grid: Grid, x: number, y: number, dir: Dir) {
    this.x = x; this.y = y; this.dir = dir;
    this.fromX = x; this.fromY = y;
    this.fromYaw = this.toYaw = dirYaw(dir);
  }

  /** Eye height as a fraction of wall height. See `EYE`. */
  eyeFrac = EYE;

  /** How far back from the tile centre the eye sits. See `PULLBACK`. */
  pullback = PULLBACK;

  /** Where the camera should be right now, in world space. */
  eye(out: THREE.Vector3, time: number): void {
    const p = easeStep(Math.min(1, this.moveT));
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

    const yaw = this.yaw();
    const back = Math.min(0.45, this.pullback);
    out.set(
      x + sway * Math.cos(yaw) + bdx * bk + Math.sin(yaw) * back,
      WALL_H * this.eyeFrac + bob + idle,
      z - sway * Math.sin(yaw) + bdy * bk + Math.cos(yaw) * back,
    );
  }

  yaw(): number {
    const t = easeTurn(Math.min(1, this.turnT));
    return this.fromYaw + shortAngle(this.fromYaw, this.toYaw) * t;
  }

  /** Extra camera roll — sells the bump and the stride. */
  roll(): number {
    const moving = this.moveT < 1;
    return (moving ? Math.sin(this.bobPhase * Math.PI * 2) * 0.006 : 0) - this.bump * 0.03;
  }

  press(input: { kind: 'move'; m: MoveKind } | { kind: 'turn'; d: -1 | 1 }): void {
    if (!this.canAct()) return;
    if (this.busy) { this.queued = input; return; }
    if (input.kind === 'turn') this.startTurn(input.d);
    else this.startMove(input.m);
  }

  private startTurn(d: -1 | 1): void {
    this.dir = (((this.dir + d) % 4) + 4) % 4 as Dir;
    this.fromYaw = this.yaw();
    this.toYaw = dirYaw(this.dir);
    this.turnT = 0;
  }

  /** The direction a given move actually travels, given current facing. */
  private moveDir(m: MoveKind): Dir {
    const off = m === 'forward' ? 0 : m === 'right' ? 1 : m === 'back' ? 2 : 3;
    return ((this.dir + off) % 4) as Dir;
  }

  private startMove(m: MoveKind): void {
    const d = this.moveDir(m);
    const [dx, dy] = DIR_VEC[d];
    const nx = this.x + dx, ny = this.y + dy;
    if (!this.grid.walkable(nx, ny) || this.blocked(nx, ny)) {
      this.bump = 1;
      this.bumpDir = d;
      this.onBump?.({ t: 0, dir: d });
      return;
    }
    this.fromX = this.x; this.fromY = this.y;
    this.x = nx; this.y = ny;
    this.moveT = 0;
    this.moveKind = m;
    this.onDepart?.(this.fromX, this.fromY, nx, ny);
  }

  update(dt: number): void {
    if (this.moveT < 1) {
      this.moveT = Math.min(1, this.moveT + dt / STEP_TIME);
      // one full bob cycle per step, so footfalls land on arrival
      this.bobPhase += dt / STEP_TIME;
      if (this.moveT >= 1) {
        this.bobPhase = Math.round(this.bobPhase);
        this.onArrive?.(this.x, this.y);
      }
    } else {
      this.bobPhase += dt * 0.22; // idle breathing
    }

    if (this.turnT < 1) {
      this.turnT = Math.min(1, this.turnT + dt / TURN_TIME);
      if (this.turnT >= 1) {
        this.fromYaw = this.toYaw;
        this.onTurnDone?.();
      }
    }

    if (this.bump > 0) this.bump = Math.max(0, this.bump - dt * 5.5);

    if (!this.busy && this.queued) {
      const q = this.queued;
      this.queued = null;
      if (q.kind === 'turn') this.startTurn(q.d);
      else this.startMove(q.m);
    }
    void this.moveKind;
  }

  /** Snap to a tile with no tween — used on floor entry. */
  place(x: number, y: number, dir: Dir): void {
    this.x = this.fromX = x;
    this.y = this.fromY = y;
    this.dir = dir;
    this.fromYaw = this.toYaw = dirYaw(dir);
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
