import { json, requireEnv, signState, userFromRequest } from "./_lib.mjs";
export default async req => {
  const user = await userFromRequest(req);
  if (!user) return json({ error: "Unauthorized" }, 401);
  requireEnv("GITHUB_CLIENT_ID", "GITHUB_OAUTH_REDIRECT_URI");
  const state = signState({ userId: user.id });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", process.env.GITHUB_OAUTH_REDIRECT_URI);
  url.searchParams.set("scope", "repo read:user");
  url.searchParams.set("state", state);
  return json({ url: url.toString() });
};
