// Keep the standard glTF skeleton while exposing photo-adapter coordinates.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Matrix4,Vector3,Quaternion} from 'three';
const path='public/models/cat/runner-base.glb';
const bytes=await readFile(path),length=bytes.readUInt32LE(12);
const g=JSON.parse(bytes.subarray(20,20+length));
let bin=Buffer.from(bytes.subarray(28+length));
const transform=new Matrix4().set(0,0,1,0, 0,1,0,-.013619639910757542, 1,0,0,0, 0,0,0,1);
const inverse=transform.clone().invert(),done=new Set();
function edit(index,fn){
  if(done.has(index))return;done.add(index);
  const a=g.accessors[index],v=g.bufferViews[a.bufferView];
  if(a.componentType!==5126)throw new Error('Expected float attribute');
  const width={VEC3:3,MAT4:16}[a.type],stride=v.byteStride||width*4;
  const min=Array(width).fill(Infinity),max=Array(width).fill(-Infinity);
  for(let i=0;i<a.count;i++){
    const start=(v.byteOffset||0)+(a.byteOffset||0)+i*stride;
    const values=fn(Array.from({length:width},(_,j)=>bin.readFloatLE(start+j*4)));
    values.forEach((x,j)=>{bin.writeFloatLE(x,start+j*4);min[j]=Math.min(min[j],x);max[j]=Math.max(max[j],x);});
  }
  if(a.min)a.min=min;if(a.max)a.max=max;
}
const direction=v=>[v[2],v[1],v[0]];
for(const m of g.meshes)for(const p of m.primitives){
  delete p.attributes.TEXCOORD_0;
  edit(p.attributes.POSITION,v=>new Vector3(...v).applyMatrix4(transform).toArray());
  if(p.attributes.NORMAL!==undefined)edit(p.attributes.NORMAL,direction);
  for(const t of p.targets||[])for(const semantic of ['POSITION','NORMAL'])if(t[semantic]!==undefined)edit(t[semantic],direction);
}
function accessor(values,type){
  const data=Buffer.alloc(values.length*4);values.forEach((v,i)=>data.writeFloatLE(v,i*4));
  const view=g.bufferViews.push({buffer:0,byteOffset:bin.length,byteLength:data.length})-1;
  bin=Buffer.concat([bin,data]);const width={SCALAR:1,VEC3:3,VEC4:4,MAT4:16}[type];
  const a={bufferView:view,componentType:5126,count:values.length/width,type};
  if(type==='SCALAR'){a.min=[Math.min(...values)];a.max=[Math.max(...values)];}
  return g.accessors.push(a)-1;
}
const bake=JSON.parse(await readFile('bench/out/cat-base/skeleton-bake.json'));
const byName=new Map(bake.bones.map((b,i)=>[b.name,{...b,i,matrix:new Matrix4().fromArray(b.rest)}]));
const nodeIndices=new Map(g.nodes.map((n,i)=>[n.name,i]));
const rig=g.nodes.find(n=>n.name==='Cat Rig');
delete rig.matrix;delete rig.rotation;delete rig.translation;delete rig.scale;
const clip={name:'run',samplers:[],channels:[]};
const time=accessor(bake.frames.map((_,i)=>i/bake.fps),'SCALAR');
for(const b of bake.bones){
  const nodeIndex=nodeIndices.get(b.name),node=g.nodes[nodeIndex],data=byName.get(b.name);
  const local=b.parent?byName.get(b.parent).matrix.clone().invert().multiply(data.matrix):data.matrix;
  const p=new Vector3(),q=new Quaternion(),s=new Vector3();local.decompose(p,q,s);
  delete node.matrix;node.translation=p.toArray();node.rotation=q.toArray();node.scale=s.toArray();
  for(const [component,path,type] of [[0,'translation','VEC3'],[1,'rotation','VEC4'],[2,'scale','VEC3']]){
    const values=[];let previous;
    for(const frame of bake.frames){
      let v=frame[data.i][component];
      if(component===1&&previous&&v.reduce((sum,x,j)=>sum+x*previous[j],0)<0)v=v.map(x=>-x);
      values.push(...v);previous=v;
    }
    const output=accessor(values,type),sampler=clip.samplers.push({input:time,output,interpolation:'LINEAR'})-1;
    clip.channels.push({sampler,target:{node:nodeIndex,path}});
  }
}
for(const skin of g.skins){
  skin.inverseBindMatrices=accessor(skin.joints.flatMap(i=>byName.get(g.nodes[i].name).matrix.clone().invert().multiply(inverse).toArray()),'MAT4');
}
g.animations=[clip];
// Preserve semantic regions used by the photo tool while the authoring mesh
// stays welded. Each primitive shares exactly the same skin and seam weights.
for(const node of [...g.nodes]){
  const mesh=g.meshes[node.mesh];if(!mesh||mesh.primitives.length===1)continue;
  node.children=[];
  for(const p of mesh.primitives){
    const material=g.materials[p.material].name;
    const part=material==='Scene_-_Root'?'body':material==='Scene_-_Root.001'?'neck':'surface';
    const name={body:'Object_9',neck:'Approved_Neck_Seam',surface:'Approved_Head'}[part];
    const mi=g.meshes.push({...mesh,name,primitives:[p]})-1;
    const ni=g.nodes.push({name,mesh:mi,skin:node.skin,extras:{...node.extras,headPart:part,approvedCatHead:part==='surface',approvedHeadNeck:part==='neck'}})-1;
    node.children.push(ni);
  }
  delete node.mesh;delete node.skin;
}
g.buffers[0].byteLength=bin.length;
g.asset.extras={...g.asset.extras,baseVersion:'cat-ear-rig-v1',authoringFile:'runner-ear-controls.blend'};
let json=Buffer.from(JSON.stringify(g));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);
const result=Buffer.concat([header,json,bh,bin]);await writeFile(path,result);
const manifestPath='public/models/cat/runner-base.json',manifest=JSON.parse(await readFile(manifestPath));
manifest.runtimeSHA256=createHash('sha256').update(result).digest('hex');
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(`Published ${path}: ${result.length} bytes, ${g.skins[0].joints.length} joints`);
