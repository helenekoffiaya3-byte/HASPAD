import {admin,json,authenticatedUser} from "./_credits.js";
export default async(req)=>{
  if(req.method!=="GET")return json(405,{error:"Method Not Allowed"});
  const user=await authenticatedUser(req);if(!user)return json(401,{error:"Unauthorized"});
  const {data,error}=await admin.from("sites").select("id,name,subdomain,custom_domain,status,created_at").eq("user_id",user.id).order("created_at",{ascending:false});
  if(error)return json(500,{error:"Impossible de charger les projets."});
  return json(200,{sites:(data||[]).map(site=>({...site,user_role:"owner"}))});
};