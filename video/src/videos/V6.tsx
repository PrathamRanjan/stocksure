// V6 "Show the working" — after the kit's v32 Figma split. Left: StockSure's real agreement screen for order SS-1008.
// Right: the maths writes itself out, stroke by stroke, and each step marks the screen on the left as it is written.
// Music: Mixkit #175 "Close Up" 129 bpm; first beat 0.157 s, period 0.4651 s.
import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { CL, grid, Mark, Music, P3O, S, shake, TRADEMARKS, tw } from "../kit";

const B = 0.4651;
const b = grid(B);
export const V6_LEN = 900;

const INK = "#1b1a16", GREEN = "#1d6b3b", RED = "#b0261c", AMBER = "#8a5300", ORANGE = "#d9822b";
const QW = 860, CW = 1176, CH = 1006; // crop px shown (bottom strip of buttons cut off)
const QS = QW / CW, QH = CH * QS;
const QX = 90, QY = (1080 - QH) / 2 + 20;

// steps on the right: [beat, [text, colour][]]
const STEPS: [number, [string, string][]][] = [
  [2, [["Ordered 8 cases × $11 = $88.", INK]]],
  [6.5, [["2 arrived crushed.", RED]]],
  [11, [["Pay = quote price × accepted.", INK]]],
  [15.5, [["$11 × 6 = $66.00", GREEN]]],
  [20, [["The other $22 goes back.", AMBER]]],
  [24.5, [["2 replacements, same price.", INK]]],
  [29, [["Still inside the $120 limit.", INK]]],
  [33.5, [["The invoice? Compared.", INK], ["Never paid from.", RED]]],
  [38.5, [["Code does the maths. Not AI.", GREEN]]],
];
const DONE = 41.5, CLOSE = 46;

// marks over the crop (crop px): [beat, kind, colour, geometry]
type Mk = { at: number; c: string; w: number } & ({ k: "ring"; cx: number; cy: number; rx: number; ry: number } | { k: "line"; x1: number; x2: number; y: number } | { k: "box"; x: number; y: number; bw: number; bh: number });
const MARKS: Mk[] = [
  { at: 3, k: "ring", cx: 266, cy: 273, rx: 80, ry: 34, c: ORANGE, w: 6 },
  { at: 7.5, k: "ring", cx: 629, cy: 273, rx: 80, ry: 34, c: RED, w: 6 },
  { at: 12, k: "line", x1: 12, x2: 640, y: 372, c: ORANGE, w: 6 },
  { at: 16.5, k: "ring", cx: 452, cy: 273, rx: 80, ry: 34, c: GREEN, w: 6 },
  { at: 17.3, k: "ring", cx: 1116, cy: 273, rx: 70, ry: 34, c: GREEN, w: 6 },
  { at: 21, k: "line", x1: 44, x2: 240, y: 870, c: "#f0b45a", w: 6 },
  { at: 25.5, k: "box", x: 26, y: 476, bw: 770, bh: 50, c: ORANGE, w: 5 },
  { at: 26.3, k: "line", x1: 44, x2: 388, y: 922, c: "#f0b45a", w: 6 },
  { at: 30, k: "line", x1: 44, x2: 742, y: 974, c: "#f0b45a", w: 6 },
  { at: 34.5, k: "line", x1: 742, x2: 1128, y: 372, c: RED, w: 7 },
];

function Written({ f, at, text, colour, y, size = 44 }: { f: number; at: number; text: string; colour: string; y: number; size?: number }) {
  const d = b(1.1);
  const p = tw(f, b(at), d, (t) => t);
  const fill = tw(f, b(at) + d * 0.7, b(0.5));
  if (p <= 0) return null;
  return (
    <text
      x={0}
      y={y}
      fontSize={size}
      fontWeight={700}
      fontFamily="Archivo"
      letterSpacing={-1}
      fill={colour}
      fillOpacity={fill}
      stroke={colour}
      strokeWidth={1.4}
      strokeDasharray="360 420"
      strokeDashoffset={390 * (1 - p)}
      style={{ clipPath: `inset(-20% ${100 - 100 * p}% -20% 0)` }}
    >
      {text}
    </text>
  );
}

function MarkPath({ f, m }: { f: number; m: Mk }) {
  const p = tw(f, b(m.at), b(0.6));
  if (p <= 0) return null;
  const common = { stroke: m.c, strokeWidth: m.w, fill: "none", pathLength: 1, strokeDasharray: "1 1", strokeDashoffset: 1 - p, strokeLinecap: "round" as const, opacity: 0.9 };
  if (m.k === "ring") {
    // a hand-drawn ring: slightly open, slightly tilted
    const { cx, cy, rx, ry } = m;
    const d = `M ${cx - rx * 0.2} ${cy - ry * 1.05} C ${cx + rx * 1.1} ${cy - ry * 1.15}, ${cx + rx * 1.15} ${cy + ry * 1.1}, ${cx} ${cy + ry} C ${cx - rx * 1.15} ${cy + ry * 0.95}, ${cx - rx * 1.1} ${cy - ry * 1.0}, ${cx + rx * 0.25} ${cy - ry * 1.12}`;
    return <path d={d} {...common} />;
  }
  if (m.k === "line") return <path d={`M ${m.x1} ${m.y} Q ${(m.x1 + m.x2) / 2} ${m.y + 5} ${m.x2} ${m.y - 2}`} {...common} />;
  return <rect x={m.x} y={m.y} width={m.bw} height={m.bh} rx={18} {...common} />;
}

