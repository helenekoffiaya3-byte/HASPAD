import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";

const files = [
  ["Dockerfile","docker"],
  ["docker-compose.yml","docker-compose"],
  ["docker-compose.yaml","docker-compose"],
  ["package.json","node"],
  ["pnpm-lock.yaml","node"],
  ["yarn.lock","node"],
  ["requirements.txt","python"],
  ["pyproject.toml","python"],
  ["go.mod","go"],
  ["composer.json","php"],
  ["index.html","static"]
];

function detect(list){
  const names=new Set((list||[]).map(x=>String(x).replace(/^\.\//,"")));
  if(names.has("Dockerfile"))return {runtime:"docker",dockerfilePath:"Dockerfile"};
  if(names.has("docker-compose.yml")||names.has("docker-compose.yaml"))return {runtime:"docker-compose"};
  if(names.has("package.json"))return {runtime:"node"};
  if(names.has("requirements.txt")||names.has("pyproject.toml"))return {runtime:"python"};
  if(names.has("go.mod"))return {runtime:"go"};
  if(names.has("composer.json"))return {runtime:"php"};
  if(names.has("index.html"))return {runtime:"static"};
  return {runtime:"unknown"};
}

export default async req=>{
  if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
  const user=await getUser();if(!user)return json(401,{error:"Unauthorized"});
  const body=await req.json().catch(()=>null);
  if(!body||!Array.isArray(body.files))return json(400,{error:"files[] requis."});
  const names=body.files.map(x=>typeof x==="string"?x:x?.path).filter(Boolean);
  const result=detect(names);
  const envSchema={};
  if(result.runtime==="docker"||result.runtime==="docker-compose")envSchema.PORT={required:false,default:"3000",description:"Port HTTP exposé par le conteneur"};
  if(result.runtime==="node")envSchema.NODE_ENV={required:false,default:"production"};
  return json(200,{
    success:true,
    runtime:result.runtime,
    dockerfilePath:result.dockerfilePath||null,
    detectedFiles:names,
    environmentSchema:envSchema,
    capabilities:{
      git:true,
      staticHosting:true,
      containerBuild:result.runtime==="docker"||result.runtime==="docker-compose",
      backend:true,
      frontend:true
    },
    note:(result.runtime==="docker"||result.runtime==="docker-compose")
      ?"Le Dockerfile est détecté. L'exécution nécessite un runtime conteneur configuré pour le projet."
      :"Type de projet détecté."
  });
};
