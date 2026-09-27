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
  const archivePath=path.join(dir,"source.tar.gz");
  const file=await fs.open(archivePath,"w");
  try{for await(const chunk of archive)await file.write(chunk)}finally{await file.close()}
  const context=path.join(dir,"context");await fs.mkdir(context);
  await tar.x({file:archivePath,cwd:context,strip:1});
  const ignore=path.join(context,".dockerignore");
  const existing=await fs.readFile(ignore,"utf8").catch(()=> "");
  const mandatory="\n.git\n.env\n.env.*\nnode_modules\n";
  if(!existing.includes(".env"))await fs.writeFile(ignore,existing+mandatory);
  const build=await docker.buildImage(context,{t:tag,dockerfile:body.dockerfilePath||"Dockerfile"});
  await new Promise((resolve,reject)=>docker.modem.followProgress(build,(err)=>err?reject(err):resolve()));
 }finally{await fs.rm(dir,{recursive:true,force:true}).catch(()=>{})}
}
function labels(name,host,port){const r=clean(name);return {"traefik.enable":"true",["traefik.http.routers."+r+".rule"]:"Host(`"+host+"`)",["traefik.http.routers."+r+".entrypoints"]:"web",["traefik.http.services."+r+".loadbalancer.server.port"]:String(port)}}
async function removeExisting(name){try{const c=docker.getContainer(name);await c.inspect();await c.remove({force:true})}catch{}}
export async function deploy(body){
 const runtimeId=clean(body.runtimeId||crypto.randomUUID(),80),name="haspad-"+runtimeId,port=Math.max(1,Math.min(65535,Number(body.port||3000))),host=required(body,"host"),tag="haspad/"+clean(body.projectId||runtimeId,50)+":"+clean(body.commitSha||Date.now(),60);
 jobs.set(runtimeId,{status:"building",name});
 try{
  await buildImage(body,tag);await removeExisting(name);
  const network=process.env.DOCKER_NETWORK||"haspad-runtime";try{await docker.createNetwork({Name:network,Driver:"bridge"})}catch{}
  const env=Object.entries(body.env||{}).filter(([k,v])=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)&&v!=null).map(([k,v])=>k+"="+String(v));
  const c=await docker.createContainer({name,Image:tag,Env:env,ExposedPorts:{[port+"/tcp"]:{}},Labels:labels(name,host,port),User:"1000:1000",
   HostConfig:{NetworkMode:network,Memory:Number(body.memoryBytes||536870912),NanoCpus:Number(body.nanoCpus||1000000000),PidsLimit:Number(body.pidsLimit||256),ReadonlyRootfs:body.readonlyRootfs!==false,Tmpfs:{"/tmp":"rw,noexec,nosuid,size=256m"},SecurityOpt:["no-new-privileges:true"],CapDrop:["ALL"],RestartPolicy:{Name:"unless-stopped"},AutoRemove:false}});
  await c.start();const ii=await docker.getImage(tag).inspect();jobs.set(runtimeId,{status:"running",containerId:c.id,image:tag,startedAt:new Date().toISOString(),host});
  return {success:true,runtimeId,containerId:c.id,image:tag,digest:ii.Id,publicUrl:"https://"+host};
 }catch(e){jobs.set(runtimeId,{status:"failed",error:String(e?.message||e)});throw e}
 finally{body.githubToken=""}
}
export async function getRuntimeStatus(id){const j=jobs.get(clean(id,80));if(!j?.containerId)return j||{status:"unknown"};try{const i=await docker.getContainer(j.containerId).inspect();return {...j,status:i.State?.Status||j.status,health:i.State?.Health?.Status||null}}catch{return {...j,status:"gone"}}}
export async function getLogs(id){const j=jobs.get(clean(id,80));if(!j?.containerId)throw Error("RUNTIME_NOT_FOUND");const b=await docker.getContainer(j.containerId).logs({stdout:true,stderr:true,tail:500,timestamps:true});return {runtimeId:id,logs:b.toString("utf8").slice(-100000)}}
export async function rollback(body){const id=required(body,"runtimeId"),image=required(body,"previousImage"),name="haspad-"+clean(id,80),port=Number(body.port||3000),network=process.env.DOCKER_NETWORK||"haspad-runtime";await removeExisting(name);const c=await docker.createContainer({name,Image:image,Env:Object.entries(body.env||{}).map(([k,v])=>k+"="+v),ExposedPorts:{[port+"/tcp"]:{}},Labels:labels(name,body.host,port),User:"1000:1000",HostConfig:{NetworkMode:network,Memory:536870912,NanoCpus:1000000000,PidsLimit:256,ReadonlyRootfs:true,Tmpfs:{"/tmp":"rw,noexec,nosuid,size=256m"},SecurityOpt:["no-new-privileges:true"],CapDrop:["ALL"],RestartPolicy:{Name:"unless-stopped"}}});await c.start();jobs.set(id,{status:"running",containerId:c.id,image,host:body.host});return {success:true,runtimeId:id,containerId:c.id,image}}
