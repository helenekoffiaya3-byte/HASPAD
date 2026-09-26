import {createClient} from "@supabase/supabase-js";
import crypto from "crypto";
import {BlockNodeSchema} from "../../src/types/ast.ts";
import {compilePage} from "../../src/compiler/engine.ts";
import {calculateVersionHash} from "../../src/deploy/publisher.ts";

const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const INITIAL_COST=390;
const REDEPLOY_COST=150;

export default async(req)=>{
  if(req.method!=="POST")return {statusCode:405,body:"Method Not Allowed"};
  const token=req.headers.authorization?.replace(/^Bearer\s+/i,"");
  if(!token)return {statusCode:401,body:"Unauthorized"};
  const {data:{user}}=await db.auth.getUser(token);
  if(!user)return {statusCode:401,body:"Unauthorized"};
  let body;try{body=JSON.parse(req.body||"{}")}catch{return {statusCode:400,body:"JSON invalide"}}
  const {site_id,pages}=body;
  if(!site_id||!Array.isArray(pages))return {statusCode:400,body:"site_id et pages requis"};
  const {data:member}=await db.from("site_members").select("role").eq("site_id",site_id).eq("user_id",user.id).maybeSingle();
  if(!member)return {statusCode:403,body:"Accès refusé à ce site."};
  if(!["owner","editor"].includes(member.role))return {statusCode:403,body:"Droits insuffisants."};

  const {count}=await db.from("deployments").select("id",{count:"exact",head:true}).eq("site_id",site_id);
  const isInitial=(count||0)===0;
  const cost=isInitial?INITIAL_COST:REDEPLOY_COST;
  const operation=isInitial?"deployment":"redeployment";
  const reference="deploy:"+crypto.randomUUID();

  const {data:balance,error:debitError}=await db.rpc("debit_user_credits",{
    p_user_id:user.id,p_cost:cost,p_type:operation,p_reference_id:reference,
    p_description:isInitial?"Déploiement initial HASPAD":"Redéploiement HASPAD"
  });
  if(debitError){
    const message=debitError.message||"";
    const insufficient=message.includes("INSUFFICIENT_CREDITS");
    return {statusCode:insufficient?402:500,headers:{"content-type":"application/json"},body:JSON.stringify({error:insufficient?"Crédits insuffisants.":"Impossible de débiter les crédits."})};
  }

  try{
    const compiled=pages.map(p=>({id:p.id,slug:p.slug,title:p.title,html:compilePage(BlockNodeSchema.parse(p.root))}));
    const snapshot={siteId:site_id,pages:compiled};
    const version_hash=calculateVersionHash(snapshot);
    const {data,error}=await db.from("deployments").insert({site_id,version_hash,status:"ready",snapshot,is_active:false}).select("id,version_hash,status").single();
    if(error)throw error;
    return {statusCode:201,headers:{"content-type":"application/json","cache-control":"no-store"},body:JSON.stringify({deployment:data,cost,operation,creditsRemaining:balance})};
  }catch(e){
    await db.rpc("refund_user_credits",{p_user_id:user.id,p_amount:cost,p_reference_id:reference+":refund",p_description:"Remboursement après échec du "+operation});
    return {statusCode:400,headers:{"content-type":"application/json"},body:JSON.stringify({error:"Snapshot invalide ou compilation impossible. Les crédits ont été remboursés."})};
  }
};