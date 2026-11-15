import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three';
import { createRandom } from '../../shared/math.js';

// Independent, overlapping mountain massifs leave deep valleys and open sectors.
// Their footprints are deliberately staggered: there is no circular ridge wall.
export function buildMountainRange(){
  const random=createRandom(810331),vertices=[],colors=[];
  const massifs=[
    [-2.03,282,55,67,68,.2],[-2.52,302,62,69,73,-.3],[-1.48,257,40,49,56,.35],
    [-3.04,246,36,53,58,-.25],[-.76,314,64,64,72,.35],[-.12,239,31,56,54,-.3],
    [.72,294,47,67,64,.2],[1.46,254,35,48,57,-.4],[2.21,323,60,73,75,.3],
    [2.9,176,19,45,37,.25],[-2.88,146,13,38,31,-.2],[-1.55,161,15,39,34,.35],
    [-2.3,182,10,30,26,-.4],[.35,151,11,36,26,.2],
  ].map(([angle,radius,height,width,depth,twist],index)=>({
    x:Math.cos(angle)*radius,z:Math.sin(angle)*radius,height,width,depth,angle:angle+twist,index,
  }));
  function rawHeight(x,z){
    let h=-1.8;
    for(const m of massifs){
      const dx=x-m.x,dz=z-m.z;
      const u=(-Math.sin(m.angle)*dx+Math.cos(m.angle)*dz)/m.width;
      const v=(Math.cos(m.angle)*dx+Math.sin(m.angle)*dz)/m.depth;
      // Off-center crests, different front/back gradients and broad branching
      // shoulders give each massif an asymmetric silhouette.
      const warped=u+.18*Math.sin(v*3.1+m.index);
      const radius=Math.hypot(warped*(v>0?1.08:.86),v*(u>0?.88:1.16));
      if(radius>=1.18)continue;
      const shape=Math.pow(Math.max(0,1-radius/1.18),1.18);
      const crags=1+.1*Math.sin(x*.075+z*.043)+.06*Math.cos(z*.12-x*.05);
      h=Math.max(h,m.height*shape*crags-1.8);
    }
    return h;
  }
  const palette=[new Color('#536f70'),new Color('#647d83'),new Color('#7d929c')];
  function emit(a,b,c,layer=0){
    vertices.push(...a,...b,...c);
    const height=(a[1]+b[1]+c[1])/3,distance=Math.hypot((a[0]+b[0]+c[0])/3,(a[2]+b[2]+c[2])/3);
    const base=height>39?new Color('#d2dfe3'):height<1?new Color('#788e7b'):palette[distance>260?2:distance>190?1:0].clone();
    base.multiplyScalar(.91+random()*.15);
    for(let i=0;i<3;i++)colors.push(base.r,base.g,base.b);
  }
  const step=10.6,cells=68,half=cells*step/2,grid=[];
  for(let iz=0;iz<=cells;iz++)for(let ix=0;ix<=cells;ix++){
    const x=ix*step-half+(ix>0&&ix<cells?(random()-.5)*4:0);
    const z=iz*step-half+(iz>0&&iz<cells?(random()-.5)*4:0);
    grid.push([x,rawHeight(x,z),z]);
  }
  // Cache actual rendered triangles for surface-following stream paths.
  const terrainTriangles=[];
  function addTriangle(a,b,c){
    if([a,b,c].every(p=>Math.hypot(p[0],p[2])<65))return;
    emit(a,b,c);terrainTriangles.push([a,b,c]);
  }
  for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
    const a=grid[x+z*(cells+1)],b=grid[x+(z+1)*(cells+1)],c=grid[x+1+(z+1)*(cells+1)],d=grid[x+1+z*(cells+1)];
    if((x+z)%2){addTriangle(a,b,d);addTriangle(b,c,d);}else{addTriangle(a,b,c);addTriangle(a,c,d);}
  }
  function triangleHeight(x,z,triangle){
    const [a,b,c]=triangle;
    const denominator=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
    if(Math.abs(denominator)<1e-7)return -Infinity;
    const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/denominator;
    const v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/denominator;
    return u>=-.0001&&v>=-.0001&&u+v<=1.0001?u*a[1]+v*b[1]+(1-u-v)*c[1]:-Infinity;
  }
  const hostTriangles=[],hosts=[{angle:-2.03,radius:207,width:29,heightScale:1,lengthScale:1,phase:.5},{angle:-2.5,radius:220,width:26,heightScale:.84,lengthScale:.94,phase:2.1}];
  const offsets=[-55,-45,-36,-29,-28,-20,-12,-11,-4,5,15,32,45];
  const heights=[0,4,9,9,21,22,22,34,35,32,22,6,0];
  const lateral=[-1.35,-1,-.72,-.43,-.18,0,.18,.43,.72,1,1.35];
  const meander=(host,offset)=>Math.sin(offset*.12+host.phase)*2.4+Math.sin(offset*.31+host.phase)*.6;
  function hostPoint(host,offset,tangent,height){
    const r=host.radius+offset*host.lengthScale;
    const t=tangent*host.width*(tangent<0?1.08:.83)+meander(host,offset);
    const x=Math.cos(host.angle)*r-Math.sin(host.angle)*t,z=Math.sin(host.angle)*r+Math.cos(host.angle)*t;
    const shoulder=Math.pow(Math.max(0,1-Math.pow(Math.abs(tangent)/1.35,tangent<0?1.25:1.8)),.8);
    const crags=height*.17*Math.abs(tangent)*Math.sin(tangent*11+offset*.19+host.phase);
    return[x,Math.max(rawHeight(x,z),(height*shoulder+crags)*host.heightScale)+.035,z];
  }
  for(const host of hosts){
    const rows=offsets.map((r,j)=>lateral.map(t=>hostPoint(host,r,t,heights[j])));
    for(let row=0;row<rows.length-1;row++)for(let col=0;col<lateral.length-1;col++){
      const a=rows[row][col],b=rows[row+1][col],c=rows[row+1][col+1],d=rows[row][col+1];
      emit(a,c,b);emit(a,d,c);hostTriangles.push([a,c,b],[a,d,c]);
    }
  }
  function sampleHeight(x,z){
    let height=-1.8;
    for(const triangle of terrainTriangles)height=Math.max(height,triangleHeight(x,z,triangle));
    for(const triangle of hostTriangles)height=Math.max(height,triangleHeight(x,z,triangle));
    return height;
  }
  const falls=hosts.map((host,index)=>{
    // Shelf → steep chute → shelf → steep chute → lower plunge basin. These
    // waypoints lie on the same generated topology as the surrounding cliff.
    const path=[];
    for(const offset of [-4,-8,-11,-12,-16,-20,-25,-28,-29,-32,-36]){
      const r=host.radius+offset*host.lengthScale,t=meander(host,offset);
      const x=Math.cos(host.angle)*r-Math.sin(host.angle)*t,z=Math.sin(host.angle)*r+Math.cos(host.angle)*t;
      path.push(new Vector3(x,sampleHeight(x,z)+.35,z));
    }
    return {...host,height:35*host.heightScale,path,width:index===0?2.2:1.65};
  });
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(vertices),3));
  geometry.setAttribute('color',new BufferAttribute(new Float32Array(colors),3));
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  return {geometry,sampleHeight,falls};
}
