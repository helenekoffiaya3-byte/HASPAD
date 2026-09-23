const axios = require("axios");
require("dotenv").config();

function createApi() {
  const {
    RESELLERS_API_URL,
    RESELLERS_API_USER,
    RESELLERS_API_PASSWORD
  } = process.env;

  if (!RESELLERS_API_URL || !RESELLERS_API_USER || !RESELLERS_API_PASSWORD) {
    throw new Error("Variables ResellersPanel manquantes.");
  }

  return axios.create({
    baseURL: RESELLERS_API_URL.replace(/\/$/, ""),
    auth: {
      username: RESELLERS_API_USER,
      password: RESELLERS_API_PASSWORD
    },
    headers: {
      Accept: "application/json"
    },
    timeout: 15000,
    validateStatus: () => true
  });
}

async function testApiConnection() {
  try {
    const response = await createApi().get("/");

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Authentification ResellersPanel refusée (HTTP ${response.status}). Vérifiez le nom du reseller, le mot de passe et l'activation de l'API.`
      );
    }

    if (response.status >= 500) {
      throw new Error(
        `Le serveur ResellersPanel a rencontré une erreur (HTTP ${response.status}).`
      );
    }

    console.log(
      `Serveur ResellersPanel joignable (HTTP ${response.status}).`
    );

    return {
      connected: true,
      status: response.status,
      data: response.data
    };
  } catch (error) {
    console.error(
      "Échec de la connexion à l'API ResellersPanel :",
      error.response?.data || error.message
    );
    throw error;
  }
}

// L'endpoint exact de commande doit être pris dans la documentation API
// fournie dans le Reseller Control Panel après activation de Reseller API.
// Ne pas inventer de route /v1/orders tant qu'elle n'est pas confirmée.
async function createHostingPlan() {
  throw new Error(
    "Endpoint de provisioning ResellersPanel non configuré : utilisez la documentation officielle de l'API fournie dans le Reseller Control Panel."
  );
}

module.exports = {
  testApiConnection,
  createHostingPlan
};
