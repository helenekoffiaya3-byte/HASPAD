import { getUser } from "@netlify/identity";
import { listBranches } from "./_github.js";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export default async (req) => {
  if (req.method !== "GET") return json(405, { error: "Method Not Allowed" });
  const user = await getUser();
  if (!user) return json(401, { error: "Unauthorized" });
  const full = String(new URL(req.url).searchParams.get("repo") || "");
  const match = /^([^/]+)\/([^/]+)$/.exec(full);
  if (!match) return json(400, { error: "repo invalide." });
  try {
    const branches = await listBranches(user.id, match[1], match[2]);
    return json(200, { branches: (branches || []).map(b => ({ name: b.name, sha: b.commit?.sha, protected: Boolean(b.protected) })) });
  } catch (error) {
    const status = [400,401,403,404,409,429].includes(Number(error?.status)) ? Number(error.status) : 502;
    return json(status, { error: error?.message || "Impossible de récupérer les branches." });
  }
};
