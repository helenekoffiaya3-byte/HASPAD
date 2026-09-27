import crypto from "node:crypto";

const env=n=>globalThis.Netlify?.env?.get?.(n)??process.env[n];

function required(name){
  const value=env(name);
  if(!value)throw new Error(name+"_NOT_CONFIGURED");
  return value;
}

function sign(secret,timestamp,body){
  return crypto.createHmac("sha256",secret).update(timestamp+"."+body).digest("hex");
}

export function containerProviderStatus(){
  const url=env("HASPAD_CONTAINER_PROVIDER_URL");
  const secret=env("HASPAD_CONTAINER_PROVIDER_SHARED_SECRET");
  return {
    configured:Boolean(url&&secret),
    provider:env("HASPAD_CONTAINER_PROVIDER")||"external-container-provider"
  };
}

export async function deployContainer(input={}){
  const base=required("HASPAD_CONTAINER_PROVIDER_URL").replace(/\/$/,"");
  const secret=required("HASPAD_CONTAINER_PROVIDER_SHARED_SECRET");
  const timestamp=String(Date.now());
  const body=JSON.stringify({
    providerVersion:"1",
    runtimeId:input.runtimeId,
    projectId:input.projectId,
    repository:{
      provider:input.repositoryProvider||"github",
      owner:input.repositoryOwner,
      name:input.repositoryName,
      branch:input.branch||"main",
      commitSha:input.commitSha||null
    },
    host:input.host,
    port:Number(input.port||3000),
    healthcheckPath:input.healthcheckPath||"/",
    dockerfilePath:input.dockerfilePath||"Dockerfile",
    runtime:input.runtime||"docker",
    environment:input.env||{}
  });
  const response=await fetch(base+"/v1/deploy",{
    method:"POST",
    headers:{
      "content-type":"application/json",
      accept:"application/json",
      "x-haspad-timestamp":timestamp,
      "x-haspad-signature":sign(secret,timestamp,body)
    },
    body
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error||"CONTAINER_PROVIDER_DEPLOY_FAILED");
  return data;
}
