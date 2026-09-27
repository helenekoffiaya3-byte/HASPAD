import crypto from "crypto";
import { admin } from "./_credits.js";

const API = "https://api.github.com";

function env(name) {
  return globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
}
function required(name) {
  const value = env(name);
  if (!value) throw new Error(name + "_NOT_CONFIGURED");
  return value;
}
function keyBytes() {
  const raw = required("GITHUB_TOKEN_ENCRYPTION_KEY");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const b = Buffer.from(raw, "base64");
  if (b.length === 32) return b;
  throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY_INVALID");
}
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
function decrypt(ciphertext, iv, tag) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}
async function githubRequest(path, token, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: "Bearer " + token,
      "x-github-api-version": env("GITHUB_API_VERSION") || "2022-11-28",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const e = new Error(data?.message || data?.error_description || "GITHUB_API_ERROR");
    e.status = response.status;
    e.details = data;
    throw e;
  }
  return data;
}
export function parseCookies(request) {
  const raw = request.headers.get("cookie") || "";
  return Object.fromEntries(raw.split(";").map(x => x.trim()).filter(Boolean).map(x => {
    const i = x.indexOf("=");
    return i < 0 ? [x, ""] : [x.slice(0, i), decodeURIComponent(x.slice(i + 1))];
  }));
}
export function signedState(userId) {
  const payload = Buffer.from(JSON.stringify({ u: String(userId), t: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", required("GITHUB_OAUTH_STATE_SECRET")).update(payload).digest("base64url");
  return payload + "." + sig;
}
export function verifyState(state, userId) {
  try {
    const [payload, sig] = String(state || "").split(".");
    if (!payload || !sig) return false;
    const expected = crypto.createHmac("sha256", required("GITHUB_OAUTH_STATE_SECRET")).update(payload).digest("base64url");
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.u === String(userId) && Number.isFinite(data.t) && Date.now() - data.t < 10 * 60 * 1000;
  } catch { return false; }
}
export async function githubConnection(userId) {
  const { data, error } = await admin.from("github_connections").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  let token = decrypt(data.access_token_ciphertext, data.access_token_iv, data.access_token_tag);
  const expires = data.token_expires_at ? new Date(data.token_expires_at).getTime() : 0;
  if (expires && expires < Date.now() + 60000) {
    if (!data.refresh_token_ciphertext) throw new Error("GITHUB_TOKEN_EXPIRED");
    const refresh = decrypt(data.refresh_token_ciphertext, data.refresh_token_iv, data.refresh_token_tag);
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: required("GITHUB_CLIENT_ID"),
        client_secret: required("GITHUB_CLIENT_SECRET"),
        grant_type: "refresh_token",
        refresh_token: refresh
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) throw new Error(result.error_description || "GITHUB_REFRESH_FAILED");
    const access = encrypt(result.access_token);
    const refreshNext = result.refresh_token ? encrypt(result.refresh_token) : null;
    const patch = {
      access_token_ciphertext: access.ciphertext,
      access_token_iv: access.iv,
      access_token_tag: access.tag,
      token_expires_at: result.expires_in ? new Date(Date.now() + Number(result.expires_in) * 1000).toISOString() : null,
      updated_at: new Date().toISOString()
    };
    if (refreshNext) {
      patch.refresh_token_ciphertext = refreshNext.ciphertext;
      patch.refresh_token_iv = refreshNext.iv;
      patch.refresh_token_tag = refreshNext.tag;
    }
    const { error: updateError } = await admin.from("github_connections").update(patch).eq("user_id", userId);
    if (updateError) throw updateError;
    token = result.access_token;
  }
  return { ...data, token };
}
export async function saveGithubConnection(userId, oauth) {
  const access = encrypt(oauth.access_token);
  const refresh = oauth.refresh_token ? encrypt(oauth.refresh_token) : null;
  const row = {
    user_id: userId,
    github_user_id: Number(oauth.github_user_id),
    github_login: oauth.github_login,
    access_token_ciphertext: access.ciphertext,
    access_token_iv: access.iv,
    access_token_tag: access.tag,
    token_expires_at: oauth.expires_in ? new Date(Date.now() + Number(oauth.expires_in) * 1000).toISOString() : null,
    updated_at: new Date().toISOString()
  };
  if (refresh) {
    row.refresh_token_ciphertext = refresh.ciphertext;
    row.refresh_token_iv = refresh.iv;
    row.refresh_token_tag = refresh.tag;
  }
  const { data, error } = await admin.from("github_connections").upsert(row, { onConflict: "user_id" }).select("id,github_user_id,github_login,token_expires_at,updated_at").single();
  if (error) throw error;
  return data;
}
export async function listRepos(userId) {
  const c = await githubConnection(userId);
  if (!c) throw new Error("GITHUB_NOT_CONNECTED");
  return githubRequest("/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member", c.token);
}
export async function createRepo(userId, name, isPrivate = true) {
  const c = await githubConnection(userId);
  if (!c) throw new Error("GITHUB_NOT_CONNECTED");
  return githubRequest("/user/repos", c.token, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, private: Boolean(isPrivate), auto_init: true }) });
}
export async function listBranches(userId, owner, repo) {
  const c = await githubConnection(userId);
  if (!c) throw new Error("GITHUB_NOT_CONNECTED");
  return githubRequest("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/branches?per_page=100", c.token);
}
export async function pushFiles(userId, owner, repo, branch, files, commitMessage) {
  const c = await githubConnection(userId);
  if (!c) throw new Error("GITHUB_NOT_CONNECTED");
  const base = await githubRequest("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/branches/" + encodeURIComponent(branch), c.token);
  const baseCommit = base?.commit?.sha;
  const treeSha = base?.commit?.commit?.tree?.sha;
  if (!baseCommit || !treeSha) throw new Error("GITHUB_BRANCH_STATE_INVALID");
  const entries = [];
  for (const [path, value] of Object.entries(files || {})) {
    const clean = String(path).replace(/^\/+/, "");
    if (!clean || clean.includes("..")) throw new Error("INVALID_REPOSITORY_PATH");
    const blob = await githubRequest("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/git/blobs", c.token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: Buffer.from(String(value), "utf8").toString("base64"), encoding: "base64" })
    });
    entries.push({ path: clean, mode: "100644", type: "blob", sha: blob.sha });
  }
  if (!entries.length) throw new Error("NO_FILES_TO_PUSH");
  const tree = await githubRequest("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/git/trees", c.token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ base_tree: treeSha, tree: entries })
  });
  const commit = await githubRequest("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/git/commits", c.token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: commitMessage, tree: tree.sha, parents: [baseCommit] })
  });
  await githubRequest("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/git/refs/heads/" + encodeURIComponent(branch), c.token, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sha: commit.sha, force: false })
  });
  return commit.sha;
}
