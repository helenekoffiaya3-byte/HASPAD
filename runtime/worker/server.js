import express from "express";
import crypto from "node:crypto";
import { deploy, getLogs, getRuntimeStatus, rollback } from "./docker-runtime.js";
const app=express(); app.use(express.json({limit:"1mb"}));
const env=n=>process.env[n]||"", secret=()=>env("RUNTIME_SHARED_SECRET");
const timing=(a,b)=>{const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)};
function authorized(req){const s=secret();if(!s)return false;const ts=req.get("x-haspad-timestamp")||"",sig=req.get("x-haspad-signature")||"";const n=Number(ts);if(!Number.isFinite(n)||Math.abs(Date.now()-n)>300000)return false;const raw=JSON.stringify(req.body||{}),expected=crypto.createHmac("sha256",s).update(ts+"."+raw).digest("hex");return timing(sig,expected)}
const guard=(req,res,next)=>authorized(req)?next():res.status(401).json({error:"RUNTIME_UNAUTHORIZED"});
app.get("/health",(req,res)=>res.json({ok:true,service:"haspad-runtime-worker"}));
app.get("/v1/status/:runtimeId",guard,async(req,res)=>{try{res.json(await getRuntimeStatus(req.params.runtimeId))}catch{res.status(404).json({error:"RUNTIME_NOT_FOUND"})}});
app.get("/v1/logs/:runtimeId",guard,async(req,res)=>{try{res.json(await getLogs(req.params.runtimeId))}catch{res.status(404).json({error:"RUNTIME_NOT_FOUND"})}});
app.post("/v1/deploy",guard,async(req,res)=>{try{res.status(201).json(await deploy(req.body||{}))}catch(e){console.error("runtime-deploy",e?.message||e);res.status(500).json({error:"RUNTIME_DEPLOY_FAILED",message:String(e?.message||e).slice(0,500)})}});
app.post("/v1/rollback",guard,async(req,res)=>{try{res.json(await rollback(req.body||{}))}catch{res.status(500).json({error:"RUNTIME_ROLLBACK_FAILED"})}});
app.listen(Number(env("PORT")||3001),"0.0.0.0",()=>console.log("HASPAD runtime worker listening"));
