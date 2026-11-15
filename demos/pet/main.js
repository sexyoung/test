// Editor for the imported, continuously skinned cat.

import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Mesh, PlaneGeometry,
  MeshBasicMaterial, CanvasTexture, SRGBColorSpace, NoToneMapping,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createCat, loadCat, saveCat, CAT_DEFAULTS, CAT_RANGES, CAT_MODELS, catDefaults } from './rigged-cat.js';

const canvas = document.getElementById('app');
const stage = document.querySelector('.stage');
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true }); // transparent: the CSS gradient shows through
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;
renderer.setClearColor(0x000000, 0);

const scene = new Scene();
const camera = new PerspectiveCamera(30, 1, 0.05, 50);
camera.position.set(1.05, 0.62, 1.1);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.16, 0);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 0.5;
controls.maxDistance = 3;
controls.maxPolarAngle = Math.PI * 0.5;

// soft, low-contrast light: strong sky/ground fill, one gentle key light, a faint rim from behind
const hemi = new HemisphereLight('#ffffff', '#f4d9de', 2.1);
const key = new DirectionalLight('#fff7ef', 1.25);
key.position.set(1.2, 2.2, 2.4);
const rim = new DirectionalLight('#ffffff', 0.55);
rim.position.set(-1.5, 1.2, -2);
scene.add(hemi, key, rim);

// a soft round shadow under the pet instead of a shadow map
const shadowTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
})();
const blob = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, color: '#000000', opacity: 0.35 }));
blob.rotation.x = -Math.PI / 2;
blob.position.y = 0.001;
blob.renderOrder = -1;
scene.add(blob);

