import {admin,json} from "./_credits.js";

export default async (req) => {
  if (req.method !== "GET") return json(405, { error: "Method Not Allowed" });
  const { data, error } = await admin
    .from("tld_pricing")
    .select("extension,registration_price,renewal_price,currency")
    .eq("is_active", true)
    .order("extension");
  if (error) return json(503, { error: "Tarification des domaines indisponible." });
  return json(200, { pricing: data || [] });
};
