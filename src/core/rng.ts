/**
 * Deterministic RNG. Every piece of procedural art and every dungeon layout is
 * generated from a seed, so a run is reproducible from its seed alone — which
 * makes art iteration and bug repro sane (see docs/architecture.md).
 *
 * mulberry32: tiny, fast, good enough distribution for art + layout.
 */
export class Rng {
  private s: number;

  constructor(seed: number | string = 1) {
    this.s = typeof seed === 'string' ? Rng.hash(seed) : seed >>> 0;
    if (this.s === 0) this.s = 0x9e3779b9;
  }

  /** FNV-1a-ish string hash so seeds can be readable ("floor-2-crypt"). */
  static hash(str: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** [0,1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min,max) float */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** [min,max] integer */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** true with probability p */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Fisher-Yates, in place, returns the same array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Pick `n` distinct entries (or as many as exist). */
  sample<T>(arr: readonly T[], n: number): T[] {
    return this.shuffle(arr.slice()).slice(0, Math.min(n, arr.length));
  }

  /** Weighted pick. `weights[i]` pairs with `arr[i]`; weights need not sum to 1. */
  weighted<T>(arr: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < arr.length; i++) {
      r -= weights[i];
      if (r <= 0) return arr[i];
    }
    return arr[arr.length - 1];
  }

  /** A fresh independent stream, so one system's draws never shift another's. */
  fork(tag: string): Rng {
    return new Rng((this.s ^ Rng.hash(tag)) >>> 0);
  }
}

/** Shared 2D value noise on a seeded lattice — the base for stone grain. */
export class Noise2 {
  private p: Uint8Array;

  constructor(seed: number | string = 1) {
    const rng = new Rng(seed);
    const p = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    this.p = p;
  }

  private grad(ix: number, iy: number): number {
    return this.p[(this.p[ix & 255] + (iy & 255)) & 511] / 255;
  }

  /** Smooth value noise in [0,1]. */
  at(x: number, y: number): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    // quintic smoothstep — no visible lattice creases
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = this.grad(ix, iy), b = this.grad(ix + 1, iy);
    const c = this.grad(ix, iy + 1), d = this.grad(ix + 1, iy + 1);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }

  /** Fractal sum — `oct` octaves at half amplitude / double frequency. */
  fbm(x: number, y: number, oct = 4, gain = 0.5): number {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let i = 0; i < oct; i++) {
      sum += this.at(x * f, y * f) * amp;
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }

  /** Ridged variant — veins, cracks, lightning-ish filaments. */
  ridge(x: number, y: number, oct = 4): number {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let i = 0; i < oct; i++) {
      const n = 1 - Math.abs(this.at(x * f, y * f) * 2 - 1);
      sum += n * n * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }

  /** Worley/cellular F1 distance in [0,1] — cobble, scales, cracked mud. */
  cell(x: number, y: number): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    let best = 8;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = ix + ox, cy = iy + oy;
        const jx = this.grad(cx, cy), jy = this.grad(cx + 71, cy + 131);
        const dx = cx + jx - x, dy = cy + jy - y;
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
    }
    return Math.min(1, Math.sqrt(best));
  }
}
