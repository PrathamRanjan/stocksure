import { lineCents, sum } from "./money.js";
import type { UnitSpec } from "./units.js";

/**
 * Three-way match: accepted quote x agreed receipt, compared with the invoice. Pure.
 * The payable amount is always quote price x accepted units; invoice figures only raise flags.
 */
export interface RProduct extends UnitSpec {
  id: string;
  sku: string;
  name: string;
}

export interface RLine {
  line_id: string;
  line_no: number;
  product: RProduct;
  qty_packs: number;
  unit_price_cents: number; // quoted price per pack
  substitutes: string[];
  replace_shortfall: boolean;
}

export interface RReceipt {
  line_id: string;
  delivered: number;
  accepted: number;
  damaged: number;
  wrong: number;
}

export interface RInvoiceLine {
  po_line_id: string | null;
  description: string;
  billed_units: number | null;
  unit_price_cents: number | null; // per pack
  line_cents: number | null;
}

export type Remedy = "none" | "replace" | "credit";

export interface ResLine {
  line_id: string;
  line_no: number;
  product_id: string;
  sku: string;
  name: string;
  pack_units: number;
  ordered: number;
  delivered: number;
  accepted: number;
  paid_units: number;
  damaged: number;
  wrong: number;
  missing: number;
  over_delivered: number;
  shortfall: number;
  unit_price_cents: number;
  quoted_cents: number;
  accepted_cents: number;
  not_charged_cents: number;
  rounding_remainder: number;
  invoice_billed_units: number | null;
  invoice_cents: number | null;
  invoice_delta_cents: number | null;
  remedy: Remedy;
  reason: string;
}

export interface Flag {
  code: "overbilled_qty" | "price_above_quote" | "unbilled_line" | "invoice_not_on_po" | "over_delivered" | "invoice_missing";
  line_id: string | null;
  message: string;
}

export interface Need {
  line_id: string;
  product_id: string;
  units: number;
  allowed: string[];
}

export interface MatchResult {
  lines: ResLine[];
  flags: Flag[];
  needs: Need[];
  totals: { quoted_cents: number; accepted_cents: number; not_charged_cents: number; invoice_cents: number | null; invoice_delta_cents: number | null };
}

export function match(lines: RLine[], receipt: RReceipt[], invoice: RInvoiceLine[] | null, choices: Record<string, Remedy> = {}): MatchResult {
  const flags: Flag[] = [];
  const needs: Need[] = [];
  const byLine = new Map(receipt.map((r) => [r.line_id, r]));
  const out: ResLine[] = [];
  for (const l of lines) {
    const r = byLine.get(l.line_id);
    if (!r) throw new Error(`Receipt has no count for line ${l.line_no}`);
    if (r.delivered !== r.accepted + r.damaged + r.wrong) throw new Error(`Line ${l.line_no}: delivered must equal accepted + damaged + wrong`);
    const ordered = l.qty_packs * l.product.pack_units;
    const paid = Math.min(r.accepted, ordered);
    const quoted = l.qty_packs * l.unit_price_cents;
    const acc = lineCents(paid, l.product.pack_units, l.unit_price_cents);
    const shortfall = ordered - paid;
    const over = Math.max(0, r.accepted - ordered);
    if (over) flags.push({ code: "over_delivered", line_id: l.line_id, message: `Line ${l.line_no}: ${over} more units accepted than ordered; only the ordered quantity is paid.` });
    let remedy: Remedy = "none";
    let reason = "Delivered as ordered.";
    if (shortfall > 0) {
      remedy = choices[l.line_id] ?? (l.replace_shortfall ? "replace" : "credit");
      const why = [r.damaged && `${r.damaged} damaged`, r.wrong && `${r.wrong} wrong item`, ordered - r.delivered > 0 && `${ordered - r.delivered} missing`].filter(Boolean).join(", ");
      reason = remedy === "replace" ? `Short ${shortfall} (${why}): not charged, replacement requested.` : `Short ${shortfall} (${why}): not charged.`;
      if (remedy === "replace") needs.push({ line_id: l.line_id, product_id: l.product.id, units: shortfall, allowed: [l.product.id, ...l.substitutes.filter((s) => s !== l.product.id)] });
    }
    // Invoice comparison (flags only).
    const inv = invoice?.filter((i) => i.po_line_id === l.line_id) ?? [];
    let invUnits: number | null = null;
    let invCents: number | null = null;
    if (invoice) {
      if (!inv.length) flags.push({ code: "unbilled_line", line_id: l.line_id, message: `Line ${l.line_no} (${l.product.sku}) is not on the invoice.` });
      else {
        invUnits = sum(inv.map((i) => i.billed_units ?? 0));
        invCents = sum(inv.map((i) => i.line_cents ?? (i.billed_units !== null && i.unit_price_cents !== null ? lineCents(i.billed_units, l.product.pack_units, i.unit_price_cents).cents : 0)));
        if (invUnits > paid) flags.push({ code: "overbilled_qty", line_id: l.line_id, message: `Line ${l.line_no}: invoice bills ${invUnits} units, ${paid} accepted. Paying ${paid}.` });
        for (const i of inv)
          if (i.unit_price_cents !== null && i.unit_price_cents > l.unit_price_cents)
            flags.push({ code: "price_above_quote", line_id: l.line_id, message: `Line ${l.line_no}: invoice price ${(i.unit_price_cents / 100).toFixed(2)} is above the quoted ${(l.unit_price_cents / 100).toFixed(2)}. Paying the quote.` });
      }
    }
    out.push({
      line_id: l.line_id,
      line_no: l.line_no,
      product_id: l.product.id,
      sku: l.product.sku,
      name: l.product.name,
      pack_units: l.product.pack_units,
      ordered,
      delivered: r.delivered,
      accepted: r.accepted,
      paid_units: paid,
      damaged: r.damaged,
      wrong: r.wrong,
      missing: Math.max(0, ordered - r.delivered),
      over_delivered: over,
      shortfall,
      unit_price_cents: l.unit_price_cents,
      quoted_cents: quoted,
      accepted_cents: acc.cents,
      not_charged_cents: quoted - acc.cents,
      rounding_remainder: acc.remainder,
      invoice_billed_units: invUnits,
      invoice_cents: invCents,
      invoice_delta_cents: invCents === null ? null : invCents - acc.cents,
      remedy,
      reason,
    });
  }
  if (invoice) for (const i of invoice) if (!i.po_line_id && (i.line_cents ?? 0) > 0) flags.push({ code: "invoice_not_on_po", line_id: null, message: `Invoice line "${i.description.slice(0, 80)}" is not on the PO. Not paid.` });
  if (!invoice) flags.push({ code: "invoice_missing", line_id: null, message: "No invoice uploaded; paying the quote for accepted units." });
  const invoiceCents = invoice ? sum(invoice.map((i) => i.line_cents ?? 0)) : null;
  const accepted = sum(out.map((l) => l.accepted_cents));
  return {
    lines: out,
    flags,
    needs,
    totals: {
      quoted_cents: sum(out.map((l) => l.quoted_cents)),
      accepted_cents: accepted,
      not_charged_cents: sum(out.map((l) => l.not_charged_cents)),
      invoice_cents: invoiceCents,
      invoice_delta_cents: invoiceCents === null ? null : invoiceCents - accepted,
    },
  };
}

/** True when the receipt matches the accepted quote exactly: nothing to agree, pay the quote. */
export const isClean = (m: MatchResult) => m.lines.every((l) => l.shortfall === 0 && l.over_delivered === 0 && l.damaged === 0 && l.wrong === 0);

/** Canonical JSON (sorted keys) for hashing a resolution body. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
