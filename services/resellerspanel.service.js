const axios = require("axios");

const api = axios.create({
  baseURL: process.env.RESELLERS_API_URL,
  auth: {
    username: process.env.RESELLERS_API_USER,
    password: process.env.RESELLERS_API_PASSWORD
  },
  headers: { "Content-Type": "application/json" },
  timeout: 15000
});

async function testConnection() {
  try {
    await api.get("/v1/account");
    return { success: true };
  } catch (error) {
    console.error("Resellers Panel API error:", error.response?.data || error.message);
    return { success: false };
  }
}

async function createHostingAccount(userData, siteData) {
  if (!userData?.email || !siteData?.subdomain) {
    throw new Error("Données utilisateur/site invalides.");
  }

  try {
    const response = await api.post("/v1/orders", {
      plan: process.env.RESELLERS_HOSTING_PLAN || "cloud_starter",
      domain: process.env.HASPAD_HOSTING_DOMAIN
        ? `${siteData.subdomain}.${process.env.HASPAD_HOSTING_DOMAIN}`
        : siteData.subdomain,
      customer: {
        email: userData.email,
        name: userData.fullName || "Utilisateur"
      }
    });

    return { success: true, data: response.data };
  } catch (error) {
    console.error("Resellers Panel provisioning error:", error.response?.data || error.message);
    throw new Error("Échec du provisioning de l'hébergement.");
  }
}

module.exports = { testConnection, createHostingAccount };
