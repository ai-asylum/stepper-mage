/**
 * Canvas-painted spell pages: parchment, hand-inked wobbly borders
 * (chesthero ink language), spell sigils with baked glow, flavor script.
 * Every spell gets: an action page (right), a lore page (left), and a
 * torn variant of the action page for the ripped floating copy.
 */
import * as THREE from 'three';
import { CHAPTERS, type SpellDef } from '../spells/pages';
import { chapters } from '../style/palette';

const W = 512;
const H = 660;
const INK = '#3d2e50';
const INK_SOFT = 'rgba(61,46,80,0.55)';

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

// deterministic-ish wobble
function wob(seed: number, t: number, freq = 5): number {
  return Math.sin(t * freq + seed * 1.7) * 0.65 + Math.sin(t * freq * 2.1 + seed * 0.9) * 0.35;
}

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return [c, c.getContext('2d')!];
}

// ------------------------------------------------------------- parchment
function parchment(ctx: CanvasRenderingContext2D, seed: number, spineShadowLeft = true) {
  ctx.fillStyle = '#fdf3dc';
  ctx.fillRect(0, 0, W, H);
  // blotches
  for (let i = 0; i < 14; i++) {
    const x = ((Math.sin(seed * 31 + i * 17.3) + 1) / 2) * W;
    const y = ((Math.sin(seed * 47 + i * 29.7) + 1) / 2) * H;
    const r = 40 + ((Math.sin(i * 7.7 + seed) + 1) / 2) * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(214,186,138,0.10)');
    g.addColorStop(1, 'rgba(214,186,138,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // edge vignette
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.72);
  g.addColorStop(0, 'rgba(160,120,70,0)');
  g.addColorStop(1, 'rgba(160,120,70,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // spine-side shadow (left edge of a right page)
  if (spineShadowLeft) {
    const sg = ctx.createLinearGradient(0, 0, 90, 0);
    sg.addColorStop(0, 'rgba(120,90,50,0.28)');
    sg.addColorStop(1, 'rgba(120,90,50,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, 90, H);
  }
  // speckles
  for (let i = 0; i < 60; i++) {
    const x = ((Math.sin(seed * 3 + i * 12.9) + 1) / 2) * W;
    const y = ((Math.sin(seed * 5 + i * 8.3) + 1) / 2) * H;
    ctx.fillStyle = `rgba(120,90,50,${0.04 + (i % 5) * 0.012})`;
    ctx.fillRect(x, y, 1.6, 1.6);
  }
}

/** Hand-inked line: living stroke weight + subtle path wobble. */
function inkPath(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  width: number,
  seed: number,
  color = INK
) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < pts.length - 1; i++) {
    const t = i / (pts.length - 1);
    ctx.lineWidth = Math.max(0.6, width * (1 + wob(seed, t * 6.28) * 0.28));
    ctx.beginPath();
    const j1 = wob(seed + 3, t * 9) * 1.3;
    const j2 = wob(seed + 7, t * 9 + 0.4) * 1.3;
    ctx.moveTo(pts[i][0] + j1, pts[i][1] + j2);
    ctx.lineTo(pts[i + 1][0] + j1 * 0.6, pts[i + 1][1] + j2 * 0.6);
    ctx.stroke();
  }
}

function inkRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, width: number, seed: number) {
  const n = 14;
  const edges: [number, number][][] = [[], [], [], []];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    edges[0].push([x + w * t, y]);
    edges[1].push([x + w, y + h * t]);
    edges[2].push([x + w * (1 - t), y + h]);
    edges[3].push([x, y + h * (1 - t)]);
  }
  edges.forEach((e, i) => inkPath(ctx, e, width, seed + i * 11));
}

function inkCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, width: number, seed: number, color = INK) {
  const n = 40;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + wob(seed, a) * 0.02);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  inkPath(ctx, pts, width, seed, color);
}

function border(ctx: CanvasRenderingContext2D, seed: number) {
  inkRect(ctx, 22, 22, W - 44, H - 44, 3.2, seed);
  inkRect(ctx, 34, 34, W - 68, H - 68, 1.4, seed + 50);
  // corner diamonds
  const corners = [
    [28, 28],
    [W - 28, 28],
    [28, H - 28],
    [W - 28, H - 28],
  ];
  ctx.fillStyle = INK;
  for (const [cx, cy] of corners) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4 + wob(seed, cx + cy) * 0.1);
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
  }
}

