// Test meter calibration on static and skinned source assets, then actual GLB export/reload.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
const arg=n=>{const i=process.argv.indexOf(n);return i<0?null:process.argv[i+1];};
const directory='/tmp/pet-physical-size-validation';await mkdir(directory,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
const page=await browser.newPage();await page.goto(arg('--url')||'http://localhost:5176');
const report=await page.evaluate(async()=>{
 const T=await import('/node_modules/three/build/three.module.js');const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');const {clone}=await import('/node_modules/three/examples/jsm/utils/SkeletonUtils.js');const {applyPhysicalSize,captureRestPose,copyRestPose}=await import('/demos/photo-cat/physical-size.js');
 const size=root=>new T.Box3().setFromObject(root,true).getSize(new T.Vector3());
 const extent=(root,axis)=>{const s=size(root);return axis==='longest'?Math.max(s.x,s.y,s.z):s[axis];};
 const meshes=root=>{const a=[];root.traverse(m=>{if(m.isMesh)a.push(m);});return a;};
 const snapshot=root=>meshes(root).map(m=>({position:Array.from(m.geometry.attributes.position.array),index:m.geometry.index?Array.from(m.geometry.index.array):null,skinIndex:m.geometry.attributes.skinIndex?Array.from(m.geometry.attributes.skinIndex.array):null,skinWeight:m.geometry.attributes.skinWeight?Array.from(m.geometry.attributes.skinWeight.array):null,bones:m.skeleton?.bones.map(b=>({name:b.name,parent:b.parent?.isBone?b.parent.name:null,inverse:m.skeleton.boneInverses[m.skeleton.bones.indexOf(b)].elements.slice()}))}));
 const require=(condition,message)=>{if(!condition)throw Error(message);};
 const records=[];
 for(const [name,path] of [['runner','/models/lowpoly_cat_rig__run_animation.glb'],['pug','/models/dog/pug.glb'],['rat','/models/other/rat.glb'],['pomeranian','/models/dog/pomeranian.glb'],['persian','/models/cat/persian.glb']]){
  const source=await new GLTFLoader().loadAsync(path);captureRestPose(source.scene);source.scene.updateMatrixWorld(true);const sourceSize=size(source.scene).toArray(),sourceSnapshot=JSON.stringify(snapshot(source.scene));
  for(const [axis,cm] of [['y',35],['z',12],['x',17],['longest',75]]){
   const root=clone(source.scene);root.animations=source.animations.map(c=>c.clone());const before=JSON.stringify(snapshot(root));
   applyPhysicalSize(root,{axis,cm,estimated:false});const firstScale=root.scale.toArray();applyPhysicalSize(root,{axis,cm,estimated:false});
   require(root.scale.toArray().every((v,i)=>Math.abs(v-firstScale[i])<1e-10),'Repeated calibration must be idempotent');
   require(Math.abs(extent(root,axis)-cm/100)<1e-8,'In-memory extent must match requested centimeters');
   require(JSON.stringify(snapshot(root))===before,'Sizing must not modify geometry, weights, bones or bind matrices');
   require(JSON.stringify(size(source.scene).toArray())===JSON.stringify(sourceSize)&&JSON.stringify(snapshot(source.scene))===sourceSnapshot,'Export clone sizing must leave source preview unchanged');
   const buffer=await new GLTFExporter().parseAsync(root,{binary:true,animations:root.animations,onlyVisible:false});const reloaded=await new GLTFLoader().parseAsync(buffer,'');
   const observed=extent(reloaded.scene,axis),error=Math.abs(observed-cm/100);require(error<2e-5,'Serialized GLB extent must retain selected metric size');
   const meta=reloaded.scene.children.find(n=>n.userData.physicalSize)?.userData.physicalSize||reloaded.scene.userData.physicalSize;
   require(meta?.unit==='meter'&&meta.centimeters===cm&&meta.estimated===false,'Serialized measurement metadata must remain explicit');
   const a=meshes(root),b=meshes(reloaded.scene);require(a.length===b.length,'Same mesh count after calibration export');
   let bones=0,triangles=0;for(let i=0;i<a.length;i++){
    require(JSON.stringify(Array.from(a[i].geometry.index?.array||[]))===JSON.stringify(Array.from(b[i].geometry.index?.array||[])),'Indices unchanged by calibrated export');
    const aa=a[i].geometry.attributes,bb=b[i].geometry.attributes;for(const attribute of ['position','skinIndex','skinWeight'])if(aa[attribute]){require(aa[attribute].array.length===bb[attribute].array.length,'Attribute length preserved');for(let j=0;j<aa[attribute].array.length;j++)require(Math.abs(aa[attribute].array[j]-bb[attribute].array[j])<1e-7,'Geometry and skin values preserved');}
    if(a[i].isSkinnedMesh){require(JSON.stringify(a[i].skeleton.bones.map(n=>n.name))===JSON.stringify(b[i].skeleton.bones.map(n=>n.name)),'Bone names retained');bones=a[i].skeleton.bones.length;}
    triangles+=(b[i].geometry.index?.count||bb.position.count)/3;
   }
   require(source.animations.length===reloaded.animations.length,'All original clips retained');for(let i=0;i<source.animations.length;i++){const a=source.animations[i],b=reloaded.animations[i];require(a.name===b.name&&a.tracks.length===b.tracks.length,'Clip/track identities preserved');for(let j=0;j<a.tracks.length;j++){require(a.tracks[j].name===b.tracks[j].name,'Animation target preserved');for(const key of ['times','values']){require(a.tracks[j][key].length===b.tracks[j][key].length,'Animation key count retained');for(let k=0;k<a.tracks[j][key].length;k++)require(Math.abs(a.tracks[j][key][k]-b.tracks[j][key][k])<1e-5,'Animation data preserved');}}}
   records.push({name,axis,centimeters:cm,observedMeters:observed,errorMeters:error,triangles,bones,clips:reloaded.animations.length});
  }
 }
 const animatedPoseRecords=[];
 for(const [name,path] of [['runner','/models/lowpoly_cat_rig__run_animation.glb'],['pug','/models/dog/pug.glb'],['rat','/models/other/rat.glb'],['adapted-runner','adapter:runner'],['adapted-husky','adapter:husky']]){
  let source;
  if(path.startsWith('adapter:')){
    const profile={baseModel:path.slice(8),shape:{headWidth:1.2,headHeight:.9,earLength:1.2,bodyWidth:1.1}};
    const root=path==='adapter:runner'?await(await import('/demos/photo-cat/template-cat.js')).createTemplateCat(profile):await(await import('/demos/photo-cat/template-dog.js')).createTemplateDog(profile);
    source={scene:root,animations:root.animations};
  }else source=await new GLTFLoader().loadAsync(path);
  captureRestPose(source.scene);const mixer=new T.AnimationMixer(source.scene);
  const clip=source.animations.find(c=>/jump/i.test(c.name))||source.animations.find(c=>/run/i.test(c.name))||source.animations[0];
  const reset=root=>{const set=new Set();root.traverse(m=>{if(m.isSkinnedMesh)set.add(m.skeleton);});set.forEach(s=>s.pose());root.updateMatrixWorld(true);};
  const rest=clone(source.scene);const restTransforms=[];rest.traverse(n=>restTransforms.push({name:n.name,p:n.position.toArray(),q:n.quaternion.toArray(),s:n.scale.toArray()}));const reference=clone(rest);applyPhysicalSize(reference,{axis:'y',cm:35});
  const expectedScale=reference.scale.toArray();mixer.clipAction(clip).play();
  for(const fraction of [.13,.37,.61,.89]){
   mixer.setTime(clip.duration*fraction);source.scene.updateMatrixWorld(true);
   const poseSnapshot=JSON.stringify(source.scene.toJSON()),previewHeight=extent(source.scene,'y');
   const exportRoot=clone(source.scene);exportRoot.animations=source.animations.map(c=>c.clone());applyPhysicalSize(exportRoot,{axis:'y',cm:35});
   require(exportRoot.scale.toArray().every((v,i)=>Math.abs(v-expectedScale[i])<1e-7),'Calibration scale must be independent of preview animation phase: '+name+' '+fraction);
   const restoredTransforms=[];exportRoot.traverse(n=>restoredTransforms.push({name:n.name,p:n.position.toArray(),q:n.quaternion.toArray(),s:n.scale.toArray()}));
   // Root scale changes for calibration; all descendant transforms must preserve adapter corrections.
   require(JSON.stringify(restoredTransforms.slice(1))===JSON.stringify(restTransforms.slice(1)),'Exact corrected adapter bone/nonbone transforms must survive restoration');
   require(!exportRoot.userData._physicalSizeRestPose,'Internal pose snapshot must not be exported');
   if(name==='adapted-runner'&&fraction===.13){
    const catalogCopy=copyRestPose(exportRoot,clone(exportRoot));catalogCopy.animations=exportRoot.animations;
    applyPhysicalSize(catalogCopy,{axis:'y',cm:40,estimated:false});
    const transforms=[];catalogCopy.traverse(n=>transforms.push({name:n.name,p:n.position.toArray(),q:n.quaternion.toArray(),s:n.scale.toArray()}));
    require(JSON.stringify(transforms.slice(1))===JSON.stringify(restTransforms.slice(1)),'Cloning already-calibrated catalog preserves corrected adapter pose');
    const encoded=await new GLTFExporter().parseAsync(catalogCopy,{binary:true,animations:catalogCopy.animations,onlyVisible:false}),decoded=await new GLTFLoader().parseAsync(encoded,'');
    require(Math.abs(extent(decoded.scene,'y')-.4)<2e-5,'Catalog clone re-export retains new40cm size');
   }

   const bindHeight=extent(exportRoot,'y');require(Math.abs(bindHeight-.35)<1e-7,'Export bind-pose height must remain selected size after animated-preview export');
   require(JSON.stringify(source.scene.toJSON())===poseSnapshot,'Calibration must not reset or mutate the live preview pose');
   const bytes=await new GLTFExporter().parseAsync(exportRoot,{binary:true,animations:exportRoot.animations,onlyVisible:false});const loaded=await new GLTFLoader().parseAsync(bytes,'');const actual=extent(loaded.scene,'y');require(Math.abs(actual-.35)<2e-5,'Animated-preview GLB retains calibrated bind-pose height');
   require(loaded.animations.length===source.animations.length,'Animated-preview export retains every clip');animatedPoseRecords.push({name,clip:clip.name,fraction,previewHeight,exportBindHeightMeters:actual});
  }
  mixer.stopAllAction();
 }
 const empty=new T.Group();let invalidRejected=0;for(const options of [{cm:0},{cm:-1},{cm:NaN},{cm:Infinity},{cm:1001},{cm:12,axis:'bad'},{cm:12},{cm:40,axis:'y',measurementKind:'withers-height'}]){try{applyPhysicalSize(empty,options);}catch{invalidRejected++;}}require(invalidRejected===8,'Invalid measurements and empty geometry rejected');
 return{records,animatedPoseRecords,invalidRejected,correctedAdapterTransformsPreserved:true,calibratedCatalogClonePassed:true,sourcePreviewUnchanged:true,geometryAndRigPreserved:true,roundtrip:'Actual GLB export and browser loader reload'};
});assert.equal(report.records.length,20);assert.equal(report.animatedPoseRecords.length,20);await writeFile(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
