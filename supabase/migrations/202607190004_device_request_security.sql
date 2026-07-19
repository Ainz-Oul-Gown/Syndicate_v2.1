begin;

alter table public.device_requests
  add column if not exists requester_device_id text,
  add column if not exists expires_at timestamptz,
  add column if not exists responded_at timestamptz,
  add column if not exists approved_by_device_id text;

update public.device_requests
set expires_at = coalesce(expires_at, created_at + interval '10 minutes')
where expires_at is null;

alter table public.device_requests
  alter column expires_at set default (now() + interval '10 minutes');

alter table public.device_requests drop constraint if exists device_requests_device_id_format_chk;
alter table public.device_requests add constraint device_requests_device_id_format_chk
  check (requester_device_id is null or requester_device_id ~ '^dev_[a-f0-9]{36}$') not valid;

alter table public.device_requests drop constraint if exists device_requests_response_consistency_chk;
alter table public.device_requests add constraint device_requests_response_consistency_chk check (
  (status = 'pending' and responded_at is null and approved_by_device_id is null and encrypted_master_keys is null)
  or (status = 'approved' and responded_at is not null and approved_by_device_id is not null and encrypted_master_keys is not null)
  or (status = 'rejected' and responded_at is not null and approved_by_device_id is not null and encrypted_master_keys is null)
) not valid;

create index if not exists device_requests_expiry_idx on public.device_requests(status, expires_at);

-- Browser clients may create and observe their own requests, but cannot approve them directly.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='device_requests'
  loop execute format('drop policy if exists %I on public.device_requests', p.policyname); end loop;
end $$;
create policy device_requests_select_owner on public.device_requests for select to authenticated
  using (user_id = public.current_tg_id());
create policy device_requests_insert_owner on public.device_requests for insert to authenticated
  with check (
    user_id = public.current_tg_id() and status = 'pending'
    and encrypted_master_keys is null and responded_at is null and approved_by_device_id is null
    and expires_at > now() and expires_at <= now() + interval '15 minutes'
  );
create policy device_requests_delete_owner on public.device_requests for delete to authenticated
  using (user_id = public.current_tg_id() and (status <> 'pending' or expires_at <= now()));

-- Trusted-device registration/update is performed only by a signature-verifying Edge Function.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='user_devices'
  loop execute format('drop policy if exists %I on public.user_devices', p.policyname); end loop;
end $$;
create policy user_devices_select_owner on public.user_devices for select to authenticated
  using (user_id = public.current_tg_id());
create policy user_devices_delete_owner on public.user_devices for delete to authenticated
  using (user_id = public.current_tg_id());

commit;
