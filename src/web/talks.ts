/**
 * Spec B4 S5 and item 3: the negotiations views for the React shell. Lists both kinds (quote negotiations and
 * shortfalls settled by agents), shows every move with the referee's verdict, and starts the agents on a shortfall.
 */
import { Router, type Request, type Response } from "express";
import { getDb } from "../db.js";
import { hasOpenAI } from "../ai/provider.js";
import { fmt } from "../core/money.js";
import { GtError } from "../lib/util.js";
import { BUYER_MANDATE, MAX_ROUNDS, SUPPLIER_FLOOR, runShortfallTalk, startShortfallTalk } from "../agents/shortfall.js";
import { getPo, latestResolution, type Person } from "../store.js";
import { me } from "./auth.js";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) =>
  fn(req, res)
    .then((out) => {
      if (!res.headersSent) res.setHeader("Cache-Control", "no-store").json(out);
    })
    .catch((e) => {
      const g = e instanceof GtError ? e : null;
      if (!g) console.error("[stocksure talks]", e);
      if (!res.headersSent) res.status(g?.status ?? 500).json({ error: g?.code ?? "error", message: g?.message ?? "Something went wrong." });
    });

async function need(req: Request): Promise<Person> {
  const p = await me(req);
  if (!p) throw new GtError("Sign in first.", "unauthorized", 401);
  return p;
}

const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

/** One negotiation as the page shows it. Both sides' limits are shown in this demo so a judge can check the referee. */
export async function talkView(id: string, p: Person) {
  const db = await getDb();
  const n = (await db.query<any>("SELECT * FROM negotiations WHERE id = $1", [id])).rows[0];
  if (!n) throw new GtError("Negotiation not found", "not_found", 404);
  const po = await getPo(db, n.po_id);
  if (po.buyer_id !== p.org_id && po.supplier_id !== p.org_id) throw new GtError("Negotiation not found", "not_found", 404);
  const moves = (await db.query<any>("SELECT round, side, proposal, guard, accepted, wording, at FROM negotiation_rounds WHERE negotiation_id = $1 ORDER BY id", [id])).rows.map((m) => {
    const prop = parse(m.proposal) ?? {};
    const guard = parse(m.guard) ?? {};
    return {
      round: m.round,
      side: m.side,
      action: prop.action ?? "offer",
      lines: prop.lines ?? [],
      price_pct: prop.price_pct ?? null,
      cost: typeof prop.cost_cents === "number" ? fmt(prop.cost_cents) : null,
      model: prop.model ?? null,
      allowed: !!guard.ok,
      reasons: guard.reasons ?? [],
      attempt: guard.attempt ?? 1,
      message: m.wording,
      at: m.at,
    };
  });
  const subject = parse(n.subject);
  return {
    id: n.id,
    kind: n.kind ?? "quote",
    status: n.status,
    round: n.round,
    max_rounds: n.max_rounds,
    po: { id: po.id, number: po.number, status: po.status, buyer: po.buyer_name, supplier: po.supplier_name },
    agents: { buyer: n.buyer_agent, supplier: n.supplier_agent },
    subject: subject
      ? {
          resolution_version: subject.resolution_version,
          limit: fmt(subject.limit_cents),
          already_committed: fmt(subject.base_cents),
          needed_by: subject.needed_by,
          lines: (subject.lines ?? []).map((l: any) => ({ line_id: l.line_id, sku: l.sku, name: l.name, short_units: l.short_units, replaceable: l.replaceable, replacement_at_quote: fmt(l.replacement_cents), unit_price: fmt(l.unit_price_cents) })),
          mandate: subject.mandate,
          floor: subject.floor,
        }
      : null,
    outcome: parse(n.outcome),
    run_id: n.run_id,
    moves,
    created_at: n.created_at,
    updated_at: n.updated_at,
  };
}

export function talksRouter() {
  const r = Router();

  r.get("/api/ui/negotiations", wrap(async (req) => {
    const p = await need(req);
    const db = await getDb();
    const col = p.org_kind === "buyer" ? "buyer_id" : "supplier_id";
    const rows = (await db.query<any>(`SELECT n.id, n.kind, n.status, n.round, n.max_rounds, n.outcome, n.created_at, po.id AS po_id, po.number FROM negotiations n JOIN purchase_orders po ON po.id = n.po_id WHERE po.${col} = $1 ORDER BY n.created_at DESC LIMIT 50`, [p.org_id])).rows;
    const open = p.org_kind === "buyer" && p.role === "owner" ? (await db.query<any>("SELECT id, number FROM purchase_orders WHERE buyer_id = $1 AND status = 'resolving' ORDER BY created_at", [p.org_id])).rows : [];
    return {
      negotiations: rows.map((x) => ({ id: x.id, kind: x.kind ?? "quote", status: x.status, round: x.round, max_rounds: x.max_rounds, po: { id: x.po_id, number: x.number }, outcome: parse(x.outcome), created_at: x.created_at })),
      can_start: open,
      ready: hasOpenAI(),
      rules: { mandate: BUYER_MANDATE, floor: SUPPLIER_FLOOR, max_rounds: MAX_ROUNDS },
    };
  }));

  r.get("/api/ui/negotiations/:id", wrap(async (req) => talkView(String(req.params.id), await need(req))));

  /** The latest shortfall negotiation on an order (for the order page's agents panel). */
  r.get("/api/ui/po/:id/agents", wrap(async (req) => {
    const p = await need(req);
    const db = await getDb();
    const po = await getPo(db, String(req.params.id));
    if (po.buyer_id !== p.org_id && po.supplier_id !== p.org_id) throw new GtError("Order not found", "not_found", 404);
    const n = (await db.query<{ id: string }>("SELECT id FROM negotiations WHERE po_id = $1 AND kind = 'shortfall' ORDER BY created_at DESC LIMIT 1", [po.id])).rows[0];
    const cur = await latestResolution(db, po.id);
    return {
      can_start: p.org_kind === "buyer" && p.role === "owner" && po.status === "resolving" && cur?.status === "proposed" && !cur.body?.negotiated && hasOpenAI(),
      ready: hasOpenAI(),
      rules: { mandate: BUYER_MANDATE, floor: SUPPLIER_FLOOR, max_rounds: MAX_ROUNDS },
      latest: n ? await talkView(n.id, p) : null,
    };
  }));

  r.post("/api/ui/po/:id/agents", wrap(async (req) => {
    const p = await need(req);
    if (!hasOpenAI()) throw new GtError("The AI isn't configured on this server, so the agents can't run.", "no_model", 503);
    const id = await startShortfallTalk(p, String(req.params.id));
    // The rounds continue after this response, inside this request's workspace (AsyncLocalStorage carries it).
    void runShortfallTalk(id).catch((e) => console.error("[stocksure shortfall]", (e as Error).message));
    return { ok: true, id };
  }));

  return r;
}
