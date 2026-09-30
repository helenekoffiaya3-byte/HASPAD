import { GoogleGenAI } from "@google/genai";
import { getDatabase } from "@netlify/database";
import { json, authenticatedUser } from "./_credits.js";

const db = getDatabase();
const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-pro-preview";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const TYPE_MAP = new Set(["text","integer","bigint","boolean","numeric","date","timestamp","jsonb","uuid"]);
const RESERVED = new Set(["users","sites","pages","projects","deployments","subscriptions","payment_transactions","user_credits","credit_transactions"]);

function ident(v, label="identifier") {
  const s = String(v || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(s)) throw new Error(label.toUpperCase()+"_INVALID");
  return s;
}
function schemaName(siteId) { return "studio_" + String(siteId).replace(/-/g,"").toLowerCase(); }

const SCHEMA = {
  type:"object", properties:{
    baseName:{type:"string"},
    tables:{type:"array",maxItems:30,items:{type:"object",properties:{
      name:{type:"string"}, columns:{type:"array",maxItems:50,items:{type:"object",properties:{
        name:{type:"string"},type:{type:"string",enum:["text","integer","bigint","boolean","numeric","date","timestamp","jsonb","uuid"]},
        nullable:{type:"boolean"},primaryKey:{type:"boolean"},unique:{type:"boolean"}
      },required:["name","type"]}}
    },required:["name","columns"]}}
  },required:["baseName","tables"]
};

async function ownedSite(siteId,userId){
  const r=await db.pool.query("SELECT id,name FROM sites WHERE id=$1 AND user_id=$2 LIMIT 1",[siteId,userId]);
  return r.rows[0] || null;
}
async function introspect(schema){
  const r=await db.pool.query(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema=$1 ORDER BY table_name, ordinal_position
  `,[schema]);
  const out={};
  for(const row of r.rows){(out[row.table_name] ||= []).push({name:row.column_name,type:row.data_type,nullable:row.is_nullable==="YES"});}
  return out;
}
function validatePlan(plan){
  if(!plan || !Array.isArray(plan.tables) || plan.tables.length>30) throw new Error("BASE_STUDIO_PLAN_INVALID");
  const seen=new Set();
  return plan.tables.map(t=>{
    const name=ident(t.name,"table");
    if(RESERVED.has(name) || name.startsWith("studio_")) throw new Error("TABLE_NAME_RESERVED");
    if(seen.has(name)) throw new Error("DUPLICATE_TABLE");
    seen.add(name);
    if(!Array.isArray(t.columns) || !t.columns.length || t.columns.length>50) throw new Error("COLUMNS_INVALID");
    const cols=new Set();
    return {name,columns:t.columns.map(c=>{
      const cn=ident(c.name,"column");
      if(cols.has(cn)) throw new Error("DUPLICATE_COLUMN");
      cols.add(cn);
      const type=String(c.type||"text");
      if(!TYPE_MAP.has(type)) throw new Error("COLUMN_TYPE_INVALID");
      return {name:cn,type,nullable:c.nullable!==false,primaryKey:c.primaryKey===true,unique:c.unique===true};
    })};
  });
}
function ddl(schema,plan){
  const statements=[`CREATE SCHEMA IF NOT EXISTS "${schema}"`];
  for(const t of plan.tables){
    const defs=t.columns.map(c=>{
      let d=`"${c.name}" ${c.type}`;
      if(c.primaryKey)d+=" PRIMARY KEY";
      if(c.unique)d+=" UNIQUE";
      if(c.nullable===false)d+=" NOT NULL";
      if(c.type==="uuid" && c.primaryKey)d+=" DEFAULT gen_random_uuid()";
      return d;
    });
    statements.push(`CREATE TABLE IF NOT EXISTS "${schema}"."${t.name}" (${defs.join(", ")})`);
  }
  return statements;
}
async function generate(prompt,current){
  if(!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY non configurée.");
  const instruction=[
    "Tu es Gemini, architecte de base de données du Studio HASPAD.",
    "Transforme la demande utilisateur en PLAN JSON de tables et colonnes.",
    "Tu ne dois jamais produire SQL, DDL, commandes shell, secrets ou identifiants.",
    "N'utilise que les types autorisés: text, integer, bigint, boolean, numeric, date, timestamp, jsonb, uuid.",
    "Ne supprime jamais de table et ne modifie jamais une table existante.",
    "Si une table existe déjà, propose seulement les nouvelles tables demandées; le backend ignore les tables déjà existantes.",
    "Demande utilisateur:",prompt.slice(0,12000),
    "Structure actuelle:",JSON.stringify(current)
  ].join("\n\n");
  const r=await ai.models.generateContent({model:MODEL,contents:instruction,config:{responseMimeType:"application/json",responseSchema:SCHEMA,temperature:0.1}});
  if(!r.text) throw new Error("EMPTY_GEMINI_RESPONSE");
  return JSON.parse(r.text);
}

export default async (req)=>{
  if(req.method!=="POST") return json(405,{error:"Method Not Allowed"});
  const user=await authenticatedUser(req);
  if(!user) return json(401,{error:"Unauthorized"});
  let body; try{body=JSON.parse(req.body||"{}")}catch{return json(400,{error:"JSON invalide."})}
  const siteId=String(body.siteId||"");
  const prompt=String(body.prompt||"").trim();
  if(!/^[0-9a-f-]{36}$/i.test(siteId)||!prompt||prompt.length>12000)return json(400,{error:"siteId ou demande invalide."});
  try{
    const site=await ownedSite(siteId,user.id);
    if(!site)return json(403,{error:"Accès non autorisé à ce projet."});
    const schema=schemaName(siteId);
    const current=await introspect(schema);
    const plan=validatePlan(await generate(prompt,current));
    const existing=new Set(Object.keys(current));
    const newTables=plan.tables.filter(t=>!existing.has(t.name));
    if(!newTables.length)return json(200,{success:true,model:MODEL,created:[],message:"La demande ne nécessite pas de nouvelle table.",schema});
    for(const statement of ddl(schema,{tables:newTables})) await db.pool.query(statement);
    const after=await introspect(schema);
    return json(200,{success:true,model:MODEL,schema,created:newTables.map(t=>t.name),tables:after});
  }catch(e){
    console.error("Base Studio Gemini:",e);
    return json(500,{error:e?.message||"Impossible de créer la base Studio."});
  }
};
