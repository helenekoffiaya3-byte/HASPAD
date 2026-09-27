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

export function containerProviderStatus(){
  const configured=Boolean(
    env("CLOUDFLARE_ACCOUNT_ID")&&
    env("CLOUDFLARE_API_TOKEN")
  );
  return {
    configured,
    provider:"cloudflare-containers",
    mode:"workers-builds"
  };
}

export async function deployContainer(input={}){
  const triggerUuid=input.cloudflareTriggerUuid||env("CLOUDFLARE_BUILD_TRIGGER_UUID");
  if(!triggerUuid)throw new Error("CLOUDFLARE_BUILD_TRIGGER_UUID_NOT_CONFIGURED");

  const payload={};
  if(input.branch)payload.branch=String(input.branch);
  if(input.commitSha)payload.commit_hash=String(input.commitSha);
  if(!payload.branch&&!payload.commit_hash)payload.branch="main";

  const build=await cf("/builds/triggers/"+encodeURIComponent(triggerUuid)+"/builds",{
    method:"POST",
    body:JSON.stringify(payload)
  });

  return {
    provider:"cloudflare-containers",
    mode:"workers-builds",
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
