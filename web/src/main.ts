import "./ui/style.css";
import { Linkage, pistonMotion, sweep, type MechanismSpec, type PistonMotion, type Solution, type Sweep } from "./kinematics/linkage";
import { thermoParamsFrom, THERMO_KEYS, type ThermoKey, type ThermoSection } from "./thermo/params";
import { indicatedPower, schmidtCycle, type CycleResult, type ThermoParams } from "./thermo/schmidt";
import { Viewer, type MechanismGeometry } from "./scene/viewer";
import { LineChart } from "./ui/charts";
import type { PartsDoc } from "./ui/types";

type MechanismDoc = MechanismSpec &
  MechanismGeometry & {
    thermo: ThermoSection;
    measured: { power_mW: number; speed_rpm: number; method: string };
  };

const N = 3600;
const TAU = 2 * Math.PI;
const MAX_STEP = (4 * Math.PI) / 180; // solver sub-step, keeps branch continuation safe
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const base = import.meta.env.BASE_URL;

const state = {
  phi: 0, // crank rotation from the CAD pose, rad, running direction
  playing: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  rpm: 340,
  slow: false,
};

let linkage: Linkage;
let sw: Sweep;
let motion: PistonMotion;
let cycle: CycleResult;
let params: ThermoParams;
let thermo: ThermoSection;
let mech: MechanismDoc;
const edited = new Set<ThermoKey>();
let lastSolution: Solution | null = null;

