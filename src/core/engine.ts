/**
 * The engine shell: a fixed portrait stage, a LOW internal render resolution,
 * and a post pass that quantises the frame.
 *
 * Why render low and upscale (docs/ARTSTYLE.md):
 *  - It is the only way AI-authored sprites and procedural tile textures end up
 *    with the SAME pixel size on screen. Two different pixel sizes in one frame
 *    is the single most common tell of fake pixel art.
 *  - The quantise + ordered-dither post pass collapses everything — sprites,
 *    walls, spell light — into one shared palette depth, so the frame reads as
 *    one artist's work instead of a collage.
 *  - It is also, incidentally, how the whole thing holds 60fps on a phone.
 */
import * as THREE from 'three';
import { tickShaders } from '../style/toon';

export interface EngineOpts {
  /** Internal render height in pixels. Width follows the stage aspect. */
  internalHeight?: number;
  /** Colour levels per channel in the post pass (lower = chunkier palette). */
  levels?: number;
}

const POST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * Ordered-dither → quantise → vignette. The dither happens BEFORE quantisation
 * so gradients break into pixel texture rather than banding, which is the whole
 * trick behind a limited palette that still reads as smooth lighting.
 */
const POST_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform vec2 uRes;
  uniform float uLevels;
  uniform float uVignette;
  uniform float uFlash;
  uniform vec3 uFlashCol;
  uniform float uDesat;
  uniform float uExposure;
  uniform float uDither;

  /**
   * Per-pixel hash dither.
   *
   * This replaced a hand-rolled "Bayer" matrix that was not actually a valid
   * Bayer sequence — it produced a strongly correlated crosshatch that was very
   * visible in dark areas instead of a well-distributed pattern. A stable hash of
   * the pixel coordinate is unstructured, so it reads as fine grain and never as
   * a grid. It is a function of position only, so it does not shimmer in motion.
   */
  float dither(vec2 p) {
    return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453);
  }

  /**
   * Linear -> sRGB. The scene is lit and composited in LINEAR light (textures
   * are uploaded as SRGB8_ALPHA8, so sampling auto-decodes), and a raw
   * ShaderMaterial gets none of three's automatic output conversion. Without
   * this the whole frame displays about a stop and a half too dark.
   */
  /**
   * ACES filmic approximation. Without a rolloff, standing next to a torch
   * clips every channel and the wall becomes one flat saturated slab; with it,
   * highlights desaturate toward white the way real overexposure does.
   */
  vec3 tonemap(vec3 c) {
    c *= uExposure;
    return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
  }

  vec3 linearToSrgb(vec3 c) {
    c = max(c, vec3(0.0));
    return mix(c * 12.92, pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055, step(vec3(0.0031308), c));
  }

  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;

    // vignette, in linear — keeps the eye in the middle of a dark corridor
    vec2 d = vUv - 0.5;
    float vig = 1.0 - uVignette * dot(d, d) * 2.2;
    c *= clamp(vig, 0.0, 1.0);

    // filmic rolloff, then to display space
    c = tonemap(c);
    c = linearToSrgb(c);

    // full-screen hit flash (cast impacts, damage taken)
    c = mix(c, uFlashCol, uFlash);

    // desaturate on death / menus
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, vec3(l), uDesat);

    // Dither then quantise, in DISPLAY space so the palette steps are
    // perceptually even rather than bunched up in the shadows. Amplitude is well
    // under a full step: at the theoretical max the noise itself becomes the
    // texture you notice.
    float n = (dither(vUv * uRes) - 0.5) * uDither;
    c = floor(c * uLevels + 0.5 + n) / uLevels;

    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  /** Crisp 2D overlay context, at device resolution (UI is not pixel-art). */
  readonly ui: CanvasRenderingContext2D;

  /** Internal render size in pixels — the pixel-art grid. */
  rw = 1;
  rh = 1;
  /** CSS size of the stage. */
  sw = 1;
  sh = 1;
  /** Device pixel ratio actually used for the UI layer. */
  dpr = 1;

  private target: THREE.WebGLRenderTarget;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private postMat: THREE.ShaderMaterial;

  private stageEl: HTMLElement;
  private viewEl: HTMLCanvasElement;
  private uiEl: HTMLCanvasElement;
  private internalHeight: number;

  private last = 0;
  private acc = 0;
  /** Fixed simulation step (120Hz-ish for stable tweens), max 4 per frame. */
  private readonly step = 1 / 120;
  private raf = 0;

  /** Seconds since boot, advanced by the fixed step — drives all animation. */
  time = 0;

  /**
   * A scene rendered at FULL resolution over the pixelated world, with depth
   * cleared first — this is where the grimoire lives. The dungeon is a low-res
   * pixel-art artifact; the book is an object in your hands and its page text
   * has to stay legible.
   */
  overlayScene: THREE.Scene | null = null;
  overlayCamera: THREE.Camera | null = null;

  onUpdate: (dt: number) => void = () => {};
  onRender: (ctx: CanvasRenderingContext2D) => void = () => {};
  onResize: () => void = () => {};

  constructor(opts: EngineOpts = {}) {
    this.internalHeight = opts.internalHeight ?? 400;

    this.stageEl = document.getElementById('stage') as HTMLElement;
    this.viewEl = document.getElementById('view') as HTMLCanvasElement;
    this.uiEl = document.getElementById('ui') as HTMLCanvasElement;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.viewEl,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    // The canvas is full resolution. The world's chunky pixels come from
    // NEAREST-upscaling the low-res render target in the post pass, which frees
    // the canvas to also carry a crisp, full-resolution book pass on top.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.autoClear = true;
    this.renderer.setClearColor(0x000000, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.02, 60);

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      generateMipmaps: false,
      type: THREE.UnsignedByteType,
    });

    this.postMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture },
        uRes: { value: new THREE.Vector2(1, 1) },
        uLevels: { value: opts.levels ?? 36 },
        uVignette: { value: 0.72 },
        uFlash: { value: 0 },
        uFlashCol: { value: new THREE.Color(1, 1, 1) },
        uDesat: { value: 0 },
        uExposure: { value: 1.12 },
        uDither: { value: 0.5 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat);
    quad.frustumCulled = false;
    this.postScene.add(quad);

    const ctx = this.uiEl.getContext('2d');
    if (!ctx) throw new Error('no 2d context for the UI layer');
    this.ui = ctx;

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    this.resize();
  }

  /** Post-pass knobs, driven by core/juice.ts. */
  setFlash(amount: number, color = 0xffffff): void {
    this.postMat.uniforms.uFlash.value = Math.max(0, Math.min(1, amount));
    (this.postMat.uniforms.uFlashCol.value as THREE.Color).setHex(color);
  }

  /** Dither amplitude in quantisation steps (0 = off, 1 = full step). */
  setDither(a: number): void {
    this.postMat.uniforms.uDither.value = a;
  }

  setExposure(e: number): void {
    this.postMat.uniforms.uExposure.value = e;
  }

  setDesat(amount: number): void {
    this.postMat.uniforms.uDesat.value = Math.max(0, Math.min(1, amount));
  }

  setVignette(amount: number): void {
    this.postMat.uniforms.uVignette.value = amount;
  }

  private resize(): void {
    // Portrait stage: fill the viewport, but never exceed a phone-ish aspect on
    // desktop — a 21:9 monitor should letterbox, not stretch the dungeon.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxAspect = 0.52;   // widest we allow (roughly 9:17)
    const minAspect = 0.42;   // narrowest (roughly 9:21)
    let sw = vw, sh = vh;
    const a = vw / vh;
    if (a > maxAspect) sw = Math.round(vh * maxAspect);
    else if (a < minAspect) sh = Math.round(vw / minAspect);

    this.sw = sw; this.sh = sh;
    this.stageEl.style.width = `${sw}px`;
    this.stageEl.style.height = `${sh}px`;

    // Internal pixel grid.
    this.rh = this.internalHeight;
    this.rw = Math.max(80, Math.round(this.rh * (sw / sh)));
    // Keep the grid even so the upscale factor stays uniform.
    if (this.rw % 2) this.rw++;

    this.renderer.setSize(sw, sh, false);
    this.viewEl.style.width = `${sw}px`;
    this.viewEl.style.height = `${sh}px`;
    this.target.setSize(this.rw, this.rh);
    (this.postMat.uniforms.uRes.value as THREE.Vector2).set(this.rw, this.rh);

    this.camera.aspect = this.rw / this.rh;
    this.camera.updateProjectionMatrix();

    // UI layer is crisp at device resolution — pixel world, sharp glyphs.
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.uiEl.width = Math.round(sw * this.dpr);
    this.uiEl.height = Math.round(sh * this.dpr);
    this.uiEl.style.width = `${sw}px`;
    this.uiEl.style.height = `${sh}px`;

    this.onResize();
  }

  /** Convert a world position to UI-layer CSS pixels (for damage numbers). */
  worldToUi(p: THREE.Vector3, out: { x: number; y: number; behind: boolean }): void {
    const v = _tmp.copy(p).project(this.camera);
    out.behind = v.z > 1 || v.z < -1;
    out.x = (v.x * 0.5 + 0.5) * this.sw;
    out.y = (-v.y * 0.5 + 0.5) * this.sh;
  }

  start(): void {
    this.last = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      let dt = (now - this.last) / 1000;
      this.last = now;
      // A backgrounded tab can hand us a huge dt; clamp so nothing tunnels.
      if (dt > 0.25) dt = 0.25;

      this.acc += dt;
      let steps = 0;
      while (this.acc >= this.step && steps < 8) {
        this.time += this.step;
        tickShaders(this.time);
        this.onUpdate(this.step);
        this.acc -= this.step;
        steps++;
      }
      if (steps === 8) this.acc = 0; // gave up catching up; drop the backlog

      this.renderer.setRenderTarget(this.target);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);

      this.renderer.setRenderTarget(null);
      this.renderer.render(this.postScene, this.postCam);

      if (this.overlayScene && this.overlayCamera) {
        // autoClear would wipe the colour buffer we just blitted the world into,
        // so the overlay composites manually: keep the colour, reset only depth
        // so the book sorts against itself and not against the dungeon.
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
        this.renderer.render(this.overlayScene, this.overlayCamera);
        this.renderer.autoClear = true;
      }

      const ui = this.ui;
      ui.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ui.clearRect(0, 0, this.sw, this.sh);
      this.onRender(ui);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }
}

const _tmp = new THREE.Vector3();
