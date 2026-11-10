import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Preload the two variable fonts the first screen uses, so headings don't reflow when they arrive (CLS).
const preloadFonts = (): Plugin => ({
  name: "preload-fonts",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler(_html, ctx) {
      const files = Object.keys(ctx.bundle ?? {}).filter((f) => /(archivo-latin-wdth-normal|source-sans-3-latin-wght-normal)-[\w-]+\.woff2$/.test(f));
      return files.map((f) => ({ tag: "link", attrs: { rel: "preload", as: "font", type: "font/woff2", href: `/${f}`, crossorigin: "" }, injectTo: "head-prepend" as const }));
    },
  },
});

// Built into web/dist and served by the Express app (src/app.ts). In dev, API and form posts proxy to the server.
const api = process.env.STOCKSURE_API ?? "http://localhost:4110";
export default defineConfig({
  plugins: [react(), tailwindcss(), preloadFonts()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 700 },
  server: { port: 5173, proxy: { "^/(api|po|login|logout|demo/(reset|fault)|connect-paypal|catalog/|guard|static|doc|negotiations|channels|safety)": { target: api, changeOrigin: false } } },
});
