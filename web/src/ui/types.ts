export interface PartInfo {
  no: string;
  id: string;
  name: string;
  name_ja: string;
  material: string;
  qty: number;
  process: string;
  mass_kg: number | null;
  drawing: string | null;
  drawing_url: string | null;
  operations: string | null;
  operations_todo: boolean;
  material_class: string;
  thermal: "hot" | "cold" | null;
  explode_mm: [number, number, number] | null;
}

export interface MaterialDef {
  color: string;
  metalness: number;
  roughness: number;
  opacity?: number;
}

export interface PartsDoc {
  materials: Record<string, MaterialDef>;
  parts: PartInfo[];
}
