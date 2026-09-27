import {createServerClient} from "@supabase/ssr";
import {admin,refreshCookie} from "./_auth.js";
function parseCookies(req){return (req.headers.cookie||"").split(/;\s*/).filter(Boolean).map(v=>{const i=v.indexOf("=");return {name:v.slice(0,i),value:decodeURIComponent(v.slice(i+1))};});}
function serializeCookie(name,value,options={}){let s=name+"="+encodeURIComponent(value);if(options.maxAge!=null)s+="; Max-Age="+Math.floor(options.maxAge);if(options.domain)s+="; Domain="+options.domain;s+="; Path="+(options.path||"/");if(options.httpOnly)s+="; HttpOnly";if(options.secure)s+="; Secure";if(options.sameSite)s+="; SameSite="+options.sameSite;return s;}
function page(token){const safe=JSON.stringify(token).replace(/</g,"\\u003c");return "<!doctype html><html><head><meta charset=\"utf-8\"><title>Connexion…</title></head><body><p>Connexion…</p><script>sessionStorage.setItem(\"haspad:access_token\","+safe+");location.replace(\"/\");</script></body></html>";}
export default async(req)=>{
  const url=new URL(req.url),code=url.searchParams.get("code"),target=process.env.FRONTEND_URL||"/";
  if(!code)return {statusCode:302,headers:{Location:target+"?error=sso_failed"}};
  const setCookies=[];
  const supabase=createServerClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{cookies:{getAll:()=>parseCookies(req),setAll:(items)=>{for(const c of items)setCookies.push(serializeCookie(c.name,c.value,c.options));}}});
  const {data,error}=await supabase.auth.exchangeCodeForSession(code);
  if(error||!data.user||!data.session)return {statusCode:302,headers:{Location:target+"?error=sso_failed"},multiValueHeaders:{"Set-Cookie":setCookies}};
  const user=data.user;
  const {data:members}=await admin.from("site_members").select("site_id").eq("user_id",user.id).limit(1);
  if(!members?.length){
    const name=user.user_metadata?.full_name||user.user_metadata?.name||user.email?.split("@")[0]||"Utilisateur";
    const siteName=("Projet de "+name).slice(0,80);
    const {data:site,error:siteError}=await admin.from("sites").insert({user_id:user.id,name:siteName,subdomain:"oauth-"+user.id.slice(0,8),status:"draft"}).select("id").maybeSingle();
    if(siteError)return {statusCode:500,body:"Impossible de préparer l'espace utilisateur."};
    if(site?.id)await admin.from("pages").insert({site_id:site.id,slug:"index",seo:{title:"Accueil"},root_block:{id:"blk_root",type:"section",props:{semanticTag:"main"},styles:{desktop:{padding:"40px 20px"}},children:[{id:"blk_welcome_heading",type:"heading",props:{level:1,text:"Bienvenue sur "+name},styles:{desktop:{fontSize:"36px",textAlign:"center"}}}]}});
  }
  setCookies.push(refreshCookie(data.session.refresh_token));
  return {statusCode:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"},multiValueHeaders:{"Set-Cookie":setCookies},body:page(data.session.access_token)};
};