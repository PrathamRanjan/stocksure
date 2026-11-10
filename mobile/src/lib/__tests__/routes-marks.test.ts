import { describe, expect, it } from "vitest";
import { money, STATUS } from "../format";
import { settlementParts, tallyMarks, tallyText } from "../marks";
import { appTarget } from "../routes";

describe("appTarget", () => {
  it("maps server paths onto app screens", () => {
    expect(appTarget("/po/abc/receive")).toEqual({ kind: "screen", href: "/order/abc/receive" });
    expect(appTarget("/po/abc#resolution")).toEqual({ kind: "screen", href: "/order/abc" });
    expect(appTarget("/home")).toEqual({ kind: "screen", href: "/" });
    expect(appTarget("/approvals")).toEqual({ kind: "screen", href: "/approvals" });
    expect(appTarget("/login?next=/home")).toEqual({ kind: "screen", href: "/sign-in" });
  });
  it("sends everything else to the web", () => {
    expect(appTarget("/po/new")).toEqual({ kind: "web", path: "/po/new" });
    expect(appTarget("/guard")).toEqual({ kind: "web", path: "/guard" });
    expect(appTarget("https://www.sandbox.paypal.com/a")).toEqual({ kind: "web", path: "https://www.sandbox.paypal.com/a" });
    expect(appTarget(undefined)).toEqual({ kind: "stay" });
  });
});

describe("tally", () => {
  it("shows ordered marks until counted", () => {
    const t = { ordered: 3, accepted: null, damaged: null, wrong: null, short: null };
    expect(tallyMarks(t)).toEqual(["ordered", "ordered", "ordered"]);
    expect(tallyText(t)).toBe("3 ordered, not counted yet");
  });
  it("orders accepted, damaged, wrong, short", () => {
    const t = { ordered: 10, accepted: 7, damaged: 1, wrong: 0, short: 2 };
    expect(tallyMarks(t)).toEqual([...Array(7).fill("accepted"), "damaged", "short", "short"]);
    expect(tallyText(t)).toBe("7 accepted, 1 damaged, 2 short, of 10 ordered");
  });
});

describe("settlementParts", () => {
  it("nets refunds, splits held from being-released and caps at the limit", () => {
    const s = settlementParts({ limit_cents: 20000, captured_cents: 18000, refunded_cents: 1000, held_cents: 2400, inflight_cents: 0, expected: [{ label: "release", cents: 2000 }], spendable_cents: 0 });
    expect(s.captured).toBe(17000);
    expect(s.expected).toBe(2000);
    expect(s.heldOnly).toBe(400);
    expect(s.frac(40000)).toBe(1);
  });
});

describe("format", () => {
  it("formats integer cents", () => {
    expect(money(18000)).toBe("$180.00");
    expect(money(-250)).toBe("−$2.50");
    expect(money(null)).toBe("—");
  });
  it("labels every order state", () => {
    for (const s of ["draft", "quoted", "funded", "dispatched", "resolving", "closed", "exception"]) expect(STATUS[s]?.label).toBeTruthy();
  });
});
