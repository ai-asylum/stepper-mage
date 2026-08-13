/**
 * 2.5D billboard sprites — every creature, prop, golem and boss in the dungeon.
 *
 * Two things make these sit IN the space instead of looking pasted on:
 *
 *  1. They are lit by the same model as the masonry (ambient + baked tile light
 *     + the player's torch + the same fog), so walking a torch toward a creature
 *     lights it exactly like it lights the wall behind it.
 *  2. Bright saturated texels stay EMISSIVE regardless of light, so a book
 *     golem's violet eyes still burn at the far end of a black corridor. That
 *     one term is most of the atmosphere.
 *
 * They are also animated purely by TRANSFORM — bob, squash, lean, lunge, recoil.
 * The sprites are single-frame, so procedural motion on a bottom-pivoted quad is
 * what keeps them from reading as cardboard. Squash and stretch conserve volume,
 * which is why it looks like weight rather than scaling.
 */
import * as THREE from 'three';
import { assetUrl } from 'playable-kit/runtime';
// Only `stepArt().spritePpu` — never `pixelStep()`. Nothing about a sprite is
// decided by the density of the masonry behind it, and the two differ at 18.
import { stepArt } from '../art/steps';
import type { SpriteView } from '../art/views';
import type { WorldUniforms } from './render';

const SPRITE_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SPRITE_FRAG = /* glsl */ `
  precision mediump float;
  uniform sampler2D map;
  uniform vec3 uCam;
  uniform vec3 uTorch;
  uniform vec3 uLightCol;
  uniform float uTorchReach;
  uniform float uFlicker;
  uniform float uAmbient;
  uniform vec3 uAmbientCol;
  uniform float uBakedGain;
  uniform float uTorchGain;
  uniform vec3 uFog;
  uniform float uFogDensity;
  uniform vec3 uMurkCol;
  uniform float uMurkHere;

  /** Baked light at this sprite's tile, pushed in when it moves. */
  uniform float uTileLight;
  /** 1 if this sprite's tile is inside a fog bank. Pushed in per frame. */
  uniform float uTileMurk;
  /** Hit flash: pushes the whole silhouette toward a colour. */
  uniform float uFlash;
  uniform vec3 uFlashCol;
  /** Status tint (burning orange, frozen blue, soaked teal...). */
  uniform float uTintAmt;
  uniform vec3 uTintCol;
  /** Fade for deaths and spawn-ins. */
  uniform float uAlpha;
  /** How strongly self-lit texels ignore the room lighting. */
  uniform float uEmissive;
  /** Selection keyline: colour + strength + one texel of the sprite's own grid. */
  uniform vec3 uOutline;
  uniform float uOutlineAmt;
  uniform vec2 uTexel;
  /**
   * Mirror the sprite horizontally. This is how one drawn profile serves a creature
   * turned to the left AND to the right: a grid stepper only shows four relative
   * angles and two of them are the same profile from opposite sides, so flipping
   * here removes a whole pose from every creature in the roster.
   */
  uniform float uFlipX;

  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    // Every sample below goes through this, the keyline taps included — reading the
    // mirrored texel for the fill and the unmirrored ones for the outline would put
    // the keyline on the wrong side of the silhouette.
    vec2 uv = vec2(mix(vUv.x, 1.0 - vUv.x, uFlipX), vUv.y);

    vec4 t = texture2D(map, uv);
    // Hard cutout — pixel art has no partial coverage, and alpha blending here
    // would break the depth sort against other sprites.
    if (t.a < 0.5) discard;

    // Selection keyline. Measured in the SPRITE's own texels, so it stays exactly
    // one pixel thick at every distance instead of thinning out with range.
    if (uOutlineAmt > 0.0) {
      float a =
        texture2D(map, uv + vec2(uTexel.x, 0.0)).a *
        texture2D(map, uv - vec2(uTexel.x, 0.0)).a *
        texture2D(map, uv + vec2(0.0, uTexel.y)).a *
        texture2D(map, uv - vec2(0.0, uTexel.y)).a;
      if (a < 0.5) {
        gl_FragColor = vec4(uOutline, uAlpha);
        return;
      }
    }

    vec3 base = t.rgb;
    base = mix(base, uTintCol, uTintAmt);

    float d = distance(vWorld, uCam);
    float dc = max(d, 0.85);
    float tt = max(0.0, 1.0 - dc / uTorchReach);
    float torch = tt * tt * uFlicker;

    vec3 L = uAmbientCol * uAmbient
           + uLightCol * uTileLight * uBakedGain
           + uTorch * torch * uTorchGain;

    // Self-lit texels: bright AND saturated reads as "this glows" (eyes, lava
    // seams, starlight), so it survives into an unlit corridor.
    float mx = max(max(base.r, base.g), base.b);
    float mn = min(min(base.r, base.g), base.b);
    float sat = mx - mn;
    float e = smoothstep(0.55, 0.96, mx) * (0.25 + 0.75 * smoothstep(0.12, 0.30, sat));

    // Gate the glow by how lit the sprite already is. Without this, a torch-lit
    // creature gets its albedo AND its full emissive, which drives saturated
    // colours straight through the tonemap into flat magenta.
    float roomLit = clamp(dot(L, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    e *= mix(1.0, 0.22, roomLit);

    vec3 c = base * L + base * e * uEmissive;

    float f = exp(-uFogDensity * d * d);
    c = mix(uFog, c, clamp(f, 0.0, 1.0));

    /*
     * THE SAME FOG BANK THE WALLS ARE IN.
     *
     * A creature standing in the murk has to go into it, or fog stops being a place
     * where you cannot see and becomes a grey backdrop with everything dangerous
     * drawn crisply in front of it — which is worse than no fog at all, because it
     * hides the room and not the thing in the room. uTileMurk is this sprite's own
     * tile, so a body inside the bank dissolves whichever side you are looking from;
     * uMurkHere is the camera's, so everything dissolves once you are in there with
     * it. Lit, like the walls: an unlit murk that bleached a sprite to white would
     * make a creature in a dark bank the brightest thing on the screen.
     */
    /*
     * A body standing IN the bank hazes; a body seen from inside one does not. The
     * global distance term is gone for the reason the world's is — being in fog is
     * not a licence to fog everything you can see — and the volume in murkView.ts
     * does the occluding by actually standing between you and the creature.
     */
    float lum = dot(L, vec3(0.299, 0.587, 0.114));
    vec3 murk = uMurkCol * mix(vec3(lum), L, 0.33);
    c = mix(c, murk, uTileMurk * 0.45);

    c = mix(c, uFlashCol, uFlash);

    gl_FragColor = vec4(c, uAlpha);
  }
`;