async function main() {
  const viewer = new Viewer($("viewport"));
  try {
    await viewer.init();
  } catch (e) {
    fatal(`This browser could not start WebGPU or WebGL2: ${(e as Error).message}`);
    return;
  }
  $("backend").textContent = viewer.backendName;

  const [mechDoc, partsDoc] = await Promise.all([
    fetch(`${base}mechanism.json`).then((r) => r.json() as Promise<MechanismDoc>),
    fetch(`${base}parts.json`).then((r) => r.json() as Promise<PartsDoc>),
  ]);
  mech = mechDoc;
  thermo = structuredClone(mech.thermo);

  // Kinematics: solve one revolution up front for the charts, then live per frame.
  linkage = new Linkage(mech);
  sw = sweep(mech, N);
  if (!sw.ok) showAlert(`Kinematics: the linkage cannot close over a full revolution (${sw.reason}).`);
  motion = pistonMotion(sw);
  recomputeThermo();

  try {
    await viewer.load(`${base}engine.glb`, partsDoc, mech, (f) => {
      $("loading-pct").textContent = `${Math.round(f * 100)}%`;
      $("loading-fill").style.width = `${f * 100}%`;
    });
  } catch (e) {
    fatal(`Could not load the model: ${(e as Error).message}`);
    return;
  }
  $("loading").hidden = true;

  // Start at hot-piston TDC so θ = 0 on screen.
  goTo(motion.phiTdcHot);
  setupControls(viewer);
  setupPanels();
  setupPartPanel(viewer);
  renderKinematicsInfo();
  renderInputs();

  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (state.playing) {
      const omega = (state.rpm / 60) * TAU * (state.slow ? 0.1 : 1);
      advance(omega * dt);
    }
    if (lastSolution?.ok) viewer.applyPoses(lastSolution.poses);
    updateReadout();
    viewer.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** Advance the crank by dphi (rad) in solver sub-steps; pause at a dead point. */
function advance(dphi: number) {
  const steps = Math.max(1, Math.ceil(Math.abs(dphi) / MAX_STEP));
  for (let i = 0; i < steps; i++) {
    const phi = state.phi + dphi / steps;
    const sol = linkage.solve(phi);
    if (!sol.ok) {
      setPlaying(false);
      showAlert(`Paused: ${sol.reason} at θ = ${thetaDeg(phi).toFixed(1)}°.`);
      return;
    }
    state.phi = phi;
    lastSolution = sol;
  }
}

/** Move the crank to an absolute rotation along the shorter way round. */
function goTo(phiTarget: number) {
  let d = (phiTarget - state.phi) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  advance(d);
  if (!lastSolution) lastSolution = linkage.solve(state.phi);
}

const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
/** Crank angle shown to the user: 0° at hot-piston top dead centre, increasing in the running direction. */
const thetaDeg = (phi: number) => (wrap(phi - motion.phiTdcHot) * 180) / Math.PI;
/** Index into the sweep arrays (sampled from the CAD pose) for rotation phi. */
const sweepIndex = (phi: number) => Math.round((wrap(phi) / TAU) * N) % N;

function recomputeThermo() {
  params = thermoParamsFrom(thermo).params;
  cycle = schmidtCycle(motion.xHot, motion.xCold, params);
  drawCharts();
  renderCompare();
}

let pvChart: LineChart;
let xChart: LineChart;
const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function drawCharts() {
  pvChart ??= new LineChart($("pv-chart"), { xLabel: "V (cm³)", yLabel: "p (kPa)" });
  xChart ??= new LineChart($("x-chart"), { xLabel: "θ from hot TDC (°)", yLabel: "x (mm)", xTicks: [0, 90, 180, 270, 360] });
  pvChart.setData([
    { x: cycle.V.map((v) => v * 1e6), y: cycle.p.map((p) => p / 1e3), color: cssVar("--accent"), label: "p–V", closed: true },
  ]);
  // Displacement plotted against θ (0 at hot TDC), so rotate the sweep arrays.
  const shift = sweepIndex(motion.phiTdcHot);
  const rot = (a: number[]) => a.map((_, i) => a[(i + shift) % N]);
  const theta = Array.from({ length: N }, (_, i) => (i * 360) / N);
  xChart.setData(
    [
      { x: theta, y: rot(motion.xHot), color: cssVar("--hot"), label: "hot" },
      { x: theta, y: rot(motion.xCold), color: cssVar("--cold"), label: "cold" },
    ],
    { x0: 0, x1: 360 },
  );
}

function setPlaying(p: boolean) {
  state.playing = p;
  $("play").textContent = p ? "❚❚ Pause" : "▶ Play";
  ($("theta") as HTMLInputElement).disabled = p;
  if (p) hideAlert();
}

function setupControls(viewer: Viewer) {
  const input = (id: string) => $<HTMLInputElement>(id);
  setPlaying(state.playing);
  $("play").addEventListener("click", () => setPlaying(!state.playing));
  input("slowmo").addEventListener("change", (e) => (state.slow = (e.target as HTMLInputElement).checked));
  input("rpm").addEventListener("input", (e) => {
    state.rpm = +(e.target as HTMLInputElement).value;
    $("rpm-out").textContent = String(state.rpm);
  });
  input("theta").addEventListener("input", (e) => {
    const deg = +(e.target as HTMLInputElement).value;
    goTo(motion.phiTdcHot + (deg * Math.PI) / 180);
  });

  const section = () => {
    const off = +input("section-offset").value;
    $("section-out").textContent = off.toFixed(1);
    viewer.setSection(input("section").checked, off, input("section-flip").checked);
  };
  input("section").addEventListener("change", section);
  input("section-flip").addEventListener("change", section);
  input("section-offset").addEventListener("input", section);

  input("explode").addEventListener("input", (e) => {
    const k = +(e.target as HTMLInputElement).value;
    $("explode-out").textContent = k.toFixed(2);
    viewer.setExplode(k);
  });
  input("thermal").addEventListener("change", (e) => viewer.setThermal((e.target as HTMLInputElement).checked));
  $("reset-view").addEventListener("click", () => viewer.resetView());

  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== "range" && e.target.type !== "checkbox") return;
    if (e.code === "Space") {
      e.preventDefault();
      setPlaying(!state.playing);
    }
  });
}

function setupPanels() {
  const narrow = window.matchMedia("(max-width: 760px)");
  const toggles = [...document.querySelectorAll<HTMLButtonElement>(".panel-toggle")];
  const setOpen = (btn: HTMLButtonElement, open: boolean) => {
    btn.setAttribute("aria-expanded", String(open));
    $(btn.dataset.target!).hidden = !open;
    document.body.classList.toggle(`open-${btn.dataset.target!.replace("-body", "")}`, open);
  };
  for (const btn of toggles) {
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") !== "true";
      // On a phone only one panel is open at a time.
      if (open && narrow.matches) toggles.forEach((b) => b !== btn && setOpen(b, false));
      setOpen(btn, open);
      pvChart?.draw();
      xChart?.draw();
    });
  }
  if (narrow.matches) toggles.forEach((b) => setOpen(b, false));
}

