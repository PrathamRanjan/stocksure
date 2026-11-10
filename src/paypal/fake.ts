import { randomBytes } from "node:crypto";
import { CaptureInput, HoldInput, InvoiceInput, PayoutInput, PayPalApi, PayPalError, PPAuthorization, PPBalance, PPCapture, PPDispute, PPOrder, PPRefund, PPTransaction, toValue, TrackingInput, UnknownOutcomeError } from "./types.js";

const rid = (p: string) => `${p}${randomBytes(6).toString("hex").toUpperCase()}`;

type FakeAuth = PPAuthorization & { orderId: string; cents: number; capturedCents: number };
type FakeCapture = PPCapture & { authId: string; cents: number; refundedCents: number };

/**
 * In-memory PayPal with vaulted authorizations, partial and final captures, voids and partial refunds.
 * Idempotent on PayPal-Request-Id. Failure helpers simulate 5xx, lost responses and slow hold release.
 */
export class FakePayPal implements PayPalApi {
  readonly env = "sandbox" as const;
  orders = new Map<string, PPOrder & { customId: string; currency: string }>();
  auths = new Map<string, FakeAuth>();
  captures = new Map<string, FakeCapture>();
  refunds = new Map<string, PPRefund & { captureId: string }>();
  tokens = new Set<string>();
  setupApproved = new Set<string>();
  calls: string[] = [];
  /** Every write body, so tests can assert that no payee was ever sent. */
  bodies: { method: string; body: unknown }[] = [];
  private idem = new Map<string, unknown>();
  private fail = new Map<string, Error>();
  private lose = new Set<string>();
  /** getAuthorization returns the pre-capture status for this many more reads (slow release). */
  releaseLag = 0;

  constructor(private readonly approveBase = "http://fake.paypal.local") {}

  failNext(method: string, err: Error = new PayPalError("Service unavailable", 503, "SERVICE_UNAVAILABLE", "fake", null)) {
    this.fail.set(method, err);
  }
  loseResponseNext(method: string) {
    this.lose.add(method);
  }
  approveSetup(id: string) {
    this.setupApproved.add(id);
  }
  capturedTotal() {
    return [...this.captures.values()].reduce((a, c) => a + c.cents, 0);
  }

  private async run<T>(method: string, requestId: string | null, body: unknown, fn: () => T): Promise<T> {
    this.calls.push(method);
    if (requestId) this.bodies.push({ method, body });
    const f = this.fail.get(method);
    if (f) {
      this.fail.delete(method);
      throw f;
    }
    let out: T;
    if (requestId && this.idem.has(requestId)) out = this.idem.get(requestId) as T;
    else {
      out = fn();
      if (requestId) this.idem.set(requestId, out);
    }
    if (this.lose.has(method)) {
      this.lose.delete(method);
      throw new UnknownOutcomeError(`Simulated lost response for ${method}`);
    }
    return JSON.parse(JSON.stringify(out));
  }

  private notFound(what: string): never {
    throw new PayPalError(`${what} not found`, 404, "RESOURCE_NOT_FOUND", "fake", null);
  }

  private view(orderId: string): PPOrder {
    const o = this.orders.get(orderId) ?? this.notFound("Order");
    const auths = [...this.auths.values()].filter((a) => a.orderId === orderId);
    const caps = [...this.captures.values()].filter((c) => auths.some((a) => a.id === c.authId));
    return {
      id: o.id,
      status: o.status,
      purchase_units: [
        {
          reference_id: o.customId,
          custom_id: o.customId,
          amount: o.purchase_units?.[0]?.amount,
          payments: {
            authorizations: auths.map((a) => ({ id: a.id, status: a.status, amount: a.amount, custom_id: a.custom_id, expiration_time: a.expiration_time })),
            captures: caps.map((c) => ({ id: c.id, status: c.status, amount: c.amount, final_capture: c.final_capture, invoice_id: c.invoice_id })),
          },
        },
      ],
    };
  }

  async verifyCredentials() {
    return this.run("verifyCredentials", null, null, () => ({ appId: "FAKE", scopes: ["vault", "payments"] }));
  }

  async createSetupToken(input: { returnUrl: string }, requestId: string) {
    return this.run("createSetupToken", requestId, input, () => {
      const id = rid("ST");
      return { id, status: "PAYER_ACTION_REQUIRED", approveUrl: `${this.approveBase}/vault?token=${id}&return=${encodeURIComponent(input.returnUrl)}` };
    });
  }

