# Exporting the model from SolidWorks and converting it for the web demo

## 1. Export from SolidWorks (manual)

The demo uses `cad/step/00_assembly.STEP`: the whole assembly exported as one STEP AP214 file with the component names kept.

1. Open `cad/solidworks/00_assembly.SLDASM`.
2. Put the mechanism in the pose you want as the reference pose, θ₀. Any crank angle works, because the converter measures the joints in whatever pose the file has.
3. **File → Save As**, type *STEP AP214 (\*.step; \*.stp)*.
4. In **Options…**, export solid geometry and keep the assembly structure: do not export as a single part. The component names are how the converter recognises the parts.
5. Save as `cad/step/00_assembly.STEP`.

<!-- TODO: add screenshots of the Save As dialog and the STEP options: images/export_step_1.png, images/export_step_2.png -->

Conventions the converter relies on:

- **Units:** millimetres.
- **Up axis:** in this assembly, SolidWorks **−X points up**: the base is at the largest X. The pins are parallel to **Z**, so the mechanism moves in the XY plane. The converter turns −X up into three.js +Y up.
- **Component names** start with the two-digit BOM number (`13_T字クランク`, …). Bearings are the `MF84ZZ` / `MF106ZZ` toolbox sub-assemblies. Screws are JIS toolbox parts whose names contain the size (`… M3 x 16 …`). Every one of them must map to a row in `docs/BOM.md`.

Fallback (not needed today): one binary STL per component instance, in assembly coordinates, with *Do not translate STL output data to positive space* ticked. `convert.py` would need a small STL reader for that.

## 2. Convert (offline)

```sh
python -m venv .venv && .venv/bin/pip install -r tools/convert/requirements.txt
.venv/bin/python tools/convert/bom_to_parts.py    # docs/BOM.md  -> web/public/parts.json
.venv/bin/python tools/convert/convert.py         # STEP         -> web/public/engine.glb + mechanism.json
python tools/convert/check_glb.py                 # consistency check (also run in CI)
```

`gltfpack` (from [meshoptimizer](https://github.com/zeux/meshoptimizer)) must be on `PATH` for meshopt compression; without it the GLB is written uncompressed. With Nix: `nix shell nixpkgs#meshoptimizer -c .venv/bin/python tools/convert/convert.py`.

What `convert.py` does:

1. Tessellates the STEP with OpenCASCADE (`cascadio`), with a linear tolerance of 0.03 mm.
2. Groups the bodies into part instances and names each node after its BOM id. A part with several instances gets `__1`, `__2`, …, numbered by position. The bearing balls are dropped: they are hidden behind the shields and would add about 180 k triangles.
3. **Measures the mechanism.** Every pin is a shaft (parts 16, 17, 18) parallel to Z, so each joint centre is the centre of a shaft's bounding box. It assigns the roles from the topology:
   - O is the centre shaft (18).
   - C is the short shaft nearest O.
   - G is the long shaft nearest its base connector (12); B is the other long shaft.
   - The yoke ends are the two short shafts nearest B.
   - The piston pins are the remaining two, matched to the hot or cold piston by position.
4. Assigns every node to a link. Machined parts get their link from a fixed table. Hardware (pins, bearings, screws, spacers, shims) follows the nearest machined part, its *host*.
5. Writes `engine.glb`, with the geometry in the CAD frame (metres) under a root node `engine` that holds the CAD → Y-up transform. It also writes `mechanism.json`, keeping its hand-edited `rotation`, `measured`, `design` and `thermo` sections.

Output of the current model: 110 part instances, about 184 k triangles, 2.2 MB, and these lengths: crank radius 7.00 mm, yoke C–B 50.00 mm, yoke B–E 40.00 mm, guide rod 60.00 mm, piston rods 60.00 mm.

## 3. Values the author still has to enter in `web/public/mechanism.json`

- `design.stroke_hot_mm`, `design.stroke_cold_mm`, `design.phase_lag_deg`, from the drawings. Until then, the matching tests are skipped.
- Optional: `design.crosscheck`, the piston positions read in SolidWorks after turning the flywheel by 90°, 180° and 270°.
- `thermo.inputs.*`: replace each value and change its `status` from `ASSUMED` to `MEASURED` or `DESIGN`. The UI flags every input that is still `ASSUMED`.
- `rotation`: +1 means the crank turns from CAD +X towards +Y. It was chosen so that the hot piston leads, which is the only direction in which the engine produces work. Check it against the real engine.
