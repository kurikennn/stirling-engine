// Planar kinematics of the Ross-yoke drive. Pure TypeScript: no three.js here.
//
// Topology (joint letters as in mechanism.json, all revolute pins normal to the plane):
//
//   ground ──O── crank ──C── yoke (T-crank) ──B── guide rod ──G── ground
//                              │ E_hot                  │ E_cold
//                           rod_hot                  rod_cold
//                              │ P_hot                  │ P_cold
//                         piston_hot (slides)     piston_cold (slides)
//
// Given the crank rotation φ from the CAD pose, the loop is closed in three steps:
//   1. C(φ) = O + R(σφ)(C₀ − O)                     σ = ±1: running direction
//   2. B = the intersection of circle(C, |B₀C₀|) and circle(G, |B₀G|) nearest to
//      the previous B; this fixes the yoke, which then carries E_hot and E_cold.
//   3. Each piston pin P = P₀ + s·d lies on its cylinder axis with |P − E| = rod length;
//      s is the root of a quadratic, again the one nearest to the previous s.
// Choosing the branch nearest the previous solution, seeded from the CAD pose,
// keeps the motion continuous (the linkage never jumps to its mirror assembly).

export type Vec2 = [number, number];

export const LINKS = ["ground", "crank", "yoke", "guide_rod", "rod_hot", "rod_cold", "piston_hot", "piston_cold"] as const;
export type LinkName = (typeof LINKS)[number];

export interface MechanismSpec {
  joints: Record<"O" | "C" | "B" | "G" | "E_hot" | "E_cold" | "P_hot" | "P_cold", Vec2>;
  cylinders: Record<"hot" | "cold", { point: Vec2; dir: Vec2 }>;
  /** +1: the crank turns counter-clockwise in plane coordinates (u → v), −1: clockwise. */
  rotation: 1 | -1;
}

/** A planar rigid motion relative to the CAD pose: p ↦ R(angle)·p + (tx, ty). */
export interface Pose2 {
  angle: number;
  tx: number;
  ty: number;
}

export interface Solution {
  ok: boolean;
  /** Why the loop could not be closed, when ok is false. */
  reason?: string;
  poses: Record<LinkName, Pose2>;
  joints: Record<"O" | "C" | "B" | "G" | "E_hot" | "E_cold" | "P_hot" | "P_cold", Vec2>;
  /** Piston pin travel along its cylinder axis from the CAD pose, mm (+ = towards the working space). */
  s: { hot: number; cold: number };
  /** Constraint closure residuals, mm. */
  residuals: Record<string, number>;
  maxResidual: number;
}

export const RESIDUAL_LIMIT_MM = 1e-6;

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const norm = (a: Vec2) => Math.hypot(a[0], a[1]);
const dist = (a: Vec2, b: Vec2) => norm(sub(a, b));
const angleOf = (a: Vec2) => Math.atan2(a[1], a[0]);
const rotate = (a: Vec2, t: number): Vec2 => {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c * a[0] - s * a[1], s * a[0] + c * a[1]];
};

/** Pose of a body rotated by `angle` whose point `from` (CAD pose) has moved to `to`. */
function poseFrom(angle: number, from: Vec2, to: Vec2): Pose2 {
  const r = rotate(from, angle);
  return { angle, tx: to[0] - r[0], ty: to[1] - r[1] };
}

export function applyPose(p: Pose2, v: Vec2): Vec2 {
  const r = rotate(v, p.angle);
  return [r[0] + p.tx, r[1] + p.ty];
}

/** Both intersections of circle(c1, r1) and circle(c2, r2), or null if they do not meet. */
export function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): [Vec2, Vec2] | null {
  const d = dist(c1, c2);
  if (d < 1e-12 || d > r1 + r2 || d < Math.abs(r1 - r2)) return null;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = Math.sqrt(Math.max(h2, 0));
  const ex = scale(sub(c2, c1), 1 / d);
  const m = add(c1, scale(ex, a));
  const perp: Vec2 = [-ex[1], ex[0]];
  return [add(m, scale(perp, h)), add(m, scale(perp, -h))];
}

export class Linkage {
  readonly spec: MechanismSpec;
  readonly crankRadius: number;
  readonly lenCB: number;
  readonly lenGuide: number;
  readonly lenRod: { hot: number; cold: number };
  readonly axis: { hot: Vec2; cold: Vec2 };
  private prevB: Vec2;
  private prevS: { hot: number; cold: number };

