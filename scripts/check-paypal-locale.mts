// Checks that PayPal's sandbox accepts the locale StockSure sends for each language on a vault setup token.
// Creates unapproved setup tokens only (no sign-in, no money); prints status and the approve link's host.
import { paypal } from "../src/paypal/index.js";
import { withLang } from "../src/lib/lang.js";
for (const lang of ["en", "hi-IN", "id-ID", "pt-BR"] as const) {
  try {
    const st = await withLang(lang, () => paypal().createSetupToken({ returnUrl: "https://example.com/return", cancelUrl: "https://example.com/cancel", description: "StockSure locale check (sandbox)" }, `locale-check:${lang}:${Date.now()}`));
    console.log(lang, st.status, st.approveUrl ? new URL(st.approveUrl).host : "no approve link");
  } catch (e) {
    console.log(lang, "FAILED", String((e as Error).message).slice(0, 300));
  }
}
