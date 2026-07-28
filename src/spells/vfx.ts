/**
 * Cast effects — the projectile, the trail, the impact.
 *
 * Deliberately small: additive billboard quads sharing three procedurally drawn
 * textures (orb, ring, spark), tinted per cast. In a first-person game the cast
 * flies AWAY from the camera, so it is on screen for a third of a second — what
 * sells it is not detail, it is the LAUNCH (a bright bloom near the eye), the
 * arrival timing, and the impact answering back with flash, shake and hitstop.
 */
import * as THREE from 'three';
import { Pix, hex, rgba } from '../art/pixel';
import { Rng } from '../core/rng';

/** A soft round orb, quantised into bands so it reads as pixel art. */
function orbTex(): Pix {
  const S = 32, p = new Pix(S, S);
  const c = (S - 1) / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - c, y - c) / (S / 2);
      if (d >= 1) continue;
      const band = Math.max(0, 1 - d);
      const q = Math.round(band * 4) / 4;
      p.set(x, y, rgba(255, 255, 255, Math.round(255 * q * q)));
    }
  }
  return p;
}

/** An expanding shock ring. */
function ringTex(): Pix {
  const S = 48, p = new Pix(S, S);
  const c = (S - 1) / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - c, y - c) / (S / 2);
      if (d > 1) continue;
      const edge = 1 - Math.abs(d - 0.78) / 0.22;
      if (edge <= 0) continue;
      const q = Math.round(edge * 3) / 3;
      p.set(x, y, rgba(255, 255, 255, Math.round(230 * q)));
    }
  }
  return p;
}

/** A four-point star flare for the launch moment. */
function starTex(): Pix {
  const S = 32, p = new Pix(S, S);
  const c = (S - 1) / 2;
  for (let i = 0; i < S; i++) {
    const f = 1 - Math.abs(i - c) / c;
    const a = Math.round(255 * f * f);
    p.set(i, c, rgba(255, 255, 255, a));
    p.set(c, i, rgba(255, 255, 255, a));
    p.set(i, c + 1, rgba(255, 255, 255, Math.round(a * 0.5)));
    p.set(c + 1, i, rgba(255, 255, 255, Math.round(a * 0.5)));
  }
  p.glow(c, c, 9, hex(0xffffff), 0.9, 3);
  return p;
}

interface Bit {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  kind: 'bolt' | 'ring' | 'spark' | 'flare';
  size: number;
  spin: number;
  /** Fired once when a bolt reaches its target. */
  onArrive?: () => void;
  arrived: boolean;
}

export class CastFx {
  readonly group = new THREE.Group();
  private bits: Bit[] = [];
  private pool: Bit[] = [];
  private texOrb: THREE.Texture;
  private texRing: THREE.Texture;
  private texStar: THREE.Texture;
  private geo = new THREE.PlaneGeometry(1, 1);
  private rng = new Rng('vfx');

  /** Screen shake amount, read by the camera rig. */
  shake = 0;
  /** Hitstop: seconds of simulation slowdown remaining. */
  hitstop = 0;

  constructor() {
    this.texOrb = orbTex().toTexture();
    this.texRing = ringTex().toTexture();
    this.texStar = starTex().toTexture();
  }

