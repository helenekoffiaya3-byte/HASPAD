import { json, userFromRequest, db, githubConnection, decryptToken, github } from "./_lib.mjs";
export default async req => {
  const user = await userFromRequest(req);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const client = db();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (req.method === "GET") {
    let query = client.from("projects").select("id,name,repo_owner,repo_name,repo_url,default_branch,created_at,updated_at").eq("user_id", user.id).order("created_at", { ascending: false });
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
    const result = await client.from("projects").upsert({
      user_id: user.id,
      name: String(body.name || repo.name).slice(0, 120),
      repo_owner: repo.owner.login,
      repo_name: repo.name,
      repo_url: repo.html_url,
      default_branch: repo.default_branch || "main"
    }, { onConflict: "user_id,repo_owner,repo_name" }).select("id,name,repo_owner,repo_name,repo_url,default_branch").single();
    if (result.error) return json({ error: result.error.message }, 500);
    return json({ project: result.data }, 201);
  } catch (error) {
    return json({ error: error.message }, 502);
  }
};
