CREATE TABLE IF NOT EXISTS project_env_vars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id text NOT NULL, key_name text NOT NULL, encrypted_value text, is_secret boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(site_id,key_name)
);
CREATE TABLE IF NOT EXISTS deployment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), build_id uuid NOT NULL REFERENCES project_builds(id) ON DELETE CASCADE,
  stream text NOT NULL DEFAULT 'stdout', message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), build_id uuid REFERENCES project_builds(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE, diagnosis jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE deployment_projects ADD COLUMN IF NOT EXISTS source_provider text;
ALTER TABLE deployment_projects ADD COLUMN IF NOT EXISTS repository_owner text;
ALTER TABLE deployment_projects ADD COLUMN IF NOT EXISTS repository_name text;
ALTER TABLE deployment_projects ADD COLUMN IF NOT EXISTS branch text DEFAULT 'main';
ALTER TABLE deployment_projects ADD COLUMN IF NOT EXISTS commit_sha text;
ALTER TABLE deployment_projects ADD COLUMN IF NOT EXISTS framework text;
ALTER TABLE deployment_projects ADD COLUMN IF NOT EXISTS detected_port integer;
ALTER TABLE deployment_projects ADD COLUMN IF NOT EXISTS healthcheck_path text DEFAULT '/';
ALTER TABLE deployment_projects ADD COLUMN IF NOT EXISTS runtime_target text DEFAULT 'netlify';
