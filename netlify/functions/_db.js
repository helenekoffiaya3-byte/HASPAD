import { getDatabase } from "@netlify/database";
import crypto from "node:crypto";
const db=getDatabase();
export const json=(status,body,headers={})=>({statusCode:status,headers:{"content-type":"application/json","cache-control":"no-store",...headers},body:JSON.stringify(body)});
const id=v=>{v=String(v);if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v))throw Error("INVALID_IDENTIFIER");return '"'+v+'"'};
class Q{
 constructor(t){this.t=t;this.op="select";this.f="*";this.w=[];this.o=null;this.l=null;this.p=null;this.c=null;this.one=0;this.maybe=0;this.head=0}
 select(f="*",o={}){this.f=f;this.head=!!o.head;return this} eq(c,v){this.w.push([c,v]);return this}
 order(c,o={}){this.o=[c,o.ascending!==false];return this} limit(n){this.l=+n;return this}
 maybeSingle(){this.maybe=1;return this.run()} single(){this.one=1;return this.run()}
 insert(p){this.op="insert";this.p=p;return this} update(p){this.op="update";this.p=p;return this}
 upsert(p,o={}){this.op="upsert";this.p=p;this.c=o.onConflict||"id";return this} delete(){this.op="delete";return this}
 then(a,b){return this.run().then(a,b)}
 async run(){try{return await this.exec()}catch(error){return{data:null,error,count:null}}}
 async exec(){
  const params=[];const where=this.w.map(([c,v])=>{params.push(v);if(c.includes("->>")){const [a,k]=c.split("->>");return id(a)+"->>"+JSON.stringify(k)+"=$"+params.length}return id(c)+"=$"+params.length}).join(" AND ");
  if(this.op==="select"){let s="SELECT "+this.f+" FROM "+id(this.t)+(where?" WHERE "+where:"");if(this.o)s+=" ORDER BY "+id(this.o[0])+" "+(this.o[1]?"ASC":"DESC");if(this.l)s+=" LIMIT "+this.l;if(this.head)s="SELECT count(*)::int count FROM "+id(this.t)+(where?" WHERE "+where:"");const r=await db.pool.query(s,params);if(this.head)return{data:null,error:null,count:r.rows[0]?.count||0};if(this.one||this.maybe){if(!r.rows[0])return{data:null,error:this.one?Error("ROW_NOT_FOUND"):null,count:0};return{data:r.rows[0],error:null,count:r.rowCount}}return{data:r.rows,error:null,count:r.rowCount}}
  if(this.op==="delete"){const r=await db.pool.query("DELETE FROM "+id(this.t)+(where?" WHERE "+where:"")+" RETURNING *",params);return{data:r.rows,error:null,count:r.rowCount}}
  const row=this.p||{};const cols=Object.keys(row);const vals=cols.map(c=>row[c]??null);let s;
  if(this.op==="update"){const set=cols.map((c,i)=>id(c)+"=$"+(i+1)).join(",");const wp=this.w.map(([c],i)=>id(c)+"=$"+(cols.length+i+1)).join(" AND ");s="UPDATE "+id(this.t)+" SET "+set+(wp?" WHERE "+wp:"")+" RETURNING *";const r=await db.pool.query(s,[...vals,...params]);return this.finish(r)}
  s="INSERT INTO "+id(this.t)+" ("+cols.map(id).join(",")+") VALUES ("+cols.map((_,i)=>"$"+(i+1)).join(",")+")";
  if(this.op==="upsert"){const cs=String(this.c).split(",").map(x=>x.trim());const up=cols.filter(c=>!cs.includes(c)).map(c=>id(c)+"=EXCLUDED."+id(c));s+=" ON CONFLICT ("+cs.map(id).join(",")+") DO "+(up.length?"UPDATE SET "+up.join(","):"NOTHING")}
  const r=await db.pool.query(s+" RETURNING *",vals);return this.finish(r)
 }
 finish(r){let d=r.rows;if(this.one){if(!d[0])return{data:null,error:Error("ROW_NOT_FOUND"),count:0};d=d[0]}else if(this.maybe)d=d[0]||null;return{data:d,error:null,count:r.rowCount}}
}
export const admin={from:t=>new Q(t),rpc:(n,a)=>rpc(n,a)};
async function rpc(n,a){
 try{
  if(n==="provision_initial_site")return{data:await provision(a.p_user_id,a.p_site_name),error:null};
  if(n==="allocate_project_build")return{data:await allocate(a),error:null};
  if(n==="consume_credits_and_create_build"||n==="consume_credits_and_create_build_v2")return{data:await consume(a),error:null};
  if(n==="fail_build_and_refund")return{data:await refundBuild(a),error:null};
  if(n==="debit_user_credits")return{data:await debit(a),error:null};
  if(n==="refund_user_credits")return{data:await refund(a),error:null};
  if(n==="apply_payment_credits")return{data:await payment(a),error:null};
  throw Error("RPC_NOT_IMPLEMENTED:"+n)
 }catch(error){return{data:null,error}}
}
async function allocate(a){const n=+(await db.pool.query("select coalesce(max(build_number),99)+1 n from project_builds where site_id=$1",[a.p_site_id])).rows[0].n;const v="v"+Math.floor(n/100)+"."+String(n%100).padStart(2,"0");const r=await db.pool.query("insert into project_builds(site_id,user_id,version_tag,build_number,commit_hash,status) select id,user_id,$2,$3,$4,'pending' from sites where id=$1 returning id,site_id,user_id,version_tag,build_number,status,created_at",[a.p_site_id,v,n,a.p_commit_hash||null]);if(!r.rows[0])throw Error("SITE_NOT_FOUND");return r.rows[0]}
async function consume(a){const c=await db.pool.connect();try{await c.query("begin");if(a.p_reference_id){const x=await c.query("select * from project_builds where credit_reference_id=$1 for update",[a.p_reference_id]);if(x.rows[0]){const u=await c.query("select credits_balance from user_credits where user_id=$1",[a.p_user_id]);await c.query("commit");return{success:true,idempotent:true,build_id:x.rows[0].id,version:x.rows[0].version_tag,build_number:x.rows[0].build_number,remaining_credits:u.rows[0]?.credits_balance||0}}}const s=await c.query("select user_id from sites where id=$1 for update",[a.p_site_id]);if(!s.rows[0]){await c.query("rollback");return{success:false,error:"SITE_NOT_FOUND"}}if(String(s.rows[0].user_id)!==String(a.p_user_id)){await c.query("rollback");return{success:false,error:"FORBIDDEN"}}const active=await c.query("select id,status from project_builds where site_id=$1 and repository_owner=$2 and repository_name=$3 and branch=$4 and status in ('pending','building','queued','processing') order by created_at desc limit 1",[a.p_site_id,a.p_repository_owner||null,a.p_repository_name||null,a.p_branch||"main"]);if(active.rows[0]){const u0=await c.query("select credits_balance from user_credits where user_id=$1",[a.p_user_id]);await c.query("commit");return{success:true,reused:true,build_id:active.rows[0].id,status:active.rows[0].status,remaining_credits:u0.rows[0]?.credits_balance||0}}const u=await c.query("select credits_balance from user_credits where user_id=$1 for update",[a.p_user_id]);if(!u.rows[0]){await c.query("rollback");return{success:false,error:"CREDIT_ACCOUNT_NOT_FOUND"}}if(u.rows[0].credits_balance<a.p_cost){await c.query("rollback");return{success:false,error:"INSUFFICIENT_CREDITS",remaining_credits:u.rows[0].credits_balance}}const rem=u.rows[0].credits_balance-a.p_cost;const n=+(await c.query("select coalesce(max(build_number),99)+1 n from project_builds where site_id=$1",[a.p_site_id])).rows[0].n;const v="v"+Math.floor(n/100)+"."+String(n%100).padStart(2,"0");await c.query("update user_credits set credits_balance=$1,updated_at=now() where user_id=$2",[rem,a.p_user_id]);const b=await c.query("insert into project_builds(site_id,user_id,version_tag,build_number,cost,status,git_provider,repository_owner,repository_name,branch,credit_reference_id) values($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10) returning id",[a.p_site_id,a.p_user_id,v,n,a.p_cost,a.p_git_provider||null,a.p_repository_owner||null,a.p_repository_name||null,a.p_branch||"main",a.p_reference_id||null]);await c.query("insert into credit_transactions(user_id,amount,type,reference_id,description,balance_after) values($1,$2,'deployment',$3,$4,$5) on conflict(user_id,reference_id) do nothing",[a.p_user_id,-a.p_cost,"build:"+(a.p_reference_id||crypto.randomUUID()),"HASPAD deployment "+v,rem]);await c.query("commit");return{success:true,idempotent:false,build_id:b.rows[0].id,version:v,build_number:n,remaining_credits:rem}}catch(e){await c.query("rollback");throw e}finally{c.release()}}
async function refundBuild(a){const c=await db.pool.connect();try{await c.query("begin");const b=(await c.query("select * from project_builds where id=$1 for update",[a.p_build_id])).rows[0];if(!b){await c.query("rollback");return{success:false,error:"BUILD_NOT_FOUND"}}if(b.status==="success"){await c.query("rollback");return{success:false,error:"BUILD_ALREADY_SUCCEEDED"}}if(b.refunded_at){await c.query("rollback");return{success:true,already_refunded:true}}const u=await c.query("update user_credits set credits_balance=credits_balance+coalesce($1,0),updated_at=now() where user_id=$2 returning credits_balance",[b.cost,b.user_id]);await c.query("update project_builds set status='failed',error_message=$1,refunded_at=now(),updated_at=now() where id=$2",[String(a.p_error||"BUILD_FAILED").slice(0,1000),b.id]);await c.query("commit");return{success:true,refunded_credits:b.cost||0,remaining_credits:u.rows[0].credits_balance}}catch(e){await c.query("rollback");throw e}finally{c.release()}}
async function debit(a){
 const c=await db.pool.connect();
 try{
  await c.query("begin");
  const ref=String(a.p_reference_id||"").trim();
  if(!ref){await c.query("rollback");throw Error("CREDIT_REFERENCE_REQUIRED")}
  const existing=await c.query("select balance_after from credit_transactions where user_id=$1 and reference_id=$2 and amount<0 limit 1",[a.p_user_id,ref]);
  if(existing.rows[0]){await c.query("commit");return existing.rows[0].balance_after}
  const cost=Number(a.p_cost);
  if(!Number.isInteger(cost)||cost<=0) {await c.query("rollback");throw Error("INVALID_CREDIT_COST")}
  const u=await c.query("select credits_balance from user_credits where user_id=$1 for update",[a.p_user_id]);
  if(!u.rows[0]){await c.query("rollback");throw Error("CREDIT_ACCOUNT_NOT_FOUND")}
  if(u.rows[0].credits_balance<cost){await c.query("rollback");throw Error("INSUFFICIENT_CREDITS")}
  const n=u.rows[0].credits_balance-cost;
  await c.query("update user_credits set credits_balance=$1,updated_at=now() where user_id=$2",[n,a.p_user_id]);
  await c.query("insert into credit_transactions(user_id,amount,type,reference_id,description,balance_after) values($1,$2,$3,$4,$5,$6)",[a.p_user_id,-cost,a.p_type||"debit",ref,a.p_description||"HASPAD credit debit",n]);
  await c.query("commit");return n;
 }catch(e){await c.query("rollback").catch(()=>{});throw e}finally{c.release()}
}
async function refund(a){
 const c=await db.pool.connect();
 try{
  await c.query("begin");
  const ref=String(a.p_reference_id||"").trim();
  if(!ref){await c.query("rollback");throw Error("CREDIT_REFERENCE_REQUIRED")}
  const amount=Number(a.p_amount);
  if(!Number.isInteger(amount)||amount<=0){await c.query("rollback");throw Error("INVALID_REFUND_AMOUNT")}
  const existing=await c.query("select balance_after from credit_transactions where user_id=$1 and reference_id=$2 and amount>0 limit 1",[a.p_user_id,ref]);
  if(existing.rows[0]){await c.query("commit");return existing.rows[0].balance_after}
  const u=await c.query("select credits_balance from user_credits where user_id=$1 for update",[a.p_user_id]);
  if(!u.rows[0]){await c.query("rollback");throw Error("CREDIT_ACCOUNT_NOT_FOUND")}
  const n=u.rows[0].credits_balance+amount;
  await c.query("update user_credits set credits_balance=$1,updated_at=now() where user_id=$2",[n,a.p_user_id]);
  await c.query("insert into credit_transactions(user_id,amount,type,reference_id,description,balance_after) values($1,$2,$3,$4,$5,$6)",[a.p_user_id,amount,a.p_type||"refund",ref,a.p_description||"HASPAD credit refund",n]);
  await c.query("commit");return n;
 }catch(e){await c.query("rollback").catch(()=>{});throw e}finally{c.release()}
}
async function payment(a){const p=(await db.pool.query("select * from payment_transactions where id=$1 for update",[a.p_payment_id])).rows[0];if(!p)throw Error("PAYMENT_NOT_FOUND");if(p.status!=="accepted")throw Error("PAYMENT_NOT_ACCEPTED");const u=(await db.pool.query("select credits_balance from user_credits where user_id=$1 for update",[p.user_id])).rows[0];if(p.processed_at)return u.credits_balance;const n=u.credits_balance+p.credits;await db.pool.query("update user_credits set credits_balance=$1,updated_at=now() where user_id=$2",[n,p.user_id]);await db.pool.query("insert into credit_transactions(user_id,amount,type,reference_id,description,balance_after) values($1,$2,'purchase',$3,$4,$5) on conflict(user_id,reference_id) do nothing",[p.user_id,p.credits,"payment:"+p.transaction_id,"Recharge HASPAD "+p.plan_type,n]);await db.pool.query("update payment_transactions set processed_at=now(),updated_at=now() where id=$1",[p.id]);return n}
async function provision(userId,siteName){const name=String(siteName||"Mon Premier Site").trim().slice(0,80)||"Mon Premier Site";const base=name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40)||"mon-site";for(let i=0;i<5;i++){try{const sub=base+"-"+crypto.randomBytes(3).toString("hex");const s=(await db.pool.query("insert into sites(user_id,name,subdomain,status) values($1,$2,$3,'draft') returning id,name,subdomain,custom_domain,status",[String(userId),name,sub])).rows[0];const root={id:"blk_root",type:"section",props:{semanticTag:"main"},styles:{desktop:{padding:"40px 20px"}},children:[{id:"blk_welcome_heading",type:"heading",props:{level:1,text:"Bienvenue sur "+name},styles:{desktop:{fontSize:"36px",textAlign:"center"}}}]};await db.pool.query("insert into pages(site_id,slug,seo,root_block) values($1,'index',$2,$3)",[s.id,JSON.stringify({title:"Accueil"}),JSON.stringify(root)]);await db.pool.query("insert into site_members(site_id,user_id,role) values($1,$2,'owner') on conflict(site_id,user_id) do nothing",[s.id,String(userId)]);return s}catch(e){if(e.code==="23505")continue;throw e}}throw Error("SITE_PROVISIONING_FAILED")}