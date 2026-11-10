/**
 * Spec A2.1: the saved sandbox buyer wallet. One PayPal Vault payment token, approved once by the owner, that every
 * demo workspace's buyers pay from, so a judge can complete holds and captures with no PayPal login.
 *
 * Where the token comes from, in order: a re-approval made on /admin/paypal/wallet (stored in the shared
 * `demo_wallet` row), else the PAYPAL_DEMO_VAULT_TOKEN setting. A daily check reads the token from PayPal; if PayPal
 * no longer has it, new workspaces are created without it and offer PayPal's own page instead. It is never attached
 * outside a demo workspace.
 */
import { config } from "../config.js";
import { getDb, withWorkspace } from "../db.js";
import { paypal } from "../paypal/index.js";

export interface Wallet {
  tokenId: string;
  payer: string;
  source: "re-approved" | "setting";
  status: "ok" | "missing" | "unchecked" | "error";
  checkedAt: Date | null;
  detail: string | null;
}

interface Row {
  payment_token_id: string | null;
  payer_email: string | null;
  status: string;
  detail: string | null;
  checked_at: Date | null;
  source: string;
}

async function row(): Promise<Row | null> {
  const db = await getDb();
  return withWorkspace(null, async () => (await db.query<Row>("SELECT * FROM demo_wallet WHERE id = 'main'")).rows[0] ?? null);
}

/** The wallet as configured, healthy or not. Null when none is configured. */
export async function walletInfo(): Promise<Wallet | null> {
  const r = await row();
  const reapproved = r?.source === "re-approved" && r.payment_token_id;
  const tokenId = reapproved ? r!.payment_token_id! : config.demo.vaultToken;
  if (!tokenId) return null;
  // A check result only applies to the token it checked.
  const checkedSame = r && r.payment_token_id === tokenId;
  return {
    tokenId,
    payer: (reapproved ? r!.payer_email : config.demo.vaultPayer) || r?.payer_email || "",
    source: reapproved ? "re-approved" : "setting",
    status: checkedSame ? (r!.status as Wallet["status"]) : "unchecked",
    checkedAt: checkedSame ? r!.checked_at : null,
    detail: checkedSame ? r!.detail : null,
  };
}

/** The wallet a new workspace may use: configured and not known to be gone. */
export async function usableWallet(): Promise<Wallet | null> {
  const w = await walletInfo();
  return w && w.status !== "missing" ? w : null;
}

/** Daily job: ask PayPal whether the token still exists. */
export async function checkWallet(): Promise<Wallet | null> {
  const w = await walletInfo();
  if (!w) return null;
  let status: Wallet["status"] = "ok";
  let detail: string | null = null;
  let payer = w.payer;
  try {
    const t = await paypal().getPaymentToken(w.tokenId);
    if (!t) {
      status = "missing";
      detail = "PayPal no longer has this saved wallet. Re-approve it on /admin/paypal/wallet; until then judges use PayPal's own page.";
    } else if (t.payerEmail) payer = t.payerEmail;
  } catch (e) {
    status = "error";
    detail = `Could not read the saved wallet from PayPal: ${(e as Error).message.slice(0, 200)}`;
  }
  const db = await getDb();
  await withWorkspace(null, () =>
    db.query(
      `INSERT INTO demo_wallet (id, payment_token_id, payer_email, source, status, detail, checked_at, updated_at) VALUES ('main',$1,$2,$3,$4,$5,now(),now())
       ON CONFLICT (id) DO UPDATE SET payment_token_id = EXCLUDED.payment_token_id, payer_email = EXCLUDED.payer_email, source = EXCLUDED.source, status = EXCLUDED.status, detail = EXCLUDED.detail, checked_at = now(), updated_at = now()`,
      [w.tokenId, payer, w.source, status, detail],
    ),
  );
  return walletInfo();
}

/** Admin re-approval, step 1: a Vault setup token for the sandbox buyer to approve on PayPal. */
export async function startReapproval(returnUrl: string, cancelUrl: string): Promise<string> {
  const st = await paypal().createSetupToken({ returnUrl, cancelUrl, description: "StockSure demo wallet: holds for judges' demo orders (sandbox)" }, `demo-wallet-setup:${Date.now()}`);
  if (!st.approveUrl) throw new Error("PayPal did not return an approval link");
  const db = await getDb();
  await withWorkspace(null, () =>
    db.query("INSERT INTO demo_wallet (id, pending_setup_token, updated_at) VALUES ('main',$1,now()) ON CONFLICT (id) DO UPDATE SET pending_setup_token = EXCLUDED.pending_setup_token, updated_at = now()", [st.id]),
  );
  return st.approveUrl;
}

/** Admin re-approval, step 2: exchange the approved setup token for a payment token and store it. */
export async function finishReapproval(setupTokenId: string): Promise<Wallet> {
  const r = await row();
  if (!r?.pending_setup_token || r.pending_setup_token !== setupTokenId) throw new Error("That approval does not match the one this page started. Start again.");
  const t = await paypal().createPaymentToken(setupTokenId, `demo-wallet-token:${setupTokenId}`);
  const db = await getDb();
  await withWorkspace(null, () =>
    db.query("UPDATE demo_wallet SET payment_token_id = $1, payer_email = $2, source = 're-approved', status = 'ok', detail = NULL, checked_at = now(), pending_setup_token = NULL, updated_at = now() WHERE id = 'main'", [t.id, t.payerEmail ?? null]),
  );
  return (await walletInfo())!;
}
