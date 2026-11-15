import {
  BufferAttribute, Color, DoubleSide, InstancedBufferAttribute,
  InstancedBufferGeometry, Mesh, ShaderMaterial, TetrahedronGeometry,
} from 'three';
import { createRandom } from '../../shared/math.js';

// Local basin coordinates are shared with the actual waterfall geometry.
// Two GPU-instanced draws animate entirely from the park simulation clock.
export function createWaterfallSpray(parent,{
  timeUniform,basins,haze={value:new Color('#b8cbd2')},daylight={value:1},
}) {
  const centers=basins.map(basin=>Array.isArray(basin)?basin:basin.toArray());
  const random=createRandom(47192);
  const uniforms={parkTime:timeUniform,haze,daylight};
  const dropletTemplate=new TetrahedronGeometry(1,0);
  const dropletGeometry=new InstancedBufferGeometry();
  dropletGeometry.setAttribute('position',dropletTemplate.attributes.position.clone());
  dropletGeometry.setAttribute('normal',dropletTemplate.attributes.normal.clone());
  dropletTemplate.dispose();
  const dropCenters=[],dropVelocity=[],dropPhase=[],dropSize=[];
  // Interleave basins so lower detail still distributes spray to every fall.
  for(let particle=0;particle<60;particle++)for(const center of centers){
    const angle=random()*Math.PI*2,speed=.7+random()*1.6;
    dropCenters.push(center[0]+(random()-.5)*2.3,center[1]+.15,center[2]+(random()-.5)*1.8);
    dropVelocity.push(Math.cos(angle)*speed,6.2+random()*4.5,Math.sin(angle)*speed);
    dropPhase.push(random()*10);dropSize.push(.13+random()*.2);
  }
  dropletGeometry.setAttribute('sprayCenter',new InstancedBufferAttribute(new Float32Array(dropCenters),3));
  dropletGeometry.setAttribute('sprayVelocity',new InstancedBufferAttribute(new Float32Array(dropVelocity),3));
  dropletGeometry.setAttribute('sprayPhase',new InstancedBufferAttribute(new Float32Array(dropPhase),1));
  dropletGeometry.setAttribute('spraySize',new InstancedBufferAttribute(new Float32Array(dropSize),1));
  const dropletMaterial=new ShaderMaterial({
    transparent:true,depthWrite:false,uniforms,
    vertexShader:`
      uniform float parkTime;
      attribute vec3 sprayCenter,sprayVelocity;
      attribute float sprayPhase,spraySize;
      varying float sprayAlpha,facetLight;
      void main(){
        float life=2.*sprayVelocity.y/9.8;
        float age=mod(parkTime+sprayPhase,life);
        float progress=age/life;
        vec3 center=sprayCenter+sprayVelocity*age-vec3(0.,4.9*age*age,0.);
        vec3 shape=position*spraySize*vec3(.65,1.25,.65);
        float spin=sprayPhase+age*2.1;
        mat2 turn=mat2(cos(spin),-sin(spin),sin(spin),cos(spin));
        shape.xy=turn*shape.xy;
        vec3 faceNormal=normal;faceNormal.xy=turn*faceNormal.xy;
        vec3 vertex=center+shape;
        sprayAlpha=smoothstep(0.,.09,progress)*(1.-smoothstep(.78,1.,progress));
        facetLight=.68+.32*max(dot(faceNormal,normalize(vec3(-.3,.8,.4))),0.);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(vertex,1.);
      }`,
    fragmentShader:`
      uniform vec3 haze;
      uniform float daylight;
      varying float sprayAlpha,facetLight;
      void main(){
        vec3 color=mix(vec3(.66,.86,.95)*facetLight*daylight,haze,.26);
        gl_FragColor=vec4(color,sprayAlpha*.8);
        #include <colorspace_fragment>
      }`,
  });
  const droplets=new Mesh(dropletGeometry,dropletMaterial);
  droplets.name='waterfall-splash-droplets';droplets.frustumCulled=false;droplets.renderOrder=4;
  parent.add(droplets);

  const mistGeometry=new InstancedBufferGeometry(),hex=[];
  for(let side=0;side<6;side++){
    const a=side/6*Math.PI*2,b=(side+1)/6*Math.PI*2;
    hex.push(0,0,0,Math.cos(a),Math.sin(a),0,Math.cos(b),Math.sin(b),0);
  }
  mistGeometry.setAttribute('position',new BufferAttribute(new Float32Array(hex),3));
  const mistCenters=[],mistPhase=[],mistSize=[],mistDrift=[];
  for(let particle=0;particle<12;particle++)for(const center of centers){
    mistCenters.push(center[0]+(random()-.5)*3,center[1]+.4,center[2]+(random()-.5)*2);
    mistPhase.push(random()*8);mistSize.push(2.1+random()*1.7);
    mistDrift.push((random()-.5)*2,.9+random()*1.1,(random()-.5)*1.6);
  }
  mistGeometry.setAttribute('mistCenter',new InstancedBufferAttribute(new Float32Array(mistCenters),3));
  mistGeometry.setAttribute('mistDrift',new InstancedBufferAttribute(new Float32Array(mistDrift),3));
  mistGeometry.setAttribute('mistPhase',new InstancedBufferAttribute(new Float32Array(mistPhase),1));
  mistGeometry.setAttribute('mistSize',new InstancedBufferAttribute(new Float32Array(mistSize),1));
  const mistMaterial=new ShaderMaterial({
    transparent:true,depthWrite:false,side:DoubleSide,uniforms,
    vertexShader:`
      uniform float parkTime;
      attribute vec3 mistCenter,mistDrift;
      attribute float mistPhase,mistSize;
      varying vec2 mistUV;
      varying float mistAlpha;
      void main(){
        float age=fract((parkTime+mistPhase)/5.5);
        vec3 center=mistCenter+mistDrift*age;
        center.x+=sin(parkTime*.65+mistPhase)*.32;
        vec4 viewCenter=modelViewMatrix*vec4(center,1.);
        // Polygonal billboards have a fixed world size, unlike inflated points.
        viewCenter.xy+=position.xy*mistSize*(.7+age*.35);
        mistUV=position.xy;
        mistAlpha=smoothstep(0.,.2,age)*(1.-smoothstep(.65,1.,age));
        gl_Position=projectionMatrix*viewCenter;
      }`,
    fragmentShader:`
      uniform vec3 haze;
      uniform float daylight;
      varying vec2 mistUV;
      varying float mistAlpha;
      void main(){
        // A soft interior still respects the six-sided low-poly boundary.
        float edge=1.-smoothstep(.08,1.,dot(mistUV,mistUV));
        float facet=.94+.06*step(0.,mistUV.x-mistUV.y*.5);
        vec3 color=mix(vec3(.84,.93,.98)*daylight*facet,haze,.36);
        gl_FragColor=vec4(color,edge*mistAlpha*.15);
        #include <colorspace_fragment>
      }`,
  });
  const mist=new Mesh(mistGeometry,mistMaterial);
  mist.name='waterfall-basin-mist';mist.frustumCulled=false;mist.renderOrder=3;
  parent.add(mist);
  function setDetail(level){
    const dropCount=level==='low'?24:level==='medium'?42:60;
    const puffCount=level==='low'?6:level==='medium'?9:12;
    dropletGeometry.instanceCount=centers.length*dropCount;
    mistGeometry.instanceCount=centers.length*puffCount;
    droplets.visible=mist.visible=centers.length>0;
  }
  setDetail('high');
  return {
    setDetail,
    get stats(){return{basins:centers.length,droplets:dropletGeometry.instanceCount,mistPuffs:mistGeometry.instanceCount,draws:centers.length?2:0};},
  };
}
