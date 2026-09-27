import crypto from "crypto";
import { admin, json, authenticatedUser } from "./_credits.js";

const CINETPAY_URL = "https://api-checkout.cinetpay.com/v2/payment";
const EXTENSIONS = new Set([".com", ".io", ".fr", ".ci"]);
const validSubdomain = (v) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v);

function transactionId() {
  return "DOM" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(6).toString("hex").toUpperCase();
}

async function rdapAvailable(domain) {
  const response = await fetch("https://rdap.org/domain/" + encodeURIComponent(domain), {
    headers: { accept: "application/rdap+json", "user-agent": "HASP​AD/1.0".replace("\u200b", "") }
  });
  if (response.status === 404) return true;
  if (response.ok) return false;
  throw new Error("RDAP_UNAVAILABLE");
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  const user = await authenticatedUser(req);
  if (!user) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(req.body || "{}"); } catch { return json(400, { error: "JSON invalide." }); }

  const projectId = String(body.projectId || "").trim();
  const subdomain = String(body.subdomain || "").trim().toLowerCase();
  const extension = String(body.domainExtension || "").trim().toLowerCase();

  if (!projectId || !validSubdomain(subdomain) || !EXTENSIONS.has(extension)) {
    return json(400, { error: "Données de domaine invalides." });
  }

  const { data: membership, error: membershipError } = await admin
    .from("site_members")
    .select("site_id,role")
    .eq("site_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError || !membership) return json(403, { error: "Projet inaccessible." });

  const domain = subdomain + extension;

  const { data: pricing, error: pricingError } = await admin
    .from("tld_pricing")
    .select("extension,registration_price,renewal_price,currency")
    .eq("extension", extension)
    .eq("is_active", true)
    .maybeSingle();

  if (pricingError || !pricing) return json(400, { error: "Extension non disponible." });
  if (pricing.currency !== "XOF") return json(503, { error: "Cette passerelle ne prend actuellement en charge que le XOF." });
  if (!Number.isInteger(pricing.registration_price) || pricing.registration_price < 5 || pricing.registration_price % 5 !== 0) {
    return json(503, { error: "Tarif de domaine invalide côté serveur." });
  }

  try {
    if (!(await rdapAvailable(domain))) return json(409, { error: "Ce domaine n'est plus disponible." });
  } catch {
    return json(503, { error: "Impossible de confirmer la disponibilité du domaine." });
  }

  const { data: existing, error: existingError } = await admin
    .from("project_domains")
    .select("*")
    .eq("full_domain", domain)
    .maybeSingle();

  if (existingError) return json(503, { error: "Impossible de vérifier la commande du domaine." });

  if (existing && existing.user_id !== user.id) return json(409, { error: "Ce domaine est déjà réservé." });

  if (existing && (existing.payment_status === "accepted" || existing.status === "active")) {
    return json(409, { error: "Ce domaine est déjà acheté ou actif." });
  }

  if (existing?.payment_status === "pending" && existing.payment_url && existing.transaction_id) {
    return json(200, {
      paymentUrl: existing.payment_url,
      transactionId: existing.transaction_id,
      domain,
      amount: existing.registration_price,
      currency: existing.currency
    });
  }

  if (!process.env.CINETPAY_API_KEY || !process.env.CINETPAY_SITE_ID) {
    return json(503, { error: "CinetPay n'est pas encore configuré." });
  }

  if (process.env.DOMAIN_PURCHASE_ENABLED !== "true") {
    return json(503, { error: "L'achat de domaines est verrouillé jusqu'à la configuration du registrar." });
  }

  if (!process.env.DOMAIN_REGISTRAR) {
    return json(503, { error: "Aucun registrar n'est configuré." });
  }

  const txId = transactionId();
  const appUrl = process.env.PUBLIC_SITE_URL || "https://haspad.com";
  const notifyUrl = process.env.CINETPAY_DOMAIN_NOTIFY_URL || "https://api.haspad.com/cinetpay-domain-notify";

  const { data: profile } = await admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const parts = String(profile?.full_name || "Client HASPAD").trim().split(/\s+/);
  const customerName = parts.shift() || "Client";
  const customerSurname = parts.join(" ") || "HASPAD";

  const rowPayload = {
    project_id: projectId,
    user_id: user.id,
    subdomain,
    domain_extension: extension,
    is_primary: true,
    status: "pending_dns",
    transaction_id: txId,
    registration_price: pricing.registration_price,
    renewal_price: pricing.renewal_price,
    currency: pricing.currency,
    payment_status: "pending",
    registrar_status: "not_started",
    payment_url: null
  };

  let domainRow;
  if (existing) {
    const { data, error } = await admin
      .from("project_domains")
      .update(rowPayload)
      .eq("id", existing.id)
      .eq("user_id", user.id)
      .select("id,project_id,full_domain,transaction_id,registration_price,renewal_price,currency,payment_status,registrar_status")
      .single();
    if (error) return json(500, { error: "Impossible de préparer la commande de domaine." });
    domainRow = data;
  } else {
    const { data, error } = await admin
      .from("project_domains")
      .insert(rowPayload)
      .select("id,project_id,full_domain,transaction_id,registration_price,renewal_price,currency,payment_status,registrar_status")
      .single();
    if (error?.code === "23505") return json(409, { error: "Ce domaine vient d'être réservé. Réessayez." });
    if (error) return json(500, { error: "Impossible de préparer la commande de domaine." });
    domainRow = data;
  }

  const payload = {
    apikey: process.env.CINETPAY_API_KEY,
    site_id: process.env.CINETPAY_SITE_ID,
    transaction_id: txId,
    amount: pricing.registration_price,
    currency: pricing.currency,
    description: "Achat domaine " + domain,
    notify_url: notifyUrl,
    return_url: appUrl + "/dashboard?domain_payment=" + encodeURIComponent(txId),
    channels: "ALL",
    lang: "FR",
    metadata: JSON.stringify({ domain_id: domainRow.id, user_id: user.id, project_id: projectId, domain }),
    customer_name: customerName,
    customer_surname: customerSurname,
    customer_email: user.email
  };

  try {
    const response = await fetch(CINETPAY_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "HASPAD/1.0" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok || result.code !== "201" || !result.data?.payment_url) {
      await admin.from("project_domains").update({
        payment_status: "error",
        registrar_status: "not_started"
      }).eq("id", domainRow.id);
      return json(502, { error: "CinetPay n'a pas pu initialiser le paiement du domaine." });
    }

    await admin.from("project_domains").update({
      payment_url: result.data.payment_url,
      payment_status: "pending"
    }).eq("id", domainRow.id);

    return json(200, {
      paymentUrl: result.data.payment_url,
      transactionId: txId,
      domain,
      amount: pricing.registration_price,
      currency: pricing.currency
    });
  } catch {
    await admin.from("project_domains").update({ payment_status: "error" }).eq("id", domainRow.id);
    return json(502, { error: "Service de paiement temporairement indisponible." });
  }
};
