/**
 * The living page shader. One material drives every page state:
 *  - uProgress 0..1: curl-flip around the spine (0 = lying right, 1 = left)
 *    with paper lag + mid-flip bow, so static pages (0.02 / 0.98) get a
 *    natural resting bow and flips look like real paper
 *  - front/back textures (back mirrored so it reads correctly when landed)
 *  - uReveal: golden dissolve for page regrowth after a rip
 *  - uFlutter/uGlow: floating ripped-page life + merge charge glow
 */
import * as THREE from 'three';
import { shaderTime } from '../style/toon';

export const PAGE_W = 0.155;
export const PAGE_H = 0.205;

const VERT = /* glsl */ `
uniform float uProgress;
uniform float uTime;
uniform float uFlutter;
uniform float uW;
varying vec2 vUv;
varying float vShade;
void main() {
  vUv = uv;
  float u = clamp(position.x / uW, 0.0, 1.0);
  float A = uProgress * 3.14159265;
  // paper physics: outer edge lags the base, sheet bows mid-flip
  float a = A - sin(A) * 0.42 * u + sin(A) * sin(u * 3.14159265) * 0.14;
  float fl = uFlutter * (
    sin(uTime * 2.1 + u * 4.0 + position.y * 5.0) * 0.006 +
    sin(uTime * 3.6 + u * 8.0) * 0.0035
  ) * u;
  vec3 p = vec3(cos(a) * position.x, position.y, sin(a) * position.x + fl);
  // simple curl shading: faces catching light as the sheet turns
  vShade = 0.84 + 0.16 * cos(a - 0.35);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMapFront;
uniform sampler2D uMapBack;
uniform float uReveal;
uniform float uGlow;
uniform float uTime;
uniform vec3 uGold;
uniform float uSealed;
varying vec2 vUv;
varying float vShade;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  vec4 tex = gl_FrontFacing
    ? texture2D(uMapFront, vUv)
    : texture2D(uMapBack, vec2(1.0 - vUv.x, vUv.y));
  if (tex.a < 0.5) discard;

  // regrow dissolve: page materializes from noise, golden burning edge
  float n = vnoise(vUv * 6.5) * 0.8 + vnoise(vUv * 19.0) * 0.2;
  if (n > uReveal + 0.001) discard;
  float edge = smoothstep(uReveal - 0.14, uReveal, n);

  vec3 col = tex.rgb * vShade;

  // A SEALED page: a spell you have not learned yet. Drained of colour and
  // pushed down toward cold grey, so an unavailable page is obvious at a glance
  // instead of being discovered by the tear silently refusing.
  if (uSealed > 0.5) {
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum) * 0.62 + vec3(0.05, 0.05, 0.09), 0.86);
  }
  // spine contact shadow
  col *= 0.86 + 0.14 * smoothstep(0.0, 0.22, vUv.x);
  // golden edge + charge glow
  col += uGold * edge * 1.6;
  float shimmer = 0.85 + 0.15 * sin(uTime * 5.0 + vUv.x * 9.0);
  col += uGold * uGlow * shimmer * 0.55;
  gl_FragColor = vec4(col, 1.0);
}`;

export interface PageMaterial extends THREE.ShaderMaterial {
  uniforms: {
    uMapFront: { value: THREE.Texture };
    uMapBack: { value: THREE.Texture };
    uProgress: { value: number };
    uReveal: { value: number };
    uFlutter: { value: number };
    uGlow: { value: number };
    uTime: { value: number };
    uW: { value: number };
    uGold: { value: THREE.Color };
    uSealed: { value: number };
  };
}

export function pageMaterial(front: THREE.Texture, back: THREE.Texture): PageMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMapFront: { value: front },
      uMapBack: { value: back },
      uProgress: { value: 0.02 },
      uReveal: { value: 1.01 },
      uFlutter: { value: 0 },
      uGlow: { value: 0 },
      uTime: shaderTime,
      uW: { value: PAGE_W },
      uGold: { value: new THREE.Color(0xffc23e) },
      uSealed: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
  }) as PageMaterial;
}

/** Page plane hinged at the spine: x ∈ [0, PAGE_W]. */
export function pageGeometry(segs = 26): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(PAGE_W, PAGE_H, segs, 8);
  geo.translate(PAGE_W / 2, 0, 0);
  return geo;
}
