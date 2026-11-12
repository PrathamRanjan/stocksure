import React from "react";
import { AbsoluteFill, Audio, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, F } from "../theme";
import { Chip, clamp, Counter, Defs, ease, Enter, Label, Logo, Sfx, Source, Stage, Stamp, Tally, useSpring, usd, Words } from "../components/core";
import { Focus, Laptop, Phone, Tilt } from "../components/devices";
import { EndCard } from "../components/end";

// Video 1: "Pay only for what arrived". Real live-demo order SS-1008 (12 Nov 2026, PayPal sandbox).
// Music: Mixkit "Uplifting Bass", 135 bpm, bars every 53.3 frames from frame 13.

export const V1_LEN = 900;

export function V1() {
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <Defs />
      <Audio src={staticFile("audio/music-v1.mp3")} volume={(f) => interpolate(f, [0, 10, 850, 900], [0, 0.5, 0.5, 0], clamp)} />
      <Sequence durationInFrames={120}><Hook /></Sequence>
      <Sequence from={120} durationInFrames={110}><PaidInFull /></Sequence>
      <Sequence from={230} durationInFrames={106}><Margin /></Sequence>
      <Sequence from={336} durationInFrames={52}><Reveal /></Sequence>
      <Sequence from={388} durationInFrames={160}><Hold /></Sequence>
      <Sequence from={548} durationInFrames={106}><Door /></Sequence>
      <Sequence from={654} durationInFrames={162}><Split /></Sequence>
      <Sequence from={816} durationInFrames={84}>
        <EndCard line="Pay only for what arrived." sub="REAL PAYPAL SANDBOX · ORDER SS-1008 · CAPTURE 7DU10198V0152671T" />
        <Sfx src="impact" volume={0.35} />
      </Sequence>
    </AbsoluteFill>
  );
}

function Hook() {
  const f = useCurrentFrame();
  const swap = interpolate(f, [62, 70], [0, 1], clamp);
  return (
    <Stage glow={C.held}>
      <AbsoluteFill style={{ padding: "150px 160px", justifyContent: "space-between" }}>
        <Label text="Delivery · SS-1008 · Almond milk" at={2} />
        <div style={{ position: "relative", height: 120 }}>
          <div style={{ position: "absolute", opacity: 1 - swap }}><Words text="8 cases ordered." at={6} size={120} /></div>
          {f > 62 && <div style={{ position: "absolute" }}><Words text="2 arrived crushed." at={64} size={120} hl={{ crushed: C.stop }} /></div>}
        </div>
        <Tally n={8} damaged={2} at={10} dmgAt={56} h={300} w={46} gap={30} />
      </AbsoluteFill>
      {Array.from({ length: 8 }).map((_, i) => <Sfx key={i} src="tick" at={10 + i * 3} volume={0.5} />)}
      <Sfx src="glitch2" at={58} volume={0.45} />
      <Sfx src="whoosh-fast" at={62} volume={0.3} />
    </Stage>
  );
}

function PaidInFull() {
  return (
    <Stage glow={C.stop}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 60 }}>
        <Words text="The invoice still says 8." at={2} size={96} align="center" />
        <Stamp text="Paid in full" at={34} color={C.stop} size={110} rotate={-8} />
      </AbsoluteFill>
      <Sfx src="thump" at={34} volume={1} />
      <Sfx src="impact" at={34} volume={0.25} />
    </Stage>
  );
}

