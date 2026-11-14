"""Derived, game-ready desert bike. The original GLB is read, never written.
Usage: Blender -b --python clean_bike.py -- <out.glb> [<out.blend>]
- Bakes the bike into bike-mount space (front +Y in Blender == -Z in three.js, 1.8 m long, wheels on the ground).
- Removes the generated mesh's 16 degree yaw twist of the handlebar assembly (the left grip sat 25 cm ahead of the right)
  and gives the bar a little rise and sweep so a small rider can reach it with bent elbows.
- Adds forward 'highway' footpegs on the front frame where the mascot's feet rest (the stock pegs are kept).
- Downsizes textures to 2K for the game copy."""
import sys; sys.path.insert(0, '/Users/arjunbehl/Developer/dev-game/tools/blender')
from common import *
A = json.load(open('/Users/arjunbehl/Developer/dev-game/tools/blender/anchors.json'))
args = sys.argv[sys.argv.index('--') + 1:]
reset(); bike = import_single_mesh(BIKE_SRC, 'DesertBike'); bike_to_mount(bike)
N0 = vertex_normals_from_mesh(bike)
V = verts_np(bike); x, y, z = V.T
# --- handlebar: the generated bar is asymmetric (left half straight and forward, right half swept back ~32 deg and 25 cm
# further back). Each grip assembly (grip, lever, switchgear, hand guard) gets its own rigid transform onto a symmetric target;
# the tube between the clamp and the assembly bends smoothly. Measured from dark-rubber vertex slices (grip_pca in the notes).
def rot_between(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b); v = np.cross(a, b); c = a @ b
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]]); return np.eye(3) + K + K @ K / (1 + c)
G = A['grip_fix']
wb = smoothstep(0.835, 0.875, z) * smoothstep(0.02, 0.10, y) * (1 - smoothstep(0.52, 0.58, y))
V2 = V.copy(); moved_w = np.zeros(len(V))
for side, key in ((-1, 'left'), (1, 'right')):
    g = G[key]; cm = np.array(g['measured_center']); am = np.array(g['measured_axis'])
    ct = np.array(A['grips'][key]); yaw = np.radians(G['target_sweep_deg']); pitch = np.radians(G['target_droop_deg'])
    at = np.array([side * np.cos(yaw) * np.cos(pitch), -np.sin(yaw), -np.sin(pitch)])   # outer end slightly back and down
    R = rot_between(am * np.array([side, 1, 1]) if am[0] * side < 0 else am, at)
    t = ct - R @ cm
    w = wb * (x * side > 0) * smoothstep(G['bend_from_m'], G['bend_to_m'], x * side)
    P = V @ R.T + t
    V2 += (P - V) * w[:, None]; moved_w = np.maximum(moved_w, w)
x, y, z = V2.T
set_verts_np(bike, V2)
Ng = welded_normals(bike)
bend = ((moved_w > 0.01) & (moved_w < 0.99)).astype(float)
# rigidly moved parts: rotate imported normals; bending tube: recomputed normals
N = N0.copy()
for side, key in ((-1, 'left'), (1, 'right')):
    g = G[key]; am = np.array(g['measured_axis']); yaw = np.radians(G['target_sweep_deg']); pitch = np.radians(G['target_droop_deg'])
    at = np.array([side * np.cos(yaw) * np.cos(pitch), -np.sin(yaw), -np.sin(pitch)]); R = rot_between(am, at)
    m = (V[:, 0] * side > 0) & (moved_w > 0.99); N[m] = N0[m] @ R.T
N = N * (1 - bend[:, None]) + Ng * bend[:, None]
set_vertex_normals(bike, N / np.linalg.norm(N, axis=1, keepdims=True))
# report grips (outermost 11 cm of each bar end)
V3 = verts_np(bike)
for side in (-1, 1):
    m = (V3[:, 0] * side > 0.30) & (V3[:, 2] > 0.85)
    P = V3[m]; e = P[np.argmax(P[:, 0] * side)]
    gm = m & (np.abs(V3[:, 0]) > np.abs(e[0]) - 0.11)
    print('GRIP', side, 'outer end', e.round(3), 'grip centroid', V3[gm].mean(0).round(3))
