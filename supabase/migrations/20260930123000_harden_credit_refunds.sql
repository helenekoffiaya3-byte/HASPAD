-- Credit refund hardening: one refund transaction per build.
create or replace function public.fail_build_and_refund(p_build_id uuid, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_build public.project_builds;
  v_balance integer;
  v_new integer;
  v_ref text;
begin
  select * into v_build from public.project_builds where id=p_build_id for update;
  if not found then return jsonb_build_object('success',false,'error','BUILD_NOT_FOUND'); end if;
  if v_build.status='success' then return jsonb_build_object('success',false,'error','BUILD_ALREADY_SUCCEEDED'); end if;
  if v_build.refunded_at is not null then
    select credits_balance into v_balance from public.user_credits where user_id=v_build.user_id;
    return jsonb_build_object('success',true,'already_refunded',true,'remaining_credits',coalesce(v_balance,0));
  end if;
  if coalesce(v_build.cost,0)<=0 then
    update public.project_builds set status='failed',error_message=left(coalesce(p_error,'BUILD_FAILED'),1000),refunded_at=now(),updated_at=now() where id=p_build_id;
    return jsonb_build_object('success',true,'refunded_credits',0);
  end if;
  select credits_balance into v_balance from public.user_credits where user_id=v_build.user_id for update;
  if not found then return jsonb_build_object('success',false,'error','CREDIT_ACCOUNT_NOT_FOUND'); end if;
  v_new:=v_balance+v_build.cost;
  update public.user_credits set credits_balance=v_new,updated_at=now() where user_id=v_build.user_id;
  v_ref:='refund:build:'||v_build.id::text;
  insert into public.credit_transactions(user_id,amount,type,reference_id,description,balance_after)
  values(v_build.user_id,v_build.cost,'deployment_refund',v_ref,'HASPAD deployment refund '||coalesce(v_build.version_tag,v_build.id::text),v_new)
  on conflict (reference_id) do nothing;
  update public.project_builds set status='failed',error_message=left(coalesce(p_error,'BUILD_FAILED'),1000),refunded_at=now(),updated_at=now() where id=p_build_id;
  return jsonb_build_object('success',true,'refunded_credits',v_build.cost,'remaining_credits',v_new);
end;
$function$;

revoke execute on function public.fail_build_and_refund(uuid,text) from public, anon, authenticated;
grant execute on function public.fail_build_and_refund(uuid,text) to service_role;
