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

const FRONTEND_FILES_SCHEMA = {
  type: "object",
  properties: {
    projectName: { type: "string" },
    framework: { type: "string" },
    pages: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          title: { type: "string" },
          route: { type: "string" }
        },
        required: ["path", "title", "route"]
      }
    },
    files: {
      type: "array",
      maxItems: 160,
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          purpose: { type: "string" }
        },
        required: ["path", "content", "purpose"]
      }
    },
    notes: {
      type: "array",
      items: { type: "string" },
      maxItems: 30
    }
  },
  required: ["projectName", "framework", "pages", "files", "notes"]
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

export async function generateFrontendFiles({ repository, branch, snapshot, databaseSchema }) {
  if (!process.env.GEMINI_API_KEY) {
    return { success: false, error: "GEMINI_API_KEY non configurée." };
  }

  const prompt = [
    "Tu es Gemini, l'agent FRONTEND PRINCIPAL de HASPAD.",
    "Ta responsabilité est de CONSTRUIRE ET MAINTENIR TOUTES LES PAGES FRONTEND du projet avant chaque déploiement.",
    "Tu dois inspecter l'état fourni puis produire les fichiers frontend complets à écrire dans le dépôt.",
    "Ne te limite pas à un audit, ne renvoie pas seulement des recommandations : génère le contenu complet des fichiers.",
    "Construis toutes les pages utilisateur nécessaires présentes ou attendues dans le projet, ainsi que leurs CSS et JavaScript frontend associés.",
    "Pour HASPAD, les pages principales sont notamment dashboard, editor, domains, billing, deploy, git, control-center et settings lorsqu'elles existent dans le dépôt.",
    "Préserve les routes et contrats backend existants. Les appels /api/* déjà utilisés par le frontend doivent rester compatibles.",
    "La page deploy doit conserver les champs Nom, Commande, Branche et le bouton Deploy; la commande reste en lecture seule et vient de ChatGPT.",
    "Ne construis PAS le backend : Claude est responsable du backend.",
    "Ne produis aucun secret, SQL, DDL, shell, credential, fichier .env ou chemin absolu.",
    "Retourne uniquement le JSON conforme au schéma. Chaque fichier retourné doit contenir son contenu COMPLET.",
    "N'écrase pas les fichiers non-frontends.",
    "Dépôt : " + repository,
    "Branche : " + branch,
    "Snapshot frontend actuel :",
    JSON.stringify(snapshot),
    "État éditorial/DB frontend disponible :",
    JSON.stringify(databaseSchema)
  ].join("\n\n");

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: FRONTEND_FILES_SCHEMA,
        temperature: 0.15,
        thinkingConfig: { thinkingLevel: "medium" }
      }
    });

    const text = response.text;
    if (!text) throw new Error("EMPTY_GEMINI_FRONTEND_RESPONSE");
    const result = JSON.parse(text);

    if (!Array.isArray(result.files) || !Array.isArray(result.pages)) {
      throw new Error("INVALID_GEMINI_FRONTEND_MANIFEST");
    }

    const files = {};
    let totalBytes = 0;
    for (const item of result.files) {
      const path = String(item.path || "").trim();
      const content = String(item.content ?? "");
      if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\") ||
          path.includes(".env") || !/^public\\/(?:[^\\/]+(?:\\/[^\\/]+)*)$/.test(path)) {
        throw new Error("INVALID_GEMINI_FRONTEND_PATH");
      }
      if (!/\.(?:html|css|js|mjs|json|svg)$/i.test(path)) {
        throw new Error("GEMINI_FRONTEND_FILE_TYPE_NOT_ALLOWED");
      }
      totalBytes += Buffer.byteLength(content, "utf8");
      if (totalBytes > 2_000_000) throw new Error("GEMINI_FRONTEND_OUTPUT_TOO_LARGE");
      files[path] = content;
    }

    return { success: true, model: MODEL, projectName: result.projectName, framework: result.framework, pages: result.pages, files, notes: result.notes || [] };
  } catch (error) {
    console.error("Gemini frontend generation:", error);
    return { success: false, error: error?.message || "Échec de la construction frontend Gemini." };
  }
}
