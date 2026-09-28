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
  const tag=worker?.external_script_id||worker?.tag;
  if(!worker||!tag)throw new Error("CLOUDFLARE_WORKER_NOT_FOUND:"+workerName);
  return {name:worker.id||worker.name,tag};
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
    mode:"worker-container",
    workerName:env("CLOUDFLARE_CONTAINER_WORKER_NAME")||null
  };
}

export async function deployContainer(input={}){
  const worker=await resolveWorker();
  return {
    provider:"cloudflare-containers",
    mode:"worker-container",
    worker:{name:worker.name,tag:worker.tag},
    status:"managed-by-workers-builds",
    publicUrl:"https://"+worker.name+".workers.dev",
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