export const V6: React.FC = () => {
  const f = useCurrentFrame();
  const breathe = interpolate(f, [0, b(CLOSE)], [0.98, 1.02], CL);
  const enter = tw(f, 0, b(1.5), P3O);
  const sh = shake(f, b(7.5) + b(0.6), 5, 9);
  const doneP = tw(f, b(DONE), b(0.8), P3O);
  const end = tw(f, b(CLOSE), b(1));
  // board layout
  let y = 60;
  const lines: { at: number; text: string; c: string; y: number }[] = [];
  for (const [at, ls] of STEPS) {
    ls.forEach(([t, c], j) => {
      lines.push({ at: at + j * 0.8, text: t, c, y });
      y += 58;
    });
    y += 22;
  }
  return (
    <AbsoluteFill style={{ background: "#fbfaf8", fontFamily: "SourceSans, sans-serif", overflow: "hidden" }}>
      <Music src="audio/music-v6.mp3" offset={0.157} len={V6_LEN} />
      {STEPS.map(([at]) => (
        <S key={at} src="k/switch_007.wav" at={b(at)} v={0.22} />
      ))}
      {MARKS.map((m) => (
        <S key={m.at} src="k/click_003.wav" at={b(m.at)} v={0.38} />
      ))}
      <S src="k/error_005.wav" at={b(7.5) + b(0.6)} v={0.12} />
      <S src="k/impactBell_heavy_000.wav" at={b(DONE)} v={0.13} />
      <S src="k/bong_001.wav" at={b(CLOSE)} v={0.3} />
      {/* left: the real screen */}
      <div style={{ position: "absolute", left: QX, top: QY - 52, fontSize: 22, letterSpacing: ".14em", textTransform: "uppercase", color: "#a8a29e", fontWeight: 600, opacity: enter }}>
        Order SS-1008 · the real screen
      </div>
      <div
        style={{
          position: "absolute",
          left: QX,
          top: QY,
          width: QW,
          height: QH,
          borderRadius: 22,
          overflow: "hidden",
          background: "#fffcf5",
          boxShadow: "0 40px 80px -40px #1a1a2e55, 0 0 0 1px #1a1a2e12",
          opacity: enter,
          transform: `translate(${sh.x}px, ${sh.y + 30 * (1 - enter)}px) scale(${breathe})`,
        }}
      >
        <Img src={staticFile("crops/split-left.png")} style={{ display: "block", width: QW }} />
        <svg viewBox={`0 0 ${CW} ${CH}`} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }}>
          {MARKS.map((m, i) => (
            <MarkPath key={i} f={f} m={m} />
          ))}
        </svg>
        {/* done: a soft green wash over the money box */}
        <div style={{ position: "absolute", left: 12 * QS, top: 670 * QS, width: 1152 * QS, height: 334 * QS, borderRadius: 12, boxShadow: `0 0 0 ${4 * doneP}px #7fcf98, 0 0 ${60 * doneP}px ${-10 + 20 * doneP}px #7fcf9888`, opacity: doneP * (1 - end) }} />
      </div>
      {/* divider + right: the working */}
      <div style={{ position: "absolute", left: QX + QW + 70, top: 120, width: 2, height: 840 * enter, background: "#e7e5e4" }} />
      <div style={{ position: "absolute", left: QX + QW + 140, top: QY - 52, fontSize: 22, letterSpacing: ".14em", textTransform: "uppercase", color: "#a8a29e", fontWeight: 600, opacity: enter }}>
        The working
      </div>
      <svg viewBox="0 0 800 900" style={{ position: "absolute", left: QX + QW + 140, top: QY - 20, width: 800, height: 900, overflow: "visible" }}>
        {lines.map((l, i) => (
          <Written key={i} f={f} at={l.at} text={l.text} colour={l.c} y={l.y} />
        ))}
      </svg>
      {/* close */}
      {f >= b(CLOSE) && (
        <AbsoluteFill style={{ background: "#fbfaf8", alignItems: "center", justifyContent: "center", flexDirection: "column", opacity: end }}>
          <Mark size={104} f={f} a={b(CLOSE)} />
          <div style={{ fontFamily: "Archivo", fontSize: 150, fontWeight: 800, letterSpacing: "-.05em", color: INK, marginTop: 14 }}>StockSure.</div>
          <div style={{ fontSize: 46, color: "#57534e", marginTop: 6, letterSpacing: "-.02em" }}>The working, not just the total.</div>
          <div style={{ fontSize: 34, color: ORANGE, fontWeight: 600, marginTop: 24 }}>pph-stocksure.onrender.com</div>
          <div style={{ position: "absolute", bottom: 40, left: 0, right: 0, textAlign: "center", fontSize: 18, color: "#b8b4b0" }}>{TRADEMARKS}</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
