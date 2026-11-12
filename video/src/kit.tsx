// Kit-style building blocks (after motion-reference-kit/shared-kit): timings in beats, one world, a moving camera,
// a cursor that does the work, one short caption per beat, seekable effects (pure functions of the frame).
import React from "react";
import { Audio, Easing, interpolate, Sequence, staticFile } from "remotion";

export const P3IO = Easing.bezier(0.645, 0.045, 0.355, 1); // power3.inOut
export const P3O = Easing.bezier(0.215, 0.61, 0.355, 1); // power3.out
export const P2IO = Easing.bezier(0.455, 0.03, 0.515, 0.955); // power2.inOut
export const EXPO = Easing.bezier(0.19, 1, 0.22, 1); // expo.out
export const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Beat grid: period in seconds; b(n) = frame of beat n. */
export const grid = (period: number) => (n: number) => n * period * 30;

/** 0..1 progress of a tween starting at frame a lasting d frames. */
export const tw = (f: number, a: number, d: number, e = P3IO) => interpolate(f, [a, a + d], [0, 1], { ...CL, easing: e });

/** Keyframed value: [[frame, value]...] with one ease between each pair (power3.inOut by default). */
export function kf(f: number, keys: [number, number][], e = P3IO) {
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [a, va] = keys[i - 1];
    const [b, vb] = keys[i];
    if (f <= b) return va + (vb - va) * e(Math.min(1, Math.max(0, (f - a) / Math.max(1, b - a))));
  }
  return keys[keys.length - 1][1];
}

/** Step function: the value of the last key whose frame has passed. */
export function step<T>(f: number, keys: [number, T][]): T {
  let v = keys[0][1];
  for (const [t, x] of keys) if (f >= t) v = x;
  return v;
}

/** Kenney / Mixkit sound at a frame. */
export function S({ src, at, v = 0.5, trim = 0, dur }: { src: string; at: number; v?: number; trim?: number; dur?: number }) {
  return (
    <Sequence from={Math.round(at)} durationInFrames={dur} layout="none">
      <Audio src={staticFile(src)} volume={v} trimBefore={trim} />
    </Sequence>
  );
}

/** Music cut so its first beat sits on frame 0, 0.04 s fade in, 1.4 s fade out, -2 dB. */
export function Music({ src, offset, len, v = 0.79 }: { src: string; offset: number; len: number; v?: number }) {
  return <Audio src={staticFile(src)} trimBefore={Math.round(offset * 30)} volume={(f) => v * interpolate(f, [0, 1, len - 42, len], [0, 1, 1, 0], CL)} />;
}

