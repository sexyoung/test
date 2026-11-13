// Procedural low-poly park, engine-agnostic.
//
// createWorld() returns plain data (typed arrays + descriptors). Every demo (three.js,
// Babylon.js, PlayCanvas, raw WebGL2) consumes exactly this data, so they all render
// the same triangles with the same batching structure and can be compared fairly.
//
// Conventions
//   * Right-handed, +Y up, metres. The "hero" camera looks roughly towards -Z.
//   * Geometry is a NON-indexed triangle list, counter-clockwise front faces,
//     with flat (per-face) normals and per-vertex colours already baked in.
//   * Matrices are column-major Float32Array(16) (translation in elements 12..14).
//   * Every instance / node transform is translation + rotation + UNIFORM scale.
//
// See the typedefs at the bottom of this file for the exact shape of the result.

import { MeshBuilder, icosphere, jitterShape, transformShape, mixColor, scaleColor } from './geom.js';
import {
  createRandom, hash01, hex, srgbToLinear, clamp, lerp, smoothstep, normalize3,
  mat4FromYawScale, mat4FromEulerScale, quatLookAt,
} from './math.js';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const PARK = { x: 0, z: 20, radius: 72 };
const TERRAIN_HALF = 128;
const EDGE_HEIGHT = 2.8;
const WATER_LEVEL = -0.45;
const POND = { cx: 16, cz: 6, rx: 14, rz: 9.5 };
const GAZEBO = { x: 28.5, z: 6.5, deckY: 0.38, radius: 3.3, pierLength: 8.5, pierWidth: 2.2 };

/** <1 inside the pond outline, ~1 at the bank. */
function pondQ(x, z) {
  const dx = (x - POND.cx) / POND.rx, dz = (z - POND.cz) / POND.rz;
  const a = Math.atan2(dz, dx);
  const wobble = 1 + 0.09 * Math.sin(3 * a + 0.7) + 0.05 * Math.sin(5 * a + 2.1);
  return Math.hypot(dx, dz) / wobble;
}

/** Analytic terrain height; the terrain mesh, prop placement and the simulation all sample it. */
export function terrainHeight(x, z) {
  let h = 0.9 * Math.sin(0.043 * x + 1.3) * Math.cos(0.037 * z - 0.4)
    + 0.5 * Math.sin(0.085 * x - 0.021 * z + 2.1) * Math.sin(0.067 * z + 0.8)
    + 0.18 * Math.sin(0.21 * x + 0.5) * Math.sin(0.19 * z + 1.7);
  // low ridge around the park that carries the backdrop tree line
  h += EDGE_HEIGHT * smoothstep(78, 112, Math.hypot(x - PARK.x, z - PARK.z));
  // settle to a constant towards the edge of the grid so the flat skirt joins seamlessly
  h = lerp(h, EDGE_HEIGHT, smoothstep(104, 126, Math.max(Math.abs(x), Math.abs(z))));
  // pond: flatten the surroundings, then dig the basin
  const q = pondQ(x, z);
  h = lerp(h, 0.12, smoothstep(2.3, 1.25, q));
  h -= 2.4 * smoothstep(1.1, 0.5, q);
  return h;
}

const RAMP_X0 = GAZEBO.x + GAZEBO.radius - 0.4, RAMP_LENGTH = 2.0;

/** 0: plain terrain, 1: gazebo deck or pier, 2: the ramp between the bank and the deck. */
function deckKind(x, z) {
  if (Math.hypot(x - GAZEBO.x, z - GAZEBO.z) < GAZEBO.radius - 0.25) return 1;
  const x1 = GAZEBO.x - GAZEBO.radius + 0.4, x0 = x1 - GAZEBO.pierLength - 0.2;
  if (x > x0 && x < x1 && Math.abs(z - GAZEBO.z) < GAZEBO.pierWidth / 2 - 0.2) return 1;
  if (x >= RAMP_X0 && x < RAMP_X0 + RAMP_LENGTH && Math.abs(z - GAZEBO.z) < 1.0) return 2;
  return 0;
}

/** Height of the surface a character stands on (terrain, deck, pier or ramp). */
export function groundHeight(x, z) {
  const t = terrainHeight(x, z);
  const kind = deckKind(x, z);
  if (kind === 1) return Math.max(GAZEBO.deckY, t);
  if (kind === 2) return Math.max(t, lerp(GAZEBO.deckY, t, clamp((x - RAMP_X0) / RAMP_LENGTH, 0, 1)));
  return t;
}

/** Whether a character may stand at (x, z): inside the park and not in the water. */
export function isWalkable(x, z) {
  if (Math.hypot(x - PARK.x, z - PARK.z) > PARK.radius) return false;
  if (deckKind(x, z) !== 0) return true;
  return terrainHeight(x, z) > WATER_LEVEL - 0.1;
}

// ---------------------------------------------------------------------------
// Palette (sRGB)
// ---------------------------------------------------------------------------

const C = {
  grass: ['#b6dc52', '#a8d548', '#9acd42', '#8cc43e'],
  bed: ['#a9cf9c', '#6da9b4'],
  path: ['#eedfb2', '#e6d4a3', '#ead9aa'],
  trunk: ['#9c6b45', '#8b5d3b', '#7a4f31'],
  canopy: ['#b9e25c', '#96d44d', '#73bf45'],
  canopyB: ['#aede58', '#88cc48', '#66b441'],
  pine: ['#5fba5a', '#4aa652', '#3c9449'],
  bush: ['#8fd04a', '#74c043', '#5fae3f'],
  rock: ['#d2cdc1', '#bdb7a9', '#a8a294'],
  petal: '#ffffff', petalShade: '#eef2f6', daisyCenter: '#ffd23f', stem: '#63b040',
  grassBlade: ['#8fcd40', '#7cc039', '#a2d84a'],
  lampMetal: ['#44515e', '#3a4651'], lampGlass: '#fff3c6',
  benchWood: ['#d98b42', '#c97a35', '#e09a50'], benchMetal: '#4b5058',
  roof: ['#e4704a', '#d35f3c', '#ee8158'], roofTop: ['#f08e63', '#e67d52'],
  wood: ['#bd7b43', '#a96938', '#cb8b50'], woodDark: '#8a5630',
  water: ['#64baeb', '#57addf', '#76c8f3', '#6cc0ee'],
  building: ['#f0e8da', '#d6e0ea', '#e8d6cb', '#d2cbe8', '#c0d9e7', '#f2ecd6', '#e3e6ea'],
  window: ['#86abcc', '#94b9d8', '#7a9fc2'], roofGray: '#b4bcc6',
  tower: ['#86b8e0', '#72a7d6', '#6096c8'],
  cloud: '#ffffff', cloudUnder: '#dce9f7',
  sun: ['#ffe14d', '#ffd83a', '#ffea70'], sunRay: '#fff2a0',
  sky: { zenith: '#3aa3f2', mid: '#5bbcf9', horizon: '#b2e2fc' },
  skin: ['#f3cca4', '#dca676', '#96623f'],
  hair: ['#3b2a20', '#6e4c2c', '#dbb468', '#23272f'],
  shirt: ['#e9604c', '#4b91da', '#f3c350', '#5fba5f', '#9d6dd8', '#f191b2'],
  pants: ['#3a434f', '#5b6c8d', '#7b5d45', '#2e3037', '#44607a', '#6a4f6e'],
  shoe: '#2c2c2e',
  bird: ['#f6f8fa', '#cfd6de'],
  duck: ['#ffffff', '#f3eee2'], beak: '#f39c2f', eye: '#1d1f23',
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function resample(dense, closed, spacing) {
  const n = dense.length;
  const cum = [0];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = dense[i], b = dense[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum[segs];
  const count = Math.max(2, Math.round(length / spacing));
  const step = length / (closed ? count : count - 1);
  const pts = new Float32Array(count * 2);
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const d = Math.min(i * step, length - 1e-6);
    while (seg < segs - 1 && cum[seg + 1] < d) seg++;
    const a = dense[seg], b = dense[(seg + 1) % n];
    const t = (d - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
    pts[i * 2] = a[0] + (b[0] - a[0]) * t;
    pts[i * 2 + 1] = a[1] + (b[1] - a[1]) * t;
  }
  return { pts, count, length, step, closed };
}

function catmullRomClosed(ctrl, spacing) {
  const dense = [];
  const n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let k = 0; k < 20; k++) {
      const t = k / 20, t2 = t * t, t3 = t2 * t;
      dense.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return resample(dense, true, spacing);
}

function ellipseLoop(cx, cz, rx, rz, spacing) {
  const dense = [];
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    dense.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]);
  }
  return resample(dense, true, spacing);
}

