import {
  json, db, requireEnv, logDeployment, githubConnection, decryptToken, snapshot,
  context, gemini, claude, openai, parseJson, validateFiles, github, netlifyApi,
  waitForNetlifyDeploy, FILES_JSON_SCHEMA
} from "./_lib.mjs";

export const config = { background: true };

const AUDIT_SCHEMA = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
    reason: { type: "string" },
    frontend_errors: { type: "array", items: { type: "string" } },
    backend_errors: { type: "array", items: { type: "string" } }
  },
  required: ["approved", "reason", "frontend_errors", "backend_errors"],
  additionalProperties: false
};

const KIT_PATHS = [
  "HASPAD.md",
  ".haspad/agents.md",
  ".haspad/architecture.md",
  ".haspad/design.md",
  ".haspad/requirements.md",
  ".haspad/deployment.md"
];

const readKit = async (owner, repo, branch, token) => {
  const result = {};
  for (const path of KIT_PATHS) {
    const file = await github(
      "/repos/" + owner + "/" + repo + "/contents/" + path + "?ref=" + encodeURIComponent(branch),
      token
    );
    result[path] = Buffer.from(file.content || "", "base64").toString("utf8");
  }
  return result;
};

const mergeFiles = (...groups) => {
  const map = new Map();
  for (const group of groups) for (const file of group || []) map.set(file.path, file);
  return [...map.values()];
};

async function provisionNetlify(project) {
  const domain = String(project.site_url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  let site = null;

  if (project.netlify_site_id) {
    site = await netlifyApi("/sites/" + encodeURIComponent(project.netlify_site_id));
  } else {
    try {
      site = await netlifyApi("/sites/" + encodeURIComponent(project.site_slug));
    } catch {}
    if (!site) {
      site = await netlifyApi("/sites", {
        method: "POST",
        body: JSON.stringify({
          name: project.site_slug,
          custom_domain: domain,
          force_ssl: true,
          repo: {
            provider: "github",
            repo_path: project.repo_owner + "/" + project.repo_name,
            repo_branch: project.deploy_branch
          }
        })
      });
    }
  }

  if (!site.custom_domain || site.custom_domain !== domain) {
    site = await netlifyApi("/sites/" + encodeURIComponent(site.id), {
      method: "PATCH",
      body: JSON.stringify({
        custom_domain: domain,
        force_ssl: true,
        repo: {
          provider: "github",
          repo_path: project.repo_owner + "/" + project.repo_name,
          repo_branch: project.deploy_branch
        }
      })
    });
  }

  let hookUrl = project.netlify_build_hook_url || null;
  if (!hookUrl) {
    const hook = await netlifyApi("/sites/" + encodeURIComponent(site.id) + "/build_hooks", {
      method: "POST",
      body: JSON.stringify({ title: "HASPАD AI fallback", branch: project.default_branch })
    });
    hookUrl = hook.url;
  }

  return { site, hookUrl };
}

async function pushValidatedFiles(project, token, files) {
  const refPath = "/repos/" + project.repo_owner + "/" + project.repo_name + "/git/ref/heads/" + encodeURIComponent(project.deploy_branch);
  const ref = await github(refPath, token);
  const parentSha = ref.object.sha;
  const parent = await github(
    "/repos/" + project.repo_owner + "/" + project.repo_name + "/git/commits/" + parentSha,
    token
  );

  const tree = files.map(file =>
    file.action === "delete"
      ? { path: file.path, mode: "100644", type: "blob", sha: null }
      : { path: file.path, mode: "100644", type: "blob", content: file.content }
  );

  const newTree = await github(
    "/repos/" + project.repo_owner + "/" + project.repo_name + "/git/trees",
    token,
    { method: "POST", body: JSON.stringify({ base_tree: parent.tree.sha, tree }) }
  );

  const commit = await github(
    "/repos/" + project.repo_owner + "/" + project.repo_name + "/git/commits",
    token,
    {
      method: "POST",
      body: JSON.stringify({
        message: "feat: HASPAD validated AI build",
        tree: newTree.sha,
        parents: [parentSha]
      })
    }
  );

  await github(refPath, token, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false })
  });

  return commit.sha;
}

async function fallbackNetlify(project) {
  if (!project.netlify_build_hook_url) return false;
  const hook = new URL(project.netlify_build_hook_url);\n  hook.searchParams.set("trigger_branch", project.deploy_branch || "haspad/deploy");\n  hook.searchParams.set("trigger_title", "HASPАD fallback — dernière version stable");\n  const response = await fetch(hook, { method: "POST" });
  return response.ok;
}

