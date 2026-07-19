-- Stage 20: protect privileged user fields and make profile/account mutations atomic.

begin;

alter table public.users
  add column if not exists account_state text not null default 'active',
  add column if not exists deactivated_at timestamptz,
  add column if not exists profile_name_changed_at timestamptz;

-- Preserve the legacy blocked state while separating account state from plan/tier.
update public.users
set account_state = 'blocked'
where status = 'blocked' and account_state = 'active';

alter table public.users
  drop constraint if exists users_account_state_chk;
alter table public.users
  add constraint users_account_state_chk
  check (account_state in ('active', 'deactivated', 'blocked', 'deleted')) not valid;

create index if not exists users_account_state_idx
  on public.users(account_state, tg_id);

update public.users u
set profile_name_changed_at = history.last_changed
from (
  select user_id, max(changed_at) as last_changed
  from public.user_name_history
  group by user_id
) history
where history.user_id = u.tg_id
  and u.profile_name_changed_at is null;

-- A valid browser identity exists only while the account is active and the
-- session version matches the signed JWT. This invalidates all RLS access
-- immediately after deactivation or administrative blocking.
create or replace function public.current_tg_id()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select u.tg_id
  from public.users u
  where u.tg_id = nullif(auth.jwt() ->> 'tg_id', '')::bigint
    and u.session_version = coalesce(nullif(auth.jwt() ->> 'session_version', '')::integer, 0)
    and u.account_state = 'active'
    and coalesce(u.status, 'free') <> 'blocked'
  limit 1
$$;

revoke all on function public.current_tg_id() from public;
grant execute on function public.current_tg_id() to authenticated;

-- The former own-row UPDATE policy allowed a browser to modify status,
-- session_version and other privileged columns. All writes now go through
-- narrow SECURITY DEFINER functions below or trusted Edge Functions.
drop policy if exists users_update_self on public.users;
revoke update on table public.users from authenticated;

-- Hide deactivated/blocked/deleted profiles from normal discovery.
drop policy if exists users_authenticated_read on public.users;
create policy users_authenticated_read_active on public.users
  for select to authenticated
  using (account_state = 'active' and coalesce(status, 'free') <> 'blocked');

create or replace function public.rename_my_profile(new_name text)
returns table(first_name text, profile_name_changed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  me bigint := public.current_tg_id();
  old_name text;
  last_changed timestamptz;
begin
  if me is null then raise exception 'unauthorized' using errcode='42501'; end if;
  new_name := btrim(new_name);
  if char_length(new_name) < 2 or char_length(new_name) > 120 then
    raise exception 'invalid_name' using errcode='22023';
  end if;

  select u.first_name, u.profile_name_changed_at
    into old_name, last_changed
  from public.users u
  where u.tg_id = me
  for update;

  if old_name is null then raise exception 'user_not_found' using errcode='P0002'; end if;
  if old_name = new_name then
    return query select old_name, last_changed;
    return;
  end if;
  if last_changed is not null and last_changed > now() - interval '7 days' then
    raise exception 'name_change_cooldown:%', extract(epoch from (last_changed + interval '7 days' - now()))::bigint
      using errcode='P0001';
  end if;

  insert into public.user_name_history(user_id, name, changed_at)
  values(me, old_name, now());

  update public.users
  set first_name = new_name, profile_name_changed_at = now()
  where tg_id = me;

  return query
    select u.first_name, u.profile_name_changed_at
    from public.users u where u.tg_id = me;
end;
$$;

-- Legacy profiles without any key container may initialize it once. Existing
-- key containers remain mutable only through signed server-side flows.
create or replace function public.initialize_my_public_key(new_public_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me bigint := public.current_tg_id();
  parsed jsonb;
begin
  if me is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if new_public_key is null or octet_length(new_public_key) > 250000 then
    raise exception 'invalid_public_key_size' using errcode='22023';
  end if;
  begin parsed := new_public_key::jsonb;
  exception when others then raise exception 'invalid_public_key_json' using errcode='22023';
  end;
  if jsonb_typeof(parsed) <> 'object' then
    raise exception 'invalid_public_key_container' using errcode='22023';
  end if;

  update public.users
  set public_key = new_public_key
  where tg_id = me
    and (public_key is null or btrim(public_key) in ('', '{}'));

  if not found then
    raise exception 'public_key_already_initialized' using errcode='42501';
  end if;
  return true;
end;
$$;

create or replace function public.create_registration_invite()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me bigint := public.current_tg_id();
  generated text;
  attempt integer := 0;
begin
  if me is null then raise exception 'unauthorized' using errcode='42501'; end if;

  -- Serialize invite creation for one owner so concurrent tabs cannot exceed 3.
  perform pg_advisory_xact_lock(me);
  if (select count(*) from public.registration_invites where owner_id=me and consumed_at is null) >= 3 then
    raise exception 'invite_limit_reached' using errcode='23514';
  end if;

  loop
    attempt := attempt + 1;
    generated := 'SYND-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 4)) || '-' ||
                 upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 4));
    begin
      insert into public.registration_invites(owner_id, code) values(me, generated);
      return generated;
    exception when unique_violation then
      if attempt >= 8 then raise exception 'invite_generation_failed'; end if;
    end;
  end loop;
end;
$$;

create or replace function public.revoke_registration_invite(invite_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare me bigint := public.current_tg_id();
begin
  if me is null then raise exception 'unauthorized' using errcode='42501'; end if;
  delete from public.registration_invites
  where owner_id=me and code=upper(btrim(invite_code)) and consumed_at is null;
  if not found then raise exception 'invite_not_found' using errcode='P0002'; end if;
  return true;
end;
$$;

-- Reversible account deactivation. Historical encrypted messages and chat
-- membership remain intact; active sessions/devices/invites are revoked.
create or replace function public.deactivate_my_account()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare me bigint := public.current_tg_id();
begin
  if me is null then raise exception 'unauthorized' using errcode='42501'; end if;

  update public.users
  set account_state='deactivated', deactivated_at=now(), session_version=session_version+1
  where tg_id=me and account_state='active';
  if not found then raise exception 'account_not_active' using errcode='P0002'; end if;

  delete from public.user_devices where user_id=me;
  delete from public.device_requests where user_id=me;
  delete from public.registration_invites where owner_id=me and consumed_at is null;
  delete from public.auth_challenges where id in ('seed_' || me::text, 'auth_' || me::text);
  return true;
end;
$$;

-- Browser invite/name writes are now RPC-only.
revoke insert, delete on table public.registration_invites from authenticated;
revoke insert on table public.user_name_history from authenticated;
drop policy if exists registration_invites_insert_own on public.registration_invites;
drop policy if exists registration_invites_delete_own_unused on public.registration_invites;
drop policy if exists user_name_history_insert_self on public.user_name_history;

revoke all on function public.rename_my_profile(text) from public;
revoke all on function public.initialize_my_public_key(text) from public;
revoke all on function public.create_registration_invite() from public;
revoke all on function public.revoke_registration_invite(text) from public;
revoke all on function public.deactivate_my_account() from public;
grant execute on function public.rename_my_profile(text) to authenticated;
grant execute on function public.initialize_my_public_key(text) to authenticated;
grant execute on function public.create_registration_invite() to authenticated;
grant execute on function public.revoke_registration_invite(text) to authenticated;
grant execute on function public.deactivate_my_account() to authenticated;

commit;
