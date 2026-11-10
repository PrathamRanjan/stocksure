/**
 * JSON view models for the React front end (web/). Read-only: every state change still goes through the existing
 * POST routes, which answer JSON when the request carries `X-StockSure-UI: 1` (see uiJsonMode in app.ts).
 * Nothing here computes money: amounts come from the same services and stored resolutions the server pages used.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { config } from "../config.js";
import { currentWs, getDb, withWorkspace, type Queryable } from "../db.js";
import { inShowcase, showcase } from "../demo/workspaces.js";
import { hasOpenAI, offlineRules } from "../ai/provider.js";
import { formatUnits } from "../core/units.js";
import { fmt } from "../core/money.js";
import { GtError } from "../lib/util.js";
import { FAULTABLE } from "../paypal/index.js";
import { countersignThreshold } from "../guard/dryrun.js";
import { quoteTotal } from "../services/orders.js";
import { lineFingerprint, proposalFor } from "../services/receiving.js";
import { claimsOf } from "../services/aftercare.js";
import { etaUpdates, riskView, riskyPos } from "../services/supply-watch.js";
import { deliveryContext, partCharged, shipmentsOf } from "../services/parts.js";
import { agreementFor, verifyAgreement } from "../services/agreements.js";
import { supplierPerformance } from "../services/records.js";
import { demoIds } from "../services/seed.js";
import { negotiationsFor } from "../agents/runtime.js";
import { runsFor } from "../trace.js";
import { scanText } from "../safety/rules.js";
import { catalog, docsOf, fundingOf, getPo, latestReceipt, latestResolution, linesOf, opsOfRoot, orgById, poFor, treeOf, type Person, type PO, type PoLine, type Product } from "../store.js";
import { me } from "./auth.js";

type H = (req: Request, res: Response, p: Person | null) => Promise<unknown>;
const J = (fn: H, needAuth = true) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const p = await me(req);
    if (needAuth && !p) return res.status(401).json({ error: "unauthorized", message: "Sign in first." });
    res.setHeader("Cache-Control", "no-store");
    const out = await fn(req, res, p);
    if (!res.headersSent) res.json(out);
  } catch (e) {
    if (e instanceof GtError) return res.status(e.status).json({ error: e.code, message: e.message });
    next(e);
  }
};

const u = (n: number | null | undefined, spec: Pick<Product, "pack_units" | "pack_label" | "base_unit"> & Partial<Product>) => (n === null || n === undefined ? null : formatUnits(n, spec as any));
const product = (p: Product) => ({ id: p.id, sku: p.sku, name: p.name, family: p.family, pack_label: p.pack_label, pack_units: p.pack_units, base_unit: p.base_unit, price_cents: p.price_cents, stock_packs: p.stock_packs, lead_hours: p.lead_hours });

export const BLURB: Record<string, { job: string; tag: string }> = {
  Jordan: { job: "Orders stock inside a spending limit, sees what actually arrived, approves the corrected PayPal charge.", tag: "Café owner" },
  Sam: { job: "Counts the delivery at the back door: the docket, photos, what's short or damaged. No access to money.", tag: "Receiving" },
  Ana: { job: "The wholesaler: confirms quotes, agrees or disputes each line the café reports, ships replacements.", tag: "Supplier" },
  Priya: { job: "A bakery on the same supplier, with its own orders, history and limits.", tag: "Bakery owner" },
  Lee: { job: "Receives at the bakery.", tag: "Receiving" },
  Marco: { job: "A deli with a draft order for cups and beans.", tag: "Deli owner" },
  Tess: { job: "Receives at the deli.", tag: "Receiving" },
};

export function whoJson(p: Person | null) {
  return p ? { id: p.id, name: p.name, first: p.name.split(" ")[0], org: p.org_name ?? "", org_id: p.org_id, side: (p.org_kind ?? "buyer") as "buyer" | "supplier", role: p.role, owner: p.org_kind === "buyer" && p.role === "owner" } : null;
}

const NEXT_SUPPLIER: Record<string, string> = { submitted: "Confirm the quote", funded: "Dispatch the order", part_delivered: "Send the rest", in_review: "Agree or dispute what arrived", resolving: "Approve the fix", exception: "Needs a look" };
const NEXT_BUYER: Record<string, string> = { draft: "Finish and send for a quote", quoted: "Accept the quote (places a PayPal hold)", dispatched: "Count it in", in_review: "Waiting on the supplier to agree", resolving: "Approve the fix", exception: "Needs a look" };
const NEED_SUPPLIER = ["submitted", "funded", "part_delivered", "in_review", "resolving", "exception"];
const NEED_BUYER = ["draft", "quoted", "dispatched", "in_review", "resolving", "exception"];

/** Per-line tally numbers in whole packs (for the tally strip) plus the exact unit texts. */
function tally(l: PoLine, r: { delivered_units: number; accepted_units: number; damaged_units: number; wrong_units: number } | null) {
  const pu = l.product.pack_units;
  const ordered = l.qty_packs;
  if (!r) return { ordered, accepted: null, damaged: null, wrong: null, short: null };
  const acc = r.accepted_units / pu;
  const dmg = r.damaged_units / pu;
  const wr = r.wrong_units / pu;
  const short = Math.max(0, ordered * pu - r.delivered_units) / pu;
  return { ordered, accepted: acc, damaged: dmg, wrong: wr, short };
}

