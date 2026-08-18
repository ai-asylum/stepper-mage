/**
 * The grimoire. Camera-attached, bottom of screen, fully procedural.
 * Pages flip with a paper-curl shader and follow the finger; swiping up
 * tears the current page out (with resistance, tension wobble, and a
 * golden regrow afterwards).
 */
import * as THREE from 'three';
import { camera, onUpdate, projectToScreen } from './bridge';
import { book as bookPal, chapters as chapterPal } from '../style/palette';
import { mergeColored, box, cyl, shellGeometry, darken } from '../style/toon';
import { gradientMap } from '../style/toon';
import { pageMaterial, pageGeometry, type PageMaterial, PAGE_W, PAGE_H } from './pageMaterial';
import { pageArt, blankPageTexture } from './pageTexture';
// LOCAL: the body's pixel-art atlas. Upstream shades these parts with flat
// vertex colours; see the file header for why that had to change here.
import { coverAtlas, uvNormalise, uvRegion, UNTINTED, type CoverRegion } from './coverTexture';
import { SPELLS, CHAPTERS, type SpellDef, type SpellSchool } from '../spells/pages';
import { sfx } from './bridge';
import { Spring, haptic, easeOutCubic, easeOutBack, clamp01, lerp } from '../core/juice';
import { goldenSparkle } from './bridge';

// Local tuning: pushed back and down from upstream's (0, -0.245, -0.52) so the
// dungeon ahead — and whatever you are targeting — stays visible above it.
const BASE_POS = new THREE.Vector3(0, -0.275, -0.60);
const BASE_TILT = -0.62;
const RIP_THRESHOLD = 78; // px of upward drag to tear
const FLIP_DIST = 230; // px of horizontal drag for a full flip

interface FlipAnim {
  p0: number;
  p1: number;
  t: number;
  dur: number;
}

interface RibbonTab {
  school: SpellSchool;
  mesh: THREE.Mesh;
  baseX: number;
  baseRotZ: number;
  /** 0 = tucked into the stack, 1 = pulled out (the open chapter) */
  extend: Spring;
}

export class Book {
  group = new THREE.Group();
  index = 0;
  /** game hooks */
  canRip: (spell: SpellDef) => boolean = () => true;
  /** True for a spell the player has not learned — drawn drained and un-tearable. */
  isSealed: (spell: SpellDef) => boolean = () => false;
  onRip: (spell: SpellDef, worldPos: THREE.Vector3, worldQuat: THREE.Quaternion) => void = () => {};
  onFlip: (spell: SpellDef) => void = () => {};

  private leftMat: PageMaterial;
  private rightMat: PageMaterial;
  private sheetMat: PageMaterial;
  private sheet: THREE.Mesh;
  private rightPage: THREE.Mesh;
  private flipDir: 1 | -1 = 1;
  private flipActive = false;
  private flipDragging = false;
  private flipProgress = 0;
  private flipAnim: FlipAnim | null = null;
  private flipSounded = false;

  private ripDragging = false;
  private ripLift = 0; // 0..1 tension
  private ripReturn = 0; // spring-back animation
  private regrowT = -1; // -1 idle; 0..1 running

  private introT = -1;
  private introFlips = 0;

  /**
   * Has the book been HANDED to the player yet?
   *
   * False from construction until `playIntro`, and the group is genuinely invisible
   * for that whole stretch rather than merely closed. The run now begins with an
   * empty grimoire and one question — which page do you carry — so for those few
   * seconds there is no book to show: `setBookPages` falls back to a single page
   * when the player holds none (`pages.ts`), and rising into frame to display a
   * Flame nobody has chosen yet would answer the question before it was asked.
   */
  private revealedT = false;

  /** Has the book been handed over yet? Readers gate page-shaped UI on it. */
  get revealed(): boolean {
    return this.revealedT;
  }

  /**
   * A one-page book does not turn.
   *
   * Every flip in a book of one lands back on the page it left, so the curl shader
   * runs, the paper sounds, and nothing changes — which reads as a broken gesture
   * rather than as a book with one page in it. Refused at the three doors a flip can
   * come through (finger, chapter tab, intro cascade) instead of inside
   * `prepareFlip`, so a refused flip never starts and never has to be unwound.
   */
  private get canFlip(): boolean {
    return SPELLS.length > 1;
  }

