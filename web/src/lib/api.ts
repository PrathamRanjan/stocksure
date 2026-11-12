import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(message: string, public status: number, public auth = false) {
    super(message);
  }
}

/** GET a view model from /api/ui/*. */
export async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, { headers: { Accept: "application/json" }, credentials: "same-origin", signal });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(body?.message ?? `Request failed (${r.status})`, r.status, r.status === 401);
  return body as T;
}

export interface ActResult {
  ok: boolean;
  message: string;
  to?: string;
  external?: boolean;
  auth?: boolean;
}

/**
 * POST to the same handlers the server forms used. The `X-StockSure-UI` header makes the server answer
 * `{ ok, message, to }` instead of redirecting. Pass a FormData for uploads.
 */
export async function act(path: string, data: Record<string, string | string[] | undefined> | FormData = {}): Promise<ActResult> {
  let body: BodyInit;
  const headers: Record<string, string> = { "X-StockSure-UI": "1", Accept: "application/json" };
  if (data instanceof FormData) body = data;
  else {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
      else p.append(k, v);
    }
    body = p;
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  let r: Response;
  try {
    r = await fetch(path, { method: "POST", body, headers, credentials: "same-origin" });
  } catch {
    return { ok: false, message: "You're offline or the server didn't answer. Nothing was sent; try again." };
  }
  const text = await r.text();
  let j: any = null;
  try {
    j = JSON.parse(text);
  } catch {
    /* plain-text error from an older handler */
  }
  if (j && typeof j.ok === "boolean") return j;
  if (j && j.message) return { ok: false, message: j.message, auth: r.status === 401 };
  if (!r.ok) return { ok: false, message: text.slice(0, 200) || `Request failed (${r.status})` };
  return { ok: true, message: "" };
}

/** Load a view model; reload on demand; poll while `poll` is set (money in flight). */
export function useView<T>(path: string | null, opts: { poll?: number | false } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // The newest request whose answer is on screen. An answer is applied unless a newer one already was: dropping
  // every superseded answer left the old data showing while a slow newer request was still out (a background poll
  // starting just after a sign-in refresh made the app think nobody was signed in).
  const applied = useRef(0);
  const load = useCallback(
    async (quiet = false) => {
      if (!path) return;
      const n = ++seq.current;
      if (!quiet) setLoading(true);
      try {
        const d = await getJSON<T>(path);
        if (n > applied.current) {
          applied.current = n;
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (n === seq.current) setError(e instanceof ApiError ? e : new ApiError(String(e), 0));
      } finally {
        if (n === seq.current) setLoading(false);
      }
    },
    [path],
  );
  useEffect(() => {
    // A new path: answers still out for the old one must never be shown.
    applied.current = seq.current;
    setData(null);
    load();
  }, [load]);
  useEffect(() => {
    if (!opts.poll) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && document.documentElement.dataset.a11yExtraTime !== "on") load(true);
    }, opts.poll);
    return () => clearInterval(t);
  }, [opts.poll, load]);
  return { data, error, loading, reload: load, setData };
}
