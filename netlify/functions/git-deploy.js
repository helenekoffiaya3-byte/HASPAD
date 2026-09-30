import crypto from "crypto";
import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";
import { BlockNodeSchema } from "../../src/types/ast.ts";
import { compilePage } from "../../src/compiler/engine.ts";
import { pushFiles } from "./_github.js";

function env(name){return globalThis.Netlify?.env?.get?.(name)??process.env[name];}
const UUID=/^[0-9a-f-]{36}$/i;
function filePath(slug){const clean=String(slug||"index").replace(/^\/+|\/+$/g,"")||"index";return clean==="index"?"/index.html":"/"+clean+"/index.html";}
function compileFiles(pages){
  const files={};
  for(const page of pages||[]){
    const html=compilePage(BlockNodeSchema.parse(page.root_block||{}));
    files[filePath(page.slug)]=html;
  }
  if(!files["/index.html"])throw new Error("INDEX_PAGE_REQUIRED");
  return files;
}
async function netlifyJson(url,options={}){
  const token=env("NETLIFY_AUTH_TOKEN");
  if(!token)throw new Error("NETLIFY_AUTH_TOKEN_NOT_CONFIGURED");
  const response=await fetch(url,{...options,headers:{authorization:"Bearer "+token,accept:"application/json","content-type":"application/json",...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const e=new Error(data?.message||data?.error||"NETLIFY_API_ERROR");e.status=response.status;throw e;}
  return data;
}
async function getDeploy(deployId){return netlifyJson("https://api.netlify.com/api/v1/deploys/"+encodeURIComponent(deployId));}
async function waitPrepared(deployId){
  let deploy=await getDeploy(deployId);
  for(let i=0;i<15;i++){
    if(["prepared","uploading","uploaded","ready"].includes(deploy.state))return deploy;
    if(deploy.state==="error")throw new Error(deploy.error_message||"NETLIFY_DEPLOY_FAILED");
    await new Promise(r=>setTimeout(r,500));
    deploy=await getDeploy(deployId);
  }
  throw new Error("NETLIFY_DEPLOY_PREPARATION_TIMEOUT");
}
async function refund(buildId,error){
  await admin.rpc("fail_build_and_refund",{p_build_id:buildId,p_error:String(error||"GIT_DEPLOY_FAILED").slice(0,1000)});
}
export default async(req)=>{
  if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
  const user=await getUser();if(!user)return json(401,{error:"Unauthorized"});
  const body=await req.json().catch(()=>null);
  if(!body)return json(400,{error:"JSON invalide."});
  const siteId=String(body.siteId||"");
  const repo=String(body.repo||"");
  const branch=String(body.branch||"main");
  const match=/^([^/]+)\/([^/]+)$/.exec(repo);
  if(!UUID.test(siteId)||!match||!/^[A-Za-z0-9._/-]{1,255}$/.test(branch))return json(400,{error:"Paramètres invalides."});
  const {data:site,error:siteError}=await admin.from("sites").select("id,name,netlify_site_id").eq("id",siteId).eq("user_id",user.id).maybeSingle();
  if(siteError)return json(500,{error:"Vérification du projet impossible."});
  if(!site)return json(403,{error:"Accès refusé."});
  if(!site.netlify_site_id)return json(503,{error:"Aucune cible Netlify n'est associée au projet."});

  const cost=Math.max(1,Number(env("GIT_DEPLOY_CREDIT_COST")||300));
  const referenceId=crypto.randomUUID();
  const allocationResult=await admin.rpc("consume_credits_and_create_build_v2",{
    p_user_id:user.id,p_site_id:siteId,p_cost:cost,p_reference_id:referenceId,
    p_git_provider:"github",p_repository_owner:match[1],p_repository_name:match[2],p_branch:branch
  });
  if(allocationResult.error)return json(500,{error:"Transaction de déploiement impossible."});
  const allocation=allocationResult.data;
  if(!allocation?.success)return json(allocation.error==="INSUFFICIENT_CREDITS"?402:400,{error:allocation.error,remainingCredits:allocation.remaining_credits});
  const buildId=allocation.build_id;
  let netlifyTriggered=false;
  try{
    const {data:pages,error:pagesError}=await admin.from("pages").select("slug,root_block").eq("site_id",siteId).order("slug");
    if(pagesError)throw pagesError;
    const files=compileFiles(pages);
    const commitSha=await pushFiles(user.id,match[1],match[2],branch,files,"HASPAD "+allocation.version+" [skip netlify]");
    await admin.from("project_builds").update({commit_hash:commitSha,status:"building",triggered_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",buildId).eq("status","pending");

    const digest={};
    for(const [path,bodyText] of Object.entries(files))digest[path]=crypto.createHash("sha1").update(bodyText).digest("hex");
    const deploy=await netlifyJson("https://api.netlify.com/api/v1/sites/"+encodeURIComponent(site.netlify_site_id)+"/deploys?production=true&title="+encodeURIComponent("HASPAD "+allocation.version+" "+buildId),{method:"POST",body:JSON.stringify({files:digest,async:true})});
    netlifyTriggered=true;
    const prepared=await waitPrepared(deploy.id);
    await admin.from("project_builds").update({netlify_deploy_id:prepared.id,updated_at:new Date().toISOString()}).eq("id",buildId);
    const required=new Set(prepared.required||[]);
    for(const [path,bodyText] of Object.entries(files)){
      const sha=digest[path];
      if(!required.has(sha))continue;
      const response=await fetch("https://api.netlify.com/api/v1/deploys/"+encodeURIComponent(prepared.id)+"/files"+path,{
        method:"PUT",
        headers:{authorization:"Bearer "+env("NETLIFY_AUTH_TOKEN"),"content-type":"application/octet-stream","content-length":String(Buffer.byteLength(bodyText))},
        body:Buffer.from(bodyText)
      });
      if(!response.ok)throw new Error("NETLIFY_FILE_UPLOAD_FAILED");
    }
    return json(202,{success:true,buildId,version:allocation.version,buildNumber:allocation.build_number,commitSha,status:"building",netlifyDeployId:prepared.id,remainingCredits:allocation.remaining_credits});
  }catch(error){
    console.error("git-deploy",error);
    if(!netlifyTriggered)await refund(buildId,error?.message||"GIT_DEPLOY_FAILED");
    else await admin.from("project_builds").update({error_message:String(error?.message||"DEPLOY_POST_PROCESSING_FAILED").slice(0,1000),updated_at:new Date().toISOString()}).eq("id",buildId);
    return json(502,{error:netlifyTriggered?"Le code est poussé et le déploiement Netlify est lancé, mais son suivi doit être vérifié.":"Le déploiement Git/Netlify a échoué. Les crédits ont été remboursés.",buildId});
  }
};
