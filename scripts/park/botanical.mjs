// Original botanical asset source for Sunlit Grove. Exported offline to GLB.
// No textures: deliberately shaped silhouettes and a small matte color palette.
import {
  Group, Mesh, MeshStandardMaterial, BufferGeometry, BufferAttribute,
  CylinderGeometry, IcosahedronGeometry, BoxGeometry, Vector3,
} from 'three';

const UP = new Vector3(0, 1, 0);
const materials = new Map();
function material(color) {
  if (!materials.has(color)) materials.set(color, new MeshStandardMaterial({color, roughness:1, metalness:0, flatShading:true}));
  return materials.get(color);
}
function random(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function mesh(group, geometry, color, position=[0,0,0], scale=[1,1,1]) {
  const object=new Mesh(geometry,material(color));object.position.fromArray(position);object.scale.fromArray(scale);group.add(object);return object;
}
function faces(group, vertices, color) {
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(vertices.flat(2)),3));geometry.computeVertexNormals();return mesh(group,geometry,color);
}
function limb(group, a, b, lower, upper, color, sides=7) {
  const start=new Vector3(...a),end=new Vector3(...b),direction=end.clone().sub(start);
  const object=mesh(group,new CylinderGeometry(upper,lower,direction.length(),sides,1),color,start.clone().add(end).multiplyScalar(.5).toArray());
  object.quaternion.setFromUnitVectors(UP,direction.normalize());return object;
}
function trunk(group, points, radii, color, sides=7) {
  for(let i=0;i<points.length-1;i++)limb(group,points[i],points[i+1],radii[i],radii[i+1],color,sides);
}
function roots(group,radius,color,seed) {
  const rand=random(seed);
  for(let i=0;i<6;i++){
    const a=i/6*Math.PI*2+.1, r=radius*(1.6+rand()*.7),w=radius*.42;
    const near=[Math.cos(a)*radius*.55,.03,Math.sin(a)*radius*.55],tip=[Math.cos(a)*r,.015,Math.sin(a)*r];
    const left=[near[0]+Math.sin(a)*w,.03,near[2]-Math.cos(a)*w],right=[near[0]-Math.sin(a)*w,.03,near[2]+Math.cos(a)*w];
    const peak=[near[0],radius*1.8,near[2]];
    faces(group,[[left,tip,peak],[tip,right,peak],[right,left,peak]],color);
  }
}
// Deterministic displacement by position keeps coincident face vertices joined.
function clump(group,position,size,color,seed,detail=1) {
  const geometry=new IcosahedronGeometry(1,detail),p=geometry.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const variation=1+.085*Math.sin(x*7.3+y*9.1+z*5.7+seed);
    p.setXYZ(i,x*variation,y*variation,z*variation);
  }
  geometry.computeVertexNormals();
  return mesh(group,geometry,color,position,size);
}
function leaf(group,center,length,width,color,rotation=0) {
  const geometry=new BufferGeometry();
  const points=[[-width,0,0],[0,.055,length*.45],[0,0,length],[width,0,0]];
  // Four triangles give a folded, double-sided pointed leaf rather than a plane.
  geometry.setAttribute('position',new BufferAttribute(new Float32Array([
    ...points[0],...points[1],...points[2], ...points[1],...points[3],...points[2],
    ...points[2],...points[1],...points[0], ...points[2],...points[3],...points[1],
  ]),3));geometry.computeVertexNormals();
  const object=mesh(group,geometry,color,center);object.rotation.y=rotation;return object;
}

