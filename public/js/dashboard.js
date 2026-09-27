import{api,logout}from"./auth.js";
import{initGit}from"./git.js";
const $=s=>document.querySelector(s);
const credits=$("#credits"),welcome=$("#welcome"),projects=$("#projectsList"),domainProject=$("#domainProject"),domainSubdomain=$("#domainSubdomain"),domainExtension=$("#domainExtension"),domainPreview=$("#domainPreview"),domainPrice=$("#domainPrice"),domainStatus=$("#domainStatus"),saveWrap=$("#saveDomainWrap"),save=$("#saveDomain"),message=$("#paymentMessage");
let pricing=[],available=false;

domainProject?.addEventListener("change",()=>{if(domainProject.value)initGit(domainProject.value).catch(error=>console.error("git-init:",error))});

const esc=v=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const xof=v=>new Intl.NumberFormat("fr-FR").format(Number(v))+" XOF/an";

function preview(){
  if(!domainPreview||!domainExtension)return;
  domainPreview.textContent=(domainSubdomain?.value||"mon-projet").toLowerCase()+domainExtension.value;
  available=false;
  if(saveWrap)saveWrap.hidden=true;
  const p=pricing.find(x=>x.extension===domainExtension.value);
  if(domainPrice)domainPrice.textContent=p?"Tarif indicatif : "+xof(p.registration_price):"Tarif indisponible";
}

async function load(){
  try{
    const me=await api("/api/auth-me");
    if(!me.ok){location.href="/connexion.html";return}
    const md=await me.json(),u=md.user||md;
    if(welcome)welcome.textContent=u.email?"Connecté en tant que "+u.email:"Bienvenue sur HASPAD.com";
    const account=$("#accountStatus");
    if(account)account.textContent=u.is_email_verified===false?"Email à vérifier":"Vérifié";

    const [cr,sr]=await Promise.all([api("/api/credits"),api("/api/editor-sites")]);

    if(cr.ok){
      const cd=await cr.json();
      if(credits)credits.textContent=new Intl.NumberFormat("fr-FR").format(Number(cd.credits||0));
    }

    if(!sr.ok){
      if(projects)projects.textContent="Impossible de charger les projets.";
      return;
    }

    const sd=await sr.json(),sites=Array.isArray(sd.sites)?sd.sites:[];
    if(sites.length&&domainProject){
      try{await initGit(sites[0].id)}catch(error){console.error("git-init:",error)}
    }
    const count=$("#projectCount");
    if(count)count.textContent=sites.length;

    if(domainProject){
      domainProject.innerHTML=sites.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name||s.subdomain||"Projet")+"</option>").join("");
    }

    if(projects){
      projects.innerHTML=sites.length
        ?sites.map(s=>'<div class="project"><div><strong>'+esc(s.name||"Projet")+'</strong><small>'+esc(s.subdomain||"")+" · "+esc(s.status||"draft")+'</small></div><a href="/editor.html?siteId='+encodeURIComponent(s.id)+'">Ouvrir l’éditeur →</a></div>').join("")
        :'<p>Aucun projet. Utilisez le bouton « Nouveau projet » pour préparer votre espace.';
    }

    // The overview reflects the latest build across all owned projects.
    const builds=await Promise.all(sites.map(async s=>{
      try{
        const r=await api("/api/build-version?siteId="+encodeURIComponent(s.id));
        if(!r.ok)return null;
        const d=await r.json();
        return d.build?{...d.build,siteName:s.name||s.subdomain||"Projet"}:null;
      }catch{return null}
    }));
    const valid=builds.filter(Boolean).sort((a,b)=>new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0));
    const latest=valid[0];
    const version=$("#currentVersion"),status=$("#deployStatus");
    if(version)version.textContent=latest?.version_tag||"—";
    if(status)status.textContent=latest?.status||"Aucun build";
  }catch(error){
    console.error("dashboard-load:",error);
    if(projects)projects.textContent="Impossible de charger le Dashboard.";
  }
}

