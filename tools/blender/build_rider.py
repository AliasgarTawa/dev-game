"""Rigged, riding-pose mascot built from the original Meshy GLB by local mesh editing (no generation calls).
Usage: Blender -b --python build_rider.py -- <out.glb> [<out.blend>]

1. The original stub arms (fused to the belly, unusable for a reach) are pulled back into the torso surface
   (rider_regions.flatten_into_torso) and their texture area is cleaned to plain body orange with flat normals.
2. A skeleton is built (hips, spine, chest, head, legs, then shoulders/upper arms/forearms/hands) and the body is skinned
   with smooth procedural weights.
3. Pose: forward lean, head counter-tilt so the face looks down the road, legs lowered onto forward footpegs.
   The pose is applied as the skeleton's rest pose, so the exported GLB opens in the riding pose with its skeleton intact.
4. New arms are modelled in that pose (skin-modifier limbs + mitten paws closed around the grips), UV-mapped into the
   cleaned orange texture area, skinned to the arm bones and joined into the same mesh and material.
The face/head vertices and UVs are left untouched (checked in verify_rider.py)."""
import sys; sys.path.insert(0, '/Users/arjunbehl/Developer/dev-game/tools/blender')
from common import *
import rider_regions as RR
A = json.load(open(ROOT + '/tools/blender/anchors.json'))
args = sys.argv[sys.argv.index('--') + 1:]
OUT_GLB = args[0]; OUT_BLEND = args[1] if len(args) > 1 else None
STAGE = int(args[2]) if len(args) > 2 else 99
K = A['rider_scale']

reset()
body = import_single_mesh(RIDER_SRC, 'MascotRider')
V0 = verts_np(body)                                   # original coordinates (face -Y, Z up, 1.9 tall)
W = RR.region_weights(V0)
faces = [tuple(p.vertices) for p in body.data.polygons]
legs = np.clip(W['legL'] + W['legR'], 0, 1)
arm_w = np.clip(W['armL'] + W['armR'], 0, 1) * (1 - legs) * (1 - W['head'])
N_orig = vertex_normals_from_mesh(body)

# ---------------------------------------------------------------- 1. remove the stub arms
V1 = RR.flatten_into_torso(V0, faces, arm_w, np.clip(legs + W['head'], 0, 1))
moved = np.clip(np.linalg.norm(V1 - V0, axis=1) / 0.004, 0, 1)

# ---------------------------------------------------------------- 1b. clean the texture under the old arms (derived copies)
me = body.data
mat = me.materials[0]
nodes = mat.node_tree.nodes
bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
def tex_for(socket_name):
    s = bsdf.inputs[socket_name]
    n = s.links[0].from_node
    while n.type != 'TEX_IMAGE':
        n = n.inputs[0].links[0].from_node if n.inputs and n.inputs[0].is_linked else (n.inputs['Color'].links[0].from_node)
    return n
img_base = tex_for('Base Color').image
img_mr = next(n for n in nodes if n.type == 'TEX_IMAGE' and n.image.colorspace_settings.name == 'Non-Color' and n.image.size[0] == 2048).image
img_nrm = next(n for n in nodes if n.type == 'TEX_IMAGE' and n.image.name.lower().startswith('normal')).image
RES = 2048
def load_px(img):
    if img.size[0] != RES: img.scale(RES, RES)
    return np.array(img.pixels[:], dtype=np.float32).reshape(RES, RES, 4)
