create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  site_slug text not null check (site_slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'),
  site_url text not null,
  netlify_site_id text,
  netlify_build_hook_url text,
  deploy_branch text not null default 'haspad/deploy',
  repo_owner text not null check (repo_owner ~ '^[A-Za-z0-9_.-]+$'),
  repo_name text not null check (repo_name ~ '^[A-Za-z0-9_.-]+$'),
  repo_url text not null,
  default_branch text not null default 'main',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, repo_owner, repo_name),
  unique(site_slug)
);

alter table public.projects add column if not exists site_slug text;
alter table public.projects add column if not exists site_url text;
alter table public.projects add column if not exists netlify_site_id text;
alter table public.projects add column if not exists netlify_build_hook_url text;
alter table public.projects add column if not exists deploy_branch text not null default 'haspad/deploy';
create unique index if not exists projects_site_slug_unique on public.projects(site_slug) where site_slug is not null;

create table if not exists public.github_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  github_user_id bigint not null,
  github_login text not null,
  access_token_ciphertext text not null,
  access_token_iv text not null,
  access_token_tag text not null,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deployments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'starting' check (status in ('starting','gemini_processing','gemini_correcting','claude_processing','claude_correcting','chatgpt_verifying','chatgpt_correcting','github_pushing','netlify_provisioning','testing','fallback','completed','failed')),
  current_step text,
  branch_name text,
  commit_sha text,
  pull_request_url text,
  netlify_site_id text,
  netlify_deploy_id text,
  logs jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.deployments add column if not exists netlify_site_id text;
alter table public.deployments add column if not exists netlify_deploy_id text;
alter table public.deployments drop constraint if exists deployments_status_check;
alter table public.deployments add constraint deployments_status_check check (status in ('starting','gemini_processing','gemini_correcting','claude_processing','claude_correcting','chatgpt_verifying','chatgpt_correcting','github_pushing','netlify_provisioning','testing','fallback','completed','failed'));

alter table public.projects enable row level security;
alter table public.github_connections enable row level security;
alter table public.deployments enable row level security;

drop policy if exists projects_select_own on public.projects;
create policy projects_select_own on public.projects for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists projects_update_own on public.projects;
create policy projects_update_own on public.projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists projects_delete_own on public.projects;
create policy projects_delete_own on public.projects for delete to authenticated using ((select auth.uid()) = user_id);
drop policy if exists github_connections_no_client_access on public.github_connections;
create policy github_connections_no_client_access on public.github_connections for select to authenticated using (false);
drop policy if exists deployments_select_own on public.deployments;
create policy deployments_select_own on public.deployments for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.set_haspad_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at before update on public.projects for each row execute function public.set_haspad_updated_at();
drop trigger if exists github_connections_updated_at on public.github_connections;
create trigger github_connections_updated_at before update on public.github_connections for each row execute function public.set_haspad_updated_at();
drop trigger if exists deployments_updated_at on public.deployments;
create trigger deployments_updated_at before update on public.deployments for each row execute function public.set_haspad_updated_at();

do $$
begin
  begin
    alter publication supabase_realtime add table public.deployments;
  exception when duplicate_object then null;
  end;
end $$;