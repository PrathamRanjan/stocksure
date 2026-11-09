import { mkdirSync } from "node:fs";
import { config } from "./config.js";

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: "pglite" | "postgres";
}

async function openPglite(path: string | null): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (path) mkdirSync(path, { recursive: true });
  const pg = path ? new PGlite(path) : new PGlite();
  await pg.waitReady;
  // PGlite is single-connection: serialise transactions so concurrent requests don't interleave.
  let chain: Promise<unknown> = Promise.resolve();
  return {
    kind: "pglite",
    query: async (sql, params) => ({ rows: (await pg.query(sql, params as any[])).rows as any[] }),
    exec: async (sql) => {
      await pg.exec(sql);
    },
    tx: (fn) => {
      const run = chain.then(() => pg.transaction(async (t) => fn({ query: async (s, p) => ({ rows: (await t.query(s, p as any[])).rows as any[] }) })));
      chain = run.catch(() => undefined);
      return run as any;
    },
    close: async () => {
      await pg.close();
    },
  };
}

async function openPostgres(url: string): Promise<Db> {
  const pgmod = await import("pg");
  const Pool = (pgmod as any).default?.Pool ?? (pgmod as any).Pool;
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false }, max: 10 });
  return {
    kind: "postgres",
    query: async (sql, params) => ({ rows: (await pool.query(sql, params)).rows }),
    exec: async (sql) => {
      await pool.query(sql);
    },
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({ query: async (s: string, p?: unknown[]) => ({ rows: (await client.query(s, p)).rows }) });
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    close: async () => {
      await pool.end();
    },
  };
}
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('buyer','supplier')),
  name TEXT NOT NULL,
  vault_token_id TEXT,
  vault_payer TEXT,
  pending_setup_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','receiving','supplier')),
  key_hash TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES orgs(id),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  family TEXT NOT NULL DEFAULT '',
  base_unit TEXT NOT NULL CHECK (base_unit IN ('ea','g','ml')),
  pack_units INTEGER NOT NULL CHECK (pack_units > 0),
  pack_label TEXT NOT NULL,
  each_size INTEGER,
  each_size_unit TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock_packs INTEGER NOT NULL DEFAULT 0 CHECK (stock_packs >= 0),
  lead_hours INTEGER NOT NULL DEFAULT 24,
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  buyer_id TEXT NOT NULL REFERENCES orgs(id),
  supplier_id TEXT NOT NULL REFERENCES orgs(id),
  root_id TEXT NOT NULL,
  parent_id TEXT,
  parent_version INTEGER,
  kind TEXT NOT NULL DEFAULT 'original' CHECK (kind IN ('original','replacement')),
  status TEXT NOT NULL,
  deliver_by TIMESTAMPTZ NOT NULL,
  spend_limit_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  quote_version INTEGER NOT NULL DEFAULT 0,
  accepted_quote_version INTEGER,
  auth_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  exception TEXT,
  dispatched_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  agreed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_id, parent_version)
);
CREATE TABLE IF NOT EXISTS po_lines (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  line_no INTEGER NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  qty_packs INTEGER NOT NULL CHECK (qty_packs > 0),
  unit_price_cents INTEGER,
  substitutes JSONB NOT NULL DEFAULT '[]',
  replace_shortfall BOOLEAN NOT NULL DEFAULT true,
  replaces_line_id TEXT,
  UNIQUE (po_id, line_no)
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  kind TEXT NOT NULL CHECK (kind IN ('delivery_note','invoice','photo','evidence')),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  body BYTEA,
  text_content TEXT,
  flags JSONB NOT NULL DEFAULT '[]',
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS extractions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  source TEXT NOT NULL,
  lines JSONB NOT NULL,
  flags JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed','superseded')),
  confirmed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (po_id, version)
);
CREATE TABLE IF NOT EXISTS receipt_lines (
  receipt_id TEXT NOT NULL REFERENCES receipts(id),
  po_line_id TEXT NOT NULL REFERENCES po_lines(id),
  delivered_units INTEGER NOT NULL CHECK (delivered_units >= 0),
  accepted_units INTEGER NOT NULL CHECK (accepted_units >= 0),
  damaged_units INTEGER NOT NULL CHECK (damaged_units >= 0),
  wrong_units INTEGER NOT NULL CHECK (wrong_units >= 0),
  note TEXT NOT NULL DEFAULT '',
  evidence JSONB NOT NULL DEFAULT '[]',
  proposal JSONB,
  supplier_status TEXT NOT NULL DEFAULT 'pending' CHECK (supplier_status IN ('pending','agreed','disputed')),
  supplier_note TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT,
  PRIMARY KEY (receipt_id, po_line_id),
  CHECK (delivered_units = accepted_units + damaged_units + wrong_units)
);
CREATE TABLE IF NOT EXISTS invoice_lines (
  document_id TEXT NOT NULL REFERENCES documents(id),
  idx INTEGER NOT NULL,
  po_line_id TEXT,
  description TEXT NOT NULL,
  billed_units INTEGER,
  unit_price_cents INTEGER,
  line_cents INTEGER,
  PRIMARY KEY (document_id, idx)
);
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  po_line_id TEXT,
  author TEXT NOT NULL,
  author_role TEXT NOT NULL,
  body TEXT NOT NULL,
  document_id TEXT,
  kind TEXT NOT NULL DEFAULT 'message',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS resolutions (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed','agreed','superseded','settled')),
  body JSONB NOT NULL,
  hash TEXT NOT NULL,
  buyer_approved_by TEXT,
  buyer_approved_hash TEXT,
  buyer_approved_at TIMESTAMPTZ,
  supplier_approved_by TEXT,
  supplier_approved_hash TEXT,
  supplier_approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (po_id, version)
);
CREATE TABLE IF NOT EXISTS payment_ops (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  root_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('authorize','capture','void','refund')),
  status TEXT NOT NULL CHECK (status IN ('planned','pending','succeeded','failed')),
  amount_cents INTEGER NOT NULL,
  final_capture BOOLEAN NOT NULL DEFAULT false,
  request_id TEXT NOT NULL UNIQUE,
  paypal_order_id TEXT,
  paypal_id TEXT,
  parent_paypal_id TEXT,
  paypal_status TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS saga_steps (
  po_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  step TEXT NOT NULL,
  result JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (po_id, version, step)
);
CREATE TABLE IF NOT EXISTS stock (
  buyer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (buyer_id, product_id)
);
CREATE TABLE IF NOT EXISTS stock_holds (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  packs INTEGER NOT NULL CHECK (packs > 0),
  for_po TEXT NOT NULL,
  source_po TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','shipped','released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS defect_claims (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  po_line_id TEXT NOT NULL REFERENCES po_lines(id),
  units INTEGER NOT NULL CHECK (units > 0),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  note TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reported','disputed','refunding','refunded','failed')),
  reported_by TEXT NOT NULL,
  decided_by TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  capture_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stock_moves (
  id BIGSERIAL PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  po_id TEXT,
  source_key TEXT NOT NULL UNIQUE,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  po_id TEXT,
  root_id TEXT,
  type TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  data JSONB,
  actor TEXT NOT NULL DEFAULT 'system',
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_root ON events(root_id, id DESC);
CREATE TABLE IF NOT EXISTS demo_faults (
  id BIGSERIAL PRIMARY KEY,
  method TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  resource_id TEXT,
  body JSONB NOT NULL,
  verified BOOLEAN NOT NULL,
  processed_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  payload JSONB NOT NULL DEFAULT '{}',
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, run_at);
CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('part','rest')),
  packs JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('dispatched','charging','charged')),
  receipt_version INTEGER,
  accepted_cents INTEGER,
  dispatched_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (po_id, seq)
);
CREATE TABLE IF NOT EXISTS eta_updates (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  eta TIMESTAMPTZ NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('supplier','carrier')),
  ref TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  applied BOOLEAN NOT NULL,
  ignored_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (po_id, ref)
);
CREATE TABLE IF NOT EXISTS po_risks (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  kind TEXT NOT NULL CHECK (kind IN ('late')),
  status TEXT NOT NULL CHECK (status IN ('open','waiting','expedite_asked','closed')),
  eta TIMESTAMPTZ NOT NULL,
  deliver_by TIMESTAMPTZ NOT NULL,
  slack_minutes INTEGER NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]',
  decision TEXT,
  decided_by TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  closed_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
