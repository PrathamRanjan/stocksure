import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { AlertTriangle, Bot, Camera, Check, FileText, QrCode, RotateCcw, Upload } from "lucide-react";
import { PhoneLink } from "@/components/phone-link";
import { PushToTalk } from "@/components/push-to-talk";
import { useView } from "@/lib/api";
import { ago, day, plural } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Empty, ErrorBlock, LoadingBlock, PageHeader, SectionTitle, Spinner, Stamp } from "@/components/brand";

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
  extractions: { id: string; document_id: string; filename: string; kind: string; source: string; created_at: string; flags: { kind: string; text: string }[]; lines: unknown[]; damage: unknown[]; notes: string[]; failed: boolean; door_photo?: boolean; screen?: boolean; description?: string | null; decisions?: { model: string | null; probabilities: Record<string, number | null>; count_clarity: string | null } | null; counted?: { sku: string | null; qty_text: string }[] }[];
}

const pct = (n: number | null | undefined) => (typeof n === "number" ? `${Math.round(n * 100)}%` : "no answer");

const FLAG_TEXT: Record<string, string> = { count_differs: "Photo and note disagree", identity_uncertain: "Label doesn't match the order", possible_damage: "Photo may show damage", not_on_note: "Not on the delivery note", low_confidence: "Reader isn't sure", unit_mismatch: "Units don't match the order" };