if len(args) > 1: bpy.ops.wm.save_as_mainfile(filepath=args[1])
# ---- forward footpegs under the rider's soles (positions written by build_rider.py)
import os
cpath = ROOT + '/tools/blender/rider_contacts.json'
if os.path.exists(cpath):
    soles = json.load(open(cpath))['soles']
    me = bike.data
    uvs = np.empty(len(me.loops) * 2); me.uv_layers[0].data.foreach_get('uv', uvs); uvs = uvs.reshape(-1, 2)
    lvb = np.empty(len(me.loops), dtype=np.int64); me.loops.foreach_get('vertex_index', lvb)
    Vb = verts_np(bike)
    # UV patch: a loop on the dark rubber grip (lowest base colour near the left grip centre) for a rubber look
    img = [i for i in bpy.data.images if i.colorspace_settings.name == 'sRGB'][0]
    W_, H_ = img.size; px = np.array(img.pixels[:], dtype=np.float32).reshape(H_, W_, 4)
    gl = np.array(A['grips']['left']); near = np.where(np.linalg.norm(Vb[lvb] - gl, axis=1) < 0.05)[0]
    lum = px[np.clip((uvs[near, 1] * (H_ - 1)).astype(int), 0, H_ - 1), np.clip((uvs[near, 0] * (W_ - 1)).astype(int), 0, W_ - 1), :3].mean(1)
    uv_dark = uvs[near[np.argmin(lum)]]
    parts = []
    for key, side in (('left', -1), ('right', 1)):
        sole = np.array(soles[key]); top = sole[2] - 0.004
        peg_c = np.array([sole[0], sole[1], top - 0.02])          # peg axis 2 cm under the sole contact
        bm = bmesh.new()
        # ribbed peg along X: a short cylinder with 5 rings of grip ridges
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.021, radius2=0.021, depth=0.11,
                              matrix=Matrix.Translation(Vector(peg_c)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
        for k in range(5):
            bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.024, radius2=0.024, depth=0.008,
                                  matrix=Matrix.Translation(Vector(peg_c + [(-0.04 + 0.02 * k) * side, 0, 0])) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
        # bracket: strut from the frame down-tube (inboard, below) to the inner end of the peg
        inner = peg_c - np.array([side * 0.055, 0, 0]); frame = np.array([side * 0.10, sole[1] + 0.03, top - 0.10])
        d = inner - frame; L = float(np.linalg.norm(d)); q = Vector((0, 0, 1)).rotation_difference(Vector(d / L))
        bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.014, radius2=0.012, depth=L,
                              matrix=Matrix.Translation(Vector((frame + inner) / 2)) @ q.to_matrix().to_4x4())
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.02, matrix=Matrix.Translation(Vector(frame)))
        m = bpy.data.meshes.new('HighwayPeg_' + key); bm.to_mesh(m); bm.free()
        o = bpy.data.objects.new('HighwayPeg_' + key, m); bpy.context.scene.collection.objects.link(o)
        m.uv_layers.new(name=me.uv_layers[0].name)
        P = verts_np(o); lv2 = np.empty(len(m.loops), dtype=np.int64); m.loops.foreach_get('vertex_index', lv2)
        q2 = (P - P.mean(0))[:, [0, 2]]; q2 = q2 / (np.abs(q2).max() + 1e-9)
        m.uv_layers[0].data.foreach_set('uv', (uv_dark + q2[lv2] * 0.0015).ravel())
        m.materials.append(me.materials[0])
        for p_ in m.polygons: p_.use_smooth = True
        parts.append(o)
        print('PEG', key, 'centre', peg_c.round(3), 'frame mount', frame.round(3))
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts: o.select_set(True)
    bike.select_set(True); bpy.context.view_layer.objects.active = bike; bpy.ops.object.join()
# ---- game copy: 2K textures, export (originals untouched)
for img in bpy.data.images:
    if img.size[0] > 2048: img.scale(2048, 2048)
bike.data.materials[0].name = 'DesertBike'
export_glb(args[0], [bike], export_image_format='AUTO')
print('EXPORTED', args[0])
