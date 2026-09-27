import { json } from "./_credits.js";
import { paydunyaConfirm, verifyPaydunyaHash, applyAcceptedPayment } from "./_paydunya.js";

function parseForm(body) {
  const params = new URLSearchParams(body || "");
  const raw = params.get("data");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function handler(event) {
  if (event.httpMethod === "GET") return json(200, { ok: true, service: "paydunya-callback" });
  if (event.httpMethod !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  try {
    const data = parseForm(event.body);
    if (!data || !verifyPaydunyaHash(data.hash)) return json(401, { error: "INVALID_CALLBACK_SIGNATURE" });
    const token = data.invoice?.token || data.token;
    const paymentId = data.invoice?.custom_data?.payment_id || data.custom_data?.payment_id;
    if (!token || !paymentId) return json(400, { error: "MISSING_PAYMENT_REFERENCE" });
    const confirmation = await paydunyaConfirm(token);
    if (confirmation.invoice?.custom_data?.payment_id !== paymentId) return json(400, { error: "PAYMENT_REFERENCE_MISMATCH" });
    const result = await applyAcceptedPayment(paymentId, confirmation);
    return json(200, { ok: true, status: confirmation.invoice?.status, ...result });
  } catch {
    return json(503, { error: "CALLBACK_PROCESSING_PENDING" });
  }
}
