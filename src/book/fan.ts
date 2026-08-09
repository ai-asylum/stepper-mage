/**
 * Ripped pages float in front of the player with a golden shiny outline,
 * fanning like a hand of cards (up to 3). On cast they converge and merge
 * in a flash of gold before the spell fires.
 */
import * as THREE from 'three';
import { camera, onUpdate } from './bridge';
import { pageMaterial, pageGeometry, type PageMaterial, PAGE_W } from './pageMaterial';
import { pageArt, blankPageTexture } from './pageTexture';
import { type SpellDef, SPELLS } from '../spells/pages';
import { pageGlowMat } from '../style/fx';
import { goldenSparkle, flashSphere, shockRing } from './bridge';
import { easeOutBack, easeInCubic, clamp01, lerp, haptic } from '../core/juice';
import { shake, hitstop } from './bridge';
import { sfx } from './bridge';

// Local tuning. Upstream fans the torn pages at eye level (y ~0.005) because its
// action happens far down a lane. Here the target sits mid-screen, so the hand is
// dropped to just above the book — the pages must never cover what you are
// aiming at.
// Local tuning. The hand has to live in the gap BETWEEN the cast bar and the
// book's top edge: upstream fans at eye level (covers the target), and dropping
// it to the book's height buries it in the open pages.
const FAN_CENTER = new THREE.Vector3(0, -0.026, -0.38);
const MERGE_POINT = new THREE.Vector3(0, -0.022, -0.38);
const FLY_DUR = 0.55;
/** floating pages shrink to card size so they don't dominate the screen */
const FAN_SCALE = 0.26;

interface FloatPage {
  spell: SpellDef;
  group: THREE.Group;
  mat: PageMaterial;
  glow: THREE.Mesh;
  born: number; // animation clock
  fromPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  phase: number;
}

export class Fan {
  pages: FloatPage[] = [];
  private merging = false;
  private mergeT = 0;
  private onMerged: (() => void) | null = null;

  get count(): number {
    return this.pages.length;
  }
  /** This game's spell ids for the torn pages, in tear order. */
  get gameIds(): string[] {
    return this.pages.map((p) => p.spell.gameId);
  }

  get spellIds(): string[] {
    return this.pages.map((p) => p.spell.id);
  }
  get busy(): boolean {
    return this.merging;
  }

  constructor() {
    onUpdate((dt, t) => this.update(dt, t));
  }

