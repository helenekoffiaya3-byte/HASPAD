import { admin } from "./_credits.js";
import { runtimeRequest } from "./_runtime.js";

export default async () => {
  if (!process.env.HASPAD_RUNTIME_URL || !process.env.HASPAD_RUNTIME_SHARED_SECRET) return;

  const { data: builds, error } = await admin
    .from("project_builds")
    .select("id,status,deploy_url")
    .eq("status", "building")
    .eq("git_provider", "github-docker")
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("northflank-reconcile-query", error.message);
    return;
  }

  for (const build of builds || []) {
    try {
      const runtime = await runtimeRequest("/v1/status/" + encodeURIComponent(build.id), {}, "GET");
      const status = String(runtime?.status || "").toLowerCase();

      if (status === "running") {
        await admin.from("project_builds").update({
          status: "success",
          deploy_url: runtime.publicUrl || build.deploy_url || null,
          updated_at: new Date().toISOString()
        }).eq("id", build.id).eq("status", "building");
      } else if (status === "failed") {
        await admin.rpc("fail_build_and_refund", {
          p_build_id: build.id,
          p_error: "NORTHFLANK_DEPLOYMENT_FAILED"
        });
      }
    } catch (error) {
      console.warn("northflank-reconcile", build.id, error?.message || error);
    }
  }
};

export const config = {
  schedule: "* * * * *"
};
