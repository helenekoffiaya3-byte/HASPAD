import { json, userFromRequest, db, githubConnection, decryptToken, github } from "./_lib.mjs";

const slugify = value => String(value || "site")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  .slice(0, 48) || "site";

const siteBase = () => String(process.env.HASPAD_SITE_DOMAIN || "haspad.com").replace(/^https?:\/\//, "").replace(/\/$/, "");

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

export default async req => {
  const user = await userFromRequest(req);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const client = db();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") {
    let query = client.from("projects").select("id,name,site_slug,site_url,repo_owner,repo_name,repo_url,default_branch,created_at,updated_at").eq("user_id", user.id).order("created_at", { ascending: false });
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
    const repo = await github("/repos/" + encodeURIComponent(body.repo_owner) + "/" + encodeURIComponent(body.repo_name), decryptToken(connection));
    if (!repo.permissions?.push) return json({ error: "Droit d’écriture requis sur ce dépôt" }, 403);

    const existing = await client.from("projects").select("id,site_slug,site_url").eq("user_id", user.id).eq("repo_owner", repo.owner.login).eq("repo_name", repo.name).maybeSingle();
    if (existing.error) return json({ error: existing.error.message }, 500);

    const siteSlug = existing.data?.site_slug || await uniqueSlug(client, body.name || repo.name);
    const siteUrl = "https://" + siteSlug + "." + siteBase();

    const result = await client.from("projects").upsert({
      user_id: user.id,
      name: String(body.name || repo.name).slice(0, 120),
      site_slug: siteSlug,
      site_url: siteUrl,
      repo_owner: repo.owner.login,
      repo_name: repo.name,
      repo_url: repo.html_url,
      default_branch: repo.default_branch || "main"
    }, { onConflict: "user_id,repo_owner,repo_name" }).select("id,name,site_slug,site_url,repo_owner,repo_name,repo_url,default_branch").single();

    if (result.error) return json({ error: result.error.message }, 500);
    return json({ project: result.data }, existing.data ? 200 : 201);
  } catch (error) {
    return json({ error: error.message }, 502);
  }
};
