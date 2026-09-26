import { json, userFromRequest, db } from "./_lib.mjs";
export default async req => {
  const user = await userFromRequest(req);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const client = db();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const projectId = url.searchParams.get("project_id");
  if (req.method === "GET") {
    let query = client.from("deployments").select("id,project_id,status,current_step,branch_name,commit_sha,pull_request_url,netlify_site_id,netlify_deploy_id,logs,error,created_at,updated_at").eq("user_id", user.id).order("created_at", { ascending: false });
    if (id) query = query.eq("id", id).single();
    else if (projectId) query = query.eq("project_id", projectId).limit(1);
    const result = await query;
    if (result.error) return json({ error: result.error.message }, id ? 404 : 500);
    return json(id ? { deployment: result.data } : { deployment: result.data?.[0] || null });
  }
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  const body = await req.json().catch(() => null);
  if (!body?.project_id) return json({ error: "project_id requis" }, 400);
  const project = await client.from("projects").select("id").eq("id", body.project_id).eq("user_id", user.id).single();
  if (project.error) return json({ error: "Projet introuvable" }, 404);
  const result = await client.from("deployments").insert({
    project_id: project.data.id, user_id: user.id, status: "starting", current_step: "Démarrage", logs: []
  }).select("*").single();
  if (result.error) return json({ error: result.error.message }, 500);
  const base = process.env.URL || new URL(req.url).origin;
  fetch(base + "/.netlify/functions/deploy-background", {
    method: "POST",
    headers: { "content-type": "application/json", "x-haspad-internal": process.env.INTERNAL_JOB_SECRET || "" },
    body: JSON.stringify({ deploymentId: result.data.id })
  }).catch(() => {});
  return json({ deployment: result.data }, 202);
};
