import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useView } from "./api";
import type { Session } from "./types";

interface Ctx {
  session: Session | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const SessionCtx = createContext<Ctx>({ session: null, loading: true, error: null, refresh: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const v = useView<Session>("/api/ui/session", { poll: 30_000 });
  // While a refresh after sign-in or sign-out is in flight, the previous answer is stale; screens wait for it.
  const [pending, setPending] = useState(0);
  const { reload } = v;
  const refresh = useCallback(async () => {
    setPending((n) => n + 1);
    try {
      await reload("quiet");
    } finally {
      setPending((n) => n - 1);
    }
  }, [reload]);
  return (
    <SessionCtx.Provider value={{ session: v.data, loading: v.loading || pending > 0, error: v.error && !v.data ? v.error.message : null, refresh }}>
      {children}
    </SessionCtx.Provider>
  );
}

export const useSession = () => useContext(SessionCtx);
