// Serve the Expo web export (dist/) and proxy StockSure's server routes on the same origin, so the
// app's cookie session works in a desktop browser exactly as it does on a phone.
//   TARGET  server to proxy to (default the hermetic e2e server at http://127.0.0.1:4472)
//   PORT    port for this preview (default 8471)
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const target = new URL(process.env.TARGET || "http://127.0.0.1:4472");
const port = Number(process.env.PORT || 8471);
const SERVER = /^\/(api|login|logout|po|guard|connect-paypal|demo|doc|static|healthz|paypal)(\/|$|\?)/;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".ttf": "font/ttf", ".svg": "image/svg+xml" };

function proxy(req, res) {
  const lib = target.protocol === "https:" ? https : http;
  const up = lib.request(
    { hostname: target.hostname, port: target.port || (target.protocol === "https:" ? 443 : 80), path: req.url, method: req.method, headers: { ...req.headers, host: target.host } },
    (r) => {
      const headers = { ...r.headers };
      // The preview is plain http on localhost: drop Domain/Secure so the browser keeps the session cookie.
      if (headers["set-cookie"]) headers["set-cookie"] = headers["set-cookie"].map((c) => c.replace(/;\s*Domain=[^;]+/i, "").replace(/;\s*Secure/i, ""));
      res.writeHead(r.statusCode || 502, headers);
      r.pipe(res);
    },
  );
  up.on("error", () => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "The StockSure server isn't answering." }));
  });
  req.pipe(up);
}

http
  .createServer((req, res) => {
    const path = decodeURIComponent((req.url || "/").split("?")[0]);
    if (SERVER.test(path)) return proxy(req, res);
    let file = normalize(join(root, path));
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": file.endsWith("index.html") ? "no-store" : "public, max-age=3600" });
    createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`[mobile-web] http://localhost:${port} -> ${target.origin}`));
