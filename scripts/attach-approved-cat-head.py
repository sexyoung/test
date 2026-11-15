"""Build the runner with the user-approved sculpt, retaining original run/skin data.

Run: python3 scripts/attach-approved-cat-head.py
The approved source stays untouched. A separate neutral head is saved first;
only its lower rear neck attachment is opened when assembling the runner.
"""
from pathlib import Path
from collections import defaultdict
import copy
import json
import math
import struct

ROOT = Path(__file__).resolve().parents[1]
BODY = ROOT / 'public/models/lowpoly_cat_rig__run_animation.glb'
APPROVED_HEAD = ROOT / 'public/models/cat/cat-head-approved.glb'
HEAD = ROOT / 'public/models/cat/cat-head-uncolored.glb'
OUTPUT = ROOT / 'public/models/cat/runner-approved-head.glb'
SCALE, CENTER_X, CENTER_Y = .05, .215, .214
MORPHS = ['Head width', 'Cheek fullness', 'Muzzle projection', 'Ear height']


def load(path):
    raw = path.read_bytes()
    size = struct.unpack_from('<I', raw, 12)[0]
    return json.loads(raw[20:20 + size]), raw[28 + size:]


def save(path, doc, data):
    doc['buffers'] = [{'byteLength': len(data)}]
    data = bytes(data) + b'\0' * ((-len(data)) % 4)
    encoded = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode()
    encoded += b' ' * ((-len(encoded)) % 4)
    raw = struct.pack('<III', 0x46546c67, 2, 12+8+len(encoded)+8+len(data))
    raw += struct.pack('<II', len(encoded), 0x4e4f534a) + encoded
    raw += struct.pack('<II', len(data), 0x004e4942) + data
    path.write_bytes(raw)
    return len(raw)


def accessor(doc, binary, index):
    a = doc['accessors'][index]
    fmt = {5126: 'f', 5125: 'I', 5123: 'H', 5121: 'B'}[a['componentType']]
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    result = [[0]*width for _ in range(a['count'])]
    if 'bufferView' in a:
        view = doc['bufferViews'][a['bufferView']]
        start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = view.get('byteStride', struct.calcsize(fmt) * width)
        result = [list(struct.unpack_from('<' + fmt * width, binary, start + stride * i)) for i in range(a['count'])]
    if 'sparse' in a:
        sparse = a['sparse']
        ii, vv = sparse['indices'], sparse['values']
        index_fmt = {5121: 'B', 5123: 'H', 5125: 'I'}[ii['componentType']]
        index_start = doc['bufferViews'][ii['bufferView']].get('byteOffset', 0)+ii.get('byteOffset', 0)
        value_start = doc['bufferViews'][vv['bufferView']].get('byteOffset', 0)+vv.get('byteOffset', 0)
        for i in range(sparse['count']):
            index = struct.unpack_from('<'+index_fmt, binary, index_start+i*struct.calcsize(index_fmt))[0]
            result[index] = list(struct.unpack_from('<'+fmt*width, binary, value_start+i*width*struct.calcsize(fmt)))
    return result


def key(v):
    return tuple(round(x, 7) for x in v['p'])


def boundary(faces):
    edges = defaultdict(list)
    for face in faces:
        for i in range(3):
            a, b = face[i], face[(i + 1) % 3]
            edges[tuple(sorted((key(a), key(b))))].append((a, b))
    return [entry[0] for entry in edges.values() if len(entry) == 1]


def loop_from_edges(edges):
    by_start = {key(a): (a, b) for a, b in edges}
    assert len(by_start) == len(edges), 'Attachment boundary must be a simple loop'
    loop, edge = [], edges[0]
    while True:
        loop.append(edge[0])
        if key(edge[1]) == key(loop[0]):
            break
        edge = by_start[key(edge[1])]
        assert len(loop) <= len(edges), 'Open attachment boundary'
    assert len(loop) == len(edges), 'More than one attachment loop'
    return loop


def normalize(v):
    length = math.sqrt(sum(x*x for x in v))
    return [x / length for x in v] if length else [1, 0, 0]


def lerp(a, b, t):
    weights = defaultdict(float)
    for vertex, fraction in [(a, 1-t), (b, t)]:
        for bone, weight in zip(vertex['si'], vertex['sw']):
            weights[bone] += weight * fraction
    influences = sorted(weights.items(), key=lambda e: (-e[1], e[0]))[:4]
    total = sum(w for _, w in influences)
    influences += [(0, 0)] * (4-len(influences))
    return {'p': [x+(y-x)*t for x, y in zip(a['p'], b['p'])],
            'n': normalize([x+(y-x)*t for x, y in zip(a['n'], b['n'])]),
            'c': a['c'][:],
            'si': [b for b, _ in influences], 'sw': [w/total for _, w in influences],
            'm': [[x+(y-x)*t for x, y in zip(ma, mb)] for ma, mb in zip(a['m'], b['m'])]}