function Margin() {
  return (
    <Stage glow={C.held} grid>
      <AbsoluteFill style={{ padding: "130px 160px", justifyContent: "center", gap: 70 }}>
        <div style={{ display: "flex", gap: 140 }}>
          <Enter at={0}>
            <div style={{ fontFamily: F.display, fontWeight: 900, fontSize: 210, color: C.paper, lineHeight: 1, fontVariationSettings: '"wdth" 112' }}>
              <Counter to={2.8} dur={26} fmt={(v) => `${v.toFixed(1)}%`} />
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 34, color: "#ffffffaa", marginTop: 16, maxWidth: 560 }}>median profit of a full-service restaurant</div>
          </Enter>
          <Enter at={14}>
            <div style={{ fontFamily: F.display, fontWeight: 900, fontSize: 210, color: C.stop, lineHeight: 1, fontVariationSettings: '"wdth" 112' }}>
              <Counter to={1.5} at={14} dur={26} fmt={(v) => `${v.toFixed(1)}%`} />
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 34, color: "#ffffffaa", marginTop: 16, maxWidth: 560 }}>average overcharge found on distributor invoices</div>
          </Enter>
        </div>
        <Words text="The margin leaks at the back door." at={44} size={64} weight={700} color={C.held} />
      </AbsoluteFill>
      <Source at={20} text="NRA Restaurant Operations Data Abstract 2025 · Buyers Edge, via QSR Web" />
      <Sfx src="swell" at={0} volume={0.35} />
      <Sfx src="pop" at={26} volume={0.4} />
      <Sfx src="pop" at={40} volume={0.4} />
    </Stage>
  );
}

function Reveal() {
  return (
    <Stage glow={C.paid} grid>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Logo at={0} size={1.15} />
      </AbsoluteFill>
      <Sfx src="boom" at={0} trim={50} volume={0.5} />
    </Stage>
  );
}

function Hold() {
  const f = useCurrentFrame();
  return (
    <Stage glow={C.held} grid>
      <AbsoluteFill style={{ padding: "0 110px", alignItems: "center", flexDirection: "row", gap: 70 }}>
        <div style={{ width: 560, display: "flex", flexDirection: "column", gap: 34 }}>
          <Label text="01 · Order" at={4} color={C.held} />
          <Words text={"Accept the quote.\nPayPal holds $88."} at={8} size={70} hl={{ $88: C.held }} />
          <Enter at={34}><div style={{ fontFamily: F.sans, fontSize: 34, color: "#ffffffb0", lineHeight: 1.35 }}>A vaulted authorization, not a charge. Nothing moves until both sides agree what came off the truck.</div></Enter>
          <div style={{ marginTop: 10 }}><Stamp text="Held · $88.00" at={52} color={C.held} size={50} rotate={-5} /></div>
        </div>
        <Tilt from={[-16, 6, 0.86]} to={[-7, 2, 0.98]} dur={160}>
          <Enter at={0} y={120} blur={20}>
            <Laptop width={1150} glow={C.held} origin="100% 0%" cam={[[0, 0, 1], [60, 0, 1], [120, 330, 1.5]]}>
              <Img src={staticFile("shots/order-settled-top.png")} style={{ width: 1440 }} />
              <Focus x={1000} y={748} w={318} h={58} at={70} color={C.held} />
            </Laptop>
          </Enter>
        </Tilt>
      </AbsoluteFill>
      <Sfx src="whoosh" at={0} volume={0.45} />
      <Sfx src="click" at={40} volume={0.6} />
      <Sfx src="thump" at={52} volume={0.9} />
      <Sfx src="ui" at={72} volume={0.35} />
      {f > 0 && null}
    </Stage>
  );
}

function Door() {
  return (
    <Stage glow={C.ai} grid>
      <AbsoluteFill style={{ padding: "0 150px", alignItems: "center", flexDirection: "row", gap: 110 }}>
        <Tilt from={[18, 4, 0.88]} to={[8, 0, 0.98]} dur={106}>
          <Enter at={0} y={140} blur={20}>
            <div style={{ position: "relative" }}>
              <Phone height={900} glow={C.ai} cam={[[0, 0, 1], [60, 0, 1.0], [106, 0, 1.06]]}>
                <Img src={staticFile("shots/phone-door-photo-result.png")} style={{ width: 390 }} />
              </Phone>
              <ScanBeam />
            </div>
          </Enter>
        </Tilt>
        <div style={{ display: "flex", flexDirection: "column", gap: 30, width: 820 }}>
          <Label text="02 · Receive" at={4} color={C.ai} />
          <Words text={"AI counts it\nat the door."} at={8} size={88} hl={{ AI: C.ai }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, maxWidth: 800 }}>
            <Chip text="8 cases in the photo" at={30} color={C.paper} />
            <Chip text="2 crushed" at={36} color={C.stop} />
            <Chip text="label matches order · 100%" at={42} color={C.paid} />
            <Chip text="photo of a screen · 0%" at={48} color={C.carbon} />
          </div>
          <Enter at={58}><div style={{ fontFamily: F.sans, fontSize: 30, color: "#ffffff99" }}>Vision model plus OpenAI Decisions. A proposal only: a person confirms every count.</div></Enter>
        </div>
      </AbsoluteFill>
      <Sfx src="shutter" at={14} volume={0.8} />
      {[30, 36, 42, 48].map((t) => <Sfx key={t} src="pop2" at={t} volume={0.25} />)}
    </Stage>
  );
}