/** Soft ground shadow, so a sprite is planted rather than hovering. */
const SHADOW_FRAG = /* glsl */ `
  precision mediump float;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.35, 1.0, d)) * uStrength;
    if (a < 0.01) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  }
`;

const SHADOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ------------------------------------------------------------------- loading

/**
 * Keyed by STEP AND id, never by id alone.
 *
 * Three rosters of the same 65 names ship (144, 72, 36) and they differ only in how
 * many pixels they have. A cache keyed on the name alone would hand the 144 moth back
 * while the world is asking for 36 — and because world size is `pixels / spritePpu`,
 * that is not a crisper moth, it is a moth four times too tall standing in a corridor
 * one unit wide.
 */
const texCache = new Map<string, THREE.Texture>();

/**
 * Where a step's art lives. 144 keeps the flat `art/<id>.png` it always had:
 * it is the roster the playable-ad bundler embeds by name, and moving it would
 * have been churn for nothing.
 */
export function spriteUrl(id: string, step = stepArt().spritePpu): string {
  return step === 144 ? `art/${id}.png` : `art/s${step}/${id}.png`;
}

/**
 * A visible stand-in for art that is not there. Magenta check, the oldest convention
 * there is, because the one thing it must never be is subtle.
 */
const missingTex = (): THREE.Texture => {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const x = c.getContext('2d')!;
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      x.fillStyle = (i + j) % 2 ? '#ff00ff' : '#1a001a';
      x.fillRect(i, j, 1, 1);
    }
  }
  return new THREE.CanvasTexture(c);
};

/** Ids already complained about, so a missing sprite logs once and not once a frame. */
const moaned = new Set<string>();