// ------------------------------------------------------------- sigils
export type SigilFn = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, colors: { main: string; glow: string; deep: string }) => void;

const sigilFire: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 30;
  // outer flame
  ctx.fillStyle = c.main;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.bezierCurveTo(cx + r * 0.85, cy - r * 0.25, cx + r * 0.6, cy + r * 0.65, cx, cy + r * 0.8);
  ctx.bezierCurveTo(cx - r * 0.6, cy + r * 0.65, cx - r * 0.85, cy - r * 0.25, cx, cy - r);
  ctx.fill();
  // inner flame
  ctx.shadowBlur = 14;
  ctx.fillStyle = c.glow;
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.05, cy - r * 0.4);
  ctx.bezierCurveTo(cx + r * 0.42, cy - r * 0.02, cx + r * 0.32, cy + r * 0.5, cx, cy + r * 0.62);
  ctx.bezierCurveTo(cx - r * 0.32, cy + r * 0.5, cx - r * 0.4, cy + r * 0.05, cx + r * 0.05, cy - r * 0.4);
  ctx.fill();
  // hot core
  ctx.fillStyle = '#fff8e8';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.3, r * 0.14, r * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // embers
  ctx.fillStyle = c.glow;
  for (let i = 0; i < 5; i++) {
    const a = i * 1.4 + 0.4;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r * (0.75 + (i % 2) * 0.32), cy - r * 0.55 - i * 9, 3.4 - i * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
};

const sigilFrost: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.main;
  ctx.shadowBlur = 22;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const ex = cx + Math.cos(a) * r * 0.92;
    const ey = cy + Math.sin(a) * r * 0.92;
    inkPath(ctx, [[cx, cy], [ex, ey]], 5, i * 7, c.deep);
    // branch ticks
    for (const f of [0.45, 0.68]) {
      const bx = cx + Math.cos(a) * r * f;
      const by = cy + Math.sin(a) * r * f;
      for (const s of [-1, 1]) {
        const ba = a + (s * Math.PI) / 4;
        inkPath(ctx, [[bx, by], [bx + Math.cos(ba) * r * 0.18, by + Math.sin(ba) * r * 0.18]], 3.4, i * 13 + f * 10, c.main);
      }
    }
    // tip crystals
    ctx.fillStyle = c.glow;
    ctx.beginPath();
    ctx.arc(ex, ey, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = c.glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const sigilGrowth: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.main;
  ctx.shadowBlur = 20;
  // stem
  const stem: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    stem.push([cx + Math.sin(t * 2.4) * r * 0.14, cy + r * 0.85 - t * r * 1.5]);
  }
  inkPath(ctx, stem, 6, 3, c.deep);
  // leaves
  const leaf = (lx: number, ly: number, dir: number, s: number) => {
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.quadraticCurveTo(lx + dir * r * 0.5 * s, ly - r * 0.28 * s, lx + dir * r * 0.62 * s, ly - r * 0.02 * s);
    ctx.quadraticCurveTo(lx + dir * r * 0.34 * s, ly + r * 0.22 * s, lx, ly);
    ctx.fill();
  };
  leaf(cx + r * 0.05, cy + r * 0.3, 1, 1);
  leaf(cx - r * 0.02, cy + r * 0.05, -1, 0.85);
  leaf(cx + r * 0.1, cy - r * 0.25, 1, 0.6);
  // sprout tip glow
  ctx.fillStyle = c.glow;
  ctx.beginPath();
  ctx.arc(cx + Math.sin(2.4) * r * 0.14, cy - r * 0.68, 7, 0, Math.PI * 2);
  ctx.fill();
  // ascending chevrons
  ctx.strokeStyle = c.main;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    const yy = cy - r * (0.82 + i * 0.22);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.2, yy + r * 0.1);
    ctx.lineTo(cx, yy);
    ctx.lineTo(cx + r * 0.2, yy + r * 0.1);
    ctx.stroke();
  }
  ctx.restore();
};

