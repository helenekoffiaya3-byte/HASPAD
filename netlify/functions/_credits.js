import { admin, json } from "./_db.js";
import { authenticatedUser as resolveAuthenticatedUser } from "./_auth.js";
export { admin, json };
export async function authenticatedUser(req){return await resolveAuthenticatedUser(req);}
export const PLANS=Object.freeze({startup:{name:"Startup",credits:4000,amountEnv:"PAYDUNYA_STARTUP_AMOUNT_XOF"},pro:{name:"Pro",credits:6800,amountEnv:"PAYDUNYA_PRO_AMOUNT_XOF"},business:{name:"Business",credits:19089,amountEnv:"PAYDUNYA_BUSINESS_AMOUNT_XOF"}});
export function getPlan(planType){const key=String(planType||"").toLowerCase();const plan=PLANS[key];if(!plan)return null;const amount=Number(process.env[plan.amountEnv]);if(!Number.isInteger(amount)||amount<200||amount>3000000)return null;return {...plan,type:key,amount};}