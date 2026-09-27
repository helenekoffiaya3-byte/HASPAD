import {json} from "./_credits.js";
const EXTENSIONS=new Set([".com",".io",".fr",".ci"]);
const validSubdomain=v=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v);
export default async(req)=>{
 if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
 let body;try{body=JSON.parse(req.body||"{}")}catch{return json(400,{error:"JSON invalide."})}
 const subdomain=String(body.subdomain||"").trim().toLowerCase(),ext=String(body.domainExtension||"").trim().toLowerCase();
 if(!validSubdomain(subdomain)||!EXTENSIONS.has(ext))return json(400,{error:"Nom ou extension de domaine invalide."});
 const domain=subdomain+ext;
 try{
  const r=await fetch("https://rdap.org/domain/"+encodeURIComponent(domain),{headers:{"accept":"application/rdap+json","user-agent":"HASP​AD/1.0"}});
  if(r.status===404)return json(200,{domain,available:true,status:"available"});
  if(r.ok)return json(200,{domain,available:false,status:"taken"});
  return json(503,{error:"Service de disponibilité temporairement indisponible."});
 }catch{return json(503,{error:"Service de disponibilité temporairement indisponible."})}
};