async function approvalsFor(q: Queryable, p: Person, poId: string | null) {
  if (!(p.org_kind === "buyer" && p.role === "owner")) return [];
  const rows = (await q.query<any>(`SELECT a.*, po.number AS po_number, po.id AS po_id_ref, s.name AS supplier_name FROM approvals a LEFT JOIN purchase_orders po ON po.id = a.payload->>'entity_id' LEFT JOIN orgs s ON s.id = po.supplier_id WHERE a.owner_id = $1 AND a.status = 'pending' ${poId ? "AND a.payload->>'entity_id' = $2" : ""} ORDER BY a.created_at`, poId ? [p.org_id, poId] : [p.org_id])).rows;
  return rows.map((a) => {
    const pl = typeof a.payload === "string" ? JSON.parse(a.payload) : a.payload;
    const cents = Number(pl.cents);
    return {
      id: a.id,
      action: a.action as string,
      cents,
      po_id: pl.entity === "po" ? pl.entity_id : null,
      po_number: a.po_number ?? null,
      supplier: a.supplier_name ?? null,
      safety_reasons: (pl.safety_reasons ?? []) as string[],
      reasons: pl.safety_reasons?.length ? pl.safety_reasons : [`This ${a.action} is above the amount StockSure may move without you.`],
      needs_passkey: cents > countersignThreshold(),
      created_at: a.created_at,
    };
  });
}

