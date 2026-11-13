// Preserve the imported skin, weights and animation; customization changes bone scales.
import { AnimationMixer, Box3, Group, Matrix4 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export const CAT_KEY = 'lowpoly-rigged-cat-v1';
export const CAT_DEFAULTS = { model: 'runner', surface: 'faceted', name: '小貓', size: 1, head: 1, ears: 1, tail: 1, color: '#d6c7b4' };
export const CAT_RANGES = { size: [0.7, 1.4], head: [0.9, 1.15], ears: [0.85, 1.2], tail: [0.85, 1.15] };
export const CAT_CREDIT = {
  title: 'Lowpoly Cat Rig + Run Animation', author: 'Daily Lowpoly',
  source: 'https://sketchfab.com/3d-models/lowpoly-cat-rig-run-animation-c36df576c9ae4ed28e89069b1a2f427a',
  license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  changes: 'Normalized orientation and size, matte material, adjustable bone scales and color.',
};
export const CAT_MODELS = {
  runner: {
    label: '低面數跑步貓', url: '../../models/lowpoly_cat_rig__run_animation.glb',
    animated: true, proportions: true, color: '#d6c7b4', surface: 'faceted',
    description: '794 個三角形，保留原始跑步動畫，可微調頭、耳朵與尾巴。',
    note: '站姿是骨架的原始姿勢；尚未新增待機與走路動畫。', credit: CAT_CREDIT,
  },
  detailed: {
    label: '細緻站姿貓', url: '../../models/low_poly_cat.glb',
    animated: false, proportions: false, color: '#e6ddd0', surface: 'smooth',
    description: '15,672 個三角形，輪廓更圓潤。預設平滑表面、不顯示格線。',
    note: '此模型沒有骨架或動畫，目前可調整大小、毛色與表面。帶進公園會移動跟隨，但沒有步態動畫。',
    credit: {
      title: 'low poly cat', author: 'kmeierhofer',
      source: 'https://sketchfab.com/3d-models/low-poly-cat-80ac4ce6cf72498eaa1572d6ec042aba',
      license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      changes: 'Normalized size and placement; adjustable color and surface shading.',
    },
  },
};
export function catDefaults(model = 'runner') {
  model = Object.hasOwn(CAT_MODELS, model) ? model : 'runner';
  return { ...CAT_DEFAULTS, model, color: CAT_MODELS[model].color, surface: CAT_MODELS[model].surface };
}
export function normalizeCat(input = {}) {
  const p = { ...catDefaults(input.model), ...input };
  p.model = Object.hasOwn(CAT_MODELS, p.model) ? p.model : 'runner';
  p.surface = ['smooth', 'faceted'].includes(p.surface) ? p.surface : CAT_MODELS[p.model].surface;
  for (const [key, [min, max]] of Object.entries(CAT_RANGES)) {
    p[key] = Number.isFinite(Number(p[key])) ? Math.max(min, Math.min(max, Number(p[key]))) : CAT_DEFAULTS[key];
  }
  p.name = String(p.name || CAT_DEFAULTS.name).slice(0, 20);
  p.color = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : CAT_DEFAULTS.color;
  return Object.fromEntries(Object.keys(CAT_DEFAULTS).map(k => [k, p[k]]));
}
export function loadCat() {
  try { const raw = localStorage.getItem(CAT_KEY); return raw ? normalizeCat(JSON.parse(raw)) : null; } catch { return null; }
}
export function saveCat(p) {
  try { localStorage.setItem(CAT_KEY, JSON.stringify(normalizeCat(p))); return true; } catch { return false; }
}
const assets = new Map();
export async function createCat(input = {}) {
  const params = normalizeCat(input), profile = CAT_MODELS[params.model];
  if (!assets.has(params.model)) assets.set(params.model, new GLTFLoader().loadAsync(profile.url).catch(error => { assets.delete(params.model); throw error; }));
  const asset = await assets.get(params.model);
  return params.model === 'detailed' ? createStaticCat(asset, params) : createRunningCat(asset, params);
}
function createRunningCat(asset, input) {
  const root = new Group(); root.name = 'Cat';
  const normalized = new Group(); normalized.name = 'CatOrientation';
  normalized.rotation.y = -Math.PI / 2; // source faces +X, park actors face +Z
  normalized.scale.setScalar(0.01); // source FBX hierarchy scales metres by 100
  root.add(normalized);
  const model = clone(asset.scene);
  model.updateMatrixWorld(true);
  const meshes = [], bones = [];
  model.traverse(o => {
    if (o.isMesh) {
      o.material = o.material.clone();
      o.material.metalness = 0; o.material.roughness = 0.95; o.material.flatShading = true;
      o.castShadow = o.receiveShadow = true;
      // Animated bounds must not be frozen at the first pose.
      o.frustumCulled = false;
      meshes.push(o);
    }
  });
  for (const m of meshes) if (m.isSkinnedMesh) {
    // This FBX export stores inverse binds in mesh coordinates but animates in
    // the rotated armature basis. Convert bind-pose root children into that basis;
    // leave the unanimated root joint alone so the original run tracks still work.
    const rootJoint = m.skeleton.bones[0];
    const basis = new Matrix4().extractRotation(rootJoint.parent.matrixWorld).invert();
    m.skeleton.pose();
    for (const child of rootJoint.children) if (child.isBone) {
      child.matrix.premultiply(basis);
      child.matrix.decompose(child.position, child.quaternion, child.scale);
    }
  }
  model.updateMatrixWorld(true);
  model.traverse(o => { if (o.isBone) bones.push({ bone: o, position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() }); });
  normalized.add(model);
  const animations = asset.animations.map(a => a.clone());
  const mixer = new AnimationMixer(root);
  const run = mixer.clipAction(animations[0]);
  let params = normalizeCat(input), mode = 'run', speed = 1;
  const customScale = () => {
    for (const b of bones) {
      let factor = 1;
      if (b.bone.name === 'head_05') factor = params.head;
      if (/^ear_(left|right)_0[67]$/.test(b.bone.name)) factor = params.ears;
      // Scale the tail chain once at its root, not repeatedly at every joint.
      if (b.bone.name === 'tail_1_020') factor = params.tail;
      b.bone.scale.copy(b.scale).multiplyScalar(factor);
    }
  };
  const restore = () => {
    for (const b of bones) { b.bone.position.copy(b.position); b.bone.quaternion.copy(b.quaternion); b.bone.scale.copy(b.scale); }
  };
  // One fixed ground offset for the whole run: preserve the authored vertical bounce.
  run.play();
  let minY = Infinity;
  for (let i = 0; i < 60; i++) {
    mixer.setTime(animations[0].duration * i / 60); root.updateMatrixWorld(true);
    minY = Math.min(minY, new Box3().setFromObject(root, true).min.y);
  }
  run.stop(); restore(); root.updateMatrixWorld(true);
  minY = Math.min(minY, new Box3().setFromObject(root, true).min.y);
  normalized.position.y = -minY;
  run.reset().play();
  const api = {
    root, animations, mixer, meshes, bones, profile: CAT_MODELS.runner, triangles: 794, duration: animations[0].duration,
    get params() { return params; }, get mode() { return mode; }, get time() { return run.time; },
    setParams(value) {
      params = normalizeCat(value); root.scale.setScalar(params.size);
      root.userData = { cat: params, attribution: CAT_CREDIT };
      for (const m of meshes) {
        m.material.color.set(params.color);
        const flat = params.surface === 'faceted';
        if (m.material.flatShading !== flat) { m.material.flatShading = flat; m.material.needsUpdate = true; }
      }
      customScale(); root.updateMatrixWorld(true);
    },
    setMode(value) {
      if (!['run', 'pause', 'rest'].includes(value)) return;
      if (value === 'rest') { run.stop(); restore(); }
      else if (mode === 'rest') run.reset().play();
      mode = value; customScale(); root.updateMatrixWorld(true);
    },
    setSpeed(value) { speed = Math.max(0.1, Math.min(2, Number(value) || 1)); },
    setWireframe(value) { for (const m of meshes) m.material.wireframe = !!value; },
    seek(seconds) {
      if (mode === 'rest') run.reset().play();
      mode = 'pause'; run.time = Math.max(0, Math.min(api.duration, seconds)); mixer.update(0);
      customScale(); root.updateMatrixWorld(true);
    },
    update(dt) {
      if (mode === 'run') mixer.update(dt * speed);
      customScale(); root.updateMatrixWorld(true);
    },
    dispose() {
      mixer.stopAllAction(); mixer.uncacheRoot(root);
      for (const m of meshes) { m.material.dispose(); if (m.isSkinnedMesh) m.skeleton.dispose(); }
      root.removeFromParent();
    },
  };
  api.setParams(params); api.update(0);
  return api;
}

// The second asset is a static mesh. Preserve its topology and authored normals;
// no animation or bone controls are fabricated for it.
function createStaticCat(asset, input) {
  const root = new Group(); root.name = 'DetailedCat';
  const normalized = new Group(); normalized.name = 'CatOrientation'; root.add(normalized);
  const model = clone(asset.scene); normalized.add(model); root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(model, true);
  const scale = 0.5 / (bounds.max.y - bounds.min.y);
  normalized.scale.setScalar(scale);
  normalized.position.set(-(bounds.min.x + bounds.max.x) * scale / 2, -bounds.min.y * scale, -(bounds.min.z + bounds.max.z) * scale / 2);
  const meshes = [];
  let triangles = 0, params;
  model.traverse(o => {
    if (!o.isMesh) return;
    o.material = o.material.clone(); o.material.wireframe = false;
    o.castShadow = o.receiveShadow = true;
    meshes.push(o); triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
  });
  const profile = CAT_MODELS.detailed;
  const api = {
    root, meshes, bones: [], animations: [], profile, triangles, duration: 0,
    get params() { return params; }, get mode() { return 'rest'; }, get time() { return 0; },
    setParams(value) {
      params = normalizeCat({ ...value, model: 'detailed' }); root.scale.setScalar(params.size);
      root.userData = { cat: params, attribution: profile.credit };
      for (const mesh of meshes) {
        mesh.material.color.set(params.color);
        const flat = params.surface === 'faceted';
        if (mesh.material.flatShading !== flat) { mesh.material.flatShading = flat; mesh.material.needsUpdate = true; }
      }
      root.updateMatrixWorld(true);
    },
    setWireframe(value) { for (const mesh of meshes) mesh.material.wireframe = !!value; },
    setMode() {}, setSpeed() {}, seek() {}, update() {},
    dispose() { for (const mesh of meshes) mesh.material.dispose(); root.removeFromParent(); },
  };
  api.setParams(input);
  return api;
}
