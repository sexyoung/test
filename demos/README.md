# Demo contract

The engine comparison renders the **same** low-poly park with a different renderer.
Three.js now opens the scenic showcase by default; use `three/index.html?scene=legacy`
for the comparison scene. Benchmark (`bench=1`) and screenshot (`freeze`) requests
automatically use the original implementation in `three/reference.js`.

| Folder | Renderer |
| --- | --- |
| `raw/` | plain WebGL2, no engine: the reference implementation |
| `three/` | Three.js |
| `babylon/` | Babylon.js |
| `playcanvas/` | PlayCanvas |

The scene data, the simulation and the measurement code are shared (`../shared`), so the
demos differ only in engine code. The rules below keep the comparison fair. If an engine
cannot follow a rule exactly, use its closest equivalent and say so in a comment at the top
of `main.js`.

## Shared modules

- `shared/world.js`: `createWorld({ seed, npcs, density, colorSpace })` returns geometries,
  materials, static instance batches, dynamic scene-graph nodes and the environment. The
  typedefs at the bottom of that file describe every field.
- `shared/sim.js`: `createSim(world, { input, autopilot })`. `sim.update(time, dt)` writes a
  local position and quaternion for every dynamic node, and the camera pose.
- `shared/harness.js`: URL parameters, HUD, input, frame timing, benchmark protocol.
- `demos/raw/main.js`: read this first. It consumes all three modules and defines the look.

## Rules

1. **Backend.** WebGL2 only. Render straight to the canvas (no post-processing, no offscreen
   colour target). Context: `antialias = params.aa`, no alpha, depth buffer, no stencil if the
   engine lets you choose, `powerPreference: 'high-performance'`.
2. **Canvas size.** Backing store is `harness.viewport.width x height` (the harness picks the
   pixel ratio). Update it from `harness.onResize`.
3. **World.** `createWorld({ seed, npcs, density })` from `harness.params`, plus the
   `colorSpace` that suits the engine's colour pipeline.
4. **Geometry.** One engine geometry per `world.geometries` entry, shared by everything that
   uses it. Non-indexed. Use the supplied normals and colours unchanged.
5. **Materials.** Exactly one engine material per `world.materials` entry (five in total).
   Use the engine's cheapest built-in lit material that reproduces the reference shading:
   matte diffuse only, vertex colour as albedo, no specular, no environment lighting.
   Honour `lit`, `fog`, `transparent`, `opacity`, `depthWrite` and `background`.
6. **Lights.** `env.ambient` (flat), `env.sun` (directional, casts shadows), `env.fill`
   (directional, no shadows). Light colours are linear. The intended result is
   `albedo * (ambient + sun * max(N.L, 0) * shadow + fill * max(N.L, 0))`, converted to sRGB
   for display, with no tone mapping.
7. **Fog.** Linear, `env.fog.near` to `env.fog.far`, colour `env.fog.color`.
8. **Shadows.** With `params.shadows`: one 2048 x 2048 shadow map for the sun, the fixed
   orthographic frustum in `env.shadow` (no cascades, no per-frame fitting), PCF close to a
   3 x 3 kernel with hardware depth comparison. Casters and receivers follow the
   `castShadow` / `receiveShadow` flags. Without `params.shadows`: no shadow pass at all.
9. **Static batches.** Each `StaticBatch` is one draw call per pass, drawn with the engine's
   hardware instancing (a batch with `count === 1` may be a plain mesh). They never move:
   no per-frame matrix work. Give the engine `batch.bounds` so culling is correct.
10. **Dynamic nodes.** Each `DynamicNode` is one ordinary scene-graph node, parented as
    `parent` says. Nodes with a geometry are ordinary meshes that share geometry and
    material. They are **not** instanced, batched or merged: one draw call each. Every frame
    copy `sim.positions` and `sim.quaternions` onto **every** node and let the engine update
    world matrices. `sim.scales[i]` is constant; set it once.
11. **Camera.** Perspective, vertical `env.camera.fov`, `near`, `far`. Every frame: position
    `sim.camera.eye`, look at `sim.camera.target`, up +Y.
12. **Culling.** Leave the engine's default frustum culling on, except for the `sky` batch.
13. **Frame loop.** Use the engine's normal loop. Per frame: `harness.beginFrame()` first,
    then `sim.update(time, dt)` with the returned time, copy transforms and camera,
    `harness.beginRender()` just before the engine renders, `harness.endFrame()` right after.
    Do not start the loop until every shader is compiled and the whole scene draws; call
    `harness.mark('engine-ready')` and `harness.mark('scene-ready')` at those two moments.
14. **Stats.** `harness.setStatsProvider(() => ({ drawCalls, triangles }))` from the engine's
    own per-frame counters.
15. **Nothing extra.** No physics, picking, debug layers or other per-frame features. Do not
    switch off default engine behaviour to win the benchmark unless the engine's own
    documentation recommends it for production; note any such choice.
16. **Bundle.** Import the engine the tree-shakeable way it recommends. Bundle size is measured.

