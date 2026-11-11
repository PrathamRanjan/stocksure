/**
 * Spec A1: a private demo workspace for every visitor.
 *
 * A workspace is its own Postgres schema (`stocksure_ws_<id>`) holding every per-business table, plus a row in the
 * shared `workspaces` table. One tap creates it, seeds the business, and signs nobody else in to it. The seed runs
 * through the app's own services, so the holds and captures in it are real PayPal sandbox objects paid from the
 * saved demo wallet and read back; sample history is flagged `is_sample`. Idle workspaces expire: their open
 * holds are voided (each void read back) and the schema is dropped.
 */
import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { createWorkspaceSchema, currentWs, dropWorkspaceSchema, getDb, withWorkspace, WS_ID } from "../db.js";
import { drain } from "../jobs.js";
import { paypal } from "../paypal/index.js";
import { ACTIVE_AUTH } from "../core/funding.js";
import { acceptQuote, createPo, dispatchPo, quotePo, submitPo } from "../services/orders.js";
import { confirmReceipt, lineFingerprint, supplierReview } from "../services/receiving.js";
import { approveResolution } from "../services/resolution.js";
import { seedDemo, type DemoIds } from "../services/seed.js";
import { getPo, latestReceipt, latestResolution, linesOf, personById, putSetting, type Person } from "../store.js";
import { GtError } from "../lib/util.js";
import { usableWallet } from "./wallet.js";

export type WorkspaceKind = "visitor" | "showcase";
export interface Workspace {
  id: string;
  kind: WorkspaceKind;
  seed_state: "seeding" | "ready" | "failed" | "expired";
  seed_progress: SeedProgress;
  error: string | null;
  join_token: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
}
export interface SeedProgress {
  /** PayPal payments the seed makes for real (holds and captures). */
  payments_expected?: number;
  step?: string;
  done?: boolean;
  wallet?: boolean;
  stopped?: string;
}

/** How many real PayPal operations the seeded scenarios make: A hold+capture, B hold+capture+replacement hold, C hold. */
export const SEED_PAYMENTS = 7;

const ALPHA = "abcdefghijkmnpqrstuvwxyz23456789";
const newWsId = () => Array.from(randomBytes(12), (b) => ALPHA[b % ALPHA.length]).join("");
export const ipHash = (ip: string) => createHash("sha256").update(`ss-ip:${config.sessionSecret}:${ip}`).digest("hex").slice(0, 32);
const idleMs = () => config.demo.idleHours * 3600_000;

async function base<T>(fn: (db: Awaited<ReturnType<typeof getDb>>) => Promise<T>): Promise<T> {
  const db = await getDb();
  return withWorkspace(null, () => fn(db));
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  if (!WS_ID.test(id)) return null;
  return base(async (db) => (await db.query<Workspace>("SELECT * FROM workspaces WHERE id = $1", [id])).rows[0] ?? null);
}

/** A workspace a request may enter: seeding or ready, not past its expiry. */
export async function liveWorkspace(id: string | null | undefined): Promise<Workspace | null> {
  if (!id) return null;
  const w = await getWorkspace(id);
  return w && (w.seed_state === "seeding" || w.seed_state === "ready") && new Date(w.expires_at).getTime() > Date.now() ? w : null;
}

const touched = new Map<string, number>();
/** Keeps an active workspace alive; written at most once a minute per workspace. */
export async function touchWorkspace(id: string) {
  const last = touched.get(id) ?? 0;
  if (Date.now() - last < 60_000) return;
  touched.set(id, Date.now());
  await base((db) => db.query("UPDATE workspaces SET last_seen_at = now(), expires_at = now() + make_interval(secs => $2) WHERE id = $1 AND kind = 'visitor'", [id, idleMs() / 1000]));
}

