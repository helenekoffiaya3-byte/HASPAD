import {createServerClient} from "@supabase/ssr";
import {admin,refreshCookie,provisionInitialSite} from "./_auth.js";

function parseCookies(req){return (req.headers.cookie||"").split(/;\s*/).filter(Boolean).map(v=>{const i=v.indexOf("=");return {name:v.slice(0,i),value:decodeURIComponent(v.slice(i+1))};});}
function serializeCookie(name,value,options={}){let s=`${name}=${encodeURIComponent(value)}`;if(options.maxAge!=null)s+=`; Max-Age=${Math.floor(options.maxAge)}`;if(options.domain)s+=`; Domain=${options.domain}`;s+=`; Path=${options.path||"/"}`;if(options.httpOnly)s+="; HttpOnly";if(options.secure)s+="; Secure";if(options.sameSite)s+=`; SameSite=${options.sameSite}`;return s;}

export default async(req)=>{
  const url=new URL(req.url),code=url.searchParams.get("code");
  const target=process.env.FRONTEND_URL||"/auth.html";
  if(!code)return {statusCode:302,headers:{Location:`${target}?error=sso_failed`}};
  const setCookies=[];
  const supabase=createServerClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{cookies:{
    getAll:()=>parseCookies(req),
    setAll:(items)=>{for(const c of items)setCookies.push(serializeCookie(c.name,c.value,c.options));}
  }});
  const {data,error}=await supabase.auth.exchangeCodeForSession(code);
  if(error||!data.user||!data.session)return {statusCode:302,headers:{Location:`${target}?error=sso_failed`},multiValueHeaders:{"Set-Cookie":setCookies}};
  const user=data.user;
  const {data:members}=await admin.from("site_members").select("site_id").eq("user_id",user.id).limit(1);
  if(!members?.length)await provisionInitialSite(user,{siteName:`Projet de ${user.user_metadata?.full_name||user.user_metadata?.name||user.email?.split("@")[0]||"Utilisateur"}`});
  setCookies.push(refreshCookie(data.session.refresh_token));
  return {statusCode:302,headers:{Location:target,"cache-control":"no-store"},multiValueHeaders:{"Set-Cookie":setCookies}};
};