/**
 * Load one sprite PNG as a nearest-filtered texture (cached per step).
 *
 * TWO FALLBACKS, and the crash that earned them: `hero_kela.png` ships in the flat 144
 * roster and was never downscaled into `s72`/`s36`, so at any other step it 404s — and
 * this rejected, the rejection killed the floor build, and entering depth 3 took the
 * whole game down. A captive is the only thing on that floor that needed it.
 *
 * So a step-specific miss falls back to the 144 roster, which is the canonical one and
 * where every sprite exists by definition. A sprite missing THERE too resolves to a
 * magenta check and a console line, because a floor with one wrong-looking body on it
 * is a bug report and a floor that will not load is a dead game. This function no
 * longer rejects at all.
 */
export function loadSprite(id: string, step = stepArt().spritePpu): Promise<THREE.Texture> {
  const key = `${step}/${id}`;
  const hit = texCache.get(key);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    const finish = (tex: THREE.Texture): void => {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      texCache.set(key, tex);
      resolve(tex);
    };
    const giveUp = (): void => {
      if (!moaned.has(id)) {
        moaned.add(id);
        console.error(`[art] missing sprite "${id}" — drawing the placeholder`);
      }
      finish(missingTex());
    };
    // Inside the playable-ad bundle this resolves to an embedded data URI;
    // on web/Android the path falls through untouched.
    loader.load(assetUrl(spriteUrl(id, step)), finish, undefined, () => {
      if (step === 144) { giveUp(); return; }
      loader.load(assetUrl(spriteUrl(id, 144)), finish, undefined, giveUp);
    });
  });
}

/** The cached texture for an already-loaded sprite, or null. */
export function spriteTexture(id: string, step = stepArt().spritePpu): THREE.Texture | null {
  return texCache.get(`${step}/${id}`) ?? null;
}

export function preloadSprites(
  ids: string[], step = stepArt().spritePpu,
): Promise<THREE.Texture[]> {
  return Promise.all([...new Set(ids)].map((id) => loadSprite(id, step)));
}

/**
 * Readability scale — world units per 144 sprite pixels. Texel-perfect mapping
 * only holds at one exact distance anyway, and at full size an adjacent creature
 * blanks the entire screen: you cannot read the room you are fighting in.
 *
 * The ceiling is the hard cap. The tallest art in the manifest is 190px, so
 * anything above ~0.72 puts a boss's head through `WALL_H` and the ceiling quad
 * chops it off.
 */
const SPRITE_SCALE = 0.72;

/**
 * Texture pixel size -> world size.
 *
 * Divided by `spritePpu` — the density the PNG was AUTHORED at — and never by the
 * world's current `ppu()`. That distinction is the whole of keeping a creature the
 * same size at every step: the two used to be one number, so halving the world's
 * texel density doubled every creature in it. A sprite's world size is a property of
 * its art, not of the masonry it stands in front of.
 *
 * Each step ships its own roster, halved in pixels and in `spritePpu` together, so
 * this returns the same answer at all four and only the crispness changes. That is
 * worth stating as an invariant because it is not enforced anywhere: nothing stops
 * someone regenerating one step's art at a different size, and the symptom would be
 * creatures that change scale when you touch a graphics setting.
 */
export function spriteWorldSize(tex: THREE.Texture): { w: number; h: number } {
  const img = tex.image as { width: number; height: number };
  const p = stepArt().spritePpu;
  return { w: (img.width / p) * SPRITE_SCALE, h: (img.height / p) * SPRITE_SCALE };
}

// ----------------------------------------------------------------- animation

export type AnimState = 'idle' | 'walk' | 'attack' | 'hit' | 'die' | 'rise';

interface AnimPose {
  /** Vertical offset in world units. */
  lift: number;
  /** Horizontal offset along the sprite's right axis. */
  slide: number;
  /** Forward offset toward the camera (for lunges). */
  push: number;
  /** Non-uniform scale; volume-conserving squash lives here. */
  sx: number;
  sy: number;
  /** Z-roll in radians. */
  roll: number;
  /** 0..1 white flash. */
  flash: number;
  alpha: number;
}

const _v = new THREE.Vector3();

const POSE: AnimPose = { lift: 0, slide: 0, push: 0, sx: 1, sy: 1, roll: 0, flash: 0, alpha: 1 };

