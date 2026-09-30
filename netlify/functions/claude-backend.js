import Anthropic from "@anthropic-ai/sdk";
import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";

const env = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
const safe = (value, max = 30000) => String(value ?? "").slice(0, max);

const SYSTEM = `You are the HASPAD Backend Agent.
You own backend engineering review: security, authentication, authorization, data integrity,
credits, GitHub integration, CI, Netlify Functions, deployment reliability and operational safety.
Do not invent evidence. Do not expose secrets. Do not execute or propose arbitrary privileged
SQL/shell operations. Treat AI-generated code and browser input as untrusted.
Return a concise structured engineering report with findings, evidence, fixes/recommendations,
tests and remaining blockers.`;

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  const user = await getUser();
  if (!user) return json(401, { error: "Unauthorized" });

  const body = await req.json().catch(() => null);
  if (!body?.buildId) return json(400, { error: "buildId requis." });

  const build = (await admin
    .from("project_builds")
    .select("*")
    .eq("id", String(body.buildId))
    .maybeSingle()).data;

  if (!build || String(build.user_id) !== String(user.id)) {
    return json(404, { error: "BUILD_NOT_FOUND" });
  }

  const apiKey = env("ANTHROPIC_API_KEY");
  const baseURL = env("ANTHROPIC_BASE_URL");
  if (!apiKey || !baseURL) {
    return json(503, { error: "CLAUDE_GATEWAY_NOT_READY" });
  }

  const model = env("CLAUDE_MODEL") || "claude-sonnet-5-5";

  try {
    const client = new Anthropic({ apiKey, baseURL });
    const prompt = [
      "Audit backend HASPAD avec les éléments suivants.",
      "Logs:\n" + safe(body.logs),
      "Repository context:\n" + safe(body.repoContext, 20000),
      "Changed files:\n" + safe(body.changedFiles, 20000),
      "Configuration:\n" + safe(body.config, 15000),
      "CI result:\n" + safe(body.ciResult, 10000),
      "Deployment result:\n" + safe(body.deploymentResult, 10000)
    ].join("\n\n");

    const message = await client.messages.create({
      model,
      max_tokens: 5000,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }]
    });

    const report = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");

    const { error: logError } = await admin.from("ai_activity_logs").insert({
      site_id: build.site_id,
      agent_name: "claude-backend",
      action_taken: "BACKEND_AUDIT",
      details: {
        build_id: build.id,
        model,
        report
      }
    });

    if (logError) console.error("claude-backend log", logError);

    return json(200, { success: true, agent: "claude-backend", model, report });
  } catch (error) {
    console.error("claude-backend", error?.message || error);
    return json(502, { error: "CLAUDE_AGENT_FAILED" });
  }
};
