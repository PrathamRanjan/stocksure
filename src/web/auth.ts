import type { NextFunction, Request, Response } from "express";
import { getDb } from "../db.js";
import { sign, unsign } from "../lib/crypto.js";
import { hashKey } from "../lib/util.js";
import { personById, type Person } from "../store.js";

export const COOKIE = "ss_who";

export async function me(req: Request): Promise<Person | null> {
  const v = unsign(req.cookies?.[COOKIE]);
  if (!v) return null;
  return personById(await getDb(), v);
}

export async function personByKey(key: string): Promise<Person | null> {
  const db = await getDb();
  const r = (await db.query<{ id: string }>("SELECT id FROM people WHERE key_hash = $1", [hashKey(key.trim())])).rows[0];
  return r ? personById(db, r.id) : null;
}

export function signIn(res: Response, p: Person, secure: boolean) {
  res.cookie(COOKIE, sign(p.id), { httpOnly: true, sameSite: "lax", secure, maxAge: 7 * 864e5, path: "/" });
}

export function signOut(res: Response) {
  res.clearCookie(COOKIE, { path: "/" });
}

export type Authed = (req: Request, res: Response, p: Person) => Promise<unknown>;

/** Page wrapper that requires a signed-in person. */
export function authed(fn: Authed) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const p = await me(req);
      if (!p) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl.slice(0, 200))}`);
      await fn(req, res, p);
    } catch (e) {
      next(e);
    }
  };
}

export const whoOf = (p: Person | null) => (p ? { name: p.name, org: p.org_name ?? "", kind: p.org_kind ?? "buyer", role: p.role } : null);
