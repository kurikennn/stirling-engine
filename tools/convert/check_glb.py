#!/usr/bin/env python3
"""Consistency check for the web model files. Standard library only (runs in CI).

Fails if
  - a part id in parts.json is missing from engine.glb, or vice versa;
  - a part has a different number of instances in the GLB than its BOM quantity;
  - a GLB node has no link in mechanism.json, or an unknown link;
  - the GLB is larger than 5 MB or has more than 300 k triangles.

Usage: python tools/convert/check_glb.py
"""
from __future__ import annotations

import json
import re
import struct
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "web" / "public"
MAX_BYTES = 5 * 1024 * 1024
MAX_TRIANGLES = 300_000
LINKS = {"ground", "crank", "yoke", "guide_rod", "rod_hot", "rod_cold", "piston_hot", "piston_cold"}


def glb_json(path: Path) -> dict:
    data = path.read_bytes()
    magic, version, _ = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2:
        raise SystemExit(f"{path}: not a glTF 2.0 binary")
    length, ctype = struct.unpack_from("<II", data, 12)
    if ctype != 0x4E4F534A:
        raise SystemExit(f"{path}: first chunk is not JSON")
    return json.loads(data[20 : 20 + length])


def main() -> int:
    errors: list[str] = []
    glb = PUBLIC / "engine.glb"
    parts = json.loads((PUBLIC / "parts.json").read_text(encoding="utf-8"))["parts"]
    mechanism = json.loads((PUBLIC / "mechanism.json").read_text(encoding="utf-8"))
    js = glb_json(glb)

    size = glb.stat().st_size
    if size > MAX_BYTES:
        errors.append(f"engine.glb is {size / 1e6:.2f} MB (limit {MAX_BYTES / 1e6:.2f} MB)")

    triangles = 0
    for mesh in js["meshes"]:
        for prim in mesh["primitives"]:
            triangles += js["accessors"][prim["indices"]]["count"] // 3
    if triangles > MAX_TRIANGLES:
        errors.append(f"engine.glb has {triangles} triangles (limit {MAX_TRIANGLES})")

    nodes = [n for n in js["nodes"] if "mesh" in n]
    node_part = {}
    for n in nodes:
        part = n.get("extras", {}).get("part") or re.sub(r"__\d+$", "", n["name"])
        node_part[n["name"]] = part
    glb_counts = Counter(node_part.values())
    bom = {p["id"]: p["qty"] for p in parts}

    for pid in sorted(set(bom) - set(glb_counts)):
        errors.append(f"part {pid} is in parts.json but not in engine.glb")
    for pid in sorted(set(glb_counts) - set(bom)):
        errors.append(f"part {pid} is in engine.glb but not in parts.json")
    for pid in sorted(set(bom) & set(glb_counts)):
        if bom[pid] != glb_counts[pid]:
            errors.append(f"part {pid}: BOM quantity {bom[pid]}, engine.glb has {glb_counts[pid]}")

    links = mechanism.get("links", {})
    for name in sorted(node_part):
        if name not in links:
            errors.append(f"node {name} has no link in mechanism.json")
        elif links[name] not in LINKS:
            errors.append(f"node {name} has unknown link '{links[name]}'")
    for name in sorted(set(links) - set(node_part)):
        errors.append(f"mechanism.json links node {name}, which is not in engine.glb")

    print(f"engine.glb: {size / 1e6:.2f} MB, {triangles} triangles, {len(nodes)} part instances, {len(glb_counts)} parts")
    if errors:
        for e in errors:
            print("ERROR:", e, file=sys.stderr)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
