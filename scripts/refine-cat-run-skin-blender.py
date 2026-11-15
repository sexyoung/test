"""Finish the runner: tuck the tail-root web and softly articulate the cheeks.
Run after refine-cat-continuity-blender.py. Keep the original run and bind rig.
"""
import bpy, json, struct, math
from pathlib import Path
from collections import defaultdict, Counter, deque
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'public/models/cat/runner-approved-head.glb'
raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0]
doc=json.loads(raw[20:20+n]);data=bytearray(raw[28+n:])
assert doc['asset'].get('extras',{}).get('napeContinuity'), 'Run continuity refinement first'
assert not doc['asset'].get('extras',{}).get('runSkinRefinement'), 'Rebuild before applying twice'
def read(i):
 a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']];w={'VEC3':3,'VEC4':4,'SCALAR':1}[a['type']];f={5126:'f',5123:'H',5125:'I',5121:'B'}[a['componentType']];o=v.get('byteOffset',0)+a.get('byteOffset',0);s=v.get('byteStride',struct.calcsize(f)*w)
 return [list(struct.unpack_from('<'+f*w,data,o+j*s))for j in range(a['count'])]
def write(i,values):
 a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']];w=len(values[0]);f={5126:'f',5123:'H',5125:'I'}[a['componentType']];o=v.get('byteOffset',0)+a.get('byteOffset',0);s=v.get('byteStride',struct.calcsize(f)*w)
 for j,p in enumerate(values):struct.pack_into('<'+f*w,data,o+j*s,*p)
 if 'min'in a:
  a['min']=[min(p[k]for p in values)for k in range(w)];a['max']=[max(p[k]for p in values)for k in range(w)]
def key(v):return tuple(round(x,7)for x in v)
def smooth(a,b,x):
 t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
def rumpwarp(v):
 x,y,z=v
 mask=(1-smooth(-.16,-.13,x))*smooth(.155,.184,y)*(1-smooth(.205,.221,y))*math.exp(-(z/.036)**2)
 return Vector((x+.028*mask,y+.004*mask,z))
report={'tool':'Blender '+bpy.app.version_string,'rumpVertices':0,'facialVertices':0}
for mesh in doc['meshes']:
 body=mesh.get('extras',{}).get('approvedHeadBody')
 face=mesh.get('extras',{}).get('headPart')=='surface'
 if not(body or face):continue
 p=mesh['primitives'][0];a=p['attributes'];pos=read(a['POSITION']);joints=read(a['JOINTS_0']);weights=read(a['WEIGHTS_0'])
 ids=[i[0]for i in read(p['indices'])]if 'indices'in p else list(range(len(pos)))
 dist={}
 if face:
  # Keep the shared neck boundary fixed: zero added influence at its vertices,
  # then ramp inward over two edge rings. No head/neck seam can open.
  edges=Counter();neighbors=defaultdict(set)
  for t in range(0,len(ids),3):
   tri=[key(pos[i])for i in ids[t:t+3]]
   for i in range(3):
    u,v=tri[i],tri[(i+1)%3];edges[tuple(sorted((u,v)))]+=1;neighbors[u].add(v);neighbors[v].add(u)
  boundary={k for edge,count in edges.items()if count==1 for k in edge}
  dist={k:0 for k in boundary};queue=deque(boundary)
  while queue:
   k=queue.popleft()
   for other in neighbors[k]:
    if other not in dist:dist[other]=dist[k]+1;queue.append(other)
 changed=set();newj=[];neww=[]
 for v,ii,ww in zip(pos,joints,weights):
  x,y,z=v;w={i:value for i,value in zip(ii,ww)if value>0}
  if body:
   # The underside of the rump belongs to the pelvis, not the wagging tail.
   # Preserve the actual tail tube above this transition and limb influences.
   amount=(1-smooth(.205,.222,y))*smooth(-.20,-.17,x)*smooth(.155,.185,y)
   moved=0
   for bone in [25,26,27,28,29]:
    value=w.get(bone,0)*amount;w[bone]=w.get(bone,0)-value;moved+=value
   if moved>1e-5:w[1]=w.get(1,0)+moved;changed.add(key(v))
  else:
   # A small neck/head gradient changes cheek triangles during head pitch.
   # Eye sockets, nose, ear tips and accepted nape remain on their existing skin.
   region=math.exp(-((x-.202)/.030)**2-((y-.237)/.023)**2)*smooth(.006,.021,abs(z))
   amount=.14*region*min(1,dist.get(key(v),0)/2)
   transfer=w.get(5,0)*amount
   if transfer>1e-5:w[5]-=transfer;w[4]=w.get(4,0)+transfer;changed.add(key(v))
  if key(v)not in changed:
   newj.append(ii);neww.append(ww);continue
  pairs=sorted(w.items(),key=lambda p:(-p[1],p[0]))[:4];total=sum(value for _,value in pairs);pairs+=[(0,0)]*(4-len(pairs))
  newj.append([b for b,value in pairs]);neww.append([value/total for b,value in pairs])
 write(a['JOINTS_0'],newj);write(a['WEIGHTS_0'],neww)
 report['rumpVertices'if body else 'facialVertices']=len(changed)
 if body:
  result=[rumpwarp(v)for v in pos];write(a['POSITION'],result)
  for target in p.get('targets',[]):
   write(target['POSITION'],[rumpwarp(Vector(v)+Vector(d))-rumpwarp(v)for v,d in zip(pos,read(target['POSITION']))])
  normals=[Vector()for _ in result]
  for t in range(0,len(ids),3):
   aa,bb,cc=ids[t:t+3];normal=(result[bb]-result[aa]).cross(result[cc]-result[aa]);assert normal.length>1e-13
   for j in [aa,bb,cc]:normals[j]+=normal
  for normal in normals:normal.normalize()
  write(a['NORMAL'],normals)
report.update({'rump':'tail underside tucked into pelvis; stray tail influences reassigned to pelvis','face':'maximum 14% head-to-neck influence transfer in lower cheeks; shared neck boundary pinned','animation':'all original tracks and inverse binds unchanged'})
doc['asset'].setdefault('extras',{})['runSkinRefinement']=report
encoded=json.dumps(doc,ensure_ascii=False,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(data))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(data),0x004e4942)+data)
print(json.dumps(report,indent=2))
