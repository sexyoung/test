// Loads .glb models (Blender's glTF export, or scripts/make-glb.mjs) into the three.js park and
// plays their animations. Also accepts .glb files dragged onto the page.
//
// Off in benchmark runs (bench=1) and with models=0, so the engine comparison is unchanged.

import { AnimationMixer, LoopOnce, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { groundHeight, isWalkable } from '../../shared/world.js';
import { buildPet, loadPet } from '../pet/pet.js';
import { createCat, loadCat } from '../pet/rigged-cat.js';

// x/z in the park (metres), yaw in radians, y = height above the ground, play = clips to loop.
// The player starts at (1.1, 27.2) looking towards -z (the pond).
const PLACEMENTS = [
  { url: '../../models/windmill.glb', x: -5, z: -6, yaw: 0.3, play: ['Spin'] },
  { url: '../../models/fox.glb', x: 3.2, z: 23.2, yaw: -0.3, play: ['Idle'], every: { clip: 'Wave', seconds: 5 } },
  { url: '../../models/balloon.glb', x: 9, z: 8, y: 6, yaw: 0, play: ['Float'] },
];

export function createModels({ scene, camera, canvas, sim }) {
  const loader = new GLTFLoader();
  const mixers = [];
  const timers = [];

  function prepare(root) {
    root.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
  }

  function addModel(gltf, { x, z, y = 0, yaw = 0, play, every }) {
    const root = gltf.scene;
    prepare(root);
    root.position.set(x, groundHeight(x, z) + y, z);
    root.rotation.y = yaw;
    scene.add(root);

    if (gltf.animations.length) {
      const mixer = new AnimationMixer(root);
      const clip = (name) => gltf.animations.find((a) => a.name === name);
      const names = play ?? gltf.animations.map((a) => a.name);
      const looping = names.map(clip).filter(Boolean).map((c) => mixer.clipAction(c).play());
      if (every && clip(every.clip)) {
        const once = mixer.clipAction(clip(every.clip));
        once.setLoop(LoopOnce, 1);
        once.clampWhenFinished = false;
        mixer.addEventListener('finished', (e) => {
          if (e.action === once) for (const a of looping) a.reset().fadeIn(0.3);
        });
        timers.push({
          left: every.seconds, every: every.seconds,
          fire() { for (const a of looping) a.fadeOut(0.3); once.reset().fadeIn(0.3).play(); },
        });
      }
      mixers.push(mixer);
    }
    console.log(`[models] ${root.children[0]?.name || root.name || 'model'} at (${x.toFixed(1)}, ${z.toFixed(1)}), animations: ${gltf.animations.map((a) => a.name).join(', ') || 'none'}`);
    return root;
  }

  for (const p of PLACEMENTS) {
    loader.loadAsync(p.url).then((gltf) => addModel(gltf, p)).catch((err) => console.warn(`[models] ${p.url}:`, err));
  }

  // ---- drag & drop: put the model a few metres in front of the camera ---------------
  const dir = new Vector3();
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    for (const file of e.dataTransfer?.files ?? []) {
      if (!/\.(glb|gltf)$/i.test(file.name)) { console.warn(`[models] ${file.name}: only .glb / .gltf`); continue; }
      try {
        const gltf = await loader.parseAsync(await file.arrayBuffer(), '');
        camera.getWorldDirection(dir);
        dir.y = 0; dir.normalize();
        const x = camera.position.x + dir.x * 8, z = camera.position.z + dir.z * 8;
        const root = addModel(gltf, { x, z, yaw: Math.atan2(-dir.x, -dir.z) });
        root.name ||= file.name;
      } catch (err) {
        console.warn(`[models] ${file.name}:`, err);
      }
    }
  });
  canvas.title = '可以把 .glb 檔拖進來放到場景裡';

  const petLink = Object.assign(document.createElement('a'), { href: '../pet/index.html', textContent: '🐾 捏寵物' });
  Object.assign(petLink.style, {
    position: 'fixed', right: '16px', bottom: '16px', zIndex: 10, padding: '8px 14px', borderRadius: '999px',
    background: 'rgba(255,255,255,0.88)', color: '#24312a', font: '600 14px system-ui, sans-serif', textDecoration: 'none',
  });
  document.body.appendChild(petLink);

  let pet = null;
  if (sim) createFollowingPet({ scene, sim }).then(value => { pet = value; }).catch(error => {
    console.warn('[models] following pet:', error);
    petLink.textContent = '貓咪載入失敗 · 返回編輯器';
  });

  return {
    update(dt) {
      for (const t of timers) if ((t.left -= dt) <= 0) { t.left += t.every; t.fire(); }
      for (const m of mixers) m.update(dt);
      pet?.update(dt);
    },
  };
}

