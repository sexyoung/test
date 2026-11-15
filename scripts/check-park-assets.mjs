// Validate the shipped assets, independent of the authoring script and renderer.
// Usage: node scripts/check-park-assets.mjs [public/models/park]
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const directory = path.resolve(process.argv[2] || 'public/models/park');
const componentTypes = {
  5120: [1, 'getInt8'], 5121: [1, 'getUint8'], 5122: [2, 'getInt16'],
  5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'],
};
const typeSizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function parseGlb(bytes, label) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${label}: GLB magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${label}: GLB version`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${label}: container length`);
  let offset = 12, document, binary;
  while (offset < bytes.length) {
    assert.ok(offset + 8 <= bytes.length, `${label}: truncated chunk header`);
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    assert.equal(length % 4, 0, `${label}: chunk alignment`);
    assert.ok(offset + 8 + length <= bytes.length, `${label}: chunk length`);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) {
      assert.equal(offset, 12, `${label}: JSON is first chunk`);
      assert.equal(document, undefined, `${label}: duplicate JSON chunk`);
      document = JSON.parse(chunk.toString('utf8'));
    } else if (type === 0x004e4942) {
      assert.equal(binary, undefined, `${label}: duplicate BIN chunk`);
      binary = chunk;
    }
    offset += 8 + length;
  }
  assert.ok(document && binary, `${label}: JSON and BIN required`);
  assert.equal(document.asset.version, '2.0');
  assert.equal(document.buffers?.length, 1, `${label}: one embedded buffer`);
  assert.equal(document.buffers[0].uri, undefined, `${label}: no external buffer`);
  assert.ok(binary.length >= document.buffers[0].byteLength && binary.length <= document.buffers[0].byteLength + 3);
  for (const image of document.images || []) assert.equal(image.uri, undefined, `${label}: no external image`);
  for (const view of document.bufferViews || []) {
    assert.equal(view.buffer, 0, `${label}: buffer view references embedded buffer`);
    assert.ok((view.byteOffset || 0) >= 0 && view.byteLength > 0);
    assert.ok((view.byteOffset || 0) + view.byteLength <= document.buffers[0].byteLength, `${label}: buffer view bounds`);
  }
  return { document, binary };
}

function accessorReader(document, binary, index, label) {
  const accessor = document.accessors?.[index];
  assert.ok(accessor, `${label}: missing accessor ${index}`);
  assert.equal(accessor.sparse, undefined, `${label}: shipped assets use dense accessors`);
  const view = document.bufferViews?.[accessor.bufferView];
  assert.ok(view, `${label}: missing buffer view`);
  const spec = componentTypes[accessor.componentType], components = typeSizes[accessor.type];
  assert.ok(spec && components, `${label}: supported accessor format`);
  const [bytes, method] = spec, stride = view.byteStride || bytes * components;
  assert.ok(Number.isInteger(accessor.count) && accessor.count > 0, `${label}: accessor count`);
  assert.ok(stride >= bytes * components && stride % bytes === 0, `${label}: accessor stride`);
  const start = accessor.byteOffset || 0;
  assert.ok(start + (accessor.count - 1) * stride + components * bytes <= view.byteLength, `${label}: accessor exceeds buffer view`);
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const read = (i, c) => data[method]((view.byteOffset || 0) + start + i * stride + c * bytes, true);
  for (let i = 0; i < accessor.count; i++) for (let c = 0; c < components; c++) {
    assert.ok(Number.isFinite(read(i, c)), `${label}: non-finite accessor ${index}, item ${i}`);
  }
  return { accessor, components, read };
}

