CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS profiles (
  id text PRIMARY KEY,
  full_name text,
  avatar_url text,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  is_email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  name varchar(255) NOT NULL,
  subdomain varchar(63) UNIQUE NOT NULL,
  custom_domain varchar(255) UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  provider_hosting_id varchar(255),
  netlify_site_id text UNIQUE,
  netlify_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sites_user_idx ON sites(user_id);

CREATE TABLE IF NOT EXISTS site_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','editor','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id,user_id)
);

CREATE TABLE IF NOT EXISTS pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug varchar(255) NOT NULL,
  title text,
  seo jsonb NOT NULL DEFAULT '{}'::jsonb,
  root_block jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id,slug)
);
CREATE INDEX IF NOT EXISTS pages_site_idx ON pages(site_id,slug);

CREATE TABLE IF NOT EXISTS site_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  is_published boolean NOT NULL DEFAULT true,
  layout_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id,slug)
);

CREATE TABLE IF NOT EXISTS project_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  subdomain text NOT NULL,
  domain_extension text NOT NULL,
  full_domain text GENERATED ALWAYS AS (subdomain || domain_extension) STORED,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending_dns',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(full_domain)
);

CREATE TABLE IF NOT EXISTS user_credits (
  user_id text PRIMARY KEY,
  credits_balance integer NOT NULL DEFAULT 500 CHECK(credits_balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  amount integer NOT NULL,
  type text NOT NULL,
  reference_id text NOT NULL,
  description text,
  balance_after integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,reference_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  plan_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  provider text NOT NULL DEFAULT 'manual',
  provider_transaction_id text UNIQUE,
  credits_granted integer NOT NULL DEFAULT 0,
  amount_xof integer,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  transaction_id text NOT NULL UNIQUE,
  provider text NOT NULL DEFAULT 'manual',
  plan_type text NOT NULL,
  amount_xof integer NOT NULL,
  credits integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  payment_url text,
  provider_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS project_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  version_tag text NOT NULL,
  build_number integer NOT NULL,
  commit_hash text,
  status text NOT NULL DEFAULT 'pending',
  cost integer,
  netlify_deploy_id text,
  deploy_url text,
  error_message text,
  triggered_at timestamptz,
  refunded_at timestamptz,
  git_provider text,
  repository_owner text,
  repository_name text,
  branch text DEFAULT 'main',
  credit_reference_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id,build_number),
  UNIQUE(site_id,version_tag)
);
CREATE INDEX IF NOT EXISTS builds_site_idx ON project_builds(site_id,build_number DESC);
CREATE INDEX IF NOT EXISTS builds_user_idx ON project_builds(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS github_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL UNIQUE,
  github_user_id bigint NOT NULL,
  github_login text NOT NULL,
  access_token_ciphertext text NOT NULL,
  access_token_iv text NOT NULL,
  access_token_tag text NOT NULL,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  refresh_token_tag text,
  token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control_centers (
  site_id uuid PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL,
  plan text NOT NULL DEFAULT 'startup',
  provisioned_at timestamptz NOT NULL DEFAULT now(),
  schema_version integer NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS server_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  cpu_usage numeric(5,2), ram_usage numeric(5,2), latency_ms integer, status text NOT NULL DEFAULT 'healthy', recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  error_message text NOT NULL, stack_trace text, severity text NOT NULL DEFAULT 'medium', is_resolved boolean NOT NULL DEFAULT false,
  ai_fix_applied text, preventive_warning text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS site_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES site_pages(id) ON DELETE CASCADE, component_type text NOT NULL,
  identifier text NOT NULL, design_props jsonb NOT NULL DEFAULT '{}'::jsonb, position_index integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(site_id,identifier)
);
CREATE TABLE IF NOT EXISTS ai_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  type text NOT NULL, message text NOT NULL, severity text NOT NULL DEFAULT 'info', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  agent_name text NOT NULL, action_taken text NOT NULL, details jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS control_schema_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id text NOT NULL, request_text text NOT NULL, schema_blueprint jsonb NOT NULL,
  status text NOT NULL DEFAULT 'applied', created_at timestamptz NOT NULL DEFAULT now()
);