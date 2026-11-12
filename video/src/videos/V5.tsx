// V5 "Fragments" — after the kit's v30 Raycast teaser. Never the whole product: tight crops of real StockSure UI,
// one per bar, each lit by a soft light that travels across it and falls off into black. Then a dim wall, then the name.
// Music: Mixkit #173 "Sci-Fi Score" 119 bpm; first beat 0.488 s, period 0.5042 s.
import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { CL, grid, Mark, Music, P3IO, P3O, S, scramble, TRADEMARKS, tw } from "../kit";

const B = 0.5042;
const b = grid(B);
export const V5_LEN = 900;
const AMBER = "#f0b45a";

// [crop, on-screen width, rotation, label]
const FR: [string, number, number, string][] = [
  ["f-doorphoto", 1240, -6, "AI reads the door photo."],
  ["f-suggest", 980, 5, "It suggests. You decide."],
  ["f-money", 860, -4, "PayPal holds. Nothing charged."],
  ["f-agreement", 1280, 6, "The fix, versioned and hashed."],
  ["f-moves", 1280, -5, "Pay for what arrived."],
  ["f-paypal", 780, 4, "Capture. Release. Hold again."],
  ["f-reconcile", 1180, -6, "Every id checked with PayPal."],
  ["f-signed", 1100, 5, "Two agents. Code referees."],
  ["f-invoice", 640, -4, "The invoice is compared. Never obeyed."],
  ["f-removed", 1280, 6, "Hidden prompts removed."],
];
const SIZES: Record<string, [number, number]> = {
  "f-doorphoto": [1032, 252], "f-suggest": [972, 692], "f-money": [704, 562], "f-agreement": [1176, 392], "f-moves": [1176, 360],
  "f-paypal": [704, 600], "f-reconcile": [620, 224], "f-signed": [688, 290], "f-invoice": [692, 704], "f-removed": [1172, 220],
};
const PAD: Record<string, string> = { "f-reconcile": "26px 40px" }; // its capture has no margin
const STEP = 4, F0 = 3;
const WALL = F0 + STEP * FR.length; // 43
const NAME = WALL + 4; // 47
// the wall: every fragment at once, small and dim [x, y, w]
const POS: [number, number, number][] = [
  [140, 150, 560], [740, 110, 380], [1160, 110, 330], [140, 450, 560], [740, 450, 560],
  [1530, 110, 250], [140, 700, 560], [740, 700, 560], [1340, 420, 260], [1340, 760, 440],
];

