import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Fog, HemisphereLight,
  DirectionalLight, PCFShadowMap, SRGBColorSpace, NoToneMapping, Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPark } from './world.js';
import { createCat, loadCat, catDefaults } from '../pet/rigged-cat.js';
import './style.css';
import { createQualityController } from './quality.js';
import { heightAt } from '../../shared/park-terrain.js';
import { createBackdrop } from './backdrop.js';
import { createWeather } from './weather.js';
import { createSky } from './sky.js';

const canvas=document.getElementById('app');
document.title='夕光貓園 · Sunlit Grove';
document.body.insertAdjacentHTML('beforeend', `
  <header class="park-header">
    <a class="park-editor" href="../pet/index.html">我的貓咪 ↗</a>
  </header>
  <nav class="park-times" aria-label="切換時間">
    <button type="button" data-time="day" aria-pressed="true">☀ <span>白天</span></button>
    <button type="button" data-time="dusk" aria-pressed="false">◒ <span>黃昏</span></button>
    <button type="button" data-time="night" aria-pressed="false">✦ <span>晚上</span></button>
  </nav>
  <div class="park-environment">
    <label for="weather">天氣 <select id="weather"><option value="sunny">晴天</option><option value="cloudy">陰天</option><option value="rain">雨天</option><option value="heavyRain">大雨</option><option value="snow">下雪</option></select></label>
    <label for="season">季節 <select id="season"><option value="spring">春天</option><option value="summer" selected>夏天</option><option value="autumn">秋天</option><option value="winter">冬天</option></select></label>
  </div>
  <nav class="park-views" aria-label="觀賞角度">
    <button type="button" data-view="overview" aria-pressed="true">公園全景</button>
    <button type="button" data-view="lake" aria-pressed="false">湖畔木橋</button>
    <button type="button" data-view="cat" aria-pressed="false">跟著貓咪</button>
  </nav>
  <footer class="park-footer">
    <div class="park-actions">
      <button id="pause" type="button" aria-pressed="false">暫停時光</button>
      <label for="quality">畫質 <select id="quality"><option value="auto">自動</option><option value="high">細緻</option><option value="medium">均衡</option><option value="low">輕量</option></select></label>
    </div>
  </footer>
  <div id="park-loading" role="status"><span class="loading-paw">◌</span><p>正在鋪好午後的小徑…</p></div>
`);
const loading=document.getElementById('park-loading');
try {
  await start();
} catch(error) {
  loading.replaceChildren();const p=document.createElement('p');p.textContent=`場景載入失敗：${error.message}`;
  const retry=document.createElement('button');retry.textContent='重新載入';retry.onclick=()=>location.reload();loading.append(p,retry);
  console.error(error);
}
async function start() {
  const renderer=new WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.outputColorSpace=SRGBColorSpace;renderer.toneMapping=NoToneMapping;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=PCFShadowMap;
  const scene=new Scene();scene.background=new Color('#e5e8dc');scene.fog=new Fog('#e5e8dc',42,108);
  const hemisphere=new HemisphereLight('#fff4df','#8c9273',2.05);scene.add(hemisphere);
  const sun=new DirectionalLight('#ffedcb',2.35);sun.position.set(-20,33,15);sun.target.position.set(-1,0,-2);sun.castShadow=true;
  Object.assign(sun.shadow.camera,{left:-32,right:32,top:32,bottom:-32,near:1,far:140});
  sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0003;sun.shadow.normalBias=.035;scene.add(sun,sun.target);
  const camera=new PerspectiveCamera(42,innerWidth/innerHeight,.1,520);
  const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.07;controls.enablePan=false;
  controls.minDistance=4;controls.maxDistance=65;controls.maxPolarAngle=Math.PI*.46;controls.minPolarAngle=.18;
  const park=await createPark(scene,(done,total)=>{loading.querySelector('p').textContent=`正在佈置湖畔花園… ${done} / ${total}`;});
  const sky=createSky(scene,{sun,hemisphere,water:park.waterMaterial});
  const backdrop=createBackdrop(scene,{timeUniform:park.timeUniform});
  const weather=createWeather(scene,{timeUniform:park.timeUniform});
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function chooseTime(mode,immediate=false){
    sky.select(mode,immediate||reducedMotion);park.setTimeOfDay(sky.mode,immediate||reducedMotion);document.body.dataset.period=sky.mode;
    document.querySelectorAll('[data-time]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.time===sky.mode)));
    try{localStorage.setItem('lowpoly-park-time',sky.mode);}catch{}
  }
  let savedTime='day';try{savedTime=localStorage.getItem('lowpoly-park-time')||'day';}catch{}
  chooseTime(savedTime,true);
  document.querySelectorAll('[data-time]').forEach(b=>b.onclick=()=>chooseTime(b.dataset.time));
  function chooseWeather(value,immediate=false){
    const mode=['sunny','cloudy','rain','heavyRain','snow'].includes(value)?value:'sunny';
    sky.setWeather(mode,immediate||reducedMotion);weather.setWeather(mode);
    park.setWeather(mode,immediate||reducedMotion);backdrop.setWeather(mode);
    park.windStrength.value=weather.windStrength;
    document.getElementById('weather').value=mode;
    document.body.dataset.weather=mode;
    try{localStorage.setItem('lowpoly-park-weather',mode);}catch{}
  }
  function chooseSeason(value){
    const mode=['spring','summer','autumn','winter'].includes(value)?value:'summer';
    park.setSeason(mode);document.getElementById('season').value=mode;
    document.body.dataset.season=mode;
    try{localStorage.setItem('lowpoly-park-season',mode);}catch{}
  }
  let savedWeather='sunny',savedSeason='summer';
  try{savedWeather=localStorage.getItem('lowpoly-park-weather')||'sunny';savedSeason=localStorage.getItem('lowpoly-park-season')||'summer';}catch{}
  chooseWeather(savedWeather,true);chooseSeason(savedSeason);
  document.getElementById('weather').onchange=e=>chooseWeather(e.target.value);
  document.getElementById('season').onchange=e=>chooseSeason(e.target.value);
  // Give the loading message a paint before decoding the animated asset.
  await new Promise(requestAnimationFrame);
  const saved=loadCat();
  const cat=await createCat(saved ?? {...catDefaults('runner'),color:'#b88458'});
  cat.root.scale.multiplyScalar(2.2);scene.add(cat.root);
  let extraRunner=null;
  if(!cat.profile.animated) {
    cat.root.position.fromArray(park.displayCat);cat.root.rotation.y=-.4;
    extraRunner=await createCat({...catDefaults('runner'),color:'#b88458'});extraRunner.root.scale.multiplyScalar(2.2);scene.add(extraRunner.root);
  }
  const runner=extraRunner??cat;runner.setSpeed(.8);
  const views={
    overview:{eye:[26,15,31],target:[-1,4,-3]},
    lake:{eye:[16,7.5,12],target:[-2,.1,-4]},
    cat:{eye:[10,5,16],target:[0,.4,7]},
  };
  let view='overview',transition=true,paused=reducedMotion,simulationTime=0,frame=0;
  const desiredEye=new Vector3(),desiredTarget=new Vector3(),followOffset=new Vector3(5,3.2,7);
  function chooseView(id){view=id;transition=true;const v=views[id];desiredEye.fromArray(v.eye);desiredTarget.fromArray(v.target);
    document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===id)));
  }
  chooseView(view);camera.position.copy(desiredEye);controls.target.copy(desiredTarget);controls.update();transition=false;
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>chooseView(b.dataset.view));
  let following=true;
  controls.addEventListener('start',()=>{transition=false;following=false;});
  document.querySelector('[data-view=cat]').addEventListener('click',()=>{following=true;});
  document.getElementById('pause').textContent=paused?'繼續時光':'暫停時光';
  document.getElementById('pause').setAttribute('aria-pressed',String(paused));
  document.getElementById('pause').onclick=e=>{paused=!paused;e.currentTarget.textContent=paused?'繼續時光':'暫停時光';e.currentTarget.setAttribute('aria-pressed',String(paused));};

  const coarse=matchMedia('(pointer: coarse)').matches;
  const quality=document.getElementById('quality');
  let level='high',currentDpr=1;
  const caps={high:coarse?1.1:1.75,medium:1,low:.75};
  renderer.shadowMap.autoUpdate=!coarse;
  function resize(){renderer.setPixelRatio(currentDpr);renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
  function setLevel(value){level=value;currentDpr=Math.min(devicePixelRatio||1,caps[value]);
    park.setDetail(value);weather.setDetail(value);backdrop.setDetail(value);sun.shadow.intensity=value==='low'?0:1;sun.shadow.autoUpdate=value!=='low';
    // Freeze the existing shadow map when hidden; avoid shader recompilation.
    if(value!=='low'){sun.shadow.needsUpdate=true;renderer.shadowMap.needsUpdate=true;}
    const resolution=value==='high'&&!coarse?2048:1024;
    if(sun.shadow.mapSize.x!==resolution){sun.shadow.mapSize.set(resolution,resolution);sun.shadow.map?.dispose();sun.shadow.map=null;}
    resize();
  }
  const qualityController=createQualityController({apply:setLevel,initial:coarse?'medium':'high'});
  let preferred='auto';try { preferred=localStorage.getItem('lowpoly-park-quality')||'auto'; } catch {}
  if(!['auto','high','medium','low'].includes(preferred))preferred='auto';
  quality.value=preferred;qualityController.select(preferred,performance.now());
  quality.onchange=()=>{qualityController.select(quality.value,performance.now());try{localStorage.setItem('lowpoly-park-quality',quality.value);}catch{}};
  window.addEventListener('resize',()=>{resize();qualityController.resetSamples(performance.now());});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();renderer.setAnimationLoop(null);loading.hidden=false;loading.textContent='繪圖暫停，正在等候恢復…';});
  canvas.addEventListener('webglcontextrestored',()=>location.reload());
  const path=park.route;
  function poseRunner(time,dt){
    const f=((time*.95/park.routeLength+.26)%1)*320,i=Math.floor(f),j=(i+1)%320,t=f-i;
    const x=path[i*4]+(path[j*4]-path[i*4])*t,y=path[i*4+1]+(path[j*4+1]-path[i*4+1])*t,z=path[i*4+2]+(path[j*4+2]-path[i*4+2])*t;
    let angle=path[j*4+3]-path[i*4+3];angle=Math.atan2(Math.sin(angle),Math.cos(angle));
    runner.root.position.set(x,y,z);runner.root.rotation.y=path[i*4+3]+angle*t;runner.update(dt);
  }
  poseRunner(0,0);sky.update(camera,0,0,currentDpr);await renderer.compileAsync(scene,camera);
  const culled=[];scene.traverse(o=>{if(o.isMesh&&o.frustumCulled){culled.push(o);o.frustumCulled=false;}});
  renderer.render(scene,camera);for(const o of culled)o.frustumCulled=true;
  loading.hidden=true;
  let last=performance.now(),lastShadow=0;
  document.addEventListener('visibilitychange',()=>{last=performance.now();qualityController.resetSamples(last);});
  function frameLoop(){
    const now=performance.now(),ms=now-last;
    if(document.hidden||(coarse&&ms<1000/30-1))return;
    const dt=Math.min(ms/1000,.05);last=now;
    if(coarse&&level!=='low'&&now-lastShadow>100){renderer.shadowMap.needsUpdate=true;lastShadow=now;}
    if(!paused){simulationTime+=dt;poseRunner(simulationTime,dt);park.timeUniform.value=simulationTime;}
    if(view==='cat'&&following){desiredTarget.copy(runner.root.position);desiredTarget.y+=.55;desiredEye.copy(desiredTarget).add(followOffset);transition=true;}
    if(transition){const k=1-Math.exp(-dt*3);camera.position.lerp(desiredEye,k);controls.target.lerp(desiredTarget,k);
      if(view!=='cat'&&camera.position.distanceToSquared(desiredEye)<.002)transition=false;}
    controls.update();
    // Polar limits prevent below-target orbits; terrain clearance also protects
    // close zooms and camera-follow views on the uneven meadow.
    const ground=heightAt(camera.position.x,camera.position.z);
    camera.position.y=Math.max(camera.position.y,ground+1.15);
    camera.lookAt(controls.target);
    park.update(dt,camera);weather.update(camera,dt);sky.update(camera,dt,simulationTime,currentDpr);backdrop.update(camera,dt);renderer.render(scene,camera);frame++;
    qualityController.observe(ms,now);
  }
  window.__park={scene,camera,renderer,controls,cat,runner,park,sky,weather,backdrop,chooseTime,chooseView,chooseWeather,chooseSeason,get time(){return simulationTime;},get paused(){return paused;},get quality(){return {...qualityController.state,dpr:currentDpr};},get frame(){return frame;}};
  window.__demoReady=true;
  renderer.setAnimationLoop(frameLoop);
}
