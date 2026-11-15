// Six-control extremes: --shape-stress long|wide|hanging (writes separate reports)
// node scripts/check-photo-dog.mjs --url http://localhost:5176
// Actual UI file: --glb /path/dog.glb --model shiba-inu (or husky)
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {AnimationMixer,Box3,Texture,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {chromium} from 'playwright-core';
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const shapeCase=arg('--shape-stress');
assert.ok(shapeCase===null||['long','wide','hanging'].includes(shapeCase),'Shape stress case: long, wide or hanging');
const shapeStress=shapeCase==='hanging'?{earLength:3.5,earWidth:2.5,earSpread:1.6,skullDepth:1.5,cheekWidth:1.8,muzzleWidth:1.8}:shapeCase==='long'?{neckLength:.65,earLength:3.5,earWidth:.5,earSpread:1.6,skullDepth:1.5,cheekWidth:.6,muzzleWidth:.5}:shapeCase==='wide'?{neckLength:1.45,earLength:.5,earWidth:2.5,earSpread:.6,skullDepth:.6,cheekWidth:1.8,muzzleWidth:1.8}:{};
const directory='/tmp/photo-dog-validation';await mkdir(directory,{recursive:true});
const bytesArray=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const skins=root=>{const result=[];root.traverse(m=>{if(m.isSkinnedMesh)result.push(m);});return result;};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const reports=[];
let actualBytes=null,inferredModel=null;
if(arg('--glb')){
  actualBytes=await readFile(arg('--glb'));
  const document=JSON.parse(actualBytes.toString('utf8',20,20+actualBytes.readUInt32LE(12)));
  const source=document.nodes?.find(node=>node.extras?.kind==='photo-dog-original-template')?.extras?.source||'';
  inferredModel=/shepherd/i.test(source)?'german-shepherd':/pug/i.test(source)?'pug':/husky/i.test(source)?'husky':'shiba-inu';
}
const muzzle=arg('--muzzle')===null?1.17:Number(arg('--muzzle'));
assert.ok(Number.isFinite(muzzle)&&muzzle>=.2&&muzzle<=1.6,'Requested muzzle stress value in allowed range');
try{
  const page=await browser.newPage();await page.goto(arg('--url')||'http://localhost:5176');
  for(const model of arg('--glb')?[arg('--model')||inferredModel]:arg('--model')?[arg('--model')]:['shiba-inu','husky']){
    assert.ok(['shiba-inu','husky','pug','german-shepherd','jtoastie'].includes(model));
    const sourcePath=`public/models/${model==='jtoastie'?'cat':'dog'}/${model}.glb`,sourceBytes=await readFile(sourcePath),source=await new GLTFLoader().register(()=>({name:'SourceStructuralTextureStub',loadTexture:()=>Promise.resolve(new Texture())})).parseAsync(bytesArray(sourceBytes),'');
    let output,controlChecks;
    if(arg('--glb'))output=actualBytes;
    else{
      const generated=await page.evaluate(async ({baseModel,muzzle,shapeStress,shapeCase})=>{
        const createTemplateDog=baseModel==='jtoastie'?(await import('/demos/photo-cat/template-cat-breed.js')).createTemplateCatBreed:(await import('/demos/photo-cat/template-dog.js')).createTemplateDog;
        const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');
    let controlChecks;
    if(shapeCase){
      const keys=['earLength','earWidth','earSpread','skullDepth','cheekWidth','muzzleWidth',...(baseModel==='jtoastie'?['neckLength']:[])].filter(key=>baseModel!=='pug'||!key.startsWith('ear'));
      const neutralProfile={baseModel,species:baseModel==='jtoastie'?'cat':'dog',pattern:'bicolor',colors:{baseColor:'#39302a',secondaryColor:'#e9dcc4',eyeColor:'#60462b',noseColor:'#28201b'},shape:{}};
      const positions=root=>{const values=[];root.traverse(mesh=>{if(mesh.isSkinnedMesh)values.push(...mesh.geometry.attributes.position.array);});return values;};
      const omitted=positions(await createTemplateDog(neutralProfile));
      const explicit=positions(await createTemplateDog({...neutralProfile,shape:Object.fromEntries(keys.map(key=>[key,1]))}));
      if(omitted.length!==explicit.length||omitted.some((value,i)=>value!==explicit[i]))throw new Error('Explicit neutral controls must exactly match omitted controls');
      controlChecks={neutralMatchesOmitted:true,individual:{}};
      for(const key of keys){
        const changed=positions(await createTemplateDog({...neutralProfile,shape:{[key]:1.3}}));
        let affectedCoordinates=0,maxDisplacement=0;
        for(let i=0;i<omitted.length;i++){const delta=Math.abs(changed[i]-omitted[i]);if(delta>1e-7)affectedCoordinates++;maxDisplacement=Math.max(maxDisplacement,delta);}
        if(!affectedCoordinates)throw new Error(`Shape control ${key} does not affect geometry`);
        controlChecks.individual[key]={affectedCoordinates,maxDisplacement};
      }
    }
        if(baseModel==='jtoastie'){
          const coatProfile={baseModel,species:'cat',pattern:'bicolor',colors:{baseColor:'#39302a',secondaryColor:'#e9dcc4',eyeColor:'#60462b',noseColor:'#28201b'}};
          const {Color}=await import('/node_modules/three/build/three.module.js');const white=new Color(coatProfile.colors.secondaryColor);
          const inspectCoat=root=>{const positions=[],whiteVertexCounts=[];root.traverse(m=>{if(!m.isMesh)return;positions.push(...m.geometry.attributes.position.array);const c=m.geometry.attributes.color;let count=0;for(let i=0;i<c.count;i++)if(Math.abs(c.getX(i)-white.r)<1e-5&&Math.abs(c.getY(i)-white.g)<1e-5&&Math.abs(c.getZ(i)-white.b)<1e-5)count++;whiteVertexCounts.push(count);});return{positions,whiteVertices:whiteVertexCounts.reduce((a,b)=>a+b,0)};};
          const low=inspectCoat(await createTemplateDog({...coatProfile,shape:{whiteCoverage:.65}})),high=inspectCoat(await createTemplateDog({...coatProfile,shape:{whiteCoverage:1.45}}));
          if(JSON.stringify(low.positions)!==JSON.stringify(high.positions))throw Error('White coat coverage must not deform anatomy');
          if(!(high.whiteVertices>low.whiteVertices))throw Error('White coverage must increase authored white coat area');
          controlChecks??={};controlChecks.whiteCoverage={lowWhiteVertices:low.whiteVertices,highWhiteVertices:high.whiteVertices,geometryUnchanged:true};
        }
        let calls=0;
        const root=await createTemplateDog({baseModel,species:baseModel==='jtoastie'?'cat':'dog',pattern:'bicolor',colors:{baseColor:'#39302a',secondaryColor:'#e9dcc4',eyeColor:'#60462b',noseColor:'#28201b'},shape:{headWidth:1.22,headHeight:.93,muzzleLength:muzzle,earSize:1.45,earDrop:1,bodyWidth:1.12,furLength:1.15,...shapeStress},sampleFace:(u,v)=>{calls++;return u<.48?[50,40,30]:[220,210,190];}});
        const bytes=new Uint8Array(await new GLTFExporter().parseAsync(root,{binary:true,animations:root.animations,onlyVisible:false}));
        let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));
        return{base64:btoa(text),calls,declaredSamples:root.userData.photoColorSamples,controlChecks};
      },{baseModel:model,muzzle,shapeStress,shapeCase});
      controlChecks=generated.controlChecks;
      assert.equal(generated.calls,generated.declaredSamples,'Source sample metadata matches independently counted calls');
      if(model==='jtoastie')assert.ok(generated.calls>0&&generated.calls<=1024,'Face map uses a bounded coarse classification grid, not per-atlas-pixel sampling');
      else assert.equal(generated.calls,144,'Dog photograph consulted only for coarse fur classification');output=Buffer.from(generated.base64,'base64');
    }
    const fileStem=arg('--glb')?basename(arg('--glb'),'.glb'):`${model}-${shapeCase?`shape-${shapeCase}-`:''}stress-muzzle-${muzzle}`;
    const path=`${directory}/${fileStem}.glb`;await writeFile(path,output);output=await readFile(path);
    assert.equal(output.readUInt32LE(0),0x46546c67);
    const doc=JSON.parse(output.toString('utf8',20,20+output.readUInt32LE(12)));
    assert.equal(doc.buffers.length,1);assert.equal(doc.buffers[0].uri,undefined);
    assert.ok(doc.images?.length>0,'Authored coat atlas embedded');
    for(const image of doc.images){assert.equal(image.uri,undefined);assert.ok(Number.isInteger(image.bufferView));}
    // Structural decoder only; Chrome separately decodes actual atlas pixels.
    const loader=new GLTFLoader().register(()=>({name:'StructuralTextureStub',loadTexture(){return Promise.resolve(new Texture());}}));
    const result=await loader.parseAsync(bytesArray(output),'');
    let original=skins(source.scene);const modified=skins(result.scene),meta=result.scene.children[0].userData;
    const sourcePrimitiveCount=original.length;
    if(model==='jtoastie'&&original.length===1&&modified.length>1){
      const triangleKeys=meshes=>meshes.flatMap(mesh=>{const ix=mesh.geometry.index,keys=[];for(let i=0;i<ix.count;i+=3)keys.push([ix.getX(i),ix.getX(i+1),ix.getX(i+2)].join(','));return keys;}).sort();
      assert.deepEqual(triangleKeys(modified),triangleKeys(original),'Face material split retains every original ordered triangle exactly once');
      original=modified.map(()=>original[0]);
    }
    assert.equal(meta.stylizedFacePaint,true);assert.equal(meta.sourcePixelsEmbedded,false);
    let physicalSize;
    if(meta.physicalSize||arg('--height-cm')){
      assert.ok(meta.physicalSize,'Actual UI export includes physical-size metadata');
      result.scene.updateMatrixWorld(true);const size=new Box3().setFromObject(result.scene,true).getSize(new Vector3()),axis=meta.physicalSize.axis;
      const meters=axis==='longest'?Math.max(size.x,size.y,size.z):size[axis];
      if(arg('--height-cm')){assert.equal(axis,'y');assert.equal(meta.physicalSize.centimeters,Number(arg('--height-cm')));}
      assert.ok(Math.abs(meters-meta.physicalSize.centimeters/100)<2e-5,'Actual UI GLB bounding size agrees with selected centimeters');
      physicalSize={...meta.physicalSize,observedMeters:meters};
    }

    assert.equal(modified.length,original.length,'Same material primitive count');
    assert.equal(result.animations.length,source.animations.length,'All original clips preserved');
    const boneCount=new Set(original.flatMap(mesh=>mesh.skeleton.bones)).size;
    assert.equal(new Set(modified.flatMap(mesh=>mesh.skeleton.bones)).size,boneCount);
    let triangles=0,changedVertices=0,maxWeightError=0,minTriangleAreaRatio=Infinity,sourceVolume=0,modifiedVolume=0,normalRotationsOver90=0;
    const groups=new Map();
    source.scene.updateMatrixWorld(true);
    for(let m=0;m<original.length;m++){
      const a=original[m],b=modified[m],p=a.geometry.attributes.position,q=b.geometry.attributes.position;
      assert.equal(q.count,p.count);
      const expectedIndices=Array.from(a.geometry.index.array).filter((_,i)=>model!=='german-shepherd'||Math.floor(i/3)<1580||Math.floor(i/3)>=3586);
      if(model!=='jtoastie'||sourcePrimitiveCount===modified.length)assert.deepEqual(Array.from(b.geometry.index.array),expectedIndices,'Original index order retained; Shepherd excludes only verified separate backpack components');
      if(model==='german-shepherd')assert.equal(b.geometry.index.count/3,2892,'Body, eyes and brows retained');
      triangles+=b.geometry.index.count/3;
      assert.deepEqual(Array.from(b.geometry.attributes.skinIndex.array),Array.from(a.geometry.attributes.skinIndex.array));
      const va=new Vector3(),vb=new Vector3(),vc=new Vector3(),ta=new Vector3(),tb=new Vector3(),tc=new Vector3(),sourceNormal=new Vector3(),targetNormal=new Vector3();
      for(let i=0;i<b.geometry.index.count;i+=3){
        const ia=b.geometry.index.getX(i),ib=b.geometry.index.getX(i+1),ic=b.geometry.index.getX(i+2);
        va.fromBufferAttribute(p,ia);vb.fromBufferAttribute(p,ib);vc.fromBufferAttribute(p,ic);
        ta.fromBufferAttribute(q,ia);tb.fromBufferAttribute(q,ib);tc.fromBufferAttribute(q,ic);
        sourceVolume+=va.dot(new Vector3().crossVectors(vb,vc))/6;modifiedVolume+=ta.dot(new Vector3().crossVectors(tb,tc))/6;
        sourceNormal.crossVectors(vb.clone().sub(va),vc.clone().sub(va));targetNormal.crossVectors(tb.clone().sub(ta),tc.clone().sub(ta));
        const sourceArea=sourceNormal.length(),targetArea=targetNormal.length();
        if(sourceArea>1e-12){
          const ratio=targetArea/sourceArea;minTriangleAreaRatio=Math.min(minTriangleAreaRatio,ratio);
          assert.ok(targetArea>1e-12&&ratio>1e-6,'Morph does not collapse an originally nondegenerate triangle');
          if(sourceNormal.dot(targetNormal)<0)normalRotationsOver90++;
        }
      }
      const wa=a.geometry.attributes.skinWeight,wb=b.geometry.attributes.skinWeight;
      for(let i=0;i<wa.array.length;i++)maxWeightError=Math.max(maxWeightError,Math.abs(wa.array[i]-wb.array[i]));
      assert.ok(maxWeightError<1e-7);
      assert.deepEqual(b.skeleton.bones.map(bone=>bone.name),a.skeleton.bones.map(bone=>bone.name));
      for(let i=0;i<a.skeleton.bones.length;i++){
        assert.equal(b.skeleton.bones[i].parent?.isBone?b.skeleton.bones[i].parent.name:null,a.skeleton.bones[i].parent?.isBone?a.skeleton.bones[i].parent.name:null);
        a.skeleton.boneInverses[i].elements.forEach((v,j)=>assert.ok(Math.abs(v-b.skeleton.boneInverses[i].elements[j])<1e-5));
      }
      for(const attribute of ['position','normal','color','uv','skinWeight'])assert.ok(Array.from(b.geometry.attributes[attribute].array).every(Number.isFinite),`Finite ${attribute}`);
      for(let i=0;i<p.count;i++){
        assert.ok(Math.abs(wb.getX(i)+wb.getY(i)+wb.getZ(i)+wb.getW(i)-1)<1e-5);
        if(Math.hypot(q.getX(i)-p.getX(i),q.getY(i)-p.getY(i),q.getZ(i)-p.getZ(i))>1e-6)changedVertices++;
        // Group in common bind coordinates ACROSS material primitives. Merely
        // testing each primitive separately would miss coat/eye/nose seams.
        const point=new Vector3().fromBufferAttribute(p,i).applyMatrix4(a.bindMatrix),key=point.toArray().map(v=>Math.round(v/1e-5)).join(',');
        if(!groups.has(key))groups.set(key,[]);groups.get(key).push({mesh:m,vertex:i});
      }
    }
    assert.equal(triangles,{'husky':1920,'shiba-inu':1950,pug:644,'german-shepherd':2892,'jtoastie':1856}[model]);
    assert.equal(Math.sign(modifiedVolume),Math.sign(sourceVolume),'Whole surface signed orientation is retained');
    if(!arg('--glb'))assert.ok(changedVertices>0,'Morph/earDrop modifies original bind positions');
    for(let i=0;i<source.animations.length;i++){
      const a=source.animations[i],b=result.animations[i];assert.equal(b.name,a.name);assert.equal(b.duration,a.duration);assert.equal(b.tracks.length,a.tracks.length);
      for(let t=0;t<a.tracks.length;t++){
        assert.equal(b.tracks[t].name,a.tracks[t].name);assert.deepEqual(Array.from(b.tracks[t].times),Array.from(a.tracks[t].times));
        assert.equal(b.tracks[t].values.length,a.tracks[t].values.length);a.tracks[t].values.forEach((v,j)=>assert.ok(Math.abs(v-b.tracks[t].values[j])<1e-5));
      }
    }
    function motionReport(root,meshes,clips){
      const mixer=new AnimationMixer(root),a=new Vector3(),b=new Vector3(),initial=new Map();let maxSeparation=0,checks=0,crossPrimitiveChecks=0,maxMovement=0;
      const position=(entry,target)=>{const mesh=meshes[entry.mesh];mesh.applyBoneTransform(entry.vertex,target.fromBufferAttribute(mesh.geometry.attributes.position,entry.vertex));return target.applyMatrix4(mesh.matrixWorld);};
      for(const clip of clips){
        mixer.stopAllAction();for(const mesh of meshes)mesh.skeleton.pose();mixer.clipAction(clip).reset().play();
        for(const fraction of [0,.13,.37,.61,.89]){
          mixer.setTime(clip.duration*fraction);root.updateMatrixWorld(true);for(const mesh of meshes)mesh.skeleton.update();
          for(const [key,vertices] of groups){
            position(vertices[0],a);if(fraction===0)initial.set(key,a.clone());else maxMovement=Math.max(maxMovement,a.distanceTo(initial.get(key)));
            for(const vertex of vertices.slice(1)){position(vertex,b);maxSeparation=Math.max(maxSeparation,a.distanceTo(b));checks++;if(vertex.mesh!==vertices[0].mesh)crossPrimitiveChecks++;}
          }
        }
      }
      mixer.stopAllAction();return{maxSeparation,checks,crossPrimitiveChecks,maxMovement};
    }
    const sourceMotion=motionReport(source.scene,original,source.animations),modifiedMotion=motionReport(result.scene,modified,result.animations);
    assert.ok(modifiedMotion.checks>0,'Shared vertices exercised');
    if(original.length>1)assert.ok(modifiedMotion.crossPrimitiveChecks>0,'Shared vertices across material boundaries exercised');
    assert.ok(modifiedMotion.maxSeparation<1e-4,'Shared primitive boundaries remain joined across all clips and sampled poses');
    assert.ok(modifiedMotion.maxMovement>1e-4,'Animations move the exported dog');
    const texture=await page.evaluate(async base64=>{
      const THREE=await import('/node_modules/three/build/three.module.js'),{GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
      const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),gltf=await new GLTFLoader().parseAsync(data.buffer,'');
      const maps=new Map();gltf.scene.traverse(mesh=>{if(mesh.isMesh&&mesh.material.map)maps.set(mesh.material.map.uuid,mesh.material.map);});
      const palettes=[...maps.values()].map(map=>{const canvas=document.createElement('canvas');canvas.width=map.image.width;canvas.height=map.image.height;const context=canvas.getContext('2d');context.drawImage(map.image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data,set=new Set();for(let i=0;i<pixels.length;i+=4)if(pixels[i+3])set.add([pixels[i],pixels[i+1],pixels[i+2]].join(','));return{width:canvas.width,height:canvas.height,colors:[...set]};});
      const scene=new THREE.Scene();scene.add(gltf.scene,new THREE.HemisphereLight(0xffffff,0x444444,2));const box=new THREE.Box3().setFromObject(gltf.scene,true),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()).length(),camera=new THREE.PerspectiveCamera(42,1,.01,100);camera.position.copy(center).add(new THREE.Vector3(size*.8,size*.4,size));camera.lookAt(center);const renderer=new THREE.WebGLRenderer();renderer.setSize(256,256);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);const renderedTriangles=renderer.info.render.triangles;renderer.dispose();return{palettes,renderedTriangles};
    },output.toString('base64'));
    assert.equal(texture.renderedTriangles,triangles);assert.ok(texture.palettes.length>0);
    const declared=new Set(meta.facePaintPalette.map(hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(',')));
    for(const palette of texture.palettes){assert.ok(palette.width>0&&palette.height>0);assert.ok(palette.colors.length<=10);for(const rgb of palette.colors)assert.ok(declared.has(rgb),'Atlas contains only authored palette colors');}
    const evidence={physicalSize,sourcePrimitiveCount,model,shapeCase,shapeStress,controlChecks,muzzleStress:arg('--glb')?undefined:muzzle,input:arg('--glb')||'browser createTemplateDog',path,bytes:output.length,triangles,skinnedMeshes:modified.length,bones:boneCount,clips:result.animations.map(clip=>clip.name),changedVertices,maxWeightError,geometry:{minTriangleAreaRatio,sourceVolume,modifiedVolume,normalRotationsOver90,note:"Ear-fold normal rotations are reported, not treated as proof of local inversion; self-intersections are not exhaustively tested."},sourceMotion,modifiedMotion,texture,sourcePixelsEmbedded:meta.sourcePixelsEmbedded};
    reports.push(evidence);await writeFile(`${directory}/${fileStem}.report.json`,JSON.stringify(evidence,null,2));
  }
}finally{await browser.close();}
if(!arg('--glb')&&!shapeCase&&!arg('--model'))await writeFile(`${directory}/report.json`,JSON.stringify(reports,null,2));
if(!arg('--glb'))await writeFile(`${directory}/template-${arg('--model')?arg('--model')+'-':''}${shapeCase?`shape-${shapeCase}-`:''}stress-muzzle-${muzzle}-report.json`,JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));
