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
import { Grid, Tile, Surface, DIR_VEC } from './grid';
import { WALL_H, STEP_H, buildTileSet, buildSconce, colToHex } from '../art/tiles';
import type { Theme } from '../art/theme';
import type { Pix } from '../art/pixel';

const WORLD_VERT = /* glsl */ `
  attribute float alight;
  attribute float amurk;
  varying vec2 vUv;
  varying float vLight;
  varying float vMurk;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vLight = alight;
    vMurk = amurk;
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
  uniform vec3 uMurkCol;
  uniform float uMurkHere;
  varying vec2 vUv;
  varying float vLight;
  varying float vMurk;
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

    /*
     * A FOG BANK, in two parts, because it has to read from two places.
     *
     * FROM OUTSIDE: vMurk is how deep in the bank this surface stands, so the ground
     * goes pale and flat and you can see the edge of the thing from across the room.
     * That is what makes walking into it a decision.
     *
     * FROM INSIDE: uMurkHere is how fogged the tile the CAMERA is on is, and it
     * drives a second distance falloff so standing in the bank dissolves the room at
     * a few tiles whichever way you turn. Distance rather than depth, because from in
     * here the murk is between you and everything, including the clear floor beyond.
     *
     * AND IT IS LIT. uMurkCol is an albedo, not a colour — it goes through the same
     * illuminance the surface does, because fog is a thing in the room and not a
     * value written over the top of it. Unlit, a bank was a sheet of bright white
     * hanging in a black corridor, which read as a rendering fault rather than as
     * weather; lit, it is dark where the room is dark and it glows where your torch
     * reaches into it, which is what fog actually does.
     *
     * Mostly the LUMINANCE of that light and not its colour, though. Taking L whole
     * meant the murk wore the torch's hue, and a metre from a sconce that is not a
     * fog bank, it is a pink one. A third of the hue kept is enough to tie it to the
     * room's palette without the grey going anywhere.
     */
    float lum = dot(L, vec3(0.299, 0.587, 0.114));
    vec3 murk = uMurkCol * mix(vec3(lum), L, 0.33);

    /*
     * The two terms would otherwise COMPOUND. Standing in the bank, a wall one tile
     * away was taking the full pallor of being in the murk AND the distance falloff
     * on top of it, which is how the inside of a bank ended up a flat sheet with no
     * near wall in it. The tint is what makes the bank visible from outside, so it
     * fades out exactly as far as you are inside.
     */
    float bank = exp(-uMurkHere * 0.18 * d * d);
    c = mix(c, murk, vMurk * 0.42 * (1.0 - uMurkHere * 0.75));
    c = mix(murk, c, clamp(bank, 0.0, 1.0));

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
  uMurkCol: { value: THREE.Color };
  uMurkHere: { value: number };
  [k: string]: { value: unknown };
}

/** Buffers for one merged mesh. */
class MeshBuild {
  pos: number[] = [];
  uv: number[] = [];
  light: number[] = [];
  murk: number[] = [];
  idx: number[] = [];
  private n = 0;
  /** Fog depth for the next quad's corners, in the same order as the light. */
  fog: [number, number, number, number] = [0, 0, 0, 0];

  quad(
    a: [number, number, number], b: [number, number, number],
    c: [number, number, number], d: [number, number, number],
    la: number, lb: number, lc: number, ld: number,
    /** UV repeat, so a tall wall keeps square texels. */
    uw = 1, vh = 1,
    /**
     * Put v=0 on the FIRST pair of corners rather than the last.
     *
     * Walls need it and the reason is a convention that is easy to get backwards:
     * three.js uploads textures with `flipY = true` by default, so v=0 is the
     * BOTTOM row of the source image and v=1 is the top. A wall quad passes its
     * two floor corners first and its two ceiling corners last, so the default
     * layout below hands v=0 to the ceiling corners — and every wall in the game
     * was drawn upside down. Soot crept up from the skirting instead of down from
     * the ceiling, moss strands hung out of the floor, and the waterline sat a
     * third of the way up rather than two thirds down.
     *
     * Floors and ceilings do not pass it: their corners are wound spatially rather
     * than vertically, and flagstone noise and a barrel vault have no up.
     */
    flipV = false,
  ): void {
    this.pos.push(...a, ...b, ...c, ...d);
    const vLo = flipV ? 0 : vh;
    const vHi = flipV ? vh : 0;
    this.uv.push(0, vLo, uw, vLo, uw, vHi, 0, vHi);
    this.light.push(la, lb, lc, ld);
    this.murk.push(...this.fog);
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
    geo.setAttribute('amurk', new THREE.Float32BufferAttribute(this.murk, 1));
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
  private sconces: {
    mesh: THREE.Mesh; frames: THREE.Texture[]; phase: number; tile: [number, number];
  }[] = [];
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
      uMurkCol: { value: new THREE.Color(0x8d949c) },
      uMurkHere: { value: 0 },
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
        // Open air counts, walls do not: a gap carries baked light, so the lip of a
        // chasm is lit by the far side the way the room it sits in is.
        if (!g.seeThrough(x, y)) continue;
        sum += g.lightAt(x, y);
        n++;
      }
    }
    return n ? sum / n : 0;
  }

  /**
   * How deep in a fog bank a floor CORNER is, 0..1 — the same four-tile average the
   * light uses, and for the same reason: sampled per tile, the edge of a bank is a
   * hard sawtooth against the tile grid, and a bank with a hard edge reads as a
   * decal. Averaged per corner it has a shoreline.
   */
  private cornerMurk(cx: number, cy: number): number {
    const g = this.grid;
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 0; dy++) {
      for (let dx = -1; dx <= 0; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!g.seeThrough(x, y)) continue;
        sum += g.surfaceAt(x, y) === Surface.Fog ? 1 : 0;
        n++;
      }
    }
    return n ? sum / n : 0;
  }

  private build(seed: string): void {
    const g = this.grid;
    const tiles = buildTileSet(this.theme, seed, g.portals.length);
    const wallB = tiles.walls.map(() => new MeshBuild());
    const floorB = tiles.floors.map(() => new MeshBuild());
    const ceilB = tiles.ceils.map(() => new MeshBuild());
    /**
     * One batch per surface texture, exactly like the floor variants — a surface is
     * not a special case in the renderer, it is another texture a floor quad can go
     * to. That is what keeps the draw call count a small constant: the whole floor is
     * still one mesh per texture, and a floor carrying three surfaces costs three
     * more of them.
     */
    const ironB = tiles.iron.map(() => new MeshBuild());
    const waterB = tiles.water.map(() => new MeshBuild());
    const rubbleB = tiles.rubble.map(() => new MeshBuild());
    const fogB = tiles.fog.map(() => new MeshBuild());
    const ladderB = tiles.ladder.map(() => new MeshBuild());
    const portalB = tiles.portal.map(() => new MeshBuild());
    const surfaceB: Record<number, MeshBuild[]> = {
      [Surface.Iron]: ironB,
      [Surface.Water]: waterB,
      [Surface.Rubble]: rubbleB,
      [Surface.Fog]: fogB,
      [Surface.Ladder]: ladderB,
    };

    // ONE. Not `WALL_H`, which is what it used to be and what put a strip of the
    // top of every wall along the bottom of every wall.
    //
    // The repeat existed to keep texels square on a face taller than it is wide,
    // which would be right if the texture were square. It is not: `buildWall` makes
    // it `ppu()` by `ppu() * WALL_H`, so it already HAS the quad's aspect and the
    // mapping is 1:1 as it stands. Repeating V by 1.05 on top of that walked the
    // sample 5% past the bottom of the texture, and the wrap mode is `Repeat`, so
    // that last 5% came back around as the texture's first rows — the
    // ceiling-shaded, sooted, strand-hung top edge, drawn at the floor.
    //
    // Which is why it read as upside-down, and why it read that way on some floors
    // more than others: what lands in that strip is whatever the theme puts along
    // its top edge, so the Ossuary showed soot at the skirting and the moss floor
    // grew hanging strands out of the ground.
    const wallVh = 1;

    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const kind = g.at(x, y);
        if (kind === Tile.Wall) continue;
        /**
         * A GAP gets no floor and no wall face, and keeps its ceiling.
         *
         * Which is the whole of its geometry: the hole in the floor IS the absent
         * quad, and a full-height wall along its edge would be the renderer calling
         * it a wall after the grid went to the trouble of saying it is not one — you
         * are meant to see across it. What is under it is Verticality's question; a
         * bottomless black is the honest answer until there is one.
         */
        const gap = kind === Tile.Gap;
        const v = g.variant[g.idx(x, y)];
        /**
         * THIS TILE'S FLOOR, and everything else on it, is built off `e`.
         *
         * The whole of the renderer's half of verticality is this one number and the
         * risers it implies. Floor at `e`, ceiling at `e + WALL_H` — the headroom
         * follows the ground rather than staying flat, so a sunken room is a sunken
         * ROOM and not a room with a taller ceiling, and a terrace does not grow up
         * through a vault that stayed where it was.
         */
        const e = g.heightAt(x, y) * STEP_H;

        // corner lights, shared by floor and ceiling
        const l00 = this.cornerLight(x, y);
        const l10 = this.cornerLight(x + 1, y);
        const l11 = this.cornerLight(x + 1, y + 1);
        const l01 = this.cornerLight(x, y + 1);

        // corner fog depth, same four corners, carried into every quad of this tile
        const m00 = this.cornerMurk(x, y);
        const m10 = this.cornerMurk(x + 1, y);
        const m11 = this.cornerMurk(x + 1, y + 1);
        const m01 = this.cornerMurk(x, y + 1);

        // Floor, normal +y. Winding runs from the far edge to the near edge —
        // the opposite order reads as facing down and gets backface-culled.
        if (!gap) {
          const surf = g.surfaceAt(x, y);
          let fb: MeshBuild;
          if (surf === Surface.Portal) {
            // A mouth belongs to its PAIR's batch, which is what makes two of them
            // the same colour and no two pairs the same.
            const pair = g.portals.findIndex((p) => p.a === g.idx(x, y) || p.b === g.idx(x, y));
            fb = portalB[pair >= 0 ? pair : 0] ?? floorB[v % floorB.length];
          } else {
            const set = surfaceB[surf];
            fb = set ? set[v % set.length] : floorB[v % floorB.length];
          }
          fb.fog = [m01, m11, m10, m00];
          fb.quad(
            [x - 0.5, e, y + 0.5], [x + 0.5, e, y + 0.5],
            [x + 0.5, e, y - 0.5], [x - 0.5, e, y - 0.5],
            l01, l11, l10, l00,
          );
        }

        // Ceiling, normal -y (pointing down at the player).
        const cb = ceilB[v % ceilB.length];
        cb.fog = [m00, m10, m11, m01];
        cb.quad(
          [x - 0.5, e + WALL_H, y - 0.5], [x + 0.5, e + WALL_H, y - 0.5],
          [x + 0.5, e + WALL_H, y + 0.5], [x - 0.5, e + WALL_H, y + 0.5],
          l00 * 0.55, l10 * 0.55, l11 * 0.55, l01 * 0.55,
        );

        /**
         * RISERS: the step face between this tile and a lower neighbour.
         *
         * Drawn from the HIGH tile and only downward, so exactly one of any pair of
         * neighbours draws the face between them and it is never drawn twice. Two of
         * them per edge, because the ceiling steps with the floor: the ledge itself,
         * from the low floor up to this one, and the soffit above it, from the low
         * ceiling up to this one. Without the second, a terrace has daylight over the
         * step — a strip of nothing where the two ceilings fail to meet.
         *
         * Wall texture on both, because that is what the side of a stone step is, and
         * it means the risers cost no new art and land in the same batches.
         */
        for (let f = 0; f < 4; f++) {
          const [dx, dy] = DIR_VEC[f];
          const nx = x + dx, ny = y + dy;
          if (!g.seeThrough(nx, ny)) continue;      // a wall face covers that edge
          const ne = g.heightAt(nx, ny) * STEP_H;
          if (ne >= e) continue;                    // the low side never draws it

          const wb = wallB[(v + f * 3) % wallB.length];
          const wm = g.surfaceAt(x, y) === Surface.Fog ? 1 : 0;
          wb.fog = [wm, wm, wm, wm];
          const lb = g.lightAt(x, y);

          // the shared edge between (x,y) and its lower neighbour
          const hx = dx * 0.5, hz = dy * 0.5;
          const ex = dy * 0.5, ez = -dx * 0.5;
          const ax = x + hx + ex, az = y + hz + ez;
          const bx = x + hx - ex, bz = y + hz - ez;

          // the ledge, facing the low side
          wb.quad(
            [ax, ne, az], [bx, ne, bz],
            [bx, e, bz], [ax, e, az],
            lb * 0.7, lb * 0.7, lb, lb,
            1, (e - ne) / WALL_H, true,
          );
          // the soffit over it, same edge, between the two ceilings
          wb.quad(
            [ax, ne + WALL_H, az], [bx, ne + WALL_H, bz],
            [bx, e + WALL_H, bz], [ax, e + WALL_H, az],
            lb * 0.45, lb * 0.45, lb * 0.3, lb * 0.3,
            1, (e - ne) / WALL_H, true,
          );
        }

        // walls: one quad per solid neighbour, facing inward
        for (let f = 0; f < 4; f++) {
          const [dx, dy] = DIR_VEC[f];
          const nx = x + dx, ny = y + dy;
          if (g.seeThrough(nx, ny)) continue;

          const wb = wallB[(v + f * 3) % wallB.length];
          // A wall bounding a fogged tile is in the bank too, or the murk would stop
          // dead at the skirting and the room's edges would stay crisp inside it.
          const wm = g.surfaceAt(x, y) === Surface.Fog ? 1 : 0;
          wb.fog = [wm, wm, wm, wm];
          const lb = g.lightAt(x, y);
          // top of a wall is shaded — the ceiling occludes it
          const lt = lb * 0.45;

          // corners of the shared edge between (x,y) and the wall tile
          const hx = dx * 0.5, hz = dy * 0.5;
          // edge direction perpendicular to the face
          const ex = dy * 0.5, ez = -dx * 0.5;
          const ax = x + hx + ex, az = y + hz + ez;
          const bx = x + hx - ex, bz = y + hz - ez;

          /**
           * A wall face runs from THIS tile's floor to THIS tile's ceiling.
           *
           * Not from zero: a wall bounding a sunken room has to start at the sunken
           * floor or the room has a strip of void round its skirting, and one
           * bounding a terrace has to stop at the terrace's ceiling or it stands
           * proud of the vault it is holding up.
           */
          wb.quad(
            [ax, e, az], [bx, e, bz],
            [bx, e + WALL_H, bz], [ax, e + WALL_H, az],
            lb, lb, lt, lt,
            1, wallVh, true,
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
    addAll(ironB, tiles.iron);
    addAll(waterB, tiles.water);
    addAll(rubbleB, tiles.rubble);
    addAll(fogB, tiles.fog);
    addAll(ladderB, tiles.ladder);
    addAll(portalB, tiles.portal);

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
      this.sconces.push({
        mesh: m, frames, phase: (L.x * 7.13 + L.y * 3.71) % 6.283, tile: [L.x, L.y],
      });
    }
  }

  /** Per-frame: torch flicker + sconce animation + how deep in the murk the eye is. */
  update(time: number, camPos: THREE.Vector3): void {
    (this.uniforms.uCam.value as THREE.Vector3).copy(camPos);

    /**
     * The camera's own fog depth, EASED rather than switched.
     *
     * Read off the tile the eye is over, which moves continuously during a step, so
     * a hard read would snap the whole room from clear to blind on the frame the
     * player crosses the shoreline. Chasing it at a fixed rate per frame gives the
     * bank a threshold you walk through instead of a light switch.
     */
    const g = this.grid;
    const want = g.surfaceAt(Math.round(camPos.x), Math.round(camPos.z)) === Surface.Fog ? 1 : 0;
    const at = this.uniforms.uMurkHere.value as number;
    this.uniforms.uMurkHere.value = at + (want - at) * 0.08;

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

      /**
       * A TORCH HAS TO GO INTO THE FOG TOO.
       *
       * The sconce is the one thing in the scene drawn with a plain unlit material —
       * deliberately, because a light source must never look shadowed — and that made
       * it the one thing a fog bank could not touch. The result read as a sorting
       * fault: a crisp, full-brightness flame apparently hanging in FRONT of a wall
       * of murk that had swallowed the wall it is bolted to.
       *
       * It fades rather than greys, because a flame does not go pale, it goes away —
       * and the halo it should leave behind is already there, since the light it
       * casts is baked into the wall the murk is lit by. Same two terms as everything
       * else: its own tile's bank, and the camera's.
       */
      const here = this.uniforms.uMurkHere.value as number;
      const bank = g.surfaceAt(s.tile[0], s.tile[1]) === Surface.Fog ? 1 : 0;
      const dist = camPos.distanceTo(s.mesh.position);
      // Both terms exactly as the walls have them, including the bank term standing
      // down once you are inside — otherwise the two stacked and a torch on a wall
      // you can plainly see, two tiles away, was not drawn at all.
      const lost = Math.min(1, bank * 0.6 * (1 - here * 0.75)
        + (1 - Math.exp(-here * 0.18 * dist * dist)));
      mat.opacity = 1 - lost;
      mat.visible = mat.opacity > 0.02;
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.clear();
    this.sconces.length = 0;
    this.disposables.length = 0;
  }
}
