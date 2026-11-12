import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import Stack from "expo-router/stack";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlertTriangle, Bot, Camera, Check, FileText, Images, Upload, X } from "lucide-react-native";
import { Button, ButtonRow } from "@/components/button";
import { Card, Kicker, SectionTitle } from "@/components/card";
import { CheckRow, Field } from "@/components/field";
import { useHomeBack } from "@/components/home-back";
import { Stamp } from "@/components/stamp";
import { Empty, ErrorState, Loading, Notice } from "@/components/states";
import { Txt } from "@/components/text";
import { useTheme } from "@/components/theme";
import { useToast } from "@/components/toast";
import { useView } from "@/lib/api";
import { ago, day, plural } from "@/lib/format";
import { tap } from "@/lib/haptics";
import { radius, space } from "@/lib/theme";
import { appendFile, type Picked } from "@/lib/upload";
import { useAction } from "@/lib/useAction";

interface RLine {
  id: string;
  line_no: number;
  product: { sku: string; name: string; pack_label: string; pack_units: number; base_unit: string };
  expected_text: string;
  expected_packs: number;
  part1_accepted: string | null;
  proposal: { delivered: number | null; delivered_text: string | null; damaged_text: string | null; confidence: number | null; flags: string[]; hints: string[]; source: string | null };
  disputed: string | null;
  prefill: { delivered: string; damaged: string; wrong: string; note: string };
  unsure: boolean;
  damage_flag: boolean;
}
interface RModel {
  po: { id: string; number: string; status: string; supplier_name: string; buyer_name: string; deliver_by: string };
  open: boolean;
  mode: string;
  demo: { samples: boolean };
  reader: string;
  lines: RLine[];
  extractions: { id: string; filename: string; kind: string; source: string; created_at: string; flags: { kind: string; text: string }[]; lines: unknown[]; damage: unknown[]; notes: string[] }[];
}

const FLAG_TEXT: Record<string, string> = { possible_damage: "Photo may show damage", not_on_note: "Not on the delivery note", low_confidence: "Reader isn't sure", unit_mismatch: "Units don't match the order" };

const fromImage = (a: ImagePicker.ImagePickerAsset, i: number): Picked => ({ uri: a.uri, name: a.fileName ?? `photo-${Date.now()}-${i}.jpg`, type: a.mimeType ?? "image/jpeg", file: a.file });