/**
 * Sample a lane at arc length `s` (wraps for closed lanes) with a sideways offset.
 * Writes x, z and the unit tangent tx, tz into `out`.
 */
export function sampleLane(lane, s, lateral, out) {
  const { pts, count, step, length } = lane;
  let d = s % length;
  if (d < 0) d += length;
  const f = d / step;
  const i = Math.floor(f) % count, j = (i + 1) % count, t = f - Math.floor(f);
  const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
  let tx = bx - ax, tz = bz - az;
  const l = Math.hypot(tx, tz) || 1;
  tx /= l; tz /= l;
  out.x = ax + (bx - ax) * t + tz * lateral;
  out.z = az + (bz - az) * t - tx * lateral;
  out.tx = tx;
  out.tz = tz;
  return out;
}

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------

const T = mat4FromEulerScale; // (tx, ty, tz, rx, ry, rz, sx, sy, sz)

function blob(rand, radius, jitter = 0.13, squash = 0.86, subdiv = 1) {
  return transformShape(jitterShape(icosphere(subdiv, radius), jitter, rand), 1, squash, 1);
}

/** Three-tone "posterised" foliage colouring: lighter on top, darker underneath. */
function foliageColor(rand, tones) {
  return (f, centroid, n) => {
    const t = 0.5 + 0.42 * n[1] + (rand() - 0.5) * 0.42;
    return t > 0.7 ? tones[0] : t > 0.38 ? tones[1] : tones[2];
  };
}

function buildRoundTree(rand, spec, tones) {
  const b = new MeshBuilder();
  const trunkColor = (i) => C.trunk[i % 2 === 0 ? 0 : 1];
  const trunk = new MeshBuilder().prism(5, spec.trunkR, spec.trunkR * 0.68, spec.trunkH, trunkColor, [0, 0, 0], { capTop: false });
  b.add(trunk, T(0, -0.15, 0, 0, 0, spec.lean || 0));
  for (const br of spec.branches || []) {
    const branch = new MeshBuilder().prism(4, spec.trunkR * 0.5, spec.trunkR * 0.3, br.len, (i) => C.trunk[1 + (i % 2)], [0, 0, 0], { capTop: false });
    b.add(branch, T(br.x, br.y, br.z, br.rx || 0, 0, br.rz));
  }
  for (const k of spec.blobs) {
    b.indexed(blob(rand, k.r, 0.14, k.squash || 0.86), foliageColor(rand, tones), T(k.x, k.y, k.z, 0, rand() * 6.28, 0));
  }
  return b;
}

function buildPine(rand) {
  const b = new MeshBuilder();
  b.prism(5, 0.17, 0.12, 0.95, (i) => C.trunk[1 + (i % 2)], [0, -0.15, 0], { capTop: false });
  const tiers = [[1.38, 1.55, 0.62], [1.08, 1.35, 1.52], [0.78, 1.2, 2.32], [0.48, 0.95, 3.02]];
  tiers.forEach(([r, h, y], t) => {
    b.prism(7, r, 0, h, (i) => C.pine[(i + t) % 3 === 0 ? 0 : (i + t) % 3 === 1 ? 1 : 2], [0, y, 0], { phase: t * 0.45 });
  });
  b.recolor((c, n, t, cur) => (n[1] < -0.5 ? C.pine[2] : cur));
  return b;
}

function buildBush(rand, variant) {
  const b = new MeshBuilder();
  const blobs = variant === 0
    ? [[0, 0.42, 0, 0.72], [0.55, 0.3, 0.2, 0.5], [-0.45, 0.28, -0.25, 0.46]]
    : [[0, 0.36, 0, 0.6], [-0.42, 0.26, 0.3, 0.42]];
  for (const [x, y, z, r] of blobs) b.indexed(blob(rand, r, 0.16, 0.78), foliageColor(rand, C.bush), T(x, y, z, 0, rand() * 6.28, 0));
  return b;
}

function buildRock(rand, variant) {
  const b = new MeshBuilder();
  const dims = [[0.85, 0.5, 0.65], [0.62, 0.42, 0.7], [0.5, 0.56, 0.46]][variant];
  const shape = transformShape(jitterShape(icosphere(1, 1), 0.2, rand), dims[0], dims[1], dims[2], 0, dims[1] * 0.45, 0);
  b.indexed(shape, (f, c, n) => {
    const t = 0.5 + 0.4 * n[1] + (rand() - 0.5) * 0.5;
    return t > 0.68 ? C.rock[0] : t > 0.36 ? C.rock[1] : C.rock[2];
  });
  return b;
}

function buildDaisy() {
  const b = new MeshBuilder();
  const up = [0, 1, 0];
  // stem + two leaves
  b.prism(3, 0.016, 0.012, 0.36, C.stem, [0, 0, 0], { capTop: false, capBottom: false });
  b.triDouble([0, 0.02, 0], [0.13, 0.12, 0.03], [0.05, 0.02, -0.03], C.stem, normalize3([0.2, 1, 0.1]));
  b.triDouble([0, 0.02, 0], [-0.12, 0.1, -0.04], [-0.04, 0.02, 0.04], C.stem, normalize3([-0.2, 1, 0]));
  // flower head, tilted so it faces up and towards +Z
  const head = new MeshBuilder();
  const petals = 7;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2, a0 = a - 0.3, a1 = a + 0.3;
    const p = (ang, r, y = 0) => [Math.sin(ang) * r, y, Math.cos(ang) * r];
    const colr = i % 2 ? C.petal : C.petalShade;
    head.quadDouble(p(a0, 0.035), p(a0 + 0.08, 0.1, 0.012), p(a, 0.135, 0.006), p(a1 - 0.08, 0.1, 0.012), colr, up);
    head.triDouble(p(a0, 0.035), p(a1 - 0.08, 0.1, 0.012), p(a1, 0.035), colr, up);
  }
  head.prism(6, 0.045, 0.02, 0.028, C.daisyCenter, [0, 0.004, 0], { capBottom: false });
  b.add(head, T(0, 0.36, 0, 0.75, 0, 0));
  return b;
}

function buildGrassTuft(rand, variant) {
  const b = new MeshBuilder();
  const blades = variant === 0 ? 4 : 3;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + rand() * 0.8;
    const h = 0.2 + rand() * 0.16, w = 0.035 + rand() * 0.02, lean = 0.05 + rand() * 0.09, off = 0.03 + rand() * 0.04;
    const cx = Math.sin(a) * off, cz = Math.cos(a) * off;
    const px = Math.cos(a) * w, pz = -Math.sin(a) * w;
    const tip = [cx + Math.sin(a) * lean, h, cz + Math.cos(a) * lean];
    b.triDouble([cx - px, 0, cz - pz], [cx + px, 0, cz + pz], tip, C.grassBlade[i % 3], normalize3([Math.sin(a) * 0.25, 1, Math.cos(a) * 0.25]));
  }
  return b;
}

function buildLamp() {
  const b = new MeshBuilder();
  b.prism(6, 0.2, 0.15, 0.3, (i) => C.lampMetal[i % 2], [0, -0.1, 0]);
  b.prism(6, 0.11, 0.075, 0.22, (i) => C.lampMetal[(i + 1) % 2], [0, 0.2, 0]);
  b.prism(6, 0.058, 0.05, 2.25, (i) => C.lampMetal[i % 2], [0, 0.42, 0], { capBottom: false });
  b.prism(6, 0.1, 0.1, 0.07, C.lampMetal[1], [0, 2.67, 0]);
  // lantern: plate, glass, cap, finial
  b.prism(4, 0.17, 0.2, 0.05, C.lampMetal[0], [0, 2.74, 0], { phase: Math.PI / 4 });
  b.prism(4, 0.165, 0.27, 0.44, C.lampGlass, [0, 2.79, 0], { phase: Math.PI / 4, capBottom: false });
  b.prism(4, 0.34, 0.1, 0.17, (i) => C.lampMetal[i % 2], [0, 3.23, 0], { phase: Math.PI / 4 });
  b.prism(4, 0.05, 0.03, 0.12, C.lampMetal[1], [0, 3.4, 0], { phase: Math.PI / 4 });
  return b;
}

