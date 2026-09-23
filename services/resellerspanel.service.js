import axios from "axios";

function getApi(){
  const {RESELLERS_API_URL,RESELLERS_API_USER,RESELLERS_API_PASSWORD}=process.env;
  if(!RESELLERS_API_URL||!RESELLERS_API_USER||!RESELLERS_API_PASSWORD)
    throw new Error("Configuration Resellers Panel incomplète");
  return axios.create({
    baseURL:RESELLERS_API_URL,
    auth:{username:RESELLERS_API_USER,password:RESELLERS_API_PASSWORD},
    headers:{"Content-Type":"application/json"},
    timeout:15000
  });
}

export async function testConnection(){
  try{
    await getApi().get("/v1/account");
    return {ok:true};
  }catch(error){
    return {ok:false,error:error.response?.data||error.message};
  }
}

export async function createHostingAccount(userData,siteData){
  if(!userData?.email||!siteData?.subdomain)
    throw new Error("Données de provisioning invalides");

  const api=getApi();
  const domain=siteData.domain ||
    `${siteData.subdomain}.${process.env.HASPAD_HOSTING_DOMAIN||"votre-domaine.com"}`;

  try{
    const response=await api.post("/v1/orders",{
      plan:process.env.RESELLERS_HOSTING_PLAN||"cloud_starter",
      domain,
      customer:{
        email:userData.email,
        name:userData.fullName||"Utilisateur"
      }
    });
    return {success:true,data:response.data};
  }catch(error){
    throw new Error("Échec du provisioning de l'hébergement.");
  }
}