  /**
   * Closed/open. Local addition: a grimoire held up permanently covers the floor,
   * and in a grid crawler you need the floor to know which tile you are on. Closing
   * drops the book out of frame entirely rather than shrinking it, so nothing is
   * left hovering in the sightline.
   */
  closed = false;
  private closeT = 0;

  private ribbons: RibbonTab[] = [];
  /** chapter-jump destination; the update loop chains quick flips toward it */
  private flipTarget = -1;

  get busy(): boolean {
    return this.flipActive || this.introT >= 0;
  }

  /**
   * Screen Y (CSS px) of the book's top edge, or Infinity when it is closed.
   *
   * The gesture boundary MUST come from the book's real projected geometry. A
   * guessed fraction of the screen left a dead band above the cover where swipes
   * meant to move the player tore pages instead.
   */
  screenTop(): number {
    if (this.closed && this.closeT > 0.5) return Infinity;
    const p = new THREE.Vector3(0, PAGE_H / 2 + 0.012, 0.014);
    this.group.localToWorld(p);
    const out = { x: 0, y: 0 };
    return projectToScreen(p.x, p.y, p.z, out) ? out.y : Infinity;
  }

  /** True once the book has glided far enough down to ignore page gestures. */
  get outOfReach(): boolean {
    return this.closed && this.closeT > 0.35;
  }
  get currentSpell(): SpellDef {
    return SPELLS[this.index];
  }

  constructor() {
    this.buildBody();
    this.buildRibbons();

    const leftGeo = pageGeometry(22);
    const rightGeo = pageGeometry(22);
    const sheetGeo = pageGeometry(30);

    // Somewhere valid, to have art to build the materials from. The index the
    // player actually opens on is `playIntro`'s, set once the book has its real
    // pages in it — at construction time the run has not chosen one yet.
    this.index = (SPELLS.length - 2 + SPELLS.length) % SPELLS.length;
    const art0 = pageArt(SPELLS[this.index], this.index);
    this.leftMat = pageMaterial(art0.action, art0.lore);
    this.leftMat.uniforms.uProgress.value = 0.975;
    this.rightMat = pageMaterial(art0.action, blankPageTexture());
    this.rightMat.uniforms.uProgress.value = 0.025;
    this.sheetMat = pageMaterial(art0.action, art0.lore);

    const left = new THREE.Mesh(leftGeo, this.leftMat);
    this.rightPage = new THREE.Mesh(rightGeo, this.rightMat);
    this.sheet = new THREE.Mesh(sheetGeo, this.sheetMat);
    left.position.z = 0.0125;
    this.rightPage.position.z = 0.0125;
    this.sheet.position.z = 0.0135;
    this.sheet.visible = false;
    left.renderOrder = 1;
    this.rightPage.renderOrder = 1;
    this.sheet.renderOrder = 2;
    this.group.add(left, this.rightPage, this.sheet);

    this.group.position.copy(BASE_POS);
    this.group.rotation.x = BASE_TILT;
    // Off screen until `playIntro`. See `revealed`.
    this.group.visible = false;
    camera.add(this.group);

    onUpdate((dt, t) => this.update(dt, t));
  }