export default async req => {
  if (req.headers.get("x-haspad-internal") !== process.env.INTERNAL_JOB_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const deploymentId = body.deploymentId;
  if (!deploymentId) return json({ error: "deploymentId requis" }, 400);

  try {
    requireEnv("INTERNAL_JOB_SECRET");

    const client = db();
    const depResult = await client
      .from("deployments")
      .select("*,projects(*)")
      .eq("id", deploymentId)
      .single();
    if (depResult.error) throw depResult.error;

    const dep = depResult.data;
    const project = dep.projects;
    const connection = await githubConnection(dep.user_id);
    if (!connection) throw new Error("GitHub non connecté");

    const token = decryptToken(connection);
    const owner = project.repo_owner;
    const repo = project.repo_name;
    const branch = project.deploy_branch || "haspad/deploy";

    await logDeployment(
      dep.id,
      { status: "netlify_provisioning", current_step: "Infrastructure — Préparation du site" },
      "Préparation de l'infrastructure Netlify et du fallback.",
      { agent: "HASPАD", target: "Netlify" }
    );

    const provisioned = await provisionNetlify(project);
    project.netlify_site_id = provisioned.site.id;
    project.netlify_build_hook_url = provisioned.hookUrl;

    await client.from("projects").update({
      netlify_site_id: provisioned.site.id,
      netlify_build_hook_url: provisioned.hookUrl,
      deploy_branch: branch
    }).eq("id", project.id);

    await logDeployment(
      dep.id,
      { netlify_site_id: provisioned.site.id },
      "Site réservé : " + (provisioned.site.ssl_url || provisioned.site.url || project.site_url),
      { agent: "Netlify", target: "Infrastructure" }
    );

    const kit = await readKit(owner, repo, project.default_branch, token);
    const snap = await snapshot(owner, repo, branch, token);
    const knownPaths = new Set(snap.knownPaths);
    const kitContext = KIT_PATHS.map(path => "===== " + path + " =====\n" + kit[path]).join("\n");
    const repositoryContext = context(snap.files);

    let finalFiles = [];
    let frontendFiles = [];
    let backendFiles = [];
    let validated = false;
    const MAX_RETRIES = 3;

    await logDeployment(
      dep.id,
      { status: "gemini_processing", current_step: "Gemini — Interface" },
      "Lecture du contexte et génération frontend.",
      { agent: "Gemini", target: "Frontend" }
    );

    const geminiResult = parseJson(await gemini(
      "Tu es l'agent Frontend de HASPAD. " +
      "Lis attentivement le contexte HASPAD fourni. Inspecte le dépôt existant. " +
      "Construis ou corrige uniquement l'interface, l'UX, les pages, styles, composants client et navigation nécessaires. " +
      "Respecte requirements.md. Ne touche ni aux secrets, ni aux workflows GitHub, ni au backend sans nécessité. " +
      "Retourne UNIQUEMENT le JSON demandé par le schéma.",
      kitContext + "\n\nDÉPÔT ACTUEL :\n" + repositoryContext
    ), FILES_JSON_SCHEMA);

    frontendFiles = validateFiles(geminiResult, knownPaths);
    frontendFiles.forEach(file => file.action === "delete" ? knownPaths.delete(file.path) : knownPaths.add(file.path));

    await logDeployment(
      dep.id,
      { status: "claude_processing", current_step: "Claude — Fonctionnement" },
      "Gemini terminé. Claude prend en charge la logique.",
      { agent: "Claude", target: "Backend" }
    );

    const claudeResult = parseJson(await claude(
      "Tu es l'agent Backend de HASPAD. " +
      "Lis HASPAD.md, architecture.md, requirements.md et deployment.md. " +
      "Construis ou corrige uniquement la logique serveur, API, données et intégrations nécessaires. " +
      "Respecte les changements frontend fournis et ne touche pas aux secrets/workflows. " +
      "Retourne UNIQUEMENT un JSON de la forme {files:[{path,action,content}],summary}.",
      kitContext + "\n\nDÉPÔT ACTUEL :\n" + repositoryContext +
      "\n\nCHANGEMENTS GEMINI :\n" + JSON.stringify(frontendFiles)
    ));

    backendFiles = validateFiles(claudeResult, knownPaths);
    backendFiles.forEach(file => file.action === "delete" ? knownPaths.delete(file.path) : knownPaths.add(file.path));
    finalFiles = mergeFiles(frontendFiles, backendFiles);

    for (let attempt = 1; attempt <= MAX_RETRIES && !validated; attempt++) {
      await logDeployment(
        dep.id,
        { status: "chatgpt_verifying", current_step: "ChatGPT — Audit " + attempt + "/" + MAX_RETRIES },
        "Audit de sécurité, fonctionnalités et build.",
        { agent: "ChatGPT", target: "Audit", attempt }
      );

      const audit = parseJson(await openai(
        "Tu es l'auditeur final de HASPAD. Vérifie strictement requirements.md, architecture.md, design.md et deployment.md. " +
        "Inspecte le dépôt et les modifications proposées. Recherche régressions, secrets exposés, routes cassées, erreurs de build et fonctionnalités manquantes. " +
        "Si tout est correct, approved=true. Sinon classe précisément les erreurs frontend/backend. " +
        "Retourne UNIQUEMENT le JSON demandé.",
        kitContext + "\n\nDÉPÔT :\n" + repositoryContext +
        "\n\nMODIFICATIONS PROPOSÉES :\n" + JSON.stringify(finalFiles),
        AUDIT_SCHEMA
      ));

      if (audit.approved && !(audit.frontend_errors?.length) && !(audit.backend_errors?.length)) {
        validated = true;
        break;
      }

      if (attempt === MAX_RETRIES) break;

      if (audit.frontend_errors?.length) {
        await logDeployment(
          dep.id,
          { status: "gemini_correcting", current_step: "Gemini — Correction " + attempt + "/" + MAX_RETRIES },
          audit.frontend_errors.join(" | "),
          { agent: "ChatGPT", target: "Gemini", attempt, status: "error" }
        );
        const corrected = parseJson(await gemini(
          "Tu es Gemini en correction ciblée. Répare UNIQUEMENT les erreurs frontend listées. " +
          "Utilise le code actuel fourni. Ne réécris pas ce qui fonctionne. JSON uniquement.",
          kitContext + "\n\nERREURS :\n" + audit.frontend_errors.join("\n") +
          "\n\nCODE ACTUEL :\n" + JSON.stringify(finalFiles.filter(f => frontendFiles.some(g => g.path === f.path)))
        ), FILES_JSON_SCHEMA);
        const correctedFiles = validateFiles(corrected, knownPaths);
        frontendFiles = mergeFiles(frontendFiles, correctedFiles);
        correctedFiles.forEach(file => file.action === "delete" ? knownPaths.delete(file.path) : knownPaths.add(file.path));
      }

      if (audit.backend_errors?.length) {
        await logDeployment(
          dep.id,
          { status: "claude_correcting", current_step: "Claude — Correction " + attempt + "/" + MAX_RETRIES },
          audit.backend_errors.join(" | "),
          { agent: "ChatGPT", target: "Claude", attempt, status: "error" }
        );
        const corrected = parseJson(await claude(
          "Tu es Claude en correction ciblée. Répare UNIQUEMENT les erreurs backend listées. " +
          "Utilise le code actuel fourni. Ne réécris pas ce qui fonctionne. JSON uniquement.",
          kitContext + "\n\nERREURS :\n" + audit.backend_errors.join("\n") +
          "\n\nCODE ACTUEL :\n" + JSON.stringify(finalFiles.filter(f => backendFiles.some(g => g.path === f.path)))
        ));
        const correctedFiles = validateFiles(corrected, knownPaths);
        backendFiles = mergeFiles(backendFiles, correctedFiles);
        correctedFiles.forEach(file => file.action === "delete" ? knownPaths.delete(file.path) : knownPaths.add(file.path));
      }

      finalFiles = mergeFiles(frontendFiles, backendFiles);

      await logDeployment(
        dep.id,
        {},
        "Corrections appliquées. Nouveau passage d'audit.",
        { agent: "HASPАD", target: "Audit", attempt, status: "fixed" }
      );
    }

    if (!validated) {
      throw new Error("Validation IA refusée après " + MAX_RETRIES + " cycles.");
    }

    await logDeployment(
      dep.id,
      { status: "github_pushing", current_step: "GitHub — Push validé", branch_name: branch },
      "Validation finale réussie. Envoi du code validé vers la branche de déploiement.",
      { agent: "HASPАD", target: "GitHub" }
    );

    const commitSha = await pushValidatedFiles(project, token, finalFiles);

    await client.from("deployments").update({
      status: "testing",
      current_step: "Netlify — Vérification du déploiement",
      branch_name: branch,
      commit_sha: commitSha,
      netlify_site_id: provisioned.site.id
    }).eq("id", dep.id);

    const deployed = await waitForNetlifyDeploy(provisioned.site.id);
    if (deployed.deploy?.id) {
      await client.from("deployments").update({ netlify_deploy_id: deployed.deploy.id }).eq("id", dep.id);
    }

    await logDeployment(
      dep.id,
      { status: "completed", current_step: "Terminé" },
      deployed.timedOut
        ? "Code validé et poussé. Netlify poursuit son build."
        : "Code validé et déployé depuis la branche GitHub.",
      { agent: "HASPАD", target: "GitHub → Netlify", status: "success" }
    );
  } catch (error) {
    try {
      const client = db();
      const depResult = await client.from("deployments").select("*,projects(*)").eq("id", deploymentId).single();
      const project = depResult.data?.projects;
      let fallback = false;
      if (project?.netlify_build_hook_url) fallback = await fallbackNetlify(project);
      await logDeployment(
        deploymentId,
        { status: fallback ? "fallback" : "failed", current_step: fallback ? "Fallback Netlify" : "Erreur", error: error.message },
        fallback
          ? "Pipeline IA interrompu. Aucun code instable n'a été poussé. Netlify redéploie la dernière version stable."
          : error.message,
        { agent: "HASPАD", target: fallback ? "Netlify fallback" : "Pipeline", status: "error" }
      );
    } catch {}
  }

  return new Response("", { status: 202 });
};
