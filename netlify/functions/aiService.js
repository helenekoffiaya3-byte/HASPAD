import { GoogleGenAI } from "@google/genai";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-pro-preview";

const BLUEPRINT_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["CREATE_OR_UPDATE_PAGE", "UPDATE_COMPONENTS"] },
    metadata: {
      type: "object",
      properties: {
        page_slug: { type: "string" },
        page_title: { type: "string" }
      },
      required: ["page_slug", "page_title"]
    },
    components: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: ["section", "heading", "text", "button", "card", "input", "image", "form", "nav", "footer"]
          },
          properties: {
            type: "object",
            properties: {
              label: { type: "string" },
              className: { type: "string" },
              text: { type: "string" },
              href: { type: "string" },
              src: { type: "string" },
              alt: { type: "string" }
            }
          }
        },
        required: ["id", "type", "properties"]
      }
    }
  },
  required: ["action", "metadata", "components"]
};

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateProjectBlueprint(userPrompt, currentSchemaState) {
  if (!process.env.GEMINI_API_KEY) {
    return { success: false, error: "GEMINI_API_KEY non configurée." };
  }

  const prompt = [
    "Tu es l'architecte IA de HASPAD.",
    "Ta sortie est un Blueprint JSON destiné à être validé puis appliqué par le backend HASPAD.",
    "Tu ne dois jamais produire de SQL, DDL, commandes shell, secrets ou instructions d'accès à une base.",
    "Ne modifie que la structure d'interface représentée par le Blueprint.",
    "Utilise uniquement les types de composants autorisés par le schéma.",
    "État actuel du projet :",
    JSON.stringify(currentSchemaState),
    "Demande utilisateur :",
    String(userPrompt).slice(0, 12000)
  ].join("\n\n");

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: BLUEPRINT_SCHEMA,
        temperature: 0.2,
        thinkingConfig: { thinkingLevel: "low" }
      }
    });

    const text = response.text;
    if (!text) throw new Error("EMPTY_GEMINI_RESPONSE");

    const blueprint = JSON.parse(text);
    return { success: true, blueprint, model: MODEL };
  } catch (error) {
    console.error("Gemini blueprint generation:", error);
    return { success: false, error: "Échec de la génération du Blueprint IA." };
  }
}