function setupPartPanel(viewer: Viewer) {
  const panel = $("part-panel");
  const close = () => {
    panel.hidden = true;
    viewer.setSelected(null);
  };
  $("part-close").addEventListener("click", close);
  viewer.onPick = (info) => {
    if (!info) return close();
    const p = info.part;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const ops = p.operations ? esc(p.operations) : p.operations_todo ? '<span class="todo">Not documented yet</span>' : "—";
    const drawing = p.drawing_url
      ? `<a href="${p.drawing_url}" target="_blank" rel="noopener">${esc(p.drawing!)}</a>`
      : "—";
    $("part-body").innerHTML = `
      <h2>${esc(p.name)}</h2>
      <div class="ja" lang="ja">${esc(p.name_ja)}</div>
      <table>
        <tr><th>Part</th><td>${p.no} · <code>${esc(p.id)}</code></td></tr>
        <tr><th>Instance</th><td><code>${esc(info.node)}</code> (${p.qty} in assembly)</td></tr>
        <tr><th>Material</th><td>${esc(p.material)}</td></tr>
        <tr><th>Process</th><td>${p.process === "machined" ? "Machined in-house from raw stock" : "Purchased"}</td></tr>
        <tr><th>Operations</th><td>${ops}</td></tr>
        <tr><th>Mass</th><td>${p.mass_kg === null ? "—" : p.mass_kg < 0.005 ? "&lt; 5 g" : `${Math.round(p.mass_kg * 1000)} g`}</td></tr>
        <tr><th>Moves with</th><td>${info.link.replace("_", " ")}</td></tr>
        <tr><th>Drawing</th><td>${drawing}</td></tr>
      </table>`;
    panel.hidden = false;
  };
}

function renderKinematicsInfo() {
  const lk = linkage;
  $("kinematics-body").innerHTML = `
    <p>A planar vector-loop solver computes the pose of every link from the crank angle. It closes the loop by
    circle–circle intersection for the yoke and guide rod, and by a slider constraint for each piston. It
    picks the branch closest to the previous solution, starting from the CAD pose. Joint positions were
    measured from the pin axes in the STEP assembly.</p>
    <table>
      <tr><th>Crank radius</th><td class="num">${lk.crankRadius.toFixed(2)} mm</td></tr>
      <tr><th>Yoke C–B</th><td class="num">${lk.lenCB.toFixed(2)} mm</td></tr>
      <tr><th>Guide rod</th><td class="num">${lk.lenGuide.toFixed(2)} mm</td></tr>
      <tr><th>Piston rods</th><td class="num">${lk.lenRod.hot.toFixed(2)} / ${lk.lenRod.cold.toFixed(2)} mm</td></tr>
      <tr><th>Stroke hot / cold</th><td class="num">${motion.stroke.hot.toFixed(2)} / ${motion.stroke.cold.toFixed(2)} mm</td></tr>
      <tr><th>Cold lags hot</th><td class="num">${motion.phaseLagDeg.toFixed(1)}° (1st harmonic)</td></tr>
      <tr><th>Max closure residual</th><td class="num">${sw.maxResidual.toExponential(1)} mm over ${N} steps
        <span class="tag ${sw.maxResidual < 1e-6 ? "ok" : "assumed"}">${sw.maxResidual < 1e-6 ? "OK" : "CHECK"}</span></td></tr>
      <tr><th>Live residual</th><td class="num" id="live-residual">—</td></tr>
    </table>`;
}

function renderInputs() {
  const rows = THERMO_KEYS.map((k) => {
    const inp = thermo.inputs[k];
    const tag = edited.has(k) ? '<span class="tag edited">EDITED</span>' : inp.status === "ASSUMED" ? '<span class="tag assumed">ASSUMED</span>' : `<span class="tag ok">${inp.status}</span>`;
    return `<tr>
      <td>${inp.label}${inp.source ? `<br><small style="color:var(--muted)">${inp.source}</small>` : ""}</td>
      <td class="num"><input type="number" step="any" data-key="${k}" value="${inp.value}" /> ${inp.unit}</td>
      <td>${tag}</td></tr>`;
  }).join("");
  $("inputs-body").innerHTML = `
    <p>Inputs marked <span class="tag assumed">ASSUMED</span> are placeholders until the author replaces them in
    <code>mechanism.json</code>. You can edit them here to explore; edits are not saved.</p>
    <p>${thermo.charge_condition}</p>
    <table class="inputs">${rows}</table>`;
  const assumed = THERMO_KEYS.filter((k) => thermo.inputs[k].status === "ASSUMED").length;
  $("assumed-count").textContent = assumed ? `${assumed} ASSUMED` : "";
  $("inputs-body").querySelectorAll<HTMLInputElement>("input[data-key]").forEach((el) =>
    el.addEventListener("change", () => {
      const k = el.dataset.key as ThermoKey;
      const v = parseFloat(el.value);
      if (!Number.isFinite(v)) return;
      thermo.inputs[k].value = v;
      if (v === mech.thermo.inputs[k].value) edited.delete(k);
      else edited.add(k);
      try {
        recomputeThermo();
        hideAlert();
      } catch (e) {
        showAlert((e as Error).message);
      }
      renderInputs();
    }),
  );
}

