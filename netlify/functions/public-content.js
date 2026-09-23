import {createClient} from "@supabase/supabase-js";
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
export default async(req)=>{
  const host=(req.headers.host||"").split(":")[0].toLowerCase().replace(/^www\./,"");
  if(!host)return {statusCode:400,body:"Host requis"};
  const {data:site}=await db.from("sites").select("id").or(`subdomain.eq.${host},custom_domain.eq.${host}`).maybeSingle();
  if(!site)return {statusCode:404,body:"Site introuvable"};
  const {data:dep}=await db.from("deployments").select("snapshot,version_hash").eq("site_id",site.id).eq("is_active",true).eq("status","ready").maybeSingle();
  if(!dep)return {statusCode:404,body:"Aucun déploiement actif"};
  return {statusCode:200,headers:{"content-type":"application/json","cache-control":"public, s-maxage=60, stale-while-revalidate=300"},body:JSON.stringify(dep.snapshot)};
};