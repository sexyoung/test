// Generates sample low-poly .glb models (no Blender needed) into public/models/.
//   node scripts/make-glb.mjs
//
// Each model is built from three.js primitives, flat-shaded (non-indexed geometry, one normal
// per face) and exported with GLTFExporter, exactly the file format Blender's glTF exporter writes.
// Animations only move child nodes, so the page can place the root node wherever it likes.

import { mkdirSync, writeFileSync } from 'node:fs';
import {
  Scene, Group, Mesh, MeshStandardMaterial, BoxGeometry, CylinderGeometry, ConeGeometry,
  IcosahedronGeometry, BufferAttribute, Color, Quaternion, Euler, Vector3,
  AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// GLTFExporter uses the browser's FileReader to turn Blobs into bytes; Node has Blob but no FileReader.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }); }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`;
      this.onload?.({ target: this }); this.onloadend?.({ target: this });
    });
  }
};

// ---- helpers ---------------------------------------------------------------------

const materialCache = new Map();
function mat(color, vertexColors = false) {
  const key = color + vertexColors;
  if (!materialCache.has(key)) {
    const m = new MeshStandardMaterial({ color: vertexColors ? 0xffffff : color, roughness: 1, metalness: 0, vertexColors });
    m.name = vertexColors ? 'vertexColor' : color;
    materialCache.set(key, m);
  }
  return materialCache.get(key);
}

/** Flat-shaded mesh: one normal per triangle, like Blender's "Shade Flat". */
function part(geometry, color, { name, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const mesh = new Mesh(g, typeof color === 'string' ? mat(color) : color);
  if (name) mesh.name = name;
  mesh.position.fromArray(pos);
  mesh.rotation.fromArray(rot);
  mesh.scale.fromArray(scale);
  return mesh;
}

function node(name, pos = [0, 0, 0], ...children) {
  const g = new Group();
  g.name = name;
  g.position.fromArray(pos);
  g.add(...children);
  return g;
}

/** Colours every triangle of a non-indexed geometry with pick(centroid, index). */
function paintFaces(geometry, pick) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.attributes.position, colors = new Float32Array(p.count * 3), c = new Color(), v = new Vector3();
  for (let t = 0; t < p.count; t += 3) {
    v.set(0, 0, 0);
    for (let k = 0; k < 3; k++) v.x += p.getX(t + k) / 3, v.y += p.getY(t + k) / 3, v.z += p.getZ(t + k) / 3;
    c.set(pick(v, t / 3));
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (t + k) * 3);
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

const q = (x, y, z) => new Quaternion().setFromEuler(new Euler(x, y, z)).toArray();
function rotTrack(nodeName, times, eulers) {
  return new QuaternionKeyframeTrack(`${nodeName}.quaternion`, times, eulers.flatMap((e) => q(...e)));
}
function posTrack(nodeName, times, positions) {
  return new VectorKeyframeTrack(`${nodeName}.position`, times, positions.flat());
}

async function save(file, root, animations) {
  const scene = new Scene();
  scene.add(root);
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, animations });
  mkdirSync('public/models', { recursive: true });
  writeFileSync(`public/models/${file}`, Buffer.from(glb));
  let tris = 0;
  root.traverse((o) => { if (o.isMesh) tris += o.geometry.attributes.position.count / 3; });
  console.log(`public/models/${file}  ${(glb.byteLength / 1024).toFixed(1)} KB  ${tris} triangles  animations: ${animations.map((a) => a.name).join(', ') || '-'}`);
}

// ---- 1. windmill (about 8 m tall), animation "Spin" -------------------------------