function renderCompare() {
  const m = mech.measured;
  const pSchmidt = indicatedPower(cycle.W, m.speed_rpm) * 1e3;
  const ratio = m.power_mW / pSchmidt;
  const anyAssumed = THERMO_KEYS.some((k) => thermo.inputs[k].status === "ASSUMED");
  $("compare-body").innerHTML = `
    <div class="big-compare">
      <div class="cell"><div class="v">${pSchmidt.toFixed(0)} mW</div><div class="k">Schmidt P<sub>i</sub> at ${m.speed_rpm} rpm</div></div>
      <div class="cell"><div class="v">${m.power_mW} mW</div><div class="k">Measured at ${m.speed_rpm} rpm</div></div>
      <div class="cell"><div class="v">${(ratio * 100).toFixed(0)} %</div><div class="k">measured / Schmidt</div></div>
    </div>
    ${anyAssumed ? '<p><span class="tag assumed">ASSUMED</span> The Schmidt figure depends on inputs that are still assumed (see Model inputs).</p>' : ""}
    <p>The measured value is shaft output: the flywheel was coupled by a pulley to a measurement device. The Schmidt value is
    the indicated work of an ideal isothermal cycle, W<sub>i</sub> = ∮p dV = ${(cycle.W * 1e3).toFixed(1)} mJ per revolution.
    The volumes come from the solved piston motion, and W<sub>i</sub> is multiplied by the speed. The ideal model over-predicts
    because the real engine loses on every assumption it makes:</p>
    <ul>
      <li><b>Heat transfer is finite.</b> The gas never reaches the wall temperatures, so the effective T<sub>h</sub>/T<sub>k</sub>
        ratio is much smaller. There is no regenerator: the heat carried by the gas moving between the spaces is lost each cycle.</li>
      <li><b>Leakage</b> past the piston seals changes the gas mass and lowers the pressure swing.</li>
      <li><b>Mechanical friction</b> in the yoke, pins and bearings takes work before it reaches the flywheel.</li>
      <li><b>Pressure drop</b> in the connecting passage makes the expansion and compression pressures differ,
        which shrinks the loop.</li>
    </ul>
    <p>A ratio of 10–30 % is typical for small unpressurised demonstration engines.</p>`;
}

let lastReadout = 0;
function updateReadout() {
  const now = performance.now();
  if (now - lastReadout < 60) return;
  lastReadout = now;
  const i = sweepIndex(state.phi);
  const th = thetaDeg(state.phi);
  pvChart.setMarker(i);
  xChart.setMarker((i - sweepIndex(motion.phiTdcHot) + N) % N);
  const effRpm = state.playing ? state.rpm * (state.slow ? 0.1 : 1) : 0;
  const cells: [string, string][] = [
    ["θ from hot TDC", `${th.toFixed(1)}°`],
    ["Speed", state.playing ? `${effRpm.toFixed(effRpm < 100 ? 1 : 0)} rpm` : "paused"],
    ["Pressure", `${(cycle.p[i] / 1e3).toFixed(1)} kPa`],
    ["Volume", `${(cycle.V[i] * 1e6).toFixed(2)} cm³`],
    ["W_i (Schmidt)", `${(cycle.W * 1e3).toFixed(1)} mJ`],
    [`P_i at ${state.rpm} rpm`, `${(indicatedPower(cycle.W, state.rpm) * 1e3).toFixed(0)} mW`],
  ];
  $("readout").innerHTML = cells.map(([k, v]) => `<div class="cell"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  if (document.activeElement !== $("theta")) ($("theta") as HTMLInputElement).value = th.toFixed(1);
  $("theta-out").textContent = th.toFixed(1);
  const lr = $("live-residual");
  if (lr && lastSolution) lr.textContent = `${lastSolution.maxResidual.toExponential(1)} mm`;
}

function showAlert(msg: string) {
  const a = $("alert");
  a.textContent = msg;
  a.hidden = false;
}

function hideAlert() {
  $("alert").hidden = true;
}

function fatal(msg: string) {
  $("loading").hidden = true;
  showAlert(msg);
}

main().catch((e) => fatal(String(e)));
