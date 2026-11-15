import {
  BackSide, BufferAttribute, BufferGeometry, Color, Group, Mesh, Points,
  ShaderMaterial, SphereGeometry, Vector3,
} from 'three';
import { createRandom } from '../../shared/math.js';

const PRESETS = {
  day: { top:'#258be0', horizon:'#a7d7f2', cloud:'#ffffff', fog:'#c3deeb',
    skyLight:'#d3edff', ground:'#88926b', ambient:1.6, light:'#fff4d6', intensity:2.4,
    direction:[-.55,.7,-.65], water:'#78b9c5', stars:0, clouds:1, disk:1 },
  dusk: { top:'#51588d', horizon:'#efb17c', cloud:'#f9c1a0', fog:'#bd9a91',
    skyLight:'#b5a3d5', ground:'#71614f', ambient:1.5, light:'#ff9f53', intensity:2.5,
    direction:[-.58,.035,-.8], water:'#937f99', stars:.06, clouds:.65, disk:1 },
  night: { top:'#050b23', horizon:'#101c38', cloud:'#344461', fog:'#1b2e47',
    skyLight:'#a3bfee', ground:'#303952', ambient:.65, light:'#b9ceff', intensity:.65,
    direction:[-.4,.65,-.6], water:'#172f4d', stars:1, clouds:.06, disk:0 },
};

const WEATHER = {
  sunny:{cover:0,tint:0,direct:1,ambient:1,stars:1,far:108,near:42},
  cloudy:{cover:.86,tint:.64,direct:.38,ambient:.9,stars:.15,far:96,near:35},
  rain:{cover:.96,tint:.8,direct:.2,ambient:.78,stars:.03,far:83,near:28},
  heavyRain:{cover:1,tint:.94,direct:.09,ambient:.62,stars:0,far:64,near:18},
  snow:{cover:.9,tint:.68,direct:.32,ambient:.94,stars:.08,far:78,near:25},
};