function oak() {
  const group=new Group();group.name='Oak — spreading cedar-green crown';
  const bark='#78543c';
  roots(group,.46,bark,13);
  trunk(group,[[0,0,0],[-.14,1.15,.04],[.12,2.25,-.08],[-.08,3.28,0],[.3,4.55,.12]],[.47,.32,.26,.18,.07],bark);
  const branches=[
    [[-.08,1.85,0],[-.95,2.7,.12],[-2.05,3.55,.25]],
    [[.08,2.35,-.04],[.95,3.05,.58],[1.87,3.8,.8]],
    [[.05,2.8,-.05],[-.25,3.5,-1],[-.8,4.2,-1.5]],
    [[-.1,3.2,0],[.85,3.9,-.6],[1.25,4.5,-.65]],
  ];
  for(const branch of branches)trunk(group,branch,[.17,.1,.035],bark,6);
  const clusters=[
    [-2.02,3.6,.3,1.16,.7,1.03,0],[-1.2,4.12,.45,1.4,.84,1.15,1],
    [-.22,4.52,.17,1.55,.9,1.34,2],[.55,5.07,-.02,1.3,.83,1.13,2],
    [1.55,4.25,.75,1.25,.76,1.05,1],[2.05,3.8,.72,.91,.62,.92,0],
    [-.95,4.3,-1.12,1.06,.7,.88,0],[.5,4.65,-1.05,1.25,.76,.94,1],
    [.5,3.85,1.2,1.1,.62,.8,0],[-1.85,4.3,-.4,.8,.6,.8,2],
  ];
  const palette=['#638154','#7e985e','#9aac70'];
  clusters.forEach(([x,y,z,sx,sy,sz,k],i)=>clump(group,[x,y,z],[sx,sy,sz],palette[k],i+3));
  return group;
}
function birch() {
  const group=new Group();group.name='Birch — forked ivory trunks';
  const bark='#e4ddc6',dark='#777564';
  roots(group,.28,dark,7);
  trunk(group,[[-.2,0,0],[-.3,2.1,.07],[-.65,4.05,.05],[-.93,5.7,-.1]],[.25,.16,.105,.025],bark,7);
  trunk(group,[[.16,.08,.05],[.43,2.7,-.04],[.65,4.85,.2],[1.04,6.37,.3]],[.22,.14,.08,.02],bark,7);
  const rand=random(29);
  for(const side of [-1,1])for(let i=0;i<8;i++){
    const y=.45+i*.52,x=side*(.2+y*.08),z=.14;
    const mark=mesh(group,new BoxGeometry(.12+rand()*.1,.035+rand()*.035,.025),dark,[x,y,z]);mark.rotation.z=(rand()-.5)*.25;
  }
  const branches=[[-.55,3.5,0,-1.65,4.7,.4],[.52,3.8,.05,1.65,5,.65],[-.8,4.8,-.05,-1.55,5.55,-.65],[.65,5,.2,.1,5.95,-.7]];
  branches.forEach(([x,y,z,X,Y,Z])=>limb(group,[x,y,z],[X,Y,Z],.07,.016,bark,5));
  const clusters=[[-1.8,4.73,.45,1.02,.67,.85],[-.85,5.05,.12,1.04,.8,.9],[.4,5.55,.12,.94,.8,.83],[1.55,5.18,.62,.93,.64,.78],[-1.18,5.83,-.32,.88,.67,.81],[.81,6.36,.2,1.05,.75,.88],[-.08,6.17,-.55,.75,.7,.72],[1.6,6.05,.15,.65,.63,.6]];
  clusters.forEach(([x,y,z,sx,sy,sz],i)=>clump(group,[x,y,z],[sx,sy,sz],['#99ad73','#b0be83','#7e9a69'][i%3],71+i));
  return group;
}
function goldenTree() {
  const group=new Group();group.name='Golden maple — low fan canopy';
  const bark='#836044';roots(group,.36,bark,19);
  trunk(group,[[0,0,0],[.23,1.35,0],[.01,2.5,.08],[-.42,3.7,-.07],[-.56,4.6,-.09]],[.37,.26,.18,.11,.02],bark);
  trunk(group,[[.15,1.9,.03],[1.02,2.85,.17],[1.7,3.4,.5]],[.19,.1,.02],bark,6);
  trunk(group,[[.01,2.5,.08],[-1.1,3.16,.3],[-1.8,3.65,.45]],[.15,.085,.02],bark,6);
  trunk(group,[[-.25,3.15,0],[.32,3.8,-.8],[.9,4.35,-1.05]],[.11,.055,.015],bark,5);
  const clusters=[[-1.92,3.66,.46,1.12,.6,.95],[-1.2,4.19,.2,1.31,.69,1.12],[-.34,4.72,-.13,1.25,.73,1.03],[.7,4.25,-.65,1.29,.65,1.05],[1.63,3.65,.4,1.17,.63,1.02],[.44,3.94,.84,1.2,.63,.9],[-.88,3.47,.9,.92,.53,.76],[1.63,4.29,-.25,.83,.52,.8]];
  clusters.forEach(([x,y,z,sx,sy,sz],i)=>clump(group,[x,y,z],[sx,sy,sz],['#bca259','#d5b66b','#e1c785','#b99752'][i%4],124+i));
  return group;
}
function pineTier(group,y,radius,height,seed,color) {
  const rand=random(seed),n=9,top=[.08,y+height,0],rim=[],inner=[];
  for(let i=0;i<n;i++){
    const a=i/n*Math.PI*2, r=radius*(.82+rand()*.27);
    rim.push([Math.cos(a)*r,y+(i%2)*.12,Math.sin(a)*r]);
    inner.push([Math.cos(a)*r*.62,y+height*.45,Math.sin(a)*r*.62]);
  }
  const triangles=[];
  for(let i=0;i<n;i++){
    const j=(i+1)%n;triangles.push([rim[i],inner[i],inner[j]],[rim[i],inner[j],rim[j]],[inner[i],top,inner[j]],[[0,y+.08,0],rim[i],rim[j]]);
  }
  faces(group,triangles,color).userData.foliage=true;
}
function pine() {
  const group=new Group();group.name='Pine — staggered swept boughs';const bark='#79634c';
  roots(group,.3,bark,31);trunk(group,[[0,0,0],[.06,2.3,-.06],[-.08,4.35,.02],[.12,6.1,0]],[.3,.2,.1,.015],bark);
  for(let i=0;i<7;i++){const a=i/7*Math.PI*2;limb(group,[0,1.25,0],[Math.cos(a)*1.5,1.05,Math.sin(a)*1.5],.09,.02,bark,5);}
  pineTier(group,1.15,1.98,1.7,10,'#587762');pineTier(group,2.18,1.67,1.65,20,'#64846b');
  pineTier(group,3.25,1.33,1.55,30,'#739276');pineTier(group,4.28,.94,1.45,40,'#83a080');pineTier(group,5.12,.56,1.05,50,'#91ac87');
  return group;
}
function rock() {
  const group=new Group();group.name='Mossy shore stone';
  const shape=clump(group,[0,.32,0],[.68,.48,.55],'#aaa898',333,3);
  const p=shape.geometry.attributes.position;
  // Flatten the base, bevel the silhouette, and keep all vertices above ground.
  for(let i=0;i<p.count;i++)p.setY(i,Math.max(p.getY(i),-.64));shape.geometry.computeVertexNormals();
  clump(group,[-.18,.65,-.05],[.33,.06,.27],'#7c9261',61,0);
  return group;
}
function shrub() {
  const group=new Group();group.name='Layered evergreen shrub';
  for(const [i,x,y,z,s] of [[0,-.36,.38,0,.45],[1,.18,.52,.05,.55],[2,.5,.3,.2,.38],[3,-.08,.27,.38,.43]])clump(group,[x,y,z],[s,s*.8,s],['#6c8a60','#78966a','#90a376'][i%3],55+i,1);
  return group;
}
function grass() {
  const group=new Group();group.name='Folded meadow grass';
  // Opaque meadow shading supplies density; five folded blades retain nearby
  // silhouettes at twenty triangles per tuft instead of forty-four.
  const rand=random(25);
  for(let i=0;i<5;i++){
    const a=i/5*Math.PI*2,r=.035+rand()*.24,h=.28+rand()*.38,x=Math.cos(a)*r,z=Math.sin(a)*r;
    const tip=[x+Math.cos(a)*.12,h,z+Math.sin(a)*.12],left=[x-.035,0,z],right=[x+.035,0,z],crease=[x,h*.48,z+.025];
    faces(group,[[left,crease,tip],[crease,right,tip],[tip,crease,left],[tip,right,crease]],['#7b965e','#93aa70','#8ba566'][i%3]);
  }
  return group;
}
function flowerPatch() {
  const group=new Group();group.name='Daisies and lavender';
  for(const [i,x,z,h] of [[0,-.21,-.12,.42],[1,.12,.03,.58],[2,.31,-.13,.34]]){
    limb(group,[x,0,z],[x+.035,h,z],.014,.007,'#6b8853',4);
    leaf(group,[x,h*.45,z],.18,.035,'#7f985e',i*2);
    const petals=7;
    for(let j=0;j<petals;j++){
      const a=j/petals*Math.PI*2,dx=Math.cos(a),dz=Math.sin(a),side=[-dz*.043,0,dx*.043];
      const c=[x+.035,h,z],tip=[c[0]+dx*.14,h+.025,c[2]+dz*.14],mid=[c[0]+dx*.075,h+.035,c[2]+dz*.075];
      const l=[mid[0]+side[0],mid[1],mid[2]+side[2]],r=[mid[0]-side[0],mid[1],mid[2]-side[2]];
      faces(group,[[c,l,tip],[c,tip,r],[tip,l,c],[r,tip,c]],i===1?'#f5e8b5':'#f1ecdb');
    }
    mesh(group,new CylinderGeometry(.037,.04,.025,7),'#d3a455',[x+.035,h+.035,z]);
  }
  for(const [i,x,z,h] of [[0,-.4,.19,.55],[1,-.29,.27,.66]]){
    limb(group,[x,0,z],[x,h,z],.012,.006,'#7d8c60',3);
    for(let j=0;j<3;j++)clump(group,[x,h-j*.055,z],[.048,.075,.045],['#a59cbc','#b7abc9'][i],i+j,0);
  }
  return group;
}
function reeds() {
  const group=new Group();group.name='Cattails and folded rushes';
  for(let i=0;i<3;i++){
    const x=(i-1)*.14,z=(i%2)*.12,h=.64+i*.16;
    limb(group,[x,0,z],[x+.03,h,z],.014,.009,'#7f8c58',3);
    limb(group,[x+.03,h-.1,z],[x+.03,h+.09,z],.043,.035,'#8a6847',5);
    const a=[x-.022,0,z],b=[x+.022,0,z],c=[x+.15,h*.72,z+.09],d=[x+.065,h*.42,z+.025];
    faces(group,[[a,b,d],[b,c,d],[d,c,b],[d,b,a]],'#8e9b62');
  }
  return group;
}
function lilies() {
  const group=new Group();group.name='Water lily pair';
  for(const [x,z,r] of [[-.2,0,.32],[.25,.18,.24]]){
    const points=[],n=10;for(let i=0;i<n;i++){const a=.22+i/(n-1)*(Math.PI*2-.44);points.push([x+Math.cos(a)*r,.014,z+Math.sin(a)*r]);}
    const triangles=[];for(let i=0;i<points.length-1;i++)triangles.push([[x,.024,z],points[i+1],points[i]]);faces(group,triangles,'#79976c');
  }
  for(let i=0;i<7;i++){
    const a=i/7*Math.PI*2,x=-.2,z=0,dx=Math.cos(a),dz=Math.sin(a),left=[x+dx*.07-dz*.035,.04,z+dz*.07+dx*.035],right=[x+dx*.07+dz*.035,.04,z+dz*.07-dx*.035],tip=[x+dx*.13,.13,z+dz*.13];
    faces(group,[[[x,.04,z],left,tip],[[x,.04,z],tip,right],[tip,left,[x,.04,z]],[right,tip,[x,.04,z]]],'#efd6c4');
  }
  mesh(group,new CylinderGeometry(.025,.04,.045,6),'#d9b45d',[-.2,.08,0]);
  return group;
}

