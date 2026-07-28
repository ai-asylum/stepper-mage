/**
 * The golden page aura, ported from ai-asylum/spellbook's style/fx.ts.
 * Glow is additive transparent geometry rather than a post effect, which is what
 * lets a torn-out page look lit from inside while sitting over a dark dungeon.
 */
import * as THREE from 'three';
import { shaderTime } from './toon';

const PAGE_GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const PAGE_GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  // distance to nearest edge -> edge-hugging halo
  vec2 d2 = min(vUv, 1.0 - vUv);
  float d = min(d2.x, d2.y);
  float edge = smoothstep(0.09, 0.0, d) * 0.75;
  // faint body fill
  float body = 0.06 * smoothstep(0.4, 0.0, d);
  // travelling diagonal shine, only near the rim
  float band = fract(vUv.x * 0.8 + vUv.y * 0.4 - uTime * 0.35);
  float shine = smoothstep(0.1, 0.0, abs(band - 0.5) - 0.02) * 0.35;
  float a = (edge + body + shine * edge) * uIntensity;
  float pulse = 0.85 + 0.15 * sin(uTime * 4.0);
  gl_FragColor = vec4(uColor * a * pulse, a * pulse);
}`;

export function pageGlowMat(color: number, intensity = 1.0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: shaderTime,
      uIntensity: { value: intensity },
    },
    vertexShader: PAGE_GLOW_VERT,
    fragmentShader: PAGE_GLOW_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
