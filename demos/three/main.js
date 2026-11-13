// Three.js demo. Same world, simulation and harness as demos/raw; only the engine code differs.
//
// Where three.js cannot follow the contract (demos/README.md) literally, the closest equivalent is used:
//
//  * Context (rule 1). WebGLRenderer always asks for `alpha: true` when it creates the context
//    itself, so the demo creates the context with the contract's attributes and hands it to the
//    renderer through its documented `context` option.
//  * Light units (rule 6). MeshLambertMaterial divides by PI (physical units), so every light
//    intensity is multiplied by PI to get `albedo * light`.
//  * Fog (rule 7). three's built-in "linear" Fog is a smoothstep ramp blended AFTER the sRGB
//    conversion. The two fogged materials move the fog chunk in front of the colour-space
//    conversion and make the ramp linear (Material.onBeforeCompile). Same cost, reference look.
//  * Shadows (rule 8). PCFShadowMap is the closest built-in filter: hardware depth comparison,
//    five bilinear taps on a one-texel Vogel disc rotated per pixel (the reference uses four
//    fixed taps). three's shadow render target also always carries a colour attachment.
//  * Static batches with count === 1 are plain meshes (rule 9 allows it); transform-only
//    dynamic nodes are Groups.
//  * Before the loop starts: compileAsync(), then one un-timed render with frustum culling off,
//    so the shadow-pass programs are linked and every buffer is uploaded (rule 13).

import {
  REVISION, WebGLRenderer, Scene, PerspectiveCamera, Fog, Color, AmbientLight, DirectionalLight,
  BufferGeometry, BufferAttribute, Mesh, InstancedMesh, Group, MeshLambertMaterial, MeshBasicMaterial,
  Sphere, Box3, Vector3, PCFShadowMap, SRGBColorSpace, NoToneMapping, StaticDrawUsage,
} from 'three';
import { createWorld } from '../../shared/world.js';
import { createSim } from '../../shared/sim.js';
import { createHarness } from '../../shared/harness.js';

const canvas = document.getElementById('app');
const harness = createHarness({ engine: 'Three.js', version: 'r' + REVISION, canvas });
const { params, viewport } = harness;

const contextAttributes = { antialias: params.aa, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance' };
const gl = canvas.getContext('webgl2', contextAttributes);
if (!gl) throw new Error('WebGL2 is not available');
const renderer = new WebGLRenderer({ canvas, context: gl, ...contextAttributes });
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;
renderer.setPixelRatio(1); // the harness already applied the pixel ratio to viewport.width / height
renderer.setSize(viewport.width, viewport.height, false);
harness.mark('engine-ready');

const world = createWorld({ seed: params.seed, npcs: params.npcs, density: params.density, colorSpace: 'linear' });
const sim = createSim(world, { input: harness.input, autopilot: params.autopilot });
const { env } = world;

// ---- scene, camera, lights ----------------------------------------------------

const scene = new Scene();
scene.fog = new Fog(new Color().setRGB(...env.fog.color), env.fog.near, env.fog.far);

const camera = new PerspectiveCamera(env.camera.fov, viewport.width / viewport.height, env.camera.near, env.camera.far);

const linear = (c) => new Color().setRGB(c[0], c[1], c[2]);
scene.add(new AmbientLight(linear(env.ambient.color), env.ambient.intensity * Math.PI));

const SHADOW = env.shadow;
const sun = new DirectionalLight(linear(env.sun.color), env.sun.intensity * Math.PI);
sun.position.set(
  SHADOW.center[0] + env.sun.direction[0] * SHADOW.distance,
  SHADOW.center[1] + env.sun.direction[1] * SHADOW.distance,
  SHADOW.center[2] + env.sun.direction[2] * SHADOW.distance,
);
sun.target.position.fromArray(SHADOW.center);
scene.add(sun, sun.target);

const fill = new DirectionalLight(linear(env.fill.color), env.fill.intensity * Math.PI);
fill.position.fromArray(env.fill.direction); // target stays at the origin
scene.add(fill);

if (params.shadows) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  sun.castShadow = true;
  const s = sun.shadow;
  s.mapSize.set(SHADOW.mapSize, SHADOW.mapSize);
  s.camera.left = -SHADOW.halfSize;
  s.camera.right = SHADOW.halfSize;
  s.camera.bottom = -SHADOW.halfSize;
  s.camera.top = SHADOW.halfSize;
  s.camera.near = SHADOW.near;
  s.camera.far = SHADOW.far;
  s.camera.updateProjectionMatrix();
  s.bias = -0.00035; // same constant depth bias as the reference; back faces are stored (three's default)
  s.normalBias = 0;
  s.radius = 1;
}

// ---- materials (exactly one per world.materials entry) --------------------------

const FOG_GLSL = `
#ifdef USE_FOG
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColorLinear, clamp( ( vFogDepth - fogNear ) / ( fogFar - fogNear ), 0.0, 1.0 ) );
#endif
`;
function referenceFog(shader) {
  const src = shader.fragmentShader;
  for (const token of ['#include <fog_pars_fragment>', '#include <colorspace_fragment>', '#include <fog_fragment>']) {
    if (!src.includes(token)) throw new Error(`fog patch: "${token}" not found in the three.js shader`);
  }
  shader.uniforms.fogColorLinear = { value: scene.fog.color }; // working (linear) colour space
  shader.fragmentShader = src
    .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\n#ifdef USE_FOG\n\tuniform vec3 fogColorLinear;\n#endif')
    .replace('#include <fog_fragment>', '')
    .replace('#include <colorspace_fragment>', `${FOG_GLSL}\n#include <colorspace_fragment>`);
}

