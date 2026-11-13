// Low Poly Park on PlayCanvas (engine only, no editor).
//
// Where PlayCanvas cannot follow demos/README.md literally, the closest equivalent is used:
//
//  * Rule 1 (context / render straight to the canvas). PlayCanvas 2.x always creates its own
//    WebGL2 context with antialias:false and, when antialiasing is requested, renders into an
//    engine-owned multisampled framebuffer that it blits to the canvas. To render straight to
//    the canvas like the other demos, this demo creates the context itself (antialias =
//    params.aa) and hands it to the device through the documented `gl` option, with the
//    device's own `antialias` off. This is NOT the engine's default presentation path.
//  * Rule 8 (shadows). The fixed frustum is reproduced with `light.shadowBounds` (one shadow
//    map fitted to a world-space box, no cascades, no per-frame fitting). The box is chosen so
//    its projection is the 84 m half-size square of env.shadow; the engine adds a 2-texel
//    border and derives near/far itself. The shadow pass uses the material's cull mode, so the
//    map stores FRONT faces (the reference stores back faces) and acne is avoided with the
//    engine's slope-scaled depth bias. Filtering: SHADOW_PCF3_32F (3x3 PCF, hardware compare,
//    32-bit float depth instead of 24-bit).
//  * Rule 5. PlayCanvas takes colours in sRGB and linearises them, so linear light / ambient /
//    fog colours are passed through Color.gamma(). Light intensity stays 1 (intensities below
//    1 are gamma-treated by the engine) and is folded into the colour. Unlit materials are
//    StandardMaterials with lighting off and the vertex colour routed to emissive.
//  * Rule 7. The engine's linear fog measures gl_FragCoord.z / gl_FragCoord.w, which is
//    far * (viewDepth - near) / (far - near): at most 0.5 m short of the true view depth.
//  * Rule 9. Every static batch, including the count === 1 ones, is hardware-instanced.
//  * Rule 14. Production builds only count draw calls (published one frame late); triangles
//    are reported as null.
//  * Clustered lighting is left at the engine default (enabled), although the scene has only
//    directional lights.

import {
  AppBase, AppOptions, WebglGraphicsDevice, version,
  RenderComponentSystem, CameraComponentSystem, LightComponentSystem,
  Entity, Layer, Mesh, MeshInstance, StandardMaterial, VertexBuffer, VertexFormat, BoundingBox, Vec3, Color,
  SEMANTIC_POSITION, SEMANTIC_NORMAL, SEMANTIC_COLOR, TYPE_FLOAT32, PRIMITIVE_TRIANGLES, BUFFER_STATIC,
  FILLMODE_NONE, RESOLUTION_FIXED, BLEND_NORMAL, FOG_LINEAR, GAMMA_SRGB, TONEMAP_NONE, SHADOW_PCF3_32F,
} from 'playcanvas';
import { createWorld } from '../../shared/world.js';
import { createSim } from '../../shared/sim.js';
import { createHarness } from '../../shared/harness.js';

const canvas = document.getElementById('app');
const harness = createHarness({ engine: 'PlayCanvas', version, canvas });
const { params, viewport } = harness;

// ---- device and application ---------------------------------------------------

