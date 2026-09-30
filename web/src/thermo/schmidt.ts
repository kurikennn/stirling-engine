// Schmidt (isothermal) analysis. Pure TypeScript: no three.js here.
//
// Assumptions of the Schmidt model: the gas is ideal, the expansion space stays at
// T_h and the compression space at T_k, the regenerator/passage gas is at the
// log-mean temperature T_r, the pressure is uniform, and the total gas mass is fixed.
//
//   p(θ) = m R / ( V_e/T_h + V_dr/T_r + V_c/T_k ),     T_r = (T_h − T_k) / ln(T_h/T_k)
//
// The volumes are taken from the solved kinematics, not from sinusoids:
//   V_e = V_de + A_hot · x_hot(θ),   V_c = V_dc + A_cold · x_cold(θ)
// x is each piston's distance from its top dead centre, towards larger volume.

export interface ThermoParams {
  /** Hot and cold bores, mm. */
  boreHot: number;
  boreCold: number;
  /** Dead volumes of the expansion space, compression space and connecting passage, cm³. */
  deadHot: number;
  deadCold: number;
  deadPassage: number;
  /** Gas temperatures, K. */
  Th: number;
  Tk: number;
  /** Pressure at the moment the engine was sealed, Pa. */
  pCharge: number;
  /** Specific gas constant, J/(kg·K). */
  R: number;
}

export interface CycleResult {
  /** Volumes, m³, per sample. */
  Ve: number[];
  Vc: number[];
  V: number[];
  /** Pressure, Pa, per sample. */
  p: number[];
  /** Gas mass, kg. */
  mass: number;
  /** Log-mean passage temperature, K. */
  Tr: number;
  /** Indicated work per cycle ∮p dV, J. Positive for engine operation (clockwise p–V loop). */
  W: number;
  /** Work done in the expansion and compression spaces, J (W = We + Wc). */
  We: number;
  Wc: number;
  /** Swept volumes, m³. */
  sweptHot: number;
  sweptCold: number;
}

/** Log-mean temperature; tends to T_h as T_h → T_k. */
export function logMeanTemperature(Th: number, Tk: number): number {
  const r = Th / Tk;
  if (Math.abs(r - 1) < 1e-9) return (Th + Tk) / 2;
  return (Th - Tk) / Math.log(r);
}

/** Trapezoidal ∮ y dx over a closed, uniformly sampled loop (the last sample connects to the first). */
export function loopIntegral(y: number[], x: number[]): number {
  const n = x.length;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    s += 0.5 * (y[i] + y[k]) * (x[k] - x[i]);
  }
  return s;
}

/**
 * Schmidt cycle from volume samples (m³) over one revolution. The gas mass is fixed
 * so that p = pCharge at the sample of minimum total volume (the engine is assumed
 * to have been sealed there).
 */
export function schmidtFromVolumes(Ve: number[], Vc: number[], Vr: number, Th: number, Tk: number, pCharge: number, R: number) {
  const Tr = logMeanTemperature(Th, Tk);
  const n = Ve.length;
  const V = new Array<number>(n);
  const denom = new Array<number>(n);
  let iMin = 0;
  for (let i = 0; i < n; i++) {
    V[i] = Ve[i] + Vr + Vc[i];
    denom[i] = Ve[i] / Th + Vr / Tr + Vc[i] / Tk;
    if (V[i] < V[iMin]) iMin = i;
  }
  const mass = (pCharge * denom[iMin]) / R;
  const p = denom.map((d) => (mass * R) / d);
  const We = loopIntegral(p, Ve);
  const Wc = loopIntegral(p, Vc);
  return { V, p, mass, Tr, We, Wc, W: We + Wc };
}

/** Schmidt cycle from piston distances from TDC (mm) per sample. */
export function schmidtCycle(xHot: number[], xCold: number[], q: ThermoParams): CycleResult {
  const aHot = (Math.PI / 4) * (q.boreHot * 1e-3) ** 2;
  const aCold = (Math.PI / 4) * (q.boreCold * 1e-3) ** 2;
  const Ve = xHot.map((x) => q.deadHot * 1e-6 + aHot * x * 1e-3);
  const Vc = xCold.map((x) => q.deadCold * 1e-6 + aCold * x * 1e-3);
  const r = schmidtFromVolumes(Ve, Vc, q.deadPassage * 1e-6, q.Th, q.Tk, q.pCharge, q.R);
  const span = (a: number[]) => Math.max(...a) - Math.min(...a);
  return { Ve, Vc, ...r, sweptHot: span(Ve), sweptCold: span(Vc) };
}

/** Indicated power, W, from work per cycle (J) and speed (rpm). */
export const indicatedPower = (W: number, rpm: number) => (W * rpm) / 60;

/**
 * Closed-form Schmidt work for sinusoidal volumes (used to verify the numerics):
 *   V_e = V_de + (V_se/2)(1 − cos θ),   V_c = V_dc + (V_sc/2)(1 − cos(θ − α))
 * With a = V_se/(2T_h), b = V_sc/(2T_k), write a cos θ + b cos(θ − α) = c cos(θ − φ).
 * Then p = mR / (K − c cos(θ − φ)), K = V_se/(2T_h) + V_de/T_h + V_sc/(2T_k) + V_dc/T_k + V_r/T_r,
 * and ∮p dV = mR (2π/c)(K/√(K² − c²) − 1) · [ (V_se/2) sin φ + (V_sc/2) sin(φ − α) ].
 */
export function schmidtSinusoidalWork(o: {
  Vse: number;
  Vsc: number;
  Vde: number;
  Vdc: number;
  Vr: number;
  alpha: number;
  Th: number;
  Tk: number;
  mass: number;
  R: number;
}): number {
  const Tr = logMeanTemperature(o.Th, o.Tk);
  const a = o.Vse / (2 * o.Th);
  const b = o.Vsc / (2 * o.Tk);
  const c = Math.hypot(a + b * Math.cos(o.alpha), b * Math.sin(o.alpha));
  const phi = Math.atan2(b * Math.sin(o.alpha), a + b * Math.cos(o.alpha));
  const K = a + o.Vde / o.Th + b + o.Vdc / o.Tk + o.Vr / Tr;
  const f = ((2 * Math.PI) / c) * (K / Math.sqrt(K * K - c * c) - 1);
  return o.mass * o.R * f * ((o.Vse / 2) * Math.sin(phi) + (o.Vsc / 2) * Math.sin(phi - o.alpha));
}
