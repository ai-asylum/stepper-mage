/**
 * Feel primitives, ported from ai-asylum/spellbook's core/juice.ts.
 * The Spring and the easings are what make the book's tabs, page lifts and
 * fan cards feel like objects rather than tweens.
 */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  stiffness: number;
  damping: number;

  constructor(target: number, stiffness = 170, damping = 18) {
    this.target = target;
    this.stiffness = stiffness;
    this.damping = damping;
    this.value = target;
  }

  update(dt: number): number {
    const f = -this.stiffness * (this.value - this.target);
    const d = -this.damping * this.velocity;
    this.velocity += (f + d) * dt;
    this.value += this.velocity * dt;
    return this.value;
  }

  /** Kick the spring (impulse) for wobble effects. */
  kick(v: number): void { this.velocity += v; }

  set(v: number): void { this.value = v; this.target = v; this.velocity = 0; }
}

export function haptic(pattern: number | number[] = 20): void {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number): number => t * t * t;
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
