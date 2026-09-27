const filesInput=document.querySelector("#projectFiles"), result=document.querySelector("#deploymentResult"), detect=document.querySelector("#detectProject");
async function analyze(files){const response=await fetch("/api/deployment-detect",{method:"POST",headers:{"content-type":"application/json"},credentials:"include",body:JSON.stringify({files:[...files].map(f=>({path:f.webkitRelativePath||f.name}))})});const data=await response.json().catch(()=>({}));result.textContent=response.ok?JSON.stringify(data,null,2):(data.error||"Analyse impossible.");}
filesInput?.addEventListener("change",()=>filesInput.files.length&&analyze(filesInput.files));
detect?.addEventListener("click",()=>filesInput?.click());
