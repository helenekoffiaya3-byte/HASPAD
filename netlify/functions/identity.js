import { admin, provisionInitialSite } from "./_auth.js";
export default {
  async userSignup(event) {
    const user=event.user;
    if(!user?.id)return;
    try {
      const metadata=user.userMetadata||{};
      const id=String(user.id);
      await admin.from("profiles").upsert({
        id,
        full_name:metadata.full_name||user.name||null,
        avatar_url:user.pictureUrl||null,
        is_email_verified:user.confirmedAt!=null,
        updated_at:new Date().toISOString()
      },{onConflict:"id"});
      const {data:credit}=await admin.from("user_credits").select("user_id").eq("user_id",id).maybeSingle();
      if(!credit)await admin.from("user_credits").insert({user_id:id,credits_balance:500});
      const {data:sites}=await admin.from("sites").select("id").eq("user_id",id).limit(1);
      if(!sites?.length)await provisionInitialSite({id},{siteName:String(metadata.site_name||"Mon Premier Site").trim().slice(0,80)});
    } catch(error) { console.error("identity userSignup failed",error); }
  }
};