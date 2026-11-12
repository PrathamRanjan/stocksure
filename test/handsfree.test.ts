// Look and Say's pure logic: the command parser in four languages, the confirm rule, snapping, calibration fit.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain browser ES module, no types
import * as core from "../public/handsfree/core.js";

describe("voice commands", () => {
  it("stop works in every language, with or without the wake word, and even mid-confirm", () => {
    for (const w of ["stop", "Stop!", "ruko", "रुको", "berhenti", "pare", "parar", "Peek stop"]) expect(core.parse(w).kind, w).toBe("stop");
    expect(core.parse("ruko", { confirming: true }).kind).toBe("stop");
  });
  it("Portuguese 'para' (for) is not a stop word", () => {
    expect(core.parse("peek rolar para baixo").kind).toBe("down");
  });
  it("needs the wake word for longer commands, but not for click", () => {
    expect(core.parse("scroll down").kind).toBe("none");
    expect(core.parse("Peak scroll down").kind).toBe("down");
    expect(core.parse("click").kind).toBe("click");
    expect(core.parse("clique").kind).toBe("click");
    expect(core.parse("scroll down", { pushToTalk: true }).kind).toBe("down");
  });
  it("yes and no only count on an open confirm card", () => {
    for (const w of ["yes", "haan", "हाँ", "iya", "sim"]) expect(core.parse(w, { confirming: true }).kind, w).toBe("yes");
    for (const w of ["no", "नहीं", "tidak", "não"]) expect(core.parse(w, { confirming: true }).kind, w).toBe("no");
    expect(core.parse("yes").kind).not.toBe("yes");
    expect(core.parse("click", { confirming: true }).kind).toBe("none");
  });
  it("reorder in four languages", () => {
    for (const w of ["peek reorder this", "Peek order this again", "peek फिर से ऑर्डर", "peek pesan lagi", "peek pedir de novo"]) expect(core.parse(w).kind, w).toBe("reorder");
  });
  it("press a named button, but 'open this' is a click", () => {
    expect(core.parse("peek press ledger")).toEqual({ kind: "press", name: "ledger" });
    expect(core.parse("peek open this").kind).toBe("click");
    expect(core.matchName("ledger", [{ name: "Ledger" }, { name: "Approvals" }])?.name).toBe("Ledger");
    expect(core.matchName("zebra", [{ name: "Ledger" }])).toBeNull();
  });
});

describe("confirm rule (in code)", () => {
  it("money, send, cancel, delete and dispute actions need a confirm card", () => {
    for (const n of ["Accept quote and place hold", "Approve v2", "Release the rest", "Refund $4.00", "Cancel order", "Send message", "Open a dispute", "Order the same again", "Confirm what arrived"]) expect(core.sensitive(n), n).toBe(true);
    for (const n of ["Ledger", "Take the tour", "Stock", "Hands-free"]) expect(core.sensitive(n), n).toBe(false);
    expect(core.sensitive("Save", { type: "submit", formMethod: "post" })).toBe(true);
    expect(core.sensitive("Send", { confirm: "no" })).toBe(false);
  });
});

describe("snapping", () => {
  const targets = [
    { id: "a", rect: { left: 100, top: 100, right: 188, bottom: 144 } },
    { id: "b", rect: { left: 200, top: 100, right: 288, bottom: 144 } },
  ];
  it("picks the control being looked at and does not flicker on noise near the edge", () => {
    const s = new core.Snapper();
    let t = 0, id = null;
    for (let i = 0; i < 10; i++) id = s.sample({ x: 140, y: 122 }, 20, (t += 33), targets);
    expect(id).toBe("a");
    // One stray sample nearer b does not move the highlight.
    expect(s.sample({ x: 205, y: 122 }, 20, (t += 33), targets)).toBe("a");
    expect(s.why).toMatch(/not clearly ahead|^$/);
  });
  it("a jump elsewhere clears old votes, so the new place wins fast", () => {
    const s = new core.Snapper();
    let t = 0;
    for (let i = 0; i < 20; i++) s.sample({ x: 140, y: 122 }, 20, (t += 33), [...targets, { id: "c", rect: { left: 700, top: 500, right: 788, bottom: 544 } }]);
    const id = s.sample({ x: 744, y: 522 }, 20, (t += 33), [...targets, { id: "c", rect: { left: 700, top: 500, right: 788, bottom: 544 } }]);
    expect(id).toBe("c");
    expect(s.why).toBe("");
  });
  it("a confirmed click nudges the drift offset toward the control's centre", () => {
    const s = new core.Snapper();
    s.confirm({ x: 100, y: 100 }, { left: 140, top: 140, right: 160, bottom: 160 });
    expect(s.offset.x).toBeGreaterThan(0);
    expect(s.offset.y).toBeGreaterThan(0);
  });
  it("44 px controls snap better than 30 px ones under the same noise (simulated)", () => {
    const small = core.simulate({ size: 30, noisePx: 60 });
    const big = core.simulate({ size: 44, noisePx: 60 });
    expect(big).toBeGreaterThan(small);
    expect(core.simulate({ size: 44, noisePx: 30 })).toBeGreaterThan(80);
  });
});

describe("calibration", () => {
  // A synthetic face whose head yaw and pitch map linearly to the screen, with noise.
  const make = (dots: number[][], label: string, noise = 0.004) => {
    let seed = 3;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 2;
    const out: any[] = [];
    dots.forEach(([fx, fy], i) => {
      for (let k = 0; k < 20; k++) {
        const x = fx * 1280, y = fy * 800;
        out.push({ dot: `${label}${i}`, x, y, f: { yaw: (640 - x) / 2400 + r() * noise, pitch: (y - 400) / 2500 + r() * noise, gx: (640 - x) / 9000 + r() * noise * 3, gy: (y - 400) / 9000 + r() * noise * 3 } });
      }
    });
    return out;
  };
  it("fits head pointing by cross-validation and measures accuracy on unseen check dots", () => {
    const model = core.fit(make(core.DOTS.calibrate, "c"), "head");
    expect(model).not.toBeNull();
    const px = core.accuracy(model, make(core.DOTS.check, "k"));
    expect(px).toBeLessThan(40);
    expect([0.01, 0.1, 1, 10]).toContain(model.lambda);
  });
  it("defaults to head pointing when gaze is too rough", () => {
    expect(core.chooseMode(200, 60)).toBe("head");
    expect(core.chooseMode(70, 60)).toBe("gaze");
    expect(core.chooseMode(90, 40)).toBe("head");
    expect(core.chooseMode(Infinity, 50)).toBe("head");
  });
  it("notices when the head has moved since calibrating", () => {
    const base = { size: 0.1, cx: 0.5, cy: 0.5 };
    expect(core.headShifted(base, { size: 0.1, cx: 0.51, cy: 0.5 })).toBe(false);
    expect(core.headShifted(base, { size: 0.13, cx: 0.5, cy: 0.5 })).toBe(true);
    expect(core.headShifted(base, { size: 0.1, cx: 0.62, cy: 0.5 })).toBe(true);
  });
});
