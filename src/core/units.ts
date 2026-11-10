/**
 * Unit normalization. Every quantity is converted to integer base units (ea, g or ml) before it is compared or priced.
 * A pack is `pack_units` base units (a case of 12 x 1 L oat milk = 12 ea). `each_size` lets a volume or weight
 * statement ("240 L") convert to each (240 ea of 1000 ml).
 */
export type BaseUnit = "ea" | "g" | "ml";

export interface UnitSpec {
  base_unit: BaseUnit;
  pack_units: number;
  pack_label: string; // noun for one pack: "case", "sack", "tray"
  each_size?: number | null; // size of one each in each_size_unit
  each_size_unit?: "g" | "ml" | null;
}

export interface Qty {
  units: number | null;
  uncertain: boolean;
  reason?: string;
}

const PACK = new Set(["case", "cases", "cs", "ctn", "ctns", "carton", "cartons", "box", "boxes", "pk", "pks", "pack", "packs", "tray", "trays", "sack", "sacks", "bag", "bags", "crate", "crates"]);
const EACH = new Set(["ea", "each", "unit", "units", "btl", "btls", "bottle", "bottles", "pc", "pcs", "piece", "pieces", "tin", "tins", "jar", "jars"]);
const MASS: Record<string, number> = { kg: 1000, kgs: 1000, g: 1, gm: 1, gms: 1, gram: 1, grams: 1 };
const VOLUME: Record<string, number> = { l: 1000, ltr: 1000, litre: 1000, litres: 1000, liter: 1000, liters: 1000, ml: 1 };

/** Classifies a unit token. Returns null for an unknown token. */
export function unitKind(token: string): { kind: "pack" | "each" | "mass" | "volume"; factor: number } | null {
  const t = token.toLowerCase().replace(/\.$/, "");
  if (PACK.has(t)) return { kind: "pack", factor: 1 };
  if (EACH.has(t)) return { kind: "each", factor: 1 };
  if (t in MASS) return { kind: "mass", factor: MASS[t] };
  if (t in VOLUME) return { kind: "volume", factor: VOLUME[t] };
  return null;
}

/** Converts one "<number> <unit>" term to base units (possibly fractional) or explains why it cannot. */
function termUnits(n: number, token: string, spec: UnitSpec): { units: number | null; uncertain: boolean; reason?: string } {
  if (!token) return { units: n * spec.pack_units, uncertain: true, reason: `no unit stated; read as ${spec.pack_label}s` };
  // The product's own pack noun ("bag", "tub") always means one pack, even if it is not in the list above.
  const own = spec.pack_label.toLowerCase();
  const t = token.toLowerCase().replace(/\.$/, "");
  const k = t === own || t === `${own}s` || t === `${own}es` ? { kind: "pack" as const, factor: 1 } : unitKind(token);
  if (!k) return { units: null, uncertain: true, reason: `unknown unit "${token}"` };
  if (k.kind === "pack") return { units: n * spec.pack_units, uncertain: false };
  if (k.kind === "each") {
    if (spec.base_unit === "ea") return { units: n, uncertain: false };
    return { units: n * spec.pack_units, uncertain: true, reason: `"${token}" is ambiguous for a product sold by ${spec.base_unit}; read as ${spec.pack_label}s` };
  }
  const dim = k.kind === "mass" ? "g" : "ml";
  const amount = n * k.factor;
  if (spec.base_unit === dim) return { units: amount, uncertain: false };
  if (spec.base_unit === "ea" && spec.each_size && spec.each_size_unit === dim) return { units: amount / spec.each_size, uncertain: false };
  return { units: null, uncertain: true, reason: `cannot convert ${dim === "g" ? "weight" : "volume"} to ${spec.base_unit} for this product` };
}

/**
 * Parses quantities such as "20 cs", "19 cases + 12 ea", "240 btl", "5 kg", "240 L", "20". Terms join with "+",
 * "and" or ",". A fractional result, unknown unit or bare number is marked uncertain.
 */
export function parseQuantity(text: string, spec: UnitSpec): Qty {
  const clean = text.trim().toLowerCase().replace(/(\d),(\d{3})/g, "$1$2");
  if (!clean) return { units: null, uncertain: true, reason: "no quantity" };
  const terms = clean.split(/\s*(?:\+|\band\b|,|&)\s*/).filter(Boolean);
  let total = 0;
  let uncertain = false;
  const reasons: string[] = [];
  for (const term of terms) {
    const m = term.match(/^(\d+(?:\.\d+)?)\s*(?:x\s*)?([a-z]+\.?)?$/);
    if (!m) return { units: null, uncertain: true, reason: `cannot read "${term}"` };
    const r = termUnits(Number(m[1]), m[2] ?? "", spec);
    if (r.units === null) return { units: null, uncertain: true, reason: r.reason };
    total += r.units;
    if (r.uncertain) {
      uncertain = true;
      if (r.reason) reasons.push(r.reason);
    }
  }
  if (!Number.isInteger(total)) {
    const rounded = Math.round(total);
    return { units: rounded, uncertain: true, reason: [...reasons, `${trimNum(total)} ${spec.base_unit} is not a whole number; rounded to ${rounded}`].join("; ") };
  }
  return { units: total, uncertain, reason: reasons.length ? reasons.join("; ") : undefined };
}

const trimNum = (n: number) => String(Math.round(n * 1000) / 1000);

const plural = (n: number, noun: string) => (n === 1 ? noun : /(s|x|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`);

/** "18 cases", "18 cases + 6 ea", "2.5 kg". */
export function formatUnits(units: number, spec: UnitSpec): string {
  if (units === 0) return `0 ${plural(0, spec.pack_label)}`;
  const packs = Math.floor(units / spec.pack_units);
  const rem = units - packs * spec.pack_units;
  const parts: string[] = [];
  if (packs) parts.push(`${packs} ${plural(packs, spec.pack_label)}`);
  if (rem) parts.push(spec.base_unit === "ea" ? `${rem} ea` : `${trimNum(rem / (spec.base_unit === "g" ? 1000 : 1000))} ${spec.base_unit === "g" ? "kg" : "L"}`);
  return parts.join(" + ");
}

export const packsToUnits = (packs: number, spec: UnitSpec) => packs * spec.pack_units;
