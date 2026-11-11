// /safety page: score a pasted message with the server rules and, in this browser, the fine-tuned text model.
// The model (23 MB, int8 ONNX) downloads once and is cached by the browser; the text is never sent anywhere for the score.
import { loadGuard } from "/static/safety/guard-client.js";

const $ = (id) => document.getElementById(id);
const form = $("scan-form"), text = $("scan-text"), out = $("scan-result"), status = $("scan-status"), btn = $("scan-btn");
const WORDS = {
  impersonation: "claims to be an authority, a bank or your boss", urgency_secrecy: "pushes you to act fast or keep it quiet", changed_details: "asks you to pay to new bank or PayPal details",
  off_platform: "asks to pay outside PayPal or move the chat elsewhere", gift_cards_crypto: "asks for gift cards or crypto", fee_to_release: "asks for a fee to release money or goods",
  otp_or_link: "asks for a code or sends a link to click", overpay_refund: "says they overpaid and want the difference back", too_good: "promises a prize or guaranteed profit",
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LEVEL = { hold: ["bad", "Hold: do not pay yet"], caution: ["warn", "Caution: check before you pay"], clear: ["good", "No scam signals found"] };

let guardPromise = null;
function guard() {
  if (!guardPromise) {
    if (!window.ort) return Promise.reject(new Error("onnxruntime-web did not load"));
    window.ort.env.wasm.wasmPaths = "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.22.0/";
    guardPromise = loadGuard({ modelUrl: "/static/safety/model/model_quantized.onnx", tokenizerUrl: "/static/safety/model/tokenizer.json", headsUrl: "/static/safety/model/heads.json", ort: window.ort });
  }
  return guardPromise;
}

$("scan-demo")?.addEventListener("click", () => { text.value = JSON.parse($("demo-bec").textContent).text; text.focus(); });

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = text.value.trim();
  if (!t) { text.focus(); return; }
  btn.disabled = true; status.textContent = "Checking…";
  out.innerHTML = "";
  let rules = null, model = null, modelErr = null, ms = 0;
  try { rules = await fetch("/safety/scan", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ text: t }) }).then((r) => r.json()); } catch (err) { rules = { error: err.message }; }
  try {
    status.textContent = guardPromise ? "Scoring in your browser…" : "Loading the model into your browser (23 MB, once)…";
    const g = await guard(); const t0 = performance.now(); model = await g.score(t); ms = performance.now() - t0;
  } catch (err) { modelErr = err.message; }
  btn.disabled = false; status.textContent = "";
  // Spec A6.1/A6.2: strictest of the server's readers (rules, Decisions, destinations in code) and this device's model.
  // Green only when every reader answered clear and the message names no payment destination.
  const server = rules && !rules.error ? rules : null;
  const lv = [server?.level ?? "caution", model?.level ?? "caution"];
  const level = lv.includes("hold") ? "hold" : lv.includes("caution") ? "caution" : "clear";
  const green = level === "clear" && !!server?.green && !!model;
  const shown = green ? "clear" : level === "clear" ? "caution" : level;
  const [cls, title] = LEVEL[shown];
  const advice = server?.advice || (!model ? "The on-device check didn't run, so this isn't marked safe." : !server ? "The server checks didn't answer, so this isn't marked safe." : "");
  const r = server?.readers;
  const pct = (p) => (typeof p === "number" ? Math.round(p * 100) + "%" : "—");
  const card = (label, value, hint) => `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`;
  const tactics = new Set([...(server?.tactics ?? []), ...Object.entries(model?.tactics ?? {}).filter(([, p]) => p >= 0.5).map(([k]) => k)]);
  out.innerHTML = `<div class="banner ${cls}" role="status"><b>${title}</b>${advice ? ` ${esc(advice)}` : ""}</div>
  <div class="stat-grid">
    ${card("On this device", model ? pct(model.p_scam) : "—", model ? `text model · ${ms.toFixed(0)} ms · ${model.level} · nothing left your browser` : esc(modelErr || "not run"))}
    ${card("Rules (server)", r ? esc(r.rules.level) : "—", r ? `${r.rules.reasons.length} reason${r.rules.reasons.length === 1 ? "" : "s"} · risk ${pct(r.rules.risk)} (synthetic data)` : esc(rules?.error || rules?.message || "not run"))}
    ${card("Decisions (OpenAI)", r ? (r.decisions.answered ? esc(r.decisions.level) : "didn't answer") : "—", r?.decisions.answered ? `${esc(r.decisions.model || "")} · ${r.decisions.ms} ms · changed details ${pct(r.decisions.probabilities.changed_payment_details)} · names a destination ${pct(r.decisions.probabilities.names_a_payment_destination)}` : "not marked safe without it")}
    ${card("Destinations (code)", r ? esc(r.code.level) : "—", r ? (r.code.destinations.filter((d) => !d.on_file).length ? esc(r.code.destinations.filter((d) => !d.on_file).map((d) => d.value).join(", ")) : `none named${server?.contact_on_file ? ` · on file: ${esc(server.contact_on_file)}` : ""}`) : "")}
  </div>
  ${tactics.size ? `<h3>What this message does</h3><ul>${[...tactics].map((k) => `<li>${esc(WORDS[k] || k)}</li>`).join("")}</ul>` : ""}
  ${server?.reasons?.length ? `<h3>Why</h3><ul>${server.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
  <p class="small muted">What to do: pay only to details you confirmed by phone with a number you already had. Never share codes. ${shown === "clear" ? "A clear result is not a guarantee." : ""}</p>`;
});
