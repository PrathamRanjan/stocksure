// V4 "Count it in" — after the kit's v29 Linear feature reel. One window, one camera, a cursor does the work.
// Music: Mixkit #744 "Digital Clouds" 123 bpm; first beat at 0.046 s, period 0.4878 s. All timings in beats.
import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { BorderBeam, Caption, CL, Cursor, cursorAt, grid, Mark, Music, P3O, S, shake, step, TRADEMARKS, tw } from "../kit";
import { interpolate } from "remotion";

const B = 0.4878;
const b = grid(B);
export const V4_LEN = 900;

const WW = 1344, WH = 840;
const WX = (1920 - WW) / 2, WY = (1080 - WH) / 2 + 10;
const ORANGE = "#f0b45a"; // StockSure held-amber as the accent
const css = (x: number, y: number): [number, number] => [x / 1440, y / 900]; // capture CSS px → window fraction

const CLK = { docket: 12, check: 22.5, confirm: 24.5, approve: 36 };
// [beat, image]
const IMGS: [number, string][] = [
  [0, "receive-desktop"],
  [CLK.docket + 0.3, "receive-read"],
  [CLK.confirm + 0.3, "order-counted"],
  [30, "order-resolution-page"],
  [CLK.approve + 0.3, "order-settled-top"],
];
// camera moves: [start beat, duration beats, fx, fy, zoom]
const CAM: [number, number, number, number, number][] = [
  [7.5, 2.5, 0.42, 0.9, 1.5], // the sample-docket buttons
  [12.5, 2.5, 0.75, 0.6, 1.7], // the suggestion
  [17, 2, 0.7, 0.58, 2.1], // the damage flag
  [20.5, 2, 0.64, 0.88, 1.55], // tick + confirm
  [25, 2, 0.5, 0.5, 1.0],
  [26.5, 2.5, 0.8, 0.5, 1.6], // money panel
  [30, 2, 0.5, 0.5, 1.0],
  [31.5, 2.5, 0.45, 0.66, 1.55], // what moves when both approve
  [34.5, 1.5, 0.36, 0.82, 1.35], // approve button
  [37, 2.5, 0.8, 0.62, 1.55], // money + PayPal activity
  [41.5, 2.5, 0.5, 0.5, 1.0],
];
const CAPS: [number, number, React.ReactNode][] = [
  [8.5, 12.5, <>Drop in the <b>delivery docket.</b></>],
  [13, 17, <>AI reads it. <b>8 cases, 2 damaged.</b></>],
  [17, 20.5, <>It flags the damage.</>],
  [21, 25, <>A person confirms. <b>Always.</b></>],
  [26, 30, <>PayPal holds <b>$88.</b> Charged: <b>$0.</b></>],
  [30.5, 36, <>Charge <b>$66.</b> Release <b>$22.</b></>],
  [37, 42, <>Captured. <b>To the cent.</b></>],
  [42.5, 49, <>Pay only for <b>what arrived.</b></>],
];

function camAt(f: number) {
  let x = 0, y = 0, s = 1;
  for (const [a, d, tx, ty, tz] of CAM) {
    const p = tw(f, b(a), b(d));
    let X = 960 - tz * (WX + tx * WW), Y = 540 - tz * (WY + ty * WH);
    // keep close-ups inside the window: never show the edge past it
    if (tz * WW >= 1920) X = Math.min(-tz * WX, Math.max(1920 - tz * (WX + WW), X));
    if (tz * WH >= 1080) Y = Math.min(-tz * WY, Math.max(1080 - tz * (WY + WH), Y));
    x += (X - x) * p; y += (Y - y) * p; s += (tz - s) * p;
  }
  return { x, y, s };
}

