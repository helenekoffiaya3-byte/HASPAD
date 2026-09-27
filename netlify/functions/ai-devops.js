import { GoogleGenAI } from "@google/genai";
import { getUser } from "@netlify/identity";
import { json } from "./_credits.js";

const env=name=>globalThis.Netlify?.env?.get?.(name)??process.env[name];

export default async req=>{
  if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
  const user=await getUser();if(!user)return json(401,{error:"Unauthorized"});
  const body=await req.json().catch(()=>null);
  if(!body?.prompt)return json(400,{error:"prompt requis."});
  const key=env("GEMINI_API_KEY");if(!key)return json(503,{error:"GEMINI_API_KEY_NOT_CONFIGURED"});
  const model=env("GEMINI_MODEL")||"gemini-3.1-pro";
  try{
    const ai=new GoogleGenAI({apiKey:key});
    const response=await ai.models.generateContent({
      model,
      contents:body.prompt,
      config:{systemInstruction:"Tu es l'agent DevOps de HASPAD. Analyse les dépôts, Dockerfiles, logs et configurations. Donne des corrections concrètes, sûres et reproductibles. Ne révèle jamais de secrets."}
    });
    return json(200,{success:true,model,text:response.text||""});
  }catch(error){
    console.error("ai-devops",error);
    return json(502,{error:"GEMINI_REQUEST_FAILED"});
  }
};
