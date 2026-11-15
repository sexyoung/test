// Six-control extremes: --shape-stress long|wide (writes separate reports)
// node scripts/check-photo-cat.mjs --url http://localhost:5176
// Validate an actual downloaded file, including browser texture decode: --glb /path/to/cat.glb
// Optional actual-photo decode: node scripts/check-photo-cat.mjs --photos /tmp/photo-cat-reference --url http://localhost:5176
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {AnimationMixer,Box3,Scene,Texture,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {analyzeCatPhoto} from '../demos/photo-cat/analyze.js';

const guides={landmarks:{leftEye:{x:.36,y:.4},rightEye:{x:.64,y:.4},nose:{x:.5,y:.57}}};
function syntheticPhoto(kind){
  const width=240,height=220,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let color=[215,225,235];const u=x/width,v=y/height;
    if(((u-.5)/.33)**2+((v-.49)/.4)**2<1){
      color=kind==='gray'?[120,130,140]:[202,139,69];
      if(kind==='bicolor'&&u>.52)color=[238,236,230];
      if(kind==='tabby'&&Math.sin(u*80+v*9)>.62)color=[90,58,28];
    }
    for(const eyeX of [.36,.64]){
      if(((u-eyeX)/.06)**2+((v-.4)/.035)**2<1)color=[124,165,53];
      if(Math.hypot(u-eyeX,v-.4)<.012)color=[12,15,12];
    }
    if(Math.hypot((u-.5)*.7,v-.57)<.022)color=[157,95,94];
    data.set([...color,255],(y*width+x)*4);
  }
  return{width,height,data};
}
const profiles={};
for(const kind of ['gray','bicolor','tabby']){
  const image=syntheticPhoto(kind),profile=analyzeCatPhoto(image,guides);profiles[kind]=profile;
  assert.equal(profile.pattern,kind==='gray'?'solid':kind,`${kind}: measured pattern`);
  assert.equal(profile.colors.baseColor,kind==='gray'?'#78828c':'#ca8b45',`${kind}: measured fur color`);
  assert.equal(profile.colors.eyeColor,'#7ca535',`${kind}: iris extraction excludes black pupil`);
  assert.equal(profile.colors.noseColor,'#9d5f5e',`${kind}: nose sampling`);
  assert.ok(profile.faceCrop.y>profile.crop.y,'Face mapping excludes ear region');
  assert.ok(profile.unknowns.includes('bodyWidth')&&profile.unknowns.includes('muzzleLength'),'Unseen anatomy remains unknown');
  assert.equal(profile.shape.earTilt,0,'Neutral ear tilt is an angle, not a scale');
  assert.deepEqual(analyzeCatPhoto(image,guides),profile,'Analysis is deterministic');
}
const auto=analyzeCatPhoto(syntheticPhoto('gray'));
for(const eye of ['leftEye','rightEye'])assert.ok(Math.hypot(auto.landmarks[eye].x-guides.landmarks[eye].x,auto.landmarks[eye].y-guides.landmarks[eye].y)<.025,'Automatic synthetic eye pairing');
assert.ok(auto.confidence.landmarks<.7&&auto.warnings.length,'Heuristic detector is qualified');
const side=analyzeCatPhoto(syntheticPhoto('gray'),{...guides,sideView:true});
assert.equal(side.shape.headWidth,1);assert.equal(side.confidence.shape,0);
assert.throws(()=>analyzeCatPhoto({width:1,height:1,data:new Uint8Array(4)}));
assert.throws(()=>analyzeCatPhoto(syntheticPhoto('gray'),{crop:{x:0,y:0,width:NaN,height:1}}));

