-- Reconciles the live Supabase schema with the atomic HASPAD build/deployment contract.
-- This migration is intentionally idempotent.

alter table public.sites
  add column if not exists netlify_site_id text unique,
  add column if not exists netlify_url text;

alter table public.project_builds
  add column if not exists cost integer,
  add column if not exists netlify_deploy_id text,
  add column if not exists deploy_url text,
  add column if not exists error_message text,
  add column if not exists triggered_at timestamptz,
  add column if not exists refunded_at timestamptz;

create index if not exists project_builds_netlify_deploy_idx
  on public.project_builds(netlify_deploy_id);

alter table public.project_builds drop constraint if exists project_builds_cost_check;
alter table public.project_builds
  add constraint project_builds_cost_check check (cost is null or cost > 0);

alter table public.project_builds drop constraint if exists project_builds_status_check;
alter table public.project_builds
  add constraint project_builds_status_check
  check (status in ('pending','building','success','failed'));

-- The full function definitions are maintained in the previous atomic build
-- migration; this migration only exists to make the live schema reproducible.