async function poModel(q: Queryable, po: PO, p: Person) {
  const lines = await linesOf(q, po.id);
  const buyer = p.org_kind === "buyer";
  const owner = buyer && p.role === "owner";
  const supplier = p.org_kind === "supplier";
  const total = quoteTotal(lines);
  const rec = await latestReceipt(q, po.id);
  const byLine = new Map((rec?.lines ?? []).map((l) => [l.po_line_id, l]));
  const skus = new Map((await q.query<{ id: string; sku: string }>("SELECT id, sku FROM products WHERE supplier_id = $1", [po.supplier_id])).rows.map((x) => [x.id, x.sku]));
  const msgs = (await q.query<any>("SELECT * FROM messages WHERE po_id = $1 ORDER BY id", [po.id])).rows;
  const org = buyer ? await orgById(q, po.buyer_id) : null;
  const ctx = await deliveryContext(q, po, lines);
  const shipments = await shipmentsOf(q, po.id);
  const part = shipments.find((x) => x.kind === "part") ?? null;

  const lineOut = lines.map((l) => {
    const r = byLine.get(l.id) ?? null;
    return {
      id: l.id,
      line_no: l.line_no,
      product: product(l.product),
      qty_packs: l.qty_packs,
      ordered_text: u(l.qty_packs * l.product.pack_units, l.product),
      unit_price_cents: l.unit_price_cents,
      quoted_cents: l.unit_price_cents === null ? null : l.qty_packs * l.unit_price_cents,
      substitutes: l.substitutes.map((s) => skus.get(s) ?? s),
      replace_shortfall: l.replace_shortfall,
      tally: tally(l, r),
      receipt: r
        ? {
            delivered: u(r.delivered_units, l.product),
            accepted: u(r.accepted_units, l.product),
            damaged: u(r.damaged_units, l.product),
            wrong: u(r.wrong_units, l.product),
            note: r.note,
            supplier_status: r.supplier_status,
            supplier_note: r.supplier_note,
            fingerprint: lineFingerprint(rec!.receipt.version, r),
          }
        : null,
      can_review: supplier && po.status === "in_review" && !!r && r.supplier_status !== "agreed",
      rest_packs: part ? l.qty_packs - (part.packs[l.id] ?? 0) : null,
    };
  });

  // Resolution
  const res = await latestResolution(q, po.id);
  let resolution: any = null;
  if (res) {
    const b = res.body;
    const L = new Map(lines.map((l) => [l.id, l]));
    const open = res.status === "proposed" && po.status === "resolving";
    const mySide = buyer ? res.buyer_approved_hash : res.supplier_approved_hash;
    resolution = {
      version: res.version,
      status: res.status,
      hash: res.hash,
      auto: !!b.auto,
      receipt_version: b.receipt_version,
      quote_version: b.quote_version,
      lines: b.lines.map((x: any) => {
        const l = L.get(x.line_id);
        return { ...x, ordered_text: l ? u(x.ordered, l.product) : String(x.ordered), paid_text: l ? u(x.paid_units, l.product) : String(x.paid_units), short_text: l ? u(x.shortfall, l.product) : String(x.shortfall), pack_units: l?.product.pack_units ?? 1 };
      }),
      flags: b.flags ?? [],
      needed_by: b.needed_by,
      plan: b.plan,
      totals: b.totals,
      funding: b.funding,
      buyer_approved_by: res.buyer_approved_by,
      supplier_approved_by: res.supplier_approved_by,
      open,
      i_approved: open && mySide === res.hash,
      can_approve: open && (supplier || owner) && mySide !== res.hash,
      can_revise: open && owner,
      part_charged_cents: await partCharged(q, po.id),
    };
  }

  // Agents, agreement, trace
  const [agreement, negs, runs] = await Promise.all([agreementFor(po.id, q), negotiationsFor(po.id), runsFor("po", po.id, 8)]);
  const v = agreement ? verifyAgreement(agreement) : null;

  // Supply watch
  const updates = await etaUpdates(q, po.id);
  const view = await riskView(q, po);
  const watched = ["funded", "dispatched"].includes(po.status);
  const supply =
    updates.length || watched
      ? {
          can_record: supplier && watched,
          updates,
          risk: view
            ? {
                ...view.risk,
                on_hand: view.onHand.map((x) => ({ line_no: x.line.line_no, sku: x.line.product.sku, ordered: x.ordered, on_hand: x.on_hand, alternatives: x.alternatives })),
                evidence: view.evidence,
                unknowns: view.unknowns,
                can_decide: owner && view.risk.status === "open",
              }
            : null,
        }
      : null;

  // After delivery
  const cap = (await q.query<any>("SELECT paypal_id FROM payment_ops WHERE po_id = $1 AND kind = 'capture' AND status = 'succeeded' LIMIT 1", [po.id])).rows[0];
  const claims = await claimsOf(q, po.id);
  const defects = cap || claims.length ? { can_report: buyer && !!cap, can_decide: supplier, claims } : null;

  const docs = (await docsOf(q, po.id)).map((d) => ({ id: d.id, kind: d.kind, filename: d.filename, size: d.size, sha256: d.sha256, uploaded_by: d.uploaded_by, created_at: d.created_at, flags: d.flags }));
  const ops = (await opsOfRoot(q, po.root_id)).map((o) => ({ id: o.id, po_number: o.po_number, kind: o.kind, status: o.status, paypal_status: o.paypal_status, amount_cents: o.amount_cents, final_capture: o.final_capture, paypal_id: o.paypal_id, request_id: o.request_id, attempts: o.attempts, error: o.error, created_at: o.created_at, updated_at: o.updated_at }));
  const events = (await q.query<any>("SELECT id, at, type, summary, actor FROM events WHERE root_id = $1 ORDER BY id DESC LIMIT 80", [po.root_id])).rows;
  const tree = (await treeOf(q, po.root_id)).map((t) => ({ id: t.id, number: t.number, status: t.status, kind: t.kind, parent_id: t.parent_id }));
  const children = tree.filter((t) => t.parent_id === po.id);
  const hasMoney = lines.some((l) => l.unit_price_cents !== null) || !!po.auth_id;

  return {
    po: { id: po.id, number: po.number, status: po.status, kind: po.kind, root_id: po.root_id, buyer_name: po.buyer_name, supplier_name: po.supplier_name, deliver_by: po.deliver_by, limit_cents: po.spend_limit_cents, note: po.note, exception: po.exception, quote_version: po.quote_version, dispatched_at: po.dispatched_at, closed_at: po.closed_at, created_at: po.created_at, history: po.note.startsWith("Imported") },
    me: { side: buyer ? "buyer" : "supplier", role: p.role, owner },
    tree,
    children,
    lines: lineOut,
    receipt: rec ? { version: rec.receipt.version, confirmed_by: rec.receipt.confirmed_by, created_at: rec.receipt.created_at } : null,
    disputed: !!rec?.lines.some((l) => l.supplier_status === "disputed"),
    quote_total_cents: total,
    over_limit: total > po.spend_limit_cents,
    paypal: buyer ? { connected: !!org?.vault_token_id, payer: org?.vault_payer ?? null } : null,
    delivery: { mode: ctx.mode, part: part ? { accepted_cents: part.accepted_cents, status: part.status, packs: part.packs } : null },
    funding: hasMoney ? await fundingOf(q, po.root_id) : null,
    approvals: await approvalsFor(q, p, po.id),
    resolution,
    agent: {
      agreement: agreement ? { hash: agreement.hash, ok: !!(v?.hash_ok && v?.hmac_ok), quote_version: agreement.quote_version, buyer_signed_at: agreement.buyer_signed_at, buyer_signed_by: agreement.buyer_signed_by, supplier_signed_at: agreement.supplier_signed_at } : null,
      negotiations: negs.map((n: any) => ({ id: n.id, status: n.status, round: n.round, max_rounds: n.max_rounds, buyer_agent: n.buyer_agent, supplier_agent: n.supplier_agent })),
      runs: runs.map((x: any) => ({ id: x.id, subject: x.subject, actor: x.actor, agent_id: x.agent_id, status: x.status, started_at: x.started_at })),
      can_negotiate: owner && ["submitted", "quoted"].includes(po.status) && !negs.some((n: any) => n.status === "open"),
    },
    supply,
    defects,
    docs,
    ops,
    messages: msgs.map((m) => {
      const s = scanText(m.body);
      return { id: m.id, line_id: m.po_line_id ?? null, author: m.author, role: m.author_role, kind: m.kind, body: m.body, document_id: m.document_id, created_at: m.created_at, scan: s.level === "clear" ? null : { level: s.level, words: s.words } };
    }),
    can_post: po.status !== "closed",
    // A replacement that stopped fitting (stock or price moved) is re-planned by the owner; the accepted goods stay charged.
    can_replan: owner && po.status === "exception" && /replacement no longer works/.test(po.exception ?? ""),
    // S3: rows written before every amount was formatted said "2400 cents"; show those as currency too.
    events: events.map((e: any) => ({ ...e, summary: String(e.summary ?? "").replace(/\b(\d+) cents\b/g, (_m: string, n: string) => fmt(Number(n))) })),
    demo: { samples: config.demoMode },
    copy: { next: (supplier ? NEXT_SUPPLIER : NEXT_BUYER)[po.status] ?? null },
  };
}

