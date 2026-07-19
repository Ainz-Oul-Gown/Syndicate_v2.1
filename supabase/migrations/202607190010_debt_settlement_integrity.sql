-- Stage 19: debt lifecycle and currency integrity.

alter table public.debts
  add column if not exists status text not null default 'active',
  add column if not exists created_by bigint,
  add column if not exists settlement_requested_at timestamptz,
  add column if not exists settled_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.debts
set created_by = debtor_id
where created_by is null;

alter table public.debts
  alter column created_by set not null;

alter table public.debts
  drop constraint if exists debts_status_chk;
alter table public.debts
  add constraint debts_status_chk
  check (status in ('active', 'payment_pending', 'settled', 'cancelled')) not valid;

alter table public.debts
  drop constraint if exists debts_created_by_party_chk;
alter table public.debts
  add constraint debts_created_by_party_chk
  check (created_by in (creditor_id, debtor_id)) not valid;

alter table public.debts
  drop constraint if exists debts_created_by_fkey;
alter table public.debts
  add constraint debts_created_by_fkey
  foreign key (created_by) references public.users(tg_id) on delete cascade not valid;

create index if not exists debts_parties_status_idx
  on public.debts(creditor_id, debtor_id, status, created_at desc);

-- Prevent duplicate custom currency names per owner when current data is clean.
do $$
begin
  if not exists (
    select 1 from public.currencies
    group by owner_id, lower(btrim(name))
    having count(*) > 1
  ) then
    create unique index if not exists currencies_owner_name_unique_idx
      on public.currencies(owner_id, lower(btrim(name)));
  else
    raise notice 'Skipped currencies_owner_name_unique_idx: duplicate names must be resolved first';
  end if;
end $$;

-- Browser writes are routed through RPCs so state transitions are atomic.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='debts'
  loop execute format('drop policy if exists %I on public.debts', p.policyname); end loop;
end $$;

create policy debts_read_participant on public.debts for select to authenticated
  using (public.current_tg_id() in (creditor_id, debtor_id));

create or replace function public.create_debt(
  target_creditor bigint,
  debt_amount numeric,
  debt_currency text
)
returns public.debts
language plpgsql
security definer
set search_path = public
as $$
declare
  me bigint := public.current_tg_id();
  result public.debts;
begin
  if me is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if target_creditor is null or target_creditor = me then
    raise exception 'invalid_creditor' using errcode='22023';
  end if;
  if debt_amount is null or debt_amount <= 0 then
    raise exception 'invalid_amount' using errcode='22023';
  end if;
  debt_currency := btrim(debt_currency);
  if length(debt_currency) < 1 or length(debt_currency) > 32 then
    raise exception 'invalid_currency' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.friendships f
    where f.status='accepted' and (
      (f.requester_id=me and f.addressee_id=target_creditor) or
      (f.addressee_id=me and f.requester_id=target_creditor)
    )
  ) then
    raise exception 'friendship_required' using errcode='42501';
  end if;

  insert into public.debts(
    creditor_id, debtor_id, amount, currency, status, created_by, updated_at
  ) values (
    target_creditor, me, round(debt_amount, 2), debt_currency, 'active', me, now()
  ) returning * into result;

  return result;
end;
$$;

create or replace function public.request_debt_settlement(debt_id uuid)
returns public.debts
language plpgsql
security definer
set search_path = public
as $$
declare
  me bigint := public.current_tg_id();
  result public.debts;
begin
  if me is null then raise exception 'unauthorized' using errcode='42501'; end if;

  update public.debts
  set status='payment_pending', settlement_requested_at=now(), updated_at=now()
  where id=debt_id and debtor_id=me and status='active'
  returning * into result;

  if result.id is null then raise exception 'debt_not_active_or_not_debtor' using errcode='42501'; end if;
  return result;
end;
$$;

create or replace function public.respond_debt_settlement(debt_id uuid, accept_payment boolean)
returns public.debts
language plpgsql
security definer
set search_path = public
as $$
declare
  me bigint := public.current_tg_id();
  result public.debts;
begin
  if me is null then raise exception 'unauthorized' using errcode='42501'; end if;

  if accept_payment then
    update public.debts
    set status='settled', settled_at=now(), updated_at=now()
    where id=debt_id and creditor_id=me and status='payment_pending'
    returning * into result;
  else
    update public.debts
    set status='active', settlement_requested_at=null, updated_at=now()
    where id=debt_id and creditor_id=me and status='payment_pending'
    returning * into result;
  end if;

  if result.id is null then raise exception 'debt_not_pending_or_not_creditor' using errcode='42501'; end if;
  return result;
end;
$$;

create or replace function public.forgive_debt(debt_id uuid)
returns public.debts
language plpgsql
security definer
set search_path = public
as $$
declare
  me bigint := public.current_tg_id();
  result public.debts;
begin
  if me is null then raise exception 'unauthorized' using errcode='42501'; end if;

  update public.debts
  set status='settled', settled_at=now(), updated_at=now()
  where id=debt_id and creditor_id=me and status in ('active','payment_pending')
  returning * into result;

  if result.id is null then raise exception 'debt_not_open_or_not_creditor' using errcode='42501'; end if;
  return result;
end;
$$;

create or replace function public.cancel_debt(debt_id uuid)
returns public.debts
language plpgsql
security definer
set search_path = public
as $$
declare
  me bigint := public.current_tg_id();
  result public.debts;
begin
  if me is null then raise exception 'unauthorized' using errcode='42501'; end if;

  update public.debts
  set status='cancelled', updated_at=now()
  where id=debt_id and created_by=me and status='active'
  returning * into result;

  if result.id is null then raise exception 'debt_not_cancellable' using errcode='42501'; end if;
  return result;
end;
$$;

revoke all on function public.create_debt(bigint, numeric, text) from public;
revoke all on function public.request_debt_settlement(uuid) from public;
revoke all on function public.respond_debt_settlement(uuid, boolean) from public;
revoke all on function public.forgive_debt(uuid) from public;
revoke all on function public.cancel_debt(uuid) from public;
grant execute on function public.create_debt(bigint, numeric, text) to authenticated;
grant execute on function public.request_debt_settlement(uuid) to authenticated;
grant execute on function public.respond_debt_settlement(uuid, boolean) to authenticated;
grant execute on function public.forgive_debt(uuid) to authenticated;
grant execute on function public.cancel_debt(uuid) to authenticated;