const sigilMulti: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.main;
  ctx.shadowBlur = 20;
  const ox = cx;
  const oy = cy + r * 0.75;
  for (const spread of [-0.55, 0, 0.55]) {
    const tx = cx + Math.sin(spread) * r * 1.05;
    const ty = cy - Math.cos(spread) * r * 0.95;
    inkPath(ctx, [[ox, oy], [tx, ty]], 5, spread * 17, c.deep);
    // arrowhead
    const a = Math.atan2(ty - oy, tx - ox);
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.moveTo(tx + Math.cos(a) * 16, ty + Math.sin(a) * 16);
    ctx.lineTo(tx + Math.cos(a + 2.5) * 13, ty + Math.sin(a + 2.5) * 13);
    ctx.lineTo(tx + Math.cos(a - 2.5) * 13, ty + Math.sin(a - 2.5) * 13);
    ctx.fill();
  }
  // origin burst
  ctx.fillStyle = c.glow;
  ctx.beginPath();
  ctx.arc(ox, oy, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const sigilSummon: SigilFn = (ctx, cx, cy, r, c) => {
  // a four-point summoning star over three clay mounds heaving from the ground
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 26;
  const sx = cx;
  const sy = cy - r * 0.32;
  const R = r * 0.62;
  const star = (scale: number, fill: string) => {
    const o = R * scale;
    const inn = o * 0.24;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(sx, sy - o);
    ctx.quadraticCurveTo(sx + inn, sy - inn, sx + o, sy);
    ctx.quadraticCurveTo(sx + inn, sy + inn, sx, sy + o);
    ctx.quadraticCurveTo(sx - inn, sy + inn, sx - o, sy);
    ctx.quadraticCurveTo(sx - inn, sy - inn, sx, sy - o);
    ctx.fill();
  };
  star(1, c.main);
  ctx.shadowBlur = 12;
  star(0.55, c.glow);
  star(0.22, '#fff8e8');
  ctx.restore();
  // orbit ring around the star, hand-inked
  inkCircle(ctx, sx, sy, R * 1.12, 2.2, 21, c.deep);
  // two attendant sparkles riding the orbit
  ctx.fillStyle = c.glow;
  for (const a of [0.6, 3.9]) {
    ctx.beginPath();
    ctx.arc(sx + Math.cos(a) * R * 1.12, sy + Math.sin(a) * R * 1.12, 4.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // golden motes sift down toward the waking clay
  ctx.fillStyle = c.main;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(sx + Math.sin(i * 2.4) * r * 0.28, sy + R * 1.3 + i * r * 0.11, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // three clay mounds glooping out of the ground line
  const gy = cy + r * 0.82;
  ctx.save();
  ctx.shadowColor = c.main;
  ctx.shadowBlur = 8;
  ctx.fillStyle = c.deep;
  for (const [mx, mr] of [[-0.42, 0.26], [0.02, 0.34], [0.44, 0.22]] as const) {
    ctx.beginPath();
    ctx.arc(cx + mx * r, gy, mr * r, Math.PI, 0);
    ctx.fill();
  }
  ctx.restore();
  inkPath(ctx, [[cx - r * 0.8, gy], [cx + r * 0.8, gy]], 3, 17, c.deep);
};

const sigilSkull: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.main;
  ctx.shadowBlur = 24;
  // cranium
  ctx.fillStyle = c.glow;
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.18, r * 0.62, Math.PI, 0);
  ctx.bezierCurveTo(cx + r * 0.62, cy + r * 0.35, cx + r * 0.4, cy + r * 0.42, cx + r * 0.34, cy + r * 0.5);
  ctx.lineTo(cx - r * 0.34, cy + r * 0.5);
  ctx.bezierCurveTo(cx - r * 0.4, cy + r * 0.42, cx - r * 0.62, cy + r * 0.35, cx - r * 0.62, cy - r * 0.18);
  ctx.fill();
  // jaw
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.3, cy + r * 0.48);
  ctx.quadraticCurveTo(cx, cy + r * 0.92, cx + r * 0.3, cy + r * 0.48);
  ctx.fill();
  ctx.restore();
  // eye sockets (dark, sunken)
  ctx.fillStyle = c.deep;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + sx * r * 0.28, cy - r * 0.08, r * 0.2, r * 0.24, sx * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // a sickly glint in the sockets
  ctx.fillStyle = c.main;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + sx * r * 0.24, cy - r * 0.02, r * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }
  // nose cavity
  ctx.fillStyle = c.deep;
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.14);
  ctx.lineTo(cx - r * 0.09, cy + r * 0.36);
  ctx.lineTo(cx + r * 0.09, cy + r * 0.36);
  ctx.fill();
  // teeth ticks along the jawline
  for (let i = -2; i <= 2; i++) {
    inkPath(
      ctx,
      [[cx + i * r * 0.13, cy + r * 0.5], [cx + i * r * 0.13, cy + r * 0.68]],
      2.4,
      i * 5,
      c.deep
    );
  }
  // crooked stitch across the cranium (undead charm)
  inkPath(ctx, [[cx - r * 0.5, cy - r * 0.36], [cx - r * 0.28, cy - r * 0.5], [cx - r * 0.06, cy - r * 0.34]], 2.6, 4, c.deep);
};

