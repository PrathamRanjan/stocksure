/**
 * The deployed server applies the calibration committed in eval/calibration/*.json (spec A5.2: thresholds live in
 * data). A row is written only when the file differs from what the table holds, so a calibration run on any
 * machine reaches production through a commit, not by hand.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { saveThreshold, thresholds } from "../ai/decisions.js";

export async function applyCommittedCalibration(dir = "eval/calibration"): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const have = await thresholds();
  const applied: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const t = r.threshold;
      if (!t?.name) continue;
      const cur = have.get(t.name);
      if (cur?.source === "calibrated" && cur.calibrated_on === t.calibrated_on) continue;
      await saveThreshold(t);
      applied.push(t.name);
    } catch (e) {
      console.error("[stocksure calibration]", f, (e as Error).message);
    }
  }
  return applied;
}
