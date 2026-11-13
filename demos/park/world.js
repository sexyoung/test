import {
  BufferGeometry, BufferAttribute, Mesh, InstancedMesh, MeshLambertMaterial,
  MeshBasicMaterial, Object3D, Vector3, CatmullRomCurve3,
} from 'three';
import { MeshBuilder, icosphere, transformShape, jitterShape } from '../../shared/geom.js';
import { createRandom, hash01, mat4FromEulerScale, smoothstep } from '../../shared/math.js';

const T = mat4FromEulerScale;
export const LAKE = { x: -3, z: -3, rx: 8.6, rz: 5.7, level: -0.24 };
export const lakeDistance = (x, z) => Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
export function heightAt(x, z) {
  const q = lakeDistance(x, z);
  const rolling = 0.25 + 0.28 * Math.sin(x * .105) * Math.cos(z * .13) + .16 * Math.sin(z * .21 + x * .09);
  const hills = smoothstep(21, 49, Math.hypot(x, z)) * (1.6 + 1.4 * Math.sin(x * .06 + z * .045));
  return rolling + hills - 1.9 * (1 - smoothstep(.78, 1.18, q));
}
const PALETTE = {
  grass: ['#a7b77c', '#a2b278', '#adbc83', '#a8b780'],
  leaf: ['#788f64', '#93a675', '#aaba83', '#bec38b'],
  wood: '#a47b56', woodDark: '#76573e', plank: '#cfac7c',
  path: ['#dfcda6', '#dcc8a0', '#e3d1aa'], rock: ['#b5b2a1', '#c6bfa9', '#a5a897'],
};
function geometry(builder, name) {
  const data = builder.build(name, 'linear'), g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(data.positions, 3));
  g.setAttribute('normal', new BufferAttribute(data.normals, 3));
  g.setAttribute('color', new BufferAttribute(data.colors, 3));
  g.computeBoundingSphere(); g.computeBoundingBox(); return g;
}
function crown(builder, rand, x, y, z, r, colors) {
  const shape = transformShape(jitterShape(icosphere(1, r), .12, rand), 1, .9, .9, x, y, z);
  builder.indexed(shape, (i, c, n) => colors[n[1] > .4 ? 2 : n[1] < -.2 ? 0 : 1]);
}
function tree(kind) {
  const r = createRandom(kind * 42 + 3), b = new MeshBuilder();
  const h = [4.6, 5.6, 4.1, 5.3][kind];
  b.prism(6, .29, .14, h * .66, PALETTE.woodDark, [0, -.05, 0]);
  for (const side of [-1, 1]) b.add(new MeshBuilder().prism(5, .13, .07, 1.7, PALETTE.wood), T(side*.14,h*.39,0,0,0,side*-.48));
  const colors = kind === 3 ? ['#b1a269', '#c7b477', '#dfc68c'] : PALETTE.leaf;
  crown(b,r,0,h*.86,0,1.6,colors);
  crown(b,r,-1.15,h*.7,.05,1.2,colors);
  crown(b,r,1.02,h*.74,-.1,1.25,colors);
  return b;
}
function bench() {
  const b = new MeshBuilder();
  for (const z of [-.23,0,.23]) b.box(2.3,.09,.19,PALETTE.plank,[0,.66,z]);
  for (const y of [1.02,1.25]) b.box(2.3,.17,.09,PALETTE.plank,[0,y,-.35]);
  for (const x of [-.9,.9]) {
    b.box(.1,.7,.65,PALETTE.woodDark,[x,.3,0]);
    b.box(.09,.7,.09,PALETTE.woodDark,[x,1,-.36]);
  }
  return b;
}
function pavilion() {
  const b = new MeshBuilder();
  b.box(5,.25,4.6,'#c6b59a',[0,.12,0]);
  for (let x=-2.2;x<2.4;x+=.28) b.box(.25,.1,4.25,PALETTE.plank,[x,.3,0]);
  for (const x of [-2.05,2.05]) for (const z of [-1.85,1.85]) {
    b.box(.21,3,.21,PALETTE.woodDark,[x,1.8,z]);
    b.box(.38,.16,.38,PALETTE.wood,[x,.42,z]);
  }
  for (const z of [-1.85,1.85]) b.box(4.6,.22,.22,PALETTE.wood,[0,3.2,z]);
  const roof = new MeshBuilder();
  roof.quad([-2.8,3.3,2.6],[2.8,3.3,2.6],[2.2,4.55,0],[-2.2,4.55,0],'#b97858');
  roof.quad([-2.2,4.55,0],[2.2,4.55,0],[2.8,3.3,-2.6],[-2.8,3.3,-2.6],'#96604b');
  roof.tri([-2.8,3.3,-2.6],[-2.8,3.3,2.6],[-2.2,4.55,0],'#cc946d');
  roof.tri([2.8,3.3,2.6],[2.8,3.3,-2.6],[2.2,4.55,0],'#a76c50');
  b.add(roof);
  b.box(4.55,.14,.18,'#d5a57a',[0,4.56,0]);
  b.add(bench(),T(0,.35,-1.45,0,0,0));
  return b;
}
function bridge() {
  const b = new MeshBuilder();
  const y = z => .55 + .48 * Math.cos(z / 4.5 * Math.PI / 2);
  for (let z=-4.4;z<4.5;z+=.27) b.box(2.25,.16,.24,PALETTE.plank,[0,y(z),z]);
  for (const x of [-1.06,1.06]) for (let z=-4.2;z<=4.3;z+=1.4) {
    b.box(.12,1.15,.12,PALETTE.woodDark,[x,y(z)+.46,z]);
    if(z<4.1) {
      const z2=z+1.4, mid=(z+z2)/2, tilt=-Math.atan2(y(z2)-y(z),1.4);
      b.add(new MeshBuilder().box(.11,.11,1.45,PALETTE.wood),T(x,y(mid)+.92,mid,tilt,0,0));
    }
  }
  return b;
}
function flowers() {
  const b = new MeshBuilder();
  for(const [x,z,h] of [[0,0,.38],[.16,.1,.28],[-.16,-.1,.32]]) {
    b.prism(3,.012,.008,h,'#738359',[x,0,z]);
    b.prism(5,.12,.065,.055,'#f2e3b3',[x,h,z]);
    b.prism(5,.04,.04,.02,'#d6a75b',[x,h+.055,z]);
  }
  return b;
}
function grasses() {
  const b=new MeshBuilder();
  for(let i=0;i<3;i++) { const a=i*2.1,x=Math.cos(a)*.12,z=Math.sin(a)*.12;
    b.triDouble([x-.05,0,z],[x+.05,0,z],[x*1.7,.28+i*.05,z*1.7],i%2?'#8b9f69':'#96aa72'); }
  return b;
}
function reeds() {
  const b=new MeshBuilder();
  for(let i=0;i<4;i++) {const x=(i%2)*.2,z=Math.floor(i/2)*.17,h=.65+i*.12;
    b.prism(3,.016,.012,h,'#798553',[x,0,z]);
    b.prism(5,.048,.04,.2,'#897254',[x,h-.1,z]);
    b.triDouble([x,0,z],[x+.1,.06,z],[x+.3,.6,z+.06],'#8a9561'); }
  return b;
}

