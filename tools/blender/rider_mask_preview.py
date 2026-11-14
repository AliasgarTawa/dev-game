"""Preview region masks on the original mascot (orig coords: face -Y, Z up). Paints a colour attribute and renders."""
import sys; sys.path.insert(0, '/Users/arjunbehl/Developer/dev-game/tools/blender')
from common import *
import rider_regions as RR
out = sys.argv[sys.argv.index('--') + 1]
reset(); m = import_single_mesh(RIDER_SRC, 'Rider')
V = verts_np(m)
W = RR.region_weights(V)
cols = {'armL': (1, 0, 0), 'armR': (0, 0, 1), 'legL': (0, 1, 0), 'legR': (1, 1, 0), 'head': (1, 0, 1), 'tail': (0, 1, 1)}
C = np.ones((len(V), 4)) * 0.7; C[:, 3] = 1
for k, c in cols.items():
    w = W[k][:, None]; C[:, :3] = C[:, :3] * (1 - w) + np.array(c) * w
attr = m.data.color_attributes.new('mask', 'FLOAT_COLOR', 'POINT'); attr.data.foreach_set('color', C.ravel())
sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.color_type = 'VERTEX'
sc.display.shading.light = 'STUDIO'; sc.render.resolution_x = sc.render.resolution_y = 500
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.0
for name, d in [('front', (0, -1, 0)), ('side', (-1, 0, 0)), ('sideR', (1, 0, 0)), ('back', (0, 1, 0)), ('tq', (-1, -1, 0.5))]:
    d = Vector(d).normalized(); cam.location = d * 6; cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'{out}_{name}.png'; bpy.ops.render.render(write_still=True)
