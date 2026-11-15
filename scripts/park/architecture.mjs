// Original Sunlit Grove architecture, authored offline and exported by make-park-glb.mjs.
// Shapes are in metres, Y up. Model origins sit at ground level.
import {
  BoxGeometry, BufferGeometry, Float32BufferAttribute, ConeGeometry, CylinderGeometry,
  Group, Mesh, MeshStandardMaterial, Vector3, Shape, ExtrudeGeometry,
} from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

const COLORS={cedar:'#a77d58',edge:'#d1ac7b',light:'#caa171',dark:'#654b38',iron:'#465950',stone:'#aaa69a',roof:'#b26b51',roofLight:'#c37d5a',roofDark:'#92523f',sage:'#7f9471'};
const materials=new Map();
function mat(color){if(!materials.has(color))materials.set(color,new MeshStandardMaterial({color,roughness:1,metalness:0}));return materials.get(color);}
function part(root,name,geometry,color,position=[0,0,0],rotation=[0,0,0]){
  const g=geometry.index?geometry.toNonIndexed():geometry;
  g.deleteAttribute('uv');g.computeVertexNormals();
  const mesh=new Mesh(g,typeof color==='string'?mat(color):color);mesh.name=name;
  mesh.position.fromArray(position);mesh.rotation.fromArray(rotation);root.add(mesh);return mesh;
}
function chamfer(w,h,d,b=.035){
  b=Math.min(b,w*.2,h*.2,d*.2);const p=[];
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
    p.push(new Vector3(x*w/2,y*(h/2-b),z*(d/2-b)));
    p.push(new Vector3(x*(w/2-b),y*h/2,z*(d/2-b)));
    p.push(new Vector3(x*(w/2-b),y*(h/2-b),z*d/2));
  }
  return new ConvexGeometry(p);
}
function beam(root,name,a,b,width,depth,color){
  const start=new Vector3(...a),end=new Vector3(...b),delta=end.clone().sub(start);
  const m=part(root,name,new BoxGeometry(width,delta.length(),depth),color,start.add(end).multiplyScalar(.5).toArray());
  m.quaternion.setFromUnitVectors(new Vector3(0,1,0),delta.normalize());return m;
}
function cappedPost(root,name,x,y,z,height,width=.19){
  part(root,name,chamfer(width,height,width,.025),COLORS.dark,[x,y+height/2,z]);
  part(root,`${name}-collar`,chamfer(width*1.3,.11,width*1.3,.018),COLORS.edge,[x,y+height-.04,z]);
  part(root,`${name}-cap`,new ConeGeometry(width*.95,.15,4),COLORS.cedar,[x,y+height+.075,z],[0,Math.PI/4,0]);
}
// A rectangular swept section makes a continuous arched rail, with deliberate planar facets.
function arch(root,name,x,zmin,zmax,yAt,width,height,color,segments=24){
  const p=[],indices=[];
  for(let i=0;i<=segments;i++){const z=zmin+(zmax-zmin)*i/segments,y=yAt(z);for(const [dx,dy]of [[-width/2,-height/2],[width/2,-height/2],[width/2,height/2],[-width/2,height/2]])p.push(x+dx,y+dy,z);}
  for(let i=0;i<segments;i++)for(let j=0;j<4;j++){const a=i*4+j,b=i*4+(j+1)%4,c=b+4,d=a+4;indices.push(a,b,d,b,c,d);}
  indices.push(0,3,1,1,3,2);const e=segments*4;indices.push(e,e+1,e+3,e+1,e+2,e+3);
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setIndex(indices);return part(root,name,g,color);
}
function bridge(){
  const g=new Group();g.name='cedar-moon-bridge';const deck=z=>.45+.65*(1-(z/4.5)**2);
  for(let i=0;i<30;i++){
    const z=-4.35+i*.3,tilt=-Math.atan(-1.3*z/(4.5**2));
    part(g,`deck-plank-${i}`,chamfer(2.48,.15,.278,.022),i%4===0?COLORS.edge:i%3===0?COLORS.cedar:COLORS.light,[0,deck(z),z],[tilt,0,0]);
    // Dark square dowel heads read at close distance without extra material calls after baking.
    for(const x of [-1.03,1.03]){const pin=new BufferGeometry();pin.setAttribute('position',new Float32BufferAttribute([-.023,0,-.023,-.023,0,.023,.023,0,.023,-.023,0,-.023,.023,0,.023,.023,0,-.023],3));part(g,'plank-dowel',pin,COLORS.dark,[x,deck(z)+.081,z]);}
  }
  for(const x of [-1.08,1.08]){
    arch(g,'continuous-handrail',x,-4.5,4.5,z=>deck(z)+1.02,.18,.15,COLORS.edge);
    arch(g,'lower-railing',x,-4.4,4.4,z=>deck(z)+.36,.1,.1,COLORS.cedar,18);
    arch(g,'arched-stringer',x,-4.5,4.5,z=>deck(z)-.25,.2,.32,COLORS.dark);
    for(let i=0;i<7;i++){const z=-4.2+i*1.4;cappedPost(g,`bridge-post-${x}-${i}`,x,deck(z)-.12,z,1.24,.18);}
    for(let i=0;i<12;i++){const z=-3.85+i*.7;beam(g,'railing-spindle',[x,deck(z)+.35,z],[x,deck(z)+.96,z],.065,.065,COLORS.cedar);}
  }
  for(const z of [-3.7,3.7]){
    for(const x of [-.96,.96])part(g,'bridge-foot',chamfer(.42,.6,.5,.06),COLORS.stone,[x,.3,z]);
    beam(g,'bridge-cross-brace',[-1.05,.15,z],[1.05,.55,z],.12,.13,COLORS.dark);
  }
  return g;
}
function bench(){
  const g=new Group();g.name='garden-bench';
  for(const x of [-.88,.88]){
    beam(g,'front-leg',[x,0,.3],[x,.62,.2],.13,.14,COLORS.iron);
    beam(g,'back-leg',[x,0,-.32],[x,.7,-.24],.13,.14,COLORS.iron);
    beam(g,'back-upright',[x,.48,-.22],[x,1.4,-.52],.1,.12,COLORS.iron);
    beam(g,'seat-support',[x,.55,-.36],[x,.55,.37],.13,.13,COLORS.iron);
    beam(g,'arm-front',[x*1.21,.58,.27],[x*1.21,.91,.25],.075,.075,COLORS.iron);
    part(g,'arm-rest',chamfer(.14,.09,.84,.025),COLORS.cedar,[x*1.21,.94,-.04],[.08,0,0]);
  }
  for(let i=0;i<5;i++){const z=-.3+i*.15;part(g,'seat-slat',chamfer(2.4,.095,.13,.018),i%2?COLORS.edge:COLORS.light,[0,.64+.03*Math.cos(z*6),z]);}
  for(let i=0;i<4;i++)part(g,'back-slat',chamfer(2.4,.14,.075,.018),i%2?COLORS.edge:COLORS.light,[0,.88+i*.16,-.33-i*.052],[-.31,0,0]);
  beam(g,'under-seat-stretcher',[-.88,.28,0],[.88,.28,0],.07,.08,COLORS.iron);
  return g;
}
function roofStrip(root,name,a,b,c,d,color){
  const geom=new BufferGeometry();geom.setAttribute('position',new Float32BufferAttribute([...a,...b,...c,...a,...c,...d],3));
  part(root,name,geom,color);
}
function pavilion(){
  const g=new Group();g.name='lakeside-tea-pavilion';
  part(g,'stone-plinth',chamfer(5.7,.22,4.7,.09),COLORS.stone,[0,.11,0]);
  part(g,'deck-edge',chamfer(5.5,.18,4.5,.055),COLORS.dark,[0,.28,0]);
  for(let i=0;i<20;i++)part(g,'deck-board',new BoxGeometry(.259,.1,4.3),i%4===0?COLORS.edge:COLORS.light,[-2.58+i*.272,.4,0]);
  for(const [w,y,z]of [[2.4,.08,2.79],[2.18,.19,2.55]])part(g,'entrance-step',chamfer(w,.16,.45,.04),COLORS.light,[0,y,z]);
  for(const x of [-2.35,2.35])for(const z of [-1.9,1.9]){
    part(g,'post-socket',chamfer(.46,.29,.46,.05),COLORS.stone,[x,.57,z]);
    part(g,'cedar-pillar',chamfer(.23,2.8,.23,.025),COLORS.cedar,[x,2.02,z]);
    part(g,'pillar-capital',chamfer(.43,.18,.43,.025),COLORS.edge,[x,3.35,z]);
    beam(g,'knee-brace-x',[x,2.58,z],[x-Math.sign(x)*.78,3.35,z],.12,.15,COLORS.dark);
    beam(g,'knee-brace-z',[x,2.58,z],[x,3.35,z-Math.sign(z)*.75],.15,.12,COLORS.dark);
  }
  for(const z of [-1.9,1.9])part(g,'header-beam',chamfer(5.2,.26,.23,.025),COLORS.dark,[0,3.43,z]);
  for(const x of [-2.35,2.35])part(g,'header-beam',chamfer(.23,.26,4.25,.025),COLORS.dark,[x,3.43,0]);
  // Four hipped roof slopes, divided into alternating terracotta panels and overlapping courses.
  const rings=[{x:3.15,z:2.65,y:3.5},{x:2.84,z:2.34,y:3.72},{x:1.72,z:1.22,y:4.5},{x:.65,z:.15,y:5.08}];
  for(let course=0;course<3;course++){
    const a=rings[course],b=rings[course+1];
    for(let side=0;side<4;side++){
      const ring=r=>[[-r.x,r.y,r.z],[r.x,r.y,r.z],[r.x,r.y,-r.z],[-r.x,r.y,-r.z]];
      const outer=ring(a),inner=ring(b),s=side,t=(side+1)%4;
      for(let j=0;j<8;j++){
        const lerp=(p,q,u)=>p.map((v,k)=>v+(q[k]-v)*u);
        roofStrip(g,'terracotta-roof-course',lerp(outer[s],outer[t],j/8),lerp(outer[s],outer[t],(j+1)/8),lerp(inner[s],inner[t],(j+1)/8),lerp(inner[s],inner[t],j/8),[COLORS.roof,COLORS.roofLight,COLORS.roofDark][(j+side+course)%3]);
      }
      beam(g,'roof-course-lip',outer[s],outer[t],.065,.065,COLORS.roofDark);
    }
  }
  // Solid soffits give the eaves visible thickness from the lake camera.
  for(const z of [-2.58,2.58])part(g,'eave-fascia',chamfer(6.3,.16,.15,.025),COLORS.edge,[0,3.46,z]);
  for(const x of [-3.08,3.08])part(g,'eave-fascia',chamfer(.15,.16,5.3,.025),COLORS.edge,[x,3.46,0]);
  part(g,'roof-ridge',chamfer(1.62,.16,.38,.04),COLORS.roofDark,[0,5.09,0]);
  for(const x of [-.74,.74])part(g,'ridge-end',new ConeGeometry(.16,.25,4),COLORS.roofLight,[x,5.25,0],[0,Math.PI/4,0]);
  for(const x of [-2.32,2.32]){
    for(const y of [.92,1.33])part(g,'side-rail',new BoxGeometry(.1,.1,3.7),COLORS.edge,[x,y,0]);
    for(let i=0;i<8;i++)beam(g,'side-baluster',[x,.88,-1.58+i*.45],[x,1.35,-1.58+i*.45],.065,.065,COLORS.cedar);
  }
  // A built-in rear seat leaves the pavilion entrance open and readable.
  for(const z of [-1.72,-1.52,-1.32])part(g,'rear-bench-slat',chamfer(4.1,.1,.17,.015),COLORS.light,[0,.94,z]);
  for(const x of [-1.6,1.6])part(g,'rear-bench-leg',new BoxGeometry(.13,.5,.45),COLORS.dark,[x,.68,-1.5]);
  for(const y of [1.26,1.47])part(g,'rear-bench-back',chamfer(4.1,.16,.08,.015),COLORS.edge,[0,y,-1.86]);
  return g;
}
function lantern(){
  const g=new Group();g.name='warm-garden-lantern';
  part(g,'stone-foot',new CylinderGeometry(.22,.3,.14,6),COLORS.stone,[0,.07,0]);
  part(g,'pole-base',new CylinderGeometry(.11,.15,.3,6),COLORS.iron,[0,.28,0]);
  part(g,'tapered-pole',new CylinderGeometry(.055,.085,1.46,6),COLORS.iron,[0,1.12,0]);
  part(g,'lantern-floor',chamfer(.45,.08,.45,.02),COLORS.iron,[0,1.86,0]);
  const glow=new MeshStandardMaterial({color:'#ffe0a0',emissive:'#ffba5f',emissiveIntensity:1,roughness:1});glow.name='lantern-glow';
  part(g,'amber-glass',new BoxGeometry(.31,.38,.31),glow,[0,2.08,0]);
  for(const x of [-.185,.185])for(const z of [-.185,.185])part(g,'lantern-frame',new BoxGeometry(.035,.45,.035),COLORS.iron,[x,2.09,z]);
  part(g,'lantern-roof',new ConeGeometry(.38,.25,4),COLORS.iron,[0,2.42,0],[0,Math.PI/4,0]);
  part(g,'lantern-finial',new ConeGeometry(.065,.15,6),COLORS.edge,[0,2.61,0]);
  g.scale.setScalar(.9);return g;
}
function signpost(){
  const g=new Group();g.name='cat-trail-sign';
  part(g,'sign-foot',new CylinderGeometry(.15,.2,.12,6),COLORS.stone,[0,.06,0]);
  part(g,'sign-upright',chamfer(.13,1.7,.13,.018),COLORS.dark,[0,.85,0]);
  const arrow=new Shape();arrow.moveTo(-.69,-.18);arrow.lineTo(.35,-.18);arrow.lineTo(.7,0);arrow.lineTo(.35,.18);arrow.lineTo(-.69,.18);arrow.closePath();
  part(g,'direction-board',new ExtrudeGeometry(arrow,{depth:.1,bevelEnabled:true,bevelSize:.02,bevelThickness:.015,bevelSegments:1,steps:1}),COLORS.edge,[0,1.42,-.05]);
  // Raised paw seal: geometry rather than text or a raster texture.
  part(g,'paw-pad',new CylinderGeometry(.105,.105,.018,7),COLORS.dark,[-.17,1.42,.068],[Math.PI/2,0,0]);
  for(const [x,y]of [[-.31,1.52],[-.22,1.58],[-.1,1.58],[-.01,1.52]])part(g,'paw-toe',new CylinderGeometry(.045,.045,.018,6),COLORS.dark,[x,y,.068],[Math.PI/2,0,0]);
  return g;
}
function planter(){
  const g=new Group();g.name='cedar-herb-planter';
  part(g,'planter-soil',new BoxGeometry(1.4,.1,.65),'#60513b',[0,.46,0]);
  for(const x of [-.75,.75])part(g,'planter-end',chamfer(.1,.56,.8,.025),COLORS.cedar,[x,.32,0]);
  for(const z of [-.37,.37])for(let i=0;i<3;i++)part(g,'planter-side-slat',chamfer(1.48,.155,.09,.015),i%2?COLORS.edge:COLORS.light,[0,.16+i*.17,z]);
  for(const x of [-.59,.59])part(g,'planter-foot',chamfer(.17,.12,.7,.02),COLORS.dark,[x,.06,0]);
  for(const z of [-.4,.4])part(g,'planter-rim',chamfer(1.63,.09,.13,.018),COLORS.edge,[0,.59,z]);
  return g;
}
export function createArchitecture(){return {bridge:bridge(),pavilion:pavilion(),bench:bench(),lantern:lantern(),signpost:signpost(),planter:planter()};}
