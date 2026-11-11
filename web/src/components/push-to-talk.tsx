import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/brand";

/**
 * Spec A7: push-to-talk dictation through OpenAI gpt-live-1, relayed by our server (the key never reaches the
 * browser). Hold the button, or press it once to start and again to stop. The live transcript shows as you speak;
 * the final text goes into the box for you to read and send. Typing always works.
 */
export function PushToTalk({ onText, label = "Hold to speak" }: { onText: (text: string) => void; label?: string }) {
  const [state, setState] = useState<"idle" | "connecting" | "listening" | "finishing">("idle");
  const [live, setLive] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const audio = useRef<{ ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode } | null>(null);
  const held = useRef(false);

  useEffect(() => () => stopAudio(), []);

  function stopAudio() {
    const a = audio.current;
    audio.current = null;
    if (!a) return;
    a.node.disconnect();
    a.stream.getTracks().forEach((t) => t.stop());
    void a.ctx.close().catch(() => undefined);
  }

  async function start() {
    if (state !== "idle") return;
    setMsg(null);
    setLive("");
    setState("connecting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      setState("idle");
      setMsg("No microphone access. You can type instead.");
      return;
    }
    const ctx = new AudioContext({ sampleRate: 24000 });
    const src = ctx.createMediaStreamSource(stream);
    // ScriptProcessor keeps this dependency-free; it turns float samples into 16-bit PCM for the live session.
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ui/voice`);
    sock.binaryType = "arraybuffer";
    ws.current = sock;
    node.onaudioprocess = (e) => {
      if (sock.readyState !== WebSocket.OPEN) return;
      const f = e.inputBuffer.getChannelData(0);
      const out = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) out[i] = Math.max(-1, Math.min(1, f[i])) * 0x7fff;
      sock.send(out.buffer);
    };
    src.connect(node);
    node.connect(ctx.destination);
    audio.current = { ctx, stream, node };
    sock.onmessage = (ev) => {
      const e = JSON.parse(String(ev.data));
      if (e.type === "ready") setState(held.current ? "listening" : "finishing");
      else if (e.type === "delta") setLive((t) => t + e.text);
      else if (e.type === "done") {
        setState("idle");
        stopAudio();
        if (e.text) onText(e.text);
        else setMsg("Nothing was heard. Try again, or type.");
      } else if (e.type === "error") {
        setState("idle");
        stopAudio();
        setMsg(e.message);
      }
    };
    sock.onclose = () => {
      stopAudio();
      setState((s) => (s === "idle" ? s : "idle"));
    };
    sock.onopen = () => {
      // Let go before the connection opened: send what was captured and stop.
      if (!held.current) sock.send(JSON.stringify({ type: "stop" }));
      setState(held.current ? "listening" : "finishing");
    };
  }

  function stop() {
    held.current = false;
    stopAudio();
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: "stop" }));
    setState((s) => (s === "idle" ? s : "finishing"));
  }

  const busy = state === "connecting" || state === "finishing";
  const listening = state === "listening" || state === "connecting";
  return (
    <div className="grid gap-1" data-push-to-talk>
      <Button
        type="button"
        variant={listening ? "carbon" : "outline"}
        size="sm"
        aria-pressed={listening}
        disabled={state === "finishing"}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          held.current = true;
          void start();
        }}
        onPointerUp={() => held.current && state !== "idle" && stop()}
        onPointerLeave={() => held.current && stop()}
        onKeyDown={(e) => {
          if (e.key !== " " && e.key !== "Enter") return;
          e.preventDefault();
          if (e.repeat) return;
          if (state === "idle") {
            held.current = true;
            void start();
          } else stop();
        }}
      >
        {busy ? <Spinner /> : listening ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
        {state === "idle" ? label : state === "finishing" ? "Writing it down…" : "Listening… let go to stop"}
      </Button>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {live ? <>Heard: “{live}”</> : msg ?? "Voice by OpenAI gpt-live-1, through StockSure's server. Keyboard: press Space to start and again to stop."}
      </p>
    </div>
  );
}
