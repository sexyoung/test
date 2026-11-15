import {
  BufferGeometry, BufferAttribute, Color, DoubleSide, InstancedMesh,
  MeshLambertMaterial, Object3D, Raycaster, Vector3,
} from 'three';
import { createRandom } from '../../shared/math.js';

// Broadleaved trees shed their crowns; the existing pine species stays evergreen.
// Colors are species-specific, not one blanket tint over bark and leaves.
const SEASONS={
  spring:{layers:2,leaves:20,ground:'#c3d8a7',grass:'#b6d38b',palette:{oak:'#9fbb63',birch:'#b9d989',goldenTree:'#a5c47b',pine:'#729b79'}},
  summer:{layers:3,leaves:28,ground:'#ffffff',grass:'#ffffff',palette:{oak:'#6c9152',birch:'#9db86c',goldenTree:'#7e9e59',pine:'#577c62'}},
  autumn:{layers:2,leaves:420,ground:'#d5bf8b',grass:'#d8bf7c',palette:{oak:'#be793c',birch:'#d5b44e',goldenTree:'#c56038',pine:'#5d8062'}},
  winter:{layers:0,leaves:0,ground:'#c7cec6',grass:'#b8b7a2',palette:{oak:'#946c48',birch:'#b7a16f',goldenTree:'#ad754f',pine:'#5e8279'}},
};
const speciesOf=name=>name?.split('_')[0];

