import { getUser as getNetlifyUser } from "@netlify/identity";
import { admin } from "./_db.js";
import crypto from "crypto";
export const json=(status,body,headers={})=>({statusCode:status,headers:{"content-type":"application/json","cache-control":"no-store",...headers},body:JSON.stringify(body)});
export const normalizeEmail=e=>String(e||"").trim().toLowerCase();
export const validEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const validPassword=p=>typeof p==="string"&&p.length>=10&&p.length<=128;
export const netlifyUser=()=>getNetlifyUser();
export async function ensureShadowUser(user){
 if(!user?.id)return null;
 const id=String(user.id);
 await admin.from("profiles").upsert({id,full_name:user.userMetadata?.full_name||user.name||null,avatar_url:user.pictureUrl||null,is_email_verified:user.confirmedAt!=null,updated_at:new Date().toISOString()},{onConflict:"id"});
 const {data:credit}=await admin.from("user_credits").select("user_id").eq("user_id",id).maybeSingle();
 if(!credit){await admin.from("user_credits").insert({user_id:id,credits_balance:500});await admin.from("credit_transactions").insert({user_id:id,amount:500,type:"signup",reference_id:"signup:"+id,description:"500 crédits offerts à l'inscription",balance_after:500}).catch(()=>{});}
 const {data:sites}=await admin.from("sites").select("id").eq("user_id",id).limit(1);
 if(!sites?.length)await provisionInitialSite({id},{siteName:user.userMetadata?.site_name||"Mon Premier Site"});
 return id;
}
export async function authenticatedUser(req){const user=await getNetlifyUser(req);if(!user)return null;const id=await ensureShadowUser(user);return{id,email:user.email,netlifyId:String(user.id),netlifyUser:user};}
export async function currentUser(){return await getNetlifyUser();}
export async function provisionInitialSite(user,{siteName}={}){const r=await admin.rpc("provision_initial_site",{p_user_id:String(user.id),p_site_name:siteName||"Mon Premier Site"});if(r.error)throw r.error;return r.data;}
export async function getSites(userId){const {data,error}=await admin.from("sites").select("id,name,subdomain,custom_domain,status,created_at").eq("user_id",userId).order("created_at",{ascending:false});if(error)throw error;return(data||[]).map(site=>({...site,user_role:"owner"}));}
export async function getProfile(user){const {data:profile}=await admin.from("profiles").select("id,full_name,avatar_url,role,is_email_verified,created_at,updated_at").eq("id",user.id).maybeSingle();return{id:user.netlifyId||user.id,email:user.email,full_name:profile?.full_name||user.netlifyUser?.userMetadata?.full_name||user.netlifyUser?.name||null,avatar_url:profile?.avatar_url||user.netlifyUser?.pictureUrl||null,role:profile?.role||"user",is_email_verified:user.netlifyUser?.confirmedAt!=null||profile?.is_email_verified===true,created_at:profile?.created_at||null};}