/**
 * Turns a `Grid` into geometry.
 *
 * One merged mesh per tile texture (6 wall variants + 4 floor + 3 ceiling = 13
 * draw calls for a whole floor), with the baked per-tile light carried in a
 * vertex attribute and smoothed across corners. The player's torch is added
 * per-fragment on top, so lighting is free at runtime — which is what buys the
 * budget for the spell VFX later.
 */
import * as THREE from 'three';
import { Grid, Tile, DIR_VEC } from './grid';
import { WALL_H, buildTileSet, buildSconce, colToHex } from '../art/tiles';
import type { Theme } from '../art/theme';
import type { Pix } from '../art/pixel';

const WORLD_VERT = /* glsl */ `
  attribute float alight;
  varying vec2 vUv;
  varying float vLight;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vLight = alight;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WORLD_FRAG = /* glsl */ `
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
  varying vec2 vUv;
  varying float vLight;
  varying vec3 vWorld;

  void main() {
    vec3 tex = texture2D(map, vUv).rgb;

    float d = distance(vWorld, uCam);

    // The torch: a squared linear falloff. Squaring keeps a tight bright pool at
    // the player's feet and a fast rolloff, which is what makes stepping forward
    // into a dark room feel like it reveals something.
    // Distance falloff with a soft near clamp: without the max() the torch
    // divides by ~0 against a wall you are standing in and blows out.
    float dc = max(d, 0.85);
    float t = max(0.0, 1.0 - dc / uTorchReach);
    float torch = t * t * uFlicker;

    // Illuminance, in LINEAR light. Values well above 1.0 are correct here:
    // stone albedo is ~0.3 sRGB (~0.07 linear), so a torch-lit wall needs a
    // multiplier of several to land at a readable mid-tone once encoded.
    vec3 L = uAmbientCol * uAmbient + uLightCol * vLight * uBakedGain + uTorch * torch * uTorchGain;
    vec3 c = tex * L;

    // exponential-squared fog to the floor's void colour
    float f = exp(-uFogDensity * d * d);
    c = mix(uFog, c, clamp(f, 0.0, 1.0));

    gl_FragColor = vec4(c, 1.0);
  }
