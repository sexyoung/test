// Validate static-source Pomeranian, independently of the animated dog templates.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {basename} from 'node:path';
import {Box3,Texture,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {chromium} from 'playwright-core';
const arg=n=>{const i=process.argv.indexOf(n);return i<0?null:process.argv[i+1];};
const isPersian=arg('--model')==='persian',expectedTriangles=isPersian?7646:500,expectedComponents=isPersian?4:1;
const dir=isPersian?'/tmp/photo-persian-validation':'/tmp/photo-pomeranian-validation';await mkdir(dir,{recursive:true});
const stem=arg('--glb')?basename(arg('--glb'),'.glb'):isPersian?'persian-shape-extremes':'pomeranian-shape-extremes';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
let bytes,controlChecks;
try{
const page=await browser.newPage({viewport:{width:800,height:650}});await page.goto(arg('--url')||'http://localhost:5176');
if(arg('--glb'))bytes=await readFile(arg('--glb'));
else{
const generated=await page.evaluate(async isPersian=>{
 const createTemplatePomeranian=isPersian?(await import('/demos/photo-cat/template-persian-cat.js')).createTemplatePersianCat:(await import('/demos/photo-cat/template-pomeranian.js')).createTemplatePomeranian;const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');
 const base={species:isPersian?'cat':'dog',baseModel:isPersian?'persian':'pomeranian',pattern:'bicolor',colors:{baseColor:'#b27845',secondaryColor:'#e5dbcc',noseColor:'#252322'}};
 const positions=root=>{const a=[];root.traverse(m=>{if(m.isMesh)a.push(...m.geometry.attributes.position.array);});return a;};
 const keys=['earLength','earWidth','earSpread','skullDepth','cheekWidth','muzzleWidth'],baseline=positions(await createTemplatePomeranian(base));
 const neutral=positions(await createTemplatePomeranian({...base,shape:Object.fromEntries(keys.map(k=>[k,1]))}));
 if(baseline.some((x,i)=>x!==neutral[i]))throw Error('Explicit neutral differs from omitted controls');
 const checks={neutralMatchesOmitted:true,individual:{}};
 for(const key of keys){const p=positions(await createTemplatePomeranian({...base,shape:{[key]:1.3}}));const delta=Math.max(...p.map((x,i)=>Math.abs(x-baseline[i])));if(!(delta>1e-7))throw Error('Ineffective '+key);checks.individual[key]=delta;}
 let samples=0;const root=await createTemplatePomeranian({...base,shape:{headWidth:1.4,headHeight:.7,muzzleLength:.7,earLength:1.4,earWidth:1.4,earSpread:1.3,skullDepth:.7,cheekWidth:1.4,muzzleWidth:.7,bodyWidth:1.3,furLength:1.2},sampleFace:(u,v)=>{samples++;return u<.5?[180,120,60]:[230,220,200];}});
 if(samples!==64)throw Error('Coarse coat sampler count changed');
 const data=new Uint8Array(await new GLTFExporter().parseAsync(root,{binary:true,animations:root.animations,onlyVisible:false}));let text='';for(let i=0;i<data.length;i+=32768)text+=String.fromCharCode(...data.subarray(i,i+32768));return{base64:btoa(text),checks};
},isPersian);bytes=Buffer.from(generated.base64,'base64');controlChecks=generated.checks;
}
await writeFile(`${dir}/${stem}.glb`,bytes);bytes=await readFile(`${dir}/${stem}.glb`);
const doc=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));assert.equal(doc.buffers[0].uri,undefined);for(const image of doc.images||[]){assert.equal(image.uri,undefined);assert.ok(Number.isInteger(image.bufferView));}assert.equal(doc.skins?.length||0,0);assert.equal(doc.animations?.length||0,0);
const ab=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),loader=new GLTFLoader().register(()=>({name:'StructuralTextureStub',loadTexture:()=>Promise.resolve(new Texture())})),source=await loader.parseAsync(ab(await readFile(isPersian?'public/models/cat/persian.glb':'public/models/dog/pomeranian.glb')),''),result=await loader.parseAsync(ab(bytes),'');
const meshes=r=>{const a=[];r.traverse(m=>{if(m.isMesh)a.push(m);});return a;},original=meshes(source.scene),modified=meshes(result.scene);assert.equal(modified.length,original.length);
const meta=result.scene.children[0].userData;assert.equal(meta.staticTemplate,true);assert.equal(meta.animationAvailable,false);assert.equal(meta.sourcePixelsEmbedded,false);assert.equal(meta.stylizedFacePaint,true);assert.equal(result.animations.length,0);
let physicalSize;
if(meta.physicalSize||arg('--height-cm')){
 assert.ok(meta.physicalSize);result.scene.updateMatrixWorld(true);const s=new Box3().setFromObject(result.scene,true).getSize(new Vector3()),axis=meta.physicalSize.axis,meters=axis==='longest'?Math.max(s.x,s.y,s.z):s[axis];
 if(arg('--height-cm')){assert.equal(axis,'y');assert.equal(meta.physicalSize.centimeters,Number(arg('--height-cm')));}
 assert.ok(Math.abs(meters-meta.physicalSize.centimeters/100)<2e-5);physicalSize={...meta.physicalSize,observedMeters:meters};
}

