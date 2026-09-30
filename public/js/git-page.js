import { logout } from "./auth.js";
const $ = (s) => document.querySelector(s);
const panel = $("#gitPanel");
const connect = $("#connectGithub");
const repo = $("#gitRepo");
const branch = $("#gitBranch");
const next = $("#gitDeploy");
const message = $("#gitMessage");
let repos = [];

function show(value) { if (message) message.textContent = value; }

async function loadBranches() {
  if (!repo?.value) return;
  const response = await fetch("/api/git-branches?repo=" + encodeURIComponent(repo.value), { credentials: "include" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { show(data.error || "Impossible de charger les branches."); return; }
  branch.innerHTML = (data.branches || []).map(x =>
    "<option value=\"" + String(x.name).replace(/"/g, "&quot;") + "\">" + x.name + (x.protected ? " · protégée" : "") + "</option>"
  ).join("");
  next.disabled = !branch.value;
}

async function loadRepos() {
  const response = await fetch("/api/git-repos", { credentials: "include" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { connect.hidden = false; next.disabled = true; show(data.error || "Connectez GitHub."); return; }
  connect.hidden = true;
  repos = data.repositories || [];
  repo.innerHTML = repos.map(x => "<option value=\"" + x.full_name + "\">" + x.full_name + (x.private ? " · privé" : "") + "</option>").join("");
  if (repos.length) await loadBranches();
  else { next.disabled = true; show("Aucun dépôt GitHub accessible."); }
}

repo?.addEventListener("change", loadBranches);
connect?.addEventListener("click", () => { location.href = "/api/github-connect"; });
next?.addEventListener("click", () => {
  const siteId = panel?.dataset.siteId;
  if (!siteId || !repo.value || !branch.value) return;
  location.href = "/deploy.html?siteId=" + encodeURIComponent(siteId) +
    "&repo=" + encodeURIComponent(repo.value) + "&branch=" + encodeURIComponent(branch.value);
});

export async function initGit(siteId) {
  if (!panel || !siteId) return;
  panel.dataset.siteId = siteId;
  const params = new URLSearchParams(location.search);
  if (params.get("github") === "connected") show("GitHub connecté. Sélectionnez votre dépôt.");
  if (params.get("github") === "error") show("Connexion GitHub annulée ou refusée.");
  await loadRepos();
}
