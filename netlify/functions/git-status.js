import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";

function env(name){return globalThis.Netlify?.env?.get?.(name)??process.env[name];}
async function netlifyJson(url){
  const token=env("NETLIFY_AUTH_TOKEN");
  if(!token)throw new Error("NETLIFY_AUTH_TOKEN_NOT_CONFIGURED");
  const response=await fetch(url,{headers:{authorization:"Bearer "+token,accept:"application/json"}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const e=new Error(data?.message||"NETLIFY_API_ERROR");e.status=response.status;throw e;}
  return data;
}
export default async(req)=>{
  if(req.method!=="GET")return json(405,{error:"Method Not Allowed"});
  const user=await getUser();if(!user)return json(401,{error:"Unauthorized"});
  const siteId=new URL(req.url).searchParams.get("siteId");
  if(!siteId)return json(400,{error:"siteId requis."});
  const {data:build,error}=await admin.from("project_builds").select("*").eq("site_id",siteId).eq("user_id",user.id).order("build_number",{ascending:false}).limit(1).maybeSingle();
  if(error)return json(500,{error:"Impossible de charger le déploiement."});
  if(!build)return json(200,{build:null});
  if(build.netlify_deploy_id&&["building","pending"].includes(build.status)){
    try{
      const deploy=await netlifyJson("https://api.netlify.com/api/v1/deploys/"+encodeURIComponent(build.netlify_deploy_id));
      if(deploy.state==="ready"){
        await admin.from("project_builds").update({status:"success",deploy_url:deploy.ssl_url||deploy.deploy_ssl_url||deploy.deploy_url||deploy.url||null,error_message:null,updated_at:new Date().toISOString()}).eq("id",build.id).eq("status","building");
      }else if(["error","failed"].includes(deploy.state)){
        await admin.rpc("fail_build_and_refund",{p_build_id:build.id,p_error:deploy.error_message||"NETLIFY_DEPLOY_FAILED"});
      }
    }catch(error){console.error("git-status",error);}
  }
  const {data:latest}=await admin.from("project_builds").select("*").eq("id",build.id).maybeSingle();
  return json(200,{build:latest||build});
};
