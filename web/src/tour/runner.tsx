import { useEffect } from "react";
import { useLocation } from "react-router";
import { closeTour, tourPath } from "./tours";

/** Spec A3.3: a running tour ends on any route change. It never starts a tour and never navigates. */
export function TourRunner() {
  const loc = useLocation();
  useEffect(() => {
    const p = tourPath();
    if (p && p !== loc.pathname) closeTour();
  }, [loc.pathname]);
  return null;
}
