"""Localized two-segment ear expressions over the preserved connected runner.
Old broad ear influence follows the head during the run; redistribute it to
head/ear-only controls, preserving the neutral skin and existing run action.
"""
import bpy,json,math
from pathlib import Path
from mathutils import Matrix,Vector
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'public/models/cat/runner-connected-rig.blend'
OUT=ROOT/'public/models/cat/runner-ear-controls.blend'
REPORT=ROOT/'bench/out/approved-head/ear-controls';REPORT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE')
if bpy.context.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
meshes=[o for o in scene.objects if o.type=='MESH' and any(m.type=='ARMATURE'for m in o.modifiers)]
action=rig.animation_data.action;slot=rig.animation_data.action_slot
oldnames={'L':('ear_left_07','ear_left_end_028'),'R':('ear_right_06','ear_right_end_027')}
frames=[i*.15 for i in range(241)]
def setframe(f):scene.frame_set(math.floor(f),subframe=f%1)
def positions():
 dg=bpy.context.evaluated_depsgraph_get()
 return np.asarray([tuple(o.matrix_world@v.co)for o in meshes for v in o.evaluated_get(dg).data.vertices])
baseline=[]
for f in frames:setframe(f);baseline.append(positions())
rig.animation_data.action=None
for p in rig.pose.bones:p.matrix_basis=Matrix.Identity(4)
bpy.context.view_layer.update();neutral=positions()
original_coords={o.name:[tuple(v.co)for v in o.data.vertices]for o in meshes}
original_weights={o.name:[{o.vertex_groups[g.group].name:g.weight for g in v.groups}for v in o.data.vertices]for o in meshes}
original_morphs={o.name:[[tuple(v.co)for v in k.data]for k in o.data.shape_keys.key_blocks]if o.data.shape_keys else []for o in meshes}
# Reuse the existing terminal ear bones as real deforming ear-body segments.
# Two unweighted mount bones provide a visible head -> ear-root connection.
bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
for side,(rootname,tipname)in oldnames.items():
 root=rig.data.edit_bones[rootname];tip=rig.data.edit_bones[tipname]
 a=root.head.copy();c=tip.tail.copy();b=a.lerp(c,.55)
 root.tail=b;tip.head=b;tip.tail=c;tip.use_deform=True;tip.parent=root;tip.use_connect=True
 mount=rig.data.edit_bones.new('ear_mount.'+side);mount.head=rig.data.edit_bones['head_05'].head;mount.tail=a
 mount.parent=rig.data.edit_bones['head_05'];mount.use_connect=False;mount.use_deform=False
 root.parent=mount;root.use_connect=True
 # Local X pitches the ear forward/back; local Z spreads it sideways.
 forward=rig.matrix_world.inverted().to_3x3()@Vector((0,-1,0))
 for b in [root,tip,mount]:b.align_roll(forward)
 root.name='ear_root.'+side;tip.name='ear_body.'+side
bpy.ops.object.mode_set(mode='OBJECT')
newaction=action.copy();newaction.name='run - expressive ears'
remove={n for pair in oldnames.values()for n in pair}|{'ear_root.L','ear_root.R','ear_body.L','ear_body.R'}
for layer in newaction.layers:
 for strip in layer.strips:
  for bag in strip.channelbags:
   for fc in list(bag.fcurves):
    if any(fc.data_path.startswith('pose.bones["'+n+'"]')for n in remove):bag.fcurves.remove(fc)
for p in rig.pose.bones:p.matrix_basis=Matrix.Identity(4)
def smooth(a,b,x):
 t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
protected=[];ear_sets={'L':[],'R':[]};offset=0
for o in meshes:
 groups={g.name:g for g in o.vertex_groups}
 for n in ['head_05','ear_root.L','ear_root.R','ear_body.L','ear_body.R']:
  if n not in groups:groups[n]=o.vertex_groups.new(name=n)
 for v,weights in zip(o.data.vertices,original_weights[o.name]):
  w=o.matrix_world@v.co;f,h,s=-w.y,w.z-.013619639910757542,w.x
  mask=smooth(.294,.306,h)*smooth(.016,.028,abs(s))*smooth(.165,.177,f)*(1-smooth(.193,.21,f))
  if mask<1e-8:protected.append(offset+v.index)
  side='L'if s>0 else'R'
  if mask>.01:ear_sets[side].append(offset+v.index)
  total=weights.get('head_05',0)+sum(weights.get(n,0)for pair in oldnames.values()for n in pair)
  # All old ear-weighted face vertices return to head control. The ear region
  # receives a smooth root/body blend; unrelated neck/body influences stay intact.
  for n in ['ear_root.L','ear_root.R','ear_body.L','ear_body.R']:
   groups[n].remove([v.index])
  groups['head_05'].add([v.index],total*(1-mask),'REPLACE')
  blend=smooth(.306,.322,h)
  if mask>0:
   groups['ear_root.'+side].add([v.index],total*mask*(1-blend),'REPLACE')
   groups['ear_body.'+side].add([v.index],total*mask*blend,'REPLACE')
 offset+=len(o.data.vertices)
