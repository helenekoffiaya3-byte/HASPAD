import {publicDb,json,getCookie,clearRefreshCookie} from "./_auth.js";
export default async(req)=>{
  if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
  const token=getCookie(req,"refreshToken");if(token){await publicDb.auth.refreshSession({refresh_token:token});}
  return json(200,{message:"Déconnexion réussie."},{ "set-cookie":clearRefreshCookie()});
};