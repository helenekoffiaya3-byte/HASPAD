import {publicDb,admin,json,refreshCookie,provisionInitialSite,getProfile,getSites} from "./_auth.js";
export default async(req)=>{
  const url=new URL(req.url),code=url.searchParams.get("code"),error=url.searchParams.get("error");
  if(error||!code)return {statusCode:302,headers:{Location:`${process.env.FRONTEND_URL||"/login"}?error=sso_failed`}};
  const {data,error:exchangeError}=await publicDb.auth.exchangeCodeForSession(code);
  if(exchangeError||!data.session)return {statusCode:302,headers:{Location:`${process.env.FRONTEND_URL||"/login"}?error=sso_failed`}};
  const user=data.user;
  const {data:profile}=await admin.from("profiles").select("id").eq("id",user.id).maybeSingle();
  if(!profile)await admin.from("profiles").insert({id:user.id,full_name:user.user_metadata?.full_name||user.user_metadata?.name||null,avatar_url:user.user_metadata?.avatar_url||user.user_metadata?.picture||null,is_email_verified:user.email_confirmed_at!=null});
  const {data:members}=await admin.from("site_members").select("site_id").eq("user_id",user.id).limit(1);
  if(!members?.length)await provisionInitialSite(user,{siteName:`Projet de ${user.user_metadata?.full_name||user.user_metadata?.name||user.email?.split("@")[0]||"Utilisateur"}`});
  const target=`${process.env.FRONTEND_URL||"/"}`;
  return {statusCode:302,headers:{Location:target,"Set-Cookie":refreshCookie(data.session.refresh_token)}};
};