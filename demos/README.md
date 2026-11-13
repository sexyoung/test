# Demo contract

Every folder here renders the **same** low-poly park with a different renderer:

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
