import type { Need } from "./resolve.js";
import type { BaseUnit } from "./units.js";

/**
 * Replacement planner. Pure. For each shortfall it finds products (the original or an approved substitute) that
 * satisfy quantity, pack size, deadline and the remaining budget, and explains every candidate it rejects.
 */
export interface CatItem {
  id: string;
  sku: string;
  name: string;
  family: string;
  base_unit: BaseUnit;
  pack_units: number;
  pack_label: string;
  price_cents: number;
  stock_packs: number;
  lead_hours: number;
  active: boolean;
}

export interface Pick {
  line_id: string;
  product_id: string;
  sku: string;
  name: string;
  packs: number;
  units: number;
  over_units: number;
  pack_price_cents: number;
  cents: number;
  eta: string;
}

export interface Plan {
  picks: Pick[];
  unfilled_units: number;
  /** Shortfall as a share of each line's need, summed: comparable across grams, litres and each. */
  unfilled_share: number;
  cost_cents: number;
  over_units: number;
  eta_max: string | null;
}

export interface Blocked {
  line_id: string;
  product_id: string;
  sku: string;
  name: string;
  reason: string;
}

export interface PlanResult {
  plans: Plan[];
  blocked: Blocked[];
  budget_cents: number;
  /** False when the combination limit stopped the search: the first plan is the best found, not proven best. */
  complete: boolean;
}

type LineOption = { picks: Pick[]; unfilled: number };

const MAX_COMBOS = 50_000;

function pick(need: Need, p: CatItem, packs: number, units: number, eta: Date): Pick {
  return { line_id: need.line_id, product_id: p.id, sku: p.sku, name: p.name, packs, units: packs * p.pack_units, over_units: Math.max(0, packs * p.pack_units - units), pack_price_cents: p.price_cents, cents: packs * p.price_cents, eta: eta.toISOString() };
}

export function plan(needs: (Need & { needed_by: Date })[], catalog: CatItem[], budgetCents: number, now: Date = new Date()): PlanResult {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const blocked: Blocked[] = [];
  const perNeed: LineOption[][] = [];
  for (const need of needs) {
    const orig = byId.get(need.product_id);
    if (!orig) throw new Error(`Unknown product ${need.product_id}`);
    const usable: { p: CatItem; eta: Date }[] = [];
    const block = (p: CatItem, reason: string) => blocked.push({ line_id: need.line_id, product_id: p.id, sku: p.sku, name: p.name, reason });
    // Approved products first, then same-family products so the buyer sees why they were not used.
    const considered = [...need.allowed.map((id) => byId.get(id)).filter((x): x is CatItem => Boolean(x)), ...catalog.filter((c) => c.family && c.family === orig.family && !need.allowed.includes(c.id))];
    for (const p of considered) {
      if (!need.allowed.includes(p.id)) {
        block(p, "not an approved substitute");
        continue;
      }
      if (!p.active) {
        block(p, "discontinued");
        continue;
      }
      if (p.base_unit !== orig.base_unit) {
        block(p, `different unit (${p.base_unit} vs ${orig.base_unit})`);
        continue;
      }
      if (p.stock_packs <= 0) {
        block(p, "out of stock");
        continue;
      }
      const eta = new Date(now.getTime() + p.lead_hours * 3_600_000);
      if (eta > need.needed_by) {
        block(p, `arrives after the deadline (${p.lead_hours} h lead time)`);
        continue;
      }
      usable.push({ p, eta });
    }
    const opts: LineOption[] = [{ picks: [], unfilled: need.units }];
    for (const { p, eta } of usable) {
      const full = Math.ceil(need.units / p.pack_units);
      // A smaller, affordable quantity is still useful: offer the most packs the budget can buy (honest remaining shortage).
      const affordable = Math.min(p.stock_packs, full, Math.floor(budgetCents / Math.max(1, p.price_cents)));
      // Every smaller pack count is an option too, so the budget can be split with other lines (up to 12 counts).
      const top = Math.min(full, p.stock_packs) - 1;
      const step = Math.max(1, Math.ceil(top / 12));
      for (let k = Math.min(top, affordable); k >= 1; k -= step) opts.push({ picks: [pick(need, p, k, Math.min(need.units, k * p.pack_units), eta)], unfilled: Math.max(0, need.units - k * p.pack_units) });
      if (p.stock_packs >= full) opts.push({ picks: [pick(need, p, full, need.units, eta)], unfilled: 0 });
      else {
        opts.push({ picks: [pick(need, p, p.stock_packs, need.units, eta)], unfilled: need.units - p.stock_packs * p.pack_units });
        // Top up from a second approved product.
        for (const { p: q, eta: eta2 } of usable) {
          if (q.id === p.id) continue;
          const left = need.units - p.stock_packs * p.pack_units;
          const qp = Math.min(q.stock_packs, Math.ceil(left / q.pack_units));
          if (qp > 0) opts.push({ picks: [pick(need, p, p.stock_packs, p.stock_packs * p.pack_units, eta), pick(need, q, qp, left, eta2)], unfilled: Math.max(0, left - qp * q.pack_units) });
        }
      }
    }
    for (const o of opts) if (o.picks.length && o.picks.reduce((a, x) => a + x.cents, 0) > budgetCents) for (const x of o.picks) if (!blocked.some((b) => b.line_id === need.line_id && b.product_id === x.product_id)) blocked.push({ line_id: need.line_id, product_id: x.product_id, sku: x.sku, name: x.name, reason: `over budget (${x.packs} x $${(x.pack_price_cents / 100).toFixed(2)} = $${(x.cents / 100).toFixed(2)}, $${(budgetCents / 100).toFixed(2)} left)` });
    perNeed.push(opts);
  }

  const plans: Plan[] = [];
  let combos = 0;
  const walk = (i: number, acc: LineOption[]) => {
    if (combos >= MAX_COMBOS) return;
    if (i === perNeed.length) {
      combos++;
      const picks = acc.flatMap((o) => o.picks);
      const cost = picks.reduce((a, x) => a + x.cents, 0);
      if (cost > budgetCents) return;
      // Shared stock across lines.
      const used = new Map<string, number>();
      for (const x of picks) used.set(x.product_id, (used.get(x.product_id) ?? 0) + x.packs);
      for (const [id, n] of used) if (n > (byId.get(id)?.stock_packs ?? 0)) return;
      const etas = picks.map((x) => x.eta).sort();
      plans.push({ picks, unfilled_units: acc.reduce((a, o) => a + o.unfilled, 0), unfilled_share: acc.reduce((a, o, k) => a + o.unfilled / Math.max(1, needs[k].units), 0), cost_cents: cost, over_units: picks.reduce((a, x) => a + x.over_units, 0), eta_max: etas.at(-1) ?? null });
      return;
    }
    for (const o of perNeed[i]) walk(i + 1, [...acc, o]);
  };
  walk(0, []);
  plans.sort((a, b) => a.unfilled_share - b.unfilled_share || a.unfilled_units - b.unfilled_units || a.cost_cents - b.cost_cents || a.over_units - b.over_units || (a.eta_max ?? "").localeCompare(b.eta_max ?? ""));
  // De-duplicate identical pick sets.
  const seen = new Set<string>();
  const unique = plans.filter((p) => {
    const k = p.picks.map((x) => `${x.line_id}:${x.product_id}:${x.packs}`).join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { plans: unique.slice(0, 5), blocked, budget_cents: budgetCents, complete: combos < MAX_COMBOS };
}