# Six keyframeable controls layer on top of the run instead of replacing it.
collection=rig.data.collections.new('Ear expression controls')
for side in ['L','R']:
 sign=-1 if side=='L'else 1
 for prop,limits,description in [('spread',(-15,65),'Spread the ear outward; degrees'),('tilt',(-45,35),'Positive faces forward, negative faces back; degrees'),('fold',(0,25),'Bend the upper ear outward; degrees')]:
  name=f'ear_{prop}_{side}';rig[name]=0.0;rig.id_properties_ui(name).update(min=limits[0],max=limits[1],soft_min=limits[0],soft_max=limits[1],description=description)
 for bone,axis,prop,factor in [('ear_root.'+side,0,'tilt',1),('ear_root.'+side,2,'spread',sign),('ear_body.'+side,2,'fold',sign)]:
  p=rig.pose.bones[bone];p.rotation_mode='XYZ'
  fc=p.driver_add('rotation_euler',axis);d=fc.driver;d.type='SCRIPTED'
  v=d.variables.new();v.name='angle';v.type='SINGLE_PROP';v.targets[0].id=rig;v.targets[0].data_path=f'["ear_{prop}_{side}"]'
  d.expression=f'angle*{math.pi/180*factor:.17g}'
 for n in ['ear_mount.'+side,'ear_root.'+side,'ear_body.'+side]:collection.assign(rig.data.bones[n])
 for name in ['ear_root.'+side,'ear_body.'+side]:rig.pose.bones[name].lock_location=(True,True,True);rig.pose.bones[name].lock_scale=(True,True,True)
PRESETS={'neutral':(0,0,0),'airplane':(55,-10,18),'forward':(5,25,0),'back':(20,-35,10)}
rig['ear_presets']=json.dumps(PRESETS)
rig['ear_control_notes']='Keyframe ear_spread_L/R, ear_tilt_L/R, ear_fold_L/R in Object custom properties. Zero keeps the approved run. Six degree-valued controls.'
def preset(values,only=None):
 for side in ['L','R']:
  for prop,value in zip(['spread','tilt','fold'],values if only is None or side==only else (0,0,0)):rig[f'ear_{prop}_{side}']=value
 rig.update_tag();bpy.context.view_layer.update()
preset((0,0,0));rig.animation_data.action=newaction
maxerror=0
for f,expected in zip(frames,baseline):
 setframe(f);maxerror=max(maxerror,float(np.max(np.linalg.norm(positions()-expected,axis=1))))
assert maxerror<.000003,('Run changed',maxerror)
rig.animation_data.action=None
for p in rig.pose.bones:p.matrix_basis=Matrix.Identity(4)
preset((0,0,0));newneutral=positions();neutralerror=float(np.max(np.linalg.norm(newneutral-neutral,axis=1)))
assert neutralerror<.000002,neutralerror
results={}
for name,values in PRESETS.items():
 preset(values);current=positions();delta=np.linalg.norm(current-newneutral,axis=1)
 face=float(np.max(delta[protected]));assert face<.000002,(name,'face moved',face)
 results[name]={'protectedFaceAndBodyMaxMotionMeters':face,'leftEarMaxMotionMeters':float(np.max(delta[ear_sets['L']])),'rightEarMaxMotionMeters':float(np.max(delta[ear_sets['R']]))}
for side in ['L','R']:
 preset(PRESETS['airplane'],only=side);delta=np.linalg.norm(positions()-newneutral,axis=1)
 opposite='R'if side=='L'else'L';err=float(np.max(delta[ear_sets[opposite]]));assert err<.000002,(side,'opposite ear moved',err)
 results['independent_'+side]={'oppositeEarMaxMotionMeters':err,'controlledEarMaxMotionMeters':float(np.max(delta[ear_sets[side]]))}
# Confirm expression controls also isolate the face while the original run plays.
rig.animation_data.action=newaction
combined_error=0
for f in [0,4.5,9,13.5,18,22.5,27,31.5,36]:
 preset((0,0,0));setframe(f);zero=positions()
 for name,values in PRESETS.items():
  preset(values);delta=np.linalg.norm(positions()-zero,axis=1);combined_error=max(combined_error,float(np.max(delta[protected])))
assert combined_error<.000002,combined_error
for o in meshes:
 assert original_coords[o.name]==[tuple(v.co)for v in o.data.vertices]
 assert original_morphs[o.name]==([[tuple(v.co)for v in k.data]for k in o.data.shape_keys.key_blocks]if o.data.shape_keys else [])
# A small readme lives in the blend so the six controls and presets are findable.
readme=bpy.data.texts.new('EAR CONTROLS - READ ME')
readme.write('Select Cat Rig, Object Properties > Custom Properties. Keyframe the six ear_* controls.\nSpread = outward opening; Tilt = forward/back; Fold = upper-ear bend. Degrees.\nPresets (spread, tilt, fold), applied to both L/R:\n'+json.dumps(PRESETS,indent=2)+'\nThe run action remains active. Setting all controls to 0 restores neutral ears.\n')
preset((0,0,0));setframe(9)
rig.hide_set(False);rig.show_in_front=True;bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='POSE');bpy.ops.pose.select_all(action='SELECT')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT))
report={'source':str(SOURCE),'output':str(OUT),'bones':len(rig.data.bones),'runSamples':len(frames),'maxRunSurfaceErrorMeters':maxerror,'neutralSurfaceErrorMeters':neutralerror,'expressionDuringRunProtectedFaceMaxMotionMeters':combined_error,'presets':results,'protectedVertices':len(protected),'earRegionVertices':{s:len(v)for s,v in ear_sets.items()},'geometryAndMorphsUnchanged':True,'productionGLBChanged':False}
(REPORT/'validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
