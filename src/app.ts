import express from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db.js";
import { GtError } from "./lib/util.js";
import { receiveWebhook } from "./webhooks.js";
import { routes } from "./web/routes.js";
import { guardRouter } from "./web/guard.js";
import { safetyRouter } from "./web/safety.js";
import { traceRouter } from "./web/trace.js";
import { ledgerRouter } from "./web/ledger.js";
import { deliveriesRouter } from "./web/deliveries.js";
import { dockRouter } from "./web/dock.js";
import { disputesRouter } from "./web/disputes.js";
import { negotiationsRouter } from "./web/negotiations.js";
import { merchantRouter } from "./web/merchant.js";
import { personByKey } from "./web/auth.js";
import { agentIdOf, serveMcp } from "./mcp/http.js";
import { buildServer } from "./mcp/tools.js";
import { installChannelHandlers } from "./channels/handlers.js";
import { uiRouter } from "./web/ui-api.js";
import { askRouter } from "./web/ask.js";
import { protectedRouter } from "./web/protected.js";
import { talksRouter } from "./web/talks.js";
import { publicRouter } from "./web/public.js";
import { config } from "./config.js";
import { demoRouter, refuseShowcaseWrites, workspaceMiddleware } from "./demo/routes.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spaDir = join(root, "web", "dist");

/** Pages the React front end owns. Everything else (guard, ledger, deliveries, dock, safety, evidence…) stays server-rendered in the same identity. */
export const SPA_PATHS = ["/", "/start", "/login", "/home", "/approvals", "/po/new", "/po/:id", "/po/:id/receive", "/stock", "/catalog", "/performance", "/demo", "/judge", "/about", "/ask", "/proof", "/ai", "/paypal", "/who-can-move-money", "/accessibility", "/agents", "/negotiations", "/negotiations/:id"];

/**
 * The front end posts to the same handlers as the old forms, with `X-StockSure-UI: 1`. For those requests a redirect
 * becomes JSON: `{ ok, message, to }`, where ok/message come from the ok= / err= flash the handler put on the URL.
 */
function uiJsonMode(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.get("x-stocksure-ui") !== "1") return next();
  (res as any).redirect = (a: unknown, b?: unknown) => {
    const url = String(typeof a === "number" ? b : a);
    const external = /^https?:\/\//.test(url) && !url.startsWith(config.appUrl);
    if (external) return res.json({ ok: true, message: "", to: url, external: true });
    const parsed = new URL(url, "http://local");
    const err = parsed.searchParams.get("err");
    const okm = parsed.searchParams.get("ok");
    parsed.searchParams.delete("ok");
    parsed.searchParams.delete("err");
    const to = parsed.pathname + parsed.search + parsed.hash;
    if (parsed.pathname === "/login" && req.path !== "/login" && !req.path.startsWith("/demo/")) return res.status(401).json({ ok: false, message: "Sign in first.", to, auth: true });
    res.json({ ok: !err, message: err ?? okm ?? "", to });
  };
  next();
}

export function createApp() {
  installChannelHandlers();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  // Gzip text responses (HTML, JSON, JS, CSS). Nothing here streams, so buffering per response is fine.
  app.use(compression());
  app.use(express.json({ limit: "200kb" }));
  app.use(express.urlencoded({ extended: false, limit: "200kb" }));
  app.use(cookieParser());
  // Spec A1: every request below runs inside the visitor's private workspace (or the base schema).
  app.use(workspaceMiddleware());
  app.use(refuseShowcaseWrites());
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  app.use("/static", express.static(join(root, "public"), { maxAge: 0, setHeaders: (res, file) => { if (/[\\/]safety[\\/]/.test(file)) res.setHeader("Cache-Control", "public, max-age=86400"); } }));
  // Spec A4: the health check reads the database and names the build, so a keep-warm ping proves both.
  app.get("/healthz", async (_req, res) => {
    const t0 = Date.now();
    try {
      await (await getDb()).query("SELECT 1");
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, db: "ok", db_ms: Date.now() - t0, commit: config.commit || null, uptime_s: Math.round(process.uptime()) });
    } catch (e) {
      console.error("[stocksure healthz]", (e as Error).message);
      res.status(500).json({ ok: false, db: "error", error: "The database did not answer.", commit: config.commit || null });
    }
  });
  app.post("/webhooks/paypal", (req, res, next) => receiveWebhook(req, res).catch(next));
  app.all("/mcp", async (req, res, next) => {
    try {
      const m = /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "");
      const p = m ? await personByKey(m[1]) : null;
      if (!p) return res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Authorization: Bearer <ssk_ key> required. Keys are on the demo page." }, id: null });
      const agentId = agentIdOf(req);
      await serveMcp(req, res, () => buildServer(p, agentId));
    } catch (e) {
      next(e);
    }
  });
  app.use(uiJsonMode);
  app.use("/assets", express.static(join(spaDir, "assets"), { maxAge: "1y", immutable: true }));
  app.use("/fonts", express.static(join(spaDir, "fonts"), { maxAge: "1y", immutable: true }));
  for (const f of ["favicon.svg"]) app.get(`/${f}`, (_req, res) => (existsSync(join(spaDir, f)) ? res.setHeader("Cache-Control", "public, max-age=86400").sendFile(join(spaDir, f)) : res.redirect("/static/icon.svg")));
  // Each front-end page is its own route (so the journey test proves every one is reachable); all serve index.html.
  const spa = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith("/api/")) return next();
    const index = join(spaDir, "index.html");
    res.setHeader("Cache-Control", "no-cache");
    if (existsSync(index)) return res.sendFile(index);
    // Tests and a fresh checkout run without the built front end: say so instead of a blank page.
    res.type("html").send(`<!doctype html><meta charset="utf-8"><title>StockSure</title><p>The StockSure front end is not built. Run <code>npm run build</code>.</p>`);
  };
  for (const p of SPA_PATHS) app.get(p, spa);
  app.use(demoRouter());
  app.use(publicRouter());
  app.use(askRouter());
  app.use(talksRouter());
  app.use(protectedRouter());
  app.use(uiRouter());
  app.use(merchantRouter());
  app.use(guardRouter());
  app.use(safetyRouter());
  app.use(traceRouter());
  app.use(ledgerRouter());
  app.use(deliveriesRouter());
  app.use(dockRouter());
  app.use(disputesRouter());
  app.use(negotiationsRouter());
  app.use(routes());
  // Unknown page: the front end's own "not found" screen, with a real 404 status.
  app.get("*", (req, res, next) => {
    const index = join(spaDir, "index.html");
    if (req.method !== "GET" || req.accepts(["html", "json"]) !== "html" || !existsSync(index)) return next();
    res.status(404).setHeader("Cache-Control", "no-cache");
    res.sendFile(index);
  });
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof GtError) return req.accepts(["html", "json"]) === "json" || req.path.startsWith("/api/") ? res.status(err.status).json({ error: err.code, message: err.message }) : res.status(err.status).type("text").send(err.message);
    console.error("[stocksure]", req.method, req.path, err);
    res.status(500).send("Something went wrong.");
  });
  return app;
}
