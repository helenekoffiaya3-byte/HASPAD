import { authenticatedUser, admin, json } from "./_credits.js";
import { paydunyaConfirm, applyAcceptedPayment } from "./_paydunya.js";

export default async function handler(req) {
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  const user = await authenticatedUser(req);
  if (!user) return json(401, { error: "UNAUTHORIZED" });
  let body;
  try { body = await req.json(); } catch { return json(400, { error: "INVALID_JSON" }); }
  const token = String(body.token || "");
  if (!token) return json(400, { error: "TOKEN_REQUIRED" });
  try {
    const { data: rows, error } = await admin.from("payment_transactions")
      .select("id,user_id,amount_xof,credits,status,processed_at,provider_response")
      .eq("user_id", user.id).eq("provider", "paydunya").eq("provider_response->>token", token)
      .order("created_at", { ascending: false }).limit(1);
    if (error) throw error;
    const payment = rows?.[0];
    if (!payment) return json(404, { error: "PAYMENT_NOT_FOUND" });
    const confirmation = await paydunyaConfirm(token);
    const result = await applyAcceptedPayment(payment.id, confirmation);
    return json(200, { success: true, status: confirmation.invoice?.status, ...result });
  } catch {
    return json(503, { error: "PAYMENT_VERIFICATION_PENDING" });
  }
}
