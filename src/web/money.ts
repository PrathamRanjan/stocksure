/** Spec B4 item 5: "Check against PayPal" on an order (GET calls to PayPal only). */
import { Router, type Request, type Response } from "express";
import { GtError } from "../lib/util.js";
import { reconcileOrder } from "../services/reconcile.js";
import { me } from "./auth.js";

export function moneyRouter() {
  const r = Router();
  r.post("/api/ui/po/:id/reconcile", async (req: Request, res: Response) => {
    try {
      const p = await me(req);
      if (!p) throw new GtError("Sign in first.", "unauthorized", 401);
      if (p.role === "receiving") throw new GtError("The owner or the supplier checks payments.", "forbidden", 403);
      res.setHeader("Cache-Control", "no-store").json(await reconcileOrder(p, String(req.params.id)));
    } catch (e) {
      const g = e instanceof GtError ? e : null;
      if (!g) console.error("[stocksure reconcile]", e);
      res.status(g?.status ?? 500).json({ error: g?.code ?? "error", message: g?.message ?? "Something went wrong." });
    }
  });
  return r;
}
