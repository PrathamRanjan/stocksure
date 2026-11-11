/**
 * Spec B4 item 4: open the receive page on a phone. The signed-in buyer gets a QR code for a link that signs the
 * phone in as the receiver (never the owner) on that one order. The link is single-use, lasts 15 minutes and works
 * only inside the visitor's own demo workspace.
 */
import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import QRCode from "qrcode";
import { config } from "../config.js";
import { getDb, withWorkspace } from "../db.js";
import { sign, unsign } from "../lib/crypto.js";
import { GtError } from "../lib/util.js";
import { getPo, personById, putSetting, setting } from "../store.js";
import { currentWs } from "../db.js";
import { liveWorkspace } from "../demo/workspaces.js";
import { WS_COOKIE } from "../demo/routes.js";
import { me, signIn } from "./auth.js";

const TTL_MS = 15 * 60_000;

export function phoneRouter() {
  const r = Router();

  r.get("/api/ui/po/:id/phone-link", async (req: Request, res: Response) => {
    try {
      const p = await me(req);
      if (!p) throw new GtError("Sign in first.", "unauthorized", 401);
      if (p.org_kind !== "buyer") throw new GtError("Only the café's team counts deliveries.", "forbidden", 403);
      const ws = currentWs();
      if (!config.demoMode || !ws) throw new GtError("Phone links are for your own demo only.", "unavailable", 404);
      const db = await getDb();
      const po = await getPo(db, String(req.params.id));
      if (po.buyer_id !== p.org_id) throw new GtError("Order not found", "not_found", 404);
      // The phone is signed in as this café's receiver: counting is all it can do.
      const receiver = (await db.query<{ id: string }>("SELECT id FROM people WHERE org_id = $1 AND role = 'receiving' ORDER BY id LIMIT 1", [p.org_id])).rows[0];
      if (!receiver) throw new GtError("This café has no receiver to sign the phone in as.", "unavailable", 409);
      const nonce = randomBytes(9).toString("base64url");
      const exp = Date.now() + TTL_MS;
      await putSetting(db, `phone:${nonce}`, JSON.stringify({ person: receiver.id, po: po.id, exp, used: false }));
      const url = `${config.appUrl}/phone/${sign(`${ws}~${nonce}`)}`;
      const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      res.setHeader("Cache-Control", "no-store").json({ url, svg, expires_at: new Date(exp).toISOString(), as: "the receiver (counts only)" });
    } catch (e) {
      const g = e instanceof GtError ? e : null;
      if (!g) console.error("[stocksure phone]", e);
      res.status(g?.status ?? 500).json({ error: g?.code ?? "error", message: g?.message ?? "Something went wrong." });
    }
  });

  r.get("/phone/:token", async (req: Request, res: Response) => {
    const bad = (msg: string) => res.status(410).type("text/plain").send(`${msg} Make a new QR code on the receive page.`);
    const v = unsign(String(req.params.token));
    const [ws, nonce] = (v ?? "").split("~");
    if (!ws || !nonce) return bad("That phone link isn't valid.");
    const w = await liveWorkspace(ws);
    if (!w || w.kind !== "visitor") return bad("That demo has closed.");
    const out = await withWorkspace(ws, async () => {
      const db = await getDb();
      const raw = await setting(db, `phone:${nonce}`);
      const link = raw ? JSON.parse(raw) : null;
      if (!link || link.used || Date.now() > link.exp) return null;
      await putSetting(db, `phone:${nonce}`, JSON.stringify({ ...link, used: true }));
      const person = await personById(db, link.person);
      return person && person.role === "receiving" ? { person, po: link.po as string } : null;
    });
    if (!out) return bad("That phone link has been used or has expired.");
    res.cookie(WS_COOKIE, sign(ws), { httpOnly: true, sameSite: "lax", secure: config.appUrl.startsWith("https://"), maxAge: 7 * 864e5, path: "/" });
    signIn(res, out.person, config.appUrl.startsWith("https://"));
    res.redirect(`/po/${out.po}/receive?phone=1`);
  });

  return r;
}
