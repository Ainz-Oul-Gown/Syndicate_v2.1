-- Syndicate: data integrity, indexes and browser-access RLS.
-- Designed to preserve existing rows. Foreign keys/checks are added NOT VALID
-- and validated automatically only when current data already satisfies them.

begin;

create or replace function public.current_tg_id()
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select nullif(auth.jwt() ->> 'tg_id', '')::bigint
$$;

revoke all on function public.current_tg_id() from public;
grant execute on function public.current_tg_id() to authenticated;

create or replace function public.is_chat_member(target_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_keys
    where chat_id = target_chat_id and user_id = public.current_tg_id()
  )
$$;

revoke all on function public.is_chat_member(uuid) from public;
grant execute on function public.is_chat_member(uuid) to authenticated;

-- Legacy bearer material is not used by the application anymore and must not
-- remain readable from the browser through public.users.
update public.users set auth_token = null where auth_token is not null;

-- Basic checks. NOT VALID keeps the migration deployable with legacy data.
alter table public.users
  add constraint users_tg_id_positive_chk check (tg_id > 0) not valid;
alter table public.debts
  add constraint debts_amount_positive_chk check (amount > 0) not valid,
  add constraint debts_parties_distinct_chk check (creditor_id <> debtor_id) not valid,
  add constraint debts_currency_nonempty_chk check (length(btrim(currency)) between 1 and 32) not valid;
alter table public.currencies
  add constraint currencies_rub_value_positive_chk check (rub_value > 0) not valid,
  add constraint currencies_name_nonempty_chk check (length(btrim(name)) between 1 and 64) not valid;
alter table public.chats
  add constraint chats_type_chk check (type in ('private', 'group', 'saved')) not valid,
  add constraint chats_name_nonempty_chk check (length(btrim(name)) between 1 and 120) not valid;
alter table public.messages
  add constraint messages_chat_required_chk check (chat_id is not null) not valid,
  add constraint messages_sender_required_chk check (sender_id is not null) not valid;
alter table public.chat_keys
  add constraint chat_keys_chat_required_chk check (chat_id is not null) not valid,
  add constraint chat_keys_user_required_chk check (user_id is not null) not valid;

-- Missing ownership relations. NOT VALID prevents orphaned legacy rows from
-- blocking deploy; new writes are still checked immediately.
alter table public.debts
  add constraint debts_creditor_id_fkey foreign key (creditor_id) references public.users(tg_id) on delete cascade not valid,
  add constraint debts_debtor_id_fkey foreign key (debtor_id) references public.users(tg_id) on delete cascade not valid;
alter table public.currencies
  add constraint currencies_owner_id_fkey foreign key (owner_id) references public.users(tg_id) on delete cascade not valid;
alter table public.device_requests
  add constraint device_requests_user_id_fkey foreign key (user_id) references public.users(tg_id) on delete cascade not valid;
alter table public.user_devices
  add constraint user_devices_user_id_fkey foreign key (user_id) references public.users(tg_id) on delete cascade not valid;

-- Query-path indexes.
create index if not exists friendships_requester_idx on public.friendships(requester_id, status);
create index if not exists friendships_addressee_idx on public.friendships(addressee_id, status);
create index if not exists chat_keys_user_idx on public.chat_keys(user_id, chat_id);
create index if not exists chat_keys_chat_idx on public.chat_keys(chat_id, user_id);
create index if not exists messages_chat_created_idx on public.messages(chat_id, created_at desc);
create index if not exists messages_sender_idx on public.messages(sender_id);
create index if not exists debts_creditor_debtor_idx on public.debts(creditor_id, debtor_id);
create index if not exists debts_debtor_creditor_idx on public.debts(debtor_id, creditor_id);
create index if not exists currencies_owner_idx on public.currencies(owner_id);
create index if not exists device_requests_user_status_idx on public.device_requests(user_id, status, created_at desc);
create index if not exists user_devices_user_active_idx on public.user_devices(user_id, last_active desc);

-- Add uniqueness only when legacy rows have no conflicts. Conflicts are reported
-- by STAGE_6_PREFLIGHT.sql and can be cleaned without losing unrelated data.
do $$
begin
  if not exists (
    select 1 from public.chat_keys group by chat_id, user_id having count(*) > 1
  ) then
    execute 'create unique index if not exists chat_keys_chat_user_uidx on public.chat_keys(chat_id, user_id)';
  end if;

  if not exists (
    select 1 from public.user_devices group by user_id, device_id having count(*) > 1
  ) then
    execute 'create unique index if not exists user_devices_user_device_uidx on public.user_devices(user_id, device_id)';
  end if;

  if not exists (
    select 1 from public.friendships
    group by least(requester_id, addressee_id), greatest(requester_id, addressee_id)
    having count(*) > 1
  ) then
    execute 'create unique index if not exists friendships_pair_uidx on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id))';
  end if;
end $$;

-- Remove all legacy browser policies before installing explicit policies.
alter table public.users enable row level security;
alter table public.friendships enable row level security;
alter table public.chats enable row level security;
alter table public.chat_keys enable row level security;
alter table public.messages enable row level security;
alter table public.debts enable row level security;
alter table public.currencies enable row level security;
alter table public.device_requests enable row level security;
alter table public.user_devices enable row level security;
alter table public.auth_challenges enable row level security;

