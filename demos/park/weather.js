import { BufferAttribute, BufferGeometry, Color, Group, LineSegments, Points, ShaderMaterial } from 'three';
import { createRandom } from '../../shared/math.js';

const MODES={
  sunny:{rain:0,snow:0,wind:1},
  cloudy:{rain:0,snow:0,wind:1.2},
  rain:{rain:2800,snow:0,wind:1.5},
  heavyRain:{rain:6500,snow:0,wind:2.25},
  snow:{rain:0,snow:3400,wind:.8},
};
// Same meadow profile as the GLB authoring source: precipitation wraps above the
// local ground/water rather than disappearing through a flat underground plane.
const groundGLSL=`
  float groundAt(vec2 p){
    float q=length((p-vec2(-3.))/vec2(8.5,5.7));
    float ground=.25+.22*sin(p.x*.105)*cos(p.y*.13)+.12*sin(p.y*.21+p.x*.09)
      +smoothstep(23.,55.,length(p))*(1.5+1.1*sin(p.x*.06+p.y*.045))
      -1.9*(1.-smoothstep(.78,1.18,q));
    return q<1.?max(ground,-.24):ground;
  }
`;

export function createWeather(scene,{timeUniform}) {
  const root=new Group();root.name='weather';scene.add(root);
  const rainUniforms={parkTime:timeUniform,storm:{value:0},tint:{value:new Color('#b2c9d7')}};
  const snowUniforms={parkTime:timeUniform,tint:{value:new Color('#edf4ff')},pixelRatio:{value:1}};
  const random=createRandom(86721),rainPositions=[],rainEnds=[],snowPositions=[],snowPhases=[];
  for(let i=0;i<6500;i++){
    const p=[(random()-.5)*112,random()*32,(random()-.5)*112];
    rainPositions.push(...p,...p);rainEnds.push(0,1);
  }
  for(let i=0;i<3400;i++){
    snowPositions.push((random()-.5)*112,random()*32,(random()-.5)*112);
    snowPhases.push(random()*Math.PI*2);
  }
  const rainGeometry=new BufferGeometry();
  rainGeometry.setAttribute('position',new BufferAttribute(new Float32Array(rainPositions),3));
  rainGeometry.setAttribute('end',new BufferAttribute(new Float32Array(rainEnds),1));
  const rain=new LineSegments(rainGeometry,new ShaderMaterial({
    uniforms:rainUniforms,transparent:true,depthWrite:false,
    vertexShader:`
      uniform float parkTime,storm; attribute float end; varying float opacity;
      ${groundGLSL}
      void main(){
        float speed=mix(13.,20.,storm);
        vec3 p=position;
        p.x=mod(p.x+56.+parkTime*mix(1.5,4.,storm),112.)-56.;
        p.z=mod(p.z+56.+parkTime*.6,112.)-56.;
        float height=mod(p.y-parkTime*speed,32.);
        p.y=groundAt(p.xz)+height;
        p+=vec3(-mix(.1,.26,storm),mix(.65,1.2,storm),-.025)*end;
        vec4 view=modelViewMatrix*vec4(p,1.);
        opacity=(1.-smoothstep(45.,90.,-view.z))*smoothstep(0.,.45,height)*mix(.34,.5,storm);
        gl_Position=projectionMatrix*view;
      }`,
    fragmentShader:`uniform vec3 tint; varying float opacity;
      void main(){gl_FragColor=vec4(tint,opacity);#include <colorspace_fragment>}`.replace(';#include',';\n#include'),
  }));
  rain.name='rain';rain.frustumCulled=false;rain.renderOrder=4;root.add(rain);
  const snowGeometry=new BufferGeometry();
  snowGeometry.setAttribute('position',new BufferAttribute(new Float32Array(snowPositions),3));
  snowGeometry.setAttribute('phase',new BufferAttribute(new Float32Array(snowPhases),1));
  const snow=new Points(snowGeometry,new ShaderMaterial({
    uniforms:snowUniforms,transparent:true,depthWrite:false,
    vertexShader:`
      uniform float parkTime,pixelRatio;attribute float phase;varying float opacity;
      ${groundGLSL}
      void main(){
        vec3 p=position;
        p.x=mod(p.x+56.+parkTime*.4+sin(parkTime*.65+phase)*1.1,112.)-56.;
        p.z=mod(p.z+56.+sin(parkTime*.4+phase*2.)*.8,112.)-56.;
        float height=mod(p.y-parkTime*(.8+.35*sin(phase)),32.);
        p.y=groundAt(p.xz)+height;
        vec4 view=modelViewMatrix*vec4(p,1.);
        opacity=(1.-smoothstep(45.,95.,-view.z))*smoothstep(0.,.25,height)*.85;
        gl_PointSize=clamp((85.+35.*sin(phase))/max(-view.z,1.),1.4,7.)*pixelRatio;
        gl_Position=projectionMatrix*view;
      }`,
    fragmentShader:`uniform vec3 tint;varying float opacity;
      void main(){
        vec2 p=gl_PointCoord-.5;
        float hex=max(abs(p.x),max(abs(.5*p.x+.866*p.y),abs(.5*p.x-.866*p.y)));
        float flake=1.-smoothstep(.31,.46,hex);
        gl_FragColor=vec4(tint,opacity*flake);
        #include <colorspace_fragment>
      }`,
  }));
  snow.name='snowfall';snow.frustumCulled=false;snow.renderOrder=4;root.add(snow);
  let mode='sunny',detail='high';
  const white=new Color('#eef4ff');
  function refresh(){
    const config=MODES[mode],density=detail==='low'?.4:detail==='medium'?.7:1;
    rain.visible=config.rain>0;snow.visible=config.snow>0;
    rainGeometry.setDrawRange(0,Math.floor(config.rain*density)*2);
    snowGeometry.setDrawRange(0,Math.floor(config.snow*density));
    rainUniforms.storm.value=mode==='heavyRain'?1:0;
  }
  refresh();
  return {
    setWeather(value){mode=Object.hasOwn(MODES,value)?value:'sunny';refresh();},
    setDetail(value){detail=value;refresh();},
    update(camera,dt){
      // Positions are derived entirely from the shared simulation clock: pause
      // and reduced-motion stop every drop without maintaining CPU particle state.
      snowUniforms.pixelRatio.value=Math.min(globalThis.devicePixelRatio||1,1.75);
      rainUniforms.tint.value.copy(scene.fog.color).lerp(white,.32);
      snowUniforms.tint.value.copy(scene.fog.color).lerp(white,.72);
    },
    get mode(){return mode;}, get windStrength(){return MODES[mode].wind;},
    get particleCount(){return rain.visible?rainGeometry.drawRange.count/2:snow.visible?snowGeometry.drawRange.count:0;},
  };
}
