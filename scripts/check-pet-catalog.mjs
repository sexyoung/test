// Read catalog declarations and exercise the same raw-source calibration/export path.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
const arg=n=>{const i=process.argv.indexOf(n);return i<0?null:process.argv[i+1];};
const rows=JSON.parse(await readFile('demos/photo-cat/base-catalog.json'));
const items=arg('--id')?rows.filter(r=>r.id===arg('--id')):rows;assert.ok(items.length);
const directory='/tmp/pet-catalog-validation';await mkdir(directory,{recursive:true});
for(const item of items){const bytes=await readFile(resolve('public',item.url.replace('../../',''))),doc=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));const tris=(doc.meshes||[]).flatMap(m=>m.primitives).reduce((n,p)=>n+doc.accessors[p.indices??p.attributes.POSITION].count/3,0);assert.equal(tris,item.triangles,item.id+' declared triangles');assert.equal(doc.animations?.length||0,item.clips,item.id+' declared clips');assert.ok(item.author&&item.license&&/^https:\/\//.test(item.source));assert.ok(!doc.buffers.some(b=>b.uri),'Self-contained source geometry');assert.ok(!(doc.images||[]).some(im=>im.uri&&!im.uri.startsWith('data:')),'No external source texture dependencies');}
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
const page=await browser.newPage();await page.goto(arg('--url')||'http://localhost:5176');const results=[];
for(const item of items){const result=await page.evaluate(async item=>{
 const T=await import('/node_modules/three/build/three.module.js');const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');const {clone}=await import('/node_modules/three/examples/jsm/utils/SkeletonUtils.js');const {applyPhysicalSize,captureRestPose,copyRestPose}=await import('/demos/photo-cat/physical-size.js');
 let asset;if(item.id==='runner'){const {createCat}=await import('/demos/pet/rigged-cat.js');const api=await createCat({model:'runner'});api.setMode('rest');asset={scene:api.root,animations:api.animations};}else asset=await new GLTFLoader().loadAsync(item.url.replace('../../','/'));
 const root=new T.Group(),orient=new T.Group();orient.rotation.y=item.rotationY||0;orient.add(asset.scene);root.add(orient);root.animations=asset.animations;captureRestPose(root);applyPhysicalSize(root,{axis:item.axis,cm:item.cm});
 const extent=o=>{const s=new T.Box3().setFromObject(o,true).getSize(new T.Vector3());return item.axis==='longest'?Math.max(s.x,s.y,s.z):s[item.axis];};
 const stat=o=>{let triangles=0,skins=0;const bones=new Set();o.traverse(n=>{if(n.isMesh){triangles+=(n.geometry.index?.count||n.geometry.attributes.position.count)/3;if(n.isSkinnedMesh){skins++;n.skeleton.bones.forEach(b=>bones.add(b));}}});return{triangles,skins,bones:bones.size};};
 const before=stat(root);if(before.triangles!==item.triangles)throw Error(item.id+' rendered scene triangle count differs from catalog');
 if(item.noMetricExport)return{id:item.id,...before,exportSkipped:true,reason:'Source includes non-pet scene geometry; metric export disabled'};
 const copy=copyRestPose(root,clone(root));copy.animations=root.animations;applyPhysicalSize(copy,{axis:item.axis,cm:item.cm});const bytes=await new GLTFExporter().parseAsync(copy,{binary:true,animations:copy.animations,onlyVisible:false});const decoded=await new GLTFLoader().parseAsync(bytes,'');const after=stat(decoded.scene);if(JSON.stringify(after)!==JSON.stringify(before))throw Error(item.id+' exported triangle/skeleton counts changed');
 const observed=extent(decoded.scene),error=Math.abs(observed-item.cm/100);if(error>2e-5)throw Error(item.id+' centimeter extent changed');if(decoded.animations.length!==item.clips)throw Error(item.id+' original clips lost');
 const meta=decoded.scene.children[0].userData.physicalSize;if(meta?.pose!=='captured-adapter-rest-pose')throw Error('Captured rest metadata absent');
 const scene=new T.Scene();scene.add(decoded.scene,new T.HemisphereLight(0xffffff,0x888888,3));const box=new T.Box3().setFromObject(decoded.scene),center=box.getCenter(new T.Vector3()),span=box.getSize(new T.Vector3()).length(),camera=new T.PerspectiveCamera(35,1,.001,100);camera.position.copy(center).add(new T.Vector3(span*.9,span*.35,span*.9));camera.lookAt(center);const renderer=new T.WebGLRenderer();renderer.setSize(128,128);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);const rendered=renderer.info.render.triangles;renderer.dispose();
 return{id:item.id,...after,clips:decoded.animations.length,axis:item.axis,requestedCm:item.cm,observedMeters:observed,errorMeters:error,pose:meta.pose,renderedTriangles:rendered,bytes:bytes.byteLength};
},item);results.push(result);}
await writeFile(`${directory}/${arg('--id')||'all'}.report.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
