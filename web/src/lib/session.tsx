import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useView } from "./api";

export interface Who {
  id: string;
  name: string;
  first: string;
  org: string;
  org_id: string;
  side: "buyer" | "supplier";
  role: "owner" | "receiving" | "supplier";
  owner: boolean;
}
export interface Session {
  who: Who | null;
  demo: boolean;
  paypal_env: string;
  paypal_ready: boolean;
  reader: string;
  channels: { telegram: boolean; push: boolean };
  paypal: { connected: boolean; payer: string | null } | null;
  counts: { needs: number; approvals: number };
}

const Ctx = createContext<{ session: Session | null; loading: boolean; refresh: () => Promise<void> }>({ session: null, loading: true, refresh: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const v = useView<Session>("/api/ui/session", { poll: 20000 });
  // While a refresh after sign-in or sign-out is in flight the old session is stale, so signed-in pages wait
  // instead of bouncing to /login on the previous (signed-out) answer.
  const [pending, setPending] = useState(0);
  const { reload } = v;
  const refresh = useCallback(async () => {
    setPending((n) => n + 1);
    try {
      await reload(true);
    } finally {
      setPending((n) => n - 1);
    }
  }, [reload]);
  return <Ctx.Provider value={{ session: v.data, loading: (v.loading && !v.data) || pending > 0, refresh }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
