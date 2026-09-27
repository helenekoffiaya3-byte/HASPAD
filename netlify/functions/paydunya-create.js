import crypto from "node:crypto";
import { authenticatedUser, admin, getPlan, json } from "./_credits.js";
import { paydunyaCreateInvoice } from "./_paydunya.js";

export default async function handler(req) {
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  const user = await authenticatedUser(event);
  if (!user) return json(401, { error: "UNAUTHORIZED" });
  let body;
  try { body = await req.json(); } catch { return json(400, { error: "INVALID_JSON" }); }
  const plan = getPlan(body.planType);
  if (!plan) return json(400, { error: "INVALID_PLAN_OR_PRICE_NOT_CONFIGURED" });
  try {
    const paymentId = crypto.randomUUID();
    const transactionId = "HASP​AD-" + Date.now() + "-" + crypto.randomBytes(6).toString("hex");
    const { error: insertError } = await admin.from("payment_transactions").insert({
      id: paymentId, user_id: user.id, transaction_id: transactionId, provider: "paydunya",
      plan_type: plan.type, amount_xof: plan.amount, credits: plan.credits, status: "pending"
    });
    if (insertError) throw insertError;
    const invoice = await paydunyaCreateInvoice({ amount: plan.amount, planType: plan.type, paymentId, user });
    const { error: updateError } = await admin.from("payment_transactions").update({
      payment_url: invoice.paymentUrl, provider_response: invoice.raw, updated_at: new Date().toISOString()
    }).eq("id", paymentId);
    if (updateError) throw updateError;
    return json(200, { success: true, paymentUrl: invoice.paymentUrl, token: invoice.token, transactionId });
  } catch (error) {
    return json(503, { error: error.message === "PAYDUNYA_NOT_CONFIGURED" ? "PayDunya n'est pas encore configuré sur le serveur." : "PAYMENT_INITIALIZATION_FAILED" });
  }
}
