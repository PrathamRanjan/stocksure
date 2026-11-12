/** View models from the server's `/api/ui/*` endpoints (`src/web/ui-api.ts`). Copied from the web front end. */
export * from "./order-types";

export interface TallyNums {
  ordered: number;
  accepted: number | null;
  damaged: number | null;
  wrong: number | null;
  short: number | null;
}

export interface FundingNums {
  limit_cents: number;
  captured_cents: number;
  refunded_cents?: number;
  held_cents: number;
  inflight_cents?: number;
  expected?: { label: string; cents: number }[];
  spendable_cents: number;
}

export interface ApprovalRow {
  id: string;
  action: string;
  cents: number;
  po_id: string | null;
  po_number: string | null;
  supplier: string | null;
  safety_reasons: string[];
  reasons: string[];
  needs_passkey: boolean;
  created_at: string;
}

export interface OrderCardData {
  id: string;
  number: string;
  kind: string;
  status: string;
  buyer: string;
  history: boolean;
  late: boolean;
  needs_you: boolean;
  next: string | null;
  total_cents: number | null;
  limit_cents: number | null;
  deliver_by: string;
  note: string;
  lines: { sku: string; name: string; qty_packs: number; pack_label: string; tally: TallyNums }[];
  moving: boolean;
}

export interface HomeData {
  org: { name: string; side: "buyer" | "supplier"; paypal_connected: boolean; payer: string | null };
  can_create: boolean;
  can_connect: boolean;
  approvals: ApprovalRow[];
  orders: OrderCardData[];
}

export interface Person {
  id: string;
  name: string;
  first: string;
  role: string;
  org: string;
  side: "buyer" | "supplier";
  job: string;
  tag: string;
}

export interface Who {
  id: string;
  name: string;
  first: string;
  org: string;
  org_id: string;
  side: "buyer" | "supplier";
  role: "owner" | "receiving" | "supplier";
  owner: boolean;
}

export interface Session {
  who: Who | null;
  demo: boolean;
  paypal_env: string;
  paypal_ready: boolean;
  reader: string;
  channels: { telegram: boolean; push: boolean };
  paypal: { connected: boolean; payer: string | null } | null;
  counts: { needs: number; approvals: number };
}