const materials = {};
for (const [name, spec] of Object.entries(world.materials)) {
  const options = {
    vertexColors: true,
    fog: spec.fog,
    transparent: spec.transparent,
    opacity: spec.opacity,
    depthWrite: spec.depthWrite,
    depthTest: !spec.background,
  };
  const material = spec.lit ? new MeshLambertMaterial(options) : new MeshBasicMaterial(options);
  material.name = name;
  if (spec.fog) {
    material.onBeforeCompile = referenceFog;
    material.customProgramCacheKey = () => 'reference-fog';
  }
  materials[name] = material;
}

// ---- geometries (one per world.geometries entry, non-indexed) -------------------

const geometries = {};
for (const [name, g] of Object.entries(world.geometries)) {
  const geometry = new BufferGeometry();
  geometry.name = name;
  geometry.setAttribute('position', new BufferAttribute(g.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(g.normals, 3));
  geometry.setAttribute('color', new BufferAttribute(g.colors, 3));
  geometry.boundingSphere = new Sphere(new Vector3().fromArray(g.bounds.center), g.bounds.radius);
  geometry.boundingBox = new Box3(new Vector3().fromArray(g.bounds.min), new Vector3().fromArray(g.bounds.max));
  geometries[name] = geometry;
}

// ---- static batches: hardware instancing, no per-frame matrix work --------------

for (const batch of world.statics) {
  if (batch.count === 0) continue;
  const geometry = geometries[batch.geometry], material = materials[batch.material];
  let mesh;
  if (batch.count === 1) {
    mesh = new Mesh(geometry, material);
    mesh.matrix.fromArray(batch.matrices);
  } else {
    mesh = new InstancedMesh(geometry, material, batch.count);
    mesh.instanceMatrix.copyArray(batch.matrices);
    mesh.instanceMatrix.setUsage(StaticDrawUsage);
    mesh.boundingSphere = new Sphere(new Vector3().fromArray(batch.bounds.center), batch.bounds.radius);
    mesh.boundingBox = new Box3(new Vector3().fromArray(batch.bounds.min), new Vector3().fromArray(batch.bounds.max));
  }
  mesh.name = batch.name;
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorld.copy(mesh.matrix);
  mesh.castShadow = batch.castShadow;
  mesh.receiveShadow = batch.receiveShadow;
  if (world.materials[batch.material].background) {
    mesh.frustumCulled = false;
    mesh.renderOrder = -1; // before everything else
  }
  scene.add(mesh);
}

// ---- dynamic nodes: ordinary scene-graph nodes, one draw call per mesh -----------

const nodeCount = world.dynamics.count;
const nodes = new Array(nodeCount);
for (let i = 0; i < nodeCount; i++) {
  const n = world.dynamics.nodes[i];
  const node = n.geometry ? new Mesh(geometries[n.geometry], materials[n.material]) : new Group();
  node.name = n.name;
  node.castShadow = n.castShadow;
  node.receiveShadow = n.receiveShadow;
  node.scale.setScalar(sim.scales[i]);
  (n.parent < 0 ? scene : nodes[n.parent]).add(node);
  nodes[i] = node;
}

function applySim() {
  const P = sim.positions, Q = sim.quaternions;
  for (let i = 0; i < nodeCount; i++) {
    const node = nodes[i];
    node.position.fromArray(P, i * 3);
    node.quaternion.fromArray(Q, i * 4);
  }
  const eye = sim.camera.eye, target = sim.camera.target;
  camera.position.set(eye[0], eye[1], eye[2]);
  camera.lookAt(target[0], target[1], target[2]);
}

// ---- resize, stats ---------------------------------------------------------------

harness.onResize((vp) => {
  renderer.setSize(vp.width, vp.height, false);
  camera.aspect = vp.width / vp.height;
  camera.updateProjectionMatrix();
});

// info.render is reset at the start of render(), before the shadow pass: both passes are counted.
harness.setStatsProvider(() => ({ drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles }));

// ---- compile everything, draw the whole scene once, then start the loop ----------

applySim();
await renderer.compileAsync(scene, camera);
{
  const culled = [];
  scene.traverse((o) => { if (o.isMesh && o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
  renderer.render(scene, camera);
  for (const o of culled) o.frustumCulled = true;
}
harness.mark('scene-ready');

// .glb models (demos/three/models.js); never loaded in benchmark runs.
const models = !params.bench && params.all.get('models') !== '0'
  ? (await import('./models.js')).createModels({ scene, camera, canvas, sim })
  : null;

function frame() {
  const { time, dt } = harness.beginFrame();
  sim.update(time, dt);
  applySim();
  models?.update(dt);
  harness.beginRender();
  renderer.render(scene, camera);
  harness.endFrame();
}
renderer.setAnimationLoop(frame);
