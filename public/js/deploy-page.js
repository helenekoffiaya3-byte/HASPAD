import { api, logout } from "./auth.js";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const siteId = params.get("siteId");
const repo = params.get("repo") || "";
const initialBranch = params.get("branch") || "main";
const [owner, name] = repo.split("/");
let analysis = null;
const runtimeTarget = () => $("#runtimeTarget").value || "netlify";

function msg(text) { $("#analysisStatus").textContent = text; }
function setDeploy(text) { $("#deployStatus").textContent = text; }

async function loadBranches() {
  if (!siteId || !repo) return;
  const r = await api("/api/git-branches?repo=" + encodeURIComponent(repo));
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Impossible de charger les branches.");
  const select = $("#branchSelect");
  select.innerHTML = (d.branches || []).map(x =>
    "<option value=\"" + String(x.name).replace(/"/g, "&quot;") + "\">" + x.name + "</option>"
  ).join("");
  if ([...select.options].some(o => o.value === initialBranch)) select.value = initialBranch;
}

async function analyze() {
  if (!siteId || !owner || !name) {
    msg("Dépôt ou projet manquant. Revenez à GitHub / Netlify.");
    return;
  }
  msg("ChatGPT inspecte le dépôt et détermine la commande exacte…");
  const branch = $("#branchSelect").value || initialBranch;
  const targetRuntime = runtimeTarget();
  const r = await api("/api/deployment-analyze", {
    method: "POST",
    body: JSON.stringify({ siteId, repositoryOwner: owner, repositoryName: name, branch, targetRuntime })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Analyse impossible.");
  analysis = d;
  $("#projectName").value = d.name || name;
  $("#buildCommand").value = d.commandRequired === false ? "Aucune commande de build nécessaire" : (d.command || "");
  $("#dockerPort").value = d.port || "";
  $("#healthcheckPath").value = d.healthcheckPath || "/";
  const blockers = d.preflight?.blockers || [];
  $("#evidence").textContent = (d.evidence || []).join("\n") || "Aucune preuve textuelle fournie.";
  if (blockers.length) {
    msg("Déploiement bloqué avant tout débit : " + blockers.join(" "));
    $("#deployButton").disabled = true;
    return;
  }
  msg("Prévalidation réussie · aucun crédit débité · cible " + (targetRuntime === "docker" ? "Docker / PaaS" : "Netlify") + " · " + (d.framework || d.runtime || "projet détecté"));
  $("#deployButton").disabled = false;
}

$("#branchSelect").addEventListener("change", () => { analysis = null; $("#deployButton").disabled = true; analyze().catch(e => msg(e.message)); });
$("#runtimeTarget").addEventListener("change", () => { analysis = null; $("#deployButton").disabled = true; analyze().catch(e => msg(e.message)); });

$("#deployButton").addEventListener("click", async () => {
  if (!analysis || analysis.deployable !== true || analysis.preflight?.deployable !== true) return;
  $("#deployButton").disabled = true;
  setDeploy("Préparation du déploiement…");
  try {
    const branch = $("#branchSelect").value;
    const r = await api("/api/deployment-trigger", {
      method: "POST",
      body: JSON.stringify({
        siteId, repositoryOwner: owner, repositoryName: name, branch,
        targetRuntime: runtimeTarget(),
        command: analysis.command || "",
        port: Number(analysis.port || 0),
        healthcheckPath: analysis.healthcheckPath || "/",

        baseDirectory: analysis.baseDirectory || "",
        publishDirectory: analysis.publishDirectory || "",
        preflightToken: analysis.preflightToken || ""
      })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Déploiement échoué.");
    setDeploy("Déploiement lancé. Build ID : " + (d.buildId || "—"));
  } catch (e) {
    setDeploy(e.message);
    $("#deployButton").disabled = false;
  }
});

$("#logout")?.addEventListener("click", logout);
(async () => {
  try { await loadBranches(); await analyze(); }
  catch (e) { msg(e.message); }
})();
