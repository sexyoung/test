import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {mkdir} from 'node:fs/promises';
import {buildMountainRange} from '../demos/park/mountain-range.js';
const range=buildMountainRange(),p=range.geometry.attributes.position;
assert.ok(p.count/3<16000);
for(let i=0;i<p.array.length;i++)assert.ok(Number.isFinite(p.array[i]));
for(const fall of range.falls){
  assert.ok(fall.path.length>8);
  assert.ok(fall.path[0].y-fall.path.at(-1).y>20);
  for(const point of fall.path)assert.ok(Math.abs(point.y-range.sampleHeight(point.x,point.z)-.35)<.02);
}
range.geometry.dispose();
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||chromium.executablePath(),headless:true});
await mkdir('bench/out',{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico'))errors.push(m.text());});
  await page.goto(`${process.argv[2]||'http://localhost:5173'}/demos/three/index.html`);await page.waitForFunction(()=>window.__park,null,{timeout:60000});
  await page.selectOption('#quality','high');await page.click('#pause');
  await page.evaluate(()=>{__park.chooseTime('day',true);__park.chooseWeather('sunny',true);});
  await page.waitForTimeout(100);
  const state=await page.evaluate(()=>{
    const water=__park.scene.getObjectByName('waterfalls'),mist=__park.scene.getObjectByName('waterfall-basin-mist'),drops=__park.scene.getObjectByName('waterfall-splash-droplets');
    return {stats:__park.backdrop.stats,mist:mist.geometry.instanceCount,drops:drops.geometry.instanceCount,
      shared:water.material.uniforms.parkTime===mist.material.uniforms.parkTime&&water.material.uniforms.parkTime===drops.material.uniforms.parkTime,
      time:water.material.uniforms.parkTime.value};
  });
  assert.ok(state.shared);assert.equal(state.mist,24);assert.equal(state.drops,120);
  await page.screenshot({path:'bench/out/park-layered-mountains.png'});
  await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>__park.scene.getObjectByName('waterfalls').material.uniforms.parkTime.value),state.time);
  await page.click('#pause');await page.waitForFunction(t=>__park.time>t+.3,state.time);await page.click('#pause');
  await page.selectOption('#quality','low');assert.equal(await page.evaluate(()=>__park.scene.getObjectByName('waterfall-basin-mist').geometry.instanceCount),12);
  await page.click('[data-time=night]');await page.selectOption('#weather','rain');await page.waitForFunction(()=>!__park.sky.transitioning);
  await page.screenshot({path:'bench/out/park-waterfalls-night.png'});
  await page.setViewportSize({width:390,height:844});await page.click('[data-time=day]');await page.selectOption('#weather','sunny');await page.waitForFunction(()=>!__park.sky.transitioning);
  await page.screenshot({path:'bench/out/park-waterfalls-mobile.png'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({state,errors},null,2));
}finally{await browser.close();}
