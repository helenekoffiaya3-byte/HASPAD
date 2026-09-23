import {publicDb,json,normalizeEmail,validEmail,refreshCookie} from "./_auth.js";
export default async(req)=>{
  if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
  let body;try{body=JSON.parse(req.body||"{}")}catch{return json(400,{error:"JSON invalide."})}
  const email=normalizeEmail(body.email),password=body.password;
  if(!validEmail(email)||typeof password!=="string")return json(400,{error:"Email et mot de passe requis."});
  const {data,error}=await publicDb.auth.signInWithPassword({email,password});
  if(error||!data.session)return json(401,{error:"Identifiants incorrects."});
  const {getProfile,getSites}=await import("./_auth.js");
  return json(200,{user:await getProfile(data.user),accessToken:data.session.access_token,sites:await getSites(data.user.id)},{ "set-cookie":refreshCookie(data.session.refresh_token)});
};