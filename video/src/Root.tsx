import React from "react";
import { Composition } from "remotion";
import { FPS, H, loadFonts, W } from "./theme";
import { V1, V1_LEN } from "./videos/V1";
import { V2, V2_LEN } from "./videos/V2";
import { V3, V3_LEN } from "./videos/V3";
import { V4, V4_LEN } from "./videos/V4";
import { V5, V5_LEN } from "./videos/V5";
import { V6, V6_LEN } from "./videos/V6";

loadFonts();

export const Root: React.FC = () => (
  <>
    <Composition id="V1-PayForWhatArrived" component={V1} durationInFrames={V1_LEN} fps={FPS} width={W} height={H} />
    <Composition id="V2-AgentsSettleIt" component={V2} durationInFrames={V2_LEN} fps={FPS} width={W} height={H} />
    <Composition id="V3-InvoiceTalkedToAI" component={V3} durationInFrames={V3_LEN} fps={FPS} width={W} height={H} />
    <Composition id="V6-ShowTheWorking" component={V6} durationInFrames={V6_LEN} fps={FPS} width={W} height={H} />
    <Composition id="V5-Fragments" component={V5} durationInFrames={V5_LEN} fps={FPS} width={W} height={H} />
    <Composition id="V4-CountItIn" component={V4} durationInFrames={V4_LEN} fps={FPS} width={W} height={H} />
  </>
);
