import crypto from "node:crypto";
const env=n=>globalThis.Netlify?.env?.get?.(n)??process.env[n];
const required=n=>{const v=env(n);if(!v)throw Error(n+"_NOT_CONFIGURED");return v};
export async function runtimeRequest(path,body={},method="POST"){
 const base=required("HASPAD_RUNTIME_URL").replace(/\/$/,""),secret=required("HASPAD_RUNTIME_SHARED_SECRET");if(!base.startsWith("https://")&&env("NODE_ENV")==="production")throw Error("RUNTIME_HTTPS_REQUIRED"),ts=String(Date.now()),raw=JSON.stringify(body);
 const sig=crypto.createHmac("sha256",secret).update(ts+"."+raw).digest("hex");
 const r=await fetch(base+path,{method,headers:{"content-type":"application/json","x-haspad-timestamp":ts,"x-haspad-signature":sig},body:method==="GET"?undefined:raw});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||"RUNTIME_REQUEST_FAILED");return data;
}