import { json } from "./_credits.js";

// Ancien endpoint de déploiement Git. Le flux canonique est
// /api/deployment-analyze -> /api/deployment-trigger.
// On le bloque pour empêcher tout contournement du préflight et du cycle de crédits.
export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });
  return json(410, {
    error: "GIT_DEPLOY_ENDPOINT_DEPRECATED",
    message: "Utilisez le flux sécurisé d'analyse puis de déploiement HASPAD."
  });
};
