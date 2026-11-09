import { StrictMode, Suspense, lazy, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import "./index.css";
import { ThemeProvider } from "@/lib/theme";
import { SessionProvider, useSession } from "@/lib/session";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/shell";
import { LoadingBlock } from "@/components/brand";
import { TourRunner } from "@/tour/runner";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Home from "@/pages/Home";

const Order = lazy(() => import("@/pages/Order"));
const Receive = lazy(() => import("@/pages/Receive"));
const NewOrder = lazy(() => import("@/pages/NewOrder"));
const Approvals = lazy(() => import("@/pages/Approvals"));
const Stock = lazy(() => import("@/pages/Stock"));
const Catalog = lazy(() => import("@/pages/Catalog"));
const Performance = lazy(() => import("@/pages/Performance"));
const Demo = lazy(() => import("@/pages/Demo"));
const Judge = lazy(() => import("@/pages/Judge"));
const NotFound = lazy(() => import("@/pages/NotFound"));

declare global {
  interface Window {
    a11yKit?: { apply: () => void; firstVisit: () => void };
  }
}

/** ?ok= / ?err= from server redirects (e.g. PayPal connect return) become toasts; scroll and a11y kit reset on route change. */
function RouteEffects() {
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    const q = new URLSearchParams(loc.search);
    const ok = q.get("ok");
    const err = q.get("err");
    if (ok || err) {
      if (ok) toast.success(ok);
      if (err) toast.error(err);
      q.delete("ok");
      q.delete("err");
      nav({ pathname: loc.pathname, search: q.toString(), hash: loc.hash }, { replace: true });
    }
  }, [loc.search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loc.hash) scrollTo({ top: 0 });
    const t = setTimeout(() => window.a11yKit?.apply(), 500);
    return () => clearTimeout(t);
  }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Signed-in pages: the app frame, and a sign-in redirect when there is no session. */
function Authed({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const loc = useLocation();
  if (loading && !session)
    return (
      <AppShell>
        <LoadingBlock />
      </AppShell>
    );
  if (!session?.who) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return (
    <AppShell>
      <Suspense fallback={<LoadingBlock />}>{children}</Suspense>
    </AppShell>
  );
}

const Lazy = ({ children }: { children: ReactNode }) => <Suspense fallback={null}>{children}</Suspense>;

function App() {
  return (
    <>
      <RouteEffects />
      <TourRunner />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/about" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/home" element={<Authed><Home /></Authed>} />
        <Route path="/po/new" element={<Authed><NewOrder /></Authed>} />
        <Route path="/po/:id" element={<Authed><Order /></Authed>} />
        <Route path="/po/:id/receive" element={<Authed><Receive /></Authed>} />
        <Route path="/approvals" element={<Authed><Approvals /></Authed>} />
        <Route path="/stock" element={<Authed><Stock /></Authed>} />
        <Route path="/catalog" element={<Authed><Catalog /></Authed>} />
        <Route path="/performance" element={<Authed><Performance /></Authed>} />
        <Route path="/demo" element={<Lazy><Demo /></Lazy>} />
        <Route path="/judge" element={<Lazy><Judge /></Lazy>} />
        <Route path="*" element={<Lazy><NotFound /></Lazy>} />
      </Routes>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <SessionProvider>
          <TooltipProvider delayDuration={250}>
            <App />
            <Toaster position="top-center" richColors closeButton />
          </TooltipProvider>
        </SessionProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
