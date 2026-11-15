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

`pet/rigged-cat.js` loads `public/models/cat/runner-base.glb`, published from
`public/models/cat/runner-ear-controls.blend`. The pet editor, photo adapter and
park use this same runtime base. Run `npm run models:cat-base` after editing the
Blender file; this exports, rebakes joint transforms and verifies the result
against the Blender surface. `runner-base.json` records both file hashes.
This derived runner replaces the old head with `cat-head-uncolored.glb`, a
separately saved neutral copy of the user-provided `cat-head-approved.glb` sculpt. It has 1,550 triangles, 53 connected joints and
the preserved 1.5-second run motion. The head keeps its facial geometry, two irises and four morph targets, with
vertex colors and unlit painted material removed from the neutral copy. An oblique opening across the underside replaces the bust-like lower head.
An inset intermediate neck ring connects the jaw and throat continuously to
the chest; ears and the upper skull are retained. The approved source GLB and Blender file remain untouched.

The earlier geometry-construction pipeline remains available for rebuilding
the intermediate derivative from the two local sources:

```sh
python3 scripts/attach-approved-cat-head.py
npm run models:cat-neck-blender
npm run models:cat-head-skin
npm run models:cat-proportions
npm run models:cat-continuity
npm run models:cat-run-skin
```

The imported FBX armature still needs the existing bind-pose basis conversion
in `createCat`. Standing is the corrected static rest pose, not an idle clip.
Head, ear and tail bone controls work over the original run. A single coat tint applies to head, neck and body; head facets stay flat even
if body smoothing is selected. GLB downloads bake flat normals and include the complete skin,
head morphs, original run clip and attribution.

The retired static “細緻站姿貓” asset and its selector entry have been removed.
Saved settings selecting that former model fall back to the runner. The
existing `lowpoly-rigged-cat-v1` settings key remains valid. The photo workshop,
base catalog and scenic park use the same replacement runner. Photo adaptation
uses per-face colors and the sculpt's eye/nose geometry, with one shared
coordinate deformation across body, head and neck. The uncolored source does not include the original black/white face paint;
individual facial coat markings are not reconstructed.

With a Vite server running:

```sh
node scripts/check-cat.mjs http://localhost:5177
```

This checks all four head morphs, head/ear/tail extremes across run poses,
cross-mesh neck continuity, export/reimport deformation, face normals, body
color consistency, original/neutral source separation, mobile layout, old-setting migration and photo integration.
Screenshots, an exported sample and the report go to `bench/out/approved-head/`.
Body credit remains in `public/models/lowpoly_cat_LICENSE.txt`, exported extras
and the UI. The approved head is identified as user supplied.

## Scenic showcase: Sunlit Grove

`three/index.html` loads `park/main.js`, a visual showcase with three camera
presets, orbit controls, pause, and automatic or manual quality. The park uses
the runner's faceted appearance as its visual reference: an irregular meadow,
warm tree crowns, a lake loop, an arched timber bridge, and a pavilion. There is
no player movement or gameplay. Saved runner proportions and appearance are
retained; its original continuous skin and run clip animate along the path.

`park/world.js` loads 29 original, self-contained GLBs from `public/models/park/`.
The landscape (terrain, path, edging, paved landings and water surface), four
tree species, buildings, furniture and botanical props are all real GLB assets.
Garden geometry is authored offline; runtime effects add leaves, precipitation and a lightweight mountain backdrop. `manifest.json` supplies
placements and a pre-sampled cat route. Repeated models are instanced by spatial
cell; vertex colors and explicit face normals preserve their matte faceted look.
One directional light casts shadows; twenty lanterns glow at dusk/night. Eight
nearby point lights provide warm pools without extra shadow maps. The GLB water surface receives a moving
shader without an additional reflection pass.
Shaders are warmed before showing the scene. Reduced-motion preference starts
the scene paused; returning from a hidden tab resets frame timing.

The original asset sources are `scripts/park/architecture.mjs`, `botanical.mjs`,
`landscape.mjs` and `layout.mjs`. These are offline procedural authoring scripts,
not hand-modelled Blender files. The exporter bakes transforms, colors and flat
normals into portable GLBs that can be imported into Blender for further editing.
The kit contains 65,862 unique source triangles and about 7.2 MB of binary assets;
the rendered count also includes repeated instances and shadow passes.

```sh
npm run models:park
npm run check:park:assets
```

The asset check validates GLB containers, embedded resources, finite attributes,
unit normals, indices, nondegenerate triangles, loaded bounds and manifest data.
The cat assets and their existing third-party attribution remain separate.

`park/sky.js` adds a camera-relative sky dome with procedural drifting clouds,
a visible sunset disk, and 8,000 seeded stars with subtle twinkling and a faint
Milky Way band. Day/dusk/night buttons transition sky, fog, directional light,
ambient light, and water color together, and save `lowpoly-park-time`. Manual
time changes also work while paused; reduced motion applies them immediately.
Sky and stars use two draws, no textures or extra shadow/reflection pass. Stars
depth-test against the park so they never show through trees or buildings.

