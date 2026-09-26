import { sb } from "./auth.js";
async function api(path, options = {}) {
  const result = await sb.auth.getSession();
  const token = result.data.session?.access_token;
  return fetch(path, { ...options, headers: { ...(options.headers || {}), authorization: "Bearer " + token } });
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&#39;","\"":"&quot;","'":"&#39;"
  }[char]));
}
const userResult = await sb.auth.getUser();
document.querySelector("#user").textContent = userResult.data.user?.email || "";
async function load() {
  const response = await api("/api/projects");
  const data = await response.json();
  const box = document.querySelector("#projects");
  box.innerHTML = "";
  document.querySelector("#empty").hidden = !!data.projects?.length;
  for (const project of data.projects || []) {
    const card = document.createElement("article");
    card.className = "card project";
    card.innerHTML = "<p class='eyebrow'>PROJET</p><h2>" + esc(project.name) + "</h2><p class='muted'>" + esc(project.repo_owner) + "/" + esc(project.repo_name) + "</p><span class='pill'>" + esc(project.default_branch) + "</span>";
    card.onclick = () => location.href = "/project.html?id=" + encodeURIComponent(project.id);
    box.appendChild(card);
  }
}
document.querySelector("#newProject").onclick = () => location.href = "/project.html?new=1";
load();
