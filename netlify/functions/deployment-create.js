import crypto from "node:crypto";
import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";
import { githubConnection } from "./_github.js";
import { deploymentTarget } from "./_deployment-router.js";
import { containerProviderStatus, deployContainer } from "./_container-provider.js";

const env=n=>globalThis.Netlify?.env?.get?.(n)??process.env[n];

export default async req=>{
  if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
  const user=await getUser();
  if(!user)return json(401,{error:"Unauthorized"});

  const b=await req.json().catch(()=>null);
  if(!b?.siteId||!b?.repositoryOwner||!b?.repositoryName)
    return json(400,{error:"siteId, repositoryOwner et repositoryName requis"});

  const site=(await admin.from("sites").select("id,user_id,subdomain,custom_domain").eq("id",b.siteId).maybeSingle()).data;
  if(!site||String(site.user_id)!==String(user.id))return json(403,{error:"Forbidden"});

  const routing=deploymentTarget({
    runtime:String(b.runtime||b.detectedRuntime||"unknown"),
    framework:b.framework||null,
    detectedFiles:Array.isArray(b.detectedFiles)?b.detectedFiles:[],
    publishDirectory:b.publishDirectory||null
  });

  if(routing.target!=="container")
    return json(409,{
      error:"NETLIFY_DEPLOYMENT_PATH",
      runtimeTarget:routing.target,
      provider:routing.provider,
      routingReason:routing.reason,
      message:"Ce projet doit passer par le chemin Git/Netlify correspondant à son analyse."
    });

  const provider=containerProviderStatus();
  if(!provider.configured)
    return json(503,{
      error:"CONTAINER_PROVIDER_NOT_CONFIGURED",
      provider:provider.provider,
      runtimeTarget:routing.target,
      message:"Le provider conteneur n'est pas configuré. Le VPS historique reste désactivé."
    });

  const requestedHost=String(b.host||site.subdomain+".haspad.com").toLowerCase();
  const allowedHost=requestedHost===String(site.subdomain).toLowerCase()+".haspad.com"||
    (site.custom_domain&&requestedHost===String(site.custom_domain).toLowerCase());
  if(!allowedHost)return json(400,{error:"HOST_NOT_AUTHORIZED"});

  const c=await githubConnection(user.id);
  if(!c)return json(400,{error:"GITHUB_NOT_CONNECTED"});

  const runtime=String(b.runtime||b.detectedRuntime||"unknown");
  const cost=Number(env("GIT_DEPLOY_CREDIT_COST")||300);
  const referenceId=crypto.randomUUID();
  const consumed=await admin.rpc("consume_credits_and_create_build_v2",{
    p_site_id:b.siteId,
    p_user_id:String(user.id),
    p_cost:cost,
    p_git_provider:"github",
    p_repository_owner:b.repositoryOwner,
    p_repository_name:b.repositoryName,
    p_branch:b.branch||"main",
    p_commit_hash:b.commitSha||null,
    p_reference_id:referenceId
  });
  if(consumed.error||!consumed.data?.success)
    return json(402,{error:consumed.error?.message||consumed.data?.error||"DEPLOYMENT_CREDIT_FAILED"});

  const buildId=consumed.data.build_id;
  try{
    const host=requestedHost.replace(/[^a-z0-9.-]/g,"");
    const saved=await admin.from("deployment_projects").upsert({
      site_id:b.siteId,
      user_id:String(user.id),
      source_type:"github",
      source_provider:"github",
      repository_owner:b.repositoryOwner,
      repository_name:b.repositoryName,
      branch:b.branch||"main",
      commit_sha:b.commitSha||null,
      runtime_type:runtime,
      runtime_target:routing.target,
      dockerfile_path:b.dockerfilePath||"Dockerfile",
      detected_port:Number(b.port||3000),
      healthcheck_path:b.healthcheckPath||"/",
      updated_at:new Date().toISOString()
    },{onConflict:"site_id"});
    if(saved.error)throw saved.error;

    const result=await deployContainer({
      runtimeId:buildId,
      projectId:b.siteId,
      repositoryProvider:"github",
      repositoryOwner:b.repositoryOwner,
      repositoryName:b.repositoryName,
      branch:b.branch||"main",
      commitSha:b.commitSha||null,
      host,
      port:Number(b.port||3000),
      healthcheckPath:b.healthcheckPath||"/",
      dockerfilePath:b.dockerfilePath||"Dockerfile",
      runtime,
      env:b.env||{}
    });

    const publicUrl=result.publicUrl||result.url||null;
    await admin.from("project_builds").update({
      status:"queued",
      deploy_url:publicUrl,
      triggered_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    }).eq("id",buildId);

    return json(202,{
      success:true,
      buildId,
      status:"queued",
      runtime:result,
      runtimeTarget:routing.target,
      provider:provider.provider,
      message:"Le Worker Cloudflare Containers est configuré. Le déploiement applicatif est piloté par Workers Builds sur le dépôt connecté au Worker."
    });
  }catch(e){
    await admin.rpc("fail_build_and_refund",{
      p_build_id:buildId,
      p_error:String(e?.message||"CONTAINER_PROVIDER_DEPLOY_FAILED").slice(0,1000)
    });
    return json(502,{error:"CONTAINER_PROVIDER_DEPLOY_FAILED",runtimeTarget:routing.target,provider:provider.provider});
  }
};
