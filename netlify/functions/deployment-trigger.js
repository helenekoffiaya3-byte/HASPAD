import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { generateFrontendFiles } from "./aiService.js";
import { githubConnection, pushFiles } from "./_github.js";
import { runtimeRequest } from "./_runtime.js";

const env = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
const UUID = /^[0-9a-f-]{36}$/i;
const SAFE_COMMAND = /^[A-Za-z0-9_./:@%+?=,-]+(?:\s+[A-Za-z0-9_./:@%+?=,-]+)*$/;
const ACTIVE_BUILD_STATES = new Set(["pending", "building", "queued", "processing"]);
const preflightSecret = () => env("GITHUB_OAUTH_STATE_SECRET") || env("NETLIFY_WEBHOOK_SECRET") || "";
function verifyPreflight(token, expected) {
  try {
    const [enc,sig] = String(token||"").split(".");
    if (!enc || !sig) return false;
    const payload = Buffer.from(enc,"base64url").toString("utf8");
    const actual = JSON.parse(payload);
    if (Date.now()-Number(actual.t) > 10*60*1000) return false;
    for (const k of ["u","s","o","n","b","r"]) if (String(actual[k]) !== String(expected[k])) return false;
    for (const k of ["c","bd","pd"]) if (String(actual[k]||"") !== String(expected[k]||"")) return false;
    const expectedSig = crypto.createHmac("sha256", preflightSecret()).update(payload).digest();
    const providedSig = Buffer.from(sig,"base64url");
    return expectedSig.length === providedSig.length && crypto.timingSafeEqual(expectedSig, providedSig);
  } catch { return false; }
}

