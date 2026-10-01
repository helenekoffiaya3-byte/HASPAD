-- Credit/deployment invariants for the canonical Netlify Database.
-- Safe to run repeatedly; existing rows and balances are not modified.
CREATE UNIQUE INDEX IF NOT EXISTS project_builds_active_repo_unique
ON project_builds(site_id, git_provider, repository_owner, repository_name, branch)
WHERE status IN ('pending','building');

CREATE UNIQUE INDEX IF NOT EXISTS project_builds_credit_reference_uidx
ON project_builds(credit_reference_id)
WHERE credit_reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS project_builds_netlify_deploy_idx
ON project_builds(netlify_deploy_id)
WHERE netlify_deploy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS project_builds_runtime_idx
ON project_builds(runtime_service_id)
WHERE runtime_service_id IS NOT NULL;
