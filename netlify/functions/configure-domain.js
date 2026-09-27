import {admin,json,authenticatedUser} from "./_credits.js";
const EXTENSIONS=new Set([".com",".io",".fr",".ci"]);
const validSubdomain=v=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v);
export default async(req)=>{
 if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
 const user=await authenticatedUser(req);if(!user)return json(401,{error:"Unauthorized"});
 let body;try{body=await req.json()}catch{return json(400,{error:"JSON invalide."})}
 const projectId=String(body.projectId||"").trim(),subdomain=String(body.subdomain||"").trim().toLowerCase(),ext=String(body.domainExtension||"").trim().toLowerCase();
 if(!projectId||!validSubdomain(subdomain)||!EXTENSIONS.has(ext))return json(400,{error:"Données de domaine invalides."});
 const {data:membership,error:memberError}=await admin.from("sites").select("id").eq("id",projectId).eq("user_id",user.id).maybeSingle();
 if(memberError||!membership)return json(403,{error:"Projet inaccessible."});
 const domain=subdomain+ext;
 const {data:existing}=await admin.from("project_domains").select("id").eq("full_domain",domain).maybeSingle();
 if(existing)return json(409,{error:"Ce domaine est déjà enregistré."});
 const {data:row,error}=await admin.from("project_domains").insert({project_id:projectId,user_id:user.id,subdomain,domain_extension:ext,is_primary:true,status:"pending_dns"}).select("id,project_id,subdomain,domain_extension,full_domain,is_primary,status,created_at").single();
 if(error)return json(500,{error:"Impossible d'enregistrer le domaine."});
 return json(201,{domain:row});
};