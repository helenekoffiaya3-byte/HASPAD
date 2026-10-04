import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";
import { runtimeRequest } from "./_runtime.js";

const env=n=>globalThis.Netlify?.env?.get?.(n)??process.env[n];

async function netlifyDeploy(deployId){
  const token=env("NETLIFY_AUTH_TOKEN");
  if(!token)throw new Error("NETLIFY_AUTH_TOKEN_NOT_CONFIGURED");
  const response=await fetch("https://api.netlify.com/api/v1/deploys/"+encodeURIComponent(deployId),{
    headers:{authorization:"Bearer "+token,accept:"application/json"}
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.message||"NETLIFY_DEPLOY_LOOKUP_FAILED");
  return data;
}

async function reconcileNetlify(build){
  if(!build.netlify_deploy_id)return null;
  const deploy=await netlifyDeploy(build.netlify_deploy_id);
  const state=String(deploy.state||"").toLowerCase();
  const now=new Date().toISOString();

  if(state==="ready"){
    const patch={
      status:"success",
      deploy_url:deploy.deploy_url||deploy.url||build.deploy_url||null,
      error_message:null,
      updated_at:now
    };
    await admin.from("project_builds").update(patch).eq("id",build.id).neq("status","failed");
    return {state:"ready",deploy};
  }

  if(["error","failed","canceled","cancelled"].includes(state)){
    await admin.rpc("fail_build_and_refund",{
      p_build_id:build.id,
      p_error:String(deploy.error_message||deploy.error||"NETLIFY_DEPLOY_FAILED").slice(0,1000)
    });
    return {state:"failed",deploy};
  }

  if(["preparing","prepared","uploading","uploaded","processing","enqueued","pending","building"].includes(state)){
    await admin.from("project_builds").update({
      status:"building",
      updated_at:now
    }).eq("id",build.id).eq("status","pending");
  }
  return {state:state||"unknown",deploy};
}

export default async req=>{
  if(req.method!=="GET")return json(405,{error:"Method Not Allowed"});
  const user=await getUser(req);
  if(!user)return json(401,{error:"Unauthorized"});

  const id=new URL(req.url).searchParams.get("buildId");
  if(!id)return json(400,{error:"buildId requis"});

  const result=await admin.from("project_builds").select("*").eq("id",id).maybeSingle();
  if(result.error)return json(500,{error:"BUILD_LOOKUP_FAILED"});
  const b=result.data;
  if(!b||String(b.user_id)!==String(user.id))return json(404,{error:"BUILD_NOT_FOUND"});

  let build=b;
  let netlify=null;
  let runtime=null;

  if(b.netlify_deploy_id){
    try{
      const reconciliation=await reconcileNetlify(b);
      netlify=reconciliation;
      const refreshed=await admin.from("project_builds").select("*").eq("id",id).maybeSingle();
      if(refreshed.data)build=refreshed.data;
    }catch(error){
      netlify={state:"unavailable",error:String(error?.message||"NETLIFY_STATUS_UNAVAILABLE")};
    }
  }

  if(!build.netlify_deploy_id && !["success","failed"].includes(String(build.status))){
    try{
      runtime=await runtimeRequest("/v1/status/"+encodeURIComponent(id),{},"GET");
      const runtimeState=String(runtime?.status||runtime?.state||"").toLowerCase();
      if(["failed","error","canceled","cancelled"].includes(runtimeState)){
        await admin.rpc("fail_build_and_refund",{
          p_build_id:id,
          p_error:String(runtime?.error||runtime?.message||"RUNTIME_DEPLOY_FAILED").slice(0,1000)
        });
        const refreshed=await admin.from("project_builds").select("*").eq("id",id).maybeSingle();
        if(refreshed.data)build=refreshed.data;
      }else if(["ready","running","healthy","active"].includes(runtimeState)){
        await admin.from("project_builds").update({
          status:"success",
          deploy_url:runtime?.publicUrl||runtime?.url||build.deploy_url||null,
          error_message:null,
          updated_at:new Date().toISOString()
        }).eq("id",id).neq("status","failed");
        const refreshed=await admin.from("project_builds").select("*").eq("id",id).maybeSingle();
        if(refreshed.data)build=refreshed.data;
      }
    }catch{
      runtime={status:"unavailable"};
    }
  }

  return json(200,{success:true,build,netlify,runtime});
};
