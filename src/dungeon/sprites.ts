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
import { PPU } from '../art/tiles';
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

  /** Baked light at this sprite's tile, pushed in when it moves. */
  uniform float uTileLight;
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

  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vec4 t = texture2D(map, vUv);
    // Hard cutout — pixel art has no partial coverage, and alpha blending here
    // would break the depth sort against other sprites.
    if (t.a < 0.5) discard;

    // Selection keyline. Measured in the SPRITE's own texels, so it stays exactly
    // one pixel thick at every distance instead of thinning out with range.
    if (uOutlineAmt > 0.0) {
      float a =
        texture2D(map, vUv + vec2(uTexel.x, 0.0)).a *
        texture2D(map, vUv - vec2(uTexel.x, 0.0)).a *
        texture2D(map, vUv + vec2(0.0, uTexel.y)).a *
        texture2D(map, vUv - vec2(0.0, uTexel.y)).a;
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

const texCache = new Map<string, THREE.Texture>();

/** Load one sprite PNG as a nearest-filtered texture (cached). */
export function loadSprite(id: string): Promise<THREE.Texture> {
  const hit = texCache.get(id);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      `art/${id}.png`,
      (tex) => {
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        texCache.set(id, tex);
        resolve(tex);
      },
      undefined,
      () => reject(new Error(`sprite failed to load: ${id}`)),
    );
  });
}

/** The cached texture for an already-loaded sprite, or null. */
export function spriteTexture(id: string): THREE.Texture | null {
  return texCache.get(id) ?? null;
}

export function preloadSprites(ids: string[]): Promise<THREE.Texture[]> {
  return Promise.all([...new Set(ids)].map(loadSprite));
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

/** Texture pixel size -> world size, keeping texels close to the wall texels. */
export function spriteWorldSize(tex: THREE.Texture): { w: number; h: number } {
  const img = tex.image as { width: number; height: number };
  return { w: (img.width / PPU) * SPRITE_SCALE, h: (img.height / PPU) * SPRITE_SCALE };
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

  readonly w: number;
  readonly h: number;

  state: AnimState = 'idle';
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
        uFlash: { value: 0 },
        uFlashCol: { value: new THREE.Color(0xffffff) },
        uTintAmt: { value: 0 },
        uTintCol: { value: new THREE.Color(0xffffff) },
        uAlpha: { value: 1 },
        uEmissive: { value: opts.emissive ?? 0.85 },
        uOutline: { value: new THREE.Color(0xffffff) },
        uOutlineAmt: { value: 0 },
        uTexel: {
          value: new THREE.Vector2(
            1 / ((tex.image as { width: number }).width),
            1 / ((tex.image as { height: number }).height),
          ),
        },
        ...world,
      },
    });

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

  /** Baked light where the sprite stands. Call when it moves. */
  setTileLight(v: number): void {
    this.mat.uniforms.uTileLight.value = v;
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
    _v.set(this.tx + this.ox, this.hover, this.ty + this.oz);
    project(_v, o);
    if (o.behind) return null;
    const bx = o.x, by = o.y;
    _v.set(this.tx + this.ox, this.hover + this.h, this.ty + this.oz);
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

    // Always-on idle breath, so nothing is ever perfectly still.
    const b = Math.sin(time * this.bobRate + this.phase);
    p.lift += b * this.bobAmt;
    p.sy += b * 0.012;
    p.sx -= b * 0.012;
    p.roll += Math.sin(time * this.bobRate * 0.5 + this.phase) * 0.012;

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
    this.group.position.set(bx, 0, bz);

    // yaw so the quad's +x is perpendicular to the view direction
    const yaw = Math.atan2(cam.x - bx, cam.z - bz);
    this.mesh.rotation.set(0, yaw, p.roll, 'YXZ');

    // push is toward the camera along the ground plane
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    this.mesh.position.set(
      p.slide * Math.cos(yaw) + dx * p.push,
      this.hover + p.lift,
      -p.slide * Math.sin(yaw) + dz * p.push,
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