P_base, P_mr, P_nrm = load_px(img_base), load_px(img_mr), load_px(img_nrm)
uv = np.empty(len(me.loops) * 2); me.uv_layers[0].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
lv = np.empty(len(me.loops), dtype=np.int64); me.loops.foreach_get('vertex_index', lv)
me.calc_loop_triangles()
LT = np.empty(len(me.loop_triangles) * 3, dtype=np.int64); me.loop_triangles.foreach_get('loops', LT); LT = LT.reshape(-1, 3)
clean_w = np.clip(arm_w * 1.6, 0, 1)                   # texture weight reaches 1 inside the patch
mask = np.zeros((RES, RES), np.float32); protect = np.zeros((RES, RES), bool)
def raster(tri_uv, tri_w, out, mode):
    p = tri_uv * (RES - 1); x0, y0 = np.floor(p.min(0)).astype(int); x1, y1 = np.ceil(p.max(0)).astype(int)
    x0, y0 = max(x0 - 1, 0), max(y0 - 1, 0); x1, y1 = min(x1 + 1, RES - 1), min(y1 + 1, RES - 1)
    if x1 < x0 or y1 < y0: return
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
    a, b, c = p; d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(d) < 1e-12: return
    l1 = ((b[1] - c[1]) * (gx - c[0]) + (c[0] - b[0]) * (gy - c[1])) / d
    l2 = ((c[1] - a[1]) * (gx - c[0]) + (a[0] - c[0]) * (gy - c[1])) / d
    l3 = 1 - l1 - l2; e = -0.6 / max(np.ptp(p[:, 0]), np.ptp(p[:, 1]), 1)    # half-texel tolerance
    inside = (l1 >= e) & (l2 >= e) & (l3 >= e)
    if mode == 'w':
        val = l1 * tri_w[0] + l2 * tri_w[1] + l3 * tri_w[2]
        sub = out[y0:y1 + 1, x0:x1 + 1]; sub[inside] = np.maximum(sub[inside], val[inside])
    else:
        out[y0:y1 + 1, x0:x1 + 1][inside] = True
head_v = W['head'] > 0.02
for t in LT:
    vs = lv[t]; w3 = clean_w[vs]
    if w3.max() > 0.001: raster(uv[t], w3, mask, 'w')
    if head_v[vs].any() or legs[vs].max() > 0.5: raster(uv[t], None, protect, 'p')
mask[protect] = 0
# grow the mask by 2 texels (mip bleed), never into protected charts
for _ in range(2):
    g = mask.copy()
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)): g = np.maximum(g, np.roll(np.roll(mask, dy, 0), dx, 1) * 0.999)
    mask = np.where(protect, 0, g)
# reference: median torso texel colour (outside patch, head and legs)
ref_v = (arm_w < 0.01) & (legs < 0.01) & (W['head'] < 0.01) & (V0[:, 2] > -0.6) & (V0[:, 2] < -0.05)
ref_l = np.where(ref_v[lv])[0]
iu = np.clip((uv[ref_l, 0] * (RES - 1)).round().astype(int), 0, RES - 1); iv = np.clip((uv[ref_l, 1] * (RES - 1)).round().astype(int), 0, RES - 1)
ref_base = np.median(P_base[iv, iu], 0); ref_mr = np.median(P_mr[iv, iu], 0)
print('reference torso colour', ref_base.round(3), 'metal/rough', ref_mr.round(3))
m4 = mask[..., None]
P_base = P_base * (1 - m4) + ref_base * m4
P_mr = P_mr * (1 - m4) + ref_mr * m4
P_nrm = P_nrm * (1 - m4) + np.array([0.5, 0.5, 1.0, 1.0], np.float32) * m4
for img, P, nm in ((img_base, P_base, 'rider_basecolor'), (img_mr, P_mr, 'rider_metal_rough'), (img_nrm, P_nrm, 'rider_normal')):
    img.pixels.foreach_set(P.ravel()); img.name = nm; img.update()
