export default async(req)=>{
  if(req.method!=="POST")return {statusCode:405,body:"Method Not Allowed"};
  let body;try{body=JSON.parse(req.body||"{}")}catch{return {statusCode:400,body:"JSON invalide"}}
  if(!body.paymentToken||!body.productId||!body.amount||!body.currency)return {statusCode:400,body:"Paramètres de paiement incomplets"};
  if(!process.env.PAYMENT_PROCESSOR_SECRET_KEY)return {statusCode:503,body:JSON.stringify({error:"Processeur de paiement non configuré"})};
  return {statusCode:501,body:JSON.stringify({error:"Google Pay reçu; validation/settlement du processeur à implémenter"})};
};