const sigilSpark: SigilFn = (ctx, cx, cy, r, c) => {
  // the classic bolt glyph striking through a storm ring broken where it
  // enters and exits (segments hand-inked separately — never erased)
  const arc = (a0: number, a1: number, seed: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 14; i++) {
      const a = a0 + ((a1 - a0) * i) / 14;
      const rr = r * 0.9 * (1 + wob(seed, a) * 0.03);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    inkPath(ctx, pts, 2.6, seed, c.deep);
  };
  arc(-0.9, 1.75, 13); // right side, open where the bolt enters top-left…
  arc(2.4, 4.6, 27); // …and exits bottom-right
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 26;
  // the bolt blade (non-self-intersecting — fills clean)
  const bolt: [number, number][] = [
    [cx + r * 0.28, cy - r * 0.95],
    [cx - r * 0.34, cy + r * 0.08],
    [cx - r * 0.05, cy + r * 0.1],
    [cx - r * 0.24, cy + r * 0.9],
    [cx + r * 0.36, cy - r * 0.14],
    [cx + r * 0.06, cy - r * 0.16],
  ];
  ctx.fillStyle = c.main;
  ctx.beginPath();
  bolt.forEach(([x, y], i) => {
    const wx = x + wob(7, i * 1.7) * 3;
    const wy = y + wob(11, i * 2.3) * 3;
    if (i === 0) ctx.moveTo(wx, wy);
    else ctx.lineTo(wx, wy);
  });
  ctx.closePath();
  ctx.fill();
  // hot inner streak down the blade
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#f2f5ff';
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.17, cy - r * 0.78);
  ctx.lineTo(cx - r * 0.2, cy + r * 0.04);
  ctx.lineTo(cx - r * 0.02, cy + r * 0.055);
  ctx.lineTo(cx - r * 0.16, cy + r * 0.66);
  ctx.lineTo(cx + r * 0.14, cy - r * 0.08);
  ctx.lineTo(cx - r * 0.02, cy - r * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // the landing spark at the tip
  ctx.fillStyle = c.glow;
  ctx.beginPath();
  ctx.arc(cx - r * 0.24, cy + r * 0.92, 6, 0, Math.PI * 2);
  ctx.fill();
  // static ticks radiating off the strike point
  for (let i = 0; i < 4; i++) {
    const a = 1.2 + i * 0.75;
    const sx = cx - r * 0.24 + Math.cos(a) * r * 0.2;
    const sy = cy + r * 0.92 + Math.sin(a) * r * 0.14;
    inkPath(ctx, [[sx, sy], [sx + Math.cos(a) * r * 0.14, sy + Math.sin(a) * r * 0.1]], 2.6, i * 9, c.main);
  }
};

