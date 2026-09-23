import {createServerClient} from "@supabase/ssr";
const allowed=new Set(["google","github","gitlab","bitbucket"]);

function parseCookies(req){return (req.headers.cookie||"").split(/;\s*/).filter(Boolean).map(v=>{const i=v.indexOf("=");return {name:v.slice(0,i),value:decodeURIComponent(v.slice(i+1))};});}
function serializeCookie(name,value,options={}){let s=`${name}=${encodeURIComponent(value)}`;if(options.maxAge!=null)s+=`; Max-Age=${Math.floor(options.maxAge)}`;if(options.domain)s+=`; Domain=${options.domain}`;s+=`; Path=${options.path||"/"}`;if(options.httpOnly)s+="; HttpOnly";if(options.secure)s+="; Secure";if(options.sameSite)s+=`; SameSite=${options.sameSite}`;return s;}

export default async(req)=>{
  if(req.method!=="GET")return {statusCode:405,body:"Method Not Allowed"};
  const provider=new URL(req.url).searchParams.get("provider");
  if(!allowed.has(provider))return {statusCode:400,body:"Fournisseur OAuth non autorisé."};
  const setCookies=[];
  const supabase=createServerClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{cookies:{
    getAll:()=>parseCookies(req),
    setAll:(items)=>{for(const c of items)setCookies.push(serializeCookie(c.name,c.value,c.options));}
  }});
  const redirectTo=`${process.env.APP_URL||process.env.URL}/api/auth/oauth-callback`;
  const {data,error}=await supabase.auth.signInWithOAuth({provider,options:{redirectTo,scopes:provider==="github"?"user:email":undefined}});
  if(error||!data.url)return {statusCode:500,body:"OAuth indisponible."};
  return {statusCode:302,headers:{Location:data.url,"cache-control":"no-store"},multiValueHeaders:{"Set-Cookie":setCookies}};
};