  async getPaymentToken(id: string) {
    return this.run("getPaymentToken", null, null, () => (this.tokens.has(id) ? { id, payerEmail: "buyer@example.com" } : null));
  }

  async createPaymentToken(setupTokenId: string, requestId: string) {
    return this.run("createPaymentToken", requestId, { setupTokenId }, () => {
      if (!this.setupApproved.has(setupTokenId)) throw new PayPalError("Setup token not approved", 422, "UNPROCESSABLE_ENTITY", "fake", null);
      const id = rid("PT");
      this.tokens.add(id);
      return { id, customerId: rid("CUS"), payerEmail: "buyer@example.com" };
    });
  }

  async createVaultedAuthorizeOrder(input: HoldInput, requestId: string) {
    return this.run("createVaultedAuthorizeOrder", requestId, input, () => {
      if (!this.tokens.has(input.vaultId)) throw new PayPalError("Payment token not found", 422, "UNPROCESSABLE_ENTITY", "fake", null);
      const id = rid("OR");
      this.orders.set(id, { id, status: "COMPLETED", customId: input.customId, currency: input.currency, purchase_units: [{ custom_id: input.customId, amount: { value: toValue(input.amountCents), currency_code: input.currency } }] });
      const a: FakeAuth = {
        id: rid("AU"),
        status: "CREATED",
        amount: { value: toValue(input.amountCents), currency_code: input.currency },
        custom_id: input.customId,
        orderId: id,
        cents: input.amountCents,
        capturedCents: 0,
        expiration_time: new Date(Date.now() + 29 * 864e5).toISOString(),
      };
      this.auths.set(a.id, a);
      return this.view(id);
    });
  }

  async getOrder(id: string) {
    return this.run("getOrder", null, null, () => this.view(id));
  }

  async authorizeOrder(orderId: string) {
    return this.run("authorizeOrder", null, null, () => this.view(orderId));
  }

  async getAuthorization(id: string) {
    return this.run("getAuthorization", null, null, () => {
      const a = this.auths.get(id) ?? this.notFound("Authorization");
      const status = this.releaseLag > 0 && (a.status === "CAPTURED" || a.status === "VOIDED") ? (this.releaseLag--, a.capturedCents > 0 ? "PARTIALLY_CAPTURED" : "CREATED") : a.status;
      return { id: a.id, status, amount: a.amount, custom_id: a.custom_id, expiration_time: a.expiration_time } as PPAuthorization;
    });
  }

  async captureAuthorization(id: string, input: CaptureInput, requestId: string) {
    return this.run("captureAuthorization", requestId, { id, ...input }, () => {
      const a = this.auths.get(id) ?? this.notFound("Authorization");
      if (a.status === "CAPTURED") throw new PayPalError("Authorization has already been captured", 422, "AUTHORIZATION_ALREADY_CAPTURED", "fake", null);
      if (a.status === "VOIDED") throw new PayPalError("Authorization is voided", 422, "AUTHORIZATION_VOIDED", "fake", null);
      if (input.amountCents <= 0 || input.amountCents > a.cents - a.capturedCents) throw new PayPalError("Capture exceeds the authorized amount", 422, "MAX_CAPTURE_AMOUNT_EXCEEDED", "fake", null);
      const c: FakeCapture = { id: rid("CA"), status: (this.nextCaptureStatus ?? "COMPLETED") as FakeCapture["status"], amount: { value: toValue(input.amountCents), currency_code: input.currency }, final_capture: input.finalCapture, invoice_id: input.invoiceId, authId: id, cents: input.amountCents, refundedCents: 0 };
      this.captures.set(c.id, c);
      a.capturedCents += input.amountCents;
      a.status = input.finalCapture || a.capturedCents >= a.cents ? "CAPTURED" : "PARTIALLY_CAPTURED";
      return { id: c.id, status: c.status, amount: c.amount, final_capture: c.final_capture, invoice_id: c.invoice_id };
    });
  }

  /** The next capture comes back with this status (e.g. PENDING); later set it with setCaptureStatus. */
  nextCaptureStatus: string | null = null;
  setCaptureStatus(id: string, status: string) {
    const c = this.captures.get(id);
    if (c) c.status = status as FakeCapture["status"];
  }

  async voidAuthorization(id: string, requestId: string) {
    await this.run("voidAuthorization", requestId, { id }, () => {
      const a = this.auths.get(id) ?? this.notFound("Authorization");
      if (a.status === "CAPTURED") throw new PayPalError("Authorization has already been captured", 422, "AUTHORIZATION_ALREADY_CAPTURED", "fake", null);
      a.status = "VOIDED";
      return {};
    });
  }

