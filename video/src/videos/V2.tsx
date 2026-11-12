import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, F } from "../theme";
import { Chip, clamp, Counter, Defs, ease, Enter, Label, Sfx, Source, Stage, Stamp, useSpring, Words } from "../components/core";
import { Phone, Tilt } from "../components/devices";
import { EndCard } from "../components/end";

// Video 2: "Let the agents settle it". Real run on live order SS-1011, 12 Nov 2026: café agent and wholesaler agent
// (both gpt-6.1-sol), each with only its own brief; the referee in code refused 80% (below the 90% floor).
// Music: Mixkit "Deep Urban", 124 bpm, bars every 58 frames from frame 14.

export const V2_LEN = 900;

export function V2() {
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <Defs />
      <Audio src={staticFile("audio/music-v2.mp3")} volume={(f) => interpolate(f, [0, 10, 850, 900], [0, 0.6, 0.6, 0], clamp)} />
      <Sequence durationInFrames={112}><Stat /></Sequence>
      <Sequence from={112} durationInFrames={80}><Question /></Sequence>
      <Sequence from={192} durationInFrames={468}><Table /></Sequence>
      <Sequence from={660} durationInFrames={160}><Approve /></Sequence>
      <Sequence from={820} durationInFrames={80}>
        <EndCard line="Models write the words. Code decides the numbers." sub="LIVE RUN · ORDER SS-1011 · TWO GPT-6.1 AGENTS · ONE REFEREE IN CODE" glow={C.ai} />
        <Sfx src="impact" volume={0.35} />
      </Sequence>
    </AbsoluteFill>
  );
}

function Stat() {
  return (
    <Stage glow={C.ai} grid>
      <AbsoluteFill style={{ padding: "0 160px", justifyContent: "center", gap: 26 }}>
        <Label text="By 2028" at={2} color={C.ai} size={28} />
        <div style={{ fontFamily: F.display, fontWeight: 900, fontSize: 300, color: C.paper, lineHeight: 0.9, fontVariationSettings: '"wdth" 115' }}>
          <Counter to={15} at={6} dur={34} fmt={(v) => `${Math.round(v)}%`} />
        </div>
        <Words text="of day-to-day work decisions will be made by AI agents." at={20} size={60} weight={700} color="#ffffffcc" stagger={2} />
      </AbsoluteFill>
      <Source at={20} text="Gartner, press release, 25 June 2025" />
      <Sfx src="riser" at={0} volume={0.3} trim={60} />
      <Sfx src="pop" at={40} volume={0.4} />
    </Stage>
  );
}

function Question() {
  return (
    <Stage glow={C.held}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Words text={"So who stops your agent\nfrom overpaying?"} at={2} size={104} align="center" hl={{ overpaying: C.held }} stagger={3} />
      </AbsoluteFill>
      <Sfx src="whoosh" at={0} volume={0.4} />
    </Stage>
  );
}

const moves = [
  { side: "buyer", text: "Replace the 2 short cases at 80% of the quote.", verdict: "refused", why: "80% is below the supplier's floor (90% of the quote)", at: 120 },
  { side: "buyer", text: "Then credit the shortfall instead.", verdict: "allowed", why: "inside both limits", at: 214 },
  { side: "supplier", text: "Agreed. We'll credit it, no replacement.", verdict: "agreed", why: "both sides inside their limits", at: 284 },
];

function Table() {
  const f = useCurrentFrame();
  const intro = useSpring(0, { damping: 18, stiffness: 100 });
  const settle = interpolate(f, [372, 396], [0, 1], { ...clamp, easing: ease });
  return (
    <Stage glow={C.ai} grid>
      <AbsoluteFill style={{ padding: "90px 110px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", opacity: 1 - settle }}>
          <AgentCard at={4} name="Café's agent" org="Laneway Café" model="gpt-6.1-sol" brief={["Owner's limit: up to 100% of quote", "Ask for 20% goodwill", "Needs it by 15 Nov"]} color={C.carbon} />
          <Referee at={20} f={f} />
          <AgentCard at={10} name="Wholesaler's agent" org="Harbour Wholesale" model="gpt-6.1-sol" brief={["Floor: 90% of quote", "Prefers to replace", "Never sees the café's limit"]} color={C.held} />
        </div>
        <div style={{ position: "absolute", left: 110, right: 110, top: 470, opacity: 1 - settle }}>
          {moves.map((m, i) => <Move key={i} m={m} f={f} />)}
        </div>
        <Enter at={42} out={110}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 500, textAlign: "center", fontFamily: F.sans, fontSize: 36, color: "#ffffffaa" }}>
            Two separate model calls. Each sees only its own side's brief.
          </div>
        </Enter>
        {f > 372 && <Fingerprint f={f - 372} />}
      </AbsoluteFill>
      <Sfx src="whoosh-fast" at={4} volume={0.4} />
      <Sfx src="whoosh-fast" at={10} volume={0.4} />
      <Sfx src="ui" at={20} volume={0.4} />
      {moves.map((m) => (
        <React.Fragment key={m.at}>
          <Sfx src="pop2" at={m.at} volume={0.35} />
          <Sfx src="typing" at={m.at + 2} volume={0.15} dur={22} />
          <Sfx src={m.verdict === "refused" ? "error" : "success2"} at={m.at + 34} volume={m.verdict === "refused" ? 0.5 : 0.3} />
          <Sfx src="thump" at={m.at + 34} volume={0.8} />
        </React.Fragment>
      ))}
      <Sfx src="sweep" at={370} volume={0.35} />
      <Sfx src="typing" at={392} volume={0.2} dur={30} />
      <Sfx src="chime" at={430} volume={0.4} />
      {intro < 0 && null}
    </Stage>
  );
}