`;

export interface WorldUniforms {
  uCam: { value: THREE.Vector3 };
  uTorch: { value: THREE.Color };
  uLightCol: { value: THREE.Color };
  uTorchReach: { value: number };
  uFlicker: { value: number };
  uAmbient: { value: number };
  uAmbientCol: { value: THREE.Color };
  uBakedGain: { value: number };
  uTorchGain: { value: number };
  uFog: { value: THREE.Color };
  uFogDensity: { value: number };
  [k: string]: { value: unknown };
}

/** Buffers for one merged mesh. */
class MeshBuild {
  pos: number[] = [];
  uv: number[] = [];
  light: number[] = [];
  idx: number[] = [];
  private n = 0;

  quad(
    a: [number, number, number], b: [number, number, number],
    c: [number, number, number], d: [number, number, number],
    la: number, lb: number, lc: number, ld: number,
    /** UV repeat, so a tall wall keeps square texels. */
    uw = 1, vh = 1,
  ): void {
    this.pos.push(...a, ...b, ...c, ...d);
    this.uv.push(0, vh, uw, vh, uw, 0, 0, 0);
    this.light.push(la, lb, lc, ld);
    const i = this.n;
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    this.n += 4;
  }

  toMesh(tex: THREE.Texture, uniforms: WorldUniforms): THREE.Mesh | null {
    if (!this.n) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('alight', new THREE.Float32BufferAttribute(this.light, 1));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      vertexShader: WORLD_VERT,
      fragmentShader: WORLD_FRAG,
      uniforms: { map: { value: tex }, ...uniforms },
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = true;
    return m;
  }
}

export class DungeonView {
  readonly group = new THREE.Group();
  readonly uniforms: WorldUniforms;
  private sconces: { mesh: THREE.Mesh; frames: THREE.Texture[]; phase: number }[] = [];
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  constructor(private grid: Grid, private theme: Theme, private seed: string) {
    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uTorch: { value: new THREE.Color(colToHex(theme.lightCol)) },
      uLightCol: { value: new THREE.Color(colToHex(theme.lightCol)) },
      uTorchReach: { value: theme.lightReach },
      uFlicker: { value: 1 },
      uAmbient: { value: theme.ambient },
      uAmbientCol: { value: new THREE.Color(colToHex(theme.ambientCol)) },
      uBakedGain: { value: 2.7 },
      uTorchGain: { value: 3.6 },
      uFog: { value: new THREE.Color(colToHex(theme.fog)) },
      uFogDensity: { value: 0.016 },
    };
    this.build(seed);
  }

  /**
   * Rebuild every texture and every mesh at the current texel density.
   *
   * Deliberately `dispose()` then `build()` — the same two calls a descent makes,
   * in the same order — rather than a second, gentler path that only swaps the
   * textures. A floor already had to be able to tear itself down completely, and a
   * texture-only swap would be a second teardown to keep correct: the geometry
   * carries the tile UVs and the sconce quads are sized off the frames.
   *
   * The GRID is untouched, so the layout, the baked light and everything standing on
   * the floor survive; `uniforms` is the same object throughout, which is why the
   * sprite materials that hold references into it keep working across a rebuild.
   */
  restep(): void {
    this.dispose();
    this.build(this.seed);
  }

  /**
   * Corner light: average the baked light of the up-to-4 tiles touching a floor
   * corner. Sampling per-corner rather than per-tile is what turns blocky tile
   * lighting into a smooth pool of torchlight across the floor.
   */
  private cornerLight(cx: number, cy: number): number {
    const g = this.grid;
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 0; dy++) {
      for (let dx = -1; dx <= 0; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!g.walkable(x, y)) continue;
        sum += g.lightAt(x, y);
        n++;
      }
    }
    return n ? sum / n : 0;
  }

  private build(seed: string): void {
    const g = this.grid;
    const tiles = buildTileSet(this.theme, seed);
    const wallB = tiles.walls.map(() => new MeshBuild());
    const floorB = tiles.floors.map(() => new MeshBuild());
    const ceilB = tiles.ceils.map(() => new MeshBuild());

    // UV repeat down a wall quad, so the texels stay square on a face that is
    // taller than it is wide. It is the wall's WORLD height and has nothing to do
    // with the step: the texture is already `ppu() * WALL_H` texels tall.
    const wallVh = WALL_H;

    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (g.at(x, y) === Tile.Wall) continue;
        const v = g.variant[g.idx(x, y)];

        // corner lights, shared by floor and ceiling
        const l00 = this.cornerLight(x, y);
        const l10 = this.cornerLight(x + 1, y);
        const l11 = this.cornerLight(x + 1, y + 1);
        const l01 = this.cornerLight(x, y + 1);

        // Floor, normal +y. Winding runs from the far edge to the near edge —
        // the opposite order reads as facing down and gets backface-culled.
        const fb = floorB[v % floorB.length];
        fb.quad(
          [x - 0.5, 0, y + 0.5], [x + 0.5, 0, y + 0.5],
          [x + 0.5, 0, y - 0.5], [x - 0.5, 0, y - 0.5],
          l01, l11, l10, l00,
        );

        // Ceiling, normal -y (pointing down at the player).
        const cb = ceilB[v % ceilB.length];
        cb.quad(
          [x - 0.5, WALL_H, y - 0.5], [x + 0.5, WALL_H, y - 0.5],
          [x + 0.5, WALL_H, y + 0.5], [x - 0.5, WALL_H, y + 0.5],
          l00 * 0.55, l10 * 0.55, l11 * 0.55, l01 * 0.55,
        );

        // walls: one quad per solid neighbour, facing inward
        for (let f = 0; f < 4; f++) {
          const [dx, dy] = DIR_VEC[f];
          const nx = x + dx, ny = y + dy;
          if (g.walkable(nx, ny)) continue;

          const wb = wallB[(v + f * 3) % wallB.length];
          const lb = g.lightAt(x, y);
          // top of a wall is shaded — the ceiling occludes it
          const lt = lb * 0.45;

          // corners of the shared edge between (x,y) and the wall tile
          const hx = dx * 0.5, hz = dy * 0.5;
          // edge direction perpendicular to the face
          const ex = dy * 0.5, ez = -dx * 0.5;
          const ax = x + hx + ex, az = y + hz + ez;
          const bx = x + hx - ex, bz = y + hz - ez;

          wb.quad(
            [ax, 0, az], [bx, 0, bz],
            [bx, WALL_H, bz], [ax, WALL_H, az],
            lb, lb, lt, lt,
            1, wallVh,
          );
        }
      }
    }

    const addAll = (builds: MeshBuild[], pixes: Pix[]) => {
      builds.forEach((b, i) => {
        const tex = pixes[i].toTexture({ repeat: true });
        this.disposables.push(tex);
        const m = b.toMesh(tex, this.uniforms);
        if (m) {
          this.group.add(m);
          this.disposables.push(m.geometry, m.material as THREE.Material);
        }
      });
    };
    addAll(wallB, tiles.walls);
    addAll(floorB, tiles.floors);
    addAll(ceilB, tiles.ceils);

    this.buildSconces(seed);
  }

  /**
   * Torch sconces as small quads flush against their wall face, drawn with an
   * additive-ish unlit material so they stay bright regardless of baked light —
   * a torch is a light source, it should never look shadowed.
   */
  private buildSconces(seed: string): void {
    const frames = buildSconce(this.theme, seed).map((p) => {
      const t = p.toTexture();
      this.disposables.push(t);
      return t;
    });
    // Sized against the wall, not in absolute units — a torch that does not
    // scale with the ceiling ends up hanging through it.
    const geo = new THREE.PlaneGeometry(WALL_H * 0.162, WALL_H * 0.248);
    this.disposables.push(geo);

    for (const L of this.grid.lights) {
      if (L.face < 0) continue;
      const mat = new THREE.MeshBasicMaterial({
        map: frames[0], transparent: true, alphaTest: 0.5,
        depthWrite: false, side: THREE.DoubleSide, fog: false,
      });
      this.disposables.push(mat);
      const m = new THREE.Mesh(geo, mat);
      const [dx, dy] = DIR_VEC[L.face];
      // sit just off the wall so it never z-fights with the masonry
      m.position.set(L.x + dx * 0.44, L.h, L.y + dy * 0.44);
      m.rotation.y = Math.atan2(-dx, -dy);
      this.group.add(m);
      this.sconces.push({ mesh: m, frames, phase: (L.x * 7.13 + L.y * 3.71) % 6.283 });
    }
  }

  /** Per-frame: torch flicker + sconce animation. */
  update(time: number, camPos: THREE.Vector3): void {
    (this.uniforms.uCam.value as THREE.Vector3).copy(camPos);

    // Two out-of-phase sines plus a rare dip: reads as fire, not as a pulse.
    const f =
      0.93 +
      Math.sin(time * 8.3) * 0.035 +
      Math.sin(time * 17.7 + 1.3) * 0.022 +
      (Math.sin(time * 2.1) > 0.985 ? -0.09 : 0);
    this.uniforms.uFlicker.value = f;

    for (const s of this.sconces) {
      const i = Math.floor((time * 11 + s.phase) % s.frames.length);
      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      if (mat.map !== s.frames[i]) { mat.map = s.frames[i]; mat.needsUpdate = true; }
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.clear();
    this.sconces.length = 0;
    this.disposables.length = 0;
  }
}