// background presets: [label, top, bottom, shadow tint, ground light]
const BACKDROPS = {
  pink: ['粉紅', '#f6a3b3', '#fde2d6', '#d9607a', '#f6d2da'],
  violet: ['藍紫', '#6f7ee0', '#f5d3d8', '#4450b8', '#d9dcf4'],
  mint: ['薄荷', '#8fd6bf', '#eef8e6', '#3f9c80', '#d8efe4'],
  cream: ['奶油', '#f4d29b', '#fff5e4', '#c28a3c', '#f7e6cc'],
};
let backdrop = 'pink';
try { backdrop = localStorage.getItem('lowpoly-pet-backdrop') in BACKDROPS ? localStorage.getItem('lowpoly-pet-backdrop') : 'pink'; } catch {}
function applyBackdrop(name) {
  backdrop = name;
  const [, top, bottom, shadow, ground] = BACKDROPS[name];
  stage.style.background = `linear-gradient(180deg, ${top} 0%, ${top} 35%, ${bottom} 100%)`;
  blob.material.color.set(shadow);
  hemi.groundColor.set(ground);
  for (const b of document.querySelectorAll('#backdrops button')) b.setAttribute('aria-pressed', String(b.dataset.backdrop === name));
  try { localStorage.setItem('lowpoly-pet-backdrop', name); } catch {}
}
{
  const box = document.getElementById('backdrops');
  for (const [name, [label, top]] of Object.entries(BACKDROPS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.backdrop = name;
    b.title = label;
    b.setAttribute('aria-label', `背景：${label}`);
    b.style.background = top;
    b.addEventListener('click', () => applyBackdrop(name));
    box.appendChild(b);
  }
  applyBackdrop(backdrop);
}

// ---- imported cat and controls ------------------------------------------------
let cat = null;
let params = loadCat() ?? { ...CAT_DEFAULTS };
const stats = document.getElementById('stats');
const status = document.getElementById('status');
const form = document.getElementById('form');
const buttons = ['download', 'toPark', 'random', 'reset'].map(id => document.getElementById(id));
buttons.forEach(b => { b.disabled = true; });
form.addEventListener('submit', e => e.preventDefault());
let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  if (!saveCat(params)) status.textContent = '瀏覽器無法儲存設定；仍可下載模型。';
}
function apply() {
  cat.setParams(params); params = cat.params;
  blob.scale.setScalar(0.85 * params.size);
  clearTimeout(saveTimer); saveTimer = setTimeout(persist, 200);
}
window.addEventListener('pagehide', () => { if (cat) persist(); });
function renderForm() {
  form.replaceChildren();
  const field = (label, key) => {
    const box = document.createElement('div'); box.className = 'field';
    const l = document.createElement('label'); l.className = 'label'; l.htmlFor = key; l.textContent = label;
    box.append(l); form.append(box); return box;
  };
  const name = document.createElement('input');
  Object.assign(name, { id: 'name', type: 'text', value: params.name, maxLength: 20 });
  name.addEventListener('input', () => { params.name = name.value; apply(); });
  field('名字', 'name').append(name);
  const labels = { size: '整體大小', head: '頭部大小', ears: '耳朵大小', tail: '尾巴大小' };
  for (const [key, [min, max]] of Object.entries(CAT_RANGES)) {
    if (key !== 'size' && !cat.profile.proportions) continue;
    const box = field(labels[key], key), out = document.createElement('output'), r = document.createElement('input');
    Object.assign(r, { id: key, type: 'range', min, max, step: 0.01, value: params[key] });
    out.htmlFor = key; out.textContent = `×${params[key].toFixed(2)}`;
    box.querySelector('label').append(out);
    r.addEventListener('input', () => { params[key] = +r.value; out.textContent = `×${params[key].toFixed(2)}`; apply(); });
    box.append(r);
  }
  const color = document.createElement('input');
  Object.assign(color, { id: 'color', type: 'color', value: params.color });
  color.addEventListener('input', () => { params.color = color.value; apply(); });
  field('全身毛色', 'color').append(color);
  const surface = document.createElement('select'); surface.id = 'surface';
  for (const [value, text] of [['smooth', '平滑表面'], ['faceted', '多邊形切面']]) surface.add(new Option(text, value));
  surface.value = params.surface;
  surface.addEventListener('change', () => { params.surface = surface.value; apply(); });
  field('表面效果', 'surface').append(surface);
}
function syncButtons() {
  for (const b of document.querySelectorAll('#anims button')) b.setAttribute('aria-pressed', String(b.dataset.mode === cat.mode));
}
for (const [mode, label] of [['run', '跑步'], ['pause', '暫停'], ['rest', '原始站姿']]) {
  const b = document.createElement('button'); b.type = 'button'; b.dataset.mode = mode; b.textContent = label; b.disabled = true;
  b.addEventListener('click', () => { cat.setMode(mode); syncButtons(); });
  document.getElementById('anims').append(b);
}
const timeline = document.getElementById('timeline'), speed = document.getElementById('speed');
timeline.addEventListener('input', () => { cat.seek(+timeline.value); syncButtons(); });
speed.addEventListener('input', () => { cat.setSpeed(+speed.value); document.getElementById('speedValue').textContent = `×${(+speed.value).toFixed(2)}`; });
document.getElementById('wireframe').addEventListener('change', e => cat.setWireframe(e.target.checked));
document.getElementById('reset').addEventListener('click', () => { params = catDefaults(params.model); renderForm(); apply(); });
document.getElementById('random').addEventListener('click', () => {
  params = { ...params, head: 0.95 + Math.random() * 0.15, ears: 0.9 + Math.random() * 0.2,
    tail: 0.9 + Math.random() * 0.2, color: ['#d6c7b4', '#c68c50', '#737985', '#ebe4d9', '#48434b'][Math.floor(Math.random() * 5)] };
  renderForm(); apply();
});
document.getElementById('download').addEventListener('click', async () => {
  const button = document.getElementById('download'); button.disabled = true;
  let exported;
  const exportGeometries = [];
  try {
    // A fresh skeleton, in bind pose, avoids exporting the current running pose or wireframe.
    exported = await createCat(params); exported.setMode('rest');
    // glTF stores normals, not Three.js's flatShading flag. Bake face normals
    // on an export-only copy, retaining skin attributes and the original asset.
    for (const mesh of exported.meshes) if (mesh.material.flatShading) {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      geometry.computeVertexNormals(); mesh.geometry = geometry; exportGeometries.push(geometry);
    }
    const glb = await new GLTFExporter().parseAsync(exported.root, { binary: true, animations: exported.animations });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    a.download = `${params.name.replace(/[\\/:*?"<>|]/g, '_') || 'cat'}.glb`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    status.textContent = exported.profile.animated ? '已匯出模型，包含骨架、跑步動畫與作者資訊。' : '已匯出站姿模型，包含外觀設定與作者資訊。';
  } catch (error) { status.textContent = `匯出失敗：${error.message}`; }
  finally { exported?.dispose(); exportGeometries.forEach(g => g.dispose()); button.disabled = false; }
});
document.getElementById('toPark').addEventListener('click', () => {
  clearTimeout(saveTimer);
  if (!saveCat(params)) { status.textContent = '無法儲存設定，請允許瀏覽器儲存後再帶去公園。'; return; }
  location.href = '../three/index.html';
});

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w && h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
}
new ResizeObserver(resize).observe(stage); resize();
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05); last = now;
  cat?.update(dt); controls.update(); renderer.render(scene, camera);
  if (cat && cat.mode === 'run') timeline.value = cat.time;
});
const modelSelect = document.getElementById('model');
for (const [id, profile] of Object.entries(CAT_MODELS)) modelSelect.add(new Option(profile.label, id));
modelSelect.value = params.model;
const drafts = new Map();
let loadVersion = 0;
function setBusy(busy) {
  buttons.forEach(b => { b.disabled = busy; });
  form.querySelectorAll('input, select').forEach(el => { el.disabled = busy; });
  document.querySelectorAll('#anims button, #motion input').forEach(el => { el.disabled = busy; });
  if (!busy && cat) {
    timeline.disabled = speed.disabled = !cat.profile.animated;
    document.querySelectorAll('#anims button').forEach(b => { b.disabled = !cat.profile.animated; });
  }
}
function showProfile() {
  stats.textContent = `${cat.triangles.toLocaleString()} 個三角形 · ${cat.profile.animated ? '連續蒙皮' : '站姿模型'}`;
  document.getElementById('modelDescription').textContent = cat.profile.description;
  document.getElementById('modelNote').textContent = cat.profile.note;
  const credit = document.getElementById('credit'); credit.replaceChildren();
  const author = document.createElement('a'), license = document.createElement('a');
  author.href = cat.profile.credit.source; author.textContent = cat.profile.credit.author;
  license.href = cat.profile.credit.licenseUrl; license.textContent = cat.profile.credit.license;
  for (const a of [author, license]) { a.target = '_blank'; a.rel = 'noopener'; }
  credit.append('模型：', author, ' · ', license, '。本站調整外觀。');
  document.getElementById('anims').hidden = !cat.profile.animated;
  document.getElementById('animationControls').hidden = !cat.profile.animated;
  timeline.max = cat.duration || 1; timeline.value = 0;
  speed.value = 1; document.getElementById('speedValue').textContent = '×1.00';
  document.getElementById('wireframe').checked = false;
  syncButtons();
}
async function selectModel(id) {
  const version = ++loadVersion;
  if (cat) drafts.set(params.model, { ...params });
  const nextParams = drafts.get(id) ?? (id === params.model ? params : catDefaults(id));
  setBusy(true); status.textContent = `正在載入${CAT_MODELS[id].label}…`;
  let next;
  try {
    next = await createCat(nextParams);
    await renderer.compileAsync(next.root, camera, scene);
    if (version !== loadVersion) { next.dispose(); return; }
    cat?.dispose(); cat = next; params = next.params;
    scene.add(cat.root); apply(); renderForm(); showProfile();
    controls.target.set(0, 0.16, 0);
    controls.update(); setBusy(false);
    status.textContent = cat.profile.animated
      ? '拖曳旋轉視角；暫停或拖曳時間軸，查看每個姿勢。'
      : '格線已隱藏。切換平滑／切面，比較輪廓與光影；拖曳可旋轉視角。';
  } catch (error) {
    next?.dispose();
    if (version !== loadVersion) return;
    modelSelect.value = params.model;
    setBusy(!cat);
    status.textContent = `模型載入失敗：${error.message}。可重新選擇模型再試。`;
  }
}
modelSelect.addEventListener('change', () => selectModel(modelSelect.value));
await selectModel(params.model);
window.__pet = { get params() { return params; }, get cat() { return cat; }, camera, controls, renderer, scene };
