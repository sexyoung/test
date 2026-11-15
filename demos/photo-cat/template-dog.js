import {Box3,BufferAttribute,Color,DataTexture,DoubleSide,Group,LinearFilter,RGBAFormat,SRGBColorSpace,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const factor=v=>clamp(Number.isFinite(v)?v:1,.65,1.45);
const control=(v,min,max)=>clamp(Number.isFinite(v)?v:1,min,max);
function color(value,fallback='#b8a28a'){
  if(value instanceof Color)return value.clone();
  if(typeof value==='string')return new Color(value);
  const rgb=Array.isArray(value)?value:value&&[value.r,value.g,value.b];
  if(rgb?.length>=3&&rgb.slice(0,3).every(Number.isFinite)){
    const k=Math.max(...rgb.slice(0,3))>1?255:1;
    return new Color().setRGB(rgb[0]/k,rgb[1]/k,rgb[2]/k).convertSRGBToLinear();
  }
  return new Color(fallback);
}


export const DOG_CREDIT={title:'Ultimate Animated Animals — Shiba Inu',author:'Quaternius',source:'https://quaternius.com/packs/ultimateanimatedanimals.html',license:'CC0 1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',changes:'Photo-referenced palette repaint and smooth bind-space shape adjustment; original topology, skeleton, skin weights and all animations retained.'};
const assets=new Map();
export async function createTemplateDog(profile={}){
  const model=['husky','pug','german-shepherd'].includes(profile.baseModel)?profile.baseModel:'shiba-inu';
  if(!assets.has(model))assets.set(model,new GLTFLoader().loadAsync('../../models/dog/'+model+'.glb').catch(error=>{assets.delete(model);throw error;}));
  return adaptTemplateDog(await assets.get(model),profile);
}
export function adaptTemplateDog(asset,profile={}){
  const breed=profile.baseModel||'shiba-inu',isPug=breed==='pug',isShepherd=breed==='german-shepherd';
  const original=clone(asset.scene||asset.root||asset),root=new Group();root.name='PhotoDog_OriginalTemplate';root.add(original);original.updateMatrixWorld(true);
  const palette=profile.colors||{},shape=profile.shape||{},pattern=profile.pattern||'solid';
  const primary=color(palette.baseColor,'#ad713b'),secondary=color(palette.secondaryColor,'#eee5d3'),iris=color(palette.eyeColor,'#583a22'),nose=color(palette.noseColor,'#252322'),deep=primary.clone().multiplyScalar(.2);
  const facePaint=createStylizedFacePaint(profile,{primary,secondary,iris,nose,deep,pattern});
  const headBounds=new Box3(),fullBounds=new Box3(),earWeights=new Map(),earRoots={};
  const positionKey=(x,y,z)=>[x,y,z].map(v=>Math.round(v*1e7)).join(',');let triangles=0,meshes=0;
  // All six material primitives share one bind basis: X lateral, -Y forward,
  // Z up. Use ONE common anatomical mask, never separate primitive bounds.
  original.traverse(m=>{if(!m.isMesh)return;const p=m.geometry.attributes.position,si=m.geometry.attributes.skinIndex,sw=m.geometry.attributes.skinWeight;
    for(const bone of m.skeleton?.bones||[])if(/^Ear1\.?[LR]$/.test(bone.name)&&!earRoots[bone.name.replace('.','')]){const v=m.worldToLocal(bone.getWorldPosition(new Vector3()));earRoots[bone.name.replace('.','')]=new Vector3(-v.y,v.z,v.x);}
    for(let i=0;i<p.count;i++){let ew=0;if(si&&sw)for(let k=0;k<4;k++)if(/^Ear/.test(m.skeleton.bones[si.array[i*4+k]]?.name))ew+=sw.array[i*4+k];const key=positionKey(p.getX(i),p.getY(i),p.getZ(i));earWeights.set(key,Math.max(earWeights.get(key)||0,ew));const v=new Vector3(-p.getY(i),p.getZ(i),p.getX(i));fullBounds.expandByPoint(v);let h=0;if(si&&sw)for(let k=0;k<4;k++)if(m.skeleton.bones[si.array[i*4+k]]?.name==='Head')h+=sw.array[i*4+k];if(h>.5)headBounds.expandByPoint(v);}
  });
  const hc=headBounds.getCenter(new Vector3()),hs=headBounds.getSize(new Vector3()),bs=fullBounds.getSize(new Vector3());
  const uv=(f,h,s)=>({u:clamp(.5-s/hs.z,.025,.975),v:clamp((headBounds.max.y-h)/hs.y,.025,.975)});
  original.traverse(mesh=>{if(!mesh.isMesh)return;meshes++;
    const materialName=({'Material':'Main','Material.001':'Main_Light','Material.006':'Black','Material.003':'Eyes_White','Material.002':'Eyes_Pupil','Beige':'Main','Brown':'Main_Dark','Atlas':'Main'})[mesh.material.name]||mesh.material.name,furMaterial=/^Main/.test(materialName);
    const sourceMap=mesh.material.map;let atlasPixels=null;if(isShepherd&&sourceMap?.image&&typeof document!=='undefined'){const canvas=document.createElement('canvas');canvas.width=sourceMap.image.width;canvas.height=sourceMap.image.height;const ctx=canvas.getContext('2d');ctx.drawImage(sourceMap.image,0,0);atlasPixels={data:ctx.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height,flipY:sourceMap.flipY};}
    mesh.geometry=mesh.geometry.clone();
    if(isShepherd){const idx=mesh.geometry.index,keep=[];for(let i=0;i<idx.count;i+=3){const triangle=i/3;if(triangle<1580||triangle>=3586)keep.push(idx.getX(i),idx.getX(i+1),idx.getX(i+2));}mesh.geometry.setIndex(keep);}
    mesh.material=mesh.material.clone();mesh.material.color.set('white');mesh.material.vertexColors=true;mesh.material.metalness=0;mesh.material.roughness=.95;mesh.material.flatShading=true;mesh.material.side=DoubleSide;
    mesh.material.map=furMaterial?facePaint.texture:null;mesh.material.needsUpdate=true;mesh.frustumCulled=false;mesh.castShadow=mesh.receiveShadow=true;
    const g=mesh.geometry,p=g.attributes.position,sourceUV=g.attributes.uv,source=p.array.slice(),colors=new Float32Array(p.count*3),uvs=new Float32Array(p.count*2);
    for(let i=0;i<p.count;i++){
      const f=-source[i*3+1],h=source[i*3+2],s=source[i*3];
      const head=smooth(headBounds.min.x-hs.x*.65,headBounds.min.x+hs.x*.18,f)*smooth(headBounds.min.y-hs.y*.6,headBounds.min.y+hs.y*.1,h);
      const body=(1-head)*smooth(fullBounds.min.y+bs.y*.26,fullBounds.min.y+bs.y*.53,h);
      const hinge=earRoots[s>=0?'Ear1L':'Ear1R'];
      const ear=smooth(.12,.8,earWeights.get(positionKey(s,-f,h))||0)*smooth(hs.z*.22,hs.z*.42,Math.abs(s))*(hinge?smooth(hinge.y-hs.y*.03,hinge.y+hs.y*.12,h):0);
      const muzzle=head*smooth(hc.x,headBounds.max.x,f);
      let F=f+(f-hc.x)*(clamp(Number.isFinite(shape.muzzleLength)?shape.muzzleLength:1,.2,1.6)-1)*.7*muzzle;
      let H=h+(h-hc.y)*(factor(shape.headHeight)-1)*.6*head+(h-hc.y)*(factor(shape.furLength)-1)*.06*body;
      H+=(h-headBounds.max.y+hs.y*.1)*(factor(shape.earSize)-1)*.8*ear;
      let S=s*(1+(factor(shape.headWidth)-1)*.65*head)*(1+(factor(shape.bodyWidth)-1)*.6*body)*(1+(factor(shape.furLength)-1)*.13*(head+body));
      // Independent skull and cheek masks leave the nose-tip projection and
      // lower legs unaffected. All masks use common source bind coordinates.
      F+=(f-hc.x)*(control(shape.skullDepth,.6,1.5)-1)*.45*head*(1-muzzle);
      const cheek=head*(1-muzzle)*smooth(headBounds.max.y,headBounds.min.y,h);
      S*=1+(control(shape.cheekWidth,.6,1.8)-1)*.65*cheek;
      S*=1+(control(shape.muzzleWidth,.5,1.8)-1)*.7*muzzle;
      // Original ear weights identify the actual tips on either template.
      // Canonical position keys give all shared material seams the same hinge.
      const drop=clamp(Number(shape.earDrop)||0,0,1);
      if(ear>0&&hinge){
        const angle=drop*Math.PI*.88,side=Math.sign(s)||1;
        const length=1+(control(shape.earLength,.5,3.5)-1)*ear;
        const width=1+(control(shape.earWidth,.5,2.5)-1)*ear;
        F=hinge.x+(F-hinge.x)*width;
        const beforeH=H,beforeS=S;
        const dh=(H-hinge.y)*(H>hinge.y?length:1),ds=(Math.abs(S)-Math.abs(hinge.z))*width;
        H=hinge.y+Math.cos(angle)*dh-Math.sin(angle)*ds;
        S=side*(Math.abs(hinge.z)+Math.sin(angle)*dh+Math.cos(angle)*ds+hs.z*.3*(control(shape.earSpread,.6,1.6)-1)*ear);
        H=beforeH+(H-beforeH)*ear;S=beforeS+(S-beforeS)*ear;
      }
      p.setXYZ(i,S,-F,H);
      let c=primary,sourceDark=false;
      if(atlasPixels&&sourceUV){const u=sourceUV.getX(i),v=sourceUV.getY(i),x=Math.round(clamp(u,0,1)*(atlasPixels.width-1)),y=Math.round(clamp(atlasPixels.flipY?1-v:v,0,1)*(atlasPixels.height-1)),k=(y*atlasPixels.width+x)*4;const rgb=[0,1,2].map(j=>atlasPixels.data[k+j]/255),l=(rgb[0]+rgb[1]+rgb[2])/3;sourceDark=l<.24&&head>.5;c=sourceDark?deep:l>.72?secondary:primary;}
      if(isPug&&materialName==='Main_Dark'){sourceDark=true;c=deep;}
      if(materialName==='Eyes_White')c=color('#fff8e9');else if(materialName==='Eyes_Pupil')c=iris;else if(materialName==='Eyes_Black')c=color('#18201c');else if(materialName==='Black')c=nose;
      else{
        const patch=Math.sin(f/bs.x*18+h/bs.y*5)*Math.cos(s/bs.z*9-h/bs.y*4);
        if(materialName==='Main_Light'&&pattern!=='solid')c=secondary;
        if(pattern==='tabby'&&Math.sin(f/bs.x*85+s/bs.z*9)>.65)c=deep;
        if(pattern==='calico')c=patch>.2?primary:patch<-.4?deep:secondary;
        if(pattern==='tortoiseshell')c=patch>.05?primary:deep;
        if(pattern==='point'&&(head>.5||h<fullBounds.min.y+bs.y*.2))c=secondary;
      }
      // The source ear interior is pale; repaint it as coat rather than a
      // stretched white triangle that resembles a hole when the ear hangs.
      if(furMaterial&&ear>.04)c=primary;
      uvs[i*2]=uvs[i*2+1]=.5/256;
      if(furMaterial&&(!sourceDark||isPug)&&ear<=.04&&head>.6&&f>hc.x-hs.x*.22){const q=uv(f,h,s);uvs[i*2]=(8.5+q.u*239)/256;uvs[i*2+1]=(8.5+q.v*239)/256;c=new Color('white');}
      colors.set([c.r,c.g,c.b],i*3);
    }
    g.setAttribute('color',new BufferAttribute(colors,3));g.setAttribute('uv',new BufferAttribute(uvs,2));p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();triangles+=(g.index?.count??p.count)/3;
  });
  original.updateMatrixWorld(true);const bounds=new Box3().setFromObject(original,true),size=bounds.getSize(new Vector3()),scale=2.8/Math.max(size.x,size.y,size.z);
  original.scale.multiplyScalar(scale);original.position.add(new Vector3(-(bounds.min.x+bounds.max.x)*.5,-bounds.min.y,-(bounds.min.z+bounds.max.z)*.5).multiplyScalar(scale));
  root.animations=(asset.animations||[]).map(c=>c.clone());
  root.userData={kind:'photo-dog-original-template',triangleCount:triangles,meshCount:meshes,source:'Quaternius '+({'husky':'Husky','pug':'Pug','german-shepherd':'German Shepherd'}[breed]||'Shiba Inu'),attribution:{...DOG_CREDIT,title:({'pug':'Pug','german-shepherd':'Zombie Apocalypse Kit — German Shepherd','husky':'Ultimate Animated Animals — Husky'}[breed]||DOG_CREDIT.title),changes:DOG_CREDIT.changes+(isShepherd?' Removed separate backpack components; body, eyes and brows retain original triangles. Fused scarf and belt recolored as coat.':''),source:isPug?'https://poly.pizza/m/1gXKv15ik8':isShepherd?'https://quaternius.com/packs/zombieapocalypsekit.html':DOG_CREDIT.source},templatePreserved:{indices:!isShepherd,retainedBodyIndices:true,skinWeights:true,skeleton:true,inverseBindMatrices:true,animationTracks:true},removedAccessories:isShepherd?['Separate backpack components (2006 triangles)']:[],sourceLimitations:isShepherd?['Scarf and belt are fused into the original body; recolored as fur, chest silhouette retained.']:[],photoColorSamples:facePaint.sourceSamples,stylizedFacePaint:true,sourcePixelsEmbedded:false,facePaintPalette:facePaint.paletteHex,referenceFacePattern:typeof profile.sampleFace==='function',embeddedFaceTexture:true,faceTextureSize:256,shapeControls:['headWidth','headHeight','muzzleLength','earSize','bodyWidth','furLength','earDrop','earLength','earWidth','earSpread','skullDepth','cheekWidth','muzzleWidth'].filter(key=>!isPug||!key.startsWith('ear')),limitations:['Uses the selected original breed model; other breeds are approximations. Pug has no separate ear joints.','Coat regions are simplified from the reference; unseen markings are inferred.','Fur amount adjusts silhouette volume, not hair strands.']};
  root.updateMatrixWorld(true);return root;
}
// The source photograph is consulted only for a tiny categorical fur map.
// The exported image contains authored, discrete fur regions only. Existing
// dog eye and nose facets retain their semantic materials; no photo pixels remain.
function createStylizedFacePaint(profile,{primary,secondary,iris,nose,deep,pattern}){
  const size=256,padding=8,extent=size-padding*2,N=12;
  const charcoal=color('#18201c'),highlight=color('#fff8e9'),white=color('#ffffff');
  const third=color(profile.colors?.tertiaryColor||'#3d3029');
  const furPalette=pattern==='calico'?[third,primary,secondary]:pattern==='tortoiseshell'?[third,primary]:pattern==='tabby'?[deep,primary,secondary]:pattern==='point'?[secondary,primary]:[primary,secondary];
  const labels=new Uint8Array(N*N),samples=[];let sourceSamples=0;
  const rgbOf=c=>{const rgb={r:0,g:0,b:0};c.getRGB(rgb,SRGBColorSpace);return[rgb.r,rgb.g,rgb.b];};
  const luminance=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722;
  if(typeof profile.sampleFace==='function'){
    for(let y=0;y<N;y++)for(let x=0;x<N;x++){
      let u=(x+.5)/N,v=(y+.5)/N;
      // Do not mistake the photographed pupils, pink nose or mouth shadows for
      // fur patches. Sample adjoining coat before assigning a color class.
      if((Math.abs(u-.25)<.14||Math.abs(u-.75)<.14)&&Math.abs(v-.4)<.13)v=.19;
      if(Math.abs(u-.5)<.18&&v>.56&&v<.79){u=u<.5?.29:.71;v=.67;}
      let rgb=rgbOf(primary);
      try{rgb=rgbOf(color(profile.sampleFace(u,v)));sourceSamples++;}catch{}
      samples.push(rgb);
    }
    const sorted=[...samples].sort((a,b)=>luminance(a)-luminance(b));
    const count=pattern==='solid'?1:furPalette.length;
    let centers=Array.from({length:count},(_,i)=>sorted[Math.round((i+.25)/count*(sorted.length-1))].slice());
    for(let pass=0;pass<7;pass++){
      const sums=centers.map(()=>[0,0,0,0]);
      samples.forEach((sample,index)=>{
        let best=0,distance=Infinity;
        centers.forEach((center,k)=>{const d=sample.reduce((n,v,j)=>n+(v-center[j])**2,0);if(d<distance){distance=d;best=k;}});
        labels[index]=best;for(let j=0;j<3;j++)sums[best][j]+=sample[j];sums[best][3]++;
      });
      centers=centers.map((center,i)=>sums[i][3]?sums[i].slice(0,3).map(v=>v/sums[i][3]):center);
    }
    const rank=centers.map((c,i)=>({i,l:luminance(c)})).sort((a,b)=>a.l-b.l).map(c=>c.i);
    for(let i=0;i<labels.length;i++)labels[i]=rank.indexOf(labels[i]);
    // Remove isolated one-cell noise, while retaining substantial asymmetric
    // markings and the central blaze. These are region labels, never pixels.
    const copy=labels.slice();
    for(let y=1;y<N-1;y++)for(let x=1;x<N-1;x++){
      const votes=new Uint8Array(count);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)votes[copy[(y+dy)*N+x+dx]]++;
      const majority=votes.indexOf(Math.max(...votes));if(votes[majority]>=7)labels[y*N+x]=majority;
    }
  }
  function measuredLabel(u,v){
    const x=clamp(u*N-.5,0,N-1),y=clamp(v*N-.5,0,N-1),ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    const votes=new Float32Array(furPalette.length);
    for(const [dx,dy,w]of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]])votes[labels[Math.min(iy+dy,N-1)*N+Math.min(ix+dx,N-1)]]+=w;
    return votes.indexOf(Math.max(...votes));
  }
  function furColor(u,v){
    let c=primary;
    if(sourceSamples)c=furPalette[measuredLabel(u,v)];
    else if(pattern==='bicolor'&&Math.abs(u-.5)<.08+v*.19)c=secondary;
    else if(pattern==='calico')c=u<.43?primary:u>.65?third:secondary;
    else if(pattern==='tortoiseshell')c=Math.sin(u*12+v*4)>.15?primary:third;
    else if(pattern==='point'&&v>.22)c=secondary;
    // Authored clean muzzle avoids copying the photo's under-chin shadows.
    if(['bicolor','calico','tabby'].includes(pattern)&&v>.65&&Math.abs(u-.5)<.24+(v-.65)*.22)c=secondary;
    if(pattern==='tabby'&&v<.28&&Math.abs(Math.sin((u-.5)*29+v*10))>.91)c=deep;
    return c;
  }
  const paletteColors=[white,...furPalette,primary,secondary,third,deep,iris,nose,charcoal,highlight];
  const bytes=new Map(paletteColors.map(c=>[c,rgbOf(c).map(v=>Math.round(clamp(v,0,1)*255))]));
  const pixels=new Uint8Array(size*size*4);pixels.fill(255);
  for(let y=0;y<extent;y++)for(let x=0;x<extent;x++){
    const u=x/(extent-1),v=y/(extent-1);let c=furColor(u,v);
    if(profile.baseModel==='pug'){
      if(v>.37)c=deep;
      for(const cx of [.25,.75]){const dx=u-cx,dy=v-.4;
        if((dx/.095)**2+(dy/.085)**2<1)c=charcoal;
        if((dx/.068)**2+(dy/.065)**2<1)c=iris;
        if((dx/.032)**2+(dy/.052)**2<1)c=charcoal;
        if(((dx+.023)/.014)**2+((dy+.025)/.016)**2<1)c=highlight;
      }
      if(((u-.5)/.075)**2+((v-.48)/.045)**2<1)c=nose;
    }
    const rgb=bytes.get(c);
    const i=((y+padding)*size+x+padding)*4;pixels[i]=rgb[0];pixels[i+1]=rgb[1];pixels[i+2]=rgb[2];
  }
  const texture=new DataTexture(pixels,size,size,RGBAFormat);
  texture.name='Authored low-poly face paint — no photographic pixels';texture.colorSpace=SRGBColorSpace;texture.flipY=false;
  texture.magFilter=texture.minFilter=LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
  const paletteHex=[...new Set([...bytes.values()].map(rgb=>'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('')))];
  return{texture,furColor,sourceSamples,paletteHex};
}
