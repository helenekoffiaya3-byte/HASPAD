import { GoogleGenAI } from "@google/genai";
import { getUser } from "@netlify/identity";
import { admin, json } from "./_credits.js";
const env=n=>globalThis.Netlify?.env?.get?.(n)??process.env[n];
const safe=(v,n=30000)=>String(v??"").slice(0,n);
async function run(model,prompt,system){
 const key=env("GEMINI_API_KEY");if(!key)throw Error("GEMINI_API_KEY_NOT_CONFIGURED");
 const ai=new GoogleGenAI({apiKey:key});
 const r=await ai.models.generateContent({model,contents:prompt,config:{systemInstruction:system}});
 return r.text||"";
}
export default async req=>{
 if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
 const user=await getUser();if(!user)return json(401,{error:"Unauthorized"});
 const b=await req.json().catch(()=>null);if(!b?.agent||!b?.buildId)return json(400,{error:"agent et buildId requis"});
 const build=(await admin.from("project_builds").select("*").eq("id",b.buildId).maybeSingle()).data;
 if(!build||String(build.user_id)!==String(user.id))return json(404,{error:"BUILD_NOT_FOUND"});
 const model=env("GEMINI_MODEL")||"gemini-3.1-pro-preview",agent=String(b.agent);
 try{
  let report,field;
  if(agent==="architect"){
   field="ai_architect_report";
   report=await run(model,"Analyse ce projet HASPAD et propose une stratégie de conteneurisation.\nFichiers: "+safe(b.fileTree,20000)+"\nConfigurations: "+safe(b.config,20000)+"\nContraintes: port="+safe(b.port,20)+" build="+safe(b.buildCommand,500)+" start="+safe(b.startCommand,500)+"\nRéponds en JSON strict avec detected_stack, recommended_port, generated_dockerfile, suggested_env_vars. N'inclus aucun secret ni valeur de secret.","Tu es l'Architecte Containerization de HASPAD. Génère uniquement des recommandations techniquement vérifiables. Ne révèle jamais de secrets.");
  }else if(agent==="devops"){
   field="ai_devops_report";
   report=await run(model,"Diagnostique cet échec de build HASPAD.\nLogs:\n"+safe(b.logs,30000)+"\nDockerfile:\n"+safe(b.dockerfile,15000)+"\nContexte:\n"+safe(b.repoContext,10000)+"\nDonne cause racine, preuve, correctif précis et prévention. Ne demande pas de secret.","Tu es le DevOps Debugger de HASPAD. Base-toi uniquement sur les éléments fournis et signale les incertitudes.");
  }else if(agent==="sre"){
   field="ai_sre_report";
   report=await run(model,"Audite ce runtime HASPAD.\nLogs:\n"+safe(b.logs,30000)+"\nMétriques:\n"+safe(b.metrics,10000)+"\nRetourne un rapport avec health, security, performance, findings et recommended_actions. Ne reproduis aucune credential.","Tu es l'agent SRE & Security de HASPAD. Identifie les risques observables sans prétendre effectuer un scan qui n'a pas été fourni.");
  }else return json(400,{error:"UNKNOWN_AGENT"});
  await admin.from("project_builds").update({[field]:report,updated_at:new Date().toISOString()}).eq("id",build.id);
  return json(200,{success:true,agent,model,report});
 }catch(e){console.error("ai-orchestrator",e?.message||e);return json(502,{error:"AI_AGENT_FAILED"})}
};