## Checking a demo

```sh
node bench/run.mjs --quick --engines three
```

This builds the demo, saves `bench/out/<engine>-hero.png` and `-fly.png`, compares them with
`bench/reference/*.png` (rendered by `raw/`), runs a short benchmark and lists console
errors. Runs are serialised by a lock, so the command may wait for another run to finish.

Expected for the default scene: no errors, canvas 1280 x 720, at most 408 draw calls and
about 423,000 triangles per frame with shadows (240 and 277,000 without). Fewer is fine when
it comes from frustum culling.

## Rigged cat editor (outside the benchmark contract)

`pet/` now edits `public/models/lowpoly_cat_rig__run_animation.glb` through
`pet/rigged-cat.js`. The original file is unchanged: one skinned mesh, 794
triangles, 35 joints, one 1.5-second run clip, and no morph targets. The GLB has
1,750 attribute vertices (including normal/UV splits); these are not 1,750
unique geometric points. Source attribution is in the UI, exported extras and
`public/models/lowpoly_cat_LICENSE.txt`.

Customization uses bounded head/ear/tail bone scales, uniform size and a matte
coat tint. It does not split the skin or rebuild geometry. The imported FBX
armature basis needs an explicit bind-pose conversion for the standing preview;
the original animation tracks are retained. Standing is a static bind pose,
not an authored idle animation. Walking, jumping and detailed facial morphs
are not yet authored for this asset.

Settings use `lowpoly-rigged-cat-v1`, preserving older procedural-pet settings.
The scenic Three.js park prefers the saved cat, defaulting to the original
rigged runner. The legacy park retains its procedural-pet fallback. Benchmark
runs continue to exclude extra models.

With a dev or preview server running, verify editor controls, skin continuity
at proportion extremes, export/reimport deformation, persistence, mobile layout
and park integration:

```sh
node scripts/check-cat.mjs http://localhost:5173
```

The check requires Playwright Chromium and writes screenshots and an exported
sample to the ignored `bench/out/` directory.

The initial-model selector also supports `public/models/low_poly_cat.glb` by
kmeierhofer (CC BY 4.0). This second asset has 15,672 triangles, 8,159 attribute
vertices, and no skin, bones, morph targets or animations. It defaults to smooth
shading with wireframe off. Only size, color and surface controls are exposed;
the scenic park exhibits it in place alongside a running reference cat. In the
legacy park, its follower translates without a gait animation. Both models support
smooth/faceted shading. Flat normals are baked into an export-only geometry
copy because glTF does not store the renderer's `flatShading` flag.

The existing settings key remains compatible with earlier runner settings;
missing `model` selects `runner`. Active model and appearance persist across
reloads, and each model's adjustments are remembered during an editing session.
The check above also verifies switching, detailed-model export, attribution,
mobile layout and the detailed park follower. Original assets are never edited.

## Scenic showcase: Sunlit Grove

`three/index.html` loads `park/main.js`, a visual showcase with three camera
presets, orbit controls, pause, and automatic or manual quality. The park uses
the runner's faceted appearance as its visual reference: an irregular meadow,
warm tree crowns, a lake loop, an arched timber bridge, and a pavilion. There is
no player movement or gameplay. Saved runner proportions and appearance are
retained; its original continuous skin and run clip animate along the path.

`park/world.js` reuses the shared geometry builders and deterministic math but
owns its scene layout. It merges buildings and paths, batches vegetation by
spatial cell, and uses one directional shadow light and a procedural water
surface without an additional reflection pass. The cat route is sampled once.
Shaders are warmed before showing the scene. Reduced-motion preference starts
the scene paused; returning from a hidden tab resets frame timing.

`park/sky.js` adds a camera-relative sky dome with procedural drifting clouds,
a visible sunset disk, and 8,000 seeded stars with subtle twinkling and a faint
Milky Way band. Day/dusk/night buttons transition sky, fog, directional light,
ambient light, and water color together, and save `lowpoly-park-time`. Manual
time changes also work while paused; reduced motion applies them immediately.
Sky and stars use two draws, no textures or extra shadow/reflection pass. Stars
depth-test against the park so they never show through trees or buildings.

Following the supplied Turbo Tails analysis, `park/quality.js` tests a lower
quality level after sustained slow frames. It retains the change only if frame
intervals improve by 15%; otherwise it restores the previous level and locks
automatic changes. Manual quality is saved separately from cat settings. Frame
intervals are not GPU timings or a guarantee of FPS on real devices.

Run the showcase checks against a running development or production server:

```sh
node scripts/check-park.mjs http://localhost:5173
```

This checks camera controls, pause, mobile layout, quality persistence, both
cat models, quality-probe rollback, time switching and persistence, reduced motion,
and the original benchmark route. Screenshots
go to `bench/out/`; a clean scene screenshot refreshes `public/park-preview.png`
for the home page. The new scene has a different workload and should not be used
to compare renderer performance with the reference demos.
