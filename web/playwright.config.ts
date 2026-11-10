import { defineConfig, devices } from "@playwright/test";

// Runs against a hermetic server (scripts/e2e-server.ts): in-memory database, fake PayPal, no keys.
// Build the front end first (npm run build) so the server has web/dist to serve.
const PORT = Number(process.env.E2E_PORT || 4471);
// E2E_BASE points the suite at a deployed copy instead (e.g. the live sandbox demo); no local server then.
const BASE = process.env.E2E_BASE;
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: BASE ?? `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: BASE ? undefined : {
    command: `npx tsx scripts/e2e-server.ts`,
    cwd: "..",
    env: { E2E_PORT: String(PORT), SS_DEMO_MODE: "1" },
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
