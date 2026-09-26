import { json, requireEnv, verifyState, encryptToken, db, github } from "./_lib.mjs";
export default async req => {
  try {
    requireEnv("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_OAUTH_REDIRECT_URI");
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) throw new Error("GitHub OAuth incomplet");
    const stateData = verifyState(state);
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: process.env.GITHUB_OAUTH_REDIRECT_URI
      })
    });
    const token = await tokenResponse.json();
    if (!token.access_token) throw new Error(token.error_description || "GitHub token unavailable");
    const gh = await github("/user", token.access_token);
    const encrypted = encryptToken(token.access_token);
    const result = await db().from("github_connections").upsert({
      user_id: stateData.userId,
      github_user_id: gh.id,
      github_login: gh.login,
      access_token_ciphertext: encrypted.ciphertext,
      access_token_iv: encrypted.iv,
      access_token_tag: encrypted.tag,
      token_expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null
    }, { onConflict: "user_id" });
    if (result.error) throw result.error;
    const target = (process.env.URL || url.origin) + "/dashboard.html?github=connected";
    return Response.redirect(target, 302);
  } catch (error) {
    const target = (process.env.URL || new URL(req.url).origin) + "/dashboard.html?github=error";
    return Response.redirect(target, 302);
  }
};
