import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { generateProjectBlueprint, generateFrontendFiles } from "./aiService.js";
import { githubConnection, pushFiles } from "./_github.js";

const env = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
const UUID = /^[0-9a-f-]{36}$/i;
const SAFE_COMMAND = /^[A-Za-z0-9_./:@%+?=,-]+(?:\s+[A-Za-z0-9_./:@%+?=,-]+)*$/;
const ACTIVE_BUILD_STATES = new Set(["pending", "building", "queued", "processing"]);

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

async function ensureDeployFailureHook(siteId) {
  const secret = env("NETLIFY_WEBHOOK_SECRET");
  if (!secret) return null;
  const hookUrl = env("PUBLIC_SITE_URL") + "/api/netlify-deploy-hook?token=" + encodeURIComponent(secret);
  try {
    const hooks = await netlify("https://api.netlify.com/api/v1/hooks?site_id=" + encodeURIComponent(siteId));
    const existing = Array.isArray(hooks)
      ? hooks.find(h => h?.type === "url" && h?.event === "deploy_failed" && h?.data?.url === hookUrl)
      : null;
    if (existing && !existing.disabled) return existing.id;
    const created = await netlify("https://api.netlify.com/api/v1/hooks", {
      method: "POST",
      body: JSON.stringify({
        site_id: siteId,
        type: "url",
        event: "deploy_failed",
        data: { url: hookUrl }
      })
    });
    return created?.id || null;
  } catch (error) {
    console.warn("Netlify deploy-failure hook unavailable:", error?.message || error);
    return null;
  }
}
