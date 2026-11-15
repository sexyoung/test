import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();await page.goto(process.argv[2]||'http://localhost:5177');
 const report=await page.evaluate(async()=>{
  const T=await import('/node_modules/three/build/three.module.js');const{GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
  const result={};
  for(const [name,url]of [['original','/models/lowpoly_cat_rig__run_animation.glb'],['replacement','/models/cat/runner-approved-head.glb']]){
   const asset=await new GLTFLoader().loadAsync(url),mixer=new T.AnimationMixer(asset.scene);mixer.clipAction(asset.animations[0]).play();
   const edges=[];
   asset.scene.traverse(m=>{
    if(!m.isSkinnedMesh)return;
    if(name==='replacement'&&m.userData.headPart!=='surface')return;
    const g=m.geometry,p=g.attributes.position,si=g.attributes.skinIndex,sw=g.attributes.skinWeight,ids=i=>g.index?.getX(i)??i;
    const headWeight=i=>[0,1,2,3].reduce((n,k)=>n+([5,6,7,8,9].includes(si.array[i*4+k])?sw.array[i*4+k]:0),0);
    for(let t=0;t<(g.index?.count??p.count);t+=3){
     const tri=[ids(t),ids(t+1),ids(t+2)];
     // Exclude ear tips: prove the cheek/jaw faces deform, not just ear motion.
     if(tri.some(i=>p.getY(i)>.245)||tri.reduce((n,i)=>n+headWeight(i),0)/3<.3)continue;
     for(let k=0;k<3;k++)edges.push({mesh:m,a:tri[k],b:tri[(k+1)%3],min:Infinity,max:0});
    }
   });
   const a=new T.Vector3(),b=new T.Vector3();
   for(let frame=0;frame<60;frame++){
    mixer.setTime(asset.animations[0].duration*frame/60);asset.scene.updateMatrixWorld(true);
    for(const e of edges){e.mesh.getVertexPosition(e.a,a);e.mesh.getVertexPosition(e.b,b);const length=a.distanceTo(b);e.min=Math.min(e.min,length);e.max=Math.max(e.max,length);}
   }
   const changes=edges.filter(e=>e.min>1e-7).map(e=>(e.max-e.min)/e.min).sort((a,b)=>a-b);
   result[name]={facialEdges:changes.length,medianRelativeEdgeChange:changes[Math.floor(changes.length*.5)],p95RelativeEdgeChange:changes[Math.floor(changes.length*.95)],maxRelativeEdgeChange:changes.at(-1),changingEdges:changes.filter(v=>v>.002).length};
  }
  return result;
 });
 assert.ok(report.original.changingEdges>0);assert.ok(report.replacement.changingEdges/report.replacement.facialEdges>.4,'At least 40% of non-ear facial edges change length by more than 0.2%, excluding rigid motion');
 assert.ok(report.replacement.p95RelativeEdgeChange<report.original.p95RelativeEdgeChange,'Transferred head strain remains below the source head p95');
 await writeFile('bench/out/approved-head/head-deformation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close()}
