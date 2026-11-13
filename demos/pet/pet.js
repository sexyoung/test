// Low-poly pet generator. A small parameter object (species, body, ears, tail, colours,
// pattern...) becomes a three.js node tree plus animation clips. Used by the pet editor
// (demos/pet) and the park (demos/three/models.js); GLTFExporter turns the result into a .glb.
//
// Modelling approach (the way hand-made low-poly animals are usually built): every body part is
// a LOFT, a chain of cross-section rings along a path, so the torso runs continuously from the
// rump through the waist, chest and shoulders up into the neck, legs have thighs, hocks and paws,
// and the head tapers into a muzzle. Faces are flat-shaded and every face gets ONE colour, so
// coat patterns have crisp edges like painted low-poly models. About 1,000 triangles per pet.
//
// Node tree (the pet faces +z, the origin is on the ground between its paws):
//   Pet > Body > Head > EarL, EarR, EyeL, EyeR
//              > Tail
//       > LegFL, LegFR, LegBL, LegBR
// Every node's parts are merged into one mesh (about 12 draw calls, one material).
// Animations: "Idle" (with a blink), "Walk", "Happy".

import {
  Group, Mesh, MeshStandardMaterial, MeshBasicMaterial, DoubleSide, Raycaster, BufferGeometry, BufferAttribute, Float32BufferAttribute, Color,
  Matrix4, Euler, Quaternion, Vector3, CylinderGeometry, ConeGeometry, IcosahedronGeometry, CatmullRomCurve3,
  AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const STORAGE_KEY = 'lowpoly-pet';

export const DEFAULT_PET = {
  name: '小橘', species: 'cat', size: 1, body: 'normal', head: 1, legs: 1, snout: 1, eyes: 1,
  ears: 'pointed', tail: 'long', pattern: 'tabby',
  main: '#e8914a', secondary: '#fbf1e2', eye: '#9cc04a', nose: '#e58f9b',
};

export const OPTIONS = {
  species: { cat: '貓', dog: '狗' },
  body: { slim: '苗條', normal: '標準', chubby: '圓滾滾' },
  ears: { pointed: '尖耳', folded: '摺耳', floppy: '垂耳', round: '圓耳' },
  tail: { long: '長尾', short: '短尾', fluffy: '蓬鬆', curly: '捲尾' },
  pattern: { solid: '純色', bicolor: '雙色', colorpoint: '重點色', tabby: '虎斑', tuxedo: '賓士', spots: '斑點' },
};

// Starting points for the dice button: [species, main, secondary, pattern, ears, tail, eye, nose]
const LOOKS = [
  ['cat', '#e8914a', '#fbf1e2', 'tabby', 'pointed', 'long', '#9cc04a', '#e58f9b'],
  ['cat', '#f7f2ea', '#b98a66', 'colorpoint', 'pointed', 'fluffy', '#5aa8e0', '#e8a0aa'],
  ['cat', '#8e98a6', '#f6f3ee', 'bicolor', 'pointed', 'long', '#d9a43a', '#e8a0aa'],
  ['cat', '#34323a', '#f4f0e8', 'tuxedo', 'pointed', 'long', '#e2b84a', '#d98f9b'],
  ['cat', '#c7c9cf', '#f6f3ee', 'bicolor', 'folded', 'fluffy', '#e2a33c', '#e3a0aa'],
  ['cat', '#f5f1ea', '#f5f1ea', 'solid', 'pointed', 'long', '#6f8fe0', '#efa3ae'],
  ['dog', '#d98a45', '#fbf3e6', 'tuxedo', 'pointed', 'curly', '#3a2a22', '#2e2a2c'],
  ['dog', '#e3bc7a', '#f6e6c6', 'solid', 'floppy', 'fluffy', '#3a2a22', '#2e2a2c'],
  ['dog', '#f6f3ee', '#2f2e33', 'spots', 'floppy', 'long', '#3a2a22', '#2e2a2c'],
  ['dog', '#6f7680', '#f2f2f0', 'tuxedo', 'pointed', 'curly', '#7ab0e0', '#2e2a2c'],
  ['dog', '#b9855a', '#f6ead8', 'tuxedo', 'round', 'short', '#3a2a22', '#2e2a2c'],
  ['dog', '#2e2c31', '#c27a45', 'tuxedo', 'floppy', 'long', '#3a2a22', '#1e1c20'],
];
const NAMES = { cat: ['小橘', '咪咪', '奶茶', '黑糖', '麻糬', '布丁', '湯圓'], dog: ['小柴', '旺財', '豆豆', '可樂', '球球', '阿福', '棉花'] };

export function randomPet(rand = Math.random) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const [species, main, secondary, pattern, ears, tail, eye, nose] = pick(LOOKS);
  const around = (lo, hi) => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
  return {
    ...DEFAULT_PET, name: pick(NAMES[species]), species, main, secondary, pattern, ears, tail, eye, nose,
    body: pick(['normal', 'normal', 'chubby', 'slim']), size: around(0.9, 1.15), head: around(0.95, 1.1),
    legs: around(0.9, 1.1), snout: species === 'dog' ? around(0.8, 1.4) : 1, eyes: around(0.9, 1.15),
  };
}

