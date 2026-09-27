import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";
import { githubConnection } from "./_github.js";
import { deploymentTarget } from "./_deployment-router.js";
const env=n=>globalThis.Netlify?.env?.get?.(n)??process.env[n],api="https://api.github.com";
const gh=async(p,t)=>{const r=await fetch(api+p,{headers:{authorization:"Bearer "+t,accept:"application/vnd.github+json","x-github-api-version":env("GITHUB_API_VERSION")||"2022-11-28"}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||"GITHUB_API_ERROR");return d};
function analyze(names,c){
 const set=new Set(names),has=x=>set.has(x);let runtime="unknown",framework=null,dockerfilePath=null,port=null,buildCommand=null,startCommand=null,publishDirectory=null;
 if(has("Dockerfile")){runtime="docker";dockerfilePath="Dockerfile";const m=(c.Dockerfile||"").match(/^EXPOSE\s+(\d+)/mi);port=m?Number(m[1]):null}
 else if(has("docker-compose.yml")||has("docker-compose.yaml"))runtime="docker-compose";
 else if(has("package.json")){runtime="node";try{const p=JSON.parse(c["package.json"]||"{}"),d={...(p.dependencies||{}),...(p.devDependencies||{})};if(d.next)framework="next";else if(d.vite)framework="vite";else if(d["@angular/core"])framework="angular";else if(d.vue)framework="vue";else if(d.react)framework="react";else if(d.express)framework="express";else if(d.fastify)framework="fastify";else if(d["@nestjs/core"])framework="nestjs";buildCommand=p.scripts?.build||null;startCommand=p.scripts?.start||null}catch{}}
 else if(has("requirements.txt")||has("pyproject.toml")){runtime="python";const s=(c["requirements.txt"]||"")+"\n"+(c["pyproject.toml"]||"");if(/fastapi/i.test(s))framework="fastapi";else if(/django/i.test(s))framework="django";else if(/flask/i.test(s))framework="flask"}
 else if(has("go.mod"))runtime="go";else if(has("composer.json"))runtime="php";else if(has("index.html"))runtime="static";
 const es={};for(const line of (c[".env.example"]||"").split(/\r?\n/)){const m=line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|$)/);if(m)es[m[1]]={required:false}};
 const routing=deploymentTarget({runtime,framework,detectedFiles:names,publishDirectory});
 return {runtime,framework,dockerfilePath,port,buildCommand,startCommand,publishDirectory,detectedFiles:names,environmentSchema:es,runtimeTarget:routing.target,provider:routing.provider,routingReason:routing.reason};
}
export default async req=>{
 if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});const user=await getUser();if(!user)return json(401,{error:"Unauthorized"});
 const b=await req.json().catch(()=>null);if(!b?.siteId||!b?.repositoryOwner||!b?.repositoryName)return json(400,{error:"siteId, repositoryOwner et repositoryName requis"});
 const site=(await admin.from("sites").select("id,user_id,subdomain").eq("id",b.siteId).maybeSingle()).data;if(!site||String(site.user_id)!==String(user.id))return json(403,{error:"Forbidden"});
 try{const x=await githubConnection(user.id);if(!x)return json(400,{error:"GITHUB_NOT_CONNECTED"});const tree=await gh("/repos/"+encodeURIComponent(b.repositoryOwner)+"/"+encodeURIComponent(b.repositoryName)+"/git/trees/"+encodeURIComponent(b.branch||"main")+"?recursive=1",x.token);const names=(tree.tree||[]).filter(z=>z.type==="blob").map(z=>z.path).filter(z=>z.length<300);const wanted=names.filter(z=>["Dockerfile","docker-compose.yml","docker-compose.yaml","package.json","requirements.txt","pyproject.toml","go.mod","composer.json","index.html",".env.example"].includes(z)).slice(0,30);const c={};for(const p of wanted){const q=await gh("/repos/"+encodeURIComponent(b.repositoryOwner)+"/"+encodeURIComponent(b.repositoryName)+"/contents/"+p+"?ref="+encodeURIComponent(b.branch||"main"),x.token);if(q.content)c[p]=Buffer.from(q.content,"base64").toString("utf8").slice(0,200000)}return json(200,{success:true,...analyze(names,c),repository:{owner:b.repositoryOwner,name:b.repositoryName,branch:b.branch||"main"}})}catch(e){console.error("project-analyze",e?.message||e);return json(502,{error:"PROJECT_ANALYSIS_FAILED"})}
};