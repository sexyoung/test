import assert from 'node:assert/strict';
import {analyzeCatPhoto} from '../demos/photo-cat/analyze.js';
const landmarks={leftEye:{x:.35,y:.35},rightEye:{x:.65,y:.35},nose:{x:.5,y:.53}};
function photo(left,right,third){
  const width=160,height=160,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let c=x<width*.46?left:right;
    if(third&&x>width*.6&&y<height*.5)c=third;
    const i=(y*width+x)*4;data.set([...c,255],i);
  }
  return {width,height,data};
}
const blackWhite=analyzeCatPhoto(photo([34,31,39],[203,197,210]),{landmarks});
assert.equal(blackWhite.pattern,'bicolor');
assert.equal(blackWhite.measurements.coatCorrection,'neutral-black-white');
assert.match(blackWhite.colors.baseColor,/^#([a-f\d]{2})\1\1$/);
assert.match(blackWhite.colors.secondaryColor,/^#([a-f\d]{2})\1\1$/);
assert.ok(parseInt(blackWhite.colors.secondaryColor.slice(1,3),16)>=232);
assert.ok(blackWhite.palette.some(p=>p.color==='#cbc5d2'),'Original sampled white remains available, separate from corrected material.');
const ginger=analyzeCatPhoto(photo([177,100,53],[231,218,197]),{landmarks});
assert.equal(ginger.measurements.coatCorrection,null,'Warm ginger coat must not be neutralized.');
assert.ok(ginger.colors.baseColor.slice(1,3)!==ginger.colors.baseColor.slice(5,7));
const patches=analyzeCatPhoto(photo([34,31,39],[203,197,210],[177,100,53]),{landmarks});
assert.equal(patches.measurements.coatCorrection,null,'Substantial orange patches veto black-white correction.');
for(const noseY of [.42,.53,.7]){
 const r=analyzeCatPhoto(photo([34,31,39],[203,197,210]),{landmarks:{...landmarks,nose:{x:.5,y:noseY}}});
 assert.ok(r.shape.headHeight>=.92&&r.shape.headHeight<=1.08,'2D nose placement must not stretch the whole skull aggressively.');
}
const side=analyzeCatPhoto(photo([34,31,39],[203,197,210]),{landmarks,sideView:true});
assert.equal(side.shape.headHeight,1);
console.log('Photo analysis: neutral black/white coat, warm-color preservation, colored-patch veto, conservative head height passed.');
