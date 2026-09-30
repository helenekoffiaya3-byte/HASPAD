import { admin, json } from "./_credits.js";

const env = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name];

function payloadFrom(req, body) {
  return body?.payload || body || {};
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });
  const expected = env("NETLIFY_WEBHOOK_SECRET");
  const token = new URL(req.url).searchParams.get("token");
  if (!expected || !token || token !== expected) return json(401, { error: "UNAUTHORIZED_WEBHOOK" });

  const body = await req.json().catch(() => null);
  const event = payloadFrom(req, body);
  const deploy = event?.deploy || event?.data?.deploy || event;
  const deployId = String(deploy?.id || deploy?.deploy_id || "");
  if (!deployId) return json(400, { error: "DEPLOY_ID_REQUIRED" });

  const build = (await admin.from("project_builds").select("id,status,refunded_at,netlify_deploy_id").eq("netlify_deploy_id", deployId).maybeSingle()).data;
  if (!build) return json(200, { success: true, ignored: true, reason: "DEPLOY_NOT_TRACKED" });

  const state = String(deploy?.state || "error").toLowerCase();
  const message = String(deploy?.error_message || deploy?.errorMessage || "NETLIFY_DEPLOY_FAILED").slice(0, 1000);
  if (state === "error" || event?.event === "deploy_failed") {
    const result = await admin.rpc("fail_build_and_refund", { p_build_id: build.id, p_error: message });
    if (result.error) return json(500, { error: "REFUND_FAILED" });
    return json(200, { success: true, refunded: true, buildId: build.id, result: result.data });
  }

  return json(200, { success: true, ignored: true, state });
};

export const config = { path: "/api/netlify-deploy-hook" };
