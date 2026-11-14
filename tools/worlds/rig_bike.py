"""Rig the three-worlds bikes for the first-person view (run with headless Blender):
  Blender -b --python rig_bike.py -- <out_dir>
Each generated bike is one fused mesh. This splits it into three nodes, in bike-mount space (three.js: metres, y up, -z forward,
wheels on y = 0):   body  ->  front (fork, bars, fender, headlight; origin on the steering axis)  ->  wheel_f (origin at the axle)
so the page can steer `front` about the steering axis and spin `wheel_f` about its local x. Cut openings are capped.
The woodland bike is also put into mount space (1.92 m long) and its skewed handlebar is straightened. Textures go to 2K WebP.
Originals in dev-game/assets/models are only read."""
import bpy, bmesh, sys, json, math
import numpy as np
from mathutils import Matrix, Vector

OUT = sys.argv[sys.argv.index('--') + 1]
from pathlib import Path
M = str(Path(__file__).resolve().parents[2] / 'assets/models') + '/'
BIKES = {
    'desert':      dict(src=M + 'desert-bike/desert-bike-game.glb', roots=False, rake=24, bars_y=0.92, straighten=False, wide_z=None),
    'roots-day':   dict(src=M + 'roots-bike/bike.glb',              roots=True,  rake=25, bars_y=0.86, straighten=True, wide_z=-0.52, delta=([0.60, 0.70], [0.13, 0.21])),
    'roots-night': dict(src=M + 'roots-bike-night/bike.glb',        roots=True,  rake=25, bars_y=0.86, straighten=True, wide_z=-0.52, delta=([0.60, 0.70], [0.13, 0.21])),
}
to_three = lambda B: np.stack([B[:, 0], B[:, 2], -B[:, 1]], 1)      # Blender (X, Y, Z) -> three (x, y, z)
to_blender = lambda T: np.stack([T[:, 0], -T[:, 2], T[:, 1]], 1)
smooth = lambda a, b, v: (lambda t: t * t * (3 - 2 * t))(np.clip((v - a) / (b - a), 0, 1))

