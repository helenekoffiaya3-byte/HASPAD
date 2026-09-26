import { sb } from "./auth.js";
const params = new URLSearchParams(location.search);
const id = params.get("id");
const isNew = params.get("new") === "1";
let project = null;
async function api(path, options = {}) {
  const result = await sb.auth.getSession();
  const token = result.data.session?.access_token;
  return fetch(path, { ...options, headers: { ...(options.headers || {}), authorization: "Bearer " + token } });
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[char]));
}
async function load() {
  if (isNew) {
    document.querySelector("#title").textContent = "Nouveau projet";
    document.querySelector("#repo").textContent = "Connectez GitHub puis choisissez un dépôt.";
    return;
  }
  const response = await api("/api/projects?id=" + encodeURIComponent(id));
  const data = await response.json();
  if (!response.ok) return alert(data.error || "Projet introuvable");
  project = data.project;
  document.querySelector("#title").textContent = project.name;
  document.querySelector("#repo").textContent = project.repo_owner + "/" + project.repo_name;
  document.querySelector("#deploy").disabled = false;
  loadDeployment();
}
async function connectGithub() {
  const response = await api("/api/github-connect");
  const data = await response.json();
  if (!response.ok) return alert(data.error || "Connexion GitHub impossible");
  location.href = data.url;
}
async function loadRepos() {
  const response = await api("/api/github-repos");
  const data = await response.json();
  if (!response.ok) return alert(data.error || "Impossible de lire les dépôts");
  const select = document.querySelector("#repos");
  select.innerHTML = "";
  for (const repo of data.repos || []) {
    const option = document.createElement("option");
    option.value = repo.full_name;
    option.dataset.branch = repo.default_branch || "main";
    option.textContent = repo.full_name + (repo.private ? " • privé" : "");
    select.appendChild(option);
  }
  select.hidden = false;
  document.querySelector("#saveRepo").hidden = false;
}
async function saveRepo() {
  const select = document.querySelector("#repos");
  const option = select.selectedOptions[0];
  if (!option) return;
  const parts = select.value.split("/");
  const response = await api("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: parts[1],
      repo_owner: parts[0],
      repo_name: parts[1],
      default_branch: option.dataset.branch || "main"
    })
  });
  const data = await response.json();
  if (!response.ok) return alert(data.error || "Association impossible");
  location.href = "/project.html?id=" + encodeURIComponent(data.project.id);
}
async function deploy() {
  if (!project) return;
  const response = await api("/api/deployments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project_id: project.id })
  });
  const data = await response.json();
  if (!response.ok) return alert(data.error || "Deploy impossible");
  document.querySelector("#deploy").disabled = true;
  watch(data.deployment.id);
}
function render(status) {
  const labels = {
    gemini_processing:"Gemini — Interface",
    claude_processing:"Claude — Fonctionnement",
    chatgpt_verifying:"ChatGPT — Inspection",
    chatgpt_correcting:"ChatGPT — Corrections",
    github_pushing:"GitHub — Branche / PR",
    testing:"Tests / CI",
    completed:"Terminé"
  };
  const order = ["gemini_processing","claude_processing","chatgpt_verifying","chatgpt_correcting","github_pushing","testing","completed"];
  const current = order.indexOf(status);
  document.querySelector("#steps").innerHTML = order.map((step, index) =>
    "<div class='step " + (index <= current ? "done" : "") + "'><span class='dot'></span>" + labels[step] + "</div>"
  ).join("");
  document.querySelector("#status").textContent = labels[status] || status;
}
async function loadDeployment() {
  const response = await api("/api/deployments?project_id=" + encodeURIComponent(project.id));
  const data = await response.json();
  if (data.deployment) {
    render(data.deployment.status);
    document.querySelector("#logs").textContent = (data.deployment.logs || []).join("\n");
    if (!["completed","failed"].includes(data.deployment.status)) watch(data.deployment.id);
  }
}
function subscribeRealtime(deploymentId) {
  sb.channel("deployment-" + deploymentId)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "deployments", filter: "id=eq." + deploymentId }, payload => {
      const deployment = payload.new;
      render(deployment.status);
      document.querySelector("#logs").textContent = (deployment.logs || []).join("\n") + (deployment.pull_request_url ? "\nPR: " + deployment.pull_request_url : "");
    })
    .subscribe();
}
function watch(deploymentId) {\n  subscribeRealtime(deploymentId);
  const timer = setInterval(async () => {
    const response = await api("/api/deployments?id=" + encodeURIComponent(deploymentId));
    const data = await response.json();
    if (!data.deployment) return;
    render(data.deployment.status);
    document.querySelector("#logs").textContent = (data.deployment.logs || []).join("\n") + (data.deployment.pull_request_url ? "\nPR: " + data.deployment.pull_request_url : "");
    if (["completed","failed"].includes(data.deployment.status)) {
      clearInterval(timer);
      document.querySelector("#deploy").disabled = false;
    }
  }, 2500);
}
document.querySelector("#connect").onclick = connectGithub;
document.querySelector("#saveRepo").onclick = saveRepo;
document.querySelector("#deploy").onclick = deploy;
document.querySelector("#back").onclick = () => location.href = "/dashboard.html";
if (params.get("github") === "connected") loadRepos();
load();
