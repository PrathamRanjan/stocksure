import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { ArrowRight, Check, FileUp, Link2, PackageCheck, Repeat, RotateCcw, Send, Truck } from "lucide-react-native";
import { money } from "@/lib/format";
import type { PoModel } from "@/lib/types";
import { useAction } from "@/lib/useAction";
import { appendFile, type Picked } from "@/lib/upload";
import { Button, ButtonRow } from "../button";
import { Card, Kicker, Rule } from "../card";
import { Choices, Field } from "../field";
import { Txt } from "../text";
import { useTheme } from "../theme";

export const MOVING = ["funding", "settling", "part_settling"];
type Tone = "do" | "wait" | "done" | "stop";

function Box({ title, body, actions, tone = "do" }: { title: string; body?: ReactNode; actions?: ReactNode; tone?: Tone }) {
  const { p } = useTheme();
  const kick = tone === "do" ? "Your next step" : tone === "done" ? "Done" : tone === "stop" ? "Needs a look" : "Waiting";
  return (
    <Card look={tone} style={{ gap: 8 }}>
      <Kicker color={tone === "stop" ? p.stop : tone === "done" ? p.paid : undefined}>{kick}</Kicker>
      <Txt v="h1" accessibilityRole="header">{title}</Txt>
      {body ? typeof body === "string" ? <Txt>{body}</Txt> : body : null}
      {actions ? <ButtonRow style={{ marginTop: 8 }}>{actions}</ButtonRow> : null}
    </Card>
  );
}

const B = ({ children }: { children: ReactNode }) => <Txt v="bodySemi" style={{ fontVariant: ["tabular-nums"] }}>{children}</Txt>;