{
  const blade = (i) => node(`Blade${i}`, [0, 0, 0],
    part(new BoxGeometry(0.12, 3.1, 0.06), '#7a4f31', { pos: [0, 1.75, 0] }),
    part(new BoxGeometry(0.75, 2.6, 0.03), '#f4eee0', { pos: [0.4, 1.95, 0.03] }));
  const blades = [0, 1, 2, 3].map((i) => { const b = blade(i); b.rotation.z = (i * Math.PI) / 2; return b; });
  const rotor = node('Rotor', [0, 0, 0], part(new CylinderGeometry(0.22, 0.22, 0.5, 8), '#5b3a24', { rot: [Math.PI / 2, 0, 0] }), ...blades);
  const head = node('Head', [0, 5.6, 1.45], rotor);

  const windmill = node('Windmill', [0, 0, 0],
    part(new CylinderGeometry(1.05, 1.7, 5.2, 8), '#f2e6cf', { pos: [0, 2.6, 0] }),
    part(new CylinderGeometry(1.75, 1.85, 0.35, 8), '#bdb7a9', { pos: [0, 0.17, 0] }),
    part(new ConeGeometry(1.5, 1.8, 8), '#c4553d', { pos: [0, 6.1, 0] }),
    part(new BoxGeometry(0.75, 1.25, 0.2), '#7a4f31', { pos: [0, 0.8, 1.58], rot: [-0.11, 0, 0] }),
    part(new BoxGeometry(0.5, 0.5, 0.15), '#9cc9e0', { pos: [0, 3.4, 1.38], rot: [-0.11, 0, 0] }),
    head);

  const spin = new AnimationClip('Spin', 6, [
    rotTrack('Rotor', [0, 1.5, 3, 4.5, 6], [0, 1, 2, 3, 4].map((i) => [0, 0, (-i * Math.PI) / 2])),
  ]);
  await save('windmill.glb', windmill, [spin]);
}

// ---- 2. character (about 1.5 m), animations "Idle", "Wave", "Walk" -----------------

{
  const fur = '#f08a3c', belly = '#fff4e2', dark = '#2b2b33';
  const head = node('Head', [0, 1.12, 0],
    part(new IcosahedronGeometry(0.34, 1), fur, { scale: [1, 0.92, 0.95] }),
    part(new IcosahedronGeometry(0.17, 0), belly, { pos: [0, -0.08, 0.26], scale: [1.2, 0.8, 0.9] }),
    part(new IcosahedronGeometry(0.05, 0), dark, { pos: [0, -0.02, 0.41] }),
    part(new BoxGeometry(0.07, 0.1, 0.04), dark, { pos: [-0.13, 0.07, 0.3] }),
    part(new BoxGeometry(0.07, 0.1, 0.04), dark, { pos: [0.13, 0.07, 0.3] }),
    part(new ConeGeometry(0.11, 0.26, 4), fur, { pos: [-0.2, 0.33, 0], rot: [0, 0, 0.3] }),
    part(new ConeGeometry(0.11, 0.26, 4), fur, { pos: [0.2, 0.33, 0], rot: [0, 0, -0.3] }));
  const arm = (side) => node(side < 0 ? 'ArmL' : 'ArmR', [side * 0.33, 0.82, 0],
    part(new CylinderGeometry(0.07, 0.06, 0.42, 6), fur, { pos: [0, -0.2, 0] }),
    part(new IcosahedronGeometry(0.08, 0), belly, { pos: [0, -0.43, 0] }));
  const leg = (side) => node(side < 0 ? 'LegL' : 'LegR', [side * 0.15, 0.42, 0],
    part(new CylinderGeometry(0.09, 0.08, 0.36, 6), fur, { pos: [0, -0.18, 0] }),
    part(new BoxGeometry(0.17, 0.09, 0.26), dark, { pos: [0, -0.37, 0.04] }));
  const tail = node('Tail', [0, 0.5, -0.27],
    part(new ConeGeometry(0.13, 0.55, 5), fur, { pos: [0, 0.2, -0.12], rot: [-0.9, 0, 0] }),
    part(new ConeGeometry(0.07, 0.16, 5), belly, { pos: [0, 0.39, -0.29], rot: [-0.9, 0, 0] }));
  const body = node('Body', [0, 0, 0],
    part(new CylinderGeometry(0.26, 0.32, 0.6, 7), fur, { pos: [0, 0.68, 0] }),
    part(new CylinderGeometry(0.17, 0.22, 0.42, 7), belly, { pos: [0, 0.66, 0.11] }),
    head, arm(-1), arm(1), tail);
  const fox = node('Fox', [0, 0, 0], body, leg(-1), leg(1));

  const T = [0, 0.5, 1, 1.5, 2];
  const idle = new AnimationClip('Idle', 2, [
    posTrack('Body', T, [[0, 0, 0], [0, -0.03, 0], [0, 0, 0], [0, -0.03, 0], [0, 0, 0]]),
    rotTrack('Head', T, [[0, 0, 0], [0.05, 0.15, 0], [0, 0, 0], [0.05, -0.15, 0], [0, 0, 0]]),
    rotTrack('Tail', T, [[0, -0.4, 0], [0, 0, 0], [0, 0.4, 0], [0, 0, 0], [0, -0.4, 0]]),
  ]);
  const W = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5];
  const wave = new AnimationClip('Wave', 1.5, [
    rotTrack('ArmR', W, [[0, 0, 0.2], [0, 0, 2.6], [0, 0, 2.2], [0, 0, 2.7], [0, 0, 2.2], [0, 0, 2.6], [0, 0, 0.2]]),
    rotTrack('Head', W, [[0, 0, 0], [0, 0, -0.15], [0, 0, -0.15], [0, 0, -0.15], [0, 0, -0.15], [0, 0, -0.15], [0, 0, 0]]),
    rotTrack('Tail', W, W.map((_, i) => [0, i % 2 ? 0.5 : -0.5, 0])),
  ]);
  const S = [0, 0.2, 0.4, 0.6, 0.8];
  const swing = (a) => [[a, 0, 0], [0, 0, 0], [-a, 0, 0], [0, 0, 0], [a, 0, 0]];
  const walk = new AnimationClip('Walk', 0.8, [
    rotTrack('LegL', S, swing(0.6)), rotTrack('LegR', S, swing(-0.6)),
    rotTrack('ArmL', S, swing(-0.5)), rotTrack('ArmR', S, swing(0.5)),
    posTrack('Body', S, [[0, 0, 0], [0, 0.05, 0], [0, 0, 0], [0, 0.05, 0], [0, 0, 0]]),
  ]);
  await save('fox.glb', fox, [idle, wave, walk]);
}