// One sky draw and one star draw. Camera-relative geometry keeps the sky distant
// under orbit/zoom; neither layer casts shadows or needs a reflection render.
export function createSky(scene, { sun, hemisphere, water }) {
  const uniforms = {
    topColor:{value:new Color()}, horizonColor:{value:new Color()}, cloudColor:{value:new Color()},
    sunColor:{value:new Color()}, sunDirection:{value:new Vector3()},
    cloudAmount:{value:1}, sunAmount:{value:1}, nightAmount:{value:0}, clock:{value:0}, overcast:{value:0},
  };
  const material = new ShaderMaterial({
    side:BackSide, depthWrite:false, depthTest:false, uniforms,
    vertexShader:`varying vec3 skyDirection;
      void main(){ skyDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader:`
      varying vec3 skyDirection;
      uniform vec3 topColor, horizonColor, cloudColor, sunColor, sunDirection;
      uniform float cloudAmount, sunAmount, nightAmount, clock, overcast;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
      float fbm(vec2 p){return .57*noise(p)+.28*noise(p*2.03)+.15*noise(p*4.07);}
      void main(){
        vec3 d=normalize(skyDirection);
        float elevation=max(d.y,0.);
        vec3 col=mix(horizonColor,topColor,pow(smoothstep(0.,.38,elevation),.65));
        float sunDot=dot(d,normalize(sunDirection));
        float glow=pow(max(sunDot,0.),42.)*.38;
        float disk=smoothstep(cos(.037),cos(.033),sunDot);
        col+=sunColor*(glow+disk*1.8)*sunAmount;
        vec2 cloudUV=d.xz/max(d.y+.22,.07)*1.3+vec2(clock*.008,clock*.002);
        float cloud=smoothstep(.49-overcast*.34,.69-overcast*.24,fbm(cloudUV));
        cloud=mix(cloud,.68+.32*fbm(cloudUV*.55),overcast)*smoothstep(-.04,.06,d.y)*cloudAmount;
        col=mix(col,cloudColor,cloud*.92);
        // A soft, irregular band behind individual stars suggests a deep sky.
        float band=exp(-pow((d.x*.45+d.y*.3-d.z*.55-.12)*5.,2.));
        float dust=fbm(d.xz*7.+d.y*3.);
        col+=vec3(.055,.055,.11)*band*dust*nightAmount*smoothstep(0.,.2,d.y);
        gl_FragColor=vec4(col,1.);
        #include <colorspace_fragment>
      }`,
  });
  const dome=new Mesh(new SphereGeometry(140,32,16),material);dome.name='sky-dome';dome.renderOrder=-20;dome.frustumCulled=false;
  const random=createRandom(7193), count=8000, positions=[], sizes=[], phases=[];
  for(let i=0;i<count;i++) {
    const y=-.15+random()*1.15,a=random()*Math.PI*2,r=Math.sqrt(1-y*y);
    positions.push(125*r*Math.cos(a),125*y,125*r*Math.sin(a));
    sizes.push(1.15+Math.pow(random(),5)*2.5);phases.push(random()*Math.PI*2);
  }
  const starsGeometry=new BufferGeometry();
  starsGeometry.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));
  starsGeometry.setAttribute('size',new BufferAttribute(new Float32Array(sizes),1));
  starsGeometry.setAttribute('phase',new BufferAttribute(new Float32Array(phases),1));
  const starUniforms={amount:uniforms.nightAmount,clock:uniforms.clock,pixelRatio:{value:1}};
  const stars=new Points(starsGeometry,new ShaderMaterial({
    uniforms:starUniforms,transparent:true,depthWrite:false,depthTest:true,
    vertexShader:`attribute float size,phase; uniform float pixelRatio; varying float sparkle;
      void main(){sparkle=phase; gl_PointSize=size*pixelRatio;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform float amount,clock; varying float sparkle;
      void main(){float circle=1.-smoothstep(.15,.5,length(gl_PointCoord-.5));
        vec3 tint=mix(vec3(.67,.8,1.),vec3(1.,.91,.75),sin(sparkle)*.5+.5);
        gl_FragColor=vec4(tint,circle*amount*(.78+.22*sin(clock*.55+sparkle)));
        #include <colorspace_fragment>
      }`,
  }));
  stars.name='stars';stars.frustumCulled=false;stars.renderOrder=-19;
  const group=new Group();group.add(dome,stars);scene.add(group);
  const target={};let selected='day',weather='sunny',remaining=0;
  const colors=['top','horizon','cloud','fog','skyLight','ground','light','water'];
  function retarget(immediate=false) {
    const p=PRESETS[selected],w=WEATHER[weather];
    const brightness=selected==='night'?.055:selected==='dusk'?.46:1;
    const wet=weather==='heavyRain'?'#596c7d':weather==='snow'?'#b8c7d0':'#8a9ba8';
    const weatherColor=new Color(wet).multiplyScalar(brightness);
    for(const key of colors) target[key]=new Color(p[key]);
    for(const key of ['top','horizon','fog','skyLight'])target[key].lerp(weatherColor,w.tint);
    target.cloud.lerp(new Color(weather==='heavyRain'?'#8a949e':'#ccd3d7').multiplyScalar(brightness),w.tint);
    target.water.lerp(weatherColor,.5*w.tint);
    Object.assign(target,{ambient:p.ambient*w.ambient,intensity:p.intensity*w.direct,
      stars:p.stars*w.stars,clouds:Math.max(p.clouds,w.cover*.65),disk:p.disk*w.direct,
      overcast:w.cover,fogNear:w.near,fogFar:w.far,direction:new Vector3(...p.direction).normalize()});
    remaining=immediate?0:1.4;
    if(immediate)apply(1);
  }
  function select(mode,immediate=false) {
    selected=Object.hasOwn(PRESETS,mode)?mode:'day';retarget(immediate);
  }
  function setWeather(mode,immediate=false) {
    weather=Object.hasOwn(WEATHER,mode)?mode:'sunny';retarget(immediate);
  }
  function apply(k) {
    uniforms.topColor.value.lerp(target.top,k);uniforms.horizonColor.value.lerp(target.horizon,k);
    uniforms.cloudColor.value.lerp(target.cloud,k);uniforms.sunColor.value.lerp(target.light,k);
    uniforms.sunDirection.value.lerp(target.direction,k);
    for(const [uniform,key] of [['overcast','overcast'],['nightAmount','stars'],['cloudAmount','clouds'],['sunAmount','disk']]) uniforms[uniform].value+=(target[key]-uniforms[uniform].value)*k;
    scene.fog.color.lerp(target.fog,k);scene.background.copy(scene.fog.color);
    scene.fog.near+=(target.fogNear-scene.fog.near)*k;scene.fog.far+=(target.fogFar-scene.fog.far)*k;
    hemisphere.color.lerp(target.skyLight,k);hemisphere.groundColor.lerp(target.ground,k);
    hemisphere.intensity+=(target.ambient-hemisphere.intensity)*k;
    sun.color.lerp(target.light,k);sun.intensity+=(target.intensity-sun.intensity)*k;
    sun.position.copy(uniforms.sunDirection.value).multiplyScalar(65).add(sun.target.position);
    water.color.lerp(target.water,k);
  }
  select('day',true);
  return {
    select,setWeather,
    update(camera,dt,time,pixelRatio) {
      if(remaining>0){const step=Math.min(dt,remaining);apply(step/remaining);remaining-=step;}
      group.position.copy(camera.position);uniforms.clock.value=time;starUniforms.pixelRatio.value=pixelRatio;
    },
    get mode(){return selected;}, get weather(){return weather;}, get transitioning(){return remaining>0;},
  };
}
