import { json, userFromRequest, githubConnection, decryptToken, github } from "./_lib.mjs";
export default async req => {
  const user = await userFromRequest(req);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const connection = await githubConnection(user.id);
  if (!connection) return json({ error: "GitHub non connecté" }, 409);
  try {
    const repos = await github("/user/repos?per_page=100&sort=updated&direction=desc", decryptToken(connection));
    return json({
      repos: (repos || []).filter(r => !r.archived && !r.disabled && r.permissions?.push).map(r => ({
        id: r.id, full_name: r.full_name, name: r.name, private: r.private,
        default_branch: r.default_branch, html_url: r.html_url
      }))
    });
  } catch (error) {
    return json({ error: error.message }, 502);
  }
};
