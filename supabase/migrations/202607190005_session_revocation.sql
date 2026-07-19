begin;

alter table public.users
  add column if not exists session_version integer not null default 1;

alter table public.users
  drop constraint if exists users_session_version_positive;
alter table public.users
  add constraint users_session_version_positive check (session_version > 0) not valid;

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
    and coalesce(u.status, 'free') <> 'blocked'
  limit 1
$$;

revoke all on function public.current_tg_id() from public;
grant execute on function public.current_tg_id() to authenticated;

commit;
