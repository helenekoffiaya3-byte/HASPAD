import { api } from "./auth.js";
const $ = (s) => document.querySelector(s);
const panel = $("#gitPanel");
const connect = $("#connectGithub");
const repo = $("#gitRepo");
const branch = $("#gitBranch");
const deploy = $("#gitDeploy");
const message = $("#gitMessage");
const status = $("#gitStatus");
let repos = [];

function show(value){if(message)message.textContent=value;}

async function loadBranches(){
  if(!repo?.value)return;
  const response=await api("/api/git-branches?repo="+encodeURIComponent(repo.value));
  const data=await response.json().catch(()=>({}));
  if(!response.ok){show(data.error||"Impossible de charger les branches.");return;}
  branch.innerHTML=(data.branches||[]).map(x=>'<option value="'+String(x.name).replace(/"/g,"&quot;")+'">'+x.name+(x.protected?" · protégée":"")+"</option>").join("");
}

async function loadRepos(){
  const response=await api("/api/git-repos");
  const data=await response.json().catch(()=>({}));
  if(!response.ok){connect.hidden=false;deploy.disabled=true;show(data.error||"Connectez GitHub.");return;}
  connect.hidden=true;
  repos=data.repositories||[];
  repo.innerHTML=repos.map(x=>'<option value="'+x.full_name+'">'+x.full_name+(x.private?" · privé":"")+"</option>").join("");
  if(repos.length){await loadBranches();deploy.disabled=false;}
  else show("Aucun dépôt GitHub accessible.");
}

repo?.addEventListener("change",loadBranches);
connect?.addEventListener("click",()=>{location.href="/api/github-connect";});

deploy?.addEventListener("click",async()=>{
  const siteId=panel?.dataset.siteId;
  if(!siteId||!repo.value||!branch.value)return;
  deploy.disabled=true;
  show("Compilation, push GitHub et publication Netlify…");
  try{
    const response=await api("/api/git-deploy",{method:"POST",body:JSON.stringify({siteId,repo:repo.value,branch:branch.value})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){show(data.error||"Déploiement échoué.");return;}
    show("Commit "+data.commitSha+" poussé. Déploiement Netlify en cours.");
    poll(siteId);
  }finally{deploy.disabled=false;}
});

async function poll(siteId){
  for(let i=0;i<30;i++){
    await new Promise(resolve=>setTimeout(resolve,2000));
    const response=await api("/api/git-status?siteId="+encodeURIComponent(siteId));
    if(!response.ok)return;
    const data=await response.json().catch(()=>({}));
    const build=data.build;
    if(!build)continue;
    status.textContent=build.status+(build.deploy_url?" · "+build.deploy_url:"");
    if(build.status==="success"){show("Déploiement réussi.");return;}
    if(build.status==="failed"){show("Déploiement échoué : crédits remboursés.");return;}
  }
}

export async function initGit(siteId){
  if(!panel||!siteId)return;
  panel.dataset.siteId=siteId;
  const params=new URLSearchParams(location.search);
  if(params.get("github")==="connected")show("GitHub connecté.");
  if(params.get("github")==="error")show("Connexion GitHub annulée ou refusée.");
  await loadRepos();
}
