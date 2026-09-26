import {admin,json,authenticatedUser} from "./_credits.js";
export default async(req)=>{
 if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
 const user=await authenticatedUser(req);if(!user)return json(401,{error:"Unauthorized"});
 let body;try{body=JSON.parse(req.body||"{}")}catch{return json(400,{error:"JSON invalide."})}
 const siteId=body.site_id;if(!siteId)return json(400,{error:"site_id requis"});
 const {data:member}=await admin.from("sites").select("id").eq("id",siteId).eq("user_id",user.id).maybeSingle();
 if(!member)return json(403,{error:"Seul le propriétaire peut provisionner Startup."});
 const {data:sub}=await admin.from("subscriptions").select("plan_name,status").eq("user_id",user.id).eq("plan_name","startup").eq("status","active").order("created_at",{ascending:false}).limit(1).maybeSingle();
 if(!sub)return json(402,{error:"Le plan Startup actif est requis."});
 const {data:center,error}=await admin.from("control_centers").upsert({site_id:siteId,owner_user_id:user.id,plan:"startup",schema_version:1},{onConflict:"site_id"}).select().single();
 if(error)return json(500,{error:"Impossible de provisionner le centre de contrôle."});
 return json(200,{ok:true,controlCenter:center});
};