def transform(p, delta=False):
    # Approved +Z forward, +Y up -> original runner +X forward, +Y up.
    return [p[2]*SCALE + (0 if delta else CENTER_X),
            p[1]*SCALE + (0 if delta else CENTER_Y), -p[0]*SCALE]


def clip_polygon(vertices, axis, plane, above):
    clipped = []
    for a, b in zip(vertices, vertices[1:] + vertices[:1]):
        da, db = a['p'][axis]-plane, b['p'][axis]-plane
        inside_a = da >= -1e-10 if above else da <= 1e-10
        inside_b = db >= -1e-10 if above else db <= 1e-10
        if inside_a:
            clipped.append(a)
        if inside_a != inside_b:
            clipped.append(lerp(a, b, -da/(db-da)))
    return clipped


def smooth(a, b, x):
    t = min(1, max(0, (x-a)/(b-a)))
    return t*t*(3-2*t)


body, body_bin = load(BODY)
approved, head_bin = load(APPROVED_HEAD)
head = copy.deepcopy(approved)
for mesh in head['meshes']:
    for primitive in mesh['primitives']:
        primitive['attributes'].pop('COLOR_0', None)
        primitive['material'] = 0
head['materials'] = [{'name': 'Cat head - neutral uncolored', 'doubleSided': True,
                     'pbrMetallicRoughness': {'baseColorFactor': [.8, .8, .8, 1],
                                              'metallicFactor': 0, 'roughnessFactor': .95}}]
for field in ['extensionsUsed', 'extensionsRequired']:
    if field in head:
        head[field] = [e for e in head[field] if e != 'KHR_materials_unlit']
        if not head[field]:
            del head[field]
head['asset'].setdefault('extras', {})['uncoloredCopyOf'] = APPROVED_HEAD.name
save(HEAD, head, head_bin)
out = copy.deepcopy(body)
binary = bytearray(body_bin[:body['buffers'][0]['byteLength']])


