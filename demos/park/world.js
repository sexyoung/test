import {
  InstancedMesh, MeshLambertMaterial, Object3D, PointLight, Vector3,
} from 'three';
import { attachMeadow, updateGrass } from './meadow.js';
import { createSnowCover } from './snow-cover.js';
import { createSeasons } from './seasons.js';
import { addWind, createWaterMaterial } from './materials.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// All visible garden geometry is authored offline and loaded from actual GLBs.
// Only placement, batching and the animated water material are configured here.
export async function createPark(scene, onProgress = () => {}) {
  // Resolve from the demo page, including when Vite builds with base: './'
  // or the entire site is hosted beneath a subdirectory.
  const base=new URL('../../models/park/',document.baseURI).href;
  const response=await fetch(`${base}manifest.json`);
  if(!response.ok)throw new Error(`公園配置載入失敗 (${response.status})`);
  const manifest=await response.json(), loader=new GLTFLoader(), entries=Object.entries(manifest.assets);
  let loaded=0;
  const templates=new Map(await Promise.all(entries.map(async([name,asset])=>{
    const gltf=await loader.loadAsync(`${base}${asset.file}`);
    onProgress(++loaded,entries.length);
    return [name,gltf.scene];
  })));
  const batches=[],glowMaterials=[],lamps=[],lampPositions=[],timeUniform={value:0},windStrength={value:1},snowAmount={value:0};
  const materialCache=new Map();
  function materialFor(source,name=''){
    if(!materialCache.has(source)){
      const mat=new MeshLambertMaterial({color:source.color,vertexColors:source.vertexColors,
        side:source.side,emissive:source.emissive,emissiveIntensity:0});
      mat.name=source.name;
      if(/^(oak|birch|goldenTree|pine|grass|flowerPatch|reeds|shrub)/.test(name))addWind(mat,timeUniform,name,windStrength);
      if(source.name==='lantern-glow')glowMaterials.push(mat);
      materialCache.set(source,mat);
    }
    return materialCache.get(source);
  }
  const waterMaterial=createWaterMaterial(timeUniform,manifest.lake);
  const landscape=templates.get('landscape');
  landscape.traverse(o=>{
    if(!o.isMesh)return;
    o.material=o.userData.role==='water'?waterMaterial:materialFor(o.material);
    if(o.name==='meadow')attachMeadow(o.material,{timeUniform,windStrength,snowAmount});
    o.castShadow=false;o.receiveShadow=o.userData.role!=='water';
    o.userData.gltfAsset='landscape';batches.push(o);
  });
  scene.add(landscape);
  const dummy=new Object3D();let instanceCount=0;
  for(const[name,placements]of Object.entries(manifest.placements)){
    const template=templates.get(name),cells=new Map();
    if(!template)throw new Error(`公園模型缺少 ${name}`);
    for(const p of placements){const key=`${Math.floor(p[0]/22)},${Math.floor(p[2]/22)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(p);}
    template.updateMatrixWorld(true);
    template.traverse(part=>{
      if(!part.isMesh)return;
      for(const cell of cells.values()){
        const mesh=new InstancedMesh(part.geometry,materialFor(part.material,name),cell.length);
        mesh.name=name==='flowerPatch'?'wildflowers':name;
        mesh.userData={...part.userData,gltfAsset:name,fullCount:cell.length};
        cell.forEach(([x,y,z,yaw,s],i)=>{
          dummy.position.set(x,y,z);dummy.rotation.set(0,yaw,0);dummy.scale.setScalar(s);dummy.updateMatrix();
          mesh.setMatrixAt(i,dummy.matrix.clone().multiply(part.matrixWorld));
        });
        mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.instanceMatrix.needsUpdate=true;
        if(mesh.material.userData.windDepth){
          mesh.customDepthMaterial=mesh.material.userData.windDepth;
          mesh.boundingBox.expandByScalar(1.5);mesh.boundingSphere.radius+=1.5;
        }
        mesh.castShadow=!['grass','flowerPatch','reeds','lilies'].includes(name)&&part.userData.role!=='glow';
        mesh.receiveShadow=part.userData.role!=='glow';mesh.matrixAutoUpdate=false;
        scene.add(mesh);batches.push(mesh);
      }
    });
    instanceCount+=placements.length;
    if(name==='lantern')for(const[x,y,z,,s]of placements)lampPositions.push(new Vector3(x,y+2*s,z));
  }
  // Keep a fixed light budget as the camera moves, while every lantern glows.
  for(let i=0;i<Math.min(8,lampPositions.length);i++){
    const light=new PointLight('#ffbd77',0,9,2);light.position.copy(lampPositions[i]);
    scene.add(light);lamps.push(light);
  }
  const seasons=createSeasons(scene,{batches,manifest,timeUniform});
  const snowCover=createSnowCover({batches,timeUniform,amount:snowAmount});
  let night=0,targetNight=0,detail='high';
  function updateLighting(){
    for(const mat of glowMaterials)mat.emissiveIntensity=night*2.8;
    for(const lamp of lamps)lamp.intensity=night*12;
  }
  return {
    route:new Float32Array(manifest.route),routeLength:manifest.routeLength,
    displayCat:manifest.displayCat, timeUniform,waterMaterial,windStrength,seasons,snowCover,
    setWeather(mode,immediate=false){snowCover.setWeather(mode,immediate);},
    setSeason(mode){seasons.setSeason(mode);},
    get season(){return seasons.season;},
    setTimeOfDay(mode,immediate=false){targetNight=mode==='night'?1:mode==='dusk'?.45:0;if(immediate){night=targetNight;updateLighting();}},
    update(dt,camera){
      night+=(targetNight-night)*(1-Math.exp(-dt*4));updateLighting();
      if(camera){
        const nearest=[...lampPositions].sort((a,b)=>a.distanceToSquared(camera.position)-b.distanceToSquared(camera.position));
        lamps.forEach((lamp,i)=>lamp.position.copy(nearest[i]));
      }
      seasons.update(dt);snowCover.update(dt);
      if(camera)updateGrass(batches,camera,detail,snowAmount.value);
    },
    setDetail(level){
      detail=level;
      for(const m of batches)if(m.name==='wildflowers')m.count=Math.ceil(m.userData.fullCount*(level==='low'?.35:1));
    },
    stats:{lanterns:lampPositions.length,activeLights:lamps.length,staticBatches:batches.length,instances:instanceCount,glbAssets:entries.length,assetBytes:entries.reduce((n,[,a])=>n+a.bytes,0)},
  };
}
