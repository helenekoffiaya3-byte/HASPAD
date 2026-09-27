import { admin } from "./_credits.js";

export async function allocateBuild(siteId, commitHash = null) {
  const { data, error } = await admin.rpc("allocate_project_build", {
    p_site_id: siteId,
    p_commit_hash: commitHash || null
  });
  if (error) throw error;
  const build = Array.isArray(data) ? data[0] : data;
  if (!build?.id || !build?.version_tag) throw new Error("BUILD_ALLOCATION_FAILED");
  return build;
}

export async function getLatestBuild(siteId) {
  const { data, error } = await admin
    .from("project_builds")
    .select("id,site_id,version_tag,build_number,commit_hash,status,created_at,updated_at")
    .eq("site_id", siteId)
    .order("build_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateBuild(buildId, status, commitHash = undefined) {
  if (!["pending", "success", "failed"].includes(status)) {
    throw new Error("INVALID_BUILD_STATUS");
  }
  const patch = { status, updated_at: new Date().toISOString() };
  if (commitHash !== undefined) patch.commit_hash = commitHash || null;
  const { data, error } = await admin
    .from("project_builds")
    .update(patch)
    .eq("id", buildId)
    .select("id,site_id,version_tag,build_number,commit_hash,status,created_at,updated_at")
    .single();
  if (error) throw error;
  return data;
}
