// Local, deterministic photo measurements. This is not a breed classifier or a
// trained face detector: ambiguous crops/landmarks remain explicitly uncertain.
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const luminance=c=>(.2126*c[0]+.7152*c[1]+.0722*c[2])/255;
const chroma=c=>(Math.max(...c)-Math.min(...c))/255;
const hex=c=>'#'+c.map(v=>Math.round(clamp(v,0,255)).toString(16).padStart(2,'0')).join('');
const average=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
function clusters(samples,count=5){
  if(!samples.length)return [];
  const centers=[samples[Math.floor(samples.length/2)].rgb.slice()];
  while(centers.length<count){
    let best=null,bestDistance=0;
    for(const sample of samples){const d=Math.min(...centers.map(c=>distance(c,sample.rgb)));if(d>bestDistance){best=sample.rgb;bestDistance=d;}}
    if(!best||bestDistance<18)break;centers.push(best.slice());
  }
  let assignments=[];
  for(let pass=0;pass<9;pass++){
    const sums=centers.map(()=>({rgb:[0,0,0],count:0,x:0,y:0}));
    assignments=samples.map(sample=>{
      let best=0,d=Infinity;centers.forEach((c,i)=>{const next=distance(c,sample.rgb);if(next<d){best=i;d=next;}});
      const sum=sums[best];sum.count++;sum.x+=sample.x;sum.y+=sample.y;for(let j=0;j<3;j++)sum.rgb[j]+=sample.rgb[j];return best;
    });
    sums.forEach((sum,i)=>{if(sum.count)centers[i]=sum.rgb.map(v=>v/sum.count);});
  }
  return centers.map((rgb,i)=>{
    const members=samples.filter((_,j)=>assignments[j]===i);
    return {rgb,count:members.length,proportion:members.length/samples.length,x:average(members.map(s=>s.x)),y:average(members.map(s=>s.y))};
  }).filter(c=>c.count).sort((a,b)=>b.count-a.count);
}
function fitCrop(c){
  const x=clamp(c.x),y=clamp(c.y),right=clamp(c.x+c.width),bottom=clamp(c.y+c.height);
  return {x,y,width:Math.max(.01,right-x),height:Math.max(.01,bottom-y)};
}
function normalizedPoint(p,width,height,pixels){
  if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))return null;
  return {x:clamp(p.x/(pixels?width:1)),y:clamp(p.y/(pixels?height:1))};
}
function cropsFromLandmarks(points,width,height){
  const {leftEye:l,rightEye:r,nose:n}=points;
  const span=Math.hypot((r.x-l.x)*width,(r.y-l.y)*height),midX=(l.x+r.x)/2,midY=(l.y+r.y)/2;
  const eyeDx=(r.x-l.x)*width,eyeDy=(r.y-l.y)*height;
  const noseDrop=n?clamp((-(n.x-midX)*width*eyeDy+(n.y-midY)*height*eyeDx)/Math.max(span,1),span*.22,span*.9):span*.46;
  return {
    crop:fitCrop({x:midX-span*1.12/width,y:midY-span*1.05/height,width:span*2.24/width,height:(span*1.65+noseDrop)/height}),
    faceCrop:fitCrop({x:midX-span*.99/width,y:midY-span*.48/height,width:span*1.98/width,height:(span*.9+noseDrop)/height}),
    span,noseDrop,
  };
}
function pointInside(p,c){return p.x>=c.x&&p.x<=c.x+c.width&&p.y>=c.y&&p.y<=c.y+c.height;}

/**
 * imageData: {width,height,data:Uint8ClampedArray RGBA}.
 * options.crop / landmarks use full-image normalized coordinates by default;
 * set coordinates:'pixels' for pixel coordinates. Optional sideView forces
 * geometric estimates to remain unknown. No DOM, network, or external models.
 */