-- auth_challenges and provider identities are server-only.
revoke all on table public.auth_challenges from anon, authenticated;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='auth_challenges'
  loop execute format('drop policy if exists %I on public.auth_challenges', p.policyname); end loop;
end $$;

-- Users: authenticated users can discover profiles and public keys. Own-row
-- updates only. auth_token has been nulled; invite storage is migrated next stage.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='users'
  loop execute format('drop policy if exists %I on public.users', p.policyname); end loop;
end $$;
create policy users_authenticated_read on public.users for select to authenticated using (true);
create policy users_update_self on public.users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and tg_id = public.current_tg_id());

-- Friend relationships.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='friendships'
  loop execute format('drop policy if exists %I on public.friendships', p.policyname); end loop;
end $$;
create policy friendships_read_participant on public.friendships for select to authenticated
  using (public.current_tg_id() in (requester_id, addressee_id));
create policy friendships_create_self on public.friendships for insert to authenticated
  with check (requester_id = public.current_tg_id() and requester_id <> addressee_id and status = 'pending');
create policy friendships_accept_addressee on public.friendships for update to authenticated
  using (addressee_id = public.current_tg_id() and status = 'pending')
  with check (addressee_id = public.current_tg_id() and status = 'accepted');
create policy friendships_delete_participant on public.friendships for delete to authenticated
  using (public.current_tg_id() in (requester_id, addressee_id));

-- Chat membership is represented by chat_keys.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='chats'
  loop execute format('drop policy if exists %I on public.chats', p.policyname); end loop;
end $$;
create policy chats_read_member on public.chats for select to authenticated using (
  public.is_chat_member(chats.id)
);
create policy chats_create_authenticated on public.chats for insert to authenticated with check (true);
create policy chats_update_member on public.chats for update to authenticated using (
  public.is_chat_member(chats.id)
) with check (
  public.is_chat_member(chats.id)
);
create policy chats_delete_member on public.chats for delete to authenticated using (
  public.is_chat_member(chats.id)
);

do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='chat_keys'
  loop execute format('drop policy if exists %I on public.chat_keys', p.policyname); end loop;
end $$;
create policy chat_keys_read_member on public.chat_keys for select to authenticated using (
  public.is_chat_member(chat_keys.chat_id)
);
create policy chat_keys_insert_member on public.chat_keys for insert to authenticated with check (
  user_id = public.current_tg_id()
  or public.is_chat_member(chat_keys.chat_id)
);
create policy chat_keys_update_owner on public.chat_keys for update to authenticated
  using (user_id = public.current_tg_id()) with check (user_id = public.current_tg_id());
create policy chat_keys_delete_member on public.chat_keys for delete to authenticated using (
  user_id = public.current_tg_id()
  or public.is_chat_member(chat_keys.chat_id)
);

do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='messages'
  loop execute format('drop policy if exists %I on public.messages', p.policyname); end loop;
end $$;
create policy messages_read_member on public.messages for select to authenticated using (
  public.is_chat_member(messages.chat_id)
);
create policy messages_create_member on public.messages for insert to authenticated with check (
  sender_id = public.current_tg_id()
  and public.is_chat_member(messages.chat_id)
);
create policy messages_update_sender on public.messages for update to authenticated
  using (sender_id = public.current_tg_id()) with check (sender_id = public.current_tg_id());
create policy messages_delete_sender on public.messages for delete to authenticated
  using (sender_id = public.current_tg_id());

-- Debts are private to their two parties.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='debts'
  loop execute format('drop policy if exists %I on public.debts', p.policyname); end loop;
end $$;
create policy debts_read_participant on public.debts for select to authenticated
  using (public.current_tg_id() in (creditor_id, debtor_id));
create policy debts_create_participant on public.debts for insert to authenticated
  with check (public.current_tg_id() in (creditor_id, debtor_id) and creditor_id <> debtor_id and amount > 0);
create policy debts_delete_participant on public.debts for delete to authenticated
  using (public.current_tg_id() in (creditor_id, debtor_id));

-- Currency definitions are readable by signed-in users for debt conversion, but
-- only the owner can mutate them.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='currencies'
  loop execute format('drop policy if exists %I on public.currencies', p.policyname); end loop;
end $$;
create policy currencies_read_authenticated on public.currencies for select to authenticated using (true);
create policy currencies_create_owner on public.currencies for insert to authenticated
  with check (owner_id = public.current_tg_id() and rub_value > 0);
create policy currencies_update_owner on public.currencies for update to authenticated
  using (owner_id = public.current_tg_id()) with check (owner_id = public.current_tg_id() and rub_value > 0);
create policy currencies_delete_owner on public.currencies for delete to authenticated
  using (owner_id = public.current_tg_id());

-- Device synchronization records belong to one account.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='device_requests'
  loop execute format('drop policy if exists %I on public.device_requests', p.policyname); end loop;
end $$;
create policy device_requests_manage_owner on public.device_requests for all to authenticated
  using (user_id = public.current_tg_id()) with check (user_id = public.current_tg_id());

do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='user_devices'
  loop execute format('drop policy if exists %I on public.user_devices', p.policyname); end loop;
end $$;
create policy user_devices_manage_owner on public.user_devices for all to authenticated
  using (user_id = public.current_tg_id()) with check (user_id = public.current_tg_id());

commit;
