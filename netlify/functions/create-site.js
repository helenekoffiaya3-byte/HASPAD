import {json,authenticatedUser,provisionInitialSite} from "./_auth.js";
export default async(req)=>{
  if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
  const user=await authenticatedUser(req);
  if(!user)return json(401,{error:"Unauthorized"});
  let body;try{body=JSON.parse(req.body||"{}")}catch{return json(400,{error:"JSON invalide."})}
  const siteName=String(body.siteName||"").trim().slice(0,80);
  if(siteName.length<1)return json(400,{error:"Nom du projet requis."});
  try{return json(201,{site:await provisionInitialSite(user,{siteName})});}
  catch(error){console.error("create-site:",error);return json(500,{error:"Impossible de créer le projet."});}
};