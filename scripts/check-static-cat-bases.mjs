// Basic exported-surface checks for the newly downloaded static cat/dog adapters.
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
const directory='/tmp/new-static-pet-validation';await mkdir(directory,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
const page=await browser.newPage();await page.goto('http://localhost:5176');const reports=[];
for(const [name,file,fn,path,expected] of [['siamese','template-siamese-cat.js','createTemplateSiameseCat','/models/cat/siamese-lowpoly.glb',3999],['sphynx','template-sphynx-cat.js','createTemplateSphynxCat','/models/cat/sphynx-lowpoly.glb',4818],['golden-retriever','template-golden-retriever.js','createTemplateGoldenRetriever','/models/dog/golden-retriever.glb',444]]){
 const report=await page.evaluate(async({name,file,fn,path,expected})=>{
 const T=await import('/node_modules/three/build/three.module.js'),{GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js'),{GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js'),factory=(await import('/demos/photo-cat/'+file))[fn];
 const require=(v,m)=>{if(!v)throw Error(name+': '+m);},meshes=r=>{const a=[];r.traverse(m=>{if(m.isMesh)a.push(m);});return a;},positions=r=>meshes(r).flatMap(m=>Array.from(m.geometry.attributes.position.array));
 const base={baseModel:name,colors:{baseColor:'#ae8768',secondaryColor:'#e6dbcc',eyeColor:'#8baa45',noseColor:'#745041'},pattern:'bicolor'},neutral=await factory(base),keys=neutral.userData.shapeControls||[],baseline=positions(neutral),explicit=await factory({...base,shape:Object.fromEntries(keys.map(k=>[k,1]))});
 require(JSON.stringify(baseline)===JSON.stringify(positions(explicit)),'Neutral controls differ');const controls={};for(const key of keys){const p=positions(await factory({...base,shape:{[key]:1.3}}));const delta=Math.max(...p.map((v,i)=>Math.abs(v-baseline[i])));require(delta>1e-7,'Ineffective '+key);controls[key]=delta;}
 let samples=0;const root=await factory({...base,shape:Object.fromEntries(keys.map((k,i)=>[k,i%2?1.4:.7])),sampleFace:u=>{samples++;return u<.5?[180,130,90]:[220,210,200];}}),asset=await new GLTFLoader().loadAsync(path);root.updateMatrixWorld(true);asset.scene.updateMatrixWorld(true);const a=meshes(asset.scene),b=meshes(root);require(a.length===b.length,'Mesh count');
 const groups=new Map(),point=new T.Vector3();let triangles=0;
 for(let m=0;m<a.length;m++){
  // Faceted adapters intentionally expand indexed triangles into independent corners.
  const geometry=a[m].geometry.index&&!b[m].geometry.index?a[m].geometry.toNonIndexed():a[m].geometry,p=geometry.attributes.position,q=b[m].geometry.attributes.position;
  require(p.count===q.count,'Source triangle corner count');require(JSON.stringify(Array.from(geometry.index?.array||[]))===JSON.stringify(Array.from(b[m].geometry.index?.array||[])),'Derived-source triangle order');
  for(const attr of Object.values(b[m].geometry.attributes))require(Array.from(attr.array).every(Number.isFinite),'Non-finite attribute');triangles+=(b[m].geometry.index?.count||q.count)/3;
  for(let i=0;i<p.count;i++){point.fromBufferAttribute(p,i).applyMatrix4(a[m].matrixWorld);const key=point.toArray().map(v=>Math.round(v/1e-5)).join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push([m,i]);}
 }
 let checks=0,maxSeparation=0;for(const vertices of groups.values()){const [m,i]=vertices[0],first=new T.Vector3().fromBufferAttribute(b[m].geometry.attributes.position,i).applyMatrix4(b[m].matrixWorld);for(const [n,j] of vertices.slice(1)){point.fromBufferAttribute(b[n].geometry.attributes.position,j).applyMatrix4(b[n].matrixWorld);maxSeparation=Math.max(maxSeparation,first.distanceTo(point));checks++;}}
 require(maxSeparation<1e-4,'Shared source corners split');require(triangles===expected,'Triangle count');require(root.animations.length===0,'Static source gained animation');require(root.userData.sourcePixelsEmbedded===false,'Source pixels embedded');require(samples<=64,'Excess photograph sampling');
 const data=await new GLTFExporter().parseAsync(root,{binary:true,animations:[],onlyVisible:false}),doc=JSON.parse(new TextDecoder().decode(new Uint8Array(data,20,new DataView(data).getUint32(12,true))));require(!doc.buffers.some(b=>b.uri),'External geometry');require(!(doc.images||[]).some(i=>i.uri),'External image');
 const decoded=await new GLTFLoader().parseAsync(data,'');require(meshes(decoded.scene).reduce((n,m)=>n+(m.geometry.index?.count||m.geometry.attributes.position.count)/3,0)===expected,'Roundtrip triangle count');
 const scene=new T.Scene();scene.add(decoded.scene,new T.HemisphereLight(0xffffff,0x888888,3));const box=new T.Box3().setFromObject(decoded.scene),center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3()).length(),camera=new T.PerspectiveCamera(35,1,.01,100);camera.position.copy(center).add(new T.Vector3(size*.9,size*.3,size*.9));camera.lookAt(center);const renderer=new T.WebGLRenderer();renderer.setSize(256,256);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);const rendered=renderer.info.render.triangles;renderer.dispose();
 return{name,triangles,controls,samples,checks,maxSeparation,bytes:data.byteLength,rendered,clips:decoded.animations.length,sourcePixelsEmbedded:false,comparison:'Existing downloaded/decimated base triangle corners retained; no claim of original high-poly topology preservation or watertightness'};
 },{name,file,fn,path,expected});reports.push(report);
}
await writeFile(directory+'/report.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));
}finally{await browser.close();}
