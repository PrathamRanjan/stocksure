/**
 * Supplier agent (roadmap S4): starts at catalog, comes down toward the buyer's offer by half the gap, never below
 * the floor. Pure: the runtime applies the floor guard and records the round.
 */
import type { PoLine } from "../store.js";
import { catalogOffer, type Offer } from "./negotiate.js";

export function supplierOpening(lines: PoLine[]): Offer {
  return catalogOffer(lines);
}

export function supplierCounter(lines: PoLine[], lastSupplier: Offer, buyerOffer: Offer, floorPct: number): Offer {
  const out: Offer = {};
  for (const l of lines) {
    const floor = Math.round((l.product.price_cents * floorPct) / 100);
    const gap = Math.max(0, lastSupplier[l.id] - buyerOffer[l.id]);
    const next = lastSupplier[l.id] - Math.ceil(gap / 2);
    out[l.id] = Math.max(floor, next);
  }
  return out;
}
