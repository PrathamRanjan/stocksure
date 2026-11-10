import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AlertTriangle, Check, ChevronRight, CircleDashed, FileText, MessageSquare, RotateCcw, ShieldAlert, X } from "lucide-react-native";
import { ago, money, plural, when } from "@/lib/format";
import type { Op, PoModel, Resolution } from "@/lib/types";
import { openWeb, useAction } from "@/lib/useAction";
import { radius } from "@/lib/theme";
import { Button, ButtonRow } from "../button";
import { Card, Rule, SectionTitle } from "../card";
import { Choices, Field } from "../field";
import { SettlementBar } from "../settlement";
import { PayPalStamp, Stamp, StatusStamp } from "../stamp";
import { Empty, Notice } from "../states";
import { Tally, TallyLegend } from "../tally";
import { Txt } from "../text";
import { useTheme } from "../theme";

const N = { fontVariant: ["tabular-nums" as const] };

/* ---------------- Related orders (original and replacements) ---------------- */
export function Related({ m }: { m: PoModel }) {
  const { p } = useTheme();
  const router = useRouter();
  if (m.tree.length < 2) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityLabel="Related orders">
      {m.tree.map((t) => {
        const here = t.id === m.po.id;
        return (
          <Pressable
            key={t.id}
            disabled={here}
            accessibilityRole="button"
            accessibilityState={{ selected: here }}
            onPress={() => router.push(`/order/${t.id}`)}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: here ? 2 : 1, borderColor: here ? p.ink : p.rule, backgroundColor: p.card }}
          >
            <Txt v="smallSemi" style={N}>{t.number}</Txt>
            <StatusStamp status={t.status} />
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------------- Lines ---------------- */
export function Lines({ m, reload }: { m: PoModel; reload: () => void }) {
  const { p } = useTheme();
  const { run, busy } = useAction(reload);
  const [dispute, setDispute] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const counted = m.lines.some((l) => l.receipt);
  return (
    <Card>
      <SectionTitle aside={m.receipt ? `counted v${m.receipt.version}` : "not counted yet"}>{counted ? "Ordered and arrived" : "What was ordered"}</SectionTitle>
      {m.lines.map((l, i) => (
        <View key={l.id} style={{ paddingTop: i ? 16 : 0, marginTop: i ? 16 : 0, borderTopWidth: i ? 1 : 0, borderTopColor: p.rule, gap: 8 }}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Txt v="mono" muted style={{ marginTop: 3 }}>{l.line_no}</Txt>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt v="bodySemi">{l.product.name}</Txt>
              <Txt v="small" muted>
                {l.qty_packs} × {l.product.pack_label} ({l.ordered_text})
                {l.unit_price_cents !== null ? ` · ${money(l.unit_price_cents)} each` : ""}
              </Txt>
              <Txt v="small" muted>
                Shortfall: {l.replace_shortfall ? "replace" : "credit"}
                {l.substitutes.length ? ` · substitutes: ${l.substitutes.join(", ")}` : ""}
              </Txt>
            </View>
            {l.quoted_cents !== null && <Txt v="h3" style={N}>{money(l.quoted_cents)}</Txt>}
          </View>
          <View style={{ paddingLeft: 22 }}>
            <Tally t={l.tally} label={`Line ${l.line_no}`} />
          </View>
          {l.receipt && (
            <View style={{ backgroundColor: p.paper2, borderRadius: radius.md, padding: 12, gap: 8, marginLeft: 22 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 8 }}>
                {[
                  ["Arrived", l.receipt.delivered, true],
                  ["Accepted", l.receipt.accepted, true],
                  ["Damaged", l.receipt.damaged, false],
                  ["Wrong item", l.receipt.wrong, false],
                ].map(([k, v, b]) => (
                  <View key={k as string} style={{ width: "50%" }}>
                    <Txt v="small" muted>{k as string}</Txt>
                    <Txt v={b ? "bodySemi" : "body"} style={N}>{v as string}</Txt>
                  </View>
                ))}
              </View>
              {l.receipt.note ? <Txt v="small">“{l.receipt.note}”</Txt> : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <Txt v="small" muted>Supplier</Txt>
                {l.receipt.supplier_status === "agreed" ? <Stamp tone="paid" animate>Agreed</Stamp> : l.receipt.supplier_status === "disputed" ? <Stamp tone="stop" animate>Disputed</Stamp> : <Stamp tone="quiet">Not reviewed</Stamp>}
              </View>
              {l.receipt.supplier_note ? <Txt v="small">“{l.receipt.supplier_note}”</Txt> : null}
            </View>
          )}
          {l.can_review && (
            <View style={{ marginLeft: 22, gap: 10 }}>
              {dispute === l.id ? (
                <>
                  <Field label="What's wrong with this count? The café sees your note." value={note} onChange={setNote} multiline placeholder="e.g. Driver's photo shows 7 cases at the door" />
                  <ButtonRow>
                    <Button variant="destructive" disabled={!note.trim()} loading={busy === `d${l.id}`} onPress={() => void run(`d${l.id}`, `/po/${m.po.id}/lines/${l.id}/review`, { action: "dispute", note, seen: l.receipt!.fingerprint }).then((r) => r.ok && setDispute(null))}>Send dispute</Button>
                    <Button variant="ghost" onPress={() => setDispute(null)}>Cancel</Button>
                  </ButtonRow>
                </>
              ) : (
                <ButtonRow>
                  <Button variant="paid" icon={Check} loading={busy === `a${l.id}`} disabled={!!busy} onPress={() => run(`a${l.id}`, `/po/${m.po.id}/lines/${l.id}/review`, { action: "agree", note: "", seen: l.receipt!.fingerprint })}>{`Agree line ${l.line_no}`}</Button>
                  <Button variant="outline" icon={X} onPress={() => { setNote(""); setDispute(l.id); }}>Dispute</Button>
                </ButtonRow>
              )}
            </View>
          )}
        </View>
      ))}
      <Rule dashed style={{ marginTop: 16 }} />
      <View style={{ gap: 10 }}>
        <TallyLegend />
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
          <Txt v="small" muted>Quote total · limit {money(m.po.limit_cents)}</Txt>
          <Txt v="h2" style={N}>{money(m.quote_total_cents || null)}</Txt>
        </View>
      </View>
    </Card>
  );
}

/* ---------------- Money ---------------- */
export function MoneyPanel({ m }: { m: PoModel }) {
  return (
    <Card>
      <SectionTitle aside={m.po.kind === "replacement" ? "shares the original limit" : undefined}>Where the money is</SectionTitle>
      {m.funding ? (
        <SettlementBar f={m.funding} />
      ) : (
        <Empty title="Nothing held yet">
          {m.quote_total_cents ? `Accepting the quote places a PayPal hold for ${money(m.quote_total_cents)}. A hold isn't a charge.` : "Once the supplier quotes, accepting places a PayPal hold for the quote. A hold isn't a charge."}
        </Empty>
      )}
    </Card>
  );
}

/* ---------------- Resolution ---------------- */
export function ResolutionPanel({ m, reload }: { m: PoModel; reload: () => void }) {
  const { p } = useTheme();
  const r = m.resolution;
  const { run, busy } = useAction(reload);
  const [revise, setRevise] = useState(false);
  if (!r)
    return (
      <Card>
        <SectionTitle>The agreement</SectionTitle>
        <Empty title="Appears after the count" art={<CircleDashed size={28} color={p.ink2} />}>
          Once the delivery is counted and the supplier agrees, StockSure works out the payment: quote price × accepted units. Both sides approve the same version before PayPal charges anything.
        </Empty>
      </Card>
    );
  const t = r.totals;
  const short = r.lines.filter((l) => l.shortfall > 0);
  const release = r.funding.release_expected_cents;
  const flags = r.flags.filter((f) => f.code !== "invoice_missing");
  return (
    <Card look={r.open ? "do" : "plain"} style={{ gap: 14 }}>
      <SectionTitle style={{ marginBottom: 0 }} aside={<Txt v="mono" muted>v{r.version} · {r.hash.slice(0, 8)}</Txt>}>The agreement</SectionTitle>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {r.status === "agreed" || r.status === "settled" ? <Stamp tone="paid" animate>Agreed by both</Stamp> : r.status === "proposed" ? <Stamp tone="held">Proposed</Stamp> : <Stamp tone="quiet">{r.status}</Stamp>}
        {r.auto && <Stamp tone="carbon">Clean delivery: agreed automatically</Stamp>}
      </View>
      <View style={{ gap: 0 }}>
        {r.lines.map((l, i) => (
          <View key={l.line_id} style={{ flexDirection: "row", gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: p.rule, borderStyle: "dashed" }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt v="smallSemi">{l.line_no}. {l.name}</Txt>
              <Txt v="small" muted style={N}>Ordered {l.ordered_text} · paid for {l.paid_text}</Txt>
              {l.shortfall > 0 && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <Txt v="small" style={N}>{l.short_text} short</Txt>
                  <Stamp tone={l.remedy === "replace" ? "carbon" : "quiet"}>{l.remedy}</Stamp>
                </View>
              )}
            </View>
            <Txt v="h3" style={N}>{money(l.accepted_cents)}</Txt>
          </View>
        ))}
      </View>
      <Txt v="small" muted>Charge = quote price × accepted units, in whole cents. The invoice is compared, never paid from.</Txt>
      {flags.map((f, i) => (
        <Notice key={i} tone="stop" icon={<AlertTriangle size={16} color={p.stop} />}>{f.message}</Notice>
      ))}
      {short.length > 0 && (
        <View style={{ borderWidth: 1, borderColor: p.rule, borderRadius: radius.md, padding: 12, gap: 4 }}>
          <Txt v="bodySemi">Replacement</Txt>
          {r.plan.chosen ? (
            <>
              {r.plan.chosen.picks.map((x, i) => (
                <Txt key={i} v="small">{x.packs} × {x.name} · {money(x.cents)} · arrives {when(x.eta)}</Txt>
              ))}
              {r.plan.chosen.unfilled_units > 0 && <Txt v="small" color={p.stop}>Some of the shortfall can't be filled within the limit; it is credited.</Txt>}
            </>
          ) : (
            <Txt v="small" muted>{short.some((l) => l.remedy === "replace") ? "No replacement fits the limit and the deadline; the shortfall is credited." : "Shortfall is credited: you simply don't pay for it."}</Txt>
          )}
        </View>
      )}
      <Card look="ink" style={{ gap: 8 }}>
        <Txt v="h3" color={p.onInk}>What moves when both approve</Txt>
        <MoveRow c={p.onInk} k={`Capture to ${m.po.supplier_name}${r.part_charged_cents ? ` (part 1 already ${money(r.part_charged_cents)})` : ""}`} v={money(t.accepted_cents - (r.part_charged_cents || 0))} />
        {release > 0 && <MoveRow c={p.onInk} k={`Release back to ${m.po.buyer_name}`} v={money(release)} />}
        {t.replacement_cents > 0 && <MoveRow c={p.onInk} k="New hold for the replacement" v={money(t.replacement_cents)} />}
        <View style={{ height: 1, backgroundColor: p.onInk, opacity: 0.2, marginVertical: 2 }} />
        <Txt v="small" color={p.onInk} style={[N, { opacity: 0.8 }]}>Total committed {money(t.final_cents)} of {money(t.limit_cents)} · {money(t.headroom_cents)} left</Txt>
      </Card>
      <View style={{ gap: 8 }}>
        {[
          [m.po.buyer_name, r.buyer_approved_by],
          [m.po.supplier_name, r.supplier_approved_by],
        ].map(([side, by]) => (
          <View key={side as string} style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Txt v="small" muted style={{ minWidth: 110 }}>{side}</Txt>
            {by ? <Stamp tone="paid">Approved</Stamp> : <Stamp tone="quiet">Not yet</Stamp>}
            {by ? <Txt v="small" style={{ flexShrink: 1 }}>{by}</Txt> : null}
          </View>
        ))}
      </View>
      {r.open && (
        <View style={{ gap: 10 }}>
          {r.can_approve && <Button variant="paid" size="lg" full icon={Check} loading={busy === "approve"} onPress={() => run("approve", `/po/${m.po.id}/resolution/approve`, { version: String(r.version), hash: r.hash })}>{`Approve v${r.version}`}</Button>}
          {r.i_approved && <Txt v="bodySemi">You approved this version. Waiting for the other side.</Txt>}
          {r.can_revise && <Button variant="outline" full icon={RotateCcw} onPress={() => setRevise((x) => !x)}>{revise ? "Keep this version" : "Change the fix"}</Button>}
          <Txt v="small" muted>Until both approve, nothing is charged. Changing the fix makes a new version and both sides approve again.</Txt>
        </View>
      )}
      {revise && r.can_revise && <Revise m={m} r={r} onDone={() => { setRevise(false); reload(); }} />}
    </Card>
  );
}

function MoveRow({ k, v, c }: { k: string; v: string; c: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "baseline" }}>
      <Txt v="small" color={c} style={{ flex: 1 }}>{k}</Txt>
      <Txt v="h3" color={c} style={N}>{v}</Txt>
    </View>
  );
}

function Revise({ m, r, onDone }: { m: PoModel; r: Resolution; onDone: () => void }) {
  const { run, busy } = useAction(onDone);
  const short = r.lines.filter((l) => l.shortfall > 0);
  const [choices, setChoices] = useState<Record<string, "replace" | "credit">>(Object.fromEntries(short.map((l) => [l.line_id, l.remedy])));
  const [plan, setPlan] = useState(String(r.plan.chosen_index ?? 0));
  return (
    <View style={{ gap: 14 }}>
      {short.map((l) => (
        <Choices
          key={l.line_id}
          label={`Line ${l.line_no} (${l.sku}): ${l.short_text} short`}
          value={choices[l.line_id]}
          onChange={(v) => setChoices({ ...choices, [l.line_id]: v })}
          options={[
            { v: "replace", l: "Send a replacement" },
            { v: "credit", l: "Credit it (don't pay)" },
          ]}
        />
      ))}
      {r.plan.alternatives.length > 1 && (
        <Choices
          label="Replacement plan"
          value={plan}
          onChange={setPlan}
          options={r.plan.alternatives.slice(0, 4).map((x, i) => ({ v: String(i), l: money(x.cost_cents), sub: `${x.picks.map((y) => `${y.packs} × ${y.sku}`).join(", ")}${x.eta_max ? ` · by ${when(x.eta_max)}` : ""}${x.unfilled_units > 0 ? " · leaves some unfilled" : ""}` }))}
        />
      )}
      <Button
        loading={busy === "revise"}
        onPress={() => {
          const data: Record<string, string> = { needed_by: new Date(r.needed_by).toISOString().slice(0, 16), plan_index: plan };
          for (const [k, v] of Object.entries(choices)) data[`choice_${k}`] = v;
          void run("revise", `/po/${m.po.id}/resolution/revise`, data);
        }}
      >
        Propose a new version
      </Button>
    </View>
  );
}

/* ---------------- PayPal timeline ---------------- */
const OP_LABEL: Record<Op["kind"], string> = { authorize: "Hold placed", capture: "Captured", void: "Hold released", refund: "Refunded" };
export function PayPalPanel({ m, reload }: { m: PoModel; reload: () => void }) {
  const { p } = useTheme();
  const { run, busy } = useAction(reload);
  const ops = [...m.ops].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const failed = ops.some((o) => o.status === "failed");
  const canRetry = (m.me.owner || m.me.side === "supplier") && ["exception", "settling", "part_settling"].includes(m.po.status) && failed;
  return (
    <Card>
      <SectionTitle aside="PayPal sandbox">PayPal activity</SectionTitle>
      {ops.length ? (
        <View>
          {ops.map((o, i) => {
            const dot = o.status === "succeeded" ? p.paid : o.status === "failed" ? p.stop : p.held;
            const last = i === ops.length - 1;
            return (
              <View key={o.id} style={{ flexDirection: "row", gap: 14 }} accessible accessibilityLabel={`${OP_LABEL[o.kind]} ${money(o.amount_cents)}, ${o.status}${o.paypal_id ? `, PayPal id ${o.paypal_id}` : ""}`}>
                <View style={{ alignItems: "center", width: 14 }}>
                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: dot, borderWidth: 3, borderColor: p.card, marginTop: 4 }} />
                  {!last && <View style={{ flex: 1, width: 2, backgroundColor: p.rule }} />}
                </View>
                <View style={{ flex: 1, paddingBottom: last ? 0 : 18, gap: 4 }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <Txt v="bodySemi">{OP_LABEL[o.kind]}{o.final_capture ? " (final)" : ""}</Txt>
                    <Txt v="h3" style={N}>{money(o.amount_cents)}</Txt>
                    {o.status === "failed" ? <Stamp tone="stop">Failed</Stamp> : o.status !== "succeeded" ? <Stamp tone="held">{o.status}</Stamp> : <PayPalStamp status={o.paypal_status} />}
                  </View>
                  {o.paypal_id ? <Txt v="mono" selectable>{o.paypal_id}</Txt> : null}
                  <Txt v="small" muted>
                    {m.tree.length > 1 ? `${o.po_number} · ` : ""}
                    {o.attempts > 1 ? `${o.attempts} attempts, same request id · ` : ""}
                    {when(o.updated_at)}
                  </Txt>
                  {o.error ? <Txt v="small" color={p.stop}>{o.error}</Txt> : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <Empty title="No PayPal calls yet">The first call is the hold, when the quote is accepted. Every call is listed here with its PayPal id.</Empty>
      )}
      {canRetry && <Button variant="carbon" icon={RotateCcw} loading={busy === "retry"} style={{ marginTop: 14 }} onPress={() => run("retry", `/po/${m.po.id}/retry-settle`)}>Retry from the first unfinished step</Button>}
    </Card>
  );
}

/* ---------------- Paperwork ---------------- */
const FLAG: Record<string, string> = { agent_instruction: "Instruction to an assistant", payment_redirect: "Tries to change who gets paid", amount_override: "Tries to change the amount", hidden_characters: "Hidden characters" };
export function DocsPanel({ m }: { m: PoModel }) {
  const { p } = useTheme();
  return (
    <Card>
      <SectionTitle aside={m.docs.length ? plural(m.docs.length, "file") : undefined}>Paperwork</SectionTitle>
      {m.docs.length ? (
        m.docs.map((d, i) => (
          <View key={d.id} style={{ paddingTop: i ? 12 : 0, marginTop: i ? 12 : 0, borderTopWidth: i ? 1 : 0, borderTopColor: p.rule, gap: 8 }}>
            <Pressable accessibilityRole="link" accessibilityHint="Opens the file" onPress={() => void openWeb(`/doc/${d.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }}>
              <FileText size={18} color={p.ink} />
              <View style={{ flex: 1 }}>
                <Txt v="bodySemi" numberOfLines={1}>{d.filename}</Txt>
                <Txt v="small" muted>{d.kind.replace("_", " ")} · by {d.uploaded_by} · {ago(d.created_at)}</Txt>
              </View>
              <ChevronRight size={18} color={p.ink2} />
            </Pressable>
            {d.flags.length > 0 && (
              <Notice tone="stop" icon={<ShieldAlert size={16} color={p.stop} />}>
                <View style={{ gap: 4 }}>
                  <Txt v="smallSemi" color={p.stop}>Removed before anything read it</Txt>
                  {d.flags.map((f, j) => (
                    <Txt key={j} v="small">
                      <Txt v="smallSemi">{FLAG[f.kind ?? ""] ?? f.kind ?? f.code}</Txt>
                      {f.text ? `: “${f.text.slice(0, 120)}”` : ""}
                    </Txt>
                  ))}
                  <Txt v="small" muted>No PayPal call takes a payee, so paperwork can't redirect money.</Txt>
                </View>
              </Notice>
            )}
          </View>
        ))
      ) : (
        <Empty title="No paperwork yet">The supplier's invoice arrives with dispatch; the café adds the delivery docket and photos when counting.</Empty>
      )}
    </Card>
  );
}

/* ---------------- Messages ---------------- */
export function Messages({ m, reload }: { m: PoModel; reload: () => void }) {
  const { p } = useTheme();
  const { run, busy } = useAction(reload);
  const [body, setBody] = useState("");
  return (
    <Card style={{ gap: 12 }}>
      <SectionTitle style={{ marginBottom: 0 }} aside={m.messages.length ? plural(m.messages.length, "message") : undefined}>Messages</SectionTitle>
      {m.messages.length ? (
        m.messages.map((x) => {
          const mine = (x.role === "supplier") === (m.me.side === "supplier");
          return (
            <View key={x.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "88%", backgroundColor: mine ? p.carbonSoft : p.paper2, borderRadius: 12, borderBottomRightRadius: mine ? 3 : 12, borderBottomLeftRadius: mine ? 12 : 3, padding: 12, gap: 4 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                <Txt v="smallSemi">{x.author}</Txt>
                {x.kind !== "text" && <Stamp tone="carbon">{x.kind}</Stamp>}
                <Txt v="small" muted>{ago(x.created_at)}</Txt>
              </View>
              <Txt>{x.body}</Txt>
              {x.scan && (
                <Notice tone={x.scan.level === "high" ? "stop" : "held"} icon={<ShieldAlert size={15} color={x.scan.level === "high" ? p.stop : p.held} />}>
                  {`Scam check: this reads like a common payment scam (${x.scan.words.slice(0, 4).join(", ")}). Bank details can't change here; check by calling a number you already have.`}
                </Notice>
              )}
            </View>
          );
        })
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <MessageSquare size={16} color={p.ink2} style={{ marginTop: 2 }} />
          <Txt v="small" muted style={{ flex: 1 }}>No messages. Use this for anything about the delivery; both sides see it.</Txt>
        </View>
      )}
      {m.can_post && (
        <View style={{ gap: 8 }}>
          <Field label={`Write to ${m.me.side === "buyer" ? m.po.supplier_name : m.po.buyer_name}`} value={body} onChange={setBody} multiline />
          <Button disabled={!body.trim()} loading={busy === "post"} style={{ alignSelf: "flex-end" }} onPress={() => void run("post", `/po/${m.po.id}/message`, { body }, { stay: true, quiet: true }).then((r) => r.ok && setBody(""))}>Send</Button>
        </View>
      )}
    </Card>
  );
}

/* ---------------- Activity ---------------- */
export function Activity({ m }: { m: PoModel }) {
  const [all, setAll] = useState(false);
  const ev = all ? m.events : m.events.slice(0, 6);
  return (
    <Card>
      <SectionTitle aside="your time zone">Activity</SectionTitle>
      <View style={{ gap: 10 }}>
        {ev.map((e) => (
          <View key={e.id} style={{ flexDirection: "row", gap: 12 }}>
            <Txt v="small" muted style={[N, { width: 92 }]}>{when(e.at)}</Txt>
            <Txt v="small" style={{ flex: 1 }}>{e.summary}</Txt>
          </View>
        ))}
      </View>
      <ButtonRow style={{ marginTop: 10 }}>
        {m.events.length > 6 && <Button variant="ghost" size="sm" onPress={() => setAll((x) => !x)}>{all ? "Show fewer" : `Show all ${m.events.length}`}</Button>}
        <Button variant="ghost" size="sm" onPress={() => void openWeb(`/po/${m.po.id}`)}>Full record on the web</Button>
      </ButtonRow>
    </Card>
  );
}