function AgentCard({ at, name, org, model, brief, color }: { at: number; name: string; org: string; model: string; brief: string[]; color: string }) {
  const p = useSpring(at, { damping: 16, stiffness: 120 });
  return (
    <div style={{ width: 600, padding: "30px 34px", borderRadius: 22, border: `2px solid ${color}66`, background: `linear-gradient(160deg, ${color}1c, #ffffff06)`, transform: `translateY(${(1 - p) * 60}px)`, opacity: p, boxShadow: `0 30px 80px #0008, 0 0 60px ${color}18` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 16, height: 16, borderRadius: 8, background: color, boxShadow: `0 0 18px ${color}` }} />
        <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 40, color: C.paper }}>{name}</div>
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 21, color: "#ffffff80", marginTop: 8 }}>{org} · {model}</div>
      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        {brief.map((b) => (
          <div key={b} style={{ fontFamily: F.sans, fontSize: 27, color: "#ffffffd0", display: "flex", gap: 12 }}>
            <span style={{ color }}>🔒</span>
            {b}
          </div>
        ))}
      </div>
    </div>
  );
}

function Referee({ at, f }: { at: number; f: number }) {
  const p = useSpring(at, { damping: 14, stiffness: 140 });
  const active = moves.find((m) => f >= m.at + 22 && f < m.at + 50);
  const pulse = active ? 0.5 + 0.5 * Math.sin(f / 2) : 0;
  return (
    <div style={{ marginTop: 50, width: 360, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, opacity: p, transform: `scale(${0.7 + p * 0.3})` }}>
      <div style={{ width: 150, height: 150, borderRadius: 30, border: `3px solid ${C.paper}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.mono, fontWeight: 700, fontSize: 52, color: C.paper, background: "#ffffff0a", boxShadow: `0 0 ${20 + pulse * 60}px ${C.paper}${active ? "66" : "22"}` }}>
        {"</>"}
      </div>
      <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 30, color: C.paper }}>Referee</div>
      <div style={{ fontFamily: F.mono, fontSize: 19, color: "#ffffff80", textAlign: "center" }}>plain code · checks every offer against both limits</div>
    </div>
  );
}

function Move({ m, f }: { m: (typeof moves)[number]; f: number }) {
  const local = f - m.at;
  if (local < 0) return null;
  const left = m.side === "buyer";
  const p = interpolate(local, [0, 14], [0, 1], { ...clamp, easing: ease });
  const shown = Math.floor(interpolate(local, [4, 26], [0, m.text.length], clamp));
  const col = left ? C.carbon : C.held;
  const vcol = m.verdict === "refused" ? C.stop : C.paid;
  const dim = moves.some((n) => n.at > m.at && f >= n.at) ? 0.35 : 1;
  return (
    <div style={{ display: "flex", justifyContent: left ? "flex-start" : "flex-end", marginBottom: 26, opacity: p * dim, transform: `translateX(${(1 - p) * (left ? -80 : 80)}px)` }}>
      <div style={{ display: "flex", flexDirection: left ? "row" : "row-reverse", alignItems: "center", gap: 30 }}>
        <div style={{ maxWidth: 780, padding: "22px 30px", borderRadius: 24, background: `${col}22`, border: `2px solid ${col}77`, fontFamily: F.sans, fontWeight: 600, fontSize: 36, color: C.paper }}>
          {m.text.slice(0, shown)}
        </div>
        {local >= 34 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: left ? "flex-start" : "flex-end", gap: 8 }}>
            <Stamp text={m.verdict} at={m.at + 34} color={vcol} size={40} rotate={left ? -5 : 5} />
            <div style={{ fontFamily: F.mono, fontSize: 20, color: vcol, opacity: interpolate(local, [40, 48], [0, 1], clamp) }}>referee: {m.why}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Fingerprint({ f }: { f: number }) {
  const hash = "a3c14df32d11";
  const full = "sha256 a3c14df32d11 · HMAC-signed by both sides";
  const n = Math.floor(interpolate(f, [18, 50], [0, full.length], clamp));
  const p = interpolate(f, [0, 20], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 34, opacity: p }}>
      <Label text="Resolution v4 · agreed by the agents" at={0} color={C.ai} size={26} />
      <Words text="The deal becomes a fingerprinted version." at={4} size={78} align="center" hl={{ fingerprinted: C.ai }} />
      <div style={{ fontFamily: F.mono, fontSize: 38, color: C.paper, padding: "20px 34px", borderRadius: 14, border: `2px dashed ${C.ai}88`, background: "#ffffff08" }}>
        {full.slice(0, n)}
        <span style={{ opacity: n < full.length ? 1 : 0 }}>▍</span>
      </div>
      <div style={{ display: "flex", gap: 18 }}>
        <Chip text="credit · 2 cases Barista Oat" at={56} color={C.paper} />
        <Chip text="no replacement charged" at={62} color={C.paid} />
      </div>
      <div style={{ display: "none" }}>{hash}</div>
    </AbsoluteFill>
  );
}

function ApprovePhone({ who, org, at, color }: { who: string; org: string; at: number; color: string }) {
  const f = useCurrentFrame();
  const tapped = f >= at + 26;
  const press = interpolate(f, [at + 22, at + 26, at + 30], [1, 0.94, 1], clamp);
  return (
    <div style={{ position: "relative" }}>
    <Phone height={880} glow={color}>
      <div style={{ width: 390, height: 844, background: C.paper, padding: "70px 22px 0", fontFamily: F.sans, color: C.ink2 }}>
        <div style={{ fontFamily: F.mono, fontSize: 12, letterSpacing: "0.12em", color: "#5f5a4f" }}>SS-1011 · APPROVALS</div>
        <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 30, marginTop: 8, lineHeight: 1.05 }}>The agents agreed a fix</div>
        <div style={{ fontSize: 16, color: "#5f5a4f", marginTop: 6 }}>{who} · {org}</div>
        <div style={{ marginTop: 18, border: "1.5px solid #1b1a16", borderRadius: 8, padding: 14, background: C.card }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}><b>Resolution v4</b><span style={{ fontFamily: F.mono, fontSize: 12 }}>a3c14df32d11</span></div>
          <div style={{ fontSize: 15, marginTop: 10, lineHeight: 1.4 }}>Barista Oat 12 x 1 L · 2 cases short<br />Remedy: <b>credit</b> (agreed by both agents)<br />Referee: inside both limits</div>
          <div style={{ marginTop: 12, background: C.ink2, color: C.paper, borderRadius: 6, padding: 12, fontSize: 14, lineHeight: 1.45 }}>
            <b>What moves when both approve</b><br />Capture only the accepted cases<br />Release the rest of the hold
          </div>
        </div>
        <div style={{ marginTop: 18, transform: `scale(${press})`, background: tapped ? C.paidDeep : C.ink2, color: C.paper, borderRadius: 8, padding: "14px 0", textAlign: "center", fontWeight: 700, fontSize: 18 }}>
          {tapped ? "✓ Approved v4" : "Approve v4"}
        </div>
        <div style={{ fontSize: 13, color: "#5f5a4f", marginTop: 10 }}>Until both approve, nothing is charged.</div>
      </div>
    </Phone>
    <div style={{ position: "absolute", left: 0, right: 0, top: 380, display: "flex", justifyContent: "center" }}><Stamp text="Approved" at={at + 26} color={C.paid} size={50} rotate={-8} fill /></div>
    </div>
  );
}

function Approve() {
  return (
    <Stage glow={C.paid} grid>
      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "0 120px", gap: 60 }}>
        <div style={{ width: 640, display: "flex", flexDirection: "column", gap: 28 }}>
          <Label text="People still sign off" at={2} color={C.paid} />
          <Words text={"Both people approve.\nThen PayPal moves."} at={6} size={72} hl={{ PayPal: C.paid }} />
          <Enter at={96}>
            <div style={{ fontFamily: F.mono, fontSize: 25, color: "#ffffffaa", lineHeight: 1.8 }}>
              ✓ capture only what was accepted
              <br />✓ release the rest of the hold
              <br />✓ only the agreed version settles
            </div>
          </Enter>
        </div>
        <Tilt from={[-14, 4, 0.9]} to={[-5, 1, 1]} dur={160}>
          <div style={{ display: "flex", gap: 50, alignItems: "center" }}>
            <Enter at={0} y={140}><ApprovePhone who="Jordan" org="Laneway Café" at={20} color={C.carbon} /></Enter>
            <Enter at={12} y={180}><ApprovePhone who="Ana" org="Harbour Wholesale" at={56} color={C.held} /></Enter>
          </div>
        </Tilt>
      </AbsoluteFill>
      <Sfx src="whoosh" at={0} volume={0.4} />
      <Sfx src="click" at={44} volume={0.7} />
      <Sfx src="thump" at={46} volume={0.8} />
      <Sfx src="click" at={80} volume={0.7} />
      <Sfx src="thump" at={82} volume={0.8} />
      <Sfx src="success" at={98} volume={0.4} />
    </Stage>
  );
}
