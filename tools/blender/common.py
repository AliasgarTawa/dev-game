"""Shared helpers for the rider/bike Blender scripts (run with Blender 5.x in background mode)."""
import bpy, bmesh, math, json, numpy as np
from mathutils import Vector, Matrix
ROOT = '/Users/arjunbehl/Developer/dev-game'
BIKE_SRC = ROOT + '/assets/models/desert-bike/desert-bike.glb'
RIDER_SRC = ROOT + '/assets/models/mascot/rider.glb'
BIKE_LENGTH = 1.8          # metres, same calibration index.html used before

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def import_single_mesh(path, name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    mesh = [o for o in new if o.type == 'MESH'][0]
    for o in new:
        if o is not mesh: bpy.data.objects.remove(o)
    mesh.name = name
    return mesh

def verts_np(obj):
    a = np.empty(len(obj.data.vertices) * 3); obj.data.vertices.foreach_get('co', a); return a.reshape(-1, 3)

def set_verts_np(obj, V):
    obj.data.vertices.foreach_set('co', np.ascontiguousarray(V, dtype=np.float64).ravel()); obj.data.update()

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def bike_to_mount(obj):
    """Original Meshy bike (front -X, Z up) -> bike mount space: front +Y, 1.8 m long, centred, wheels on z = 0.
    Blender +Y forward becomes three.js -Z forward after glTF export, so no runtime rotation is needed."""
    V = verts_np(obj)
    s = BIKE_LENGTH / (V[:, 0].max() - V[:, 0].min())
    M = np.stack([V[:, 1], -V[:, 0], V[:, 2]], 1) * s
    c = (M.max(0) + M.min(0)) / 2
    M[:, 0] -= c[0]; M[:, 1] -= c[1]; M[:, 2] -= M[:, 2].min()
    set_verts_np(obj, M)
    return s

def export_glb(path, objects, **kw):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', **kw)

def vertex_normals_from_mesh(obj):
    """Per-vertex normals as imported (glTF custom normals), averaged over each vertex's corners."""
    me = obj.data
    cn = np.empty(len(me.loops) * 3); me.corner_normals.foreach_get('vector', cn); cn = cn.reshape(-1, 3)
    lv = np.empty(len(me.loops), dtype=np.int64); me.loops.foreach_get('vertex_index', lv)
    N = np.zeros((len(me.vertices), 3)); np.add.at(N, lv, cn)
    return N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12)

def welded_normals(obj, tol=1e-5):
    """Area-weighted smooth normals computed on the position-welded mesh, so UV seams do not show."""
    me = obj.data; V = verts_np(obj)
    key = np.round(V / tol).astype(np.int64); _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel()
    me.calc_loop_triangles()
    T = np.empty(len(me.loop_triangles) * 3, dtype=np.int64); me.loop_triangles.foreach_get('vertices', T); T = T.reshape(-1, 3)
    fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    Nw = np.zeros((inv.max() + 1, 3))
    for k in range(3): np.add.at(Nw, inv[T[:, k]], fn)
    N = Nw[inv]; return N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12)

def set_vertex_normals(obj, N):
    me = obj.data
    for p in me.polygons: p.use_smooth = True
    me.normals_split_custom_set_from_vertices([tuple(n) for n in N])
