// An opaque carpet fills the spaces between nearby GLB grass tufts. It costs no
// extra draw call or transparent layers, and filters to an even turf at distance.
export function attachMeadow(material,{timeUniform,windStrength={value:1},snowAmount={value:0}}){
  const previousCompile=material.onBeforeCompile;
  const previousKey=material.customProgramCacheKey.bind(material);
  const baseKey=previousKey();
  material.onBeforeCompile=function(shader,renderer){
    previousCompile.call(this,shader,renderer);
    shader.uniforms.meadowTime=timeUniform;
    shader.uniforms.meadowWind=windStrength;
    shader.uniforms.meadowSnow=snowAmount;
    shader.vertexShader='varying vec3 meadowPosition;\n'+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      meadowPosition=(modelMatrix*vec4(transformed,1.)).xyz;`);
    shader.fragmentShader=`
      varying vec3 meadowPosition;
      uniform float meadowTime,meadowWind,meadowSnow;
      float meadowHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float meadowNoise(vec2 p){
        vec2 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(meadowHash(cell),meadowHash(cell+vec2(1.,0.)),f.x),
          mix(meadowHash(cell+vec2(0.,1.)),meadowHash(cell+vec2(1.,1.)),f.x),f.y);
      }
      float meadowBlades(vec2 p,float breeze){
        vec2 cell=floor(p),f=fract(p)-.5;
        float seed=meadowHash(cell);
        float height=.65+.27*seed;
        float along=(f.y+.46)/height;
        float center=(seed-.5)*.3+along*along*(.14+breeze*.16);
        float width=mix(.14,.012,clamp(along,0.,1.));
        float aa=max(fwidth(p.x),fwidth(p.y))*.7+.012;
        float edge=1.-smoothstep(width-aa,width+aa,abs(f.x-center));
        float ends=smoothstep(-aa,aa,along)*(1.-smoothstep(1.-aa,1.+aa,along));
        // Subpixel blades converge to average coverage instead of shimmering.
        float detail=1.-smoothstep(.3,1.,max(fwidth(p.x),fwidth(p.y)));
        return mix(.23,edge*ends,detail);
      }
    `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 field=meadowPosition.xz*.085-normalize(vec2(1.,.43))*meadowTime*.28;
      float gust=meadowNoise(field);
      float broad=meadowNoise(field*.43+vec2(5.7,-9.2));
      float breeze=(.12+.7*gust*gust+.3*broad)*clamp(meadowWind,0.,3.);
      vec2 turf=meadowPosition.xz;
      // Two interleaved orientations conceal the cell grid and create a dense,
      // continuously planted surface even when distant tuft instances are culled.
      float bladeA=meadowBlades(mat2(.8,-.6,.6,.8)*turf*6.,breeze);
      float bladeB=meadowBlades(mat2(.45,.893,-.893,.45)*turf*8.3+19.7,breeze*.7);
      float blades=max(bladeA,bladeB*.82);
      float variation=meadowNoise(turf*.7);
      vec3 roots=vec3(.49,.69,.39),tips=vec3(.96,1.09,.77);
      vec3 carpet=mix(roots,tips,clamp(.24+blades*.7+variation*.12,0.,1.));
      carpet*=.94+gust*.13*min(meadowWind,1.5);
      diffuseColor.rgb*=mix(carpet,vec3(1.),clamp(meadowSnow,0.,1.));
    `);
  };
  material.customProgramCacheKey=()=>`${baseKey}|meadow-carpet-v1`;
  material.userData.meadowCarpet=true;
  material.needsUpdate=true;
}

// Draw only silhouette-producing nearby tufts. The opaque carpet above supplies
// full ground coverage at every quality level, including mobile low quality.
const grassState=new WeakMap();
const DETAIL={high:{near:16,far:64,density:1},medium:{near:12,far:46,density:.55},low:{near:7,far:29,density:.24}};
export function updateGrass(batches,camera,detail='high',snow=0){
  const setting=DETAIL[detail]||DETAIL.high;
  const snowFactor=1-Math.min(1,Math.max(0,snow));
  for(const mesh of batches){
    if(mesh.name!=='grass'||!mesh.isInstancedMesh)continue;
    let state=grassState.get(mesh);
    if(!state){
      if(!mesh.boundingBox)mesh.computeBoundingBox();
      state={fullCount:mesh.userData.fullCount??mesh.instanceMatrix.count};
      grassState.set(mesh,state);
    }
    const box=mesh.boundingBox;
    // Current park batches have identity world matrices; their instance bounds
    // already use world coordinates. Measure to the cell edge to avoid popping
    // an entire nearby cell when the camera crosses a coarse grid boundary.
    const dx=Math.max(box.min.x-camera.position.x,0,camera.position.x-box.max.x);
    const dz=Math.max(box.min.z-camera.position.z,0,camera.position.z-box.max.z);
    const distance=Math.hypot(dx,dz);
    const t=Math.min(1,Math.max(0,(distance-setting.near)/(setting.far-setting.near)));
    const fade=1-t*t*(3-2*t);
    const count=Math.round(state.fullCount*setting.density*fade*snowFactor);
    mesh.count=count;
    mesh.visible=count>0;
  }
}
