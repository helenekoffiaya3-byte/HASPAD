import {createClient} from "@supabase/supabase-js";
import crypto from "crypto";

export const admin=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
export const publicDb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{autoRefreshToken:false,persistSession:false}});

export const json=(status,body,headers={})=>({statusCode:status,headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});
export const normalizeEmail=e=>String(e||"").trim().toLowerCase();
export const validEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const validPassword=p=>typeof p==="string"&&p.length>=10&&p.length<=128;

export const refreshCookie=(token,maxAge=7*24*60*60)=>{
  const secure=process.env.NODE_ENV==="production";
  return `refreshToken=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/api/auth; HttpOnly; SameSite=Lax${secure?"; Secure":""}`;
};

export function clearRefreshCookie(){return refreshCookie("",0);}
export function getCookie(req,name){const raw=req.headers.cookie||"";const m=raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));return m?decodeURIComponent(m[1]):null;}
export async function currentUser(accessToken){if(!accessToken)return null;const {data,error}=await admin.auth.getUser(accessToken);return error?null:data.user;}

export async function provisionInitialSite(user,{siteName}={}){
  const name=String(siteName||"Mon Premier Site").trim().slice(0,80)||"Mon Premier Site";
  const base=(name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40)||"mon-site");
  for(let i=0;i<5;i++){
    const suffix=crypto.randomBytes(3).toString("hex");
    const subdomain=`${base}-${suffix}`;
    const {data:site,error}=await admin.from("sites").insert({user_id:user.id,name,subdomain,status:"draft"}).select("id,name,subdomain,custom_domain,status").single();
    if(!error){
      const root={id:"blk_root",type:"section",props:{semanticTag:"main"},styles:{desktop:{padding:"40px 20px"}},children:[{id:"blk_welcome_heading",type:"heading",props:{level:1,text:`Bienvenue sur ${name}`},styles:{desktop:{fontSize:"36px",textAlign:"center"}}}]};
      await admin.from("pages").insert({site_id:site.id,slug:"index",seo:{title:"Accueil"},root_block:root});
      return site;
    }
  }
  throw new Error("Impossible de générer un sous-domaine unique");
}

export async function getSites(userId){
  const {data,error}=await admin.from("sites").select("id,name,subdomain,custom_domain,status,created_at").eq("user_id",userId).order("created_at",{ascending:false});
  if(error)throw error;
  return (data||[]).map(site=>({...site,user_role:"owner"}));
}

export async function getProfile(user){
  const {data:profile}=await admin.from("profiles").select("id,full_name,avatar_url,role,is_email_verified,created_at,updated_at").eq("id",user.id).maybeSingle();
  return {id:user.id,email:user.email,full_name:profile?.full_name||user.user_metadata?.full_name||null,avatar_url:profile?.avatar_url||user.user_metadata?.avatar_url||null,role:profile?.role||"user",is_email_verified:user.email_confirmed_at!=null||profile?.is_email_verified===true,created_at:profile?.created_at||user.created_at};
}