// Weather/season interaction, pause, persistence and mobile-control regression checks.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
const base=process.argv[2]||'http://localhost:5173';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||chromium.executablePath(),headless:true});
await mkdir('bench/out',{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico'))errors.push(m.text());});
  await page.goto(`${base}/demos/three/index.html`);await page.waitForFunction(()=>window.__park,null,{timeout:60000});
  await page.selectOption('#quality','high');await page.click('#pause');
  const grass=await page.evaluate(()=>__park.scene.getObjectsByProperty('name','grass').reduce((n,o)=>n+o.userData.fullCount,0));
  assert.ok(grass>15000);
  const counts={};
  for(const season of ['spring','summer','autumn','winter']){
    await page.selectOption('#season',season);
    const state=await page.evaluate(()=>({stats:__park.park.seasons.stats,
      pine:__park.scene.children.filter(o=>o.userData.gltfAsset?.startsWith('pine')&&o.userData.role?.startsWith('foliage')).every(o=>o.visible),
      deciduous:__park.scene.children.filter(o=>/^(oak|birch|goldenTree)/.test(o.userData.gltfAsset)&&o.userData.role?.startsWith('foliage')).filter(o=>o.visible).length}));
    assert.equal(state.stats.season,season);assert.ok(state.pine);
    if(season==='winter')assert.equal(state.deciduous,0);
    counts[season]=state.stats;
    await page.screenshot({path:`bench/out/park-season-${season}.png`});
  }
  assert.ok(counts.summer.visibleFoliageBatches>counts.spring.visibleFoliageBatches);
  assert.ok(counts.autumn.fallingLeaves>counts.summer.fallingLeaves);
  assert.equal(counts.winter.fallingLeaves,0);
  // Exercise all 60 independent combinations, including switching while paused.
  const combinations=await page.evaluate(async()=>{
    const result=[];
    for(const season of ['spring','summer','autumn','winter'])for(const time of ['day','dusk','night'])for(const weather of ['sunny','cloudy','rain','heavyRain','snow']){
      __park.chooseSeason(season);__park.chooseTime(time,true);__park.chooseWeather(weather,true);
      await new Promise(requestAnimationFrame);
      result.push({season:__park.park.season,time:__park.sky.mode,weather:__park.weather.mode,skyWeather:__park.sky.weather,particles:__park.weather.particleCount});
    }
    return result;
  });
  assert.equal(combinations.length,60);
  for(const c of combinations){assert.equal(c.weather,c.skyWeather);assert.equal(c.particles>0,['rain','heavyRain','snow'].includes(c.weather));}
  const rain=combinations.find(c=>c.weather==='rain').particles,heavy=combinations.find(c=>c.weather==='heavyRain').particles;
  assert.ok(heavy>rain);
  await page.selectOption('#season','autumn');await page.selectOption('#weather','heavyRain');
  const frozen=await page.evaluate(()=>({time:__park.time,leaves:Array.from(__park.scene.getObjectByName('season-falling-leaves').instanceMatrix.array)}));
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(()=>({time:__park.time,leaves:Array.from(__park.scene.getObjectByName('season-falling-leaves').instanceMatrix.array)})),frozen);
  await page.click('#pause');await page.waitForFunction(t=>__park.time>t+.15,frozen.time);
  assert.notDeepEqual(await page.evaluate(()=>Array.from(__park.scene.getObjectByName('season-falling-leaves').instanceMatrix.array)),frozen.leaves);
  await page.click('#pause');
  await page.click('[data-time=night]');await page.waitForFunction(()=>!__park.sky.transitioning);
  await page.screenshot({path:'bench/out/park-autumn-storm-night.png'});
  await page.selectOption('#season','winter');await page.selectOption('#weather','snow');await page.click('[data-time=day]');await page.waitForFunction(()=>!__park.sky.transitioning);
  await page.screenshot({path:'bench/out/park-winter-snow.png'});
  await page.reload();await page.waitForFunction(()=>window.__park);
  assert.equal(await page.inputValue('#season'),'winter');assert.equal(await page.inputValue('#weather'),'snow');
  await page.selectOption('#quality','low');assert.ok(await page.evaluate(()=>__park.weather.particleCount<3400&&__park.weather.particleCount>0));
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const selector of ['#weather','#season','#quality','#pause'])assert.ok(await page.locator(selector).isVisible());
  await page.screenshot({path:'bench/out/park-weather-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({grass,seasons:counts,combinations:combinations.length,rain,heavy,errors},null,2));
}finally{await browser.close();}
