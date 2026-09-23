let accessToken=null;
let currentUser=null;

export function setSession({accessToken:token,user=null}){accessToken=token||null;currentUser=user||null;}
export function clearSession(){accessToken=null;currentUser=null;}
export function getAccessToken(){return accessToken;}
export function getUser(){return currentUser;}

export async function api(path,options={}){
  const headers={"content-type":"application/json",...(options.headers||{})};
  if(accessToken)headers.Authorization=`Bearer ${accessToken}`;
  let res=await fetch(path,{...options,headers,credentials:"include"});
  if(res.status===401&&path!=="/api/auth/refresh"){
    const refreshed=await fetch("/api/auth/refresh",{method:"POST",credentials:"include"});
    if(refreshed.ok){
      const data=await refreshed.json();accessToken=data.accessToken;
      headers.Authorization=`Bearer ${accessToken}`;
      res=await fetch(path,{...options,headers,credentials:"include"});
    }
  }
  return res;
}

export async function refreshSession(){
  const res=await fetch("/api/auth/refresh",{method:"POST",credentials:"include"});
  if(!res.ok){clearSession();return false;}
  const data=await res.json();accessToken=data.accessToken;return true;
}

export async function logout(){
  await fetch("/api/auth/logout",{method:"POST",credentials:"include"});
  clearSession();
}