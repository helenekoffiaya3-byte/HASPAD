import { admin, provisionInitialSite } from "./_auth.js";
import crypto from "crypto";

export default {
  async userSignup(event) {
    const user=event.user;
    if(!user?.id||!user?.email)return;
    try {
      const metadata=user.userMetadata||{};
      const siteName=String(metadata.site_name||"Mon Premier Site").trim().slice(0,80)||"Mon Premier Site";
      const {data:existing}=await admin.from("netlify_identity_links").select("supabase_user_id").eq("netlify_user_id",String(user.id)).maybeSingle();
      if(existing?.supabase_user_id)return;
      const password=crypto.randomBytes(32).toString("base64url")+"A1!";
      const created=await admin.auth.admin.createUser({email:user.email,password,email_confirm:true,user_metadata:{full_name:metadata.full_name||user.name||null,avatar_url:user.pictureUrl||null}});
      if(created.error)throw created.error;
      const shadow=created.data.user;
      await admin.from("netlify_identity_links").insert({netlify_user_id:String(user.id),supabase_user_id:shadow.id,email:user.email});
      await admin.from("user_credits").upsert({user_id:shadow.id,credits_balance:500},{onConflict:"user_id"});
      await admin.from("profiles").upsert({id:shadow.id,full_name:metadata.full_name||user.name||null,avatar_url:user.pictureUrl||null,is_email_verified:true},{onConflict:"id"});
      await provisionInitialSite(shadow,{siteName});
    } catch(error) { console.error("identity userSignup sync failed",error); }
  }
};