async function netlify(url, options = {}) {
  const token = env("NETLIFY_AUTH_TOKEN");
  if (!token) throw new Error("NETLIFY_AUTH_TOKEN_NOT_CONFIGURED");
  const r = await fetch(url, {
    ...options,
    headers: {
      authorization: "Bearer " + token,
      accept: "application/json",
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
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
  const files = entries.filter(x => x.type === "blob" && allowed.test(String(x.path || ""))).slice(0, 160);
  const snapshot = [];
  for (const entry of files) {
    const data = await githubRequest(
      "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name) +
      "/contents/" + entry.path.split("/").map(encodeURIComponent).join("/") +
      "?ref=" + encodeURIComponent(branch),
      connection.token
    );
    const raw = data?.content
      ? Buffer.from(String(data.content).replace(/\s/g, ""), "base64").toString("utf8")
      : "";
    snapshot.push({ path: entry.path, content: raw.slice(0, 50000) });
  }
  return snapshot;
}

async function ensureDeployFailureHook(siteId) {
  const secret = env("NETLIFY_WEBHOOK_SECRET");
  const publicUrl = env("PUBLIC_SITE_URL");
  if (!secret || !publicUrl) return null;
  const hookUrl = publicUrl + "/api/netlify-deploy-hook?token=" + encodeURIComponent(secret);
  try {
    const hooks = await netlify("https://api.netlify.com/api/v1/hooks?site_id=" + encodeURIComponent(siteId));
    const existing = Array.isArray(hooks)
      ? hooks.find(h => h?.type === "url" && h?.event === "deploy_failed" && h?.data?.url === hookUrl)
      : null;
    if (existing && !existing.disabled) return existing.id;
    const created = await netlify("https://api.netlify.com/api/v1/hooks", {
      method: "POST",
      body: JSON.stringify({ site_id: siteId, type: "url", event: "deploy_failed", data: { url: hookUrl } })
    });
    return created?.id || null;
  } catch (error) {
    console.warn("Netlify deploy-failure hook unavailable:", error?.message || error);
    return null;
  }
}

async function runThreeAgents({ user, buildId, siteId, owner, name, branch, command }) {
  if (!env("GEMINI_API_KEY")) throw new Error("GEMINI_GATEWAY_NOT_READY");
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
    await pushFiles(user.id, owner, name, branch, frontendFiles, "feat(haspad): Gemini builds all frontend pages [skip netlify]");
  }
  await admin.from("ai_activity_logs").insert({
    site_id: siteId, agent_name: "gemini-frontend", action_taken: "DEPLOYMENT_FRONTEND_BUILD",
    details: { build_id: buildId, model: gemini.model, status: "PASS", page_count: Array.isArray(gemini.pages) ? gemini.pages.length : 0, file_count: Object.keys(frontendFiles).length }
  });

  const anthropicKey = env("ANTHROPIC_API_KEY");
  const anthropicBase = env("ANTHROPIC_BASE_URL");
  if (!anthropicKey || !anthropicBase) throw new Error("CLAUDE_GATEWAY_NOT_READY");
  const claudeClient = new Anthropic({ apiKey: anthropicKey, baseURL: anthropicBase });
  const claudeResponse = await claudeClient.messages.create({
    model: env("CLAUDE_MODEL") || "claude-sonnet-5-5",
    max_tokens: 12000,
    system: "Tu es Claude, agent Backend HASPAD. Génère le backend nécessaire à l'application. Retourne UNIQUEMENT JSON: {projectType,framework,files:[{path,content}],env:[{key,required,secret,description}],endpoints:[{method,path,description}],tests:[{path,content}],notes:[string]}. Aucun secret, aucun chemin absolu, aucun code destructif.",
    messages: [{ role: "user", content: JSON.stringify({
      buildId, repository: owner + "/" + name, branch, command, frontendBlueprint: gemini.blueprint || null,
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
    await pushFiles(user.id, owner, name, branch, files, "chore(haspad): apply Claude backend before deployment [skip netlify]");
  }
  await admin.from("ai_activity_logs").insert({
    site_id: siteId, agent_name: "claude-backend-builder", action_taken: "DEPLOYMENT_BACKEND_GENERATION",
    details: { build_id: buildId, model: env("CLAUDE_MODEL") || "claude-sonnet-5-5", file_count: Object.keys(files).length }
  });

  const finalFrontendSnapshot = await loadFrontendSnapshot(user.id, owner, name, branch);
  const openaiKey = env("OPENAI_API_KEY");
  if (!openaiKey) throw new Error("OPENAI_GATEWAY_NOT_READY");
  const chatResponse = await fetch(env("OPENAI_BASE_URL") || "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + openaiKey },
    body: JSON.stringify({
      model: env("CHATGPT_MODEL") || "gpt-5.6-luna",
      instructions: "Tu es ChatGPT, dernier agent d'intégration HASPAD. Vérifie frontend, backend Claude, routes, API, variables et commande de build. Retourne UNIQUEMENT JSON: {status:'PASS'|'REPAIR_REQUIRED'|'BLOCKED',errors:[{file,message}],fixes:[{file,reason}],checks:[{name,result,evidence}],notes:[string]}. PASS seulement si le déploiement peut partir sans erreur d'intégration évidente.",
      input: JSON.stringify({ siteId, repository: owner + "/" + name, branch, command, frontend: gemini, backend: claude, finalFrontendEvidence: finalFrontendSnapshot.slice(0, 80).map(x => ({path:x.path,content:String(x.content||"").slice(0,12000)})) })
    })
  });
  if (!chatResponse.ok) throw new Error("OPENAI_GATEWAY_ERROR");
  const chatData = await chatResponse.json();
  const chatgpt = JSON.parse(String(chatData.output_text || "").replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/i, ""));
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
  const preflightToken = String(b?.preflightToken || "");
  const targetRuntime = String(b?.targetRuntime || "netlify").toLowerCase();
  const port = Number(b?.port || 0);
  const healthcheckPath = String(b?.healthcheckPath || "/");

  if (!UUID.test(siteId) || !/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(name) ||
      !/^[A-Za-z0-9._/-]{1,255}$/.test(branch) || !["netlify","docker"].includes(targetRuntime) || command.length > 300 || (command && !SAFE_COMMAND.test(command)) || (targetRuntime === "docker" && (!Number.isInteger(port) || port < 1 || port > 65535)) || healthcheckPath.length > 200 || !healthcheckPath.startsWith("/")) {
    return json(400, { error: "Paramètres de déploiement invalides." });
  }

  if (!verifyPreflight(preflightToken, {u:user.id,s:siteId,o:owner,n:name,b:branch,r:targetRuntime,c:command,bd:baseDirectory,pd:publishDirectory,p:String(port || ""),h:healthcheckPath})) {
    return json(412, { error: "PREFLIGHT_REQUIRED_OR_EXPIRED", message: "Une prévalidation réussie et récente est obligatoire avant tout débit." });
  }

  const site = (await admin.from("sites").select("id,user_id,netlify_site_id,subdomain,custom_domain").eq("id", siteId).maybeSingle()).data;
  if (!site || String(site.user_id) !== String(user.id)) return json(403, { error: "Forbidden" });
  if (targetRuntime === "netlify" && !site.netlify_site_id) return json(503, { error: "Aucune cible Netlify n'est associée au projet." });
  if (targetRuntime === "netlify" && !env("NETLIFY_AUTH_TOKEN")) return json(503, { error: "NETLIFY_AUTH_TOKEN_NOT_CONFIGURED" });
  if (targetRuntime === "docker" && !env("HASPAD_RUNTIME_URL")) return json(503, { error: "HASPAD_RUNTIME_URL_NOT_CONFIGURED" });

  const connection = await githubConnection(user.id);
  if (!connection?.token) return json(400, { error: "GITHUB_NOT_CONNECTED" });

  const recent = (await admin.from("project_builds")
    .select("id,status,netlify_deploy_id,created_at,version_tag,build_number,repository_owner,repository_name,branch")
    .eq("site_id", siteId).order("build_number", { ascending: false }).limit(10)).data || [];
  const active = recent.find(x => x.repository_owner === owner && x.repository_name === name && x.branch === branch && ACTIVE_BUILD_STATES.has(String(x.status)));
  if (active) return json(202, { success:true, reused:true, buildId:active.id, netlifyDeployId:active.netlify_deploy_id||null, status:active.status, message:"Un déploiement identique est déjà en cours. Aucun crédit supplémentaire n'est débité." });

  const preflightId = crypto.randomUUID();
  const host = String(site.custom_domain || ((site.subdomain || "").replace(/[^A-Za-z0-9.-]/g, "") + "." + (env("HASPAD_SITE_DOMAIN") || "haspad.com"))).toLowerCase();
  if (targetRuntime === "docker" && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) return json(422,{error:"DOCKER_HOST_INVALID"});
  let creditedBuildId = null;
  let netlifyAccepted = false;

  try {
    // Phase 1: prévalidation + agents. Aucun crédit n'est débité et aucun build Netlify n'est lancé.
    const agents = targetRuntime === "netlify" ? await runThreeAgents({ user, buildId: preflightId, siteId, owner, name, branch, command }) : { skipped: "docker-source-is-immutable-after-preflight" };

    // Phase 2: configuration de la cible. Aucun crédit n'est débité.
    if (targetRuntime === "netlify") await ensureDeployFailureHook(site.netlify_site_id);
    const current = targetRuntime === "netlify" ? await netlify("https://api.netlify.com/api/v1/sites/" + encodeURIComponent(site.netlify_site_id)) : null;
    const existing = current?.build_settings || current?.repo || {};
    const repoPath = owner + "/" + name;
    const repoUrl = "https://github.com/" + owner + "/" + name;
    const buildSettings = {
      ...(existing || {}),
      provider: "github",
      repo_path: repoPath,
      repo_url: repoUrl,
      repo_branch: branch,
      base: baseDirectory || existing.base || "",
      cmd: command,
      dir: publishDirectory || existing.dir || "",
      allowed_branches: Array.from(new Set([...(existing.allowed_branches || []), branch]))
    };
    await netlify("https://api.netlify.com/api/v1/sites/" + encodeURIComponent(site.netlify_site_id), {
      method: "PATCH", body: JSON.stringify({ build_settings: buildSettings, repo: buildSettings })
    });

    // Phase 3: débit atomique immédiatement avant le lancement réel du build Netlify.
    const cost = Math.max(1, Number(env("GIT_DEPLOY_CREDIT_COST") || 300));
    const referenceId = crypto.randomUUID();
    const allocationResult = await admin.rpc("consume_credits_and_create_build_v2", {
      p_user_id:user.id, p_site_id:siteId, p_cost:cost, p_reference_id:referenceId,
      p_git_provider:targetRuntime === "docker" ? "github-docker" : "github", p_repository_owner:owner, p_repository_name:name, p_branch:branch
    });
    if (allocationResult.error) return json(500, {error:"Transaction de déploiement impossible."});
    const allocation = allocationResult.data;
    if (!allocation?.success) {
      return json(allocation.error === "INSUFFICIENT_CREDITS" ? 402 : 400, {error:allocation.error,remainingCredits:allocation.remaining_credits});
    }
    if (allocation.reused || allocation.idempotent) {
      return json(202, {success:true,reused:true,buildId:allocation.build_id,status:allocation.status||"building",remainingCredits:allocation.remaining_credits,message:"Un déploiement identique est déjà en cours. Aucun nouveau crédit n'a été débité."});
    }
    creditedBuildId = allocation.build_id;

    await admin.from("project_builds").update({
      status:"building", triggered_at:new Date().toISOString(), updated_at:new Date().toISOString()
    }).eq("id",creditedBuildId).eq("status","pending");

    if (targetRuntime === "docker") {
      const runtime = await runtimeRequest("/v1/deploy", {
        projectId: creditedBuildId,
        runtimeId: creditedBuildId,
        repositoryOwner: owner,
        repositoryName: name,
        branch,
        githubToken: connection.token,
        host,
        port,
        healthcheckPath,
        dockerfilePath: "Dockerfile"
      }, "POST");
      netlifyAccepted = true;
      const savedRuntime = await admin.from("project_builds").update({
        status:"success", updated_at:new Date().toISOString(), deploy_url:runtime.publicUrl||null
      }).eq("id",creditedBuildId).eq("status","building").select("id").maybeSingle();
      if (savedRuntime.error) throw new Error("RUNTIME_ACCEPTED_DB_SYNC_FAILED");
      return json(202,{success:true,buildId:creditedBuildId,runtimeId:creditedBuildId,targetRuntime:"docker",host,publicUrl:runtime.publicUrl||null,health:runtime.health||null,remainingCredits:allocation.remaining_credits});
    }

    // L'unique appel de lancement Netlify est ici.
    const build = await netlify(
      "https://api.netlify.com/api/v1/sites/" + encodeURIComponent(site.netlify_site_id) +
      "/builds?branch=" + encodeURIComponent(branch) + "&title=" + encodeURIComponent("HASPAD " + owner + "/" + name),
      {method:"POST",body:JSON.stringify({})}
    );
    netlifyAccepted = true;

    const savedBuild = await admin.from("project_builds").update({
      status:"building", updated_at:new Date().toISOString(), netlify_deploy_id:build.deploy_id||null
    }).eq("id",creditedBuildId).select("id").maybeSingle();

    return json(202, {
      success:true, buildId:creditedBuildId, netlifyBuildId:build.id, netlifyDeployId:build.deploy_id||null,
      command, branch, agents, remainingCredits:allocation.remaining_credits
    });
  } catch (error) {
    if (creditedBuildId && !netlifyAccepted) {
      await admin.rpc("fail_build_and_refund",{p_build_id:creditedBuildId,p_error:String(error?.message||"DEPLOYMENT_FAILED").slice(0,1000)});
    } else if (creditedBuildId && netlifyAccepted) {
      await admin.from("project_builds").update({error_message:String(error?.message||"DEPLOY_POST_ACCEPTANCE_ERROR").slice(0,1000),updated_at:new Date().toISOString()}).eq("id",creditedBuildId);
    }
    console.error("deployment-trigger",error?.message||error);
    return json(502,{error:creditedBuildId&&!netlifyAccepted?"Le déploiement a échoué avant son lancement. Les crédits ont été remboursés.":"Le déploiement a échoué ou a été accepté par Netlify; le suivi reste actif.",buildId:creditedBuildId});
  }
};
