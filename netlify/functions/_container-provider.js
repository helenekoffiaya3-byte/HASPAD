const env=n=>globalThis.Netlify?.env?.get?.(n)??process.env[n];

function required(name){
  const value=env(name);
  if(!value)throw new Error(name+"_NOT_CONFIGURED");
  return value;
}

async function cf(path,options={}){
  const accountId=required("CLOUDFLARE_ACCOUNT_ID");
  const token=required("CLOUDFLARE_API_TOKEN");
  const response=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(accountId)+path,{
    ...options,
    headers:{
      Authorization:"Bearer "+token,
      "content-type":"application/json",
      accept:"application/json",
      ...(options.headers||{})
    }
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.success===false){
    const message=data?.errors?.map?.(x=>x.message).filter(Boolean).join("; ")||"CLOUDFLARE_API_ERROR";
    throw new Error(message);
  }
  return data?.result??data;
}

async function resolveWorker(){
  const workerName=required("CLOUDFLARE_CONTAINER_WORKER_NAME");
  const workers=await cf("/workers/scripts",{method:"GET"});
  const list=Array.isArray(workers)?workers:[];
  const worker=list.find(x=>x?.id===workerName||x?.name===workerName);
  if(!worker?.tag)throw new Error("CLOUDFLARE_WORKER_NOT_FOUND:"+workerName);
  return {name:worker.id||worker.name,tag:worker.tag};
}

async function resolveTrigger(workerTag){
  const triggers=await cf("/builds/workers/"+encodeURIComponent(workerTag)+"/triggers",{method:"GET"});
  const list=Array.isArray(triggers)?triggers:[];
  const requested=env("CLOUDFLARE_BUILD_TRIGGER_NAME");
  const production=list.find(x=>x?.branch_includes?.includes("main")&&(!requested||x.trigger_name===requested));
  const fallback=list.find(x=>!requested||x.trigger_name===requested)||list[0];
  const trigger=production||fallback;
  if(!trigger?.trigger_uuid)throw new Error("CLOUDFLARE_BUILD_TRIGGER_NOT_FOUND");
  return trigger;
}

export function containerProviderStatus(){
  const configured=Boolean(
    env("CLOUDFLARE_ACCOUNT_ID")&&
    env("CLOUDFLARE_API_TOKEN")&&
    env("CLOUDFLARE_CONTAINER_WORKER_NAME")
  );
  return {
    configured,
    provider:"cloudflare-containers",
    mode:"workers-builds",
    workerName:env("CLOUDFLARE_CONTAINER_WORKER_NAME")||null
  };
}

export async function deployContainer(input={}){
  const worker=await resolveWorker();
  const trigger=await resolveTrigger(worker.tag);

  const payload={};
  if(input.branch)payload.branch=String(input.branch);
  if(input.commitSha)payload.commit_hash=String(input.commitSha);
  if(!payload.branch&&!payload.commit_hash)payload.branch="main";

  const build=await cf("/builds/triggers/"+encodeURIComponent(trigger.trigger_uuid)+"/builds",{
    method:"POST",
    body:JSON.stringify(payload)
  });

  return {
    provider:"cloudflare-containers",
    mode:"workers-builds",
    worker:{name:worker.name,tag:worker.tag},
    trigger:{uuid:trigger.trigger_uuid,name:trigger.trigger_name||null},
    buildUuid:build?.build_uuid||build?.uuid||null,
    status:build?.status||"queued",
    publicUrl:build?.preview_url||build?.url||null,
    repository:{
      provider:input.repositoryProvider||"github",
      owner:input.repositoryOwner,
      name:input.repositoryName,
      branch:input.branch||"main",
      commitSha:input.commitSha||null
    }
  };
}

export async function getContainerBuild(buildUuid){
  if(!buildUuid)throw new Error("CLOUDFLARE_BUILD_UUID_REQUIRED");
  return cf("/builds/builds/"+encodeURIComponent(buildUuid),{method:"GET"});
}