async function receiveModel(q: Queryable, po: PO) {
  const lines = await linesOf(q, po.id);
  const prop = await proposalFor(q, po);
  const prev = await latestReceipt(q, po.id);
  const prevBy = new Map((prev?.lines ?? []).map((l) => [l.po_line_id, l]));
  const exs = (await q.query<any>("SELECT e.*, d.filename, d.kind FROM extractions e JOIN documents d ON d.id = e.document_id WHERE d.po_id = $1 AND d.kind IN ('delivery_note','photo') ORDER BY e.created_at DESC", [po.id])).rows.map((e) => ({ ...e, lines: typeof e.lines === "string" ? JSON.parse(e.lines) : e.lines, flags: typeof e.flags === "string" ? JSON.parse(e.flags) : e.flags }));
  const ctx = await deliveryContext(q, po, lines);
  const partVersion = ctx.part?.receipt_version ?? null;
  if (ctx.mode === "rest") {
    if (!prev || prev.receipt.version === partVersion) prevBy.clear();
    else
      for (const [k, o] of prevBy) {
        const b = ctx.base.get(k);
        if (b) prevBy.set(k, { ...o, delivered_units: o.delivered_units - b.delivered, damaged_units: o.damaged_units - b.damaged, wrong_units: o.wrong_units - b.wrong, accepted_units: o.accepted_units - b.accepted });
      }
  }
  const val = (n: number | null | undefined, l: PoLine) => (n === null || n === undefined ? "" : formatUnits(n, l.product).replace(/ cases?$/, " cs").replace(/ \+ /g, " + "));
  return {
    po: { id: po.id, number: po.number, status: po.status, supplier_name: po.supplier_name, buyer_name: po.buyer_name, deliver_by: po.deliver_by },
    open: po.status === "dispatched" || po.status === "in_review",
    mode: ctx.mode,
    demo: { samples: config.demoMode },
    reader: hasOpenAI() ? `OpenAI ${config.ai.models.read}` : offlineRules() ? "text parser (offline test mode)" : "no model configured",
    lines: lines.map((l) => {
      const p = prop.lines.get(l.id)!;
      const o = prevBy.get(l.id);
      const expected = ctx.expected.get(l.id) ?? l.qty_packs * l.product.pack_units;
      return {
        id: l.id,
        line_no: l.line_no,
        product: product(l.product),
        expected_units: expected,
        expected_text: u(expected, l.product),
        expected_packs: expected / l.product.pack_units,
        part1_accepted: ctx.mode === "rest" && ctx.base.get(l.id) ? u(ctx.base.get(l.id)!.accepted, l.product) : null,
        proposal: {
          delivered: p.delivered,
          delivered_text: u(p.delivered, l.product),
          damaged_text: p.damaged ? u(p.damaged, l.product) : null,
          confidence: p.confidence,
          flags: p.flags,
          hints: p.hints,
          source: p.source,
        },
        disputed: o?.supplier_status === "disputed" ? o.supplier_note : null,
        prefill: {
          delivered: val(o ? o.delivered_units : p.delivered, l),
          damaged: (o ? o.damaged_units : p.damaged) ? val(o ? o.damaged_units : p.damaged, l) : "0",
          wrong: (o ? o.wrong_units : p.wrong) ? val(o ? o.wrong_units : p.wrong, l) : "0",
          note: o?.note ?? "",
        },
        unsure: p.flags.length > 0,
        damage_flag: p.flags.includes("possible_damage"),
      };
    }),
    extractions: exs.map((e) => ({ id: e.id, filename: e.filename, kind: e.kind, source: e.source, created_at: e.created_at, flags: e.flags, lines: e.lines?.lines ?? [], damage: e.lines?.damage ?? [], notes: e.lines?.notes ?? [] })),
  };
}