  /** Add a ripped page. World transform comes from the book's page. */
  add(spell: SpellDef, worldPos: THREE.Vector3, worldQuat: THREE.Quaternion) {
    const art = pageArt(spell, SPELLS.indexOf(spell));
    const mat = pageMaterial(art.torn, blankPageTexture());
    mat.uniforms.uProgress.value = 0.03;
    mat.uniforms.uFlutter.value = 1;

    const group = new THREE.Group();
    const mesh = new THREE.Mesh(pageGeometry(18), mat);
    mesh.position.x = -PAGE_W / 2; // center the page on its group
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W * 1.18, PAGE_W * 1.18 * 1.35), pageGlowMat(0xffc23e, 0.8));
    glow.position.z = -0.004;
    group.add(glow, mesh);
    group.renderOrder = 3;

    // convert world transform → camera-local so the page stays screen-fixed
    camera.worldToLocal(worldPos);
    const camQuatInv = camera.getWorldQuaternion(new THREE.Quaternion()).invert();
    worldQuat.premultiply(camQuatInv);

    group.position.copy(worldPos);
    group.quaternion.copy(worldQuat);
    camera.add(group);

    this.pages.push({
      spell,
      group,
      mat,
      glow,
      born: 0,
      fromPos: worldPos.clone(),
      fromQuat: worldQuat.clone(),
      phase: Math.random() * 10,
    });
    sfx.shimmer(520 + this.pages.length * 90);

    const wp = new THREE.Vector3();
    group.getWorldPosition(wp);
    goldenSparkle(wp, 10, 0.14, 0.028);
  }

  /**
   * How many slots the fan lays out, whether or not they are filled.
   *
   * Set from hand size. The fan used to lay out against the number of cards HELD, so
   * one card of two sat dead centre and the second appeared by pushing the first
   * aside. Slots are fixed places now and cards fill them left to right, which is
   * the only way an empty slot can be drawn in the position its card will occupy.
   */
  capacity = 1;

  /** Fan slot transform for page i of n. PUBLIC so the empty slots share it. */
  slot(i: number, n: number): { pos: THREE.Vector3; rotZ: number } {
    const c = (n - 1) / 2;
    const off = i - c;
    return {
      pos: new THREE.Vector3(
        FAN_CENTER.x + off * 0.075,
        FAN_CENTER.y - Math.abs(off) * 0.01,
        FAN_CENTER.z + i * 0.006
      ),
      rotZ: -off * 0.18,
    };
  }

  /** Converge + merge + golden burst, then hand off to the caster. */
  mergeAndCast(onMerged: () => void) {
    if (this.pages.length === 0 || this.merging) return;
    this.merging = true;
    this.mergeT = 0;
    this.onMerged = onMerged;
    sfx.merge();
  }

  /**
   * Take ONE card out of the hand, by index. Returns the spell it held.
   *
   * Local addition on top of upstream, which only has all-or-nothing `clear()`.
   * This game lets the player cancel a single component, so a per-card removal is
   * needed and there is no upstream call to route it through. Disposal is exactly
   * `clear()`'s, one card's worth; the surviving cards need no fixing up because
   * `slot(i, n)` derives every position from the index and the count, so `update`
   * re-lays the fan out on the next frame.
   */
  removeAt(i: number): SpellDef | null {
    if (this.merging || i < 0 || i >= this.pages.length) return null;
    const [p] = this.pages.splice(i, 1);
    camera.remove(p.group);
    p.mat.dispose();
    return p.spell;
  }

  /** Return all pages to the book (refund flow). */
  clear() {
    for (const p of this.pages) {
      camera.remove(p.group);
      p.mat.dispose();
    }
    this.pages = [];
  }

  private update(dt: number, t: number) {
    const n = this.pages.length;

    if (this.merging) {
      this.mergeT += dt;
      const k = clamp01(this.mergeT / 0.38);
      const e = easeInCubic(k);
      for (const p of this.pages) {
        p.group.position.lerp(MERGE_POINT, e * 0.35 + dt * 10 * e);
        p.group.scale.setScalar(FAN_SCALE * lerp(1, 0.4, e));
        p.group.rotation.z += dt * e * 14;
        p.mat.uniforms.uGlow.value = e * 1.4;
        (p.glow.material as THREE.ShaderMaterial).uniforms.uIntensity.value = 0.8 + e * 0.7;
      }
      if (k >= 1) {
        // the burst (world sizes are tiny — this sits ~0.4m from the eye)
        const wp = MERGE_POINT.clone();
        camera.localToWorld(wp);
        flashSphere(wp, 0xfff2cc, 0.045, 0.14);
        flashSphere(wp, 0xffc23e, 0.075, 0.22);
        shockRing(wp, 0xffe9a0, 0.16, 0.3);
        goldenSparkle(wp, 24, 0.12, 0.02);
        shake(0.15);
        hitstop(0.05, 0.85);
        haptic([10, 20, 30]);
        this.clear();
        this.merging = false;
        const cb = this.onMerged;
        this.onMerged = null;
        cb?.();
      }
      return;
    }

    for (let i = 0; i < n; i++) {
      const p = this.pages[i];
      p.born = Math.min(FLY_DUR, p.born + dt);
      const k = clamp01(p.born / FLY_DUR);
      const e = easeOutBack(k);
      const s = this.slot(i, Math.max(this.capacity, n));
      // hover life once landed
      const hoverY = Math.sin(t * 1.9 + p.phase) * 0.004 * k;
      const hoverR = Math.sin(t * 1.4 + p.phase * 2) * 0.03 * k;
      p.group.position.lerpVectors(p.fromPos, s.pos, e);
      p.group.position.y += hoverY;
      p.group.scale.setScalar(lerp(1, FAN_SCALE, e));
      const targetQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.06, 0, s.rotZ + hoverR));
      p.group.quaternion.slerpQuaternions(p.fromQuat, targetQ, e);
      p.mat.uniforms.uGlow.value = lerp(0.7, 0.22 + 0.1 * Math.sin(t * 3 + p.phase), k);
      // sparkle drip
      if (Math.random() > 0.975) {
        const wp = new THREE.Vector3();
        p.group.getWorldPosition(wp);
        goldenSparkle(wp, 1, 0.08, 0.02);
      }
    }
  }
}
