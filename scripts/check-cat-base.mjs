import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {AnimationMixer,Vector3} from 'three';
const dir='bench/out/cat-base';
const bytes=await readFile('public/models/cat/runner-base.glb');
const manifest=JSON.parse(await readFile('public/models/cat/runner-base.json'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.runtimeSHA256);
assert.equal(createHash('sha256').update(await readFile('public/models/cat/'+manifest.authoringFile)).digest('hex'),manifest.authoringSHA256);
const g=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const meshes=[],bones=[];g.scene.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);if(o.isBone)bones.push(o);});
assert.equal(bones.length,53);assert.equal(g.animations.length,1);assert.equal(g.animations[0].duration,1.5);
assert.equal(meshes.reduce((n,m)=>n+m.geometry.index.count/3,0),1550);
for(const side of ['L','R']){
  const root=bones.find(b=>b.name===`ear_root${side}`||b.name===`ear_root_${side}`||b.name===`ear_root.${side}`);
  assert.ok(root,'Ear root retained');assert.ok(root.parent.name.startsWith('ear_mount'));
  assert.ok(root.children.some(b=>b.name.startsWith('ear_body')));
}
const mixer=new AnimationMixer(g.scene),action=mixer.clipAction(g.animations[0]);
const rest=bones.map(b=>({b,p:b.position.clone(),q:b.quaternion.clone(),s:b.scale.clone()}));
const samples=JSON.parse(await readFile(`${dir}/blender-reference.json`));
const p=new Vector3();let maximum=0;
const results=[];
for(const sample of samples){
  if(sample.time===null){action.stop();for(const {b,p,q,s} of rest){b.position.copy(p);b.quaternion.copy(q);b.scale.copy(s);}}
  else{action.play();mixer.setTime(sample.time);}
  g.scene.updateMatrixWorld(true);
  let error=0;
  for(const m of meshes)for(let i=0;i<m.geometry.attributes.position.count;i++){
    m.getVertexPosition(i,p).applyMatrix4(m.matrixWorld);
    let distance=Infinity;
    for(const v of sample.vertices){const d=(p.x-v[0])**2+(p.y-v[1])**2+(p.z-v[2])**2;if(d<distance)distance=d;}
    error=Math.max(error,Math.sqrt(distance));
  }
  maximum=Math.max(maximum,error);results.push({time:sample.time,errorMeters:error});
}
const report={bones:bones.length,meshes:meshes.length,triangles:1550,animations:1,duration:1.5,maxSurfaceErrorMeters:maximum,samples:results};
await writeFile(`${dir}/roundtrip.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
assert.ok(maximum<.0001,`GLB differs from Blender by ${maximum} metres`);
