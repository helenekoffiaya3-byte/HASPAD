import { getUser } from "@netlify/identity";
import { createRepo, listRepos } from "./_github.js";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export default async (req) => {
  const user = await getUser();
  if (!user) return json(401, { error: "Unauthorized" });
  try {
    if (req.method === "GET") {
      const repos = await listRepos(user.id);
      return json(200, { repositories: (repos || []).map(r => ({ id: r.id, name: r.name, full_name: r.full_name, private: r.private, default_branch: r.default_branch, clone_url: r.clone_url, html_url: r.html_url })) });
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const name = String(body.name || "").trim();
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) return json(400, { error: "Nom de dépôt invalide." });
      const repository = await createRepo(user.id, name, body.private !== false);
      return json(201, { repository: { id: repository.id, name: repository.name, full_name: repository.full_name, private: repository.private, default_branch: repository.default_branch, clone_url: repository.clone_url, html_url: repository.html_url } });
    }
    return json(405, { error: "Method Not Allowed" });
  } catch (error) {
    console.error("git-repos", error);
    const status = [400,401,403,404,409,429].includes(Number(error?.status)) ? Number(error.status) : 502;
    return json(status, { error: error?.message || "GitHub indisponible." });
  }
};
