"""Sculpt the rear skull, nape and shoulders as one continuous transition.
Also soften the upper haunch and its skin gradient. Run after proportion pass.
"""
import bpy,bmesh,json,struct,math
from pathlib import Path
from mathutils import Vector
from collections import defaultdict
ROOT=Path(__file__).resolve().parents[1];path=ROOT/'public/models/cat/runner-approved-head.glb'
raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);data=bytearray(raw[28+n:])
assert not doc['asset'].get('extras',{}).get('napeContinuity')
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
def headwarp(v):
 x,y,z=v;rear=(1-smooth(.15,.19,x))*(1-smooth(.245,.295,y))
 return Vector((x-.040*rear,y,z))
def bodywarp(v):
 x,y,z=v;upper=smooth(.17,.245,y);forward=smooth(0,.18,x)
 hip=math.exp(-((x+.105)/.065)**2)*smooth(.14,.205,y)
 return Vector((x-.085*upper*forward,y-.003*upper*forward-.010*hip,z*(1-.07*hip)))
records=[];headmap={};bodymap={}
for mesh in doc['meshes']:
 p=mesh['primitives'][0];a=p['attributes'];pos=read(a['POSITION'])
 if mesh['name']=='Approved_Neck_Seam':neck=(mesh,pos);continue
 head=mesh.get('extras',{}).get('approvedCatHead',False);warp=headwarp if head else bodywarp
 result=[warp(v)for v in pos]
 mapping=headmap if head else bodymap
 mapping.update({key(v):(q,warp)for v,q in zip(pos,result)})
 records.append((mesh,pos,result,warp))
mesh,pos=neck
bm=bmesh.new();vertices={}
for v in pos:
 if key(v)not in vertices:vertices[key(v)]=bm.verts.new(v)
for i in range(0,len(pos),3):bm.faces.new([vertices[key(v)]for v in pos[i:i+3]])
old={v:v.co.copy()for v in bm.verts};delta={};pin={}
for k,v in vertices.items():
 if k in headmap or k in bodymap:
  q,warp=headmap.get(k)or bodymap[k];pin[v]=q-old[v];delta[v]=pin[v]
 else:delta[v]=Vector((0,0,0))
# Laplace displacement across the whole joining band, rather than independent
# object scaling. Both endpoints move with their actual neighboring surfaces.
for _ in range(100):
 change={}
 for v in bm.verts:
  if v in pin:continue
  nn=[e.other_vert(v)for e in v.link_edges]
  change[v]=sum((delta[n]for n in nn),Vector())/len(nn)
 delta.update(change)
for v in bm.verts:v.co=old[v]+delta[v]
result=[vertices[key(v)].co.copy()for v in pos]
records.append((mesh,pos,result,None))
# Relax the actual joined exterior across the former object boundary so the
# back of the skull, neck band and shoulder do not retain a collar-like ridge.
exterior=bmesh.new();welded={}
for m,ps,qs,fn in records:
 if 'Iris' in m['name']:continue
 for q in qs:
  if key(q)not in welded:welded[key(q)]=exterior.verts.new(q)
 pp=m['primitives'][0];ids=[i[0]for i in read(pp['indices'])]if 'indices'in pp else list(range(len(qs)))
 for t in range(0,len(ids),3):
  vv=[welded[key(qs[i])]for i in ids[t:t+3]]
  try:exterior.faces.new(vv)
  except ValueError:pass
original={v:v.co.copy()for v in exterior.verts}
for _ in range(4):
 updates={}
 for v in exterior.verts:
  x,y,z=original[v]
  amount=.22*smooth(.21,.245,y)*(1-smooth(.275,.30,y))*smooth(.035,.07,x)*(1-smooth(.135,.17,x))
  if amount<.001:continue
  nn=[e.other_vert(v)for e in v.link_edges]
  if nn:updates[v]=v.co.lerp(sum((n.co for n in nn),Vector())/len(nn),amount)
 for v,q in updates.items():v.co=q
for m,ps,qs,fn in records:
 if 'Iris' in m['name']:continue
 for i,q in enumerate(qs):qs[i]=welded[key(q)].co.copy()
exterior.free()
for mesh,pos,result,warp in records:
 p=mesh['primitives'][0];a=p['attributes'];write(a['POSITION'],result)
 for target in p.get('targets',[]):
  out=[]
  for v,d in zip(pos,read(target['POSITION'])):
   localwarp=warp
   if localwarp is None:
    record=headmap.get(key(v))or bodymap.get(key(v));localwarp=record[1]if record else None
   out.append(localwarp(Vector(v)+Vector(d))-localwarp(v)if localwarp else d)
  write(target['POSITION'],out)
 ids=[i[0]for i in read(p['indices'])]if 'indices'in p else list(range(len(result)))
 normals=[Vector()for _ in result]
 for i in range(0,len(ids),3):
  aa,bb,cc=ids[i:i+3];normal=(result[bb]-result[aa]).cross(result[cc]-result[aa])
  assert normal.length>1e-13
  for j in [aa,bb,cc]:normals[j]+=normal
 for normal in normals:normal.normalize()
 write(a['NORMAL'],normals)
 # Smooth only the upper haunch's original weight gradient, retaining every
 # duplicate corner's identical influences and all downstream limb weights.
 if mesh.get('extras',{}).get('approvedHeadBody'):
  influences={};neighbors=defaultdict(set);original={}
  for v,ii,ww in zip(pos,read(a['JOINTS_0']),read(a['WEIGHTS_0'])):
   k=key(v);original[k]={i:w for i,w in zip(ii,ww)if w>0};influences[k]=dict(original[k])
  for i in range(0,len(ids),3):
   ks=[key(pos[j])for j in ids[i:i+3]]
   for k in ks:neighbors[k].update(set(ks)-{k})
  for _ in range(2):
   updates={}
   for k,nn in neighbors.items():
    x,y,z=k;amount=.22*math.exp(-((x+.105)/.065)**2)*smooth(.14,.205,y)
    if x>-.035 or x<-.19 or amount<.001:continue
    w=defaultdict(float)
    for bone,value in influences[k].items():w[bone]+=(1-amount)*value
    for neighbor in nn:
     for bone,value in influences[neighbor].items():w[bone]+=amount*value/len(nn)
    updates[k]=dict(w)
   influences.update(updates)
  jointrows=[];weightrows=[]
  for v in pos:
   w=influences[key(v)];pairs=sorted(w.items(),key=lambda p:(-p[1],p[0]))[:4];total=sum(w for _,w in pairs);pairs+=[(0,0)]*(4-len(pairs))
   jointrows.append([b for b,w in pairs]);weightrows.append([w/total for b,w in pairs])
  write(a['JOINTS_0'],jointrows);write(a['WEIGHTS_0'],weightrows)
bm.free()
report={'tool':'Blender '+bpy.app.version_string,'nape':'rear skull tapered back into retracted upper shoulder boundary; harmonic whole-band transition','rump':'upper haunch contour reduced and local skin weights relaxed','runTracks':'unchanged','headSources':'untouched'}
doc['asset'].setdefault('extras',{})['napeContinuity']=report
encoded=json.dumps(doc,ensure_ascii=False,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(data))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(data),0x004e4942)+data)
print(json.dumps(report,indent=2))
