"""Create an anatomically fitted Blender rig while preserving the accepted skin motion.
Rebase every animated bone matrix when changing its rest frame; validate subframes.
The approved production GLB is never overwritten by this editing conversion.
"""
import bpy, json, math, hashlib
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'bench/out/approved-head/runner-uncolored-head.glb'
OUT=ROOT/'public/models/cat/runner-editable-rig.blend'
REPORT=ROOT/'bench/out/approved-head/skeleton-refined'
REPORT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE),guess_original_bind_pose=False,disable_bone_shape=True)
scene=bpy.context.scene
rig=next(o for o in scene.objects if o.type=='ARMATURE')
rig.name='Cat Rig';rig.show_in_front=True;rig.data.display_type='OCTAHEDRAL'
meshes=[o for o in scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)]
oldaction=rig.animation_data.action;oldslot=rig.animation_data.action_slot
oldrest={b.name:b.matrix_local.copy()for b in rig.data.bones}
names=[b.name for b in rig.data.bones]
parents={b.name:b.parent.name if b.parent else None for b in rig.data.bones}
start,end=map(float,oldaction.frame_range)
assert abs(end-start-36)<.01
# Sample at 192 Hz (8 samples per original 24 fps frame). Midpoint validation
# checks interpolation independently from the baked key times.
step=1/8
frames=[start+i*step for i in range(round((end-start)/step)+1)]
checks=[start+(i+.5)*step for i in range(round((end-start)/step))]
def setframe(f):scene.frame_set(math.floor(f),subframe=f%1)
def positions():
 dg=bpy.context.evaluated_depsgraph_get();out=[]
 for o in meshes:
  e=o.evaluated_get(dg)
  out.extend(tuple(e.matrix_world@v.co)for v in e.data.vertices)
 return np.asarray(out)
pose_samples=[]
for f in frames:
 setframe(f);pose_samples.append({p.name:p.matrix.copy()for p in rig.pose.bones})
baseline=[]
for f in checks:setframe(f);baseline.append(positions())
# Neutral geometry / morph blocks remain bit-for-bit unchanged after this import.
rig.animation_data.action=None
for p in rig.pose.bones:p.matrix_basis=Matrix.Identity(4)
bpy.context.view_layer.update();neutral_before=positions()
mesh_data={o.name:[v.co.copy()for v in o.data.vertices]for o in meshes}
# Design coordinates are forward, height above original origin, lateral.
# They were measured against the approved mesh, not the obsolete source body.
inv=rig.matrix_world.inverted();ground=.013619639910757542
def point(f,h,s=0):return inv@Vector((s,-f,h+ground))
heads={
 '_rootJoint':(-.11,.192,0),'pelvis_01':(-.125,.211,0),
 'body_1_02':(-.065,.215,0),'body_2_03':(.045,.216,0),
 'neck_04':(.121,.232,0),'head_05':(.184,.259,0),
 'tail_1_020':(-.144,.226,0),'tail_2_021':(-.177,.237,0),
 'tail_3_022':(-.248,.2635,0),'tail_4_023':(-.304,.269,0),
 'tail_4_end_032':(-.357,.262,0),
}
for side,sign in [('right',-1),('left',1)]:
 ear='ear_right_06'if side=='right'else'ear_left_07';endear='ear_right_end_027'if side=='right'else'ear_left_end_028'
 heads[ear]=(.182,.296,sign*.038);heads[endear]=(.182,.319,sign*.048)
 front=[f'leg_front_{side}_{s}'for s in (['1_08','2_09','3_010','4_011','4_end_029']if side=='right'else['1_012','2_013','3_014','4_015','4_end_030'])]
 back=[f'leg_back_{side}_{s}'for s in (['1_00','2_024','3_025','4_026','4_end_033']if side=='right'else['1_016','2_017','3_018','4_019','4_end_031'])]
 for name,p in zip(front,[(.129,.168,sign*.030),(.101,.102,sign*.026),(.105,.031,sign*.028),(.119,.011,sign*.029),(.132,.009,sign*.030)]):heads[name]=p
 for name,p in zip(back,[(-.10,.187,sign*.031),(-.124,.102,sign*.026),(-.139,.063,sign*.027),(-.104,.012,sign*.029),(-.089,.008,sign*.029)]):heads[name]=p
