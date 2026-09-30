import type { ThermoParams } from "./schmidt";

/** One thermodynamic input as stored in mechanism.json → thermo. */
export interface ThermoInput {
  value: number;
  unit: string;
  /** "ASSUMED" until the author replaces the value with a measured or designed one. */
  status: "ASSUMED" | "MEASURED" | "DESIGN";
  label: string;
  source?: string;
}

export type ThermoKey =
  | "bore_hot"
  | "bore_cold"
  | "dead_volume_hot"
  | "dead_volume_cold"
  | "dead_volume_passage"
  | "T_hot"
  | "T_cold"
  | "p_charge"
  | "R_gas";

export const THERMO_KEYS: ThermoKey[] = [
  "bore_hot",
  "bore_cold",
  "dead_volume_hot",
  "dead_volume_cold",
  "dead_volume_passage",
  "T_hot",
  "T_cold",
  "p_charge",
  "R_gas",
];

export interface ThermoSection {
  gas: string;
  charge_condition: string;
  inputs: Record<ThermoKey, ThermoInput>;
}

/** Convert the stored inputs (°C, cm³, mm, Pa) into model parameters (K, cm³, mm, Pa). */
export function thermoParamsFrom(section: ThermoSection): { params: ThermoParams; assumed: ThermoKey[] } {
  const v = (k: ThermoKey) => {
    const inp = section.inputs[k];
    if (!inp || typeof inp.value !== "number") throw new Error(`mechanism.json thermo.inputs.${k} is missing`);
    return inp.value;
  };
  const params: ThermoParams = {
    boreHot: v("bore_hot"),
    boreCold: v("bore_cold"),
    deadHot: v("dead_volume_hot"),
    deadCold: v("dead_volume_cold"),
    deadPassage: v("dead_volume_passage"),
    Th: v("T_hot") + 273.15,
    Tk: v("T_cold") + 273.15,
    pCharge: v("p_charge"),
    R: v("R_gas"),
  };
  const assumed = THERMO_KEYS.filter((k) => section.inputs[k].status === "ASSUMED");
  return { params, assumed };
}