const sigilStone: SigilFn = (ctx, cx, cy, r, c) => {
  // a faceted boulder mid-fall — motion ticks above, impact ticks below.
  // deliberately the quietest sigil in the book: stone doesn't glow
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 8;
  const face: [number, number][] = [
    [cx - r * 0.6, cy - r * 0.1],
    [cx - r * 0.3, cy - r * 0.55],
    [cx + r * 0.25, cy - r * 0.6],
    [cx + r * 0.62, cy - r * 0.12],
    [cx + r * 0.48, cy + r * 0.42],
    [cx - r * 0.12, cy + r * 0.56],
    [cx - r * 0.52, cy + r * 0.32],
  ];
  ctx.fillStyle = c.main;
  ctx.beginPath();
  face.forEach(([x, y], i) => {
    const wx = x + wob(23, i * 2.3) * 3;
    const wy = y + wob(31, i * 1.9) * 3;
    if (i === 0) ctx.moveTo(wx, wy);
    else ctx.lineTo(wx, wy);
  });
  ctx.closePath();
  ctx.fill();
  // two ochre strata bands crossing the face
  ctx.fillStyle = c.glow;
  ctx.save();
  ctx.beginPath();
  face.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = 0.55;
  ctx.fillRect(cx - r * 0.7, cy - r * 0.08, r * 1.4, r * 0.11);
  ctx.fillRect(cx - r * 0.7, cy + r * 0.22, r * 1.4, r * 0.08);
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.restore();
  // facet lines, hand-inked
  inkPath(ctx, [[cx - r * 0.3, cy - r * 0.55], [cx - r * 0.05, cy - r * 0.05], [cx - r * 0.12, cy + r * 0.56]], 2.6, 5, c.deep);
  inkPath(ctx, [[cx + r * 0.25, cy - r * 0.6], [cx - r * 0.05, cy - r * 0.05]], 2.4, 11, c.deep);
  inkPath(ctx, [[cx - r * 0.05, cy - r * 0.05], [cx + r * 0.48, cy + r * 0.42]], 2.4, 17, c.deep);
  // the outline itself, inked over the fill
  inkPath(ctx, [...face, face[0]], 3.2, 29, c.deep);
  // motion ticks above (it is coming down fast)
  for (const [dx, len] of [[-0.25, 0.22], [0.05, 0.3], [0.3, 0.2]] as const) {
    inkPath(
      ctx,
      [[cx + dx * r, cy - r * 0.95], [cx + dx * r - r * 0.06, cy - r * 0.95 + len * r]],
      2.8,
      dx * 40,
      c.deep
    );
  }
  // impact ticks + pebbles at the ground line below
  inkPath(ctx, [[cx - r * 0.85, cy + r * 0.85], [cx + r * 0.85, cy + r * 0.85]], 3, 41, c.deep);
  ctx.fillStyle = c.main;
  for (const [px, pr] of [[-0.6, 0.07], [0.55, 0.08], [0.72, 0.05]] as const) {
    ctx.beginPath();
    ctx.arc(cx + px * r, cy + r * 0.8, pr * r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const s of [-1, 1]) {
    inkPath(
      ctx,
      [[cx + s * r * 0.3, cy + r * 0.8], [cx + s * r * 0.45, cy + r * 0.68]],
      2.4,
      s * 7,
      c.deep
    );
  }
};

/** Gust 💨: three comma-curl wind strokes sweeping right, a loose leaf
 *  tumbling off the topmost curl. */
const sigilGust: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.main;
  ctx.shadowBlur = 18;
  // three stacked wind curls, each a sweep that hooks back on itself
  const rows: [number, number, number][] = [
    // yOff, length, curlR
    [-r * 0.42, r * 1.5, r * 0.26],
    [0, r * 1.75, r * 0.32],
    [r * 0.45, r * 1.3, r * 0.2],
  ];
  rows.forEach(([yOff, len, curl], i) => {
    const y = cy + yOff;
    const x0 = cx - len / 2;
    const pts: [number, number][] = [];
    const n = 22;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (t < 0.7) {
        // the long sweep, bowing gently
        const tt = t / 0.7;
        pts.push([x0 + tt * (len - curl), y + Math.sin(tt * Math.PI) * r * 0.1 * (i % 2 ? 1 : -1)]);
      } else {
        // the curl: hooking up and back around
        const a = ((t - 0.7) / 0.3) * Math.PI * 1.6;
        pts.push([
          x0 + (len - curl) + Math.sin(a) * curl,
          y - (1 - Math.cos(a)) * curl * 0.8,
        ]);
      }
    }
    inkPath(ctx, pts, 5 - i, i * 13, c.deep);
  });
  ctx.restore();
  // the loose leaf, flung off the top curl
  ctx.save();
  ctx.translate(cx + r * 0.62, cy - r * 0.78);
  ctx.rotate(0.6);
  ctx.fillStyle = c.main;
  ctx.beginPath();
  ctx.ellipse(0, 0, 9, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = c.deep;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-9, 0);
  ctx.lineTo(9, 0);
  ctx.stroke();
  ctx.restore();
};

/** Shrink 🐜: a fading dashed outer ring with four arrows driving INWARD
 *  onto a tiny dense core — the big made small. */