export function analyzeCatPhoto(imageData,options={}){
  const {width,height,data}=imageData||{};
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||!data||data.length<width*height*4)throw new TypeError('A valid RGBA image of at least 8 × 8 pixels is required.');
  const pixels=options.coordinates==='pixels';
  const at=(x,y)=>{const ix=Math.round(clamp(x)* (width-1)),iy=Math.round(clamp(y)*(height-1)),i=(iy*width+ix)*4;return [data[i],data[i+1],data[i+2]];};
  const samples=[],border=[];
  // Bounded sampling keeps analysis responsive even for full-resolution photos.
  const step=Math.max(1,Math.ceil(Math.max(width,height)/144));
  for(let y=0;y<height;y+=step)for(let x=0;x<width;x+=step){
    const i=(y*width+x)*4;if(data[i+3]<180)continue;
    const s={x:x/width,y:y/height,rgb:[data[i],data[i+1],data[i+2]]};samples.push(s);
    if(s.x<.06||s.x>.94||s.y<.055||s.y>.945)border.push(s);
  }
  if(samples.length<16)throw new TypeError('The image contains too few opaque pixels to analyze.');
  const backgrounds=clusters(border,3);
  const backgroundDistance=rgb=>backgrounds.length?Math.min(...backgrounds.map(c=>distance(c.rgb,rgb))):255;
  const warnings=[],unknowns=['bodyWidth'],observations=[];
  const input=options.landmarks||{};
  let leftEye=normalizedPoint(input.leftEye,width,height,pixels),rightEye=normalizedPoint(input.rightEye,width,height,pixels),nose=normalizedPoint(input.nose,width,height,pixels);
  const manualEyes=Boolean(leftEye&&rightEye);
  if(manualEyes&&leftEye.x>rightEye.x)[leftEye,rightEye]=[rightEye,leftEye];
  const manualSpan=manualEyes?Math.hypot((rightEye.x-leftEye.x)*width,(rightEye.y-leftEye.y)*height):0;
  if(manualEyes&&manualSpan<Math.min(width,height)*.04)throw new RangeError('Eye guides are too close together; mark the two eyes separately.');
  let crop;
  if(options.crop){const c=options.crop;if(!['x','y','width','height'].every(k=>Number.isFinite(c[k]))||c.width<=0||c.height<=0)throw new RangeError('Crop must contain finite x, y and positive width and height.');crop=fitCrop({x:c.x/(pixels?width:1),y:c.y/(pixels?height:1),width:c.width/(pixels?width:1),height:c.height/(pixels?height:1)});}
  else if(manualEyes)crop=cropsFromLandmarks({leftEye,rightEye,nose},width,height).crop;
  else{
    const foreground=samples.filter(s=>s.x>.12&&s.x<.88&&s.y>.04&&s.y<.88&&backgroundDistance(s.rgb)>43);
    if(foreground.length>samples.length*.1){
      const xs=foreground.map(s=>s.x).sort((a,b)=>a-b),ys=foreground.map(s=>s.y).sort((a,b)=>a-b);
      const x0=xs[Math.floor(xs.length*.04)],x1=xs[Math.floor(xs.length*.96)],y0=ys[Math.floor(ys.length*.04)],y1=ys[Math.floor(ys.length*.96)];
      const w=clamp((x1-x0)*1.1,.3,.86),h=Math.min((y1-y0)*1.08,w*width/height*1.13);
      crop=fitCrop({x:(x0+x1-w)/2,y:Math.max(.01,y0-.025),width:w,height:Math.max(.25,h)});
    }else crop={x:.16,y:.06,width:.68,height:.8};
    warnings.push('自動框選依據中央區域與背景色差，並非貓臉辨識模型；請確認臉部框選。');
  }
  let landmarkConfidence=manualEyes?.92:0;
  // Search local dark features in the upper/middle face. Pair symmetry and local
  // contrast reject many fur spots; guides are still required for low confidence.
  if(!manualEyes&&!options.sideView){
    const candidates=[];
    for(let gy=0;gy<22;gy++)for(let gx=0;gx<34;gx++){
      const x=crop.x+crop.width*(.13+gx/33*.74),y=crop.y+crop.height*(.25+gy/21*.4),rgb=at(x,y),lum=luminance(rgb);
      const surrounding=average([[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>luminance(at(x+dx*crop.width*.045,y+dy*crop.height*.035))));
      const contrast=surrounding-lum;
      if(lum<.48&&contrast>.07)candidates.push({x,y,score:contrast*(1.05-lum)});
    }
    candidates.sort((a,b)=>b.score-a.score);
    const distinct=[];
    for(const p of candidates){if(distinct.every(q=>Math.hypot((p.x-q.x)/crop.width,(p.y-q.y)/crop.height)>.055))distinct.push(p);if(distinct.length>=32)break;}
    let best=null;
    for(const l of distinct)for(const r of distinct){
      const separation=(r.x-l.x)/crop.width,dy=Math.abs(r.y-l.y)/crop.height,mid=(l.x+r.x)/2;
      if(separation<.24||separation>.64||dy>.08||Math.abs(mid-(crop.x+crop.width*.5))>crop.width*.16)continue;
      const score=(l.score+r.score)*(1-dy*5)*(1-Math.abs(separation-.43));
      if(!best||score>best.score)best={l,r,score};
    }
    if(best&&best.score>.14){leftEye={x:best.l.x,y:best.l.y};rightEye={x:best.r.x,y:best.r.y};landmarkConfidence=clamp(best.score*1.1,.2,.45);}
  }
  if(leftEye&&rightEye&&!nose){
    const midX=(leftEye.x+rightEye.x)/2,midY=(leftEye.y+rightEye.y)/2,span=(rightEye.x-leftEye.x)*width;
    let best=null;
    for(let j=0;j<14;j++)for(let i=0;i<11;i++){
      const x=midX+(i/10-.5)*span*.32/width,y=midY+span*(.25+j/13*.4)/height;if(y>1)continue;
      const rgb=at(x,y),pink=clamp((rgb[0]-rgb[1])/110),score=(1-luminance(rgb))*.55+pink*.45;
      if(!best||score>best.score)best={x,y,score};
    }
    if(best)nose={x:best.x,y:best.y};
  }
  let faceCrop,span,noseDrop;
  if(leftEye&&rightEye){({faceCrop,span,noseDrop}=cropsFromLandmarks({leftEye,rightEye,nose},width,height));}
  else{faceCrop=fitCrop({x:crop.x+crop.width*.07,y:crop.y+crop.height*.26,width:crop.width*.86,height:crop.height*.68});span=faceCrop.width*width*.5;noseDrop=span*.46;unknowns.push('eyeLandmarks','noseLandmark');}
  const landmarks={leftEye,rightEye,nose};
  const eyeDistance=(s,p)=>p?Math.hypot((s.x-p.x)*width,(s.y-p.y)*height):Infinity;
  let fur=samples.filter(s=>{
    if(!pointInside(s,faceCrop))return false;
    const nx=(s.x-faceCrop.x)/faceCrop.width-.5,ny=(s.y-faceCrop.y)/faceCrop.height-.5;
    if(nx*nx/.25+ny*ny/.25>1)return false;
    if(eyeDistance(s,leftEye)<span*.16||eyeDistance(s,rightEye)<span*.16||eyeDistance(s,nose)<span*.13)return false;
    // Do not remove center-face fur merely because it matches the background.
    return Math.abs(nx)<.34||backgroundDistance(s.rgb)>25;
  });
  if(fur.length<35){fur=samples.filter(s=>pointInside(s,faceCrop));warnings.push('有效毛色樣本偏少，背景可能影響取色。');}
  const paletteData=clusters(fur,5);
  let primary=paletteData[0]||{rgb:[150,140,125],proportion:0};
  let secondary=paletteData.filter(c=>distance(c.rgb,primary.rgb)>48&&c.proportion>.08).sort((a,b)=>distance(b.rgb,primary.rgb)*Math.sqrt(b.proportion)-distance(a.rgb,primary.rgb)*Math.sqrt(a.proportion))[0]||primary;
  const white=paletteData.filter(c=>luminance(c.rgb)>.73&&chroma(c.rgb)<.22),dark=paletteData.filter(c=>luminance(c.rgb)<.3),orange=paletteData.filter(c=>c.rgb[0]>c.rgb[2]*1.35&&c.rgb[0]>c.rgb[1]*1.08&&chroma(c.rgb)>.18&&luminance(c.rgb)>.24);
  const fraction=arr=>arr.reduce((sum,c)=>sum+c.proportion,0);
  const whiteFraction=fraction(white),darkFraction=fraction(dark),orangeFraction=fraction(orange);
  // Measure repeated light/dark transitions in several forehead/cheek strips.
  let stripeRuns=0,stripeLines=0;
  for(const row of [.12,.22,.65,.77]){
    const lum=[];for(let i=0;i<40;i++)lum.push(luminance(at(faceCrop.x+faceCrop.width*(.14+i/39*.72),faceCrop.y+faceCrop.height*row)));
    const mean=average(lum),spread=Math.sqrt(average(lum.map(v=>(v-mean)**2)));
    if(spread<.055)continue;
    let runs=0,last=0;
    for(let i=1;i<lum.length-1;i++){const smoothed=(lum[i-1]+lum[i]+lum[i+1])/3;const side=smoothed>mean+spread*.22?1:smoothed<mean-spread*.22?-1:0;if(side&&last&&side!==last)runs++;if(side)last=side;}
    stripeRuns+=runs;stripeLines++;
  }
  const stripeScore=stripeLines?stripeRuns/stripeLines:0;
  const meanPosition=arr=>({x:average(arr.map(c=>c.x)),y:average(arr.map(c=>c.y))});
  const op=meanPosition(orange),dp=meanPosition(dark);
  const patchSeparation=Math.hypot((op.x-dp.x)/faceCrop.width,(op.y-dp.y)/faceCrop.height);
  let pattern='solid';
  if(stripeScore>=4&&paletteData.length>1)pattern='tabby';
  else if(whiteFraction>.11&&darkFraction>.12&&orangeFraction>.13&&patchSeparation>.18)pattern='calico';
  else if(whiteFraction>.17&&whiteFraction<.83&&secondary!==primary)pattern='bicolor';
  else if(darkFraction>.2&&luminance(primary.rgb)>.45&&nose&&leftEye&&rightEye){
    const center=luminance(at(nose.x,nose.y-span*.16/height));
    const cheeks=average([-.65,.65].map(offset=>luminance(at((leftEye.x+rightEye.x)/2+span*offset/width,nose.y))));
    if(cheeks-center>.18)pattern='point';
  }
  // The model uses base for the coat and secondary for chest/paws. A mostly
  // white face must not erase a substantive black coat in a bicolor photograph.
  if(pattern==='bicolor'&&white.length){
    const coat=dark.find(c=>c.proportion>.07)||paletteData.find(c=>luminance(c.rgb)<.7&&c.proportion>.08);
    if(coat){primary=coat;secondary=white[0];}
  }
  if(pattern==='calico'&&orange.length&&white.length){primary=orange[0];secondary=white[0];}
  // A photographed white coat includes shadows and the room's color cast.
  // Recover a neutral material only when BOTH substantial black and white fur
  // support it. Warm/colored coats, tabbies and calicos keep their sampled RGB.
  const relativeChroma=c=>(Math.max(...c)-Math.min(...c))/Math.max(1,Math.max(...c));
  const neutralWhites=white.filter(c=>relativeChroma(c.rgb)<.12);
  const neutralDarks=dark.filter(c=>relativeChroma(c.rgb)<.30);
  const neutralCoat=pattern==='bicolor'&&orangeFraction<.06&&fraction(neutralWhites)>.2&&fraction(neutralDarks)>.12&&luminance(primary.rgb)<.3&&relativeChroma(primary.rgb)<.30;
  let coatCorrection=null;
  if(neutralCoat){
    const black=clamp(luminance(primary.rgb)*255,22,48);
    const whiteWeight=fraction(neutralWhites);
    const observedWhite=neutralWhites.reduce((sum,c)=>sum+luminance(c.rgb)*255*c.proportion,0)/whiteWeight;
    const light=clamp(observedWhite*1.1,232,244);
    primary={...primary,rgb:[black,black,black]};
    secondary={...secondary,rgb:[light,light,light]};
    coatCorrection='neutral-black-white';
    observations.push('低彩度黑白毛色已去除環境色偏，白毛以材質亮度呈現；保留原始取樣色盤供比較。');
  }
  function irisColor(){
    if(!leftEye||!rightEye)return null;
    const iris=[];
    for(const eye of [leftEye,rightEye])for(let j=-5;j<=5;j++)for(let i=-7;i<=7;i++){
      const nx=i/7,ny=j/5,r=Math.hypot(nx,ny);if(r<.28||r>1)continue;
      const rgb=at(eye.x+nx*span*.135/width,eye.y+ny*span*.095/height),lum=luminance(rgb),sat=chroma(rgb);
      if(lum>.15&&lum<.83&&sat>.11)iris.push({x:eye.x,y:eye.y,rgb});
    }
    const colors=clusters(iris,3);return colors.length&&iris.length>16?colors[0].rgb:null;
  }
  const iris=irisColor();
  if(!iris){unknowns.push('eyeColor');warnings.push('瞳色無法可靠取樣，眼睛顏色目前為可手動調整的預設值。');}
  const noseSamples=[];
  if(nose)for(let j=-2;j<=2;j++)for(let i=-3;i<=3;i++)noseSamples.push(at(nose.x+i*span*.012/width,nose.y+j*span*.012/height));
  const noseColor=noseSamples.length?[0,1,2].map(i=>average(noseSamples.map(c=>c[i]))):[118,86,82];
  if(!nose)unknowns.push('noseColor');
  // Width estimates use visible foreground spans near the cheeks. This only
  // estimates frontal silhouette proportions, never unseen 3-D anatomy.
  const faceRows=[];
  for(const row of [.4,.5,.6,.7]){
    const y=faceCrop.y+faceCrop.height*row,visible=[];
    for(let i=0;i<50;i++){const x=faceCrop.x+faceCrop.width*i/49;if(backgroundDistance(at(x,y))>28)visible.push(x);}
    if(visible.length>12)faceRows.push((visible.at(-1)-visible[0])*width);
  }
  const visibleWidth=average(faceRows),geometryConfidence=options.sideView?0:manualEyes?.62:landmarkConfidence*.45;
  const shape={headWidth:1,headHeight:1,muzzleLength:1,earSize:1,earTilt:0,bodyWidth:1,furLength:1};
  if(geometryConfidence>.25){
    if(visibleWidth>span*1.5)shape.headWidth=clamp(visibleWidth/(span*1.85),.75,1.3);
    else unknowns.push('headWidth');
    // Eye-to-nose distance also changes with muzzle projection, pose and guide
    // placement. It is weak evidence for the height of the whole 3-D skull.
    shape.headHeight=clamp(1+((noseDrop/span)-.46)*.35,.92,1.08);
    // A photograph yields muzzle projection in the image, not depth. Leave
    // muzzleLength neutral rather than inventing a 3-D estimate from eye spacing.
    observations.push('臉寬與臉高依眼距、鼻子位置及可見輪廓估計；不是精確三維尺寸。');
  }else unknowns.push('headWidth','headHeight');
  unknowns.push('muzzleLength','earSize','earTilt','furLength');
  const colorConfidence=clamp(.35+Math.min(fur.length/1500,.3)+(manualEyes?.18:0)-(options.sideView?.12:0),.15,.88);
  if(!manualEyes||landmarkConfidence<.5)warnings.push('請確認雙眼與鼻子位置；側臉、遮擋或花紋容易被誤判為五官。');
  if(options.sideView)warnings.push('側面照片不足以推算正面比例，模型比例保留預設值。');
  observations.push(`由臉部 ${fur.length} 個像素樣本估計主要毛色與次要毛色。`);
  observations.push(`白色區域約 ${Math.round(whiteFraction*100)}%，深色區域約 ${Math.round(darkFraction*100)}%；花紋分類為視覺啟發式估計。`);
  warnings.push('單張照片無法可靠推算品種、身體比例、毛長或被遮住的耳朵形狀；請用調整控制校正。');
  return {
    colors:{baseColor:hex(primary.rgb),secondaryColor:hex(secondary.rgb),eyeColor:iris?hex(iris):'#a4ae69',noseColor:hex(noseColor),tertiaryColor:hex(neutralCoat?primary.rgb:dark[0]?.rgb||primary.rgb)},
    shape,pattern,crop,faceCrop,landmarks,
    palette:paletteData.map(c=>({color:hex(c.rgb),proportion:c.proportion})),
    confidence:{overall:Math.min(colorConfidence,.3+landmarkConfidence*.5),color:colorConfidence,landmarks:landmarkConfidence,shape:geometryConfidence,pattern:pattern==='solid'?.5:.4},
    observations,unknowns:[...new Set(unknowns)],warnings,
    measurements:{furSampleCount:fur.length,eyeSpanPixels:span,noseDropPixels:noseDrop,visibleHeadWidthPixels:visibleWidth,whiteFraction,darkFraction,orangeFraction,stripeTransitions:stripeScore,coatCorrection,backgroundPalette:backgrounds.map(c=>hex(c.rgb))},
  };
}
