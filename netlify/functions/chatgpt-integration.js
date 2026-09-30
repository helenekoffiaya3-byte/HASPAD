import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";

const env = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name];

const SYSTEM = `You are the HASPAD ChatGPT Integration and Repair Agent.
Your job is to connect the user's frontend, buttons, forms, functions, APIs, backend, data layer,
environment configuration and build/deployment configuration, and to prevent avoidable build failures.

Return ONLY valid JSON:
{
  "status": "PASS" | "REPAIR_REQUIRED" | "BLOCKED",
  "integrationMap": [{"ui": string, "handler": string, "api": string, "backend": string, "data": string}],
  "errors": [{"severity": "error" | "warning", "file": string, "message": string, "evidence": string}],
  "fixes": [{"file": string, "reason": string, "replacement": string}],
  "checks": [{"name": string, "result": "pass" | "fail" | "unknown", "evidence": string}],
  "buildCommand": string,
  "notes": string[]
}

Rules:
- Use only supplied repository/build evidence; never invent evidence.
- Detect missing button handlers, wrong API paths, HTTP method mismatches, missing imports/exports,
  invalid environment references and frontend/backend contract mismatches.
- Detect likely build failures from syntax, dependency, runtime and configuration evidence.
- Fixes must be minimal and concrete.
- Never output credentials, access tokens, private keys or secret values.
- Never propose destructive shell/SQL commands.
- Do not declare PASS when a required check is unknown.
- This agent reports corrections; HASPAD must validate and execute them deterministically.`;

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  const user = await getUser();
  if (!user) return json(401, { error: "Unauthorized" });

  const body = await req.json().catch(() => null);
  if (!body?.buildId) return json(400, { error: "buildId requis." });

  const build = (await admin.from("project_builds")
    .select("*").eq("id", String(body.buildId)).maybeSingle()).data;

  if (!build || String(build.user_id) !== String(user.id)) {
    return json(404, { error: "BUILD_NOT_FOUND" });
  }

  const apiKey = env("OPENAI_API_KEY");
  const baseURL = env("OPENAI_BASE_URL");
  if (!apiKey) return json(503, { error: "CHATGPT_GATEWAY_NOT_READY" });

  const evidence = JSON.stringify({
    request: String(body.request || "").slice(0, 20000),
    repository: String(body.repository || "").slice(0, 50000),
    files: String(body.files || "").slice(0, 100000),
    buildLogs: String(body.buildLogs || "").slice(0, 50000),
    testResults: String(body.testResults || "").slice(0, 30000),
    envKeys: String(body.envKeys || "").slice(0, 20000),
    deployment: String(body.deployment || "").slice(0, 20000)
  });

  try {
    const response = await fetch(baseURL || "https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: env("CHATGPT_MODEL") || "gpt-5.6-luna",
        instructions: SYSTEM,
        input: evidence
      })
    });

    if (!response.ok) {
      console.error("chatgpt-integration", response.status);
      return json(502, { error: "CHATGPT_AGENT_FAILED" });
    }

    const data = await response.json();
    const textOutput = data.output_text || "";
    const parsed = JSON.parse(textOutput.replace(/^\`\`\`json\s*/i, "").replace(/\s*\`\`\`$/i, ""));

    const { error: logError } = await admin.from("ai_activity_logs").insert({
      site_id: build.site_id,
      agent_name: "chatgpt-integration",
      action_taken: "INTEGRATION_REPAIR_AUDIT",
      details: { build_id: build.id, model: env("CHATGPT_MODEL") || "gpt-5.6-luna", status: parsed.status }
    });
    if (logError) console.error("chatgpt-integration log", logError);

    return json(200, { success: true, agent: "chatgpt-integration", result: parsed });
  } catch (error) {
    console.error("chatgpt-integration", error?.message || error);
    return json(422, { error: "CHATGPT_AGENT_FAILED" });
  }
};

export const config = { path: "/api/integration/check" };