const sigilShrink: SigilFn = (ctx, cx, cy, r, c) => {
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = 16;
  // the dashed ghost of the former size
  const n = 16;
  for (let i = 0; i < n; i++) {
    if (i % 2) continue;
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 0.9) / n) * Math.PI * 2;
    const pts: [number, number][] = [];
    for (let k = 0; k <= 4; k++) {
      const a = a0 + (a1 - a0) * (k / 4);
      pts.push([cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95]);
    }
    inkPath(ctx, pts, 2.4, i * 5, c.deep);
  }
  // four inward arrows
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const ox = Math.cos(a);
    const oy = Math.sin(a);
    const x0 = cx + ox * r * 0.78;
    const y0 = cy + oy * r * 0.78;
    const x1 = cx + ox * r * 0.34;
    const y1 = cy + oy * r * 0.34;
    inkPath(ctx, [[x0, y0], [x1, y1]], 4.4, i * 9, c.main);
    // the arrowhead, splayed off the shaft tip
    const pa = a + Math.PI * 0.82;
    const pb = a - Math.PI * 0.82;
    inkPath(ctx, [[x1, y1], [x1 - Math.cos(pa) * -12, y1 - Math.sin(pa) * -12]], 3.6, i * 9 + 3, c.main);
    inkPath(ctx, [[x1, y1], [x1 - Math.cos(pb) * -12, y1 - Math.sin(pb) * -12]], 3.6, i * 9 + 6, c.main);
  }
  // the tiny dense survivor
  ctx.fillStyle = c.deep;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c.glow;
  ctx.beginPath();
  ctx.arc(cx - r * 0.03, cy - r * 0.04, r * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

export const SIGILS: Record<string, SigilFn> = {
  fireball: sigilFire,
  frostbolt: sigilFrost,
  spark: sigilSpark,
  stone: sigilStone,
  gust: sigilGust,
  growth: sigilGrowth,
  multishot: sigilMulti,
  shrink: sigilShrink,
  summon: sigilSummon,
  decay: sigilSkull,
};

// ------------------------------------------------------------- text helpers
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lineH;
    } else line = test;
  }
  ctx.fillText(line, x, yy);
  return yy;
}

// ------------------------------------------------------------- page builders
function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function actionPage(spell: SpellDef, index: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas();
  const seed = index * 13 + 3;
  parchment(ctx, seed);
  border(ctx, seed);
  const colors = { main: spell.colors.main, glow: spell.colors.glow, deep: spell.colors.deep };

  // title
  ctx.save();
  ctx.translate(W / 2, 108);
  ctx.rotate(wob(seed, 1) * 0.012);
  ctx.fillStyle = INK;
  ctx.font = '600 52px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(spell.name, 0, 0);
  ctx.restore();
  // title underline flourish
  const uy = 132;
  inkPath(
    ctx,
    Array.from({ length: 16 }, (_, i) => {
      const t = i / 15;
      return [W / 2 - 150 + t * 300, uy + Math.sin(t * Math.PI) * 6 * (t > 0.5 ? -1 : 1)] as [number, number];
    }),
    2.4,
    seed + 5
  );
  // chapter flourish, tinted with the chapter's ribbon color
  ctx.fillStyle = hex(chapters[spell.school]);
  ctx.font = 'italic 22px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(`~ ${spell.school} ~`, W / 2, 168);

  // sigil ring
  inkCircle(ctx, W / 2, 330, 128, 3, seed + 9);
  inkCircle(ctx, W / 2, 330, 116, 1.2, seed + 17);
  // rune ticks around ring
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r1 = 128;
    const r2 = 140;
    inkPath(
      ctx,
      [
        [W / 2 + Math.cos(a) * r1, 330 + Math.sin(a) * r1],
        [W / 2 + Math.cos(a) * r2, 330 + Math.sin(a) * r2],
      ],
      2,
      seed + i
    );
  }
  SIGILS[spell.id]?.(ctx, W / 2, 330, 86, colors);

  // effect text
  ctx.fillStyle = INK;
  ctx.font = 'italic 25px Georgia, serif';
  ctx.textAlign = 'center';
  wrapText(ctx, spell.effect, W / 2, 512, 380, 32);

  // mana cost diamonds
  const n = spell.cost;
  const pipW = 34;
  const startX = W / 2 - ((n - 1) * pipW) / 2;
  for (let i = 0; i < n; i++) {
    const x = startX + i * pipW;
    const y = 584;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.shadowColor = '#7ec8ff';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#4aa8e8';
    ctx.fillRect(-9, -9, 18, 18);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#bfe8ff';
    ctx.fillRect(-9, -9, 9, 9);
    ctx.restore();
  }
  ctx.fillStyle = INK_SOFT;
  ctx.font = '16px Georgia, serif';
  ctx.fillText('MANA', W / 2, 620);

  return c;
}