  async getCapture(id: string) {
    return this.run("getCapture", null, null, () => {
      const c = this.captures.get(id) ?? this.notFound("Capture");
      return { id: c.id, status: c.status, amount: c.amount, final_capture: c.final_capture, invoice_id: c.invoice_id };
    });
  }

  async refundCapture(captureId: string, amountCents: number | null, currency: string, note: string, requestId: string) {
    return this.run("refundCapture", requestId, { captureId, amountCents, note }, () => {
      const c = this.captures.get(captureId) ?? this.notFound("Capture");
      const left = c.cents - c.refundedCents;
      const amt = amountCents ?? left;
      if (amt <= 0 || amt > left) throw new PayPalError("Refund amount exceeds the remaining capture", 422, "REFUND_AMOUNT_EXCEEDED", "fake", null);
      c.refundedCents += amt;
      c.status = c.refundedCents >= c.cents ? "REFUNDED" : "PARTIALLY_REFUNDED";
      const r = { id: rid("RF"), status: "COMPLETED" as const, amount: { value: toValue(amt), currency_code: currency }, captureId };
      this.refunds.set(r.id, r);
      return { id: r.id, status: r.status, amount: r.amount };
    });
  }

  async getRefund(id: string) {
    return this.run("getRefund", null, null, () => {
      const r = this.refunds.get(id) ?? this.notFound("Refund");
      return { id: r.id, status: r.status, amount: r.amount };
    });
  }

  async createWebhook(url: string) {
    return { id: `WH-FAKE-${url.length}` };
  }
  async listWebhooks() {
    return [];
  }
  async verifyWebhookSignature(headers: Record<string, string | undefined>) {
    return headers["paypal-transmission-sig"] === "valid-fake-signature";
  }

  /** Test helper: total captured on one authorization. */
  capturedOn(authId: string) {
    return this.auths.get(authId)?.capturedCents ?? 0;
  }

  // ---- Roadmap B.7 / S7 ----
  disputes = new Map<string, PPDispute & { evidence: unknown[] }>();
  trackers: { orderId: string; captureId: string; trackingNumber: string; carrier: string }[] = [];
  payouts: { batchId: string; input: PayoutInput }[] = [];
  invoices: { id: string; input: InvoiceInput; status: string }[] = [];
  private mock: string | null = null;

  /** Opens a sandbox-style dispute against a capture (tests and the demo use this). */
  openDispute(captureId: string, reason = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"): PPDispute {
    const cap = this.captures.get(captureId);
    const d: PPDispute & { evidence: unknown[] } = {
      dispute_id: rid("PP-D-"),
      status: "WAITING_FOR_SELLER_RESPONSE",
      reason,
      dispute_amount: cap?.amount,
      disputed_transactions: [{ seller_transaction_id: captureId }],
      dispute_life_cycle_stage: "INQUIRY",
      seller_response_due_date: new Date(Date.now() + 7 * 86400_000).toISOString(),
      create_time: new Date().toISOString(),
      evidence: [],
    };
    this.disputes.set(d.dispute_id, d);
    return d;
  }

  async withMockResponse<T>(mock: { mock_application_codes: string }, fn: () => Promise<T>): Promise<T> {
    this.mock = mock.mock_application_codes;
    try {
      return await fn();
    } finally {
      this.mock = null;
    }
  }

  /** Called by write methods: simulates the sandbox mock codes used in negative tests. */
  private consumeMock(method: string) {
    const m = this.mock;
    if (!m) return;
    this.mock = null;
    if (m === "INSTRUMENT_DECLINED" || m === "INSUFFICIENT_FUNDS" || m === "TRANSACTION_REFUSED") throw new PayPalError(`Simulated ${m} on ${method}`, 422, m, "fake-mock-" + m.toLowerCase(), [{ issue: m }]);
    if (m === "INTERNAL_SERVER_ERROR") throw new PayPalError("Simulated 500", 500, "INTERNAL_SERVER_ERROR", "fake-mock-500", null);
  }