function buildBench() {
  const b = new MeshBuilder();
  // seat slats (bench faces +Z)
  [-0.15, 0.0, 0.15].forEach((z, i) => b.box(1.8, 0.045, 0.125, C.benchWood[i % 3], [0, 0.46, z]));
  // backrest slats, leaning back slightly
  const back = new MeshBuilder();
  [0.14, 0.31, 0.48].forEach((y, i) => back.box(1.8, 0.125, 0.04, C.benchWood[(i + 1) % 3], [0, y, 0]));
  b.add(back, T(0, 0.46, -0.24, -0.2, 0, 0));
  for (const x of [-0.74, 0.74]) {
    b.box(0.07, 0.46, 0.07, C.benchMetal, [x, 0.21, 0.17]);
    b.box(0.07, 1.02, 0.07, C.benchMetal, [x, 0.49, -0.27]);
    b.box(0.07, 0.06, 0.5, C.benchMetal, [x, 0.41, -0.04]);
    b.box(0.08, 0.05, 0.42, C.benchWood[1], [x, 0.69, -0.04]);
    b.box(0.07, 0.24, 0.07, C.benchMetal, [x, 0.56, 0.15]);
  }
  return b;
}

/** Hexagonal gazebo with a pier. Local origin: centre of the deck's top surface; the pier runs towards -X. */
function buildGazebo() {
  const b = new MeshBuilder();
  const R = GAZEBO.radius, postR = R - 0.32;
  const corner = (i, r, y = 0) => {
    const a = Math.PI / 6 + (i / 6) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  // deck (+ rim) and piles
  b.prism(6, R, R, 0.26, { side: C.wood[1], top: C.wood[2], bottom: C.woodDark }, [0, -0.26, 0], { phase: Math.PI / 3 });
  for (let i = 0; i < 6; i++) {
    const p = corner(i, postR);
    b.prism(5, 0.15, 0.15, 2.4, C.woodDark, [p[0], -2.6, p[2]], { capTop: false });
    b.box(0.2, 2.5, 0.2, C.wood[i % 2], [p[0], 1.25, p[2]]);
  }
  // beams, railings (the two sides on the X axis stay open: bank entrance and pier)
  for (let i = 0; i < 6; i++) {
    const p0 = corner(i, postR), p1 = corner((i + 1) % 6, postR);
    const mx = (p0[0] + p1[0]) / 2, mz = (p0[2] + p1[2]) / 2;
    const len = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    const yaw = Math.atan2(p1[0] - p0[0], p1[2] - p0[2]);
    b.add(new MeshBuilder().box(0.16, 0.22, len, C.wood[1]), T(mx, 2.42, mz, 0, yaw, 0));
    const open = Math.abs(mz) < 0.5; // sides crossing the X axis
    if (!open) {
      b.add(new MeshBuilder().box(0.1, 0.09, len - 0.2, C.wood[0]), T(mx, 0.98, mz, 0, yaw, 0));
      b.add(new MeshBuilder().box(0.08, 0.07, len - 0.2, C.wood[1]), T(mx, 0.28, mz, 0, yaw, 0));
      for (let k = 1; k <= 5; k++) {
        const t = k / 6;
        b.box(0.06, 0.66, 0.06, C.wood[2], [lerp(p0[0], p1[0], t), 0.63, lerp(p0[2], p1[2], t)]);
      }
    }
  }
  // two-tier hexagonal roof
  const roof = (r0, r1, y, h, tones) => b.prism(6, r0, r1, h, (i) => tones[i % tones.length], [0, y, 0], { phase: Math.PI / 3 });
  roof(R + 0.95, 1.85, 2.5, 1.25, C.roof);
  roof(2.0, 0, 3.7, 1.05, C.roofTop);
  b.prism(6, R + 0.95, R + 0.95, 0.1, C.roof[1], [0, 2.42, 0], { phase: Math.PI / 3 });
  b.prism(4, 0.09, 0.03, 0.4, C.woodDark, [0, 4.72, 0]);
  // pier towards -X
  const L = GAZEBO.pierLength, W = GAZEBO.pierWidth, x1 = -R + 0.35, x0 = x1 - L;
  b.box(L, 0.2, W, { side: C.wood[1], top: C.wood[2], bottom: C.woodDark }, [(x0 + x1) / 2, -0.1, 0]);
  for (const z of [-W / 2 + 0.08, W / 2 - 0.08]) {
    b.box(L, 0.09, 0.09, C.wood[0], [(x0 + x1) / 2, 0.95, z]);
    b.box(L, 0.07, 0.07, C.wood[1], [(x0 + x1) / 2, 0.5, z]);
    for (let k = 0; k <= 5; k++) {
      const x = lerp(x0 + 0.1, x1 - 0.5, k / 5);
      b.box(0.12, 1.0, 0.12, C.wood[k % 2], [x, 0.5, z]);
      if (k % 2 === 0) b.prism(5, 0.11, 0.11, 2.3, C.woodDark, [x, -2.5, z], { capTop: false });
    }
  }
  // ramp to the bank (+X)
  b.add(new MeshBuilder().box(2.2, 0.14, 2.0, { side: C.wood[1], top: C.wood[2], bottom: C.woodDark }), T(R + 0.75, -0.2, 0, 0, 0, -0.13));
  return b;
}

function buildCloud(rand, variant) {
  const b = new MeshBuilder();
  const specs = [
    [[0, 0.4, 0, 5], [-5.2, -0.6, 0.5, 3.6], [4.8, -0.3, -0.4, 4.0], [8.9, -1.2, 0.3, 2.6], [-8.6, -1.4, 0, 2.3]],
    [[0, 0, 0, 4.2], [4.6, -0.5, 0.4, 3.1], [-4.4, -0.8, -0.3, 2.9]],
    [[-2.6, 0.2, 0, 4.4], [2.8, 0.9, 0.3, 5.2], [8.2, -0.7, -0.2, 3.3], [-7.6, -1.1, 0.2, 2.7], [12, -1.5, 0, 2.0]],
    [[0, 0, 0, 3.4], [3.6, -0.5, 0.2, 2.4]],
  ][variant];
  const floor = -1.7;
  for (const [x, y, z, r] of specs) {
    let s = transformShape(jitterShape(icosphere(1, r), 0.1, rand), 1.1, 0.8, 0.85, x, y, z);
    s = { faces: s.faces, verts: s.verts.map((v) => [v[0], Math.max(v[1], floor), v[2]]) };
    b.indexed(s, (f, c, n) => (n[1] < -0.35 ? C.cloudUnder : C.cloud));
  }
  return b;
}

/** Faceted sun disc in the local XY plane facing +Z (unit radius). */
function buildSunDisc() {
  const b = new MeshBuilder();
  const N = 10, p = (i, r, z = 0) => [Math.cos((i / N) * Math.PI * 2) * r, Math.sin((i / N) * Math.PI * 2) * r, z];
  for (let i = 0; i < N; i++) {
    b.tri([0, 0, 0.12], p(i, 0.6, 0.08), p(i + 1, 0.6, 0.08), C.sun[2]);
    b.quad(p(i, 0.6, 0.08), p(i, 1), p(i + 1, 1), p(i + 1, 0.6, 0.08), C.sun[i % 2]);
  }
  return b;
}

function buildSunRays() {
  const b = new MeshBuilder();
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = ((i + 0.5) / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const r0 = 1.28, r1 = i % 2 ? 1.62 : 1.78, w = 0.11;
    const pt = (r, s) => [ca * r - sa * s, sa * r + ca * s, 0];
    b.quad(pt(r0, -w), pt(r1, -w), pt(r1, w), pt(r0, w), C.sunRay);
  }
  return b;
}

function buildSky() {
  const b = new MeshBuilder();
  const R = 1300, SEG = 32, RINGS = 12, E0 = (-14 * Math.PI) / 180, E1 = Math.PI / 2;
  const hz = hex(C.sky.horizon), md = hex(C.sky.mid), zn = hex(C.sky.zenith);
  const colorAt = (el) => {
    if (el <= 0) return hz;
    const t = Math.pow(el / E1, 0.55);
    return t < 0.5 ? mixColor(hz, md, t / 0.5) : mixColor(md, zn, (t - 0.5) / 0.5);
  };
  const pt = (el, az) => [R * Math.cos(el) * Math.sin(az), R * Math.sin(el), R * Math.cos(el) * Math.cos(az)];
  const inward = (p) => normalize3([-p[0], -p[1], -p[2]]);
  for (let r = 0; r < RINGS; r++) {
    const e0 = lerp(E0, E1, r / RINGS), e1 = lerp(E0, E1, (r + 1) / RINGS);
    const c0 = colorAt(e0), c1 = colorAt(e1);
    for (let s = 0; s < SEG; s++) {
      const a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2;
      const p00 = pt(e0, a0), p01 = pt(e0, a1), p10 = pt(e1, a0), p11 = pt(e1, a1);
      const n = inward(pt((e0 + e1) / 2, (a0 + a1) / 2));
      if (r === RINGS - 1) b.tri(p00, p10, p01, [c0, c1, c0], n);
      else {
        b.tri(p00, p10, p11, [c0, c1, c1], n);
        b.tri(p00, p11, p01, [c0, c1, c0], n);
      }
    }
  }
  return b;
}

function buildSkyline(rand) {
  const b = new MeshBuilder();
  const baseY = EDGE_HEIGHT - 3;
  const place = (builder, az, dist) => {
    const x = PARK.x + Math.sin(az) * dist, z = PARK.z - Math.cos(az) * dist;
    b.add(builder, T(x, baseY, z, 0, Math.atan2(PARK.x - x, PARK.z - z), 0)); // local +Z faces the park
  };
  const COUNT = 118;
  for (let i = 0; i < COUNT; i++) {
    // two thirds of the buildings sit in the northern arc the hero camera looks at
    const az = i < COUNT * 0.66 ? (rand() * 2 - 1) * 1.45 : 1.45 + rand() * (Math.PI * 2 - 2.9);
    const dist = 235 + rand() * 110;
    const w = 12 + rand() * 17, d = 12 + rand() * 12;
    const h = 22 + rand() * 24 + (rand() < 0.22 ? 10 + rand() * 12 : 0);
    const body = C.building[Math.floor(rand() * C.building.length)];
    const m = new MeshBuilder();
    m.box(w, h, d, { side: body, top: C.roofGray, bottom: body }, [0, h / 2, 0]);
    if (rand() < 0.5) m.box(w * 0.55, 3 + rand() * 4, d * 0.55, { side: scaleColor(body, 0.94), top: C.roofGray, bottom: body }, [(rand() - 0.5) * w * 0.3, h + 2, 0]);
    const cols = Math.max(2, Math.floor(w / 4.4)), rows = Math.max(3, Math.floor((h - 5) / 5.6));
    const win = C.window[Math.floor(rand() * 3)];
    const ww = (w / cols) * 0.62, wh = 3.0, z = d / 2 + 0.25;
    for (let r = 0; r < rows; r++) {
      const y = 6 + r * ((h - 9) / rows);
      for (let c = 0; c < cols; c++) {
        const x = -w / 2 + (c + 0.5) * (w / cols);
        m.quad([x - ww / 2, y, z], [x + ww / 2, y, z], [x + ww / 2, y + wh, z], [x - ww / 2, y + wh, z], win);
      }
    }
    place(m, az, dist);
  }
  // the tiered landmark tower, slightly right of where the hero camera looks
  const t = new MeshBuilder();
  const tone = (i) => C.tower[i % 3];
  let y = 0;
  t.taperedBox(26, 26, 23, 23, 9, { side: tone(1), top: tone(0), bottom: tone(2) }, [0, y, 0]); y += 9;
  t.taperedBox(16, 16, 13.5, 13.5, 14, { side: tone(0), top: tone(0), bottom: tone(2) }, [0, y, 0]); y += 14;
  for (let k = 0; k < 8; k++) {
    t.taperedBox(11.4, 11.4, 14.6, 14.6, 6.4, { side: tone(k), top: tone(0), bottom: tone(2) }, [0, y, 0]); y += 6.4;
  }
  t.taperedBox(10.4, 10.4, 7.8, 7.8, 5, { side: tone(1), top: tone(0), bottom: tone(2) }, [0, y, 0]); y += 5;
  t.taperedBox(4.4, 4.4, 2.8, 2.8, 6, { side: tone(0), top: tone(0), bottom: tone(2) }, [0, y, 0]); y += 6;
  t.prism(4, 1.2, 0.0, 17, tone(2), [0, y, 0]);
  place(t, 0.34, 300);
  return b;
}

function buildCharacterParts(variant, geoms, colorSpace) {
  const shirt = C.shirt[variant % C.shirt.length], pants = C.pants[variant % C.pants.length];
  const skin = C.skin[variant % C.skin.length], hair = C.hair[(variant * 3 + 1) % C.hair.length];
  const shirtDark = scaleColor(shirt, 0.88);
  // torso: origin at the hips
  const torso = new MeshBuilder();
  torso.taperedBox(0.4, 0.22, 0.46, 0.25, 0.56, { side: shirt, top: shirtDark, bottom: pants }, [0, 0.04, 0]);
  torso.box(0.41, 0.08, 0.23, pants, [0, 0.02, 0]);
  geoms[`torso_${variant}`] = torso.build(`torso_${variant}`, colorSpace);
  // head: origin at the neck, facing +Z
  const head = new MeshBuilder();
  head.box(0.1, 0.07, 0.1, skin, [0, 0.025, 0]);
  head.box(0.27, 0.27, 0.25, skin, [0, 0.19, 0]);
  head.box(0.29, 0.1, 0.27, hair, [0, 0.33, -0.005]);
  head.box(0.29, 0.2, 0.07, hair, [0, 0.2, -0.105]);
  for (const x of [-0.065, 0.065]) head.box(0.035, 0.045, 0.01, C.eye, [x, 0.2, 0.128]);
  geoms[`head_${variant}`] = head.build(`head_${variant}`, colorSpace);
  // arm: origin at the shoulder, hanging down
  const arm = new MeshBuilder();
  arm.taperedBox(0.105, 0.105, 0.12, 0.12, 0.32, shirt, [0, -0.32, 0]);
  arm.taperedBox(0.085, 0.085, 0.095, 0.095, 0.26, skin, [0, -0.58, 0]);
  geoms[`arm_${variant}`] = arm.build(`arm_${variant}`, colorSpace);
  // leg: origin at the hip
  const leg = new MeshBuilder();
  leg.taperedBox(0.13, 0.15, 0.16, 0.18, 0.68, pants, [0, -0.68, 0]);
  leg.box(0.15, 0.12, 0.25, C.shoe, [0, -0.74, 0.04]);
  geoms[`leg_${variant}`] = leg.build(`leg_${variant}`, colorSpace);
}

function buildBirdParts(geoms, colorSpace) {
  const body = new MeshBuilder();
  const shape = { verts: [[0, 0, 0.3], [0, 0, -0.24], [0, 0.075, 0.02], [0, -0.06, 0.02], [-0.085, 0, 0.02], [0.085, 0, 0.02]],
    faces: [[0, 5, 2], [0, 2, 4], [0, 4, 3], [0, 3, 5], [1, 2, 5], [1, 4, 2], [1, 3, 4], [1, 5, 3]] };
  body.indexed(shape, (f) => C.bird[f % 2]);
  body.triDouble([0, 0.01, -0.2], [-0.11, 0.01, -0.42], [0.11, 0.01, -0.42], C.bird[1], [0, 1, 0]);
  geoms.bird_body = body.build('bird_body', colorSpace);
  for (const [name, sx] of [['bird_wing_l', -1], ['bird_wing_r', 1]]) {
    const w = new MeshBuilder();
    w.triDouble([0, 0, 0.13], [sx * 0.34, 0, 0.05], [0, 0, -0.12], C.bird[0], [0, 1, 0]);
    w.triDouble([sx * 0.34, 0, 0.05], [sx * 0.66, 0, -0.1], [0, 0, -0.12], C.bird[1], [0, 1, 0]);
    geoms[name] = w.build(name, colorSpace);
  }
}

function buildDuck() {
  const b = new MeshBuilder();
  b.taperedBox(0.2, 0.34, 0.27, 0.42, 0.17, { side: C.duck[1], top: C.duck[0], bottom: C.duck[1] }, [0, -0.03, 0]);
  b.tri([-0.1, 0.14, -0.2], [0.1, 0.14, -0.2], [0, 0.24, -0.31], C.duck[0]);
  b.tri([0.1, 0.14, -0.2], [-0.1, 0.14, -0.2], [0, 0.24, -0.31], C.duck[1]);
  b.box(0.09, 0.14, 0.09, C.duck[0], [0, 0.2, 0.13]);
  b.box(0.14, 0.13, 0.15, C.duck[0], [0, 0.32, 0.15]);
  b.taperedBox(0.08, 0.1, 0.05, 0.08, 0.035, C.beak, [0, 0.285, 0.265]);
  for (const x of [-0.071, 0.071]) b.box(0.01, 0.03, 0.03, C.eye, [x, 0.34, 0.18]);
  return b;
}

// ---------------------------------------------------------------------------
// World assembly
// ---------------------------------------------------------------------------

/**
 * @param {Object} [options]
 * @param {number} [options.seed=1]
 * @param {number} [options.npcs=24]      number of walking characters (7 scene nodes each)
 * @param {number} [options.density=1]    multiplier for the instanced vegetation / rock counts
 * @param {'linear'|'srgb'} [options.colorSpace='linear'] colour space of vertex colours, fog and sky colours
 * @returns {World}
 */
export function createWorld(options = {}) {
  const seed = options.seed ?? 1;
  const npcCount = Math.max(0, Math.floor(options.npcs ?? 24));
  const density = Math.max(0.05, options.density ?? 1);
  const colorSpace = options.colorSpace === 'srgb' ? 'srgb' : 'linear';
  const cs = (c) => {
    const v = typeof c === 'string' ? hex(c) : c;
    return colorSpace === 'linear' ? v.map(srgbToLinear) : v.slice();
  };

  /** @type {Record<string, Geometry>} */
  const geometries = {};
  const addGeom = (name, builder) => (geometries[name] = builder.build(name, colorSpace));

  // ---- paths --------------------------------------------------------------
  const loop = catmullRomClosed([
    [-46, 30], [-24, 28], [-10, 27], [-3.5, 25], [1.5, 20], [-2.2, 9], [0.5, -4], [12, -9.5],
    [26, -8.5], [38, -1], [43.5, 12], [42, 30], [30, 46], [10, 56], [-16, 56], [-40, 48],
  ], 1.0);
  const outer = ellipseLoop(PARK.x, PARK.z, 62, 56, 1.0);
  // spur from the loop to the gazebo ramp
  let spurStart = 0, best = Infinity;
  for (let i = 0; i < loop.count; i++) {
    const x = loop.pts[i * 2], z = loop.pts[i * 2 + 1];
    if (x > 30 && Math.abs(z - GAZEBO.z) < best) { best = Math.abs(z - GAZEBO.z); spurStart = i; }
  }
  const spurFrom = [loop.pts[spurStart * 2], GAZEBO.z];
  const spurTo = [GAZEBO.x + GAZEBO.radius + 1.5, GAZEBO.z];
  const spur = resample([spurFrom, spurTo], false, 1.0);
  const lanes = [
    { name: 'loop', width: 3.2, ...loop },
    { name: 'outer', width: 2.6, ...outer },
  ];
  const ribbons = [...lanes, { name: 'spur', width: 2.2, ...spur }];

  // spatial hash of path samples for "distance to the nearest path" queries
  const CELL = 4, pathGrid = new Map();
  for (const r of ribbons) {
    for (let i = 0; i < r.count; i++) {
      const x = r.pts[i * 2], z = r.pts[i * 2 + 1];
      const key = Math.floor(x / CELL) * 4096 + Math.floor(z / CELL);
      if (!pathGrid.has(key)) pathGrid.set(key, []);
      pathGrid.get(key).push(x, z, r.width / 2);
    }
  }
  /** Distance from (x, z) to the nearest path EDGE (negative on the path); capped at ~4 m. */
  const pathClearance = (x, z) => {
    let bestD = 4;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const cell = pathGrid.get(ix * 4096 + iz);
        if (!cell) continue;
        for (let k = 0; k < cell.length; k += 3) {
          const d = Math.hypot(cell[k] - x, cell[k + 1] - z) - cell[k + 2];
          if (d < bestD) bestD = d;
        }
      }
    }
    return bestD;
  };

  // ---- terrain ------------------------------------------------------------
  {
    const b = new MeshBuilder();
    const N = 128, cell = (TERRAIN_HALF * 2) / N;
    const vx = new Float32Array((N + 1) * (N + 1)), vy = new Float32Array(vx.length), vz = new Float32Array(vx.length);
    for (let iz = 0; iz <= N; iz++) {
      for (let ix = 0; ix <= N; ix++) {
        let x = -TERRAIN_HALF + ix * cell, z = -TERRAIN_HALF + iz * cell;
        if (ix > 0 && ix < N && iz > 0 && iz < N) {
          x += (hash01(ix * 131 + iz, 11) - 0.5) * cell * 0.55;
          z += (hash01(ix * 131 + iz, 12) - 0.5) * cell * 0.55;
        }
        const i = iz * (N + 1) + ix;
        vx[i] = x; vz[i] = z; vy[i] = terrainHeight(x, z);
      }
    }
    const P = (i) => [vx[i], vy[i], vz[i]];
    const faceColor = (p0, p1, p2, id) => {
      const x = (p0[0] + p1[0] + p2[0]) / 3, y = (p0[1] + p1[1] + p2[1]) / 3, z = (p0[2] + p1[2] + p2[2]) / 3;
      const h = hash01(id, 21);
      if (y < WATER_LEVEL - 0.05) return scaleColor(mixColor(C.bed[0], C.bed[1], smoothstep(WATER_LEVEL, WATER_LEVEL - 1.5, y)), 0.96 + h * 0.08);
      const patch = 0.5 + 0.5 * Math.sin(0.09 * x + 1.0) * Math.sin(0.11 * z + 2.0) + (h - 0.5) * 0.55;
      const base = patch > 0.66 ? C.grass[0] : patch > 0.42 ? C.grass[1] : patch > 0.2 ? C.grass[2] : C.grass[3];
      return scaleColor(base, 0.97 + hash01(id, 22) * 0.06);
    };
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const a = P(iz * (N + 1) + ix), bb = P(iz * (N + 1) + ix + 1);
        const c = P((iz + 1) * (N + 1) + ix + 1), d = P((iz + 1) * (N + 1) + ix);
        const id = (iz * N + ix) * 2;
        if ((ix + iz) % 2 === 0) {
          b.tri(a, d, c, faceColor(a, d, c, id));
          b.tri(a, c, bb, faceColor(a, c, bb, id + 1));
        } else {
          b.tri(a, d, bb, faceColor(a, d, bb, id));
          b.tri(bb, d, c, faceColor(bb, d, c, id + 1));
        }
      }
    }
    // flat skirt out to the horizon (fog hides the far end)
    const S = 1250, Hh = TERRAIN_HALF, y = EDGE_HEIGHT, xs = [-S, -Hh, Hh, S];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (i === 1 && j === 1) continue;
        b.quad([xs[i], y, xs[j]], [xs[i], y, xs[j + 1]], [xs[i + 1], y, xs[j + 1]], [xs[i + 1], y, xs[j]], C.grass[2]);
      }
    }
    addGeom('terrain', b);
  }

  // ---- path ribbons -------------------------------------------------------
  {
    const b = new MeshBuilder();
    const LIFT = 0.07;
    for (const r of ribbons) {
      const hw = r.width / 2, n = r.count, last = r.closed ? n : n - 1;
      const edge = (i) => {
        const p = (k) => [r.pts[((k + n) % n) * 2], r.pts[((k + n) % n) * 2 + 1]];
        const a = p(r.closed ? i - 1 : Math.max(0, i - 1)), c = p(r.closed ? i + 1 : Math.min(n - 1, i + 1)), m = p(i);
        let tx = c[0] - a[0], tz = c[1] - a[1];
        const l = Math.hypot(tx, tz) || 1;
        tx /= l; tz /= l;
        const pt = (side) => {
          const x = m[0] + tz * hw * side, z = m[1] - tx * hw * side;
          return [x, terrainHeight(x, z) + LIFT, z];
        };
        return [pt(-1), pt(1)];
      };
      for (let i = 0; i < last; i++) {
        const [l0, r0] = edge(i), [l1, r1] = edge(i + 1);
        const tone = scaleColor(C.path[Math.floor(hash01(i, r.width * 10) * 3)], 0.98 + hash01(i, 31) * 0.04);
        b.quad(l0, l1, r1, r0, tone);
      }
    }
    // make sure every face points up regardless of path direction
    const fixed = new MeshBuilder();
    for (let t = 0; t < b.triangleCount; t++) {
      const o = t * 9;
      const a = [b.p[o], b.p[o + 1], b.p[o + 2]], bb = [b.p[o + 3], b.p[o + 4], b.p[o + 5]], c = [b.p[o + 6], b.p[o + 7], b.p[o + 8]];
      const colr = [b.c[o], b.c[o + 1], b.c[o + 2]];
      if (b.n[o + 1] >= 0) fixed.tri(a, bb, c, colr); else fixed.tri(a, c, bb, colr);
    }
    addGeom('paths', fixed);
  }

  // ---- water --------------------------------------------------------------
  {
    const b = new MeshBuilder();
    const SEG = 40, rings = [0.4, 0.78, 1.14];
    const pt = (ring, s) => {
      const a = (s / SEG) * Math.PI * 2;
      const wobble = 1 + 0.09 * Math.sin(3 * a + 0.7) + 0.05 * Math.sin(5 * a + 2.1);
      const q = rings[ring] * wobble;
      const jitter = ring < 2 ? (hash01(s % SEG, 40 + ring) - 0.5) * 0.07 : 0;
      return [POND.cx + Math.cos(a) * POND.rx * q, WATER_LEVEL + jitter, POND.cz + Math.sin(a) * POND.rz * q];
    };
    const tone = (i) => C.water[Math.floor(hash01(i, 44) * C.water.length)];
    const center = [POND.cx, WATER_LEVEL, POND.cz];
    let id = 0;
    for (let s = 0; s < SEG; s++) {
      b.tri(center, pt(0, s + 1), pt(0, s), tone(id++));
      for (let ring = 0; ring < 2; ring++) {
        b.tri(pt(ring, s), pt(ring, s + 1), pt(ring + 1, s + 1), tone(id++));
        b.tri(pt(ring, s), pt(ring + 1, s + 1), pt(ring + 1, s), tone(id++));
      }
    }
    // normalise winding so the surface faces up
    const fixed = new MeshBuilder();
    for (let t = 0; t < b.triangleCount; t++) {
      const o = t * 9;
      const a = [b.p[o], b.p[o + 1], b.p[o + 2]], bb = [b.p[o + 3], b.p[o + 4], b.p[o + 5]], c = [b.p[o + 6], b.p[o + 7], b.p[o + 8]];
      const colr = [b.c[o], b.c[o + 1], b.c[o + 2]];
      if (b.n[o + 1] >= 0) fixed.tri(a, bb, c, colr); else fixed.tri(a, c, bb, colr);
    }
    addGeom('water', fixed);
  }

  // ---- props --------------------------------------------------------------
  const gRand = createRandom(seed * 7919 + 17); // geometry stream: independent of npcs/density
  addGeom('tree_round_a', buildRoundTree(gRand, {
    trunkR: 0.24, trunkH: 2.5, lean: 0.04,
    blobs: [{ x: 0, y: 3.7, z: 0, r: 1.75 }, { x: 1.05, y: 3.1, z: 0.35, r: 1.25 }, { x: -0.95, y: 3.25, z: -0.5, r: 1.15 }, { x: 0.1, y: 4.75, z: -0.2, r: 1.0 }],
  }, C.canopy));
  addGeom('tree_round_b', buildRoundTree(gRand, {
    trunkR: 0.27, trunkH: 3.1, lean: -0.1,
    branches: [{ x: 0.2, y: 1.7, z: 0, rz: -0.75, len: 1.5 }],
    blobs: [{ x: 0.35, y: 4.5, z: 0, r: 1.6 }, { x: -1.15, y: 3.9, z: 0.4, r: 1.25 }, { x: 1.5, y: 3.5, z: -0.5, r: 1.2 }, { x: 0.1, y: 5.45, z: 0.3, r: 1.0 }, { x: 0.9, y: 4.6, z: 0.9, r: 0.95 }],
  }, C.canopyB));
  addGeom('tree_round_c', buildRoundTree(gRand, {
    trunkR: 0.18, trunkH: 1.75, lean: 0.03,
    blobs: [{ x: 0, y: 2.6, z: 0, r: 1.3 }, { x: 0.7, y: 2.2, z: -0.3, r: 0.8 }],
  }, C.canopy));
  addGeom('tree_pine', buildPine(gRand));
  addGeom('bush_a', buildBush(gRand, 0));
  addGeom('bush_b', buildBush(gRand, 1));
  addGeom('rock_a', buildRock(gRand, 0));
  addGeom('rock_b', buildRock(gRand, 1));
  addGeom('rock_c', buildRock(gRand, 2));
  addGeom('daisy', buildDaisy());
  addGeom('grass_a', buildGrassTuft(gRand, 0));
  addGeom('grass_b', buildGrassTuft(gRand, 1));
  addGeom('lamp', buildLamp());
  addGeom('bench', buildBench());
  addGeom('gazebo', buildGazebo());
  addGeom('skyline', buildSkyline(createRandom(seed * 104729 + 5)));
  addGeom('sky', buildSky());
  for (let v = 0; v < 4; v++) addGeom(`cloud_${v}`, buildCloud(gRand, v));
  addGeom('sun_disc', buildSunDisc());
  addGeom('sun_rays', buildSunRays());
  const CHARACTER_VARIANTS = 6;
  for (let v = 0; v < CHARACTER_VARIANTS; v++) buildCharacterParts(v, geometries, colorSpace);
  buildBirdParts(geometries, colorSpace);
  addGeom('duck', buildDuck());

  // ---- static instance placement -------------------------------------------
  /** @type {Record<string, number[]>} */
  const placed = {};
  const put = (name, x, z, yaw, scale, sink = 0) => {
    (placed[name] ||= []).push(x, terrainHeight(x, z) - sink * scale, z, yaw, scale);
  };
  const inMeadow = (x, z) => ((x - 4) / 23) ** 2 + ((z - 26) / 13.5) ** 2 < 1; // open lawn between camera and pond
  const nearGazebo = (x, z, r) => Math.hypot(x - GAZEBO.x, z - GAZEBO.z) < r || (x > GAZEBO.x - 13 && x < GAZEBO.x + 6 && Math.abs(z - GAZEBO.z) < r * 0.5);
  const polar = (rand, r0, r1, power = 1) => {
    const a = rand() * Math.PI * 2, r = r0 + (r1 - r0) * Math.pow(rand(), power);
    return [PARK.x + Math.cos(a) * r, PARK.z + Math.sin(a) * r];
  };

  // hero composition (matches the reference picture): big tree, lamp, bench, rocks, daisies
  put('tree_round_b', -3.3, 28.0, 0.25, 1.75, 0.05);
  put('lamp', -5.0, 20.0, 0.4, 1, 0);
  put('bench', -2.9, 20.3, 0.21, 1, 0);
  put('rock_a', -2.3, 31.0, 0.6, 1.25, 0.12);
  put('rock_b', 8.2, 28.6, 2.1, 1.0, 0.1);
  put('rock_c', 3.4, 16.9, 1.0, 0.8, 0.1);
  put('rock_b', 6.3, 16.1, 4.0, 0.62, 0.08);
  put('bush_a', -15.5, 24.2, 0.3, 1.5, 0.05);
  put('bush_b', -17.2, 26.0, 1.9, 1.2, 0.05);
  put('bush_a', 26.5, 18.5, 1.1, 1.15, 0.05);
  put('tree_pine', -1.0, -20.5, 0, 1.25, 0.05);
  [[-1.4, 30.2], [-0.3, 29.2], [0.9, 31.4], [1.3, 32.3], [3.1, 30.9], [4.4, 32.4], [-3.2, 27.9], [5.9, 29.9], [2.2, 28.4]].forEach(([x, z], i) => {
    put('daisy', x, z, (hash01(i, 77) - 0.5) * 0.9, 1.1 + hash01(i, 78) * 0.5, 0);
  });

  const heroTreeXZ = [-3.3, 28.0];
  const treeRand = createRandom(seed * 31 + 101);
  const treeSpots = [];
  const tooClose = (x, z, min) => treeSpots.some((p) => Math.hypot(p[0] - x, p[1] - z) < min);
  const treeKinds = ['tree_round_a', 'tree_round_b', 'tree_round_c', 'tree_pine'];
  const pickTree = (rand) => { const u = rand(); return u < 0.32 ? treeKinds[0] : u < 0.58 ? treeKinds[1] : u < 0.82 ? treeKinds[2] : treeKinds[3]; };
  // park trees: sparse near the centre, denser towards the edge
  for (let i = 0, made = 0, target = Math.round(150 * density); made < target && i < target * 30; i++) {
    const [x, z] = polar(treeRand, 24, 100, 0.8);
    const kind = pickTree(treeRand), yaw = treeRand() * 6.28, scale = 0.85 + treeRand() * 0.6;
    if (pondQ(x, z) < 1.6 || pathClearance(x, z) < 1.7 || inMeadow(x, z) || nearGazebo(x, z, 7)) continue;
    if (Math.hypot(x - heroTreeXZ[0], z - heroTreeXZ[1]) < 9 || tooClose(x, z, 3.4 / Math.sqrt(density))) continue;
    treeSpots.push([x, z]);
    put(kind, x, z, yaw, scale, 0.05);
    made++;
  }
  // backdrop ring of bigger trees on the ridge
  for (let i = 0, made = 0, target = Math.round(260 * density); made < target && i < target * 30; i++) {
    const [x, z] = polar(treeRand, 98, 134, 1);
    const kind = pickTree(treeRand), yaw = treeRand() * 6.28, scale = 0.95 + treeRand() * 0.55;
    if (tooClose(x, z, 2.6 / Math.sqrt(density))) continue;
    treeSpots.push([x, z]);
    put(kind, x, z, yaw, scale, 0.05);
    made++;
  }

  const bushRand = createRandom(seed * 31 + 202);
  for (let i = 0, made = 0, target = Math.round(90 * density); made < target && i < target * 30; i++) {
    const [x, z] = polar(bushRand, 8, 96, 0.9);
    const kind = bushRand() < 0.55 ? 'bush_a' : 'bush_b', yaw = bushRand() * 6.28, scale = 0.8 + bushRand() * 0.8;
    if (pondQ(x, z) < 1.2 || pathClearance(x, z) < 0.9 || nearGazebo(x, z, 5)) continue;
    if (((x - 3) / 14) ** 2 + ((z - 29) / 8) ** 2 < 1) continue;
    put(kind, x, z, yaw, scale, 0.05);
    made++;
  }

  const rockRand = createRandom(seed * 31 + 303);
  for (let i = 0, made = 0, target = Math.round(70 * density); made < target && i < target * 40; i++) {
    let x, z;
    if (rockRand() < 0.32) { // along the pond bank
      const a = rockRand() * Math.PI * 2, q = 1.0 + rockRand() * 0.2;
      const wobble = 1 + 0.09 * Math.sin(3 * a + 0.7) + 0.05 * Math.sin(5 * a + 2.1);
      x = POND.cx + Math.cos(a) * POND.rx * q * wobble; z = POND.cz + Math.sin(a) * POND.rz * q * wobble;
    } else [x, z] = polar(rockRand, 4, 92, 0.9);
    const kind = ['rock_a', 'rock_b', 'rock_c'][Math.floor(rockRand() * 3)], yaw = rockRand() * 6.28, scale = 0.5 + rockRand() * 0.9;
    if (pondQ(x, z) < 0.98 || pathClearance(x, z) < 0.6 || nearGazebo(x, z, 4.2)) continue;
    put(kind, x, z, yaw, scale, 0.1);
    made++;
  }

  const flowerRand = createRandom(seed * 31 + 404);
  for (let i = 0, made = 0, target = Math.round(700 * density); made < target && i < target * 30; i++) {
    let x, z;
    if (flowerRand() < 0.3) { x = 4 + (flowerRand() * 2 - 1) * 22; z = 26 + (flowerRand() * 2 - 1) * 13; } else [x, z] = polar(flowerRand, 0, 84, 0.75);
    const yaw = flowerRand() * 6.28, scale = 0.8 + flowerRand() * 0.7;
    if (pondQ(x, z) < 1.1 || pathClearance(x, z) < 0.35) continue;
    put('daisy', x, z, yaw, scale, 0);
    made++;
  }

  const grassRand = createRandom(seed * 31 + 505);
  for (let i = 0, made = 0, target = Math.round(5000 * density); made < target && i < target * 30; i++) {
    const [x, z] = polar(grassRand, 0, 96, 0.72);
    const kind = grassRand() < 0.5 ? 'grass_a' : 'grass_b', yaw = grassRand() * 6.28, scale = 0.9 + grassRand() * 1.0;
    if (pondQ(x, z) < 1.04 || pathClearance(x, z) < 0.2) continue;
    put(kind, x, z, yaw, scale, 0);
    made++;
  }

  // lamps and benches along the paths
  const tmp = { x: 0, z: 0, tx: 0, tz: 0 };
  for (const [lane, every, lateral] of [[lanes[0], 24, 2.5], [lanes[1], 31, 2.2]]) {
    const count = Math.floor(lane.length / every);
    for (let i = 0; i < count; i++) {
      sampleLane(lane, (i + 0.35) * (lane.length / count), lateral, tmp);
      if (Math.hypot(tmp.x + 5.0, tmp.z - 20.0) < 13 || pondQ(tmp.x, tmp.z) < 1.15 || nearGazebo(tmp.x, tmp.z, 5)) continue;
      put('lamp', tmp.x, tmp.z, Math.atan2(tmp.tx, tmp.tz), 1, 0);
    }
  }
  for (const [lane, every, lateral] of [[lanes[0], 37, -2.45], [lanes[1], 49, -2.2]]) {
    const count = Math.floor(lane.length / every);
    for (let i = 0; i < count; i++) {
      sampleLane(lane, (i + 0.8) * (lane.length / count), lateral, tmp);
      if (Math.hypot(tmp.x + 2.9, tmp.z - 20.3) < 14 || pondQ(tmp.x, tmp.z) < 1.2 || nearGazebo(tmp.x, tmp.z, 6)) continue;
      // face the path: local +Z towards the lane centre
      put('bench', tmp.x, tmp.z, Math.atan2(-tmp.tz * Math.sign(lateral), tmp.tx * Math.sign(lateral)), 1, 0);
    }
  }

  // ---- static batches -----------------------------------------------------
  /** @type {StaticBatch[]} */
  const statics = [];
  const single = (name, geometry, material, castShadow, receiveShadow, matrix) => {
    statics.push(makeBatch(name, geometries[geometry], material, castShadow, receiveShadow, matrix || mat4FromYawScale(0, 0, 0, 0, 1), 1));
  };
  single('sky', 'sky', 'sky', false, false);
  single('terrain', 'terrain', 'lit', false, true);
  single('paths', 'paths', 'lit', false, true);
  single('skyline', 'skyline', 'lit', false, false);
  single('gazebo', 'gazebo', 'lit', true, true, mat4FromYawScale(GAZEBO.x, GAZEBO.deckY, GAZEBO.z, 0, 1));
  const order = ['tree_round_a', 'tree_round_b', 'tree_round_c', 'tree_pine', 'bush_a', 'bush_b', 'rock_a', 'rock_b', 'rock_c', 'lamp', 'bench', 'daisy', 'grass_a', 'grass_b'];
  for (const name of order) {
    const list = placed[name] || [];
    const count = list.length / 5;
    const matrices = new Float32Array(count * 16);
    for (let i = 0; i < count; i++) {
      matrices.set(mat4FromYawScale(list[i * 5], list[i * 5 + 1], list[i * 5 + 2], list[i * 5 + 3], list[i * 5 + 4]), i * 16);
    }
    const small = name === 'daisy' || name.startsWith('grass');
    statics.push(makeBatch(name, geometries[name], 'lit', !small, true, matrices, count));
  }
  single('water', 'water', 'water', false, true);

  // ---- dynamic scene-graph nodes -------------------------------------------
  /** @type {DynamicNode[]} */
  const nodes = [];
  const node = (name, parent, geometry, o = {}) => {
    nodes.push({
      name, parent, geometry: geometry || null, material: o.material || 'lit',
      castShadow: !!o.castShadow, receiveShadow: !!o.receiveShadow, scale: o.scale ?? 1,
      position: o.position || [0, 0, 0],
    });
    return nodes.length - 1;
  };
  const humanoid = (name, variant, scale) => {
    const root = node(name, -1, null, { scale });
    const part = (suffix, geometry, position) => node(`${name}/${suffix}`, root, geometry, { castShadow: true, receiveShadow: true, position });
    return {
      root,
      torso: part('torso', `torso_${variant}`, [0, 0.8, 0]),
      head: part('head', `head_${variant}`, [0, 1.4, 0]),
      armL: part('armL', `arm_${variant}`, [-0.288, 1.37, 0]),
      armR: part('armR', `arm_${variant}`, [0.288, 1.37, 0]),
      legL: part('legL', `leg_${variant}`, [-0.105, 0.8, 0]),
      legR: part('legR', `leg_${variant}`, [0.105, 0.8, 0]),
    };
  };

  const actors = { player: null, npcs: [], birds: [], clouds: [], ducks: [], sun: null };
  actors.player = { ...humanoid('player', 0, 1.06), start: { x: 1.1, z: 27.2, yaw: Math.PI } };

  for (let i = 0; i < npcCount; i++) {
    const lane = hash01(i, 1) < 0.45 ? 0 : 1;
    const half = lanes[lane].width / 2 - 0.35;
    actors.npcs.push({
      ...humanoid(`npc${i}`, 1 + (i % (CHARACTER_VARIANTS - 1)), 0.9 + hash01(i, 2) * 0.22),
      lane,
      s0: hash01(i, 3) * lanes[lane].length,
      speed: 1.15 + hash01(i, 4) * 1.1,
      dir: hash01(i, 5) < 0.5 ? 1 : -1,
      lateral: (hash01(i, 6) * 2 - 1) * half,
      phase: hash01(i, 7) * 6.28,
    });
  }

  for (let i = 0; i < 16; i++) {
    const root = node(`bird${i}`, -1, null, { scale: 1.5 + hash01(i, 50) * 0.9 });
    actors.birds.push({
      root,
      body: node(`bird${i}/body`, root, 'bird_body'),
      wingL: node(`bird${i}/wingL`, root, 'bird_wing_l', { position: [-0.05, 0.02, 0] }),
      wingR: node(`bird${i}/wingR`, root, 'bird_wing_r', { position: [0.05, 0.02, 0] }),
      cx: 8 + (hash01(i, 51) - 0.5) * 50, cz: 10 + (hash01(i, 52) - 0.5) * 50,
      radius: 16 + hash01(i, 53) * 42, height: 13 + hash01(i, 54) * 22,
      speed: (0.16 + hash01(i, 55) * 0.2) * (hash01(i, 56) < 0.5 ? 1 : -1), phase: hash01(i, 57) * 6.28,
    });
  }

  for (let i = 0; i < 14; i++) {
    const az = (i / 14) * Math.PI * 2 + (hash01(i, 60) - 0.5) * 0.35;
    const dist = 330 + hash01(i, 61) * 380;
    actors.clouds.push({
      node: node(`cloud${i}`, -1, `cloud_${i % 4}`, { material: 'cloud', scale: 3.2 + hash01(i, 62) * 4.2 }),
      az, dist, y: 95 + hash01(i, 63) * 120,
      yaw: hash01(i, 64) * 0.6 - 0.3, speed: 1.5 + hash01(i, 65) * 2.5, // metres per second along the orbit
    });
  }

  for (let i = 0; i < 6; i++) {
    actors.ducks.push({
      node: node(`duck${i}`, -1, 'duck', { scale: 1.25, castShadow: true }),
      cx: POND.cx - 4 + (hash01(i, 70) - 0.5) * 3, cz: POND.cz + 0.25 + (hash01(i, 71) - 0.5) * 2.5,
      radius: 1.3 + hash01(i, 72) * 2.2, speed: (0.22 + hash01(i, 73) * 0.2) * (i % 2 ? 1 : -1), phase: hash01(i, 74) * 6.28,
    });
  }

  // decorative sun (not the light direction: purely a sky ornament, like in the reference picture)
  const sunAz = 0.5, sunEl = 0.34, sunDist = 1100;
  const sunPos = [PARK.x + Math.sin(sunAz) * Math.cos(sunEl) * sunDist, Math.sin(sunEl) * sunDist, PARK.z - Math.cos(sunAz) * Math.cos(sunEl) * sunDist];
  const sunDisc = node('sun', -1, 'sun_disc', { material: 'unlit', scale: 62, position: sunPos });
  actors.sun = {
    disc: sunDisc,
    rays: node('sun/rays', sunDisc, 'sun_rays', { material: 'unlit' }),
    position: sunPos,
    quaternion: quatLookAt(sunPos, [PARK.x, 0, PARK.z]),
  };

  // ---- environment --------------------------------------------------------
  const sunDirection = normalize3([0.5, 0.8, 0.16]);
  const env = {
    // Lights are specified in LINEAR space, independent of `colorSpace`.
    // Intended shading (linear), see demos/raw for the reference implementation:
    //   lit = albedo * (ambient.color*ambient.intensity
    //                   + sun.color*sun.intensity*max(N.L_sun,0)*shadow
    //                   + fill.color*fill.intensity*max(N.L_fill,0))
    sun: { direction: sunDirection, color: [1.0, 0.95, 0.84], intensity: 0.86 },
    fill: { direction: normalize3([-0.55, 0.38, 0.74]), color: [0.72, 0.84, 1.0], intensity: 0.24 },
    ambient: { color: [0.8, 0.9, 1.0], intensity: 0.46 },
    // `direction` vectors point FROM the surface TOWARDS the light.
    shadow: {
      center: [PARK.x, 0, PARK.z], // the shadow camera looks at this point
      halfSize: 84, // orthographic half extent (metres), both axes
      distance: 220, // light "position" = center + sun.direction * distance
      near: 1,
      far: 460,
      mapSize: 2048,
    },
    fog: { color: cs(C.sky.horizon), near: 90, far: 760 }, // linear fog on view-space depth
    sky: { zenith: cs(C.sky.zenith), horizon: cs(C.sky.horizon) },
    camera: { fov: 50, near: 0.5, far: 1500 }, // vertical field of view in degrees
    waterLevel: WATER_LEVEL,
  };

  /** @type {Record<string, MaterialSpec>} */
  const materials = {
    lit: { lit: true, fog: true, transparent: false, opacity: 1, depthWrite: true },
    cloud: { lit: true, fog: false, transparent: false, opacity: 1, depthWrite: true },
    water: { lit: true, fog: true, transparent: true, opacity: 0.8, depthWrite: false },
    unlit: { lit: false, fog: false, transparent: false, opacity: 1, depthWrite: true },
    sky: { lit: false, fog: false, transparent: false, opacity: 1, depthWrite: false, background: true },
  };

  const heroEye = [0, terrainHeight(0, 34) + 1.85, 34];
  let triangles = 0;
  for (const s of statics) triangles += geometries[s.geometry].triangleCount * s.count;
  for (const n of nodes) if (n.geometry) triangles += geometries[n.geometry].triangleCount;

  return {
    seed, colorSpace,
    options: { seed, npcs: npcCount, density, colorSpace },
    geometries, materials, statics,
    dynamics: { nodes, count: nodes.length },
    actors, lanes, env,
    layout: { park: PARK, pond: POND, gazebo: GAZEBO, waterLevel: WATER_LEVEL, hero: { eye: heroEye, target: [5, 2.6, 0] } },
    stats: {
      geometries: Object.keys(geometries).length,
      staticBatches: statics.length,
      staticInstances: statics.reduce((a, s) => a + s.count, 0),
      dynamicNodes: nodes.length,
      dynamicMeshes: nodes.filter((n) => n.geometry).length,
      triangles,
    },
  };
}

