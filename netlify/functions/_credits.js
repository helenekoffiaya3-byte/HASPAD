import { createClient } from "@supabase/supabase-js";
export const admin=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
export const json=(statusCode,body,headers={})=>({statusCode,headers:{"content-type":"application/json","cache-control":"no-store",...headers},body:JSON.stringify(body)});
export async function authenticatedUser(req){const token=req.headers.authorization?.replace(/^Bearer\s+/i,"");if(!token)return null;const {data,error}=await admin.auth.getUser(token);return error?null:data.user;}
export const PLANS=Object.freeze({startup:{name:"Startup",credits:4000,amountEnv:"CINETPAY_STARTUP_AMOUNT_XOF"},pro:{name:"Pro",credits:6800,amountEnv:"CINETPAY_PRO_AMOUNT_XOF"},business:{name:"Business",credits:19089,amountEnv:"CINETPAY_BUSINESS_AMOUNT_XOF"}});
export function getPlan(planType){const key=String(planType||"").toLowerCase();const plan=PLANS[key];if(!plan)return null;const amount=Number(process.env[plan.amountEnv]);if(!Number.isInteger(amount)||amount<5||amount%5!==0)return null;return {...plan,type:key,amount};}