def put(values, width=3, kind=5126, target=34962, bounds=False):
    while len(binary) % 4:
        binary.append(0)
    offset = len(binary)
    fmt = {5126: 'f', 5125: 'I', 5123: 'H'}[kind]
    for value in values:
        binary.extend(struct.pack('<'+fmt*width, *value))
    view = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(binary)-offset}
    if target:
        view['target'] = target
    out['bufferViews'].append(view)
    a = {'bufferView': len(out['bufferViews'])-1, 'componentType': kind, 'count': len(values),
         'type': {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4'}[width]}
    if bounds:
        a['min'] = [min(v[k] for v in values) for k in range(width)]
        a['max'] = [max(v[k] for v in values) for k in range(width)]
    out['accessors'].append(a)
    return len(out['accessors'])-1


primitive = body['meshes'][0]['primitives'][0]
positions = accessor(body, body_bin, primitive['attributes']['POSITION'])
normals = accessor(body, body_bin, primitive['attributes']['NORMAL'])
joints = accessor(body, body_bin, primitive['attributes']['JOINTS_0'])
weights = accessor(body, body_bin, primitive['attributes']['WEIGHTS_0'])
indices = [v[0] for v in accessor(body, body_bin, primitive['indices'])]
vertices = [{'p': p, 'n': n, 'si': si, 'sw': sw, 'c': [1, 1, 1], 'm': [[0, 0, 0] for _ in MORPHS]}
            for p, n, si, sw in zip(positions, normals, joints, weights)]
head_weight = [sum(w for i, w in zip(si, sw) if i in [5, 6, 7, 8, 9]) for si, sw in zip(joints, weights)]
kept_indices = [indices[t:t+3] for t in range(0, len(indices), 3)
                if sum(head_weight[i] for i in indices[t:t+3])/3 <= .1]
body_faces = [[vertices[i] for i in face] for face in kept_indices]
body_neck_edges = [(a, b) for a, b in boundary(body_faces) if min(a['p'][0], b['p'][0]) > .12]
body_ring = loop_from_edges(body_neck_edges)
used = sorted({i for face in kept_indices for i in face})
remap = {old: new for new, old in enumerate(used)}
body_primitive = out['meshes'][0]['primitives'][0]
body_primitive['indices'] = put([[remap[i]] for face in kept_indices for i in face], 1, 5123, 34963)
for name, index in primitive['attributes'].items():
    values = accessor(body, body_bin, index)
    kind = body['accessors'][index]['componentType']
    body_primitive['attributes'][name] = put([values[i] for i in used], len(values[0]), kind, bounds=name == 'POSITION')
out['meshes'][0]['extras'] = {'approvedHeadBody': True}

approved_material = len(out['materials'])
out['materials'].append(copy.deepcopy(head['materials'][0]))
for extension in head.get('extensionsUsed', []):
    out.setdefault('extensionsUsed', [])
    if extension not in out['extensionsUsed']:
        out['extensionsUsed'].append(extension)


def add_mesh(name, faces, part):
    verts = [v for face in faces for v in face]
    attrs = {'POSITION': put([v['p'] for v in verts], bounds=True),
             'NORMAL': put([v['n'] for v in verts]),
             'JOINTS_0': put([v['si'] for v in verts], 4, 5123),
             'WEIGHTS_0': put([v['sw'] for v in verts], 4)}
    targets = [{'POSITION': put([v['m'][k] for v in verts], bounds=True)} for k in range(len(MORPHS))]
    is_neck = part == 'neck-seam'
    mesh = {'name': name, 'primitives': [{'attributes': attrs, 'material': 0 if is_neck else approved_material, 'targets': targets}],
            'weights': [0]*len(MORPHS),
            'extras': {'targetNames': MORPHS, 'approvedCatHead': not is_neck, 'approvedHeadNeck': is_neck,
                       'headPart': part, 'source': HEAD.name, 'uncoloredHead': True}}
    out['meshes'].append(mesh)
    node = {'name': name, 'mesh': len(out['meshes'])-1, 'skin': body['nodes'][9]['skin']}
    out['nodes'].append(node)
    parent = next(n for n in out['nodes'] if 9 in n.get('children', []))
    parent['children'].append(len(out['nodes'])-1)


head_surfaces, head_ring = [], None
for number, mesh in enumerate(head['meshes']):
    p = mesh['primitives'][0]
    ps = accessor(head, head_bin, p['attributes']['POSITION'])
    ns = accessor(head, head_bin, p['attributes']['NORMAL'])
    cs = [[1, 1, 1] for _ in ps]
    morphs = [accessor(head, head_bin, t['POSITION']) for t in p['targets']]
    ids = [v[0] for v in accessor(head, head_bin, p['indices'])]
    vs = []
    for i, pos in enumerate(ps):
        # Continuous coordinate masks give coincident ear/head corners identical weights.
        ear = smooth(.85, 1.55, pos[1])*smooth(.3, .7, abs(pos[0]))
        ear_bone = 6 if pos[0] < 0 else 8
        vs.append({'p': transform(pos), 'n': normalize([ns[i][2], ns[i][1], -ns[i][0]]),
                   'c': cs[i][:3], 'si': [5, ear_bone, 0, 0], 'sw': [1-ear, ear, 0, 0],
                   'm': [transform(target[i], True) for target in morphs]})
    faces = []
    for t in range(0, len(ids), 3):
        triangle = [vs[i] for i in ids[t:t+3]]
        if number == 0:
            # Replace the sculpt's dangling bust base with an oblique throat
            # opening: lower at the chin, higher at the rear of the skull.
            # This connects the entire underside to the chest, not a rear patch.
            polygon = []
            distance = lambda v: v['p'][1] + .4*(v['p'][0]-.22) - .211
            for va, vb in zip(triangle, triangle[1:] + triangle[:1]):
                da, db = distance(va), distance(vb)
                if da >= -1e-10:
                    polygon.append(va)
                if (da >= -1e-10) != (db >= -1e-10):
                    polygon.append(lerp(va, vb, da/(da-db)))
            pieces = [polygon]
        else:
            pieces = [triangle]
        for polygon in pieces:
            faces.extend([[polygon[0], polygon[k], polygon[k+1]] for k in range(1, len(polygon)-1)])
    if number == 0:
        head_ring = loop_from_edges([(a, b) for a, b in boundary(faces)
                                     if all(abs(v['p'][1]+.4*(v['p'][0]-.22)-.211)<1e-6 for v in [a,b])])
    add_mesh(['Approved_Head', 'Approved_Iris_L', 'Approved_Iris_R'][number], faces,
             ['surface', 'iris-left', 'iris-right'][number])
    head_surfaces.extend(faces)

# Both open boundaries have opposite surface winding. Reverse one for the band.
head_ring.reverse()
# Start the two rings at the closest pair, then zip by normalized perimeter.
a, b = min(((i, j) for i in range(len(body_ring)) for j in range(len(head_ring))),
           key=lambda ij: sum((x-y)**2 for x, y in zip(body_ring[ij[0]]['p'], head_ring[ij[1]]['p'])))
body_ring = body_ring[a:] + body_ring[:a]
head_ring = head_ring[b:] + head_ring[:b]


def progress(ring):
    lengths = [math.dist(v['p'], ring[(i+1) % len(ring)]['p']) for i, v in enumerate(ring)]
    total = sum(lengths)
    result = [0]
    for length in lengths:
        result.append(result[-1]+length/total)
    result[-1] = 1
    return result


bp, hp = progress(body_ring), progress(head_ring)
bridge, i, j = [], 0, 0
while i < len(body_ring) or j < len(head_ring):
    a, b = body_ring[i % len(body_ring)], head_ring[j % len(head_ring)]
    if i < len(body_ring) and (j == len(head_ring) or bp[i+1] <= hp[j+1]):
        face = [a, b, body_ring[(i+1) % len(body_ring)]]
        i += 1
    else:
        face = [a, b, head_ring[(j+1) % len(head_ring)]]
        j += 1
    face = copy.deepcopy(face)
    # The joining neck follows the body coat tint, rather than baking a dark
    # unlit collar across the original shoulder.
    c = [1, 1, 1]
    ab = [face[1]['p'][k]-face[0]['p'][k] for k in range(3)]
    ac = [face[2]['p'][k]-face[0]['p'][k] for k in range(3)]
    n = normalize([ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]])
    for v in face:
        v['c'], v['n'] = c[:], n[:]
    bridge.append(face)
# Add an inset intermediate neck ring. Long chin-to-shoulder spans otherwise
# form a straight triangular slab even though their boundary is watertight.
body_keys, head_keys = {key(v) for v in body_ring}, {key(v) for v in head_ring}
refined = []
for face in bridge:
    same = next(k for k in range(3)
                if (key(face[k]) in body_keys) == (key(face[(k+1)%3]) in body_keys))
    a, b, c = face[same], face[(same+1)%3], face[(same+2)%3]
    ac, bc = lerp(a,c,.5), lerp(b,c,.5)
    for v in [ac,bc]:
        v['p'][1] = .206+(v['p'][1]-.206)*.86
        v['p'][2] *= .86
        for delta in v['m']:
            delta[1] *= .86
            delta[2] *= .86
    for tri in [[a,b,bc],[a,bc,ac],[ac,bc,c]]:
        tri=copy.deepcopy(tri)
        u=[tri[1]['p'][k]-tri[0]['p'][k] for k in range(3)]
        v=[tri[2]['p'][k]-tri[0]['p'][k] for k in range(3)]
        n=normalize([u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]])
        for vertex in tri: vertex['n']=n[:]
        refined.append(tri)
