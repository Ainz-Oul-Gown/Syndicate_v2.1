-- Stage 16: atomic message deletion and legacy voice migration support.

create or replace function public.delete_own_message(target_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if public.current_tg_id() is null then
    raise exception 'Unauthorized';
  end if;

  delete from public.messages
  where id = target_message_id
    and sender_id = public.current_tg_id();

  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;

revoke all on function public.delete_own_message(uuid) from public, anon;
grant execute on function public.delete_own_message(uuid) to authenticated;

-- Track whether legacy root-level Storage objects still exist.
create or replace view public.voice_storage_migration_status
with (security_invoker = true)
as
select
  count(*) filter (where position('/' in name) = 0) as legacy_root_objects,
  count(*) filter (where position('/' in name) > 0) as protected_objects
from storage.objects
where bucket_id = 'voice_messages';

revoke all on public.voice_storage_migration_status from public, anon;
grant select on public.voice_storage_migration_status to authenticated;
