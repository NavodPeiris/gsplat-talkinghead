"""Generate iris_occlusion.json for LAM/FLAME Gaussian-splat avatar folders.

Usage: python scripts/generate_iris_occlusion.py assets/Jane [assets/Jack ...] [--write]
(requires numpy). Without --write it only prints what it would detect.

Splat indices in the renderer are skin.glb vertex indices (the shader reads
skinning data with the same index), so:
  1. eyeball vertices = moved by both eyeLookIn* and eyeLookUp* morph targets
     but not by eyeBlink* (these heads rotate eyes with blendshapes, not the
     eye bones; eye-bone skinning is the fallback),
  2. iris = the front-facing (+Z) cap within IRIS_DEG of the fitted eyeball
     sphere's forward axis,
  3. north/south = above/below the iris centre (upper lid covers north first).
"""
import json
import math
import os
import struct
import sys

IRIS_DEG = 28.0  # iris half-angle on the eyeball (~12 mm iris on a ~24-26 mm eyeball)
C0 = 0.28209479177387814  # SH band-0 constant (f_dc -> rgb)


def read_glb(path):
    b = open(path, 'rb').read()
    _, _, length = struct.unpack_from('<III', b, 0)
    off, js, binc = 12, None, None
    while off < length:
        clen, ctype = struct.unpack_from('<II', b, off)
        chunk = b[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk)
        elif ctype == 0x004E4942:
            binc = chunk
        off += 8 + clen
    return js, binc


COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def _read(js, binc, view_idx, byte_offset, count, fmt, n, size):
    bv = js['bufferViews'][view_idx]
    stride = bv.get('byteStride') or size * n
    base = bv.get('byteOffset', 0) + byte_offset
    return [struct.unpack_from('<' + fmt * n, binc, base + i * stride) for i in range(count)]


def accessor(js, binc, idx):
    """Reads a glTF accessor, including sparse accessors (used by morph targets)."""
    a = js['accessors'][idx]
    fmt, size = COMP[a['componentType']]
    n = NCOMP[a['type']]
    if 'bufferView' in a:
        out = _read(js, binc, a['bufferView'], a.get('byteOffset', 0), a['count'], fmt, n, size)
    else:
        out = [(0,) * n] * a['count']
    sp = a.get('sparse')
    if sp:
        ifmt, isize = COMP[sp['indices']['componentType']]
        ids = _read(js, binc, sp['indices']['bufferView'], sp['indices'].get('byteOffset', 0), sp['count'], ifmt, 1, isize)
        vals = _read(js, binc, sp['values']['bufferView'], sp['values'].get('byteOffset', 0), sp['count'], fmt, n, size)
        out = list(out)
        for (i,), v in zip(ids, vals):
            out[i] = v
    return out


def read_ply_colors(path):
    with open(path, 'rb') as f:
        header = b''
        while not header.endswith(b'end_header\n'):
            header += f.readline()
        props = [l.split()[-1].decode() for l in header.splitlines() if l.startswith(b'property')]
        count = int([l for l in header.splitlines() if l.startswith(b'element vertex')][0].split()[-1])
        data = f.read(count * 4 * len(props))
    i0 = props.index('f_dc_0')
    cols = []
    for i in range(count):
        r, g, b = struct.unpack_from('<fff', data, (i * len(props) + i0) * 4)
        cols.append(tuple(max(0.0, min(1.0, 0.5 + C0 * c)) for c in (r, g, b)))
    return cols


def to_ranges(indices):
    s = sorted(indices)
    ranges = []
    for i in s:
        if ranges and i == ranges[-1][1] + 1:
            ranges[-1][1] = i
        else:
            ranges.append([i, i])
    return ranges


