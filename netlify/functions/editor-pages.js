import {createClient} from "@supabase/supabase-js";
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
export default async(req)=>{
  const token=req.headers.authorization?.replace(/^Bearer\s+/i,"");if(!token)return {statusCode:401,body:"Unauthorized"};
  const {data:{user},error:uerr}=await db.auth.getUser(token);if(uerr||!user)return {statusCode:401,body:"Unauthorized"};
  const siteId=new URL(req.url,"https://haspad.local").searchParams.get("site_id");if(!siteId)return {statusCode:400,body:"site_id requis"};
  const {data:site}=await db.from("sites").select("id").eq("id",siteId).eq("user_id",user.id).maybeSingle();if(!site)return {statusCode:404,body:"Site introuvable"};
  if(req.method==="GET"){const {data,error}=await db.from("pages").select("*").eq("site_id",siteId).order("slug");if(error)return {statusCode:500,body:"Database error"};return {statusCode:200,headers:{"content-type":"application/json","cache-control":"no-store"},body:JSON.stringify({pages:data})};}
  return {statusCode:405,body:"Method Not Allowed"};
};