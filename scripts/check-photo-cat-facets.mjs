// Validate authored per-triangle color, conforming source-surface refinement and rig continuity.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {AnimationMixer,Box3,Texture,Vector3,Triangle,Color} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {chromium} from 'playwright-core';
const arg=n=>{const i=process.argv.indexOf(n);return i<0?null:process.argv[i+1];};
const dir='/tmp/photo-cat-facet-validation';await mkdir(dir,{recursive:true});
const stem=arg('--glb')?basename(arg('--glb'),'.glb'):`jtoastie-facets-${arg('--shape-stress')||'default'}`;
const stress=arg('--shape-stress')==='long'?{neckLength:.65,headWidth:1.4,muzzleLength:.7,earLength:1.4,earWidth:.7,cheekWidth:.7}:arg('--shape-stress')==='wide'?{neckLength:1.45,headWidth:.7,muzzleLength:1.4,earLength:.7,earWidth:1.4,cheekWidth:1.4}:{};
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage({viewport:{width:640,height:640}});await page.goto(arg('--url')||'http://localhost:5176');
 let bytes,observedSourceCalls;
 if(arg('--glb'))bytes=await readFile(arg('--glb'));
 else{
  const generated=await page.evaluate(async shape=>{
   const {createTemplateCatBreed}=await import('/demos/photo-cat/template-cat-breed.js');const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');let calls=0;
   const root=await createTemplateCatBreed({baseModel:'jtoastie',pattern:'bicolor',shape,colors:{baseColor:'#252329',secondaryColor:'#f1f0ed',eyeColor:'#a4ae69',noseColor:'#b28e9a'},sampleFace:(u,v)=>{calls++;return Math.abs(u-.5)<.1+v*.15?[225,222,214]:[32,30,36];}});
   const data=new Uint8Array(await new GLTFExporter().parseAsync(root,{binary:true,animations:root.animations,onlyVisible:false}));let binary='';for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));return{base64:btoa(binary),calls,declaredCalls:root.userData.photoColorSamples};
  },stress);
  assert.equal(generated.calls,generated.declaredCalls);assert.ok(generated.calls>0&&generated.calls<=1024,'Only bounded coarse photo classification');observedSourceCalls=generated.calls;bytes=Buffer.from(generated.base64,'base64');
 }
 await writeFile(`${dir}/${stem}.glb`,bytes);bytes=await readFile(`${dir}/${stem}.glb`);
 const array=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),doc=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
 assert.equal(doc.images?.length||0,0,'Per-face coloring embeds no texture image');assert.equal(doc.textures?.length||0,0);assert.ok(doc.buffers.every(b=>!b.uri));
 const sourceBytes=await readFile('public/models/cat/jtoastie.glb');const source=await new GLTFLoader().register(()=>({name:'SourceTextureStub',loadTexture:()=>Promise.resolve(new Texture())})).parseAsync(array(sourceBytes),'');
 const result=await new GLTFLoader().parseAsync(array(bytes),'');const skins=root=>{const a=[];root.traverse(n=>{if(n.isSkinnedMesh)a.push(n);});return a;};const originals=skins(source.scene),derived=skins(result.scene);assert.equal(originals.length,1);assert.equal(derived.length,1);
 const a=originals[0],b=derived[0],g=a.geometry,h=b.geometry,p=h.attributes.position,c=h.attributes.color,ix=g.index,meta=result.scene.children[0].userData;
 assert.equal(meta.sourcePixelsEmbedded,false);assert.equal(meta.surfaceRefinement.method,'uniform-midpoint-plus-conforming-face');assert.equal(meta.surfaceRefinement.levels,1);assert.equal(meta.surfaceRefinement.sourceTriangleCount,1856);assert.equal(meta.surfaceRefinement.derivedTriangleCount,p.count/3);
 assert.equal(h.index,null,'Flat triangles use independent corners');assert.ok(p.count/3>=7424&&p.count/3<15000);assert.equal(h.attributes.uv,undefined,'No hidden face texture projection remains');
 for(const m of Array.isArray(b.material)?b.material:[b.material])assert.equal(m.map,null);
 for(const attribute of Object.values(h.attributes))assert.ok(Array.from(attribute.array).every(Number.isFinite),'Finite geometry, normal, color and skin attributes');
 const palette=meta.facePaintPalette.map(hex=>new Color(hex));
 for(let i=0;i<p.count;i+=3){assert.ok(palette.some(v=>Math.max(Math.abs(v.r-c.getX(i)),Math.abs(v.g-c.getY(i)),Math.abs(v.b-c.getZ(i)))<2e-6),'Each face uses an authored palette color');}
 for(let i=0;i<p.count;i+=3)for(let k=0;k<3;k++){assert.equal(c.getComponent(i,k),c.getComponent(i+1,k),'Each face has one exact RGB');assert.equal(c.getComponent(i,k),c.getComponent(i+2,k),'Each face has one exact RGB');}
 const weights=(geometry,i)=>{const ids=geometry.attributes.skinIndex,w=geometry.attributes.skinWeight,map=new Map();for(let k=0;k<4;k++){const value=w.getComponent(i,k);assert.ok(Number.isFinite(value)&&value>=0);if(value>0)map.set(ids.getComponent(i,k),(map.get(ids.getComponent(i,k))||0)+value);}return map;};
 const distance=(a,b)=>[...new Set([...a.keys(),...b.keys()])].reduce((n,k)=>n+Math.abs((a.get(k)||0)-(b.get(k)||0)),0);
 const merged=(a,b)=>{const values=new Map();for(const map of [a,b])for(const [id,w]of map)values.set(id,(values.get(id)||0)+w*.5);const entries=[...values].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,4),sum=entries.reduce((n,[,w])=>n+w,0);return new Map(entries.map(([id,w])=>[id,w/sum]));};
 const point=i=>new Vector3().fromBufferAttribute(p,i);let maxWeightError=0;
 // Neutral source-space surface proof: every child triangle lies inside one
 // original triangle, and total area is conserved (no new sculpted surface).
 let surfaceProof=null;
 if(!arg('--glb')&&!arg('--shape-stress')){
  const triangles=[];let sourceArea=0,derivedArea=0;const closest=new Vector3();
  for(let t=0;t<ix.count;t+=3){const tri=new Triangle(...[0,1,2].map(k=>new Vector3().fromBufferAttribute(g.attributes.position,ix.getX(t+k))));tri.box=new Box3().setFromPoints([tri.a,tri.b,tri.c]).expandByScalar(1e-7);triangles.push(tri);sourceArea+=tri.getArea();}
  for(let i=0;i<p.count;i+=3){const pts=[point(i),point(i+1),point(i+2)],tri=new Triangle(...pts),center=tri.getMidpoint(new Vector3());derivedArea+=tri.getArea();const parent=triangles.find(t=>t.box.containsPoint(center)&&pts.every(v=>t.closestPointToPoint(v,closest).distanceTo(v)<1e-7));assert.ok(parent,'Refined triangle stays on and inside an original source face');assert.ok(tri.getNormal(new Vector3()).dot(parent.getNormal(new Vector3()))>.999,'Refinement retains source face winding');}
  assert.ok(Math.abs(derivedArea-sourceArea)/sourceArea<2e-6,'Refinement conserves original surface area');surfaceProof={sourceArea,derivedArea,trianglesChecked:p.count/3};
  const sourcePoints=new Map();for(let i=0;i<g.attributes.position.count;i++){const key=new Vector3().fromBufferAttribute(g.attributes.position,i).toArray().map(x=>Math.round(x/1e-7)).join(',');sourcePoints.set(key,i);}
  let corners=0;for(let i=0;i<p.count;i++){const key=point(i).toArray().map(x=>Math.round(x/1e-7)).join(',');if(sourcePoints.has(key)){const error=distance(weights(h,i),weights(g,sourcePoints.get(key)));maxWeightError=Math.max(maxWeightError,error);assert.ok(error<2e-6,'Original corner weights retained');corners++;}}assert.ok(corners>=1856*3);surfaceProof.originalCornerChecks=corners;
 }
 assert.deepEqual(b.skeleton.bones.map(n=>n.name),a.skeleton.bones.map(n=>n.name));assert.equal(b.skeleton.bones.length,22);
 for(let i=0;i<22;i++){assert.equal(b.skeleton.bones[i].parent?.isBone?b.skeleton.bones[i].parent.name:null,a.skeleton.bones[i].parent?.isBone?a.skeleton.bones[i].parent.name:null);a.skeleton.boneInverses[i].elements.forEach((v,j)=>assert.ok(Math.abs(v-b.skeleton.boneInverses[i].elements[j])<1e-5));}
 assert.equal(result.animations.length,source.animations.length);for(let i=0;i<source.animations.length;i++){const x=source.animations[i],y=result.animations[i];assert.equal(x.name,y.name);assert.equal(x.tracks.length,y.tracks.length);for(let j=0;j<x.tracks.length;j++){assert.equal(x.tracks[j].name,y.tracks[j].name);for(const key of ['times','values']){assert.equal(x.tracks[j][key].length,y.tracks[j][key].length);x.tracks[j][key].forEach((v,k)=>assert.ok(Math.abs(v-y.tracks[j][key][k])<1e-5));}}}
 const groups=new Map();for(let i=0;i<p.count;i++){const key=point(i).toArray().map(x=>Math.round(x/1e-7)).join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);const sum=[...weights(h,i).values()].reduce((n,v)=>n+v,0);assert.ok(Math.abs(sum-1)<2e-6);}
 let sharedSkinChecks=0;for(const vertices of groups.values())for(const i of vertices.slice(1)){assert.ok(distance(weights(h,i),weights(h,vertices[0]))<2e-6,'Shared positions have identical canonical skin');sharedSkinChecks++;}
 let animatedChecks=0,maxAnimatedSeparation=0;const mixer=new AnimationMixer(result.scene),v=new Vector3(),w=new Vector3();for(const clip of result.animations){mixer.stopAllAction();mixer.clipAction(clip).reset().play();for(const f of [0,.13,.37,.61,.89]){mixer.setTime(clip.duration*f);result.scene.updateMatrixWorld(true);for(const vertices of groups.values()){b.applyBoneTransform(vertices[0],v.fromBufferAttribute(p,vertices[0]));for(const i of vertices.slice(1)){b.applyBoneTransform(i,w.fromBufferAttribute(p,i));const separation=v.distanceTo(w);maxAnimatedSeparation=Math.max(maxAnimatedSeparation,separation);assert.ok(separation<1e-5,'All refined facets remain joined during animation');animatedChecks++;}}}}mixer.stopAllAction();
 const render=await page.evaluate(async base64=>{const T=await import('/node_modules/three/build/three.module.js'),{GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),g=await new GLTFLoader().parseAsync(data.buffer,'');const box=new T.Box3().setFromObject(g.scene,true),size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());const scene=new T.Scene();scene.background=new T.Color('#e8eade');scene.add(g.scene,new T.HemisphereLight(0xffffff,0x888888,3));const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(640,640);document.body.replaceChildren(renderer.domElement);const cam=new T.PerspectiveCamera(35,1,.001,100);cam.position.copy(center).add(new T.Vector3(size.length()*.7,size.length()*.2,size.length()));cam.lookAt(center);renderer.render(scene,cam);let maps=0;g.scene.traverse(m=>{if(m.isMesh)for(const material of Array.isArray(m.material)?m.material:[m.material])if(material.map)maps++;});return{triangles:renderer.info.render.triangles,maps,size:size.toArray(),physicalSize:g.scene.children[0].userData.physicalSize};},bytes.toString('base64'));
 assert.equal(render.triangles,p.count/3);assert.equal(render.maps,0);if(arg('--height-cm'))assert.ok(Math.abs(render.size[1]-Number(arg('--height-cm'))/100)<2e-5);await page.screenshot({path:`${dir}/${stem}.png`});
 const report={input:arg('--glb')||'browser factory',triangles:p.count/3,surfaceProof,sourceTriangles:1856,bones:22,clips:result.animations.map(c=>c.name),faceColors:'exact identical RGB at all three corners',textureImages:0,observedSourceCalls,declaredSourceCalls:meta.photoColorSamples,originalCornerWeightError:surfaceProof?maxWeightError:null,sharedSkinChecks,animatedChecks,maxAnimatedSeparation,render};await writeFile(`${dir}/${stem}.report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
