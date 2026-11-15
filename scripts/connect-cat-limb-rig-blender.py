"""Add anatomical shoulder/hip chains without changing the approved run skin.
Bridges are real parent bones; their lengths follow the retained moving joints.
"""
import bpy,json,math
from pathlib import Path
from mathutils import Vector,Matrix
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'public/models/cat/runner-editable-rig.blend'
OUT=ROOT/'public/models/cat/runner-connected-rig.blend'
REPORT=ROOT/'bench/out/approved-head/skeleton-connected'
REPORT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');scene=bpy.context.scene
if bpy.context.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
meshes=[o for o in scene.objects if o.type=='MESH' and any(m.type=='ARMATURE'for m in o.modifiers)]
action=rig.animation_data.action;slot=rig.animation_data.action_slot
connections=[
 ('shoulder.L','body_2_03','leg_front_left_1_012','tail'),
 ('shoulder.R','body_2_03','leg_front_right_1_08','tail'),
 ('hip.L','pelvis_01','leg_back_left_1_016','head'),
 ('hip.R','pelvis_01','leg_back_right_1_00','head'),
]
# The previous rest-frame fit retained animated gaps at some knee/ankle
# junctions. Short in-chain connectors keep these joints continuous too.
for side,suffix in [('left','L'),('right','R')]:
 front=[f'leg_front_{side}_{part}'for part in (['1_012','2_013','3_014','4_015']if side=='left'else['1_08','2_09','3_010','4_011'])]
 back=[f'leg_back_{side}_{part}'for part in (['1_016','2_017','3_018','4_019']if side=='left'else['1_00','2_024','3_025','4_026'])]
 for limb,chain in [('front',front),('back',back)]:
  for i in range(3):connections.append((f'{limb}_joint_{i+1}.{suffix}',chain[i],chain[i+1],'shortened_tail'))
oldnames=[b.name for b in rig.data.bones]
oldrest={b.name:b.matrix_local.copy()for b in rig.data.bones}
oldweights={o.name:[[(g.group,g.weight)for g in v.groups]for v in o.data.vertices]for o in meshes}
oldcoords={o.name:[tuple(v.co)for v in o.data.vertices]for o in meshes}
frames=[i/16 for i in range(577)]
checks=[(i+.5)/16 for i in range(576)]
def setframe(f):scene.frame_set(math.floor(f),subframe=f%1)
def positions():
 dg=bpy.context.evaluated_depsgraph_get()
 return np.asarray([tuple(o.matrix_world@v.co)for o in meshes for v in o.evaluated_get(dg).data.vertices])
poses=[]
for f in frames:
 setframe(f);poses.append({p.name:p.matrix.copy()for p in rig.pose.bones})
baseline=[]
for f in checks:setframe(f);baseline.append(positions())
rig.animation_data.action=None
for p in rig.pose.bones:p.matrix_basis=Matrix.Identity(4)
bpy.context.view_layer.update();neutral=positions()
bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='EDIT')
for name,parent,child,anchor in connections:
 pa=rig.data.edit_bones[parent];ch=rig.data.edit_bones[child]
 if anchor=='shortened_tail':
  # Length alone changes the bone display endpoint, not its rest matrix or
  # skin deformation. Reserve the final 18% for a connected joint segment.
  pa.length*=.82
 bridge=rig.data.edit_bones.new(name);bridge.head=pa.tail if anchor!='head'else pa.head;bridge.tail=ch.head
 bridge.parent=pa;bridge.use_connect=(anchor!='head');bridge.use_deform=False;bridge.inherit_scale='NONE'
 bridge.align_roll(pa.z_axis)
 ch.parent=bridge;ch.use_connect=True;ch.inherit_scale='NONE'
bpy.ops.object.mode_set(mode='OBJECT')
rest={b.name:b.matrix_local.copy()for b in rig.data.bones}
# Reparenting must not change any original rest frame, geometry or weights.
for n in oldnames:
 delta=max(abs(rest[n][i][j]-oldrest[n][i][j])for i in range(4)for j in range(4))
 # Edit-mode round trips introduce a few float32 ulps in bone rotations.
 assert delta<1e-5,(n,delta)
newaction=action.copy();newaction.name='run - connected shoulders and hips';rig.animation_data.action=newaction
changed={c for _,_,c,_ in connections}
for layer in newaction.layers:
 for strip in layer.strips:
  for bag in strip.channelbags:
   for fc in list(bag.fcurves):
    if any(fc.data_path.startswith('pose.bones["'+n+'"]')for n in changed):bag.fcurves.remove(fc)

