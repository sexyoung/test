"""Blender geometry edit with fixed attachment boundaries and untouched rig data.
Run after attach-approved-cat-head.py:
  blender --background --python scripts/refine-cat-neck-blender.py
Head, neck and upper shoulder positions are edited in Blender; animation,
skin, morph deltas and the two standalone head files remain unchanged.
"""
import bpy
import bmesh
from mathutils import Vector
from pathlib import Path
import json
import struct

ROOT=Path(__file__).resolve().parents[1]
PATH=ROOT/'public/models/cat/runner-approved-head.glb'
raw=PATH.read_bytes()
n=struct.unpack_from('<I',raw,12)[0]
doc=json.loads(raw[20:20+n])
data=bytearray(raw[28+n:])
if doc['asset'].get('extras',{}).get('blenderNeckRefinement'):
    raise RuntimeError('Already refined. Rebuild from sources before running this edit again.')
HEAD_SHIFT=Vector((-.032,-.004,0))
key=lambda v:tuple(round(x,7) for x in v)
def read_attribute(primitive,name):
    a=doc['accessors'][primitive['attributes'][name]]
    view=doc['bufferViews'][a['bufferView']]
    offset=view.get('byteOffset',0)+a.get('byteOffset',0)
    stride=view.get('byteStride',12)
    return a,offset,stride,[Vector(struct.unpack_from('<fff',data,offset+i*stride)) for i in range(a['count'])]
def write_positions(a,offset,stride,positions):
    for i,p in enumerate(positions):struct.pack_into('<fff',data,offset+i*stride,*p)
    a['min']=[min(p[k] for p in positions) for k in range(3)]
    a['max']=[max(p[k] for p in positions) for k in range(3)]
def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
head_points,body_points={},{}
for mesh in doc['meshes']:
    if mesh['name']=='Approved_Neck_Seam':continue
    primitive=mesh['primitives'][0]
    pa,po,ps,positions=read_attribute(primitive,'POSITION')
    is_head=mesh.get('extras',{}).get('approvedCatHead',False)
    result=[]
    for p in positions:
        # Translate the whole approved face and both eyes together. Relax the
        # upper shoulder a little so the shortened nape meets the back naturally.
        delta=HEAD_SHIFT if is_head else Vector((0,-.008*smooth(.10,.16,p.x)*smooth(.17,.23,p.y),0))
        q=p+delta
        (head_points if is_head else body_points)[key(p)]=q.copy()
        result.append(q)
    write_positions(pa,po,ps,result)
mesh=next(m for m in doc['meshes'] if m['name']=='Approved_Neck_Seam')
primitive=mesh['primitives'][0]
pa,po,ps,positions=read_attribute(primitive,'POSITION')
na,no,ns,normals=read_attribute(primitive,'NORMAL')
bm=bmesh.new()
unique={}
for p in positions:
    if key(p) not in unique: unique[key(p)]=bm.verts.new(p)
for i in range(0,len(positions),3):
    bm.faces.new([unique[key(p)] for p in positions[i:i+3]])
bm.normal_update()
interior=[v for v in bm.verts if not v.is_boundary]
boundary=[v for v in bm.verts if v.is_boundary]
before={v:v.co.copy() for v in bm.verts}
# Move the pinned attachment boundaries with the edited head/shoulder. The
# middle neck follows their blend before sculpting a concave throat profile.
for v in bm.verts:
    k=key(v.co)
    if k in head_points:v.co=head_points[k]
    elif k in body_points:v.co=body_points[k]
    else:
        v.co+=HEAD_SHIFT*.5
        # Bring the underside back under the jaw, instead of a diagonal slab.
        underside=1-smooth(.188,.214,before[v].y)
        v.co.x-=.013*underside
        v.co.y+=.007*underside
pinned={v:v.co.copy() for v in boundary}
for _ in range(2):
    bmesh.ops.smooth_vert(bm,verts=interior,factor=.16,use_axis_x=True,use_axis_y=True,use_axis_z=True)
bm.normal_update()
assert all((v.co-pinned[v]).length==0 for v in boundary)
result=[unique[key(p)].co.copy() for p in positions]
max_move=max((v.co-before[v]).length for v in interior)
for i,p in enumerate(result): struct.pack_into('<fff',data,po+i*ps,*p)
for i in range(0,len(result),3):
    a,b,c=result[i:i+3]
    normal=(b-a).cross(c-a).normalized()
    assert normal.length>.9
    for j in range(3): struct.pack_into('<fff',data,no+(i+j)*ns,*normal)
pa['min']=[min(p[k] for p in result) for k in range(3)]
pa['max']=[max(p[k] for p in result) for k in range(3)]
report={'tool':'Blender '+bpy.app.version_string,'interiorVerticesEdited':len(interior),
        'pinnedBoundaryVertices':len(boundary),'maxBindSpaceDisplacement':max_move,
        'headTranslation':list(HEAD_SHIFT),'method':'head moved toward shoulders; nape lowered; underside tucked behind jaw; two constrained relaxation passes',
        'animationSkinAndMorphBuffers':'unchanged'}
doc['asset'].setdefault('extras',{})['blenderNeckRefinement']=report
encoded=json.dumps(doc,ensure_ascii=False,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
result_bytes=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(data))
result_bytes+=struct.pack('<II',len(encoded),0x4e4f534a)+encoded
result_bytes+=struct.pack('<II',len(data),0x004e4942)+data
PATH.write_bytes(result_bytes)
bm.free()
print(json.dumps(report,indent=2))