function validateModel(root){
  let vertices=0,triangles=0;
  root.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,c=mesh.geometry.attributes.color;
    assert.ok(p&&n&&c,`${mesh.name}: exportable position/normal/vertex color`);
    assert.equal(p.count,n.count);assert.equal(p.count,c.count);
    for(const attribute of [p,n,c])assert.ok(Array.from(attribute.array).every(Number.isFinite),`${mesh.name}: finite attributes`);
    for(let i=0;i<n.count;i++)assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<.02,`${mesh.name}: unit normal`);
    const index=mesh.geometry.index;const count=index?.count??p.count;
    assert.equal(count%3,0);vertices+=p.count;triangles+=count/3;
  });
  const bounds=new Box3().setFromObject(root),size=bounds.getSize(new Vector3());
  assert.ok(size.x>.5&&size.y>1&&size.z>.3&&size.length()<10,'Plausible model dimensions');
  assert.ok(vertices>500&&triangles<100000,'Nonempty bounded mesh');
  return{vertices,triangles,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}};
}
function inspectReferenceRig(root,clips){
  const meshes=[];root.traverse(mesh=>{if(mesh.isMesh)meshes.push(mesh);});
  const boneSet=new Set(),surfaces=[];
  for(const mesh of meshes.filter(mesh=>mesh.isSkinnedMesh)){
    mesh.skeleton.bones.forEach(bone=>boneSet.add(bone));
    const p=mesh.geometry.attributes.position,index=mesh.geometry.index,groups=new Map(),ids=[];
    for(let i=0;i<p.count;i++){
      const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v/1e-5)).join(',');
      if(!groups.has(key))groups.set(key,{id:groups.size,vertices:[]});const group=groups.get(key);group.vertices.push(i);ids.push(group.id);
    }
    const parent=Array.from({length:groups.size},(_,i)=>i),find=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;},edges=new Map();
    const count=index?.count??p.count;let degenerateTriangles=0;
    for(let i=0;i<count;i+=3){
      const triangle=[0,1,2].map(j=>ids[index?index.getX(i+j):i+j]);
      if(new Set(triangle).size<3){degenerateTriangles++;continue;}
      for(let j=0;j<3;j++){const a=triangle[j],b=triangle[(j+1)%3];parent[find(a)]=find(b);const key=a<b?`${a}:${b}`:`${b}:${a}`;edges.set(key,(edges.get(key)||0)+1);}
    }
    surfaces.push({mesh,groups,referencePoints:new Map(),report:{name:mesh.name,triangles:count/3,uniquePositions:groups.size,components:new Set(parent.map((_,i)=>find(i))).size,boundaryEdges:[...edges.values()].filter(n=>n===1).length,nonManifoldEdges:[...edges.values()].filter(n=>n>2).length,degenerateTriangles,duplicateChecks:0,maxAnimatedMovement:0,maxAnimatedCoincidentSeparation:0}});
  }
  const mixer=new AnimationMixer(root),a=new Vector3(),b=new Vector3();
  for(const clip of clips){
    mixer.stopAllAction();for(const {mesh} of surfaces)mesh.skeleton.pose();root.updateMatrixWorld(true);
    mixer.clipAction(clip).reset().play();
    for(const fraction of [0,.13,.37,.61,.89]){
      mixer.setTime(clip.duration*fraction);root.updateMatrixWorld(true);
      for(const {mesh,groups,report,referencePoints} of surfaces){
        mesh.skeleton.update();const p=mesh.geometry.attributes.position;
        for(const {id,vertices} of groups.values()){
          mesh.applyBoneTransform(vertices[0],a.fromBufferAttribute(p,vertices[0]));
          if(fraction===0)referencePoints.set(id,a.clone());
          else report.maxAnimatedMovement=Math.max(report.maxAnimatedMovement,a.distanceTo(referencePoints.get(id)));
          for(const vertex of vertices.slice(1)){mesh.applyBoneTransform(vertex,b.fromBufferAttribute(p,vertex));report.maxAnimatedCoincidentSeparation=Math.max(report.maxAnimatedCoincidentSeparation,a.distanceTo(b));report.duplicateChecks++;}
        }
      }
    }
  }
  mixer.stopAllAction();for(const {mesh} of surfaces)mesh.skeleton.pose();root.updateMatrixWorld(true);
  return{meshes:meshes.length,skinnedMeshes:surfaces.length,bones:boneSet.size,triangles:meshes.reduce((sum,mesh)=>sum+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3,0),animations:clips.map(clip=>({name:clip.name,duration:clip.duration,tracks:clip.tracks.length})),surfaces:surfaces.map(surface=>surface.report)};
}
const arg=name=>{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:null;};
const shapeCase=arg('--shape-stress');
assert.ok(shapeCase===null||['long','wide'].includes(shapeCase),'Shape stress case: long or wide');
const shapeStress=shapeCase==='long'?{earLength:1.4,earWidth:.7,earSpread:1.3,skullDepth:1.4,cheekWidth:.7,muzzleWidth:.7}:shapeCase==='wide'?{earLength:.7,earWidth:1.4,earSpread:.7,skullDepth:.7,cheekWidth:1.4,muzzleWidth:1.4}:{};
const referencePath='public/models/cat/runner-base.glb';
const referenceBytes=await readFile(referencePath);
const reference=await new GLTFLoader().parseAsync(referenceBytes.buffer.slice(referenceBytes.byteOffset,referenceBytes.byteOffset+referenceBytes.byteLength),'');
const referenceRig=inspectReferenceRig(reference.scene,reference.animations);
const artifactDirectory='/tmp/photo-cat-validation';await mkdir(artifactDirectory,{recursive:true});
const fileStem=arg('--glb')?basename(arg('--glb'),'.glb'):shapeCase?`shape-${shapeCase}-cat`:'generated-cat';
const generatedPath=join(artifactDirectory,`${fileStem}.glb`);
let generated;
if(arg('--glb')){
  generated={base64:(await readFile(arg('--glb'))).toString('base64'),metadata:null};
}else{
const {chromium}=await import('playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(arg('--url')||'http://localhost:5176');
  generated=await page.evaluate(async profile=>{
    const {createTemplateCat}=await import('/demos/photo-cat/template-cat.js');
    const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');
    let controlChecks;
    if(profile.testShapeControls){
      const keys=['earLength','earWidth','earSpread','skullDepth','cheekWidth','muzzleWidth'];
      const neutralProfile={...profile,shape:{}};
      const positions=root=>{const values=[];root.traverse(mesh=>{if(mesh.isSkinnedMesh)values.push(...mesh.geometry.attributes.position.array);});return values;};
      const omitted=positions(await createTemplateCat(neutralProfile));
      const explicit=positions(await createTemplateCat({...neutralProfile,shape:Object.fromEntries(keys.map(key=>[key,1]))}));
      if(omitted.length!==explicit.length||omitted.some((value,i)=>value!==explicit[i]))throw new Error('Explicit neutral controls must exactly match omitted controls');
      controlChecks={neutralMatchesOmitted:true,individual:{}};
      for(const key of keys){
        const changed=positions(await createTemplateCat({...neutralProfile,shape:{[key]:1.3}}));
        let affectedCoordinates=0,maxDisplacement=0;
        for(let i=0;i<omitted.length;i++){const delta=Math.abs(changed[i]-omitted[i]);if(delta>1e-7)affectedCoordinates++;maxDisplacement=Math.max(maxDisplacement,delta);}
        if(!affectedCoordinates)throw new Error(`Shape control ${key} does not affect geometry`);
        controlChecks.individual[key]={affectedCoordinates,maxDisplacement};
      }
    }
    let sourceSampleCalls=0;
    const root=await createTemplateCat({...profile,sampleFace:(u,v)=>{sourceSampleCalls++;return[Math.round(50+u*170),Math.round(45+v*130),70];}});
    const bytes=new Uint8Array(await new GLTFExporter().parseAsync(root,{binary:true,animations:root.animations,onlyVisible:false}));
    let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return{base64:btoa(text),controlChecks,sourceSampleCalls,metadata:root.userData,clipNames:root.animations.map(clip=>clip.name)};
  },{...profiles.tabby,shape:{...profiles.tabby.shape,headWidth:1.12,headHeight:.96,earSize:1.08,bodyWidth:1.1,...shapeStress},testShapeControls:!!shapeCase});
  assert.deepEqual(errors,[],'Browser template generation has no runtime errors');
}finally{await browser.close();}
}
await writeFile(generatedPath,Buffer.from(generated.base64,'base64'));
const serialized=await readFile(generatedPath);
assert.equal(serialized.readUInt32LE(0),0x46546c67,'Actual written artifact is a GLB');
const glbDocument=JSON.parse(serialized.toString('utf8',20,20+serialized.readUInt32LE(12)));
const embeddedImages=glbDocument.images||[];
assert.equal(glbDocument.buffers.length,1,'GLB has one embedded binary buffer');
assert.equal(glbDocument.buffers[0].uri,undefined,'No external geometry or animation buffer');
for(const image of embeddedImages){
  assert.equal(image.uri,undefined,'No external or data-URI texture dependencies');
  assert.ok(Number.isInteger(image.bufferView),'Texture pixels are embedded in the GLB BIN chunk');
  assert.ok(['image/png','image/jpeg','image/webp'].includes(image.mimeType),'Known embedded image type');
}
if(process.argv.includes('--require-texture'))assert.ok(embeddedImages.length>0,'Actual export contains an embedded face texture');
// Node has no image decoder. This plugin is used ONLY for geometry/rig checks;
// the exact same file is independently decoded and rendered in Chrome below.
let structuralTextureStubs=0;
const structuralLoader=new GLTFLoader().register(()=>({name:'NodeStructuralTextureStub',loadTexture(){structuralTextureStubs++;const texture=new Texture();texture.userData.structuralStub=true;return Promise.resolve(texture);}}));
const roundtrip=await structuralLoader.parseAsync(serialized.buffer.slice(serialized.byteOffset,serialized.byteOffset+serialized.byteLength),'');
let textureValidation={embeddedImages:0,decodedImages:0,rendered:false};
if(embeddedImages.length){
  const {chromium}=await import('playwright-core');
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error'&&/shader|texture|image/i.test(message.text()))errors.push(message.text());});
    await page.goto(arg('--url')||'http://localhost:5176');
    textureValidation=await page.evaluate(async base64=>{
      const THREE=await import('/node_modules/three/build/three.module.js');
      const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
      const bytes=Uint8Array.from(atob(base64),character=>character.charCodeAt(0));
      const gltf=await new GLTFLoader().parseAsync(bytes.buffer,'');
      const maps=new Map();gltf.scene.traverse(mesh=>{if(mesh.isMesh)for(const material of (Array.isArray(mesh.material)?mesh.material:[mesh.material]))if(material.map)maps.set(material.map.uuid,material.map);});
      const images=[...maps.values()].map(texture=>{
        const image=texture.image,width=image?.width||0,height=image?.height||0;
        if(!width||!height)return{width,height,uniqueSampleColors:0};
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
        const data=context.getImageData(0,0,width,height).data,colors=new Set();
        for(let i=0;i<data.length;i+=4)if(data[i+3]>0)colors.add(`${data[i]},${data[i+1]},${data[i+2]}`);
        return{width,height,uniqueColors:colors.size,palette:[...colors].slice(0,32)};
      });
      const scene=new THREE.Scene();scene.add(gltf.scene,new THREE.HemisphereLight(0xffffff,0x444444,2));
      const bounds=new THREE.Box3().setFromObject(gltf.scene,true),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()).length();
      const camera=new THREE.PerspectiveCamera(42,1,.01,100);camera.position.copy(center).add(new THREE.Vector3(size*.8,size*.45,size));camera.lookAt(center);
      const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(256,256);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
      const result={decodedImages:images.length,images,rendered:renderer.info.render.triangles>0,triangles:renderer.info.render.triangles,programsRunnable:renderer.info.programs.every(program=>program.diagnostics?.runnable!==false)};
      renderer.dispose();return result;
    },serialized.toString('base64'));
    assert.deepEqual(errors,[],'Actual embedded-texture GLB loads/renders without browser errors');
    assert.ok(textureValidation.decodedImages>0&&textureValidation.images.every(image=>image.width>0&&image.height>0),'Chrome decoded embedded face pixels');
    assert.ok(textureValidation.images.some(image=>image.uniqueColors>3),'Embedded face paint contains non-flat color detail');
    assert.ok(textureValidation.rendered&&textureValidation.programsRunnable,'Decoded texture renders on the actual GLB');
    textureValidation.embeddedImages=embeddedImages.length;
  }finally{await browser.close();}
}
const finalMetadata=generated.metadata||roundtrip.scene.children[0]?.userData;
function skinsForFacetCheck(root){const result=[];root.traverse(m=>{if(m.isMesh)result.push(m);});return result;}
if(process.argv.includes('--require-stylized')){
  assert.equal(finalMetadata.sourcePixelsEmbedded,false,'Source photograph pixels are not embedded');
  assert.equal(finalMetadata.stylizedFacePaint,true,'Export declares authored stylized face paint');
  if(generated.sourceSampleCalls!==undefined)assert.ok(generated.sourceSampleCalls<=144,'Photo sampler used only for coarse12×12 classification, not per-pixel texture copying');
  if(finalMetadata.perFacetColor){
    assert.equal(embeddedImages.length,0,'Approved sculpt uses face colors without a texture');
    for(const mesh of skinsForFacetCheck(roundtrip.scene)){
      const c=mesh.geometry.attributes.color;
      for(let i=0;i<c.count;i+=3)for(let k=1;k<3;k++)for(let channel=0;channel<3;channel++)assert.equal(c.array[i*3+channel],c.array[(i+k)*3+channel],'One color per face');
    }
  }else assert.ok(textureValidation.images?.length,'Styled paint atlas is actually decoded');
  for(const image of textureValidation.images||[]){
    assert.ok(image.uniqueColors<=10,'Face paint uses a small authored palette, not continuous source photo colors');
    if(Array.isArray(finalMetadata.facePaintPalette)){
      const palette=new Set(finalMetadata.facePaintPalette.map(color=>{
        assert.match(color,/^#[0-9a-f]{6}$/i,'Authored palette color format');
        return[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)).join(',');
      }));
      assert.ok(palette.size<=10,'Declared palette is bounded');
      for(const rgb of image.palette)assert.ok(palette.has(rgb),`Decoded face pixel belongs to authored palette: ${rgb}`);
    }
  }
}
const metrics=validateModel(roundtrip.scene),modifiedRig=inspectReferenceRig(roundtrip.scene,roundtrip.animations);
assert.ok(modifiedRig.surfaces.some(surface=>surface.maxAnimatedMovement>1e-4),'Run animation actually deforms the exported skin');
assert.equal(modifiedRig.triangles,referenceRig.triangles,'Approved-head runner triangle count is retained');
assert.equal(modifiedRig.skinnedMeshes,referenceRig.skinnedMeshes,'Skinned-mesh count retained');
assert.equal(modifiedRig.bones,referenceRig.bones,'Original skeleton bone count retained');
assert.deepEqual(modifiedRig.animations,referenceRig.animations,'Original clip names/duration/track counts retained');
// Non-indexed per-face colors duplicate attribute vertices; compare original
// triangle corners, skin influences and coincidence groups below instead.
const skins=root=>{const list=[];root.traverse(o=>{if(o.isSkinnedMesh)list.push(o);});return list;};
const originalSkins=skins(reference.scene),modifiedSkins=skins(roundtrip.scene);
let adjustedVertices=0,maxSkinWeightError=0,maxAnimatedSeparation=0,duplicateChecks=0,minTriangleAreaRatio=Infinity,normalRotationsOver90=0;
for(let n=0;n<originalSkins.length;n++){
  const original=originalSkins[n],modified=modifiedSkins[n],source=original.geometry,target=modified.geometry;
  const cornerCount=source.index?.count??source.attributes.position.count;
  assert.equal(target.index?.count??target.attributes.position.count,cornerCount,'Triangle corner count retained');
  const sourceAt=i=>source.index?.getX(i)??i,targetAt=i=>target.index?.getX(i)??i;
  for(let i=0;i<cornerCount;i++)for(let k=0;k<4;k++){
    const a=sourceAt(i)*4+k,b=targetAt(i)*4+k;
    assert.equal(target.attributes.skinIndex.array[b],source.attributes.skinIndex.array[a],'Corner bone index retained');
    maxSkinWeightError=Math.max(maxSkinWeightError,Math.abs(target.attributes.skinWeight.array[b]-source.attributes.skinWeight.array[a]));
  }
  assert.ok(maxSkinWeightError<1e-7,'Skin weights retained through serialization');
  assert.deepEqual(modified.skeleton.bones.map(b=>b.name),original.skeleton.bones.map(b=>b.name),'Bone names/order retained');
  for(let i=0;i<original.skeleton.bones.length;i++){
    const a=original.skeleton.bones[i],b=modified.skeleton.bones[i];
    assert.equal(b.parent?.isBone?b.parent.name:null,a.parent?.isBone?a.parent.name:null,'Bone hierarchy retained');
    original.skeleton.boneInverses[i].elements.forEach((v,j)=>assert.ok(Math.abs(v-modified.skeleton.boneInverses[i].elements[j])<1e-5,'Inverse bind matrix retained'));
  }
  const p=source.attributes.position,q=target.attributes.position,w=target.attributes.skinWeight,groups=new Map();
  assert.equal(target.index?.count??q.count,cornerCount,'Face expansion retains every original corner');
  const va=new Vector3(),vb=new Vector3(),vc=new Vector3(),ta=new Vector3(),tb=new Vector3(),tc=new Vector3(),sourceNormal=new Vector3(),targetNormal=new Vector3();
  for(let i=0;i<cornerCount;i+=3){
    const ia=sourceAt(i),ib=sourceAt(i+1),ic=sourceAt(i+2),ja=targetAt(i),jb=targetAt(i+1),jc=targetAt(i+2);
    va.fromBufferAttribute(p,ia);vb.fromBufferAttribute(p,ib);vc.fromBufferAttribute(p,ic);
    ta.fromBufferAttribute(q,ja);tb.fromBufferAttribute(q,jb);tc.fromBufferAttribute(q,jc);
    sourceNormal.crossVectors(vb.sub(va),vc.sub(va));targetNormal.crossVectors(tb.sub(ta),tc.sub(ta));
    const sourceArea=sourceNormal.length(),targetArea=targetNormal.length();
    if(sourceArea>1e-12){
      const ratio=targetArea/sourceArea;minTriangleAreaRatio=Math.min(minTriangleAreaRatio,ratio);
      assert.ok(targetArea>1e-12&&ratio>1e-6,'Morph does not collapse an originally nondegenerate triangle');
      if(sourceNormal.dot(targetNormal)<0)normalRotationsOver90++;
    }
  }

  for(let corner=0;corner<cornerCount;corner++){
    const i=targetAt(corner),originalIndex=sourceAt(corner);
    assert.ok([w.getX(i),w.getY(i),w.getZ(i),w.getW(i)].every(v=>Number.isFinite(v)&&v>=0),'Finite nonnegative skin weights');
    assert.ok(Math.abs(w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i)-1)<1e-5,'Normalized skin weights');
    if(Math.hypot(p.getX(originalIndex)-q.getX(i),p.getY(originalIndex)-q.getY(i),p.getZ(originalIndex)-q.getZ(i))>1e-6)adjustedVertices++;
    const key=[p.getX(originalIndex),p.getY(originalIndex),p.getZ(originalIndex)].map(v=>Math.round(v/1e-7)).join(',');
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);
  }
  // Use ORIGINAL coincidence groups, so a broken seam cannot escape detection
  // by becoming two distinct positions in the generated mesh.
  const a=new Vector3(),b=new Vector3(),mixer=new AnimationMixer(roundtrip.scene);
  for(const clip of roundtrip.animations){
    mixer.stopAllAction();modified.skeleton.pose();mixer.clipAction(clip).reset().play();
    for(const fraction of [0,.13,.37,.61,.89]){
      mixer.setTime(clip.duration*fraction);roundtrip.scene.updateMatrixWorld(true);modified.skeleton.update();
      for(const vertices of groups.values()){
        const first=vertices[0];modified.applyBoneTransform(first,a.fromBufferAttribute(q,first));
        for(const vertex of vertices.slice(1)){
          modified.applyBoneTransform(vertex,b.fromBufferAttribute(q,vertex));const separation=a.distanceTo(b);
          maxAnimatedSeparation=Math.max(maxAnimatedSeparation,separation);duplicateChecks++;
          assert.ok(separation<1e-4,'Original coincident vertices remain joined throughout sampled run poses');
        }
      }
    }
  }
  mixer.stopAllAction();modified.skeleton.pose();roundtrip.scene.updateMatrixWorld(true);
}
assert.ok(adjustedVertices>0,'Photo profile actually adjusts base mesh geometry');
assert.ok(duplicateChecks>0,'Original seam duplicates were exercised');
for(let i=0;i<reference.animations.length;i++){
  const a=reference.animations[i],b=roundtrip.animations[i];
  for(let j=0;j<a.tracks.length;j++){
    assert.equal(b.tracks[j].name,a.tracks[j].name,'Animation track targets retained');
    assert.deepEqual(Array.from(b.tracks[j].times),Array.from(a.tracks[j].times),'Animation key times retained');
    assert.equal(b.tracks[j].values.length,a.tracks[j].values.length);
    a.tracks[j].values.forEach((v,k)=>assert.ok(Math.abs(v-b.tracks[j].values[k])<1e-5,'Animation values retained'));
  }
}
const report={geometry:{minTriangleAreaRatio,normalRotationsOver90,note:"Normal rotations are reported; self-intersections are not exhaustively tested."},shapeCase,shapeStress,controlChecks:generated.controlChecks,inputGLB:arg('--glb')||'browser createTemplateCat',generatedPath,referencePath,referenceRig,modifiedRig,model:metrics,metadata:finalMetadata,sourceSampleCalls:generated.sourceSampleCalls,glbBytes:serialized.byteLength,textureValidation,structuralTextureStubs,adjustedVertices,maxSkinWeightError,duplicateChecks,maxAnimatedSeparation,synthetic:'color, pattern, guides, ambiguity and determinism passed',roundtrip:'actual disk GLB validated'};
if(arg('--photos')){
  const {chromium}=await import('playwright-core');
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{
    const page=await browser.newPage();await page.goto(arg('--url')||'http://localhost:5176');
    report.realPhotos=[];
    for(const filename of (await readdir(arg('--photos'))).filter(f=>/\.(png|jpe?g)$/i.test(f))){
      const bytes=await readFile(join(arg('--photos'),filename)),url=`data:image/${filename.endsWith('.png')?'png':'jpeg'};base64,${bytes.toString('base64')}`;
      const guidesByPhoto={alfie:{leftEye:{x:.376,y:.204},rightEye:{x:.541,y:.188},nose:{x:.463,y:.285}},lucas:{leftEye:{x:.351,y:.346},rightEye:{x:.590,y:.315},nose:{x:.517,y:.462}},orange:{leftEye:{x:.307,y:.558},rightEye:{x:.600,y:.458},nose:{x:.560,y:.681}}};
      const result=await page.evaluate(async ({url,guides})=>{
        const {analyzeCatPhoto}=await import('/demos/photo-cat/analyze.js');
        const image=new Image();image.src=url;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);
        const pixels=context.getImageData(0,0,image.width,image.height),profile=analyzeCatPhoto(pixels);
        const guided=guides?analyzeCatPhoto(pixels,{landmarks:guides}):null;
        return{guided:guided&&{colors:guided.colors,pattern:guided.pattern,faceCrop:guided.faceCrop,confidence:guided.confidence},colors:profile.colors,pattern:profile.pattern,crop:profile.crop,faceCrop:profile.faceCrop,landmarks:profile.landmarks,confidence:profile.confidence,unknowns:profile.unknowns,warnings:profile.warnings};
      },{url,guides:guidesByPhoto[filename.replace(/\..*$/,'')]});
      assert.ok(Object.values(result.colors).every(c=>/^#[0-9a-f]{6}$/.test(c)),'Real photo finite colors');
      assert.ok(result.warnings.length,'Real photo ambiguity surfaced');
      report.realPhotos.push({filename,...result});
    }
  }finally{await browser.close();}
}
await writeFile(join(artifactDirectory,`${fileStem}.report.json`),JSON.stringify(report,null,2));
if(!arg('--glb')&&!shapeCase)await writeFile(join(artifactDirectory,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
