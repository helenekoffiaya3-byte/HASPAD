import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";
import { githubConnection } from "./_github.js";

const env = (name) => globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
const GH = "https://api.github.com";

async function gh(path, token) {
  const r = await fetch(GH + path, {
    headers: {
      authorization: "Bearer " + token,
      accept: "application/vnd.github+json",
      "x-github-api-version": env("GITHUB_API_VERSION") || "2022-11-28"
    }
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || "GITHUB_API_ERROR");
  return d;
}

const important = (path) => {
  const p = path.toLowerCase();
  return /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|bun\.lockb?|requirements\.txt|pyproject\.toml|poetry\.lock|pipfile|go\.mod|cargo\.toml|composer\.json|gemfile|dockerfile|docker-compose\.ya?ml|netlify\.toml|vercel\.json|vite\.config\.[cm]?[jt]sx?|next\.config\.[cm]?[jt]s|nuxt\.config\.[cm]?[jt]s|astro\.config\.[cm]?[jt]s|angular\.json|svelte\.config\.[cm]?[jt]s|\.nvmrc|\.node-version|README(?:\.md)?|USAGE\.md|Makefile|\.env\.example)$/i.test(path)
    || /(^|\/)(apps|packages|frontend|web|client|server|backend)\/package\.json$/i.test(path);
};

