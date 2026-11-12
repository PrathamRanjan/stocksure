import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

export const FPS = 30;
export const W = 1920;
export const H = 1080;
export const s = (sec: number) => Math.round(sec * FPS);

export const C = {
  ink: "#121110",
  ink2: "#1b1a16",
  ink3: "#2a2823",
  paper: "#f4efe4",
  paper2: "#ebe4d4",
  card: "#fffcf5",
  muted: "#8d8676",
  mutedDark: "#5f5a4f",
  paid: "#7fcf98",
  paidDeep: "#1d6b3b",
  held: "#f0b45a",
  heldDeep: "#8a5300",
  stop: "#ff6b5a",
  stopDeep: "#b0261c",
  released: "#a9afbc",
  carbon: "#9db0f2",
  carbonDeep: "#2a3f8f",
  ai: "#b9a4ff",
};

export const F = {
  display: "Archivo, sans-serif",
  sans: "SourceSans, sans-serif",
  mono: "JBMono, ui-monospace, monospace",
};

let loaded = false;
export function loadFonts() {
  if (loaded) return;
  loaded = true;
  loadFont({ family: "Archivo", url: staticFile("fonts/archivo.woff2"), weight: "100 900", style: "normal" });
  loadFont({ family: "SourceSans", url: staticFile("fonts/sourcesans.woff2"), weight: "200 900" });
  loadFont({ family: "JBMono", url: staticFile("fonts/mono500.woff2"), weight: "500" });
  loadFont({ family: "JBMono", url: staticFile("fonts/mono700.woff2"), weight: "700" });
}
