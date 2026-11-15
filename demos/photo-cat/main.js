import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {applyPhysicalSize,SIZE_PRESETS,captureRestPose,copyRestPose} from './physical-size.js';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {analyzeCatPhoto} from './analyze.js';
import {createCat} from '../pet/rigged-cat.js';
import {createTemplateCat} from './template-cat.js';
import {createTemplateDog} from './template-dog.js';
import {createTemplatePomeranian} from './template-pomeranian.js';
import {createTemplateCatBreed} from './template-cat-breed.js';
import {createTemplatePersianCat} from './template-persian-cat.js';
import {createTemplateExpandedDog,EXPANDED_DOG_BASES} from './template-expanded-dog.js';
import {createTemplateSiameseCat} from './template-siamese-cat.js';
import {createTemplateSphynxCat} from './template-sphynx-cat.js';
import {createTemplateGoldenRetriever} from './template-golden-retriever.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const $=id=>document.getElementById(id), canvas=$('photo'),ctx=canvas.getContext('2d');
let sizeEdited=false;
let bitmap,data,analysis,profile,cat,fileName='cat',points={},guideStep=-1,showGuides=true,loadVersion=0,mixer=null,playing=false,lastFrame=0,reference=null,comparing=false,rebuildId=0,building=false,currentView='angle',framedPhotoVersion=-1,species='cat',activeClip=null;
const pointNames=['leftEye','rightEye','nose'],pointLabels=['照片左側眼睛','照片右側眼睛','鼻尖'];
const colorLabels={baseColor:'主要毛色',secondaryColor:'次要毛色',eyeColor:'眼睛',noseColor:'鼻子'};
const shapeLabels={headWidth:'臉寬',headHeight:'臉長',earSize:'耳朵大小',muzzleLength:'口鼻長度',bodyWidth:'身形',furLength:'輪廓蓬鬆度',skullDepth:'頭顱前後深度',cheekWidth:'臉頰寬度',muzzleWidth:'口鼻寬度',earLength:'耳長',earWidth:'耳寬',earSpread:'耳根間距',whiteCoverage:'白斑覆蓋比例',neckLength:'頸部長度'};
for(const [key,label] of Object.entries(colorLabels))$('colors').insertAdjacentHTML('beforeend',`<label>${label}<span class="color-inputs"><input type="color" id="${key}"><input class="hex-color" id="${key}Hex" aria-label="${label}色碼" type="text" maxlength="7" placeholder="#000000" spellcheck="false"></span></label>`);
for(const [key,label] of Object.entries(shapeLabels))$('shapes').insertAdjacentHTML('beforeend',`<label>${label}<input type="range" id="${key}" min="0.65" max="1.45" step="0.01" value="1"></label>`);
const detailRanges={cat:{earLength:[.7,1.4],earWidth:[.7,1.4],earSpread:[.7,1.3],skullDepth:[.7,1.4],cheekWidth:[.7,1.4],muzzleWidth:[.7,1.4]},dog:{earLength:[.5,3.5],earWidth:[.5,2.5],earSpread:[.6,1.6],skullDepth:[.6,1.5],cheekWidth:[.6,1.8],muzzleWidth:[.5,1.8]}};
function setDetailRanges(){for(const [key,[min,max]] of Object.entries(detailRanges[species])){$(key).min=min;$(key).max=max;}}
setDetailRanges();
const selectedBase=()=>species==='dog'?$('dogBase').value:$('catBase').value;
function resetSize(){sizeEdited=false;$('physicalHeight').value=SIZE_PRESETS[selectedBase()]?.cm||({poodle:45,chihuahua:25,dachshund:32,siamese:34,sphynx:32,'golden-retriever':75}[selectedBase()])||35;$('sizeNote').textContent='預設為比例估計，請依實際寵物校正；不由照片推算。';}
$('physicalHeight').oninput=()=>{sizeEdited=true;$('sizeNote').textContent='匯出採用此全高；預覽鏡頭仍會自動拉近。';};
resetSize();
const scene=new THREE.Scene();scene.background=new THREE.Color('#e8ede4');const catHolder=new THREE.Group();scene.add(catHolder);
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;$('stage').append(renderer.domElement);
const camera=new THREE.PerspectiveCamera(34,1,.01,100);camera.position.set(0,1.65,5.7);
const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.set(0,1.25,0);orbit.minDistance=.8;orbit.maxDistance=16;orbit.maxPolarAngle=Math.PI*.52;orbit.enableDamping=true;
scene.add(new THREE.HemisphereLight(0xffffff,0xa2a59e,1.65));const light=new THREE.DirectionalLight(0xfffaf2,2.4);light.position.set(-3,5,4);light.castShadow=true;light.shadow.mapSize.set(1024,1024);Object.assign(light.shadow.camera,{left:-3.5,right:3.5,top:4,bottom:-2,near:.1,far:15});light.shadow.bias=-.0001;light.shadow.normalBias=.018;scene.add(light);
const floor=new THREE.Mesh(new THREE.CylinderGeometry(1.05,1.1,.08,64),new THREE.MeshStandardMaterial({color:'#d3ddc9',roughness:1}));floor.position.y=-.04;floor.receiveShadow=true;scene.add(floor);
new ResizeObserver(()=>{const {width,height}=$('stage').getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();}).observe($('stage'));
renderer.setAnimationLoop(time=>{const delta=Math.min(.05,(time-lastFrame)/1000||0);lastFrame=time;if(playing){mixer?.update(delta);if(comparing)reference?.update(delta)}orbit.update();renderer.render(scene,camera);});
function dispose(group){if(group===cat){mixer?.stopAllAction();mixer?.uncacheRoot(group);mixer=null;}const materials=new Set();group.traverse(o=>{o.skeleton?.dispose();o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m)});materials.forEach(m=>{m.map?.dispose();m.dispose()});}
function faceFrame(){
  const {leftEye:l,rightEye:r,nose:n}=analysis.landmarks;
  if(!l||!r||!n){const c=analysis.faceCrop;return {span:c.width*data.width/2,cos:1,sin:0,mx:(c.x+c.width/2)*data.width,my:(c.y+c.height*.4)*data.height,noseDrop:c.height*data.height*.24}}
  const dx=(r.x-l.x)*data.width,dy=(r.y-l.y)*data.height,span=Math.max(5,Math.hypot(dx,dy)),cos=dx/span,sin=dy/span;
  const mx=(l.x+r.x)*data.width/2,my=(l.y+r.y)*data.height/2;
  const noseDrop=Math.max(span*.22,Math.min(span*.9,-(n.x*data.width-mx)*sin+(n.y*data.height-my)*cos));
  return {span,cos,sin,mx,my,noseDrop};
}
function sampleFace(u,v){
  const f=faceFrame(),dx=(u-.5)*f.span*2;
  const dy=v<.4?(v-.4)*f.span*1.375:(v-.4)*f.noseDrop/.24;
  const x=Math.max(0,Math.min(data.width-1,Math.round(f.mx+dx*f.cos-dy*f.sin))),y=Math.max(0,Math.min(data.height-1,Math.round(f.my+dx*f.sin+dy*f.cos)));
  return Array.from(data.data.slice((y*data.width+x)*4,(y*data.width+x)*4+3));
}
async function rebuild(){
  if(!profile)return;const id=++rebuildId;building=true;$('export').disabled=true;
  try{
    const landmarks={leftEye:{x:.25,y:.4},rightEye:{x:.75,y:.4},nose:{x:.5,y:.64}};
    const key=selectedBase();const create=species==='dog'?(key==='golden-retriever'?createTemplateGoldenRetriever:EXPANDED_DOG_BASES[key]?createTemplateExpandedDog:key==='pomeranian'?createTemplatePomeranian:createTemplateDog):(key==='sphynx'?createTemplateSphynxCat:key==='siamese'?createTemplateSiameseCat:key==='persian'?createTemplatePersianCat:key==='runner'?createTemplateCat:createTemplateCatBreed);
    const next=await create({...profile,baseModel:selectedBase(),landmarks,sampleFace:$('mapping').checked?sampleFace:undefined});
    if(id!==rebuildId){dispose(next);return}
    if(cat){catHolder.remove(cat);dispose(cat)}cat=next;catHolder.add(cat);captureRestPose(cat);setupMotion();if(framedPhotoVersion!==loadVersion){fitView();framedPhotoVersion=loadVersion}$('stats').textContent=`${cat.userData.triangleCount.toLocaleString()} 三角面 · ${cat.animations?.length?'原骨架與動畫':'靜態基底，尚未綁骨架'}`;for(const key of [...Object.keys(shapeLabels),'earDrop'])$(key).disabled=!(cat.userData.shapeControls||[]).includes(key);if(cat.userData.sourceLimitations?.length)$('status').textContent='此德牧基底已移除背包；原網格仍帶有領巾與腰帶輪廓，尚待清理。';for(const colorKey of Object.keys(colorLabels)){const enabled=!cat.userData.colorControls||cat.userData.colorControls.includes(colorKey);$(colorKey).disabled=$(colorKey+'Hex').disabled=!enabled;}const paletteOnly=Boolean(EXPANDED_DOG_BASES[selectedBase()]);$('mapping').disabled=paletteOnly;$('pattern').disabled=paletteOnly;if(paletteOnly)$('status').textContent='此基底目前支援參考色盤與尺寸；局部輪廓與臉部花紋尚待適配。';const credit=cat.userData.attribution;if(credit){$('referenceCredit').textContent='基底來源：';const link=document.createElement('a');link.href=credit.source;link.textContent=credit.author+' · '+credit.title;link.target='_blank';link.rel='noopener';$('referenceCredit').append(link,document.createTextNode(' · '+credit.license));}
  }catch(e){$('status').textContent=`模型建立失敗：${e.message}`}
  finally{if(id===rebuildId){building=false;$('export').disabled=!cat}}
}
function drawPhoto(){if(!bitmap)return;ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);if(!showGuides)return;if(analysis){const c=analysis.faceCrop;ctx.strokeStyle='#b9efd3';ctx.lineWidth=2;ctx.setLineDash([5,4]);ctx.strokeRect(c.x*canvas.width,c.y*canvas.height,c.width*canvas.width,c.height*canvas.height);ctx.setLineDash([])}Object.entries(points).forEach(([key,p])=>{ctx.beginPath();ctx.arc(p.x*canvas.width,p.y*canvas.height,6,0,Math.PI*2);ctx.fillStyle='#3b7656';ctx.fill();ctx.strokeStyle='white';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='white';ctx.font='12px sans-serif';ctx.fillText(String(pointNames.indexOf(key)+1),p.x*canvas.width+9,p.y*canvas.height-7)});}
function analyze(manual=false){analysis=analyzeCatPhoto(data,manual?{landmarks:points}:{});profile={species,baseModel:selectedBase(),shape:{...Object.fromEntries(Object.keys(shapeLabels).map(key=>[key,1])),...analysis.shape,earDrop:0},colors:{...analysis.colors},pattern:analysis.pattern};if(species==='dog'){profile.shape.headWidth=1;profile.shape.headHeight=1;analysis.warnings.push('狗的吻長、耳型與體型需手動確認；請先選擇與照片相符的犬種基底。')} $('earDrop').value=profile.shape.earDrop;if(!manual)points={...analysis.landmarks};for(const key of Object.keys(colorLabels)){$(key).value=profile.colors[key];$(key+'Hex').value=profile.colors[key]}for(const key of Object.keys(shapeLabels))$(key).value=profile.shape[key]||1;$('pattern').value=profile.pattern;analysis.warnings.push('耳長、耳寬、耳根間距與頭顱／臉頰比例尚需對照照片手動確認。');drawPhoto();rebuild();$('analysis').textContent=[...(analysis.observations||[]),...(analysis.warnings||[]),...(analysis.unknowns||[]).map(key=>({bodyWidth:'身形待確認',muzzleLength:'口鼻深度待確認',earSize:'耳朵大小待確認',earTilt:'耳朵角度待確認',furLength:'毛量待確認',headWidth:'臉寬待確認',headHeight:'臉長待確認',eyeColor:'瞳色待確認',eyeLandmarks:'眼睛位置待確認',noseLandmark:'鼻尖位置待確認'}[key]||key))].join('；').replaceAll('貓臉','寵物臉部');$('status').textContent=manual?'已依三個定位點重新建立。請確認臉部花色，再微調輪廓。':'已產生初稿。自動定位可能誤判，建議標記雙眼與鼻尖再比對。';}
$('upload').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;const version=++loadVersion;try{if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024)throw Error('請使用 20 MB 以下的 JPG、PNG 或 WebP。');const next=await createImageBitmap(file);if(version!==loadVersion){next.close();return}if(next.width*next.height>60e6){next.close();throw Error('照片尺寸過大，請先縮小至 6,000 萬畫素以下。')}bitmap?.close();bitmap=next;const scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);data=ctx.getImageData(0,0,canvas.width,canvas.height);fileName=file.name.replace(/\.[^.]+$/,'').replace(/[^\p{L}\p{N}_-]/gu,'_')||'cat';guideStep=-1;$('empty').hidden=true;analyze();['guide','overlays','reanalyze','report'].forEach(id=>$(id).disabled=false);}catch(error){$('status').textContent=error.message}});
$('guide').onclick=()=>{showGuides=true;$('overlays').textContent='隱藏定位';$('overlays').setAttribute('aria-pressed','true');guideStep=0;points={};drawPhoto();$('guideStatus').textContent=`請點選${pointLabels[0]}（1 / 3）`;};
canvas.addEventListener('pointerdown',e=>{if(guideStep<0)return;const r=canvas.getBoundingClientRect();points[pointNames[guideStep]]={x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};guideStep++;drawPhoto();if(guideStep===3){if(points.rightEye.x-points.leftEye.x<.025){$('guideStatus').textContent='雙眼順序或間距不正確，請重新標記。';guideStep=-1;return}guideStep=-1;analyze(true);$('guideStatus').textContent='定位完成 · 虛線為臉部取樣範圍'}else $('guideStatus').textContent=`請點選${pointLabels[guideStep]}（${guideStep+1} / 3）`;});
for(const key of Object.keys(colorLabels))$(key).oninput=()=>{if(profile){profile.colors[key]=$(key).value;$(key+'Hex').value=$(key).value;rebuild()}};
for(const key of Object.keys(shapeLabels))$(key).oninput=()=>{if(profile){profile.shape[key]=Number($(key).value);rebuild()}};
$('pattern').onchange=()=>{if(profile){profile.pattern=$('pattern').value;rebuild()}};$('mapping').onchange=rebuild;$('reanalyze').onclick=()=>analyze();
function headBounds(root){
  const box=new THREE.Box3(),point=new THREE.Vector3();root.updateMatrixWorld(true);
  root.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight,positions=mesh.geometry.attributes.position;if(!indices||!weights)return;const heads=new Set(mesh.skeleton.bones.map((bone,i)=>/^head(?:_|$)/i.test(bone.name)?i:-1).filter(i=>i>=0));if(!heads.size)return;mesh.skeleton.update();for(let i=0;i<positions.count;i++){let headWeight=0;for(let k=0;k<4;k++)if(heads.has(indices.getComponent(i,k)))headWeight+=weights.getComponent(i,k);if(headWeight<.4)continue;mesh.getVertexPosition(i,point);box.expandByPoint(point.applyMatrix4(mesh.matrixWorld));}});
  if(box.isEmpty()){box.setFromObject(root,true);box.min.y=box.min.y+(box.max.y-box.min.y)*.48;}
  return box;
}
function fitView(name=currentView){
  currentView=name;if(!cat)return;cat.updateMatrixWorld(true);
  const box=name==='face'?headBounds(catHolder):new THREE.Box3().setFromObject(catHolder,true);if(comparing&&reference)box.union(name==='face'?headBounds(reference.root):new THREE.Box3().setFromObject(reference.root,true));
  const center=box.getCenter(new THREE.Vector3()),direction=new THREE.Vector3(...({face:[0,.03,1],front:[0,.08,1],angle:[.85,.35,1],side:[1,.15,0]}[name])).normalize();
  const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right),tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));let distance=1;
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=new THREE.Vector3(x,y,z).sub(center);distance=Math.max(distance,Math.abs(p.dot(up))/tan+p.dot(direction),Math.abs(p.dot(right))/(tan*camera.aspect)+p.dot(direction))}
  camera.position.copy(center).addScaledVector(direction,distance*1.15);orbit.target.copy(center);orbit.update();
}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>fitView(b.dataset.view));
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)}
$('export').onclick=async()=>{if(!cat||building)return;$('export').disabled=true;try{const exportRoot=copyRestPose(cat,cloneSkeleton(cat));exportRoot.animations=cat.animations||[];applyPhysicalSize(exportRoot,{axis:'y',cm:Number($('physicalHeight').value),estimated:!sizeEdited});const glb=await new GLTFExporter().parseAsync(exportRoot,{binary:true,animations:exportRoot.animations});download(new Blob([glb],{type:'model/gltf-binary'}),`${fileName}-low-poly.glb`);$('status').textContent=cat.animations?.length?'GLB 已匯出，保留基底骨架、原有動畫與重新繪製的毛色。':'靜態 GLB 已匯出，包含重新繪製的毛色；此基底尚未綁骨架。'}catch(e){$('status').textContent=`匯出失敗：${e.message}`}finally{$('export').disabled=false}};
$('report').onclick=()=>download(new Blob([JSON.stringify({method:'local-photo-finetuned-rigged-template-v1',profile,analysis,geometry:cat.userData,identitySimilarityScore:null,limitations:['未執行身份辨識或完整三維重建','背面、身形與遮擋處為推估','照片僅作為配色與花紋分布參考；臉部重新繪製，請人工比對']},null,2)],{type:'application/json'}),`${fileName}-analysis.json`);

