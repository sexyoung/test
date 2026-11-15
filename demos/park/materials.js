import { MeshPhongMaterial, MeshDepthMaterial, RGBADepthPacking, Vector2 } from 'three';

// The same deformation is applied to visible geometry and its shadow pass.
export function addWind(material,time,kind,windStrength={value:1}){
  const tree=/^(oak|birch|goldenTree|pine)/.test(kind);
  const strength=tree?.015:kind==='shrub'?.12:.75;
  const declarations=`uniform float parkTime,parkWindStrength;
    float windHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float windNoise(vec2 p){
      vec2 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(windHash(cell),windHash(cell+vec2(1.,0.)),f.x),
        mix(windHash(cell+vec2(0.,1.)),windHash(cell+vec2(1.,1.)),f.x),f.y);
    }
    vec3 windPosition(vec3 p){
      vec3 root=instanceMatrix[3].xyz;
      vec3 world=(instanceMatrix*vec4(p,1.)).xyz;
      vec2 direction=normalize(vec2(1.,.43));
      // Advected, smooth gust fronts cross whole patches instead of making
      // every plant rock back and forth in a synchronized sine wave.
      vec2 field=world.xz*.085-direction*parkTime*.28;
      float gust=windNoise(field);
      float broad=windNoise(field*.43+vec2(5.7,-9.2));
      float phase=windHash(root.xz)*6.2831853;
      float flutter=sin(parkTime*3.3+phase+world.x*.6)*.11
        +sin(parkTime*5.1+phase*1.7+world.z*.8)*.055;
      float strength=clamp(parkWindStrength,0.,3.);
      float bend=(.12+.7*gust*gust+.3*broad+flutter*(.25+gust))*strength;
      float across=(windNoise(field+vec2(8.1,2.3))-.5)*.28*strength;
      float weight=pow(max(p.y,0.),${tree?'1.65':'1.65'});
      vec3 offset=vec3(direction.x*bend-direction.y*across,0.,direction.y*bend+direction.x*across)*weight*${strength};
      // Undo instance yaw AND scale: all plants lean in the same world wind,
      // even though every tuft is randomly rotated and sized in the manifest.
      vec3 xAxis=instanceMatrix[0].xyz,yAxis=instanceMatrix[1].xyz,zAxis=instanceMatrix[2].xyz;
      p+=vec3(dot(offset,xAxis)/dot(xAxis,xAxis),dot(offset,yAxis)/dot(yAxis,yAxis),dot(offset,zAxis)/dot(zAxis,zAxis));
      p.y-=min(max(p.y,0.)*.12,length(offset)*.12);
      return p;
    }\n`;
  const patch=shader=>{
    shader.uniforms.parkTime=time;shader.uniforms.parkWindStrength=windStrength;
    shader.vertexShader=declarations+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed=windPosition(transformed);');
  };
  material.onBeforeCompile=patch;material.customProgramCacheKey=()=>`park-wind-${kind}`;
  const depth=new MeshDepthMaterial({depthPacking:RGBADepthPacking});
  depth.onBeforeCompile=patch;depth.customProgramCacheKey=material.customProgramCacheKey;
  material.userData.windDepth=depth;
  material.userData.windStrength=windStrength;
}

export function createWaterMaterial(time,lake){
  const material=new MeshPhongMaterial({color:'#78b9c5',specular:'#49616a',shininess:180});
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{parkTime:time,lakeCenter:{value:new Vector2(lake.x,lake.z)},lakeRadius:{value:new Vector2(lake.rx,lake.rz)}});
    const common=`uniform float parkTime; uniform vec2 lakeCenter,lakeRadius;
      varying vec3 lakePosition;
      float shore(vec2 p){return length((p-lakeCenter)/lakeRadius);}
      float heightWave(vec2 p){return .035*sin(dot(p,vec2(1.8,.9))-parkTime*1.9)+.018*sin(dot(p,vec2(-1.1,2.7))-parkTime*1.35);}\n`;
    shader.vertexShader=common+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      transformed.y+=heightWave(position.xz)*(1.-smoothstep(.88,1.,shore(position.xz)));
      lakePosition=(modelMatrix*vec4(transformed,1.)).xyz;`);
    shader.fragmentShader=common+shader.fragmentShader
      .replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
        vec2 p=lakePosition.xz;
        float sx=.063*cos(dot(p,vec2(1.8,.9))-parkTime*1.9)-.0198*cos(dot(p,vec2(-1.1,2.7))-parkTime*1.35);
        float sz=.0315*cos(dot(p,vec2(1.8,.9))-parkTime*1.9)+.0486*cos(dot(p,vec2(-1.1,2.7))-parkTime*1.35);
        sx+=.025*cos(dot(p,vec2(7.1,4.3))+parkTime*2.4);
        sz+=.02*cos(dot(p,vec2(-5.3,8.1))-parkTime*2.1);
        vec3 waterNormal=normalize(vec3(-sx,1.,-sz));
        normal=normalize(mat3(viewMatrix)*waterNormal);`)
      .replace('#include <color_fragment>',`#include <color_fragment>
        float edge=shore(lakePosition.xz);
        float shallows=smoothstep(.62,1.,edge);
        float caustic=pow(max(0.,sin(lakePosition.x*3.4+parkTime*.6)*sin(lakePosition.z*4.2-parkTime*.45)),9.);
        diffuseColor.rgb*=mix(vec3(.24,.61,.72),vec3(.75,1.08,.92),shallows);
        diffuseColor.rgb+=diffuseColor.rgb*caustic*.3*shallows;`)
      .replace('#include <opaque_fragment>',`
        float facing=max(dot(waterNormal,normalize(cameraPosition-lakePosition)),0.);
        float fresnel=.08+.65*pow(1.-facing,4.);
        vec3 skyTint=diffuse*vec3(.8,1.08,1.2);
        outgoingLight=mix(outgoingLight*.72,skyTint,fresnel);
        float foamBand=1.-smoothstep(.012,.045,abs(shore(lakePosition.xz)-(.96+.012*sin(parkTime*1.5+lakePosition.x*2.))));
        float broken=smoothstep(.25,.8,sin(lakePosition.x*5.+lakePosition.z*3.-parkTime)*.5+.5);
        outgoingLight=mix(outgoingLight,diffuse*1.35,foamBand*broken*.55);
        #include <opaque_fragment>`);
  };
  return material;
}
