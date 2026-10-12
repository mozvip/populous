"""Procedurally build the settlement models and export them as one GLB.

Run headless from the repo root:

    blender -b --factory-startup -P tools/build_models.py -- assets/buildings.glb

Optionally render a preview strip of every level:

    blender -b --factory-startup -P tools/build_models.py -- assets/buildings.glb preview.png

Each settlement level becomes one top-level mesh object named `level_<n>`,
origin at the centre of its 2x2-cell footprint on the ground, front facing
Blender -Y (= three.js +Z). One cell = one unit. Faces carrying the `team`
material are recoloured per tribe at runtime.
"""
import math
import sys

import bpy

# ---------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------
PALETTE = {
    'team':       0xffffff,  # recoloured at runtime
    'wood':       0x8a5a32,
    'wood_dark':  0x5a3a20,
    'plaster':    0xe6d6b0,
    'mud':        0x9c7650,
    'straw':      0xd8b85a,
    'stone':      0xa8a49a,
    'stone_dark': 0x7a766e,
    'opening':    0x2a1e16,
    'fire':       0xff8a20,
}
MAT_NAMES = list(PALETTE)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def make_materials(palette=PALETTE):
    mats = {}
    for name, hexcol in palette.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        rgb = [srgb_to_linear(((hexcol >> s) & 0xff) / 255) for s in (16, 8, 0)]
        bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
        bsdf.inputs['Roughness'].default_value = 1.0
        if name == 'fire':
            bsdf.inputs['Emission Color'].default_value = (*rgb, 1.0)
            bsdf.inputs['Emission Strength'].default_value = 2.0
        mats[name] = m
    return mats


