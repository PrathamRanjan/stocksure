import React from "react";
import { AbsoluteFill, Audio, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import { C, F } from "../theme";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const ease = Easing.bezier(0.2, 0.7, 0.2, 1);
export const easeIO = Easing.bezier(0.65, 0, 0.35, 1);

export function useSpring(delay = 0, cfg: { damping?: number; stiffness?: number; mass?: number } = {}) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: f - delay, fps, config: { damping: cfg.damping ?? 16, stiffness: cfg.stiffness ?? 140, mass: cfg.mass ?? 0.9 } });
}

/** Sound effect at a frame (relative to the enclosing Sequence). */
export function Sfx({ src, at = 0, volume = 0.6, trim = 0, dur }: { src: string; at?: number; volume?: number; trim?: number; dur?: number }) {
  return (
    <Sequence from={at} durationInFrames={dur} layout="none">
      <Audio src={staticFile(`audio/${src}.mp3`)} volume={volume} trimBefore={trim} />
    </Sequence>
  );
}

/** Background: ink or paper, film grain, drifting glow, vignette. */
export function Stage({ tone = "ink", glow = C.carbon, children, grid = false }: { tone?: "ink" | "paper"; glow?: string; children?: React.ReactNode; grid?: boolean }) {
  const f = useCurrentFrame();
  const dark = tone === "ink";
  const gx = 50 + noise2D("gx", f / 240, 0) * 18;
  const gy = 42 + noise2D("gy", 0, f / 240) * 14;
  return (
    <AbsoluteFill style={{ background: dark ? C.ink : C.paper, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: `radial-gradient(1100px 760px at ${gx}% ${gy}%, ${glow}${dark ? "26" : "22"}, transparent 70%)` }} />
      {grid && (
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${dark ? "#ffffff0a" : "#1b1a160c"} 1px, transparent 1px), linear-gradient(90deg, ${dark ? "#ffffff0a" : "#1b1a160c"} 1px, transparent 1px)`,
            backgroundSize: "64px 64px",
            backgroundPosition: `${-f * 0.4}px ${-f * 0.25}px`,
            maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          }}
        />
      )}
      {children}
      <Grain seed={f} dark={dark} />
      <AbsoluteFill style={{ pointerEvents: "none", background: dark ? "radial-gradient(ellipse at center, transparent 55%, #000000aa 100%)" : "radial-gradient(ellipse at center, transparent 60%, #8a7f6a33 100%)" }} />
    </AbsoluteFill>
  );
}

function Grain({ seed, dark }: { seed: number; dark: boolean }) {
  const id = `g${seed % 6}`;
  return (
    <AbsoluteFill style={{ opacity: dark ? 0.09 : 0.07, mixBlendMode: dark ? "screen" : "multiply", pointerEvents: "none" }}>
      <svg width="100%" height="100%">
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={seed % 6} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${id})`} />
      </svg>
    </AbsoluteFill>
  );
}

