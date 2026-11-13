// Run against a Vite dev server: node scripts/check-cat.mjs http://localhost:5174
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AnimationMixer, Vector3 } from 'three';
const base = process.argv[2] || 'http://localhost:5173';
await mkdir('bench/out', { recursive: true });
const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(`${m.text()} ${m.location().url}`); });
  await page.goto(`${base}/demos/pet/index.html`);
  await page.waitForFunction(() => window.__pet);
  await page.click('[data-mode=rest]');
  await page.screenshot({ path: 'bench/out/cat-rest.png' });
  // Test both ends of every supported proportion over the full animation cycle.
  const deformation = await page.evaluate(() => {
    const {cat} = window.__pet, mesh = cat.meshes[0], g = mesh.geometry;
    const p = mesh.position.clone();
    const groups = new Map();
    for (let i = 0; i < g.attributes.position.count; i++) {
      p.fromBufferAttribute(g.attributes.position, i);
      const key = p.toArray().join(',');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    const defaults = {...cat.params}; let maxSeam = 0;
    for (const extreme of [{head:.9,ears:.85,tail:.85,size:.7}, {head:1.15,ears:1.2,tail:1.15,size:1.4}]) {
      cat.setParams({...defaults,...extreme});
      for (let frame = 0; frame < 30; frame++) {
        cat.seek(frame * cat.duration / 30);
        for (const ids of groups.values()) {
          const first = mesh.getVertexPosition(ids[0], p).clone();
          if (!first.toArray().every(Number.isFinite)) throw new Error('Non-finite skinned vertex');
          for (const i of ids.slice(1)) maxSeam = Math.max(maxSeam, first.distanceTo(mesh.getVertexPosition(i, p)));
        }
      }
    }
    cat.setParams(defaults);
    return {maxSeam, triangles:g.index.count/3, bones:mesh.skeleton.bones.length};
  });
  assert.equal(deformation.triangles,794); assert.equal(deformation.bones,35);
  assert.ok(deformation.maxSeam < 1e-6, JSON.stringify(deformation));
  await page.locator('#head').fill('1.15');
  await page.locator('#ears').fill('1.2');
  await page.locator('#tail').fill('1.15');
  await page.locator('#size').fill('1.2');
  await page.locator('#name').fill('測試貓');
  await page.locator('#color').fill('#c68c50');
  await page.locator('#timeline').fill('0.375');
  await page.locator('#wireframe').check();
  await page.screenshot({path:'bench/out/cat-wireframe.png'});
  await page.locator('#wireframe').uncheck();
  const sourceVertices = await page.evaluate(() => {
    const cat=__pet.cat;cat.seek(.375);const mesh=cat.meshes[0], p=mesh.position.clone();
    return Array.from({length:mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count},(_,i)=>mesh.getVertexPosition(mesh.geometry.index?.getX(i) ?? i,p).applyMatrix4(mesh.matrixWorld).toArray());
  });
  const downloadPromise = page.waitForEvent('download');
  await page.click('#download');
  const download=await downloadPromise;
  await download.saveAs('bench/out/custom-cat.glb');
  const bytes=await readFile('bench/out/custom-cat.glb');
  const imported=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  assert.equal(imported.animations.length,1);
  const mixer=new AnimationMixer(imported.scene);mixer.clipAction(imported.animations[0]).play();mixer.setTime(.375);imported.scene.updateMatrixWorld(true);
  let mesh;imported.scene.traverse(o=>{if(o.isSkinnedMesh)mesh=o;});
  assert.equal(mesh.skeleton.bones.length,35);
  const p=new Vector3();let maxExportError=0;
  sourceVertices.forEach((v,i)=>{mesh.getVertexPosition(mesh.geometry.index?.getX(i) ?? i,p).applyMatrix4(mesh.matrixWorld);maxExportError=Math.max(maxExportError,p.distanceTo(new Vector3(...v)));});
  assert.ok(maxExportError<1e-5,`Export deformation mismatch: ${maxExportError}`);
  assert.ok(bytes.includes(Buffer.from('Daily Lowpoly')));
  await page.reload();await page.waitForFunction(()=>window.__pet);
  assert.equal(await page.locator('#name').inputValue(),'測試貓');
  assert.equal(await page.locator('#head').inputValue(),'1.15');
  await page.locator('#timeline').fill('0.375');
  await page.screenshot({path:'bench/out/cat-run.png'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'bench/out/cat-mobile.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.setViewportSize({width:1280,height:800});
  await page.click('#toPark');
  await page.waitForFunction(()=>window.__demoReady);
  await page.waitForFunction(()=>document.body.textContent.includes('Cat: Daily Lowpoly'));
  await page.keyboard.down('KeyW');await page.waitForTimeout(500);await page.keyboard.up('KeyW');
  await page.screenshot({path:'bench/out/cat-park.png'});
  await page.goto(`${base}/demos/pet/index.html`); await page.waitForFunction(()=>window.__pet);
  await page.locator('#model').selectOption('detailed');
  await page.waitForFunction(()=>window.__pet.cat.params.model === 'detailed');
  assert.equal(await page.locator('#surface').inputValue(),'smooth');
  assert.equal(await page.locator('#wireframe').isChecked(),false);
  assert.equal(await page.locator('#head').count(),0);
  assert.equal(await page.locator('#animationControls').isVisible(),false);
  const detailed = await page.evaluate(()=>({triangles:__pet.cat.triangles, bones:__pet.cat.bones.length, animations:__pet.cat.animations.length, wireframe:__pet.cat.meshes[0].material.wireframe}));
  assert.deepEqual(detailed,{triangles:15672,bones:0,animations:0,wireframe:false});
  await page.screenshot({path:'bench/out/cat-detailed-smooth.png'});
  await page.locator('#surface').selectOption('faceted');
  await page.screenshot({path:'bench/out/cat-detailed-faceted.png'});
  const detailDownloadPromise=page.waitForEvent('download'); await page.click('#download');
  await (await detailDownloadPromise).saveAs('bench/out/detailed-cat.glb');
  const detailBytes=await readFile('bench/out/detailed-cat.glb');
  const detailAsset=await new GLTFLoader().parseAsync(detailBytes.buffer.slice(detailBytes.byteOffset,detailBytes.byteOffset+detailBytes.byteLength),'');
  assert.equal(detailAsset.animations.length,0);
  let detailMesh;detailAsset.scene.traverse(o=>{if(o.isMesh)detailMesh=o;});
  assert.equal(detailMesh.geometry.attributes.position.count/3,15672);
  assert.ok(detailBytes.includes(Buffer.from('kmeierhofer')));
  // Face normals survive export even though glTF has no flatShading flag.
  const normals=detailMesh.geometry.attributes.normal;
  for(let i=0;i<normals.count;i+=3) for(let c=0;c<3;c++) {
    assert.equal(normals.array[i*3+c],normals.array[(i+1)*3+c]);
    assert.equal(normals.array[i*3+c],normals.array[(i+2)*3+c]);
  }
  await page.locator('#surface').selectOption('smooth');
  await page.locator('#size').fill('1.1');
  await page.locator('#model').selectOption('runner'); await page.waitForFunction(()=>__pet.cat.params.model==='runner');
  assert.equal(await page.locator('#head').inputValue(),'1.15');
  assert.equal(await page.locator('#wireframe').isChecked(),false);
  await page.locator('#model').selectOption('detailed'); await page.waitForFunction(()=>__pet.cat.params.model==='detailed');
  assert.equal(await page.locator('#size').inputValue(),'1.1');
  // An immediate navigation must persist the active model without waiting for debounce.
  await page.reload();await page.waitForFunction(()=>window.__pet);
  assert.equal(await page.locator('#model').inputValue(),'detailed');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'bench/out/cat-detailed-mobile.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.setViewportSize({width:1280,height:800});
  await page.click('#toPark');await page.waitForFunction(()=>window.__demoReady);
  await page.waitForFunction(()=>document.body.textContent.includes('Cat: kmeierhofer'));
  await page.screenshot({path:'bench/out/cat-detailed-park.png'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({deformation,maxExportError,exportBytes:bytes.length,detailed,errors,checks:['editor','proportion extremes across run','coincident vertex continuity','GLB export/reimport pose match','persistence','mobile layout','park integration','model selection and per-model drafts','detailed model capabilities','faceted export normals','detailed model persistence and park']},null,2));
} finally { await browser.close(); }
