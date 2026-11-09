export interface PPMoney {
  value: string;
  currency_code: string;
}

export interface PPAuthorization {
  id: string;
  status: "CREATED" | "CAPTURED" | "DENIED" | "PARTIALLY_CAPTURED" | "VOIDED" | "PENDING" | "EXPIRED";
  amount: PPMoney;
  custom_id?: string;
  invoice_id?: string;
  expiration_time?: string;
}

export interface PPCapture {
  id: string;
  status: "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "FAILED";
  amount: PPMoney;
  final_capture?: boolean;
  custom_id?: string;
  invoice_id?: string;
  links?: { href: string; rel: string }[];
}

export interface PPRefund {
  id: string;
  status: "CANCELLED" | "FAILED" | "PENDING" | "COMPLETED";
  amount?: PPMoney;
}

export interface PPOrder {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  purchase_units?: { reference_id?: string; custom_id?: string; invoice_id?: string; amount?: PPMoney; payee?: unknown; payments?: { authorizations?: PPAuthorization[]; captures?: PPCapture[] } }[];
  links?: { href: string; rel: string; method?: string }[];
}

export interface PPSetupToken {
  id: string;
  status: string;
  approveUrl: string | null;
}

export interface HoldInput {
  vaultId: string;
  amountCents: number;
  currency: string;
  customId: string;
  invoiceId: string;
  description: string;
}

export interface CaptureInput {
  amountCents: number;
  currency: string;
  finalCapture: boolean;
  invoiceId: string;
  note: string;
}

export interface PPDispute {
  dispute_id: string;
  status: string;
  reason?: string;
  dispute_amount?: PPMoney;
  disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string }[];
  dispute_life_cycle_stage?: string;
  seller_response_due_date?: string;
  create_time?: string;
  update_time?: string;
}
export interface PPTransaction {
  transaction_info: { transaction_id: string; transaction_status?: string; transaction_amount?: PPMoney; transaction_initiation_date?: string; transaction_event_code?: string; custom_field?: string; invoice_id?: string };
  payer_info?: { email_address?: string; payer_name?: { alternate_full_name?: string } };
}
export interface PPBalance {
  currency: string;
  total_balance: PPMoney;
  available_balance: PPMoney;
  withheld_balance: PPMoney;
}
export interface TrackingInput {
  orderId: string;
  captureId: string;
  carrier: string;
  trackingNumber: string;
  notifyPayer?: boolean;
}
export interface PayoutInput {
  senderBatchId: string;
  senderItemId: string;
  receiverEmail: string;
  amountCents: number;
  currency: string;
  note: string;
}
export interface InvoiceInput {
  invoiceNumber: string;
  recipientEmail: string;
  currency: string;
  note: string;
  items: { name: string; quantity: number; unitCents: number }[];
}

/**
 * The PayPal calls StockSure makes. Note what is absent: no call takes a payee. Funds always go to the merchant
 * behind the app's own credentials, so nothing read from a document can redirect a payment.
 */
export interface PayPalApi {
  readonly env: "sandbox" | "live";
  verifyCredentials(): Promise<{ appId?: string; scopes: string[] }>;
  createSetupToken(input: { returnUrl: string; cancelUrl: string; description: string }, requestId: string): Promise<PPSetupToken>;
  createPaymentToken(setupTokenId: string, requestId: string): Promise<{ id: string; customerId?: string; payerEmail?: string }>;
  /** Merchant-initiated order on a vaulted PayPal token, intent AUTHORIZE: places a hold. */
  createVaultedAuthorizeOrder(input: HoldInput, requestId: string): Promise<PPOrder>;
  getOrder(id: string): Promise<PPOrder>;
  authorizeOrder(orderId: string, requestId: string): Promise<PPOrder>;
  getAuthorization(id: string): Promise<PPAuthorization>;
  captureAuthorization(id: string, input: CaptureInput, requestId: string): Promise<PPCapture>;
  voidAuthorization(id: string, requestId: string): Promise<void>;
  getCapture(id: string): Promise<PPCapture>;
  refundCapture(captureId: string, amountCents: number | null, currency: string, note: string, requestId: string): Promise<PPRefund>;
  getRefund(id: string): Promise<PPRefund>;
  createWebhook(url: string, eventTypes: string[]): Promise<{ id: string }>;
  listWebhooks(): Promise<{ id: string; url: string }[]>;
  verifyWebhookSignature(headers: Record<string, string | undefined>, body: unknown, webhookId: string): Promise<boolean>;
  // ---- Roadmap B.7 / S7 depth ----
  /** New authorization for the same amount after the 3-day honor period (the old one is voided by PayPal). */
  reauthorize(id: string, requestId: string): Promise<PPAuthorization>;
  listDisputes(opts?: { status?: string; transactionId?: string }): Promise<PPDispute[]>;
  getDispute(id: string): Promise<PPDispute>;
  provideDisputeEvidence(id: string, evidence: { notes: string; trackingNumber?: string; carrier?: string; evidenceType?: string }, requestId: string): Promise<{ accepted: boolean }>;
  acceptDisputeClaim(id: string, note: string, requestId: string): Promise<{ accepted: boolean }>;
  searchTransactions(opts: { startDate: Date; endDate: Date; transactionId?: string }): Promise<PPTransaction[]>;
  listBalances(): Promise<PPBalance[]>;
  addTracking(input: TrackingInput, requestId: string): Promise<{ trackers: { id?: string; status?: string }[] }>;
  /** Supplier-side payout (a credit back to a buyer outside the capture, e.g. goodwill) — recorded, never used for a refund that a capture can carry. */
  createPayout(input: PayoutInput, requestId: string): Promise<{ batchId: string; batchStatus: string }>;
  /** Draft + send a PayPal invoice for an order that has no hold (buyer without a vaulted PayPal). */
  createInvoice(input: InvoiceInput, requestId: string): Promise<{ id: string; status: string; href: string | null }>;
  /** Sandbox negative testing: PayPal-Mock-Response on the next request only. */
  withMockResponse<T>(mock: { mock_application_codes: string }, fn: () => Promise<T>): Promise<T>;
}

export class PayPalError extends Error {
  constructor(message: string, readonly status: number, readonly name_: string | undefined, readonly debugId: string | undefined, readonly details: unknown) {
    super(message);
  }
  get isClientError() {
    return this.status >= 400 && this.status < 500;
  }
}

/** Network-level failure where the request may or may not have reached PayPal. */
export class UnknownOutcomeError extends Error {}

export const toValue = (cents: number) => (cents / 100).toFixed(2);
export const toCents = (m: PPMoney | undefined) => {
  if (!m) return 0;
  const [w, f = ""] = m.value.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0").slice(0, 2));
};
export const authOf = (o: PPOrder) => o.purchase_units?.[0]?.payments?.authorizations?.[0] ?? null;
export const capturesOf = (o: PPOrder) => o.purchase_units?.[0]?.payments?.captures ?? [];
