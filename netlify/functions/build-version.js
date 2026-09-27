import { admin, json, authenticatedUser } from "./_credits.js";
import { getLatestBuild } from "./_builds.js";

export default async (req) => {
  if (req.method !== "GET") return json(405, { error: "Method Not Allowed" });

  const user = await authenticatedUser(req);
  if (!user) return json(401, { error: "Unauthorized" });

  const url = new URL(req.url);
  const siteId = url.searchParams.get("siteId");
  if (!/^[0-9a-f-]{36}$/i.test(siteId || "")) {
    return json(400, { error: "siteId invalide." });
  }

  const { data: site, error: siteError } = await admin
    .from("sites")
    .select("id")
    .eq("id", siteId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (siteError) return json(500, { error: "Vérification du projet impossible." });
  if (!site) return json(403, { error: "Accès non autorisé à ce projet." });

  try {
    const build = await getLatestBuild(siteId);
    return json(200, { build });
  } catch (error) {
    console.error("build-version:", error);
    return json(500, { error: "Impossible de récupérer la version." });
  }
};