function ScanBeam() {
  const f = useCurrentFrame();
  const y = interpolate(f, [16, 46], [0, 860], { ...clamp, easing: ease });
  const o = interpolate(f, [14, 18, 44, 50], [0, 1, 1, 0], clamp);
  return <div style={{ position: "absolute", left: 18, right: 18, top: 18 + y, height: 6, background: C.ai, boxShadow: `0 0 40px 14px ${C.ai}88`, opacity: o, borderRadius: 3 }} />;
}

function Split() {
  const f = useCurrentFrame();
  const sp = useSpring(18, { damping: 18, stiffness: 90 });
  const rep = useSpring(78, { damping: 16, stiffness: 120 });
  const total = 1360;
  const capW = total * (66 / 88);
  return (
    <Stage glow={C.paid} grid>
      <AbsoluteFill style={{ padding: "120px 180px", justifyContent: "center", gap: 46 }}>
        <Label text="03 · Settle on PayPal" at={2} color={C.paid} />
        <Words text="Charge what arrived. Release the rest." at={4} size={70} hl={{ Charge: C.paid, Release: C.released }} />
        <div style={{ position: "relative", width: total, height: 120, marginTop: 20 }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: 120, width: capW - sp * 10, borderRadius: 16, background: interpolateHex(sp, C.held, C.paidDeep), display: "flex", alignItems: "center", paddingLeft: 34, overflow: "hidden" }}>
            <span style={{ fontFamily: F.display, fontWeight: 900, fontSize: 54, color: C.paper }}>{sp < 0.5 ? "$88.00 hold" : "$66.00 captured"}</span>
          </div>
          <div style={{ position: "absolute", left: capW + sp * 30, top: 0, height: 120, width: total - capW, borderRadius: 16, background: interpolateHex(sp, C.held, "#3a3d44"), transform: `translateY(${sp * 0}px)`, display: "flex", alignItems: "center", justifyContent: "center", opacity: 1 - sp * 0.25 }}>
            <span style={{ fontFamily: F.display, fontWeight: 900, fontSize: 40, color: C.paper, opacity: sp }}>$22 back</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 22, alignItems: "center", height: 80 }}>
          <Stamp text="Captured" at={30} color={C.paid} size={40} rotate={-4} />
          <Stamp text="Released · PayPal confirmed" at={44} color={C.released} size={40} rotate={3} />
        </div>
        <div style={{ opacity: rep, transform: `translateY(${(1 - rep) * 40}px)`, display: "flex", alignItems: "center", gap: 30 }}>
          <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 46, color: C.held }}>+ 2 replacement cases · new $22.00 hold</div>
          <div style={{ fontFamily: F.mono, fontSize: 26, color: "#ffffff88" }}>
            spendable <Counter from={120} to={32} at={84} dur={30} fmt={(v) => usd(v)} /> of $120 limit
          </div>
        </div>
        <Enter at={104}>
          <div style={{ fontFamily: F.mono, fontSize: 24, color: "#ffffff70", lineHeight: 1.7 }}>
            hold 5BR5635463466715D → capture 7DU10198V0152671T → release confirmed by read-back → hold SS-1008-R1
            <br />Check against PayPal: every id matched
          </div>
        </Enter>
      </AbsoluteFill>
      <Sfx src="sweep" at={16} volume={0.35} />
      <Sfx src="thump" at={30} volume={0.8} />
      <Sfx src="thump" at={44} volume={0.7} />
      <Sfx src="success" at={80} volume={0.4} />
      <Sfx src="typing" at={104} volume={0.18} dur={40} />
      {f < 0 && null}
    </Stage>
  );
}

function interpolateHex(t: number, a: string, b: string) {
  const x = Math.min(1, Math.max(0, t));
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * x)).join(",")})`;
}
