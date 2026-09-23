const axios = require("axios");
require("dotenv").config();

function createApi() {
  const { RESELLERS_API_URL, RESELLERS_API_USER, RESELLERS_API_PASSWORD } = process.env;
  if (!RESELLERS_API_URL || !RESELLERS_API_USER || !RESELLERS_API_PASSWORD) {
    throw new Error("Variables ResellersPanel manquantes.");
  }
  return axios.create({
    baseURL: RESELLERS_API_URL,
    auth: { username: RESELLERS_API_USER, password: RESELLERS_API_PASSWORD },
    headers: { "Content-Type": "application/json" },
    timeout: 15000
  });
}

async function testApiConnection() {
  try {
    const response = await createApi().get("/v1/account");
    console.log("Connexion API ResellersPanel réussie.");
    return response.data;
  } catch (error) {
    console.error("Échec de la connexion à l'API ResellersPanel :", error.response?.data || error.message);
    throw error;
  }
}

async function createHostingPlan(customerInfo, domainName) {
  if (!customerInfo?.email || !domainName) {
    throw new Error("Informations client ou domaine manquantes.");
  }
  try {
    const response = await createApi().post("/v1/orders", {
      plan: process.env.RESELLERS_HOSTING_PLAN || "cloud_starter",
      domain: domainName,
      customer: {
        email: customerInfo.email,
        name: customerInfo.fullName || "Utilisateur"
      }
    });
    return response.data;
  } catch (error) {
    console.error("Erreur lors du provisioning de l'hébergement :", error.response?.data || error.message);
    throw error;
  }
}

module.exports = { testApiConnection, createHostingPlan };
