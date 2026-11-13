// Babylon.js demo. Follows demos/README.md; see demos/raw/main.js for the reference look.
//
// Closest-equivalent notes (where Babylon.js cannot follow the contract literally):
//  * Material: StandardMaterial (the cheapest built-in lit material). It lights in whatever
//    space its inputs are in and has no linear -> sRGB output stage, so a tiny material plugin
//    (OutputPlugin below, the documented MaterialPluginBase mechanism) adds three things:
//      1. linear -> sRGB at the end of the fragment shader (same formula as the reference);
//      2. StandardMaterial clamps the accumulated light to [0, 1] before multiplying by the
//         albedo, but the reference light sum reaches ~1.17 on sun-facing surfaces. The
//         materials therefore use diffuse / ambient / emissive colour 0.5 and the plugin
//         multiplies the lit colour by 2 before fog (exact: powers of two). Lights and
//         vertex colours keep the values from world.env unchanged;
//      3. Babylon's fog uses the radial distance to the camera, the reference uses view-space
//         depth. The plugin keeps only the z component of the fog varying, so the built-in
//         linear fog runs on view depth.
//  * Flat ambient: scene.ambientColor (x material.ambientColor), not a light object.
//  * Shadows: ShadowGenerator PCF, QUALITY_MEDIUM (3x3 tent from 4 hardware comparison taps),
//    back faces only, constant bias. Babylon has no "outside the frustum = lit" test; see
//    the frustumEdgeFalloff note below.
//  * Static batches with count === 1 are plain meshes with a frozen world matrix; the others
//    are thin instances (one instanced draw call per pass).
//  * Documented production optimisations used: material.freeze(), mesh.freezeWorldMatrix()
//    on static meshes, scene.detachControl() (no pointer picking), lights without specular.

import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { Geometry } from '@babylonjs/core/Meshes/geometry.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo.js';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
// GLSL shaders used by this demo, imported statically so they are in the main bundle
import '@babylonjs/core/Shaders/default.vertex.js';
import '@babylonjs/core/Shaders/default.fragment.js';
import '@babylonjs/core/Shaders/shadowMap.vertex.js';
import '@babylonjs/core/Shaders/shadowMap.fragment.js';

import { createWorld } from '../../shared/world.js';
import { createSim } from '../../shared/sim.js';
import { createHarness } from '../../shared/harness.js';

const canvas = document.getElementById('app');
const harness = createHarness({ engine: 'Babylon.js', version: Engine.Version, canvas });
const { params, viewport } = harness;

const engine = new Engine(canvas, params.aa, {
  antialias: params.aa, alpha: false, depth: true, stencil: false,
  powerPreference: 'high-performance', preserveDrawingBuffer: false, audioEngine: false,
}, false);
engine.setSize(viewport.width, viewport.height);
harness.onResize(() => engine.setSize(viewport.width, viewport.height));
harness.mark('engine-ready');

const world = createWorld({ seed: params.seed, npcs: params.npcs, density: params.density, colorSpace: 'linear' });
const sim = createSim(world, { input: harness.input, autopilot: params.autopilot });
const { env } = world;

const scene = new Scene(engine);
scene.useRightHandedSystem = true;
scene.detachControl(); // input is handled by the shared harness; no picking
scene.clearColor = new Color4(0, 0, 0, 1);
const c3 = (c, s = 1) => new Color3(c[0] * s, c[1] * s, c[2] * s);
scene.ambientColor = c3(env.ambient.color, env.ambient.intensity);
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogStart = env.fog.near;
scene.fogEnd = env.fog.far;
scene.fogColor = c3(env.fog.color);

// ---- camera -----------------------------------------------------------------

const camera = new TargetCamera('camera', new Vector3(0, 2, 10), scene);
camera.fov = (env.camera.fov * Math.PI) / 180; // vertical
camera.minZ = env.camera.near;
camera.maxZ = env.camera.far;
scene.activeCamera = camera;

// ---- lights -----------------------------------------------------------------

