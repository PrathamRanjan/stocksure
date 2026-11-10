/**
 * The app's contract with the StockSure server, the same one the web front end uses:
 *  - read-only view models from `GET /api/ui/*`;
 *  - actions through the existing form handlers, with `X-StockSure-UI: 1` so the server answers
 *    `{ ok, message, to, external?, auth? }` instead of redirecting (see `uiJsonMode` in `src/app.ts`).
 * Money is never computed here. This module has no React Native imports so it can be unit-tested.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public auth = false,
  ) {
    super(message);
  }
}

export interface ActResult {
  ok: boolean;
  message: string;
  to?: string;
  external?: boolean;
  auth?: boolean;
}

export type Fields = Record<string, string | string[] | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const OFFLINE = "You're offline or the server didn't answer. Nothing was sent; try again.";
export const WAKING = "The server is waking up. This can take about 20 seconds the first time.";

export function encodeForm(data: Fields): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.append(k, v);
  }
  return p.toString();
}

/** Join the server base and a path, keeping absolute URLs (e.g. PayPal approval links) as they are. */
export function resolve(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Interpret any server answer to a POST as an ActResult; never throws. */
export async function readAct(r: Response): Promise<ActResult> {
  const text = await r.text();
  let j: any = null;
  try {
    j = JSON.parse(text);
  } catch {
    /* plain-text error from an older handler */
  }
  if (j && typeof j.ok === "boolean") return j as ActResult;
  if (j && j.message) return { ok: false, message: String(j.message), auth: r.status === 401 };
  if (r.status === 401) return { ok: false, message: "Sign in first.", auth: true };
  if (!r.ok) return { ok: false, message: text.replace(/<[^>]+>/g, " ").trim().slice(0, 200) || `Request failed (${r.status})` };
  return { ok: true, message: "" };
}

export function createClient(opts: { base: () => string; fetch?: FetchLike; timeoutMs?: number }) {
  const f: FetchLike = opts.fetch ?? ((i, init) => fetch(i, init));
  const timeout = opts.timeoutMs ?? 45_000;

  async function withTimeout(url: string, init: RequestInit): Promise<Response> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      return await f(url, { ...init, signal: init.signal ?? ctl.signal, credentials: "include" });
    } finally {
      clearTimeout(t);
    }
  }

  async function get<T>(path: string): Promise<T> {
    let r: Response;
    try {
      r = await withTimeout(resolve(opts.base(), path), { headers: { Accept: "application/json" } });
    } catch {
      throw new ApiError(OFFLINE, 0);
    }
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(body?.message ?? `Request failed (${r.status})`, r.status, r.status === 401);
    return body as T;
  }

  async function act(path: string, data: Fields | FormData = {}): Promise<ActResult> {
    const headers: Record<string, string> = { "X-StockSure-UI": "1", Accept: "application/json" };
    let body: BodyInit;
    if (typeof FormData !== "undefined" && data instanceof FormData) body = data;
    else {
      body = encodeForm(data as Fields);
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    try {
      return await readAct(await withTimeout(resolve(opts.base(), path), { method: "POST", headers, body }));
    } catch {
      return { ok: false, message: OFFLINE };
    }
  }

  return { get, act };
}