/**
 * A billboard entity. Owns its quad, its shadow, and its animation clock.
 * `Sprite` is deliberately dumb about gameplay — combat drives it by calling
 * `play()`; it only knows how to look alive.
 */
export class Sprite {
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  readonly group = new THREE.Group();

  /** World tile the sprite stands on. */
  tx = 0;
  ty = 0;
  /** Sub-tile offset, so several things can share a tile without overlapping. */
  ox = 0;
  oz = 0;
  /** Base hover height (flying creatures sit above the floor). */
  hover = 0;
  /**
   * World height of the floor this sprite is standing on.
   *
   * Separate from `hover`, which is how far a thing floats above its own ground. A
   * wraith on a terrace is hovering AND elevated, and collapsing the two would make a
   * flyer that drifts down a step when it crosses one. Pushed per frame from
   * `Floor.update`, for the same reason the fog depth is: a body walks, gets shoved,
   * rises as a golem and dies, and every one of those paths would otherwise have to
   * remember to update it.
   */
  ground = 0;

  /**
   * The quad's world size. Not `readonly`, because the pixel step can invalidate it
   * — see `restep`. Nothing else writes them.
   */
  w: number;
  h: number;

  state: AnimState = 'idle';
  /**
   * The drawn views this creature has, and which is showing.
   *
   * A profile is narrower than a front, so turning genuinely resizes the quad —
   * which is why `bind` rebuilds the geometry rather than only swapping the map.
   * Height is equal across views by construction (see `tools/genviews.py`), so a
   * creature does not grow as it turns.
   */
  private views = new Map<SpriteView, THREE.Texture>();
  private view: SpriteView = 'front';
  private flipped = false;
  private t = 0;
  private phase: number;
  /** Personality: every creature bobs at its own rate so a room is not a chorus. */
  private bobRate: number;
  private bobAmt: number;
  private dead = false;

  private mat: THREE.ShaderMaterial;
  private shadowMat: THREE.ShaderMaterial;

