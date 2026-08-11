/**
 * Circling stars over anything that is about to lose its turn.
 *
 * The game already SAID this twice and neither said it loudly enough. A denied body
 * carries a 34%-opacity colour tint, which in a torch-lit brown room is a body that
 * looks slightly wrong; and it throws a "SHOCKED · SKIPS" floater, which arrives on
 * the round the turn is already being lost. Neither answers the question the player
 * is actually asking, which is asked BEFORE they commit to anything: *which of these
 * three things is going to hit me this round?*
 *
 * So: the oldest icon in games, for the oldest reason. Stars orbiting a head is a
 * thing every player has already been taught to read, it needs no legend, and it is
 * legible at the back of a room where a tint is not. It sits above the sprite rather
 * than on it so a crowd of bodies still reads as individually stunned or not.
 *
 * Driven off `DENIAL_STATUSES` rather than off `shocked` alone, because the three of
 * them are mechanically one thing — frozen, shocked and staggered all cost a body its
 * round — and the player is asking about the consequence, not the cause. The tint
 * still says WHICH; the stars say THAT.
 */
import * as THREE from 'three';
import { Pix, rgba } from '../art/pixel';

/** Stars per body. Three reads as a ring; two reads as an accident. */
const STARS = 3;
/** Orbits per second. Slow enough to track, fast enough to be obviously animate. */
const SPIN = 1.1;
/** Radius of the ring, in world units. A tile is 1. */
const RADIUS = 0.26;
/** How far above the sprite's top the ring floats. */
const LIFT = 0.16;
/** The star's own size. */
const SIZE = 0.17;

/**
 * A five-pointed star, drawn as a filled polygon with a lighter core.
 *
 * Five points and not four: a four-point star is the mark this game already uses for
 * CELESTIAL STARS, on the altar cards and the HUD counter, and that is a currency.
 * Two meanings for one silhouette is exactly the kind of collision the Blizzard
 * rename existed to fix.
 */
function starPix(n: number): Pix {
  const p = new Pix(n, n);
  const c = (n - 1) / 2;
  const outer = c * 0.94, inner = outer * 0.42;
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    // -90° so a point sits at the top; a star resting on a flat edge reads as a blob
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    pts.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
  }
  p.poly(pts, rgba(255, 226, 120));
  // A hot core, so the shape survives being scaled down to a dozen texels on screen.
  p.ellipse(c, c, Math.max(1, n * 0.13), Math.max(1, n * 0.13), rgba(255, 250, 214));
  // The dark rim every effect in this game wears: the one value the brown room
  // never produces, and the only reason yellow stays legible against torchlight.
  p.outline(rgba(74, 48, 14), false, true);
  return p;
}

export class StunView {
  readonly group = new THREE.Group();
  private tex: THREE.Texture;
  private geo = new THREE.PlaneGeometry(SIZE, SIZE);
  private pool: THREE.Mesh[] = [];
  private live = 0;
  private t = 0;

  constructor() {
    this.tex = starPix(16).toTexture();
  }

  private take(): THREE.Mesh {
    const existing = this.pool[this.live];
    this.live++;
    if (existing) { existing.visible = true; return existing; }
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, fog: false,
      // No depth WRITE but keep the test: the stars should be hidden by a wall
      // between you and the body, and must not punch a hole in each other.
      depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.pool.push(mesh);
    return mesh;
  }

  /**
   * Place a ring over every body in `at`, and spin them.
   *
   * Takes positions rather than entities so it owes nothing to `Floor` — and takes
   * them fresh every frame because a stunned body can still be SHOVED, and a ring
   * that lagged a tile behind the thing it belongs to is worse than no ring.
   *
   * The ring is tilted rather than flat, so from a standing camera it reads as an
   * orbit around the head instead of as three stars sliding left and right. Each star
   * is then billboarded on top of that, which is what keeps the star itself facing you
   * while the RING keeps its shape.
   */
  update(dt: number, at: Iterable<{ x: number; y: number; top: number }>, camQuat: THREE.Quaternion): void {
    this.t += dt;
    this.live = 0;
    for (const b of at) {
      for (let i = 0; i < STARS; i++) {
        const a = this.t * SPIN * Math.PI * 2 + (i / STARS) * Math.PI * 2;
        const m = this.take();
        m.position.set(
          b.x + Math.cos(a) * RADIUS,
          // The vertical wobble is what sells the tilt: a star at the back of the
          // orbit rides a little higher than one at the front.
          b.top + LIFT + Math.sin(a) * 0.05,
          b.y + Math.sin(a) * RADIUS * 0.45,
        );
        m.quaternion.copy(camQuat);
        // Fade the far half of the orbit, so the ring has a front and a back rather
        // than three stars of equal weight sliding through each other.
        const front = 0.62 + 0.38 * (0.5 - Math.sin(a) * 0.5);
        (m.material as THREE.MeshBasicMaterial).opacity = front;
      }
    }
    for (let i = this.live; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  dispose(): void {
    for (const m of this.pool) (m.material as THREE.MeshBasicMaterial).dispose();
    this.geo.dispose();
    this.tex.dispose();
    this.group.clear();
    this.pool.length = 0;
  }
}