The compact controls independently select three times of day, five weather modes
(sunny, cloudy, rain, heavy rain, snow), and four seasons. Weather changes cloud
cover, fog, lighting, wind strength and GPU precipitation. Seasons recolor foliage
by species and change crown density: oak, birch and maple lose their leaves in
winter; pine remains evergreen. Fallen leaves tumble from real tree positions and
settle on sampled terrain. All motion shares the pause-aware simulation clock.
The 17,941 grass tufts cover the meadow while avoiding paths, water and props;
An opaque grass-carpet shader fills the ground without additional draws. Near
tufts use 20 triangles each; distance and quality reduce tuft counts while the
carpet remains. Snow blankets terrain and upward-facing prop surfaces, hiding
grass tufts completely at full accumulation. Weather and season choices
persist as `lowpoly-park-weather` and `lowpoly-park-season`.

Following the supplied Turbo Tails analysis, `park/quality.js` tests a lower
quality level after sustained slow frames. It retains the change only if frame
intervals improve by 15%; otherwise it restores the previous level and locks
automatic changes. Manual quality is saved separately from cat settings. Frame
intervals are not GPU timings or a guarantee of FPS on real devices.

Run the showcase checks against a running development or production server:

```sh
node scripts/check-park.mjs http://localhost:5173
node scripts/check-park-environment.mjs http://localhost:5173
```

This checks camera controls, pause, mobile layout, quality persistence, both
cat models, quality-probe rollback, time switching and persistence, reduced motion,
GLB network loading, lantern lighting, failed-model retry, and the original
benchmark route. Screenshots
go to `bench/out/`; a clean scene screenshot refreshes `public/park-preview.png`
for the home page. The new scene has a different workload and should not be used
to compare renderer performance with the reference demos.

The environment check covers all 60 season/weather/time combinations, evergreen
retention, deciduous leaf density, leaf pause/resume, precipitation density, saved
preferences and mobile controls. Set `CHROME_PATH` when using a system browser.

`park/backdrop.js` adds staggered low hills, asymmetric massifs and deep valleys
from `mountain-range.js`. Two connected waterfall ribbons follow sampled rock
shelves downhill to basins, with foam, ballistic low-poly spray and drifting mist
from `waterfall-spray.js`. The backdrop uses five draws (including two for GPU
spray/mist), and shares the pause-aware simulation clock. `shared/park-terrain.js` is shared by terrain generation and camera clearance;
orbit elevation stays above the target and the camera remains at least 1.15 units
above local terrain. Touch devices cap rendering at 30 FPS, DPR at 1.1, and shadow
refresh at 10 Hz. These reduce workload but are not a thermal guarantee on hardware.

```sh
node scripts/check-park-landscape.mjs http://localhost:5173
```

This checks reversible snow cover, grass distance detail, backdrop presence,
72 camera clearance cases, and the touch-device rendering limits.

```sh
node scripts/check-park-backdrop.mjs http://localhost:5173
```

The backdrop check validates finite terrain geometry, stream-to-terrain alignment,
GPU effect clock sharing, pause/resume, reduced particle detail, night/rain and
mobile rendering. Its screenshots are written to `bench/out/park-layered-mountains.png`
and the corresponding waterfall night/mobile files.

### 寵物照片與基底尺寸

- `photo-cat/index.html`：5 個貓基底、9 個狗基底，本機配色／部分形態適配與公尺尺度 GLB 匯出。靜態及僅配色模型各有明確控制限制。
- `photo-cat/base-catalog.html`：27 個實際下載基底（含13其他動物候選），共用公尺網格並排比較；個別尺寸可修改，預設為展示估計。
- 來源、授權、抽樣與限制：[`docs/pet-base-catalog.md`](../docs/pet-base-catalog.md)。
- 驗證：`npm run check:physical-size`、`npm run check:static-cat-bases`。

The neck finishing pass uses Blender BMesh with both attachment loops pinned.
It moves the full head and both eyes 0.032 bind-space units toward the body
and 0.004 down, lowers the nape, and tucks the underside of the middle neck
ring behind the jaw before two constrained relaxation passes. All skin and
animation buffers and standalone head files remain intact. After downloading the verified neutral runner to
`bench/out/approved-head/runner-uncolored-head.glb`, run `npm run models:cat-blend`
to save `public/models/cat/runner-neck-refined.blend`. This working file joins
and welds the exterior head/neck/body for easier sculpting; irises stay separate.

Head deformation: the approved face and irises now receive barycentric skin
weights from the original runner head surface, registered in bind space. The
neck interior uses harmonic interpolation with the head/body boundary weights
pinned exactly. This replaces the earlier single-head-bone rigid facial skin.
The original bones, inverse binds and run tracks are unchanged. Check actual
non-rigid facial edge-length changes against the original asset with
`node scripts/check-head-deformation.mjs http://localhost:5177`.

