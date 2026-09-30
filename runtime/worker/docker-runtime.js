import Docker from "dockerode";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import tar from "tar";

const docker=new Docker({socketPath:process.env.DOCKER_SOCKET||"/var/run/docker.sock"}),jobs=new Map();
const clean=(v,max=120)=>String(v||"").replace(/[^a-zA-Z0-9_.-]/g,"-").slice(0,max);
const required=(o,k)=>{if(!o?.[k])throw new Error(k+"_REQUIRED");return o[k]};
const envPairs=o=>Object.entries(o||{}).filter(([k,v])=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)&&v!=null).map(([k,v])=>k+"="+String(v));

async function githubArchive(owner,repo,ref,token){
 const u="https://api.github.com/repos/"+encodeURIComponent(owner)+"/"+encodeURIComponent(repo)+"/tarball/"+encodeURIComponent(ref);
 const r=await fetch(u,{headers:{authorization:"Bearer "+token,accept:"application/vnd.github+json","x-github-api-version":"2022-11-28"}});
 if(!r.ok||!r.body)throw new Error("GITHUB_ARCHIVE_FAILED");
 return Readable.fromWeb(r.body);
}
async function buildImage(body,tag){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"haspad-build-"));
 try{
  const archive=await githubArchive(required(body,"repositoryOwner"),required(body,"repositoryName"),body.branch||"main",required(body,"githubToken"));
  const archivePath=path.join(dir,"source.tar.gz"),file=await fs.open(archivePath,"w");
  try{for await(const chunk of archive)await file.write(chunk)}finally{await file.close()}
  const context=path.join(dir,"context");await fs.mkdir(context);
  await tar.x({file:archivePath,cwd:context,strip:1});
  const ignore=path.join(context,".dockerignore"),existing=await fs.readFile(ignore,"utf8").catch(()=> "");
  if(!existing.includes(".env"))await fs.writeFile(ignore,existing+"\n.git\n.env\n.env.*\nnode_modules\n");
  const build=await docker.buildImage(context,{t:tag,dockerfile:body.dockerfilePath||"Dockerfile"});
  await new Promise((resolve,reject)=>docker.modem.followProgress(build,(err)=>err?reject(err):resolve()));
 }finally{await fs.rm(dir,{recursive:true,force:true}).catch(()=>{})}
}
function labels(project,host,port,suffix){const r=clean(project,60)+"-"+clean(suffix,20);return {"haspad.project":clean(project,80),"haspad.runtime":r,"traefik.enable":"true",["traefik.http.routers."+r+".rule"]:"Host(`"+host+"`)",["traefik.http.routers."+r+".entrypoints"]:"websecure",["traefik.http.routers."+r+".tls"]:"true",["traefik.http.routers."+r+".tls.certresolver"]:"le",["traefik.http.services."+r+".loadbalancer.server.port"]:String(port)}}
async function ensureNetwork(name){
 const existing=docker.getNetwork(name);
 try{await existing.inspect();return existing}catch{}
 const n=await docker.createNetwork({Name:name,Driver:"bridge",Labels:{"haspad.managed":"true"}});
 return docker.getNetwork(n.id);
}
async function projectContainers(project){const a=await docker.listContainers({all:true,filters:{label:["haspad.project="+clean(project,80)]}});return a.map(x=>docker.getContainer(x.Id))}
async function waitReady(c,port,pathName="/",timeoutMs=60000){
 const deadline=Date.now()+timeoutMs;let last="";
 while(Date.now()<deadline){try{
   const i=await c.inspect(),net=process.env.DOCKER_NETWORK||"haspad-runtime",ip=i.NetworkSettings?.Networks?.[net]?.IPAddress;
   if(i.State?.Running&&ip){const r=await fetch("http://"+ip+":"+port+pathName,{signal:AbortSignal.timeout(2500)});if(r.status>=200&&r.status<500)return {ip,status:r.status}}
 }catch(e){last=String(e?.message||e)}await new Promise(r=>setTimeout(r,1500))}
 throw new Error("HEALTHCHECK_FAILED:"+last.slice(0,160));
}
async function pushRegistry(tag){
 const registry=process.env.REGISTRY_URL;if(!registry)return {tag,pushed:false};
 const image=tag.replace(/^haspad\//,registry.replace(/\/$/,"")+"/haspad/");
 const auth=process.env.REGISTRY_USERNAME&&process.env.REGISTRY_PASSWORD?{username:process.env.REGISTRY_USERNAME,password:process.env.REGISTRY_PASSWORD}:undefined;
 await docker.getImage(tag).tag({repo:image});
 const stream=await docker.getImage(image).push({authconfig:auth});
 await new Promise((resolve,reject)=>docker.modem.followProgress(stream,(err)=>err?reject(err):resolve()));
 return {tag:image,pushed:true};
}
export async function deploy(body){
 const projectId=required(body,"projectId"),runtimeId=clean(body.runtimeId||crypto.randomUUID(),80),port=Math.max(1,Math.min(65535,Number(body.port||3000))),host=required(body,"host"),tag="haspad/"+clean(projectId,50)+":"+clean(body.commitSha||runtimeId,60),network=process.env.DOCKER_NETWORK||"haspad-runtime";
 jobs.set(runtimeId,{status:"building",projectId});
 let createdContainer=null;
 try{
  await ensureNetwork(network);
  await buildImage(body,tag);const registry=await pushRegistry(tag);
  const name="haspad-"+clean(runtimeId,80),c=await docker.createContainer({name,Image:tag,Env:envPairs(body.env),ExposedPorts:{[port+"/tcp"]:{}},Labels:labels(projectId,host,port,runtimeId),User:"1000:1000",
   HostConfig:{NetworkMode:network,Memory:Number(body.memoryBytes||536870912),NanoCpus:Number(body.nanoCpus||1000000000),PidsLimit:Number(body.pidsLimit||256),ReadonlyRootfs:body.readonlyRootfs!==false,Tmpfs:{"/tmp":"rw,noexec,nosuid,size=256m"},SecurityOpt:["no-new-privileges:true"],CapDrop:["ALL"],RestartPolicy:{Name:"unless-stopped"},AutoRemove:false}});
  createdContainer=c; await c.start();const ready=await waitReady(c,port,body.healthcheckPath||"/");
  const old=(await projectContainers(projectId)).filter(x=>x.id!==c.id);for(const oc of old)await oc.remove({force:true}).catch(()=>{});
  const ii=await docker.getImage(tag).inspect();jobs.set(runtimeId,{status:"running",projectId,containerId:c.id,image:tag,startedAt:new Date().toISOString(),host});
  return {success:true,runtimeId,containerId:c.id,image:tag,digest:ii.Id,publicUrl:"https://"+host,health:ready.status,registry};
 }catch(e){if(createdContainer)await createdContainer.remove({force:true}).catch(()=>{});jobs.set(runtimeId,{status:"failed",projectId,error:String(e?.message||e)});throw e}finally{body.githubToken=""}
}
export async function getRuntimeStatus(id){const j=jobs.get(clean(id,80));if(!j?.containerId)return j||{status:"unknown"};try{const i=await docker.getContainer(j.containerId).inspect();return {...j,status:i.State?.Status||j.status,health:i.State?.Health?.Status||null,restarts:i.RestartCount}}catch{return {...j,status:"gone"}}}
export async function getLogs(id){const j=jobs.get(clean(id,80));if(!j?.containerId)throw Error("RUNTIME_NOT_FOUND");const b=await docker.getContainer(j.containerId).logs({stdout:true,stderr:true,tail:500,timestamps:true});return {runtimeId:id,logs:b.toString("utf8").slice(-100000)}}
export async function rollback(body){const id=required(body,"runtimeId"),image=required(body,"previousImage"),projectId=required(body,"projectId"),host=required(body,"host"),port=Number(body.port||3000),network=process.env.DOCKER_NETWORK||"haspad-runtime",name="haspad-"+clean(id,80),c=await docker.createContainer({name,Image:image,Env:envPairs(body.env),ExposedPorts:{[port+"/tcp"]:{}},Labels:labels(projectId,host,port,"rollback"),User:"1000:1000",HostConfig:{NetworkMode:network,Memory:536870912,NanoCpus:1000000000,PidsLimit:256,ReadonlyRootfs:true,Tmpfs:{"/tmp":"rw,noexec,nosuid,size=256m"},SecurityOpt:["no-new-privileges:true"],CapDrop:["ALL"],RestartPolicy:{Name:"unless-stopped"}}});await c.start();await waitReady(c,port,body.healthcheckPath||"/");for(const oc of await projectContainers(projectId)){if(oc.id!==c.id)await oc.remove({force:true}).catch(()=>{})}jobs.set(id,{status:"running",projectId,containerId:c.id,image,host});return {success:true,runtimeId:id,containerId:c.id,image}}

export async function restartRuntime(id){
 const j=jobs.get(clean(id,80)); if(!j?.containerId) throw Error("RUNTIME_NOT_FOUND");
 const container=docker.getContainer(j.containerId); await container.restart(); jobs.set(clean(id,80),{...j,status:"running",restartedAt:new Date().toISOString()});
 return {success:true,runtimeId:id,status:"running"};
}
export async function stopRuntime(id){
 const j=jobs.get(clean(id,80)); if(!j?.containerId) throw Error("RUNTIME_NOT_FOUND");
 const container=docker.getContainer(j.containerId); await container.stop().catch(()=>{}); jobs.set(clean(id,80),{...j,status:"stopped",stoppedAt:new Date().toISOString()});
 return {success:true,runtimeId:id,status:"stopped"};
}
