#!/usr/bin/env python3
"""Generate web/public/parts.json from docs/BOM.md.

docs/BOM.md is the single source of truth for names, materials, quantities and
drawings. This script only adds presentation data that does not belong in a
BOM: the render material class, the thermal side and the exploded-view offset.

Usage: python tools/convert/bom_to_parts.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BOM = ROOT / "docs" / "BOM.md"
OUT = ROOT / "web" / "public" / "parts.json"

# BOM material -> render material class.
MATERIAL_CLASS = {
    "a2017p": "aluminium",
    "a2017": "aluminium",
    "brass": "brass",
    "sus304": "steel",
    "sus304-b": "steel",
    "ss400": "steel",
    "steel": "steel",
    "silicone rubber": "rubber",
    "glass": "glass",
    "acrylic": "acrylic",
}

# PBR values per material class (glTF metallic-roughness).
MATERIALS = {
    "aluminium": {"color": "#c8ccd2", "metalness": 1.0, "roughness": 0.38},
    "brass": {"color": "#d6a84e", "metalness": 1.0, "roughness": 0.32},
    "steel": {"color": "#9ba1a8", "metalness": 1.0, "roughness": 0.28},
    "rubber": {"color": "#b8362c", "metalness": 0.0, "roughness": 0.85},
    "glass": {"color": "#d8ecff", "metalness": 0.0, "roughness": 0.05, "opacity": 0.28},
    "acrylic": {"color": "#e8f4ff", "metalness": 0.0, "roughness": 0.1, "opacity": 0.35},
}

HOT = {"05", "06", "07", "08", "22", "27", "28"}
COLD = {"09", "10", "23", "24", "25", "26"}

# Exploded-view offset at explode = 1, in mm, in the CAD assembly frame
# (SolidWorks frame: -X is up, the mechanism is on -Y, the flywheel on -Z).
# Purchased hardware (29-45) and small pin parts (16, 17, 19, 21) have no own
# offset: the viewer moves each of them with the part it sits in (its "host").
EXPLODE = {
    "01": [40, 0, 0],
    "02": [0, 0, 0],
    "03": [0, 0, -95],
    "04": [0, -10, -50],
    "05": [0, 45, 0],
    "06": [-60, 0, 0],
    "07": [0, 90, 0],
    "08": [0, -20, 0],
    "09": [0, 0, 45],
    "10": [0, -20, 30],
    "11": [20, 0, -20],
    "12": [25, -30, 0],
    "13": [0, -60, 15],
    "14": [0, -80, -10],
    "15": [0, -35, 25],
    "18": [0, 0, -70],
    "20": [0, 0, -30],
    "22": [0, 15, 0],
    "23": [0, 0, 30],
    "24": [0, 0, 35],
    "25": [0, 0, -35],
    "26": [0, -25, 0],
    "27": [-35, 0, 0],
    "28": [0, -20, 0],
}

REPO_BLOB = "https://github.com/kurikennn/stirling-engine/blob/main/drawings/pdf/"


def parse_bom(text: str) -> list[dict]:
    rows = []
    for line in text.splitlines():
        if not re.match(r"^\|\s*\d{2}\s*\|", line):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        no, pid, name, name_ja, material, qty, process, mass, drawing, ops = cells
        rows.append(
            {
                "no": no,
                "id": pid,
                "name": name,
                "name_ja": name_ja,
                "material": material,
                "qty": int(qty),
                "process": process,
                "mass_kg": None if mass in ("—", "") else float(mass),
                "drawing": None if drawing in ("—", "") else drawing,
                "operations": None if ops in ("—", "", "TODO") else ops,
                "operations_todo": ops == "TODO",
            }
        )
    return rows


def main() -> int:
    rows = parse_bom(BOM.read_text(encoding="utf-8"))
    if not rows:
        print(f"no BOM rows found in {BOM}", file=sys.stderr)
        return 1
    parts = []
    for r in rows:
        mclass = MATERIAL_CLASS.get(r["material"].lower())
        if mclass is None:
            print(f"unknown material '{r['material']}' for {r['id']}", file=sys.stderr)
            return 1
        parts.append(
            {
                **r,
                "material_class": mclass,
                "drawing_url": REPO_BLOB + r["drawing"] if r["drawing"] else None,
                "thermal": "hot" if r["no"] in HOT else "cold" if r["no"] in COLD else None,
                "explode_mm": EXPLODE.get(r["no"]),
            }
        )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"materials": MATERIALS, "parts": parts}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT.relative_to(ROOT)} ({len(parts)} parts)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