async function prices(){
  if(!domainPrice||!domainExtension)return;
  try{
    const r=await api("/api/domain-pricing");
    if(r.ok){pricing=(await r.json()).pricing||[];preview()}
    else domainPrice.textContent="Tarification indisponible";
  }catch{domainPrice.textContent="Tarification indisponible"}
}

async function verifyReturnedPayment(){
  const token=new URLSearchParams(location.search).get("token");
  if(!token||!message)return;
  message.textContent="Vérification du paiement PayDunya…";
  try{
    const r=await api("/api/paydunya-verify",{method:"POST",body:JSON.stringify({token})});
    const d=await r.json().catch(()=>({}));
    if(r.ok&&d.status==="completed"){
      message.textContent=d.alreadyProcessed?"Paiement déjà traité.":"Paiement confirmé : vos crédits ont été ajoutés.";
      await load();
    }else if(r.ok&&d.status){
      message.textContent="Paiement en cours de confirmation ("+d.status+").";
    }else message.textContent="La confirmation du paiement est encore en cours. Rechargez cette page dans quelques instants.";
  }catch{message.textContent="La confirmation du paiement est encore en cours. Rechargez cette page dans quelques instants."}
}

domainSubdomain?.addEventListener("input",e=>{
  e.target.value=e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,"");
  preview();
});
domainExtension?.addEventListener("change",preview);

$("#domainForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  if(domainStatus)domainStatus.textContent="Vérification…";
  try{
    const r=await api("/api/domain-availability",{method:"POST",body:JSON.stringify({subdomain:domainSubdomain.value.trim(),domainExtension:domainExtension.value})});
    const d=await r.json().catch(()=>({}));
    available=r.ok&&d.available===true;
    if(domainStatus)domainStatus.textContent=available?"✓ Disponible":"✕ "+(d.error||"Indisponible");
    if(saveWrap)saveWrap.hidden=!available;
  }catch{
    available=false;
    if(domainStatus)domainStatus.textContent="✕ Service temporairement indisponible.";
    if(saveWrap)saveWrap.hidden=true;
  }
});

save?.addEventListener("click",async()=>{
  save.disabled=true;
  if(domainStatus)domainStatus.textContent="Enregistrement…";
  try{
    const r=await api("/api/configure-domain",{method:"POST",body:JSON.stringify({projectId:domainProject.value,subdomain:domainSubdomain.value.trim(),domainExtension:domainExtension.value})});
    const d=await r.json().catch(()=>({}));
    if(r.ok){
      if(domainStatus)domainStatus.textContent="✓ Domaine enregistré dans HASPAD.";
      if(saveWrap)saveWrap.hidden=true;
    }else{
      if(domainStatus)domainStatus.textContent="✕ "+(d.error||"Enregistrement impossible.");
    }
  }catch{
    if(domainStatus)domainStatus.textContent="✕ Enregistrement impossible.";
  }finally{save.disabled=false}
});

document.querySelectorAll("[data-plan]").forEach(b=>b.addEventListener("click",async()=>{
  const plan=b.dataset.plan;b.disabled=true;
  if(message)message.textContent="Création de la facture PayDunya…";
  try{
    const r=await api("/api/paydunya-create",{method:"POST",body:JSON.stringify({planType:plan})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.paymentUrl){
      if(message)message.textContent=d.error||"Impossible de créer le paiement.";
      return;
    }
    location.href=d.paymentUrl;
  }catch{
    if(message)message.textContent="Erreur lors de l'initialisation du paiement.";
  }finally{b.disabled=false}
}));

$("#logout")?.addEventListener("click",async()=>{await logout();location.href="/"});

$("#newProject")?.addEventListener("click",async()=>{
  const name=prompt("Nom du nouveau projet");
  if(!name?.trim())return;
  const b=$("#newProject");b.disabled=true;
  try{
    const r=await api("/api/create-site",{method:"POST",body:JSON.stringify({siteName:name.trim()})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){alert(d.error||"Création impossible.");return}
    location.href="/editor.html?siteId="+encodeURIComponent(d.site.id);
  }finally{b.disabled=false}
});

load();
prices();
verifyReturnedPayment();
