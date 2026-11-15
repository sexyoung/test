import bpy,json,math,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
from mathutils import Vector
from mathutils import Matrix
from mathutils.bvhtree import BVHTree
connected='--connected' in sys.argv
ears='--ears' in sys.argv
asset='runner-ear-controls.blend' if ears else ('runner-connected-rig.blend' if connected else 'runner-editable-rig.blend')
output='ear-controls' if ears else ('skeleton-connected' if connected else 'skeleton-refined')
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'public/models/cat'/asset))
r=bpy.data.objects['Cat Rig'];scene=bpy.context.scene
ms=[o for o in scene.objects if o.type=='MESH' and 'Iris' not in o.name]
action=r.animation_data.action
results={}
samples=[(None,f) for f in [None]+[i*.3 for i in range(121)]]
if ears:
 presets=json.loads(r['ear_presets'])
 samples += [(name,f) for name in presets if name!='neutral' for f in [None,0,9,18,27,36]]
for expression,f in samples:
 if ears:
  values=presets[expression or 'neutral']
  for side in ['L','R']:
   for prop,value in zip(['spread','tilt','fold'],values):r[f'ear_{prop}_{side}']=value
  r.update_tag()
 if f is None:
  r.animation_data.action=None
  for p in r.pose.bones:p.matrix_basis=Matrix.Identity(4)
  bpy.context.view_layer.update()
 else:
  r.animation_data.action=action;scene.frame_set(int(f),subframe=f%1)
 dg=bpy.context.evaluated_depsgraph_get();verts=[];faces=[]
 for o in ms:
  evaluated=o.evaluated_get(dg);m=evaluated.to_mesh();n=len(verts);verts.extend(o.matrix_world@v.co for v in m.vertices);faces.extend(tuple(n+i for i in p.vertices)for p in m.polygons);evaluated.to_mesh_clear()
 bvh=BVHTree.FromPolygons(verts,faces)
 for p in r.pose.bones:
  a=r.matrix_world@p.head;b=r.matrix_world@p.tail
  for k in range(21):
   q=a.lerp(b,k/20);near,normal,idx,d=bvh.find_nearest(q);signed=(q-near).dot(normal)
   votes=0
   if signed>0:
    for direction in [Vector((1,.173,.317)).normalized(),Vector((.213,1,.371)).normalized(),Vector((.113,.219,1)).normalized()]:
     origin=q.copy();hits=0
     for _ in range(40):
      hit,_,_,_=bvh.ray_cast(origin,direction)
      if hit is None:break
      hits+=1;origin=hit+direction*1e-6
     votes+=hits%2
   if signed>results.get(p.name,{}).get('outside',0) and votes<2:results[p.name]={'outside':signed,'frame':f,'expression':expression,'segment':k/20,'point':list(q)}
report={'poses':len(samples),'bones':len(r.pose.bones),'samplesPerBone':21,'outside':results,'note':'Bone centerlines tested against the evaluated exterior; nearest-face signs confirmed by three ray directions because the source contains overlapping faces.'}
print(json.dumps(report,indent=2))
(ROOT/'bench/out/approved-head'/output/'containment.json').write_text(json.dumps(report,indent=2))
assert not results, 'Bone segments outside the animated skin'