export function lorePage(spell: SpellDef, index: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas();
  const seed = index * 29 + 7;
  parchment(ctx, seed, false);
  // spine shadow on the right edge (this is a left page)
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  const sg = ctx.createLinearGradient(0, 0, 90, 0);
  sg.addColorStop(0, 'rgba(120,90,50,0.28)');
  sg.addColorStop(1, 'rgba(120,90,50,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, 90, H);
  ctx.restore();
  border(ctx, seed);
  const colors = { main: spell.colors.main, glow: spell.colors.glow, deep: spell.colors.deep };

  // chapter marker: the school this page is filed under + its leaf numeral
  const chapter = CHAPTERS.find((c) => c.school === spell.school);
  const leaf = ['I', 'II', 'III', 'IV', 'V', 'VI'][index - (chapter?.firstIndex ?? 0)] ?? '';
  ctx.fillStyle = hex(chapters[spell.school]);
  ctx.font = 'italic 20px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(`— ${chapter?.name ?? spell.school} · ${leaf} —`, W / 2, 92);

  // faded emblem
  ctx.save();
  ctx.globalAlpha = 0.85;
  inkCircle(ctx, W / 2, 240, 96, 2.4, seed + 3);
  SIGILS[spell.id]?.(ctx, W / 2, 240, 60, colors);
  ctx.restore();

  // fake arcane script — rows of wavy ink squiggles
  let y = 396;
  for (let row = 0; row < 6; row++) {
    const len = 0.55 + ((row * 37 + index * 13) % 40) / 100;
    const pts: [number, number][] = [];
    const n = 30;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([
        70 + t * (W - 150) * len,
        y + Math.sin(t * 34 + row * 3.1 + seed) * 3.4 + Math.sin(t * 90 + row * 7) * 1.6,
      ]);
    }
    inkPath(ctx, pts, 2.1, seed + row * 3, 'rgba(61,46,80,0.62)');
    y += 26;
  }

  // flavor quote
  ctx.fillStyle = INK;
  ctx.font = 'italic 22px Georgia, serif';
  ctx.textAlign = 'center';
  wrapText(ctx, `“${spell.flavor}”`, W / 2, 588, 380, 28);

  return c;
}

/** Plain parchment used for the back face of ripped pages. */
export function blankPage(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas();
  parchment(ctx, 55);
  inkRect(ctx, 28, 28, W - 56, H - 56, 1.4, 200);
  return c;
}

/** Apply a jagged torn strip along the left (spine) edge. */
export function tornVariant(src: HTMLCanvasElement): HTMLCanvasElement {
  const [c, ctx] = makeCanvas();
  ctx.drawImage(src, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  const teeth = 26;
  for (let i = 0; i <= teeth; i++) {
    const t = i / teeth;
    const depth = 8 + Math.abs(wob(9, t * 12)) * 16;
    ctx.lineTo(depth, t * H);
  }
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // torn fiber line
  ctx.strokeStyle = 'rgba(120,90,50,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= teeth; i++) {
    const t = i / teeth;
    const depth = 9 + Math.abs(wob(9, t * 12)) * 16;
    if (i === 0) ctx.moveTo(depth, 0);
    else ctx.lineTo(depth, t * H);
  }
  ctx.stroke();
  return c;
}

export interface PageArt {
  action: THREE.CanvasTexture;
  lore: THREE.CanvasTexture;
  torn: THREE.CanvasTexture;
}

const artCache = new Map<string, PageArt>();
let blankTex: THREE.CanvasTexture | null = null;

export function pageArt(spell: SpellDef, index: number): PageArt {
  let art = artCache.get(spell.id);
  if (!art) {
    const action = actionPage(spell, index);
    art = {
      action: toTexture(action),
      lore: toTexture(lorePage(spell, index)),
      torn: toTexture(tornVariant(action)),
    };
    artCache.set(spell.id, art);
  }
  return art;
}

export function blankPageTexture(): THREE.CanvasTexture {
  if (!blankTex) blankTex = toTexture(blankPage());
  return blankTex;
}
