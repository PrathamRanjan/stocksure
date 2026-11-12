/**
 * Language and hands-free endpoints.
 * POST /api/ui/lang        remembers the person's language (cookie for every visitor, people.lang when signed in)
 * POST /api/ui/translate   translates run-time text (agent moves, AI summaries) for display; signed-in only
 * POST /api/public/handsfree  a calibration result the person chose to share: two numbers, no images
 */
import { Router, type Request, type Response } from "express";
import { getDb, withWorkspace } from "../db.js";
import { translateTexts } from "../ai/translate.js";
import { GtError } from "../lib/util.js";
import { langOf } from "../lib/lang.js";
import { me } from "./auth.js";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) =>
  fn(req, res)
    .then((out) => !res.headersSent && res.json(out))
    .catch((e) => {
      const g = e instanceof GtError ? e : null;
      if (!g) console.error("[stocksure i18n]", (e as Error).message);
      if (!res.headersSent) res.status(g?.status ?? 500).json({ error: g?.code ?? "error", message: g?.message ?? "Something went wrong." });
    });

const shared = new Map<string, number[]>();
function limited(ip: string, max: number, windowMs: number) {
  const t = Date.now();
  const v = (shared.get(ip) ?? []).filter((x) => x > t - windowMs);
  v.push(t);
  shared.set(ip, v);
  return v.length > max;
}

export function i18nRouter() {
  const r = Router();

  r.post("/api/ui/lang", wrap(async (req, res) => {
    const lang = langOf(req.body?.lang);
    res.cookie("ss-lang", lang, { path: "/", maxAge: 365 * 86400_000, sameSite: "lax" });
    const p = await me(req);
    if (p) await (await getDb()).query("UPDATE people SET lang = $2 WHERE id = $1", [p.id, lang]);
    return { ok: true, lang, saved_for: p ? p.name : null };
  }));

  r.post("/api/ui/translate", wrap(async (req) => {
    const p = await me(req);
    if (!p) throw new GtError("Sign in first.", "unauthorized", 401);
    const lang = langOf(req.body?.lang);
    const texts = Array.isArray(req.body?.texts) ? (req.body.texts as unknown[]).slice(0, 30).map((t) => String(t ?? "").slice(0, 1200)) : [];
    if (limited(`t:${p.id}`, 60, 60_000)) throw new GtError("Too many translations at once; the original text is shown.", "rate_limited", 429);
    return { lang, texts: await translateTexts(lang, texts), machine: true };
  }));

  r.post("/api/public/handsfree", wrap(async (req) => {
    if (limited(`h:${req.ip}`, 10, 3600_000)) throw new GtError("Thanks, already recorded.", "rate_limited", 429);
    const n = (v: unknown, max: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Math.round(Number(v)) : null);
    const mode = req.body?.mode === "gaze" ? "gaze" : "head";
    const row = { gaze: n(req.body?.gaze_px, 5000), head: n(req.body?.head_px, 5000), w: n(req.body?.w, 10000), h: n(req.body?.h, 10000) };
    if (row.gaze === null && row.head === null) throw new GtError("No accuracy given.", "invalid", 400);
    await withWorkspace(null, async () => (await getDb()).query("INSERT INTO handsfree_runs (mode, gaze_px, head_px, width, height) VALUES ($1,$2,$3,$4,$5)", [mode, row.gaze, row.head, row.w, row.h]));
    return { ok: true };
  }));

  /**
   * Spec B: a local-currency estimate beside USD amounts (INR, IDR, BRL). The rate is the European Central Bank's
   * reference rate via frankfurter.dev, cached for six hours; no rate means no estimate, never a guessed one.
   * PayPal still charges USD.
   */
  r.get("/api/public/fx", wrap(async () => ({ fx: await usdRates() })));

  return r;
}

let fx: { at: number; v: { date: string; source: string; rates: Record<string, number> } | null } | null = null;
let fxFetch: typeof fetch = (i, init) => fetch(i, init);
export function setFxFetch(f: typeof fetch | null) {
  fxFetch = f ?? ((i, init) => fetch(i, init));
  fx = null;
}
export async function usdRates() {
  if (fx && Date.now() - fx.at < (fx.v ? 6 : 0.25) * 3600_000) return fx.v;
  let v: NonNullable<typeof fx>["v"] = null;
  try {
    const res = await fxFetch("https://api.frankfurter.dev/v1/latest?from=USD&to=INR,IDR,BRL", { signal: AbortSignal.timeout(4000) });
    const d = (await res.json()) as { date?: string; rates?: Record<string, unknown> };
    const rates = Object.fromEntries(["INR", "IDR", "BRL"].map((c) => [c, Number(d.rates?.[c])]).filter(([, n]) => Number.isFinite(n as number) && (n as number) > 0));
    if (res.ok && d.date && Object.keys(rates).length) v = { date: d.date, source: "European Central Bank reference rate (frankfurter.dev)", rates: rates as Record<string, number> };
  } catch {
    /* no estimate */
  }
  fx = { at: Date.now(), v };
  return v;
}

/** What visitors shared about their calibration, for /accessibility. */
export async function handsfreeStats() {
  return withWorkspace(null, async () => {
    const db = await getDb();
    const q = (await db.query<any>("SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY gaze_px) AS gaze, percentile_cont(0.5) WITHIN GROUP (ORDER BY head_px) AS head, max(created_at) AS last FROM handsfree_runs")).rows[0];
    return { shared_runs: Number(q?.n ?? 0), median_gaze_px: q?.gaze === null || q?.gaze === undefined ? null : Math.round(Number(q.gaze)), median_head_px: q?.head === null || q?.head === undefined ? null : Math.round(Number(q.head)), last_at: q?.last ?? null };
  }).catch(() => ({ shared_runs: 0, median_gaze_px: null, median_head_px: null, last_at: null }));
}
