import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
});

export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" }
});

export const requireEnv = (...names) => {
  for (const name of names) if (!process.env[name]) throw new Error("Missing environment variable: " + name);
};

export async function userFromRequest(req) {
  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const result = await db().auth.getUser(token);
  return result.error ? null : result.data.user;
}

export function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: "Bearer " + token,
    "x-github-api-version": "2026-03-10",
    "content-type": "application/json"
  };
}

export async function github(path, token, options = {}) {
  const response = await fetch("https://api.github.com" + path, {
    ...options,
    headers: { ...githubHeaders(token), ...(options.headers || {}) }
  });
  const raw = await response.text();
  let data = {};
  try { data = JSON.parse(raw); } catch { data = { raw }; }
  if (!response.ok) throw new Error("GitHub " + response.status + ": " + (data.message || raw.slice(0, 300)));
  return data;
}

export function encryptToken(value) {
  requireEnv("GITHUB_TOKEN_ENCRYPTION_KEY");
  const key = Buffer.from(process.env.GITHUB_TOKEN_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  };
}

export function decryptToken(row) {
  requireEnv("GITHUB_TOKEN_ENCRYPTION_KEY");
  const key = Buffer.from(process.env.GITHUB_TOKEN_ENCRYPTION_KEY, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(row.access_token_iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.access_token_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.access_token_ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

export function signState(payload) {
  requireEnv("GITHUB_OAUTH_STATE_SECRET");
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + 10 * 60 * 1000
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.GITHUB_OAUTH_STATE_SECRET).update(body).digest("base64url");
  return body + "." + signature;
}

export function verifyState(value) {
  requireEnv("GITHUB_OAUTH_STATE_SECRET");
  const parts = String(value || "").split(".");
  if (parts.length !== 2) throw new Error("Invalid OAuth state");
  const expected = crypto.createHmac("sha256", process.env.GITHUB_OAUTH_STATE_SECRET).update(parts[0]).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) throw new Error("Invalid OAuth state");
  const payload = JSON.parse(Buffer.from(parts[0], "base64url"));
  if (payload.exp < Date.now()) throw new Error("Expired OAuth state");
  return payload;
}

export async function githubConnection(userId) {
  const result = await db().from("github_connections").select("*").eq("user_id", userId).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

export async function logDeployment(id, patch, message) {
  const client = db();
  const current = await client.from("deployments").select("logs").eq("id", id).single();
  if (current.error) throw current.error;
  const logs = Array.isArray(current.data.logs) ? current.data.logs : [];
  if (message) logs.push("[" + new Date().toISOString() + "] " + message);
  const result = await client.from("deployments").update({ ...patch, logs }).eq("id", id);
  if (result.error) throw result.error;
}

export function parseJson(text) {
  const value = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(value); } catch {}
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
  throw new Error("AI response is not valid JSON");
}

const unsafePath = /(^|\/)(\.git|node_modules)(\/|$)|^\.env|(^|\/).*\.(lock|pem|key)$/i;

export function validateFiles(result, knownPaths) {
  if (!result || !Array.isArray(result.files)) throw new Error("AI did not return files");
  if (result.files.length > 24) throw new Error("AI returned too many files");
  let total = 0;
  for (const file of result.files) {
    if (!file.path || file.path.includes("..") || unsafePath.test(file.path) || file.path.startsWith(".github/workflows/")) {
      throw new Error("Unsafe AI path: " + file.path);
    }
    if (!["create", "update", "delete"].includes(file.action)) throw new Error("Invalid action: " + file.action);
    if (file.action === "update" && !knownPaths.has(file.path)) throw new Error("Unknown update path: " + file.path);
    if (file.action === "delete" && !knownPaths.has(file.path)) throw new Error("Unknown delete path: " + file.path);
    if (file.action !== "delete" && typeof file.content !== "string") throw new Error("Missing file content: " + file.path);
    if (file.action !== "delete" && file.content.length > 350000) throw new Error("File too large: " + file.path);
    total += file.content ? file.content.length : 0;
  }
  if (total > 2000000) throw new Error("AI patch set is too large");
  return result.files;
}

export async function snapshot(owner, repo, branch, token) {
  const commit = await github("/repos/" + owner + "/" + repo + "/commits/" + encodeURIComponent(branch), token);
  const tree = await github("/repos/" + owner + "/" + repo + "/git/trees/" + commit.commit.tree.sha + "?recursive=1", token);
  if (tree.truncated) throw new Error("Repository tree is too large");
  const entries = tree.tree || [];
  const knownPaths = new Set(entries.filter(x => x.type === "blob").map(x => x.path));
  const candidates = entries.filter(x =>
    x.type === "blob" &&
    x.size <= 250000 &&
    /\.(html?|css|scss|js|mjs|cjs|jsx|tsx?|vue|svelte|json|md|py|go|java|php|rb)$/i.test(x.path) &&
    !/(node_modules|\.git|dist\/|build\/|coverage\/|\.lock$|\.min\.)/i.test(x.path)
  ).slice(0, 70);
  let total = 0;
  const files = [];
  for (const entry of candidates) {
    if (total > 650000) break;
    try {
      const blob = await github("/repos/" + owner + "/" + repo + "/git/blobs/" + entry.sha, token);
      const content = Buffer.from(blob.content || "", "base64").toString("utf8");
      if (content.includes("\u0000")) continue;
      const clipped = content.slice(0, 120000);
      total += clipped.length;
      files.push({ path: entry.path, content: clipped, sha: entry.sha });
    } catch {}
  }
  return { commitSha: commit.sha, treeSha: commit.commit.tree.sha, files, knownPaths };
}

export const context = files => files.map(f => "\n===== " + f.path + " =====\n" + f.content).join("\n");

export async function gemini(prompt) {
  requireEnv("GEMINI_API_KEY", "GEMINI_MODEL");
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.GEMINI_MODEL, input: prompt })
  });
  const data = await response.json();
  if (!response.ok) throw new Error("Gemini " + response.status + ": " + (data.error?.message || "request failed"));
  return data.output_text || "";
}

export async function claude(system, prompt) {
  requireEnv("ANTHROPIC_API_KEY", "ANTHROPIC_MODEL");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL,
      max_tokens: 24000,
      system,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error("Claude " + response.status + ": " + (data.error?.message || "request failed"));
  return (data.content || []).filter(x => x.type === "text").map(x => x.text).join("\n");
}

export async function openai(system, prompt) {
  requireEnv("OPENAI_API_KEY", "OPENAI_MODEL");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: "Bearer " + process.env.OPENAI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL, instructions: system, input: prompt, store: false })
  });
  const data = await response.json();
  if (!response.ok) throw new Error("OpenAI " + response.status + ": " + (data.error?.message || "request failed"));
  return data.output_text || "";
}
