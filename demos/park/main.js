import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Fog, HemisphereLight,
  DirectionalLight, PCFShadowMap, SRGBColorSpace, NoToneMapping, Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPark, heightAt } from './world.js';
import { createCat, loadCat, catDefaults } from '../pet/rigged-cat.js';
import './style.css';
import { createQualityController } from './quality.js';
import { createSky } from './sky.js';

const canvas=document.getElementById('app');
document.title='夕光貓園 · Sunlit Grove';
document.body.insertAdjacentHTML('beforeend', `
  <header class="park-header">
    <a class="park-home" href="../../index.html" aria-label="返回首頁">←</a>
    <div><span class="park-eyebrow">A LITTLE PLACE TO SLOW DOWN</span><h1>夕光貓園<span>SUNLIT GROVE</span></h1></div>
    <a class="park-editor" href="../pet/index.html">我的貓咪 ↗</a>
  </header>
  <nav class="park-times" aria-label="切換時間">
    <button type="button" data-time="day" aria-pressed="true">☀ <span>白天</span></button>
    <button type="button" data-time="dusk" aria-pressed="false">◒ <span>黃昏</span></button>
    <button type="button" data-time="night" aria-pressed="false">✦ <span>晚上</span></button>
  </nav>
  <div class="park-caption"><span class="park-number">01 / THE GROVE</span><p id="view-title">在樹影與湖光之間。</p><span id="view-description">一座小公園，一個不趕時間的午後。</span></div>
  <nav class="park-views" aria-label="觀賞角度">
    <button type="button" data-view="overview" aria-pressed="true"><span>01</span>公園全景</button>
    <button type="button" data-view="lake" aria-pressed="false"><span>02</span>湖畔木橋</button>
    <button type="button" data-view="cat" aria-pressed="false"><span>03</span>跟著貓咪</button>
  </nav>
  <footer class="park-footer">
    <span class="park-help">拖曳環視 · 滾輪縮放</span>
    <div class="park-actions">
      <button id="pause" type="button" aria-pressed="false">暫停時光</button>
      <label for="quality">畫質 <select id="quality"><option value="auto">自動</option><option value="high">細緻</option><option value="medium">均衡</option><option value="low">輕量</option></select></label>
      <button id="info-toggle" type="button" aria-expanded="false" aria-controls="park-info">關於</button>
    </div>
  </footer>
  <aside id="park-info" hidden><h2>留一點時間，看貓散步。</h2><p>以連續蒙皮的低面數貓咪為起點，重新搭配湖岸、木橋與樹冠的切面。沒有任務，只需要挑一個喜歡的角度。</p><p id="model-credit"></p><p id="park-metrics"></p><a href="index.html?scene=legacy">原引擎比較場景 ↗</a></aside>
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
  const camera=new PerspectiveCamera(42,innerWidth/innerHeight,.1,180);
  const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.07;controls.enablePan=false;
  controls.minDistance=4;controls.maxDistance=65;controls.maxPolarAngle=Math.PI*.56;controls.minPolarAngle=.18;
  const park=createPark(scene);
  const sky=createSky(scene,{sun,hemisphere,water:park.waterMaterial});
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const timeDescriptions={day:'晴空、白雲，和湖畔輕快的腳步。',dusk:'夕陽落在樹梢，留下一湖溫柔的光。',night:'把步調放慢，陪貓咪一起看滿天星光。'};
  function chooseTime(mode,immediate=false){
    sky.select(mode,immediate||reducedMotion);document.body.dataset.period=sky.mode;
    document.querySelectorAll('[data-time]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.time===sky.mode)));
    document.getElementById('view-description').textContent=timeDescriptions[sky.mode];
    try{localStorage.setItem('lowpoly-park-time',sky.mode);}catch{}
  }
  let savedTime='day';try{savedTime=localStorage.getItem('lowpoly-park-time')||'day';}catch{}
  chooseTime(savedTime,true);
  document.querySelectorAll('[data-time]').forEach(b=>b.onclick=()=>chooseTime(b.dataset.time));
  // Give the loading message a paint before decoding the animated asset.
  await new Promise(requestAnimationFrame);
  const saved=loadCat();
  const cat=await createCat(saved ?? {...catDefaults('runner'),color:'#b88458'});
  cat.root.scale.multiplyScalar(2.2);scene.add(cat.root);
  let extraRunner=null;
  if(!cat.profile.animated) {
    cat.root.position.set(0,heightAt(0,8),8);cat.root.rotation.y=-.4;
    extraRunner=await createCat({...catDefaults('runner'),color:'#b88458'});extraRunner.root.scale.multiplyScalar(2.2);scene.add(extraRunner.root);
  }
  const runner=extraRunner??cat;runner.setSpeed(.8);
  const credit=document.getElementById('model-credit');
  const credits=[cat.profile.credit,...(extraRunner?[extraRunner.profile.credit]:[])];
  for(const c of credits){const a=document.createElement('a');a.href=c.source;a.textContent=`Cat: ${c.author} · ${c.license}`;a.target='_blank';a.rel='noopener';credit.append(a,document.createElement('br'));}
  const views={
    overview:{eye:[26,15,31],target:[-1,4,-3],title:'在樹影與湖光之間。',description:'晴空、白雲，和湖畔輕快的腳步。'},
    lake:{eye:[16,7.5,12],target:[-2,.1,-4],title:'走過一座小小的木橋。',description:'風吹過蘆葦，水面留下細碎的光。'},
    cat:{eye:[10,5,16],target:[0,.4,7],title:'今天，跟著牠慢慢走。',description:'沒有目的地，也有沿路的好風景。'},
  };
  let view='overview',transition=true,paused=reducedMotion,simulationTime=0,frame=0;
  const desiredEye=new Vector3(),desiredTarget=new Vector3(),followOffset=new Vector3(5,3.2,7);
  function chooseView(id){view=id;transition=true;const v=views[id];desiredEye.fromArray(v.eye);desiredTarget.fromArray(v.target);
    document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===id)));
    document.querySelector('.park-number').textContent=`0${Object.keys(views).indexOf(id)+1} / ${id==='overview'?'THE GROVE':id==='lake'?'BY THE WATER':'A CAT’S AFTERNOON'}`;
    document.getElementById('view-title').textContent=v.title;document.getElementById('view-description').textContent=timeDescriptions[sky.mode];
  }
  chooseView(view);camera.position.copy(desiredEye);controls.target.copy(desiredTarget);controls.update();transition=false;
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>chooseView(b.dataset.view));
  let following=true;
  controls.addEventListener('start',()=>{transition=false;following=false;});
  document.querySelector('[data-view=cat]').addEventListener('click',()=>{following=true;});
  document.getElementById('pause').textContent=paused?'繼續時光':'暫停時光';
  document.getElementById('pause').setAttribute('aria-pressed',String(paused));
  document.getElementById('pause').onclick=e=>{paused=!paused;e.currentTarget.textContent=paused?'繼續時光':'暫停時光';e.currentTarget.setAttribute('aria-pressed',String(paused));};
  const info=document.getElementById('park-info');
  document.getElementById('info-toggle').onclick=e=>{info.hidden=!info.hidden;e.currentTarget.setAttribute('aria-expanded',String(!info.hidden));};

  const coarse=matchMedia('(pointer: coarse)').matches;
  const quality=document.getElementById('quality');
  let level='high',currentDpr=1;
  const caps={high:coarse?1.4:1.75,medium:1,low:.75};
  function resize(){renderer.setPixelRatio(currentDpr);renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
  function setLevel(value){level=value;currentDpr=Math.min(devicePixelRatio||1,caps[value]);
    park.setDetail(value);sun.shadow.intensity=value==='low'?0:1;sun.shadow.autoUpdate=value!=='low';
    // Freeze the existing shadow map when hidden; avoid shader recompilation.
    if(value!=='low')sun.shadow.needsUpdate=true;
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
  let last=performance.now(),lastStats=0;
  document.addEventListener('visibilitychange',()=>{last=performance.now();qualityController.resetSamples(last);});
  function frameLoop(){
    const now=performance.now(),ms=now-last,dt=Math.min(ms/1000,.05);last=now;
    if(document.hidden)return;
    if(!paused){simulationTime+=dt;poseRunner(simulationTime,dt);park.timeUniform.value=simulationTime;}
    if(view==='cat'&&following){desiredTarget.copy(runner.root.position);desiredTarget.y+=.55;desiredEye.copy(desiredTarget).add(followOffset);transition=true;}
    if(transition){const k=1-Math.exp(-dt*3);camera.position.lerp(desiredEye,k);controls.target.lerp(desiredTarget,k);
      if(view!=='cat'&&camera.position.distanceToSquared(desiredEye)<.002)transition=false;}
    controls.update();sky.update(camera,dt,simulationTime,currentDpr);renderer.render(scene,camera);frame++;
    qualityController.observe(ms,now);
    if(now-lastStats>700){lastStats=now;document.getElementById('park-metrics').textContent=`${renderer.info.render.calls} 次繪製 · ${Math.round(renderer.info.render.triangles/1000)}k 三角形 · ${level} / DPR ${currentDpr.toFixed(2)}`;}
  }
  window.__park={scene,camera,renderer,controls,cat,runner,park,sky,chooseTime,chooseView,get time(){return simulationTime;},get paused(){return paused;},get quality(){return {...qualityController.state,dpr:currentDpr};},get frame(){return frame;}};
  window.__demoReady=true;
  renderer.setAnimationLoop(frameLoop);
}
