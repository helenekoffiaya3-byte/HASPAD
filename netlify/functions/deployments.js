import {createClient} from "@supabase/supabase-js";
import {BlockNodeSchema} from "../../src/types/ast.ts";
import {compilePage} from "../../src/compiler/engine.ts";
import {calculateVersionHash} from "../../src/deploy/publisher.ts";
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
export default async(req)=>{
  if(req.method!=="POST")return {statusCode:405,body:"Method Not Allowed"};
  const token=req.headers.authorization?.replace(/^Bearer\s+/i,"");if(!token)return {statusCode:401,body:"Unauthorized"};
  const {data:{user}}=await db.auth.getUser(token);if(!user)return {statusCode:401,body:"Unauthorized"};
  let body;try{body=JSON.parse(req.body||"{}")}catch{return {statusCode:400,body:"JSON invalide"}}
  const {site_id,pages}=body;if(!site_id||!Array.isArray(pages))return {statusCode:400,body:"site_id et pages requis"};
  const {data:member}=await db.from("site_members").select("role").eq("site_id",site_id).eq("user_id",user.id).maybeSingle();if(!member)return {statusCode:403,body:"Accès refusé à ce site."};
  if(!["owner","editor"].includes(member.role))return {statusCode:403,body:"Droits insuffisants."};
  try{
    const compiled=pages.map(p=>({id:p.id,slug:p.slug,title:p.title,html:compilePage(BlockNodeSchema.parse(p.root))}));
    const snapshot={siteId:site_id,pages:compiled};
    const version_hash=calculateVersionHash(snapshot);
    const {data,error}=await db.from("deployments").insert({site_id,version_hash,status:"ready",snapshot,is_active:false}).select("id,version_hash,status").single();
    if(error)throw error;
    return {statusCode:201,headers:{"content-type":"application/json","cache-control":"no-store"},body:JSON.stringify({deployment:data})};
  }catch(e){return {statusCode:400,body:JSON.stringify({error:"Snapshot invalide ou compilation impossible"})}}
};