/** Rate limits from spec A1.2: 5 new workspaces per address per hour; at most 300 live (the oldest idle one is reused). */
export async function checkStartAllowed(ip: string): Promise<void> {
  const n = await base(async (db) => Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM workspaces WHERE ip_hash = $1 AND kind = 'visitor' AND created_at > now() - interval '1 hour'", [ipHash(ip)])).rows[0].n));
  if (n >= config.demo.perAddressPerHour) throw new GtError(`You've started ${n} demos in the last hour, which is the limit. Keep using your current one, or try again later.`, "rate_limited", 429);
}

async function makeRoom() {
  const live = await base(async (db) => (await db.query<{ id: string }>("SELECT id FROM workspaces WHERE kind = 'visitor' AND seed_state IN ('seeding','ready') ORDER BY last_seen_at ASC")).rows);
  for (const w of live.slice(0, Math.max(0, live.length - config.demo.maxWorkspaces + 1))) await closeWorkspace(w.id, "reused: the demo was full and this was the longest idle");
}

/**
 * Creates the workspace, loads the business into it (people, catalog, sample history, draft orders) and returns.
 * The real PayPal payments for the seeded orders continue in the background; `seed_progress` and the payment
 * ops in the workspace say how far they got.
 */
export async function createWorkspace(kind: WorkspaceKind, ip: string | null, opts: { background?: boolean } = {}): Promise<Workspace> {
  if (kind === "visitor") await makeRoom();
  const id = newWsId();
  const joinToken = randomBytes(18).toString("base64url");
  const wallet = await usableWallet();
  await base((db) =>
    db.query("INSERT INTO workspaces (id, kind, ip_hash, join_token, seed_state, seed_progress, expires_at) VALUES ($1,$2,$3,$4,'seeding',$5, now() + make_interval(secs => $6))", [
      id,
      kind,
      ip ? ipHash(ip) : null,
      joinToken,
      JSON.stringify({ payments_expected: wallet ? SEED_PAYMENTS : 0, step: "Loading the business", wallet: !!wallet }),
      kind === "showcase" ? 3 * 86400 : idleMs() / 1000,
    ]),
  );
  const db = await getDb();
  let ids: DemoIds;
  try {
    await createWorkspaceSchema(db, id);
    ids = await withWorkspace(id, () => db.tx(async (q) => (await seedDemo(q, { wallet: wallet ? { tokenId: wallet.tokenId, payer: wallet.payer } : null })).ids));
  } catch (e) {
    await base((d) => d.query("UPDATE workspaces SET seed_state = 'failed', error = $2 WHERE id = $1", [id, (e as Error).message.slice(0, 500)]));
    await dropWorkspaceSchema(db, id).catch(() => undefined);
    throw e;
  }
  await base((d) => d.query("UPDATE workspaces SET seed_state = 'ready' WHERE id = $1", [id]));
  const run = () => withWorkspace(id, () => seedPayments(id, ids, !!wallet));
  if (opts.background === false) await run();
  else void run().catch((e) => console.error("[stocksure] seeding payments", id, (e as Error).message));
  return (await getWorkspace(id))!;
}

async function progress(id: string, patch: SeedProgress) {
  await base((db) => db.query("UPDATE workspaces SET seed_progress = seed_progress || $2::jsonb WHERE id = $1", [id, JSON.stringify(patch)]));
}

let jobHandlers: Record<string, (p: any) => Promise<void>> | null = null;
/** The worker's job handlers, loaded lazily (the worker imports this module's callers). */
async function handlers() {
  if (!jobHandlers) jobHandlers = (await import("../worker.js")).handlers as any;
  return jobHandlers!;
}

/**
 * The seeded orders, made through the real path: drafted by the owner, quoted by the supplier, held on PayPal from
 * the saved wallet, dispatched, counted, agreed and settled by the same services a judge uses.
 *   A. Espresso beans, delivered in full: held, then captured in full. Closed with money confirmed.
 *   B. Cups, one carton crushed: held, the accepted carton captured, the rest released, a replacement held and
 *      dispatched. In transit.
 *   C. Almond milk: held and dispatched. Waiting for the receiver to count it in.
 *   D. Barista oat, two cases crushed: held, counted, the supplier agreed the count. Waiting for the fix.
 * Without the saved wallet nothing is paid: the drafts stay as drafts and the page offers PayPal's own approval.
 */
async function seedPayments(id: string, ids: DemoIds, withWallet: boolean) {
  if (!withWallet) {
    await progress(id, { done: true, step: "No saved wallet: connect PayPal on PayPal's own page to place holds" });
    return;
  }
  const db = await getDb();
  const P = async (k: string): Promise<Person> => (await personById(db, ids.people[k]))!;
  const jordan = await P("jordan");
  const sam = await P("sam");
  const ana = await P("ana");
  const prod = ids.products;
  const due = new Date(Date.now() + 2 * 864e5);
  const settleNow = async () => drain(db, (await handlers()) as any, 20, undefined, id);
  const order = async (sku: string, packs: number, limit: number, note: string) => {
    const po = await createPo(jordan, { supplier_id: ids.supplier, lines: [{ product_id: prod[sku], qty_packs: packs, substitutes: [], replace_shortfall: true }], deliver_by: due, spend_limit_cents: limit, note }, true);
    await submitPo(jordan, po);
    await quotePo(ana, po, {});
    await acceptQuote(jordan, po, (await getPo(db, po)).quote_version);
    return po;
  };
  const counts = async (po: string, f: (packs: number) => { delivered: number; damaged: number; note?: string }) => {
    const c: Record<string, { delivered: string; damaged: string; wrong: string; note: string }> = {};
    for (const l of await linesOf(db, po)) {
      const x = f(l.qty_packs);
      c[l.id] = { delivered: String(x.delivered), damaged: String(x.damaged), wrong: "0", note: x.note ?? "" };
    }
    await confirmReceipt(sam, po, c);
  };
  try {
    await progress(id, { step: "Placing the hold for the almond milk order" });
    const c = await order("ALM-12", 8, 12000, "Almond milk for the weekend");
    await dispatchPo(ana, c, null);

    await progress(id, { step: "Settling the espresso beans order" });
    const a = await order("BEAN-1", 3, 12000, "Espresso beans");
    await dispatchPo(ana, a, null);
    await counts(a, (n) => ({ delivered: n, damaged: 0 }));
    await settleNow();

    await progress(id, { step: "Settling the cups order with a crushed carton" });
    const b = await order("CUP-12", 2, 26000, "Takeaway cups");
    await dispatchPo(ana, b, null);
    await counts(b, (n) => ({ delivered: n, damaged: 1, note: "One carton crushed on the pallet corner" }));
    const rec = await latestReceipt(db, b);
    for (const l of rec?.lines ?? []) if (l.supplier_status !== "agreed") await supplierReview(ana, b, l.po_line_id, "agree", "Driver confirmed the crushed carton.", lineFingerprint(rec!.receipt.version, l));
    const res = await latestResolution(db, b);
    if (!res) throw new Error("The cups order produced no resolution");
    await approveResolution(jordan, b, res.version, res.hash);
    await approveResolution(ana, b, res.version, res.hash);
    await settleNow();
    const repl = (await db.query<{ id: string; status: string }>("SELECT id, status FROM purchase_orders WHERE parent_id = $1", [b])).rows[0];
    if (repl?.status === "funded") await dispatchPo(ana, repl.id, null);

    // D. Barista oat, two cases crushed: held, counted and agreed by the supplier, waiting for the fix. The judge's
    //    "let the agents settle it" path starts here.
    await progress(id, { step: "Counting the barista oat order with two crushed cases" });
    const d = await order("OAT-B12", 6, 9000, "Barista oat for the week");
    await putSetting(db, "judge_agents_po", d);
    await dispatchPo(ana, d, null);
    await counts(d, (n) => ({ delivered: n, damaged: 2, note: "Two cases crushed under the pallet strap" }));
    const recD = await latestReceipt(db, d);
    for (const l of recD?.lines ?? []) if (l.supplier_status !== "agreed") await supplierReview(ana, d, l.po_line_id, "agree", "Driver photographed the two crushed cases.", lineFingerprint(recD!.receipt.version, l));
    await progress(id, { done: true, step: "All seeded payments placed" });
  } catch (e) {
    await progress(id, { done: true, stopped: (e as Error).message.slice(0, 300), step: "Seeding stopped" });
    throw e;
  }
}

/** What the seed has confirmed with PayPal so far: payment ops that PayPal's read-back marked succeeded. */
export async function seedStatus(w: Workspace) {
  const db = await getDb();
  const confirmed = await withWorkspace(w.id, async () => Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM payment_ops WHERE status = 'succeeded' AND paypal_id IS NOT NULL")).rows[0].n));
  const p = typeof w.seed_progress === "string" ? JSON.parse(w.seed_progress) : (w.seed_progress ?? {});
  return { expected: Number(p.payments_expected ?? 0), confirmed, step: p.step ?? "", done: !!p.done, stopped: p.stopped ?? null, wallet: !!p.wallet };
}

/**
 * Closes a workspace: voids every authorization it still holds at PayPal (each void read back), drops its
 * schema, and marks it expired. A void PayPal refuses is recorded, never hidden.
 */
export async function closeWorkspace(id: string, reason: string): Promise<{ voided: string[]; failed: string[] }> {
  const w = await getWorkspace(id);
  if (!w || w.seed_state === "expired") return { voided: [], failed: [] };
  await base((db) => db.query("UPDATE workspaces SET seed_state = 'expired', error = $2 WHERE id = $1", [id, reason.slice(0, 300)]));
  const db = await getDb();
  const voided: string[] = [];
  const failed: string[] = [];
  const auths = await withWorkspace(id, async () => (await db.query<{ paypal_id: string }>("SELECT DISTINCT paypal_id FROM payment_ops WHERE kind IN ('authorize','reauthorize') AND status = 'succeeded' AND paypal_id IS NOT NULL")).rows).catch(() => []);
  for (const { paypal_id } of auths) {
    try {
      const a = await paypal().getAuthorization(paypal_id);
      if (!ACTIVE_AUTH.has(a.status)) continue;
      await paypal().voidAuthorization(paypal_id, `ws-close:${id}:${paypal_id}`);
      const after = await paypal().getAuthorization(paypal_id);
      (after.status === "VOIDED" ? voided : failed).push(paypal_id);
    } catch {
      failed.push(paypal_id);
    }
  }
  await dropWorkspaceSchema(db, id);
  await base((d) => d.query("UPDATE jobs SET status = 'cancelled', last_error = 'workspace closed', updated_at = now() WHERE ws_id = $1 AND status IN ('pending','running')", [id]));
  await base((d) => d.query("UPDATE workspaces SET error = $2 WHERE id = $1", [id, `${reason}. Voided ${voided.length} hold(s)${failed.length ? `; ${failed.length} not confirmed voided: ${failed.join(", ")}` : ""}.`.slice(0, 500)]));
  return { voided, failed };
}

/** Housekeeping: close visitor workspaces idle past their expiry, and showcases replaced by a newer one. */
export async function expireWorkspaces(): Promise<number> {
  const due = await base(async (db) => (await db.query<{ id: string }>("SELECT id FROM workspaces WHERE seed_state IN ('seeding','ready','failed') AND expires_at < now()")).rows);
  for (const w of due) await closeWorkspace(w.id, "expired after being idle");
  return due.length;
}

/** The newest ready showcase: the read-only workspace the landing page previews. */
export async function showcase(): Promise<Workspace | null> {
  return base(async (db) => (await db.query<Workspace>("SELECT * FROM workspaces WHERE kind = 'showcase' AND seed_state = 'ready' ORDER BY created_at DESC LIMIT 1")).rows[0] ?? null);
}

/** Nightly: build a fresh showcase through the same seeding path, then close the older ones. */
export async function rebuildShowcase(): Promise<Workspace> {
  const fresh = await createWorkspace("showcase", null, { background: false });
  const old = await base(async (db) => (await db.query<{ id: string }>("SELECT id FROM workspaces WHERE kind = 'showcase' AND id <> $1 AND seed_state <> 'expired'", [fresh.id])).rows);
  for (const o of old) await closeWorkspace(o.id, "replaced by a newer showcase");
  return fresh;
}

/** Ensures a showcase exists (first boot, or after a failed nightly build). */
export async function ensureShowcase(): Promise<void> {
  const s = await showcase();
  if (!s || Date.now() - new Date(s.created_at).getTime() > 26 * 3600_000) await rebuildShowcase();
}

export const inShowcase = async () => {
  const ws = currentWs();
  return ws ? (await getWorkspace(ws))?.kind === "showcase" : false;
};