bridge=refined
add_mesh('Approved_Neck_Seam', bridge, 'neck-seam')
# Every attachment edge is used twice after positional welding. The source has
# a few unrelated foot seams, so check only the deliberately constructed joins.
joined_boundary = {tuple(sorted((key(a), key(b)))) for a, b in boundary(body_faces+head_surfaces+bridge)}
for ring in [body_ring, head_ring]:
    for k, a in enumerate(ring):
        assert tuple(sorted((key(a), key(ring[(k+1) % len(ring)])))) not in joined_boundary, 'Unclosed neck seam'

out['asset'].setdefault('extras', {})['approvedHeadReplacement'] = {
    'bodySource': BODY.name, 'headSource': HEAD.name, 'originalApprovedHead': APPROVED_HEAD.name,
    'headProvidedBy': 'user', 'headColor': 'neutral material; no vertex colors or unlit paint',
    'removedOriginalTriangles': len(indices)//3-len(kept_indices),
    'bodyTriangles': len(body_faces), 'headTriangles': len(head_surfaces), 'neckTriangles': len(bridge),
    'attachment': 'oblique full underside opening joined to chest through an inset skinned neck ring',
    'headTransform': {'scale': SCALE, 'centerX': CENTER_X, 'centerY': CENTER_Y,
                      'throatPlaneY': .211, 'throatPlaneSlope': .4, 'neckInset': .86},
    'preserved': ['original skeleton', 'inverse bind matrices', 'run animation accessors', 'approved facial geometry', 'four approved morph targets']}
size = save(OUTPUT, out, binary)
print(json.dumps(out['asset']['extras']['approvedHeadReplacement'], indent=2))
print(f'Wrote {HEAD.relative_to(ROOT)} and {OUTPUT.relative_to(ROOT)} ({size:,} bytes)')
