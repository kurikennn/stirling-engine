import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pistonMotion, sweep, type MechanismSpec } from "../src/kinematics/linkage";
import { schmidtCycle, schmidtFromVolumes, schmidtSinusoidalWork } from "../src/thermo/schmidt";
import { thermoParamsFrom } from "../src/thermo/params";

const N = 3600;
const R = 287;

function sinusoidalCase(alphaDeg: number, Th: number, Tk: number) {
  const o = { Vse: 4e-6, Vsc: 4.5e-6, Vde: 1.5e-6, Vdc: 1.0e-6, Vr: 2e-6, alpha: (alphaDeg * Math.PI) / 180, Th, Tk, R };
  const Ve: number[] = [];
  const Vc: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = (2 * Math.PI * i) / N;
    Ve.push(o.Vde + (o.Vse / 2) * (1 - Math.cos(t)));
    Vc.push(o.Vdc + (o.Vsc / 2) * (1 - Math.cos(t - o.alpha)));
  }
  const num = schmidtFromVolumes(Ve, Vc, o.Vr, Th, Tk, 101325, R);
  const exact = schmidtSinusoidalWork({ ...o, mass: num.mass });
  return { num, exact };
}

describe("Schmidt model", () => {
  it("matches the closed-form Schmidt work for sinusoidal volumes within 0.1 %", () => {
    for (const alpha of [60, 90, 120]) {
      const { num, exact } = sinusoidalCase(alpha, 623.15, 293.15);
      expect(Math.abs(num.W - exact) / Math.abs(exact), `α = ${alpha}°`).toBeLessThan(1e-3);
    }
  });

  it("gives zero work when T_h = T_k", () => {
    const { num } = sinusoidalCase(90, 293.15, 293.15);
    // Scale: p_charge · swept volume ≈ 0.4 J; the trapezoidal error is far below that.
    expect(Math.abs(num.W)).toBeLessThan(1e-6);
  });

  it("traverses the loop clockwise (W > 0) for engine operation", () => {
    const { num } = sinusoidalCase(90, 623.15, 293.15);
    expect(num.W).toBeGreaterThan(0);
    // Signed area of the (V, p) polygon: negative = clockwise.
    let area = 0;
    for (let i = 0; i < N; i++) {
      const k = (i + 1) % N;
      area += num.V[i] * num.p[k] - num.V[k] * num.p[i];
    }
    expect(area).toBeLessThan(0);
  });

  it("runs the engine forwards with the solved kinematics and the configured rotation", () => {
    const mech = JSON.parse(readFileSync(new URL("../public/mechanism.json", import.meta.url), "utf-8"));
    const motion = pistonMotion(sweep(mech as MechanismSpec, N));
    const cycle = schmidtCycle(motion.xHot, motion.xCold, thermoParamsFrom(mech.thermo).params);
    console.info(
      `Schmidt W_i = ${(cycle.W * 1e3).toFixed(2)} mJ/cycle, swept hot ${(cycle.sweptHot * 1e6).toFixed(3)} cm³, cold ${(cycle.sweptCold * 1e6).toFixed(3)} cm³`,
    );
    expect(cycle.W).toBeGreaterThan(0);
  });
});