/**
 * Where an anonymous read comes from. Inside a workspace: that workspace. Outside one, in production: the read-only
 * showcase (or nothing, if it is not built yet). Outside one locally: the base data, as before.
 */
async function anonScope<T>(fn: () => Promise<T>, none: T): Promise<T> {
  if (currentWs() || config.demo.baseSignIn) return fn();
  const s = await showcase();
  return s ? withWorkspace(s.id, fn) : none;
}

/**
 * Spec S1: the one definition of "needs you", used by the home page, its empty state and the nav badge alike.
 * An order needs you when its state waits on your side, it is late, or (for the owner) a payment on it waits for
 * your approval. Approvals not tied to an order are counted on their own.
 */
async function needsYou(db: Queryable, p: Person): Promise<{ poIds: Set<string>; approvals: Awaited<ReturnType<typeof approvalsFor>>; count: number }> {
  const col = p.org_kind === "buyer" ? "buyer_id" : "supplier_id";
  const states = p.org_kind === "supplier" ? NEED_SUPPLIER : NEED_BUYER;
  const rows = (await db.query<{ id: string }>(`SELECT id FROM purchase_orders WHERE ${col} = $1 AND status = ANY($2) AND NOT is_sample`, [p.org_id, states])).rows;
  const poIds = new Set(rows.map((r) => r.id));
  for (const id of await riskyPos(db, p.org_id)) poIds.add(id);
  const approvals = await approvalsFor(db, p, null);
  let loose = 0;
  for (const a of approvals) {
    if (a.po_id) poIds.add(a.po_id);
    else loose++;
  }
  return { poIds, approvals, count: poIds.size + loose };
}

