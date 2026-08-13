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
  /**
   * `beam` is the odd one out: every other kind is a point that MOVES between
   * `from` and `to`, while a beam is a quad STRETCHED across both at once and
   * rolled to face the camera about its own length. That is what a bolt of
   * lightning is — a thing occupying the whole gap rather than crossing it.
   */
  kind: 'bolt' | 'ring' | 'spark' | 'flare' | 'beam' | 'mote';
  size: number;
  spin: number;
  /** Fired once when a bolt reaches its target. */
  onArrive?: () => void;
  arrived: boolean;
}

/** Scratch for the beam basis — rebuilt every frame, so never allocated per bit. */
const BEAM_X = new THREE.Vector3();
const BEAM_Y = new THREE.Vector3();
const BEAM_Z = new THREE.Vector3();
const BEAM_VIEW = new THREE.Vector3();
const BEAM_M = new THREE.Matrix4();

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

  /**
   * The two PAINTED textures, lifted from `vfx-factory`'s `_ref-lightning-chain`.
   *
   * Everything else in this file is drawn procedurally in `Pix`, because everything
   * else is a blob of light and a blob of light is cheaper to author than to load.
   * A bolt is not a blob: it is a specific silhouette — forked, tapered, brightest
   * along a hot core — and that is the one thing the pixel helpers here cannot make.
   *
   * `streak_lightning_thin` HAS ITS COLOUR BAKED IN (cobalt body, indigo halo,
   * near-white core), so it is tinted with white and left alone. Tinting it with
   * spark's yellow would multiply into the painted blue and come out muddy. The
   * motes are a white mask, so those DO take the cast's colour.
   */
  private texStreak: THREE.Texture;
  private texMote: THREE.Texture;

  constructor() {
    this.texOrb = orbTex().toTexture();
    this.texRing = ringTex().toTexture();
    this.texStar = starTex().toTexture();
    const load = new THREE.TextureLoader();
    this.texStreak = load.load('art/vfx/streak_lightning_thin.png');
    this.texMote = load.load('art/vfx/mote_soft.png');
    for (const t of [this.texStreak, this.texMote]) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
    }
  }

  /** Box-Muller, for the jitter that makes a bolt a zigzag and not a ruler. */
  private gauss(sd: number): number {
    const u = Math.max(1e-6, this.rng.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rng.next()) * sd;
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
    const want = b.kind === 'ring' ? this.texRing
      : b.kind === 'flare' ? this.texStar
        : b.kind === 'beam' ? this.texStreak
          : b.kind === 'mote' ? this.texMote
            : this.texOrb;
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
  ): number {
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

    /**
     * WHEN THIS LANDS, in seconds, so a caller can wait for it.
     *
     * Returned rather than recomputed by the caller, because the flight time is
     * `0.26 + distance * 0.03` and that number belongs here. `Combat` has to know when
     * the player's attack has finished before it lets the room answer — see
     * `TURN_GAP_MS` — and a second copy of this formula in `main.ts` would be a beat
     * that silently drifts the day the bolt speed changes.
     */
    return (opts.delay ?? 0) + b.dur;
  }

  /**
   * ONE LINK OF CHAIN LIGHTNING, from `vfx-factory`'s `_ref-lightning-chain`.
   *
   * The reference strobes forever between two fixed anchors; a jump in this game is
   * a single event between two bodies, so the loop is unrolled into `flashes` short
   * strikes spaced a frame or two apart. What is kept is everything that makes it
   * read as lightning rather than as a laser:
   *
   *  - THE PATH IS A ZIGZAG, not a line. Three segments with gaussian jitter at the
   *    joints, re-rolled on every flash, so the bolt never sits still.
   *  - IT SNAPS OFF, it does not fade. 67ms at full alpha and gone, which is what
   *    makes the gaps between flashes feel like a strobe instead of a dissolve.
   *  - A BRANCH, sometimes, growing off one of the two real endpoints — anchored to
   *    a vertex the bolt actually drew, or it floats free of the visible zigzag.
   *  - SPARKS THAT OUTLIVE IT along every segment, so the air stays lit after the
   *    bolt has gone.
   */
  chain(from: THREE.Vector3, to: THREE.Vector3, colour: number, flashes = 3): void {
    for (let f = 0; f < flashes; f++) {
      // 4 frames on, 2 off, at 60fps — the reference's duty cycle, held exactly.
      const at = f * 0.1;
      const verts = this.strike(from, to, at, 3);
      if (this.rng.chance(0.4)) {
        const a = this.rng.chance(0.5) ? verts[0] : verts[verts.length - 1];
        const b = new THREE.Vector3(
          a.x + this.gauss(0.6), a.y + this.gauss(0.5), a.z + this.gauss(0.6),
        );
        this.strike(a, b, at, 2);
      }
      // The anchors pulse in time with the strike, so the link reads as powered at
      // both ends rather than as something arriving at one of them.
      for (const p of [from, to]) {
        const m = this.take('mote');
        this.setTex(m);
        m.from.copy(p); m.to.copy(p);
        m.size = this.rng.range(0.45, 0.6);
        m.dur = 0.18; m.t = -at; m.spin = 0;
        m.mat.color.setHex(colour);
        this.bits.push(m);
      }
    }
  }

  /** One flash: the jittered vertex list, the beams between them, and the sparks. */
  private strike(
    a: THREE.Vector3, b: THREE.Vector3, delay: number, segments: number,
  ): THREE.Vector3[] {
    const verts: THREE.Vector3[] = [a.clone()];
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      verts.push(new THREE.Vector3(
        a.x + (b.x - a.x) * t + this.gauss(0.45),
        a.y + (b.y - a.y) * t + this.gauss(0.45),
        a.z + (b.z - a.z) * t + this.gauss(0.45),
      ));
    }
    verts.push(b.clone());

    const life = 0.067;
    for (let i = 1; i < verts.length; i++) {
      const p0 = verts[i - 1], p1 = verts[i];
      const beam = this.take('beam');
      this.setTex(beam);
      beam.from.copy(p0); beam.to.copy(p1);
      beam.size = 0.36; beam.dur = life; beam.t = -delay; beam.spin = 0;
      // White: the streak's blue is painted into the texture — see `texStreak`.
      beam.mat.color.setHex(0xffffff);
      this.bits.push(beam);

      const n = this.rng.int(1, 3);
      for (let s = 0; s < n; s++) {
        const t = this.rng.next();
        const m = this.take('mote');
        this.setTex(m);
        m.from.lerpVectors(p0, p1, t);
        m.to.set(
          m.from.x + this.gauss(0.12), m.from.y + this.gauss(0.12), m.from.z + this.gauss(0.12),
        );
        m.size = this.rng.range(0.08, 0.16);
        // 4-8x the beam, so they persist as glittering residue after it snaps off.
        m.dur = this.rng.range(life * 4, life * 8);
        m.t = -delay; m.spin = 0;
        m.mat.color.setHex(0xc8e8ff);
        this.bits.push(m);
      }
    }
    return verts;
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

      /**
       * A BEAM IS PLACED, NOT MOVED, and it is the one bit that is not a full
       * billboard: it spans `from`→`to` and only ROLLS about that axis to face the
       * camera. Billboarding it on all three axes like everything else would let it
       * swing off its own endpoints, and a bolt whose ends are not on the two bodies
       * it connects is the whole illusion gone.
       *
       * The streak texture is 333x887 — taller than it is wide — so the bolt runs
       * along local Y and the thickness is local X.
       */
      if (b.kind === 'beam') {
        BEAM_Y.subVectors(b.to, b.from);
        const len = BEAM_Y.length();
        if (len < 1e-5) { b.mesh.visible = false; continue; }
        BEAM_Y.divideScalar(len);
        BEAM_VIEW.set(0, 0, -1).applyQuaternion(camQuat);
        /**
         * `view × Y` and NOT `Y × view`, which is the difference between a bolt you
         * can see and one you cannot.
         *
         * The quad's normal is its local +Z, and `makeBasis` derives that from the
         * other two. Crossing the other way puts +Z along the view direction — that
         * is, pointing AWAY from the camera — so every beam was backfacing and culled
         * while its position, scale and opacity all read as perfectly correct. This
         * order faces the normal back down the camera's line of sight, and keeps the
         * basis right-handed so `setFromRotationMatrix` gets a real rotation.
         */
        BEAM_X.crossVectors(BEAM_VIEW, BEAM_Y);
        // Dead-on down the barrel: any perpendicular will do, and picking one
        // silently beats a zero-length basis that collapses the quad to nothing.
        if (BEAM_X.lengthSq() < 1e-8) BEAM_X.set(1, 0, 0).cross(BEAM_Y);
        BEAM_X.normalize();
        BEAM_Z.crossVectors(BEAM_X, BEAM_Y).normalize();
        BEAM_M.makeBasis(BEAM_X, BEAM_Y, BEAM_Z);
        b.mesh.quaternion.setFromRotationMatrix(BEAM_M);
        b.mesh.position.lerpVectors(b.from, b.to, 0.5);
        // Thins slightly over its life, as `sizeEnd` does in the reference. No alpha
        // ramp: a bolt SNAPS off, and fading it turns the strobe into a dissolve.
        b.mesh.scale.set(b.size * (1 - k * 0.55), len, 1);
        b.mat.opacity = 1;
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
    this.texStreak.dispose(); this.texMote.dispose();
    this.group.clear();
    this.bits.length = 0; this.pool.length = 0;
  }
}