let triangles=0,duplicateChecks=0,maxSeparation=0,minAreaRatio=Infinity;const topology=[];
for(let m=0;m<original.length;m++){
 const a=original[m].geometry,b=modified[m].geometry,p=a.attributes.position,q=b.attributes.position;assert.equal(p.count,q.count);assert.deepEqual(a.index?Array.from(a.index.array):null,b.index?Array.from(b.index.array):null);assert.ok(Array.from(q.array).every(Number.isFinite));assert.ok(Array.from(b.attributes.color.array).every(Number.isFinite));
 const groups=new Map(),ids=[],parents=[],edges=new Map();for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v/1e-5)).join(',');if(!groups.has(key)){groups.set(key,[]);parents.push(parents.length);}groups.get(key).push(i);}
 const vertexIds=new Map();[...groups.values()].forEach((vertices,i)=>vertices.forEach(v=>vertexIds.set(v,i)));const find=i=>parents[i]===i?i:parents[i]=find(parents[i]);
 const va=new Vector3(),vb=new Vector3(),vc=new Vector3(),ta=new Vector3(),tb=new Vector3(),tc=new Vector3();
 for(const vertices of groups.values())for(const i of vertices.slice(1)){maxSeparation=Math.max(maxSeparation,va.fromBufferAttribute(q,vertices[0]).distanceTo(vb.fromBufferAttribute(q,i)));duplicateChecks++;}
 const count=a.index?.count||p.count;triangles+=count/3;for(let i=0;i<count;i+=3){const v=[0,1,2].map(k=>a.index?a.index.getX(i+k):i+k),w=v.map(i=>vertexIds.get(i));parents[find(w[0])]=find(w[1]);parents[find(w[1])]=find(w[2]);for(let j=0;j<3;j++){const key=[w[j],w[(j+1)%3]].sort((a,b)=>a-b).join(',');edges.set(key,(edges.get(key)||0)+1);}
 va.fromBufferAttribute(p,v[0]);vb.fromBufferAttribute(p,v[1]);vc.fromBufferAttribute(p,v[2]);ta.fromBufferAttribute(q,v[0]);tb.fromBufferAttribute(q,v[1]);tc.fromBufferAttribute(q,v[2]);const sa=vb.sub(va).cross(vc.sub(va)).length(),qa=tb.sub(ta).cross(tc.sub(ta)).length();if(sa>1e-12){const ratio=qa/sa;assert.ok(ratio>1e-6,'No originally valid triangle collapsed');minAreaRatio=Math.min(minAreaRatio,ratio);}}
 const t={components:new Set(parents.map((_,i)=>find(i))).size,boundaryEdges:[...edges.values()].filter(n=>n===1).length,nonmanifold:[...edges.values()].filter(n=>n>2).length};assert.deepEqual(t,{components:expectedComponents,boundaryEdges:0,nonmanifold:0});topology.push(t);
}
assert.equal(triangles,expectedTriangles);assert.ok(duplicateChecks>0);assert.equal(maxSeparation,0,'Shared facet corners remain joined');
const rendered=await page.evaluate(async base64=>{const T=await import('/node_modules/three/build/three.module.js');const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');const data=Uint8Array.from(atob(base64),x=>x.charCodeAt(0)),g=await new GLTFLoader().parseAsync(data.buffer,'');const scene=new T.Scene();scene.background=new T.Color('#e7edf2');scene.add(g.scene,new T.HemisphereLight(0xffffff,0x696969,3));const box=new T.Box3().setFromObject(g.scene),center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3()).length();const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(800,650);document.body.replaceChildren(renderer.domElement);const camera=new T.PerspectiveCamera(35,800/650,.01,1000);camera.position.copy(center).add(new T.Vector3(size*.8,size*.3,size*.9));camera.lookAt(center);renderer.render(scene,camera);const palette=new Set();g.scene.traverse(m=>{if(m.isMesh&&m.material.map){const im=m.material.map.image,c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;for(let i=0;i<d.length;i+=4)palette.add('#'+[d[i],d[i+1],d[i+2]].map(x=>x.toString(16).padStart(2,'0')).join(''));}});return{triangles:renderer.info.render.triangles,palette:[...palette]};},bytes.toString('base64'));assert.equal(rendered.triangles,expectedTriangles);assert.ok(rendered.palette.length<=10);for(const c of rendered.palette)assert.ok(meta.facePaintPalette.includes(c),'Every embedded pixel uses authored palette');await page.screenshot({path:`${dir}/${stem}.png`});
const report={physicalSize,input:arg('--glb')||'browser createTemplatePomeranian',triangles,staticTemplate:true,bones:0,animations:0,sourcePixelsEmbedded:false,controlChecks,duplicateChecks,maxSeparation,minAreaRatio,topology,renderedTriangles:rendered};await writeFile(`${dir}/${stem}.report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
