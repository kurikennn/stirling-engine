# Stirling Engine: designed, machined and tested from raw stock

An alpha-type Stirling engine with a Ross yoke drive. I designed it in SolidWorks, produced the manufacturing drawings, machined every metal part myself and measured its output on a test rig.

<!-- TODO: add a photo of the finished engine: images/engine.jpg -->
![Finished engine](images/engine.jpg)

**[Live 3D demo](https://kurikennn.github.io/stirling-engine/)**: rotate the engine, watch it run, cut it open, and click any part to see its name and drawing.

<!-- TODO: add a 10 s GIF recorded from the demo (≤ 5 MB): images/demo.gif -->

Course project, University of Tokyo, April to July 2026.
<!-- TODO: add the course name if you want it here. -->

## Result

| Quantity | Value |
|---|---|
| Mechanical output | **128.3 mW** |
| Speed at that point | **340 rpm** |
| Measurement | Flywheel coupled by a pulley to a measurement device |

<!-- TODO: add hot-side temperature, cold-side condition and working fluid/pressure for this operating point. Without them the number cannot be compared with anything. -->

Test setup and calculation: [docs/test_procedure.md](docs/test_procedure.md).

## Design

<!-- TODO: fill in the values you have; delete rows you do not have. -->

| Item | Value |
|---|---|
| Configuration | Alpha, Ross yoke |
| Bore x stroke (both cylinders) | TODO |
| Swept volume | TODO |
| Phase angle | TODO |
| Flywheel | TODO (material, diameter, mass) |
| Main materials | TODO |
| Working fluid | TODO |
| Heat source | TODO |

Design rationale and calculations: [docs/design_notes.md](docs/design_notes.md).

## Manufacturing

All metal parts were made from raw stock on a lathe, a milling machine, a drill press and a contour band saw. The engine was then assembled, fitted and run.
3D-printed parts, if any: TODO.

Process notes and lessons learned: [docs/manufacturing.md](docs/manufacturing.md).

## Interactive demo

The demo in [`web/`](web) uses the real CAD geometry (converted from [`cad/step/00_assembly.STEP`](cad/step)). It is published to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml).

**What is modelled**

- **Kinematics.** A planar solver ([`web/src/kinematics/`](web/src/kinematics)) moves the mechanism. It takes its joint positions from the pin axes in the STEP assembly: crank radius 7 mm, yoke 50/40/40 mm, guide rod 60 mm, piston rods 60 mm. The solver closes the vector loop by circle–circle intersection and by a slider constraint for each piston. For each piston it picks the branch closest to the previous solution. Tests check the closure residual (< 1e-6 mm over 3600 steps), periodicity, continuity and agreement with the CAD pose. The solved strokes are 18.90 mm (hot) and 17.05 mm (cold), and the cold piston lags the hot one by 77.6° (first harmonic).
- **Thermodynamics.** An ideal isothermal (Schmidt) cycle ([`web/src/thermo/`](web/src/thermo)), with the volumes taken from the solved piston motion. The model is tested against the closed-form Schmidt solution. The demo draws the P–V loop and compares the Schmidt indicated power with the measured 128.3 mW.

**What is not modelled**

- Heat transfer, the missing regenerator, leakage, friction and pressure drop. These are why the measured output is well below the Schmidt value.
- Several thermodynamic inputs: dead volumes, hot gas temperature and charge condition. They are placeholders and are marked `ASSUMED` in the UI until they are replaced in [`web/public/mechanism.json`](web/public/mechanism.json).
- Clearances and elastic deformation. Every joint is an ideal pin.

Run it locally:

```sh
cd web
npm ci
npm run dev      # http://localhost:5173/stirling-engine/
npm test         # kinematics and thermodynamics tests
```

The geometry pipeline (SolidWorks → STEP → GLB) is described in [`tools/convert/EXPORT.md`](tools/convert/EXPORT.md).

## Repository layout

```
stirling-engine/
├── README.md
├── drawings/
│   └── pdf/                 Dimensioned, toleranced manufacturing drawings (one PDF per part, plus assembly)
├── cad/
│   ├── solidworks/          Native SolidWorks parts, assembly and drawings
│   └── step/                Neutral STEP export of the assembly and each part
├── docs/
│   ├── BOM.md               Bill of materials
│   ├── design_notes.md      Design rationale and main dimensions
│   ├── manufacturing.md     Machining notes
│   └── test_procedure.md    Test setup, procedure, calculation and uncertainty
├── test/
│   ├── data/                Raw measurements (CSV)
│   └── plots/               Figures generated from the data
├── images/                  Photos used in this README
├── tools/convert/           STEP -> GLB converter, BOM -> parts.json, GLB consistency check
├── web/                     Interactive 3D demo (Vite + TypeScript + three.js)
│   ├── public/              engine.glb, mechanism.json, parts.json
│   ├── src/                 kinematics/, thermo/, scene/, ui/
│   └── test/                vitest tests for the solver and the Schmidt model
├── .github/workflows/       ci.yml (tests + GLB check), pages.yml (deploy the demo)
├── .gitattributes
└── .gitignore
```

## Drawings and CAD

- **Drawings:** [`drawings/pdf/`](drawings/pdf). File names follow the part numbers in [docs/BOM.md](docs/BOM.md), for example `01_cylinder_hot.pdf`. `00_assembly.pdf` is the assembly drawing.
- **CAD:** native SolidWorks files are in [`cad/solidworks/`](cad/solidworks) (open `Assembly.SLDASM`). For other CAD systems use the STEP files in [`cad/step/`](cad/step).
- Software: SolidWorks (version TODO).

## Known limitations

<!-- TODO: be honest and specific. Reviewers respect this. Examples: leakage past the pistons, friction in the yoke, no regenerator, output measured at only one operating point. -->

- TODO
- TODO

## Licence

<!-- TODO: choose one and add a LICENSE file. Suggestion: CC BY 4.0 for the drawings and documents. -->
Drawings, CAD files and documents: TODO (for example CC BY 4.0).

## Acknowledgements

<!-- TODO: instructor / teaching staff / workshop technicians, if you want to name them. -->

## Author

Kengo Kuriaki, University of Tokyo. [GitHub](https://github.com/kurikennn)
