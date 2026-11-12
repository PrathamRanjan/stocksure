import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { ArrowRight, ChevronDown, KeyRound, Play } from "lucide-react-native";
import { ActivityIndicator } from "react-native";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { Field } from "@/components/field";
import { HeroTally } from "@/components/hero-tally";
import { Logo } from "@/components/logo";
import { Stamp } from "@/components/stamp";
import { Empty, ErrorState, Loading, Screen } from "@/components/states";
import { Txt } from "@/components/text";
import { useTheme } from "@/components/theme";
import { useToast } from "@/components/toast";
import { api, serverLabel, useView } from "@/lib/api";
import * as haptics from "@/lib/haptics";
import { radius, space } from "@/lib/theme";
import { useSession } from "@/lib/session";
import type { Person } from "@/lib/types";

const MAIN = ["Jordan", "Sam", "Ana"];

export default function SignIn() {
  const { p } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { session, loading, refresh } = useSession();
  const people = useView<{ people: Person[]; needs_workspace?: boolean }>("/api/ui/people");
  const [busy, setBusy] = useState<string | null>(null);
  const [seed, setSeed] = useState<string | null>(null);

  // The live server gives each visitor a private demo (its own people, orders and PayPal holds). Until one is
  // open, there is nobody to sign in as: start it here, the same request as the website's "Start" button, and
  // wait for its people and seeded orders.
  async function startDemo() {
    haptics.tap();
    setBusy("demo");
    const r = await api.act("/demo/start", {});
    if (!r.ok) {
      setBusy(null);
      haptics.warn();
      return toast.error(r.message || "The demo didn't start.");
    }
    setSeed("Setting up your demo…");
  }
  useEffect(() => {
    if (!seed) return;
    let stop = false;
    (async () => {
      for (let i = 0; i < 90 && !stop; i++) {
        const w = await api.get<{ seed: { expected: number; confirmed: number; done: boolean; stopped: string | null } | null }>("/api/ui/workspace").catch(() => null);
        const s = w?.seed;
        if (s?.stopped) {
          setSeed(null);
          setBusy(null);
          return toast.error(`The demo stopped while setting up: ${s.stopped}`);
        }
        if (s?.done) break;
        if (s) setSeed(s.expected ? `Placing sample PayPal holds: ${s.confirmed} of ${s.expected}` : "Setting up your demo…");
        await new Promise((res) => setTimeout(res, 2000));
      }
      if (stop) return;
      setSeed(null);
      setBusy(null);
      haptics.success();
      people.reload();
    })();
    return () => void (stop = true);
  }, [seed !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const [key, setKey] = useState("");
  const [more, setMore] = useState(false);

  if (!loading && session?.who && !busy) return <Redirect href="/" />;

  async function go(data: Record<string, string>, k: string) {
    haptics.tap();
    setBusy(k);
    const r = await api.act("/login", { ...data, next: "/home" });
    if (!r.ok) {
      setBusy(null);
      haptics.warn();
      return toast.error(r.message || "That didn't work.");
    }
    await refresh();
    haptics.success();
    setBusy(null);
    router.replace("/");
  }

  const list = people.data?.people ?? [];
  const main = list.filter((x) => MAIN.includes(x.first));
  const others = list.filter((x) => !MAIN.includes(x.first));

  return (
    <Screen top bottom={40}>
      <View style={{ gap: space.xl, paddingTop: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Logo size={30} />
          <Stamp tone="held">Sandbox</Stamp>
        </View>
        <HeroTally />
        <View style={{ gap: 10 }}>
          <Txt v="display" accessibilityRole="header" style={{ fontSize: 38, lineHeight: 41 }}>Pay for what{"\n"}arrived.</Txt>
          <Txt muted style={{ fontSize: 17, lineHeight: 25 }}>
            PayPal holds the quote when you order. You count the delivery at the door, and only what you accept is charged. The rest goes back.
          </Txt>
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <Txt v="label" muted>{list.length ? "Sign in as" : "Sign in"}</Txt>
        {people.error && !people.data ? <ErrorState message={people.error.message} status={people.error.status} retry={() => people.reload()} /> : null}
        {people.loading && !people.data ? <Loading label="Loading people" cards={3} /> : null}
        {people.data && !list.length && people.data.needs_workspace ? (
          <Card style={{ gap: 12 }}>
            <Txt v="h3">Start your private demo</Txt>
            <Txt v="small" muted>You get your own café, wholesaler and orders, with real PayPal sandbox holds. Nobody else sees them, and they are cleared after two days without use.</Txt>
            <Button disabled={!!busy} loading={busy === "demo"} onPress={startDemo} icon={Play}>Start the demo</Button>
            {seed ? <Txt v="small" accessibilityLiveRegion="polite">{seed}</Txt> : null}
          </Card>
        ) : null}
        {people.data && !list.length && !people.data.needs_workspace ? <Empty title="Demo sign-in is off on this server">Use the access key your organisation gave you.</Empty> : null}
        {main.map((x) => (
          <Pressable
            key={x.id}
            accessibilityRole="button"
            accessibilityLabel={`Sign in as ${x.name}, ${x.tag} at ${x.org.replace(/\.$/, "")}. ${x.job}`}
            accessibilityState={{ busy: busy === x.id, disabled: !!busy }}
            disabled={!!busy}
            onPress={() => go({ person_id: x.id }, x.id)}
            style={({ pressed }) => ({ opacity: busy && busy !== x.id ? 0.5 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] })}
          >
            <Card style={{ flexDirection: "row", gap: 14, alignItems: "center", borderColor: session?.who?.id === x.id ? p.ink : p.rule }}>
              <View style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: x.side === "supplier" ? p.carbon : p.ink, alignItems: "center", justifyContent: "center" }}>
                <Txt v="title" color={x.side === "supplier" ? (p.scheme === "dark" ? p.paper : "#FFFCF5") : p.onInk} style={{ lineHeight: 34 }}>{x.first[0]}</Txt>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <Txt v="h2">{x.name}</Txt>
                  <Stamp tone={x.side === "supplier" ? "carbon" : x.role === "owner" ? "ink" : "quiet"}>{x.tag}</Stamp>
                </View>
                <Txt v="smallSemi" muted>{x.org}</Txt>
                <Txt v="small">{x.job}</Txt>
              </View>
              {busy === x.id ? <ActivityIndicator color={p.ink} /> : <ArrowRight size={20} color={p.ink2} />}
            </Card>
          </Pressable>
        ))}
        {others.length > 0 && (
          <Card pad={0}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: more }} onPress={() => setMore((m) => !m)} style={{ flexDirection: "row", alignItems: "center", minHeight: 52, paddingHorizontal: 16, gap: 8 }}>
              <Txt v="bodySemi" style={{ flex: 1 }}>Other people ({others.length})</Txt>
              <ChevronDown size={20} color={p.ink2} style={{ transform: [{ rotate: more ? "180deg" : "0deg" }] }} />
            </Pressable>
            {more && (
              <View style={{ paddingBottom: 8 }}>
                {others.map((x) => (
                  <Pressable key={x.id} accessibilityRole="button" disabled={!!busy} onPress={() => go({ person_id: x.id }, x.id)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 50, paddingHorizontal: 16, backgroundColor: pressed ? p.paper2 : "transparent" })}>
                    <View style={{ flex: 1 }}>
                      <Txt v="bodySemi">{x.name}</Txt>
                      <Txt v="small" muted>{x.tag} · {x.org}</Txt>
                    </View>
                    {busy === x.id ? <ActivityIndicator color={p.ink} /> : <ArrowRight size={18} color={p.ink2} />}
                  </Pressable>
                ))}
              </View>
            )}
          </Card>
        )}
      </View>

      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <KeyRound size={18} color={p.ink} />
          <Txt v="h3">Access key</Txt>
        </View>
        <Txt v="small" muted>Outside the demo, each person signs in with the key their organisation gave them.</Txt>
        <Field label="Key" value={key} onChange={setKey} autoCapitalize="none" secure />
        <Button variant="outline" disabled={!key.trim() || !!busy} loading={busy === "key"} onPress={() => go({ key: key.trim() }, "key")}>Sign in with key</Button>
      </Card>
      <Txt v="small" muted center>Connected to {serverLabel()} · PayPal sandbox, no real money</Txt>
    </Screen>
  );
}
