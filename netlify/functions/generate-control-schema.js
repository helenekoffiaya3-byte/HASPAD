import {admin,json,authenticatedUser} from "./_credits.js";
const MODEL=process.env.GEMINI_MODEL||"gemini-3.8-flash";
const TYPES=new Set(["text","integer","numeric","boolean","uuid","timestamptz","jsonb"]);
function extract(text){const cleaned=String(text||"").replace(/^\s*\`\`\`json\s*/i,"").replace(/\s*\`\`\`\s*$/,"").trim();return JSON.parse(cleaned);}
function validateBlueprint(x){
 if(!x||!Array.isArray(x.tables)||x.tables.length>12)throw new Error("INVALID_BLUEPRINT");
 for(const t of x.tables){if(!/^[a-z][a-z0-9_]{1,62}$/.test(t.name)||!Array.isArray(t.columns)||t.columns.length>32)throw new Error("INVALID_TABLE");for(const c of t.columns){if(!/^[a-z][a-z0-9_]{0,62}$/.test(c.name)||!TYPES.has(c.type))throw new Error("INVALID_COLUMN");}}
 return x;
}
export default async(req)=>{
 if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
 const user=await authenticatedUser(req);if(!user)return json(401,{error:"Unauthorized"});
 let body;try{body=JSON.parse(req.body||"{}")}catch{return json(400,{error:"JSON invalide."})}
 const {site_id,prompt}=body;if(!site_id||!prompt||String(prompt).length>6000)return json(400,{error:"site_id et prompt requis."});
 const {data:member}=await admin.from("sites").select("id").eq("site_id",site_id).eq("user_id",user.id).maybeSingle();if(!member)return json(403,{error:"Accès refusé."});
 const {data:sub}=await admin.from("subscriptions").select("status").eq("user_id",user.id).eq("plan_name","startup").eq("status","active").limit(1).maybeSingle();if(!sub)return json(402,{error:"Le plan Startup actif est requis."});
 if(!process.env.GEMINI_API_KEY)return json(503,{error:"GEMINI_API_KEY manquante."});
 const system="Tu es l'architecte PostgreSQL du Centre de Contrôle HASPAD Startup. Génère UNIQUEMENT un blueprint JSON, jamais de SQL exécutable. Autorisé: tables, colonnes, types, relations. Types autorisés: text, integer, numeric, boolean, uuid, timestamptz, jsonb. Maximum 12 tables et 32 colonnes/table. Le blueprint doit rester lié au contrôle, métriques, erreurs, pages, composants, recommandations et configuration. Ne demande ni secrets ni données personnelles. Format: {tables:[{name,columns:[{name,type,nullable,primaryKey}],foreignKeys:[{column,table,column}]}],explanation:string}.";
 const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(MODEL)+":generateContent",{method:"POST",headers:{"x-goog-api-key":process.env.GEMINI_API_KEY,"content-type":"application/json"},body:JSON.stringify({system_instruction:{parts:[{text:system}]},contents:[{parts:[{text:String(prompt)}]}]})});
 if(!response.ok)return json(502,{error:"Gemini indisponible."});
 const raw=await response.json();const text=raw?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
 try{const blueprint=validateBlueprint(extract(text));const {data,error}=await admin.from("control_schema_requests").insert({site_id,user_id:user.id,request_text:String(prompt),schema_blueprint:blueprint,status:"applied"}).select("id,created_at").single();if(error)throw error;await admin.from("ai_activity_logs").insert({site_id,agent_name:"Architect",action_taken:"control_schema_blueprint",details:{requestId:data.id,tableCount:blueprint.tables.length}});return json(200,{ok:true,requestId:data.id,blueprint});}catch(e){return json(422,{error:"Le blueprint Gemini ne respecte pas le périmètre HASPAD."});}
};
