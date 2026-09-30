#!/usr/bin/env python3
"""Convert the SolidWorks STEP assembly into the web demo's model files.

Outputs
  web/public/engine.glb       one named node per part instance, geometry in the
                              CAD assembly frame (metres), under a root node
                              "engine" that turns the CAD frame into three.js Y-up
  web/public/mechanism.json   joint coordinates measured from the pin axes, the
                              link of every node; its "thermo" and "design"
                              sections are kept when the file already exists

Steps
  1. STEP AP214 -> glTF with OpenCASCADE (cascadio), keeping the product names.
  2. Group the tessellated bodies into part instances and name each one after
     its id in docs/BOM.md (via web/public/parts.json).
  3. Measure the mechanism: every pin in this engine is a shaft (parts 16, 17,
     18) whose axis is normal to the mechanism plane, so the joint centres are
     the centres of those shafts. Roles are assigned from the topology.
  4. Assign each node to a link. Hardware (pins, bearings, screws, spacers)
     follows the machined part it sits in ("host").
  5. Write a GLB and compress it with gltfpack (meshopt), if gltfpack is on PATH.

Usage: python tools/convert/convert.py [--step cad/step/00_assembly.STEP]
Run tools/convert/bom_to_parts.py first.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "web" / "public"

# Tessellation tolerances, in the STEP file's unit (mm).
TOL_LINEAR = 0.03
TOL_ANGULAR = 0.35

# Ball bearing balls are hidden behind the shields; dropping them saves ~180k triangles.
DROP_BODY = re.compile(r"\bBall$")

# Which link each machined part belongs to. Parts not listed are hardware and
# follow their host part.
LINK_OF_PART = {
    "01": "ground", "02": "ground", "05": "ground", "06": "ground", "07": "ground",
    "09": "ground", "11": "ground", "12": "ground", "22": "ground", "23": "ground",
    "24": "ground", "25": "ground", "26": "ground", "27": "ground",
    "03": "crank", "04": "crank", "18": "crank", "20": "crank",
    "13": "yoke",
    "14": "guide_rod",
    "15": None,  # rod_hot / rod_cold, decided by position
    "08": "piston_hot", "28": "piston_hot",
    "10": "piston_cold",
}

SCREW = re.compile(r"(set screw).*?(M\d+) x (\d+)|cap screw.*?(M\d+) x (\d+)")


# --------------------------------------------------------------------------- glTF I/O

COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
DTYPES = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}


def read_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    magic, _, _ = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB"
    off, js, binchunk = 12, None, b""
    while off < len(data):
        length, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8 : off + 8 + length]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk)
        elif ctype == 0x004E4942:
            binchunk = chunk
        off += 8 + length
    return js, binchunk


def accessor(js: dict, binchunk: bytes, idx: int) -> np.ndarray:
    acc = js["accessors"][idx]
    view = js["bufferViews"][acc["bufferView"]]
    n = COMPONENTS[acc["type"]]
    dtype = DTYPES[acc["componentType"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride", 0)
    itemsize = np.dtype(dtype).itemsize * n
    if stride and stride != itemsize:
        raw = np.frombuffer(binchunk, np.uint8, count=stride * acc["count"], offset=start)
        arr = raw.reshape(acc["count"], stride)[:, :itemsize].copy().view(dtype)
    else:
        arr = np.frombuffer(binchunk, dtype, count=acc["count"] * n, offset=start)
    return arr.reshape(acc["count"], n) if n > 1 else arr


def node_matrix(node: dict) -> np.ndarray:
    if "matrix" in node:
        return np.array(node["matrix"], dtype=float).reshape(4, 4).T
    m = np.eye(4)
    if "scale" in node:
        m = np.diag([*node["scale"], 1.0]) @ m
    if "rotation" in node:
        x, y, z, w = node["rotation"]
        r = np.array(
            [
                [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
            ]
        )
        rm = np.eye(4)
        rm[:3, :3] = r
        m = rm @ m
    if "translation" in node:
        t = np.eye(4)
        t[:3, 3] = node["translation"]
        m = t @ m
    return m


class Body:
    """One tessellated body, in the CAD assembly frame (metres)."""

    def __init__(self, name, path, positions, normals, indices):
        self.name = name  # product name from the STEP file
        self.path = path  # glTF node indices from the root to this body
        self.positions = positions
        self.normals = normals
        self.indices = indices


def load_bodies(glb: Path) -> list[Body]:
    js, binchunk = read_glb(glb)
    nodes, meshes = js["nodes"], js["meshes"]
    bodies: list[Body] = []

    def walk(i: int, parent: np.ndarray, path: tuple[int, ...]):
        node = nodes[i]
        world = parent @ node_matrix(node)
        path = path + (i,)
        if "mesh" in node:
            mesh = meshes[node["mesh"]]
            for prim in mesh["primitives"]:
                pos = accessor(js, binchunk, prim["attributes"]["POSITION"]).astype(float)
                nrm = accessor(js, binchunk, prim["attributes"]["NORMAL"]).astype(float)
                idx = accessor(js, binchunk, prim["indices"]).astype(np.uint32).reshape(-1)
                pos = pos @ world[:3, :3].T + world[:3, 3]
                nrm = nrm @ np.linalg.inv(world[:3, :3])
                nrm /= np.linalg.norm(nrm, axis=1, keepdims=True).clip(1e-12)
                bodies.append(Body(mesh.get("name", ""), path, pos, nrm, idx))
        for c in node.get("children", []):
            walk(c, world, path)

    for root in js["scenes"][js.get("scene", 0)]["nodes"]:
        walk(root, np.eye(4), ())
    return bodies


# --------------------------------------------------------------------------- grouping

class Instance:
    def __init__(self, part_no: str, key: tuple):
        self.part_no = part_no
        self.key = key
        self.bodies: list[Body] = []
        self.node_name = ""
        self.link = ""
        self.host: str | None = None

    @property
    def positions(self) -> np.ndarray:
        return np.concatenate([b.positions for b in self.bodies])

    @property
    def bbox(self) -> np.ndarray:
        p = self.positions
        return np.array([p.min(0), p.max(0)])

    @property
    def center(self) -> np.ndarray:
        return self.bbox.mean(0)


def part_number_of(body: Body, parts_by_no: dict) -> str | None:
    """Return the BOM number of the part a body belongs to."""
    m = re.match(r"^(\d{2})_", body.name)
    if m:
        return m.group(1)
    if body.name.startswith("MF84ZZ"):
        return "29"
    if body.name.startswith("MF106ZZ"):
        return "30"
    m = SCREW.search(body.name)
    if m:
        if m.group(1):
            size = f"{m.group(2)}x{m.group(3)}".lower()
            suffix = f"set_screw_{size}"
        else:
            size = f"{m.group(4)}x{m.group(5)}".lower()
            suffix = f"bolt_{size}"
        for no, p in parts_by_no.items():
            if p["id"].endswith(suffix):
                return no
    return None


def group_instances(bodies: list[Body], parts_by_no: dict) -> list[Instance]:
    instances: dict[tuple, Instance] = {}
    unknown = set()
    for b in bodies:
        if DROP_BODY.search(b.name):
            continue
        no = part_number_of(b, parts_by_no)
        if no is None:
            unknown.add(b.name)
            continue
        # A bearing is a sub-assembly: all its bodies share the parent node.
        key = (no, b.path[:-1]) if no in ("29", "30") else (no, b.path)
        inst = instances.setdefault(key, Instance(no, key))
        inst.bodies.append(b)
    if unknown:
        raise SystemExit(f"bodies with no BOM entry: {sorted(unknown)}")

    by_part = defaultdict(list)
    for inst in instances.values():
        by_part[inst.part_no].append(inst)
    for no, insts in by_part.items():
        pid = parts_by_no[no]["id"]
        if len(insts) != parts_by_no[no]["qty"]:
            raise SystemExit(f"{pid}: BOM quantity {parts_by_no[no]['qty']}, assembly has {len(insts)}")
        # Stable numbering: sort by position.
        insts.sort(key=lambda i: tuple(np.round(i.center * 1000, 1)))
        for k, inst in enumerate(insts, 1):
            inst.node_name = pid if len(insts) == 1 else f"{pid}__{k}"
    missing = set(parts_by_no) - set(by_part)
    if missing:
        raise SystemExit(f"BOM parts not found in the assembly: {sorted(missing)}")
    return sorted(instances.values(), key=lambda i: i.node_name)


# --------------------------------------------------------------------------- mechanism

def axis_centre_xy(inst: Instance) -> np.ndarray:
    """Centre of a shaft whose axis is along CAD Z, in mm (x, y)."""
    lo, hi = inst.bbox
    ext = hi - lo
    if not (ext[2] > 2 * ext[0] and ext[2] > 2 * ext[1]):
        raise SystemExit(f"{inst.node_name}: shaft axis is not along Z (extent {ext * 1000} mm)")
    return (lo[:2] + hi[:2]) / 2 * 1000


def measure_mechanism(insts: list[Instance]) -> dict:
    by_no = defaultdict(list)
    for i in insts:
        by_no[i.part_no].append(i)

    def c(no):  # centre of the only instance of a part, mm
        (i,) = by_no[no]
        return i.center * 1000

    O = axis_centre_xy(by_no["18"][0])
    short = [(axis_centre_xy(i), i) for i in by_no["16"]]
    long_ = [(axis_centre_xy(i), i) for i in by_no["17"]]

    # Crank pin: the short shaft closest to the crankshaft.
    short.sort(key=lambda s: np.linalg.norm(s[0] - O))
    C = short.pop(0)[0]
    # Guide-rod ground pivot: the long shaft closest to its base connector (12).
    conn = c("12")[:2]
    long_.sort(key=lambda s: np.linalg.norm(s[0] - conn))
    G, B = long_[0][0], long_[1][0]
    # Piston axes: centre of each piston, direction +Y (towards the working space).
    hot_axis_x = c("28")[0]
    cold_axis_x = c("10")[0]
    # Remaining four short shafts: yoke ends (near B) and piston pins (far from B).
    short.sort(key=lambda s: np.linalg.norm(s[0] - B))
    yoke_ends, piston_pins = [s[0] for s in short[:2]], [s[0] for s in short[2:]]

    def nearest_to_x(points, x):
        return min(points, key=lambda p: abs(p[0] - x))

    E_hot, E_cold = nearest_to_x(yoke_ends, hot_axis_x), nearest_to_x(yoke_ends, cold_axis_x)
    P_hot, P_cold = nearest_to_x(piston_pins, hot_axis_x), nearest_to_x(piston_pins, cold_axis_x)

    r = lambda a: [round(float(v), 4) for v in a]
    joints = {"O": r(O), "C": r(C), "B": r(B), "G": r(G), "E_hot": r(E_hot), "E_cold": r(E_cold), "P_hot": r(P_hot), "P_cold": r(P_cold)}
    d = lambda a, b: round(float(np.linalg.norm(np.asarray(a) - np.asarray(b))), 4)
    lengths = {
        "crank_radius": d(O, C),
        "yoke_C_B": d(C, B),
        "yoke_B_E_hot": d(B, E_hot),
        "yoke_B_E_cold": d(B, E_cold),
        "guide_rod": d(G, B),
        "rod_hot": d(E_hot, P_hot),
        "rod_cold": d(E_cold, P_cold),
    }
    # "point"/"dir" are in plane coordinates; "z" is the CAD z of the cylinder axis,
    # used by the viewer for the section plane through both axes.
    cylinders = {
        "hot": {"point": r([hot_axis_x, 0.0]), "dir": [0.0, 1.0], "z": round(float(c("28")[2]), 4)},
        "cold": {"point": r([cold_axis_x, 0.0]), "dir": [0.0, 1.0], "z": round(float(c("10")[2]), 4)},
    }
    # Piston diameters, for the thermodynamic defaults.
    diam = lambda no: round(float(min((by_no[no][0].bbox[1] - by_no[no][0].bbox[0])[[0, 2]]) * 1000), 2)
    return {
        "joints": joints,
        "lengths": lengths,
        "cylinders": cylinders,
        "piston_diameter_mm": {"hot": diam("28"), "cold": diam("10")},
    }


def assign_links(insts: list[Instance], mech: dict) -> None:
    from scipy.spatial import cKDTree

    hot_x = mech["cylinders"]["hot"]["point"][0]
    cold_x = mech["cylinders"]["cold"]["point"][0]
    hosts = []
    for i in insts:
        if i.part_no in LINK_OF_PART:
            link = LINK_OF_PART[i.part_no]
            if link is None:  # piston drive rod
                x = i.center[0] * 1000
                link = "rod_hot" if abs(x - hot_x) < abs(x - cold_x) else "rod_cold"
            i.link = link
            hosts.append(i)
    trees = [(h, cKDTree(h.positions)) for h in hosts]
    for i in insts:
        if i.link:
            continue
        p = i.center
        best = min(trees, key=lambda t: t[1].query(p)[0])[0]
        i.host = best.node_name
        i.link = best.link


# --------------------------------------------------------------------------- output

def cad_to_view(insts: list[Instance]) -> np.ndarray:
    """CAD frame (-X up) -> three.js frame (Y up), base on y = 0, centred in x and z."""
    rot = np.array([[0, 1, 0, 0], [-1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], dtype=float)
    pts = np.concatenate([i.positions for i in insts]) @ rot[:3, :3].T
    lo, hi = pts.min(0), pts.max(0)
    t = np.eye(4)
    t[:3, 3] = [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2]
    return t @ rot


def write_glb(path: Path, insts: list[Instance], parts: dict, materials: dict, root_matrix: np.ndarray) -> int:
    mat_names = list(materials)
    gl_materials = []
    for name in mat_names:
        m = materials[name]
        rgb = [int(m["color"][k : k + 2], 16) / 255 for k in (1, 3, 5)]
        lin = [(c / 12.92) if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
        mat = {
            "name": name,
            "pbrMetallicRoughness": {
                "baseColorFactor": [*lin, m.get("opacity", 1.0)],
                "metallicFactor": m["metalness"],
                "roughnessFactor": m["roughness"],
            },
        }
        if "opacity" in m:
            mat["alphaMode"] = "BLEND"
            mat["doubleSided"] = True
        gl_materials.append(mat)

    buf = bytearray()
    views, accessors, meshes, nodes = [], [], [], []

    def add_view(arr: np.ndarray, target: int) -> int:
        while len(buf) % 4:
            buf.append(0)
        views.append({"buffer": 0, "byteOffset": len(buf), "byteLength": arr.nbytes, "target": target})
        buf.extend(arr.tobytes())
        return len(views) - 1

    tris = 0
    for inst in insts:
        pos, nrm, idx, base = [], [], [], 0
        for b in inst.bodies:
            pos.append(b.positions)
            nrm.append(b.normals)
            idx.append(b.indices + base)
            base += len(b.positions)
        pos = np.concatenate(pos).astype(np.float32)
        nrm = np.concatenate(nrm).astype(np.float32)
        idx = np.concatenate(idx).astype(np.uint32)
        tris += len(idx) // 3
        pv, nv, iv = add_view(pos, 34962), add_view(nrm, 34962), add_view(idx, 34963)
        accessors += [
            {"bufferView": pv, "componentType": 5126, "count": len(pos), "type": "VEC3", "min": pos.min(0).tolist(), "max": pos.max(0).tolist()},
            {"bufferView": nv, "componentType": 5126, "count": len(nrm), "type": "VEC3"},
            {"bufferView": iv, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
        ]
        a = len(accessors) - 3
        part = parts[inst.part_no]
        meshes.append(
            {
                "name": inst.node_name,
                "primitives": [
                    {
                        "attributes": {"POSITION": a, "NORMAL": a + 1},
                        "indices": a + 2,
                        "material": mat_names.index(part["material_class"]),
                    }
                ],
            }
        )
        extras = {"part": part["id"], "link": inst.link}
        if inst.host:
            extras["host"] = inst.host
        nodes.append({"name": inst.node_name, "mesh": len(meshes) - 1, "extras": extras})

    root = {"name": "engine", "matrix": root_matrix.T.reshape(-1).tolist(), "children": list(range(1, len(nodes) + 1))}
    gltf = {
        "asset": {"version": "2.0", "generator": "stirling-engine tools/convert/convert.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [root, *nodes],
        "meshes": meshes,
        "materials": gl_materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(buf)}],
    }
    js = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)
    while len(buf) % 4:
        buf.append(0)
    total = 12 + 8 + len(js) + 8 + len(buf)
    with path.open("wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(buf), 0x004E4942) + bytes(buf))
    return tris


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--step", default=str(ROOT / "cad" / "step" / "00_assembly.STEP"))
    ap.add_argument("--no-pack", action="store_true", help="skip gltfpack compression")
    args = ap.parse_args()

    import cascadio

    parts_doc = json.loads((PUBLIC / "parts.json").read_text(encoding="utf-8"))
    parts_by_no = {p["no"]: p for p in parts_doc["parts"]}

    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.glb"
        print(f"tessellating {args.step} ...")
        cascadio.step_to_glb(args.step, str(raw), tol_linear=TOL_LINEAR, tol_angular=TOL_ANGULAR)
        bodies = load_bodies(raw)

        insts = group_instances(bodies, parts_by_no)
        mech = measure_mechanism(insts)
        assign_links(insts, mech)

        out = PUBLIC / "engine.glb"
        unpacked = Path(tmp) / "engine.glb"
        tris = write_glb(unpacked, insts, parts_by_no, parts_doc["materials"], cad_to_view(insts))
        gltfpack = shutil.which("gltfpack")
        if gltfpack and not args.no_pack:
            # -kn keep named nodes, -km keep materials, -ke keep extras, -vpf float positions
            # (the viewer applies poses in the CAD frame, so no quantisation transforms).
            subprocess.run([gltfpack, "-i", str(unpacked), "-o", str(out), "-c", "-kn", "-km", "-ke", "-vpf", "-noq"], check=True)
        else:
            if not args.no_pack:
                print("gltfpack not found: writing an uncompressed GLB", file=sys.stderr)
            shutil.copy(unpacked, out)

    mpath = PUBLIC / "mechanism.json"
    old = json.loads(mpath.read_text(encoding="utf-8")) if mpath.exists() else {}
    mechanism = {
        "units": "mm",
        "source": "Measured by tools/convert/convert.py from the pin-shaft axes in cad/step/00_assembly.STEP. "
        "Plane coordinates are CAD (x, y); the pins are parallel to CAD z.",
        "plane": {"origin": [0.0, 0.0, 0.0], "u": [1.0, 0.0, 0.0], "v": [0.0, 1.0, 0.0]},
        **mech,
        "rotation": old.get("rotation", 1),
        "measured": old.get("measured", {}),
        "links": {i.node_name: i.link for i in insts},
        "design": old.get("design", {}),
        "thermo": old.get("thermo", {}),
    }
    mpath.write_text(json.dumps(mechanism, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"{len(insts)} part instances, {tris} triangles")
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1e6:.2f} MB)")
    print(f"wrote {mpath.relative_to(ROOT)}")
    print("joints (mm):", json.dumps(mech["joints"]))
    print("lengths (mm):", json.dumps(mech["lengths"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
