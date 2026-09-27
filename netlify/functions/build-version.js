import crypto from "crypto";
import { admin, json, authenticatedUser } from "./_credits.js";
import { BlockNodeSchema } from "../../src/types/ast.ts";
import { compilePage } from "../../src/compiler/engine.ts";

function env(name){
  return globalThis.Netlify?.env?.get?.(name) ?? undefined;
}
const UUID=/^[0-9a-f-]{36}$/i;
const netlifyHeaders=()=>({
  authorization:"Bearer "+(env("NETLIFY_AUTH_TOKEN")||""),
  accept:"application/json",
  "content-type":"application/json"
});
async function netlifyJson(url,options={}){
  const response=await fetch(url,{...options,headers:{...netlifyHeaders(),...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.message||data?.error||"NETLIFY_API_ERROR");
  return data;
}
function filePath(slug){
  const clean=String(slug||"index").replace(/^\/+|\/+$/g,"")||"index";
  return clean==="index"?"/index.html":"/"+clean+"/index.html";
}
function compileFiles(pages){
  const files={};
  for(const page of pages||[]){
    const root=page.root_block||{};
    const html=compilePage(BlockNodeSchema.parse(root));
    const path=filePath(page.slug);
    files[path]={
      sha:crypto.createHash("sha1").update(html).digest("hex"),
      body:html
    };
  }
  if(!files["/index.html"])throw new Error("INDEX_PAGE_REQUIRED");
  return files;
}
async function finalizeFailed(buildId,errorMessage){
  await admin.rpc("fail_build_and_refund",{p_build_id:buildId,p_error:String(errorMessage||"BUILD_FAILED").slice(0,1000)});
}
async function syncBuild(build){
  if(!build?.netlify_deploy_id)return build;
  if(!["pending","building"].includes(build.status))return build;
  try{
    const deploy=await netlifyJson("https://api.netlify.com/api/v1/deploys/"+encodeURIComponent(build.netlify_deploy_id),{method:"GET"});
    if(deploy.state==="ready"){
      const {data,error}=await admin.from("project_builds").update({
        status:"success",deploy_url:deploy.ssl_url||deploy.deploy_ssl_url||deploy.deploy_url||deploy.url||null,
        error_message:null,updated_at:new Date().toISOString()
      }).eq("id",build.id).eq("status","building").select("*").single();
      if(error)throw error;
      return data;
    }
    if(deploy.state==="error"){
      await finalizeFailed(build.id,deploy.error_message||"NETLIFY_DEPLOY_FAILED");
      const {data}=await admin.from("project_builds").select("*").eq("id",build.id).single();
      return data;
    }
  }catch(error){
    console.error("build-status-sync:",error);
  }
  return build;
}
export default async(req)=>{
  const user=await authenticatedUser(req);
  if(!user)return json(401,{error:"Unauthorized"});
  const url=new URL(req.url);
  if(req.method==="GET"){
    const siteId=url.searchParams.get("siteId");
    if(!UUID.test(siteId||""))return json(400,{error:"siteId invalide."});
    const {data:site,error:siteError}=await admin.from("sites").select("id").eq("id",siteId).eq("user_id",user.id).maybeSingle();
    if(siteError)return json(500,{error:"Vérification du projet impossible."});
    if(!site)return json(403,{error:"Accès non autorisé à ce projet."});
    const {data:build,error}=await admin.from("project_builds").select("*").eq("site_id",siteId).order("build_number",{ascending:false}).limit(1).maybeSingle();
    if(error)return json(500,{error:"Impossible de récupérer la version."});
    return json(200,{build:await syncBuild(build)});
  }
  if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
  let body;try{body=await req.json()}catch{return json(400,{error:"JSON invalide."})}
  const siteId=String(body.siteId||"");
  if(!UUID.test(siteId))return json(400,{error:"siteId invalide."});
  if(!env("NETLIFY_AUTH_TOKEN"))return json(503,{error:"Netlify n'est pas encore configuré côté serveur."});

  const {data:site,error:siteError}=await admin.from("sites").select("id,name,netlify_site_id").eq("id",siteId).eq("user_id",user.id).maybeSingle();
  if(siteError)return json(500,{error:"Vérification du projet impossible."});
  if(!site)return json(403,{error:"Accès non autorisé à ce projet."});
  if(!site.netlify_site_id)return json(503,{error:"Aucune cible Netlify n'est associée à ce projet."});

  const {count,error:countError}=await admin.from("project_builds").select("id",{count:"exact",head:true}).eq("site_id",siteId).eq("status","success");
  if(countError)return json(500,{error:"Impossible de déterminer le coût du déploiement."});
  const cost=(count||0)===0?390:150;

  const {data:rpcResult,error:rpcError}=await admin.rpc("consume_credits_and_create_build",{
    p_user_id:user.id,p_site_id:siteId,p_cost:cost
  });
  if(rpcError)return json(500,{error:"Transaction de déploiement impossible."});
  if(!rpcResult?.success){
    const status=rpcResult.error==="INSUFFICIENT_CREDITS"?402:rpcResult.error==="FORBIDDEN"?403:400;
    return json(status,{error:rpcResult.error,remainingCredits:rpcResult.remaining_credits});
  }

  const buildId=rpcResult.build_id;
  try{
    const {data:pages,error:pagesError}=await admin.from("pages").select("slug,root_block").eq("site_id",siteId).order("slug");
    if(pagesError)throw pagesError;
    const files=compileFiles(pages);
    const digest=Object.fromEntries(Object.entries(files).map(([path,file])=>[path,file.sha]));
    const deploy=await netlifyJson(
      "https://api.netlify.com/api/v1/sites/"+encodeURIComponent(site.netlify_site_id)+"/deploys?production=true&title="+encodeURIComponent("HASP​AD "+rpcResult.version+" "+buildId).replace("\u200b",""),
      {method:"POST",body:JSON.stringify({files:digest,async:true})}
    );

    await admin.from("project_builds").update({
      status:"building",netlify_deploy_id:deploy.id,triggered_at:new Date().toISOString(),updated_at:new Date().toISOString()
    }).eq("id",buildId).eq("status","pending");

    const required=new Set([...(deploy.required||[])]);
    for(const [path,file] of Object.entries(files)){
      if(!required.has(file.sha))continue;
      const response=await fetch("https://api.netlify.com/api/v1/deploys/"+encodeURIComponent(deploy.id)+"/files"+path,{
        method:"PUT",
        headers:{authorization:"Bearer "+env("NETLIFY_AUTH_TOKEN"),"content-type":"application/octet-stream","content-length":String(Buffer.byteLength(file.body))}
        ,body:Buffer.from(file.body)
      });
      if(!response.ok)throw new Error("NETLIFY_FILE_UPLOAD_FAILED");
    }

    return json(202,{
      success:true,buildId,version:rpcResult.version,buildNumber:rpcResult.build_number,
      remainingCredits:rpcResult.remaining_credits,status:"building",netlifyDeployId:deploy.id
    });
  }catch(error){
    console.error("build-version:",error);
    await finalizeFailed(buildId,error?.message||"BUILD_FAILED");
    return json(502,{error:"Le déploiement a échoué. Les crédits ont été remboursés.",buildId});
  }
};