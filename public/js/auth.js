import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
const config = await fetch("/api/config").then(r => r.json());
export const sb = createClient(config.supabaseUrl, config.supabasePublishableKey);
const sessionResult = await sb.auth.getSession();
const session = sessionResult.data.session;
const path = location.pathname;
if (session && (path === "/" || path === "/index.html")) location.replace("/dashboard.html");
if (!session && (path === "/dashboard.html" || path === "/project.html")) location.replace("/");
document.querySelector("#google")?.addEventListener("click", async () => {
  const result = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + "/dashboard.html" }
  });
  if (result.error) document.querySelector("#message").textContent = result.error.message;
});
document.querySelector("#logout")?.addEventListener("click", async () => {
  await sb.auth.signOut();
  location.replace("/");
});
