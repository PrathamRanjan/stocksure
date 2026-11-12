// Outbound messages to a real phone go out in the recipient's chosen language; the stored copy stays as written,
// English recipients are untouched, and with no translation available the original is sent rather than nothing.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { openDb, setDb, withWorkspace, type Db } from "../src/db.js";
import { deliver, link, send, setChannelFetch } from "../src/channels/index.js";

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

describe("outbound language", () => {
  let db: Db;
  let sent: any[];
  const saved = { token: config.channels.telegramToken, key: config.ai.openaiKey };
  beforeEach(async () => {
    db = await openDb({ memory: true });
    setDb(db);
    sent = [];
    config.channels.telegramToken = "test-token";
    config.ai.openaiKey = "";
    setChannelFetch((async (_u: any, init: any) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
    }) as typeof fetch);
    await db.query("INSERT INTO orgs (id, kind, name) VALUES ('org_b','buyer','Laneway Café')");
    await db.query("INSERT INTO people (id, org_id, name, role) VALUES ('p_j','org_b','Jordan Lee','owner')");
    await link("telegram", "111", "buyer", "org_b");
  });
  afterEach(async () => {
    config.channels.telegramToken = saved.token;
    config.ai.openaiKey = saved.key;
    setChannelFetch(null);
    setDb(null as any);
    await db.close();
  });

  const go = async (body: string) => {
    const id = await send({ channel: "telegram", address: "111", body, buttons: [{ id: "ok", label: "Approve" }] });
    await deliver(id);
    return id;
  };

  it("English recipients get the message as written", async () => {
    await go("Your order is on hold.");
    expect(sent[0].text).toBe("Your order is on hold.");
  });

  it("a Hindi-speaking owner gets Hindi; the stored copy keeps the original", async () => {
    await db.query("UPDATE people SET lang = 'hi-IN' WHERE id = 'p_j'");
    await withWorkspace(null, async () => {
      for (const [src, out] of [["Your order is on hold.", "आपका ऑर्डर होल्ड पर है।"], ["Approve", "मंज़ूर करें"]]) await db.query("INSERT INTO translations (lang, hash, src, out) VALUES ('hi-IN',$1,$2,$3)", [hash(src), src, out]);
    });
    const id = await go("Your order is on hold.");
    expect(sent[0].text).toBe("आपका ऑर्डर होल्ड पर है।");
    expect(sent[0].reply_markup.inline_keyboard[0][0].text).toBe("मंज़ूर करें");
    const row = (await db.query<{ body: string; status: string }>("SELECT body, status FROM channel_messages WHERE id = $1", [id])).rows[0];
    expect(row).toEqual({ body: "Your order is on hold.", status: "sent" });
  });

  it("with no translation available, the original still goes out", async () => {
    await db.query("UPDATE people SET lang = 'pt-BR' WHERE id = 'p_j'");
    await go("Something new.");
    expect(sent[0].text).toBe("Something new.");
  });
});
