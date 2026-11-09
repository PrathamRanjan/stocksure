/**
 * Funding view for one PO tree. Pure. Spendable money comes only from PayPal state that has been read back:
 * an expected hold release or refund is listed, but it does not count until PayPal confirms it.
 */
export interface FundOp {
  kind: "authorize" | "capture" | "void" | "refund";
  status: "planned" | "pending" | "succeeded" | "failed";
  amount_cents: number;
  paypal_id: string | null;
  parent_paypal_id: string | null;
  paypal_status: string | null; // read-back status (authorizations)
  final_capture: boolean;
  po_number?: string;
}

export const ACTIVE_AUTH = new Set(["CREATED", "PENDING", "PARTIALLY_CAPTURED"]);

export interface Funding {
  limit_cents: number;
  captured_cents: number;
  refunded_cents: number;
  held_cents: number;
  inflight_cents: number;
  expected: { label: string; cents: number }[];
  spendable_cents: number;
  holds: { id: string; po_number?: string; amount_cents: number; captured_cents: number; live_cents: number; status: string }[];
}

export function funding(limitCents: number, ops: FundOp[]): Funding {
  const ok = (o: FundOp) => o.status === "succeeded";
  const captured = ops.filter((o) => o.kind === "capture" && ok(o)).reduce((a, o) => a + o.amount_cents, 0);
  const refunded = ops.filter((o) => o.kind === "refund" && ok(o)).reduce((a, o) => a + o.amount_cents, 0);
  const expected: Funding["expected"] = [];
  const holds: Funding["holds"] = [];
  let held = 0;
  for (const a of ops.filter((o) => o.kind === "authorize" && ok(o) && o.paypal_id)) {
    const caps = ops.filter((o) => o.kind === "capture" && o.parent_paypal_id === a.paypal_id);
    const capturedOn = caps.filter(ok).reduce((s, o) => s + o.amount_cents, 0);
    const status = a.paypal_status ?? "CREATED";
    const live = ACTIVE_AUTH.has(status) ? Math.max(0, a.amount_cents - capturedOn) : 0;
    held += live;
    holds.push({ id: a.paypal_id!, po_number: a.po_number, amount_cents: a.amount_cents, captured_cents: capturedOn, live_cents: live, status });
    const finalOrVoid = caps.some((c) => c.final_capture && c.status !== "failed") || ops.some((o) => o.kind === "void" && o.parent_paypal_id === a.paypal_id && o.status !== "failed");
    if (live > 0 && finalOrVoid) expected.push({ label: `Release of the rest of hold ${a.paypal_id}${a.po_number ? ` (${a.po_number})` : ""}`, cents: live });
  }
  const inflight = ops.filter((o) => o.kind === "authorize" && (o.status === "planned" || o.status === "pending")).reduce((a, o) => a + o.amount_cents, 0);
  for (const r of ops.filter((o) => o.kind === "refund" && (o.status === "planned" || o.status === "pending"))) expected.push({ label: `Refund ${r.paypal_id ?? "(not sent yet)"}`, cents: r.amount_cents });
  return {
    limit_cents: limitCents,
    captured_cents: captured,
    refunded_cents: refunded,
    held_cents: held,
    inflight_cents: inflight,
    expected,
    spendable_cents: limitCents - captured + refunded - held - inflight,
    holds,
  };
}
