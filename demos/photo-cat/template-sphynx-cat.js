import {Box3,BufferAttribute,Color,Group,MeshStandardMaterial,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const factor=v=>clamp(Number.isFinite(v)?v:1,.7,1.4);
function color(v,fallback){if(typeof v==='string')return new Color(v);if(v instanceof Color)return v.clone();const a=Array.isArray(v)?v:v&&[v.r,v.g,v.b];if(a?.length>=3&&a.slice(0,3).every(Number.isFinite)){const k=Math.max(...a)>1?255:1;return new Color().setRGB(a[0]/k,a[1]/k,a[2]/k).convertSRGBToLinear();}return new Color(fallback);}
export const SPHYNX_CAT_CREDIT={title:'Sphynx Cat Sculpt',author:'jakeblakeley',source:'https://sketchfab.com/3d-models/sphynx-cat-sculpt-8dd24cd03aa0404bb5f043da29cdef79',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',changes:'Merged skin primitives and quadric-decimated source to4818 triangles; removed transparent cornea overlay. Authored palette repaint and smooth profile deformation. Static source, no skeleton or animation.'};
let source;
export async function createTemplateSphynxCat(profile={}){source??=new GLTFLoader().loadAsync('../../models/cat/sphynx-lowpoly.glb').catch(e=>{source=undefined;throw e;});return adaptTemplateSphynxCat(await source,profile);}
export function adaptTemplateSphynxCat(asset,profile={}){
 const original=(asset.scene||asset.root||asset).clone(true),root=new Group();root.name='PhotoCat_SphynxStaticTemplate';root.add(original);
 const shape=profile.shape||{},palette=profile.colors||{},primary=color(palette.baseColor,'#aa8f87'),secondary=color(palette.secondaryColor,'#d9c2b5'),third=color(palette.tertiaryColor,'#625455'),iris=color(palette.eyeColor,'#94b4a0'),nose=color(palette.noseColor,'#35272b'),coat=[primary,secondary,third];
 const labels=new Uint8Array(64);let samples=0;
 if(typeof profile.sampleFace==='function')for(let y=0;y<8;y++)for(let x=0;x<8;x++){try{const c=color(profile.sampleFace((x+.5)/8,(y+.5)/8),'#aa8f87');let best=0,dist=Infinity;coat.forEach((p,i)=>{const d=(c.r-p.r)**2+(c.g-p.g)**2+(c.b-p.b)**2;if(d<dist){dist=d;best=i;}});labels[y*8+x]=best;samples++;}catch{}}
 let triangles=0;
 original.traverse(mesh=>{if(!mesh.isMesh)return;mesh.geometry=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();const g=mesh.geometry,p=g.attributes.position,src=p.array.slice(),colors=new Float32Array(p.count*3),eye=mesh.name.includes('EyeIris'),sclera=mesh.name.includes('Sclera'),claw=mesh.name.includes('Claw');
 for(let i=0;i<p.count;i++){const x=src[i*3],y=src[i*3+1],z=src[i*3+2],head=smooth(.62,.94,z)*smooth(.8,1.04,y),ear=head*smooth(1.25,1.47,y),muzzle=head*smooth(1.03,1.2,z)*(1-smooth(1.19,1.31,y));
 let X=x*(1+(factor(shape.bodyWidth)-1)*.4*(1-head))+(x+.15)*(factor(shape.headWidth)-1)*.55*head;
 X+=(x+.15)*(factor(shape.cheekWidth)-1)*.35*head*(1-ear)+(x+.15)*(factor(shape.muzzleWidth)-1)*.45*muzzle;
 X+=(x+.15)*(factor(shape.earWidth)-1)*.5*ear+Math.sign(x+.15)*.065*(factor(shape.earSpread)-1)*ear;
 const Y=y+(y-1.14)*(factor(shape.headHeight)-1)*.5*head+Math.max(0,y-1.27)*(factor(shape.earLength)-1)*ear;
 const Z=z+(z-.94)*(factor(shape.skullDepth)-1)*.45*head+(z-1.04)*(factor(shape.muzzleLength)-1)*.55*muzzle;
 p.setXYZ(i,X,Y,Z);
 let c=primary;
 if(profile.pattern==='bicolor'&&(y<.2||Math.abs(x+.1)<.08&&z>.55))c=secondary;
 if(profile.pattern==='point'&&(head>.5||y<.2))c=third;
 if(['calico','tortoiseshell'].includes(profile.pattern))c=Math.sin(x*17+y*12+z*11)>.3?third:primary;
 if(samples&&head>.5){const u=clamp(.5-(x+.15)/.4,0,.999),v=clamp((1.43-y)/.43,0,.999);c=coat[labels[Math.floor(v*8)*8+Math.floor(u*8)]];}
 if(eye)c=iris;if(sclera)c=new Color('#262323');if(claw)c=nose;
 if(!eye&&!sclera&&z>1.16&&y>1.06&&y<1.15)c=nose;
 colors.set([c.r,c.g,c.b],i*3);
 }
 g.setAttribute('color',new BufferAttribute(colors,3));g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();mesh.material=new MeshStandardMaterial({color:'white',vertexColors:true,roughness:.92,flatShading:true});mesh.castShadow=mesh.receiveShadow=true;triangles+=p.count/3;
 });
 original.updateMatrixWorld(true);const box=new Box3().setFromObject(original,true),size=box.getSize(new Vector3()),scale=2.8/Math.max(size.x,size.y,size.z);original.scale.multiplyScalar(scale);original.position.set(-(box.min.x+box.max.x)*.5*scale,-box.min.y*scale,-(box.min.z+box.max.z)*.5*scale);
 root.animations=[];root.userData={kind:'photo-cat-sphynx-static-template',baseModel:'sphynx',triangleCount:triangles,attribution:{...SPHYNX_CAT_CREDIT},staticTemplate:true,rigged:false,animationAvailable:false,sourcePixelsEmbedded:false,stylizedFacePaint:true,photoColorSamples:samples,shapeControls:['headWidth','headHeight','bodyWidth','muzzleLength','earLength','earWidth','earSpread','skullDepth','cheekWidth','muzzleWidth'],templatePreserved:{sourceTriangles:false,indices:false,skeleton:false,animationTracks:false},limitations:['Static raised-paw pose. No animation or skeleton.','Decimation changes topology and reduces skin wrinkles. Source surface is not watertight.','Hairless source: fur-length control is intentionally unsupported.','Source units are unknown; use measured shoulder height independently of total mesh height.']};root.updateMatrixWorld(true);return root;
}