  constructor(
    readonly id: string,
    tex: THREE.Texture,
    world: WorldUniforms,
    opts: { hover?: number; emissive?: number; bob?: number; seed?: number } = {},
  ) {
    const size = spriteWorldSize(tex);
    this.w = size.w;
    this.h = size.h;
    this.hover = opts.hover ?? 0;

    const seed = opts.seed ?? id.length * 7.13;
    this.phase = (seed % 6.283);
    this.bobRate = 1.5 + ((seed * 1.37) % 1) * 1.1;
    this.bobAmt = (opts.bob ?? 1) * 0.016;

    // Bottom-pivoted quad: translate the geometry up by half its height so
    // scaling and rolling happen around the feet, not the middle.
    const geo = new THREE.PlaneGeometry(size.w, size.h);
    geo.translate(0, size.h / 2, 0);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      uniforms: {
        map: { value: tex },
        uTileLight: { value: 0.4 },
        uTileMurk: { value: 0 },
        uFlash: { value: 0 },
        uFlashCol: { value: new THREE.Color(0xffffff) },
        uTintAmt: { value: 0 },
        uTintCol: { value: new THREE.Color(0xffffff) },
        uAlpha: { value: 1 },
        uEmissive: { value: opts.emissive ?? 0.85 },
        uOutline: { value: new THREE.Color(0xffffff) },
        uOutlineAmt: { value: 0 },
        uFlipX: { value: 0 },
        uTexel: {
          value: new THREE.Vector2(
            1 / ((tex.image as { width: number }).width),
            1 / ((tex.image as { height: number }).height),
          ),
        },
        ...world,
      },
    });

    this.views.set('front', tex);

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;

    const shGeo = new THREE.PlaneGeometry(size.w * 0.82, size.w * 0.42);
    shGeo.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: { uStrength: { value: 0.5 } },
    });
    this.shadow = new THREE.Mesh(shGeo, this.shadowMat);
    this.shadow.position.y = 0.006; // just off the floor, no z-fighting
    this.shadow.frustumCulled = false;

    this.group.add(this.shadow, this.mesh);
  }

  /**
   * Replace the whole set of drawn views, then re-show whichever one is current.
   *
   * This is both the spawn path and the pixel-step path. It takes textures rather
   * than fetching them because the caller has to await the floor's whole roster
   * anyway, and doing it per sprite would pop creatures in one at a time.
   *
   * Old textures are not disposed: they belong to the module cache, still keyed
   * under their own step, and a player switching back should not re-fetch them.
   */
  setViews(views: ReadonlyMap<SpriteView, THREE.Texture>): void {
    this.views = new Map(views);
    this.bind(this.view, this.flipped, true);
  }

  /**
   * Show a creature from a given side, mirroring for the opposite one.
   *
   * Cheap to call every frame: it early-outs unless the view or the flip actually
   * changed, which they only do when a creature turns or the player walks round it.
   */
  setView(view: SpriteView, flip: boolean): void {
    // A body mid-strike shows its attack pose regardless of which way it is turned.
    // There is one drawn strike and it is front-facing, so it out-ranks the facing
    // for the third of a second it plays — a creature lunging at you is looking at
    // you by definition, and drawing its back while it hits you would be worse than
    // having no attack frame at all.
    if (this.state === 'attack' && this.views.has('attack')) {
      this.bind('attack', false);
      return;
    }
    this.bind(view, flip);
  }

  /** The view currently drawn, after falling back for art that does not exist. */
  get shownView(): SpriteView { return this.view; }
  get shownFlipped(): boolean { return this.flipped; }

  private bind(view: SpriteView, flip: boolean, force = false): void {
    // Fall back to the front rather than drawing nothing: most of the roster has no
    // back or side yet, and a prop has no business having one.
    const tex = this.views.get(view) ?? this.views.get('front');
    if (!tex) return;
    const resolved: SpriteView = this.views.has(view) ? view : 'front';
    // A front is never mirrored. Flipping a symmetrical creature would be invisible
    // and flipping an asymmetrical one would make it change hands as you walk past.
    const doFlip = resolved === 'side' && flip;
    if (!force && resolved === this.view && doFlip === this.flipped) return;
    this.view = resolved;
    this.flipped = doFlip;

    this.mat.uniforms.map.value = tex;
    this.mat.uniforms.uFlipX.value = doFlip ? 1 : 0;
    const img = tex.image as { width: number; height: number };
    // The keyline is measured in the sprite's OWN texels, so it has to move with the
    // texture or it stays a 144-texel hairline on a 36-texel creature.
    (this.mat.uniforms.uTexel.value as THREE.Vector2).set(1 / img.width, 1 / img.height);

    const size = spriteWorldSize(tex);
    if (size.w === this.w && size.h === this.h) return;
    this.w = size.w;
    this.h = size.h;
    // Bottom-pivoted exactly as the constructor builds it.
    const geo = new THREE.PlaneGeometry(size.w, size.h);
    geo.translate(0, size.h / 2, 0);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
    const shGeo = new THREE.PlaneGeometry(size.w * 0.82, size.w * 0.42);
    shGeo.rotateX(-Math.PI / 2);
    this.shadow.geometry.dispose();
    this.shadow.geometry = shGeo;
  }

  /**
   * The pixel dimensions of the art currently bound. Only a harness asks: it is
   * the one way to tell from outside which step's PNG the cache actually handed
   * over, since a right-sized quad proves nothing on its own.
   */
  get texSize(): { w: number; h: number } {
    const img = (this.mat.uniforms.map.value as THREE.Texture).image as
      { width: number; height: number };
    return { w: img.width, h: img.height };
  }

  /** Baked light where the sprite stands. Call when it moves. */
  setTileLight(v: number): void {
    this.mat.uniforms.uTileLight.value = v;
  }

  /**
   * Is the tile this sprite stands on inside a fog bank?
   *
   * Pushed per frame from `Floor.update` rather than from the ten places that push
   * the light, because it is a fact about WHERE THE SPRITE IS and the sprite is the
   * only thing that reliably knows that — a body walks, gets shoved, rises as a
   * golem and dies, and every one of those paths would have had to remember.
   */
  setTileMurk(v: number): void {
    this.mat.uniforms.uTileMurk.value = v;
  }

  setTint(color: number, amount: number): void {
    (this.mat.uniforms.uTintCol.value as THREE.Color).setHex(color);
    this.mat.uniforms.uTintAmt.value = amount;
  }

  /** Draw a one-texel keyline around the silhouette (selection feedback). */
  setOutline(colour: number, on: boolean): void {
    (this.mat.uniforms.uOutline.value as THREE.Color).setHex(colour);
    this.mat.uniforms.uOutlineAmt.value = on ? 1 : 0;
  }

  /**
   * The sprite's projected screen box, so a tap anywhere on it selects it.
   * Returns null when it is behind the camera.
   */
  screenBox(
    project: (p: THREE.Vector3, out: { x: number; y: number; behind: boolean }) => void,
  ): { x: number; y: number; w: number; h: number } | null {
    const o = { x: 0, y: 0, behind: false };
    _v.set(this.tx + this.ox, this.ground + this.hover, this.ty + this.oz);
    project(_v, o);
    if (o.behind) return null;
    const bx = o.x, by = o.y;
    _v.set(this.tx + this.ox, this.ground + this.hover + this.h, this.ty + this.oz);
    project(_v, o);
    if (o.behind) return null;
    const top = o.y;
    const hpx = Math.abs(by - top);
    const wpx = hpx * (this.w / this.h);
    return { x: bx - wpx / 2, y: top, w: wpx, h: hpx };
  }

  setEmissive(v: number): void {
    this.mat.uniforms.uEmissive.value = v;
  }

  /** Start an animation. `hit`, `attack`, `die` and `rise` are one-shots. */
  play(state: AnimState): void {
    if (this.dead && state !== 'die') return;
    this.state = state;
    this.t = 0;
    if (state === 'die') this.dead = true;
  }

  get isDead(): boolean { return this.dead; }
  /** True once a death animation has finished playing out. */
  get isGone(): boolean { return this.dead && this.state === 'die' && this.t >= 1; }

  private pose(time: number): AnimPose {
    const p = POSE;
    p.lift = 0; p.slide = 0; p.push = 0; p.sx = 1; p.sy = 1; p.roll = 0; p.flash = 0; p.alpha = 1;

    /**
     * Idle breath — for things that BREATHE, which `bob` is the switch for.
     *
     * It used to be unconditional and only its amplitude was tunable, so the squash
     * and the roll ran at full strength on everything in the dungeon: a chest, a
     * brazier, a stone plinth with a lever bolted to it. A creature swaying is alive.
     * A block of masonry swaying is the floor coming loose, and once you notice it on
     * one prop you notice it on all of them at once.
     *
     * So the whole breath is scaled by the same number, and `bob: 0` now means STILL
     * rather than "lifts less while it keeps rolling".
     */
    const k = this.bobAmt / 0.016;
    if (k > 0) {
      const b = Math.sin(time * this.bobRate + this.phase);
      p.lift += b * this.bobAmt;
      p.sy += b * 0.012 * k;
      p.sx -= b * 0.012 * k;
      p.roll += Math.sin(time * this.bobRate * 0.5 + this.phase) * 0.012 * k;
    }

    const t = this.t;
    switch (this.state) {
      case 'walk': {
        // a rolling stride: two bobs per tile, with a lean into the direction
        const k = Math.sin(t * Math.PI * 4);
        p.lift += Math.abs(k) * 0.05;
        p.roll += k * 0.05;
        p.sy += Math.abs(k) * 0.03;
        p.sx -= Math.abs(k) * 0.02;
        break;
      }
      case 'attack': {
        // anticipation (pull back + squash) then a hard lunge, then settle
        if (t < 0.32) {
          const k = t / 0.32;
          p.push -= 0.1 * k;
          p.sy -= 0.13 * k;
          p.sx += 0.13 * k;
          p.lift -= 0.02 * k;
        } else if (t < 0.52) {
          const k = (t - 0.32) / 0.2;
          p.push += 0.34 * k;
          p.sy += 0.16 * k;
          p.sx -= 0.1 * k;
        } else {
          const k = 1 - (t - 0.52) / 0.48;
          p.push += 0.34 * k * k;
          p.sy += 0.16 * k * k;
        }
        break;
      }
      case 'hit': {
        // sharp recoil away, a white pop, and a decaying shake
        const k = 1 - t;
        p.push -= 0.18 * k * k;
        p.flash = Math.max(0, 1 - t * 3.2);
        p.slide += Math.sin(t * 46) * 0.05 * k;
        p.sx += 0.14 * k;
        p.sy -= 0.1 * k;
        break;
      }
      case 'rise': {
        // birth: burst up out of the floor, overshoot, settle
        const k = Math.min(1, t / 0.75);
        const o = 1 - Math.pow(1 - k, 3);
        p.sy = 0.15 + o * 0.95;
        p.sx = 1.45 - o * 0.45;
        p.lift = -this.h * (1 - o) * 0.55;
        if (t > 0.5) {
          const s = Math.sin((t - 0.5) * 18) * (1 - (t - 0.5) / 0.5) * 0.09;
          p.sy += s; p.sx -= s;
        }
        p.alpha = Math.min(1, t * 4);
        break;
      }
      case 'die': {
        // topple, flatten, fade — a crumple rather than a fade-out
        const k = Math.min(1, t);
        p.roll += k * k * 1.25;
        p.lift -= k * k * this.h * 0.28;
        p.sy = 1 - k * 0.55;
        p.sx = 1 + k * 0.28;
        p.alpha = 1 - Math.max(0, (k - 0.55) / 0.45);
        p.flash = Math.max(0, 0.7 - t * 2.4);
        break;
      }
      case 'idle':
      default:
        break;
    }
    return p;
  }

  /**
   * Face the camera (Y axis only) and apply the current pose.
   * Y-only billboarding is what keeps this reading as 2.5D: sprites never tilt
   * with the camera, so verticals stay vertical and the world stays solid.
   */
  /**
   * A permanent nudge along the view axis, positive toward the camera.
   *
   * Two things standing on one tile are at one distance from the camera, and three
   * sorts transparent objects by exactly that — so a tie is broken arbitrarily and
   * arbitrarily is what flickers. Nothing here writes depth, so this is the only lever:
   * separate them in space and the sort has an answer.
   *
   * It is a property of WHAT THE THING IS rather than of where it stands. Fire belongs
   * in front of a body standing in it; a staircase is a hole in the floor and belongs
   * behind everything that stands on it. Set once, at build time.
   */
  depthBias = 0;

  update(dt: number, time: number, cam: THREE.Vector3): void {
    // one-shot animations advance a normalised clock
    const dur = this.state === 'attack' ? 0.52
      : this.state === 'hit' ? 0.34
      : this.state === 'die' ? 0.95
      : this.state === 'rise' ? 0.85
      : this.state === 'walk' ? 0.235
      : 1;
    this.t = Math.min(1, this.t + dt / dur);
    if (this.t >= 1 && (this.state === 'attack' || this.state === 'hit' || this.state === 'rise')) {
      this.state = 'idle';
      this.t = 0;
    }

    const p = this.pose(time);

    const bx = this.tx + this.ox;
    const bz = this.ty + this.oz;
    this.group.position.set(bx, this.ground, bz);

    // yaw so the quad's +x is perpendicular to the view direction
    const yaw = Math.atan2(cam.x - bx, cam.z - bz);
    this.mesh.rotation.set(0, yaw, p.roll, 'YXZ');

    /**
     * Push is toward the camera along the ground plane, and `depthBias` is a STANDING
     * one — see the field.
     */
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    const push = p.push + this.depthBias;
    this.mesh.position.set(
      p.slide * Math.cos(yaw) + dx * push,
      this.hover + p.lift,
      -p.slide * Math.sin(yaw) + dz * push,
    );
    this.mesh.scale.set(p.sx, p.sy, 1);

    this.mat.uniforms.uFlash.value = p.flash;
    this.mat.uniforms.uAlpha.value = p.alpha;

    // shadow shrinks as the sprite lifts — sells the hover and the death slump
    const lift = this.hover + p.lift;
    const shrink = Math.max(0.25, 1 - lift * 1.1);
    this.shadow.scale.set(shrink * p.sx, 1, shrink);
    this.shadowMat.uniforms.uStrength.value = 0.5 * shrink * p.alpha;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.shadow.geometry.dispose();
    this.mat.dispose();
    this.shadowMat.dispose();
  }
}
