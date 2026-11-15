import {Box3,BufferAttribute,Color,Group,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';

const assets=new Map();
export const EXPANDED_DOG_BASES={
  poodle:{title:'Poodle',author:'Poly by Google',source:'https://poly.pizza/m/eQmBaLcGbbE',license:'CC BY 3.0',licenseUrl:'https://creativecommons.org/licenses/by/3.0/',static:true},
  dachshund:{title:'Dashshund Dog',author:'spooneystone',source:'https://sketchfab.com/3d-models/dashshund-dog-cb0abb276cc247f095c0c527db987276',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',static:false},
  chihuahua:{title:'Chihuahua',author:'Gobkit',source:'https://gobkit.com/freebies',license:'CC0 1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',static:false},
};
function color(v,fallback){
  if(v?.isColor)return v.clone();
  if(typeof v==='string')return new Color(v);
  const a=Array.isArray(v)?v:v&&[v.r,v.g,v.b];
  if(a?.length>=3&&a.every(Number.isFinite)){const d=Math.max(...a)>1?255:1;return new Color().setRGB(a[0]/d,a[1]/d,a[2]/d).convertSRGBToLinear();}
  return new Color(fallback);
}
export async function createTemplateExpandedDog(profile={}){
  const key=profile.baseModel;
  if(!EXPANDED_DOG_BASES[key])throw new Error('Unsupported independent dog base: '+key);
  if(!assets.has(key))assets.set(key,new GLTFLoader().loadAsync('../../models/dog/'+key+'.glb').catch(e=>{assets.delete(key);throw e;}));
  return adaptTemplateExpandedDog(await assets.get(key),profile);
}
export function adaptTemplateExpandedDog(asset,profile={}){
  const key=profile.baseModel,credit=EXPANDED_DOG_BASES[key];
  if(!credit)throw new Error('Unsupported independent dog base: '+key);
  const root=new Group(),original=clone(asset.scene||asset);root.name='PhotoDog_'+key;root.add(original);
  const primary=color(profile.colors?.baseColor,key==='poodle'?'#eee6db':'#bd8244'),secondary=color(profile.colors?.secondaryColor,'#eee6db'),nose=color(profile.colors?.noseColor,'#211c19');
  let triangles=0;
  original.traverse(mesh=>{
    if(!mesh.isMesh)return;
    mesh.geometry=mesh.geometry.clone();
    const g=mesh.geometry,p=g.attributes.position,uv=g.attributes.uv,sourceColor=g.attributes.color;
    const sourceMaterial=mesh.material,sourceMap=sourceMaterial.map;
    let pixels=null,width=0,height=0;
    if(sourceMap?.image&&typeof document!=='undefined'){
      const canvas=document.createElement('canvas');width=canvas.width=sourceMap.image.width;height=canvas.height=sourceMap.image.height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(sourceMap.image,0,0);pixels=ctx.getImageData(0,0,width,height).data;
    }
    const colors=new Float32Array(p.count*3);
    for(let i=0;i<p.count;i++){
      let r=1,b=1,green=1;
      if(pixels&&uv){const u=((uv.getX(i)%1)+1)%1,v=((uv.getY(i)%1)+1)%1,x=Math.min(width-1,Math.floor(u*width)),y=Math.min(height-1,Math.floor((sourceMap.flipY?1-v:v)*height)),k=(y*width+x)*4;r=pixels[k]/255;green=pixels[k+1]/255;b=pixels[k+2]/255;}
      else if(sourceColor){r=sourceColor.getX(i);green=sourceColor.getY(i);b=sourceColor.getZ(i);}
      const light=.2126*r+.7152*green+.0722*b;
      // Source semantic colors classify nose/eyes and pale coat. The exported
      // colors are newly authored palette values, never photograph pixels.
      let c=light<.18?nose:(key==='chihuahua'&&r>.65&&green>.65&&b>.65?secondary:primary);
      if(key==='chihuahua'&&r>green*1.3&&b>green*1.15&&light<.6)c=new Color('#b7787b');
      if(key==='dachshund'){
        const u=uv?.getX(i)||0,v=uv?.getY(i)||0;
        const eyePatch=u<.115&&v>.82;
        const nosePatch=Math.hypot(u-.64,v-.01)<.024||Math.hypot(u-.273,v-.858)<.025;
        const faceDetail=Math.hypot((u-.718)*1.2,v-.108)<.035||Math.hypot((u-.343)*1.2,v-.75)<.035;
        c=nosePatch?nose:eyePatch?(light>.3?secondary:nose):faceDetail&&light<.055?nose:light>.065?secondary:primary;
      }
      colors.set([c.r,c.g,c.b],i*3);
    }
    g.setAttribute('color',new BufferAttribute(colors,3));
    mesh.material=sourceMaterial.clone();mesh.material.map=null;mesh.material.vertexColors=true;mesh.material.color.set('white');mesh.material.metalness=0;mesh.material.roughness=.85;mesh.material.flatShading=true;mesh.material.needsUpdate=true;
    triangles+=(g.index?.count??p.count)/3;
  });
  original.updateMatrixWorld(true);
  const bounds=new Box3().setFromObject(original,true),size=bounds.getSize(new Vector3()),scale=2.8/Math.max(size.x,size.y,size.z);
  original.scale.multiplyScalar(scale);original.position.add(new Vector3(-(bounds.min.x+bounds.max.x)/2,-bounds.min.y,-(bounds.min.z+bounds.max.z)/2).multiplyScalar(scale));
  root.animations=(asset.animations||[]).map(c=>c.clone());
  root.userData={kind:'photo-dog-independent-template',baseModel:key,colorControls:key==='poodle'?['baseColor','noseColor']:['baseColor','secondaryColor','noseColor'],triangleCount:triangles,shapeControls:[],attribution:{...credit,changes:'Source topology, pose and skeleton retained; source palette classified and repainted with reference-derived coat colors. No geometry deformation.'},templatePreserved:{indices:true,skinWeights:true,skeleton:true,animationTracks:true},sourcePixelsEmbedded:false,embeddedFaceTexture:false,photoColorSamples:0,staticBase:credit.static,limitations:[credit.static?'Static original model: no skeleton or animation.':key==='dachshund'?'Original 72-joint rig and seven clips retained; source coat reduced to categorical colors.':'Original rig and four clips retained; highly stylized large head and short legs.','Only coat palette adapts to the reference; no breed substitution or photo-derived physical measurements.','Whole bounding-box height includes head and ears; it is not shoulder height.']};
  root.updateMatrixWorld(true);return root;
}
