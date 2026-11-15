import { BufferGeometry,BufferAttribute,Mesh,MeshStandardMaterial,Group,Color } from 'three';
import { MeshBuilder } from '../../shared/geom.js';
import { hash01,mat4FromEulerScale } from '../../shared/math.js';
import { heightAt,lake } from './layout.mjs';
function mesh(builder,name){
  const data=builder.build(name,'linear'),g=new BufferGeometry();
  for(const [key,array]of [['position',data.positions],['normal',data.normals],['color',data.colors]])g.setAttribute(key,new BufferAttribute(array,3));
  const m=new Mesh(g,new MeshStandardMaterial({vertexColors:true,roughness:1}));m.name=name;return m;
}
export function createLandscape(layout){
  const root=new Group();root.name='landscape';
  const terrain=new MeshBuilder(),N=96,step=1.4,half=N*step/2;
  function point(ix,iz){let x=ix*step-half,z=iz*step-half,id=ix+iz*(N+1);
    if(ix>0&&ix<N&&iz>0&&iz<N){x+=(hash01(id,71)-.5)*step*.7;z+=(hash01(id,72)-.5)*step*.7;}
    return [x,heightAt(x,z),z];
  }
  for(let z=0;z<N;z++)for(let x=0;x<N;x++){
    const a=point(x,z),b=point(x,z+1),c=point(x+1,z+1),d=point(x+1,z);
    const field=(Math.sin(a[0]*.15+a[2]*.07)+Math.cos(a[2]*.19))*.5;
    const color=new Color('#a8b983').lerp(new Color('#849e72'),(field+1)*.2);
    // Convert back to authored sRGB for MeshBuilder, with restrained facet variation.
    color.multiplyScalar(.96+hash01(x+z*N,5)*.08);
    const hex='#'+color.getHexString();terrain.tri(a,b,c,hex);terrain.tri(a,c,d,hex);
  }
  root.add(mesh(terrain,'meadow'));
  const path=new MeshBuilder(),edging=new MeshBuilder(),points=layout.points;
  function edge(i,side){const p=points[i%320],n=points[(i+1)%320],l=Math.hypot(n.x-p.x,n.z-p.z);
    const x=p.x+(n.z-p.z)/l*side,z=p.z-(n.x-p.x)/l*side;return[x,heightAt(x,z)+.06,z];}
  for(let i=0;i<320;i++){
    path.quad(edge(i,-.86),edge(i+1,-.86),edge(i+1,.86),edge(i,.86),'#d4bf99');
    if(i%2===0)for(const side of [-1,1]){
      const a=edge(i,side*.98),b=edge(i+2,side*.98),mid=a.map((v,j)=>(v+b[j])/2),yaw=Math.atan2(b[0]-a[0],b[2]-a[2]);
      edging.add(new MeshBuilder().box(.17,.12,Math.hypot(b[0]-a[0],b[2]-a[2])*.93,i%4?'#aea38a':'#c2b79f'),mat4FromEulerScale(mid[0],mid[1]-.025,mid[2],0,yaw,0));
    }
  }
  // A small paved apron connects the teahouse to the lake loop.
  const stones=new MeshBuilder();
  for(let i=0;i<10;i++)for(let j=0;j<4;j++){
    const x=8.5+j*.7+i*.17,z=-6-i*.42;
    stones.prism(6,.41,.38,.12,(i+j)%2?'#bdb7a3':'#cec3aa',[x,heightAt(x,z)+.03,z]);
  }
  for(const direction of [-1,1])for(let i=0;i<5;i++){
    const x=4.4+(i%2-.5)*.18,z=-3+direction*(4.6+i*.55);
    stones.prism(6,.4,.36,.12,'#c9c1a6',[x,heightAt(x,z)+.03,z]);
  }
  root.add(mesh(path,'lakeside-path'),mesh(edging,'path-edging'),mesh(stones,'paved-landings'));
  const surface=new MeshBuilder();
  const sectors=128,rings=32;
  const lakePoint=(ring,i)=>{const a=i/sectors*Math.PI*2,r=ring/rings;return[lake.x+Math.cos(a)*lake.rx*r,lake.level,lake.z+Math.sin(a)*lake.rz*r];};
  for(let i=0;i<sectors;i++) {
    surface.tri([lake.x,lake.level,lake.z],lakePoint(1,i+1),lakePoint(1,i),'#ffffff');
    for(let ring=1;ring<rings;ring++)surface.quad(lakePoint(ring,i),lakePoint(ring,i+1),lakePoint(ring+1,i+1),lakePoint(ring+1,i),'#ffffff');
  }
  const water=mesh(surface,'lake');water.material.name='water';root.add(water);
  return root;
}
