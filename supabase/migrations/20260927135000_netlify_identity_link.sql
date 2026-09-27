-- Bridge Netlify Identity users to the existing Supabase-backed application data.
create table if not exists public.netlify_identity_links (
  netlify_user_id text primary key,
  supabase_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.netlify_identity_links enable row level security;
revoke all on table public.netlify_identity_links from public, anon, authenticated;
grant all on table public.netlify_identity_links to service_role;

drop policy if exists netlify_identity_links_service_only on public.netlify_identity_links;
create policy netlify_identity_links_service_only
  on public.netlify_identity_links
  for all to service_role
  using (true)
  with check (true);

create index if not exists netlify_identity_links_supabase_user_idx
  on public.netlify_identity_links(supabase_user_id);
