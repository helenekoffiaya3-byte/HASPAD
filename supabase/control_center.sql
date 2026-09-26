-- HASPAD Startup Control Center.
create table if not exists public.control_centers (
  site_id uuid primary key references public.sites(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null default 'startup' check(plan='startup'),
  provisioned_at timestamptz not null default now(),
  schema_version integer not null default 1
);
create table if not exists public.server_metrics (
  id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id) on delete cascade,
  cpu_usage numeric(5,2), ram_usage numeric(5,2), latency_ms integer,
  status text not null default 'healthy' check(status in ('healthy','warning','critical')),
  recorded_at timestamptz not null default now()
);
create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id) on delete cascade,
  error_message text not null, stack_trace text,
  severity text not null default 'medium' check(severity in ('low','medium','critical')),
  is_resolved boolean not null default false, ai_fix_applied text, preventive_warning text,
  created_at timestamptz not null default now()
);
create table if not exists public.site_pages (
  id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id) on delete cascade,
  slug text not null, title text not null, is_published boolean not null default true,
  layout_config jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(),
  unique(site_id,slug)
);
create table if not exists public.site_components (
  id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id) on delete cascade,
  page_id uuid not null references public.site_pages(id) on delete cascade, component_type text not null,
  identifier text not null, design_props jsonb not null default '{}'::jsonb, position_index integer not null default 0,
  updated_at timestamptz not null default now(), unique(site_id,identifier)
);
create table if not exists public.ai_recommendations (
  id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id) on delete cascade,
  type text not null, message text not null, severity text not null default 'info',
  created_at timestamptz not null default now()
);
create table if not exists public.ai_activity_logs (
  id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id) on delete cascade,
  agent_name text not null, action_taken text not null, details jsonb, created_at timestamptz not null default now()
);
create table if not exists public.control_schema_requests (
  id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, request_text text not null,
  schema_blueprint jsonb not null, status text not null default 'applied' check(status in ('applied','rejected')),
  created_at timestamptz not null default now()
);
create index if not exists server_metrics_site_time on public.server_metrics(site_id,recorded_at desc);
create index if not exists error_logs_site_time on public.error_logs(site_id,created_at desc);
create index if not exists ai_recommendations_site_time on public.ai_recommendations(site_id,created_at desc);
create index if not exists ai_activity_logs_site_time on public.ai_activity_logs(site_id,created_at desc);

alter table public.control_centers enable row level security;
alter table public.server_metrics enable row level security;
alter table public.error_logs enable row level security;
alter table public.site_pages enable row level security;
alter table public.site_components enable row level security;
alter table public.ai_recommendations enable row level security;
alter table public.ai_activity_logs enable row level security;
alter table public.control_schema_requests enable row level security;

create or replace function public.has_site_access(p_site_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.site_members where site_id=p_site_id and user_id=(select auth.uid())); $$;
revoke all on function public.has_site_access(uuid) from public,anon;
grant execute on function public.has_site_access(uuid) to authenticated;

drop policy if exists control_centers_select on public.control_centers;
create policy control_centers_select on public.control_centers for select to authenticated using (public.has_site_access(site_id));
drop policy if exists server_metrics_select on public.server_metrics;
create policy server_metrics_select on public.server_metrics for select to authenticated using (public.has_site_access(site_id));
drop policy if exists error_logs_select on public.error_logs;
create policy error_logs_select on public.error_logs for select to authenticated using (public.has_site_access(site_id));
drop policy if exists site_pages_select on public.site_pages;
create policy site_pages_select on public.site_pages for select to authenticated using (public.has_site_access(site_id));
drop policy if exists site_components_select on public.site_components;
create policy site_components_select on public.site_components for select to authenticated using (public.has_site_access(site_id));
drop policy if exists ai_recommendations_select on public.ai_recommendations;
create policy ai_recommendations_select on public.ai_recommendations for select to authenticated using (public.has_site_access(site_id));
drop policy if exists ai_activity_logs_select on public.ai_activity_logs;
create policy ai_activity_logs_select on public.ai_activity_logs for select to authenticated using (public.has_site_access(site_id));
drop policy if exists control_schema_requests_select on public.control_schema_requests;
create policy control_schema_requests_select on public.control_schema_requests for select to authenticated using (public.has_site_access(site_id));
