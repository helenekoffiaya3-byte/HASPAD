const $=s=>document.querySelector(s);
const result=$("#deploymentResult"),filesInput=$("#projectFiles"),detect=$("#detectProject"),dockerDeploy=$("#deployDockerProject");
const repoSelect=$("#gitRepo"),branchSelect=$("#gitBranch"),gitPanel=$("#gitPanel");
const api=(path,options={})=>fetch(path,{credentials:"include",headers:{"content-type":"application/json",...(options.headers||{})},...options});
let lastAnalysis=null;
function show(v){if(result)result.textContent=typeof v==="string"?v:JSON.stringify(v,null,2)}
async function analyzeRepo(){
 const siteId=gitPanel?.dataset.siteId,full=repoSelect?.value,branch=branchSelect?.value||"main";
 if(!siteId||!full)return show("Connectez GitHub et sélectionnez un dépôt.");
 const [owner,name]=full.split("/");
 show("Analyse GitHub en cours…");
 const r=await api("/api/project-analyze",{method:"POST",body:JSON.stringify({siteId,repositoryOwner:owner,repositoryName:name,branch})});
 const data=await r.json().catch(()=>({}));if(!r.ok)return show(data.error||"Analyse impossible.");
 lastAnalysis=data;show(data);
}
async function analyzeFiles(list){
 const names=[...list].map(f=>f.webkitRelativePath||f.name);
 const runtime=names.includes("Dockerfile")?"docker":names.includes("package.json")?"node":names.includes("index.html")?"static":"unknown";
 show({success:true,runtime,detectedFiles:names});
}
detect?.addEventListener("click",()=>repoSelect?.value?analyzeRepo():filesInput?.click());
filesInput?.addEventListener("change",()=>filesInput.files.length&&analyzeFiles(filesInput.files));
dockerDeploy?.addEventListener("click",async()=>{
 const siteId=gitPanel?.dataset.siteId,full=repoSelect?.value,branch=branchSelect?.value||"main";
 if(!siteId||!full)return show("Connectez GitHub et sélectionnez un dépôt.");
 if(!lastAnalysis)await analyzeRepo();
 if(!lastAnalysis?.runtime)return;
 const [owner,name]=full.split("/");
 const port=lastAnalysis.port||3000;
 show("Déploiement Docker en cours…");
 const r=await api("/api/deployment-create",{method:"POST",body:JSON.stringify({siteId,repositoryOwner:owner,repositoryName:name,branch,runtimeTarget:"docker",port,dockerfilePath:lastAnalysis.dockerfilePath||"Dockerfile"})});
 const data=await r.json().catch(()=>({}));if(!r.ok)return show(data.error||"Déploiement Docker échoué.");
 show(data);
});
