import {admin,publicDb,json,normalizeEmail,validEmail,validPassword,refreshCookie,provisionInitialSite} from "./_auth.js";
export default async(req)=>{
  if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
  let body;try{body=JSON.parse(req.body||"{}")}catch{return json(400,{error:"JSON invalide."})}
  const email=normalizeEmail(body.email),password=body.password,fullName=String(body.fullName||"").trim().slice(0,255),siteName=String(body.siteName||"").trim();
  if(!validEmail(email))return json(400,{error:"Adresse email invalide."});
  if(!validPassword(password))return json(400,{error:"Le mot de passe doit contenir 10 à 128 caractères."});
  try{
    const {data,error}=await publicDb.auth.signUp({email,password,options:{data:{full_name:fullName||null}}});
    if(error)return json(error.status===422||/already registered/i.test(error.message)?409:400,{error:"Impossible de créer ce compte."});
    await admin.from("profiles").upsert({id:data.user.id,full_name:fullName||null,is_email_verified:data.user.email_confirmed_at!=null},{onConflict:"id"});
    const site=await provisionInitialSite(data.user,{siteName});
    if(data.session)return json(201,{message:"Compte et site créés avec succès.",user:{id:data.user.id,email:data.user.email,fullName:fullName||null},accessToken:data.session.access_token,initialSite:site},{ "set-cookie":refreshCookie(data.session.refresh_token)});
    return json(201,{message:"Compte créé. Vérifiez votre email pour activer la connexion.",user:{id:data.user.id,email:data.user.email,fullName:fullName||null},emailVerificationRequired:true,initialSite:site});
  }catch(e){return json(500,{error:"Erreur serveur lors de l'inscription."})}
};