# a fully-clean rectangle for the new arms' UVs: largest square of mask == 1 (simple erosion search)
full = mask > 0.995
best = None
for r in (48, 40, 32, 24, 16, 12, 8):
    e = full.copy()
    for _ in range(r):
        e = e & np.roll(e, 1, 0) & np.roll(e, -1, 0) & np.roll(e, 1, 1) & np.roll(e, -1, 1)
    ys, xs = np.nonzero(e)
    if len(ys): best = (xs[len(xs) // 2], ys[len(ys) // 2], r); break
ARM_UV_CENTER = np.array([best[0], best[1]]) / (RES - 1); ARM_UV_HALF = best[2] * 0.8 / (RES - 1)
print('arm UV square centre', ARM_UV_CENTER.round(4), 'half size', round(ARM_UV_HALF, 4), 'texels', best[2])

# ---------------------------------------------------------------- 2. into bike-mount space
def to_mount(P):
    P = np.atleast_2d(P); Q = np.stack([-P[:, 0], -P[:, 1], P[:, 2]], 1) * K
    return Q + OFF
BUTT = np.array([0.04, 0.10, -0.95]); SEAT = np.array(A['seat_contact'])
OFF = SEAT - np.array([-BUTT[0], -BUTT[1], BUTT[2]]) * K
VM = to_mount(V1)
set_verts_np(body, VM)
Nm = welded_normals(body)
No = np.stack([-N_orig[:, 0], -N_orig[:, 1], N_orig[:, 2]], 1)
Nmix = No * (1 - moved[:, None]) + Nm * moved[:, None]
set_vertex_normals(body, Nmix / np.linalg.norm(Nmix, axis=1, keepdims=True))
if STAGE <= 1:
    if OUT_BLEND: bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    raise SystemExit

# ---------------------------------------------------------------- 3. skeleton (orig-space joints -> mount space)
J = {k: to_mount(np.array(v))[0] for k, v in {
    'root': [0.04, 0.10, -0.95], 'hips': [0.04, 0.10, -0.70], 'spine': [0.04, 0.12, -0.50], 'chest': [0.04, 0.12, -0.25],
    'neck': [0.05, 0.10, 0.02], 'head_end': [0.05, 0.05, 0.80],
    'thigh.L': [-0.22, -0.06, -0.64], 'foot.L': [-0.25, -0.48, -0.74], 'toe.L': [-0.26, -0.64, -0.74],
    'thigh.R': [0.30, -0.06, -0.64], 'foot.R': [0.36, -0.48, -0.74], 'toe.R': [0.38, -0.64, -0.74],
}.items()}
# NB: after the 180-degree turn the mascot's own left (orig -X) is on mount +X; bone names follow the character.
arm_data = bpy.data.armatures.new('RiderRig'); rig = bpy.data.objects.new('RiderRig', arm_data)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
def bone(name, head, tail, parent=None, deform=True, roll_up=(0, 0, 1)):
    b = eb.new(name); b.head = Vector(head); b.tail = Vector(tail); b.use_deform = deform
    if parent: b.parent = eb[parent]
    b.align_roll(Vector(roll_up))
    return b
bone('root', J['root'], J['root'] + np.array([0, 0.1, 0]), deform=False, roll_up=(0, 0, 1))
bone('hips', J['root'] + np.array([0, 0, 0.02]), J['spine'], 'root', roll_up=(0, 1, 0))
bone('spine', J['spine'], J['chest'], 'hips', roll_up=(0, 1, 0))
bone('chest', J['chest'], J['neck'], 'spine', roll_up=(0, 1, 0))
bone('head', J['neck'], J['head_end'], 'chest', roll_up=(0, 1, 0))
for s in ('L', 'R'):
    bone(f'thigh.{s}', J[f'thigh.{s}'], J[f'foot.{s}'], 'hips', roll_up=(0, 0, 1))
    bone(f'foot.{s}', J[f'foot.{s}'], J[f'toe.{s}'], f'thigh.{s}', roll_up=(0, 0, 1))
bpy.ops.object.mode_set(mode='OBJECT')

# body weights (computed on original coordinates where the masks were tuned)
z = V0[:, 2]; ss = RR.ss
wl = {'L': W['legL'], 'R': W['legR']}
foot_part = {s: RR.ss(-0.36, -0.46, V0[:, 1]) for s in ('L', 'R')}     # far front of each leg blob = foot
torso = 1 - legs
w_head = W['head'] * torso
rest = torso - w_head
w_hips = rest * (1 - ss(-0.66, -0.50, z)); rest2 = rest - w_hips
w_spine = rest2 * (1 - ss(-0.36, -0.20, z)); w_chest = rest2 - w_spine
groups = {'hips': w_hips, 'spine': w_spine, 'chest': w_chest, 'head': w_head}
for s in ('L', 'R'):
    groups[f'thigh.{s}'] = wl[s] * (1 - foot_part[s] * 0.0)       # the leg blob moves as one piece (no visible knee)
for name, w in groups.items():
    vg = body.vertex_groups.new(name=name)
    idx = np.nonzero(w > 1e-4)[0]
    for i in idx: vg.add([int(i)], float(w[i]), 'REPLACE')
mod = body.modifiers.new('Armature', 'ARMATURE'); mod.object = rig
body.parent = rig

# ---------------------------------------------------------------- 4. riding pose
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='POSE')
pb = rig.pose.bones
def rotate_world(name, axis, deg, pivot=None):
    b = pb[name]; bpy.context.view_layer.update()
    piv = Vector(pivot) if pivot is not None else b.head.copy()
    R = Matrix.Rotation(math.radians(deg), 4, Vector(axis))
    b.matrix = Matrix.Translation(piv) @ R @ Matrix.Translation(-piv) @ b.matrix
    bpy.context.view_layer.update()
def aim_world(name, target):
    b = pb[name]; bpy.context.view_layer.update()
    d0 = (b.tail - b.head).normalized(); d1 = (Vector(target) - b.head).normalized()
    q = d0.rotation_difference(d1)
    b.matrix = Matrix.Translation(b.head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-b.head) @ b.matrix
    bpy.context.view_layer.update()
lean = A['rider_lean_deg']
# lean forward: +Y is forward, so a forward pitch is a rotation about -X
rotate_world('spine', (-1, 0, 0), lean * 0.55)
rotate_world('chest', (-1, 0, 0), lean * 0.45)
rotate_world('head', (1, 0, 0), lean * 0.85)               # keep the face looking down the road
for s, side in (('L', 1), ('R', -1)):                       # character left = mount +X
    peg = np.array(A['pegs']['left' if side < 0 else 'right'])
    foot_target = peg + np.array([0, -0.03, 0.075])         # foot-bone joint sits above and just behind the peg
    aim_world(f'thigh.{s}', foot_target)
    aim_world(f'foot.{s}', foot_target + np.array([side * 0.02, 0.10, -0.01]))
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.update()
# apply pose: bake into mesh, then make it the rest pose
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier='Armature')
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')
mod = body.modifiers.new('Armature', 'ARMATURE'); mod.object = rig
# the pose rotated vertices but not the imported custom normals: recompute smooth (seam-welded) normals everywhere
set_vertex_normals(body, welded_normals(body))
VP = verts_np(body)
# sole points for the footpegs (lowest part of each foot)
pegs_out = {}
for s, key in (('L', 'right'), ('R', 'left')):              # character left foot is on mount +X ("right" peg)
    m = wl[s] > 0.9
    P = VP[m]; low = P[P[:, 2] < P[:, 2].min() + 0.025]
    pegs_out[key] = low.mean(0).round(4).tolist()