export function Cursor({ x, y, press = 1, opacity = 1 }: { x: number; y: number; press?: number; opacity?: number }) {
  return (
    <div style={{ position: "absolute", left: 0, top: 0, transform: `translate(${x}px, ${y}px) scale(${press})`, opacity, zIndex: 5, transformOrigin: "0 0" }}>
      <svg width="58" height="72" viewBox="-3 -3 29 36" style={{ position: "absolute", left: -5, top: -5, overflow: "visible", filter: "drop-shadow(0 4px 6px #00000045)" }}>
        <path d="M0 0 L0 26.2 L6.1 20.3 L10 29.1 L14 27.4 L10.2 18.8 L18.6 18.8 Z" fill="#111" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** A cursor path: [[frame it arrives, fx, fy, click?]...] in window fractions; moves over `lead` frames before each arrival. */
export function cursorAt(f: number, path: [number, number, number, boolean?][], lead: number) {
  let x = path[0][1];
  let y = path[0][2];
  let press = 1;
  for (let i = 1; i < path.length; i++) {
    const [t, fx, fy, click] = path[i];
    const p = tw(f, t - lead, lead, P2IO);
    x += (fx - x) * p;
    y += (fy - y) * p;
    if (click && f >= t - 1 && f < t + 5) press = interpolate(f, [t - 1, t + 2, t + 5], [1, 0.85, 1], CL);
  }
  return { x, y, press };
}

/** Magic UI HyperText: letters resolve left to right from glyph noise (deterministic). */
export function scramble(text: string, f: number, a: number, d: number) {
  const t = (f - a) / d;
  if (t < 0) return "";
  const n = text.length;
  const k = Math.floor(Math.min(1, t) * n * 1.0001);
  const G = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&$";
  const rnd = (i: number) => {
    const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  let s = "";
  for (let i = 0; i < n; i++) {
    const c = text[i];
    s += i < k || c === " " || c === "." ? c : G[Math.floor(rnd(i * 97 + Math.floor(f * 0.8)) * G.length)];
  }
  return s;
}

/** Decaying camera jitter on a hit. */
export function shake(f: number, t: number, amp = 10, dur = 10) {
  if (f < t || f > t + dur) return { x: 0, y: 0, r: 0 };
  const p = (f - t) / dur;
  const d = 1 - p;
  return { x: Math.sin(p * 70) * amp * d, y: Math.cos(p * 55) * amp * 0.7 * d, r: Math.sin(p * 40) * amp * 0.04 * d };
}

/** Linear-style caption pill (top-left). <b> parts are bright. */
export function Caption({ f, a, z, children, dark = true, pos = { left: 80, top: 60 } }: { f: number; a: number; z: number; children: React.ReactNode; dark?: boolean; pos?: React.CSSProperties }) {
  const inP = tw(f, a, 9, P3O);
  const outP = tw(f, z - 6, 6, P3IO);
  if (f < a || f > z) return null;
  return (
    <div
      style={{
        position: "absolute",
        ...pos,
        color: dark ? "#a1a1aa" : "#57534e",
        fontSize: 34,
        letterSpacing: "-.015em",
        fontWeight: 500,
        background: dark ? "#09090be8" : "#ffffffee",
        padding: "16px 28px",
        borderRadius: 16,
        boxShadow: dark ? "0 0 0 1px #ffffff14, 0 20px 40px -10px #000c" : "0 0 0 1px #0000000f, 0 20px 40px -14px #0003",
        opacity: inP * (1 - outP),
        transform: `translateY(${(1 - inP) * 14}px)`,
        fontFamily: "SourceSans, sans-serif",
        zIndex: 8,
      }}
    >
      {children}
    </div>
  );
}

/** Magic UI Border Beam: a light that runs round a rounded rectangle. */
export function BorderBeam({ f, w, h, r = 18, color = "#7fcf98", speed = 90, size = 220 }: { f: number; w: number; h: number; r?: number; color?: string; speed?: number; size?: number }) {
  const per = 2 * (w + h);
  const off = -((f / speed) * per) % per;
  return (
    <svg width={w} height={h} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
      <defs>
        <filter id="bbglow"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>
      <rect x="1" y="1" width={w - 2} height={h - 2} rx={r} fill="none" stroke={color} strokeWidth="3" strokeDasharray={`${size} ${per}`} strokeDashoffset={off} filter="url(#bbglow)" opacity="0.9" />
      <rect x="1" y="1" width={w - 2} height={h - 2} rx={r} fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray={`${size * 0.4} ${per}`} strokeDashoffset={off - size * 0.3} opacity="0.8" />
    </svg>
  );
}

/** The StockSure mark (public/icon.svg), drawn bars then slash. */
export function Mark({ size, f, a = 0, ink = "#1b1a16", paper = "#f4efe4" }: { size: number; f: number; a?: number; ink?: string; paper?: string }) {
  const bars = [0, 1, 2].map((i) => tw(f, a + 3 + i * 3, 10, EXPO));
  const slash = tw(f, a + 12, 10, P3O);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <rect width="64" height="64" rx="10" fill={paper} />
      {[13, 23, 33].map((x, i) => (
        <rect key={x} x={x} y={15 + 34 * (1 - bars[i])} width="6" height={34 * bars[i]} rx="2" fill={ink} />
      ))}
      <path d="M44 49 L52 15" stroke={ink} strokeWidth="5.5" strokeLinecap="round" strokeDasharray="36" strokeDashoffset={36 * (1 - slash)} />
    </svg>
  );
}

export const TRADEMARKS = "PayPal and OpenAI are trademarks of their respective owners. StockSure is a hackathon project, not affiliated with them. Live sandbox demo, 12 Nov 2026.";
