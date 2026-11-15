import {Box3,BufferAttribute,BufferGeometry,Color,DataTexture,Group,LinearFilter,MeshLambertMaterial,RGBAFormat,SRGBColorSpace,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const factor=v=>clamp(Number.isFinite(v)?v:1,.65,1.45);
const facialFactor=(v,max=1.4)=>clamp(Number.isFinite(v)?v:1,.7,max);
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


export const CAT_BREED_CREDIT={title:'Cat',author:'J-Toastie',source:'https://poly.pizza/m/DJ9rpAhrh3',license:'CC BY 3.0',licenseUrl:'https://creativecommons.org/licenses/by/3.0/',changes:'Normalized display orientation and size; palette-based coat repaint, authored graphic face and smooth bind-space shape adjustments. Uniform midpoint refinement plus conforming eye/nose edge splits derives additional facets; skin weights interpolated consistently. Original skeleton, inverse binds and IdleCat clip retained. Each facet uses one authored palette color and no texture.'};
let assetPromise;
export async function createTemplateCatBreed(profile={}){
  assetPromise??=new GLTFLoader().loadAsync('../../models/cat/jtoastie.glb').catch(e=>{assetPromise=null;throw e;});
  return adaptTemplateCatBreed(await assetPromise,profile);
}
export function adaptTemplateCatBreed(asset,profile={}){
  const original=clone(asset.scene),root=new Group(),orientation=new Group();root.name='PhotoCat_JToastie';orientation.rotation.y=-Math.PI/2;orientation.add(original);root.add(orientation);root.updateMatrixWorld(true);
  const shape=profile.shape||{},palette=profile.colors||{},primary=color(palette.baseColor,'#777777'),secondary=color(palette.secondaryColor,'#ece5db'),iris=color(palette.eyeColor,'#a4b260'),nose=color(palette.noseColor,'#b78b88'),deep=primary.clone().multiplyScalar(.2),pattern=profile.pattern||'solid';
  const paint=createStylizedFacePaint(profile,{primary,secondary,iris,nose,deep,pattern});
  const hb=new Box3(),bb=new Box3();
  original.traverse(m=>{if(!m.isMesh)return;const p=m.geometry.attributes.position,si=m.geometry.attributes.skinIndex,sw=m.geometry.attributes.skinWeight;
    for(let i=0;i<p.count;i++){const v=new Vector3(p.getX(i),p.getZ(i),-p.getY(i));bb.expandByPoint(v);let h=0;for(let j=0;j<4;j++)if(m.skeleton.bones[si.array[i*4+j]]?.name==='Head')h+=sw.array[i*4+j];if(h>.5)hb.expandByPoint(v);}
  });
  const hc=hb.getCenter(new Vector3()),hs=hb.getSize(new Vector3()),bs=bb.getSize(new Vector3());
  const faceSpan=hs.z*.74;let triangles=0,meshes=0;
  const ctl=(v,a=.7,b=1.4)=>clamp(Number.isFinite(v)?v:1,a,b);
  original.traverse(m=>{if(!m.isMesh)return;meshes++;m.geometry=m.geometry.clone();m.material=m.material.clone();m.material.color.set('white');m.material.map=null;m.material.vertexColors=true;m.material.roughness=.95;m.material.metalness=0;m.material.flatShading=true;m.material.needsUpdate=true;m.frustumCulled=false;m.castShadow=m.receiveShadow=true;
    const g=m.geometry,p=g.attributes.position,source=p.array.slice(),colors=new Float32Array(p.count*3),uvs=new Float32Array(p.count*2);
    for(let i=0;i<p.count;i++){
      const f=source[i*3],h=source[i*3+2],s=-source[i*3+1];
      const head=smooth(hb.min.x-hs.x*.5,hb.min.x+hs.x*.15,f)*smooth(hb.min.y-hs.y*.5,hb.min.y+hs.y*.05,h),body=(1-head)*smooth(bb.min.y+bs.y*.3,bb.min.y+bs.y*.52,h);
      const muzzle=head*smooth(hc.x,hb.max.x,f),ear=head*smooth(hb.max.y-hs.y*.42,hb.max.y-hs.y*.19,h)*smooth(hs.z*.08,hs.z*.29,Math.abs(s));
      const cheek=head*(1-muzzle)*smooth(hb.max.y,hb.min.y,h);
      let F=f+(f-hc.x)*(factor(shape.muzzleLength)-1)*.45*muzzle+(f-hc.x)*(ctl(shape.skullDepth)-1)*.4*head*(1-muzzle);
      let H=h+(h-hc.y)*(factor(shape.headHeight)-1)*.55*head+(h-hc.y)*(factor(shape.furLength)-1)*.08*body;
      let S=s*(1+(factor(shape.headWidth)-1)*.6*head)*(1+(factor(shape.bodyWidth)-1)*.5*body)*(1+(factor(shape.furLength)-1)*.13*(head+body));
      S*=1+(ctl(shape.cheekWidth)-1)*.5*cheek;S*=1+(ctl(shape.muzzleWidth)-1)*.5*muzzle;
      H+=Math.max(0,h-(hb.max.y-hs.y*.38))*(factor(shape.earSize)*ctl(shape.earLength)-1)*ear;
      // A coordinate-only neck compression moves all coincident head corners
      // equally; its bounded displacement stays below 6% of body height.
      const neck=smooth(bb.min.y+bs.y*.42,bb.min.y+bs.y*.68,h)*smooth(hb.min.x-hs.x*.9,hb.min.x-hs.x*.25,f);
      H+=bs.y*.13*(factor(shape.neckLength)-1)*neck;
      S+=Math.sign(s)*hs.z*((ctl(shape.earWidth)-1)*.2+(ctl(shape.earSpread,.7,1.3)-1)*.25)*ear;
      F+=(f-hc.x)*(ctl(shape.earWidth)-1)*.2*ear;
      p.setXYZ(i,F,-S,H);
      let c=primary;const patch=Math.sin(f/bs.x*22+h/bs.y*7)*Math.cos(s/bs.z*11-h/bs.y*5);
      if(pattern==='bicolor'){
        const coverage=factor(shape.whiteCoverage),lowPaws=h<bb.min.y+bs.y*(.14+.08*(coverage-.65));
        const chest=f>bb.max.x-bs.x*(.29+.13*(coverage-.65))&&h<bb.min.y+bs.y*.73&&Math.abs(s)<bs.z*(.17+.18*(coverage-.65));
        if(lowPaws||chest)c=secondary;
      }
      if(pattern==='tabby'&&Math.sin(f/bs.x*70+s/bs.z*12)>.55)c=deep;
      if(pattern==='calico')c=patch>.2?primary:patch<-.4?deep:secondary;
      if(pattern==='tortoiseshell')c=patch>.05?primary:deep;
      if(pattern==='point'&&(head>.5||h<bb.min.y+bs.y*.2))c=secondary;
      const u=clamp(.5-s/faceSpan,.025,.975),v=clamp((hb.max.y-hs.y*.14-h)/(hs.y*.86),.025,.975);
      if(head>.5)c=paint.furColor(u,ear>.3?.04:v);
      uvs[i*2]=uvs[i*2+1]=.5/paint.size;

      colors.set([c.r,c.g,c.b],i*3);
    }
    // Material groups isolate the painted face without splitting or reordering
    // source triangles. Shared body vertices never interpolate through an atlas.
    const faceMaterial=m.material.clone();faceMaterial.map=paint.texture;faceMaterial.vertexColors=false;faceMaterial.needsUpdate=true;m.material=[m.material,faceMaterial];g.clearGroups();
    for(let i=0;i<p.count;i++){const u=clamp(.5+source[i*3+1]/faceSpan,.025,.975),v=clamp((hb.max.y-hs.y*.14-source[i*3+2])/(hs.y*.86),.025,.975);uvs[i*2]=(8.5+u*(paint.size-17))/paint.size;uvs[i*2+1]=(8.5+v*(paint.size-17))/paint.size;}
    let start=0,last=-1;const count=g.index?.count??p.count;
    for(let t=0;t<count;t+=3){const ids=[0,1,2].map(k=>g.index?g.index.getX(t+k):t+k),f=ids.reduce((n,j)=>n+source[j*3],0)/3,h=ids.reduce((n,j)=>n+source[j*3+2],0)/3;
      const material=f>hc.x-hs.x*.12&&h>hb.min.y&&h<hb.max.y-hs.y*.15?1:0;
      if(last!==material){if(last>=0)g.addGroup(start,t-start,last);start=t;last=material;}}
    g.addGroup(start,count-start,last);g.setAttribute('uv',new BufferAttribute(uvs,2));
    g.setAttribute('color',new BufferAttribute(colors,3));p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();m.geometry=refineFacetSurface(g,paint);g.dispose();m.material.forEach(material=>material.dispose());m.material=new MeshLambertMaterial({color:'white',vertexColors:true,flatShading:true});m.receiveShadow=false;triangles+=m.geometry.attributes.position.count/3;
  });
  root.updateMatrixWorld(true);const bounds=new Box3().setFromObject(orientation,true),sz=bounds.getSize(new Vector3()),scale=2.8/Math.max(sz.x,sz.y,sz.z);orientation.scale.setScalar(scale);orientation.position.set(-(bounds.min.x+bounds.max.x)*.5*scale,-bounds.min.y*scale,-(bounds.min.z+bounds.max.z)*.5*scale);
  root.animations=asset.animations.map(c=>c.clone());root.userData={kind:'photo-cat-jtoastie-template',triangleCount:triangles,meshCount:meshes,source:'Cat by J-Toastie',attribution:{...CAT_BREED_CREDIT},templatePreserved:{indices:false,skinWeights:false,skeleton:true,inverseBindMatrices:true,animationTracks:true},surfaceRefinement:{method:'uniform-midpoint-plus-conforming-face',levels:1,faceRefinementPasses:2,sourceTriangleCount:1856,derivedTriangleCount:triangles,weights:'midpoint-merge-top4-normalized'},perFacetColor:true,photoColorSamples:paint.sourceSamples,stylizedFacePaint:true,sourcePixelsEmbedded:false,facePaintPalette:paint.paletteHex,referenceFacePattern:typeof profile.sampleFace==='function',embeddedFaceTexture:false,shapeControls:['headWidth','headHeight','muzzleLength','earSize','bodyWidth','furLength','earLength','earWidth','earSpread','skullDepth','cheekWidth','muzzleWidth','neckLength','whiteCoverage'],limitations:['Descriptive round-face body style, not a verified purebred model.','Original source supplies idle animation only.','Coat regions are simplified; unseen markings are inferred.']};paint.texture.dispose();root.updateMatrixWorld(true);return root;
}
// The source photograph is consulted only for a tiny categorical fur map.
// The exported image is newly authored flat paint: a bounded palette, graphic
// eyes/pupils, a triangular nose and mouth. No source image pixels are retained.
function createStylizedFacePaint(profile,{primary,secondary,iris,nose,deep,pattern}){
  const size=512,padding=8,extent=size-padding*2,N=24;
  const charcoal=color('#18201c'),highlight=color('#fff8e9'),white=color('#ffffff'),mouthTone=nose.clone().multiplyScalar(.42);
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
      if(Math.abs(u-.5)<.085&&v>.58&&v<.75)v=.54;
      let rgb=rgbOf(primary);
      // Extend the fur-only forehead region above the eye-aligned frame.
      // Eye and nose anchors remain authored; the forehead is not stretched
      // from the narrow strip immediately above photographed eyes.
      const sourceV=v<.4?.4+(v-.4)*1.65:v;
      try{rgb=rgbOf(color(profile.sampleFace(u,sourceV)));sourceSamples++;}catch{}
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
    const paletteRank=count===1?[0]:furPalette.map((c,i)=>({i,l:luminance(rgbOf(c))})).sort((a,b)=>a.l-b.l).map(c=>c.i);
    for(let i=0;i<labels.length;i++)labels[i]=paletteRank[rank.indexOf(labels[i])];
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
    if(sourceSamples){
      c=furPalette[measuredLabel(u,v)];
      if(pattern==='bicolor'){
        // Infer a clean pale lower face only when the sampled chin agrees;
        // side-of-photo background must not leave isolated cheek triangles.
        const paleChin=[.4,.5,.6].filter(x=>furPalette[measuredLabel(x,.88)]===secondary).length>=2;
        if(paleChin&&v>.66)c=secondary;
        const darkCap=furPalette[measuredLabel(.22,.13)]===primary&&furPalette[measuredLabel(.78,.13)]===primary;
        if(darkCap&&v<.28&&c===secondary&&Math.abs(u-.5)>.018+v*.27)c=primary;
      }
    }
    else if(pattern==='bicolor'&&Math.abs(u-.5)<.08+v*.19)c=secondary;
    else if(pattern==='calico')c=u<.43?primary:u>.65?third:secondary;
    else if(pattern==='tortoiseshell')c=Math.sin(u*12+v*4)>.15?primary:third;
    else if(pattern==='point'&&v>.22)c=secondary;
    // Authored clean muzzle avoids copying the photo's under-chin shadows.
    if(['bicolor','calico','tabby'].includes(pattern)&&v>.65&&Math.abs(u-.5)<.24+(v-.65)*.22)c=secondary;
    if(pattern==='tabby'&&v<.28&&Math.abs(Math.sin((u-.5)*29+v*10))>.91)c=deep;
    return c;
  }
  function paint(u,v){
    let c=furColor(u,v);
    for(const cx of [.25,.75]){
      const dx=u-cx,dy=v-.4;
      const almond=(rx,ry)=>Math.abs(dx)<rx&&Math.abs(dy)<ry*(1-Math.pow(Math.abs(dx)/rx,1.5));
      if(almond(.084,.065))c=charcoal;
      if(almond(.069,.049))c=iris;
      if((dx/.016)**2+(dy/.046)**2<1)c=charcoal;
      if(((dx+.019)/.009)**2+((dy+.015)/.009)**2<1)c=highlight;
    }
    if(v>=.55&&v<=.615&&Math.abs(u-.5)<.047*(1-(v-.55)/.065))c=nose;
    if(v>.612&&v<.65&&Math.abs(u-.5)<.0028)c=mouthTone;
    const mouthY=.65+Math.abs(u-.5)*.12;
    if(Math.abs(u-.5)<.032&&Math.abs(v-mouthY)<.0022)c=mouthTone;
    return c;
  }
  const paletteColors=[white,...furPalette,primary,secondary,third,deep,iris,nose,charcoal,highlight,mouthTone];
  const bytes=new Map(paletteColors.map(c=>[c,rgbOf(c).map(v=>Math.round(clamp(v,0,1)*255))]));
  const pixels=new Uint8Array(size*size*4);pixels.fill(255);
  for(let y=0;y<extent;y++)for(let x=0;x<extent;x++){
    const c=paint(x/(extent-1),y/(extent-1)),rgb=bytes.get(c);
    const i=((y+padding)*size+x+padding)*4;pixels[i]=rgb[0];pixels[i+1]=rgb[1];pixels[i+2]=rgb[2];
  }
  const texture=new DataTexture(pixels,size,size,RGBAFormat);
  texture.name='Authored low-poly face paint — no photographic pixels';texture.colorSpace=SRGBColorSpace;texture.flipY=false;
  texture.magFilter=texture.minFilter=LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
  const paletteHex=[...new Set([...bytes.values()].map(rgb=>'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('')))];
  return{texture,furColor,sourceSamples,paletteHex,size,iris,charcoal,bodyPalette:pattern==='bicolor'?[primary,secondary]:pattern==='solid'?[primary]:[...furPalette,primary,secondary,deep]};
}

// Refine the complete surface uniformly. Shared edges therefore have exactly
// matching positions and skin influences, including the original UV seams.
function refineFacetSurface(source,paint){
 const pos=source.attributes.position,uv=source.attributes.uv,col=source.attributes.color,si=source.attributes.skinIndex,sw=source.attributes.skinWeight;
 const palette=paint.bodyPalette,pixels=paint.texture.image.data,size=paint.size;
 const positions=[],indices=[],weights=[],colors=[];let facets=[];
 const vertex=i=>({p:[pos.getX(i),pos.getY(i),pos.getZ(i)],uv:[uv.getX(i),uv.getY(i)],c:[col.getX(i),col.getY(i),col.getZ(i)],si:Array.from(si.array.slice(i*4,i*4+4)),sw:Array.from(sw.array.slice(i*4,i*4+4))});
 function mid(a,b){
  const influence=new Map();for(const v of [a,b])for(let k=0;k<4;k++)if(v.sw[k]>0)influence.set(v.si[k],(influence.get(v.si[k])||0)+v.sw[k]*.5);
  const ranked=[...influence].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,4),total=ranked.reduce((n,e)=>n+e[1],0);
  while(ranked.length<4)ranked.push([0,0]);
  return{p:a.p.map((n,k)=>(n+b.p[k])*.5),uv:a.uv.map((n,k)=>(n+b.uv[k])*.5),c:a.c.map((n,k)=>(n+b.c[k])*.5),si:ranked.map(e=>e[0]),sw:ranked.map(e=>e[1]/total)};
 }
 function classify(tri,face){
  let color;
  if(face){const u=tri.reduce((n,v)=>n+v.uv[0],0)/3,v=tri.reduce((n,v)=>n+v.uv[1],0)/3,x=clamp(Math.floor(u*size),0,size-1),y=clamp(Math.floor(v*size),0,size-1),k=(y*size+x)*4;color=new Color().setRGB(pixels[k]/255,pixels[k+1]/255,pixels[k+2]/255,SRGBColorSpace);}
  else{const rgb=[0,1,2].map(k=>tri.reduce((n,v)=>n+v.c[k],0)/3);let best=Infinity;for(const candidate of palette){const distance=(candidate.r-rgb[0])**2+(candidate.g-rgb[1])**2+(candidate.b-rgb[2])**2;if(distance<best){color=candidate;best=distance;}}}
  return color;
 }
 const count=source.index?.count??pos.count;let group=0;
 for(let t=0;t<count;t+=3){while(group<source.groups.length-1&&t>=source.groups[group].start+source.groups[group].count)group++;const ids=[0,1,2].map(k=>source.index?source.index.getX(t+k):t+k),[a,b,c]=ids.map(vertex),ab=mid(a,b),bc=mid(b,c),ca=mid(c,a),face=source.groups[group]?.materialIndex===1;for(const tri of [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])facets.push({tri,face});}

 // Mark edges globally, then conformingly retriangulate every incident face.
 // Coordinate keys also join duplicated original UV/material seam vertices.
 const key=v=>v.p.map(n=>Math.round(n*1e7)).join(','),edge=(a,b)=>{const x=key(a),y=key(b);return x<y?x+'|'+y:y+'|'+x;};
 for(let pass=0;pass<2;pass++){
  const marked=new Set();
  for(const {tri,face} of facets){if(!face)continue;const u=(tri.reduce((n,v)=>n+v.uv[0],0)/3*size-8.5)/(size-17),v=(tri.reduce((n,v)=>n+v.uv[1],0)/3*size-8.5)/(size-17);
   const us=tri.map(p=>(p.uv[0]*size-8.5)/(size-17)),vs=tri.map(p=>(p.uv[1]*size-8.5)/(size-17));
   const intersects=(x0,x1,y0,y1)=>Math.max(...us)>=x0&&Math.min(...us)<=x1&&Math.max(...vs)>=y0&&Math.min(...vs)<=y1;
   const eye=intersects(.12,.38,.295,.505)||intersects(.62,.88,.295,.505),nose=intersects(.41,.59,.5,.67),blaze=intersects(.35,.65,0,.62);
   if(eye||nose||blaze)for(let k=0;k<3;k++)marked.add(edge(tri[k],tri[(k+1)%3]));
  }
  const next=[];
  for(const {tri,face} of facets){const flags=tri.map((v,k)=>marked.has(edge(v,tri[(k+1)%3]))),n=flags.filter(Boolean).length;if(!n){next.push({tri,face});continue;}
   let a,b,c,ab,bc,ca,parts;
   if(n===3){[a,b,c]=tri;ab=mid(a,b);bc=mid(b,c);ca=mid(c,a);parts=[[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]];}
   else if(n===1){const k=flags.indexOf(true);a=tri[k];b=tri[(k+1)%3];c=tri[(k+2)%3];ab=mid(a,b);parts=[[a,ab,c],[ab,b,c]];}
   else{const k=flags.findIndex((v,i)=>v&&flags[(i+1)%3]);a=tri[k];b=tri[(k+1)%3];c=tri[(k+2)%3];ab=mid(a,b);bc=mid(b,c);parts=[[b,bc,ab],[a,ab,c],[ab,bc,c]];}
   for(const tri of parts)next.push({tri,face});
  }
  facets=next;
 }

 // Compact authored iris regions are classified directly on each whole facet.
 // Small highlight pixels cannot fragment them into disconnected colored slits.
 for(const f of facets){
  f.color=classify(f.tri,f.face);f.u=(f.tri.reduce((n,v)=>n+v.uv[0],0)/3*size-8.5)/(size-17);f.v=(f.tri.reduce((n,v)=>n+v.uv[1],0)/3*size-8.5)/(size-17);f.eye=false;

  if(f.face)for(const cx of [.25,.75]){const dx=f.u-cx,dy=f.v-.4;if((dx/.081)**2+(dy/.077)**2<1){f.eye=true;f.color=paint.charcoal;if((dx/.069)**2+(dy/.062)**2<1)f.color=paint.iris;if((dx/.02)**2+(dy/.044)**2<1)f.color=paint.charcoal;}}
 }
 const incidence=new Map(),neighbors=facets.map(()=>new Set());
 facets.forEach((f,i)=>{for(let k=0;k<3;k++){const e=edge(f.tri[k],f.tri[(k+1)%3]);if(!incidence.has(e))incidence.set(e,[]);incidence.get(e).push(i);}});
 for(const ids of incidence.values())for(const i of ids)for(const j of ids)if(i!==j)neighbors[i].add(j);
 const colorKey=c=>[c.r,c.g,c.b].map(v=>Math.round(v*1e7)).join(',');
 for(let pass=0;pass<3;pass++){
  const previous=facets.map(f=>f.color);
  facets.forEach((f,i)=>{
   if(!f.face||f.eye||f.v>.58||Math.abs(f.u-.5)>.29)return;
   const [a,b,c]=f.tri.map(v=>new Vector3(v.uv[0],v.uv[1],0)),ab=b.clone().sub(a),ac=c.clone().sub(a),area2=ab.clone().cross(ac).length(),longest=Math.max(ab.lengthSq(),ac.lengthSq(),b.distanceToSquared(c));
   if(longest/Math.max(area2,1e-15)<4)return;
   const votes=new Map();for(const j of neighbors[i])if(facets[j].face&&!facets[j].eye){const k=colorKey(previous[j]),entry=votes.get(k)||{count:0,color:previous[j]};entry.count++;votes.set(k,entry);}
   const majority=[...votes.values()].sort((a,b)=>b.count-a.count)[0];if(majority?.count>=2)f.color=majority.color;
  });
 }
 for(const {tri,color} of facets)for(const v of tri){positions.push(...v.p);indices.push(...v.si);weights.push(...v.sw);colors.push(color.r,color.g,color.b);}


 const result=new BufferGeometry();result.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));result.setAttribute('skinIndex',new BufferAttribute(new Uint16Array(indices),4));result.setAttribute('skinWeight',new BufferAttribute(new Float32Array(weights),4));result.setAttribute('color',new BufferAttribute(new Float32Array(colors),3));result.computeVertexNormals();result.computeBoundingBox();result.computeBoundingSphere();return result;
}
