import { usePathname } from "expo-router";
import { useRouter } from "expo-router";
import { ArrowRight, Fingerprint, ShieldAlert, Undo2 } from "lucide-react-native";
import { View } from "react-native";
import { ago, money } from "@/lib/format";
import type { ApprovalRow } from "@/lib/types";
import { openWeb, useAction } from "@/lib/useAction";
import { Button, ButtonRow } from "./button";
import { Card } from "./card";
import { Stamp } from "./stamp";
import { Txt } from "./text";
import { useTheme } from "./theme";

const VERB: Record<string, string> = { capture: "Charge", refund: "Refund", reauthorize: "Renew hold", authorize: "Place hold" };

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <Txt v="label" muted>{k}</Txt>
      {typeof children === "string" ? <Txt v="small">{children}</Txt> : children}
    </View>
  );
}

/** One held payment: what moves, to whom, why it waited, and what each choice does. */
export function ApprovalCard({ a, onDone, showOrder = true }: { a: ApprovalRow; onDone: () => void; showOrder?: boolean }) {
  const { p } = useTheme();
  const here = usePathname();
  const router = useRouter();
  const { run, busy } = useAction(onDone);
  const refund = a.action === "refund";
  const to = refund ? "back to your PayPal account" : `to ${a.supplier ?? "the supplier"}`;
  const verb = VERB[a.action] ?? a.action;
  return (
    <Card look="held" style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <Stamp tone="held" animate>Waiting for you</Stamp>
        {a.safety_reasons.length > 0 && <Stamp tone="stop" icon={<ShieldAlert size={11} color={p.stop} />}>Scam check</Stamp>}
        <Txt v="small" muted style={{ marginLeft: "auto" }}>{ago(a.created_at)}</Txt>
      </View>
      <Txt v="title">
        {verb} <Txt v="title" style={{ fontVariant: ["tabular-nums"] }}>{money(a.cents)}</Txt>
      </Txt>
      <Row k="What moves">
        <Txt v="small">
          {money(a.cents)} {refund ? "returned" : "captured from the PayPal hold"} {to}
          {showOrder && a.po_number ? ` · ${a.po_number}` : ""}
        </Txt>
      </Row>
      <Row k="Why it waited">
        <View style={{ gap: 3 }}>
          {a.reasons.map((r) => (
            <View key={r} style={{ flexDirection: "row", gap: 8 }}>
              <Txt v="small" muted>•</Txt>
              <Txt v="small" style={{ flex: 1 }}>{r}</Txt>
            </View>
          ))}
        </View>
      </Row>
      <Row k="If you decline">
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Undo2 size={15} color={p.ink2} style={{ marginTop: 2 }} />
          <Txt v="small" style={{ flex: 1 }}>Nothing moves and the PayPal hold stays in place. You can retry from the order later, which asks you again.</Txt>
        </View>
      </Row>
      <Row k="If you approve">{`PayPal runs it now with the same request id, so a retry can't charge twice.${refund ? "" : " A later problem with the goods is refunded to the same PayPal payment."}`}</Row>
      <ButtonRow>
        {a.needs_passkey ? (
          <Button variant="carbon" icon={Fingerprint} trailing={ArrowRight} onPress={() => void openWeb("/guard#approvals").then(onDone)}>
            Approve with passkey
          </Button>
        ) : (
          <Button variant="paid" loading={busy === "approve"} disabled={!!busy} onPress={() => run("approve", `/guard/approvals/${a.id}/approve`, { next: "/approvals" }, { stay: true })}>
            {`Approve ${money(a.cents)}`}
          </Button>
        )}
        <Button variant="outline" loading={busy === "decline"} disabled={!!busy} onPress={() => run("decline", `/guard/approvals/${a.id}/decline`, { next: "/approvals" }, { stay: true })}>
          Decline
        </Button>
        {showOrder && a.po_id && here !== `/order/${a.po_id}` && (
          <Button variant="ghost" trailing={ArrowRight} onPress={() => router.push(`/order/${a.po_id}`)}>
            Open order
          </Button>
        )}
      </ButtonRow>
      {a.needs_passkey && <Txt v="small" muted>Amounts this size need your passkey. It opens the Spending rules page in a browser and signs this exact payment.</Txt>}
    </Card>
  );
}
