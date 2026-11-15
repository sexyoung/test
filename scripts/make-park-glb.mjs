// Offline original asset authoring. Generates real, self-contained GLBs; no
// geometry builders from this directory are included in the browser bundle.
import {mkdir,writeFile} from 'node:fs/promises';
import {Box3,BufferAttribute,Color,Group,Mesh,MeshStandardMaterial,Scene} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {createArchitecture} from './park/architecture.mjs';
import {createBotanical} from './park/botanical.mjs';
import {createLandscape} from './park/landscape.mjs';
import {makeLayout} from './park/layout.mjs';

globalThis.FileReader??=class{
  readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onload?.({target:this});this.onloadend?.({target:this});});}
  readAsDataURL(blob){blob.arrayBuffer().then(result=>{this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;this.onload?.({target:this});this.onloadend?.({target:this});});}
};
const out='public/models/park';await mkdir(out,{recursive:true});
const layout=makeLayout(),assets={landscape:createLandscape(layout),...createArchitecture(),...createBotanical()};
const manifest={version:1,title:'Sunlit Grove · Lakeside Garden',author:'Original project assets',assets:{},
  placements:layout.placements,route:layout.route,routeLength:layout.routeLength,lake:layout.lake,displayCat:layout.displayCat};
function bake(root,name){
  root.updateMatrixWorld(true);const groups=new Map();
  root.traverse(o=>{
    if(!o.isMesh)return;
    if(Array.isArray(o.material))throw new Error(`${name}/${o.name}: one material per authored mesh required`);
    const m=o.material,glow=m.name==='lantern-glow'||m.emissive?.getHex()>0;
    const role=o.userData.role||'solid';
    const key=name==='landscape'?o.name:glow?'lantern-glow':role.startsWith('foliage-')?role:'surface';
    let g=o.geometry.clone();if(g.index)g=g.toNonIndexed();g.applyMatrix4(o.matrixWorld);
    if(m.flatShading||!g.attributes.normal)g.computeVertexNormals();
    const n=g.attributes.position.count,colors=new Float32Array(n*3),original=g.attributes.color,c=m.color??new Color('white');
    for(let i=0;i<n;i++)colors.set([c.r*(original?original.getX(i):1),c.g*(original?original.getY(i):1),c.b*(original?original.getZ(i):1)],i*3);
    for(const attribute of Object.keys(g.attributes))if(!['position','normal'].includes(attribute))g.deleteAttribute(attribute);
    g.setAttribute('color',new BufferAttribute(colors,3));g.clearGroups();
    if(!groups.has(key))groups.set(key,{geometries:[],glow,water:m.name==='water',role});
    groups.get(key).geometries.push(g);
  });
  const baked=new Group();baked.name=name;baked.userData={author:'Original Sunlit Grove project asset',source:`scripts/park/${name==='landscape'?'landscape':['bridge','pavilion','bench','lantern','signpost','planter'].includes(name)?'architecture':'botanical'}.mjs`};
  for(const[key,{geometries,glow,water,role}]of groups){
    const g=mergeGeometries(geometries),m=new MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0});
    m.name=water?'water':glow?'lantern-glow':'matte-vertex-color';
    if(glow){m.emissive.set('#ffd6a0');m.emissiveIntensity=1;}
    const mesh=new Mesh(g,m);mesh.name=key;mesh.userData={role:water?'water':glow?'glow':role};baked.add(mesh);
  }
  return baked;
}
for(const[name,source]of Object.entries(assets)){
  const root=bake(source,name),scene=new Scene();scene.add(root);
  const bytes=Buffer.from(await new GLTFExporter().parseAsync(scene,{binary:true}));
  let triangles=0;root.traverse(o=>{if(o.isMesh)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});
  const bounds=new Box3().setFromObject(root),file=`${name}.glb`;
  await writeFile(`${out}/${file}`,bytes);
  manifest.assets[name]={file,triangles,bytes:bytes.length,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}};
  console.log(`${name}: ${triangles} triangles, ${Math.round(bytes.length/1024)} KiB`);
}
await writeFile(`${out}/manifest.json`,JSON.stringify(manifest));
await writeFile(`${out}/README.md`,`# Sunlit Grove — original GLB garden kit\n\nThese scene assets were authored for this project with the offline scripts in\n\`scripts/park/\` and exported by \`node scripts/make-park-glb.mjs\`. They are original\nproject geometry, not downloaded third-party models or exports of the previous park.\nThe separately supplied cat models retain their own attribution/license files.\n\nAll files are self-contained glTF 2.0 binary assets, Y-up, with meter-like scene units,\nexplicit normals, matte vertex colors, and no texture dependencies. Props have ground\norigins; landscape is in world coordinates. The lantern has a separate emissive pane\nmaterial. The landscape includes the lake surface; its moving water shader and the\nprocedural sky/stars are runtime effects.\n\nThe manifest contains bounds, triangle counts, byte lengths, placements and the cat\nroute. Models can be imported into Blender or another glTF editor. Run\n\`node scripts/check-park-assets.mjs\` after regenerating assets.\n`);
