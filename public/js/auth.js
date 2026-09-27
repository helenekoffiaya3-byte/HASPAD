import { getUser as identityGetUser, logout as identityLogout, handleAuthCallback, refreshSession } from "https://cdn.jsdelivr.net/npm/@netlify/identity@2.0.0/+esm";

let callbackPromise;
export async function initAuth(){
  if(!callbackPromise) callbackPromise=handleAuthCallback().catch(()=>null);
  return callbackPromise;
}
export async function getUser(){await initAuth();return identityGetUser();}
export async function api(path,options={}){
  await initAuth();
  const headers=new Headers(options.headers||{});
  if(options.body&&!headers.has("content-type"))headers.set("content-type","application/json");
  return fetch(path,{...options,headers,credentials:"include"});
}
export async function refreshAuth(){return refreshSession();}
export async function logout(){await identityLogout();location.href="/";}
await initAuth();