# Target one child along the main chain. Branches keep their own anatomical roots.
tips={}
for b in rig.data.bones:
 children=[c.name for c in b.children]
 if b.name=='_rootJoint':tips[b.name]=(-.11,.207,0)
 elif b.name=='head_05':tips[b.name]=(.222,.253,0)
 elif children:tips[b.name]=heads[children[0]]
 else:
  f,h,s=heads[b.name]
  if b.name.startswith('ear_'):tips[b.name]=(f,h+.003,s+math.copysign(.001,s))
  elif b.name.startswith('tail_'):tips[b.name]=(-.362,.261,0)
  else:tips[b.name]=(f+.003,h,s)
# Fit the chain through the *animated* skin too. A rest-only adjustment can
# still put a joint outside a bent paw. Project shared junctions inward across
# 73 sampled poses, using each bone's original deformation field.
verts_offset=0;polygons=[]
for o in meshes:
 if 'Iris' not in o.name:
  polygons.extend(tuple(verts_offset+i for i in p.vertices)for p in o.data.polygons)
 verts_offset+=len(o.data.vertices)
fit_cases=[(BVHTree.FromPolygons([Vector(v)for v in neutral_before],polygons),{n:Matrix.Identity(4)for n in names})]
rig.animation_data.action=oldaction;rig.animation_data.action_slot=oldslot
for idx in range(0,len(checks),4):
 setframe(checks[idx]);ds={n:rig.matrix_world@rig.pose.bones[n].matrix@oldrest[n].inverted()@inv for n in names}
 for n in names:
  if '_end_'in n:ds[n]=ds[parents[n]]
 fit_cases.append((BVHTree.FromPolygons([Vector(v)for v in baseline[idx]],polygons),ds))
rig.animation_data.action=None
for p in rig.pose.bones:p.matrix_basis=Matrix.Identity(4)
bpy.context.view_layer.update()
variables={n:rig.matrix_world@point(*v)for n,v in heads.items()}
references={}
for b in rig.data.bones:
 n=b.name
 if b.children and n not in ['_rootJoint','head_05']:references[n]=b.children[0].name
 else:references[n]=n+' tip';variables[references[n]]=rig.matrix_world@point(*tips[n])
startvars={k:v.copy()for k,v in variables.items()}
fit_error=0
for iteration in range(240):
 fit_error=0
 for n in names:
  endkey=references[n];aa=variables[n];bb=variables[endkey];worst=None
  for tree,matrices in fit_cases:
   m=matrices[n];a=m@aa;b=m@bb
   for t in [i/20 for i in range(21)]:
    q=a.lerp(b,t);near,normal,_,_=tree.find_nearest(q)
    signed=(q-near).dot(normal)+.0008
    # The source has a few overlapping/internal faces. A positive nearest-face
    # normal alone misclassifies these interiors; confirm outside with rays.
    if signed>.0008:
     inside=0
     for direction in [Vector((1,.173,.317)).normalized(),Vector((.213,1,.371)).normalized(),Vector((.113,.219,1)).normalized()]:
      origin=q.copy();hits=0
      for _ in range(40):
       hit,_,_,_=tree.ray_cast(origin,direction)
       if hit is None:break
       hits+=1;origin=hit+direction*1e-6
      inside+=hits%2
     if inside>=2:continue
    if signed>0 and (worst is None or signed>worst[0]):worst=(signed,t,normal,m)
  if worst:
   error,t,normal,m=worst;fit_error=max(fit_error,error)
   correction=m.to_3x3().inverted()@(-normal*min(error,.006)*.65)
   denom=(1-t)**2+t*t
   variables[n]+=correction*((1-t)/denom);variables[endkey]+=correction*(t/denom)
 if fit_error<.00012:break
print('Animated skeleton fit',iteration,fit_error,flush=True)
def design(w):return (-w.y,w.z-ground,w.x)
heads={n:design(variables[n])for n in names}
tips={n:design(variables[references[n]])for n in names}
bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for b in rig.data.edit_bones:
 b.use_connect=False;b.head=point(*heads[b.name]);b.tail=point(*tips[b.name])
 # Retain old roll as closely as possible. No geometry or vertex weights change.
 b.align_roll(oldrest[b.name].to_3x3().col[2])
 if '_end_'in b.name:b.use_deform=False
