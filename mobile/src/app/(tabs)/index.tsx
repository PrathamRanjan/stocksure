import { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { AlertTriangle, ArrowRight, BadgeCheck, ChevronDown, Link2 } from "lucide-react-native";
import { Button } from "@/components/button";
import { Card, SectionTitle } from "@/components/card";
import { Masthead } from "@/components/masthead";
import { OrderCard } from "@/components/order-card";
import { Stamp } from "@/components/stamp";
import { Empty, ErrorState, Loading, Screen } from "@/components/states";
import { TallyLegend } from "@/components/tally";
import { Txt } from "@/components/text";
import { useTheme } from "@/components/theme";
import { useView } from "@/lib/api";
import { money, plural } from "@/lib/format";
import { tap } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import type { HomeData } from "@/lib/types";
import { useAction } from "@/lib/useAction";

export default function Home() {
  const { p } = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const v = useView<HomeData>("/api/ui/home", { poll: 8000 });
  const { run, busy } = useAction(() => v.reload("quiet"));
  const [showHistory, setShowHistory] = useState(false);
  const role = session?.who?.role;
  const d = v.data;
  const supplierView = d?.org.side === "supplier";
  const title = supplierView ? "Orders" : role === "receiving" ? "Deliveries" : "Orders";

  const live = d?.orders.filter((o) => !o.history) ?? [];
  const needs = live.filter((o) => o.needs_you);
  const rest = live.filter((o) => !o.needs_you);
  const history = d?.orders.filter((o) => o.history) ?? [];

  return (
    <Screen top bottom={110} refreshing={v.refreshing} onRefresh={() => v.reload("pull")}>
      <Masthead title={title} sub={d ? `${d.org.name}${live.length ? ` · ${plural(live.length, "order")}` : ""}` : undefined} />

      {v.error && !d ? <ErrorState message={v.error.message} status={v.error.status} retry={() => v.reload()} /> : null}
      {!d && !v.error ? <Loading label="Loading orders" /> : null}

      {d && (
        <>
          {d.can_connect && !d.org.paypal_connected && (
            <Card look="held" style={{ gap: 10, backgroundColor: p.heldSoft }}>
              <Txt v="h2">Connect PayPal to place holds</Txt>
              <Txt v="small">You approve once on PayPal. After that, each accepted quote places a hold for exactly the quote, and nothing is charged until a delivery is agreed.</Txt>
              <Button variant="carbon" icon={Link2} loading={busy === "connect"} onPress={() => run("connect", "/connect-paypal")}>Connect PayPal (sandbox)</Button>
            </Card>
          )}
          {d.can_connect && d.org.paypal_connected && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <Stamp tone="paid">PayPal connected</Stamp>
              <Txt v="small" muted style={{ flexShrink: 1 }}>{d.org.payer ? `as ${d.org.payer}` : "sandbox"}</Txt>
            </View>
          )}

          {d.approvals.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${plural(d.approvals.length, "payment")} waiting for you`}
              onPress={() => {
                tap();
                router.push("/approvals");
              }}
            >
              <Card look="ink" style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <BadgeCheck size={26} color={p.onInk} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt v="h3" color={p.onInk}>{plural(d.approvals.length, "payment")} waiting for you</Txt>
                  <Txt v="small" color={p.onInk} style={{ opacity: 0.8 }} numberOfLines={2}>
                    {d.approvals.map((a) => `${a.action} ${money(a.cents)}${a.po_number ? ` on ${a.po_number}` : ""}`).join(" · ")}
                  </Txt>
                </View>
                <ArrowRight size={20} color={p.onInk} />
              </Card>
            </Pressable>
          )}

          <View>
            <SectionTitle aside={needs.length ? plural(needs.length, "order") : undefined}>Needs you</SectionTitle>
            {needs.length ? (
              <View style={{ gap: 12 }}>{needs.map((o) => <OrderCard key={o.id} o={o} supplierView={supplierView} />)}</View>
            ) : (
              <Empty title={live.length ? "Nothing needs you right now" : "No orders yet"}>
                {live.length
                  ? "Everything below is waiting on someone else or already settled."
                  : d.can_create
                    ? "Start an order from your supplier's catalog on the web. A PayPal hold is placed only when you accept the quote."
                    : supplierView
                      ? "Orders appear here when a buyer sends one for a quote."
                      : "Deliveries appear here once the owner orders."}
              </Empty>
            )}
          </View>

          {rest.length > 0 && (
            <View>
              <SectionTitle aside={plural(rest.length, "order")}>Everything else</SectionTitle>
              <View style={{ gap: 12 }}>{rest.map((o) => <OrderCard key={o.id} o={o} supplierView={supplierView} />)}</View>
            </View>
          )}

          {live.some((o) => o.lines.some((l) => l.tally.accepted !== null)) && <TallyLegend />}

          {history.length > 0 && (
            <Card pad={0}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showHistory }}
                onPress={() => {
                  tap();
                  setShowHistory((x) => !x);
                }}
                style={{ flexDirection: "row", alignItems: "center", minHeight: 52, paddingHorizontal: 16, gap: 8 }}
              >
                <Txt v="bodySemi" style={{ flex: 1 }}>Imported history ({history.length})</Txt>
                <ChevronDown size={20} color={p.ink2} style={{ transform: [{ rotate: showHistory ? "180deg" : "0deg" }] }} />
              </Pressable>
              {showHistory && (
                <View style={{ padding: 12, paddingTop: 0, gap: 10 }}>
                  <Txt v="small" muted>Past deliveries loaded for the supplier record. They're read-only.</Txt>
                  {history.map((o) => <OrderCard key={o.id} o={o} supplierView={supplierView} />)}
                </View>
              )}
            </Card>
          )}

          {v.error && (
            <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <AlertTriangle size={16} color={p.stop} />
              <Txt v="small" color={p.stop}>Couldn't refresh: {v.error.message}</Txt>
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
