import Anthropic from "@anthropic-ai/sdk";
import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";

const env = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
const MAX_FILES = 80;
const MAX_FILE_BYTES = 120000;
const MAX_TOTAL_BYTES = 2000000;

const SYSTEM = `You are the HASPAD Backend Builder.
Build the backend required by a user's application. The generated backend is untrusted until
HASPAD validates and tests it.

Return ONLY valid JSON:
{
  "projectType": "node" | "python" | "docker",
  "framework": string,
  "files": [{"path": string, "content": string}],
  "env": [{"key": string, "required": boolean, "secret": boolean, "description": string}],
  "endpoints": [{"method": string, "path": string, "description": string}],
  "tests": [{"path": string, "content": string}],
  "notes": string[]
}

Rules:
- Generate a complete, runnable backend, not pseudocode.
- Never include real credentials, tokens, private keys, or secrets.
- Never generate destructive shell commands, arbitrary SQL execution, crypto-mining, malware,
  credential theft, surveillance, or code whose primary purpose is bypassing authorization.
- Validate request input and enforce authentication/authorization where the requested feature needs it.
- Use parameterized database access.
- Keep secrets in environment variables.
- Keep the backend compatible with the requested runtime.
- If the user asks for an API, include health/status and error handling.
- Tests must be deterministic and runnable by HASPAD's build pipeline.
- Do not claim an integration exists unless it is represented by generated code/configuration.`;

const forbiddenPath = (p) =>
  !p || p.startsWith("/") || p.includes("..") || p.includes("\\") ||
  p.includes(".env") || p.includes(".git/") || p.includes("node_modules/");

function validate(result) {
  if (!result || !Array.isArray(result.files) || result.files.length < 1 ||
      result.files.length > MAX_FILES) throw new Error("INVALID_BACKEND_MANIFEST");

  let total = 0;
  for (const file of result.files) {
    if (typeof file.path !== "string" || typeof file.content !== "string" || forbiddenPath(file.path)) {
      throw new Error("INVALID_BACKEND_PATH");
    }
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > MAX_FILE_BYTES) throw new Error("BACKEND_FILE_TOO_LARGE");
    total += bytes;
  }
  if (total > MAX_TOTAL_BYTES) throw new Error("BACKEND_OUTPUT_TOO_LARGE");

  result.env = Array.isArray(result.env) ? result.env : [];
  result.endpoints = Array.isArray(result.endpoints) ? result.endpoints : [];
  result.tests = Array.isArray(result.tests) ? result.tests : [];
  result.notes = Array.isArray(result.notes) ? result.notes : [];
  return result;
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  const user = await getUser();
  if (!user) return json(401, { error: "Unauthorized" });

  const body = await req.json().catch(() => null);
  if (!body?.buildId || !body?.prompt) {
    return json(400, { error: "buildId et prompt sont requis." });
  }

  const build = (await admin.from("project_builds")
    .select("*").eq("id", String(body.buildId)).maybeSingle()).data;

  if (!build || String(build.user_id) !== String(user.id)) {
    return json(404, { error: "BUILD_NOT_FOUND" });
  }

  const apiKey = env("ANTHROPIC_API_KEY");
  const baseURL = env("ANTHROPIC_BASE_URL");
  if (!apiKey || !baseURL) return json(503, { error: "CLAUDE_GATEWAY_NOT_READY" });

  const model = env("CLAUDE_MODEL") || "claude-sonnet-5-5";

  try {
    const client = new Anthropic({ apiKey, baseURL });
    const userContext = JSON.stringify({
      prompt: String(body.prompt).slice(0, 30000),
      projectType: String(body.projectType || "auto"),
      runtime: String(body.runtime || "netlify"),
      frontendContext: String(body.frontendContext || "").slice(0, 20000),
      existingBackend: String(body.existingBackend || "").slice(0, 20000)
    });

    const message = await client.messages.create({
      model,
      max_tokens: 12000,
      system: SYSTEM,
      messages: [{ role: "user", content: userContext }]
    });

    const raw = message.content.filter((p) => p.type === "text").map((p) => p.text).join("\n").trim();
    const jsonText = raw.replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/i, "");
    const generated = validate(JSON.parse(jsonText));

    const { error: logError } = await admin.from("ai_activity_logs").insert({
      site_id: build.site_id,
      agent_name: "claude-backend-builder",
      action_taken: "BACKEND_GENERATION",
      details: {
        build_id: build.id,
        model,
        project_type: generated.projectType,
        framework: generated.framework,
        file_count: generated.files.length,
        endpoint_count: generated.endpoints.length
      }
    });
    if (logError) console.error("claude-backend-builder log", logError);

    return json(200, {
      success: true,
      agent: "claude-backend-builder",
      model,
      backend: generated
    });
  } catch (error) {
    console.error("claude-backend-builder", error?.message || error);
    return json(422, { error: "BACKEND_GENERATION_FAILED" });
  }
};

export const config = { path: "/api/backend/generate" };