def bridge_matrix(a,b,reference,restlength):
 y=b-a;length=y.length;y.normalize()
 x=reference.to_3x3().col[0];x=(x-y*x.dot(y)).normalized()
 if x.length<.1:
  x=reference.to_3x3().col[2];x=(x-y*x.dot(y)).normalized()
 z=x.cross(y).normalized();rot=Matrix((x,y,z)).transposed().to_4x4()
 return Matrix.Translation(a)@rot@Matrix.Diagonal((1,length/restlength,1,1))
lastq={}
for f,oldpose in zip(frames,poses):
 for name,parent,child,anchor in connections:
  pa=oldpose[parent];a=pa@Vector((0,rig.data.bones[parent].length if anchor!='head'else 0,0));b=oldpose[child].translation
  bridgepose=bridge_matrix(a,b,pa,rig.data.bones[name].length)
  for n,target,parentmatrix,parentrest in [(name,bridgepose,pa,rest[parent]),(child,oldpose[child],bridgepose,rest[name])]:
   p=rig.pose.bones[n]
   local=p.bone.convert_local_to_pose(target,rest[n],parent_matrix=parentmatrix,parent_matrix_local=parentrest,invert=True)
   loc,q,scale=local.decompose()
   if n in lastq and lastq[n].dot(q)<0:q.negate()
   lastq[n]=q.copy();p.rotation_mode='QUATERNION';p.location=loc;p.rotation_quaternion=q;p.scale=scale
   p.keyframe_insert('location',frame=f,group=n);p.keyframe_insert('rotation_quaternion',frame=f,group=n);p.keyframe_insert('scale',frame=f,group=n)
for layer in newaction.layers:
 for strip in layer.strips:
  for bag in strip.channelbags:
   for fc in bag.fcurves:
    if any(fc.data_path.startswith('pose.bones["'+n+'"]')for n in changed|{n for n,_,_,_ in connections}):
     for k in fc.keyframe_points:k.interpolation='LINEAR'
maxerror=0;maxgap=0;worst=0
for f,expected in zip(checks,baseline):
 setframe(f);err=float(np.max(np.linalg.norm(positions()-expected,axis=1)))
 if err>maxerror:maxerror=err;worst=f
 for n,parent,child,anchor in connections:
  p=rig.pose.bones[n];pa=rig.pose.bones[parent];ch=rig.pose.bones[child]
  maxgap=max(maxgap,(p.head-(pa.tail if anchor!='head'else pa.head)).length,(p.tail-ch.head).length)
assert maxerror<.00002,('Surface changed',maxerror,worst)
assert maxgap<.000002,('Disconnected limb junction',maxgap)
rig.animation_data.action=None
for p in rig.pose.bones:p.matrix_basis=Matrix.Identity(4)
bpy.context.view_layer.update();neutralerror=float(np.max(np.linalg.norm(positions()-neutral,axis=1)))
assert neutralerror<.000002,neutralerror
for o in meshes:
 assert oldcoords[o.name]==[tuple(v.co)for v in o.data.vertices]
 assert oldweights[o.name]==[[(g.group,g.weight)for g in v.groups]for v in o.data.vertices]
# Groups make the newly connected chain easy to select in Blender.
for group,names in [('Spine and head',[n for n in oldnames if n in ['_rootJoint','pelvis_01','body_1_02','body_2_03','neck_04','head_05']]),('Front legs and shoulders',[n for n in rig.data.bones.keys()if n.startswith(('leg_front','shoulder.','front_joint'))]),('Hind legs and hips',[n for n in rig.data.bones.keys()if n.startswith(('leg_back','hip.','back_joint'))]),('Ears and tail',[n for n in oldnames if n.startswith(('ear_','tail_'))])]:
 collection=rig.data.collections.new(group)
 for n in names:collection.assign(rig.data.bones[n])
rig['limb_connections']='Chest -> shoulders -> front leg chains; pelvis -> hips -> hind leg chains; shoulder, hip, knee, ankle and paw junctions connected during animation'
rig['connection_surface_error_m']=maxerror;rig['connection_max_gap_m']=maxgap
rig.animation_data.action=newaction;setframe(9)
rig.hide_set(False);rig.show_in_front=True
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='POSE');bpy.ops.pose.select_all(action='SELECT')
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type=='VIEW_3D':
   s=area.spaces.active;s.overlay.show_relationship_lines=False;s.overlay.show_extras=False
bpy.ops.wm.save_as_mainfile(filepath=str(OUT))
report={'source':str(SOURCE),'output':str(OUT),'bones':len(rig.data.bones),'connections':connections,'bakedSamples':len(frames),'independentSubframeChecks':len(checks),'maxSurfaceErrorMeters':maxerror,'worstFrame':worst,'maxConnectionGapMeters':maxgap,'neutralSurfaceErrorMeters':neutralerror,'geometryAndWeightsUnchanged':True,'productionGLBChanged':False}
(REPORT/'validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
