import sys; sys.path.insert(0, '/Users/arjunbehl/Developer/dev-game/tools/blender')
from common import *
import importlib, rider_regions as RR
out = sys.argv[sys.argv.index('--') + 1]
reset(); m = import_single_mesh(RIDER_SRC, 'Rider')
V = verts_np(m); W = RR.region_weights(V)
faces = [tuple(p.vertices) for p in m.data.polygons]
w = np.clip(W['armL'] + W['armR'], 0, 1) * (1 - np.clip(W['legL'] + W['legR'], 0, 1)) * (1 - W['head'])
ex = np.clip(W['legL'] + W['legR'] + W['head'], 0, 1)
N0 = vertex_normals_from_mesh(m)
V2 = RR.flatten_into_torso(V, faces, w, ex)
set_verts_np(m, V2)
moved = np.clip(np.linalg.norm(V2 - V, axis=1) / 0.004, 0, 1)
Ng = welded_normals(m)
N = N0 * (1 - moved[:, None]) + Ng * moved[:, None]
set_vertex_normals(m, N / np.linalg.norm(N, axis=1, keepdims=True))
m.data.shade_smooth() if hasattr(m.data,'shade_smooth') else None
bpy.ops.wm.save_as_mainfile(filepath=out + '.blend')