The last Blender pass uses the supplied natural-standing side illustration:
head scale 1.16/1.14/1.12, 0.018 bind-space lower-limb lift, a modest waist/belly
tuck, slightly broader paws, and tail radial scale tapering from 0.72 to 0.47
with a gentle 0.038 arc. It transforms coincident neck endpoints and morph
deltas together, preserving skin weights and every original run track.

The final continuity pass retracts the old upper-shoulder boundary, tapers the
rear skull into that boundary and relaxes the joined exterior across the former
head/neck/shoulder split. The upper haunch volume is reduced, and only its local
skin gradient is relaxed. Every original run track and inverse bind is retained.

The run skin finishing pass tucks the small tail-root underside into the pelvis
and removes tail-bone influence from that body region. This fixes the angular
flap visible below the tail during the extended run pose. A spatially tapered
head-to-neck weight transfer (at most 14%) adds subtle cheek deformation; the
shared neck boundary is pinned and the separate irises remain unchanged.
These edits live in the GLB skin, so they also survive export and photo fitting;
they add no triangles, bones, animation tracks or per-frame application work.

For animation authoring, run `npm run models:cat-editable-rig` after exporting
the verified neutral runner to `bench/out/approved-head/runner-uncolored-head.glb`.
This saves `public/models/cat/runner-editable-rig.blend`. The import uses the
GLB's default pose instead of guessing the bind pose. All 35 bones remain;
ear, paw and tail chains are fitted inside the approved model, including the
previously misplaced terminal markers. Changing bone rest frames is compensated
by rebasing the run matrices, then baking at 192 Hz and comparing the evaluated
surface at independent subframes. Mesh coordinates, weights and facial shape
keys are retained; the exterior is welded for editing as in the previous blend.
The `run` action is active on opening. This editable conversion does not overwrite
the production GLB or the approved source head. Validation is saved alongside
the skeleton screenshots in `bench/out/approved-head/skeleton-refined/`.

Then run `npm run models:cat-connected-rig` for the connected-limb editing
file, `public/models/cat/runner-connected-rig.blend`. It adds four shoulder/hip
bones and twelve short joint connectors to the fitted 35-bone rig (51 total).
The front limbs now descend through the shoulders from the chest; the hind
limbs descend through the hips from the pelvis. Connected knee, ankle and paw
junctions also remain joined through the run. Connectors carry no mesh weights;
their animated lengths accommodate the retained motion, while child transforms
compensate for the new parenting. Geometry, weights and the production GLB are
unchanged. The conversion compares 576 independent subframes against the prior
Blender file and checks both ends of every new connector. Run
`npm run check:cat-connected-rig` to check 122 poses for bone centerlines outside
the evaluated skin. Reports and screenshots are in
`bench/out/approved-head/skeleton-connected/`.

Finally, `npm run models:cat-ear-controls` creates the current authoring file,
`public/models/cat/runner-ear-controls.blend` (53 bones). Two head-to-ear mounts
connect each ear root to the head. Former ear terminal bones become weighted
upper-ear segments. The original ears follow the head throughout the run;
redistributing their broad facial influence to the head and restricting new
ear weights to the ear region preserves the run while isolating expressions.
Mesh coordinates and shape keys remain unchanged. The builder validates 241
run samples, neutral geometry, independent ears and expressions during running.

Select `Cat Rig`, then Object Properties > Custom Properties. Keyframe the six
degree-valued properties `ear_spread_L/R`, `ear_tilt_L/R`, `ear_fold_L/R`.
Spread opens outward, positive tilt points forward, negative tilt points back,
and fold bends the upper ear. Zero restores the approved neutral ears.
Suggested values for each ear, in spread/tilt/fold order:

| Pose | Spread | Tilt | Fold |
| --- | ---: | ---: | ---: |
| Neutral | 0 | 0 | 0 |
| Airplane | 55 | -10 | 18 |
| Forward | 5 | 25 | 0 |
| Back | 20 | -35 | 10 |

These are example poses, not collision constraints for arbitrary combinations.
The blend includes the same instructions in `EAR CONTROLS - READ ME`.
`npm run check:cat-ear-controls` checks bone centerlines in 140 neutral, run
and expression poses. Reports and Blender screenshots are in
`bench/out/approved-head/ear-controls/`.

Publish this approved authoring file with `npm run models:cat-base`. The runtime
GLB uses metres, Y-up and +Z forward, so the former FBX basis/scale repair is no
longer applied. Blender's unweighted connectors use `inherit_scale=NONE` for
their children; glTF cannot encode that setting. The export retains every joint
and bakes child transforms from evaluated world poses while removing editor-only
connector stretch. A 384 Hz bake retains the run; 26 independent neutral/run
samples compare the exported surface against Blender (maximum error below
0.004 mm). Facial morphs remain user-controlled instead of being reset by
constant animation tracks. Six ear drivers remain editable in the blend;
the GLB contains the neutral-ear run and ear joints, not Blender driver logic.
Reports are in `bench/out/cat-base/`; `npm run check:cat -- http://localhost:5177`
also verifies browser customization, seams, photo facet colors and GLB download.
