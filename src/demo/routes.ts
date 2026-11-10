/**
 * Spec A1.2: the visitor's workspace lifecycle over HTTP, and the admin-only controls that used to be public.
 *
 *  POST /demo/start          one tap: a private workspace, a signed `ss_ws` cookie, back at once while it seeds
 *  GET  /api/ui/workspace    the visitor's workspace: state, seeded payments confirmed by PayPal, join link
 *  GET  /demo/join/:token    opens the same workspace on a second device (the QR code on the demo page)
 *  GET  /demo/join.svg       that QR code
 *  POST /demo/reset          "Reset my demo": a new workspace for this visitor only; the old one is closed
 *  POST /demo/fault          arms a PayPal fault in this visitor's workspace only
 *  /admin/*                  behind SS_ADMIN_KEY: global reset of the base schema, wallet re-approval, workspaces
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import QRCode from "qrcode";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { currentWs, getDb, withWorkspace } from "../db.js";
import { sign, unsign } from "../lib/crypto.js";
import { GtError } from "../lib/util.js";
import { armFault, FAULTABLE, type FaultKind } from "../paypal/index.js";
import { keyWorkspace, seedDemo } from "../services/seed.js";
import { signOut } from "../web/auth.js";
import { back, flashOf } from "../web/common.js";
import { html, layout, raw } from "../web/html.js";
import { checkStartAllowed, closeWorkspace, createWorkspace, expireWorkspaces, getWorkspace, liveWorkspace, rebuildShowcase, seedStatus, touchWorkspace, type Workspace } from "./workspaces.js";
import { checkWallet, finishReapproval, startReapproval, walletInfo } from "./wallet.js";

export const WS_COOKIE = "ss_ws";
const secure = () => config.appUrl.startsWith("https://");

function setWsCookie(res: Response, id: string) {
  res.cookie(WS_COOKIE, sign(id), { httpOnly: true, sameSite: "lax", secure: secure(), maxAge: 7 * 864e5, path: "/" });
}

/** Which workspace a request belongs to: a workspace-scoped key (MCP, merchant API) wins, then the cookie. */
async function wsOf(req: Request): Promise<Workspace | null> {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "")?.[1];
  const fromKey = bearer ? keyWorkspace(bearer) : null;
  if (fromKey) return liveWorkspace(fromKey);
  const driver = /^\/driver\/(drv_[a-z0-9]{6,24}~)/.exec(req.path)?.[1];
  if (driver) return liveWorkspace(keyWorkspace(driver));
  return liveWorkspace(unsign(req.cookies?.[WS_COOKIE]));
}

/** Runs the rest of the request inside the visitor's workspace (or the base schema when there is none). */
export function workspaceMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.demoMode) return withWorkspace(null, () => next());
    wsOf(req)
      .then((w) => {
        if (!w && req.cookies?.[WS_COOKIE] && !req.header("authorization")) res.clearCookie(WS_COOKIE, { path: "/" });
        if (w && w.kind === "visitor") void touchWorkspace(w.id).catch(() => undefined);
        (req as any).workspace = w;
        withWorkspace(w?.id ?? null, () => next());
      })
      .catch(next);
  };
}

export const workspaceOf = (req: Request): Workspace | null => (req as any).workspace ?? null;

/** Showcase workspaces are read-only to visitors: they feed the landing preview and nobody signs in to them. */
export function refuseShowcaseWrites() {
  return (req: Request, res: Response, next: NextFunction) => {
    const w = workspaceOf(req);
    if (w?.kind === "showcase" && req.method !== "GET" && req.method !== "HEAD") return res.status(403).json({ ok: false, message: "The showcase is read-only. Start your own demo." });
    next();
  };
}

