import {json,authenticatedUser,provisionInitialSite,admin} from "./_auth.js";

function env(name){
  return globalThis.Netlify?.env?.get?.(name) ?? undefined;
}
function slugify(value){
  return String(value).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,50)||"haspad-site";
}
async function createNetlifySite(name){
  const token=env("NETLIFY_AUTH_TOKEN");
  if(!token)throw new Error("NETLIFY_AUTH_TOKEN_NOT_CONFIGURED");
  const team=env("NETLIFY_TEAM_SLUG");
  const url=team
    ? "https://api.netlify.com/api/v1/"+encodeURIComponent(team)+"/sites"
    : "https://api.netlify.com/api/v1/sites";
  const response=await fetch(url,{method:"POST",headers:{"authorization":"Bearer "+token,"content-type":"application/json","accept":"application/json"},body:JSON.stringify({name})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.id)throw new Error("NETLIFY_SITE_CREATE_FAILED");
  return data;
}
export default async(req)=>{
  if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
  const user=await authenticatedUser(req);
  if(!user)return json(401,{error:"Unauthorized"});
  let body;try{body=JSON.parse(req.body||"{}")}catch{return json(400,{error:"JSON invalide."})}
  const siteName=String(body.siteName||"").trim().slice(0,80);
  if(siteName.length<1)return json(400,{error:"Nom du projet requis."});

  let site;
  try{
    site=await provisionInitialSite(user,{siteName});
    const netlify=await createNetlifySite(slugify(siteName)+"-"+site.id.slice(0,8));
    const {data:updated,error:updateError}=await admin.from("sites").update({
      netlify_site_id:netlify.id,
      netlify_url:netlify.ssl_url||netlify.url||null
    }).eq("id",site.id).eq("user_id",user.id).select("id,name,subdomain,custom_domain,status,netlify_site_id,netlify_url").single();
    if(updateError)throw updateError;
    return json(201,{site:updated});
  }catch(error){
    console.error("create-site:",error);
    if(site?.id){
      await admin.from("sites").delete().eq("id",site.id).eq("user_id",user.id);
    }
    const message=error?.message==="NETLIFY_AUTH_TOKEN_NOT_CONFIGURED"
      ?"Netlify n'est pas encore configuré côté serveur."
      :"Impossible de créer le projet.";
    return json(error?.message==="NETLIFY_AUTH_TOKEN_NOT_CONFIGURED"?503:500,{error:message});
  }
};