/** Fills in missing or invalid fields, so old or hand-edited data never breaks the builder. */
export function normalizePet(p = {}) {
  const out = { ...DEFAULT_PET };
  for (const k of Object.keys(OPTIONS)) if (p[k] in OPTIONS[k]) out[k] = p[k];
  for (const k of ['size', 'head', 'legs', 'snout', 'eyes']) if (p[k] !== '' && p[k] != null && Number.isFinite(+p[k])) out[k] = Math.min(2, Math.max(0.4, +p[k]));
  for (const k of ['main', 'secondary', 'eye', 'nose']) if (/^#[0-9a-f]{6}$/i.test(p[k] ?? '')) out[k] = p[k];
  if (typeof p.name === 'string') out.name = p.name.slice(0, 20);
  return out;
}

export function loadPet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizePet(JSON.parse(raw)) : null;
  } catch { return null; }
}
export function savePet(p) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); return true; } catch { return false; }
}

// ---- geometry helpers --------------------------------------------------------------------------

const V = (x, y, z) => new Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Loft: rings of n vertices around a path, joined by triangles, with fan caps at both ends.
 * sections: [{ c: Vector3 centre, w: half-width along x, h: half-height along the ring's "up" }]
 * The path direction must lie in the yz plane (x only offsets the rings). "belly" squashes the
 * lower half of every ring; capStart / capEnd push the cap centres outwards (a pointed end);
 * twist rotates every other ring by that fraction of a step (triangular facets).
 */
function loft(sections, { n = 10, belly = 1, capStart = 0, capEnd = 0, twist = 0 } = {}) {
  const rings = sections.map((s, i) => {
    const prev = sections[Math.max(0, i - 1)].c, next = sections[Math.min(sections.length - 1, i + 1)].c;
    const t = V(0, next.y - prev.y, next.z - prev.z).normalize();
    const up = V(0, t.z, -t.y); // (+x, up, t) is a right-handed frame, so faces wind outwards
    const pts = [];
    for (let j = 0; j < n; j++) {
      const a = ((j + (i % 2) * twist) / n) * Math.PI * 2;
      const cy = Math.cos(a);
      pts.push(s.c.clone().add(V(Math.sin(a) * s.w, 0, 0)).addScaledVector(up, (cy < 0 ? cy * belly : cy) * s.h));
    }
    return { pts, t, c: s.c };
  });
  const pos = [];
  const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i].pts, B = rings[i + 1].pts;
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      tri(A[j], B[j], A[j1]);
      tri(A[j1], B[j], B[j1]);
    }
  }
  const first = rings[0], last = rings[rings.length - 1];
  const c0 = first.c.clone().addScaledVector(first.t, -capStart), c1 = last.c.clone().addScaledVector(last.t, capEnd);
  for (let j = 0; j < n; j++) {
    const j1 = (j + 1) % n;
    tri(c0, first.pts[j], first.pts[j1]);
    tri(c1, last.pts[j1], last.pts[j]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

/** Sections from [z, y, w, h] rows (a path along z), scaled by s. */
const rowsZ = (rows, s = 1) => rows.map(([z, y, w, h]) => ({ c: V(0, y * s, z * s), w: w * s, h: h * s }));

const _m = new Matrix4(), _q = new Quaternion(), _e = new Euler(), _v = new Vector3(), _s = new Vector3();
/** Bakes a transform into a primitive and makes it non-indexed (flat faces). */
function prim(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], quat = null } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  _m.compose(_v.fromArray(pos), quat ?? _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])), _s.fromArray(scale));
  return g.applyMatrix4(_m);
}