export default function Receive() {
  const { id } = useParams();
  const v = useView<RModel>(`/api/ui/po/${id}/receive`);
  const { run, busy } = useAction(() => v.reload(true));
  const notes = useRef<HTMLInputElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [counts, setCounts] = useState<Record<string, RLine["prefill"]>>({});
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (v.data) setCounts(Object.fromEntries(v.data.lines.map((l) => [l.id, l.prefill])));
  }, [v.data]);

  if (v.error && !v.data) return <ErrorBlock message={v.error.message} retry={() => v.reload()} status={v.error.status} />;
  if (!v.data) return <LoadingBlock label="Loading the delivery" />;
  const m = v.data;
  const set = (lid: string, k: keyof RLine["prefill"], val: string) => setCounts((c) => ({ ...c, [lid]: { ...c[lid], [k]: val } }));
  const read = m.extractions.length > 0;

  async function upload(sample?: string) {
    const fd = new FormData();
    for (const f of Array.from(notes.current?.files ?? [])) fd.append("delivery_note", f);
    for (const f of Array.from(photos.current?.files ?? [])) fd.append("photo", f);
    if (text.trim()) fd.append("note_text", text);
    if (sample) fd.append("sample", sample);
    const r = await run(sample ? `s-${sample}` : "upload", `/po/${m.po.id}/receive/upload`, fd, { stay: true });
    if (r.ok) {
      setText("");
      if (notes.current) notes.current.value = "";
      if (photos.current) photos.current.value = "";
    }
  }

  return (
    <>
      <PageHeader
        back={{ to: `/po/${m.po.id}`, label: m.po.number }}
        title={m.mode === "rest" ? "Count the rest in" : "Count it in"}
        sub={<>{m.po.number} from {m.po.supplier_name} · due {day(m.po.deliver_by)}</>}
      />
      {m.open && m.mode !== "whole" && (
        <p className="mb-5 rounded-md border border-carbon/40 bg-carbon-soft p-3" role="note">
          {m.mode === "part" ? <>This is <strong>part 1</strong> of a delivery in two parts. Count only what arrived; it's compared with what was shipped in this part.</> : <>This is <strong>the rest</strong> of the order. Part 1 was already counted and charged; count only what arrived now. StockSure adds part 1 to it.</>}
        </p>
      )}
      {!m.open ? (
        <Empty title="Nothing to count right now" action={<Button asChild variant="outline"><Link to={`/po/${m.po.id}`}>Back to the order</Link></Button>}>
          Counting opens when the supplier marks the order dispatched.
        </Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <section aria-labelledby="up-title" className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <SectionTitle id="up-title" aside={<span className="inline-flex items-center gap-1"><Bot className="size-4" aria-hidden="true" /> {m.reader}</span>}>1. Add the paperwork</SectionTitle>
            <p className="text-muted-foreground">The docket and photos are read into suggested counts. You check them in step 2. The reader can't change prices or who gets paid.</p>
            <div className="mt-4 grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="photos" className="flex items-center gap-2"><Camera className="size-4" aria-hidden="true" /> Photos of the delivery or damage</Label>
                <Input id="photos" ref={photos} type="file" accept="image/*" capture="environment" multiple className="h-auto py-2" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="notes" className="flex items-center gap-2"><FileText className="size-4" aria-hidden="true" /> Delivery docket (photo, PDF or text)</Label>
                <Input id="notes" ref={notes} type="file" accept="image/*,application/pdf,text/plain" multiple className="h-auto py-2" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ntext">Or paste the docket text, or say what arrived</Label>
                <Textarea id="ntext" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
                {m.reader.startsWith("OpenAI") && <PushToTalk label="Hold to say what arrived" onText={(t) => setText((x) => (x.trim() ? `${x.trim()}\n${t}` : t))} />}
              </div>
              <Button onClick={() => upload()} disabled={!!busy}>{busy === "upload" ? <Spinner /> : <Upload aria-hidden="true" />} Read these</Button>
              {m.demo.samples && (
                <div className="rounded-md bg-paper-2 p-3">
                  <p className="text-sm font-semibold">Demo: use a sample docket</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => upload("clean")}>{busy === "s-clean" && <Spinner />} Everything arrived</Button>
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => upload("damaged")}>{busy === "s-damaged" && <Spinner />} Driver notes two crushed</Button>
                  </div>
                  <p className="mt-3 text-sm font-semibold">Demo: count from a door photo</p>
                  <p className="text-xs text-muted-foreground">Generated drawings, not camera photos. Or take a real one above.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => upload("photo")} data-sample="photo">{busy === "s-photo" ? <Spinner /> : <Camera aria-hidden="true" />} Cases, two crushed (generated)</Button>
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => upload("screen")} data-sample="screen">{busy === "s-screen" ? <Spinner /> : <Camera aria-hidden="true" />} A photo of a screen (generated)</Button>
                  </div>
                </div>
              )}
              {m.demo.samples && <PhoneLink poId={m.po.id} icon={<QrCode className="size-4" aria-hidden="true" />} />}
            </div>
            {read && (
              <div className="mt-5">
                <p className="font-semibold">Read so far</p>
                <ul className="mt-2 space-y-2">
                  {m.extractions.map((e) => (
                    <li key={e.id} className="rounded-md border border-border p-3 text-sm">
                      <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">{e.filename}</span>{e.failed ? <Stamp tone="stop">Not read</Stamp> : <Stamp tone="quiet">{e.source}</Stamp>}<span className="text-muted-foreground">{ago(e.created_at)}</span></p>
                      {e.failed ? (
                        <div className="mt-1" role="alert">
                          <p>{e.notes[0] ?? "I couldn't read that. Try again, or fill it in below."} It's kept as evidence; nothing was guessed from it.</p>
                          <Button size="sm" variant="outline" className="mt-2" disabled={!!busy} onClick={() => run(`reread-${e.document_id}`, `/po/${m.po.id}/receive/reread/${e.document_id}`, {}, { stay: true })}>
                            {busy === `reread-${e.document_id}` ? <Spinner /> : <RotateCcw aria-hidden="true" />} Read it again
                          </Button>
                        </div>
                      ) : e.screen ? (
                        <p className="mt-1 flex gap-1.5 text-stop" role="alert" data-screen-photo><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {e.notes[0]}</p>
                      ) : e.door_photo ? (
                        <div className="mt-1" data-door-photo>
                          <p>{e.counted?.length ? e.counted.map((c) => `${c.sku ?? "?"}: ${c.qty_text}`).join(" · ") : "No cases counted."}{e.damage.length ? ` · ${e.damage.length} damage note${e.damage.length > 1 ? "s" : ""}` : ""}</p>
                          {e.decisions && <p className="text-xs text-muted-foreground">OpenAI Decisions on the photo: damage {pct(e.decisions.probabilities.shows_damage)} · label matches the order {pct(e.decisions.probabilities.label_matches_ordered_item)} · photo of a screen {pct(e.decisions.probabilities.photo_is_of_a_screen)} · countable: {e.decisions.count_clarity?.replace(/_/g, " ") ?? "no answer"}</p>}
                          {e.notes.map((n, i) => <p key={i} className="text-xs">{n}</p>)}
                          <p className="text-xs text-muted-foreground">A proposal only: you confirm every count in step 2.</p>
                        </div>
                      ) : (
                        <p className="text-muted-foreground">{plural(e.lines.length, "line")} read{e.damage.length ? ` · ${e.damage.length} damage note${e.damage.length > 1 ? "s" : ""}` : ""}</p>
                      )}
                      {e.flags.length > 0 && <p className="mt-1 flex gap-1.5 text-stop"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {plural(e.flags.length, "instruction")} in the document ignored: {e.flags.map((f) => f.kind.replace(/_/g, " ")).join(", ")}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <form
            aria-labelledby="count-title"
            className="rounded-lg border-2 border-foreground bg-card p-4 sm:p-5"
            onSubmit={(e) => {
              e.preventDefault();
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
            <SectionTitle id="count-title">2. Confirm what arrived</SectionTitle>
            <p className="text-muted-foreground">Type counts like <span className="mono">6 cs</span>, <span className="mono">36</span> or <span className="mono">5 cs + 4</span>. {read ? "Suggestions from the paperwork are filled in." : "Add paperwork for suggestions, or count by hand."}</p>
            <ol className="mt-4 grid gap-4">
              {m.lines.map((l) => {
                const c = counts[l.id] ?? l.prefill;
                return (
                  <li key={l.id} className={cn("rounded-md border p-3 sm:p-4", l.unsure || l.disputed ? "border-held" : "border-border")}>
                    <p className="font-semibold"><span className="mono mr-1 text-xs text-muted-foreground">{l.line_no}</span> {l.product.name}</p>
                    <p className="text-sm text-muted-foreground">Expected {l.expected_text} ({l.expected_packs} × {l.product.pack_label}){l.part1_accepted ? ` · part 1 accepted ${l.part1_accepted}` : ""}</p>
                    {l.disputed && <p className="mt-2 rounded-md bg-stop-soft px-3 py-2 text-sm"><span className="font-semibold">Supplier disputed:</span> {l.disputed}</p>}
                    {l.proposal.delivered_text && (
                      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        <Bot className="size-4" aria-hidden="true" /> Suggests {l.proposal.delivered_text}{l.proposal.damaged_text ? `, ${l.proposal.damaged_text} damaged` : ""}
                        {l.proposal.confidence !== null && <span className="text-muted-foreground">· {Math.round(l.proposal.confidence * 100)}% sure</span>}
                      </p>
                    )}
                    {l.proposal.flags.length > 0 && (
                      <ul className="mt-1 flex flex-wrap gap-1.5">{l.proposal.flags.map((f) => <li key={f}><Stamp tone={f === "possible_damage" ? "stop" : "held"}>{FLAG_TEXT[f] ?? f.replace(/_/g, " ")}</Stamp></li>)}</ul>
                    )}
                    {l.proposal.hints.length > 0 && <p className="mt-1 text-sm text-muted-foreground">{l.proposal.hints.join(" · ")}</p>}
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {(["delivered", "damaged", "wrong"] as const).map((k) => (
                        <div key={k} className="grid gap-1">
                          <Label htmlFor={`${k}-${l.id}`} className="text-sm">{k === "delivered" ? "Arrived" : k === "damaged" ? "Damaged" : "Wrong item"}</Label>
                          <Input id={`${k}-${l.id}`} value={c[k]} onChange={(e) => set(l.id, k, e.target.value)} className="num a11y-skip" required={k === "delivered"} autoComplete="off" />
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 grid gap-1">
                      <Label htmlFor={`note-${l.id}`} className="text-sm">Note (optional)</Label>
                      <Input id={`note-${l.id}`} value={c.note} onChange={(e) => set(l.id, "note", e.target.value)} placeholder="e.g. one case crushed, milk leaking" />
                    </div>
                  </li>
                );
              })}
            </ol>
            <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-md bg-paper-2 p-3">
              <input type="checkbox" className="mt-1 size-5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              <span>I checked the goods. These counts are what we accept. <span className="text-muted-foreground">The supplier sees them and can dispute a line.</span></span>
            </label>
            <Button type="submit" size="lg" className="mt-4 w-full sm:w-auto" disabled={!checked || !!busy}>
              {busy === "confirm" ? <Spinner /> : <Check aria-hidden="true" />} Confirm counts
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