print('SOLES', json.dumps(pegs_out))
if STAGE <= 2:
    if OUT_BLEND: bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    raise SystemExit

# ---------------------------------------------------------------- 5. new arms, modelled in the riding pose
bpy.context.view_layer.update()
chest_m = rig.matrix_world @ rig.data.bones['chest'].matrix_local
def chest_point(p_orig):
    """Orig-space point carried along with the chest's lean (same transform the body received)."""
    return np.array(chest_m @ (rig.data.bones['chest'].matrix_local.inverted() @ Vector(to_mount(np.array(p_orig))[0])))
ARM = A.get('arm', {})
arm_objs = []
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT'); eb = arm_data.edit_bones
chains = {}
for s, side, gkey in (('L', 1, 'right'), ('R', -1, 'left')):
    sh_orig = [-0.37 if s == 'L' else 0.45, 0.06, -0.12]
    shoulder = to_mount(np.array(sh_orig))[0]
    # lean carried: rotate shoulder about the spine joint like the chest did
    piv = J['spine']; ang = math.radians(lean)
    d = shoulder - piv; c_, s_ = math.cos(ang), math.sin(ang)
    shoulder = piv + np.array([d[0], d[1] * c_ + d[2] * s_, -d[1] * s_ + d[2] * c_])
    grip = np.array(A['grips'][gkey]); hand = grip + np.array([0, -0.012, 0.018])     # paw centre wraps the grip
    reach = np.linalg.norm(hand - shoulder)
    la = lb = reach * ARM.get('length_factor', 0.56)
    # elbow: 2-bone IK in the plane given by a pole (out, back, down)
    pole = np.array([side * 0.75, -0.35, -0.55])
    dvec = (hand - shoulder) / reach
    pole_p = pole - dvec * (pole @ dvec); pole_p /= np.linalg.norm(pole_p)
    a_ = (la ** 2 - lb ** 2 + reach ** 2) / (2 * reach); h = math.sqrt(max(la ** 2 - a_ ** 2, 0))
    elbow = shoulder + dvec * a_ + pole_p * h
    chains[s] = dict(shoulder=shoulder, elbow=elbow, hand=hand, grip=grip, side=side, reach=reach, la=la)
    print(f'ARM {s}: shoulder {shoulder.round(3)} elbow {elbow.round(3)} hand {hand.round(3)} reach {reach:.3f} m'
          f' segment {la:.3f} m elbow angle {math.degrees(math.acos(np.clip(((shoulder-elbow)@(hand-elbow))/la/lb,-1,1))):.0f} deg')
    inner = shoulder + (shoulder - elbow) / np.linalg.norm(shoulder - elbow) * 0.035 - np.array([side * 0.03, 0, 0])
    bone(f'shoulder.{s}', inner, shoulder, 'chest', roll_up=(0, 0, 1))
    bone(f'upper_arm.{s}', shoulder, elbow, f'shoulder.{s}', roll_up=(0, 0, 1)).use_connect = True
    bone(f'forearm.{s}', elbow, hand, f'upper_arm.{s}', roll_up=(0, 0, 1)).use_connect = True
    bone(f'hand.{s}', hand, hand + np.array([side * 0.07, 0.0, 0.0]), f'forearm.{s}', roll_up=(0, 0, 1)).use_connect = True
    chains[s]['inner'] = inner
