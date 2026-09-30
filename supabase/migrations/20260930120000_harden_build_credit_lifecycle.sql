-- Atomic deployment credit lifecycle hardening.
-- The same SQL has been applied to the HASPAD Supabase project.
create unique index if not exists project_builds_active_repo_unique
on public.project_builds (
  site_id,
  coalesce(git_provider, ''),
  coalesce(repository_owner, ''),
  coalesce(repository_name, ''),
  coalesce(branch, 'main')
)
where status in ('pending','building');

-- The production RPC is intentionally kept in the database migration history.
-- It serializes builds per site, detects an active identical deployment before debit,
-- and uses the partial unique index as a second race-condition guard.
create or replace function public.consume_credits_and_create_build_v2(
  p_user_id uuid,p_site_id uuid,p_cost integer,p_reference_id text,
  p_git_provider text default null,p_repository_owner text default null,
  p_repository_name text default null,p_branch text default 'main'
) returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_site_user uuid; v_credits integer; v_next integer; v_version text;
  v_build_id uuid; v_existing public.project_builds; v_new integer;
  v_provider text := nullif(lower(trim(p_git_provider)), '');
  v_owner text := nullif(trim(p_repository_owner), '');
  v_name text := nullif(trim(p_repository_name), '');
  v_branch text := coalesce(nullif(trim(p_branch), ''), 'main');
begin
  if p_user_id is null or p_site_id is null or p_reference_id is null or length(trim(p_reference_id)) < 8 then
    return jsonb_build_object('success',false,'error','INVALID_ARGUMENTS');
  end if;
  if p_cost is null or p_cost <= 0 then
    return jsonb_build_object('success',false,'error','INVALID_COST');
  end if;
  select * into v_existing from public.project_builds where credit_reference_id=p_reference_id for update;
  if found then
    select credits_balance into v_credits from public.user_credits where user_id=p_user_id;
    return jsonb_build_object('success',true,'idempotent',true,'reused',true,'build_id',v_existing.id,'version',v_existing.version_tag,'build_number',v_existing.build_number,'status',v_existing.status,'remaining_credits',coalesce(v_credits,0));
  end if;
  select s.user_id into v_site_user from public.sites s where s.id=p_site_id for update;
  if v_site_user is null then return jsonb_build_object('success',false,'error','SITE_NOT_FOUND'); end if;
  if v_site_user<>p_user_id then return jsonb_build_object('success',false,'error','FORBIDDEN'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_site_id::text,0));
  select * into v_existing from public.project_builds
  where site_id=p_site_id and status in ('pending','building')
    and coalesce(git_provider,'')=coalesce(v_provider,'')
    and coalesce(repository_owner,'')=coalesce(v_owner,'')
    and coalesce(repository_name,'')=coalesce(v_name,'')
    and coalesce(branch,'main')=v_branch
  order by build_number desc limit 1 for update;
  if found then
    select credits_balance into v_credits from public.user_credits where user_id=p_user_id;
    return jsonb_build_object('success',true,'idempotent',true,'reused',true,'build_id',v_existing.id,'version',v_existing.version_tag,'build_number',v_existing.build_number,'status',v_existing.status,'remaining_credits',coalesce(v_credits,0));
  end if;
  select credits_balance into v_credits from public.user_credits where user_id=p_user_id for update;
  if not found then return jsonb_build_object('success',false,'error','CREDIT_ACCOUNT_NOT_FOUND'); end if;
  if v_credits<p_cost then return jsonb_build_object('success',false,'error','INSUFFICIENT_CREDITS','remaining_credits',v_credits); end if;
  select coalesce(max(pb.build_number),99)+1 into v_next from public.project_builds pb where pb.site_id=p_site_id;
  v_version:='v'||floor(v_next/100)::text||'.'||lpad((v_next%100)::text,2,'0');
  v_new:=v_credits-p_cost;
  update public.user_credits set credits_balance=v_new,updated_at=now() where user_id=p_user_id;
  insert into public.project_builds(site_id,user_id,version_tag,build_number,cost,status,git_provider,repository_owner,repository_name,branch,credit_reference_id)
  values(p_site_id,p_user_id,v_version,v_next,p_cost,'pending',v_provider,v_owner,v_name,v_branch,p_reference_id)
  returning id into v_build_id;
  insert into public.credit_transactions(user_id,amount,type,reference_id,description,balance_after)
  values(p_user_id,-p_cost,'deployment','build:'||p_reference_id,'HASPAD deployment '||v_version,v_new);
  return jsonb_build_object('success',true,'idempotent',false,'reused',false,'build_id',v_build_id,'version',v_version,'build_number',v_next,'status','pending','remaining_credits',v_new);
exception when unique_violation then
  select * into v_existing from public.project_builds
  where site_id=p_site_id and status in ('pending','building')
    and coalesce(git_provider,'')=coalesce(v_provider,'')
    and coalesce(repository_owner,'')=coalesce(v_owner,'')
    and coalesce(repository_name,'')=coalesce(v_name,'')
    and coalesce(branch,'main')=v_branch
  order by build_number desc limit 1;
  if v_existing.id is not null then
    select credits_balance into v_credits from public.user_credits where user_id=p_user_id;
    return jsonb_build_object('success',true,'idempotent',true,'reused',true,'build_id',v_existing.id,'version',v_existing.version_tag,'build_number',v_existing.build_number,'status',v_existing.status,'remaining_credits',coalesce(v_credits,0));
  end if;
  raise;
end;
$function$;

revoke execute on function public.consume_credits_and_create_build_v2(uuid,uuid,integer,text,text,text,text,text) from public, anon;
grant execute on function public.consume_credits_and_create_build_v2(uuid,uuid,integer,text,text,text,text,text) to service_role;
revoke execute on function public.fail_build_and_refund(uuid,text) from public, anon;
grant execute on function public.fail_build_and_refund(uuid,text) to service_role;
