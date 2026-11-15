import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||chromium.executablePath(),headless:true});
const base=process.argv[2]||'http://localhost:5173';
await mkdir('bench/out',{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico'))errors.push(m.text());});
  await page.goto(`${base}/demos/three/index.html`);await page.waitForFunction(()=>window.__park,null,{timeout:60000});
  await page.selectOption('#quality','high');await page.click('#pause');
  await page.evaluate(()=>{__park.chooseTime('day',true);__park.chooseSeason('summer');__park.chooseWeather('sunny',true);});
  await page.waitForTimeout(100);
  const sunny=await page.evaluate(()=>({triangles:__park.renderer.info.render.triangles,grass:__park.scene.getObjectsByProperty('name','grass').reduce((n,o)=>n+o.count,0),backdrop:__park.backdrop.stats,carpet:__park.scene.getObjectByName('meadow').material.userData.meadowCarpet}));
  assert.ok(sunny.carpet);assert.ok(sunny.triangles<600000);assert.ok(sunny.backdrop.waterfalls>=2);
  await page.screenshot({path:'bench/out/park-mountains-meadow.png'});
  await page.selectOption('#weather','snow');await page.waitForFunction(()=>__park.park.snowCover.amount.value===1);
  assert.ok(await page.evaluate(()=>__park.scene.getObjectsByProperty('name','grass').every(o=>!o.visible||o.count===0)));
  assert.equal(await page.evaluate(()=>__park.park.waterMaterial.userData.snowCover),undefined);
  await page.screenshot({path:'bench/out/park-snow-blanket.png'});
  await page.selectOption('#season','autumn');assert.equal(await page.evaluate(()=>__park.park.snowCover.amount.value),1);
  await page.selectOption('#weather','sunny');await page.waitForFunction(()=>__park.park.snowCover.amount.value===0);
  assert.ok(await page.evaluate(()=>__park.scene.getObjectsByProperty('name','grass').some(o=>o.visible&&o.count>0)));
  const clearances=await page.evaluate(async()=>{
    const {heightAt}=await import('/shared/park-terrain.js');const result=[];
    __park.controls.dispatchEvent({type:'start'});__park.controls.enableDamping=false;
    for(const targetHeight of [.1,4])for(const distance of [4,20,65])for(let i=0;i<12;i++){
      const a=i/12*Math.PI*2,t=__park.controls.target;t.y=targetHeight;
      __park.camera.position.set(t.x+Math.cos(a)*distance,t.y-.1,t.z+Math.sin(a)*distance);
      __park.controls.update();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      result.push(__park.camera.position.y-heightAt(__park.camera.position.x,__park.camera.position.z));
    }
    return result;
  });
  assert.ok(Math.min(...clearances)>=1.14);
  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
  mobile.on('pageerror',e=>errors.push(e.message));
  await mobile.goto(`${base}/demos/three/index.html`);await mobile.waitForFunction(()=>window.__park,null,{timeout:60000});
  const start=await mobile.evaluate(()=>__park.frame);await mobile.waitForTimeout(1100);
  const power=await mobile.evaluate(start=>({frames:__park.frame-start,dpr:__park.renderer.getPixelRatio(),shadowAuto:__park.renderer.shadowMap.autoUpdate,triangles:__park.renderer.info.render.triangles}),start);
  assert.ok(power.frames<=36);assert.ok(power.dpr<=1.1);assert.equal(power.shadowAuto,false);
  await mobile.screenshot({path:'bench/out/park-meadow-mobile.png'});
  await mobile.selectOption('#weather','snow');await mobile.waitForFunction(()=>__park.park.snowCover.amount.value===1);
  await mobile.screenshot({path:'bench/out/park-snow-mobile.png'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({sunny,minCameraClearance:Math.min(...clearances),mobile:power,errors},null,2));
}finally{await browser.close();}
