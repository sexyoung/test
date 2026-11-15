import {Box3,BufferAttribute,Color,Group,Vector3} from 'three';
import {createCat,CAT_CREDIT} from '../pet/rigged-cat.js';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const factor=v=>clamp(Number.isFinite(v)?v:1,.65,1.45);
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

export async function createTemplateCat(profile={}){
  const cat=await createCat({model:'runner',surface:'faceted',color:'#ffffff'});
  cat.setMode('rest');cat.mixer.stopAllAction();cat.mixer.uncacheRoot(cat.root);
  return adaptTemplateCat(cat,profile);
}

// One bind-space deformation is shared by body, sculpt, irises and neck band.
// In particular, the attachment never uses independent per-mesh head bounds.
export function adaptTemplateCat(base,profile={}){
  const original=base.root||base;original.updateMatrixWorld(true);
  const palette=profile.colors||{},shape=profile.shape||{},pattern=profile.pattern||'solid';
  const primary=color(palette.baseColor,'#b8a28a'),secondary=color(palette.secondaryColor,'#eee8df');
  const iris=color(palette.eyeColor,'#a3b06c'),nose=color(palette.noseColor,'#b78b88');
  const deep=primary.clone().multiplyScalar(.25),charcoal=new Color('#191b19');
  const headBounds=new Box3();
  original.traverse(mesh=>{
    if(!mesh.isMesh||mesh.userData.headPart!=='surface')return;
    const p=mesh.geometry.attributes.position;
    for(let i=0;i<p.count;i++)headBounds.expandByPoint(new Vector3().fromBufferAttribute(p,i));
  });
  const center=headBounds.getCenter(new Vector3()),headSize=headBounds.getSize(new Vector3());
  if(headBounds.isEmpty())throw new Error('Runner is missing its approved head sculpt');
  const warp=(x,y,z)=>{
    const head=smooth(.14,.205,x)*smooth(.12,.19,y);
    const body=(1-head)*smooth(.065,.14,y)*smooth(-.2,-.12,x);
    const ear=head*smooth(.252,.298,y)*smooth(.014,.04,Math.abs(z));
    const muzzle=head*smooth(.224,.268,x)*(1-ear);
    const skull=head*(1-ear)*(1-muzzle);
    const cheek=head*(1-ear)*smooth(.17,.21,y)*(1-smooth(.23,.265,y));
    let X=x+(x-center.x)*(factor(shape.muzzleLength)-1)*.45*muzzle;
    X+=(x-center.x)*(factor(shape.skullDepth)-1)*.65*skull;
    let Y=y+(y-center.y)*(factor(shape.headHeight)-1)*.55*head;
    Y+=(y-.165)*(factor(shape.furLength)-1)*.08*body;
    Y+=Math.max(0,y-.25)*((factor(shape.earSize)-1)*.65+factor(shape.earLength)-1)*ear;
    let Z=z*(1+(factor(shape.headWidth)-1)*.6*head)*(1+(factor(shape.bodyWidth)-1)*.5*body);
    Z*=1+(factor(shape.furLength)-1)*.16*(head+body);
    Z+=z*(factor(shape.cheekWidth)-1)*.65*cheek+z*(factor(shape.muzzleWidth)-1)*.6*muzzle;
    Z+=(z-Math.sign(z)*headSize.z*.29)*(factor(shape.earWidth)-1)*ear;
    Z+=Math.sign(z)*headSize.z*.22*(factor(shape.earSpread)-1)*ear;
    return [X,Y,Z];
  };
  function fur(x,y,z,white){
    const stripe=Math.sin(x*190+Math.sin(y*62)*1.8+z*45),patch=Math.sin(x*68+y*24)*Math.cos(z*77-y*51);
    if(pattern==='bicolor')return white||y<.05||(x>.1&&y<.195)||(y<.13&&x>-.15&&x<.16)?secondary:primary;
    if(pattern==='tabby')return stripe>.55?deep:primary;
    if(pattern==='calico')return patch>.18?primary:patch<-.4?deep:secondary;
    if(pattern==='tortoiseshell')return patch>.05?primary:deep;
    if(pattern==='point')return x>.18||y<.055||x<-.19?secondary:primary;
    return primary;
  }
  let triangles=0,meshes=0;
  original.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const g=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
    mesh.geometry=g;mesh.material=mesh.material.clone();mesh.material.color.set('white');
    mesh.material.map=null;mesh.material.vertexColors=true;mesh.material.flatShading=true;
    mesh.material.needsUpdate=true;
    const p=g.attributes.position,source=p.array.slice(),authored=g.attributes.color;
    const cs=new Float32Array(p.count*3),isHead=mesh.userData.approvedCatHead,part=mesh.userData.headPart||'';
    for(let t=0;t<p.count;t+=3){
      const x=(source[t*3]+source[(t+1)*3]+source[(t+2)*3])/3;
      const y=(source[t*3+1]+source[(t+1)*3+1]+source[(t+2)*3+1])/3;
      const z=(source[t*3+2]+source[(t+1)*3+2]+source[(t+2)*3+2])/3;
      const rgb=authored?[authored.getX(t),authored.getY(t),authored.getZ(t)]:[1,1,1];
      const luma=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
      let c;
      if(part.startsWith('iris'))c=luma<.025?charcoal:iris.clone().multiplyScalar(clamp(luma/.19,.4,1.35));
      else if(isHead&&x>.251&&y>.205&&y<.227&&Math.abs(z)<.017&&rgb[0]>rgb[1]*1.12&&rgb[2]>rgb[1]*1.02)c=nose.clone().multiplyScalar(clamp(luma/.17,.6,1.3));
      else{
        const white=isHead&&!!authored&&luma>.24;
        c=fur(x,y,z,white).clone();
        // Retain the sculpt's deliberate facet tones, never interpolate colors
        // across corners or project a photographed eye/mouth over its geometry.
        if(isHead&&authored)c.multiplyScalar(white?clamp(luma/.72,.65,1.3):clamp(luma/.035,.45,3.2));
      }
      for(let k=0;k<3;k++)cs.set([clamp(c.r,0,1),clamp(c.g,0,1),clamp(c.b,0,1)],(t+k)*3);
    }
    // Morph deltas are warped together with their bases, including the matching
    // deltas on the neck boundary; the four approved morphs remain usable.
    for(const target of g.morphAttributes.position||[]){
      for(let i=0;i<p.count;i++){
        const b=[source[i*3],source[i*3+1],source[i*3+2]],a=warp(...b);
        const q=warp(b[0]+target.getX(i),b[1]+target.getY(i),b[2]+target.getZ(i));
        target.setXYZ(i,q[0]-a[0],q[1]-a[1],q[2]-a[2]);
      }
    }
    for(let i=0;i<p.count;i++)p.setXYZ(i,...warp(source[i*3],source[i*3+1],source[i*3+2]));
    g.deleteAttribute('uv');g.setAttribute('color',new BufferAttribute(cs,3));
    g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
    mesh.frustumCulled=false;mesh.receiveShadow=false;mesh.userData.photoAdapted=true;
    triangles+=p.count/3;meshes++;
  });
  original.updateMatrixWorld(true);
  const bounds=new Box3().setFromObject(original,true),size=bounds.getSize(new Vector3());
  const root=new Group();root.name='PhotoCat_ApprovedHeadRunner';root.add(original);
  const displayScale=2.8/Math.max(size.x,size.y,size.z);original.scale.multiplyScalar(displayScale);
  original.position.y-=bounds.min.y*displayScale;
  original.position.z-=(bounds.min.z+bounds.max.z)*.5*displayScale;
  root.animations=(base.animations||original.animations||[]).map(clip=>clip.clone());
  root.userData={kind:'photo-cat-approved-head-runner',triangleCount:triangles,meshCount:meshes,
    source:'runner-base.glb',authoringFile:'runner-ear-controls.blend',approvedHead:'cat-head-uncolored.glb',originalApprovedHead:'cat-head-approved.glb',attribution:{...CAT_CREDIT},
    templatePreserved:{indices:false,skinWeights:true,skeleton:true,inverseBindMatrices:true,animationTracks:true},
    perFacetColor:true,stylizedFacePaint:true,sourcePixelsEmbedded:false,photoColorSamples:0,
    embeddedFaceTexture:false,referenceFacePattern:false,
    shapeControls:['headWidth','headHeight','muzzleLength','earSize','bodyWidth','furLength','earLength','earWidth','earSpread','skullDepth','cheekWidth','muzzleWidth'],
    limitations:['The uncolored approved sculpt provides facial geometry; individual facial coat markings are not reconstructed.','Body and unseen markings are inferred.','Fur controls change the silhouette, not hair strands.']};
  root.updateMatrixWorld(true);return root;
}
