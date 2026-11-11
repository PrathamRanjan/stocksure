import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/brand";

interface Link { url: string; svg: string; expires_at: string; as: string }

/** Spec B4 item 4: a QR code that opens this receive page on a phone, signed in as the receiver, once, for 15 minutes. */
export function PhoneLink({ poId, icon }: { poId: string; icon: ReactNode }) {
  const [link, setLink] = useState<Link | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("phone") === "1") return null;
  async function make() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/ui/po/${poId}/phone-link`, { headers: { accept: "application/json" } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? "Couldn't make a phone link.");
      setLink(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-md border border-dashed border-input p-3" data-phone-link>
      <p className="flex items-center gap-2 text-sm font-semibold">{icon} Count at the door on your phone</p>
      {!link ? (
        <>
          <p className="text-xs text-muted-foreground">Scan a QR code to open this page on a phone, signed in as the receiver. The phone can count; it can't approve or pay.</p>
          <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={make}>{busy && <Spinner />} Show the QR code</Button>
        </>
      ) : (
        <div className="mt-2 flex flex-wrap items-start gap-3">
          {/* The SVG is made on the server by the qrcode library from our own URL. */}
          <div role="img" aria-label="QR code for this receive page" className="size-40 shrink-0 rounded bg-white p-1" dangerouslySetInnerHTML={{ __html: link.svg }} />
          <div className="min-w-0 flex-1 text-xs">
            <p>Signs the phone in as {link.as}. Works once, until {new Date(link.expires_at).toLocaleTimeString()}.</p>
            <p className="mt-1 break-all font-mono text-muted-foreground">{link.url}</p>
          </div>
        </div>
      )}
      {err && <p role="alert" className="mt-1 text-xs text-stop">{err}</p>}
    </div>
  );
}
