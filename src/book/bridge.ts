/**
 * Compatibility shim for the ported ai-asylum/spellbook `book/` files.
 *
 * Those files are kept near-verbatim so they stay mergeable with upstream, which
 * means they expect spellbook's engine module (`camera`, `onUpdate`,
 * `projectToScreen`), its audio (`sfx`) and its VFX (`goldenSparkle`, …). This
 * module supplies all of that from this game's own systems.
 *
 * The book renders in its OWN scene with its OWN camera, at full device
 * resolution, composited over the pixelated dungeon. That split is deliberate:
 * the dungeon is a low-res pixel-art artifact, the book is a real object in your
 * hands and its page text has to be legible.
 */
import * as THREE from 'three';

/** The book's camera — the book is parented to this, not to the world camera. */
export const camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);

/** The scene the book lives in, composited over the world. */
export const bookScene = new THREE.Scene();
bookScene.add(camera);

type UpdateFn = (dt: number, t: number) => void;
const updaters: UpdateFn[] = [];

export function onUpdate(fn: UpdateFn): void {
  updaters.push(fn);
}

export function tickBook(dt: number, t: number): void {
  for (const fn of updaters) fn(dt, t);
}

/** Screen size of the book layer, in CSS px — set by the engine on resize. */
export const screen = { w: 1, h: 1 };

export function resizeBook(w: number, h: number): void {
  screen.w = w; screen.h = h;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

const _proj = new THREE.Vector3();

/**
 * Project a world point in the BOOK scene to CSS pixels.
 * Returns false when the point is behind the camera.
 */
export function projectToScreen(
  x: number, y: number, z: number, out: { x: number; y: number },
): boolean {
  _proj.set(x, y, z).project(camera);
  if (_proj.z > 1) return false;
  out.x = (_proj.x * 0.5 + 0.5) * screen.w;
  out.y = (-_proj.y * 0.5 + 0.5) * screen.h;
  return true;
}

// ------------------------------------------------------------------- feedback
// The game's juice sinks. `main.ts` wires these to the real CastFx / camera rig
// so the ported book can shake the screen and throw sparkles without importing
// the game's own modules (which would create a cycle).

export const sinks: {
  sparkle: (p: THREE.Vector3, count: number, spread: number, size: number) => void;
  flash: (p: THREE.Vector3, colour: number, size: number) => void;
  ring: (p: THREE.Vector3, colour: number, size: number) => void;
  shake: (amount: number) => void;
  hitstop: (dur: number, depth?: number) => void;
} = {
  sparkle: () => {}, flash: () => {}, ring: () => {}, shake: () => {}, hitstop: () => {},
};

export function goldenSparkle(p: THREE.Vector3, count = 10, spread = 0.2, size = 0.03): void {
  sinks.sparkle(p, count, spread, size);
}

/** Upstream passes (pos, colour, size, life); life is folded into size here. */
export function flashSphere(p: THREE.Vector3, colour = 0xffc23e, size = 0.3, _life = 0.2): void {
  void _life;
  sinks.flash(p, colour, size);
}

export function shockRing(p: THREE.Vector3, colour = 0xffc23e, size = 0.16, _life = 0.3): void {
  void _life;
  sinks.ring(p, colour, size);
}

export function shake(amount: number): void { sinks.shake(amount); }
export function hitstop(dur = 0.09, depth = 0.92): void { sinks.hitstop(dur, depth); }

// ---------------------------------------------------------------------- audio
/**
 * Synthesised sound, no assets. Only the handful of cues the book needs: the
 * paper flip, the tear, and the arcane shimmer. Every one is a short WebAudio
 * graph built on demand — a page flip with no sound feels broken, and a whole
 * sample pipeline for three noises is not worth it.
 */
class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** Browsers require a gesture before audio; call this from the first tap. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private ac(): AudioContext | null {
    if (!this.ctx) this.unlock();
    if (!this.ctx || this.muted) return null;
    return this.ctx;
  }

  /** A second of white noise, reused for every paper sound. */
  private noiseBuf(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return buf;
  }

  /**
   * Filtered noise burst. Paper is broadband noise shaped by a sweeping
   * bandpass — the sweep is what separates a "flip" from a "tear".
   */
  private paper(dur: number, f0: number, f1: number, gain: number, q = 1.2): void {
    const ctx = this.ac();
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf(ctx);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    const now = ctx.currentTime;
    bp.frequency.setValueAtTime(f0, now);
    bp.frequency.exponentialRampToValueAtTime(Math.max(60, f1), now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + dur * 0.14);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  pageFlip(): void { this.paper(0.19, 2600, 700, 0.16, 0.9); }
  rip(): void {
    this.paper(0.34, 1100, 4200, 0.3, 0.7);
    this.paper(0.16, 340, 180, 0.14, 1.4);
  }
  /**
   * A page that will not tear. This is a MUFFLED THUD, not an error beep — the
   * fiction is paper refusing to give, and a square-wave buzz read as a system
   * error rather than a physical resistance.
   */
  deny(): void {
    this.paper(0.13, 420, 150, 0.10, 1.8);
    const ctx = this.ac();
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    const now = ctx.currentTime;
    o.type = 'sine';
    o.frequency.setValueAtTime(120, now);
    o.frequency.exponentialRampToValueAtTime(74, now + 0.11);
    g.gain.setValueAtTime(0.055, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    o.connect(g).connect(ctx.destination);
    o.start(now); o.stop(now + 0.15);
  }

  /** A bell-ish arcane shimmer — stacked detuned sines with a fast decay. */
  shimmer(freq = 880): void {
    const ctx = this.ac();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [mult, gain, delay] of [[1, 0.06, 0], [2.01, 0.035, 0.02], [3.02, 0.02, 0.05]] as const) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq * mult;
      g.gain.setValueAtTime(0, now + delay);
      g.gain.linearRampToValueAtTime(gain, now + delay + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.7);
      o.connect(g).connect(ctx.destination);
      o.start(now + delay); o.stop(now + delay + 0.75);
    }
  }

  /** The cast: a rising swell into a thump. */
  cast(colourFreq = 300): void {
    const ctx = this.ac();
    if (!ctx) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(colourFreq * 0.5, now);
    o.frequency.exponentialRampToValueAtTime(colourFreq * 2, now + 0.18);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(600, now);
    lp.frequency.exponentialRampToValueAtTime(4200, now + 0.18);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.13, now + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    o.connect(lp).connect(g).connect(ctx.destination);
    o.start(now); o.stop(now + 0.45);
  }

  impact(): void { this.paper(0.2, 260, 90, 0.22, 0.8); }

  /** The ripped pages converging: a rising shimmer stack into a soft thud. */
  merge(): void {
    this.shimmer(520);
    this.shimmer(1040);
    this.paper(0.22, 900, 200, 0.12, 1.0);
  }
}

export const sfx = new Sfx();