function adminOk(req: Request): boolean {
  const key = config.demo.adminKey;
  if (!key) return false;
  const given = req.header("x-admin-key") ?? unsign(req.cookies?.ss_admin) ?? "";
  const a = Buffer.from(String(given));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
function needAdmin(req: Request, res: Response, next: NextFunction) {
  if (!config.demo.adminKey) return res.status(404).send("Not found");
  if (!adminOk(req)) return res.status(401).type("html").send(layout({ title: "Admin" }, html`<h1>Admin</h1><form method="post" action="/admin/login" class="card"><label>Admin key <input type="password" name="key" autocomplete="current-password"></label> <input type="hidden" name="next" value="${req.originalUrl}"><button class="btn primary">Sign in</button></form>`));
  next();
}

export function workspaceView(w: Workspace | null, req: Request) {
  return w
    ? {
        id: w.id,
        kind: w.kind,
        state: w.seed_state,
        created_at: w.created_at,
        expires_at: w.expires_at,
        idle_hours: config.demo.idleHours,
        join_url: `${config.appUrl}/demo/join/${w.join_token}`,
      }
    : null;
}

export function demoRouter() {
  const r = Router();

  r.post("/demo/start", async (req, res, next) => {
    try {
      if (!config.demoMode) return res.status(403).json({ ok: false, message: "Demo mode is off on this server." });
      const cur = workspaceOf(req);
      if (cur?.kind === "visitor" && req.body?.fresh !== "1") return res.json({ ok: true, message: "Your demo is already open.", to: "/login" });
      await checkStartAllowed(req.ip ?? "");
      const w = await createWorkspace("visitor", req.ip ?? "");
      setWsCookie(res, w.id);
      signOut(res);
      res.json({ ok: true, message: "Your private demo is ready. Pick who you are.", to: "/login" });
    } catch (e) {
      if (e instanceof GtError) return res.status(e.status).json({ ok: false, message: e.message });
      next(e);
    }
  });

  r.get("/api/ui/workspace", async (req, res, next) => {
    try {
      const w = workspaceOf(req);
      const wallet = await walletInfo();
      res.json({
        demo: config.demoMode,
        workspace: workspaceView(w, req),
        seed: w ? await seedStatus(w) : null,
        wallet: wallet ? { configured: true, status: wallet.status, payer: wallet.payer, checked_at: wallet.checkedAt } : { configured: false },
      });
    } catch (e) {
      next(e);
    }
  });

  r.get("/demo/join/:token", async (req, res, next) => {
    try {
      const db = await getDb();
      const row = await withWorkspace(null, async () => (await db.query<{ id: string }>("SELECT id FROM workspaces WHERE join_token = $1", [req.params.token])).rows[0]);
      const w = row ? await liveWorkspace(row.id) : null;
      if (!w || w.kind !== "visitor") return back(res, "/", "That demo link has expired. Start a new demo.", true);
      setWsCookie(res, w.id);
      signOut(res);
      back(res, "/login", "This device is now in the same demo. Pick who you are on this one.");
    } catch (e) {
      next(e);
    }
  });

  r.get("/demo/join.svg", async (req, res, next) => {
    try {
      const w = workspaceOf(req);
      if (!w || w.kind !== "visitor") return res.status(404).send("No demo open");
      const svg = await QRCode.toString(`${config.appUrl}/demo/join/${w.join_token}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      res.setHeader("Cache-Control", "private, no-store");
      res.type("image/svg+xml").send(svg);
    } catch (e) {
      next(e);
    }
  });

  r.post("/demo/reset", async (req, res, next) => {
    try {
      if (!config.demoMode) return res.status(403).send("Demo mode is off");
      const old = workspaceOf(req);
      if (!old && config.demo.baseSignIn) {
        // Local development only (never production): no workspace, so reset the base data as before.
        const db = await getDb();
        await withWorkspace(null, () => db.tx((q) => seedDemo(q, { keepPayPal: req.body.keep === "1" })));
        return back(res, "/login", "The local demo data was reset.");
      }
      if (!old || old.kind !== "visitor") return back(res, "/", "There is no demo of yours to reset. Start one first.", true);
      await checkStartAllowed(req.ip ?? "");
      const w = await createWorkspace("visitor", req.ip ?? "");
      setWsCookie(res, w.id);
      signOut(res);
      // Close the old one after answering: its holds are voided and read back in the background.
      void closeWorkspace(old.id, "reset by its visitor").catch((e) => console.error("[stocksure] close", old.id, (e as Error).message));
      back(res, "/login", "Your demo was reset. Nobody else's was touched. Pick who you are.");
    } catch (e) {
      if (e instanceof GtError) return back(res, "/demo", e.message, true);
      next(e);
    }
  });

  r.post("/demo/fault", async (req, res, next) => {
    try {
      if (!config.demoMode) return res.status(403).send("Demo mode is off");
      // Outside a workspace only local development (base sign-in on, never production) may arm faults.
      if (!currentWs() && !config.demo.baseSignIn) return back(res, "/demo", "Start your own demo first: faults only affect your workspace.", true);
      const method = String(req.body.method);
      const kind = String(req.body.kind) as FaultKind;
      if (!(FAULTABLE as readonly string[]).includes(method) || !["fail_503", "lose_response", "fail_422", "stale_read"].includes(kind)) return back(res, "/demo", "Unknown fault", true);
      await armFault(method, kind);
      back(res, "/demo", currentWs() ? `Armed in your demo only: next ${method} → ${kind}.` : `Armed (local development data): next ${method} → ${kind}.`);
    } catch (e) {
      next(e);
    }
  });

  // ---------- Admin (SS_ADMIN_KEY) ----------
  r.post("/admin/login", (req, res) => {
    if (!config.demo.adminKey) return res.status(404).send("Not found");
    const given = String(req.body.key ?? "");
    const ok = given.length === config.demo.adminKey.length && timingSafeEqual(Buffer.from(given), Buffer.from(config.demo.adminKey));
    if (!ok) return res.status(401).send("Wrong key");
    res.cookie("ss_admin", sign(given), { httpOnly: true, sameSite: "strict", secure: secure(), maxAge: 12 * 3600_000, path: "/admin" });
    const next = String(req.body.next ?? "/admin/paypal/wallet");
    res.redirect(next.startsWith("/admin") ? next : "/admin/paypal/wallet");
  });

  r.post("/admin/reset-base", needAdmin, async (req, res, next) => {
    try {
      const db = await getDb();
      await withWorkspace(null, () => db.tx((q) => seedDemo(q, { keepPayPal: req.body.keep !== "0" })));
      back(res, "/admin/workspaces", "The base demo was reset.");
    } catch (e) {
      next(e);
    }
  });

  r.post("/admin/showcase", needAdmin, async (_req, res, next) => {
    try {
      const w = await rebuildShowcase();
      back(res, "/admin/workspaces", `Showcase ${w.id} rebuilt.`);
    } catch (e) {
      next(e);
    }
  });

  r.post("/admin/expire", needAdmin, async (_req, res, next) => {
    try {
      back(res, "/admin/workspaces", `Closed ${await expireWorkspaces()} idle workspace(s).`);
    } catch (e) {
      next(e);
    }
  });

  r.get("/admin/workspaces", needAdmin, async (req, res, next) => {
    try {
      const db = await getDb();
      const rows = await withWorkspace(null, async () => (await db.query<Workspace>("SELECT * FROM workspaces ORDER BY created_at DESC LIMIT 100")).rows);
      res.type("html").send(
        layout(
          { title: "Workspaces", flash: flashOf(req) },
          html`<h1>Demo workspaces</h1>
<form method="post" action="/admin/expire" class="row"><button class="btn small">Close idle workspaces now</button></form>
<form method="post" action="/admin/showcase" class="row"><button class="btn small">Rebuild the showcase</button></form>
<form method="post" action="/admin/reset-base" class="row"><button class="btn small">Reset the base demo (keeps PayPal)</button></form>
<table><tr><th>Id</th><th>Kind</th><th>State</th><th>Created</th><th>Last seen</th><th>Expires</th><th>Note</th></tr>
${rows.map((w) => html`<tr><td class="mono">${w.id}</td><td>${w.kind}</td><td>${w.seed_state}</td><td>${new Date(w.created_at).toISOString()}</td><td>${new Date(w.last_seen_at).toISOString()}</td><td>${new Date(w.expires_at).toISOString()}</td><td>${w.error ?? ""}</td></tr>`)}</table>`,
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  r.get("/admin/paypal/wallet", needAdmin, async (req, res, next) => {
    try {
      const w = req.query.check === "1" ? await checkWallet() : await walletInfo();
      res.type("html").send(
        layout(
          { title: "Demo wallet", flash: flashOf(req) },
          html`<h1>Saved demo wallet</h1>
<p class="sub">Every demo workspace's buyers pay from this saved sandbox PayPal (Vault payment token), so judges need no PayPal login. Approve it once as the dedicated sandbox buyer.</p>
<div class="card">${w ? html`<p>Status: <b>${w.status}</b>${w.checkedAt ? html` (checked ${new Date(w.checkedAt).toISOString()})` : ""}. Source: ${w.source}. Buyer: ${w.payer || "unknown"}. Token: <span class="mono">…${w.tokenId.slice(-4)}</span>.</p>${w.detail ? html`<p class="small">${w.detail}</p>` : ""}` : html`<p>No saved wallet is configured. Judges will be offered PayPal's own approval page.</p>`}
<p><a class="btn small" href="/admin/paypal/wallet?check=1">Check it with PayPal now</a></p></div>
<form method="post" action="/admin/paypal/wallet/start" class="card"><h2>Re-approve</h2><p class="small">Opens PayPal. Sign in as the dedicated sandbox buyer and approve. The new token replaces the setting.</p><button class="btn primary">Approve on PayPal</button></form>`,
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  r.post("/admin/paypal/wallet/start", needAdmin, async (_req, res, next) => {
    try {
      res.redirect(await startReapproval(`${config.appUrl}/admin/paypal/wallet/return`, `${config.appUrl}/admin/paypal/wallet`));
    } catch (e) {
      next(e);
    }
  });

  r.get("/admin/paypal/wallet/return", needAdmin, async (req, res) => {
    try {
      const w = await finishReapproval(String(req.query.approval_token_id ?? req.query.token ?? ""));
      back(res, "/admin/paypal/wallet", `Saved wallet re-approved for ${w.payer || "the sandbox buyer"}.`);
    } catch (e) {
      back(res, "/admin/paypal/wallet", `Re-approval failed: ${(e as Error).message}`, true);
    }
  });

  return r;
}

export { raw };
