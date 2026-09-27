create table if not exists public.project_builds (
  id uuid default gen_random_uuid() primary key,
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  version_tag text not null,
  build_number integer not null,
  commit_hash text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_builds_version_tag_check check (version_tag ~ '^v[0-9]+\\.[0-9]{2}$'),
  constraint project_builds_build_number_check check (build_number >= 100),
  constraint project_builds_status_check check (status in ('pending','success','failed')),
  constraint project_builds_site_build_unique unique (site_id, build_number),
  constraint project_builds_site_version_unique unique (site_id, version_tag)
);

create index if not exists project_builds_site_created_idx on public.project_builds(site_id, created_at desc);
create index if not exists project_builds_user_created_idx on public.project_builds(user_id, created_at desc);

alter table public.project_builds enable row level security;

drop policy if exists "Users can view their own project builds" on public.project_builds;
create policy "Users can view their own project builds"
on public.project_builds for select to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.allocate_project_build(
  p_site_id uuid,
  p_commit_hash text default null
)
returns table(id uuid, site_id uuid, user_id uuid, version_tag text, build_number integer, status text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_next integer;
  v_version text;
  v_id uuid;
  v_created timestamptz;
begin
  select s.user_id into v_user_id from public.sites s where s.id = p_site_id for update;
  if v_user_id is null then raise exception 'SITE_NOT_FOUND'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_site_id::text, 0));

  select coalesce(max(pb.build_number), 99) + 1 into v_next
  from public.project_builds pb where pb.site_id = p_site_id;

  v_version := 'v' || floor(v_next / 100)::text || '.' || lpad((v_next % 100)::text, 2, '0');

  insert into public.project_builds(site_id, user_id, version_tag, build_number, commit_hash, status)
  values(p_site_id, v_user_id, v_version, v_next, nullif(left(coalesce(p_commit_hash,''), 100), ''), 'pending')
  returning project_builds.id, project_builds.created_at into v_id, v_created;

  return query select v_id, p_site_id, v_user_id, v_version, v_next, 'pending'::text, v_created;
end;
$$;

revoke all on function public.allocate_project_build(uuid, text) from public, anon, authenticated;
grant execute on function public.allocate_project_build(uuid, text) to service_role;
