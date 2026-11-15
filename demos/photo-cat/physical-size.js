import {Box3,Vector3} from 'three';
// Starting values are editorial preview estimates, NOT measured pet dimensions.
export const SIZE_PRESETS={runner:{axis:'y',cm:35},jtoastie:{axis:'y',cm:35},persian:{axis:'y',cm:35},'shiba-inu':{axis:'y',cm:50},husky:{axis:'y',cm:65},pug:{axis:'y',cm:35},'german-shepherd':{axis:'y',cm:75},pomeranian:{axis:'y',cm:28},rabbit:{axis:'y',cm:25},rat:{axis:'z',cm:35},hamster:{axis:'z',cm:12},hedgehog:{axis:'z',cm:22},ferret:{axis:'z',cm:55},'guinea-pig':{axis:'z',cm:25},budgie:{axis:'y',cm:18},cockatiel:{axis:'y',cm:30},parrot:{axis:'y',cm:30},chicken:{axis:'y',cm:40},horse:{axis:'y',cm:190},goldfish:{axis:'z',cm:12},turtle:{axis:'z',cm:22}};
// These are model-space extents, never anatomical shoulder height or nose-to-rump length.
export const SIZE_MEASUREMENTS={
  y:{kind:'model-full-height',label:'模型全高（含耳尾）',description:'Full model vertical bounding extent, including ears and any raised tail'},
  z:{kind:'model-full-depth',label:'含尾前後長',description:'Full front-to-back bounding extent, including tail'},
  x:{kind:'model-full-width',label:'最寬處',description:'Full left-to-right bounding extent'},
  longest:{kind:'model-longest-extent',label:'最大外框尺寸',description:'Largest axis-aligned bounding extent'},
};
for(const preset of Object.values(SIZE_PRESETS))Object.assign(preset,{estimated:true,measurementKind:SIZE_MEASUREMENTS[preset.axis].kind,source:'editorial-preview-estimate'});

const restPoseKey='_physicalSizeRestPose';
const calibratedRestPoses=new WeakMap();
/** Call once after adapter corrections/fitting, BEFORE starting its animation mixer.
 * A JSON-safe child-index snapshot survives SkeletonUtils.clone without sharing bones.
 */
export function captureRestPose(root){
  root.updateMatrixWorld(true);
  const nodes=[];
  const visit=(node,path)=>{
    nodes.push({path,position:node.position.toArray(),quaternion:node.quaternion.toArray(),scale:node.scale.toArray(),matrix:node.matrix.toArray(),matrixAutoUpdate:node.matrixAutoUpdate});
    node.children.forEach((child,index)=>visit(child,[...path,index]));
  };
  visit(root,[]);
  root.userData[restPoseKey]={version:1,nodes};
  calibratedRestPoses.delete(root);
  return root;
}
/** Transfer a previously captured pose when cloning an already-calibrated catalog asset. */
export function copyRestPose(source,target){
  const snapshot=source.userData[restPoseKey]||calibratedRestPoses.get(source);
  if(snapshot)target.userData[restPoseKey]=snapshot;
  return target;
}
function restoreSizingPose(root){
  const skeletons=new Set();root.traverse(node=>{if(node.isSkinnedMesh)skeletons.add(node.skeleton);});
  const snapshot=root.userData[restPoseKey]||calibratedRestPoses.get(root);
  if(snapshot){
    if(snapshot.version!==1)throw new Error('模型尺寸基準姿勢版本不符');
    for(const transform of snapshot.nodes){
      let node=root;for(const index of transform.path)node=node?.children[index];
      if(!node)throw new Error('模型結構已變更，請重新記錄尺寸基準姿勢');
      node.position.fromArray(transform.position);node.quaternion.fromArray(transform.quaternion);node.scale.fromArray(transform.scale);
      node.matrixAutoUpdate=transform.matrixAutoUpdate;node.matrix.fromArray(transform.matrix);node.matrixWorldNeedsUpdate=true;
    }
    // Keep repeat calibration idempotent without embedding this internal snapshot in GLB extras.
    calibratedRestPoses.set(root,snapshot);delete root.userData[restPoseKey];
  }else{
    // Backwards-compatible fallback for unmodified source rigs. Adapters should always capture.
    for(const skeleton of skeletons)skeleton.pose();
  }
  root.updateMatrixWorld(true);for(const skeleton of skeletons)skeleton.update();
  return snapshot?'captured-adapter-rest-pose':skeletons.size?'skeletal-bind-pose':'static-source-pose';
}
/** Apply to a detached export clone or calibrated asset, never to the fitted preview.
 * Dimensions use the captured adapter rest pose (or source bind/static fallback), never a playing skeletal frame.
 * Anatomical measurements require separately annotated landmarks and are intentionally unsupported.
 */
export function applyPhysicalSize(root,{axis='y',cm,estimated=true,measurementKind}={}){
  if(!Object.hasOwn(SIZE_MEASUREMENTS,axis)||!Number.isFinite(cm)||cm<=0||cm>1000)throw new Error('請輸入有效尺寸（大於 0、最多 1000 公分）');
  const measurement=SIZE_MEASUREMENTS[axis];
  if(measurementKind&&measurementKind!==measurement.kind)throw new Error('尺寸量法不符；肩高或不含尾身長不能直接套用模型外框尺寸');
  const pose=restoreSizingPose(root);
  const size=new Box3().setFromObject(root,true).getSize(new Vector3());
  const extent=axis==='longest'?Math.max(size.x,size.y,size.z):size[axis];
  if(!Number.isFinite(extent)||extent<=0)throw new Error('無法計算模型尺寸');
  root.scale.multiplyScalar(cm/100/extent);root.updateMatrixWorld(true);
  root.userData.physicalSize={schemaVersion:2,unit:'meter',axis,centimeters:cm,estimated,measurementKind:measurement.kind,measurement:measurement.description,pose,source:estimated?'Editable preview estimate, not inferred from photograph':'User-entered measurement'};
  return root;
}