export const V4: React.FC = () => {
  const f = useCurrentFrame();
  const cam = camAt(f);
  const img = step(f, IMGS.map(([t, n]) => [b(t), n] as [number, string]));
  // the window rises, floats in 3D at the end, then leaves
  const rise = tw(f, b(5.5), b(3), P3O);
  const flt = tw(f, b(42), b(7), (t) => 0.5 - Math.cos(Math.PI * t) / 2);
  const out = tw(f, b(48.5), b(1.5), (t) => t * t);
  const rx = 28 * (1 - rise) + 8 * flt;
  const ry = -14 * flt;
  const sh = shake(f, b(17.6), 6, 9);
  // cursor (window fractions)
  const [dx, dy] = css(609, 869), [kx, ky] = css(856, 786), [cx, cy] = css(923, 873), [ax, ay] = css(437, 780);
  const cur = cursorAt(
    f,
    [
      [b(9), 0.72, 0.95],
      [b(CLK.docket), dx, dy, true],
      [b(16), 0.86, 0.72],
      [b(CLK.check), kx, ky, true],
      [b(CLK.confirm), cx, cy, true],
      [b(31), 0.6, 0.6],
      [b(CLK.approve), ax, ay, true],
      [b(38.5), 0.22, 0.96],
    ],
    b(1.4)
  );
  const curOn = f >= b(9) && f < b(41);
  const checked = f >= b(CLK.check) && f < b(CLK.confirm + 0.3);
  // title
  const t1 = tw(f, b(0.2), b(1.5), P3O), t2 = tw(f, b(1.5), b(1.5), P3O), tOut = tw(f, b(5), b(1));
  const end = tw(f, b(50), b(2), P3O);
  const flash = interpolate(f, [b(CLK.approve + 0.3), b(CLK.approve + 0.3) + 2, b(CLK.approve + 0.3) + 12], [0, 0.35, 0], CL);
  return (
    <AbsoluteFill style={{ background: "#09090b", fontFamily: "SourceSans, sans-serif", overflow: "hidden" }}>
      <Music src="audio/music-v4.mp3" offset={0.046} len={V4_LEN} />
      {Object.values(CLK).map((t) => (
        <S key={t} src="k/click_003.wav" at={b(t)} v={0.55} />
      ))}
      <S src="k/error_005.wav" at={b(17.6)} v={0.12} />
      <S src="k/impactBell_heavy_000.wav" at={b(CLK.approve + 0.3)} v={0.14} />
      <S src="k/impactSoft_medium_002.wav" at={b(5.5)} v={0.22} />
      <S src="k/bong_001.wav" at={b(50)} v={0.32} />
      <AbsoluteFill style={{ background: "radial-gradient(60% 60% at 50% 55%,#1c1b22 0%,#09090b 70%)" }} />
      <AbsoluteFill
        style={{
          backgroundImage: "linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px)",
          backgroundSize: "64px 64px",
          backgroundPosition: `0 ${-(f * 0.4) % 64}px`,
          WebkitMaskImage: "radial-gradient(60% 60% at 50% 50%,#000,transparent)",
        }}
      />
      {/* title */}
      <div style={{ position: "absolute", left: 0, width: 1920, top: 400, textAlign: "center", color: "#fafafa", fontFamily: "Archivo", fontSize: 120, fontWeight: 700, letterSpacing: "-.045em", opacity: t1 * (1 - tOut), transform: `translateY(${(1 - t1) * 30 - tOut * 30}px)` }}>
        Count it in.
      </div>
      <div style={{ position: "absolute", left: 0, width: 1920, top: 570, textAlign: "center", color: "#71717a", fontSize: 42, letterSpacing: "-.015em", opacity: t2 * (1 - tOut), transform: `translateY(${(1 - t2) * 20 - tOut * 30}px)` }}>
        Every delivery checked before PayPal pays the supplier.
      </div>
      {/* camera world */}
      <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: `translate(${cam.x + sh.x}px, ${cam.y + sh.y}px) scale(${cam.s})` }}>
        <div style={{ position: "absolute", inset: 0, perspective: 2200 }}>
          <div
            style={{
              position: "absolute",
              left: WX,
              top: WY,
              width: WW,
              height: WH,
              borderRadius: 18,
              overflow: "hidden",
              background: "#f4efe4",
              boxShadow: `0 0 0 1px #ffffff1f, 0 60px 120px -40px #000, 0 0 140px -30px ${ORANGE}55`,
              transformOrigin: "50% 100%",
              opacity: rise * (1 - out),
              transform: `translateY(${300 * (1 - rise) - 80 * out}px) rotateX(${rx}deg) rotateY(${ry}deg)`,
            }}
          >
            <Img src={staticFile(`shots/${img}.png`)} style={{ position: "absolute", left: 0, top: 0, width: "100%" }} />
            {checked && (
              <div style={{ position: "absolute", left: kx * WW - 11, top: ky * WH - 11, width: 22, height: 22, borderRadius: 4, background: "#1b1a16", display: "grid", placeItems: "center" }}>
                <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 8.5 L6.5 12 L13 4" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" /></svg>
              </div>
            )}
            {f >= b(37) && f < b(48) && (
              <div style={{ position: "absolute", left: (985 / 1440) * WW, top: (299 / 900) * WH, width: (351 / 1440) * WW, height: (371 / 900) * WH }}>
                <BorderBeam f={f} w={(351 / 1440) * WW} h={(371 / 900) * WH} r={10} color="#7fcf98" speed={70} />
              </div>
            )}
            <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: flash }} />
            {curOn && <Cursor x={cur.x * WW} y={cur.y * WH} press={cur.press} opacity={tw(f, b(9), b(0.6)) * (1 - tw(f, b(40), b(1)))} />}
          </div>
        </div>
      </div>
      {CAPS.map(([a, z, t], i) => (
        <Caption key={i} f={f} a={b(a)} z={b(z)}>
          {t}
        </Caption>
      ))}
      {/* end card */}
      {f >= b(50) && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", opacity: end, transform: `scale(${0.96 + 0.04 * end})` }}>
          <Mark size={104} f={f} a={b(50)} />
          <div style={{ fontFamily: "Archivo", fontSize: 140, fontWeight: 800, letterSpacing: "-.05em", color: "#fafafa", marginTop: 14 }}>StockSure.</div>
          <div style={{ fontSize: 38, color: "#a1a1aa", marginTop: 6 }}>
            Pay only for what arrived. <span style={{ color: ORANGE, fontWeight: 600 }}>pph-stocksure.onrender.com</span>
          </div>
          <div style={{ position: "absolute", bottom: 40, left: 0, right: 0, textAlign: "center", fontSize: 18, color: "#52525b" }}>{TRADEMARKS}</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
