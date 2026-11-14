"""Orthographic review renders. Usage: Blender -b --python render_views.py -- <file.glb|.blend> <out_prefix> "<views dict>" [size]
views: {'name': ((cx,cy,cz),(dx,dy,dz),ortho_scale)} in Blender Z-up coordinates."""
import bpy, sys, mathutils
args=sys.argv[sys.argv.index("--")+1:]
path,out=args[0],args[1]; views=eval(args[2]); size=int(args[3]) if len(args)>3 else 700
if path.endswith('.blend'): bpy.ops.wm.open_mainfile(filepath=path)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for p in path.split(','): bpy.ops.import_scene.gltf(filepath=p)
sc=bpy.context.scene
sc.render.engine='BLENDER_EEVEE'
sc.render.resolution_x=sc.render.resolution_y=size
w=bpy.data.worlds.new("w"); sc.world=w; w.use_nodes=True
w.node_tree.nodes["Background"].inputs[0].default_value=(.35,.4,.45,1)
sun=bpy.data.objects.new("sun",bpy.data.lights.new("sun",'SUN')); sun.data.energy=3; sun.rotation_euler=(0.6,0.2,0.8); sc.collection.objects.link(sun)
cam=bpy.data.objects.new("cam",bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera=cam
cam.data.type='ORTHO'; cam.data.clip_end=100
for name,(c,d,s) in views.items():
    c=mathutils.Vector(c); d=mathutils.Vector(d).normalized(); cam.location=c+d*8; cam.data.ortho_scale=s
    cam.rotation_euler=(-d).to_track_quat('-Z','Y').to_euler()
    sc.render.filepath=f"{out}_{name}.png"; bpy.ops.render.render(write_still=True)