async function readTextFile(owner, name, path, branch, token) {
  try {
    const q = await gh("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name) +
      "/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(branch), token);
    if (!q.content || q.encoding !== "base64") return "";
    const raw = Buffer.from(q.content, "base64").toString("utf8");
    return raw.slice(0, 120000);
  } catch {
    return "";
  }
}

function safeCommand(command) {
  const c = String(command || "").trim();
  if (!c) return true;
  if (c.length > 300) return false;
  return /^[A-Za-z0-9_./:@%+?=,-]+(?:\s+[A-Za-z0-9_./:@%+?=,-]+)*$/.test(c);
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });
  const user = await getUser();
  if (!user) return json(401, { error: "Unauthorized" });

  const body = await req.json().catch(() => null);
  const siteId = String(body?.siteId || "");
  const owner = String(body?.repositoryOwner || "");
  const name = String(body?.repositoryName || "");
  const branch = String(body?.branch || "");
  if (!siteId || !owner || !name || !branch) {
    return json(400, { error: "siteId, repositoryOwner, repositoryName et branch requis." });
  }

  const site = (await admin.from("sites").select("id,user_id").eq("id", siteId).maybeSingle()).data;
  if (!site || String(site.user_id) !== String(user.id)) return json(403, { error: "Forbidden" });

  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return json(503, { error: "OPENAI_GATEWAY_NOT_READY" });

  try {
    const connection = await githubConnection(user.id);
    if (!connection?.token) return json(400, { error: "GITHUB_NOT_CONNECTED" });

    const tree = await gh("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name) +
      "/git/trees/" + encodeURIComponent(branch) + "?recursive=1", connection.token);
    const files = (tree.tree || []).filter(x => x.type === "blob" && x.path).map(x => x.path).filter(x => x.length <= 300);
    const selected = files.filter(important).slice(0, 120);
    const rootFiles = new Set(files.filter(p => !p.includes("/")));
    const recognized = ["package.json","requirements.txt","pyproject.toml","Dockerfile","docker-compose.yml","docker-compose.yaml","index.html","go.mod","composer.json"].filter(x => rootFiles.has(x));
    if (tree.truncated) return json(422, { error: "REPOSITORY_TREE_TRUNCATED", deployable: false, blockers: ["L'arborescence GitHub est trop volumineuse pour une prévalidation sûre."] });
    if (!recognized.length) return json(422, { error: "UNSUPPORTED_PROJECT", deployable: false, blockers: ["Aucun manifeste de projet reconnu à la racine du dépôt."] });

    const contents = {};
    for (const path of selected) {
      contents[path] = await readTextFile(owner, name, path, branch, connection.token);
    }

    const evidence = {
      repository: owner + "/" + name,
      branch,
      completeFileInventory: files,
      importantFiles: contents
    };

    const instructions = `You are HASPAD's deployment-command detector. Inspect the supplied Git repository evidence and determine the exact build command that the repository itself expects for deployment on Netlify.

Return ONLY JSON:
{
  "name": "string",
  "command": "string",
  "commandRequired": true,
  "framework": "string|null",
  "runtime": "node|python|docker|static|other",
  "baseDirectory": "string",
  "publishDirectory": "string",
  "confidence": "high|medium|low",
  "evidence": ["path: exact relevant evidence"],
  "notes": ["string"]
}

Rules:
- The user MUST NOT type or describe the build command. You determine it from repository evidence.
- Prefer an explicit repository script/config over guesses. For Node inspect package.json scripts and workspace/monorepo manifests. Respect pnpm/yarn/bun lockfiles when they determine the package manager.
- Inspect netlify.toml when present; its build.command is authoritative unless repository structure proves it invalid.
- For Next.js use the repository's actual package scripts/config, not a generic command if an explicit script exists.
- For Python, inspect project metadata and documented build scripts; do not invent a build command when the project is runtime-only.
- For Docker, report the repository's Docker build/start strategy; Netlify itself cannot execute arbitrary Docker hosting, so mark notes accordingly.
- For static sites with no build step, command may be an empty string and commandRequired must be false.
- Never invent a command solely from a framework name when repository evidence is available.
- Do not include shell chaining, redirects, command substitution, destructive commands, secrets, or arbitrary user-provided commands.
- The command must be safe for a Netlify build command and use only normal package/build tools visible in the repository evidence.
- "exact" means the command actually indicated by repository configuration, not a generic recommendation.`;

    const response = await fetch(env("OPENAI_BASE_URL") || "https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model: env("CHATGPT_MODEL") || "gpt-5.6-luna",
        instructions,
        input: JSON.stringify(evidence)
      })
    });
    if (!response.ok) return json(502, { error: "OPENAI_AGENT_FAILED" });

    const raw = await response.json();
    const output = String(raw.output_text || "").replace(/^\`\`\`json\s*/i, "").replace(/\s*\`\`\`$/i, "");
    const result = JSON.parse(output);
    if (!safeCommand(result.command)) return json(422, { error: "AI_COMMAND_INVALID" });
    if (!result.name) result.name = name;
    result.repository = { owner, name, branch };
    result.analyzedFiles = files.length;
    result.analyzedImportantFiles = selected.length;
    const blockers = [];
    if (!result.runtime || result.runtime === "other") blockers.push("Type de projet non pris en charge automatiquement.");
    if (["docker","docker-compose"].includes(String(result.runtime))) blockers.push("Le runtime Docker doit être envoyé vers une cible Docker, pas vers le build Netlify standard.");
    if (result.commandRequired && !String(result.command || "").trim()) blockers.push("Aucune commande de build sûre n'a pu être déterminée.");
    if (result.confidence === "low") blockers.push("La détection de configuration est trop incertaine pour autoriser un déploiement automatique.");
    if (String(result.command || "").includes(".env")) blockers.push("La commande détectée ne doit pas référencer un fichier secret.");
    result.preflight = { branchResolved: true, repositoryReadable: true, recognizedRootFiles: recognized, blockers, deployable: blockers.length === 0 };
    result.deployable = result.preflight.deployable;

    await admin.from("ai_activity_logs").insert({
      site_id: siteId,
      agent_name: "chatgpt-deployment-detector",
      action_taken: "DEPLOYMENT_COMMAND_DETECTION",
      details: {
        repository: owner + "/" + name,
        branch,
        command: result.command || null,
        model: env("CHATGPT_MODEL") || "gpt-5.6-luna",
        analyzed_files: files.length
      }
    });

    return json(200, { success: true, ...result });
  } catch (error) {
    console.error("deployment-analyze", error?.message || error);
    return json(502, { error: "DEPLOYMENT_ANALYSIS_FAILED" });
  }
};
