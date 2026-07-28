/**
 * The subset of ai-asylum/spellbook's style/toon.ts that the grimoire needs:
 * the shared shader clock, the 3-step gradient ramp, primitive builders, the
 * vertex-colour merge, and the inverted-hull outline shell.
 *
 * The outline shell is load-bearing for the look — a toon-shaded book without an
 * ink keyline reads as untextured plastic.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Shared time uniform, ticked once per frame. */
export const shaderTime = { value: 0 };

export function tickShaders(t: number): void {
  shaderTime.value = t;
}

const rampCache = new Map<string, THREE.DataTexture>();

/** A hard N-step gradient map — the toon ramp. */
export function gradientMap(steps: number[] = [0.35, 0.7, 1.0]): THREE.DataTexture {
  const key = steps.join(',');
  const hit = rampCache.get(key);
  if (hit) return hit;
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((s, i) => {
    const v = Math.round(Math.max(0, Math.min(1, s)) * 255);
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  });
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  rampCache.set(key, tex);
  return tex;
}

export function darken(color: number, factor: number): number {
  return new THREE.Color(color).multiplyScalar(factor).getHex();
}

export function lighten(color: number, factor: number): number {
  return new THREE.Color(color).lerp(new THREE.Color(0xffffff), factor).getHex();
}

/** Push every vertex out along its normal — the inverted-hull outline shell. */
export function shellGeometry(geo: THREE.BufferGeometry, offset: number): THREE.BufferGeometry {
  const out = geo.clone();
  if (!out.attributes.normal) out.computeVertexNormals();
  const pos = out.attributes.position as THREE.BufferAttribute;
  const nor = out.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + nor.getX(i) * offset,
      pos.getY(i) + nor.getY(i) * offset,
      pos.getZ(i) + nor.getZ(i) * offset,
    );
  }
  pos.needsUpdate = true;
  return out;
}

function place(
  geo: THREE.BufferGeometry, x: number, y: number, z: number, rot?: THREE.Euler,
): THREE.BufferGeometry {
  if (rot) geo.rotateX(rot.x), geo.rotateY(rot.y), geo.rotateZ(rot.z);
  geo.translate(x, y, z);
  return geo;
}

export function box(
  w: number, h: number, d: number, x = 0, y = 0, z = 0, rot?: THREE.Euler,
): THREE.BufferGeometry {
  return place(new THREE.BoxGeometry(w, h, d), x, y, z, rot);
}

export function cyl(
  rt: number, rb: number, h: number, seg = 10, x = 0, y = 0, z = 0, rot?: THREE.Euler,
): THREE.BufferGeometry {
  return place(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rot);
}

export function sphere(r: number, x = 0, y = 0, z = 0, wSeg = 10, hSeg = 8): THREE.BufferGeometry {
  return place(new THREE.SphereGeometry(r, wSeg, hSeg), x, y, z);
}

export function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const anyNonIndexed = geos.some((g) => !g.index);
  const list = anyNonIndexed ? geos.map((g) => (g.index ? g.toNonIndexed() : g)) : geos;
  const merged = mergeGeometries(list, false)!;
  geos.forEach((g) => g.dispose());
  return merged;
}

/** Merge differently-coloured primitives into ONE mesh via baked vertex colours. */
export function mergeColored(parts: { geo: THREE.BufferGeometry; color: number }[]): THREE.BufferGeometry {
  const c = new THREE.Color();
  for (const p of parts) {
    const g = p.geo;
    c.setHex(p.color);
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return mergeGeos(parts.map((p) => p.geo));
}