function setupMotion(){
  mixer?.stopAllAction();mixer=null;const clips=cat.animations||[];$('motion').disabled=!clips.length;$('rest').disabled=!clips.length;
  activeClip=clips.find(c=>/run|gallop/i.test(c.name))||clips.find(c=>/walk/i.test(c.name))||clips[0];if(activeClip){mixer=new THREE.AnimationMixer(cat);mixer.clipAction(activeClip).play()}
  $('motion').textContent=playing&&clips.length?'暫停動作':'播放動作';
}
$('motion').onclick=()=>{playing=!playing;reference?.setMode(playing?'run':'pause');$('motion').textContent=playing?'暫停動作':'播放動作'};

$('compare').onclick=async()=>{
  try{
    if(!reference){reference=species==='dog'||$('catBase').value!=='runner'?await createDogReference():await createCat({model:'runner'});reference.setMode('rest');const box=new THREE.Box3().setFromObject(reference.root,true),factor=2.8/Math.max(...box.getSize(new THREE.Vector3()).toArray());reference.root.scale.multiplyScalar(factor);reference.root.position.z-=(box.min.z+box.max.z)*.5*factor;reference.root.position.x=-1.25;scene.add(reference.root);}
    comparing=!comparing;reference.root.visible=comparing;reference.setMode(playing?'run':'rest');catHolder.position.x=comparing?1.15:0;
    fitView();$('compare').textContent=comparing?'結束對照':'對照原模型';
    $('status').textContent=comparing?`左：原${species==='dog'?'狗':'貓'}模型；右：重新著色模型。播放動作可檢查接縫與變形。`:'已回到照片模型。';
  }catch(e){$('status').textContent=`參考模型載入失敗：${e.message}`}
};

