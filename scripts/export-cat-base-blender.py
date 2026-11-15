"""Publish the approved editable cat as a standard, metre-scale glTF rig.

Only the export copy is transformed/resampled; the authoring blend is untouched.
"""
import bpy, json, math, hashlib
from pathlib import Path
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'public/models/cat/runner-ear-controls.blend'
OUT = ROOT / 'public/models/cat/runner-base.glb'
REPORT = ROOT / 'bench/out/cat-base'
REPORT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.context.scene
rig = next(o for o in scene.objects if o.type == 'ARMATURE')
bpy.ops.object.mode_set(mode='OBJECT')
meshes = [o for o in scene.objects if o.type == 'MESH']
action = rig.animation_data.action
for side in ['L', 'R']:
    for prop in ['spread', 'tilt', 'fold']:
        rig[f'ear_{prop}_{side}'] = 0.0
rig.update_tag()

def vertices():
    dg = bpy.context.evaluated_depsgraph_get()
    points = []
    for o in meshes:
        for v in o.evaluated_get(dg).data.vertices:
            w = o.matrix_world @ v.co
            points.append([w.x, w.z, -w.y])  # Blender Z-up -> glTF Y-up
    return points

samples = []
rig.animation_data.action = None
for p in rig.pose.bones:
    p.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()
samples.append({'time': None, 'vertices': vertices()})
rig.animation_data.action = action
for i in range(25):
    t = (i + .37) * 1.5 / 25
    frame = t * 24
    scene.frame_set(math.floor(frame), subframe=frame % 1)
    samples.append({'time': t, 'vertices': vertices()})

# Keep photo-adapter mesh coordinates in forward/height/lateral metres.
# Compensate object transforms so neither the skin nor its animation moves.
ground = .013619639910757542
world_to_local = Matrix(((0,-1,0,0),(-1,0,0,0),(0,0,1,-ground),(0,0,0,1)))
for o in meshes:
    transform = world_to_local @ o.matrix_world
    o.data.transform(transform, shape_keys=True)
    o.matrix_world = world_to_local.inverted()
    for polygon in o.data.polygons:
        polygon.use_smooth = False

# The glTF exporter samples integer frames. Rescale keys and FPS together to
# preserve the 384 Hz authoring bake without changing the 1.5-second duration.
for layer in action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            for curve in bag.fcurves:
                for key in curve.keyframe_points:
                    key.co.x *= 16
                    key.handle_left.x *= 16
                    key.handle_right.x *= 16
scene.render.fps = 384
scene.frame_start = 0
scene.frame_end = 576
max_resample_error = 0
for sample in samples[1:]:
    frame = sample['time'] * 384
    scene.frame_set(math.floor(frame), subframe=frame % 1)
    for a, b in zip(vertices(), sample['vertices']):
        max_resample_error = max(max_resample_error, sum((x-y)**2 for x,y in zip(a,b))**.5)
print('Resampled Blender error:', max_resample_error)
assert max_resample_error < .00001, max_resample_error
scene.frame_set(0)
# glTF has no inherit_scale=NONE. Unweighted connector lengths are an editor
# display aid, so export them without scale and bake each child's world pose.
conversion = Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
def world_matrix(bone, posed):
    m = conversion @ rig.matrix_world @ (rig.pose.bones[bone.name].matrix if posed else bone.matrix_local) @ conversion.inverted()
    if not bone.use_deform:
        p,q,s = m.decompose()
        m = Matrix.LocRotScale(p,q,None)
    return m
bone_data = [{'name': b.name, 'parent': b.parent.name if b.parent else None,
              'rest': list(v for row in world_matrix(b,False).transposed() for v in row)} for b in rig.data.bones]
motion = []
for frame in range(577):
    scene.frame_set(frame)
    worlds = {b.name:world_matrix(b,True) for b in rig.data.bones}
    transforms = []
    for b in rig.data.bones:
        local = worlds[b.parent.name].inverted() @ worlds[b.name] if b.parent else worlds[b.name]
        p,q,s = local.decompose()
        reconstructed=Matrix.LocRotScale(p,q,s)
        assert max(abs(local[i][j]-reconstructed[i][j]) for i in range(4) for j in range(4))<.00001, b.name
        transforms.append([list(p),[q.x,q.y,q.z,q.w],list(s)])
    motion.append(transforms)
(REPORT/'skeleton-bake.json').write_text(json.dumps({'bones':bone_data,'frames':motion,'fps':384}))
scene.frame_set(0)
rig['baseVersion'] = 'cat-ear-rig-v1'
rig['authoringFile'] = 'runner-ear-controls.blend'
bpy.ops.object.select_all(action='DESELECT')
for o in [rig, *meshes]:
    o.hide_set(False)
    o.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=str(OUT), export_format='GLB', use_selection=True,
    export_extras=True, export_animations=True, export_animation_mode='SCENE',
    export_nla_strips_merged_animation_name='run', export_frame_range=True,
    export_force_sampling=True, export_frame_step=1,
    export_rest_position_armature=True, export_def_bones=False,
    export_morph=True, export_try_sparse_sk=False, export_skins=True, export_yup=True,
)
(REPORT / 'blender-reference.json').write_text(json.dumps(samples))
manifest = {
    'version': 'cat-ear-rig-v1', 'authoringFile': SOURCE.name,
    'runtimeFile': OUT.name, 'authoringSHA256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    'runtimeSHA256': hashlib.sha256(OUT.read_bytes()).hexdigest(),
    'bones': len(rig.data.bones), 'durationSeconds': 1.5,
    'earPresets': json.loads(rig['ear_presets']),
    'notes': 'Blender retains six editable ear drivers. GLB contains their neutral run bake and all ear joints; glTF does not store Blender drivers.',
}
(OUT.parent / 'runner-base.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest, indent=2))