def main(folder, write):
    js, binc = read_glb(os.path.join(folder, 'skin.glb'))
    prim = js['meshes'][0]['primitives'][0]
    pos = accessor(js, binc, prim['attributes']['POSITION'])
    joints = accessor(js, binc, prim['attributes']['JOINTS_0'])
    weights = accessor(js, binc, prim['attributes']['WEIGHTS_0'])
    skin_joints = [js['nodes'][j].get('name') for j in js['skins'][0]['joints']]

    # Eyeball vertices. These LAM heads rotate the eyes with morph targets
    # (eyeLook*), not the eye bones, so: moved by both a horizontal and a
    # vertical look target, and NOT by blink (which moves the lids). Falls
    # back to eye-bone skinning for rigs that do use lEye/rEye.
    mesh = js['meshes'][0]
    tnames = (mesh.get('extras') or {}).get('targetNames') or []

    def moved(name):
        if name not in tnames:
            return None
        d = accessor(js, binc, prim['targets'][tnames.index(name)]['POSITION'])
        return {i for i, v in enumerate(d) if v[0] * v[0] + v[1] * v[1] + v[2] * v[2] > 1e-10}

    eyes = {}
    for side, suffix, bone in (('left', 'Left', 'lEye'), ('right', 'Right', 'rEye')):
        look_in, look_up, blink = moved('eyeLookIn' + suffix), moved('eyeLookUp' + suffix), moved('eyeBlink' + suffix)
        if look_in and look_up and blink is not None:
            idx = sorted((look_in & look_up) - blink)
        else:
            j = skin_joints.index(bone)
            idx = [i for i in range(len(pos)) if any(joints[i][k] == j and weights[i][k] > 0.5 for k in range(4))]
        if not idx:
            raise SystemExit(f'{folder}: could not find {side} eyeball vertices')
        eyes[side] = idx

    colors = read_ply_colors(os.path.join(folder, 'offset.ply'))
    vo = json.load(open(os.path.join(folder, 'vertex_order.json')))
    lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]

    result, report = {}, []
    for side, idx in eyes.items():
        # Eyeball centre from a least-squares sphere fit (a vertex average is
        # biased toward the denser front of the mesh). Forward = +Z: the face
        # points +Z in these assets (the nose tip is the max-Z vertex).
        import numpy as np
        P = np.array([pos[i] for i in idx])
        sol, *_ = np.linalg.lstsq(np.c_[2 * P, np.ones(len(P))], (P ** 2).sum(1), rcond=None)
        cx, cy, cz = sol[:3]
        iris = []
        for i in idx:
            dx, dy, dz = pos[i][0] - cx, pos[i][1] - cy, pos[i][2] - cz
            r = math.sqrt(dx * dx + dy * dy + dz * dz) or 1e-9
            ang = math.degrees(math.acos(max(-1, min(1, dz / r))))
            if ang <= IRIS_DEG:
                iris.append(i)
        # Split at the iris's own centre height (robust to a slightly off sphere fit).
        iris_cy = sum(pos[i][1] for i in iris) / len(iris)
        north = [i for i in iris if pos[i][1] >= iris_cy]
        south = [i for i in iris if pos[i][1] < iris_cy]
        # Validation: iris splats should be darker than the rest of the eyeball.
        # Try both mappings between ply order and mesh order.
        def mean_lum(sel, mapping):
            return sum(lum(colors[mapping(i)]) for i in sel) / max(1, len(sel))
        inv = {v: k for k, v in enumerate(vo)}
        rest = [i for i in idx if i not in set(iris)]
        checks = {
            'direct': (mean_lum(iris, lambda i: i), mean_lum(rest, lambda i: i)),
            'vo[i]': (mean_lum(iris, lambda i: vo[i]), mean_lum(rest, lambda i: vo[i])),
            'inv[i]': (mean_lum(iris, lambda i: inv[i]), mean_lum(rest, lambda i: inv[i])),
        }
        report.append(f'{side}: eyeball {len(idx)} verts, iris {len(iris)} (north {len(north)}, south {len(south)}); '
                      f'luminance iris/rest: ' + ', '.join(f'{k} {a:.2f}/{b:.2f}' for k, (a, b) in checks.items()))
        result[f'{side}_iris_north'] = to_ranges(north)
        result[f'{side}_iris_south'] = to_ranges(south)

    print(os.path.basename(folder) + ':\n  ' + '\n  '.join(report))
    print('  ranges:', {k: len(v) for k, v in result.items()})
    if write:
        with open(os.path.join(folder, 'iris_occlusion.json'), 'w') as f:
            json.dump(result, f)
        print('  wrote iris_occlusion.json')


if __name__ == '__main__':
    write = '--write' in sys.argv
    for folder in [a for a in sys.argv[1:] if not a.startswith('--')]:
        main(folder, write)
