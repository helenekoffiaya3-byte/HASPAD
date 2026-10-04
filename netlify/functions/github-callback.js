import { getUser } from "@netlify/identity";
import { saveGithubConnection, parseCookies, verifyState } from "./_github.js";

export default async (req) => {
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const user = await getUser(req);
  if (!user) return new Response("Session HASPAD absente ou expirée.", { status: 401 });
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return Response.redirect(new URL("/dashboard.html?github=error", url).toString(), 302);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(req);
  if (!code || !state || cookies.haspad_github_state !== state || !verifyState(state, user.id)) {
    return new Response("État OAuth GitHub invalide.", { status: 400 });
  }
  const clientId = globalThis.Netlify?.env?.get?.("GITHUB_CLIENT_ID");
  const clientSecret = globalThis.Netlify?.env?.get?.("GITHUB_CLIENT_SECRET");
  const redirectUri = globalThis.Netlify?.env?.get?.("GITHUB_OAUTH_REDIRECT_URI") || "https://haspad.com/.netlify/functions/github-callback";
  if (!clientId || !clientSecret) return new Response("GitHub OAuth n'est pas configuré.", { status: 503 });
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri })
  });
  const token = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !token.access_token) return new Response("Échec de l'autorisation GitHub.", { status: 502 });
  const meResponse = await fetch("https://api.github.com/user", {
    headers: { accept: "application/vnd.github+json", authorization: "Bearer " + token.access_token, "x-github-api-version": globalThis.Netlify?.env?.get?.("GITHUB_API_VERSION") || "2022-11-28" }
  });
  const me = await meResponse.json().catch(() => ({}));
  if (!meResponse.ok || !me.id || !me.login) return new Response("Impossible de récupérer le compte GitHub.", { status: 502 });
  await saveGithubConnection(user.id, { access_token: token.access_token, refresh_token: token.refresh_token, expires_in: token.expires_in, github_user_id: me.id, github_login: me.login });
  const headers = new Headers({ location: "/dashboard.html?github=connected" });
  headers.append("set-cookie", "haspad_github_state=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax");
  return new Response(null, { status: 302, headers });
};
