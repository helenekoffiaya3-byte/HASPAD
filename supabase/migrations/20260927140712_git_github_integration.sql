alter table public.github_connections
  add column if not exists refresh_token_ciphertext text,
  add column if not exists refresh_token_iv text,
  add column if not exists refresh_token_tag text,
  add column if not exists token_expires_at timestamptz;

create unique index if not exists github_connections_user_id_uidx
  on public.github_connections(user_id);

alter table public.project_builds
  add column if not exists git_provider text,
  add column if not exists repository_owner text,
  add column if not exists repository_name text,
  add column if not exists branch text default 'main',
  add column if not exists credit_reference_id text;

create unique index if not exists project_builds_credit_reference_uidx
  on public.project_builds(credit_reference_id)
  where credit_reference_id is not null;

create index if not exists project_builds_git_repo_idx
  on public.project_builds(user_id, git_provider, repository_owner, repository_name, created_at desc);

create or replace function public.consume_credits_and_create_build_v2(
  p_user_id uuid,p_site_id uuid,p_cost integer,p_reference_id text,
  p_git_provider text default null,p_repository_owner text default null,
  p_repository_name text default null,p_branch text default 'main')
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_site_user uuid; v_credits integer; v_next integer; v_version text;
v_build_id uuid; v_existing public.project_builds; v_new integer;
begin
 if p_user_id is null or p_site_id is null or p_reference_id is null or length(trim(p_reference_id))<8 then
   return jsonb_build_object('success',false,'error','INVALID_ARGUMENTS');
 end if;
 if p_cost is null or p_cost<=0 then return jsonb_build_object('success',false,'error','INVALID_COST'); end if;
 select * into v_existing from public.project_builds where credit_reference_id=p_reference_id for update;
 if found then
   select credits_balance into v_credits from public.user_credits where user_id=p_user_id;
   return jsonb_build_object('success',true,'idempotent',true,'build_id',v_existing.id,'version',v_existing.version_tag,'build_number',v_existing.build_number,'remaining_credits',coalesce(v_credits,0));
 end if;
 select s.user_id into v_site_user from public.sites s where s.id=p_site_id for update;
 if v_site_user is null then return jsonb_build_object('success',false,'error','SITE_NOT_FOUND'); end if;
 if v_site_user<>p_user_id then return jsonb_build_object('success',false,'error','FORBIDDEN'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_site_id::text,0));
 select credits_balance into v_credits from public.user_credits where user_id=p_user_id for update;
 if not found then return jsonb_build_object('success',false,'error','CREDIT_ACCOUNT_NOT_FOUND'); end if;
 if v_credits<p_cost then return jsonb_build_object('success',false,'error','INSUFFICIENT_CREDITS','remaining_credits',v_credits); end if;
 select coalesce(max(pb.build_number),99)+1 into v_next from public.project_builds pb where pb.site_id=p_site_id;
 v_version:='v'||floor(v_next/100)::text||'.'||lpad((v_next%100)::text,2,'0');
 v_new:=v_credits-p_cost;
 update public.user_credits set credits_balance=v_new,updated_at=now() where user_id=p_user_id;
 insert into public.project_builds(site_id,user_id,version_tag,build_number,cost,status,git_provider,repository_owner,repository_name,branch,credit_reference_id)
 values(p_site_id,p_user_id,v_version,v_next,p_cost,'pending',nullif(lower(trim(p_git_provider)),''),nullif(trim(p_repository_owner),''),nullif(trim(p_repository_name),''),coalesce(nullif(trim(p_branch),''),'main'),p_reference_id)
 returning id into v_build_id;
 insert into public.credit_transactions(user_id,amount,type,reference_id,description,balance_after)
 values(p_user_id,-p_cost,'deployment','build:'||p_reference_id,'HASPAD deployment '||v_version,v_new);
 return jsonb_build_object('success',true,'idempotent',false,'build_id',v_build_id,'version',v_version,'build_number',v_next,'remaining_credits',v_new);
exception when unique_violation then
 select * into v_existing from public.project_builds where credit_reference_id=p_reference_id limit 1;
 if v_existing.id is not null then
   select credits_balance into v_credits from public.user_credits where user_id=p_user_id;
   return jsonb_build_object('success',true,'idempotent',true,'build_id',v_existing.id,'version',v_existing.version_tag,'build_number',v_existing.build_number,'remaining_credits',coalesce(v_credits,0));
 end if;
 raise;
end;
$$;

revoke all on function public.consume_credits_and_create_build_v2(uuid,uuid,integer,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.consume_credits_and_create_build_v2(uuid,uuid,integer,text,text,text,text,text) to service_role;