export function createPark(scene) {
  const mat = new MeshLambertMaterial({vertexColors:true});
  const rand = createRandom(9284), batches = [], props = [];
  function add(builder,name,cast=true) {
    const m=new Mesh(geometry(builder,name),mat);m.name=name;m.castShadow=cast;m.receiveShadow=true;m.matrixAutoUpdate=false;scene.add(m);props.push(m);return m;
  }
  const terrain = new MeshBuilder(), N=80, step=1.7, half=N*step/2;
  const point=(x,z)=>{
    const ix=Math.round((x+half)/step),iz=Math.round((z+half)/step),id=ix+iz*(N+1);
    if(ix>0&&ix<N&&iz>0&&iz<N){x+=(hash01(id,71)-.5)*step*.7;z+=(hash01(id,72)-.5)*step*.7;}
    return [x,heightAt(x,z),z];
  };
  for(let z=0;z<N;z++) for(let x=0;x<N;x++) {
    const X=x*step-half,Z=z*step-half;
    const a=point(X,Z),b=point(X,Z+step),c=point(X+step,Z+step),d=point(X+step,Z);
    const color=PALETTE.grass[Math.floor(hash01(x+z*N,5)*4)];
    terrain.tri(a,b,c,color);terrain.tri(a,c,d,color);
  }
  add(terrain,'meadow',false);

  // Arc-length sampled route, reused by the visible path and the cat motion.
  const curve=new CatmullRomCurve3(Array.from({length:12},(_,i)=>{const a=i/12*Math.PI*2;return new Vector3(-3+Math.cos(a)*12.5,0,-3+Math.sin(a)*9.1);}),true);
  const points=curve.getSpacedPoints(320), path=new MeshBuilder();
  const edge=(i,side)=>{const p=points[i%320],n=points[(i+1)%320];let dx=n.x-p.x,dz=n.z-p.z;const l=Math.hypot(dx,dz);dx/=l;dz/=l;const x=p.x+dz*side*.7,z=p.z-dx*side*.7;return [x,heightAt(x,z)+.035,z];};
  for(let i=0;i<320;i++)path.quad(edge(i,-1),edge(i+1,-1),edge(i+1,1),edge(i,1),PALETTE.path[0]);
  add(path,'lakeside-path',false);
  // A fork to the pavilion; build into a single mesh rather than individual paving blocks.
  const spur=new MeshBuilder();
  for(let i=0;i<20;i++){const x=9+i*.18,z=-6-i*.13;spur.quad([x-.7,heightAt(x-.7,z)+.04,z],[x-.7,heightAt(x-.7,z-.35)+.04,z-.35],[x+.7,heightAt(x+.7,z-.35)+.04,z-.35],[x+.7,heightAt(x+.7,z)+.04,z],PALETTE.path[0]);}
  add(spur,'pavilion-path',false);
  add(pavilion(),'tea-pavilion').geometry.translate(11,heightAt(11,-9),-9);
  add(bridge(),'cedar-bridge').geometry.translate(4.4,0,-3);
  for(const [x,z,yaw] of [[-12,6,-.65],[7,8,.4],[-16,-6,1.5]]) add(bench(),`bench-${x}`).geometry.applyMatrix4(matrixAt(x,heightAt(x,z),z,yaw));

  // Same model per spatial cell: few calls, with useful culling instead of one park-wide bound.
  const dummy=new Object3D();
  function instances(builder,name,placements,cast=true) {
    const geo=geometry(builder,name), cells=new Map();
    for(const p of placements) {const key=`${Math.floor(p[0]/18)},${Math.floor(p[2]/18)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(p);}
    for(const group of cells.values()) {
      const mesh=new InstancedMesh(geo,mat,group.length);mesh.name=name;
      group.forEach(([x,y,z,yaw,s],i)=>{dummy.position.set(x,y,z);dummy.rotation.set(0,yaw,0);dummy.scale.setScalar(s);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});
      mesh.computeBoundingSphere();mesh.computeBoundingBox();mesh.castShadow=cast;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;
      scene.add(mesh);batches.push(mesh);
    }
  }
  const treeSets=Array.from({length:4},()=>[]), rockSet=[], flowerSet=[], grassSet=[], reedSet=[];
  // Deliberate foreground frame and a quiet clearing around the lake.
  const heroTrees=[[-18,9,1.25,0],[-21,-3,1.3,1],[16,5,1.15,3],[18,-12,1.2,0],[-4,-17,1.1,1],[-12,-16,1.05,0]];
  for(const [x,z,s,k]of heroTrees)treeSets[k].push([x,heightAt(x,z),z,rand()*6.28,s]);
  for(let i=0;i<100;i++) {
    const a=rand()*6.28,r=21+rand()*32,x=Math.cos(a)*r,z=Math.sin(a)*r;
    if(z>10&&Math.abs(x)<18)continue;
    const k=i%4;treeSets[k].push([x,heightAt(x,z),z,rand()*6.28,.85+rand()*.65]);
  }
  for(let i=0;i<75;i++){
    const a=rand()*6.28,q=1.03+rand()*.12,x=LAKE.x+Math.cos(a)*LAKE.rx*q,z=LAKE.z+Math.sin(a)*LAKE.rz*q;
    if(x>3&&x<6)continue;
    rockSet.push([x,heightAt(x,z)+.05,z,rand()*6.28,.35+rand()*.5]);
    if(i%2===0)reedSet.push([x,heightAt(x,z),z,rand()*6.28,.8+rand()*.35]);
  }
  for(let i=0;i<1050;i++) {
    const x=(rand()-.5)*65,z=(rand()-.5)*55,q=lakeDistance(x,z);
    const routeQ=Math.hypot((x+3)/12.5,(z+3)/9.1);
    if(q<1.23||Math.abs(routeQ-1)<.13||Math.hypot(x-11,z+9)<4)continue;
    const p=[x,heightAt(x,z),z,rand()*6.28,.7+rand()*.65];
    if(i%6===0)flowerSet.push(p);else grassSet.push(p);
  }
  treeSets.forEach((p,i)=>instances(tree(i),`trees-${i}`,p));
  const rock=new MeshBuilder();rock.indexed(transformShape(jitterShape(icosphere(0,1),.15,rand),1,.65,.85),i=>PALETTE.rock[i%3]);
  instances(rock,'shore-rocks',rockSet);instances(flowers(),'wildflowers',flowerSet,false);instances(grasses(),'grass',grassSet,false);instances(reeds(),'reeds',reedSet,false);

  // One water surface; procedural moving glints, no reflection camera or offscreen pass.
  const waterShape=new MeshBuilder();
  for(let i=0;i<72;i++){const a=i/72*6.28,b=(i+1)/72*6.28;
    waterShape.tri([LAKE.x,LAKE.level,LAKE.z],[LAKE.x+Math.cos(b)*LAKE.rx,LAKE.level,LAKE.z+Math.sin(b)*LAKE.rz],[LAKE.x+Math.cos(a)*LAKE.rx,LAKE.level,LAKE.z+Math.sin(a)*LAKE.rz],'#81b6ac');}
  const waterMat=new MeshBasicMaterial({color:'#81b6ac'}), timeUniform={value:0};
  waterMat.onBeforeCompile=shader=>{
    shader.uniforms.parkTime=timeUniform;
    shader.vertexShader='varying vec2 lakeXZ;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nlakeXZ = position.xz;');
    shader.fragmentShader='varying vec2 lakeXZ; uniform float parkTime;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float ripple = sin(lakeXZ.x * 2.8 + lakeXZ.y * 3.7 + parkTime * .7);
      float glint = smoothstep(.94, 1., ripple) * .07;
      diffuseColor.rgb *= .97 + .035 * sin(lakeXZ.y * .65 + parkTime * .2);
      diffuseColor.rgb += glint;`);
  };
  const water=new Mesh(geometry(waterShape,'lake'),waterMat);water.name='lake';scene.add(water);
  // Flat lily pads, batched with their small flowers.
  const lilies=new MeshBuilder();
  for(let i=0;i<12;i++) {const a=rand()*6.28,x=-5+Math.cos(a)*2.8,z=-4+Math.sin(a)*2;
    lilies.prism(7,.25,.25,.012,'#779875',[x,LAKE.level+.025,z]);
    if(i%3===0)lilies.prism(5,.12,.04,.12,'#ead3b4',[x,LAKE.level+.04,z]);}
  add(lilies,'water-lilies',false);
  const stepping=new MeshBuilder();
  for(const direction of [-1,1])for(let i=0;i<5;i++) {
    const x=4.4+(i%2-.5)*.2,z=-3+direction*(4.6+i*.55);
    stepping.prism(6,.36,.32,.1,'#c9c1a6',[x,heightAt(x,z)+.015,z]);
  }
  add(stepping,'bridge-stepping-stones',false);

  const route=new Float32Array(320*4); // x, ground, z, heading
  for(let i=0;i<320;i++){const p=points[i],n=points[i+1];route.set([p.x,heightAt(p.x,p.z)+.04,p.z,Math.atan2(n.x-p.x,n.z-p.z)],i*4);}
  return {
    route, routeLength:curve.getLength(), timeUniform, waterMaterial:waterMat,
    setDetail(level) {for(const m of batches)if(m.name==='grass'||m.name==='wildflowers')m.visible=level!=='low';},
    stats:{staticBatches:batches.length+props.length+1,instances:batches.reduce((n,m)=>n+m.count,0)},
  };
}
// Matrix construction is a one-time authoring operation.
function matrixAt(x,y,z,yaw) {const o=new Object3D();o.position.set(x,y,z);o.rotation.y=yaw;o.updateMatrix();return o.matrix;}