  private buildBody() {
    const cw = 0.178;
    const ch = 0.232;
    const ct = 0.012;
    const parts: { geo: THREE.BufferGeometry; color: number }[] = [];
    /**
     * LOCAL: every part is the primitive upstream builds, with its 0..1 UVs
     * pointed at a region of one pixel-art atlas (`coverTexture.ts`) instead of
     * carrying a flat vertex colour. Geometry, placement and the merge are
     * unchanged — this is a texture change.
     */
    const skin = (geo: THREE.BufferGeometry, region: CoverRegion) => ({
      geo: uvRegion(geo, region), color: UNTINTED,
    });
    for (const side of [1, -1]) {
      const cx = side * (cw / 2 + 0.001);
      // leather board
      parts.push(skin(box(cw, ch, ct, cx, 0, -ct / 2 - 0.0005), 'board'));
      // gold corner caps on the outer corners
      const ox = side * (cw - 0.012);
      for (const sy of [1, -1]) {
        parts.push(skin(
          box(0.024, 0.024, ct + 0.002, side * 0.001 + ox, sy * (ch / 2 - 0.012), -ct / 2 - 0.0005),
          'gold',
        ));
      }
      // gold edge line along the outer edge
      parts.push(skin(box(0.006, ch - 0.02, ct + 0.001, side * (cw - 0.004), 0, -ct / 2 - 0.0005), 'goldDark'));
      // page stack
      const stackN = 3;
      for (let i = 0; i < stackN; i++) {
        const w = PAGE_W - 0.002 - i * 0.004;
        parts.push(skin(
          box(w, PAGE_H - i * 0.006, 0.0038, side * (w / 2 + 0.0015), 0, 0.002 + i * 0.0038),
          i === stackN - 1 ? 'pageFace' : 'pageEdge',
        ));
      }
    }
    // spine roll (CylinderGeometry is already y-aligned = along the spine)
    parts.push(skin(cyl(0.016, 0.016, ch, 10, 0, 0, -ct / 2), 'spine'));
    // spine gold bands
    for (const sy of [0.08, -0.08]) {
      parts.push(skin(cyl(0.0175, 0.0175, 0.014, 10, 0, sy, -ct / 2), 'gold'));
    }
    // bookmark ribbon
    parts.push(skin(
      box(0.02, 0.075, 0.0024, 0.012, -ch / 2 - 0.026, -0.002, new THREE.Euler(0, 0, 0.1)),
      'ribbon',
    ));

    const geo = mergeColored(parts);
    const mat = new THREE.MeshToonMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: coverAtlas(),
      gradientMap: gradientMap([0.5, 0.78, 1]),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    const outline = new THREE.Mesh(
      shellGeometry(geo, 0.0035),
      new THREE.MeshBasicMaterial({ color: darken(bookPal.leather, 0.42), side: THREE.BackSide })
    );
    outline.raycast = () => {};
    mesh.add(outline);
    this.group.add(mesh);
  }

  /**
   * Chapter ribbon tabs: cloth swallowtail markers bound into the page stack,
   * poking up past the book's TOP edge (the right board edge sits offscreen
   * in portrait) — one per chapter, in its school color. The open chapter's
   * tab pulls out further. Tap one to leaf to that chapter.
   */
  /**
   * Chapter tabs are OFF.
   *
   * They competed with the CAST pill for the same pixels and their hit boxes
   * leaked taps through it. A page-count threshold was the wrong fix — it just
   * made them reappear the moment you picked up spells. The geometry is kept
   * intact so this can become a star unlock later; until then it stays a hard
   * off, not a condition.
   */
  private static ribbonsEnabled = false;

