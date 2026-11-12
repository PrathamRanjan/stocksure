import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useSession } from "@/lib/session";
import { closeTour, tourPath } from "./tours";
import { setJourneyHooks, show } from "./journey";

/** Spec A3.3: a one-page tour ends on any route change. It never starts a tour and never navigates. */
export function TourRunner() {
  const loc = useLocation();
  useEffect(() => {
    const p = tourPath();
    if (p && p !== loc.pathname) closeTour();
  }, [loc.pathname]);
  return <JourneyRunner />;
}

/**
 * The guided journey (tour/journey.ts) moves across pages and people. On every route change it shows the step for
 * this page, if a journey is running. It only ever runs after the visitor pressed a button to start one.
 */
function JourneyRunner() {
  const loc = useLocation();
  const nav = useNavigate();
  const { refresh } = useSession();
  useEffect(() => {
    setJourneyHooks({ navigate: (to) => nav(to), refresh });
  }, [nav, refresh]);
  useEffect(() => {
    const t = setTimeout(() => void show(), 60);
    return () => clearTimeout(t);
  }, [loc.pathname, loc.search]);
  return null;
}
