import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { generateProjectBlueprint, generateFrontendFiles } from "./aiService.js";
import { githubConnection, pushFiles } from "./_github.js";

const env = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
const UUID = /^[0-9a-f-]{36}$/i;
const SAFE_COMMAND = /^[A-Za-z0-9_./:@%+?=,-]+(?:\s+[A-Za-z0-9_./:@%+?=,-]+)*$/;

async function netlify(url, options = {}) {
  const token = env("NETLIFY_AUTH_TOKEN");
  if (!token) throw new Error("NETLIFY_AUTH_TOKEN_NOT_CONFIGURED");
  const r = await fetch(url, { ...options, headers: {
    authorization: "Bearer " + token, accept: "application/json", "content-type": "application/json", ...(options.headers || {})
  }});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.message || d?.error || "NETLIFY_API_ERROR");
  return d;
}



async function githubRequest(path, token, options = {}) {
  const response = await fetch("https://api.github.com" + path, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: "Bearer " + token,
      "x-github-api-version": env("GITHUB_API_VERSION") || "2022-11-28",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || data?.error_description || "GITHUB_API_ERROR");
  return data;
}

async function loadFrontendSnapshot(userId, owner, name, branch) {
  const connection = await githubConnection(userId);
  if (!connection) throw new Error("GITHUB_NOT_CONNECTED");
  const tree = await githubRequest(
    "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name) +
    "/git/trees/" + encodeURIComponent(branch) + "?recursive=1",
    connection.token
  );
  const entries = Array.isArray(tree.tree) ? tree.tree : [];
  const allowed = /^(?:public\/)(?:[^/]+\/)*[^/]+\.(?:html|css|js|mjs|json|svg)$/i;
  const files = entries
    .filter(x => x.type === "blob" && allowed.test(String(x.path || "")))
    .slice(0, 160);
  const snapshot = [];
  for (const entry of files) {
    const data = await githubRequest(
      "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name) +
      "/contents/" + entry.path.split("/").map(encodeURIComponent).join("/") +
      "?ref=" + encodeURIComponent(branch),
      connection.token
    );
    const raw = data?.content ? Buffer.from(String(data.content).replace(/\s/g, ""), "base64").toString("utf8") : "";
    snapshot.push({ path: entry.path, content: raw.slice(0, 50000) });
  }
  return snapshot;
}

