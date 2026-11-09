import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Built into web/dist and served by the Express app (src/app.ts). In dev, API and form posts proxy to the server.
const api = process.env.STOCKSURE_API ?? "http://localhost:4110";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 700 },
  server: { port: 5173, proxy: { "^/(api|po|login|logout|demo/(reset|fault)|connect-paypal|catalog/|guard|static|doc|negotiations|channels|safety)": { target: api, changeOrigin: false } } },
});
