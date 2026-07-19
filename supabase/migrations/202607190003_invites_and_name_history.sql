begin;

create table if not exists public.registration_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id bigint not null references public.users(tg_id) on update cascade on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by bigint references public.users(tg_id) on update cascade on delete set null,
  constraint registration_invites_code_format check (code ~ '^SYND-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  constraint registration_invites_code_key unique (code),
  constraint registration_invites_consumption_pair check (
    consumed_at is not null or consumed_by is null
  )
);

create unique index if not exists registration_invites_owner_active_code_idx
  on public.registration_invites(owner_id, code) where consumed_at is null;
create index if not exists registration_invites_owner_created_idx
  on public.registration_invites(owner_id, created_at desc);

create table if not exists public.user_name_history (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.users(tg_id) on update cascade on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  changed_at timestamptz not null default now()
);
create index if not exists user_name_history_user_changed_idx
  on public.user_name_history(user_id, changed_at desc);

-- Migrate legacy JSON stored in users.status. Invalid JSON is ignored safely.
do $$
declare r record; payload jsonb; invite text; item jsonb;
begin
  for r in select tg_id, status from public.users loop
    begin payload := coalesce(r.status, '{}')::jsonb; exception when others then payload := '{}'::jsonb; end;
    if jsonb_typeof(payload->'invites') = 'array' then
      for invite in select jsonb_array_elements_text(payload->'invites') loop
        if invite ~ '^SYND-[A-Z0-9]{4}-[A-Z0-9]{4}$' then
          insert into public.registration_invites(owner_id, code)
          values (r.tg_id, invite) on conflict (code) do nothing;
        end if;
      end loop;
    end if;
    if jsonb_typeof(payload->'names_history') = 'array' then
      for item in select * from jsonb_array_elements(payload->'names_history') loop
        if nullif(btrim(item->>'name'),'') is not null then
          insert into public.user_name_history(user_id, name, changed_at)
          values (r.tg_id, left(btrim(item->>'name'),120),
            case when (item->>'changed_at') ~ '^[0-9]+$'
              then to_timestamp((item->>'changed_at')::numeric / 1000.0)
              else now() end);
        end if;
      end loop;
    end if;
  end loop;
end $$;

-- status becomes an account tier/state again, not a generic JSON container.
update public.users set status = 'free'
where status is null or status like '{%';
alter table public.users alter column status set default 'free';
alter table public.users add constraint users_status_allowed
  check (status in ('free','premium','blocked')) not valid;

alter table public.registration_invites enable row level security;
alter table public.user_name_history enable row level security;

revoke all on public.registration_invites from anon;
revoke all on public.user_name_history from anon;
grant select, insert, delete on public.registration_invites to authenticated;
grant select, insert on public.user_name_history to authenticated;

create policy registration_invites_select_own on public.registration_invites
  for select to authenticated using (owner_id = public.current_tg_id());
create policy registration_invites_insert_own on public.registration_invites
  for insert to authenticated with check (
    owner_id = public.current_tg_id() and consumed_at is null and consumed_by is null and
    (select count(*) from public.registration_invites i where i.owner_id = public.current_tg_id() and i.consumed_at is null) < 3
  );
create policy registration_invites_delete_own_unused on public.registration_invites
  for delete to authenticated using (owner_id = public.current_tg_id() and consumed_at is null);

create policy user_name_history_select_visible on public.user_name_history
  for select to authenticated using (
    user_id = public.current_tg_id() or exists (
      select 1 from public.friendships f
      where f.status='accepted' and
        ((f.requester_id=public.current_tg_id() and f.addressee_id=user_name_history.user_id) or
         (f.addressee_id=public.current_tg_id() and f.requester_id=user_name_history.user_id))
    )
  );
create policy user_name_history_insert_self on public.user_name_history
  for insert to authenticated with check (user_id = public.current_tg_id());

comment on table public.registration_invites is 'One-time registration invites. Codes are visible only to their owner and consumed only by server functions.';
comment on table public.user_name_history is 'Previous display names separated from users.status.';
commit;