-- Roadmap B foundation: provider audit, agent trace, guard, channels, eval, judge mode.
CREATE TABLE IF NOT EXISTS ai_calls (
  id BIGSERIAL PRIMARY KEY,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  via TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_hash TEXT NOT NULL DEFAULT '',
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ok BOOLEAN NOT NULL,
  error TEXT,
  output JSONB,
  run_id TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_calls_hash ON ai_calls(input_hash, id DESC);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  agent_id TEXT,
  subject TEXT NOT NULL DEFAULT '',
  entity TEXT,
  entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS agent_trace (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  step INTEGER NOT NULL,
  actor TEXT NOT NULL,
  tool TEXT NOT NULL,
  args JSONB,
  policy TEXT,
  gate TEXT,
  result JSONB,
  pp_request_id TEXT,
  pp_debug_id TEXT,
  duration_ms INTEGER,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_trace_run ON agent_trace(run_id, step);
CREATE TABLE IF NOT EXISTS audit_chain (
  seq BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  text TEXT NOT NULL,
  rules JSONB NOT NULL,
  unexpressed JSONB NOT NULL DEFAULT '[]',
  compiler TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kill_switches (
  scope TEXT PRIMARY KEY,
  engaged BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','expired')),
  method TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provenance (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  trust TEXT NOT NULL CHECK (trust IN ('system','paypal','owner','agent','document','message','web')),
  text TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS channel_messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  address TEXT NOT NULL,
  body TEXT NOT NULL,
  buttons JSONB,
  entity TEXT,
  entity_id TEXT,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS channel_links (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  address TEXT NOT NULL,
  party TEXT NOT NULL,
  party_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, address)
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  party TEXT NOT NULL,
  party_id TEXT NOT NULL,
  subscription JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS judge_sessions (
  id TEXT PRIMARY KEY,
  persona TEXT NOT NULL,
  beat INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  suite TEXT NOT NULL,
  arm TEXT NOT NULL,
  case_id TEXT NOT NULL,
  expected TEXT NOT NULL,
  actual TEXT NOT NULL,
  correct BOOLEAN NOT NULL,
  trap BOOLEAN NOT NULL DEFAULT false,
  naive_paid_cents INTEGER NOT NULL DEFAULT 0,
  ours_paid_cents INTEGER NOT NULL DEFAULT 0,
  cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  detail JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eval_runs_suite ON eval_runs(suite, arm);
-- Agent requests over MCP and the merchant API: idempotency and audit.
CREATE TABLE IF NOT EXISTS agent_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  args JSONB,
  idempotency_key TEXT,
  ok BOOLEAN,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, tool, idempotency_key)
);
-- S5: hashed two-party agreement on an accepted quote (lines, prices, deadline, total), HMAC-signed by the server.
CREATE TABLE IF NOT EXISTS agreements (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  quote_version INTEGER NOT NULL,
  body JSONB NOT NULL,
  hash TEXT NOT NULL,
  hmac TEXT NOT NULL,
  buyer_signed_by TEXT,
  buyer_signed_at TIMESTAMPTZ,
  supplier_signed_by TEXT,
  supplier_signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (po_id, quote_version)
);
-- S4: negotiation between a buyer agent (under its mandate) and a supplier agent (under its floor), guarded by code.
CREATE TABLE IF NOT EXISTS negotiations (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  status TEXT NOT NULL CHECK (status IN ('open','agreed','walked_away','held','failed')),
  round INTEGER NOT NULL DEFAULT 0,
  max_rounds INTEGER NOT NULL DEFAULT 6,
  buyer_agent TEXT NOT NULL,
  supplier_agent TEXT NOT NULL,
  outcome JSONB,
  run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS negotiation_rounds (
  id BIGSERIAL PRIMARY KEY,
  negotiation_id TEXT NOT NULL REFERENCES negotiations(id),
  round INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buyer','supplier')),
  proposal JSONB NOT NULL,
  guard JSONB NOT NULL,
  accepted BOOLEAN NOT NULL DEFAULT false,
  wording TEXT NOT NULL DEFAULT '',
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- S2: carts from the merchant endpoint (Cart-API style) before they become purchase orders.
CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL REFERENCES orgs(id),
  supplier_id TEXT NOT NULL REFERENCES orgs(id),
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','quoted','checked_out','abandoned')),
  items JSONB NOT NULL DEFAULT '[]',
  quote JSONB,
  po_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- S7: PayPal depth on orders and ops.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS reauthorized_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS dispute_id TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS paypal_invoice_id TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS negotiation_id TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS created_by_agent TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tracking_number TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS carrier TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tracked_at TIMESTAMPTZ;
ALTER TABLE payment_ops DROP CONSTRAINT IF EXISTS payment_ops_kind_check;
ALTER TABLE payment_ops ADD CONSTRAINT payment_ops_kind_check CHECK (kind IN ('authorize','capture','void','refund','reauthorize','payout'));
ALTER TABLE people ADD COLUMN IF NOT EXISTS mcp_key_hash TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS driver_token TEXT;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS floor_pct INTEGER NOT NULL DEFAULT 90;
ALTER TABLE products ADD COLUMN IF NOT EXISTS reservation_cents INTEGER;
`;

let shared: Db | null = null;

export async function openDb(opts: { memory?: boolean } = {}): Promise<Db> {
  const db = opts.memory ? await openPglite(null) : config.databaseUrl ? await openPostgres(config.databaseUrl) : await openPglite(config.pglitePath);
  await db.exec(SCHEMA);
  return db;
}

export async function getDb(): Promise<Db> {
  if (!shared) shared = await openDb();
  return shared;
}

export function setDb(db: Db) {
  shared = db;
}
