import express from "express";
import cookieParser from "cookie-parser";
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function createApp() {
  installChannelHandlers();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "200kb" }));
  app.use(express.urlencoded({ extended: false, limit: "200kb" }));
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  app.use("/static", express.static(join(root, "public"), { maxAge: 0, setHeaders: (res, file) => { if (/[\\/]safety[\\/]/.test(file)) res.setHeader("Cache-Control", "public, max-age=86400"); } }));
  app.get("/healthz", async (_req, res) => {
    try {
      await (await getDb()).query("SELECT 1");
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
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
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof GtError) return req.accepts(["html", "json"]) === "json" || req.path.startsWith("/api/") ? res.status(err.status).json({ error: err.code, message: err.message }) : res.status(err.status).type("text").send(err.message);
    console.error("[stocksure]", req.method, req.path, err);
    res.status(500).send("Something went wrong.");
  });
  return app;
}