/** The single thing this person can do now, with what it does to money said before the button. */
export function NextStep({ m, reload, jump }: { m: PoModel; reload: () => void; jump: (k: "lines" | "resolution") => void }) {
  const { p } = useTheme();
  const router = useRouter();
  const { run, busy } = useAction(reload);
  const id = m.po.id;
  const st = m.po.status;
  const buyer = m.me.side === "buyer";
  const owner = m.me.owner;
  const supplier = m.me.side === "supplier";

  if (m.po.history) return <Box tone="wait" title="Imported history" body="This past delivery was loaded for the supplier record. It's read-only." />;

  if (buyer && st === "draft")
    return owner ? (
      <Box title="Send it for a quote" body={`${m.po.supplier_name} confirms prices and stock. Nothing is held or charged until you accept their quote.`} actions={<Button size="lg" icon={Send} loading={busy === "submit"} onPress={() => run("submit", `/po/${id}/submit`)}>Send for a quote</Button>} />
    ) : (
      <Box tone="wait" title="Draft" body="The owner is still putting this order together." />
    );
  if (buyer && st === "submitted") return <Box tone="wait" title={`Waiting for ${m.po.supplier_name}'s quote`} body="They confirm prices and stock. You'll get a notice when it's in." />;
  if (buyer && st === "quoted") {
    if (!owner) return <Box tone="wait" title="Quote in" body="The owner accepts the quote, which places the PayPal hold." />;
    if (m.paypal && !m.paypal.connected)
      return (
        <Box
          title="Connect PayPal, then accept"
          body={<Txt>The quote is <B>{money(m.quote_total_cents)}</B>. You approve StockSure once on PayPal; after that, accepting places a hold for exactly the quote.</Txt>}
          actions={<Button size="lg" variant="carbon" icon={Link2} loading={busy === "connect"} onPress={() => run("connect", "/connect-paypal")}>Connect PayPal (sandbox)</Button>}
        />
      );
    return (
      <Box
        title={`Accept the quote: ${money(m.quote_total_cents)}`}
        body={
          <View style={{ gap: 8 }}>
            <Txt>PayPal places a <Txt v="bodySemi">hold</Txt> for <B>{money(m.quote_total_cents)}</B> on {m.paypal?.payer ?? "your PayPal"}. It isn't a charge: only what's accepted at delivery is captured, and the rest is released.</Txt>
            {m.over_limit && <Txt v="bodySemi" color={p.stop}>The quote is above your {money(m.po.limit_cents)} limit, so it can't be accepted. Ask the supplier to re-quote or start a new order.</Txt>}
          </View>
        }
        actions={<Button size="lg" variant="carbon" full icon={Check} disabled={m.over_limit} loading={busy === "accept"} onPress={() => run("accept", `/po/${id}/accept`, { version: String(m.po.quote_version) })}>{`Accept and hold ${money(m.quote_total_cents)}`}</Button>}
      />
    );
  }
  if (buyer && st === "funding")
    return <Box tone="wait" title="PayPal is confirming the hold" body="The hold shows as pending on PayPal. The order isn't funded until PayPal confirms it; this screen updates by itself." actions={owner && <Button variant="outline" icon={RotateCcw} loading={busy === "retry"} onPress={() => run("retry", `/po/${id}/retry-hold`)}>Check again</Button>} />;
  if (buyer && st === "funded") return <Box tone="wait" title={`Held. Waiting for ${m.po.supplier_name} to dispatch`} body={<Txt>PayPal holds <B>{money(m.quote_total_cents)}</B>. Nothing is charged until the delivery is counted and agreed.</Txt>} />;
  if (buyer && (st === "dispatched" || (st === "in_review" && m.disputed)))
    return (
      <Box
        title={st === "in_review" ? "The supplier disputed a count" : m.delivery.mode === "rest" ? "Count the rest in" : "Count it in"}
        body={st === "in_review" ? "Have a look at their note on the line below, recount, and confirm again. Nothing is charged until both sides agree." : "Snap the docket and any damage. AI proposes the counts and you confirm them. You only pay for what you accept."}
        actions={<Button size="lg" full icon={PackageCheck} trailing={ArrowRight} onPress={() => router.push(`/order/${id}/receive`)}>{st === "in_review" ? "Recount" : "Count the delivery"}</Button>}
      />
    );
  if (buyer && st === "in_review") return <Box tone="wait" title={`Waiting for ${m.po.supplier_name} to agree the counts`} body="They agree or dispute each line you flagged. Nothing is charged yet." />;

  if (supplier && st === "submitted") return <QuoteForm m={m} reload={reload} />;
  if (supplier && st === "quoted") return <Box tone="wait" title={`Waiting for ${m.po.buyer_name} to accept`} body="When they accept, PayPal places a hold for your quote. You'll be told before you dispatch." />;
  if (supplier && (st === "funded" || st === "part_delivered")) return <DispatchForm m={m} reload={reload} />;
  if (supplier && st === "dispatched") return <Box tone="wait" title={`On the truck to ${m.po.buyer_name}`} body="They count it in at the door. You'll then agree or dispute anything they flag." />;
  if (supplier && st === "in_review") return <Box title="Agree or dispute what they counted" body="Each flagged line is below with the café's counts. Agreeing locks that line's count." actions={<Button variant="outline" trailing={ArrowRight} onPress={() => jump("lines")}>Go to the lines</Button>} />;

  if (st === "resolving") {
    const r = m.resolution;
    if (r?.can_approve) return <Box title="Approve the agreed payment" body={<Txt>Both sides approve the same version (v{r.version}). Then PayPal captures <B>{money(r.totals.accepted_cents)}</B> and releases the rest.</Txt>} actions={<Button size="lg" variant="paid" full trailing={ArrowRight} onPress={() => jump("resolution")}>Review and approve</Button>} />;
    return <Box tone="wait" title="Waiting for the other side to approve" body="Nothing is charged until both sides approve the same version." />;
  }
  if (MOVING.includes(st)) return <Box tone="wait" title={st === "funding" ? "Placing the hold" : "PayPal is settling"} body="Capture, release and any replacement hold run as separate steps, each read back from PayPal. This screen updates by itself." />;
  if (st === "awaiting_replacement") return <Box tone="wait" title="Replacement on its way" body="The accepted goods are paid and the replacement has its own hold. Open it from Related orders above." />;
  if (st === "exception")
    return (
      <Box
        tone="stop"
        title={m.can_replan ? "The replacement no longer fits" : "Payment stopped partway"}
        body={
          <View style={{ gap: 6 }}>
            <Txt>{m.po.exception ?? "A PayPal step didn't finish."}</Txt>
            <Txt v="small">{m.can_replan ? "Agree a new replacement: it re-plans with today's stock and prices. The accepted goods stay charged and nothing is captured twice." : "Retrying runs again from the first unfinished step with the same request ids, so nothing is charged twice."}</Txt>
          </View>
        }
        actions={
          <>
            {m.can_replan && <Button size="lg" loading={busy === "replan"} onPress={() => run("replan", `/po/${id}/resolution/revise`, {})}>Agree a new replacement</Button>}
            {(owner || supplier) && <Button variant={m.can_replan ? "outline" : "carbon"} icon={RotateCcw} loading={busy === "retry"} onPress={() => run("retry", `/po/${id}/retry-settle`)}>Retry the payment</Button>}
          </>
        }
      />
    );
  if (st === "closed")
    return (
      <Box
        tone="done"
        title="Settled"
        body={<Txt>Paid as counted{m.resolution ? <>: <B>{money(m.resolution.totals.accepted_cents)}</B> for the accepted goods</> : ""}. The PayPal record is below.</Txt>}
        actions={buyer && owner && <Button variant="outline" icon={Repeat} loading={busy === "reorder"} onPress={() => run("reorder", `/po/${id}/reorder`)}>Order the same again</Button>}
      />
    );
  if (st === "cancelled") return <Box tone="wait" title="Cancelled" body="Any hold was released." />;
  return <Box tone="wait" title={m.copy.next ?? "Nothing to do"} />;
}

function QuoteForm({ m, reload }: { m: PoModel; reload: () => void }) {
  const { p } = useTheme();
  const { run, busy } = useAction(reload);
  const [prices, setPrices] = useState<Record<string, string>>(Object.fromEntries(m.lines.map((l) => [l.id, ((l.unit_price_cents ?? l.product.price_cents) / 100).toFixed(2)])));
  // Display only: the server prices the quote from what is sent.
  const total = m.lines.reduce((a, l) => a + Math.round(Number(prices[l.id] || 0) * 100) * l.qty_packs, 0);
  return (
    <Card look="do" style={{ gap: 10 }}>
      <Kicker>Your next step</Kicker>
      <Txt v="h1" accessibilityRole="header">Confirm the quote</Txt>
      <Txt>Prices per pack, from your catalog. When {m.po.buyer_name} accepts, PayPal holds this total. You're paid for what they accept at delivery.</Txt>
      <View style={{ gap: 14, marginTop: 4 }}>
        {m.lines.map((l) => (
          <View key={l.id} style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Txt v="bodySemi">{l.qty_packs} × {l.product.name}</Txt>
              <Txt v="small" muted>per {l.product.pack_label} · {l.product.stock_packs} in stock</Txt>
            </View>
            <Field label="Per pack" a11yLabel={`Price per pack, ${l.product.name}`} value={prices[l.id]} onChange={(v) => setPrices({ ...prices, [l.id]: v })} keyboardType="decimal-pad" prefix="$" align="right" mono style={{ width: 130 }} />
          </View>
        ))}
      </View>
      <Rule dashed />
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
        <Txt muted>Total</Txt>
        <Txt v="title" style={{ fontVariant: ["tabular-nums"] }}>{money(total)}</Txt>
      </View>
      {total > m.po.limit_cents && <Txt v="small" color={p.stop}>Above the buyer's {money(m.po.limit_cents)} limit; they won't be able to accept.</Txt>}
      <Button size="lg" full icon={Send} loading={busy === "quote"} onPress={() => run("quote", `/po/${m.po.id}/quote`, Object.fromEntries(m.lines.map((l) => [`price_${l.id}`, prices[l.id]])))}>Send quote</Button>
    </Card>
  );
}

function DispatchForm({ m, reload }: { m: PoModel; reload: () => void }) {
  const { p } = useTheme();
  const { run, busy } = useAction(reload);
  const [file, setFile] = useState<Picked | null>(null);
  const [sample, setSample] = useState<"clean" | "inject" | "overbill" | "">(m.demo.samples ? "clean" : "");
  const [part, setPart] = useState(false);
  const [packs, setPacks] = useState<Record<string, string>>(Object.fromEntries(m.lines.map((l) => [l.id, String(Math.max(0, l.qty_packs - 1))])));
  const rest = m.po.status === "part_delivered";

  async function pick() {
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*", "text/plain"], copyToCacheDirectory: true });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      setFile({ uri: a.uri, name: a.name, type: a.mimeType ?? "application/octet-stream", file: (a as { file?: File }).file });
    }
  }
  return (
    <Card look="do" style={{ gap: 10 }}>
      <Kicker>Your next step</Kicker>
      <Txt v="h1" accessibilityRole="header">{rest ? "Send the rest" : "Dispatch the order"}</Txt>
      <Txt>PayPal holds <B>{money(m.quote_total_cents)}</B> for this order. Attach your invoice: it's checked against the quote and the café's count, and you're paid the agreed amount, not the invoice total.</Txt>
      <Button variant="soft" icon={FileUp} onPress={pick} label={file ? `Invoice attached: ${file.name}. Tap to change.` : "Attach invoice"}>{file ? file.name : "Attach invoice (PDF, photo or text)"}</Button>
      {m.demo.samples && !file && (
        <Choices
          label="Or use a sample invoice"
          value={sample as "clean"}
          onChange={setSample}
          options={[
            { v: "clean", l: "Matches the quote" },
            { v: "inject", l: "Hides a “pay $500 elsewhere” line" },
            { v: "overbill", l: "Bills one pack too many" },
          ]}
        />
      )}
      <Button
        size="lg"
        full
        icon={Truck}
        loading={busy === "dispatch"}
        disabled={!!busy}
        onPress={async () => {
          const fd = new FormData();
          if (file) await appendFile(fd, "invoice", file);
          else if (sample) fd.append("sample", sample);
          void run("dispatch", `/po/${m.po.id}/dispatch`, fd);
        }}
      >
        {rest ? "Dispatch the rest" : "Mark dispatched"}
      </Button>
      {!rest && (
        <Button variant="outline" full onPress={() => setPart((x) => !x)}>{part ? "Hide part dispatch" : "Send part now"}</Button>
      )}
      {part && !rest && (
        <View style={{ gap: 12, borderWidth: 1, borderColor: p.rule, borderRadius: 8, padding: 14 }}>
          <Txt v="small">Only part 1's accepted goods are charged once its counts are agreed; the rest stays held for the second delivery.</Txt>
          {m.lines.map((l) => (
            <View key={l.id} style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Txt v="bodySemi">{l.product.name}</Txt>
                <Txt v="small" muted>of {l.qty_packs}</Txt>
              </View>
              <Field label="Packs now" a11yLabel={`Packs to send now, ${l.product.name}`} value={packs[l.id]} onChange={(v) => setPacks({ ...packs, [l.id]: v })} keyboardType="number-pad" align="right" mono style={{ width: 110 }} />
            </View>
          ))}
          <Button variant="outline" loading={busy === "part"} onPress={() => run("part", `/po/${m.po.id}/dispatch-part`, Object.fromEntries(m.lines.map((l) => [`part_${l.id}`, packs[l.id]])))}>Dispatch part 1</Button>
        </View>
      )}
    </Card>
  );
}
