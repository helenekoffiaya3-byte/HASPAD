import { admin, json, authenticatedUser } from "./_credits.js";

const CHECK_URL = "https://api-checkout.cinetpay.com/v2/payment/check";

async function checkPayment(transactionId) {
  const response = await fetch(CHECK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "HASPAD/1.0" },
    body: JSON.stringify({
      apikey: process.env.CINETPAY_API_KEY,
      site_id: process.env.CINETPAY_SITE_ID,
      transaction_id: transactionId
    })
  });
  return response.json();
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  const user = await authenticatedUser(req);
  if (!user) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(req.body || "{}"); } catch { return json(400, { error: "JSON invalide." }); }

  const transactionId = String(body.transactionId || "").trim();
  if (!transactionId) return json(400, { error: "transactionId requis." });

  const { data: payment, error } = await admin
    .from("payment_transactions")
    .select("*")
    .eq("transaction_id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !payment) return json(404, { error: "Transaction introuvable." });
  if (payment.status === "accepted" && payment.processed_at) {
    return json(200, { success: true, status: "accepted", alreadyProcessed: true });
  }

  const result = await checkPayment(transactionId);
  const status = result?.data?.status || "UNKNOWN";
  const accepted = result?.code === "00" && status === "ACCEPTED";

  if (!accepted) {
    return json(200, { success: false, status });
  }

  const amount = Number(result?.data?.amount);
  if (!Number.isInteger(amount) || amount !== payment.amount_xof) {
    await admin.from("payment_transactions").update({
      status: "error",
      provider_response: { verification: result, reason: "amount_mismatch" },
      updated_at: new Date().toISOString()
    }).eq("id", payment.id);
    return json(409, { error: "Montant du paiement invalide." });
  }

  const { error: markAcceptedError } = await admin.from("payment_transactions").update({\n    status: "accepted",\n    provider_response: result,\n    updated_at: new Date().toISOString()\n  }).eq("id", payment.id).eq("status", "pending");\n\n  if (markAcceptedError) {\n    console.error("HASPAD payment status update error:", markAcceptedError);\n    return json(503, { error: "Paiement validé, confirmation en cours." });\n  }\n\n  const { error: creditError } = await admin.rpc("apply_payment_credits", {
    p_payment_id: payment.id
  });

  if (creditError) {
    console.error("HASPAD payment fulfillment error:", creditError);
    return json(503, { error: "Paiement validé, attribution des crédits en cours." });
  }

  const { data: updated } = await admin
    .from("payment_transactions")
    .select("status,credits,processed_at")
    .eq("id", payment.id)
    .single();

  return json(200, {
    success: updated?.status === "accepted",
    status: updated?.status || "accepted",
    creditsAdded: updated?.credits || 0,
    processedAt: updated?.processed_at || null
  });
};
