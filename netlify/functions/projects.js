import { json, userFromRequest, db, githubConnection, decryptToken, github } from "./_lib.mjs";
import { buildHaspadKit } from "./haspad-kit.mjs";

const slugify = value => String(value || "site")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  .slice(0, 48) || "site";

const siteBase = () => String(process.env.HASPAD_SITE_DOMAIN || "haspad.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
const deployBranch = "haspad/deploy";

async function uniqueSlug(client, base) {
  let slug = slugify(base);
  for (let i = 1; i <= 100; i++) {
    const candidate = i === 1 ? slug : slug + "-" + i;
    const found = await client.from("projects").select("id").eq("site_slug", candidate).maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) return candidate;
  }
  throw new Error("Impossible de générer un sous-domaine disponible");
}

async function refSha(owner, repo, branch, token) {
  try {
    const ref = await github("/repos/" + owner + "/" + repo + "/git/ref/heads/" + encodeURIComponent(branch), token);
    return ref.object.sha;
  } catch (error) {
    if (/GitHub 404:/.test(error.message)) return null;
    throw error;
  }
}

async function ensureHaspadKit(owner, repo, branch, token, projectName) {
  const kit = buildHaspadKit(projectName);
  const missing = [];
  for (const path of Object.keys(kit)) {
    try {
      await github("/repos/" + owner + "/" + repo + "/contents/" + path + "?ref=" + encodeURIComponent(branch), token);
    } catch (error) {
      if (/GitHub 404:/.test(error.message)) missing.push(path);
      else throw error;
    }
  }
  if (!missing.length) return { changed: false, commitSha: await refSha(owner, repo, branch, token) };

  const parentSha = await refSha(owner, repo, branch, token);
  let baseTreeSha = null;
  if (parentSha) {
    const parent = await github("/repos/" + owner + "/" + repo + "/git/commits/" + parentSha, token);
    baseTreeSha = parent.tree.sha;
  }

  const tree = await github("/repos/" + owner + "/" + repo + "/git/trees", token, {
    method: "POST",
    body: JSON.stringify({
      ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
      tree: missing.map(path => ({ path, mode: "100644", type: "blob", content: kit[path] }))
    })
  });

  const commit = await github("/repos/" + owner + "/" + repo + "/git/commits", token, {
    method: "POST",
    body: JSON.stringify({
      message: "feat: initialise HASPAD Context as Code",
      tree: tree.sha,
      ...(parentSha ? { parents: [parentSha] } : {})
    })
  });

  if (parentSha) {
    await github("/repos/" + owner + "/" + repo + "/git/refs/heads/" + encodeURIComponent(branch), token, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false })
    });
  } else {
    await github("/repos/" + owner + "/" + repo + "/git/refs", token, {
      method: "POST",
      body: JSON.stringify({ ref: "refs/heads/" + branch, sha: commit.sha })
    });
  }
  return { changed: true, commitSha: commit.sha };
}

async function ensureDeployBranch(owner, repo, defaultBranch, token) {
  const existing = await refSha(owner, repo, deployBranch, token);
  if (existing) return existing;
  const base = await refSha(owner, repo, defaultBranch, token);
  if (!base) throw new Error("Le dépôt GitHub ne possède aucun commit");
  await github("/repos/" + owner + "/" + repo + "/git/refs", token, {
    method: "POST",
    body: JSON.stringify({ ref: "refs/heads/" + deployBranch, sha: base })
  });
  return base;
}

export default async req => {
  const user = await userFromRequest(req);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const client = db();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") {
    let query = client.from("projects").select("id,name,site_slug,site_url,netlify_site_id,deploy_branch,repo_owner,repo_name,repo_url,default_branch,created_at,updated_at").eq("user_id", user.id).order("created_at", { ascending: false });
    if (id) query = query.eq("id", id).single();
    const result = await query;
    if (result.error) return json({ error: result.error.message }, id ? 404 : 500);
    return json(id ? { project: result.data } : { projects: result.data || [] });
  }

  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  const body = await req.json().catch(() => null);
  if (!body?.repo_owner || !body?.repo_name) return json({ error: "Dépôt requis" }, 400);
  const connection = await githubConnection(user.id);
  if (!connection) return json({ error: "Connectez GitHub avant d'associer un dépôt" }, 409);

  try {
    const token = decryptToken(connection);
    const repo = await github("/repos/" + encodeURIComponent(body.repo_owner) + "/" + encodeURIComponent(body.repo_name), token);
    if (!repo.permissions?.push) return json({ error: "Droit d’écriture requis sur ce dépôt" }, 403);

    const existing = await client.from("projects").select("id,site_slug,site_url,netlify_site_id,netlify_build_hook_url,deploy_branch").eq("user_id", user.id).eq("repo_owner", repo.owner.login).eq("repo_name", repo.name).maybeSingle();
    if (existing.error) return json({ error: existing.error.message }, 500);

    const defaultBranch = repo.default_branch || "main";
    const siteSlug = existing.data?.site_slug || await uniqueSlug(client, body.name || repo.name);
    const siteUrl = "https://" + siteSlug + "." + siteBase();

    const result = await client.from("projects").upsert({
      user_id: user.id,
      name: String(body.name || repo.name).slice(0, 120),
      site_slug: siteSlug,
      site_url: siteUrl,
      deploy_branch: deployBranch,
      repo_owner: repo.owner.login,
      repo_name: repo.name,
      repo_url: repo.html_url,
      default_branch: defaultBranch
    }, { onConflict: "user_id,repo_owner,repo_name" }).select("id,name,site_slug,site_url,netlify_site_id,netlify_build_hook_url,deploy_branch,repo_owner,repo_name,repo_url,default_branch").single();

    if (result.error) return json({ error: result.error.message }, 500);

    const kit = await ensureHaspadKit(repo.owner.login, repo.name, defaultBranch, token, result.data.name);
    const deployBaseSha = await ensureDeployBranch(repo.owner.login, repo.name, defaultBranch, token);

    return json({
      project: result.data,
      haspad_kit: kit,
      deploy_branch: deployBranch,
      deploy_base_sha: deployBaseSha
    }, existing.data ? 200 : 201);
  } catch (error) {
    return json({ error: error.message }, 502);
  }
};
