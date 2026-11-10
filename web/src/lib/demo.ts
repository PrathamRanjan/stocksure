import { useView } from "@/lib/api";

/** GET /api/ui/workspace: the visitor's private demo (spec A1), how far its seeding got, and the saved wallet. */
export interface WorkspaceInfo {
  demo: boolean;
  workspace: {
    id: string;
    kind: "visitor" | "showcase";
    state: "seeding" | "ready" | "failed" | "expired";
    created_at: string;
    expires_at: string;
    idle_hours: number;
    join_url: string;
  } | null;
  seed: { expected: number; confirmed: number; step: string; done: boolean; stopped: string | null; wallet: boolean } | null;
  wallet: { configured: false } | { configured: true; status: "ok" | "missing" | "unchecked" | "error"; payer: string; checked_at: string | null };
}

export function useWorkspace(poll: number | false = false) {
  return useView<WorkspaceInfo>("/api/ui/workspace", { poll });
}

/** Starts (or reuses) this visitor's private demo. The server sets the workspace cookie. */
export async function startDemo(fresh = false): Promise<{ ok: boolean; message: string; to?: string }> {
  try {
    const r = await fetch("/demo/start", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "X-StockSure-UI": "1" },
      body: new URLSearchParams(fresh ? { fresh: "1" } : {}),
    });
    const j = await r.json().catch(() => null);
    return { ok: r.ok && !!j?.ok, message: j?.message ?? `The server answered ${r.status}.`, to: j?.to };
  } catch {
    return { ok: false, message: "You're offline or the server didn't answer. Nothing was started; try again." };
  }
}

/** "4 of 6 payments confirmed by PayPal", or why there are none. */
export function seedLine(w: WorkspaceInfo): string {
  const s = w.seed;
  if (!s) return "";
  if (!s.wallet) return "No saved sandbox wallet is available, so nothing was paid in advance. Connect PayPal on PayPal's own page when you accept a quote.";
  if (s.stopped) return `Seeding stopped after ${s.confirmed} of ${s.expected} payments: ${s.stopped}`;
  return `${s.confirmed} of ${s.expected} payments confirmed by PayPal${s.done ? "" : ` · ${s.step}`}`;
}