/** One colour per face, chosen at the face centre (pet space = node space + origin). */
function paintFaces(g, origin, pick) {
  const p = g.attributes.position, colors = new Float32Array(p.count * 3), c = new Vector3();
  for (let t = 0; t < p.count; t += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.x += p.getX(t + k), c.y += p.getY(t + k), c.z += p.getZ(t + k);
    c.multiplyScalar(1 / 3).add(origin);
    const col = pick(c);
    for (let k = 0; k < 3; k++) colors.set([col.r, col.g, col.b], (t + k) * 3);
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashString = (s) => [...s].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261);

let sharedMaterial = null;
export function petMaterial() {
  return (sharedMaterial ??= new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true, name: 'pet' }));
}

// ---- builder ----------------------------------------------------------------------------------

export function buildPet(input) {
  const P = normalizePet(input);
  const dog = P.species === 'dog';
  const B = { slim: [0.85, 0.92, 1.05], normal: [1, 1, 1], chubby: [1.28, 1.12, 0.96] }[P.body];

  // ---- dimensions (metres at size 1) ----
  const D = dog
    ? { BL: 0.5, cw: 0.088, ch: 0.105, ww: 0.07, wh: 0.077, hw: 0.082, hh: 0.09, leg: 0.15, rF: 0.029, rB: 0.035, Hr: 0.09, TL: 0.24, tr: 0.017 }
    : { BL: 0.42, cw: 0.074, ch: 0.082, ww: 0.064, wh: 0.07, hw: 0.078, hh: 0.084, leg: 0.115, rF: 0.024, rB: 0.03, Hr: 0.082, TL: 0.3, tr: 0.014 };
  const chubby = P.body === 'chubby';
  const L2 = (D.BL * B[2]) / 2;
  const cw = D.cw * B[0], ch = D.ch * B[1], ww = D.ww * B[0] * (chubby ? 1.15 : 1), wh = D.wh * B[1] * (chubby ? 1.12 : 1);
  const hw = D.hw * B[0], hh = D.hh * B[1];
  const legLen = D.leg * P.legs;
  const bodyY = legLen + ch * 0.95;
  const Hr = D.Hr * P.head;
  const headC = V(0, bodyY + ch * 1.42, L2 * 1.2 + Hr * 0.15);

  // ---- colours ----
  const C = (hex) => new Color(hex);
  const main = C(P.main), second = C(P.secondary);
  const darkMain = main.clone().lerp(C('#2a2226'), 0.38);
  const lightMain = main.clone().lerp(C('#ffffff'), 0.45);
  const noseC = C(P.nose), lum = 0.3 * noseC.r + 0.59 * noseC.g + 0.11 * noseC.b;
  const innerEar = (lum < 0.25 ? C('#eab0b8') : noseC.clone()).lerp(C('#ffffff'), 0.35); // dark noses would give grey ears
  const rand = mulberry32(hashString(P.name + P.species + P.pattern));
  const spots = [
    ...Array.from({ length: 6 }, () => ({ c: V((rand() * 2 - 1) * cw * 1.2, bodyY + (rand() * 1.4 - 0.3) * ch, (rand() * 2 - 1) * L2 * 0.95), r: ch * (0.45 + rand() * 0.4) })),
    { c: headC.clone().add(V((rand() > 0.5 ? 1 : -1) * Hr * 0.55, Hr * 0.45, Hr * 0.1)), r: Hr * 0.55 },
  ];
  const tailRoot = V(0, bodyY + ch * 0.25, -L2 * 1.0);
  const tailLen = D.TL * (P.tail === 'fluffy' ? 0.8 : P.tail === 'curly' ? 0.65 : P.tail === 'short' ? 0.25 : 1);
  const hipFY = bodyY - ch * 0.35, hipBY = bodyY - hh * 0.3;

  /** Coat colour at pet-space point p on a part ('body' | 'head' | 'ear' | 'leg' | 'tail'). Hard edges. */
  function coat(p, where) {
    const h = p.clone().sub(headC); // head-local
    const muzzle = where === 'head' && ((h.z > Hr * 0.42 && h.y < -Hr * 0.12) || (h.y < -Hr * 0.45 && h.z > -Hr * 0.1));
    let base = main, white = false;
    switch (P.pattern) {
      case 'solid':
        if (muzzle && !dog) base = lightMain;
        break;
      case 'bicolor': {
        let colored = true;
        if (where === 'head') colored = h.z < -Hr * 0.4 || h.y > (Math.abs(h.x) < Hr * 0.2 && h.z > 0 ? Hr * 0.55 : Hr * 0.1);
        else if (where === 'body') colored = p.y > bodyY + ch * 0.1 && p.z < L2 * 0.75;
        else if (where === 'leg') colored = p.y > hipBY * 0.75 && p.z < 0;
        white = !colored;
        break;
      }
      case 'colorpoint':
        if (where === 'head') base = h.distanceTo(V(0, -Hr * 0.1, Hr * 0.75)) < Hr * 0.62 ? second : main;
        else if (where === 'ear') base = second;
        else if (where === 'leg') base = p.y < hipFY * 0.4 ? second : main;
        else if (where === 'tail') base = p.distanceTo(tailRoot) > tailLen * 0.25 ? second : main;
        break;
      case 'tabby':
        if (where === 'body') {
          if (Math.sin(p.z * 70 + Math.abs(p.x) * 20) > 0.25 && p.y > bodyY - ch * 0.3) base = darkMain;
          white = p.y < bodyY - ch * 0.6;
        } else if (where === 'head') {
          if (h.y > Hr * 0.4 && h.z > -Hr * 0.3 && Math.sin(h.x * 95 + 1.57) > 0.3) base = darkMain;
          white = muzzle;
        } else if (where === 'leg') {
          if (Math.sin(p.y * 90) > 0.35 && p.y > hipFY * 0.25) base = darkMain;
        } else if (where === 'tail') {
          if (Math.sin(p.distanceTo(tailRoot) * 75) > 0.2) base = darkMain;
        }
        break;
      case 'tuxedo':
        if (where === 'body') white = p.y < bodyY - ch * 0.5 || (p.z > L2 * 0.5 && p.y < bodyY + ch * 0.45);
        else if (where === 'head') white = muzzle;
        else if (where === 'leg') white = p.y < hipFY * 0.35;
        break;
      case 'spots':
        if (!muzzle && spots.some((s) => s.c.distanceTo(p) < s.r)) white = true;
        if (where === 'ear' && P.ears === 'floppy') white = true;
        break;
    }
    return white ? second : base;
  }

  // ---- nodes ----
  const nodes = {}, origins = {}, pieces = {};
  function node(name, parent, pos) {
    const g = new Group();
    g.name = name;
    g.position.copy(pos);
    if (parent) nodes[parent].add(g);
    nodes[name] = g;
    origins[name] = pos.clone().add(parent ? origins[parent] : V(0, 0, 0));
    pieces[name] = [];
    return g;
  }
  const add = (n, geo, pick) => pieces[n].push(paintFaces(geo, origins[n], typeof pick === 'function' ? pick : () => pick));
  const coatOf = (where) => (p) => coat(p, where);

  const root = node('Pet', null, V(0, 0, 0));
  root.name = P.name || 'Pet';
  node('Body', 'Pet', V(0, bodyY, 0));
  node('Head', 'Body', headC.clone().sub(V(0, bodyY, 0)));
  node('Tail', 'Body', tailRoot.clone().sub(V(0, bodyY, 0)));
  const legs = [['LegFL', 1, 1], ['LegFR', -1, 1], ['LegBL', 1, -1], ['LegBR', -1, -1]];
  for (const [n, sx, sz] of legs) node(n, 'Pet', sz > 0 ? V(sx * cw * 0.55, hipFY, L2 * 0.62) : V(sx * hw * 0.58, hipBY, -L2 * 0.6));

  // torso: rump > haunch > waist > chest > shoulders > neck (body space: y relative to bodyY)
  add('Body', loft([
    { c: V(0, ch * 0.12, -L2 * 1.04), w: hw * 0.45, h: hh * 0.5 },
    { c: V(0, ch * 0.06, -L2 * 0.9), w: hw * 0.88, h: hh * 0.9 },
    { c: V(0, 0, -L2 * 0.6), w: hw, h: hh },
    { c: V(0, ch * 0.12, -L2 * 0.15), w: ww, h: wh },
    { c: V(0, -ch * 0.03, L2 * 0.35), w: cw, h: ch },
    { c: V(0, ch * 0.05, L2 * 0.75), w: cw * 0.94, h: ch * 0.95 },
    { c: V(0, ch * 0.4, L2 * 1.0), w: cw * 0.7, h: ch * 0.68 },
    { c: V(0, ch * 0.9, L2 * 1.1), w: cw * 0.56, h: ch * 0.52 },
    { c: V(0, ch * 1.3, L2 * 1.17), w: cw * 0.5, h: ch * 0.46 },
  ], { n: 10, belly: 0.85, capStart: L2 * 0.08, twist: 0.5 }), coatOf('body'));

  // head: skull > cheeks > muzzle > nose (head space, rows in units of Hr: z, y, half-width, half-height)
  const sn = dog ? P.snout : 1;
  const headRows = dog
    ? [[-0.75, 0.1, 0.42, 0.48], [-0.45, 0.07, 0.8, 0.84], [0, 0.03, 0.94, 0.84], [0.34, -0.05, 0.78, 0.66], [0.55, -0.14, 0.52, 0.47], [0.55 + 0.5 * sn, -0.19, 0.36, 0.31], [0.6 + 0.55 * sn, -0.2, 0.27, 0.23]]
    : [[-0.75, 0.08, 0.45, 0.5], [-0.45, 0.05, 0.85, 0.85], [0, 0, 1, 0.88], [0.35, -0.08, 0.86, 0.7], [0.6, -0.2, 0.52, 0.44], [0.76, -0.27, 0.3, 0.26]];
  add('Head', loft(rowsZ(headRows, Hr), { n: 10, belly: 0.75, capStart: Hr * 0.1, capEnd: Hr * 0.06, twist: 0.5 }), coatOf('head'));
  const headAt = (z) => { // interpolated head section at head-space z (Hr units)
    for (let i = 0; i < headRows.length - 1; i++) {
      const [z0, y0, w0, h0] = headRows[i], [z1, y1, w1, h1] = headRows[i + 1];
      if (z <= z1) { const t = (z - z0) / (z1 - z0); return { y: lerp(y0, y1, t), w: lerp(w0, w1, t), h: lerp(h0, h1, t) }; }
    }
    const [, y, w, h] = headRows.at(-1);
    return { y, w, h };
  };

  // nose
  {
    const [zEnd, yEnd, , hEnd] = headRows.at(-1);
    const tip = V(0, (yEnd + hEnd * 0.45) * Hr, (zEnd + 0.04) * Hr);
    if (dog) add('Head', prim(new IcosahedronGeometry(Hr * 0.13, 0), { pos: tip.toArray(), scale: [1.35, 0.85, 0.9] }), noseC);
    else add('Head', prim(new ConeGeometry(Hr * 0.1, Hr * 0.09, 3), { pos: [0, tip.y, tip.z - Hr * 0.01], rot: [Math.PI + 0.35, 0, 0], scale: [1, 1, 0.6] }), noseC);
  }

  // eyes: iris disc, pupil, highlight (one node each, so they can blink). A ray from inside the
  // head finds the actual (faceted) surface, so the eyes always sit on it.
  const e = Hr * 0.16 * P.eyes;
  const headMesh = new Mesh(pieces.Head[0], new MeshBasicMaterial({ side: DoubleSide }));
  const ray = new Raycaster();
  for (const [n, sx] of [['EyeL', 1], ['EyeR', -1]]) {
    const dir = V(sx * 0.62, 0.3, 0.72).normalize();
    ray.set(V(0, Hr * 0.05, Hr * (dog ? 0.12 : 0.18)), dir);
    const hit = ray.intersectObject(headMesh)[0];
    const surf = hit ? hit.point : dir.clone().multiplyScalar(Hr * 0.8);
    const nrm = (hit ? hit.face.normal.clone() : dir.clone()).lerp(V(0, 0, 1), 0.35).normalize();
    node(n, 'Head', surf.clone().addScaledVector(nrm, e * 0.05));
    const q = new Quaternion().setFromUnitVectors(V(0, 1, 0), nrm);
    const toFace = new Quaternion().setFromUnitVectors(V(0, 0, 1), nrm);
    const out = (d, x = 0, y = 0) => V(x, y, 0).applyQuaternion(toFace).addScaledVector(nrm, d).toArray();
    add(n, prim(new CylinderGeometry(e, e, e * 0.3, 8), { quat: q }), C(P.eye));
    add(n, prim(new CylinderGeometry(e * 0.66, e * 0.66, e * 0.3, 8), { quat: q, pos: out(e * 0.06) }), C('#1d1b22'));
    add(n, prim(new CylinderGeometry(e * 0.2, e * 0.2, e * 0.3, 5), { quat: q, pos: out(e * 0.12, -e * 0.25, e * 0.3) }), C('#ffffff'));
  }
  headMesh.material.dispose();

  // ears
  for (const [n, sx] of [['EarL', 1], ['EarR', -1]]) {
    const s0 = headAt(-0.25);
    const at = P.ears === 'floppy'
      ? V(sx * s0.w * Hr * 0.85, (s0.y + s0.h * 0.45) * Hr, -0.2 * Hr)
      : V(sx * s0.w * Hr * 0.52, (s0.y + s0.h * 0.72) * Hr, -0.25 * Hr);
    node(n, 'Head', at);
    const outer = coatOf('ear');
    switch (P.ears) {
      case 'pointed': {
        const h = Hr * (dog ? 0.75 : 0.68), r = Hr * (dog ? 0.34 : 0.32);
        add(n, prim(new ConeGeometry(r, h, 4, 1), { pos: [sx * Hr * 0.04, h * 0.45, 0], rot: [-0.15, Math.PI / 4, sx * 0.28], scale: [1, 1, 0.45] }), outer);
        add(n, prim(new ConeGeometry(r * 0.55, h * 0.65, 4, 1), { pos: [sx * Hr * 0.02, h * 0.36, r * 0.13], rot: [-0.15, Math.PI / 4, sx * 0.28], scale: [1, 1, 0.3] }), innerEar);
        break;
      }
      case 'folded':
        add(n, prim(new ConeGeometry(Hr * 0.26, Hr * 0.32, 3), { pos: [sx * Hr * 0.02, Hr * 0.12, Hr * 0.02], rot: [0.9, Math.PI, sx * 0.3], scale: [1, 1, 0.55] }), outer);
        break;
      case 'round':
        add(n, prim(new CylinderGeometry(Hr * 0.24, Hr * 0.24, Hr * 0.1, 7), { pos: [0, Hr * 0.12, 0], rot: [Math.PI / 2, 0, 0] }), outer);
        add(n, prim(new CylinderGeometry(Hr * 0.14, Hr * 0.14, Hr * 0.1, 7), { pos: [0, Hr * 0.11, Hr * 0.03], rot: [Math.PI / 2, 0, 0] }), innerEar);
        break;
      case 'floppy': // a thin flap hanging down beside the head (path goes down; "up" is forward)
        add(n, loft([
          { c: V(0, Hr * 0.05, 0), w: Hr * 0.07, h: Hr * 0.2 },
          { c: V(sx * Hr * 0.06, -Hr * 0.2, 0), w: Hr * 0.065, h: Hr * 0.27 },
          { c: V(sx * Hr * 0.1, -Hr * 0.5, -Hr * 0.02), w: Hr * 0.055, h: Hr * 0.23 },
        ], { n: 6, capEnd: Hr * 0.06 }), outer);
        break;
    }
  }

  // legs: hip > thigh > (hock) > ankle > paw; leg space: pivot at the hip, the path goes down
  for (const [n, , sz] of legs) {
    const front = sz > 0, r = (front ? D.rF : D.rB) * Math.sqrt(B[0]), Lh = front ? hipFY : hipBY;
    // rows: [y, z (in r), half-width (in r), half-depth (in r)]
    const rows = front
      ? [[r * 1.6, 0, 1.15, 1.35], [-0.25 * Lh, 0.05, 1, 1.15], [-0.62 * Lh, 0.04, 0.72, 0.8], [-0.88 * Lh, 0.1, 0.7, 0.8], [-Lh + r * 0.55, 0.42, 0.85, 1.1], [-Lh + r * 0.08, 0.48, 0.8, 1.05]]
      : [[r * 1.4, -0.25, 1.35, 1.9], [-0.3 * Lh, -0.4, 1.2, 1.55], [-0.56 * Lh, -0.8, 0.78, 0.86], [-0.85 * Lh, -0.32, 0.64, 0.72], [-Lh + r * 0.55, 0.12, 0.82, 1.06], [-Lh + r * 0.08, 0.18, 0.8, 1.02]];
    add(n, loft(rows.map(([y, z, w, d]) => ({ c: V(0, y, z * r), w: w * r, h: d * r })), { n: 6, capEnd: r * 0.05 }), coatOf('leg'));
  }

  // tail: a tapering loft along a curve (tail space: +y up, -z back)
  {
    const s = tailLen, r = D.tr * Math.sqrt(B[0]);
    const shape = {
      long: { pts: [[0, 0, 0], [0, 0.05, -0.25], [0, 0.25, -0.45], [0, 0.55, -0.5], [0, 0.82, -0.42]], rad: [1.15, 1, 0.95, 0.85, 0.7] },
      fluffy: { pts: [[0, 0, 0], [0, 0.12, -0.3], [0, 0.4, -0.5], [0, 0.72, -0.48], [0, 0.95, -0.36]], rad: [1.5, 2.3, 2.6, 2.3, 1.4] },
      curly: { pts: [[0, 0, 0], [0, 0.35, -0.22], [0, 0.62, 0], [0, 0.5, 0.3], [0, 0.25, 0.36]], rad: [1.4, 1.35, 1.25, 1.05, 0.8] },
      short: { pts: [[0, 0, 0], [0, 0.3, -0.6], [0, 0.6, -1]], rad: [1.6, 1.7, 1.3] },
    }[P.tail];
    const curve = new CatmullRomCurve3(shape.pts.map(([x, y, z]) => V(x * s, y * s, z * s)));
    const N = 9, sections = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1), f = t * (shape.rad.length - 1), k = Math.min(shape.rad.length - 2, Math.floor(f));
      const rr = lerp(shape.rad[k], shape.rad[k + 1], f - k) * r;
      sections.push({ c: curve.getPointAt(t), w: rr, h: rr });
    }
    add('Tail', loft(sections, { n: 6, capEnd: r * 1.2, twist: 0.5 }), coatOf('tail'));
  }

  // ---- merge every node's parts into one flat-shaded mesh ----
  const material = petMaterial();
  let triangles = 0;
  for (const [name, list] of Object.entries(pieces)) {
    if (!list.length) continue;
    const geo = list.length === 1 ? list[0] : mergeGeometries(list);
    if (geo !== list[0]) for (const g of list) g.dispose();
    geo.computeVertexNormals(); // non-indexed: one normal per face
    geo.computeBoundingSphere();
    triangles += geo.attributes.position.count / 3;
    const mesh = new Mesh(geo, material);
    mesh.name = `${name}Mesh`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    nodes[name].add(mesh);
  }
  root.scale.setScalar(P.size);
  root.userData.pet = P;
  let top = 0;
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); top = Math.max(top, o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).max.y); } });

  return {
    root,
    animations: makeAnimations({ bodyY, legLen }),
    triangles,
    height: top,
    footprint: L2 * 1.05 * P.size, // radius for a soft ground shadow
  };
}

