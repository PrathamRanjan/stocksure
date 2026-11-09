/**
 * Buyer agent (roadmap S4): opens below catalog and concedes toward the supplier's ask within the mandate.
 * Pure: the runtime applies the guard and records the round.
 */
import type { Rules } from "../guard/policy.js";
import type { PoLine } from "../store.js";
import { catalogOffer, type Offer } from "./negotiate.js";

const pctOf = (cents: number, pct: number) => Math.round((cents * pct) / 100);

export function buyerOpening(lines: PoLine[], rules: Rules): Offer {
  // Ask for a discount about twice the concession step, so there is room to move and still land near catalog.
  const discount = Math.min(12, Math.max(3, Math.min(rules.max_concession_pct, 12)));
  const cat = catalogOffer(lines);
  return Object.fromEntries(lines.map((l) => [l.id, cat[l.id] - pctOf(cat[l.id], discount)]));
}

/**
 * Counter-offer. `closing` is true in the last two rounds: a standing ask inside the mandate's ceiling is then
 * accepted outright (taking an offer already on the table is not a concession beyond the mandate).
 */
export function buyerCounter(lines: PoLine[], rules: Rules, lastBuyer: Offer, lastSupplier: Offer, closing = false): Offer {
  const out: Offer = {};
  for (const l of lines) {
    const ceiling = l.product.price_cents + pctOf(l.product.price_cents, rules.max_over_catalog_pct);
    if (closing && lastSupplier[l.id] <= ceiling) {
      out[l.id] = lastSupplier[l.id];
      continue;
    }
    const gap = Math.max(0, lastSupplier[l.id] - lastBuyer[l.id]);
    // Concede the allowed share of the gap; close the last cent when the gap is tiny.
    const move = gap <= 2 ? gap : pctOf(gap, rules.max_concession_pct);
    out[l.id] = lastBuyer[l.id] + move;
  }
  return out;
}