// ---- the pet from the pet editor (demos/pet) follows the player ----------------------------

async function createFollowingPet({ scene, sim }) {
  const catParams = loadCat();
  const params = catParams ?? loadPet();
  if (!params) return null;
  const cat = catParams ? await createCat(catParams) : null;
  const { root, animations } = cat ?? buildPet(params);
  const player = sim.player;
  const state = { x: player.x + 1.2, z: player.z - 0.5, yaw: player.yaw, speed: 0, wasGrounded: true };
  root.position.set(state.x, groundHeight(state.x, state.z), state.z);
  scene.add(root);

  const mixer = cat ? null : new AnimationMixer(root);
  const action = cat ? {} : Object.fromEntries(animations.map((c) => [c.name, mixer.clipAction(c)]));
  if (!cat) {
    action.Idle.play();
    action.Walk.play().setEffectiveWeight(0);
    action.Happy.setLoop(LoopOnce, 1);
    mixer.addEventListener('finished', (e) => { if (e.action === action.Happy) action.Happy.fadeOut(0.2); });
  }
  console.log(`[models] pet "${params.name}" (${cat ? 'rigged cat' : params.species}) follows the player`);
  if (cat) {
    const credit = document.createElement('a');
    credit.href = root.userData.attribution.source;
    credit.textContent = `Cat: ${root.userData.attribution.author} · ${root.userData.attribution.license} · 已修改`;
    credit.target = '_blank'; credit.rel = 'noopener';
    Object.assign(credit.style, { position: 'fixed', bottom: '4px', left: '8px', font: '10px system-ui', color: '#24312a', background: '#ffffffbb' });
    document.body.append(credit);
  }

  const turnTowards = (target, rate) => {
    let d = target - state.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    state.yaw += d * (1 - Math.exp(-rate));
  };

  return {
    update(dt) {
      // a spot a little behind and to the right of the player
      const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
      const tx = player.x - fx * 1.1 - fz * 0.9, tz = player.z - fz * 1.1 + fx * 0.9;
      let dx = tx - state.x, dz = tz - state.z;
      let dist = Math.hypot(dx, dz);
      if (dist > 25) { state.x = tx; state.z = tz; dx = dz = dist = 0; } // fell too far behind: catch up instantly

      const want = dist > 0.35 ? Math.min(7.5, 1.2 + dist * 1.8) : 0;
      state.speed += (want - state.speed) * (1 - Math.exp(-dt * 6));
      if (state.speed > 0.05 && dist > 0.01) {
        const step = Math.min(dist, state.speed * dt);
        const nx = state.x + (dx / dist) * step, nz = state.z + (dz / dist) * step;
        if (isWalkable(nx, nz)) { state.x = nx; state.z = nz; }
        turnTowards(Math.atan2(dx, dz), dt * 10);
      } else {
        turnTowards(Math.atan2(player.x - state.x, player.z - state.z), dt * 3); // look at the player
      }
      root.position.set(state.x, groundHeight(state.x, state.z), state.z);
      root.rotation.y = state.yaw;

      if (cat) {
        const moving = state.speed > 0.15 && dist > 0.35;
        const mode = moving && cat.profile.animated ? 'run' : 'rest';
        if (cat.mode !== mode) cat.setMode(mode);
        cat.setSpeed(Math.max(0.4, Math.min(1.5, state.speed / 2)));
        cat.update(dt);
        return;
      }
      // blend idle <-> walk, and hop along when the player jumps
      const w = Math.min(1, state.speed / 0.8);
      action.Walk.setEffectiveWeight(w);
      action.Walk.setEffectiveTimeScale(Math.max(0.6, state.speed / 1.6));
      action.Idle.setEffectiveWeight(1 - w);
      if (state.wasGrounded && !player.grounded) action.Happy.reset().fadeIn(0.1).play();
      state.wasGrounded = player.grounded;
      mixer.update(dt);
    },
  };
}
