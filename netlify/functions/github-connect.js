import { getUser } from "@netlify/identity";
import { signedState } from "./_github.js";

export default async (req) => {
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const clientId = globalThis.Netlify?.env?.get?.("GITHUB_CLIENT_ID");
  const redirectUri = globalThis.Netlify?.env?.get?.("GITHUB_OAUTH_REDIRECT_URI") || "https://haspad.com/.netlify/functions/github-callback";
  if (!clientId) return new Response("GitHub OAuth n'est pas configuré.", { status: 503 });
  const state = signedState(user.id);
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, scope: "repo read:user user:email", allow_signup: "true" });
  const headers = new Headers({ location: "https://github.com/login/oauth/authorize?" + params.toString() });
  headers.append("set-cookie", "haspad_github_state=" + encodeURIComponent(state) + "; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax");
  return new Response(null, { status: 302, headers });
};
