import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { act } from "./api";
import { useSession } from "./session";

const SPA = [/^\/$/, /^\/login$/, /^\/home$/, /^\/approvals$/, /^\/po\/new$/, /^\/po\/[^/]+$/, /^\/po\/[^/]+\/receive$/, /^\/stock$/, /^\/catalog$/, /^\/performance$/, /^\/demo$/, /^\/judge$/, /^\/about$/, /^\/negotiations(\/[^/]+)?$/, /^\/ask$/, /^\/proof$/];
export const isSpaPath = (to: string) => SPA.some((r) => r.test(to.split(/[?#]/)[0]));

/**
 * Runs a POST against the existing server handlers and does what a redirect would have done:
 * a toast with the server's own message, then reload the view or move to the page the server named.
 */
export function useAction(reload?: () => void) {
  const nav = useNavigate();
  const { refresh } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  async function run(key: string, path: string, data: Parameters<typeof act>[1] = {}, opts: { stay?: boolean; quiet?: boolean } = {}) {
    setBusy(key);
    const r = await act(path, data);
    setBusy(null);
    if (r.external && r.to) {
      location.href = r.to;
      return r;
    }
    if (r.auth) {
      toast.error(r.message || "Sign in first.");
      nav(`/login?next=${encodeURIComponent(location.pathname)}`);
      return r;
    }
    if (r.message && !(opts.quiet && r.ok)) (r.ok ? toast.success : toast.error)(r.message);
    refresh();
    const to = r.to?.split("#")[0];
    if (to && !opts.stay && to !== location.pathname) {
      if (isSpaPath(to)) nav(r.to!);
      else location.href = r.to!;
    } else reload?.();
    return r;
  }
  return { run, busy };
}
