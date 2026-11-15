"""Transfer original runner head skin in Blender; harmonically join neck weights.
Run after geometry refinement. Source rig and animation bytes are untouched.
"""
import bpy, json, struct
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc
from collections import defaultdict
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'public/models/cat/runner-approved-head.glb'
def load(path):
 raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0]
 return json.loads(raw[20:20+n]),bytearray(raw[28+n:])
def read(doc,data,index):
 a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
 width={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']];fmt={5121:'B',5123:'H',5125:'I',5126:'f'}[a['componentType']]
 offset=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',struct.calcsize(fmt)*width)
 return [list(struct.unpack_from('<'+fmt*width,data,offset+stride*i)) for i in range(a['count'])]
def write(doc,data,index,values):
 a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']];fmt={5123:'H',5126:'f'}[a['componentType']]
 width=4;offset=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',struct.calcsize(fmt)*width)
 for i,value in enumerate(values):struct.pack_into('<'+fmt*width,data,offset+i*stride,*value)
def skin(si,sw):return {i:w for i,w in zip(si,sw) if w>0}
def compact(w):
 pairs=sorted(w.items(),key=lambda p:(-p[1],p[0]))[:4];total=sum(v for _,v in pairs)
 pairs += [(0,0)]*(4-len(pairs));return [i for i,_ in pairs],[v/total for _,v in pairs]
def key(p):return tuple(round(x,7)for x in p)
source,sbin=load(ROOT/'public/models/lowpoly_cat_rig__run_animation.glb')
doc,data=load(path)
if doc['asset'].get('extras',{}).get('originalHeadSkinTransfer'):raise RuntimeError('Rebuild before reapplying skin transfer')
p=source['meshes'][0]['primitives'][0];a=p['attributes']
positions=read(source,sbin,a['POSITION']);si=read(source,sbin,a['JOINTS_0']);sw=read(source,sbin,a['WEIGHTS_0'])
indices=[i[0]for i in read(source,sbin,p['indices'])]
head_weight=[sum(w for i,w in zip(ii,ww)if i in [5,6,7,8,9])for ii,ww in zip(si,sw)]
triangles=[indices[i:i+3]for i in range(0,len(indices),3)if sum(head_weight[j]for j in indices[i:i+3])/3>.1]
bvh=BVHTree.FromPolygons([Vector(p)for p in positions],triangles,all_triangles=True)
body_weights,head_weights={},{}
for mesh in doc['meshes']:
 p=mesh['primitives'][0];a=p['attributes'];pos=read(doc,data,a['POSITION'])
 oldsi=read(doc,data,a['JOINTS_0']);oldsw=read(doc,data,a['WEIGHTS_0'])
 if mesh['name']=='Approved_Neck_Seam':continue
 if not mesh.get('extras',{}).get('approvedCatHead'):
  for v,ii,ww in zip(pos,oldsi,oldsw):body_weights[key(v)]=(ii,ww)
  continue
 newsi,newsw=[],[]
 for v in pos:
  # Register the larger sculpt's skull/eye/ear region to the original head in
  # bind space, undoing the deliberate head-to-shoulder placement offset.
  q=Vector((.195+(v[0]+.032-.176)*.91,v[1]-.020,v[2]))
  closest,normal,index,distance=bvh.find_nearest(q)
  ids=triangles[index];bary=poly_3d_calc([Vector(positions[i])for i in ids],closest)
  w=defaultdict(float)
  for i,fraction in zip(ids,bary):
   for bone,weight in zip(si[i],sw[i]):w[bone]+=weight*max(0,fraction)
  ii,ww=compact(w);newsi.append(ii);newsw.append(ww);head_weights[key(v)]=(ii,ww)
 write(doc,data,a['JOINTS_0'],newsi);write(doc,data,a['WEIGHTS_0'],newsw)
mesh=next(m for m in doc['meshes']if m['name']=='Approved_Neck_Seam');a=mesh['primitives'][0]['attributes']
pos=read(doc,data,a['POSITION']);neighbors=defaultdict(set)
for t in range(0,len(pos),3):
 ids=[key(v)for v in pos[t:t+3]]
 for i in range(3):neighbors[ids[i]].update([ids[(i+1)%3],ids[(i+2)%3]])
pinned={k:(head_weights.get(k)or body_weights.get(k))for k in neighbors if k in head_weights or k in body_weights}
weights={k:skin(*pinned[k])if k in pinned else {5:.5,4:.5} for k in neighbors}
for _ in range(100):
 next_weights=dict(weights)
 for k,nn in neighbors.items():
  if k in pinned:continue
  w=defaultdict(float)
  for n in nn:
   for bone,value in weights[n].items():w[bone]+=value/len(nn)
  next_weights[k]=dict(w)
 weights=next_weights
out=[pinned[key(v)]if key(v)in pinned else compact(weights[key(v)])for v in pos]
write(doc,data,a['JOINTS_0'],[i for i,w in out]);write(doc,data,a['WEIGHTS_0'],[w for i,w in out])
report={'tool':'Blender '+bpy.app.version_string,'sourceHeadTriangles':len(triangles),'headUniqueVertices':len(head_weights),
 'sourceInfluences':['head','neck','ears','original shoulder blend'], 'method':'closest original head triangle barycentric weights; fixed-boundary harmonic neck blend',
 'neckPinnedVertices':len(pinned),'neckInteriorVertices':len(neighbors)-len(pinned),'animationTracks':'unchanged'}
doc['asset'].setdefault('extras',{})['originalHeadSkinTransfer']=report
encoded=json.dumps(doc,ensure_ascii=False,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
raw=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(data))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(data),0x004e4942)+data
path.write_bytes(raw);print(json.dumps(report,indent=2))