export function uiRouter() {
  const r = Router();

  r.get(
    "/api/ui/session",
    J(async (_req, _res, p) => {
      const db = await getDb();
      let paypal: { connected: boolean; payer: string | null; demo_wallet: boolean } | null = null;
      let needs = 0;
      let approvals = 0;
      if (p) {
        const org = await orgById(db, p.org_id);
        if (p.org_kind === "buyer") paypal = { connected: !!org?.vault_token_id, payer: org?.vault_payer ?? null, demo_wallet: (org as any)?.vault_source === "demo_wallet" };
        const n = await needsYou(db, p);
        needs = n.count;
        approvals = n.approvals.length;
      }
      return {
        who: whoJson(p),
        demo: config.demoMode,
        workspace: currentWs() ? { id: currentWs(), showcase: await inShowcase() } : null,
        paypal_env: config.paypal.env,
        paypal_ready: !!(config.paypal.clientId && config.paypal.clientSecret),
        reader: hasOpenAI() ? `OpenAI ${config.ai.models.read}` : offlineRules() ? "text parser (offline test mode)" : "no model configured",
        channels: { telegram: !!config.channels.telegramToken, push: !!(config.channels.vapidPublic && config.channels.vapidPrivate) },
        paypal,
        counts: { needs, approvals },
      };
    }, false),
  );

  r.get(
    "/api/ui/people",
    J(async () => {
      if (!config.demoMode) return { people: [] };
      // In production the people to sign in as exist only inside a visitor's own workspace.
      if (!currentWs() && !config.demo.baseSignIn) return { people: [], needs_workspace: true };
      if (await inShowcase()) return { people: [], needs_workspace: true };
      const db = await getDb();
      const rows = (await db.query<any>("SELECT p.id, p.name, p.role, o.name AS org, o.kind FROM people p JOIN orgs o ON o.id = p.org_id ORDER BY o.kind DESC, o.name, p.role")).rows;
      const order = ["Jordan", "Sam", "Ana", "Priya", "Lee", "Marco", "Tess"];
      return { people: rows.map((x) => ({ id: x.id, name: x.name, first: x.name.split(" ")[0], role: x.role, org: x.org, side: x.kind, ...(BLURB[x.name.split(" ")[0]] ?? { job: "", tag: x.role }) })).sort((a, b) => order.indexOf(a.first) - order.indexOf(b.first)) };
    }, false),
  );

  /** The landing preview: the real demo order as it stands right now (lines, counts, money), no secrets. */
  r.get(
    "/api/ui/preview",
    J(async () => anonScope(async () => {
      const db = await getDb();
      const ids = await demoIds(db);
      const po = ids ? await getPo(db, ids.demoPo).catch(() => null) : null;
      if (!po) return { po: null };
      const lines = await linesOf(db, po.id);
      const rec = await latestReceipt(db, po.id);
      const byLine = new Map((rec?.lines ?? []).map((l) => [l.po_line_id, l]));
      const res = await latestResolution(db, po.id);
      const f = po.auth_id ? await fundingOf(db, po.root_id) : null;
      return {
        po: { number: po.number, status: po.status, buyer: po.buyer_name, supplier: po.supplier_name, limit_cents: po.spend_limit_cents },
        lines: lines.map((l) => ({ sku: l.product.sku, name: l.product.name, pack_label: l.product.pack_label, unit_price_cents: l.unit_price_cents ?? l.product.price_cents, tally: tally(l, byLine.get(l.id) ?? null) })),
        totals: res ? { accepted_cents: res.body.totals.accepted_cents, replacement_cents: res.body.totals.replacement_cents, final_cents: res.body.totals.final_cents, limit_cents: res.body.totals.limit_cents } : null,
        quote_total_cents: quoteTotal(lines),
        funding: f ? { captured_cents: f.captured_cents - f.refunded_cents, held_cents: f.held_cents + f.inflight_cents, expected_cents: f.expected.reduce((a, x) => a + x.cents, 0), spendable_cents: f.spendable_cents, limit_cents: f.limit_cents, held_now_cents: f.held_now_cents, releasing_cents: f.releasing_cents, released_cents: f.released_cents, refunding_cents: f.refunding_cents } : null,
        from: currentWs() ? ((await inShowcase()) ? "showcase" : "your demo") : "local data",
      };
    }, { po: null } as any), false),
  );

  r.get(
    "/api/ui/home",
    J(async (_req, _res, p) => {
      const db = await getDb();
      const col = p!.org_kind === "buyer" ? "buyer_id" : "supplier_id";
      const pos = (await db.query<PO & { buyer_name: string }>(`SELECT po.*, b.name AS buyer_name FROM purchase_orders po JOIN orgs b ON b.id = po.buyer_id WHERE po.${col} = $1 ORDER BY (po.status = 'closed'), po.created_at DESC LIMIT 100`, [p!.org_id])).rows;
      const org = await orgById(db, p!.org_id);
      const risky = await riskyPos(db, p!.org_id);
      const need = await needsYou(db, p!);
      const waiting = new Set(need.approvals.map((a) => a.po_id).filter(Boolean));
      const next = p!.org_kind === "supplier" ? NEXT_SUPPLIER : NEXT_BUYER;
      const orders = [];
      for (const po of pos) {
        const lines = await linesOf(db, po.id);
        const rec = await latestReceipt(db, po.id);
        const byLine = new Map((rec?.lines ?? []).map((l) => [l.po_line_id, l]));
        orders.push({
          id: po.id,
          number: po.number,
          kind: po.kind,
          status: po.status,
          buyer: po.buyer_name,
          history: po.is_sample || po.note.startsWith("Imported"),
          sample: !!po.is_sample,
          late: risky.has(po.id),
          needs_you: need.poIds.has(po.id),
          approval_waiting: waiting.has(po.id),
          next: waiting.has(po.id) ? "Approve the payment" : (next[po.status] ?? null),
          total_cents: quoteTotal(lines) || null,
          limit_cents: po.kind === "original" ? po.spend_limit_cents : null,
          deliver_by: po.deliver_by,
          note: po.note,
          lines: lines.map((l) => ({ sku: l.product.sku, name: l.product.name, qty_packs: l.qty_packs, pack_label: l.product.pack_label, tally: tally(l, byLine.get(l.id) ?? null) })),
          moving: ["settling", "part_settling", "funding"].includes(po.status),
        });
      }
      return {
        org: { name: org?.name, side: p!.org_kind, paypal_connected: !!org?.vault_token_id, payer: org?.vault_payer ?? null },
        can_create: p!.org_kind === "buyer" && p!.role === "owner",
        can_connect: p!.org_kind === "buyer" && p!.role === "owner",
        approvals: need.approvals,
        needs_count: need.count,
        orders,
      };
    }),
  );

  r.get(
    "/api/ui/po-new",
    J(async (_req, _res, p) => {
      if (p!.org_kind !== "buyer" || p!.role !== "owner") throw new GtError("Only the buyer's owner creates orders.", "forbidden", 403);
      const db = await getDb();
      const suppliers = (await db.query<{ id: string; name: string }>("SELECT id, name FROM orgs WHERE kind = 'supplier' ORDER BY name")).rows;
      const out = [];
      for (const s of suppliers) out.push({ ...s, catalog: (await catalog(db, s.id)).map(product) });
      return { suppliers: out, default_deliver_by: new Date(Date.now() + 864e5).toISOString().slice(0, 10) + "T06:00" };
    }),
  );

  r.get(
    "/api/ui/po/:id",
    J(async (req, _res, p) => {
      const db = await getDb();
      const po = await poFor(db, p!, req.params.id);
      return poModel(db, po, p!);
    }),
  );

  r.get(
    "/api/ui/po/:id/receive",
    J(async (req, _res, p) => {
      const db = await getDb();
      const po = await poFor(db, p!, req.params.id);
      if (p!.org_kind !== "buyer") throw new GtError("Receiving is the buyer's.", "forbidden", 403);
      return receiveModel(db, po);
    }),
  );

  r.get(
    "/api/ui/approvals",
    J(async (_req, _res, p) => ({ approvals: await approvalsFor(await getDb(), p!, null), threshold_cents: countersignThreshold() })),
  );

  r.get(
    "/api/ui/stock",
    J(async (_req, _res, p) => {
      if (p!.org_kind !== "buyer") throw new GtError("Stock is the buyer's.", "forbidden", 403);
      const db = await getDb();
      const P = (x: any) => (typeof x === "string" ? JSON.parse(x) : x);
      const rows = (await db.query<any>("SELECT s.units, row_to_json(pr.*) AS product, (SELECT max(at) FROM stock_moves m WHERE m.buyer_id = s.buyer_id AND m.product_id = s.product_id) AS last FROM stock s JOIN products pr ON pr.id = s.product_id WHERE s.buyer_id = $1 ORDER BY pr.sku", [p!.org_id])).rows;
      const moves = (await db.query<any>("SELECT m.*, pr.sku, row_to_json(pr.*) AS product, po.number FROM stock_moves m JOIN products pr ON pr.id = m.product_id LEFT JOIN purchase_orders po ON po.id = m.po_id WHERE m.buyer_id = $1 ORDER BY m.id DESC LIMIT 40", [p!.org_id])).rows;
      return {
        stock: rows.map((x) => ({ product: product(P(x.product)), units: x.units, text: formatUnits(x.units, P(x.product)), last: x.last })),
        moves: moves.map((m) => ({ id: m.id, at: m.at, sku: m.sku, delta: m.delta, text: `${m.delta > 0 ? "+" : "−"}${formatUnits(Math.abs(m.delta), P(m.product))}`, reason: m.reason, po_id: m.po_id, po_number: m.number })),
      };
    }),
  );

  r.get(
    "/api/ui/catalog",
    J(async (_req, _res, p) => {
      const db = await getDb();
      const sup = p!.org_kind === "supplier" ? p!.org_id : (await db.query<{ id: string }>("SELECT id FROM orgs WHERE kind = 'supplier' LIMIT 1")).rows[0]?.id;
      const org = sup ? await orgById(db, sup) : null;
      return { supplier: org ? { id: org.id, name: org.name } : null, can_edit: p!.role === "supplier", products: sup ? (await catalog(db, sup)).map(product) : [] };
    }),
  );

  r.get(
    "/api/ui/performance",
    J(async (_req, _res, p) => {
      const db = await getDb();
      const sup = p!.org_kind === "supplier" ? p!.org_id : (await db.query<{ id: string }>("SELECT supplier_id AS id FROM purchase_orders WHERE buyer_id = $1 LIMIT 1", [p!.org_id])).rows[0]?.id;
      if (!sup) return { supplier: null, rows: [] };
      const org = await orgById(db, sup);
      const buyers = (await db.query<{ id: string; name: string }>("SELECT DISTINCT o.id, o.name FROM orgs o JOIN purchase_orders po ON po.buyer_id = o.id WHERE po.supplier_id = $1 ORDER BY o.name", [sup])).rows.filter((b) => p!.org_kind === "supplier" || b.id === p!.org_id);
      const rows = [];
      if (p!.org_kind === "supplier") rows.push({ scope: "All buyers", ...(await supplierPerformance(db, sup)) });
      for (const b of buyers) rows.push({ scope: b.name, ...(await supplierPerformance(db, sup, b.id)) });
      return { supplier: { id: sup, name: org?.name }, rows };
    }),
  );

  /** The scripted scenario with every figure computed from the live demo order, never typed in. */
  r.get(
    "/api/ui/demo",
    J(async () => anonScope(async () => {
      const db = await getDb();
      const ids = await demoIds(db);
      const po = ids ? await getPo(db, ids.demoPo).catch(() => null) : null;
      const lines = po ? await linesOf(db, po.id) : [];
      const res = po ? await latestResolution(db, po.id) : null;
      const f = po?.auth_id ? await fundingOf(db, po.root_id) : null;
      const driver = ids ? (await db.query<{ driver_token: string | null }>("SELECT driver_token FROM people WHERE id = $1", [ids.people.ana])).rows[0] : null;
      const l0 = lines[0];
      return {
        demo: config.demoMode,
        app_url: config.appUrl,
        po: po ? { id: po.id, number: po.number, status: po.status, limit_cents: po.spend_limit_cents, buyer: po.buyer_name, supplier: po.supplier_name } : null,
        line: l0 ? { sku: l0.product.sku, name: l0.product.name, qty_packs: l0.qty_packs, pack_label: l0.product.pack_label, price_cents: l0.unit_price_cents ?? l0.product.price_cents, substitutes: l0.substitutes.length } : null,
        quote_total_cents: quoteTotal(lines) || (l0 ? l0.qty_packs * l0.product.price_cents : null),
        totals: res?.body?.totals ?? null,
        funding: f ? { captured_cents: f.captured_cents - f.refunded_cents, held_cents: f.held_now_cents, releasing_cents: f.releasing_cents, spendable_cents: f.spendable_cents, limit_cents: f.limit_cents } : null,
        driver_path: driver?.driver_token ? `/driver/${driver.driver_token}` : null,
        faults: FAULTABLE,
        live: { paypal: !!(config.paypal.clientId && config.paypal.clientSecret), ai: hasOpenAI(), telegram: !!config.channels.telegramToken, push: !!(config.channels.vapidPublic && config.channels.vapidPrivate) },
        // "yours": figures from your own workspace; "showcase": the read-only sample, until you start your own.
        scope: currentWs() ? ((await inShowcase()) ? "showcase" : "yours") : config.demo.baseSignIn ? "local" : "none",
      };
    }, { demo: config.demoMode, app_url: config.appUrl, po: null, line: null, quote_total_cents: null, totals: null, funding: null, driver_path: null, faults: FAULTABLE, live: { paypal: !!(config.paypal.clientId && config.paypal.clientSecret), ai: hasOpenAI(), telegram: !!config.channels.telegramToken, push: !!(config.channels.vapidPublic && config.channels.vapidPrivate) }, scope: "none" } as any), false),
  );

  r.get("/api/ui/*", (_req, res) => res.status(404).json({ error: "not_found", message: "No such view." }));
  return r;
}
