-- Stage 17: safely finalize legacy voice storage migration.
-- Run the function from SQL Editor only after legacy_root_objects reaches zero.

create or replace function public.finalize_voice_storage_migration()
returns table(finalized boolean, legacy_root_objects bigint, message text)
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  remaining bigint;
begin
  select count(*) into remaining
  from storage.objects
  where bucket_id = 'voice_messages'
    and position('/' in name) = 0;

  if remaining > 0 then
    return query select false, remaining,
      'Legacy root objects still exist. Open old chats as their original senders and retry.'::text;
    return;
  end if;

  drop policy if exists syndicate_voice_read_chat_member on storage.objects;

  create policy syndicate_voice_read_chat_member on storage.objects
  for select to authenticated using (
    bucket_id = 'voice_messages'
    and array_length(storage.foldername(name), 1) >= 2
    and public.is_chat_storage_member((storage.foldername(name))[1])
  );

  return query select true, 0::bigint,
    'Legacy root access has been disabled. Only chat-scoped objects are readable.'::text;
end;
$$;

revoke all on function public.finalize_voice_storage_migration() from public, anon, authenticated;
comment on function public.finalize_voice_storage_migration() is
  'SQL Editor/admin-only finalizer. Refuses to remove legacy root access until no root voice objects remain.';

-- Reduce migration-status exposure: authenticated users do not need global object counts.
revoke select on public.voice_storage_migration_status from authenticated;
