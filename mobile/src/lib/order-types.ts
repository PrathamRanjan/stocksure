import type { ApprovalRow, FundingNums, TallyNums } from "./types";

export interface Line {
  id: string;
  line_no: number;
  product: { id: string; sku: string; name: string; family: string; pack_label: string; pack_units: number; base_unit: string; price_cents: number; stock_packs: number; lead_hours: number };
  qty_packs: number;
  ordered_text: string;
  unit_price_cents: number | null;
  quoted_cents: number | null;
  substitutes: string[];
  replace_shortfall: boolean;
  tally: TallyNums;
  receipt: { delivered: string; accepted: string; damaged: string; wrong: string; note: string; supplier_status: string; supplier_note: string; fingerprint: string } | null;
  can_review: boolean;
  rest_packs: number | null;
}
export interface ResLine {
  line_id: string;
  line_no: number;
  sku: string;
  name: string;
  ordered_text: string;
  paid_text: string;
  short_text: string;
  shortfall: number;
  unit_price_cents: number;
  quoted_cents: number;
  accepted_cents: number;
  not_charged_cents: number;
  invoice_cents: number | null;
  invoice_delta_cents: number | null;
  remedy: "replace" | "credit";
}
export interface Pick {
  line_id: string;
  sku: string;
  name: string;
  packs: number;
  units: number;
  pack_price_cents: number;
  cents: number;
  eta: string;
}
export interface Plan {
  picks: Pick[];
  unfilled_units: number;
  cost_cents: number;
  eta_max: string | null;
}
export interface Resolution {
  version: number;
  status: string;
  hash: string;
  auto: boolean;
  lines: ResLine[];
  flags: { code: string; line_id: string | null; message: string }[];
  needed_by: string;
  plan: { chosen_index: number | null; chosen: Plan | null; alternatives: Plan[]; blocked: { sku: string; reason: string }[]; budget_cents: number };
  totals: { quoted_cents: number; accepted_cents: number; not_charged_cents: number; invoice_cents: number | null; invoice_delta_cents: number | null; replacement_cents: number; other_spend_cents: number; final_cents: number; limit_cents: number; headroom_cents: number };
  funding: { spendable_now_cents: number; hold_cents: number; release_expected_cents: number };
  buyer_approved_by: string | null;
  supplier_approved_by: string | null;
  open: boolean;
  i_approved: boolean;
  can_approve: boolean;
  can_revise: boolean;
  part_charged_cents: number;
}
export interface Op {
  id: string;
  po_number: string;
  kind: "authorize" | "capture" | "void" | "refund";
  status: "planned" | "pending" | "succeeded" | "failed";
  paypal_status: string | null;
  amount_cents: number;
  final_capture: boolean;
  paypal_id: string | null;
  request_id: string;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}
export interface PoModel {
  po: { id: string; number: string; status: string; kind: string; root_id: string; buyer_name: string; supplier_name: string; deliver_by: string; limit_cents: number; note: string; exception: string | null; quote_version: number; dispatched_at: string | null; closed_at: string | null; created_at: string; history: boolean };
  me: { side: "buyer" | "supplier"; role: string; owner: boolean };
  tree: { id: string; number: string; status: string; kind: string; parent_id: string | null }[];
  children: { id: string; number: string; status: string; kind: string }[];
  lines: Line[];
  receipt: { version: number; confirmed_by: string; created_at: string } | null;
  disputed: boolean;
  quote_total_cents: number;
  over_limit: boolean;
  paypal: { connected: boolean; payer: string | null } | null;
  delivery: { mode: string; part: { accepted_cents: number; status: string; packs: Record<string, number> } | null };
  funding: (FundingNums & { holds?: unknown[] }) | null;
  approvals: ApprovalRow[];
  resolution: Resolution | null;
  agent: {
    agreement: { hash: string; ok: boolean; quote_version: number; buyer_signed_at: string | null; buyer_signed_by: string | null; supplier_signed_at: string | null } | null;
    negotiations: { id: string; status: string; round: number; max_rounds: number; buyer_agent: string; supplier_agent: string }[];
    runs: { id: string; subject: string; actor: string; agent_id: string | null; status: string; started_at: string }[];
    can_negotiate: boolean;
  };
  supply: {
    can_record: boolean;
    updates: { id: string; eta: string; observed_at: string; source: string; ref: string; note: string; applied: boolean; ignored_reason: string | null }[];
    risk: { id: string; status: string; eta: string; deliver_by: string; slack_minutes: number; decision: string | null; on_hand: { line_no: number; sku: string; ordered: string; on_hand: string; alternatives: unknown[] }[]; evidence: unknown[]; unknowns: string[]; can_decide: boolean } | null;
  } | null;
  defects: { can_report: boolean; can_decide: boolean; claims: { id: string; po_line_id: string; line_no: number; sku: string; units: number; amount_cents: number; note: string; status: string; decision_note: string; created_at: string }[] } | null;
  docs: { id: string; kind: string; filename: string; size: number; sha256: string; uploaded_by: string; created_at: string; flags: { line?: number; text?: string; kind?: string; code?: string; message?: string }[] }[];
  ops: Op[];
  messages: { id: number; line_id: string | null; author: string; role: string; kind: string; body: string; document_id: string | null; created_at: string; scan: { level: string; words: string[] } | null }[];
  can_post: boolean;
  can_replan: boolean;
  events: { id: number; at: string; type: string; summary: string; actor: string | null }[];
  demo: { samples: boolean };
  copy: { next: string | null };
}