// Coherent bending preserves branch junctions; extra forks make each GLB
// structurally different, rather than only rotating an identical tree instance.
function treeVariant(factory,seed) {
  const group=factory(),rand=random(seed);
  if(factory!==pine)for(let i=0;i<5;i++){
    const a=rand()*Math.PI*2,y=2.3+rand()*1.7,r=1.4+rand()*1.3;
    const tip=[Math.cos(a)*r,y+.8+rand()*.7,Math.sin(a)*r];
    trunk(group,[[0,y,0],[tip[0]*.6,y+.45,tip[2]*.6],tip],[.11,.065,.015],'#78543c',6);
    clump(group,tip,[.65+rand()*.4,.55+rand()*.3,.65+rand()*.4],factory===goldenTree?'#c5aa61':'#819b66',seed+i,2);
  }
  group.updateMatrixWorld(true);
  const bend=(rand()-.5)*.045,twist=(rand()-.5)*.16,stretch=.9+rand()*.2;
  group.traverse(o=>{
    if(!o.isMesh)return;
    o.geometry=o.geometry.clone().applyMatrix4(o.matrixWorld);
    const p=o.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),a=twist*y;
      p.setXYZ(i,Math.cos(a)*x-Math.sin(a)*z+bend*y*y,y*stretch,Math.sin(a)*x+Math.cos(a)*z);
    }
    o.geometry.computeVertexNormals();o.position.set(0,0,0);o.rotation.set(0,0,0);o.scale.set(1,1,1);
  });
  return group;
}
export function createBotanical() {
  const assets={oak:oak(),birch:birch(),goldenTree:goldenTree(),pine:pine(),rock:rock(),flowerPatch:flowerPatch(),grass:grass(),reeds:reeds(),lilies:lilies(),shrub:shrub()};
  for(const [name,factory] of Object.entries({oak,birch,goldenTree,pine})) {
    for(let i=1;i<=3;i++)assets[`${name}_${i}`]=treeVariant(factory,137+i*97+name.length*13);
  }
  // Keep wood and crown layers separate in the exported GLBs. Seasonal leaf
  // density can change without removing trunks or swapping tree species.
  for(const [name,group] of Object.entries(assets)) {
    if(!/^(oak|birch|goldenTree|pine)/.test(name))continue;
    let crown=0;
    group.traverse(o=>{
      if(o.isMesh&&(o.geometry.type==='IcosahedronGeometry'||o.userData.foliage)) {
        o.userData.role=`foliage-${crown++%3}`;
      }
    });
  }
  return assets;
}