  private buildRibbons() {
    // clear any existing tabs — this is re-run when the page list changes
    for (const r of this.ribbons) this.group.remove(r.mesh);
    this.ribbons.length = 0;
    if (!Book.ribbonsEnabled) return;

    const len = 0.06; // tab length (mostly tucked under the stack)
    const h = 0.03; // tab width
    const shape = new THREE.Shape();
    shape.moveTo(0, -h / 2);
    shape.lineTo(len, -h / 2);
    shape.lineTo(len - 0.012, 0); // swallowtail notch
    shape.lineTo(len, h / 2);
    shape.lineTo(0, h / 2);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.0034, bevelEnabled: false });
    // LOCAL: the woven-cloth region, which is greyscale so the school tint below
    // still does the colouring (`coverTexture.ts`).
    uvRegion(uvNormalise(geo, 0, -h / 2, len, h), 'cloth');

    CHAPTERS.forEach((chapter, i) => {
      const color = chapterPal[chapter.school];
      const mat = new THREE.MeshToonMaterial({
        color, map: coverAtlas(), gradientMap: gradientMap([0.5, 0.78, 1]),
      });
      const mesh = new THREE.Mesh(geo, mat);
      const outline = new THREE.Mesh(
        shellGeometry(geo, 0.0016),
        new THREE.MeshBasicMaterial({ color: darken(color, 0.42), side: THREE.BackSide })
      );
      outline.raycast = () => {};
      mesh.add(outline);
      // a paler stitched mid-band so the tabs read as sewn cloth
      const band = new THREE.Mesh(
        uvRegion(new THREE.BoxGeometry(0.007, h * 0.86, 0.0046), 'cloth'),
        new THREE.MeshToonMaterial({
          color: darken(color, 0.72), map: coverAtlas(), gradientMap: gradientMap([0.5, 0.78, 1]),
        })
      );
      band.position.set(len - 0.022, 0, 0.0017);
      mesh.add(band);

      // point the tab up (+y): tucked into the stack, peeking past the top
      const baseY = PAGE_H / 2 - len + 0.032;
      const baseRotZ = Math.PI / 2 + (-0.04 + i * 0.03); // hand-placed lean
      mesh.position.set(-0.105 + i * 0.105, baseY, 0.0065);
      mesh.rotation.z = baseRotZ;
      this.group.add(mesh);
      this.ribbons.push({ school: chapter.school, mesh, baseX: baseY, baseRotZ, extend: new Spring(0, 90, 10) });
    });
  }

  // ------------------------------------------------------------ chapters
  /** Which chapter ribbon (if any) sits under a screen tap, in CSS px. */
  ribbonAt(px: number, py: number): SpellSchool | null {
    const tip = new THREE.Vector3();
    const out = { x: 0, y: 0 };
    for (const r of this.ribbons) {
      tip.set(0.05, 0, 0.0017); // near the swallowtail, in tab-local space
      r.mesh.localToWorld(tip);
      if (!projectToScreen(tip.x, tip.y, tip.z, out)) continue;
      // Tightened from upstream's 34x30: these tabs sit directly under the CAST
      // pill here, and a generous box meant taps on the pill leaked through to a
      // chapter jump.
      if (Math.abs(out.x - px) < 20 && Math.abs(out.y - py) < 18) return r.school;
    }
    return null;
  }

  /** Leaf to a chapter's first page with a quick cascade of flips. */
  goToChapter(school: SpellSchool) {
    const chapter = CHAPTERS.find((c) => c.school === school);
    if (!chapter || this.introT >= 0) return;
    const ribbon = this.ribbons.find((r) => r.school === school);
    if (ribbon) {
      ribbon.extend.kick(6);
      const p = new THREE.Vector3(0.05, 0, 0);
      ribbon.mesh.localToWorld(p);
      goldenSparkle(p, 8, 0.05, 0.014);
    }
    haptic(8);
    // Already there, or nowhere else to be: the tab just tugs.
    if ((chapter.firstIndex === this.index && !this.flipActive) || !this.canFlip) {
      sfx.pageFlip();
      return;
    }
    sfx.shimmer(640);
    this.flipTarget = chapter.firstIndex;
  }

  /** Chain quick flips toward a chapter-jump target (runs from update). */
  private stepChapterJump() {
    if (this.flipTarget < 0 || this.flipActive || this.introT >= 0) return;
    if (this.flipTarget === this.index) {
      this.flipTarget = -1;
      return;
    }
    const n = SPELLS.length;
    const fwd = (this.flipTarget - this.index + n) % n;
    const dir: 1 | -1 = fwd <= n - fwd ? 1 : -1;
    this.prepareFlip(dir);
    // cascade flips run brisker than a finger flip
    this.flipDragging = false;
    this.flipAnim = { p0: this.flipProgress, p1: dir === 1 ? 1 : 0, t: 0, dur: 0.17 };
  }

  // ------------------------------------------------------------ helpers
  private spellAt(offset: number): SpellDef {
    const n = SPELLS.length;
    return SPELLS[((this.index + offset) % n + n) % n];
  }

  private artOf(s: SpellDef) {
    return pageArt(s, SPELLS.indexOf(s));
  }

  /** Prepare the flip sheet + underlying pages for a flip in `dir`. */
  private prepareFlip(dir: 1 | -1) {
    const cur = this.currentSpell;
    if (dir === 1) {
      const next = this.spellAt(1);
      this.sheetMat.uniforms.uMapFront.value = this.artOf(cur).action;
      this.sheetMat.uniforms.uMapBack.value = this.artOf(next).lore;
      this.rightMat.uniforms.uMapFront.value = this.artOf(next).action;
      this.flipProgress = 0;
    } else {
      const prev = this.spellAt(-1);
      this.sheetMat.uniforms.uMapFront.value = this.artOf(prev).action;
      this.sheetMat.uniforms.uMapBack.value = this.artOf(cur).lore;
      this.leftMat.uniforms.uMapBack.value = this.artOf(prev).lore;
      this.flipProgress = 1;
    }
    this.flipDir = dir;
    this.flipActive = true;
    this.flipSounded = false;
    this.sheet.visible = true;
    // ripped page regrow finishes instantly if a flip starts
    if (this.regrowT >= 0) {
      this.regrowT = -1;
      this.rightMat.uniforms.uReveal.value = 1.01;
    }
  }

  private finishFlip() {
    if (this.flipDir === 1) {
      const next = this.spellAt(1);
      this.leftMat.uniforms.uMapBack.value = this.artOf(next).lore;
      this.index = SPELLS.indexOf(next);
    } else {
      const prev = this.spellAt(-1);
      this.rightMat.uniforms.uMapFront.value = this.artOf(prev).action;
      this.index = SPELLS.indexOf(prev);
    }
    this.sheet.visible = false;
    this.flipActive = false;
    this.flipAnim = null;
    this.onFlip(this.currentSpell);
  }

  private cancelFlip() {
    if (this.flipDir === 1) {
      this.rightMat.uniforms.uMapFront.value = this.artOf(this.currentSpell).action;
    } else {
      this.leftMat.uniforms.uMapBack.value = this.artOf(this.currentSpell).lore;
    }
    this.sheet.visible = false;
    this.flipActive = false;
    this.flipAnim = null;
  }

  private animateFlipTo(target: number) {
    this.flipDragging = false;
    const dist = Math.abs(target - this.flipProgress);
    this.flipAnim = { p0: this.flipProgress, p1: target, t: 0, dur: 0.1 + 0.24 * dist };
  }

  // ------------------------------------------------------------ input API
  /** Horizontal drag in px. Starts/updates a finger-following flip. */
  flipDrag(dx: number) {
    if (this.introT >= 0 || this.ripDragging || !this.canFlip) return;
    this.flipTarget = -1; // a finger on the page outranks a chapter jump
    if (!this.flipActive) {
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      this.prepareFlip(dir);
      this.flipDragging = true;
    }
    if (!this.flipDragging) return;
    if (this.flipDir === 1) this.flipProgress = clamp01(-dx / FLIP_DIST);
    else this.flipProgress = 1 - clamp01(dx / FLIP_DIST);
  }

  /**
   * Vertical (upward) drag in px. Lifts the page with tension.
   *
   * Return values are deliberately distinct, because they mean different things
   * to the player: `refused` is "you may not tear this page" (unlearned, or you
   * cannot afford it) and deserves feedback; `blocked` is merely "not this
   * instant" (mid-flip, page regrowing) and must stay silent, or the book scolds
   * you for its own animations.
   */
  ripDrag(dy: number): 'torn' | 'held' | 'blocked' | 'refused' {
    if (this.introT >= 0 || this.flipActive) return 'blocked';
    if (this.regrowT >= 0 && this.regrowT < 0.65) return 'blocked'; // page still regrowing
    this.ripDragging = true;
    const pull = Math.max(0, -dy);
    this.ripLift = clamp01(pull / RIP_THRESHOLD);
    if (pull >= RIP_THRESHOLD) {
      const spell = this.currentSpell;
      if (!this.canRip(spell)) {
        this.ripDragging = false;
        this.ripReturn = 1.4; // hard deny snap
        return 'refused';
      }
      this.tear(spell);
      return 'torn';
    }
    return 'held';
  }

  private tear(spell: SpellDef) {
    this.ripDragging = false;
    this.ripLift = 0;
    this.ripReturn = 0;
    this.rightPage.position.set(0, 0, 0.0125);
    this.rightPage.rotation.set(0, 0, 0);

    // hand the world transform of the page to the fan
    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    this.rightPage.getWorldPosition(wp);
    this.rightPage.getWorldQuaternion(wq);

    sfx.rip();
    haptic([12, 30, 18]);
    // paper scraps burst from the spine
    const spineWorld = new THREE.Vector3(0, 0.02, 0.02);
    this.group.localToWorld(spineWorld);
    goldenSparkle(spineWorld, 14, 0.25, 0.03);

    // regrow: the magic book restores its page
    this.rightMat.uniforms.uReveal.value = 0;
    this.regrowT = 0;

    this.onRip(spell, wp, wq);
  }

  /** Pointer released. */
  dragEnd(vx: number) {
    if (this.flipDragging) {
      const p = this.flipProgress;
      let target: number;
      if (this.flipDir === 1) target = p > 0.42 || vx < -0.55 ? 1 : 0;
      else target = p < 0.58 || vx > 0.55 ? 0 : 1;
      this.animateFlipTo(target);
    }
    // always release any rip lift (a deny mid-drag clears ripDragging
    // but can leave the page held up)
    if (this.ripDragging || this.ripLift > 0) {
      this.ripDragging = false;
      this.ripReturn = Math.max(this.ripReturn, this.ripLift);
      this.ripLift = 0;
    }
  }

  /**
   * Re-sync after the player's page list changes (a new spell from an altar).
   * The page array is mutated in place, so the index has to be re-clamped and the
   * resting page textures reassigned or the book shows art for a page that moved.
   */
  refresh(): void {
    if (!SPELLS.length) return;
    this.index = Math.min(this.index, SPELLS.length - 1);
    this.buildRibbons();
    this.flipTarget = -1;
    this.flipActive = false;
    this.flipAnim = null;
    this.sheet.visible = false;
    const cur = this.artOf(this.currentSpell);
    this.rightMat.uniforms.uMapFront.value = cur.action;
    this.rightMat.uniforms.uProgress.value = 0.025;
    this.rightMat.uniforms.uReveal.value = 1.01;
    /**
     * THE LEFT PAGE IS THE CURRENT SPELL'S LORE, like it is everywhere else.
     *
     * A spread is ONE spell: its lore on the left and its action on the right.
     * `finishFlip`, `cancelFlip` and `tearAt` all hold that; this line alone reached
     * for `spellAt(-1)` and put the PREVIOUS spell's lore beside the current one's
     * action. And `refresh` is exactly what runs when the page list changes — so the
     * spread went wrong the moment a new spell was learnt, and stayed wrong until the
     * player happened to flip, which is what put it back.
     */
    this.leftMat.uniforms.uMapBack.value = this.artOf(this.currentSpell).lore;
    this.regrowT = -1;
  }

  /**
   * TEAR THE PAGE THAT IS OPEN, on a tap.
   *
   * The upward drag is the gesture the book teaches and it stays the primary one — the
   * page lifts with tension under the finger, which is what makes a tear feel like a
   * tear. But a drag is also the most expensive input in the game to perform one-handed
   * on a tall phone, and it is the input the player makes most often; a tap is the cheap
   * way to say the same thing, exactly as tapping an altar or a lever is.
   *
   * Same refusals as `ripDrag`, in the same three words, so a tap and a drag can never
   * disagree about whether a page may leave the book: `blocked` while the book is
   * animating (silent, it is the book's own business), `refused` when the page cannot be
   * torn (the caller explains why), `torn` when it left.
   */
  tapTear(): 'torn' | 'blocked' | 'refused' {
    if (this.busy || this.introT >= 0 || this.flipActive) return 'blocked';
    if (this.regrowT >= 0 && this.regrowT < 0.65) return 'blocked';
    const spell = this.currentSpell;
    if (!this.canRip(spell)) {
      this.ripReturn = 1.4;   // the same deny snap the drag gives
      return 'refused';
    }
    this.tear(spell);
    return 'torn';
  }

  /**
   * Tear a specific page outright, no drag. Local addition on top of upstream:
   * the keyboard shortcuts and the scripted playtests need to tear page N
   * without simulating a gesture.
   */
  tearAt(index: number): boolean {
    if (this.busy) return false;
    const n = SPELLS.length;
    const target = ((index % n) + n) % n;
    // Leafing to another page cancels a pending regrow, exactly as a real flip
    // does in prepareFlip — otherwise tearing a second page is blocked for a
    // second after the first tear.
    if (target !== this.index || this.regrowT >= 0) {
      this.regrowT = -1;
      this.rightMat.uniforms.uReveal.value = 1.01;
    }
    this.index = target;
    // resting pages must show the new index before we tear off it
    this.rightMat.uniforms.uMapFront.value = this.artOf(this.currentSpell).action;
    this.leftMat.uniforms.uMapBack.value = this.artOf(this.currentSpell).lore;
    const spell = this.currentSpell;
    if (!this.canRip(spell)) return false;
    this.tear(spell);
    return true;
  }

  /** Quick swipe without a meaningful drag. */
  swipe(dir: 1 | -1) {
    if (this.busy || !this.canFlip) return;
    this.flipTarget = -1;
    this.prepareFlip(dir);
    this.animateFlipTo(dir === 1 ? 1 : 0);
  }

  // ------------------------------------------------------------ intro
  /**
   * Rise into frame. Called once the player has a book worth showing — which is
   * now AFTER the mouth's page question, not at boot.
   */
  playIntro() {
    this.revealedT = true;
    this.introT = 0;
    /**
     * Two flips, or none. The cascade exists to leaf onto the opening page and it
     * needs somewhere to leaf FROM; a book holding the one page the player just
     * chose is already open at it, so the flips would be two turns back onto
     * themselves. `index` is set to match, because the constructor's "start two
     * pages early" only makes sense when there are two pages to start early from.
     */
    this.introFlips = this.canFlip ? 2 : 0;
    this.index = this.canFlip
      ? (SPELLS.length - 2 + SPELLS.length) % SPELLS.length
      : 0;
    this.refresh();
    this.group.position.y = BASE_POS.y - 0.5;
    this.group.rotation.x = BASE_TILT - 0.5;
  }

  // ------------------------------------------------------------ update
  private update(dt: number, t: number) {
    // Not handed over yet — no pose to hold and nothing to draw. See `revealed`.
    if (!this.revealedT) { this.group.visible = false; return; }
    /**
     * Back on the moment it IS handed over, and here rather than at the end of the
     * method, because the intro branch below returns early: leaving it to the
     * open/close glide meant the whole rise played invisible and the book popped
     * into frame already settled. The glide still owns hiding it again.
     */
    this.group.visible = true;

    // idle breathing
    const bobY = Math.sin(t * 1.5) * 0.0035;
    const bobR = Math.sin(t * 1.15) * 0.006;

    // intro: rise + settle + cascade flips
    if (this.introT >= 0) {
      this.introT += dt;
      const k = clamp01(this.introT / 0.9);
      const e = easeOutBack(k);
      this.group.position.y = lerp(BASE_POS.y - 0.5, BASE_POS.y, e) + bobY;
      this.group.rotation.x = lerp(BASE_TILT - 0.5, BASE_TILT, e);
      if (k >= 1 && this.introFlips > 0 && !this.flipActive) {
        this.introFlips--;
        this.prepareFlip(1);
        this.animateFlipTo(1);
      }
      if (k >= 1 && this.introFlips === 0 && !this.flipActive) {
        this.introT = -1;
        const p = new THREE.Vector3(0, 0, 0.04);
        this.group.localToWorld(p);
        goldenSparkle(p, 22, 0.3, 0.035);
        sfx.shimmer();
      }
      if (this.flipAnim) this.stepFlipAnim(dt);
      this.applyFlip();
      return;
    }

    // close/open glide
    const wantClosed = this.closed ? 1 : 0;
    const d = wantClosed - this.closeT;
    if (d !== 0) this.closeT += Math.sign(d) * Math.min(Math.abs(d), dt * 4.2);
    const drop = this.closeT * this.closeT * 0.62;

    // keep each visible page's sealed state current
    this.rightMat.uniforms.uSealed.value = this.isSealed(this.currentSpell) ? 1 : 0;
    // The same spell as the right page — see `refresh`. This asked the previous one,
    // so a sealed spell beside an unsealed one wore the wrong seal on half the spread.
    this.leftMat.uniforms.uSealed.value = this.isSealed(this.currentSpell) ? 1 : 0;

    this.group.position.y = BASE_POS.y + bobY - drop;
    this.group.rotation.x = BASE_TILT + this.closeT * 0.55;
    this.group.rotation.z = bobR * 0.4;
    this.group.visible = this.closeT < 0.995;
    for (const r of this.ribbons) r.mesh.visible = this.closeT < 0.6;

    // flip animation (+ chapter-jump cascade chaining)
    this.stepChapterJump();
    if (this.flipAnim) this.stepFlipAnim(dt);
    this.applyFlip();

    // chapter ribbons: the open chapter's tab pulls out, all sway faintly
    const school = this.currentSpell.school;
    for (let i = 0; i < this.ribbons.length; i++) {
      const r = this.ribbons[i];
      r.extend.target = r.school === school ? 1 : 0;
      const e = r.extend.update(dt);
      r.mesh.position.y = r.baseX + e * 0.018;
      r.mesh.rotation.z = r.baseRotZ + Math.sin(t * 2.1 + i * 2.4) * 0.014 + e * 0.03;
    }

    // rip lift: the page follows the finger with resistance
    if (this.ripDragging || this.ripReturn > 0 || this.ripLift > 0) {
      let lift = this.ripLift;
      if (!this.ripDragging && this.ripReturn > 0) {
        // springy return with a couple of wobbles
        this.ripReturn = Math.max(0, this.ripReturn - dt * 4.5);
        lift = this.ripReturn * Math.abs(Math.sin(this.ripReturn * 14)) * 0.5;
      }
      const tension = lift * lift;
      const wobble = Math.sin(t * 42) * tension * 0.0035;
      this.rightPage.position.y = lift * 0.045;
      this.rightPage.position.z = 0.0125 + lift * 0.035;
      this.rightPage.position.x = wobble;
      this.rightPage.rotation.z = lift * 0.14 + wobble * 3;
      this.rightMat.uniforms.uProgress.value = 0.025 + lift * 0.06;
    } else {
      this.rightPage.position.set(0, 0, 0.0125);
      this.rightPage.rotation.set(0, 0, 0);
      this.rightMat.uniforms.uProgress.value = 0.025;
    }

    // regrow dissolve
    if (this.regrowT >= 0) {
      this.regrowT += dt * 1.1;
      const k = this.regrowT;
      // slight delay, then dissolve in
      this.rightMat.uniforms.uReveal.value = k < 0.25 ? 0 : Math.min(1.01, easeOutCubic((k - 0.25) / 0.75) * 1.01);
      if (k >= 1) {
        this.regrowT = -1;
        this.rightMat.uniforms.uReveal.value = 1.01;
      }
    }
  }

  private stepFlipAnim(dt: number) {
    const a = this.flipAnim!;
    a.t += dt;
    const k = clamp01(a.t / a.dur);
    this.flipProgress = lerp(a.p0, a.p1, easeOutCubic(k));
    if (k >= 1) {
      if ((this.flipDir === 1 && a.p1 === 1) || (this.flipDir === -1 && a.p1 === 0)) this.finishFlip();
      else this.cancelFlip();
    }
  }

  private applyFlip() {
    if (!this.flipActive) return;
    // keep the sheet curled just above the resting static pages so their
    // edges never poke through at the extremes of the flip
    this.sheetMat.uniforms.uProgress.value = Math.min(0.96, Math.max(0.04, this.flipProgress));
    // flutter the sheet slightly while mid-air
    this.sheetMat.uniforms.uFlutter.value = Math.sin(this.flipProgress * Math.PI) * 0.5;
    if (!this.flipSounded && Math.abs(this.flipProgress - 0.5) < 0.18) {
      this.flipSounded = true;
      sfx.pageFlip();
      haptic(6);
    }
  }
}