// ---- animations ------------------------------------------------------------------------------

function makeAnimations({ bodyY, legLen }) {
  const q = (x, y, z) => new Quaternion().setFromEuler(new Euler(x, y, z)).toArray();
  const rot = (node, times, eulers) => new QuaternionKeyframeTrack(`${node}.quaternion`, times, eulers.flatMap((e) => q(...e)));
  const posY = (node, times, ys) => new VectorKeyframeTrack(`${node}.position`, times, ys.flatMap((y) => [0, y, 0]));
  const scl = (node, times, ys) => new VectorKeyframeTrack(`${node}.scale`, times, ys.flatMap((y) => [1, y, 1]));

  const T = [0, 0.8, 1.6, 2.4, 3.2];
  const B = [0, 2.9, 2.97, 3.04, 3.2]; // blink near the end of the loop
  const idle = new AnimationClip('Idle', 3.2, [
    posY('Body', T, [bodyY, bodyY - 0.003, bodyY, bodyY - 0.003, bodyY]),
    rot('Head', T, [[0, 0, 0], [0.06, 0.2, 0.05], [0, 0, 0], [0.02, -0.18, -0.05], [0, 0, 0]]),
    rot('Tail', T, [[0, -0.25, 0], [0, 0.25, 0], [0, -0.25, 0], [0, 0.25, 0], [0, -0.25, 0]]),
    rot('EarL', [0, 1.3, 1.4, 1.5, 3.2], [[0, 0, 0], [0, 0, 0], [0, 0, 0.3], [0, 0, 0], [0, 0, 0]]),
    scl('EyeL', B, [1, 1, 0.1, 1, 1]), scl('EyeR', B, [1, 1, 0.1, 1, 1]),
  ]);

  const S = [0, 0.15, 0.3, 0.45, 0.6];
  const swing = (a) => [[a, 0, 0], [0, 0, 0], [-a, 0, 0], [0, 0, 0], [a, 0, 0]];
  const walk = new AnimationClip('Walk', 0.6, [
    rot('LegFL', S, swing(0.5)), rot('LegBR', S, swing(0.5)),
    rot('LegFR', S, swing(-0.5)), rot('LegBL', S, swing(-0.5)),
    posY('Body', S, [bodyY, bodyY + 0.01, bodyY, bodyY + 0.01, bodyY]),
    rot('Head', S, [[0.04, 0, 0], [-0.03, 0, 0], [0.04, 0, 0], [-0.03, 0, 0], [0.04, 0, 0]]),
    rot('Tail', S, [[0, 0.25, 0], [0, 0, 0], [0, -0.25, 0], [0, 0, 0], [0, 0.25, 0]]),
  ]);

  const H = [0, 0.12, 0.25, 0.37, 0.5, 0.62, 0.75, 0.87, 1];
  const hop = legLen * 0.35 + 0.02;
  const happy = new AnimationClip('Happy', 1, [
    posY('Body', H, [bodyY, bodyY + hop, bodyY + hop * 1.2, bodyY + hop * 0.4, bodyY, bodyY + hop * 0.6, bodyY + hop * 0.7, bodyY + hop * 0.2, bodyY]),
    rot('Tail', H, H.map((_, i) => [0, (i % 2 ? 0.7 : -0.7) * (i === 0 || i === 8 ? 0 : 1), 0])),
    rot('Head', H, [[0, 0, 0], [-0.2, 0, 0.25], [-0.25, 0, 0.3], [-0.1, 0, 0.1], [0, 0, 0], [-0.15, 0, -0.25], [-0.2, 0, -0.3], [-0.1, 0, -0.1], [0, 0, 0]]),
    rot('LegFL', H, H.map((t) => [-0.8 * Math.sin(t * Math.PI * 2) ** 2, 0, 0])),
    rot('LegFR', H, H.map((t) => [-0.8 * Math.sin(t * Math.PI * 2) ** 2, 0, 0])),
    rot('EarL', H, H.map((_, i) => [0, 0, i % 2 ? 0.25 : 0])),
    rot('EarR', H, H.map((_, i) => [0, 0, i % 2 ? -0.25 : 0])),
  ]);

  return [idle, walk, happy];
}
