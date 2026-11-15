// Offline authoring coordinates. Runtime reads the exported route and placement manifest.
import { Vector3, CatmullRomCurve3 } from 'three';
import { createRandom } from '../../shared/math.js';
import { lake,lakeDistance,heightAt } from '../../shared/park-terrain.js';
export { lake,lakeDistance,heightAt };
export function makeLayout(){
  const random=createRandom(9127), placements={};
  const curve=new CatmullRomCurve3(Array.from({length:12},(_,i)=>{
    const a=i/12*Math.PI*2;return new Vector3(-3+Math.cos(a)*12.8,0,-3+Math.sin(a)*9.5);
  }),true);
  const points=curve.getSpacedPoints(320),route=[];
  function place(name,x,z,scale=1,yaw=0,y=heightAt(x,z)){
    if(['oak','birch','goldenTree','pine'].includes(name)){const variant=Math.floor(random()*4);if(variant)name+=`_${variant}`;}
    (placements[name]??=[]).push([x,y,z,yaw,scale]);
  }
  // A spacious central clearing; the three foreground trees frame, rather than cover, the pond.
  for(const [name,x,z,s] of [
    ['oak',-18,5,1.1],['goldenTree',17,2,1.05],['birch',-15,-14,1],
    ['oak',13,-16,1.05],['goldenTree',-5,-18,.95],['birch',20,-10,1.05],
  ])place(name,x,z,s,random()*6.28);
  for(let i=0;i<57;i++){
    const a=random()*Math.PI*2,r=24+random()*30,x=Math.cos(a)*r,z=Math.sin(a)*r;
    if(z>6&&Math.abs(x)<20)continue;
    place(['oak','birch','goldenTree','pine'][i%4],x,z,.75+random()*.45,random()*6.28);
  }
  place('bridge',4.4,-3,1,0,0);
  place('pavilion',11.7,-9.6,1,-.15);
  for(const [x,z,a] of [[-12,6,-.65],[7,8,.4],[-16,-6,1.5]])place('bench',x,z,1,a);
  for(const [x,z] of [[-10,5.8],[5.9,7.8],[-15.3,-7.5],[8.6,-6.5],[14.2,-7]])place('lantern',x,z,1,0);
  // Warm lamps follow the outside of the actual walkway, with gaps at the
  // pavilion and existing fixtures rather than clustering lights in one corner.
  for(let i=0;i<20;i++){
    const p=points[Math.floor(i/20*320)],next=points[(Math.floor(i/20*320)+1)%320];
    const dx=next.x-p.x,dz=next.z-p.z,length=Math.hypot(dx,dz);
    const x=p.x+dz/length*1.4,z=p.z-dx/length*1.4;
    if(Math.hypot(x-11.7,z+9.6)<4.5)continue;
    if(placements.lantern.some(l=>Math.hypot(x-l[0],z-l[2])<2.2))continue;
    place('lantern',x,z,.95,Math.atan2(dx,dz));
  }
  place('signpost',-1,8.5,1,-.25);
  for(const [x,z] of [[9.2,-6.8],[14.1,-7.4]]){
    place('planter',x,z,1,-.15);
    for(const dx of [-.45,0,.45])place('flowerPatch',x+dx,z,.65,random()*6.28,heightAt(x,z)+.58);
  }
  for(let i=0;i<55;i++){
    const a=i/55*Math.PI*2,q=1.05+random()*.07,x=lake.x+Math.cos(a)*lake.rx*q,z=lake.z+Math.sin(a)*lake.rz*q;
    if(x>3&&x<6.2)continue;
    place('rock',x,z,.45+random()*.55,random()*6.28,heightAt(x,z)+.04);
    if(i%3===0)place('reeds',x+.1,z,.7+random()*.3,random()*6.28);
  }
  for(let i=0;i<13;i++){
    const a=random()*6.28;place('lilies',-5+Math.cos(a)*2.8,-4+Math.sin(a)*2,.7+random()*.3,random()*6.28,lake.level+.025);
  }
  // A stratified meadow avoids the empty holes of sparse random sampling.
  // Close grass overlaps slightly; distant tufts grow larger and use a coarser
  // spacing so the hillside stays planted without multiplying the draw cost.
  function pathDistance(x,z){
    let nearest=Infinity;
    for(let i=0;i<320;i++){
      const a=points[i],b=points[i+1],dx=b.x-a.x,dz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
      nearest=Math.min(nearest,Math.hypot(x-a.x-t*dx,z-a.z-t*dz));
    }
    return nearest;
  }
  function insideProp(x,z,name,pad){
    return (placements[name]||[]).some(([px,,pz,yaw,scale])=>{
      const dx=x-px,dz=z-pz,c=Math.cos(yaw),sn=Math.sin(yaw);
      const lx=(c*dx-sn*dz)/scale,lz=(sn*dx+c*dz)/scale;
      return Math.abs(lx)<pad[0]&&Math.abs(lz)<pad[1];
    });
  }
  function plantable(x,z){
    if(lakeDistance(x,z)<1.12||pathDistance(x,z)<1.2)return false;
    if(insideProp(x,z,'pavilion',[3.6,3.4])||insideProp(x,z,'bench',[1.5,.85])||insideProp(x,z,'planter',[1.,.7]))return false;
    if(x>7.9&&x<12.8&&z>-10.1&&z<-5.5)return false; // paved pavilion apron
    if(Math.abs(x-4.4)<.85&&z>-10.5&&z<4.5)return false; // bridge landings
    if((placements.lantern||[]).some(p=>Math.hypot(x-p[0],z-p[2])<.35))return false;
    return true;
  }
  let grassIndex=0;
  function meadow(min,max,step,outer=false){
    for(let gz=min;gz<max;gz+=step)for(let gx=min;gx<max;gx+=step){
      if(outer&&Math.abs(gx)<37&&Math.abs(gz)<37)continue;
      const x=gx+(random()-.5)*step*.85,z=gz+(random()-.5)*step*.85;
      if(!plantable(x,z))continue;
      const size=outer?1.25+random()*.55:.85+random()*.45;
      place('grass',x,z,size,random()*Math.PI*2);
      if(!outer&&grassIndex++%160===0)place('flowerPatch',x,z,.65+random()*.3,random()*Math.PI*2);
    }
  }
  meadow(-37,37,.6);
  meadow(-62,62,1.65,true);
  for(const [x,z] of [[-18,4],[-17,5.6],[18,0],[17,-2],[-12,-15],[-14,-16],[14,-15],[16,-16],[-19,-4],[-20,-6]])place('shrub',x,z,1+random()*.5,random()*6.28);
  // Feature planting in soft drifts instead of identical flowers scattered everywhere.
  for(const [cx,cz]of [[-10,7],[9,9],[-17,-7],[15,-7]])for(let i=0;i<7;i++){
    const a=random()*6.28,r=random()*1.2;place('flowerPatch',cx+Math.cos(a)*r,cz+Math.sin(a)*r,.8+random()*.4,random()*6.28);
  }
  // Prefix-based instance LOD must thin the whole meadow, not erase rows.
  const shuffle=createRandom(49261),grass=placements.grass;
  for(let i=grass.length-1;i>0;i--){const j=Math.floor(shuffle()*(i+1));[grass[i],grass[j]]=[grass[j],grass[i]];}
  for(let i=0;i<320;i++){const p=points[i],n=points[i+1];route.push(p.x,heightAt(p.x,p.z)+.075,p.z,Math.atan2(n.x-p.x,n.z-p.z));}
  return {placements,route,routeLength:curve.getLength(),lake,points,displayCat:[0,heightAt(0,8.8),8.8]};
}
