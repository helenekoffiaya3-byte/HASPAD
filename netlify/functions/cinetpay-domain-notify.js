import crypto from "crypto";
import { admin, json } from "./_credits.js";

const CHECK_URL = "https://api-checkout.cinetpay.com/v2/payment/check";

function bodyData(req) {
  const raw = req.body || "";
  const contentType = String(req.headers["content-type"] || "");
  if (contentType.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch { return {}; }
}

function verifyHmac(data, received) {
  const secret = process.env.CINETPAY_SECRET_KEY;
  if (!secret || !received) return false;
  const ordered = [
    "cpm_site_id","cpm_trans_id","cpm_trans_date","cpm_amount","cpm_currency",
    "signature","payment_method","cel_phone_num","cpm_phone_prefixe",
    "cpm_language","cpm_version","cpm_payment_config","cpm_page_action",
    "cpm_custom","cpm_designation","cpm_error_message"
  ].map((key) => data[key] ?? "").join("");
  const expected = crypto.createHmac("sha256", secret).update(ordered).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(received));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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
  if (!response.ok) throw new Error("CinetPay check HTTP " + response.status);
  return response.json();
}

async function provisionDomain(domainRow) {
  const registrar = String(process.env.DOMAIN_REGISTRAR || "").toLowerCase();
  if (!registrar) throw new Error("REGISTRAR_NOT_CONFIGURED");
  throw new Error("REGISTRAR_ADAPTER_NOT_CONFIGURED:" + registrar);
}

export default async (req) => {
  if (req.method === "GET") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  if (!process.env.CINETPAY_API_KEY || !process.env.CINETPAY_SITE_ID || !process.env.CINETPAY_SECRET_KEY) {
    return json(503, { error: "CinetPay webhook non configuré." });
  }

  const data = bodyData(req);
  const tx = String(data.cpm_trans_id || "").trim();
  if (!tx) return json(400, { error: "transaction_id manquant." });
  if (!verifyHmac(data, req.headers["x-token"])) return json(401, { error: "Notification HMAC invalide." });

  const { data: domainRow, error: lookupError } = await admin
    .from("project_domains")
    .select("*")
    .eq("transaction_id", tx)
    .maybeSingle();

  if (lookupError || !domainRow) return json(200, { ok: true });

  if (domainRow.payment_status === "accepted" && domainRow.registrar_status === "active") {
    return json(200, { ok: true, alreadyProcessed: true });
  }

  try {
    const result = await checkPayment(tx);
    const status = result?.data?.status || "UNKNOWN";
    const accepted = result?.code === "00" && status === "ACCEPTED";

    if (!accepted) {
      const next = ["REFUSED", "CANCELLED"].includes(status) ? "refused" : "pending";
      await admin.from("project_domains").update({ payment_status: next }).eq("id", domainRow.id);
      return json(200, { ok: true, status: next });
    }

    const amount = Number(result?.data?.amount);
    const currency = String(result?.data?.currency || "").toUpperCase();
    if (!Number.isInteger(amount) || amount !== domainRow.registration_price || currency !== domainRow.currency) {
      await admin.from("project_domains").update({ payment_status: "error", registrar_status: "failed" }).eq("id", domainRow.id);
      return json(200, { ok: true, status: "amount_or_currency_mismatch" });
    }

    if (domainRow.payment_status !== "accepted") {
      const { error } = await admin.from("project_domains")
        .update({ payment_status: "accepted", registrar_status: "provisioning" })
        .eq("id", domainRow.id)
        .neq("payment_status", "accepted");
      if (error) return json(503, { ok: false });
    }

    try {
      const registrarResult = await provisionDomain(domainRow);
      await admin.from("project_domains").update({
        status: "active",
        registrar_status: "active",
        registrar_reference: registrarResult?.reference || null,
        registered_at: new Date().toISOString()
      }).eq("id", domainRow.id);
      return json(200, { ok: true, status: "active" });
    } catch (error) {
      console.error("HASPAD domain provisioning error:", error);
      await admin.from("project_domains").update({
        payment_status: "accepted",
        registrar_status: "failed"
      }).eq("id", domainRow.id);
      return json(200, { ok: true, status: "payment_accepted_provisioning_pending" });
    }
  } catch (error) {
    console.error("HASPAD domain notification error:", error);
    return json(503, { ok: false });
  }
};
