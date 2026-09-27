import { GoogleGenAI } from "@google/genai";
import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";
import { runtimeRequest } from "./_runtime.js";

const env=n=>globalThis.Netlify?.env?.get?.(n)??process.env[n];

export default async req=>{
  if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
  const user=await getUser();if(!user)return json(401,{error:"Unauthorized"});
  const b=await req.json().catch(()=>null);if(!b?.buildId)return json(400,{error:"buildId requis"});
  const build=(await admin.from("project_builds").select("*").eq("id",b.buildId).maybeSingle()).data;
  if(!build||String(build.user_id)!==String(user.id))return json(404,{error:"BUILD_NOT_FOUND"});
  const key=env("GEMINI_API_KEY");if(!key)return json(503,{error:"GEMINI_API_KEY_NOT_CONFIGURED"});
  let logs="";
  try{logs=(await runtimeRequest("/v1/logs/"+encodeURIComponent(b.buildId),{},"GET")).logs||""}catch{}
  const prompt=[
    "HASPAD deployment diagnosis.",
    "Analyze the deployment failure using only the supplied metadata and logs.",
    "Return JSON with keys: rootCause, evidence, fixes, risk, retryRecommended.",
    "Never request or expose secrets. Do not invent missing facts.",
    "Build metadata:",JSON.stringify({id:build.id,status:build.status,repo:build.repository_owner+"/"+build.repository_name,branch:build.branch,error:build.error_message}),
    "Logs:",logs.slice(-30000)
  ].join("\n");
  try{
    const ai=new GoogleGenAI({apiKey:key}),model=env("GEMINI_MODEL")||"gemini-3.1-pro-preview";
    const response=await ai.models.generateContent({model,contents:prompt,config:{systemInstruction:"Tu es l'agent de diagnostic DevOps de HASPAD. Sois précis, reproductible et prudent. Ne révèle jamais de secrets."}});
    const text=response.text||"";
    await admin.from("ai_diagnostics").insert({build_id:build.id,site_id:build.site_id,diagnosis:{model,text},created_at:new Date().toISOString()});
    return json(200,{success:true,model,text});
  }catch(e){console.error("deployment-diagnose",e?.message||e);return json(502,{error:"GEMINI_REQUEST_FAILED"})}
};