// ---- 3. hot-air balloon (about 6 m), animation "Float" ------------------------------

{
  const stripes = ['#e94f4f', '#ffd23f', '#e94f4f', '#4fa3e9', '#ffffff', '#4fa3e9'];
  const envelopeGeo = paintFaces(new IcosahedronGeometry(2.2, 2), (c) => {
    const a = Math.atan2(c.z, c.x);
    return stripes[Math.floor(((a + Math.PI) / (2 * Math.PI)) * 12) % stripes.length];
  });
  const ropes = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) =>
    part(new CylinderGeometry(0.025, 0.025, 1.7, 4), '#5b3a24', { pos: [x * 0.55, 1.1, z * 0.55], rot: [z * 0.25, 0, -x * 0.25] }));
  const craft = node('Craft', [0, 0, 0],
    part(envelopeGeo, mat('', true), { pos: [0, 4.0, 0], scale: [1, 1.15, 1] }),
    part(new ConeGeometry(0.9, 1.1, 10), '#e94f4f', { pos: [0, 1.9, 0], rot: [Math.PI, 0, 0] }),
    part(new BoxGeometry(0.9, 0.6, 0.9), '#9c6b45', { pos: [0, 0.3, 0] }),
    part(new BoxGeometry(0.98, 0.1, 0.98), '#7a4f31', { pos: [0, 0.62, 0] }),
    ...ropes);
  const balloon = node('Balloon', [0, 0, 0], craft);

  const F = [0, 2, 4, 6, 8];
  const float = new AnimationClip('Float', 8, [
    posTrack('Craft', F, [[0, 0, 0], [0, 0.6, 0.2], [0, 0.1, 0], [0, 0.7, -0.2], [0, 0, 0]]),
    rotTrack('Craft', F, [0, 1, 2, 3, 4].map((i) => [0.03 * Math.sin(i * 1.6), (i * Math.PI) / 2, 0.03 * Math.cos(i * 1.6)])),
  ]);
  await save('balloon.glb', balloon, [float]);
}