bpy.ops.object.mode_set(mode='OBJECT')

def skin_limb(name, pts, radii):
    """Smooth organic limb: a vertex chain with the Skin modifier, then subdivided."""
    m = bpy.data.meshes.new(name); m.from_pydata([tuple(p) for p in pts], [(i, i + 1) for i in range(len(pts) - 1)], [])
    o = bpy.data.objects.new(name, m); bpy.context.scene.collection.objects.link(o)
    sk = o.modifiers.new('Skin', 'SKIN'); sk.use_smooth_shade = True
    for i, r in enumerate(radii): m.skin_vertices[0].data[i].radius = (r, r)
    sd = o.modifiers.new('Subd', 'SUBSURF'); sd.levels = 2; sd.render_levels = 2
    bpy.context.view_layer.objects.active = o
    for md in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=md.name)
    return o

def ellipsoid(name, center, axes, radii, seg=28, rings=18):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    R = np.array(axes).T
    for v in bm.verts:
        p = np.array(v.co) * np.array(radii); v.co = Vector(R @ p + center)
    m = bpy.data.meshes.new(name); bm.to_mesh(m); bm.free()
    o = bpy.data.objects.new(name, m); bpy.context.scene.collection.objects.link(o)
    for p in m.polygons: p.use_smooth = True
    return o

R_ARM = K * np.array(ARM.get('radii_orig', [0.115, 0.105, 0.092, 0.085, 0.08]))   # shoulder .. wrist, from the original arm girth
for s, ch in chains.items():
    side = ch['side']; sh, el, hd = ch['shoulder'], ch['elbow'], ch['hand']
    wrist = hd + (el - hd) / np.linalg.norm(el - hd) * 0.045
    pts = [ch['inner'], sh, (sh + el) / 2, el, (el + wrist) / 2, wrist]
    rad = [R_ARM[0] * 0.95, R_ARM[0], R_ARM[1], R_ARM[2], R_ARM[3], R_ARM[4]]
    limb = skin_limb(f'arm.{s}', pts, rad)
    # mitten paw closed around the grip: long axis along the grip, flattened top-to-bottom, plus a thumb under the bar
    g_axis = np.array([side * math.cos(math.radians(8)), -math.sin(math.radians(8)), -math.sin(math.radians(6))]); g_axis /= np.linalg.norm(g_axis)
    fwd = np.array([0, 1, 0.0]); fwd -= g_axis * (g_axis @ fwd); fwd /= np.linalg.norm(fwd); up = np.cross(g_axis, fwd) * side
    if up[2] < 0: up = -up
    paw = ellipsoid(f'paw.{s}', hd, [g_axis, fwd, up], [0.048, 0.05, 0.046])
    knuckles = ellipsoid(f'knuckles.{s}', ch['grip'] + fwd * 0.03 + up * 0.004, [g_axis, fwd, up], [0.042, 0.026, 0.034], 20, 12)
    thumb = ellipsoid(f'thumb.{s}', ch['grip'] - g_axis * 0.032 - up * 0.022 + fwd * 0.012, [fwd, g_axis, up], [0.028, 0.017, 0.016], 16, 10)
    arm_objs += [limb, paw, knuckles, thumb]

