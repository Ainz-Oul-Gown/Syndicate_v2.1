-- Stage 15: private voice storage, attachment ownership and orphan cleanup queue.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice_messages', 'voice_messages', false, 15728640, array['application/octet-stream'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  uploader_id bigint not null references public.users(tg_id) on delete cascade,
  bucket_id text not null default 'voice_messages' check (bucket_id = 'voice_messages'),
  storage_path text not null unique,
  kind text not null default 'voice' check (kind = 'voice'),
  size_bytes bigint check (size_bytes is null or size_bytes > 0),
  created_at timestamptz not null default now(),
  unique (message_id, kind)
);

create index if not exists message_attachments_chat_idx on public.message_attachments(chat_id, created_at desc);
create index if not exists message_attachments_uploader_idx on public.message_attachments(uploader_id, created_at desc);

alter table public.message_attachments enable row level security;

do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='message_attachments'
  loop execute format('drop policy if exists %I on public.message_attachments', p.policyname); end loop;
end $$;

create policy message_attachments_read_member on public.message_attachments
for select to authenticated using (public.is_chat_member(chat_id));

create policy message_attachments_create_sender on public.message_attachments
for insert to authenticated with check (
  uploader_id = public.current_tg_id()
  and public.is_chat_member(chat_id)
  and exists (
    select 1 from public.messages m
    where m.id = message_id and m.chat_id = message_attachments.chat_id and m.sender_id = public.current_tg_id()
  )
  and storage_path like chat_id::text || '/' || uploader_id::text || '/%'
);

create policy message_attachments_delete_uploader on public.message_attachments
for delete to authenticated using (uploader_id = public.current_tg_id());

create table if not exists public.storage_cleanup_queue (
  id bigint generated always as identity primary key,
  bucket_id text not null,
  storage_path text not null,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  unique (bucket_id, storage_path)
);

alter table public.storage_cleanup_queue enable row level security;
-- No browser policies: queue is processed only by a service-role Edge Function.

create or replace function public.queue_deleted_attachment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.storage_cleanup_queue(bucket_id, storage_path)
  values (old.bucket_id, old.storage_path)
  on conflict (bucket_id, storage_path) do nothing;
  return old;
end;
$$;

revoke all on function public.queue_deleted_attachment() from public, anon, authenticated;

drop trigger if exists trg_queue_deleted_attachment on public.message_attachments;
create trigger trg_queue_deleted_attachment
after delete on public.message_attachments
for each row execute function public.queue_deleted_attachment();


create or replace function public.is_chat_storage_member(chat_id_text text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if chat_id_text is null or chat_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_chat_member(chat_id_text::uuid);
exception when others then
  return false;
end;
$$;

grant execute on function public.is_chat_storage_member(text) to authenticated;
revoke execute on function public.is_chat_storage_member(text) from anon;

-- New voice files use: <chat_uuid>/<uploader_tg_id>/<random>.bin
-- Existing root-level files remain readable temporarily for compatibility.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'syndicate_voice_%'
  loop execute format('drop policy if exists %I on storage.objects', p.policyname); end loop;
end $$;

create policy syndicate_voice_read_chat_member on storage.objects
for select to authenticated using (
  bucket_id = 'voice_messages'
  and (
    (
      array_length(storage.foldername(name), 1) >= 2
      and public.is_chat_storage_member((storage.foldername(name))[1])
    )
    or array_length(storage.foldername(name), 1) is null
  )
);

create policy syndicate_voice_upload_chat_member on storage.objects
for insert to authenticated with check (
  bucket_id = 'voice_messages'
  and array_length(storage.foldername(name), 1) >= 2
  and public.is_chat_storage_member((storage.foldername(name))[1])
  and ((storage.foldername(name))[2]) = public.current_tg_id()::text
);

create policy syndicate_voice_delete_uploader on storage.objects
for delete to authenticated using (
  bucket_id = 'voice_messages'
  and array_length(storage.foldername(name), 1) >= 2
  and public.is_chat_storage_member((storage.foldername(name))[1])
  and ((storage.foldername(name))[2]) = public.current_tg_id()::text
);
