import {admin,json,authenticatedUser} from "./_credits.js";
const UUID=/^[0-9a-f-]{36}$/i;
export default async(req)=>{
  if(req.method!=="GET")return json(405,{error:"Method Not Allowed"});
  const user=await authenticatedUser(req);if(!user)return json(401,{error:"Unauthorized"});
  const siteId=new URL(req.url,"https://haspad.local").searchParams.get("site_id");
  if(!UUID.test(siteId||""))return json(400,{error:"site_id invalide."});
  const {data:site,error:siteError}=await admin.from("sites").select("id").eq("id",siteId).eq("user_id",user.id).maybeSingle();
  if(siteError)return json(500,{error:"Vérification du projet impossible."});
  if(!site)return json(403,{error:"Accès refusé."});
  const [{data:pages,error:pagesError},{data:structured,error:structuredError}]=await Promise.all([
    admin.from("pages").select("id,slug,seo,root_block,created_at").eq("site_id",siteId).order("slug"),
    admin.from("site_pages").select("id,slug,title,is_published,layout_config,updated_at").eq("site_id",siteId).order("slug")
  ]);
  if(pagesError||structuredError)return json(500,{error:"Impossible de charger les pages."});
  const bySlug=new Map();
  for(const p of pages||[])bySlug.set(p.slug,{id:p.id,slug:p.slug,title:p.seo?.title||p.slug,is_published:true,root:p.root_block||{}});
  for(const p of structured||[])bySlug.set(p.slug,{id:p.id,slug:p.slug,title:p.title,is_published:p.is_published,root:p.layout_config||{}});
  return json(200,{siteId,siteRole:"owner",pages:[...bySlug.values()]});
};