# UVs into the cleaned orange square; skin weights from the chain parameter
def arm_weights(P, ch):
    sh, el, hd = ch['shoulder'], ch['elbow'], ch['hand']
    def seg_t(p, a, b):
        ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1); return t, np.linalg.norm(p - (a + np.outer(t, ab)), axis=1)
    t1, d1 = seg_t(P, sh, el); t2, d2 = seg_t(P, el, hd)
    # continuous parameter: 0 shoulder, 1 elbow, 2 wrist/hand
    u = np.where(d1 <= d2, t1, 1 + t2)
    dist_inner = (P - sh) @ ((sh - el) / np.linalg.norm(sh - el))     # > 0 inside the shoulder ball
    w = {}
    w['shoulder'] = np.clip(dist_inner / 0.03, 0, 1) * 0.0
    w['upper_arm'] = 1 - RR.ss(0.75, 1.25, u)
    w['forearm'] = RR.ss(0.75, 1.25, u) * (1 - RR.ss(1.70, 1.95, u))
    w['hand'] = RR.ss(1.70, 1.95, u)
    return w
uv_layer_name = me.uv_layers[0].name
for o in arm_objs:
    s = o.name.split('.')[-1]; ch = chains[s]
    m = o.data
    if not m.uv_layers: m.uv_layers.new(name=uv_layer_name)
    P = verts_np(o)
    lv2 = np.empty(len(m.loops), dtype=np.int64); m.loops.foreach_get('vertex_index', lv2)
    # planar map of the limb (along / around) squeezed into the clean square: tangents stay well defined
    ax = (ch['hand'] - ch['shoulder']); ax /= np.linalg.norm(ax)
    a1 = np.cross(ax, [0, 0, 1]); a1 /= np.linalg.norm(a1); a2 = np.cross(ax, a1)
    q = np.stack([(P - ch['shoulder']) @ ax / 0.6, np.arctan2((P - ch['shoulder']) @ a2, (P - ch['shoulder']) @ a1) / (2 * np.pi)], 1)
    q = (q - q.min(0)) / (np.ptp(q, 0) + 1e-9) * 2 - 1
    uvv = ARM_UV_CENTER + q * ARM_UV_HALF
    m.uv_layers[0].data.foreach_set('uv', uvv[lv2].ravel())
    o.data.materials.clear(); o.data.materials.append(mat)
    w = arm_weights(P, ch)
    for bn, ww in w.items():
        vg = o.vertex_groups.get(f'{bn}.{s}') or o.vertex_groups.new(name=f'{bn}.{s}')
        for i in np.nonzero(ww > 1e-4)[0]: vg.add([int(i)], float(ww[i]), 'REPLACE')
# join arms into the body: one mesh, one material, one skin
bpy.ops.object.select_all(action='DESELECT')
for o in arm_objs: o.select_set(True)
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.data.materials[0].name = 'MascotOrange'
# make sure every vertex has weights that sum to 1 (normalise over deform groups)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
print('VERTS', len(body.data.vertices), 'GROUPS', [g.name for g in body.vertex_groups])
A_out = dict(A); A_out['pegs_from_soles'] = pegs_out
json.dump({'soles': pegs_out, 'arms': {s: {k: (v.round(4).tolist() if hasattr(v, 'round') else v) for k, v in ch.items()} for s, ch in chains.items()}},
          open(ROOT + '/tools/blender/rider_contacts.json', 'w'), indent=1)
if OUT_BLEND: bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
# ---------------------------------------------------------------- 6. export
for img in (img_base, img_mr, img_nrm): img.file_format = 'PNG' if img is not img_base else 'JPEG'
export_glb(OUT_GLB, [rig, body], export_skins=True, export_animations=False, export_yup=True,
           export_image_format='AUTO', export_apply=False)
print('EXPORTED', OUT_GLB)
