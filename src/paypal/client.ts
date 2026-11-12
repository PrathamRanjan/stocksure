import { currentLang, PAYPAL_LOCALE } from "../lib/lang.js";
import { paypalBaseUrl } from "../config.js";
import { CaptureInput, HoldInput, InvoiceInput, PayoutInput, PayPalApi, PayPalError, PPAuthorization, PPBalance, PPCapture, PPDispute, PPOrder, PPRefund, PPSetupToken, PPTransaction, toValue, TrackingInput, UnknownOutcomeError } from "./types.js";

type Json = Record<string, any>;

/** Typed PayPal REST client. Writes carry PayPal-Request-Id so a retry with the same id cannot apply twice. */
export class PayPalClient implements PayPalApi {
  private token: { value: string; expiresAt: number; scopes: string[]; appId?: string } | null = null;
  readonly env: "sandbox" | "live";

  constructor(private readonly creds: { clientId: string; clientSecret: string; env: "sandbox" | "live" }, private readonly fetchImpl: typeof fetch = (i, init) => fetch(i, init)) {
    this.env = creds.env;
  }

  private get base() {
    return paypalBaseUrl(this.env);
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const res = await this.fetchImpl(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const data = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) throw new PayPalError(String(data.error_description ?? "PayPal authentication failed"), res.status, String(data.error ?? ""), undefined, data);
    this.token = { value: String(data.access_token), expiresAt: Date.now() + Number(data.expires_in ?? 3000) * 1000, scopes: String(data.scope ?? "").split(" ").filter(Boolean), appId: data.app_id };
    return this.token.value;
  }

  private pendingMock: string | null = null;

  /** Roadmap B.7: negative tests on the real sandbox. The header is sent on the next request only. */
  async withMockResponse<T>(mock: { mock_application_codes: string }, fn: () => Promise<T>): Promise<T> {
    if (this.env !== "sandbox") throw new Error("PayPal-Mock-Response is sandbox only");
    this.pendingMock = JSON.stringify(mock);
    try {
      return await fn();
    } finally {
      this.pendingMock = null;
    }
  }

