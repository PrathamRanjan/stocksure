import { createContext, useContext, type ReactNode } from "react";
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

const Ctx = createContext<{ session: Session | null; loading: boolean; refresh: () => void }>({ session: null, loading: true, refresh: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const v = useView<Session>("/api/ui/session", { poll: 20000 });
  return <Ctx.Provider value={{ session: v.data, loading: v.loading && !v.data, refresh: () => v.reload(true) }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