  async reauthorize(id: string, requestId: string) {
    this.consumeMock("reauthorize");
    return this.run("reauthorize", requestId, { id }, () => {
      const a = this.auths.get(id) ?? this.notFound("Authorization");
      if (a.status !== "CREATED" && a.status !== "EXPIRED") throw new PayPalError(`Authorization is ${a.status}`, 422, "AUTHORIZATION_NOT_REAUTHORIZABLE", "fake", null);
      a.status = "VOIDED";
      const n: FakeAuth = { ...a, id: rid("AU"), status: "CREATED", capturedCents: 0, expiration_time: new Date(Date.now() + 29 * 864e5).toISOString() };
      this.auths.set(n.id, n);
      return { id: n.id, status: n.status, amount: n.amount, custom_id: n.custom_id, expiration_time: n.expiration_time } as PPAuthorization;
    });
  }

  async listDisputes(opts: { status?: string; transactionId?: string } = {}): Promise<PPDispute[]> {
    return this.run("listDisputes", null, null, () => [...this.disputes.values()].filter((d) => (!opts.status || d.status === opts.status) && (!opts.transactionId || d.disputed_transactions?.some((t) => t.seller_transaction_id === opts.transactionId))));
  }

  async getDispute(id: string): Promise<PPDispute> {
    return this.run("getDispute", null, null, () => this.disputes.get(id) ?? this.notFound("Dispute"));
  }

  async provideDisputeEvidence(id: string, evidence: { notes: string; trackingNumber?: string; carrier?: string; evidenceType?: string }, requestId: string) {
    return this.run("provideDisputeEvidence", requestId, { id, evidence }, () => {
      const d = this.disputes.get(id) ?? this.notFound("Dispute");
      if (d.status !== "WAITING_FOR_SELLER_RESPONSE") throw new PayPalError("Evidence only accepted while WAITING_FOR_SELLER_RESPONSE", 422, "UNPROCESSABLE_ENTITY", "fake", null);
      d.evidence.push(evidence);
      d.status = "UNDER_REVIEW";
      d.update_time = new Date().toISOString();
      return { accepted: true };
    });
  }

  async acceptDisputeClaim(id: string, _note: string, requestId: string) {
    return this.run("acceptDisputeClaim", requestId, { id }, () => {
      const d = this.disputes.get(id) ?? this.notFound("Dispute");
      d.status = "RESOLVED";
      return { accepted: true };
    });
  }

  async searchTransactions(opts: { startDate: Date; endDate: Date; transactionId?: string }): Promise<PPTransaction[]> {
    return this.run("searchTransactions", null, null, () => {
      const out: PPTransaction[] = [];
      for (const c of this.captures.values()) {
        if (opts.transactionId && c.id !== opts.transactionId) continue;
        out.push({ transaction_info: { transaction_id: c.id, transaction_status: c.status === "COMPLETED" ? "S" : "P", transaction_amount: c.amount, transaction_initiation_date: new Date().toISOString(), transaction_event_code: "T0006", invoice_id: c.invoice_id } });
      }
      for (const r of this.refunds.values()) out.push({ transaction_info: { transaction_id: r.id, transaction_status: "S", transaction_amount: { currency_code: r.amount?.currency_code ?? "USD", value: "-" + (r.amount?.value ?? "0") }, transaction_event_code: "T1107" } });
      return out;
    });
  }

  async listBalances(): Promise<PPBalance[]> {
    return this.run("listBalances", null, null, () => {
      const v = toValue(this.capturedTotal() - [...this.captures.values()].reduce((a, c) => a + c.refundedCents, 0));
      return [{ currency: "USD", total_balance: { currency_code: "USD", value: v }, available_balance: { currency_code: "USD", value: v }, withheld_balance: { currency_code: "USD", value: "0.00" } }];
    });
  }

  async addTracking(input: TrackingInput, requestId: string) {
    return this.run("addTracking", requestId, input, () => {
      if (!this.captures.has(input.captureId)) this.notFound("Capture");
      this.trackers.push({ orderId: input.orderId, captureId: input.captureId, trackingNumber: input.trackingNumber, carrier: input.carrier });
      return { trackers: [{ id: `${input.captureId}-${input.trackingNumber}`, status: "SHIPPED" }] };
    });
  }

  async createPayout(input: PayoutInput, requestId: string) {
    this.consumeMock("createPayout");
    return this.run("createPayout", requestId, input, () => {
      const batchId = rid("PB");
      this.payouts.push({ batchId, input });
      return { batchId, batchStatus: "PENDING" };
    });
  }

  async createInvoice(input: InvoiceInput, requestId: string) {
    return this.run("createInvoice", requestId, input, () => {
      const id = rid("INV2-");
      this.invoices.push({ id, input, status: "SENT" });
      return { id, status: "SENT", href: `${this.approveBase}/invoice/p/#${id}` };
    });
  }
}