bpy.ops.object.mode_set(mode='OBJECT')
newrest={b.name:b.matrix_local.copy()for b in rig.data.bones}
# P_new B_new^-1 = P_old B_old^-1 exactly at each sampled frame.
correction={n:oldrest[n].inverted()@newrest[n]for n in names}
action=bpy.data.actions.new('run');rig.animation_data.action=action
lastq={}
for f,poses in zip(frames,pose_samples):
 target={n:poses[n]@correction[n]for n in names}
 for n in names:
  p=rig.pose.bones[n];par=parents[n]
  if '_end_'in n:
   # Unweighted terminal markers follow the fitted tip, rather than the bogus
   # imported origin/0.01 scale. They carry no original animation channels.
   assert not any(g.weight>1e-8 for o in meshes if n in o.vertex_groups for v in o.data.vertices for g in v.groups if g.group==o.vertex_groups[n].index)
   target[n]=target[par]@newrest[par].inverted()@newrest[n]
  kw={'parent_matrix':target[par],'parent_matrix_local':newrest[par]}if par else{}
  local=p.bone.convert_local_to_pose(target[n],newrest[n],invert=True,**kw)
  loc,q,scale=local.decompose()
  if n in lastq and lastq[n].dot(q)<0:q.negate()
  lastq[n]=q.copy();p.rotation_mode='QUATERNION';p.location=loc;p.rotation_quaternion=q;p.scale=scale
  p.keyframe_insert('location',frame=f,group=n);p.keyframe_insert('rotation_quaternion',frame=f,group=n);p.keyframe_insert('scale',frame=f,group=n)
for layer in action.layers:
 for strip in layer.strips:
  for bag in strip.channelbags:
   for fc in bag.fcurves:
    for k in fc.keyframe_points:k.interpolation='LINEAR'
oldaction.name='Source run - archived';oldaction.use_fake_user=True
action.name='run'
maxerror=0;worst=0
for f,expected in zip(checks,baseline):
 setframe(f);err=float(np.max(np.linalg.norm(positions()-expected,axis=1)))
 if err>maxerror:maxerror=err;worst=f
assert maxerror<.00005,('Animated surface moved',maxerror,worst)
rig.animation_data.action=None
for p in rig.pose.bones:p.matrix_basis=Matrix.Identity(4)
bpy.context.view_layer.update();neutralerror=float(np.max(np.linalg.norm(positions()-neutral_before,axis=1)))
assert neutralerror<.000002,neutralerror
for o in meshes:assert all((v.co-p).length==0 for v,p in zip(o.data.vertices,mesh_data[o.name]))
# Weld the exterior for the editable asset, as in the previous approved blend.
bpy.ops.object.select_all(action='DESELECT')
skins=[o for o in meshes if o.name in ['Object_9','Approved_Head','Approved_Neck_Seam']]
for o in skins:o.select_set(True)
bpy.context.view_layer.objects.active=next(o for o in skins if o.name=='Approved_Head')
bpy.ops.object.join();cat=bpy.context.object;cat.name='Cat - continuous head neck body'
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=.000001);bpy.ops.object.mode_set(mode='OBJECT')
for poly in cat.data.polygons:poly.use_smooth=False
for o in scene.objects:
 if o.type=='MESH':o.show_wire=False;o.show_all_edges=False
rig['rig_edit']='Anatomical rest-frame rebase, 35 bones; ear, tail and paw endpoints inside approved neutral mesh; original surface motion preserved'
rig['run_max_world_vertex_error_m']=maxerror
rig['neutral_max_world_vertex_error_m']=neutralerror
rig['source_glb_sha256']=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
# Open on the retained run action, ready to play or edit in the action editor.
rig.animation_data.action=action
scene.frame_start=0;scene.frame_end=36;scene.render.fps=24
setframe(12)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
rig.hide_set(False);bpy.ops.object.mode_set(mode='POSE');bpy.ops.pose.select_all(action='SELECT')
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type=='VIEW_3D':
   s=area.spaces.active;s.show_region_ui=False;s.overlay.show_extras=True;s.overlay.show_relationship_lines=False;s.overlay.show_floor=False;s.overlay.show_axis_x=False;s.overlay.show_axis_y=False
   s.region_3d.view_distance=.85;s.region_3d.view_location=(0,-.06,.18);s.region_3d.view_rotation=Vector((1,-.55,.25)).to_track_quat('Z','Y');s.region_3d.view_perspective='ORTHO'
   s.shading.color_type='SINGLE';s.shading.single_color=(.48,.50,.53);s.shading.background_type='VIEWPORT';s.shading.background_color=(.055,.065,.08)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT))
report={'source':str(SOURCE),'output':str(OUT),'bones':len(rig.data.bones),'animation':'run','durationSeconds':1.5,'bakedSamples':len(frames),'independentSubframeChecks':len(checks),'maxAnimatedSurfaceErrorMeters':maxerror,'worstFrame':worst,'neutralSurfaceErrorMeters':neutralerror,'meshCoordinatesChanged':False,'morphsPreserved':True,'productionGLBChanged':False,'heads':heads,'tips':tips}
(REPORT/'validation.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items()if k not in ['heads','tips']},indent=2))
