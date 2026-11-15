"""Save the verified editor GLB as an editable, welded Blender working file."""
import bpy
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'bench/out/approved-head/runner-uncolored-head.glb'))
# Join the exterior skin into one editable mesh; keep the irises separate.
skins=[o for o in bpy.data.objects if o.type=='MESH' and o.name in ['Object_9','Approved_Head','Approved_Neck_Seam']]
assert len(skins)==3
bpy.ops.object.select_all(action='DESELECT')
for o in skins:o.select_set(True)
bpy.context.view_layer.objects.active=next(o for o in skins if o.name=='Approved_Head')
bpy.ops.object.join()
cat=bpy.context.object;cat.name='Cat - continuous head neck body'
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=.000001)
bpy.ops.object.mode_set(mode='OBJECT')
for polygon in cat.data.polygons:polygon.use_smooth=False
for o in bpy.data.objects:
 if o.type=='ARMATURE':o.hide_set(True)
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type=='VIEW_3D':
   space=area.spaces.active
   space.overlay.show_extras=False
   space.region_3d.view_distance=.8
   space.region_3d.view_location=(0,-.1,.19)
   space.region_3d.view_rotation=Vector((1,.15,.12)).to_track_quat('Z','Y')
   space.region_3d.view_perspective='ORTHO'
cat['proportion_edit']='Natural-standing side reference: larger head, slimmer waist, longer lower limbs, broader paws, tapered curved tail'
cat['neck_edit']='Head translated toward shoulders; shortened concave throat, relaxed nape, exterior skin welded for editing'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'public/models/cat/runner-neck-refined.blend'))
print('Saved editable exterior with',len(cat.data.vertices),'welded vertices;',len(cat.data.shape_keys.key_blocks),'shape keys')