const contextOptions = { antialias: params.aa, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance' };
const gl = canvas.getContext('webgl2', contextOptions);
if (!gl) throw new Error('WebGL2 is not available');
const device = new WebglGraphicsDevice(canvas, { ...contextOptions, antialias: false, gl });
device.maxPixelRatio = 1; // the harness owns the pixel ratio

const options = new AppOptions();
options.graphicsDevice = device;
options.componentSystems = [RenderComponentSystem, CameraComponentSystem, LightComponentSystem];
options.resourceHandlers = [];
const app = new AppBase(canvas);
app.init(options);

function resize() {
  app.setCanvasFillMode(FILLMODE_NONE, viewport.cssWidth, viewport.cssHeight);
  app.setCanvasResolution(RESOLUTION_FIXED, viewport.width, viewport.height);
}
resize();
harness.onResize(resize);
harness.mark('engine-ready');

// vertex colours are used as linear albedo (vertexColorGamma stays off)
const world = createWorld({ seed: params.seed, npcs: params.npcs, density: params.density, colorSpace: 'linear' });
const sim = createSim(world, { input: harness.input, autopilot: params.autopilot });
const { env } = world;

/** Linear rgb (optionally scaled) -> the sRGB Color the engine expects and linearises again. */
const fromLinear = (c, k = 1) => new Color(c[0] * k, c[1] * k, c[2] * k).gamma();

// ---- environment ----------------------------------------------------------------

const scene = app.scene;
scene.ambientLight = fromLinear(env.ambient.color, env.ambient.intensity);
scene.fog.type = FOG_LINEAR;
scene.fog.color = fromLinear(env.fog.color);
scene.fog.start = env.fog.near;
scene.fog.end = env.fog.far;

// the sky is drawn first, from its own layer in front of the world layer
const skyLayer = new Layer({ name: 'Sky' });
scene.layers.insertOpaque(skyLayer, 0);
const worldLayers = [app.defaultLayerWorld.id];

const cameraEntity = new Entity('camera');
cameraEntity.addComponent('camera', {
  fov: env.camera.fov, nearClip: env.camera.near, farClip: env.camera.far,
  clearColor: new Color(0, 0, 0, 1),
  gammaCorrection: GAMMA_SRGB, toneMapping: TONEMAP_NONE,
  layers: [skyLayer.id, ...worldLayers],
});
app.root.addChild(cameraEntity);

/** Directional light whose rays travel along -direction; local axes match a look-at from the light. */
function addLight(name, spec, center, distance, extra) {
  const e = new Entity(name);
  const d = spec.direction;
  e.setPosition(center[0] + d[0] * distance, center[1] + d[1] * distance, center[2] + d[2] * distance);
  e.lookAt(center[0], center[1], center[2]);
  e.rotateLocal(90, 0, 0); // the light shines along its local -Y
  e.addComponent('light', { type: 'directional', color: fromLinear(spec.color, spec.intensity), intensity: 1, layers: worldLayers, ...extra });
  app.root.addChild(e);
  return e;
}

const SHADOW = env.shadow;
let shadowSettings = {};
if (params.shadows) {
  // world-space box whose projection on the light's right / up axes is SHADOW.halfSize on both
  const d = env.sun.direction;
  const hl = Math.hypot(d[0], d[2]);
  const right = [d[2] / hl, 0, -d[0] / hl];
  const up = [d[1] * right[2] - d[2] * right[1], d[2] * right[0] - d[0] * right[2], d[0] * right[1] - d[1] * right[0]];
  const h = SHADOW.halfSize / (Math.abs(right[0]) + Math.abs(right[2]));
  const hy = (SHADOW.halfSize - (Math.abs(up[0]) + Math.abs(up[2])) * h) / Math.abs(up[1]);
  shadowSettings = {
    castShadows: true,
    shadowType: SHADOW_PCF3_32F,
    shadowResolution: SHADOW.mapSize,
    shadowBounds: new BoundingBox(new Vec3(...SHADOW.center), new Vec3(h, hy, h)),
    shadowBias: 0.3,
    normalOffsetBias: 0,
  };
}
addLight('sun', env.sun, SHADOW.center, SHADOW.distance, shadowSettings);
addLight('fill', env.fill, SHADOW.center, SHADOW.distance, { castShadows: false });

// ---- materials (exactly one per world.materials entry) ---------------------------

const materials = {};
for (const [name, spec] of Object.entries(world.materials)) {
  const m = new StandardMaterial();
  m.name = name;
  m.useMetalness = false;
  m.specular = new Color(0, 0, 0);
  m.useSkybox = false;
  m.useTonemap = false;
  m.useFog = spec.fog;
  m.useLighting = spec.lit;
  if (spec.lit) {
    m.diffuse = new Color(1, 1, 1);
    m.diffuseVertexColor = true;
  } else {
    m.diffuse = new Color(0, 0, 0);
    m.emissive = new Color(1, 1, 1);
    m.emissiveVertexColor = true;
  }
  if (spec.transparent) {
    m.blendType = BLEND_NORMAL;
    m.opacity = spec.opacity;
  }
  m.depthWrite = spec.depthWrite;
  if (spec.background) m.depthTest = false;
  m.update();
  materials[name] = m;
}

// ---- geometry (one Mesh per world.geometries entry, non-indexed) ------------------

const vertexFormat = new VertexFormat(device, [
  { semantic: SEMANTIC_POSITION, components: 3, type: TYPE_FLOAT32 },
  { semantic: SEMANTIC_NORMAL, components: 3, type: TYPE_FLOAT32 },
  { semantic: SEMANTIC_COLOR, components: 3, type: TYPE_FLOAT32 },
]);
const boxOf = (b) => {
  const box = new BoundingBox();
  box.setMinMax(new Vec3(...b.min), new Vec3(...b.max));
  return box;
};
const meshes = new Map();
function meshOf(name) {
  let mesh = meshes.get(name);
  if (!mesh) {
    const g = world.geometries[name];
    const n = g.vertexCount;
    const data = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) {
      data.set(g.positions.subarray(i * 3, i * 3 + 3), i * 9);
      data.set(g.normals.subarray(i * 3, i * 3 + 3), i * 9 + 3);
      data.set(g.colors.subarray(i * 3, i * 3 + 3), i * 9 + 6);
    }
    mesh = new Mesh(device);
    mesh.vertexBuffer = new VertexBuffer(device, vertexFormat, n, { usage: BUFFER_STATIC, data: data.buffer });
    mesh.primitive[0] = { type: PRIMITIVE_TRIANGLES, base: 0, count: n, indexed: false };
    mesh.aabb = boxOf(g.bounds);
    meshes.set(name, mesh);
  }
  return mesh;
}

