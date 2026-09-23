import {publicDb,admin,json,getCookie,refreshCookie} from "./_auth.js";
export default async(req)=>{
  if(req.method!=="POST")return json(405,{error:"Method Not Allowed"});
  const token=getCookie(req,"refreshToken");if(!token)return json(401,{error:"Jeton de rafraîchissement absent."});
  const {data,error}=await publicDb.auth.refreshSession({refresh_token:token});
  if(error||!data.session)return json(401,{error:"Session expirée ou invalide."});
  return json(200,{accessToken:data.session.access_token},{ "set-cookie":refreshCookie(data.session.refresh_token)});
};