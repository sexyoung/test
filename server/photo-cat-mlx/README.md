# Optional local photo-to-shape research backend

This is an **experimental static shape generator**, separate from the app's template-based, skinned cat workflow. It does not create bones, weights, animation, or an identity-accurate unseen back side. A single image cannot determine occluded legs, hidden markings, or depth reliably. The browser's existing runner template remains the primary animation workflow.

## Run on an Apple Silicon Mac

```sh
python3 server/photo-cat-mlx/setup.py
node server/photo-cat-mlx/server.mjs
```

The installer creates an isolated Python 3.12 environment and caches a pinned upstream runtime plus 3.82 GB shape checkpoint under `~/Library/Caches/sunlit-photo-cat-mlx`. It verifies the checkpoint SHA256. `PHOTO_CAT_MLX_CACHE` overrides that directory. Photos are processed locally; no API key is needed. Initial dependency/model downloads need internet. Background removal downloads the small U2NetP model on its first use; a corrected transparent PNG bypasses that step.

The server binds only `127.0.0.1:8790`; generation starts only with an explicit POST. It accepts localhost browser origins and runs one job at a time.

- `GET /health`: `{ready,busy,backend,cloud:false}`. Ready means dependencies and weights installed, not that all inputs produce acceptable meshes.
- `POST /jobs`: raw PNG, JPEG, or WebP body, matching `Content-Type`, maximum 20 MiB; returns `202 {id,status}`. Busy returns409; missing installation503.
- `GET /jobs/:id`: status `running`, `complete`, or `failed`, bounded log, metadata, and completed model URL.
- `GET /jobs/:id/model.glb`: completed GLB. The API accepts no filesystem paths. Uploaded pixels are limited to16 megapixels, dimensions at least32px per side.

CLI example (use the installed environment):

```sh
~/Library/Caches/sunlit-photo-cat-mlx/venv/bin/python server/photo-cat-mlx/run.py cat.png --out /tmp/cat.glb --project-colors
```

Optional photo coloring is a simple canonical front-view projection. Unseen surfaces receive the median foreground color. This is neither learned texture synthesis nor recovered hidden markings. Metadata states this approximation and `rigged:false`.

## Actual validation on this Mac

Tested on Apple M4 Pro,24 GB unified RAM, macOS26.5.2 with Python3.12.16 and MLX0.31.2. Native MLX GPU arithmetic passed. Native Swift was unsuitable because this machine has Command Line Tools but no Xcode Metal compiler; the upstream Python MLX reference port runs with prebuilt Metal wheels.

A real Alfie cat photograph was segmented locally, then processed with the public Hunyuan3D-2mini checkpoint,4-bit DiT/DINO, fp16 VAE,30 steps, seed0, octree192. The first run measured25.7 seconds denoising,9.2 seconds VAE decoding,36.5 seconds total inference (excluding imports, checkpoint loading and segmentation). It generated158,184 faces. The principal surface had157,360 faces and was connected and watertight;30 tiny disconnected fragments accounted for824 faces.

**The low-poly export did not pass validation.** Quadric simplification to6,000,12,000 and20,000 faces introduced nonmanifold edges. A conservative diagnostic simplification preserved a closed, connected surface but retained147,974 faces, so it was not a low-poly result. The adapter correctly rejects invalid output instead of exporting it as seamless. A two-view diagnostic render also failed visual resemblance: the result was a broad irregular slab rather than a recognizable cat. This test establishes that the inference code executes locally, not that this pinned configuration produces a usable cat or satisfies the animated low-poly requirement.

The adapter only discards disconnected noise when its combined faces are at most2% of the generated mesh; substantial disconnected parts are rejected. It removes degenerate/duplicate faces, fills only simple triangle/quad holes, and requires exactly one component, no boundary edges, and no nonmanifold edges. Visual resemblance and suitable animation topology remain separate checks.

For evaluation, use at least two different real cats with the same seed; compare geometry and source hashes, input-facing silhouette, ears/muzzle proportions and markings, then inspect an eight-view turntable. Validate exported GLB loading, finite coordinates, connectivity and boundary counts. Do not treat a perceptual image score as proof of identity. For animation, separately inspect skeleton retention, skin weights and deformation at joints; this backend does not provide them.

## Source selection and license

- [TripoSR](https://github.com/VAST-AI-Research/TripoSR): MIT, official default inference6 GB CUDA. Its [runner](https://github.com/VAST-AI-Research/TripoSR/blob/main/run.py) selects CPU when CUDA is unavailable; it is not the chosen native Apple GPU path.
- [Stable Fast3D](https://github.com/Stability-AI/stable-fast-3d): experimental MPS support; the README recommends CPU below32 GB RAM. Model download is gated and requires accepting the model terms and authentication. Uses the Stability community license.
- [Hunyuan3D-Swift](https://github.com/ZimengXiong/Hunyuan3D-Swift), [Python MLX reference](https://github.com/ZimengXiong/Hunyuan3D-Swift/tree/main/python/shape): native Apple GPU shape inference without PyTorch in the inference path. Pinned runtime commit `292331f4d26ddb80b9dcea6bcb5629ff82f12b82`; source MIT.
- [Small shape checkpoint](https://huggingface.co/zimengxiong/hunyuan3d-mlx-shape-small): public ungated official2mini tensor repack,3,819,958,234-byte checkpoint. SHA256 `3cc66f3bea33e4062b7dbc875ffe1d70c4888914aec3e91b60f94e9bd01b522b`.
- [Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1): official full pipeline requires29 GB VRAM. Full paint weights were not installed on this24 GB machine.

**Powered by Tencent Hunyuan.** The model weights use the [Tencent Hunyuan3D-2 Community License](https://huggingface.co/tencent/Hunyuan3D-2/blob/main/LICENSE), not MIT. The installer keeps a copy beside the weights. Its territory excludes the EU, UK and South Korea, and it imposes distribution, attribution and other conditions. This local research adapter is not presented as deployment-ready. Tencent does not sponsor or endorse this project. Review the exact model license and actual service-provider disclosure requirements before offering this capability to others.
