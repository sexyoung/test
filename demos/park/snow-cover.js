// Snow changes the surface albedo, not the final lit color: it stays shaded by
// the sun, moon, and lanterns, while completely covering green vertex colors.
export function createSnowCover({batches,amount={value:0}}) {
  let target=0;
  const patched=new Set();
  for(const mesh of batches) {
    const role=mesh.userData.role;
    // The pond remains open water; lamps still shine through their glass.
    if(role==='water'||role==='glow'||mesh.userData.gltfAsset==='lilies')continue;
    const material=mesh.material;
    if(!material||patched.has(material))continue;
    patched.add(material);
    const ground=mesh.userData.gltfAsset==='landscape';
    const previousCompile=material.onBeforeCompile;
    const previousKey=material.customProgramCacheKey();
    material.onBeforeCompile=function(shader,renderer){
      previousCompile.call(this,shader,renderer);
      shader.uniforms.parkSnowCover=amount;
      shader.fragmentShader='uniform float parkSnowCover;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        // 'normal' already includes model/instance transforms in view space.
        // Convert back to world space so snow always lands on upward faces.
        vec3 parkSnowNormal=inverseTransformDirection(normal,viewMatrix);
        float parkSnowMask=${ground?'1.':'smoothstep(.22,.68,parkSnowNormal.y)'};
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.93,.96,1.),parkSnowCover*parkSnowMask);`);
    };
    material.customProgramCacheKey=()=>`${previousKey}|park-snow-${ground?'ground':'caps'}-v1`;
    material.userData.snowCover=amount;
    material.needsUpdate=true;
  }
  return {
    amount,
    setWeather(mode,immediate=false){
      target=mode==='snow'?1:0;
      if(immediate)amount.value=target;
    },
    update(dt){
      // User-initiated weather changes continue while scene motion is paused.
      // A finite 1.2-second ramp reaches full white coverage, not an asymptote.
      const step=Math.max(0,Number.isFinite(dt)?dt:0)/1.2;
      amount.value=target>amount.value?Math.min(target,amount.value+step):Math.max(target,amount.value-step);
    },
  };
}
