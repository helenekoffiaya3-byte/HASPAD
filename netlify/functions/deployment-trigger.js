import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";
import crypto from "crypto";

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

    return json(202, { success: true, buildId, netlifyBuildId: build.id, netlifyDeployId: build.deploy_id || null, command, branch });
  } catch (error) {
    await admin.rpc("fail_build_and_refund", { p_build_id: buildId, p_error: String(error?.message || "DEPLOYMENT_FAILED").slice(0, 1000) });
    console.error("deployment-trigger", error?.message || error);
    return json(502, { error: "Le déploiement a échoué. Les crédits ont été remboursés." });
  }
};
