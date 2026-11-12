// node render.mjs stills V1-PayForWhatArrived 90,200,300   |   node render.mjs video V1-PayForWhatArrived
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { readdirSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const [mode, id, frames] = process.argv.slice(2);
const pw = path.join(homedir(), "Library/Caches/ms-playwright");
const hs = readdirSync(pw).filter((d) => d.startsWith("chromium_headless_shell")).sort().pop();
const sub = readdirSync(path.join(pw, hs)).find((d) => d.startsWith("chrome"));
const browserExecutable = path.join(pw, hs, sub, "headless_shell");
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const inputProps = {};
const composition = await selectComposition({ serveUrl, id, inputProps, browserExecutable });
mkdirSync("out/stills", { recursive: true });
if (mode === "stills") {
  for (const f of frames.split(",").map(Number)) {
    await renderStill({ serveUrl, composition, frame: f, output: `out/stills/${id}-${f}.jpg`, imageFormat: "jpeg", jpegQuality: 80, browserExecutable, inputProps, scale: 0.5 });
    console.log("still", f);
  }
} else {
  await renderMedia({
    serveUrl, composition, codec: "h264", crf: 16, audioBitrate: "320k", pixelFormat: "yuv420p", x264Preset: "slow",
    outputLocation: `out/${id}.mp4`, browserExecutable, inputProps, concurrency: 6,
    onProgress: ({ progress }) => { if (Math.round(progress * 100) % 10 === 0) process.stdout.write(`\r${Math.round(progress * 100)}%`); },
  });
  console.log("\nvideo", `out/${id}.mp4`);
}
