alter table public.sites
  add column if not exists netlify_site_id text unique,
  add column if not exists netlify_url text;

alter table public.project_builds
  drop constraint if exists project_builds_status_check;
alter table public.project_builds
  add constraint project_builds_status_check check (status in ('pending','building','success','failed'));