import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh,
  MeshLambertMaterial, ShaderMaterial, Vector3,
} from 'three';
import { buildMountainRange } from './mountain-range.js';
import { createWaterfallSpray } from './waterfall-spray.js';

export function createBackdrop(scene,{timeUniform}) {
  const root=new Group();root.name='mountain-backdrop';scene.add(root);
  const {geometry,falls}=buildMountainRange();
  const haze={value:scene.fog.color.clone()},weatherHaze={value:.16},daylight={value:1};
  const material=new MeshLambertMaterial({vertexColors:true,fog:false,side:DoubleSide});
  material.onBeforeCompile=shader=>{
    shader.uniforms.mountainHaze=haze;shader.uniforms.weatherHaze=weatherHaze;
    shader.vertexShader='varying float mountainDistance;\n'+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nmountainDistance=length(mvPosition.xyz);');
    shader.fragmentShader='uniform vec3 mountainHaze;uniform float weatherHaze;varying float mountainDistance;\n'+shader.fragmentShader.replace('#include <opaque_fragment>',`outgoingLight=mix(outgoingLight,mountainHaze,clamp(weatherHaze+smoothstep(110.,410.,mountainDistance)*.48,.12,.9));\n#include <opaque_fragment>`);
  };
  const mountains=new Mesh(geometry,material);mountains.name='distant-mountains';root.add(mountains);
  const positions=[],uvs=[],foamPositions=[],foamUV=[],basins=[];
  function tri(a,b,c,uv,target=positions,tex=uvs){target.push(...a.toArray(),...b.toArray(),...c.toArray());tex.push(...uv.flat());}
  for(const [fallIndex,fall] of falls.entries()){
    const path=fall.path.map(p=>p.clone?p.clone():new Vector3(...p));
    const distances=[0];
    for(let i=1;i<path.length;i++)distances.push(distances[i-1]+path[i].distanceTo(path[i-1]));
    const length=distances.at(-1);
    const tangent=new Vector3(-Math.sin(fall.angle),0,Math.cos(fall.angle));
    // Connected ribbon from the headwater, over each rock shelf, to the basin.
    // Irregular banks and small independent strands break up a rectangular sheet.
    for(let strand=0;strand<3;strand++){
      const offset=strand===0?0:strand===1?-1.5:1.6;
      for(let i=0;i<path.length-1;i++){
        const a=path[i],b=path[i+1],v0=distances[i]/length,v1=distances[i+1]/length;
        const width=(v)=>(strand===0?1.1+v*.9+Math.sin(v*19+fallIndex)*.22:.2+.1*Math.sin(v*12))*(fall.width/2.2);
        const p0=a.clone().addScaledVector(tangent,offset+Math.sin(v0*16+strand)*.16);
        const p1=b.clone().addScaledVector(tangent,offset+Math.sin(v1*16+strand)*.16);
        // Raise the water slightly away from its rock bed; the source is built
        // from the same terrain samples, so the ribbon never floats in mid-air.
        p0.y+=.24+strand*.025;p1.y+=.24+strand*.025;
        const l0=p0.clone().addScaledVector(tangent,-width(v0)),r0=p0.clone().addScaledVector(tangent,width(v0));
        const l1=p1.clone().addScaledVector(tangent,-width(v1)),r1=p1.clone().addScaledVector(tangent,width(v1));
        tri(l0,r0,r1,[[0,v0],[1,v0],[1,v1]]);tri(l0,r1,l1,[[0,v0],[1,v1],[0,v1]]);
      }
    }
    const basin=path.at(-1).clone();basin.y+=.28;basins.push(basin);
    for(let i=0;i<20;i++){
      const a=i/20*Math.PI*2,b=(i+1)/20*Math.PI*2;
      const radius=5.5+Math.sin(a*3+fallIndex)*.55;
      const pa=basin.clone().add(new Vector3(Math.cos(a)*radius,0,Math.sin(a)*radius*.72));
      const pb=basin.clone().add(new Vector3(Math.cos(b)*radius,0,Math.sin(b)*radius*.72));
      tri(basin,pb,pa,[[.5,.5],[.5+Math.cos(b)*.5,.5+Math.sin(b)*.5],[.5+Math.cos(a)*.5,.5+Math.sin(a)*.5]],foamPositions,foamUV);
    }
  }
  const shared={parkTime:timeUniform,haze,weatherHaze,daylight};
  function waterMesh(vertices,uv,foam){
    const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(new Float32Array(vertices),3));g.setAttribute('uv',new BufferAttribute(new Float32Array(uv),2));
    const m=new ShaderMaterial({side:DoubleSide,transparent:true,depthWrite:false,uniforms:{...shared,foam:{value:foam?1:0}},
      vertexShader:`varying vec2 flowUV;void main(){flowUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`uniform float parkTime,daylight,weatherHaze,foam;uniform vec3 haze;varying vec2 flowUV;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
        void main(){
          // Increasing V runs downhill. Features advect toward the basin.
          vec2 q=vec2(flowUV.x*8.,flowUV.y*21.-parkTime*2.6);
          float streak=noise(q)+.35*noise(q*2.8+8.);
          float edge=smoothstep(0.,.13,flowUV.x)*(1.-smoothstep(.85,1.,flowUV.x));
          float alpha=edge*(.55+.32*streak);
          float highlight=smoothstep(.2,1.15,streak);
          if(foam>.5){
            float r=length(flowUV-.5)*2.;
            float ripple=.5+.5*sin(r*32.-parkTime*4.+noise(flowUV*17.)*3.);
            alpha=(1.-smoothstep(.35,1.,r))*(.42+.32*ripple);
            highlight=.65+.35*ripple;
          }
          vec3 color=mix(vec3(.25,.52,.59),vec3(.9,.97,.98),highlight)*daylight;
          color=mix(color,haze,weatherHaze*.65);
          gl_FragColor=vec4(color,alpha);
          #include <colorspace_fragment>
        }`,
    });
    const mesh=new Mesh(g,m);mesh.name=foam?'waterfall-foam':'waterfalls';mesh.renderOrder=1;root.add(mesh);
  }
  waterMesh(positions,uvs,false);waterMesh(foamPositions,foamUV,true);
  const spray=createWaterfallSpray(root,{timeUniform,basins,haze,daylight});
  let selected='sunny';
  return {
    setWeather(mode){selected=mode;weatherHaze.value={sunny:.13,cloudy:.28,rain:.4,heavyRain:.58,snow:.38}[mode]??.13;},
    setDetail(level){spray.setDetail?.(level);},
    update(){
      haze.value.copy(scene.fog.color);
      const light=scene.children.find(o=>o.isHemisphereLight);
      const luminance=light?(light.color.r+light.color.g+light.color.b)/3*light.intensity:1;
      daylight.value=Math.max(.1,Math.min(1,luminance*1.1));
    },
    get weather(){return selected;},
    stats:{mountainTriangles:geometry.attributes.position.count/3,waterfallTriangles:positions.length/9,waterfalls:falls.length,spray:spray.stats},
  };
}
