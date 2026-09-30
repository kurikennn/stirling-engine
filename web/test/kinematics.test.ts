import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Linkage, pistonMotion, sweep, type MechanismSpec, type Vec2 } from "../src/kinematics/linkage";

const mech = JSON.parse(readFileSync(new URL("../public/mechanism.json", import.meta.url), "utf-8"));
const spec: MechanismSpec = mech;
const N = 3600;
const sw = sweep(spec, N);
const motion = pistonMotion(sw);

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("kinematic solver", () => {
  it("reproduces the CAD joint positions at θ₀ within 0.01 mm", () => {
    const sol = new Linkage(spec).solve(0);
    expect(sol.ok).toBe(true);
    for (const [name, p] of Object.entries(spec.joints)) {
      expect(dist(sol.joints[name as keyof typeof spec.joints], p), name).toBeLessThan(0.01);
    }
  });

  it("closes every constraint within 1e-6 mm over 3600 steps of a revolution", () => {
    expect(sw.ok, sw.reason).toBe(true);
    expect(sw.phi.length).toBe(N);
    expect(sw.maxResidual).toBeLessThan(1e-6);
  });

  it("gives periodic piston displacements (back to the start after 2π)", () => {
    const lk = new Linkage(spec);
    const start = lk.solve(0);
    for (let i = 1; i <= N; i++) lk.solve((2 * Math.PI * i) / N);
    const end = lk.solve(2 * Math.PI);
    expect(Math.abs(end.s.hot - start.s.hot)).toBeLessThan(1e-9);
    expect(Math.abs(end.s.cold - start.s.cold)).toBeLessThan(1e-9);
    expect(dist(end.joints.B, start.joints.B)).toBeLessThan(1e-9);
  });

  it("gives continuous piston displacements (no branch flips)", () => {
    // With 0.1° steps and a crank radius of a few mm, a smooth solution moves far less
    // than 0.1 mm per step; a jump to the other branch would move tens of mm.
    const step = (2 * Math.PI * motion.stroke.hot) / N;
    for (const s of [sw.sHot, sw.sCold]) {
      for (let i = 0; i < N; i++) {
        const d = Math.abs(s[(i + 1) % N] - s[i]);
        expect(d).toBeLessThan(2 * step);
      }
    }
  });

  it("reports stroke and phase lag", () => {
    console.info(
      `stroke hot ${motion.stroke.hot.toFixed(4)} mm, cold ${motion.stroke.cold.toFixed(4)} mm; ` +
        `cold piston lags hot by ${motion.phaseLagDeg.toFixed(3)}° (first harmonic)`,
    );
    expect(motion.stroke.hot).toBeGreaterThan(0);
    expect(motion.stroke.cold).toBeGreaterThan(0);
  });

  const design = mech.design ?? {};
  it.skipIf(design.stroke_hot_mm == null || design.stroke_cold_mm == null)(
    "stroke of each piston equals the design stroke within 0.05 mm",
    () => {
      expect(Math.abs(motion.stroke.hot - design.stroke_hot_mm)).toBeLessThan(0.05);
      expect(Math.abs(motion.stroke.cold - design.stroke_cold_mm)).toBeLessThan(0.05);
    },
  );

  it.skipIf(design.phase_lag_deg == null)("phase lag matches the design value within 1°", () => {
    expect(Math.abs(motion.phaseLagDeg - design.phase_lag_deg)).toBeLessThan(1);
  });

  // Optional cross-check against piston positions recorded in SolidWorks at
  // θ₀ + 0°, 90°, 180°, 270°: design.crosscheck = [{ "phi_deg": 90, "s_hot_mm": …, "s_cold_mm": … }, …]
  const cross: { phi_deg: number; s_hot_mm: number; s_cold_mm: number }[] = design.crosscheck ?? [];
  it.skipIf(cross.length === 0)("matches piston positions recorded in SolidWorks within 0.05 mm", () => {
    const lk = new Linkage(spec);
    let phi = 0;
    for (const c of [...cross].sort((a, b) => a.phi_deg - b.phi_deg)) {
      const target = (c.phi_deg * Math.PI) / 180;
      while (phi < target) {
        phi = Math.min(phi + 0.01, target);
        lk.solve(phi);
      }
      const sol = lk.solve(target);
      expect(Math.abs(sol.s.hot - c.s_hot_mm)).toBeLessThan(0.05);
      expect(Math.abs(sol.s.cold - c.s_cold_mm)).toBeLessThan(0.05);
    }
  });

  it("flags a linkage that cannot close", () => {
    // A 40 mm crank: half a turn later the crank pin is further from G than yoke + guide rod can reach.
    const broken: MechanismSpec = structuredClone(spec);
    broken.joints.O = [spec.joints.C[0] - 40, spec.joints.C[1]];
    const res = sweep(broken, 360);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/dead point/);
  });
});