$('rest').onclick=()=>{playing=false;mixer?.stopAllAction();if(activeClip)mixer.clipAction(activeClip).reset().play();reference?.setMode('rest');$('motion').textContent='播放動作';fitView()};

$('overlays').onclick=()=>{showGuides=!showGuides;$('overlays').textContent=showGuides?'隱藏定位':'顯示定位';$('overlays').setAttribute('aria-pressed',String(showGuides));drawPhoto()};

function clearReference(){if(reference){reference.root.removeFromParent();reference.dispose();reference=null}comparing=false;catHolder.position.x=0;$('compare').textContent='對照原模型';framedPhotoVersion=-1;}
$('species').onchange=()=>{
  species=$('species').value;resetSize();setDetailRanges();clearReference();$('muzzleLength').min=species==='dog'?'0.2':'0.65';$('muzzleLength').max=species==='dog'?'1.6':'1.45';$('pattern').querySelector('[value=calico]').textContent=species==='dog'?'三色':'三花';$('pattern').querySelector('[value=tortoiseshell]').textContent=species==='dog'?'深色混斑':'玳瑁';$('dogBaseRow').hidden=$('earDropRow').hidden=species!=='dog';$('catBaseRow').hidden=species!=='cat';
  $('referenceCredit').innerHTML=species==='dog'?'對照模型：<a href="https://quaternius.com/packs/ultimateanimatedanimals.html" target="_blank" rel="noopener">Quaternius · Ultimate Animated Animals</a>，CC0 1.0。':'對照模型：<a href="https://sketchfab.com/3d-models/lowpoly-cat-rig-run-animation-c36df576c9ae4ed28e89069b1a2f427a" target="_blank" rel="noopener">Daily Lowpoly · Lowpoly Cat Rig + Run Animation</a>，CC BY 4.0。';
  if(data)analyze();
};
$('catBase').onchange=()=>{resetSize();clearReference();if(profile){profile.baseModel=selectedBase();rebuild()}};
$('dogBase').onchange=()=>{resetSize();clearReference();if(profile){profile.baseModel=$('dogBase').value;rebuild()}};
$('earDrop').oninput=()=>{if(profile){profile.shape.earDrop=Number($('earDrop').value);rebuild()}};
async function createDogReference(){
  const asset=await new GLTFLoader().loadAsync(`../../models/${species==='dog'?'dog':'cat'}/${['siamese','sphynx'].includes(selectedBase())?selectedBase()+'-lowpoly':selectedBase()}.glb`),root=asset.scene;
  root.traverse(o=>{if(o.isMesh){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.flatShading=true;m.roughness=.95}o.frustumCulled=false}});
  const animation=asset.animations.find(c=>/run|gallop/i.test(c.name))||asset.animations.find(c=>/walk/i.test(c.name))||asset.animations[0],refMixer=new THREE.AnimationMixer(root);let action=animation?refMixer.clipAction(animation):null,mode='rest';
  return{root,setMode(next){if(next==='rest'){refMixer.stopAllAction()}else if(mode==='rest'){action?.reset().play()}mode=next;},update(dt){if(mode==='run')refMixer.update(dt)},dispose(){refMixer.stopAllAction();refMixer.uncacheRoot(root);dispose(root)}};
}

for(const key of Object.keys(colorLabels))$(key+'Hex').onchange=()=>{
  const input=$(key+'Hex'),value=input.value.trim();if(!/^#[0-9a-f]{6}$/i.test(value)){input.setCustomValidity('請輸入 # 加六位十六進位色碼');input.reportValidity();return}input.setCustomValidity('');$(key).value=value;if(profile){profile.colors[key]=value;rebuild()}
};

for(const key of Object.keys(colorLabels))$(key+'Hex').oninput=()=>{const value=$(key+'Hex').value.trim();if(/^#[0-9a-f]{6}$/i.test(value)){$(key+'Hex').setCustomValidity('');$(key).value=value;if(profile){profile.colors[key]=value;rebuild()}}};
