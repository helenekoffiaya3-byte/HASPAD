-- Reconciles the live Supabase schema with the atomic HASPAD build/deployment contract.
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

create index if not exists project_builds_netlify_deploy_idx on public.project_builds(netlify_deploy_id);

alter table public.project_builds drop constraint if exists project_builds_cost_check;
alter table public.project_builds add constraint project_builds_cost_check check (cost is null or cost > 0);

alter table public.project_builds drop constraint if exists project_builds_status_check;
alter table public.project_builds add constraint project_builds_status_check check (status in ('pending','building','success','failed'));

create or replace function public.consume_credits_and_create_build(p_user_id uuid,p_site_id uuid,p_cost integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_site_user uuid; v_credits integer; v_next integer; v_version text; v_build_id uuid;
begin
 if p_user_id is null or p_site_id is null then return jsonb_build_object('success',false,'error','INVALID_ARGUMENTS'); end if;
 if p_cost is null or p_cost<=0 then return jsonb_build_object('success',false,'error','INVALID_COST'); end if;
 select s.user_id into v_site_user from public.sites s where s.id=p_site_id for update;
 if v_site_user is null then return jsonb_build_object('success',false,'error','SITE_NOT_FOUND'); end if;
 if v_site_user<>p_user_id then return jsonb_build_object('success',false,'error','FORBIDDEN'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_site_id::text,0));
 select uc.credits_balance into v_credits from public.user_credits uc where uc.user_id=p_user_id for update;
 if not found then return jsonb_build_object('success',false,'error','CREDIT_ACCOUNT_NOT_FOUND'); end if;
 if v_credits<p_cost then return jsonb_build_object('success',false,'error','INSUFFICIENT_CREDITS','remaining_credits',v_credits); end if;
 select coalesce(max(pb.build_number),99)+1 into v_next from public.project_builds pb where pb.site_id=p_site_id;
 v_version:='v'||floor(v_next/100)::text||'.'||lpad((v_next%100)::text,2,'0');
 update public.user_credits set credits_balance=credits_balance-p_cost,updated_at=now() where user_id=p_user_id;
 insert into public.project_builds(site_id,user_id,version_tag,build_number,cost,status) values(p_site_id,p_user_id,v_version,v_next,p_cost,'pending') returning id into v_build_id;
 return jsonb_build_object('success',true,'build_id',v_build_id,'version',v_version,'build_number',v_next,'remaining_credits',v_credits-p_cost);
end; $$;
revoke all on function public.consume_credits_and_create_build(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.consume_credits_and_create_build(uuid,uuid,integer) to service_role;

create or replace function public.fail_build_and_refund(p_build_id uuid,p_error text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_build public.project_builds; v_balance integer;
begin
 select * into v_build from public.project_builds where id=p_build_id for update;
 if not found then return jsonb_build_object('success',false,'error','BUILD_NOT_FOUND'); end if;
 if v_build.status='success' then return jsonb_build_object('success',false,'error','BUILD_ALREADY_SUCCEEDED'); end if;
 if v_build.refunded_at is not null then return jsonb_build_object('success',true,'already_refunded',true); end if;
 select credits_balance into v_balance from public.user_credits where user_id=v_build.user_id for update;
 if not found then return jsonb_build_object('success',false,'error','CREDIT_ACCOUNT_NOT_FOUND'); end if;
 update public.user_credits set credits_balance=credits_balance+coalesce(v_build.cost,0),updated_at=now() where user_id=v_build.user_id;
 update public.project_builds set status='failed',error_message=left(coalesce(p_error,'BUILD_FAILED'),1000),refunded_at=now(),updated_at=now() where id=p_build_id;
 return jsonb_build_object('success',true,'refunded_credits',coalesce(v_build.cost,0),'remaining_credits',v_balance+coalesce(v_build.cost,0));
end; $$;
revoke all on function public.fail_build_and_refund(uuid,text) from public,anon,authenticated;
grant execute on function public.fail_build_and_refund(uuid,text) to service_role;