/** Demo-workspace and admin routes, walked in test/workspaces.test.ts rather than the base-data journey. */
export const WORKSPACE_ROUTES = ["GET /admin/paypal/wallet", "GET /admin/paypal/wallet/return", "GET /admin/workspaces", "GET /api/ui/workspace", "GET /demo/join.svg", "GET /demo/join/:token", "GET /start", "POST /admin/expire", "POST /admin/login", "POST /admin/paypal/wallet/start", "POST /admin/reset-base", "POST /admin/showcase", "POST /demo/start"];
/** The Ask page and its API (spec A5.3), walked over HTTP in test/agent.test.ts. */
export const ASK_ROUTES = ["GET /api/ui/ask", "GET /api/ui/ask/:id", "GET /api/ui/ask/:id/events", "GET /ask", "POST /api/ui/ask"];
/** Spec A3: the judge API and the pages that need no sign-in, walked in test/public.test.ts. */
export const PUBLIC_ROUTES = ["GET /api/public/ai", "GET /api/public/judge", "GET /api/public/mcp", "GET /api/public/paypal", "GET /api/public/proof", "GET /accessibility", "GET /agents", "GET /ai", "GET /paypal", "GET /proof", "GET /who-can-move-money"];