function Fragment({ f, i }: { f: number; i: number }) {
  const [name, w, r, label] = FR[i];
  const [cw, ch] = SIZES[name];
  const h = (w * ch) / cw;
  const a = b(F0 + i * STEP), z = a + b(STEP);
  if (f < a - 2 || f > z + 2) return null;
  const side = i % 2 ? -1 : 1;
  const inP = tw(f, a, b(1), P3O);
  const drift = tw(f, a + b(1), b(STEP - 1.3), (t) => t);
  const outP = tw(f, z - b(0.4), b(0.5), (t) => t * t);
  const ry = interpolate(inP, [0, 1], [r * 2.2, r]) + (-r - r) * drift;
  const rz = r * 0.25 * (1 - inP);
  const x = interpolate(inP, [0, 1], [120 * side, 40 * side]) + (-80 * side) * drift;
  const sc = interpolate(inP, [0, 1], [1.12, 1]) + 0.04 * drift + 0.04 * outP;
  const blur = 18 * (1 - inP) + 14 * outP;
  const lx = 25 + Math.max(0, Math.min(1, (f - a) / (z - a))) * 50;
  const lblIn = a + b(0.8);
  return (
    <div style={{ position: "absolute", left: 960 - w / 2, top: 520 - h / 2, width: w, transformStyle: "preserve-3d", opacity: inP * (1 - outP), filter: `blur(${blur}px)`, transform: `translateX(${x}px) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${sc})` }}>
      <div style={{ position: "relative", borderRadius: 24, overflow: "hidden", boxShadow: "0 0 0 1px #ffffff14, 0 50px 100px -30px #000" }}>
        <div style={{ background: "#fffcf5", padding: PAD[name] ?? 0 }}><Img src={staticFile(`crops/${name}.png`)} style={{ display: "block", width: "100%", filter: "saturate(1.1) contrast(1.05)" }} /></div>
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(100deg,#000000c0 0%,#00000055 calc(${lx}% - 22%),#ffffff14 ${lx}%,#00000055 calc(${lx}% + 22%),#000000c0 100%)` }} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: h + 34, textAlign: "center", fontFamily: "JBMono", fontSize: 26, letterSpacing: ".08em", textTransform: "uppercase", color: "#d4d4d8", opacity: tw(f, lblIn, 6) }}>
        {scramble(label, f, lblIn, b(0.9))}
      </div>
    </div>
  );
}

export const V5: React.FC = () => {
  const f = useCurrentFrame();
  const line = tw(f, 0, b(2));
  const lineOut = tw(f, b(2.5), b(1));
  const glowIn = tw(f, b(1), b(3), (t) => Math.sin((t * Math.PI) / 2));
  const glowMove = tw(f, b(3), b(WALL), P3IO);
  const persp = 1 - 0.1 * tw(f, b(WALL), b(4), P3IO);
  const wallOut = tw(f, b(NAME) - b(0.8), b(1));
  const nm = tw(f, b(NAME), b(1.5), P3O), nt = tw(f, b(NAME + 0.5), b(1.2), P3O), ns = tw(f, b(NAME + 2), b(1.2)), nu = tw(f, b(NAME + 4), b(1.2));
  const fade = interpolate(f, [V5_LEN - 20, V5_LEN], [1, 0], CL);
  return (
    <AbsoluteFill style={{ background: "#000", fontFamily: "SourceSans, sans-serif", overflow: "hidden" }}>
      <Music src="audio/music-v5.mp3" offset={0.488} len={V5_LEN} />
      {FR.map((_, i) => (
        <S key={i} src={`k/impactSoft_medium_00${i % 5}.wav`} at={b(F0 + i * STEP)} v={0.3} />
      ))}
      <S src="k/impactSoft_heavy_003.wav" at={b(WALL)} v={0.28} />
      <S src="k/bong_001.wav" at={b(NAME)} v={0.36} />
      <div style={{ position: "absolute", left: 560, top: 140, width: 800, height: 800, borderRadius: "50%", background: `radial-gradient(closest-side, ${AMBER}38, transparent)`, filter: "blur(40px)", opacity: glowIn * (1 - 0.5 * tw(f, b(NAME), b(2))), transform: `translate(${-300 * glowMove + 300 * tw(f, b(WALL), b(6), P3IO)}px, ${60 * glowMove}px) scale(${0.6 + 0.4 * glowIn})` }} />
      <div style={{ position: "absolute", left: 0, top: 540, width: 1920, height: 2, background: `linear-gradient(90deg, transparent, ${AMBER}, transparent)`, transform: `scaleX(${line})`, opacity: 1 - lineOut }} />
      <div style={{ position: "absolute", inset: 0, perspective: 1600, transform: `scale(${persp})` }}>
        {FR.map((_, i) => (
          <Fragment key={i} f={f} i={i} />
        ))}
        {f >= b(WALL) &&
          POS.map(([x, y, w], i) => {
            const p = tw(f, b(WALL) + b(i * 0.15), b(1.5), P3O);
            return (
              <div key={i} style={{ position: "absolute", left: x, top: y, width: w, borderRadius: 14, overflow: "hidden", opacity: 0.55 * p * (1 - wallOut), filter: `blur(${12 * wallOut}px)`, transform: `translateZ(${-400 * (1 - p)}px) scale(${0.8 + 0.2 * p})` }}>
                <Img src={staticFile(`crops/${FR[i][0]}.png`)} style={{ display: "block", width: "100%" }} />
              </div>
            );
          })}
      </div>
      {f >= b(NAME) && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", opacity: fade }}>
          <div style={{ opacity: nm, transform: `rotate(${-120 * (1 - nm)}deg) scale(${0.4 + 0.6 * nm})` }}>
            <Mark size={124} f={f} a={b(NAME)} />
          </div>
          <div style={{ fontFamily: "Archivo", fontSize: 170, fontWeight: 800, letterSpacing: "-.05em", color: "#fafafa", marginTop: 10, opacity: nt, transform: `translateY(${20 * (1 - nt)}px)`, filter: `blur(${10 * (1 - nt)}px)` }}>StockSure.</div>
          <div style={{ fontSize: 42, color: "#a1a1aa", letterSpacing: "-.015em", marginTop: 4, opacity: ns }}>Pay your supplier for what actually arrived.</div>
          <div style={{ fontSize: 32, color: AMBER, fontWeight: 600, marginTop: 26, opacity: nu }}>pph-stocksure.onrender.com</div>
          <div style={{ position: "absolute", bottom: 40, left: 0, right: 0, textAlign: "center", fontSize: 18, color: "#3f3f46" }}>{TRADEMARKS}</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