/** Kinetic words: each word rises out of a mask, staggered. `hl` colours chosen words. */
export function Words({ text, at = 0, size = 96, weight = 800, color = C.paper, stagger = 3, hl = {}, wdth = 112, align = "left", lh = 1.02, style, font = F.display, maxWidth }: {
  text: string; at?: number; size?: number; weight?: number; color?: string; stagger?: number; hl?: Record<string, string>; wdth?: number; align?: "left" | "center" | "right"; lh?: number; style?: React.CSSProperties; font?: string; maxWidth?: number;
}) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lines = text.split("\n");
  let i = 0;
  return (
    <div style={{ fontFamily: font, fontSize: size, fontWeight: weight, color, lineHeight: lh, letterSpacing: "-0.02em", fontVariationSettings: `"wdth" ${wdth}`, textAlign: align, maxWidth, ...style }}>
      {lines.map((ln, li) => (
        <div key={li} style={{ display: "flex", flexWrap: "wrap", justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start", columnGap: size * 0.26 }}>
          {ln.split(" ").map((w, wi) => {
            const k = i++;
            const p = spring({ frame: f - at - k * stagger, fps, config: { damping: 18, stiffness: 120, mass: 0.8 } });
            const clean = w.replace(/[.,!?:;]/g, "");
            return (
              <span key={wi} style={{ display: "inline-block", overflow: "hidden", paddingBottom: size * 0.12, marginBottom: -size * 0.12 }}>
                <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 110}%) rotate(${(1 - p) * 4}deg)`, opacity: interpolate(p, [0, 0.3], [0, 1], clamp), color: hl[clean] ?? color }}>{w}</span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A line of small caps label text that types in. */
export function Label({ text, at = 0, color = C.muted, size = 22, style }: { text: string; at?: number; color?: string; size?: number; style?: React.CSSProperties }) {
  const f = useCurrentFrame();
  const n = Math.floor(interpolate(f - at, [0, text.length * 0.9], [0, text.length], clamp));
  const o = interpolate(f - at, [0, 4], [0, 1], clamp);
  return (
    <div style={{ fontFamily: F.mono, fontSize: size, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color, opacity: o, ...style }}>
      {text.slice(0, n)}
      <span style={{ opacity: n < text.length ? 1 : 0 }}>▍</span>
    </div>
  );
}

export function Counter({ from = 0, to, at = 0, dur = 30, fmt = (v: number) => v.toFixed(0), style }: { from?: number; to: number; at?: number; dur?: number; fmt?: (v: number) => string; style?: React.CSSProperties }) {
  const f = useCurrentFrame();
  const v = interpolate(f - at, [0, dur], [from, to], { ...clamp, easing: Easing.out(Easing.cubic) });
  return <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>{fmt(v)}</span>;
}

export const usd = (v: number, dp = 2) => `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

/** A docket stamp that slams onto the page. */
export function Stamp({ text, at = 0, color = C.paid, size = 54, rotate = -6, style, fill = false }: { text: string; at?: number; color?: string; size?: number; rotate?: number; style?: React.CSSProperties; fill?: boolean }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f - at, fps, config: { damping: 11, stiffness: 260, mass: 0.7 } });
  const shake = f - at > 0 && f - at < 8 ? Math.sin((f - at) * 3) * (8 - (f - at)) * 0.6 : 0;
  return (
    <div
      style={{
        display: "inline-block",
        transform: `scale(${interpolate(p, [0, 1], [2.4, 1])}) rotate(${rotate + shake * 0.3}deg) translate(${shake}px, 0)`,
        opacity: interpolate(f - at, [0, 3], [0, 1], clamp),
        border: `${size * 0.09}px solid ${color}`,
        borderRadius: size * 0.12,
        padding: `${size * 0.12}px ${size * 0.32}px`,
        color: fill ? C.ink : color,
        background: fill ? color : `${color}14`,
        fontFamily: F.display,
        fontWeight: 900,
        fontVariationSettings: '"wdth" 125',
        fontSize: size,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        boxShadow: `0 0 0 ${size * 0.03}px ${color}55 inset`,
        filter: "url(#rough)",
        ...style,
      }}
    >
      {text}
    </div>
  );
}

/** Tally marks: n bars, `damaged` of them (from the end) turn red with a slash. */
export function Tally({ n, damaged = 0, at = 0, dmgAt = 40, h = 220, w = 34, gap = 22, color = C.paper }: { n: number; damaged?: number; at?: number; dmgAt?: number; h?: number; w?: number; gap?: number; color?: string }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", gap, alignItems: "flex-end" }}>
      {Array.from({ length: n }).map((_, i) => {
        const p = spring({ frame: f - at - i * 3, fps, config: { damping: 14, stiffness: 180 } });
        const bad = i >= n - damaged;
        const d = bad ? spring({ frame: f - at - dmgAt - (i - (n - damaged)) * 5, fps, config: { damping: 12, stiffness: 200 } }) : 0;
        const col = bad ? interpolateColors(d, color, C.stop) : color;
        return (
          <div key={i} style={{ position: "relative", width: w, height: h, transform: `scaleY(${p})`, transformOrigin: "bottom" }}>
            <div style={{ position: "absolute", inset: 0, borderRadius: 6, background: bad && d > 0.5 ? "transparent" : col, border: `4px solid ${col}` }} />
            {bad && (
              <div style={{ position: "absolute", left: -w * 0.6, top: h / 2 - 5, width: w * 2.2, height: 10, background: C.stop, borderRadius: 5, transform: `rotate(-62deg) scaleX(${d})`, boxShadow: `0 0 24px ${C.stop}` }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function interpolateColors(t: number, a: string, b: string) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.min(1, Math.max(0, t))));
  return `#${m.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Fades and lifts children in at `at`, out at `out` (frames relative to parent). */
export function Enter({ at = 0, out, children, y = 40, blur = 12, style, scale = 1 }: { at?: number; out?: number; children: React.ReactNode; y?: number; blur?: number; style?: React.CSSProperties; scale?: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f - at, fps, config: { damping: 20, stiffness: 110 } });
  const q = out === undefined ? 0 : interpolate(f, [out, out + 12], [0, 1], { ...clamp, easing: easeIO });
  return (
    <div style={{ opacity: Math.min(p, 1) * (1 - q), transform: `translateY(${(1 - p) * y - q * 30}px) scale(${scale + (1 - p) * 0.04})`, filter: `blur(${(1 - Math.min(p, 1)) * blur + q * 10}px)`, ...style }}>
      {children}
    </div>
  );
}

/** Small source line for a statistic. */
export function Source({ text, at = 0, dark = true }: { text: string; at?: number; dark?: boolean }) {
  const f = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: 96, bottom: 56, fontFamily: F.mono, fontSize: 19, color: dark ? "#ffffff70" : "#1b1a1680", opacity: interpolate(f - at, [0, 10], [0, 1], clamp), letterSpacing: "0.02em" }}>
      SOURCE · {text}
    </div>
  );
}

export function Chip({ text, color = C.paper, at = 0, style, icon }: { text: string; color?: string; at?: number; style?: React.CSSProperties; icon?: string }) {
  const p = useSpring(at, { damping: 15, stiffness: 170 });
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "12px 20px", borderRadius: 999, border: `2px solid ${color}55`, background: `${color}12`, color, fontFamily: F.mono, fontSize: 24, fontWeight: 700, transform: `scale(${0.6 + p * 0.4})`, opacity: Math.min(1, p * 1.4), whiteSpace: "nowrap", ...style }}>
      {icon && <span>{icon}</span>}
      {text}
    </div>
  );
}

/** The StockSure mark (from public/icon.svg). */
export function Mark({ size = 120, at = 0 }: { size?: number; at?: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bars = [0, 1, 2].map((i) => spring({ frame: f - at - 4 - i * 4, fps, config: { damping: 14, stiffness: 200 } }));
  const slash = interpolate(f - at - 18, [0, 10], [0, 1], { ...clamp, easing: ease });
  const box = spring({ frame: f - at, fps, config: { damping: 14, stiffness: 160 } });
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ transform: `scale(${box})` }}>
      <rect width="64" height="64" rx="10" fill={C.paper} />
      {[13, 23, 33].map((x, i) => (
        <rect key={x} x={x} y={15 + 34 * (1 - bars[i])} width="6" height={34 * bars[i]} rx="2" fill={C.ink2} />
      ))}
      <path d="M44 49 L52 15" stroke={C.ink2} strokeWidth="5.5" strokeLinecap="round" strokeDasharray="36" strokeDashoffset={36 * (1 - slash)} />
    </svg>
  );
}

export function Logo({ at = 0, size = 1, dark = true }: { at?: number; size?: number; dark?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 28 * size }}>
      <Mark size={120 * size} at={at} />
      <Words text="StockSure" at={at + 10} size={112 * size} weight={800} color={dark ? C.paper : C.ink2} wdth={118} stagger={0} />
    </div>
  );
}

/** Shared SVG filters (rough stamp edges). Render once per video. */
export function Defs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }}>
      <filter id="rough">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" />
      </filter>
    </svg>
  );
}

export function Shot({ src, style }: { src: string; style?: React.CSSProperties }) {
  return <Img src={staticFile(`shots/${src}.png`)} style={{ display: "block", width: "100%", ...style }} />;
}
