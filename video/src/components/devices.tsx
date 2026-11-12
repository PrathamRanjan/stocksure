import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { clamp, easeIO } from "./core";

/** Pan/zoom keyframes over a tall screenshot: [frame, y offset in screen-px, scale]. */
export type Cam = [number, number, number][];
function camAt(cam: Cam | undefined, f: number) {
  if (!cam || !cam.length) return { y: 0, z: 1 };
  const fr = cam.map((c) => c[0]);
  if (cam.length === 1) return { y: cam[0][1], z: cam[0][2] };
  return {
    y: interpolate(f, fr, cam.map((c) => c[1]), { ...clamp, easing: easeIO }),
    z: interpolate(f, fr, cam.map((c) => c[2]), { ...clamp, easing: easeIO }),
  };
}

/** Screen content: an image pinned to the top, panned by `cam`, with optional overlay children in screen coordinates. */
function Screen({ children, cam, w, origin = "50% 0%" }: { children: React.ReactNode; cam?: Cam; w: number; origin?: string }) {
  const f = useCurrentFrame();
  const { y, z } = camAt(cam, f);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, transform: `scale(${z}) translateY(${-y}px)`, transformOrigin: origin }}>{children}</div>
    </div>
  );
}

/** A laptop: 1440x900 screen content scaled into the frame. */
export function Laptop({ children, cam, width = 1280, glow = "#9db0f2", origin }: { children: React.ReactNode; cam?: Cam; width?: number; glow?: string; origin?: string }) {
  const sw = width * 0.86;
  const sh = sw * (900 / 1440);
  const k = sw / 1440;
  return (
    <div style={{ width, position: "relative", filter: `drop-shadow(0 60px 80px #00000088) drop-shadow(0 0 120px ${glow}22)` }}>
      <div style={{ margin: "0 auto", width: sw + 36, padding: 18, paddingBottom: 26, background: "linear-gradient(180deg,#2b2b2e,#161617)", borderRadius: 28, boxShadow: "inset 0 0 0 2px #3a3a3e" }}>
        <div style={{ position: "relative", width: sw, height: sh, borderRadius: 8, overflow: "hidden", background: "#f4efe4" }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: 1440, height: 900, transform: `scale(${k})`, transformOrigin: "0 0" }}>
            <Screen cam={cam} w={1440} origin={origin}>{children}</Screen>
          </div>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(115deg, #ffffff14 0%, transparent 35%)", pointerEvents: "none" }} />
        </div>
      </div>
      <div style={{ width, height: 26, marginTop: -2, background: "linear-gradient(180deg,#d8d8dc,#9a9aa0)", borderRadius: "4px 4px 22px 22px", position: "relative" }}>
        <div style={{ position: "absolute", left: "50%", top: 0, width: 180, height: 10, transform: "translateX(-50%)", background: "#7d7d83", borderRadius: "0 0 10px 10px" }} />
      </div>
    </div>
  );
}

/** A phone: 390-wide screen content scaled into the frame. */
export function Phone({ children, cam, height = 860, glow = "#9db0f2" }: { children: React.ReactNode; cam?: Cam; height?: number; glow?: string }) {
  const sh = height - 36;
  const sw = sh * (390 / 844);
  const k = sw / 390;
  return (
    <div style={{ width: sw + 36, height, padding: 18, background: "linear-gradient(160deg,#3a3a3f,#141416)", borderRadius: 74, boxShadow: "inset 0 0 0 3px #4a4a50, 0 50px 90px #000000aa", filter: `drop-shadow(0 0 100px ${glow}26)`, position: "relative" }}>
      <div style={{ position: "relative", width: sw, height: sh, borderRadius: 58, overflow: "hidden", background: "#f4efe4" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: 390, height: 844, transform: `scale(${k})`, transformOrigin: "0 0" }}>
          <Screen cam={cam} w={390}>{children}</Screen>
        </div>
        <div style={{ position: "absolute", top: 14, left: "50%", width: 118, height: 34, transform: "translateX(-50%)", background: "#000", borderRadius: 20 }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(120deg, #ffffff18 0%, transparent 30%)", pointerEvents: "none" }} />
      </div>
    </div>
  );
}

/** Wraps children in a slow 3D camera move: rotateY/X and push in over the scene. */
export function Tilt({ children, from = [14, -6, 0.92], to = [4, -2, 1], dur = 120, style }: { children: React.ReactNode; from?: [number, number, number]; to?: [number, number, number]; dur?: number; style?: React.CSSProperties }) {
  const f = useCurrentFrame();
  const t = interpolate(f, [0, dur], [0, 1], { ...clamp, easing: easeIO });
  const ry = from[0] + (to[0] - from[0]) * t;
  const rx = from[1] + (to[1] - from[1]) * t;
  const sc = from[2] + (to[2] - from[2]) * t;
  return <div style={{ perspective: 2400, ...style }}><div style={{ transform: `rotateY(${ry}deg) rotateX(${rx}deg) scale(${sc})`, transformStyle: "preserve-3d" }}>{children}</div></div>;
}

/** A pulsing highlight box in screen coordinates. */
export function Focus({ x, y, w, h, at = 0, color = "#f0b45a", r = 12 }: { x: number; y: number; w: number; h: number; at?: number; color?: string; r?: number }) {
  const f = useCurrentFrame();
  const p = interpolate(f - at, [0, 10], [0, 1], { ...clamp, easing: easeIO });
  const pulse = 0.5 + 0.5 * Math.sin((f - at) / 6);
  if (f < at) return null;
  return (
    <div style={{ position: "absolute", left: x - 8, top: y - 8, width: w + 16, height: h + 16, borderRadius: r, border: `4px solid ${color}`, boxShadow: `0 0 ${20 + pulse * 30}px ${color}aa, inset 0 0 30px ${color}33`, opacity: p, transform: `scale(${1.08 - p * 0.08})` }} />
  );
}
