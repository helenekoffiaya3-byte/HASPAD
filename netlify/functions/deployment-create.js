import { json } from "./_credits.js";

// Ancien point d'entrée générique. Le seul flux de déploiement autorisé
// est désormais deployment-analyze -> signed preflight -> deployment-trigger.
// Les déploiements conteneurisés auront un gate dédié avant toute consommation.
export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });
  return json(410, {
    error: "DEPLOYMENT_CREATE_DEPRECATED",
    message: "Utilisez le flux HASPAD prévalidé. Aucun crédit n'est débité par cet endpoint."
  });
};
