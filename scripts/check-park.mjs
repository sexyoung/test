// node scripts/check-park.mjs http://localhost:5174
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createQualityController } from '../demos/park/quality.js';
const base=process.argv[2]||'http://localhost:5173';
// A 30 FPS cap must restore quality; an effective probe must retain the change.
for(const improved of [false,true]) {
  const changes=[];const q=createQualityController({apply:l=>changes.push(l)});let now=0;
  q.select('auto',now);
  const window=(ms,count)=>{now+=2100;for(let i=0;i<count;i++){now+=ms;q.observe(ms,now);}};
  window(33,120);assert.equal(q.state.level,'medium');assert.equal(q.state.probing,true);
  window(improved?20:33,60);assert.equal(q.state.level,improved?'medium':'high');
  assert.equal(q.state.locked,!improved);
  q.select('low',now);window(33,180);assert.equal(q.state.level,'low');
  q.select('auto',now);now+=2100;for(let i=0;i<100;i++)q.observe(200,now+=200);assert.equal(q.state.level,'high');
}
await mkdir('bench/out',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||chromium.executablePath(),headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}), errors=[],assetRequests=new Set();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico'))errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/favicon.ico'))errors.push(`${r.status()} ${r.url()}`);if(r.ok()&&r.url().includes('/models/park/')&&r.url().endsWith('.glb'))assetRequests.add(r.url());});
  await page.goto(`${base}/demos/three/index.html`);await page.waitForFunction(()=>window.__park,null,{timeout:60000});
  const t=await page.evaluate(()=>__park.time);await page.waitForFunction(t=>__park.time>t+.1,t);
  await page.click('#pause');const stopped=await page.evaluate(()=>({time:__park.time,position:__park.runner.root.position.toArray()}));
  await page.waitForTimeout(200);assert.deepEqual(await page.evaluate(()=>({time:__park.time,position:__park.runner.root.position.toArray()})),stopped);
  const metrics=await page.evaluate(()=>({calls:__park.renderer.info.render.calls,triangles:__park.renderer.info.render.triangles,static:__park.park.stats}));
  // Richer GLB props have an explicit new geometry budget; batching remains bounded.
  assert.ok(metrics.calls<460);assert.ok(metrics.triangles<1300000);
  const assetCount=await page.evaluate(async()=>Object.keys((await (await fetch('../../models/park/manifest.json')).json()).assets).length);
  assert.equal(assetRequests.size,assetCount);assert.equal(metrics.static.glbAssets,assetCount);
  assert.equal(await page.locator('.park-caption, #park-info, .park-help, h1').count(),0);
  assert.ok(await page.evaluate(()=>__park.scene.children.filter(o=>o.material?.userData.windDepth).length>0));
  assert.equal(await page.evaluate(()=>__park.park.timeUniform.value),stopped.time);
  assert.ok(await page.evaluate(()=>{let assets=0;__park.scene.traverse(o=>{if(o.isMesh&&o.userData.gltfAsset)assets++;});return assets>=17;}));
  await page.screenshot({path:'bench/out/park-overview.png'});
  // Clean source screenshot for the home page, using the actual rendered scene.
  const hide=await page.addStyleTag({content:'body > :not(canvas){visibility:hidden!important}body::after{display:none!important}'});
  await page.screenshot({path:'public/park-preview.png'});await hide.evaluate(e=>e.remove());
  const dayWater=await page.evaluate(()=>__park.park.waterMaterial.color.toArray());
  for(const mode of ['dusk','night']) {
    await page.click(`[data-time=${mode}]`);
    await page.waitForFunction(()=>!__park.sky.transitioning);
    assert.equal(await page.locator(`[data-time=${mode}]`).getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>__park.sky.mode),mode);
    // User-initiated time changes work while motion is paused.
    assert.equal(await page.evaluate(()=>__park.time),stopped.time);
    await page.screenshot({path:`bench/out/park-${mode}.png`});
  }
  const nightWater=await page.evaluate(()=>__park.park.waterMaterial.color.toArray());
  assert.ok(nightWater.every((v,i)=>v<dayWater[i]));
  assert.ok(await page.evaluate(()=>{let lit=0;__park.scene.traverse(o=>{if(o.isPointLight&&o.intensity>4)lit++;});return lit===__park.park.stats.activeLights&&__park.park.stats.lanterns>=18;}));
  assert.equal(await page.evaluate(()=>__park.scene.getObjectByName('stars').geometry.attributes.position.count),8000);
  await page.reload();await page.waitForFunction(()=>window.__park);
  assert.equal(await page.evaluate(()=>__park.sky.mode),'night');
  assert.equal(await page.locator('[data-time=night]').getAttribute('aria-pressed'),'true');
  await page.click('#pause');await page.click('[data-time=day]');await page.waitForFunction(()=>!__park.sky.transitioning);
  for(const view of ['lake','cat']){
    await page.click(`[data-view=${view}]`);
    await page.waitForFunction(()=>__park.camera.position.distanceTo(__park.controls.target)<30);
    await page.waitForTimeout(1500);await page.screenshot({path:`bench/out/park-${view}.png`});
    assert.equal(await page.locator(`[data-view=${view}]`).getAttribute('aria-pressed'),'true');
  }
  await page.locator('#quality').selectOption('low');
  assert.ok(await page.evaluate(()=>__park.quality.dpr<=.75));
  assert.ok(await page.evaluate(()=>__park.scene.getObjectsByProperty('name','grass').some(o=>o.visible&&o.count>0&&o.count<o.userData.fullCount)));
  await page.locator('#quality').selectOption('high');
  assert.equal(await page.evaluate(()=>__park.scene.getObjectsByProperty('name','grass').some(o=>o.visible)),true);
  await page.setViewportSize({width:390,height:844});await page.click('[data-view=overview]');await page.waitForTimeout(1500);
  await page.screenshot({path:'bench/out/park-mobile.png'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.click('[data-time=night]');await page.waitForFunction(()=>!__park.sky.transitioning);
  await page.screenshot({path:'bench/out/park-night-mobile.png'});
  await page.locator('#quality').selectOption('medium');await page.reload();await page.waitForFunction(()=>window.__park);
  assert.equal(await page.locator('#quality').inputValue(),'medium');
  // Saved detailed cat is exhibited, with the animated reference cat still on the path.
  await page.evaluate(()=>localStorage.setItem('lowpoly-rigged-cat-v1',JSON.stringify({model:'detailed',name:'展示貓',size:1,color:'#eeeeee'})));
  await page.reload();await page.waitForFunction(()=>window.__park);
  assert.equal(await page.evaluate(()=>__park.cat.params.model),'detailed');
  assert.equal(await page.evaluate(()=>__park.runner.profile.animated),true);
  // Engine benchmark stays on the original deterministic workload.
  await page.goto(`${base}/demos/three/index.html?bench=1&frames=20&warmup=10&hud=1`);
  await page.waitForFunction(()=>window.__benchResult,{timeout:60000});
  const benchmark=await page.evaluate(()=>({engine:__benchResult.engine,drawCalls:__benchResult.census.drawCalls,triangles:__benchResult.census.triangles}));
  assert.equal(benchmark.engine,'Three.js');assert.equal(await page.locator('.park-header').count(),0);
  assert.match(await page.locator('.lp-nav a.lp-current').getAttribute('href'), /scene=legacy/);
  assert.match(await page.locator('.lp-presets a').first().getAttribute('href'), /scene=legacy/);
  const still=await browser.newPage({reducedMotion:'reduce'});
  await still.goto(`${base}/demos/three/index.html`);await still.waitForFunction(()=>window.__park);
  await still.click('[data-time=dusk]');
  assert.equal(await still.evaluate(()=>__park.paused&&!__park.sky.transitioning&&__park.sky.mode==='dusk'),true);
  await still.close();
  // A missing GLB must show a recoverable load error, never an incomplete park.
  const retry=await browser.newPage();
  await retry.route('**/models/park/bridge.glb',route=>route.abort());
  await retry.goto(`${base}/demos/three/index.html`);
  await retry.getByRole('button',{name:'重新載入'}).waitFor();
  assert.equal(await retry.evaluate(()=>Boolean(window.__park)),false);
  await retry.unroute('**/models/park/bridge.glb');
  await retry.getByRole('button',{name:'重新載入'}).click();await retry.waitForFunction(()=>window.__park);
  await retry.close();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({metrics,benchmark,qualityProbe:'rollback and retain paths passed',errors},null,2));
}finally{await browser.close();}