const makeLight = (name, spec) => {
  const d = spec.direction;
  const light = new DirectionalLight(name, new Vector3(-d[0], -d[1], -d[2]), scene);
  light.diffuse = c3(spec.color);
  light.specular = Color3.Black(); // matte: the shaders compile without the specular term
  light.intensity = spec.intensity;
  return light;
};
const sun = makeLight('sun', env.sun);
makeLight('fill', env.fill);

let shadowGenerator = null;
if (params.shadows) {
  const S = env.shadow, d = env.sun.direction;
  sun.position = new Vector3(S.center[0] + d[0] * S.distance, S.center[1] + d[1] * S.distance, S.center[2] + d[2] * S.distance);
  sun.autoUpdateExtends = false;
  sun.autoCalcShadowZBounds = false;
  sun.shadowFrustumSize = S.halfSize * 2;
  sun.shadowMinZ = S.near;
  sun.shadowMaxZ = S.far;
  shadowGenerator = new ShadowGenerator(S.mapSize, sun);
  shadowGenerator.usePercentageCloserFiltering = true;
  shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM; // 3x3 tent, 4 hardware PCF taps
  shadowGenerator.forceBackFacesOnly = true; // like the reference: store back faces
  shadowGenerator.bias = 0.0007; // clip-space z = 0.00035 in depth, the reference bias
  shadowGenerator.normalBias = 0;
  shadowGenerator.setDarkness(0);
  // Babylon samples the clamped border texel outside the shadow frustum. A minimal edge
  // fall-off makes everything outside the (inscribed circle of the) frustum lit instead.
  shadowGenerator.frustumEdgeFalloff = 0.001;
}

// ---- materials (exactly one per world.materials entry) ------------------------

class OutputPlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, 'LowPolyOutput', 200, { LOWPOLY_OUTPUT: false }, true, true);
  }
  prepareDefines(defines) { defines.LOWPOLY_OUTPUT = true; }
  getClassName() { return 'LowPolyOutputPlugin'; }
  isCompatible() { return true; }
  getCustomCode(shaderType) {
    if (shaderType === 'vertex') {
      return { CUSTOM_VERTEX_MAIN_END: '#ifdef FOG\nvFogDistance = vec3(0.0, 0.0, vFogDistance.z);\n#endif' };
    }
    return {
      CUSTOM_FRAGMENT_BEFORE_FOG: 'color.rgb *= 2.0;',
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR:
        'color.rgb = mix(color.rgb * 12.92, 1.055 * pow(max(color.rgb, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), color.rgb));',
    };
  }
}

// World data: right-handed with counter-clockwise front faces. Babylon's mesh default assumes
// its own (clockwise) convention, so the orientation is stated explicitly on every material.
const SIDE_ORIENTATION = 1; // Material.CounterClockWiseSideOrientation
const HALF = new Color3(0.5, 0.5, 0.5);
const materials = {};
// Babylon draws opaque meshes grouped by material, in material creation order, so creating
// the background material first makes the sky the first draw of the frame.
const materialEntries = Object.entries(world.materials).sort((a, b) => (b[1].background ? 1 : 0) - (a[1].background ? 1 : 0));
for (const [name, spec] of materialEntries) {
  const m = new StandardMaterial(name, scene);
  m.specularColor = Color3.Black();
  m.diffuseColor = HALF.clone();
  if (spec.lit) {
    m.ambientColor = HALF.clone();
    m.emissiveColor = Color3.Black();
  } else {
    m.disableLighting = true;
    m.ambientColor = Color3.Black();
    m.emissiveColor = HALF.clone();
  }
  m.fogEnabled = spec.fog;
  m.backFaceCulling = true;
  m.sideOrientation = SIDE_ORIENTATION;
  if (spec.transparent) m.alpha = spec.opacity;
  if (!spec.depthWrite) m.disableDepthWrite = true;
  if (spec.background) m.depthFunction = 519; // ALWAYS
  new OutputPlugin(m);
  materials[name] = m;
}

// ---- geometry (one Geometry per world geometry, shared) -----------------------

