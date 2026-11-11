import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Stamp } from "@/components/brand";
import { paymentDestinations, type FoundDestination } from "@/lib/destinations";

/**
 * Spec A6.6: the landing page's try-it box. The on-device text model (MiniLM, int8 ONNX, the same files the safety
 * page uses) loads only when asked, with a progress bar; the service worker caches /static/ so a second visit is
 * instant. The text never leaves the browser. Never green when the text names somewhere to pay.
 */
const ORT = "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.22.0/";
const MODEL = "/static/safety/model/model_quantized.onnx";
const SAMPLE = "Hi Jordan, hope you're well! Just a quick note that we've moved banks, so please send this month's payment to our new PayPal: harbourwholesale.accounts@outlook.com. Thanks so much, Ana";
const TACTIC: Record<string, string> = {
  impersonation: "claims to be someone it may not be", urgency_secrecy: "pushes you to act fast or keep it quiet", changed_details: "asks you to pay to new or changed details",
  off_platform: "asks to be paid outside PayPal", gift_cards_crypto: "asks for gift cards or crypto", fee_to_release: "asks for a fee before something is released",
  otp_or_link: "asks for a code or sends a link", overpay_refund: "says someone overpaid", too_good: "promises something too good to be true",
};

type Guard = { score: (t: string) => Promise<{ p_scam: number; level: "hold" | "caution" | "clear"; tactics: Record<string, number> }> };
let guardP: Promise<Guard> | null = null;

function loadScript(src: string) {
  return new Promise<void>((ok, bad) => {
    if ((window as any).ort) return ok();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => ok();
    s.onerror = () => bad(new Error("The model runtime didn't load."));
    document.head.appendChild(s);
  });
}

async function fetchWithProgress(url: string, onProgress: (f: number) => void): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error("The model didn't download.");
  const total = Number(r.headers.get("content-length") ?? 0);
  const reader = r.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) onProgress(got / total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}

function guard(onProgress: (f: number) => void): Promise<Guard> {
  if (!guardP) {
    guardP = (async () => {
      // The service worker caches /static/ (the model included), so a second visit doesn't download it again.
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      await loadScript(`${ORT}ort.min.js`);
      const ort = (window as any).ort;
      ort.env.wasm.wasmPaths = ORT;
      const bytes = await fetchWithProgress(MODEL, onProgress);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
      const clientUrl = "/static/safety/guard-client.js";
      const mod = await import(/* @vite-ignore */ clientUrl);
      return mod.loadGuard({ modelUrl: url, tokenizerUrl: "/static/safety/model/tokenizer.json", headsUrl: "/static/safety/model/heads.json", ort });
    })().catch((e) => {
      guardP = null;
      throw e;
    });
  }
  return guardP;
}

interface Result { level: "hold" | "caution" | "clear"; green: boolean; ms: number; p: number; tactics: string[]; dest: FoundDestination[] }

export function TryScam() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const check = async () => {
    const t = text.trim();
    if (!t) return box.current?.focus();
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const g = await guard((f) => setProgress(f));
      setProgress(null);
      const t0 = performance.now();
      const s = await g.score(t);
      const ms = Math.round(performance.now() - t0);
      const dest = paymentDestinations(t);
      const tactics = Object.entries(s.tactics).filter(([, v]) => v >= 0.5).map(([k]) => TACTIC[k] ?? k);
      const level = s.level === "hold" ? "hold" : s.level === "caution" || dest.length ? "caution" : "clear";
      setRes({ level, green: level === "clear", ms, p: s.p_scam, tactics, dest });
    } catch (e) {
      setErr(`${(e as Error).message} Nothing was checked, so nothing is marked safe.`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <section className="rounded-lg border-2 border-foreground bg-card p-4 sm:p-5" aria-labelledby="try-title" id="try-scam">
      <h2 id="try-title" className="text-2xl">Got a message asking you to pay? Try the scam check</h2>
      <p className="mt-1 text-sm text-muted-foreground">Paste a supplier's email or text. A small model checks it on this device; nothing you paste is sent anywhere. Inside StockSure, messages also get the rules, OpenAI Decisions and a check against the supplier's details on file.</p>
      <div className="mt-3 grid gap-2">
        <Label htmlFor="try-text">Message to check</Label>
        <Textarea id="try-text" ref={box} rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
        <div className="flex flex-wrap items-center gap-2">
          <Button className="min-h-11" onClick={() => void check()} disabled={busy}>{busy ? "Checking…" : "Check on this device"}</Button>
          <Button variant="outline" className="min-h-11" onClick={() => setText(SAMPLE)} disabled={busy}>Paste the 10 Nov message</Button>
        </div>
        {progress !== null && (
          <div className="grid gap-1" role="status">
            <span className="text-sm">Downloading the model (23 MB, once): {Math.round(progress * 100)}%</span>
            <progress max={1} value={progress} className="h-2 w-full" aria-label="Model download" />
          </div>
        )}
      </div>
      <div aria-live="polite" className="mt-3">
        {err && <p className="text-sm text-destructive">{err}</p>}
        {res && (
          <div className="grid gap-1.5" data-level={res.level}>
            <p>
              <Stamp tone={res.level === "hold" ? "stop" : res.level === "caution" ? "held" : "paid"}>{res.level === "hold" ? "Don't pay on this" : res.level === "caution" ? "Check before you pay" : "No scam signs found"}</Stamp>
            </p>
            {res.dest.length > 0 && <p className="text-sm">It names somewhere to pay ({res.dest.map((d) => `${d.kind} ${d.value}`).join("; ")}). Confirm it by phone on a number you already had.</p>}
            {res.tactics.length > 0 && <p className="text-sm">The model reads it as: {res.tactics.join("; ")}.</p>}
            <p className="text-sm text-muted-foreground">Checked on this device in {res.ms} ms; nothing left your browser. Scam score {Math.round(res.p * 100)}%.</p>
          </div>
        )}
      </div>
    </section>
  );
}
