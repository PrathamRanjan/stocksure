import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F } from "../theme";
import { clamp, Enter, Logo, Stage, Words } from "./core";

export function EndCard({ line, sub, glow = C.paid }: { line: string; sub: string; glow?: string }) {
  const f = useCurrentFrame();
  const fade = interpolate(f, [60, 84], [1, 0], clamp);
  return (
    <Stage glow={glow} grid>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 40, opacity: fade }}>
        <Logo at={0} size={0.9} />
        <Words text={line} at={10} size={58} weight={700} color={C.paper} align="center" stagger={2} wdth={105} />
        <Enter at={22}>
          <div style={{ fontFamily: F.mono, fontSize: 24, color: "#ffffff88", letterSpacing: "0.08em" }}>{sub}</div>
        </Enter>
      </AbsoluteFill>
    </Stage>
  );
}
