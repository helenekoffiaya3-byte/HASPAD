import {createClient} from "@supabase/supabase-js";
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
export default async(req)=>{
 if(req.method!=="GET")return {statusCode:405,body:"Method Not Allowed"};
 const token=req.headers.authorization?.replace(/^Bearer\s+/i,"");if(!token)return {statusCode:401,body:"Unauthorized"};
 const {data:{user},error:uerr}=await db.auth.getUser(token);if(uerr||!user)return {statusCode:401,body:"Unauthorized"};
 const {data,error}=await db.from("site_members").select("role,sites(id,name,subdomain,custom_domain,status,settings,created_at,updated_at)").eq("user_id",user.id);
 if(error)return {statusCode:500,body:JSON.stringify({error:"Database error"})};
 return {statusCode:200,headers:{"content-type":"application/json","cache-control":"no-store"},body:JSON.stringify({sites:(data||[]).map(x=>({...x.sites,user_role:x.role}))})};
};