import { json } from "./_lib.mjs";
export default async () => json({
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || ""
});