  private async call<T = Json>(method: string, path: string, body?: unknown, opts: { requestId?: string; prefer?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json", Accept: "application/json" };
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    if (opts.prefer) headers["Prefer"] = opts.prefer;
    if (this.pendingMock && method !== "GET") {
      headers["PayPal-Mock-Response"] = this.pendingMock;
      this.pendingMock = null;
    }
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
      } catch (e) {
        last = new UnknownOutcomeError(`Network error calling PayPal ${method} ${path}: ${(e as Error).message}`);
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue; // same PayPal-Request-Id: safe
        }
        throw last;
      }
      const text = await res.text();
      const data = (text ? JSON.parse(text) : {}) as any;
      if (res.status >= 500 && attempt < 2) {
        last = new PayPalError(data.message ?? `PayPal ${res.status}`, res.status, data.name, data.debug_id, data.details);
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      // PayPal still working on this request id ("request in progress") or rate limiting: the outcome is
      // unknown, never a refusal. Wait and resend the same request id; if it persists, report it as unknown.
      if (res.status === 429 || /PREVIOUS_REQUEST_IN_PROGRESS/.test(`${data.name ?? ""} ${JSON.stringify(data.details ?? "")}`)) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        throw new UnknownOutcomeError(`PayPal is still processing ${method} ${path} (outcome unknown; retry with the same request id)`);
      }
      if (!res.ok) {
        const d = Array.isArray(data.details) && data.details[0] ? `: ${data.details[0].issue ?? ""} ${data.details[0].description ?? ""}`.trim() : "";
        throw new PayPalError(`${data.message ?? data.name ?? `PayPal ${res.status}`}${d}`, res.status, data.name ?? data.details?.[0]?.issue, data.debug_id, data.details);
      }
      return data as T;
    }
    throw last;
  }

  async verifyCredentials() {
    await this.accessToken();
    return { appId: this.token?.appId, scopes: this.token?.scopes ?? [] };
  }

  async createSetupToken(input: { returnUrl: string; cancelUrl: string; description: string }, requestId: string): Promise<PPSetupToken> {
    const d = await this.call<Json>(
      "POST",
      "/v3/vault/setup-tokens",
      {
        payment_source: {
          paypal: {
            description: input.description.slice(0, 127),
            usage_type: "MERCHANT",
            customer_type: "CONSUMER",
            permit_multiple_payment_tokens: true,
            // Spec B: PayPal's approval page in the person's language; English sends no locale, as before.
            experience_context: { brand_name: "StockSure", ...(currentLang() !== "en" ? { locale: PAYPAL_LOCALE[currentLang()] } : {}), return_url: input.returnUrl, cancel_url: input.cancelUrl, shipping_preference: "NO_SHIPPING", vault_instruction: "ON_PAYER_APPROVAL" },
          },
        },
      },
      { requestId },
    );
    return { id: d.id, status: d.status, approveUrl: d.links?.find((l: Json) => l.rel === "approve")?.href ?? null };
  }

  async createPaymentToken(setupTokenId: string, requestId: string) {
    const d = await this.call<Json>("POST", "/v3/vault/payment-tokens", { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } }, { requestId });
    return { id: String(d.id), customerId: d.customer?.id, payerEmail: d.payment_source?.paypal?.email_address };
  }

  async getPaymentToken(id: string) {
    try {
      const d = await this.call<Json>("GET", `/v3/vault/payment-tokens/${encodeURIComponent(id)}`);
      return { id: String(d.id), payerEmail: d.payment_source?.paypal?.email_address };
    } catch (e) {
      if (e instanceof PayPalError && e.status === 404) return null;
      throw e;
    }
  }

  async createVaultedAuthorizeOrder(input: HoldInput, requestId: string) {
    return this.call<PPOrder>(
      "POST",
      "/v2/checkout/orders",
      {
        intent: "AUTHORIZE",
        purchase_units: [
          {
            reference_id: input.customId,
            custom_id: input.customId,
            invoice_id: input.invoiceId,
            description: input.description.slice(0, 127),
            amount: { currency_code: input.currency, value: toValue(input.amountCents) },
          },
        ],
        payment_source: { paypal: { vault_id: input.vaultId } },
      },
      { requestId, prefer: "return=representation" },
    );
  }

  async getOrder(id: string) {
    return this.call<PPOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(id)}`);
  }

  async authorizeOrder(orderId: string, requestId: string) {
    return this.call<PPOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {}, { requestId, prefer: "return=representation" });
  }

  async getAuthorization(id: string) {
    return this.call<PPAuthorization>("GET", `/v2/payments/authorizations/${encodeURIComponent(id)}`);
  }

  async captureAuthorization(id: string, input: CaptureInput, requestId: string) {
    return this.call<PPCapture>(
      "POST",
      `/v2/payments/authorizations/${encodeURIComponent(id)}/capture`,
      { amount: { currency_code: input.currency, value: toValue(input.amountCents) }, final_capture: input.finalCapture, invoice_id: input.invoiceId, note_to_payer: input.note.slice(0, 255) },
      { requestId, prefer: "return=representation" },
    );
  }

  async voidAuthorization(id: string, requestId: string) {
    await this.call("POST", `/v2/payments/authorizations/${encodeURIComponent(id)}/void`, undefined, { requestId });
  }

  async getCapture(id: string) {
    return this.call<PPCapture>("GET", `/v2/payments/captures/${encodeURIComponent(id)}`);
  }

  async refundCapture(captureId: string, amountCents: number | null, currency: string, note: string, requestId: string) {
    const body: Json = { note_to_payer: note.slice(0, 255) };
    if (amountCents !== null) body.amount = { value: toValue(amountCents), currency_code: currency };
    return this.call<PPRefund>("POST", `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, body, { requestId, prefer: "return=representation" });
  }


  async getRefund(id: string) {
    return this.call<PPRefund>("GET", `/v2/payments/refunds/${encodeURIComponent(id)}`);
  }

  // ---- Roadmap B.7 / S7: reauthorize, disputes, reporting, tracking, payouts, invoicing ----

  async reauthorize(id: string, requestId: string) {
    return this.call<PPAuthorization>("POST", `/v2/payments/authorizations/${encodeURIComponent(id)}/reauthorize`, {}, { requestId, prefer: "return=representation" });
  }

  async listDisputes(opts: { status?: string; transactionId?: string } = {}): Promise<PPDispute[]> {
    const qs = new URLSearchParams();
    if (opts.status) qs.set("dispute_state", opts.status);
    if (opts.transactionId) qs.set("disputed_transaction_id", opts.transactionId);
    qs.set("page_size", "50");
    const d = await this.call<Json>("GET", `/v1/customer/disputes?${qs}`);
    return (d.items ?? []) as PPDispute[];
  }

  async getDispute(id: string): Promise<PPDispute> {
    return this.call<PPDispute>("GET", `/v1/customer/disputes/${encodeURIComponent(id)}`);
  }

  async provideDisputeEvidence(id: string, evidence: { notes: string; trackingNumber?: string; carrier?: string; evidenceType?: string }, requestId: string) {
    const body: Json = {
      evidences: [
        {
          evidence_type: evidence.evidenceType ?? "OTHER",
          notes: evidence.notes.slice(0, 2000),
          ...(evidence.trackingNumber ? { evidence_info: { tracking_info: [{ carrier_name: evidence.carrier ?? "OTHER", tracking_number: evidence.trackingNumber }] } } : {}),
        },
      ],
    };
    await this.call<Json>("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, body, { requestId });
    return { accepted: true };
  }

  async acceptDisputeClaim(id: string, note: string, requestId: string) {
    await this.call<Json>("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/accept-claim`, { note: note.slice(0, 2000), accept_claim_type: "REFUND" }, { requestId });
    return { accepted: true };
  }

  async searchTransactions(opts: { startDate: Date; endDate: Date; transactionId?: string }): Promise<PPTransaction[]> {
    const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
    const qs = new URLSearchParams({ start_date: iso(opts.startDate), end_date: iso(opts.endDate), fields: "transaction_info,payer_info", page_size: "100" });
    if (opts.transactionId) qs.set("transaction_id", opts.transactionId);
    const d = await this.call<Json>("GET", `/v1/reporting/transactions?${qs}`);
    return (d.transaction_details ?? []) as PPTransaction[];
  }

  async listBalances(): Promise<PPBalance[]> {
    const d = await this.call<Json>("GET", "/v1/reporting/balances");
    return (d.balances ?? []) as PPBalance[];
  }

  async addTracking(input: TrackingInput, requestId: string) {
    const d = await this.call<Json>("POST", `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/track`, { capture_id: input.captureId, tracking_number: input.trackingNumber, carrier: input.carrier, notify_payer: input.notifyPayer ?? false }, { requestId });
    return { trackers: d.purchase_units?.[0]?.shipping?.trackers ?? [] };
  }

  async createPayout(input: PayoutInput, requestId: string) {
    const d = await this.call<Json>(
      "POST",
      "/v1/payments/payouts",
      {
        sender_batch_header: { sender_batch_id: input.senderBatchId, email_subject: "A credit from your supplier via StockSure", email_message: input.note.slice(0, 255) },
        items: [{ recipient_type: "EMAIL", receiver: input.receiverEmail, amount: { value: toValue(input.amountCents), currency: input.currency }, note: input.note.slice(0, 255), sender_item_id: input.senderItemId }],
      },
      { requestId },
    );
    return { batchId: String(d.batch_header?.payout_batch_id ?? ""), batchStatus: String(d.batch_header?.batch_status ?? "PENDING") };
  }

  async createInvoice(input: InvoiceInput, requestId: string) {
    const draft = await this.call<Json>(
      "POST",
      "/v2/invoicing/invoices",
      {
        detail: { invoice_number: input.invoiceNumber, currency_code: input.currency, note: input.note.slice(0, 4000), payment_term: { term_type: "DUE_ON_RECEIPT" } },
        primary_recipients: [{ billing_info: { email_address: input.recipientEmail } }],
        items: input.items.map((i) => ({ name: i.name.slice(0, 200), quantity: String(i.quantity), unit_amount: { currency_code: input.currency, value: toValue(i.unitCents) } })),
      },
      { requestId, prefer: "return=representation" },
    );
    const id = String(draft.id ?? draft.href?.split("/").pop() ?? "");
    let status = String(draft.status ?? "DRAFT");
    let href: string | null = null;
    if (id) {
      const sent = await this.call<Json>("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, { send_to_recipient: true }, { requestId: `${requestId}:send` }).catch(() => null);
      if (sent) status = "SENT";
      href = typeof sent?.href === "string" ? sent.href : null;
    }
    return { id, status, href };
  }

  async createWebhook(url: string, eventTypes: string[]) {
    const d = await this.call<{ id: string }>("POST", "/v1/notifications/webhooks", { url, event_types: eventTypes.map((name) => ({ name })) });
    return { id: d.id };
  }

  async listWebhooks() {
    const d = await this.call<{ webhooks: { id: string; url: string }[] }>("GET", "/v1/notifications/webhooks");
    return d.webhooks ?? [];
  }

  async verifyWebhookSignature(headers: Record<string, string | undefined>, body: unknown, webhookId: string) {
    const d = await this.call<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: webhookId,
      webhook_event: body,
    });
    return d.verification_status === "SUCCESS";
  }
}

export const WEBHOOK_EVENTS = ["PAYMENT.AUTHORIZATION.CREATED", "PAYMENT.AUTHORIZATION.VOIDED", "PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"];
