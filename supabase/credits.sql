-- HASPAD credits and CinetPay billing. Production-safe, atomic and idempotent.
create table if not exists public.user_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits_balance integer not null default 500 check (credits_balance >= 0),
  updated_at timestamptz not null default now()
);
create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  type text not null check (type in ('signup','deployment','redeployment','purchase','refund','adjustment')),
  reference_id text not null,
  description text,
  balance_after integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, reference_id)
);
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_name text not null check (plan_name in ('startup','pro','business')),
  status text not null default 'pending' check (status in ('pending','active','failed','cancelled')),
  provider text not null default 'cinetpay',
  provider_transaction_id text unique,
  credits_granted integer not null default 0,
  amount_xof integer,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id text not null unique,
  provider text not null default 'cinetpay',
  plan_type text not null check (plan_type in ('startup','pro','business')),
  amount_xof integer not null,
  credits integer not null,
  status text not null default 'pending' check (status in ('pending','accepted','refused','expired','error')),
  payment_url text,
  provider_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.user_credits enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payment_transactions enable row level security;

drop policy if exists user_credits_select_self on public.user_credits;
create policy user_credits_select_self on public.user_credits for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists credit_transactions_select_self on public.credit_transactions;
create policy credit_transactions_select_self on public.credit_transactions for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists subscriptions_select_self on public.subscriptions;
create policy subscriptions_select_self on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists payment_transactions_select_self on public.payment_transactions;
create policy payment_transactions_select_self on public.payment_transactions for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.handle_new_user_credits()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.user_credits(user_id,credits_balance) values(new.id,500)
  on conflict(user_id) do nothing;
  insert into public.credit_transactions(user_id,amount,type,reference_id,description,balance_after)
  values(new.id,500,'signup','signup:'||new.id::text,'500 crédits offerts à l inscription',500)
  on conflict(user_id,reference_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_credits on auth.users;
create trigger on_auth_user_created_credits after insert on auth.users for each row execute function public.handle_new_user_credits();

create or replace function public.debit_user_credits(
  p_user_id uuid,p_cost integer,p_type text,p_reference_id text,p_description text
) returns integer language plpgsql security definer set search_path = ''
as $$
declare v_balance integer; v_new_balance integer; v_existing integer;
begin
  if p_cost <= 0 then raise exception 'INVALID_CREDIT_COST'; end if;
  if p_type not in ('deployment','redeployment') then raise exception 'INVALID_CREDIT_TYPE'; end if;
  if p_reference_id is null or length(p_reference_id)=0 then raise exception 'REFERENCE_REQUIRED'; end if;

  select balance_after into v_existing from public.credit_transactions
  where user_id=p_user_id and reference_id=p_reference_id and amount=-p_cost limit 1;
  if v_existing is not null then return v_existing; end if;

  select credits_balance into v_balance from public.user_credits where user_id=p_user_id for update;
  if v_balance is null then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if v_balance < p_cost then raise exception 'INSUFFICIENT_CREDITS'; end if;

  v_new_balance:=v_balance-p_cost;
  update public.user_credits set credits_balance=v_new_balance,updated_at=now() where user_id=p_user_id;
  insert into public.credit_transactions(user_id,amount,type,reference_id,description,balance_after)
  values(p_user_id,-p_cost,p_type,p_reference_id,p_description,v_new_balance)
  on conflict(user_id,reference_id) do nothing;
  return v_new_balance;
end;
$$;

create or replace function public.refund_user_credits(
  p_user_id uuid,p_amount integer,p_reference_id text,p_description text
) returns integer language plpgsql security definer set search_path = ''
as $$
declare v_balance integer; v_new_balance integer; v_existing integer;
begin
  if p_amount <= 0 then raise exception 'INVALID_REFUND_AMOUNT'; end if;
  select balance_after into v_existing from public.credit_transactions
  where user_id=p_user_id and reference_id=p_reference_id and type='refund' limit 1;
  if v_existing is not null then return v_existing; end if;
  select credits_balance into v_balance from public.user_credits where user_id=p_user_id for update;
  if v_balance is null then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  v_new_balance:=v_balance+p_amount;
  update public.user_credits set credits_balance=v_new_balance,updated_at=now() where user_id=p_user_id;
  insert into public.credit_transactions(user_id,amount,type,reference_id,description,balance_after)
  values(p_user_id,p_amount,'refund',p_reference_id,p_description,v_new_balance)
  on conflict(user_id,reference_id) do nothing;
  return v_new_balance;
end;
$$;

create or replace function public.apply_payment_credits(p_payment_id uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_payment public.payment_transactions; v_balance integer; v_new_balance integer;
begin
  select * into v_payment from public.payment_transactions where id=p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_payment.status <> 'accepted' then raise exception 'PAYMENT_NOT_ACCEPTED'; end if;

  select credits_balance into v_balance from public.user_credits where user_id=v_payment.user_id for update;
  if v_balance is null then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if v_payment.processed_at is not null then return v_balance; end if;

  v_new_balance:=v_balance+v_payment.credits;
  update public.user_credits set credits_balance=v_new_balance,updated_at=now() where user_id=v_payment.user_id;
  insert into public.credit_transactions(user_id,amount,type,reference_id,description,balance_after)
  values(v_payment.user_id,v_payment.credits,'purchase','payment:'||v_payment.transaction_id,'Recharge HASPAD '||v_payment.plan_type,v_new_balance)
  on conflict(user_id,reference_id) do nothing;
  update public.payment_transactions set processed_at=now(),updated_at=now() where id=p_payment_id and processed_at is null;
  insert into public.subscriptions(user_id,plan_name,status,provider,provider_transaction_id,credits_granted,amount_xof,current_period_start,current_period_end)
  values(v_payment.user_id,v_payment.plan_type,'active',v_payment.provider,v_payment.transaction_id,v_payment.credits,v_payment.amount_xof,now(),now()+interval '30 days')
  on conflict(provider_transaction_id) do update set status='active',credits_granted=excluded.credits_granted,amount_xof=excluded.amount_xof,current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,updated_at=now();
  return v_new_balance;
end;
$$;

revoke all on function public.handle_new_user_credits() from public,anon,authenticated;
revoke all on function public.debit_user_credits(uuid,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.refund_user_credits(uuid,integer,text,text) from public,anon,authenticated;
revoke all on function public.apply_payment_credits(uuid) from public,anon,authenticated;
grant execute on function public.debit_user_credits(uuid,integer,text,text,text) to service_role;
grant execute on function public.refund_user_credits(uuid,integer,text,text) to service_role;
grant execute on function public.apply_payment_credits(uuid) to service_role;
