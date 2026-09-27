CREATE TABLE IF NOT EXISTS deployment_projects(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
 user_id text NOT NULL,
 source_type text NOT NULL DEFAULT 'github',
 runtime_type text NOT NULL DEFAULT 'static',
 dockerfile_path text,
 build_command text,
 start_command text,
 publish_directory text,
 port integer,
 environment_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
 detected_files jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(site_id)
);
CREATE TABLE IF NOT EXISTS deployment_artifacts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES deployment_projects(id) ON DELETE CASCADE,
 build_id uuid REFERENCES project_builds(id) ON DELETE SET NULL,
 artifact_type text NOT NULL,
 image_reference text,
 artifact_url text,
 digest text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS deployment_runtimes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES deployment_projects(id) ON DELETE CASCADE,
 runtime_type text NOT NULL,
 provider text NOT NULL,
 service_id text,
 region text,
 port integer,
 status text NOT NULL DEFAULT 'pending',
 public_url text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