export function createSeasons(scene,{batches,manifest,timeUniform}) {
  let season='summer';
  const foliage=batches.filter(mesh=>mesh.userData.role?.startsWith('foliage-'));
  const coloredGeometry=new Map();
  for(const mesh of foliage) {
    // Batches of the same GLB share a geometry. Preserve its original facet
    // shading once, and recolor that geometry once per season.
    if(!coloredGeometry.has(mesh.geometry)) {
      const colors=mesh.geometry.attributes.color;
      const source=new Float32Array(colors.array);
      let mean=0;
      for(let i=0;i<colors.count;i++)mean+=(source[i*3]+source[i*3+1]+source[i*3+2])/3;
      mean/=colors.count;
      coloredGeometry.set(mesh.geometry,{source,mean,species:speciesOf(mesh.userData.gltfAsset)});
    }
  }
  const meadow=batches.find(mesh=>mesh.name==='meadow');
  const meadowColor=meadow?.material.color.clone();
  const grassMaterials=[...new Set(batches.filter(mesh=>mesh.name==='grass').map(mesh=>mesh.material))];
  const grassColors=grassMaterials.map(material=>material.color.clone());
  const trees=[];
  for(const [name,placements] of Object.entries(manifest.placements)) {
    if(!/^(oak|birch|goldenTree)(_|$)/.test(name))continue;
    const top=manifest.assets[name].bounds.max[1];
    for(const [x,y,z,yaw,scale] of placements)trees.push({x,y,z,yaw,scale,top,species:speciesOf(name)});
  }
  const leafGeometry=new BufferGeometry();
  // Folded leaf, not a camera-facing particle: it catches light as it tumbles.
  leafGeometry.setAttribute('position',new BufferAttribute(new Float32Array([
    -.08,0,0, 0,.025,.03, 0,0,.2,
    0,.025,.03, .08,0,0, 0,0,.2,
  ]),3));
  leafGeometry.computeVertexNormals();
  const leaves=new InstancedMesh(leafGeometry,new MeshLambertMaterial({color:'white',side:DoubleSide}),420);
  leaves.name='season-falling-leaves';leaves.frustumCulled=false;leaves.castShadow=false;leaves.receiveShadow=true;
  scene.add(leaves);
  const rand=createRandom(89321),dummy=new Object3D(),leafColor=new Color();
  const particles=Array.from({length:420},()=>({
    tree:trees[Math.floor(rand()*trees.length)],phase:rand(),life:11+rand()*8,
    fall:4+rand()*3,angle:rand()*Math.PI*2,radius:.4+rand()*1.5,
    size:.7+rand()*.8,spin:rand()*Math.PI*2,
  }));
  // Sample the authored terrain once for each landing spot, so settled leaves
  // follow the hills instead of floating at the source tree's root height.
  if(meadow){
    meadow.updateWorldMatrix(true,false);
    const ray=new Raycaster(new Vector3(),new Vector3(0,-1,0));
    for(const particle of particles){
      const tree=particle.tree;if(!tree)continue;
      let x=tree.x+Math.cos(particle.angle)*particle.radius*tree.scale+1.4;
      let z=tree.z+Math.sin(particle.angle)*particle.radius*tree.scale+.56;
      const lake=manifest.lake;
      if(Math.hypot((x-lake.x)/lake.rx,(z-lake.z)/lake.rz)<1.08){x=tree.x;z=tree.z;}
      ray.ray.origin.set(x,100,z);
      particle.ground=ray.intersectObject(meadow,false)[0]?.point.y??tree.y;
    }
  }
  let lastTime=NaN;
  function animateLeaves(force=false) {
    const time=timeUniform.value;
    if(!force&&time===lastTime)return;
    lastTime=time;
    particles.slice(0,leaves.count).forEach((p,i)=>{
      const tree=p.tree;if(!tree)return;
      const age=(time+p.phase*p.life)%p.life;
      const fall=Math.min(age/p.fall,1),settled=fall>=1;
      const originX=tree.x+Math.cos(p.angle)*p.radius*tree.scale;
      const originZ=tree.z+Math.sin(p.angle)*p.radius*tree.scale;
      const drift=fall*fall*1.4;
      let x=originX+drift+Math.sin(age*1.8+p.spin)*.35*(1-fall);
      let z=originZ+drift*.4+Math.cos(age*1.3+p.spin)*.4*(1-fall);
      // Keep settled leaves out of the pond, even for future tree placements.
      const lake=manifest.lake;
      if(Math.hypot((x-lake.x)/lake.rx,(z-lake.z)/lake.rz)<1.08){x=tree.x;z=tree.z;}
      const ground=p.ground??tree.y;
      const y=ground+.035+(1-fall)*(tree.y+tree.top*.72*tree.scale-ground);
      dummy.position.set(x,y,z);
      dummy.rotation.set(settled?0:age*2+p.spin,p.angle+Math.min(age,p.fall)*.9,settled?0:Math.sin(age*2.1+p.spin)*.8);
      const fade=Math.min(1,(p.life-age)/1.2,age/.35);
      dummy.scale.setScalar(p.size*Math.max(0,fade));dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);
    });
    leaves.instanceMatrix.needsUpdate=true;
  }
  function setSeason(value) {
    season=Object.hasOwn(SEASONS,value)?value:'summer';const setting=SEASONS[season];
    for(const mesh of foliage) {
      const evergreen=speciesOf(mesh.userData.gltfAsset)==='pine';
      const layer=Number(mesh.userData.role.slice(-1));
      // Autumn opens different gaps than spring, while winter exposes branches.
      mesh.visible=evergreen||(season==='autumn'?layer!==1:layer<setting.layers);
    }
    for(const [geometry,{source,mean,species}] of coloredGeometry) {
      const color=new Color(setting.palette[species]||setting.palette.oak),attribute=geometry.attributes.color;
      for(let i=0;i<attribute.count;i++) {
        const luminance=(source[i*3]+source[i*3+1]+source[i*3+2])/3;
        const shade=.78+.22*luminance/Math.max(mean,.01);
        attribute.setXYZ(i,color.r*shade,color.g*shade,color.b*shade);
      }
      attribute.needsUpdate=true;
    }
    if(meadow)meadow.material.color.copy(meadowColor).multiply(new Color(setting.ground));
    grassMaterials.forEach((material,i)=>material.color.copy(grassColors[i]).multiply(new Color(setting.grass)));
    leaves.count=trees.length?setting.leaves:0;leaves.visible=leaves.count>0;
    particles.slice(0,leaves.count).forEach((particle,i)=>{
      leafColor.set(setting.palette[particle.tree.species]);
      leafColor.multiplyScalar(.8+(i%7)*.04);leaves.setColorAt(i,leafColor);
    });
    if(leaves.instanceColor)leaves.instanceColor.needsUpdate=true;
    animateLeaves(true);
  }
  setSeason(season);
  return {
    setSeason,
    update(){animateLeaves();},
    get season(){return season;},
    get stats(){return {season,foliageBatches:foliage.length,visibleFoliageBatches:foliage.filter(mesh=>mesh.visible).length,fallingLeaves:leaves.count,deciduousTrees:trees.length};},
  };
}