function validateGeometry(document, binary, label) {
  const readers = new Map();
  const read = index => {
    if (!readers.has(index)) readers.set(index, accessorReader(document, binary, index, label));
    return readers.get(index);
  };
  let triangles = 0, primitives = 0, vertices = 0;
  for (const mesh of document.meshes || []) for (const primitive of mesh.primitives) {
    primitives++;
    assert.equal(primitive.mode ?? 4, 4, `${label}: triangle primitives only`);
    assert.ok(document.materials?.[primitive.material], `${label}: primitive material exists`);
    const positions = read(primitive.attributes.POSITION), normals = read(primitive.attributes.NORMAL);
    assert.equal(positions.components, 3); assert.equal(normals.components, 3);
    const count = positions.accessor.count; vertices += count;
    assert.equal(normals.accessor.count, count, `${label}: normal count`);
    for (const index of Object.values(primitive.attributes)) assert.equal(read(index).accessor.count, count, `${label}: attribute count`);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++) { const value = positions.read(i, c); min[c] = Math.min(min[c], value); max[c] = Math.max(max[c], value); }
      if (normals.accessor.componentType === 5126) {
        const length = Math.hypot(normals.read(i, 0), normals.read(i, 1), normals.read(i, 2));
        assert.ok(Math.abs(length - 1) < .02, `${label}: non-unit normal ${i}: ${length}`);
      }
    }
    for (let c = 0; c < 3; c++) {
      assert.ok(Math.abs(min[c]) < 2000 && Math.abs(max[c]) < 2000, `${label}: sensible geometry extent`);
      assert.ok(Math.abs(min[c] - positions.accessor.min[c]) < 1e-4 && Math.abs(max[c] - positions.accessor.max[c]) < 1e-4, `${label}: position min/max metadata`);
    }
    const indices = primitive.indices === undefined ? null : read(primitive.indices);
    if (indices) assert.ok([5121, 5123, 5125].includes(indices.accessor.componentType) && indices.components === 1, `${label}: unsigned scalar indices`);
    const indexCount = indices ? indices.accessor.count : count;
    assert.equal(indexCount % 3, 0, `${label}: complete triangles`);
    triangles += indexCount / 3;
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    const point = (v, i) => {
      const vertex = indices ? indices.read(i, 0) : i;
      assert.ok(vertex >= 0 && vertex < count && Number.isInteger(vertex), `${label}: vertex index ${vertex}`);
      return v.set(positions.read(vertex, 0), positions.read(vertex, 1), positions.read(vertex, 2));
    };
    for (let i = 0; i < indexCount; i += 3) {
      point(a, i); point(b, i + 1); point(c, i + 2);
      const areaSquared = b.sub(a).cross(c.sub(a)).lengthSq();
      assert.ok(areaSquared > 1e-18, `${label}: degenerate triangle ${i / 3} in ${mesh.name}`);
    }
  }
  assert.ok(triangles > 0 && primitives > 0, `${label}: nonempty geometry`);
  return { triangles, primitives, vertices };
}

const files = (await readdir(directory)).filter(file => file.endsWith('.glb')).sort();
assert.ok(files.length > 0, `No GLB assets in ${directory}`);
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
assert.equal(manifest.version, 1, 'Manifest version');
assert.deepEqual(Object.values(manifest.assets).map(asset => asset.file).sort(), files, 'Manifest covers exactly the shipped GLBs');
assert.equal(manifest.route.length, 320 * 4, 'Route has 320 samples of x/y/z/heading');
assert.ok(manifest.route.every(Number.isFinite), 'Finite route samples');
assert.ok(Number.isFinite(manifest.routeLength) && manifest.routeLength > 20, 'Route length');
for (const [asset, placements] of Object.entries(manifest.placements)) {
  assert.ok(manifest.assets[asset], `Placement references missing asset ${asset}`);
  for (const placement of placements) {
    assert.equal(placement.length, 5, `${asset}: placement x/y/z/yaw/scale`);
    assert.ok(placement.every(Number.isFinite), `${asset}: finite placement`);
    assert.ok(placement[4] > 0 && placement[4] < 100, `${asset}: positive scale`);
  }
}
const results = [];
for (const file of files) {
  const bytes = await readFile(path.join(directory, file));
  const { document, binary } = parseGlb(bytes, file);
  const census = validateGeometry(document, binary, file);
  const entry = Object.entries(manifest.assets).find(([, asset]) => asset.file === file);
  const [assetName, expected] = entry;
  assert.equal(bytes.length, expected.bytes, `${file}: manifest byte count`);
  assert.equal(census.triangles, expected.triangles, `${file}: manifest triangle count`);
  const imported = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  assert.ok(imported.scene.children.length > 0, `${file}: named scene roots`);
  for (const root of imported.scene.children) assert.ok(root.name.length > 0, `${file}: root name`);
  assert.ok(imported.scene.getObjectByName(assetName), `${file}: asset root name ${assetName}`);
  imported.scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(imported.scene);
  assert.ok(!bounds.isEmpty() && [...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite), `${file}: finite world bounds`);
  const size = bounds.getSize(new Vector3());
  assert.ok(size.length() > .001 && size.length() < 2000, `${file}: world size`);
  for (const side of ['min', 'max']) for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(bounds[side].getComponent(axis) - expected.bounds[side][axis]) < 1e-4, `${file}: manifest ${side} bound`);
  }
  results.push({ file, bytes: bytes.length, ...census, materials: document.materials.length, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } });
}
console.log(JSON.stringify({
  assets: results,
  totals: results.reduce((sum, asset) => ({ files: sum.files + 1, bytes: sum.bytes + asset.bytes, triangles: sum.triangles + asset.triangles }), { files: 0, bytes: 0, triangles: 0 }),
}, null, 2));
