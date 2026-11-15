// Preserve the imported skin, weights and animation; customization changes bone scales.
import { AnimationMixer, Box3, Group } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export const CAT_KEY = 'lowpoly-rigged-cat-v1';
export const CAT_DEFAULTS = { model: 'runner', surface: 'faceted', name: '小貓', size: 1, head: 1, ears: 1, tail: 1, color: '#d6c7b4' };
export const CAT_RANGES = { size: [0.7, 1.4], head: [0.9, 1.15], ears: [0.85, 1.2], tail: [0.85, 1.15] };
export const CAT_CREDIT = {
  title: 'Lowpoly Cat Rig + Run Animation', author: 'Daily Lowpoly',
  source: 'https://sketchfab.com/3d-models/lowpoly-cat-rig-run-animation-c36df576c9ae4ed28e89069b1a2f427a',
  license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  changes: 'Original body and run animation; original head replaced with the cat-head-uncolored.glb copy of the user-provided approved sculpt, skinned ears and a continuous neck band. Approved facial geometry and four morphs retained in a separate uncolored head copy; one coat tint applies to head, neck and body. Original head surface skin weights transferred to the new face and eyes, with a continuous harmonic neck blend.',
};
export const CAT_MODELS = {
  runner: {
    label: '低面數跑步貓', url: '../../models/cat/runner-base.glb',
    authoringFile: '../../models/cat/runner-ear-controls.blend',
    animated: true, proportions: true, color: '#d6c7b4', surface: 'faceted',
    description: '已換上確認版貓頭（去色），保留跑步動畫，可微調頭、耳朵與尾巴。',
    note: '站姿是骨架的原始姿勢；尚未新增待機與走路動畫。', credit: CAT_CREDIT,
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
  return createRunningCat(asset, params);
}
function createRunningCat(asset, input) {
  const root = new Group(); root.name = 'Cat';
  const normalized = new Group(); normalized.name = 'CatOrientation';
  // The published Blender base is already in metres, Y-up and facing +Z.
  root.add(normalized);
  const model = clone(asset.scene);
  model.updateMatrixWorld(true);
  const meshes = [], bones = [];
  model.traverse(o => {
    if (o.isMesh) {
      // Blender's welded exterior exports as material primitives. Restore each
      // region's semantic tag for the photo adapter without separating the rig.
      if (o.material.name === 'Scene_-_Root') {
        o.userData = {...o.userData, approvedCatHead:false, approvedHeadNeck:false, headPart:'body'};
      } else if (o.material.name === 'Scene_-_Root.001') {
        o.userData = {...o.userData, approvedCatHead:false, approvedHeadNeck:true, headPart:'neck'};
      }
      o.material = o.material.clone();
      o.material.metalness = 0; o.material.roughness = 0.95; o.material.flatShading = true;
      o.castShadow = o.receiveShadow = true;
      // Animated bounds must not be frozen at the first pose.
      o.frustumCulled = false;
      meshes.push(o);
    }
  });
  model.updateMatrixWorld(true);
  model.traverse(o => { if (o.isBone) bones.push({ bone: o, position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() }); });
  normalized.add(model);
  const animations = asset.animations.map(a => a.clone());
  const mixer = new AnimationMixer(root);
  const run = mixer.clipAction(animations[0]);
  let params = normalizeCat(input), mode = 'run', speed = 1;
  const scaleTracks = new Map(animations[0].tracks.filter(t=>t.name.endsWith('.scale')).map(t=>[t.name.slice(0,-6),t.createInterpolant()]));
  const scaleFactor = name => name === 'head_05' ? params.head
    : /^ear_root[._]?[LR]$/.test(name) ? params.ears
    : name === 'tail_1_020' ? params.tail : 1;
  const customScale = () => {
    // Read authored values directly: Mixer.update(0) may skip unchanged tracks,
    // so multiplying the last displayed scale would accumulate while paused.
    for (const b of bones) {
      const track = scaleTracks.get(b.bone.name);
      if (mode !== 'rest' && track) b.bone.scale.fromArray(track.evaluate(run.time));
      else b.bone.scale.copy(b.scale);
      b.bone.scale.multiplyScalar(scaleFactor(b.bone.name));
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
    root, mixer, meshes, bones, profile: CAT_MODELS.runner, triangles: meshes.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0), duration: animations[0].duration,
    get animations() {
      // Downloaded clips must retain the same proportions as the preview.
      return animations.map(clip=>{
        const copy=clip.clone();
        for(const track of copy.tracks)if(track.name.endsWith('.scale')){
          const factor=scaleFactor(track.name.slice(0,-6));
          for(let i=0;i<track.values.length;i++)track.values[i]*=factor;
        }
        return copy;
      });
    },
    get params() { return params; }, get mode() { return mode; }, get time() { return run.time; },
    setParams(value) {
      params = normalizeCat(value); root.scale.setScalar(params.size);
      root.userData = { cat: params, attribution: CAT_CREDIT, baseVersion:'cat-ear-rig-v1', authoringFile:'runner-ear-controls.blend', approvedHead: 'cat-head-uncolored.glb', originalApprovedHead: 'cat-head-approved.glb' };
      for (const m of meshes) {
        m.material.color.set(params.color);
        const flat = m.userData.approvedCatHead || params.surface === 'faceted';
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