  private take(kind: Bit['kind']): Bit {
    const b = this.pool.pop();
    if (b) {
      b.kind = kind; b.t = 0; b.arrived = false; b.onArrive = undefined;
      b.mesh.visible = true;
      return b;
    }
    const mat = new THREE.MeshBasicMaterial({
      map: kind === 'ring' ? this.texRing : kind === 'flare' ? this.texStar : this.texOrb,
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: true, fog: false,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const nb: Bit = {
      mesh, mat, from: new THREE.Vector3(), to: new THREE.Vector3(),
      t: 0, dur: 0.3, kind, size: 0.3, spin: 0, arrived: false,
    };
    return nb;
  }

  private setTex(b: Bit): void {
    const want = b.kind === 'ring' ? this.texRing : b.kind === 'flare' ? this.texStar : this.texOrb;
    if (b.mat.map !== want) { b.mat.map = want; b.mat.needsUpdate = true; }
  }

  /**
   * Throw one bolt from the caster's eye to a target position.
   * The launch offset puts it slightly below and ahead of the eye so it reads as
   * coming from the player's hands rather than their forehead.
   */
  bolt(
    from: THREE.Vector3, to: THREE.Vector3, colour: number,
    opts: { size?: number; delay?: number; onArrive?: () => void } = {},
  ): void {
    const b = this.take('bolt');
    this.setTex(b);
    b.from.copy(from);
    b.to.copy(to);
    b.size = opts.size ?? 0.34;
    b.dur = 0.26 + from.distanceTo(to) * 0.03;
    b.t = -(opts.delay ?? 0);
    b.spin = this.rng.range(-4, 4);
    b.mat.color.setHex(colour);
    b.onArrive = opts.onArrive;
    this.bits.push(b);

    // launch flare at the muzzle
    const f = this.take('flare');
    this.setTex(f);
    f.from.copy(from); f.to.copy(from);
    f.size = 0.5; f.dur = 0.16; f.t = -(opts.delay ?? 0);
    f.mat.color.setHex(colour);
    this.bits.push(f);
  }

  /** The impact: a ring, a scatter of sparks, and a kick to the camera. */
  burst(at: THREE.Vector3, colour: number, power = 1): void {
    const r = this.take('ring');
    this.setTex(r);
    r.from.copy(at); r.to.copy(at);
    r.size = 0.55 * power; r.dur = 0.3;
    r.mat.color.setHex(colour);
    this.bits.push(r);

    const n = Math.round(7 * power);
    for (let i = 0; i < n; i++) {
      const s = this.take('spark');
      this.setTex(s);
      s.from.copy(at);
      s.to.set(
        at.x + this.rng.range(-0.7, 0.7) * power,
        at.y + this.rng.range(-0.35, 0.8) * power,
        at.z + this.rng.range(-0.7, 0.7) * power,
      );
      s.size = this.rng.range(0.07, 0.17);
      s.dur = this.rng.range(0.22, 0.45);
      s.mat.color.setHex(colour);
      this.bits.push(s);
    }

    this.shake = Math.min(1.2, this.shake + 0.42 * power);
    this.hitstop = Math.max(this.hitstop, 0.05 * power);
  }

  /** A column of light where a golem rises. */
  rise(at: THREE.Vector3, colour: number): void {
    for (let i = 0; i < 14; i++) {
      const s = this.take('spark');
      this.setTex(s);
      const a = (i / 14) * Math.PI * 2;
      s.from.set(at.x + Math.cos(a) * 0.42, at.y + 0.02, at.z + Math.sin(a) * 0.42);
      s.to.set(at.x + Math.cos(a) * 0.12, at.y + this.rng.range(0.8, 1.5), at.z + Math.sin(a) * 0.12);
      s.size = this.rng.range(0.08, 0.2);
      s.dur = this.rng.range(0.4, 0.8);
      s.mat.color.setHex(colour);
      this.bits.push(s);
    }
    this.burst(at, colour, 1.3);
  }

  update(dt: number, camQuat: THREE.Quaternion): void {
    this.shake = Math.max(0, this.shake - dt * 3.4);
    this.hitstop = Math.max(0, this.hitstop - dt);

    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.t += dt;
      if (b.t < 0) { b.mesh.visible = false; continue; }
      b.mesh.visible = true;
      const k = b.t / b.dur;

      if (k >= 1) {
        if (b.kind === 'bolt' && !b.arrived) { b.arrived = true; b.onArrive?.(); }
        b.mesh.visible = false;
        this.bits.splice(i, 1);
        this.pool.push(b);
        continue;
      }

      let s = b.size;
      let a = 1;
      if (b.kind === 'bolt') {
        // ease out so it decelerates into the target — reads as impact, not a pass
        const e = 1 - Math.pow(1 - k, 2.1);
        b.mesh.position.lerpVectors(b.from, b.to, e);
        // grows as it travels so it does not vanish with perspective
        s = b.size * (0.55 + e * 0.75);
        a = 1;
      } else if (b.kind === 'ring') {
        b.mesh.position.copy(b.from);
        s = b.size * (0.35 + k * 2.5);
        a = 1 - k;
      } else if (b.kind === 'flare') {
        b.mesh.position.copy(b.from);
        s = b.size * (1 + k * 1.4);
        a = 1 - k;
      } else {
        const e = 1 - Math.pow(1 - k, 2);
        b.mesh.position.lerpVectors(b.from, b.to, e);
        s = b.size * (1 - k * 0.6);
        a = 1 - k * k;
      }

      b.mesh.scale.setScalar(Math.max(0.001, s));
      // full billboard (all axes) — these are light, not objects in the world
      b.mesh.quaternion.copy(camQuat);
      if (b.spin) b.mesh.rotateZ(b.t * b.spin);
      b.mat.opacity = Math.max(0, a);
    }
  }

  dispose(): void {
    for (const b of [...this.bits, ...this.pool]) b.mat.dispose();
    this.geo.dispose();
    this.texOrb.dispose(); this.texRing.dispose(); this.texStar.dispose();
    this.group.clear();
    this.bits.length = 0; this.pool.length = 0;
  }
}
