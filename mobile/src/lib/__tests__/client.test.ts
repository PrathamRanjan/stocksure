import { describe, expect, it } from "vitest";
import { createClient, encodeForm, OFFLINE, readAct, resolve } from "../client";

const res = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "application/json" } });

describe("encodeForm", () => {
  it("skips undefined and repeats arrays", () => {
    expect(encodeForm({ a: "1", b: undefined, c: ["x", "y"] })).toBe("a=1&c=x&c=y");
  });
});

describe("resolve", () => {
  it("joins base and path and keeps absolute URLs", () => {
    expect(resolve("https://s.test/", "/po/1")).toBe("https://s.test/po/1");
    expect(resolve("", "po/1")).toBe("/po/1");
    expect(resolve("https://s.test", "https://www.sandbox.paypal.com/x")).toBe("https://www.sandbox.paypal.com/x");
  });
});

describe("readAct", () => {
  it("passes a UI-mode answer through", async () => {
    expect(await readAct(res(JSON.stringify({ ok: true, message: "Sent", to: "/po/1" })))).toEqual({ ok: true, message: "Sent", to: "/po/1" });
  });
  it("marks 401 as needing sign-in", async () => {
    expect(await readAct(new Response("nope", { status: 401 }))).toMatchObject({ ok: false, auth: true });
  });
  it("turns an HTML error into plain words", async () => {
    const r = await readAct(new Response("<h1>Bad</h1><p>Line 2 is wrong</p>", { status: 400 }));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Line 2 is wrong");
    expect(r.message).not.toContain("<");
  });
});

describe("createClient", () => {
  it("sends the UI header, form encoding and cookies on act", async () => {
    let seen: RequestInit | undefined;
    let url = "";
    const c = createClient({ base: () => "https://s.test", fetch: async (u, init) => ((url = u), (seen = init), res('{"ok":true,"message":""}')) });
    await c.act("/po/1/submit", { a: "1" });
    expect(url).toBe("https://s.test/po/1/submit");
    expect(seen?.method).toBe("POST");
    expect(seen?.credentials).toBe("include");
    expect((seen?.headers as Record<string, string>)["X-StockSure-UI"]).toBe("1");
    expect(seen?.body).toBe("a=1");
  });
  it("never throws on a network failure, and says nothing was sent", async () => {
    const c = createClient({ base: () => "", fetch: async () => { throw new TypeError("offline"); } });
    expect(await c.act("/x")).toEqual({ ok: false, message: OFFLINE });
    await expect(c.get("/api/ui/home")).rejects.toMatchObject({ status: 0, message: OFFLINE });
  });
  it("raises the server's message on a failed view load", async () => {
    const c = createClient({ base: () => "", fetch: async () => res('{"message":"Sign in first."}', 401) });
    await expect(c.get("/api/ui/home")).rejects.toMatchObject({ status: 401, auth: true, message: "Sign in first." });
  });
});
