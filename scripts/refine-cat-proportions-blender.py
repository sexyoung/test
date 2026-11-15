"""Blender proportion pass based on user-provided natural-standing side views.
Run after head skin transfer. Preserve standalone sculpts and original rig data.
"""
import bpy,bmesh,json,struct,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'public/models/cat/runner-approved-head.glb'
raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);data=bytearray(raw[28+n:])
assert not doc['asset'].get('extras',{}).get('sideReferenceProportions'),'Rebuild before repeating proportion pass'
def read(index):
 a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']];w={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']];f={5126:'f',5123:'H',5125:'I',5121:'B'}[a['componentType']];o=v.get('byteOffset',0)+a.get('byteOffset',0);s=v.get('byteStride',struct.calcsize(f)*w)
 return a,o,s,[list(struct.unpack_from('<'+f*w,data,o+i*s))for i in range(a['count'])]
def write(attr,values,bounds=True):
 a,o,s,_=read(attr)
 for i,p in enumerate(values):struct.pack_into('<fff',data,o+i*s,*p)
 if bounds:
  a['min']=[min(v[k]for v in values)for k in range(3)];a['max']=[max(v[k]for v in values)for k in range(3)]
def key(v):return tuple(round(x,7)for x in v)
def smooth(a,b,x):
 t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
def bodywarp(p,tail=0):
 x,y,z=p
 # Longer lower limbs with continuous support for the ribcage/head above them.
 Y=y+.018*smooth(.025,.145,y)
 torso=smooth(.085,.14,y)*smooth(-.195,-.145,x)*(1-smooth(.105,.17,x))
 belly=(1-smooth(.13,.19,y))*smooth(.085,.115,y)
 waist=math.exp(-((x+.025)/.09)**2)
 Y+=.010*belly*waist*torso
 Z=z*(1-.11*torso)
 # Slightly round the shoulder/back cross section, retaining planar facets.
 Y-=.004*smooth(.185,.225,y)*min(1,(abs(z)/.052)**2)*torso
 paw=1-smooth(.018,.045,y)
 Z*=1+.16*paw
 X=x+.004*paw
 if tail>0:
  t=max(0,min(1,(-x-.15)/.24));taper=.72-.25*t
  X+=tail*(x+.15)*(-.08)
  Y+=tail*((y-.213)*(taper-1)+.038*math.sin(t*math.pi*.75))
  Z+=tail*z*(taper-1)
 return Vector((X,Y,Z))
HEAD_CENTER=Vector((.190,.242,0))
def headwarp(p):
 q=Vector(p)-HEAD_CENTER
 q.x*=1.16;q.y*=1.14;q.z*=1.12
 q+=HEAD_CENTER
 q.y+=.023
 return q
# Identify the existing head/body attachment boundaries by coincident position.
body_map,head_map={},{}
records=[]
for mesh in doc['meshes']:
 p=mesh['primitives'][0];a=p['attributes'];pos=read(a['POSITION'])[3]
 si=read(a['JOINTS_0'])[3];sw=read(a['WEIGHTS_0'])[3]
 part=mesh.get('extras',{}).get('headPart');ishead=mesh.get('extras',{}).get('approvedCatHead',False)
 if part=='neck-seam':neck=(mesh,pos);continue
 result=[]
 for v,ii,ww in zip(pos,si,sw):
  tail=sum(w for i,w in zip(ii,ww)if 25<=i<=29)
  q=headwarp(v)if ishead else bodywarp(v,tail)
  (head_map if ishead else body_map)[key(v)]=q.copy();result.append(q)
 records.append((mesh,pos,result,ishead))
mesh,pos=neck
bm=bmesh.new();verts={}
for v in pos:
 if key(v)not in verts:verts[key(v)]=bm.verts.new(v)
for i in range(0,len(pos),3):bm.faces.new([verts[key(v)]for v in pos[i:i+3]])
for k,v in verts.items():
 if k in head_map:v.co=head_map[k]
 elif k in body_map:v.co=body_map[k]
 else:v.co=(bodywarp(v.co)+headwarp(v.co))*.5
boundary=[v for v in bm.verts if v.is_boundary];pinned={v:v.co.copy()for v in boundary}
interior=[v for v in bm.verts if not v.is_boundary]
bmesh.ops.smooth_vert(bm,verts=interior,factor=.18,use_axis_x=True,use_axis_y=True,use_axis_z=True)
assert all((v.co-pinned[v]).length==0 for v in boundary)
result=[verts[key(v)].co.copy()for v in pos]
records.append((mesh,pos,result,False))
# Transform morph offsets consistently at coincident attachment vertices.
for mesh,pos,result,ishead in records:
 p=mesh['primitives'][0];a=p['attributes'];write(a['POSITION'],result)
 for target in p.get('targets',[]):
  old=read(target['POSITION'])[3];delta=[]
  for v,d in zip(pos,old):
   k=key(v)
   if ishead or k in head_map:delta.append(Vector((d[0]*1.16,d[1]*1.14,d[2]*1.12)))
   elif k in body_map:delta.append(Vector(d))
   else:delta.append(Vector((d[0]*1.08,d[1]*1.07,d[2]*1.06)))
  write(target['POSITION'],delta)
 # Recalculate facet normals in Blender after silhouette changes.
 inds=[i[0]for i in read(p['indices'])[3]]if 'indices'in p else list(range(len(result)))
 normals=[Vector((0,0,0))for _ in result]
 for t in range(0,len(inds),3):
  i,j,k=inds[t:t+3];normal=(result[j]-result[i]).cross(result[k]-result[i])
  assert normal.length>1e-13
  for v in [i,j,k]:normals[v]+=normal
 for normal in normals:normal.normalize()
 write(a['NORMAL'],normals,False)
bm.free()
report={'tool':'Blender '+bpy.app.version_string,'headScale':[1.16,1.14,1.12],
 'legAndBodyLift':.018,'tailRadialScaleRootToTip':[.72,.47],'tailArc':.038,
 'reference':'user natural-standing side illustration; no medical body-wasting features copied',
 'skinAndAnimationBuffers':'unchanged','standaloneHeadFiles':'unchanged'}
doc['asset'].setdefault('extras',{})['sideReferenceProportions']=report
encoded=json.dumps(doc,ensure_ascii=False,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(data))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(data),0x004e4942)+data)
print(json.dumps(report,indent=2))
