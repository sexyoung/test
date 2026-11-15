# Sunlit Grove — original GLB garden kit

These scene assets were authored for this project with the offline scripts in
`scripts/park/` and exported by `node scripts/make-park-glb.mjs`. They are original
project geometry, not downloaded third-party models or exports of the previous park.
The separately supplied cat models retain their own attribution/license files.

All files are self-contained glTF 2.0 binary assets, Y-up, with meter-like scene units,
explicit normals, matte vertex colors, and no texture dependencies. Props have ground
origins; landscape is in world coordinates. The lantern has a separate emissive pane
material. The landscape includes the lake surface; its moving water shader and the
procedural sky/stars are runtime effects.

The manifest contains bounds, triangle counts, byte lengths, placements and the cat
route. Models can be imported into Blender or another glTF editor. Run
`node scripts/check-park-assets.mjs` after regenerating assets.