  constructor(spec: MechanismSpec) {
    this.spec = spec;
    const j = spec.joints;
    this.crankRadius = dist(j.O, j.C);
    this.lenCB = dist(j.C, j.B);
    this.lenGuide = dist(j.G, j.B);
    this.lenRod = { hot: dist(j.E_hot, j.P_hot), cold: dist(j.E_cold, j.P_cold) };
    const unit = (v: Vec2) => scale(v, 1 / norm(v));
    this.axis = { hot: unit(spec.cylinders.hot.dir), cold: unit(spec.cylinders.cold.dir) };
    this.prevB = [...j.B];
    this.prevS = { hot: 0, cold: 0 };
  }

  /** Forget the continuation state and restart from the CAD pose. */
  reset(): void {
    this.prevB = [...this.spec.joints.B];
    this.prevS = { hot: 0, cold: 0 };
  }

  /**
   * Solve the linkage for crank rotation `phi` (rad, from the CAD pose, positive in
   * the running direction). The continuation state is updated only on success.
   * For continuity, successive calls should differ by a small angle (≲ 10°).
   */
  solve(phi: number): Solution {
    const j = this.spec.joints;
    const crankAngle = this.spec.rotation * phi;
    const C = add(j.O, rotate(sub(j.C, j.O), crankAngle));

    const fail = (reason: string): Solution => ({
      ok: false,
      reason,
      poses: Object.fromEntries(LINKS.map((l) => [l, { angle: 0, tx: 0, ty: 0 }])) as Record<LinkName, Pose2>,
      joints: { ...j, C },
      s: { ...this.prevS },
      residuals: {},
      maxResidual: Infinity,
    });

    const cands = circleCircle(C, this.lenCB, j.G, this.lenGuide);
    if (!cands) return fail("yoke and guide rod cannot close (dead point)");
    const B = dist(cands[0], this.prevB) <= dist(cands[1], this.prevB) ? cands[0] : cands[1];

    const yokeAngle = angleOf(sub(B, C)) - angleOf(sub(j.B, j.C));
    const yoke = poseFrom(yokeAngle, j.C, C);
    const E = { hot: applyPose(yoke, j.E_hot), cold: applyPose(yoke, j.E_cold) };

    const s = { hot: 0, cold: 0 };
    const P = { hot: [0, 0] as Vec2, cold: [0, 0] as Vec2 };
    for (const side of ["hot", "cold"] as const) {
      const P0 = side === "hot" ? j.P_hot : j.P_cold;
      const d = this.axis[side];
      // |P0 + s d − E|² = L²  →  s² + 2 s (w·d) + |w|² − L² = 0,  w = P0 − E
      const w = sub(P0, E[side]);
      const b = dot(w, d);
      const disc = b * b - dot(w, w) + this.lenRod[side] ** 2;
      if (disc < 0) return fail(`${side} piston rod cannot reach the cylinder axis (dead point)`);
      const root = Math.sqrt(disc);
      const s1 = -b + root;
      const s2 = -b - root;
      s[side] = Math.abs(s1 - this.prevS[side]) <= Math.abs(s2 - this.prevS[side]) ? s1 : s2;
      P[side] = add(P0, scale(d, s[side]));
    }

    const crank = poseFrom(crankAngle, j.O, j.O);
    const guideAngle = angleOf(sub(B, j.G)) - angleOf(sub(j.B, j.G));
    const guide = poseFrom(guideAngle, j.G, j.G);
    const rod = (side: "hot" | "cold") => {
      const E0 = side === "hot" ? j.E_hot : j.E_cold;
      const P0 = side === "hot" ? j.P_hot : j.P_cold;
      return poseFrom(angleOf(sub(P[side], E[side])) - angleOf(sub(P0, E0)), E0, E[side]);
    };
    const piston = (side: "hot" | "cold"): Pose2 => {
      const t = scale(this.axis[side], s[side]);
      return { angle: 0, tx: t[0], ty: t[1] };
    };

    const poses: Record<LinkName, Pose2> = {
      ground: { angle: 0, tx: 0, ty: 0 },
      crank,
      yoke,
      guide_rod: guide,
      rod_hot: rod("hot"),
      rod_cold: rod("cold"),
      piston_hot: piston("hot"),
      piston_cold: piston("cold"),
    };

    // Closure residuals: every joint evaluated from both bodies it connects.
    const residuals: Record<string, number> = {
      "O crank": dist(applyPose(crank, j.O), j.O),
      "C crank|yoke": dist(applyPose(crank, j.C), applyPose(yoke, j.C)),
      "B yoke|guide": dist(applyPose(yoke, j.B), applyPose(guide, j.B)),
      "G guide|ground": dist(applyPose(guide, j.G), j.G),
      "E_hot yoke|rod": dist(applyPose(yoke, j.E_hot), applyPose(poses.rod_hot, j.E_hot)),
      "E_cold yoke|rod": dist(applyPose(yoke, j.E_cold), applyPose(poses.rod_cold, j.E_cold)),
      "P_hot rod|piston": dist(applyPose(poses.rod_hot, j.P_hot), applyPose(poses.piston_hot, j.P_hot)),
      "P_cold rod|piston": dist(applyPose(poses.rod_cold, j.P_cold), applyPose(poses.piston_cold, j.P_cold)),
      "C on crank circle": Math.abs(dist(C, j.O) - this.crankRadius),
      "|CB| rigid": Math.abs(dist(C, B) - this.lenCB),
      "|GB| guide length": Math.abs(dist(j.G, B) - this.lenGuide),
      "|EP| hot rod length": Math.abs(dist(E.hot, P.hot) - this.lenRod.hot),
      "|EP| cold rod length": Math.abs(dist(E.cold, P.cold) - this.lenRod.cold),
    };
    const maxResidual = Math.max(...Object.values(residuals));

    const sol: Solution = {
      ok: maxResidual <= RESIDUAL_LIMIT_MM,
      poses,
      joints: { O: j.O, C, B, G: j.G, E_hot: E.hot, E_cold: E.cold, P_hot: P.hot, P_cold: P.cold },
      s,
      residuals,
      maxResidual,
    };
    if (!sol.ok) sol.reason = `closure residual ${maxResidual.toExponential(2)} mm exceeds ${RESIDUAL_LIMIT_MM} mm`;
    else {
      this.prevB = B;
      this.prevS = s;
    }
    return sol;
  }
}

