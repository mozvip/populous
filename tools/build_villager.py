"""Procedurally build the villager (walker) model and export it as a GLB.

Run headless from the repo root:

    blender -b --factory-startup -P tools/build_villager.py -- assets/villager.glb

Optionally render a preview:

    blender -b --factory-startup -P tools/build_villager.py -- assets/villager.glb preview.png

The model is an empty named `villager` (origin between the feet, front
facing Blender -Y = three.js +Z) with five mesh children: `body`, `leg_l`,
`leg_r`, `arm_l` and `arm_r`. Each limb's origin sits at its hip or
shoulder joint so the game can swing it around local X for a walk cycle.
Faces carrying the `team` material are recoloured per tribe at runtime.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_models import Builder, make_materials  # noqa: E402

PALETTE = {
    'team':     0xffffff,  # tunic and sleeves, recoloured at runtime
    'skin':     0xe0a878,
    'hair':     0x4a3020,
    'trousers': 0x6b5638,
    'leather':  0x3a2a1a,
}
MAT_NAMES = list(PALETTE)

HIP_Z = 0.26
SHOULDER_Z = 0.47
SHOULDER_X = 0.135
HIP_X = 0.055


def sphere(b, mat, cx, cy, cz, r, n=8, rings=4):
    """Low-poly UV sphere."""
    pts = [(0, 0, -r)]
    for i in range(1, rings):
        a = -math.pi / 2 + math.pi * i / rings
        for j in range(n):
            t = 2 * math.pi * j / n
            pts.append((r * math.cos(a) * math.cos(t), r * math.cos(a) * math.sin(t), r * math.sin(a)))
    pts.append((0, 0, r))
    top = len(pts) - 1
    faces = [(0, 1 + (j + 1) % n, 1 + j) for j in range(n)]
    for i in range(rings - 2):
        r0, r1 = 1 + i * n, 1 + (i + 1) * n
        faces += [(r0 + j, r0 + (j + 1) % n, r1 + (j + 1) % n, r1 + j) for j in range(n)]
    last = 1 + (rings - 2) * n
    faces += [(last + j, last + (j + 1) % n, top) for j in range(n)]
    b._add([(cx + x, cy + y, cz + z) for x, y, z in pts], faces, mat)


def body(b):
    # tunic, flaring out below the belt
    b.frustum('team', 0, 0, 0.2, 0.12, 0.125, 0.11, n=8)
    b.frustum('leather', 0, 0, 0.31, 0.035, 0.118, 0.118, n=8)
    b.frustum('team', 0, 0, 0.345, 0.15, 0.11, 0.085, n=8)
    # neck and head
    b.frustum('skin', 0, 0, 0.49, 0.05, 0.035, 0.035, n=6)
    sphere(b, 'skin', 0, 0, 0.6, 0.085)
    b.box('skin', 0, -0.085, 0.585, 0.025, 0.03, 0.035)  # nose: shows facing
    b.dome('hair', 0, 0.015, 0.615, 0.092, 0.085, n=8, rings=3)
    b.box('hair', 0, 0.06, 0.53, 0.15, 0.06, 0.08)       # back of the head


def leg(b):
    # relative to the hip joint
    b.box('trousers', 0, 0, -HIP_Z + 0.04, 0.075, 0.08, HIP_Z - 0.03)
    b.box('leather', 0, -0.02, -HIP_Z, 0.085, 0.13, 0.05)


def arm(b, side):
    # relative to the shoulder joint; sleeve slightly splayed outwards
    b.frustum('team', 0.005 * side, 0, -0.15, 0.17, 0.035, 0.045, n=6)
    sphere(b, 'skin', 0.01 * side, 0, -0.18, 0.034, n=6, rings=3)


def build_all():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials(PALETTE)

    root = bpy.data.objects.new('villager', None)
    bpy.context.scene.collection.objects.link(root)

    parts = [
        ('body', body, (0, 0, 0)),
        ('leg_l', leg, (HIP_X, 0, HIP_Z)),
        ('leg_r', leg, (-HIP_X, 0, HIP_Z)),
        ('arm_l', lambda b: arm(b, 1), (SHOULDER_X, 0, SHOULDER_Z)),
        ('arm_r', lambda b: arm(b, -1), (-SHOULDER_X, 0, SHOULDER_Z)),
    ]
    for name, fn, pivot in parts:
        b = Builder(MAT_NAMES)
        fn(b)
        obj = b.to_object(name, mats)
        obj.location = pivot
        obj.parent = root
    return root


def export(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
    )


def render_preview(root, path):
    scene = bpy.context.scene
    # mid-stride pose so the joints are visible
    for name, ang in (('leg_l', 25), ('leg_r', -25), ('arm_l', -20), ('arm_r', 20)):
        bpy.data.objects[name].rotation_euler = (math.radians(ang), 0, 0)
    bpy.ops.mesh.primitive_plane_add(size=10)
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.15, 0.35, 0.1, 1)
    bpy.context.active_object.data.materials.append(gm)
    tm = bpy.data.materials['team']
    tm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.05, 0.15, 0.6, 1)

    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 1.0
    cam.location = (1.2, -1.6, 1.3)
    cam.rotation_euler = (math.radians(62), 0, math.radians(37))
    scene.collection.objects.link(cam)
    scene.camera = cam
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.6, 0.8, 1)
    scene.world = world
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 16
    scene.render.resolution_x = 600
    scene.render.resolution_y = 600
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = argv[0] if argv else 'assets/villager.glb'
    root = build_all()
    export(out)
    print(f'exported villager to {out}')
    if len(argv) > 1:
        render_preview(root, argv[1])