async function runThreeAgents({ user, buildId, siteId, owner, name, branch, command }) {
  const geminiKey = env("GEMINI_API_KEY");
  if (!geminiKey) throw new Error("GEMINI_GATEWAY_NOT_READY");

  const [{ data: pages }, { data: components }] = await Promise.all([
    admin.from("pages").select("slug,root_block,seo").eq("site_id", siteId).limit(100),
    admin.from("site_components").select("page_id,component_type,identifier,design_props,position_index").eq("site_id", siteId).limit(500)
  ]);

  const snapshot = await loadFrontendSnapshot(user.id, owner, name, branch);
  const gemini = await generateFrontendFiles({
    repository: owner + "/" + name,
    branch,
    snapshot,
    databaseSchema: { pages: pages || [], components: components || [] }
  });
  if (!gemini.success) throw new Error(gemini.error || "GEMINI_FRONTEND_BUILD_FAILED");

  const frontendFiles = gemini.files || {};
  if (Object.keys(frontendFiles).length) {
    await pushFiles(user.id, owner, name, branch, frontendFiles, "feat(haspad): Gemini builds all frontend pages");
  }

  await admin.from("ai_activity_logs").insert({
    site_id: siteId, agent_name: "gemini-frontend", action_taken: "DEPLOYMENT_FRONTEND_BUILD",
    details: {
      build_id: buildId,
      model: gemini.model,
      status: "PASS",
      page_count: Array.isArray(gemini.pages) ? gemini.pages.length : 0,
      file_count: Object.keys(frontendFiles).length
    }
  });

  const anthropicKey = env("ANTHROPIC_API_KEY");
  const anthropicBase = env("ANTHROPIC_BASE_URL");
  if (!anthropicKey || !anthropicBase) throw new Error("CLAUDE_GATEWAY_NOT_READY");
  const claudeClient = new Anthropic({ apiKey: anthropicKey, baseURL: anthropicBase });
  const claudeResponse = await claudeClient.messages.create({
    model: env("CLAUDE_MODEL") || "claude-sonnet-5-5",
    max_tokens: 12000,
    system: "Tu es Claude, agent Backend HASPAD. Génère le backend nécessaire à l'application. Retourne UNIQUEMENT JSON: {projectType,framework,files:[{path,content}],env:[{key,required,secret,description}],endpoints:[{method,path,description}],tests:[{path,content}],notes:[string]}. Aucun secret, aucun chemin absolu, aucun code destructif. Le résultat sera écrit dans le dépôt avant le contrôle final.",
    messages: [{ role: "user", content: JSON.stringify({
      buildId, repository: owner + "/" + name, branch, command,
      frontendBlueprint: gemini.blueprint || null,
      instruction: "Construis ou complète uniquement le backend nécessaire pour rendre le projet déployable et connecté."
    }) }]
  });
  const claudeRaw = claudeResponse.content.filter(p => p.type === "text").map(p => p.text).join("\n").trim();
  const claude = JSON.parse(claudeRaw.replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/i, ""));
  if (!Array.isArray(claude.files) || claude.files.length > 80) throw new Error("INVALID_CLAUDE_MANIFEST");
  const files = Object.fromEntries(claude.files.map(f => [String(f.path), String(f.content)]));
  for (const p of Object.keys(files)) {
    if (!p || p.startsWith("/") || p.includes("..") || p.includes("\\") || p.includes(".env")) throw new Error("INVALID_CLAUDE_PATH");
  }
  if (Object.keys(files).length) {
    await pushFiles(user.id, owner, name, branch, files, "chore(haspad): apply Claude backend before deployment");
  }
  await admin.from("ai_activity_logs").insert({
    site_id: siteId, agent_name: "claude-backend-builder", action_taken: "DEPLOYMENT_BACKEND_GENERATION",
    details: { build_id: buildId, model: env("CLAUDE_MODEL") || "claude-sonnet-5-5", file_count: Object.keys(files).length }
  });

  const openaiKey = env("OPENAI_API_KEY");
  if (!openaiKey) throw new Error("OPENAI_GATEWAY_NOT_READY");
  const chatResponse = await fetch(env("OPENAI_BASE_URL") || "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + openaiKey },
    body: JSON.stringify({
      model: env("CHATGPT_MODEL") || "gpt-5.6-luna",
      instructions: "Tu es ChatGPT, dernier agent d'intégration HASPAD. Vérifie que frontend, backend Claude, routes, API, variables et commande de build sont cohérents. Retourne UNIQUEMENT JSON: {status:'PASS'|'REPAIR_REQUIRED'|'BLOCKED',errors:[{file,message}],fixes:[{file,reason}],checks:[{name,result,evidence}],notes:[string]}. PASS seulement si le déploiement peut partir sans erreur d'intégration évidente.",
      input: JSON.stringify({ siteId, repository: owner + "/" + name, branch, command, frontend: gemini, backend: claude })
    })
  });
  if (!chatResponse.ok) throw new Error("OPENAI_GATEWAY_ERROR");
  const chatData = await chatResponse.json();
  const chatgpt = JSON.parse(String(chatData.output_text || "").replace(/^\`\`\`json\s*/i, "").replace(/\s*\`\`\`$/i, ""));
  await admin.from("ai_activity_logs").insert({
    site_id: siteId, agent_name: "chatgpt-integration", action_taken: "DEPLOYMENT_FINAL_GATE",
    details: { build_id: buildId, model: env("CHATGPT_MODEL") || "gpt-5.6-luna", status: chatgpt.status }
  });
  if (chatgpt.status !== "PASS") throw new Error("AI_GATE_" + chatgpt.status);
  return { gemini: "PASS", claude: "BACKEND_READY", chatgpt: "PASS" };
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });
  const user = await getUser();
  if (!user) return json(401, { error: "Unauthorized" });
  const b = await req.json().catch(() => null);
  const siteId = String(b?.siteId || "");
  const owner = String(b?.repositoryOwner || "");
  const name = String(b?.repositoryName || "");
  const branch = String(b?.branch || "");
  const command = String(b?.command || "").trim();
  const baseDirectory = String(b?.baseDirectory || "");
  const publishDirectory = String(b?.publishDirectory || "");
  if (!UUID.test(siteId) || !/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(name) ||
      !/^[A-Za-z0-9._/-]{1,255}$/.test(branch) || command.length > 300 || (command && !SAFE_COMMAND.test(command))) {
    return json(400, { error: "Paramètres de déploiement invalides." });
  }
  const site = (await admin.from("sites").select("id,user_id,netlify_site_id").eq("id", siteId).maybeSingle()).data;
  if (!site || String(site.user_id) !== String(user.id)) return json(403, { error: "Forbidden" });
  if (!site.netlify_site_id) return json(503, { error: "Aucune cible Netlify n'est associée au projet." });

  const cost = Math.max(1, Number(env("GIT_DEPLOY_CREDIT_COST") || 300));
  const referenceId = crypto.randomUUID();
  const allocationResult = await admin.rpc("consume_credits_and_create_build_v2", {
    p_user_id: user.id, p_site_id: siteId, p_cost: cost, p_reference_id: referenceId,
    p_git_provider: "github", p_repository_owner: owner, p_repository_name: name, p_branch: branch
  });
  if (allocationResult.error) return json(500, { error: "Transaction de déploiement impossible." });
  const allocation = allocationResult.data;
  if (!allocation?.success) return json(allocation.error === "INSUFFICIENT_CREDITS" ? 402 : 400, {
    error: allocation.error, remainingCredits: allocation.remaining_credits
  });

  const buildId = allocation.build_id;
  try {
    const agents = await runThreeAgents({ user, buildId, siteId, owner, name, branch, command });
    const current = await netlify("https://api.netlify.com/api/v1/sites/" + encodeURIComponent(site.netlify_site_id));
    const existing = current.build_settings || current.repo || {};
    const repoPath = owner + "/" + name;
    const repoUrl = "https://github.com/" + owner + "/" + name;
    const buildSettings = {
      ...(existing || {}),
      provider: "github",
      repo_path: repoPath,
      repo_url: repoUrl,
      repo_branch: branch,
      cmd: command,
      dir: publishDirectory || existing.dir || "",
      allowed_branches: Array.from(new Set([...(existing.allowed_branches || []), branch]))
    };

    await netlify("https://api.netlify.com/api/v1/sites/" + encodeURIComponent(site.netlify_site_id), {
      method: "PATCH",
      body: JSON.stringify({ build_settings: buildSettings, repo: buildSettings })
    });

    const build = await netlify("https://api.netlify.com/api/v1/sites/" + encodeURIComponent(site.netlify_site_id) +
      "/builds?branch=" + encodeURIComponent(branch) + "&title=" + encodeURIComponent("HASPAD " + owner + "/" + name), { method: "POST", body: JSON.stringify({}) });

    await admin.from("project_builds").update({
      status: "building",
      triggered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      netlify_deploy_id: build.deploy_id || null
    }).eq("id", buildId);

    return json(202, { success: true, buildId, netlifyBuildId: build.id, netlifyDeployId: build.deploy_id || null, command, branch, agents });
  } catch (error) {
    await admin.rpc("fail_build_and_refund", { p_build_id: buildId, p_error: String(error?.message || "DEPLOYMENT_FAILED").slice(0, 1000) });
    console.error("deployment-trigger", error?.message || error);
    return json(502, { error: "Le déploiement a échoué. Les crédits ont été remboursés." });
  }
};
