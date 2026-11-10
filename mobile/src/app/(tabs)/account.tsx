import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";
import { ExternalLink, LogOut, Server } from "lucide-react-native";
import { Button, ButtonRow } from "@/components/button";
import { Card, SectionTitle } from "@/components/card";
import { Field, Segmented } from "@/components/field";
import { Masthead } from "@/components/masthead";
import { Stamp } from "@/components/stamp";
import { Screen } from "@/components/states";
import { Txt } from "@/components/text";
import { useTheme, type Mode } from "@/components/theme";
import { useToast } from "@/components/toast";
import { TrustRow } from "@/components/trust";
import { api, LIVE_URL, serverLabel, serverUrl, setServer } from "@/lib/api";
import { useSession } from "@/lib/session";
import { openWeb } from "@/lib/useAction";

const ROLE: Record<string, string> = { owner: "Owner", receiving: "Receiving", supplier: "Supplier" };

export default function Account() {
  const { p, mode, setMode } = useTheme();
  const { session, refresh } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(serverUrl() || "");
  const who = session?.who;

  async function signOut() {
    setBusy(true);
    const r = await api.act("/logout");
    setBusy(false);
    if (!r.ok && r.message) toast.error(r.message);
    await refresh();
    router.replace("/sign-in");
  }

  return (
    <Screen top bottom={110}>
      <Masthead title="Account" />
      {who && (
        <Card style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
          <View style={{ width: 54, height: 54, borderRadius: 8, backgroundColor: p.ink, alignItems: "center", justifyContent: "center" }}>
            <Txt v="title" color={p.onInk} style={{ lineHeight: 34 }}>{who.first[0]}</Txt>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Txt v="h2">{who.name}</Txt>
            <Txt v="small" muted>{who.org}</Txt>
            <Stamp tone={who.side === "supplier" ? "carbon" : who.owner ? "ink" : "quiet"}>{ROLE[who.role] ?? who.role}</Stamp>
          </View>
        </Card>
      )}

      {session && (
        <Card style={{ gap: 12 }}>
          <SectionTitle style={{ marginBottom: 0 }}>Connections</SectionTitle>
          <Line k="PayPal" v={session.paypal ? (session.paypal.connected ? <Stamp tone="paid">Connected</Stamp> : <Stamp tone="quiet">Not connected</Stamp>) : <Stamp tone="quiet">Supplier side</Stamp>} sub={session.paypal?.payer ?? `${session.paypal_env} environment`} />
          <Line k="Document reader" v={<Txt v="smallSemi">{session.reader}</Txt>} />
          <Line k="Telegram alerts" v={<Stamp tone={session.channels.telegram ? "paid" : "quiet"}>{session.channels.telegram ? "On" : "Off"}</Stamp>} />
          <Line k="Web push" v={<Stamp tone={session.channels.push ? "paid" : "quiet"}>{session.channels.push ? "On" : "Off"}</Stamp>} />
        </Card>
      )}

      <Card style={{ gap: 12 }}>
        <SectionTitle style={{ marginBottom: 0 }}>Appearance</SectionTitle>
        <Segmented<Mode>
          label="Colour scheme"
          value={mode}
          onChange={setMode}
          options={[
            { v: "system", l: "System" },
            { v: "light", l: "Light" },
            { v: "dark", l: "Dark" },
          ]}
        />
      </Card>

      <Card style={{ gap: 12 }}>
        <SectionTitle style={{ marginBottom: 0 }} aside={<Server size={16} color={p.ink2} />}>Server</SectionTitle>
        <Txt v="small" muted>The app talks to the same StockSure server as the website: {serverLabel()}.</Txt>
        {Platform.OS !== "web" && (
          <>
            <Field label="Server address" value={url} onChange={setUrl} keyboardType="url" autoCapitalize="none" placeholder={LIVE_URL} />
            <ButtonRow>
              <Button
                variant="outline"
                size="sm"
                onPress={async () => {
                  if (!/^https?:\/\/[^\s]+$/i.test(url.trim())) return toast.error("Enter a full address starting with https://");
                  await setServer(url.trim());
                  toast.success(`Now using ${serverLabel()}`);
                  await refresh();
                }}
              >
                Use this server
              </Button>
              <Button variant="ghost" size="sm" onPress={() => { setUrl(LIVE_URL); void setServer(LIVE_URL).then(refresh); }}>Reset</Button>
            </ButtonRow>
          </>
        )}
        <Button variant="ghost" size="sm" icon={ExternalLink} onPress={() => void openWeb("/home")}>Open the full website</Button>
      </Card>

      <View style={{ gap: 8 }}>
        <Txt v="label" muted>How StockSure decides</Txt>
        <TrustRow />
      </View>

      {who && (
        <Button variant="outline" icon={LogOut} loading={busy} full onPress={signOut}>
          Sign out
        </Button>
      )}
    </Screen>
  );
}

function Line({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 32 }}>
      <View style={{ flex: 1 }}>
        <Txt v="bodySemi">{k}</Txt>
        {sub ? <Txt v="small" muted numberOfLines={1}>{sub}</Txt> : null}
      </View>
      {v}
    </View>
  );
}