export default function Receive() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { p } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const v = useView<RModel>(`/api/ui/po/${id}/receive`);
  const { run, busy } = useAction(() => v.reload("quiet"));
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [docs, setDocs] = useState<Picked[]>([]);
  const [text, setText] = useState("");
  const [counts, setCounts] = useState<Record<string, RLine["prefill"]>>({});
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (v.data) setCounts(Object.fromEntries(v.data.lines.map((l) => [l.id, l.prefill])));
  }, [v.data]);

  const m = v.data;
  const headerLeft = useHomeBack();
  const set = (lid: string, k: keyof RLine["prefill"], val: string) => setCounts((c) => ({ ...c, [lid]: { ...c[lid], [k]: val } }));

  async function camera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return toast.error("Camera access is off. Turn it on in Settings, or pick photos from your library.");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (!r.canceled) setPhotos((x) => [...x, ...r.assets.map(fromImage)]);
  }
  async function library() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 8, quality: 0.7 });
    if (!r.canceled) setPhotos((x) => [...x, ...r.assets.map(fromImage)]);
  }
  async function docket() {
    const r = await DocumentPicker.getDocumentAsync({ type: ["image/*", "application/pdf", "text/plain"], multiple: true, copyToCacheDirectory: true });
    if (!r.canceled) setDocs((x) => [...x, ...r.assets.map((a) => ({ uri: a.uri, name: a.name, type: a.mimeType ?? "application/octet-stream", file: (a as { file?: File }).file }))]);
  }
  async function upload(sample?: string) {
    if (!m) return;
    const fd = new FormData();
    for (const f of docs) await appendFile(fd, "delivery_note", f);
    for (const f of photos) await appendFile(fd, "photo", f);
    if (text.trim()) fd.append("note_text", text);
    if (sample) fd.append("sample", sample);
    const r = await run(sample ? `s-${sample}` : "upload", `/po/${m.po.id}/receive/upload`, fd, { stay: true });
    if (r.ok) {
      setText("");
      setPhotos([]);
      setDocs([]);
    }
  }
  const nothing = !photos.length && !docs.length && !text.trim();

  return (
    <>
      <Stack.Screen options={{ title: m?.po.number ?? "Count it in", headerLeft }} />
      <ScrollView style={{ flex: 1, backgroundColor: p.paper }} contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
        <View style={{ width: "100%", maxWidth: 720, alignSelf: "center", gap: space.lg }}>
          {v.error && !m ? <ErrorState message={v.error.message} status={v.error.status} retry={() => v.reload()} /> : null}
          {!m && !v.error ? <Loading label="Loading the delivery" cards={2} /> : null}
          {m && (
            <>
              <View style={{ gap: 6 }}>
                <Txt v="display" accessibilityRole="header">{m.mode === "rest" ? "Count the rest in" : "Count it in"}</Txt>
                <Txt muted>{m.po.number} from {m.po.supplier_name} · due {day(m.po.deliver_by)}</Txt>
              </View>
              {m.open && m.mode !== "whole" && (
                <Notice tone="carbon">{m.mode === "part" ? "This is part 1 of a delivery in two parts. Count only what arrived; it's compared with what was shipped in this part." : "This is the rest of the order. Part 1 was already counted and charged; count only what arrived now. StockSure adds part 1 to it."}</Notice>
              )}
              {!m.open ? (
                <Empty title="Nothing to count right now">Counting opens when the supplier marks the order dispatched.</Empty>
              ) : (
                <>
                  <Card style={{ gap: 12 }}>
                    <SectionTitle style={{ marginBottom: 0 }} aside={<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Bot size={14} color={p.ink2} /><Txt v="small" muted>{m.reader}</Txt></View>}>1. Add the paperwork</SectionTitle>
                    <Txt v="small" muted>The docket and photos are read into suggested counts. You check them in step 2. The reader can't change prices or who gets paid.</Txt>
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <Big icon={Camera} label="Take a photo" onPress={camera} />
                      <Big icon={Images} label="From library" onPress={library} />
                      <Big icon={FileText} label="Docket file" onPress={docket} />
                    </View>
                    {(photos.length > 0 || docs.length > 0) && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                        {photos.map((f, i) => (
                          <Thumb key={f.uri} onRemove={() => setPhotos((x) => x.filter((_, j) => j !== i))} label={`photo ${i + 1}`}>
                            <Image source={{ uri: f.uri }} style={{ width: 84, height: 84 }} accessibilityIgnoresInvertColors />
                          </Thumb>
                        ))}
                        {docs.map((f, i) => (
                          <Thumb key={f.uri} onRemove={() => setDocs((x) => x.filter((_, j) => j !== i))} label={f.name}>
                            <View style={{ width: 84, height: 84, alignItems: "center", justifyContent: "center", gap: 4, padding: 6, backgroundColor: p.paper2 }}>
                              <FileText size={22} color={p.ink} />
                              <Txt v="small" numberOfLines={2} center style={{ fontSize: 11, lineHeight: 13 }}>{f.name}</Txt>
                            </View>
                          </Thumb>
                        ))}
                      </ScrollView>
                    )}
                    <Field label="Or paste the docket text" value={text} onChange={setText} multiline />
                    <Button full icon={Upload} disabled={nothing || !!busy} loading={busy === "upload"} onPress={() => upload()}>
                      {nothing ? "Read these" : `Read ${plural(photos.length + docs.length + (text.trim() ? 1 : 0), "item")}`}
                    </Button>
                    {m.demo.samples && (
                      <View style={{ backgroundColor: p.paper2, borderRadius: radius.md, padding: 12, gap: 8 }}>
                        <Txt v="smallSemi">Demo: use a sample docket</Txt>
                        <ButtonRow>
                          <Button size="sm" variant="outline" loading={busy === "s-clean"} disabled={!!busy} onPress={() => upload("clean")}>Everything arrived</Button>
                          <Button size="sm" variant="outline" loading={busy === "s-damaged"} disabled={!!busy} onPress={() => upload("damaged")}>Driver notes two crushed</Button>
                        </ButtonRow>
                      </View>
                    )}
                    {m.extractions.length > 0 && (
                      <View style={{ gap: 8 }}>
                        <Kicker>Read so far</Kicker>
                        {m.extractions.map((e) => (
                          <View key={e.id} style={{ borderWidth: 1, borderColor: p.rule, borderRadius: radius.md, padding: 12, gap: 4 }}>
                            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                              <Txt v="smallSemi" numberOfLines={1} style={{ flexShrink: 1 }}>{e.filename}</Txt>
                              <Stamp tone="quiet">{e.source}</Stamp>
                              <Txt v="small" muted>{ago(e.created_at)}</Txt>
                            </View>
                            <Txt v="small" muted>{plural(e.lines.length, "line")} read{e.damage.length ? ` · ${plural(e.damage.length, "damage note")}` : ""}</Txt>
                            {e.flags.length > 0 && (
                              <View style={{ flexDirection: "row", gap: 6 }}>
                                <AlertTriangle size={15} color={p.stop} style={{ marginTop: 2 }} />
                                <Txt v="small" color={p.stop} style={{ flex: 1 }}>{plural(e.flags.length, "instruction")} in the document ignored: {e.flags.map((f) => f.kind.replace(/_/g, " ")).join(", ")}</Txt>
                              </View>
                            )}
                          </View>
                        ))}
                      </View>
                    )}
                  </Card>

                  <Card look="do" style={{ gap: 14 }}>
                    <SectionTitle style={{ marginBottom: 0 }}>2. Confirm what arrived</SectionTitle>
                    <Txt v="small" muted>Type counts like “6 cs”, “36” or “5 cs + 4”. {m.extractions.length ? "Suggestions from the paperwork are filled in." : "Add paperwork for suggestions, or count by hand."}</Txt>
                    {m.lines.map((l) => {
                      const c = counts[l.id] ?? l.prefill;
                      const flag = l.unsure || !!l.disputed;
                      return (
                        <View key={l.id} style={{ borderWidth: flag ? 2 : 1, borderColor: flag ? p.held : p.rule, borderRadius: radius.md, padding: 14, gap: 10 }}>
                          <View style={{ flexDirection: "row", gap: 10 }}>
                            <Txt v="mono" muted style={{ marginTop: 3 }}>{l.line_no}</Txt>
                            <View style={{ flex: 1 }}>
                              <Txt v="bodySemi">{l.product.name}</Txt>
                              <Txt v="small" muted>Expected {l.expected_text} ({l.expected_packs} × {l.product.pack_label}){l.part1_accepted ? ` · part 1 accepted ${l.part1_accepted}` : ""}</Txt>
                            </View>
                          </View>
                          {l.disputed && <Notice tone="stop">{`Supplier disputed: ${l.disputed}`}</Notice>}
                          {l.proposal.delivered_text && (
                            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                              <Bot size={15} color={p.carbon} />
                              <Txt v="small">Suggests {l.proposal.delivered_text}{l.proposal.damaged_text ? `, ${l.proposal.damaged_text} damaged` : ""}</Txt>
                              {l.proposal.confidence !== null && <Txt v="small" muted>· {Math.round(l.proposal.confidence * 100)}% sure</Txt>}
                            </View>
                          )}
                          {l.proposal.flags.length > 0 && (
                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                              {l.proposal.flags.map((f) => <Stamp key={f} tone={f === "possible_damage" ? "stop" : "held"}>{FLAG_TEXT[f] ?? f.replace(/_/g, " ")}</Stamp>)}
                            </View>
                          )}
                          {l.proposal.hints.length > 0 && <Txt v="small" muted>{l.proposal.hints.join(" · ")}</Txt>}
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            <Field label="Arrived" value={c.delivered} onChange={(x) => set(l.id, "delivered", x)} mono autoCapitalize="none" style={{ flex: 1.2 }} />
                            <Field label="Damaged" value={c.damaged} onChange={(x) => set(l.id, "damaged", x)} mono autoCapitalize="none" style={{ flex: 1 }} />
                            <Field label="Wrong" value={c.wrong} onChange={(x) => set(l.id, "wrong", x)} mono autoCapitalize="none" style={{ flex: 1 }} />
                          </View>
                          {!c.delivered.trim() && (
                            <Pressable accessibilityRole="button" onPress={() => { tap(); set(l.id, "delivered", l.expected_text); }} style={{ alignSelf: "flex-start", minHeight: 36, justifyContent: "center", paddingHorizontal: 10, borderRadius: 18, borderWidth: 1, borderColor: p.rule }}>
                              <Txt v="smallSemi">All arrived: {l.expected_text}</Txt>
                            </Pressable>
                          )}
                          <Field label="Note (optional)" value={c.note} onChange={(x) => set(l.id, "note", x)} placeholder="e.g. one case crushed, milk leaking" />
                        </View>
                      );
                    })}
                    <CheckRow checked={checked} onChange={setChecked}>
                      <Txt>I checked the goods. These counts are what we accept. <Txt muted>The supplier sees them and can dispute a line.</Txt></Txt>
                    </CheckRow>
                    <Button
                      size="lg"
                      full
                      icon={Check}
                      disabled={!checked || !!busy || m.lines.some((l) => !(counts[l.id] ?? l.prefill).delivered.trim())}
                      loading={busy === "confirm"}
                      onPress={() => {
                        const data: Record<string, string> = { checked: checked ? "1" : "0" };
                        for (const l of m.lines) {
                          const c = counts[l.id] ?? l.prefill;
                          data[`delivered_${l.id}`] = c.delivered;
                          data[`damaged_${l.id}`] = c.damaged;
                          data[`wrong_${l.id}`] = c.wrong;
                          data[`note_${l.id}`] = c.note;
                        }
                        void run("confirm", `/po/${m.po.id}/receive/confirm`, data);
                      }}
                    >
                      Confirm counts
                    </Button>
                  </Card>
                </>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </>
  );
}

function Big({ icon: I, label, onPress }: { icon: typeof Camera; label: string; onPress: () => void }) {
  const { p } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { tap(); onPress(); }} style={({ pressed }) => ({ flex: 1, minHeight: 88, borderRadius: radius.md, borderWidth: 1.5, borderColor: p.ink, borderStyle: "dashed", backgroundColor: pressed ? p.paper2 : p.card, alignItems: "center", justifyContent: "center", gap: 6, padding: 8 })}>
      <I size={24} color={p.ink} />
      <Txt v="smallSemi" center>{label}</Txt>
    </Pressable>
  );
}

function Thumb({ children, onRemove, label }: { children: React.ReactNode; onRemove: () => void; label: string }) {
  const { p } = useTheme();
  return (
    <View style={{ borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: p.rule }}>
      {children}
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label}`} onPress={onRemove} hitSlop={10} style={{ position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: p.ink, alignItems: "center", justifyContent: "center" }}>
        <X size={14} color={p.onInk} />
      </Pressable>
    </View>
  );
}