export interface Sweep {
  /** Crank rotation from the CAD pose, rad, n samples over [0, 2π). */
  phi: number[];
  sHot: number[];
  sCold: number[];
  maxResidual: number;
  ok: boolean;
  reason?: string;
}

/** Solve one full revolution in n steps, starting from the CAD pose. */
export function sweep(spec: MechanismSpec, n = 3600): Sweep {
  const lk = new Linkage(spec);
  const out: Sweep = { phi: [], sHot: [], sCold: [], maxResidual: 0, ok: true };
  for (let i = 0; i < n; i++) {
    const phi = (2 * Math.PI * i) / n;
    const sol = lk.solve(phi);
    if (!sol.ok) {
      out.ok = false;
      out.reason = `at φ = ${((phi * 180) / Math.PI).toFixed(1)}°: ${sol.reason}`;
      break;
    }
    out.phi.push(phi);
    out.sHot.push(sol.s.hot);
    out.sCold.push(sol.s.cold);
    out.maxResidual = Math.max(out.maxResidual, sol.maxResidual);
  }
  return out;
}

/** First Fourier harmonic of a periodic sampled signal: amplitude and phase (rad) of a·cos(θ − phase). */
export function firstHarmonic(values: number[]): { amplitude: number; phase: number } {
  const n = values.length;
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    a += values[i] * Math.cos(t);
    b += values[i] * Math.sin(t);
  }
  a *= 2 / n;
  b *= 2 / n;
  return { amplitude: Math.hypot(a, b), phase: Math.atan2(b, a) };
}

export interface PistonMotion {
  /** Stroke of each piston, mm. */
  stroke: { hot: number; cold: number };
  /** Crank rotation (from the CAD pose) at hot-piston top dead centre, rad. */
  phiTdcHot: number;
  /** By how much the cold piston lags the hot piston, from the first harmonics, degrees in (−180, 180]. */
  phaseLagDeg: number;
  /** Distance from TDC (towards larger volume), mm, per sample of the sweep. */
  xHot: number[];
  xCold: number[];
}

/**
 * Stroke, TDC and phase lag from a sweep. TDC is the pin position furthest into
 * the working space (largest s), because each cylinder direction points that way.
 */
export function pistonMotion(sw: Sweep): PistonMotion {
  const maxH = Math.max(...sw.sHot);
  const minH = Math.min(...sw.sHot);
  const maxC = Math.max(...sw.sCold);
  const minC = Math.min(...sw.sCold);
  const iTdc = sw.sHot.indexOf(maxH);
  const h = firstHarmonic(sw.sHot);
  const c = firstHarmonic(sw.sCold);
  let lag = ((c.phase - h.phase) * 180) / Math.PI;
  lag = ((((lag + 180) % 360) + 360) % 360) - 180;
  if (lag === -180) lag = 180;
  return {
    stroke: { hot: maxH - minH, cold: maxC - minC },
    phiTdcHot: sw.phi[iTdc],
    phaseLagDeg: lag,
    xHot: sw.sHot.map((v) => maxH - v),
    xCold: sw.sCold.map((v) => maxC - v),
  };
}
