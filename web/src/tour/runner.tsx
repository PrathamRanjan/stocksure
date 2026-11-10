import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useSession } from "@/lib/session";
import { SEEN, hide, readState, showStep, startTour, stepsOf } from "./tours";

/** Keeps a running tour on the right page and step; starts Judge Mode from ?tour=judge. */
export function TourRunner() {
  const loc = useLocation();
  const nav = useNavigate();
  const { refresh, session } = useSession();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    addEventListener("ss-tour", on);
    return () => removeEventListener("ss-tour", on);
  }, []);
  useEffect(() => {
    const q = new URLSearchParams(loc.search);
    const kind = q.get("tour");
    if (kind === "judge" || kind === "product") {
      q.delete("tour");
      nav({ pathname: loc.pathname, search: q.toString() }, { replace: true });
      void startTour(kind);
    }
  }, [loc.search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const s = readState();
    if (!s) return hide();
    const step = stepsOf(s)[s.i];
    if (!step) return hide();
    const want = step.path(s.ctx);
    if (want && want !== loc.pathname) {
      refresh();
      nav(want);
      return;
    }
    void showStep(s, (p) => nav(p));
  }, [tick, loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  // First run: each person gets a short product tour on their first visit to /home, unless they said never again.
  const role = session?.who?.role;
  useEffect(() => {
    if (!role || loc.pathname !== "/home" || readState()) return;
    try {
      if (localStorage.getItem(SEEN(role)) || sessionStorage.getItem(`ss-tour-skip-${role}`)) return;
    } catch {
      return;
    }
    const t = setTimeout(() => {
      if (!readState()) void startTour("product");
    }, 900);
    return () => clearTimeout(t);
  }, [role, loc.pathname]);
  return null;
}