function makeBatch(name, geometry, material, castShadow, receiveShadow, matrices, count) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const gb = geometry.bounds;
  for (let i = 0; i < count; i++) {
    const m = matrices.subarray(i * 16, i * 16 + 16);
    const s = Math.hypot(m[0], m[1], m[2]);
    const c = [
      m[0] * gb.center[0] + m[4] * gb.center[1] + m[8] * gb.center[2] + m[12],
      m[1] * gb.center[0] + m[5] * gb.center[1] + m[9] * gb.center[2] + m[13],
      m[2] * gb.center[0] + m[6] * gb.center[1] + m[10] * gb.center[2] + m[14],
    ];
    const r = gb.radius * s;
    for (let k = 0; k < 3; k++) {
      if (c[k] - r < min[k]) min[k] = c[k] - r;
      if (c[k] + r > max[k]) max[k] = c[k] + r;
    }
  }
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
  return { name, geometry: geometry.name, material, castShadow, receiveShadow, count, matrices, bounds: { min, max, center, radius } };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Bounds
 * @property {number[]} min
 * @property {number[]} max
 * @property {number[]} center
 * @property {number} radius   bounding-sphere radius around `center`
 *
 * @typedef {Object} Geometry
 * @property {string} name
 * @property {Float32Array} positions  xyz per vertex; non-indexed triangle list, CCW front faces
 * @property {Float32Array} normals    xyz per vertex; flat face normals, already baked
 * @property {Float32Array} colors     rgb per vertex, in the colour space passed to createWorld
 * @property {number} vertexCount
 * @property {number} triangleCount
 * @property {Bounds} bounds           local space
 *
 * @typedef {Object} MaterialSpec
 * @property {boolean} lit          false: output the vertex colour unchanged (no lights, no shadows)
 * @property {boolean} fog
 * @property {boolean} transparent  alpha-blend with `opacity`
 * @property {number} opacity
 * @property {boolean} depthWrite
 * @property {boolean} [background] draw before everything else, never cull
 *
 * @typedef {Object} StaticBatch    never moves. count > 1: draw with hardware instancing (one draw call per pass)
 * @property {string} name
 * @property {string} geometry      key into world.geometries
 * @property {string} material      key into world.materials
 * @property {boolean} castShadow
 * @property {boolean} receiveShadow
 * @property {number} count
 * @property {Float32Array} matrices  count * 16, column-major world matrices
 * @property {Bounds} bounds        world-space bounds of all instances
 *
 * @typedef {Object} DynamicNode    one regular scene-graph node, re-posed every frame by the simulation
 * @property {string} name
 * @property {number} parent        index of the parent node, -1 for the scene root (parents precede children)
 * @property {string|null} geometry key into world.geometries, or null for a pure transform node
 * @property {string} material
 * @property {boolean} castShadow
 * @property {boolean} receiveShadow
 * @property {number} scale         constant uniform local scale
 * @property {number[]} position    initial local position
 *
 * @typedef {Object} World
 * @property {Record<string, Geometry>} geometries
 * @property {Record<string, MaterialSpec>} materials
 * @property {StaticBatch[]} statics
 * @property {{nodes: DynamicNode[], count: number}} dynamics
 * @property {Object} actors        simulation bookkeeping (see sim.js); demos do not need it
 * @property {Object[]} lanes       walking paths (see sampleLane)
 * @property {Object} env           lights, shadow frustum, fog, camera
 * @property {Object} layout
 * @property {Object} stats
 */
