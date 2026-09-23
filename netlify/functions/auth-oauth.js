import {publicDb,json} from "./_auth.js";
const allowed=new Set(["google","github","gitlab","bitbucket"]);
export default async(req)=>{
  if(req.method!=="GET")return json(405,{error:"Method Not Allowed"});
  const provider=new URL(req.url).searchParams.get("provider");
  if(!allowed.has(provider))return json(400,{error:"Fournisseur OAuth non autorisé."});
  const redirectTo=`${process.env.APP_URL||process.env.URL}/api/auth/oauth-callback`;
  const {data,error}=await publicDb.auth.signInWithOAuth({provider,options:{redirectTo,scopes:provider==="github"?"user:email":undefined}});
  if(error)return json(500,{error:"OAuth indisponible."});
  return {statusCode:302,headers:{Location:data.url}};
};