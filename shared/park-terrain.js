// Shared by offline terrain authoring and the runtime camera clearance.
import { smoothstep } from './math.js';
export const lake={x:-3,z:-3,rx:8.5,rz:5.7,level:-.24};
export const lakeDistance=(x,z)=>Math.hypot((x-lake.x)/lake.rx,(z-lake.z)/lake.rz);
export function heightAt(x,z){
  const q=lakeDistance(x,z);
  return .25+.22*Math.sin(x*.105)*Math.cos(z*.13)+.12*Math.sin(z*.21+x*.09)
    +smoothstep(23,55,Math.hypot(x,z))*(1.5+1.1*Math.sin(x*.06+z*.045))
    -1.9*(1-smoothstep(.78,1.18,q));
}
