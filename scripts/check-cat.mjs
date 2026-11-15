// node scripts/check-cat.mjs http://localhost:5177
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {AnimationMixer,Vector3} from 'three';
const base=process.argv[2]||'http://localhost:5173';
const output='bench/out/approved-head';await mkdir(output,{recursive:true});
const load=async path=>{const b=await readFile(path);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');};
const source=await load('public/models/lowpoly_cat_rig__run_animation.glb');
const derived=await load('public/models/cat/runner-base.glb');
const skins=root=>{const ms=[];root.traverse(o=>{if(o.isSkinnedMesh)ms.push(o);});return ms;};
assert.equal(derived.animations.length,source.animations.length);
for(let i=0;i<source.animations.length;i++){
  const a=source.animations[i],b=derived.animations[i];
  assert.equal(a.duration,b.duration);
  assert.equal(b.tracks.length,53*3,'All rebased joint transforms are baked');
}
for(const mesh of skins(derived.scene)){
  assert.equal(mesh.skeleton.bones.length,53);
  for(const side of ['L','R'])assert.ok(mesh.skeleton.bones.some(b=>b.name===`ear_root${side}`));
  if(mesh.userData.approvedCatHead||mesh.userData.approvedHeadNeck){
    assert.deepEqual(Object.keys(mesh.morphTargetDictionary),['Head width','Cheek fullness','Muzzle projection','Ear height']);
    assert.equal(mesh.geometry.attributes.uv,undefined);
    if(mesh.userData.approvedCatHead){
      assert.equal(mesh.geometry.attributes.color,undefined,'The attached head has no baked vertex colors');
      assert.ok(mesh.material.isMeshStandardMaterial,'Neutral head responds to the same light as the body');
      assert.equal(mesh.material.map,null);
    }
  }
}
const approvedBytes=await readFile('public/models/cat/cat-head-approved.glb');
const neutralBytes=await readFile('public/models/cat/cat-head-uncolored.glb');
const approved=await new GLTFLoader().parseAsync(approvedBytes.buffer.slice(approvedBytes.byteOffset,approvedBytes.byteOffset+approvedBytes.byteLength),'');
const neutral=await new GLTFLoader().parseAsync(neutralBytes.buffer.slice(neutralBytes.byteOffset,neutralBytes.byteOffset+neutralBytes.byteLength),'');
const plainMeshes=root=>{const a=[];root.traverse(m=>{if(m.isMesh)a.push(m);});return a;};
const approvedMeshes=plainMeshes(approved.scene),neutralMeshes=plainMeshes(neutral.scene);
assert.equal(neutralMeshes.length,approvedMeshes.length);
neutralMeshes.forEach((mesh,i)=>{
  const a=approvedMeshes[i].geometry,b=mesh.geometry;
  assert.ok(a.attributes.color,'Original approved head retains its colors');
  assert.equal(b.attributes.color,undefined,'Saved neutral head has no vertex colors');
  assert.deepEqual(b.attributes.position.array,a.attributes.position.array,'Neutral copy preserves sculpt geometry');
  assert.deepEqual(b.attributes.normal.array,a.attributes.normal.array);
  assert.deepEqual(b.index.array,a.index.array);
  b.morphAttributes.position.forEach((m,j)=>assert.deepEqual(m.array,a.morphAttributes.position[j].array,'Neutral copy preserves all head morphs'));
  assert.ok(mesh.material.isMeshStandardMaterial);
  assert.equal(mesh.material.color.r,mesh.material.color.g);assert.equal(mesh.material.color.g,mesh.material.color.b);
});
await assert.rejects(access('public/models/low_poly_cat.glb'),'Removed static asset must not exist');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/demos/pet/index.html`);await page.waitForFunction(()=>window.__pet);
  assert.deepEqual(await page.locator('#model option').evaluateAll(options=>options.map(o=>o.value)),['runner']);
  await page.locator('#reset').click();await page.locator('[data-mode=rest]').click();
  const deformation=await page.evaluate(()=>{
    const cat=__pet.cat,groups=new Map(),p=cat.root.position.clone();
    for(const mesh of cat.meshes){const pos=mesh.geometry.attributes.position;
      for(let i=0;i<pos.count;i++){
        const key=[pos.getX(i),pos.getY(i),pos.getZ(i)].map(v=>Math.round(v*1e7)).join(',');
        if(!groups.has(key))groups.set(key,[]);groups.get(key).push({mesh,i});
      }
    }
    const defaults={...cat.params};let maxSeam=0,checks=0,crossMeshChecks=0,maxMotion=0;let previous;
    for(const extreme of [{head:.9,ears:.85,tail:.85,size:.7},{head:1.15,ears:1.2,tail:1.15,size:1.4}]){
      cat.setParams({...defaults,...extreme});
      for(const morph of [null,0,1,2,3]){
        for(const mesh of cat.meshes)if(mesh.morphTargetInfluences)mesh.morphTargetInfluences.fill(0);
        if(morph!==null)for(const mesh of cat.meshes)if(mesh.morphTargetInfluences)mesh.morphTargetInfluences[morph]=1;
        for(let frame=0;frame<30;frame++){
          cat.seek(frame*cat.duration/30);
          for(const entries of groups.values()){
            const first=entries[0],a=first.mesh.getVertexPosition(first.i,p).applyMatrix4(first.mesh.matrixWorld).clone();
            if(!a.toArray().every(Number.isFinite))throw new Error('Non-finite animated vertex');
            for(const entry of entries.slice(1)){
              const q=entry.mesh.getVertexPosition(entry.i,p).applyMatrix4(entry.mesh.matrixWorld);
              maxSeam=Math.max(maxSeam,a.distanceTo(q));checks++;
              if(entry.mesh!==first.mesh)crossMeshChecks++;
            }
          }
          const head=cat.meshes.find(m=>m.userData.headPart==='surface');
          const q=head.getVertexPosition(0,p).applyMatrix4(head.matrixWorld).clone();
          if(previous)maxMotion=Math.max(maxMotion,q.distanceTo(previous));previous=q;
        }
      }
    }
    for(const mesh of cat.meshes)if(mesh.morphTargetInfluences)mesh.morphTargetInfluences.fill(0);
    cat.setParams(defaults);cat.setMode('rest');
    return{triangles:cat.triangles,bones:cat.bones.length,meshes:cat.meshes.length,maxSeam,checks,crossMeshChecks,maxMotion};
  });
  assert.equal(deformation.triangles,1550);assert.equal(deformation.bones,53);assert.equal(deformation.meshes,5);
  assert.ok(deformation.maxSeam<1e-6,JSON.stringify(deformation));assert.ok(deformation.crossMeshChecks>0);assert.ok(deformation.maxMotion>.001);
  await page.evaluate(()=>{__pet.camera.position.set(.64,.4,1.05);__pet.controls.target.set(0,.16,0);__pet.controls.update();});
  await page.screenshot({path:`${output}/runner-rest.png`});
  await page.evaluate(()=>{__pet.camera.position.set(0,.31,.95);__pet.controls.target.set(0,.2,.13);__pet.controls.update();});
  await page.screenshot({path:`${output}/runner-front.png`});
  await page.evaluate(()=>{__pet.camera.position.set(.94,.3,0);__pet.controls.target.set(0,.16,0);__pet.controls.update();});
  await page.screenshot({path:`${output}/runner-side.png`});
  await page.locator('#color').fill('#48434b');
  assert.ok(await page.evaluate(()=>__pet.cat.meshes.filter(m=>m.userData.approvedCatHead).every(m=>m.material.color.getHexString()==='48434b')),'Uncolored head and body must share the same coat tint');
  await page.locator('#head').fill('1.15');await page.locator('#ears').fill('1.2');await page.locator('#tail').fill('1.15');await page.locator('#size').fill('1.2');
  await page.locator('#name').fill('確認版貓頭');await page.locator('#timeline').fill('0.375');
  await page.evaluate(()=>{__pet.camera.position.set(.74,.43,1.05);__pet.controls.target.set(0,.17,0);__pet.controls.update();});
  await page.screenshot({path:`${output}/runner-run.png`});
  const posed=await page.evaluate(()=>{
    const cat=__pet.cat;cat.seek(.375);const p=cat.root.position.clone();
    return cat.meshes.map(mesh=>({name:mesh.name,vertices:Array.from({length:mesh.geometry.index?.count??mesh.geometry.attributes.position.count},(_,i)=>mesh.getVertexPosition(mesh.geometry.index?.getX(i)??i,p).applyMatrix4(mesh.matrixWorld).toArray())}));
  });
  const pending=page.waitForEvent('download');await page.click('#download');await(await pending).saveAs(`${output}/runner-export.glb`);
  const imported=await load(`${output}/runner-export.glb`),mixer=new AnimationMixer(imported.scene);
  mixer.clipAction(imported.animations[0]).play();mixer.setTime(.375);imported.scene.updateMatrixWorld(true);
  const p=new Vector3();let maxExportError=0;
  const importedMeshes=skins(imported.scene);
  for(const original of posed){
    const mesh=importedMeshes.find(m=>m.name===original.name);assert.ok(mesh,original.name);
    original.vertices.forEach((v,i)=>{mesh.getVertexPosition(mesh.geometry.index?.getX(i)??i,p).applyMatrix4(mesh.matrixWorld);maxExportError=Math.max(maxExportError,p.distanceTo(new Vector3(...v)));});
    const n=mesh.geometry.attributes.normal;
    for(let i=0;i<n.count;i+=3)for(let k=1;k<3;k++)for(let c=0;c<3;c++)assert.equal(n.array[i*3+c],n.array[(i+k)*3+c],'Exported facets keep face normals');
  }
  assert.ok(maxExportError<1e-5,`Export deformation mismatch ${maxExportError}`);
  await page.reload();await page.waitForFunction(()=>window.__pet);
  assert.equal(await page.locator('#name').inputValue(),'確認版貓頭');assert.equal(await page.locator('#head').inputValue(),'1.15');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${output}/runner-mobile.png`,fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // A saved selection for the removed model migrates to the surviving runner.
  await page.evaluate(()=>{const key='lowpoly-rigged-cat-v1';localStorage.setItem(key,JSON.stringify({...__pet.cat.params,model:'detailed'}));});
  await page.reload();await page.waitForFunction(()=>window.__pet);assert.equal(await page.locator('#model').inputValue(),'runner');
  await page.locator('#reset').click();
  // The photo adapter uses this same sculpt; no generated eye atlas covers it.
  const photo=await page.evaluate(async()=>{
    const {createTemplateCat}=await import('/demos/photo-cat/template-cat.js');
    const root=await createTemplateCat({pattern:'bicolor',colors:{baseColor:'#222222',secondaryColor:'#eeeeee'},shape:{headWidth:1.12,earLength:1.15,cheekWidth:1.2}});
    let faces=0,headParts=0;root.traverse(m=>{if(!m.isMesh)return;const g=m.geometry,c=g.attributes.color;
      if(m.userData.approvedCatHead)headParts++;
      if(g.attributes.uv||m.material.map)throw new Error('Photo adapter must not overlay the sculpt with a texture');
      for(let i=0;i<c.count;i+=3){faces++;for(let k=1;k<3;k++)for(let channel=0;channel<3;channel++)if(c.array[i*3+channel]!==c.array[(i+k)*3+channel])throw new Error('Interpolated face colors');}
    });return{faces,headParts,animations:root.animations.length};
  });
  assert.deepEqual(photo,{faces:1550,headParts:3,animations:1});
  assert.deepEqual(errors,[]);
  const report={deformation,maxExportError,photo,removedModelFallback:'runner',animation:'Blender world poses baked for the connected 53-joint rig',inverseBindMatrices:'rebased to current Blender rest pose',errors};
  await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