// ---- static batches: hardware instancing, one draw call per batch per pass ---------

const instancingFormat = VertexFormat.getDefaultInstancingFormat(device);
for (const s of world.statics) {
  const spec = world.materials[s.material];
  const mi = new MeshInstance(meshOf(s.geometry), materials[s.material]);
  const matrices = new VertexBuffer(device, instancingFormat, s.count, { usage: BUFFER_STATIC, data: s.matrices.slice().buffer });
  mi.setInstancing(matrices, !spec.background); // second argument: frustum-cull the batch
  const e = new Entity(s.name);
  e.addComponent('render', {
    meshInstances: [mi], castShadows: s.castShadow && params.shadows, receiveShadows: s.receiveShadow,
    layers: spec.background ? [skyLayer.id] : worldLayers,
  });
  e.render.customAabb = boxOf(s.bounds); // the entity sits at the origin, so local == world
  app.root.addChild(e);
}

// ---- dynamic nodes: plain entities, one draw call each ------------------------------

const nodeCount = world.dynamics.count;
const entities = world.dynamics.nodes.map((n, i) => {
  const e = new Entity(n.name);
  if (n.geometry) {
    e.addComponent('render', {
      meshInstances: [new MeshInstance(meshOf(n.geometry), materials[n.material])],
      castShadows: n.castShadow && params.shadows, receiveShadows: n.receiveShadow, layers: worldLayers,
    });
  }
  const s = sim.scales[i];
  e.setLocalScale(s, s, s);
  return e;
});
world.dynamics.nodes.forEach((n, i) => (n.parent < 0 ? app.root : entities[n.parent]).addChild(entities[i]));

function applySim() {
  const P = sim.positions, Q = sim.quaternions;
  for (let i = 0; i < nodeCount; i++) {
    const e = entities[i];
    e.setLocalPosition(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    e.setLocalRotation(Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3]);
  }
  const eye = sim.camera.eye, target = sim.camera.target;
  cameraEntity.setPosition(eye[0], eye[1], eye[2]);
  cameraEntity.lookAt(target[0], target[1], target[2]);
}

// ---- warm-up: draw everything once (no culling) so every shader is compiled ---------

applySim();
cameraEntity.camera.frustumCulling = false;
app.render();
cameraEntity.camera.frustumCulling = true;
harness.mark('scene-ready');

// ---- frame loop (the engine's own tick) ----------------------------------------------

harness.setStatsProvider(() => ({ drawCalls: app.stats.drawCalls.total, triangles: null }));

let frameInfo = null;
app.on('frameupdate', () => { frameInfo = harness.beginFrame(); });
app.on('update', () => {
  sim.update(frameInfo.time, frameInfo.dt);
  applySim();
});
app.on('framerender', () => harness.beginRender());
app.on('frameend', () => harness.endFrame());
app.start();
