import {admin,json,authenticatedUser,getPlan} from "./_credits.js";
const CINETPAY_URL="https://api-checkout.cinetpay.com/v2/payment";
function transactionId(){return "HSP"+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,10).toUpperCase();}
export default async(req)=>{
 if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
 const user=await authenticatedUser(req);if(!user)return json(401,{error:"Unauthorized"});
 let body;try{body=JSON.parse(req.body||"{}")}catch{return json(400,{error:"JSON invalide."})}
 const plan=getPlan(body.planType);if(!plan)return json(400,{error:"Plan indisponible. Configurez son montant côté serveur."});
 if(!process.env.CINETPAY_API_KEY||!process.env.CINETPAY_SITE_ID)return json(503,{error:"CinetPay n'est pas encore configuré."});
 const txId=transactionId(),appUrl=process.env.PUBLIC_SITE_URL||"https://haspad.com",notifyUrl=process.env.CINETPAY_NOTIFY_URL||"https://api.haspad.com/cinetpay-notify";
 const {data:profile}=await admin.from("profiles").select("full_name").eq("id",user.id).maybeSingle();
 const parts=String(profile?.full_name||"Client HASPAD").trim().split(/\s+/),customerName=parts.shift()||"Client",customerSurname=parts.join(" ")||"HASPAD";
 const payload={apikey:process.env.CINETPAY_API_KEY,site_id:process.env.CINETPAY_SITE_ID,transaction_id:txId,amount:plan.amount,currency:process.env.CINETPAY_CURRENCY||"XOF",description:"HASPAD "+plan.name+" "+plan.credits+" crédits",notify_url:notifyUrl,return_url:appUrl+"/paiement-retour.html?transaction_id="+encodeURIComponent(txId),channels:"ALL",lang:"FR",metadata:JSON.stringify({user_id:user.id,plan_type:plan.type}),customer_name:customerName,customer_surname:customerSurname,customer_email:user.email};
 const {data:payment,error:insertError}=await admin.from("payment_transactions").insert({user_id:user.id,transaction_id:txId,plan_type:plan.type,amount_xof:plan.amount,credits:plan.credits,status:"pending"}).select("id,transaction_id").single();
 if(insertError||!payment)return json(500,{error:"Impossible d'enregistrer le paiement."});
 try{const response=await fetch(CINETPAY_URL,{method:"POST",headers:{"content-type":"application/json","user-agent":"HASPAD/1.0"},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok||result.code!=="201"||!result.data?.payment_url){await admin.from("payment_transactions").update({status:"error",provider_response:result}).eq("id",payment.id);return json(502,{error:"CinetPay n'a pas pu initialiser le paiement."});}await admin.from("payment_transactions").update({payment_url:result.data.payment_url,provider_response:result}).eq("id",payment.id);return json(200,{paymentUrl:result.data.payment_url,transactionId:txId,plan:{type:plan.type,credits:plan.credits,amount:plan.amount}});}
 catch(error){await admin.from("payment_transactions").update({status:"error",provider_response:{error:String(error.message||error)}}).eq("id",payment.id);return json(502,{error:"Service de paiement temporairement indisponible."});}
};