const geometries = new Map();
function geometryFor(name) {
  let g = geometries.get(name);
  if (!g) {
    const src = world.geometries[name];
    g = new Geometry(name, scene, undefined, false);
    g.setVerticesData('position', src.positions, false, 3);
    g.setVerticesData('normal', src.normals, false, 3);
    g.setVerticesData('color', src.colors, false, 3);
    geometries.set(name, g);
  }
  return g;
}

function makeMesh(name, geometryName, materialName, parent) {
  const mesh = new Mesh(name, scene, parent || null);
  mesh.isUnIndexed = true;
  geometryFor(geometryName).applyToMesh(mesh);
  const n = world.geometries[geometryName].vertexCount;
  if (!mesh.subMeshes || mesh.subMeshes.length !== 1 || mesh.subMeshes[0].indexCount !== n) {
    mesh.releaseSubMeshes();
    new SubMesh(0, 0, n, 0, n, mesh);
  }
  mesh.material = materials[materialName];
  mesh.isPickable = false;
  return mesh;
}

// ---- static batches -----------------------------------------------------------

for (const s of world.statics) {
  const mesh = makeMesh(s.name, s.geometry, s.material, null);
  if (s.count === 1) {
    mesh.freezeWorldMatrix(Matrix.FromArray(s.matrices));
  } else {
    mesh.doNotSyncBoundingInfo = true;
    mesh.thinInstanceSetBuffer('matrix', s.matrices, 16, true);
    mesh.setBoundingInfo(new BoundingInfo(Vector3.FromArray(s.bounds.min), Vector3.FromArray(s.bounds.max)));
    mesh.freezeWorldMatrix();
  }
  if (world.materials[s.material].background) mesh.alwaysSelectAsActiveMesh = true;
  mesh.receiveShadows = !!shadowGenerator && s.receiveShadow && world.materials[s.material].lit;
  if (shadowGenerator && s.castShadow) shadowGenerator.addShadowCaster(mesh, false);
}

// ---- dynamic nodes ------------------------------------------------------------

const nodeCount = world.dynamics.count;
const nodes = new Array(nodeCount);
world.dynamics.nodes.forEach((n, i) => {
  const parent = n.parent >= 0 ? nodes[n.parent] : null;
  let node;
  if (n.geometry) {
    node = makeMesh(n.name, n.geometry, n.material, parent);
    node.receiveShadows = !!shadowGenerator && n.receiveShadow && world.materials[n.material].lit;
    if (shadowGenerator && n.castShadow) shadowGenerator.addShadowCaster(node, false);
  } else {
    node = new TransformNode(n.name, scene);
    node.parent = parent;
  }
  node.rotationQuaternion = new Quaternion(0, 0, 0, 1);
  node.scaling.setAll(sim.scales[i]);
  node.position.set(n.position[0], n.position[1], n.position[2]);
  nodes[i] = node;
});

// ---- frame --------------------------------------------------------------------

const target = new Vector3();
const drawCalls = engine._drawCalls;
harness.setStatsProvider(() => ({ drawCalls: drawCalls.current, triangles: scene.getActiveIndices() / 3 }));

function applySim() {
  const P = sim.positions, Q = sim.quaternions;
  for (let i = 0; i < nodeCount; i++) {
    const node = nodes[i];
    node.position.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    node.rotationQuaternion.set(Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3]);
  }
  const e = sim.camera.eye, t = sim.camera.target;
  camera.position.set(e[0], e[1], e[2]);
  target.set(t[0], t[1], t[2]);
  camera.setTarget(target);
}

function frame() {
  const { time, dt } = harness.beginFrame();
  sim.update(time, dt);
  applySim();
  harness.beginRender();
  drawCalls.fetchNewFrame();
  scene.render();
  harness.endFrame();
}

// Shaders compile in parallel and meshes that are not ready are skipped, so wait until the
// whole scene (including the shadow map pass) is ready before the first harness frame.
applySim();
scene.executeWhenReady(() => {
  for (const m of Object.values(materials)) m.freeze();
  harness.mark('scene-ready');
  engine.runRenderLoop(frame);
}, true);