# ---------------------------------------------------------------------
# Mesh builder: accumulates low-poly primitives into one mesh
# ---------------------------------------------------------------------
class Builder:
    def __init__(self, mat_names=MAT_NAMES):
        self.mat_names = mat_names
        self.verts = []
        self.faces = []
        self.mat_idx = []

    def _add(self, pts, faces, mat):
        base = len(self.verts)
        self.verts.extend(pts)
        mi = self.mat_names.index(mat)
        for f in faces:
            self.faces.append([base + i for i in f])
            self.mat_idx.append(mi)

    @staticmethod
    def _xf(pts, cx, cy, rot):
        c, s = math.cos(rot), math.sin(rot)
        return [(cx + x * c - y * s, cy + x * s + y * c, z) for x, y, z in pts]

    def box(self, mat, cx, cy, z0, sx, sy, sz, rot=0.0):
        hx, hy = sx / 2, sy / 2
        pts = [(-hx, -hy, z0), (hx, -hy, z0), (hx, hy, z0), (-hx, hy, z0)]
        pts += [(x, y, z0 + sz) for x, y, _ in pts]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                 (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        self._add(self._xf(pts, cx, cy, rot), faces, mat)

    def frustum(self, mat, cx, cy, z0, h, r1, r2, n=8, off=0.0, caps=True):
        bot = [(r1 * math.cos(off + 2 * math.pi * i / n),
                r1 * math.sin(off + 2 * math.pi * i / n), z0) for i in range(n)]
        if r2 <= 0:
            pts = bot + [(0, 0, z0 + h)]
            faces = [(i, (i + 1) % n, n) for i in range(n)]
        else:
            top = [(r2 * math.cos(off + 2 * math.pi * i / n),
                    r2 * math.sin(off + 2 * math.pi * i / n), z0 + h) for i in range(n)]
            pts = bot + top
            faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
            if caps:
                faces.append(tuple(range(n, 2 * n)))
        if caps:
            faces.append(tuple(reversed(range(n))))
        self._add(self._xf(pts, cx, cy, 0), faces, mat)

    def pyramid(self, mat, cx, cy, z0, half, h):
        """Square hip roof / pyramid with sides aligned to the axes."""
        self.frustum(mat, cx, cy, z0, h, half * math.sqrt(2), 0, n=4, off=math.pi / 4)

    def gable(self, mat, cx, cy, z0, wx, ly, h, rot=0.0):
        """Triangular prism, ridge along local Y. wx/ly are half extents."""
        pts = [(-wx, -ly, z0), (wx, -ly, z0), (0, -ly, z0 + h),
               (-wx, ly, z0), (wx, ly, z0), (0, ly, z0 + h)]
        faces = [(0, 1, 2), (4, 3, 5), (1, 4, 5, 2), (3, 0, 2, 5), (0, 3, 4, 1)]
        self._add(self._xf(pts, cx, cy, rot), faces, mat)

    def dome(self, mat, cx, cy, z0, r, h, n=10, rings=4):
        prev_r, prev_z = r, z0
        for i in range(1, rings + 1):
            a = (math.pi / 2) * i / rings
            nr = r * math.cos(a) if i < rings else 0
            nz = z0 + h * math.sin(a)
            self.frustum(mat, cx, cy, prev_z, nz - prev_z, prev_r, nr, n=n,
                         caps=(i == 1 and False))
            prev_r, prev_z = nr, nz

    def battlements(self, mat, cx, cy, z, half, m=0.12, mh=0.12):
        """Merlons around a square of half-size `half`."""
        count = max(2, int(round(2 * half / (2 * m))))
        step = 2 * half / count
        for i in range(count + 1):
            t = -half + i * step
            self.box(mat, cx + t, cy - half, z, m, m, mh)
            self.box(mat, cx + t, cy + half, z, m, m, mh)
            if 0 < i < count:  # corners already placed by the X rows
                self.box(mat, cx - half, cy + t, z, m, m, mh)
                self.box(mat, cx + half, cy + t, z, m, m, mh)

    def round_tower(self, cx, cy, r, h, roof_h, n=8):
        self.frustum('stone', cx, cy, 0, h, r, r * 0.92, n=n)
        self.frustum('stone_dark', cx, cy, h, 0.06, r * 1.12, r * 1.12, n=n)
        self.frustum('team', cx, cy, h + 0.06, roof_h, r * 1.15, 0, n=n)

    def flag(self, cx, cy, z, pole=0.5):
        self.box('wood_dark', cx, cy, z, 0.04, 0.04, pole)
        self.box('team', cx + 0.14, cy, z + pole - 0.18, 0.26, 0.02, 0.16)

    def to_object(self, name, mats):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        for mname in self.mat_names:
            mesh.materials.append(mats[mname])
        for poly, mi in zip(mesh.polygons, self.mat_idx):
            poly.material_index = mi
            poly.use_smooth = False
        mesh.validate()
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


# Front of every building is -Y. Doors/windows sit just proud of the wall.
def door(b, y_face, w=0.18, h=0.3, x=0.0, z0=0.0):
    b.box('opening', x, y_face - 0.01, z0, w, 0.03, h)


def window(b, y_face, x, z0, s=0.12):
    b.box('opening', x, y_face - 0.01, z0, s, 0.03, s)


# ---------------------------------------------------------------------
# Levels — names follow the original Populous settlement ladder
# ---------------------------------------------------------------------
def level_tent(b):
    b.gable('team', 0, 0.05, 0, 0.42, 0.45, 0.6)
    b.gable('opening', 0, -0.405, 0.0, 0.14, 0.01, 0.3)
    b.box('wood_dark', 0, -0.42, 0, 0.04, 0.04, 0.66)
    # campfire
    for i in range(6):
        a = 2 * math.pi * i / 6
        b.box('stone_dark', -0.55 + 0.13 * math.cos(a), -0.55 + 0.13 * math.sin(a), 0, 0.07, 0.07, 0.05)
    b.frustum('fire', -0.55, -0.55, 0, 0.18, 0.07, 0, n=5)


def level_mud_hut(b):
    b.dome('mud', 0, 0, 0, 0.55, 0.6, n=10, rings=4)
    b.box('opening', 0, -0.52, 0, 0.2, 0.08, 0.28)
    b.frustum('straw', 0, 0, 0.55, 0.12, 0.1, 0, n=6)


def level_straw_hut(b):
    b.frustum('plaster', 0, 0, 0, 0.42, 0.55, 0.55, n=10)
    b.frustum('straw', 0, 0, 0.42, 0.6, 0.75, 0, n=10)
    b.box('opening', 0, -0.54, 0, 0.2, 0.04, 0.3)
    b.box('wood', 0.45, -0.55, 0, 0.5, 0.04, 0.06)  # little fence
    b.box('wood', 0.7, -0.55, 0, 0.04, 0.04, 0.2)
    b.box('wood', 0.22, -0.55, 0, 0.04, 0.04, 0.2)


def level_wooden_hut(b):
    b.box('wood', 0, 0, 0, 1.0, 0.8, 0.5)
    b.gable('wood', 0, 0, 0.5, 0.4, 0.5, 0.32, rot=math.pi / 2)
    b.gable('wood_dark', 0, 0, 0.48, 0.52, 0.6, 0.38, rot=math.pi / 2)
    door(b, -0.4, x=-0.2)
    window(b, -0.4, 0.22, 0.22)


def level_stone_hut(b):
    b.box('stone', 0, 0, 0, 1.1, 1.0, 0.55)
    b.pyramid('team', 0, 0, 0.55, 0.66, 0.5)
    door(b, -0.5, x=-0.22)
    window(b, -0.5, 0.25, 0.25)
    b.box('stone_dark', 0.35, 0.2, 0.7, 0.14, 0.14, 0.4)  # chimney


def level_wooden_house(b):
    W, D, H = 1.4, 1.0, 0.9
    b.box('plaster', 0, 0, 0, W, D, H)
    # timber frame
    for x in (-W / 2, 0, W / 2):
        for y in (-D / 2, D / 2):
            b.box('wood_dark', x, y, 0, 0.07, 0.07, H)
    b.box('wood_dark', 0, -D / 2, H / 2 - 0.03, W + 0.02, 0.07, 0.06)
    b.box('wood_dark', 0, D / 2, H / 2 - 0.03, W + 0.02, 0.07, 0.06)
    b.gable('plaster', 0, 0, H, D / 2, W / 2, 0.42, rot=math.pi / 2)
    b.gable('team', 0, 0, H - 0.02, D / 2 + 0.12, W / 2 + 0.1, 0.5, rot=math.pi / 2)
    b.box('stone_dark', 0.45, 0.2, H, 0.16, 0.16, 0.55)
    door(b, -D / 2, x=-0.35, h=0.34)
    for x in (0.35,):
        window(b, -D / 2, x, 0.18)
    for x in (-0.35, 0.35):
        window(b, -D / 2, x, 0.6)


def level_stone_house(b):
    b.box('stone', -0.15, 0.1, 0, 1.3, 1.0, 0.95)
    b.gable('stone', -0.15, 0.1, 0.95, 0.5, 0.65, 0.42, rot=math.pi / 2)
    b.gable('team', -0.15, 0.1, 0.93, 0.62, 0.78, 0.5, rot=math.pi / 2)
    # side wing
    b.box('stone', 0.6, -0.25, 0, 0.6, 0.7, 0.6)
    b.gable('team', 0.6, -0.25, 0.6, 0.38, 0.42, 0.32)
    b.box('stone_dark', -0.55, 0.35, 0.95, 0.18, 0.18, 0.6)
    door(b, -0.6, x=0.6, h=0.32)
    window(b, -0.4, -0.5, 0.2)
    window(b, -0.4, -0.15, 0.2)
    window(b, -0.4, -0.5, 0.6)
    window(b, -0.4, -0.15, 0.6)
    b.flag(0.6, -0.25, 0.92, 0.35)


def keep(b, cx, cy, half, h):
    b.box('stone', cx, cy, 0, 2 * half, 2 * half, h)
    b.box('stone_dark', cx, cy, h, 2 * half + 0.08, 2 * half + 0.08, 0.06)
    b.battlements('stone', cx, cy, h + 0.06, half + 0.01)
    for z in (h * 0.45, h * 0.75):
        window(b, cy - half, cx, z, s=0.1)


def level_small_castle(b):
    keep(b, 0, 0.1, 0.55, 1.5)
    door(b, 0.1 - 0.55, h=0.38, w=0.24)
    b.flag(0, 0.1, 1.56, 0.6)
    b.box('stone', 0, -0.75, 0, 1.1, 0.12, 0.35)  # low front wall
    b.box('opening', 0, -0.82, 0, 0.26, 0.04, 0.26)


def level_fort(b):
    keep(b, 0, 0.25, 0.5, 1.6)
    b.flag(0, 0.25, 1.66, 0.6)
    for x in (-0.7, 0.7):
        b.round_tower(x, -0.55, 0.28, 1.25, 0.5)
    b.box('stone', 0, -0.55, 0, 1.4, 0.18, 0.7)
    for i in range(5):
        b.box('stone', -0.4 + 0.2 * i, -0.55, 0.7, 0.1, 0.18, 0.1)
    b.box('opening', 0, -0.65, 0, 0.3, 0.04, 0.4)
    for x in (-0.7, 0.7):
        b.box('stone', x, 0.0, 0, 0.18, 0.9, 0.6)


def level_castle(b):
    S = 1.0  # curtain wall half-size
    for (cx, cy, sx, sy) in ((0, -S, 2 * S, 0.18), (0, S, 2 * S, 0.18),
                             (-S, 0, 0.18, 2 * S), (S, 0, 0.18, 2 * S)):
        b.box('stone', cx, cy, 0, sx, sy, 0.7)
    for i in range(7):
        t = -0.6 + 0.2 * i
        for x, y in ((t, -S), (t, S), (-S, t), (S, t)):
            b.box('stone', x, y, 0.7, 0.1, 0.1, 0.1)
    for x in (-S, S):
        for y in (-S, S):
            b.round_tower(x, y, 0.3, 1.25, 0.55)
    # gatehouse
    for x in (-0.25, 0.25):
        b.box('stone', x, -S, 0, 0.2, 0.3, 0.95)
        b.pyramid('team', x, -S, 0.95, 0.14, 0.25)
    b.box('opening', 0, -S - 0.1, 0, 0.3, 0.04, 0.45)
    keep(b, 0, 0.15, 0.45, 1.9)
    b.round_tower(0.3, 0.45, 0.16, 2.2, 0.4, n=6)
    b.flag(-0.2, 0.15, 1.96, 0.7)


LEVELS = [
    level_tent, level_mud_hut, level_straw_hut, level_wooden_hut,
    level_stone_hut, level_wooden_house, level_stone_house,
    level_small_castle, level_fort, level_castle,
]


def build_all():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials()
    objs = []
    for i, fn in enumerate(LEVELS):
        b = Builder()
        fn(b)
        objs.append(b.to_object(f'level_{i}', mats))
    return objs


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


def render_preview(objs, path):
    scene = bpy.context.scene
    spacing = 3.0
    dup = []
    for i, o in enumerate(objs):
        c = o.copy()
        c.location = (i * spacing, 0, 0)
        scene.collection.objects.link(c)
        dup.append(c)
    for o in objs:
        o.hide_render = True
    bpy.ops.mesh.primitive_plane_add(size=80, location=(13.5, 0, 0))
    ground = bpy.context.active_object
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.15, 0.35, 0.1, 1)
    ground.data.materials.append(gm)
    # tint team material blue for the preview
    tm = bpy.data.materials['team']
    tm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.05, 0.15, 0.6, 1)

    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 31
    cam.location = (13.5, -14, 10)
    cam.rotation_euler = (math.radians(58), 0, 0)
    scene.collection.objects.link(cam)
    scene.camera = cam
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.6, 0.8, 1)
    scene.world = world
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 16
    scene.render.resolution_x = 2000
    scene.render.resolution_y = 500
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = argv[0] if argv else 'assets/buildings.glb'
    objs = build_all()
    export(out)
    print(f'exported {len(objs)} levels to {out}')
    if len(argv) > 1:
        render_preview(objs, argv[1])
