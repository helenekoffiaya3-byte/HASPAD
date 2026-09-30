import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";

const env = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name];

const SYSTEM = `You are the HASPAD pre-deployment integration gate.
Your job is to detect and correct preventable integration failures before a user deployment.

Audit the supplied project evidence for:
- UI buttons/forms without a valid action;
- API/function paths that do not match;
- frontend/backend request and response mismatches;
- missing authentication/authorization;
- missing environment-variable declarations;
- missing pages/components;
- invalid build configuration;
- obvious syntax/dependency/runtime mismatches;
- backend endpoints not connected to the intended UI.

Return ONLY JSON:
{
  "status": "PASS" | "REPAIR_REQUIRED" | "BLOCKED",
  "integrationMap": [{"ui": string, "handler": string, "api": string, "backend": string, "data": string}],
  "errors": [{"severity": "error" | "warning", "file": string, "message": string, "evidence": string}],
  "fixes": [{"file": string, "reason": string, "replacement": string}],
  "checks": [{"name": string, "result": "pass" | "fail" | "unknown", "evidence": string}],
  "notes": string[]
}

Rules:
- Use only supplied evidence.
- Never invent a successful connection.
- Never expose secrets.
- Do not output destructive commands or arbitrary SQL.
- PASS is allowed only when required checks are supported by evidence.
- Prefer the smallest safe correction.
- If source code needed for a definitive answer is missing, report unknown rather than guessing.`;

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  const user = await getUser();
  if (!user) return json(401, { error: "Unauthorized" });

  const body = await req.json().catch(() => null);
  if (!body?.siteId) return json(400, { error: "siteId requis." });

  const siteId = String(body.siteId);
  const { data: site } = await admin.from("sites")
    .select("id,name,netlify_site_id")
    .eq("id", siteId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!site) return json(403, { error: "Accès non autorisé à ce projet." });

  const [{ data: pages }, { data: components }, { data: build }] = await Promise.all([
    admin.from("pages").select("slug,root_block,seo").eq("site_id", siteId).limit(100),
    admin.from("site_components").select("page_id,component_type,identifier,design_props,position_index").eq("site_id", siteId).limit(500),
    admin.from("project_builds").select("id,status,error_message,version_tag,updated_at").eq("site_id", siteId).order("build_number",{ascending:false}).limit(1).maybeSingle()
  ]);

  const apiKey = env("CHATGPT_API_KEY") || env("OPENAI_API_KEY");
  if (!apiKey) return json(503, { error: "CHATGPT_GATEWAY_NOT_READY" });

  const evidence = JSON.stringify({
    site: { id: site.id, name: site.name, hasNetlifyTarget: Boolean(site.netlify_site_id) },
    pages: pages || [],
    components: components || [],
    latestBuild: build || null,
    frontendContext: String(body.frontendContext || "").slice(0, 50000),
    backendContext: String(body.backendContext || "").slice(0, 50000),
    routeContext: String(body.routeContext || "").slice(0, 30000),
    envKeys: String(body.envKeys || "").slice(0, 20000)
  });

  try {
    const response = await fetch(env("OPENAI_BASE_URL") || "https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: env("CHATGPT_MODEL") || "gpt-5.6-luna",
        instructions: SYSTEM,
        input: evidence
      })
    });

    if (!response.ok) return json(502, { error: "CHATGPT_GATEWAY_ERROR" });

    const data = await response.json();
    const raw = data.output_text || "";
    const result = JSON.parse(raw.replace(/^\`\`\`json\s*/i, "").replace(/\s*\`\`\`$/i, ""));

    await admin.from("ai_activity_logs").insert({
      site_id: siteId,
      agent_name: "chatgpt-integration",
      action_taken: "PRE_DEPLOYMENT_GATE",
      details: {
        model: env("CHATGPT_MODEL") || "gpt-5.6-luna",
        status: result.status,
        error_count: Array.isArray(result.errors) ? result.errors.length : 0,
        fix_count: Array.isArray(result.fixes) ? result.fixes.length : 0
      }
    });

    return json(200, { success: true, agent: "chatgpt-integration", result });
  } catch (error) {
    console.error("chatgpt-preflight", error?.message || error);
    return json(422, { error: "CHATGPT_PREFLIGHT_FAILED" });
  }
};

export const config = { path: "/api/integration/preflight" };
