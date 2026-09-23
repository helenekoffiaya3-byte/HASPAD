import {publicDb,json,normalizeEmail,validEmail} from "./_auth.js";
export default async(req)=>{
  if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
  let body;try{body=JSON.parse(req.body||"{}")}catch{return json(400,{error:"JSON invalide."})}
  const email=normalizeEmail(body.email);
  if(!validEmail(email))return json(400,{error:"Adresse email invalide."});
  await publicDb.auth.resetPasswordForEmail(email,{redirectTo:`${process.env.FRONTEND_URL||process.env.URL}/reset-password.html`});
  return json(200,{message:"Si ce compte existe, un email de réinitialisation a été envoyé."});
};