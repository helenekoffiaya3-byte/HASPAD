import {
  json, db, requireEnv, logDeployment, githubConnection, decryptToken, snapshot,
  context, gemini, claude, openai, parseJson, validateFiles, github, netlifyApi,
  waitForNetlifyDeploy
} from "./_lib.mjs";

export const config = { background: true };

export default async req => {
  if (req.headers.get("x-haspad-internal") !== process.env.INTERNAL_JOB_SECRET) return json({ error: "Forbidden" }, 403);
  const body = await req.json().catch(() => ({}));
  const deploymentId = body.deploymentId;
  if (!deploymentId) return json({ error: "deploymentId requis" }, 400);

  try {
    requireEnv("INTERNAL_JOB_SECRET");
    const client = db();
    const depResult = await client.from("deployments").select("*,projects(*)").eq("id", deploymentId).single();
    if (depResult.error) throw depResult.error;
    const dep = depResult.data;
    const project = dep.projects;
    const connection = await githubConnection(dep.user_id);
    if (!connection) throw new Error("GitHub non connecté");
    const token = decryptToken(connection);
    const snap = await snapshot(project.repo_owner, project.repo_name, project.default_branch, token);
    const frontend = snap.files.filter(f => /\.(html?|css|scss|jsx|tsx|vue|svelte)$/i.test(f.path));
    const backend = snap.files.filter(f => /\.(js|mjs|cjs|ts|py|go|java|php|rb)$/i.test(f.path) || /^(package\.json|netlify\.toml|vercel\.json)$/.test(f.path));

    await logDeployment(dep.id, { status: "gemini_processing", current_step: "Gemini — Interface" }, "Analyse du frontend.");
    const geminiResult = parseJson(await gemini(
      "Tu es l'agent interface de HASPAD. Travaille sur un dépôt existant. Corrige uniquement ce qui est nécessaire pour pages, boutons et navigation. Ne touche ni aux secrets, ni aux workflows GitHub, ni aux dépendances sans nécessité. Retourne uniquement JSON avec files et summary. Format: {files:[{path,action,content}],summary}."
      + "\nDEPOT FRONTEND:\n" + context(frontend)
    ));
    const geminiFiles = validateFiles(geminiResult, snap.knownPaths);

    await logDeployment(dep.id, { status: "claude_processing", current_step: "Claude — Fonctionnement" }, "Gemini terminé. Passage au backend.");
    const claudeResult = parseJson(await claude(
      "Tu es l'agent backend de HASPAD. Construis uniquement le fonctionnement nécessaire: serveur, API, logique et redirections. Ne touche ni aux secrets ni aux workflows. Retourne uniquement JSON avec files et summary.",
      "DEPOT BACKEND:\n" + context(backend) + "\n\nMODIFICATIONS GEMINI:\n" + JSON.stringify(geminiFiles)
    ));
    const claudeFiles = validateFiles(claudeResult, snap.knownPaths);

    await logDeployment(dep.id, { status: "chatgpt_verifying", current_step: "ChatGPT — Inspection" }, "Audit final.");
    const audit = parseJson(await openai(
      "Tu es l'auditeur final de HASPAD. Vérifie les changements contre le dépôt original. Empêche les régressions. Corrige uniquement les erreurs nécessaires. Ne touche ni aux secrets, ni aux workflows GitHub, ni aux fichiers sans rapport. Retourne JSON: approved, reason, files.",
      "DEPOT ORIGINAL:\n" + context(snap.files) + "\n\nGEMINI:\n" + JSON.stringify(geminiFiles) + "\n\nCLAUDE:\n" + JSON.stringify(claudeFiles)
    ));
    let finalFiles = [...geminiFiles, ...claudeFiles];
    if (!audit.approved || (audit.files || []).length) {
      await logDeployment(dep.id, { status: "chatgpt_correcting", current_step: "ChatGPT — Corrections" }, "Corrections nécessaires.");
      finalFiles = finalFiles.concat(validateFiles(audit, snap.knownPaths));
    }

    await logDeployment(dep.id, { status: "github_pushing", current_step: "GitHub — Branche / PR" }, "Création d'une branche isolée.");
    const branchName = "haspad/" + dep.id.slice(0, 8);
    const baseRef = await github("/repos/" + project.repo_owner + "/" + project.repo_name + "/git/ref/heads/" + encodeURIComponent(project.default_branch), token);
    await github("/repos/" + project.repo_owner + "/" + project.repo_name + "/git/refs", token, {
      method: "POST",
      body: JSON.stringify({ ref: "refs/heads/" + branchName, sha: baseRef.object.sha })
    });
    const baseCommit = await github("/repos/" + project.repo_owner + "/" + project.repo_name + "/git/commits/" + baseRef.object.sha, token);
    const unique = new Map();
    for (const file of finalFiles) unique.set(file.path, file);
    const tree = Array.from(unique.values()).map(file => file.action === "delete"
      ? { path: file.path, mode: "100644", type: "blob", sha: null }
      : { path: file.path, mode: "100644", type: "blob", content: file.content });
    const newTree = await github("/repos/" + project.repo_owner + "/" + project.repo_name + "/git/trees", token, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree })
    });
    const commit = await github("/repos/" + project.repo_owner + "/" + project.repo_name + "/git/commits", token, {
      method: "POST",
      body: JSON.stringify({
        message: "HASPАD AI deployment " + dep.id.slice(0, 8),
        tree: newTree.sha,
        parents: [baseRef.object.sha]
      })
    });
    await github("/repos/" + project.repo_owner + "/" + project.repo_name + "/git/refs/heads/" + encodeURIComponent(branchName), token, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false })
    });

    const pr = await github("/repos/" + project.repo_owner + "/" + project.repo_name + "/pulls", token, {
      method: "POST",
      body: JSON.stringify({
        title: "HASPАD — AI deployment " + dep.id.slice(0, 8),
        head: branchName,
        base: project.default_branch,
        draft: false,
        body: "Déploiement généré par HASPAD. Gemini: interface. Claude: fonctionnement. ChatGPT: audit final. La branche principale n'a pas été modifiée directement."
      })
    });

    await logDeployment(dep.id, {
      status: "netlify_provisioning",
      current_step: "Netlify — Création du site",
      branch_name: branchName,
      commit_sha: commit.sha,
      pull_request_url: pr.html_url
    }, "Pull Request créée. Création du site Netlify.");

    const domain = String(project.site_url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    let site = null;
    if (project.netlify_site_id) {
      site = await netlifyApi("/sites/" + encodeURIComponent(project.netlify_site_id), {
        method: "PATCH",
        body: JSON.stringify({
          name: project.site_slug,
          custom_domain: domain,
          force_ssl: true,
          repo: {
            provider: "github",
            repo_path: project.repo_owner + "/" + project.repo_name,
            repo_branch: branchName
          }
        })
      });
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
              repo_branch: branchName
            }
          })
        });
      }
    }

    await client.from("projects").update({ netlify_site_id: site.id }).eq("id", project.id);
    await logDeployment(dep.id, {
      status: "testing",
      current_step: "Netlify — Build / vérification",
      netlify_site_id: site.id,
      netlify_deploy_id: site.published_deploy?.id || null
    }, "Site Netlify créé: " + (site.ssl_url || site.url || project.site_url));

    const deployed = await waitForNetlifyDeploy(site.id);
    if (deployed.deploy?.id) {
      await client.from("deployments").update({ netlify_deploy_id: deployed.deploy.id }).eq("id", dep.id);
    }
    if (deployed.timedOut) {
      await logDeployment(dep.id, { status: "completed", current_step: "Netlify — Build en cours" }, "Le site a été créé. Netlify poursuit le build.");
    } else {
      await logDeployment(dep.id, { status: "completed", current_step: "Terminé" }, "Site Netlify prêt: " + (deployed.site?.ssl_url || deployed.site?.url || project.site_url));
    }
  } catch (error) {
    try {
      await logDeployment(deploymentId, { status: "failed", current_step: "Erreur", error: error.message }, error.message);
    } catch {}
  }
  return new Response("", { status: 202 });
};