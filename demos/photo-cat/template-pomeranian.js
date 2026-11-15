import {Box3,BufferAttribute,Color,DataTexture,Group,LinearFilter,MeshStandardMaterial,RGBAFormat,SRGBColorSpace,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const factor=(value)=>clamp(Number.isFinite(value)?value:1,.7,1.4);
const controls=['headWidth','headHeight','muzzleLength','bodyWidth','furLength','earLength','earWidth','earSpread','skullDepth','cheekWidth','muzzleWidth'];
function color(value,fallback){
  if(value instanceof Color)return value.clone();
  if(typeof value==='string')return new Color(value);
  const rgb=Array.isArray(value)?value:value&&[value.r,value.g,value.b];
  if(rgb?.length>=3&&rgb.slice(0,3).every(Number.isFinite)){
    const k=Math.max(...rgb.slice(0,3))>1?255:1;
    return new Color().setRGB(rgb[0]/k,rgb[1]/k,rgb[2]/k).convertSRGBToLinear();
  }
  return new Color(fallback);
}
export const POMERANIAN_CREDIT={title:'Pomeranian Low Poly',author:'MarceloAMS / Marcelo Silva',source:'https://www.printables.com/model/36149-pomeranian-low-poly',license:'CC0 1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',changes:'Original 500 source triangles retained. Axis conversion and normalization, photo-referenced authored facet palette, and smooth shape offsets. Static source: no skeleton or animation.'};
let source;
export async function createTemplatePomeranian(profile={}){
  source??=new GLTFLoader().loadAsync('../../models/dog/pomeranian.glb').catch(error=>{source=undefined;throw error;});
  return adaptTemplatePomeranian(await source,profile);
}
export function adaptTemplatePomeranian(asset,profile={}){
  const original=(asset.scene||asset.root||asset).clone(true),root=new Group();
  root.name='PhotoDog_PomeranianStaticTemplate';root.add(original);original.updateMatrixWorld(true);
  const bounds=new Box3().setFromObject(original,true),size=bounds.getSize(new Vector3()),center=bounds.getCenter(new Vector3());
  const unit=Math.max(size.x,size.y,size.z),shape=profile.shape||{},palette=profile.colors||{};
  const primary=color(palette.baseColor,'#d3a565'),secondary=color(palette.secondaryColor,'#f4e0bc');
  const third=color(palette.tertiaryColor,'#65492f'),nose=color(palette.noseColor,'#251d18');
  const coat=[primary,secondary,third],pattern=profile.pattern||'solid';
  // A tiny categorical coat map references colors only; no photograph texture
  // or pixels are embedded. Existing source facets carry all authored paint.
  const N=8,labels=new Uint8Array(N*N);let samples=0;
  if(typeof profile.sampleFace==='function')for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    try{
      const c=color(profile.sampleFace((i+.5)/N,(j+.5)/N),'#d3a565');let best=0,d=Infinity;
      coat.forEach((candidate,k)=>{const distance=(c.r-candidate.r)**2+(c.g-candidate.g)**2+(c.b-candidate.b)**2;if(distance<d){d=distance;best=k;}});
      labels[j*N+i]=best;samples++;
    }catch{}
  }
  // White atlas background preserves the existing vertex-painted coat. Only
  // authored eye/nose graphics multiply onto the original facial triangles.
  const atlasSize=256,padding=8,extent=240,texels=new Uint8Array(atlasSize*atlasSize*4);texels.fill(255);
  const dark=[24,19,16],eye=[112,72,36],noseRGB=[35,26,23];
  for(let y=0;y<extent;y++)for(let x=0;x<extent;x++){
    const u=x/(extent-1),v=y/(extent-1);let rgb=[255,255,255];
    for(const cx of [.25,.75]){
      const dx=u-cx,dy=v-.395;
      if((dx/.105)**2+(dy/.063)**2<1)rgb=dark;
      if((dx/.077)**2+(dy/.044)**2<1)rgb=eye;
      if((dx/.031)**2+(dy/.043)**2<1)rgb=dark;
      if(((dx+.023)/.016)**2+((dy+.018)/.017)**2<1)rgb=[255,255,255];
    }
    if(v>.59&&v<.69&&Math.abs(u-.5)<.08*(1-(v-.59)/.1))rgb=noseRGB;
    if(v>.685&&v<.755&&Math.abs(u-.5)<.008)rgb=dark;
    const mouth=.75+.027*Math.sin(Math.abs(u-.5)/.085*Math.PI);
    if(Math.abs(u-.5)<.085&&Math.abs(v-mouth)<.006)rgb=dark;
    const k=((y+padding)*atlasSize+x+padding)*4;texels[k]=rgb[0];texels[k+1]=rgb[1];texels[k+2]=rgb[2];
  }
  const faceTexture=new DataTexture(texels,atlasSize,atlasSize,RGBAFormat);faceTexture.name='Authored Pomeranian eyes and nose — no photo pixels';
  faceTexture.colorSpace=SRGBColorSpace;faceTexture.flipY=false;faceTexture.magFilter=faceTexture.minFilter=LinearFilter;faceTexture.generateMipmaps=false;faceTexture.needsUpdate=true;
  let triangles=0,meshes=0;
  original.traverse(mesh=>{
    if(!mesh.isMesh)return;meshes++;
    mesh.geometry=mesh.geometry.clone();const g=mesh.geometry,p=g.attributes.position,src=p.array.slice();
    const normalized=i=>new Vector3((src[i*3]-center.x)/unit,(src[i*3+1]-bounds.min.y)/unit,(src[i*3+2]-center.z)/unit);
    // Deformation depends only on source coordinates. Coincident facet corners
    // move identically, preserving the original closed surface without a rig.
    for(let i=0;i<p.count;i++){
      const v=normalized(i),x=v.x,y=v.y,z=v.z;
      const head=smooth(.03,.21,z)*smooth(.4,.65,y),ear=head*smooth(.79,.95,y)*smooth(.05,.14,Math.abs(x));
      const muzzle=head*smooth(.25,.44,z)*(1-smooth(.73,.86,y));
      const cheek=head*(1-ear)*(1-smooth(.76,.9,y));
      let X=x*(1+(factor(shape.headWidth)-1)*.6*head+(factor(shape.bodyWidth)-1)*.45*(1-head));
      let Y=y+(y-.64)*(factor(shape.headHeight)-1)*.5*head;
      let Z=z+(z-.2)*(factor(shape.skullDepth)-1)*.45*head*(1-ear);
      X+=x*(factor(shape.cheekWidth)-1)*.4*cheek+x*(factor(shape.muzzleWidth)-1)*.5*muzzle;
      Z+=(z-.26)*(factor(shape.muzzleLength)-1)*.65*muzzle;
      Y+=Math.max(0,y-.79)*(factor(shape.earLength)-1)*ear;
      X+=(x-Math.sign(x)*.12)*(factor(shape.earWidth)-1)*ear;
      X+=Math.sign(x)*.055*(clamp(Number.isFinite(shape.earSpread)?shape.earSpread:1,.7,1.3)-1)*ear;
      X+=x*(factor(shape.furLength)-1)*.13*smooth(.2,.48,y);
      p.setXYZ(i,X*unit+center.x,Y*unit+bounds.min.y,Z*unit+center.z);
    }
    const colors=new Float32Array(p.count*3),uvs=new Float32Array(p.count*2),index=g.index,count=index?.count??p.count;
    uvs.fill(.5/atlasSize);
    const idsAt=i=>index?index.getX(i):i;
    for(let k=0;k<count;k+=3){
      const ids=[idsAt(k),idsAt(k+1),idsAt(k+2)],v=new Vector3();ids.forEach(i=>v.add(normalized(i)));v.multiplyScalar(1/3);
      const {x,y,z}=v,head=z>.13&&y>.55;let c=primary;
      if(pattern==='bicolor'&&(z>.08&&y<.67||y<.17))c=secondary;
      if(pattern==='point'&&head)c=third;
      if(pattern==='calico'||pattern==='tortoiseshell')c=Math.sin(z*15+x*18+y*9)>.25?third:primary;
      if(samples&&head){const u=clamp(.5-x/.44,0,.999),w=clamp((.96-y)/.44,0,.999);c=coat[labels[Math.floor(w*N)*N+Math.floor(u*N)]];}
      // Project graphic eyes onto the continuous front of the existing head.
      // Their positions use source anatomy, so shape controls carry the paint.
      const a=normalized(ids[0]),b=normalized(ids[1]),d=normalized(ids[2]);
      const normal=b.sub(a).cross(d.sub(a)).normalize();
      const front=z>.19&&y>.56&&normal.z>.12;
      for(const i of ids){
        colors.set([c.r,c.g,c.b],i*3);
        if(front){const q=normalized(i),u=clamp(.5-q.x/.4,0,1),v=clamp((.96-q.y)/.43,0,1);uvs[i*2]=(padding+.5+u*(extent-1))/atlasSize;uvs[i*2+1]=(padding+.5+v*(extent-1))/atlasSize;}
      }
    }
    g.setAttribute('color',new BufferAttribute(colors,3));g.setAttribute('uv',new BufferAttribute(uvs,2));p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
    mesh.material=new MeshStandardMaterial({color:'white',map:faceTexture,vertexColors:true,roughness:.95,metalness:0,flatShading:true});
    mesh.castShadow=mesh.receiveShadow=true;triangles+=count/3;
  });
  original.updateMatrixWorld(true);const box=new Box3().setFromObject(original,true),displaySize=box.getSize(new Vector3()),s=2.8/Math.max(displaySize.x,displaySize.y,displaySize.z);
  original.scale.multiplyScalar(s);original.position.add(new Vector3(-(box.min.x+box.max.x)*.5,-box.min.y,-(box.min.z+box.max.z)*.5).multiplyScalar(s));
  root.animations=[];
  root.userData={kind:'photo-dog-pomeranian-static-template',triangleCount:triangles,meshCount:meshes,source:'MarceloAMS Pomeranian Low Poly — original STL',attribution:{...POMERANIAN_CREDIT},shapeControls:controls,staticTemplate:true,rigged:false,animationAvailable:false,templatePreserved:{indices:true,sourceTriangles:true,skeleton:false,animationTracks:false},sourcePixelsEmbedded:false,embeddedFaceTexture:true,faceTextureSize:atlasSize,stylizedFacePaint:true,photoColorSamples:samples,facePaintPalette:[...coat.map(c=>'#'+c.getHexString()),'#ffffff','#181310','#704824','#231a17'],limitations:['Original Pomeranian source is static; no animation or skeleton is supplied.','The original 500 facets limit facial detail.','Coat is newly authored palette paint; hidden markings and anatomy are inferred.']};
  root.updateMatrixWorld(true);return root;
}
