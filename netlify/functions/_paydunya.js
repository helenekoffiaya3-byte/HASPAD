import crypto from "node:crypto";
import { admin } from "./_credits.js";

export const PAYDUNYA_API_BASE = String(process.env.PAYDUNYA_MODE || "production").toLowerCase() === "sandbox"
  ? "https://app.paydunya.com/sandbox-api/v1"
  : "https://app.paydunya.com/api/v1";

export function paydunyaConfig() {
  const master = process.env.PAYDUNYA_MASTER_KEY;
  const privateKey = process.env.PAYDUNYA_PRIVATE_KEY;
  const token = process.env.PAYDUNYA_TOKEN;
  if (!master || !privateKey || !token) throw new Error("PAYDUNYA_NOT_CONFIGURED");
  return { master, privateKey, token };
}

export function paydunyaHeaders() {
  const { master, privateKey, token } = paydunyaConfig();
  return { "content-type": "application/json", "PAYDUNYA-MASTER-KEY": master, "PAYDUNYA-PRIVATE-KEY": privateKey, "PAYDUNYA-TOKEN": token };
}

export async function paydunyaCreateInvoice({ amount, planType, paymentId, user }) {
  const appUrl = process.env.PUBLIC_SITE_URL || "https://haspad.com";
  const callbackUrl = process.env.PAYDUNYA_CALLBACK_URL || appUrl + "/api/paydunya-callback";
  const returnUrl = appUrl + "/dashboard.html?payment=return";
  const response = await fetch(PAYDUNYA_API_BASE + "/checkout-invoice/create", {
    method: "POST", headers: paydunyaHeaders(), body: JSON.stringify({
      invoice: { total_amount: amount, description: "HASPAD " + planType + " — " + amount + " XOF" },
      store: { name: "HASPAD.com", tagline: "Création et déploiement de sites", website_url: appUrl },
      custom_data: { payment_id: paymentId, user_id: user.id, plan_type: planType },
      actions: { callback_url: callbackUrl, return_url: returnUrl },
      customer: { name: user.netlifyUser?.userMetadata?.full_name || user.email || "Client HASPAD", email: user.email || "" }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.response_code !== "00" || !data.token || !data.response_text) throw new Error("PAYDUNYA_CREATE_FAILED");
  return { token: data.token, paymentUrl: data.response_text, raw: data };
}

export async function paydunyaConfirm(token) {
  if (!token || !/^[A-Za-z0-9._-]{4,200}$/.test(token)) throw new Error("INVALID_PAYDUNYA_TOKEN");
  const response = await fetch(PAYDUNYA_API_BASE + "/checkout-invoice/confirm/" + encodeURIComponent(token), { headers: paydunyaHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.response_code !== "00") throw new Error("PAYDUNYA_CONFIRM_FAILED");
  return data;
}

export function verifyPaydunyaHash(hash) {
  if (typeof hash !== "string" || !hash) return false;
  const expected = crypto.createHash("sha512").update(paydunyaConfig().master, "utf8").digest("hex");
  const a = Buffer.from(hash, "utf8"), b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function applyAcceptedPayment(paymentId, confirmation) {
  const invoice = confirmation?.invoice || {};
  const status = String(invoice.status || "").toLowerCase();
  if (status !== "completed") return { applied: false, status };
  const amount = Number(invoice.total_amount);
  const { data: payment, error: findError } = await admin.from("payment_transactions").select("id,user_id,plan_type,amount_xof,credits,status,processed_at").eq("id", paymentId).maybeSingle();
  if (findError) throw findError;
  if (!payment) throw new Error("PAYMENT_NOT_FOUND");
  if (!Number.isInteger(amount) || amount !== payment.amount_xof) throw new Error("PAYDUNYA_AMOUNT_MISMATCH");
  if (payment.processed_at) return { applied: true, alreadyProcessed: true };
  const { error: updateError } = await admin.from("payment_transactions").update({ status: "accepted", provider: "paydunya", provider_response: confirmation, updated_at: new Date().toISOString() }).eq("id", payment.id).eq("status", "pending");
  if (updateError) throw updateError;
  const { data: balance, error: creditError } = await admin.rpc("apply_payment_credits", { p_payment_id: payment.id });
  if (creditError) throw creditError;
  return { applied: true, balance };
}
