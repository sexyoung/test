// Pet editor: a form that drives buildPet(), a turntable preview, .glb download and "take it to the park".

import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Mesh, PlaneGeometry,
  MeshBasicMaterial, CanvasTexture, AnimationMixer, SRGBColorSpace, NoToneMapping,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildPet, randomPet, loadPet, savePet, normalizePet, OPTIONS, DEFAULT_PET } from './pet.js';

const canvas = document.getElementById('app');
const stage = document.querySelector('.stage');
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true }); // transparent: the CSS gradient shows through
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;
renderer.setClearColor(0x000000, 0);

const scene = new Scene();
const camera = new PerspectiveCamera(30, 1, 0.05, 50);
camera.position.set(0.78, 0.48, 1.55);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.17, 0);
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

// ---- pet state -----------------------------------------------------------------------

let params = loadPet() ?? { ...DEFAULT_PET };
let pet = null, mixer = null, actions = {}, current = 'Idle';

function rebuild() {
  if (pet) {
    scene.remove(pet.root);
    pet.root.traverse((o) => o.isMesh && o.geometry.dispose());
  }
  pet = buildPet(params);
  scene.add(pet.root);
  mixer = new AnimationMixer(pet.root);
  actions = Object.fromEntries(pet.animations.map((c) => [c.name, mixer.clipAction(c)]));
  actions[current]?.play();
  blob.scale.setScalar(pet.footprint * 2.4);
  document.getElementById('stats').textContent = `${pet.triangles} 個三角形 · 高約 ${Math.round(pet.height * 100)} 公分`;
  savePet(params);
}

function play(name) {
  if (!actions[name] || name === current) return;
  actions[name].reset().fadeIn(0.25).play();
  actions[current]?.fadeOut(0.25);
  current = name;
  for (const b of document.querySelectorAll('#anims button')) b.setAttribute('aria-pressed', String(b.dataset.anim === name));
}

// ---- form ------------------------------------------------------------------------------

const form = document.getElementById('form');
const LABELS = { species: '種類', body: '體型', ears: '耳朵', tail: '尾巴', pattern: '花紋' };
const SLIDERS = [['size', '整體大小', 0.6, 1.6], ['head', '頭的大小', 0.8, 1.35], ['legs', '腿長', 0.6, 1.5], ['eyes', '眼睛大小', 0.7, 1.4], ['snout', '嘴巴長度（狗）', 0.6, 1.6]];
const COLORS = [['main', '主要毛色'], ['secondary', '第二毛色'], ['eye', '眼睛'], ['nose', '鼻子']];

function renderForm() {
  form.innerHTML = '';
  const field = (label, out) => {
    const f = document.createElement('div');
    f.className = 'field';
    f.innerHTML = `<div class="label"><span>${label}</span>${out ? '<output></output>' : ''}</div>`;
    form.appendChild(f);
    return f;
  };

  const name = field('名字');
  const input = Object.assign(document.createElement('input'), { type: 'text', value: params.name, maxLength: 20 });
  input.addEventListener('input', () => { params.name = input.value; rebuild(); });
  name.appendChild(input);

  for (const [key, label] of Object.entries(LABELS)) {
    const f = field(label);
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const [value, text] of Object.entries(OPTIONS[key])) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('aria-pressed', String(params[key] === value));
      b.addEventListener('click', () => {
        params[key] = value;
        if (key === 'species') params.snout = value === 'dog' ? 1.2 : 1; // dogs get a longer snout by default
        renderForm();
        rebuild();
      });
      chips.appendChild(b);
    }
    f.appendChild(chips);
  }

  for (const [key, label, min, max] of SLIDERS) {
    const f = field(label, true);
    const out = f.querySelector('output');
    const r = Object.assign(document.createElement('input'), { type: 'range', min, max, step: 0.01, value: params[key] });
    out.textContent = `×${(+params[key]).toFixed(2)}`;
    r.addEventListener('input', () => { params[key] = +r.value; out.textContent = `×${(+r.value).toFixed(2)}`; rebuild(); });
    f.appendChild(r);
  }

  const f = field('顏色');
  const grid = document.createElement('div');
  grid.className = 'colors';
  for (const [key, label] of COLORS) {
    const l = document.createElement('label');
    const c = Object.assign(document.createElement('input'), { type: 'color', value: params[key] });
    c.addEventListener('input', () => { params[key] = c.value; rebuild(); });
    l.append(c, label);
    grid.appendChild(l);
  }
  f.appendChild(grid);
}

// ---- animation buttons and actions --------------------------------------------------------

const anims = document.getElementById('anims');
for (const [name, text] of [['Idle', '待機'], ['Walk', '走路'], ['Happy', '開心']]) {
  const b = document.createElement('button');
  b.dataset.anim = name;
  b.textContent = text;
  b.setAttribute('aria-pressed', String(name === current));
  b.addEventListener('click', () => play(name));
  anims.appendChild(b);
}

document.getElementById('random').addEventListener('click', () => {
  params = randomPet();
  renderForm();
  rebuild();
});

document.getElementById('download').addEventListener('click', async () => {
  const exportRoot = pet.root.clone();
  exportRoot.position.set(0, 0, 0);
  const glb = await new GLTFExporter().parseAsync(exportRoot, { binary: true, animations: pet.animations });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
  a.download = `${(params.name || 'pet').replace(/[\\/:*?"<>|]/g, '_')}.glb`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

document.getElementById('toPark').addEventListener('click', () => {
  savePet(normalizePet(params));
  location.href = '../three/index.html';
});

// ---- loop ------------------------------------------------------------------------------

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

let last = performance.now();
renderer.setAnimationLoop(() => {
  resize();
  const now = performance.now(), dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  mixer?.update(dt);
  controls.update();
  renderer.render(scene, camera);
});

renderForm();
rebuild();
window.__pet = { get params() { return params; }, play, camera, controls };
