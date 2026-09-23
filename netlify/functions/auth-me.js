import {admin,json,currentUser,getProfile,getSites} from "./_auth.js";
export default async(req)=>{
  if(req.method!=="GET")return json(405,{error:"Method Not Allowed"});
  const token=req.headers.authorization?.replace(/^Bearer\s+/i,"");
  const user=await currentUser(token);if(!user)return json(401,{error:"Accès non autorisé."});
  return json(200,{user:await getProfile(user),sites:await getSites(user.id)});
};