def rig(name, cfg):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=cfg['src'])
    obs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    W = ob.matrix_world.copy(); ob.parent = None; ob.matrix_world = Matrix.Identity(4); ob.data.transform(W)
    for o in list(bpy.context.scene.objects):
        if o is not ob: bpy.data.objects.remove(o)
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.triangulate(bm, faces=bm.faces[:]); bm.to_mesh(me); bm.free()

    V = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', V); V = to_three(V.reshape(-1, 3))
    if cfg['roots']:                       # the page's old runtime placement, baked: 1.92 m long, rotation.y = -90 deg, centred, on the ground
        size = V.max(0) - V.min(0); V = V * (1.92 / max(size[0], size[2]))
        V = np.stack([-V[:, 2], V[:, 1], V[:, 0]], 1)
        c = (V.max(0) + V.min(0)) / 2; V = V - [c[0], V[:, 1].min(), c[2]]
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    info = {}
    bars = (y > cfg['bars_y']) & (z < 0.2) & (np.abs(x) > 0.05)
    fit = bars & (np.abs(x) > 0.2)
    a, b = np.polyfit(x[fit], z[fit], 1); c, d = np.polyfit(x[fit], y[fit], 1)
    info['bar_skew'] = dict(z_per_x=float(a), y_per_x=float(c))
    if cfg['straighten']:                  # rotate each side of the bar back square about the clamp; blend in from the centre
        w = smooth(0.05, 0.16, np.abs(x[bars])); al = math.atan(a) * w; be = -math.atan(c) * w
        xr, yr, zr = x[bars], y[bars] - d, z[bars] - b
        x1 = xr * np.cos(al) + zr * np.sin(al); z1 = -xr * np.sin(al) + zr * np.cos(al)
        x2 = x1 * np.cos(be) - yr * np.sin(be); y2 = x1 * np.sin(be) + yr * np.cos(be)
        V[bars] = np.stack([x2, y2 + d, z1 + b], 1); x, y, z = V[:, 0], V[:, 1], V[:, 2]
        a2 = np.polyfit(x[fit], z[fit], 1)[0]; c2 = np.polyfit(x[fit], y[fit], 1)[0]; info['bar_skew_after'] = dict(z_per_x=float(a2), y_per_x=float(c2))
    me.vertices.foreach_set('co', to_blender(V).ravel()); me.update()

    # front wheel: the foremost tyre point gives the axle height (= radius, the tyre stands on y = 0) and its z
    zmin = z.min(); R = float(np.median(y[z < zmin + 0.008])); yA, zA = R, float(zmin + R)
    rr = np.hypot(y - yA, z - zA); tyre = (rr > 0.8 * R) & (rr < R + 0.003) & (y < yA - 0.4 * R)
    hw = float(np.abs(x[tyre]).max() + 0.004)
    rake = math.radians(cfg['rake']); axis = [0.0, math.cos(rake), math.sin(rake)]
    pivot = [0.0, 0.85, zA + (0.85 - yA) * math.tan(rake)]
    info.update(axle=[0.0, yA, zA], radius=R, half_width=hw, axis=axis, pivot=pivot)

    F = np.empty(len(me.polygons) * 3, dtype=np.int64); me.polygons.foreach_get('vertices', F); C = V[F.reshape(-1, 3)].mean(1)
    cx, cy, cz = C[:, 0], C[:, 1], C[:, 2]; r = np.hypot(cy - yA, cz - zA)
    wheel = (r < R + 0.003) & (np.abs(cx) < np.where(r > 0.7 * R, hw, 0.6 * hw))      # tyre and rim full width; hub and spokes narrower, so the fork legs stay put
    zline = zA + (cy - yA) * math.tan(rake)
    # below the bars only what is narrow (fork, headlight, fender) turns with the fork; wide panels beside it (tank shrouds)
    # belong to the body, except those far enough forward to be the fender (wide_z, per bike)
    narrow = (np.abs(cx) < 0.14) | ((cz < cfg['wide_z']) if cfg['wide_z'] is not None else False)
    front = ((cz < zline + np.interp(cy, *cfg.get('delta', ([0.60, 0.75], [0.13, 0.055])))) & narrow) | ((cy > cfg['bars_y']) & (cz < 0.2) & ((np.abs(cx) > 0.14) | (cy > cfg['bars_y'] + 0.04) | (cz < zline + 0.15))) | ((np.abs(cx) > 0.14) & (cy > 0.80) & (cz < 0.2)) | ((r < R + 0.07) & (cy > yA - 0.05) & (cz < zA + 0.27) & narrow)
    part = np.where(wheel, 2, np.where(front, 1, 0))
    info['tris'] = dict(body=int((part == 0).sum()), front=int((part == 1).sum()), wheel_f=int((part == 2).sum()))

    def piece(p, nm):
        o = ob.copy(); o.data = me.copy(); o.name = nm; o.data.name = nm; bpy.context.scene.collection.objects.link(o)
        bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
        cut = [e for e in bm.edges if len({int(part[f.index]) for f in e.link_faces}) > 1 and any(part[f.index] == p for f in e.link_faces)]
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if part[f.index] != p], context='FACES')
        cut = [e for e in cut if e.is_valid]
        before = set(bm.faces); bmesh.ops.holes_fill(bm, edges=cut, sides=0); new = [f for f in bm.faces if f not in before]
        uv = bm.loops.layers.uv.active
        if uv:
            for f in new:
                f.smooth = True
                for l in f.loops:
                    for l2 in l.vert.link_loops:
                        if l2.face in before: l[uv].uv = l2[uv].uv; break
        bm.to_mesh(o.data); bm.free(); return o, len(new)
    body, n0 = piece(0, 'body'); frontO, n1 = piece(1, 'front'); wheelO, n2 = piece(2, 'wheel_f')
    info['caps'] = [n0, n1, n2]
    bpy.data.objects.remove(ob)
    P = Vector((pivot[0], -pivot[2], pivot[1])); A = Vector((0.0, -zA, yA))
    frontO.data.transform(Matrix.Translation(-P)); frontO.location = P
    wheelO.data.transform(Matrix.Translation(-A)); wheelO.parent = frontO; wheelO.matrix_parent_inverse = Matrix.Identity(4); wheelO.location = A - P
    for img in bpy.data.images:
        if img.size[0] > 2048 or img.size[1] > 2048: img.scale(min(2048, img.size[0]), min(2048, img.size[1]))
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/{name}-rigged.glb', export_format='GLB', export_image_format='WEBP', export_image_quality=90, export_yup=True, export_apply=False)
    return info

res = {k: rig(k, v) for k, v in BIKES.items()}
json.dump(res, open(f'{OUT}/rig.json', 'w'), indent=1)
print('RIG', json.dumps(res))
