import { getUser as getNetlifyUser } from "@netlify/identity";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
export const admin=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
export const json=(status,body,headers={})=>({statusCode:status,headers:{"content-type":"application/json","cache-control":"no-store",...headers},body:JSON.stringify(body)});
export const normalizeEmail=e=>String(e||"").trim().toLowerCase();
export const validEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const validPassword=p=>typeof p==="string"&&p.length>=10&&p.length<=128;
export const netlifyUser=()=>getNetlifyUser();
export async function ensureShadowUser(user){
  if(!user?.id||!user.email)return null;
  const {data:link}=await admin.from("netlify_identity_links").select("supabase_user_id").eq("netlify_user_id",String(user.id)).maybeSingle();
  if(link?.supabase_user_id)return link.supabase_user_id;
  const metadata={full_name:user.userMetadata?.full_name||user.name||null,avatar_url:user.pictureUrl||null};
  const password=crypto.randomBytes(32).toString("base64url")+"A1!";
  let shadow;
  const created=await admin.auth.admin.createUser({email:normalizeEmail(user.email),password,email_confirm:true,user_metadata:metadata});
  if(created.error){
    const listed=await admin.auth.admin.listUsers({page:1,perPage:1000});
    shadow=(listed.data?.users||[]).find(u=>normalizeEmail(u.email)===normalizeEmail(user.email));
    if(!shadow)throw created.error;
  }else shadow=created.data.user;
  const {error}=await admin.from("netlify_identity_links").upsert({netlify_user_id:String(user.id),supabase_user_id:shadow.id,email:normalizeEmail(user.email),updated_at:new Date().toISOString()},{onConflict:"netlify_user_id"});
  if(error)throw error;
  await provisionUserData(shadow,user);
  return shadow.id;
}
async function provisionUserData(shadow,user){
  const {data:credit}=await admin.from("user_credits").select("user_id").eq("user_id",shadow.id).maybeSingle();
  if(!credit)await admin.from("user_credits").insert({user_id:shadow.id,credits_balance:500});
  await admin.from("profiles").upsert({id:shadow.id,full_name:user.userMetadata?.full_name||user.name||null,avatar_url:user.pictureUrl||null,is_email_verified:true},{onConflict:"id"});
}
export async function authenticatedUser(){
  const user=await getNetlifyUser(); if(!user)return null;
  const id=await ensureShadowUser(user);
  return {id,email:user.email,netlifyId:String(user.id),netlifyUser:user};
}
export async function currentUser(){return await getNetlifyUser();}
export async function provisionInitialSite(user,{siteName}={}){
  const name=String(siteName||"Mon Premier Site").trim().slice(0,80)||"Mon Premier Site";
  const base=(name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40)||"mon-site");
  for(let i=0;i<5;i++){const subdomain=`${base}-${crypto.randomBytes(3).toString("hex")}`;
    const {data:site,error}=await admin.from("sites").insert({user_id:user.id,name,subdomain,status:"draft"}).select("id,name,subdomain,custom_domain,status").single();
    if(!error){const root={id:"blk_root",type:"section",props:{semanticTag:"main"},styles:{desktop:{padding:"40px 20px"}},children:[{id:"blk_welcome_heading",type:"heading",props:{level:1,text:`Bienvenue sur ${name}`},styles:{desktop:{fontSize:"36px",textAlign:"center"}}}]};
      const {error:pageError}=await admin.from("pages").insert({site_id:site.id,slug:"index",seo:{title:"Accueil"},root_block:root});
      if(pageError){await admin.from("sites").delete().eq("id",site.id).eq("user_id",user.id);throw pageError;} return site;
    }
  } throw new Error("Impossible de générer un sous-domaine unique");
}
export async function getSites(userId){const {data,error}=await admin.from("sites").select("id,name,subdomain,custom_domain,status,created_at").eq("user_id",userId).order("created_at",{ascending:false});if(error)throw error;return(data||[]).map(site=>({...site,user_role:"owner"}));}
export async function getProfile(user){const {data:profile}=await admin.from("profiles").select("id,full_name,avatar_url,role,is_email_verified,created_at,updated_at").eq("id",user.id).maybeSingle();return{id:user.netlifyId||user.id,email:user.email,full_name:profile?.full_name||user.netlifyUser?.userMetadata?.full_name||user.netlifyUser?.name||null,avatar_url:profile?.avatar_url||user.netlifyUser?.pictureUrl||null,role:profile?.role||"user",is_email_verified:user.netlifyUser?.confirmedAt!=null||profile?.is_email_verified===true,created_at:profile?.created_at||null};}