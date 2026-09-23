import {publicDb,admin,json,normalizeEmail,validEmail,refreshCookie,getProfile,getSites} from "./_auth.js";
export default async(req)=>{
  if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
  let body;try{body=JSON.parse(req.body||"{}")}catch{return json(400,{error:"JSON invalide."})}
  const email=normalizeEmail(body.email),password=body.password;
  if(!validEmail(email)||typeof password!=="string")return json(400,{error:"Email et mot de passe requis."});
  const ip=(req.headers["x-forwarded-for"]||req.headers["client-ip"]||"unknown").split(",")[0].trim();
  const key=`login:${ip}`;
  const {data:allowed,error:limitError}=await admin.rpc("consume_auth_rate_limit",{p_key:key,p_max:10,p_window_seconds:900});
  if(limitError)return json(503,{error:"Service d'authentification temporairement indisponible."});
  if(allowed===false)return json(429,{error:"Trop de tentatives. Réessayez dans 15 minutes."});
  const {data,error}=await publicDb.auth.signInWithPassword({email,password});
  if(error||!data.session)return json(401,{error:"Identifiants incorrects."});
  return json(200,{user:await getProfile(data.user),accessToken:data.session.access_token,sites:await getSites(data.user.id)},{ "set-cookie":refreshCookie(data.session.refresh_token)});
};