-- Syndicate: message read-status tracking.
-- Adds read_at column, an RPC for recipients to mark messages read,
-- and an RLS policy allowing recipients (non-senders) to update read_at.

begin;

-- 1. Add read_at column (nullable = message not yet read).
alter table public.messages
  add column if not exists read_at timestamptz;

create index if not exists messages_read_at_idx
  on public.messages(chat_id, read_at)
  where read_at is null;

-- 2. RPC: mark all unread messages in a chat that were sent BY OTHERS.
--    Returns the number of rows updated so the caller can decide
--    whether a Realtime UPDATE will fire.
create or replace function public.mark_messages_read(p_chat_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.messages
  set    read_at = now()
  where  chat_id = p_chat_id
    and  sender_id != public.current_tg_id()
    and  read_at is null;
$$;

-- Only authenticated users may call this function.
revoke all on function public.mark_messages_read(uuid) from public;
grant  execute on function public.mark_messages_read(uuid) to authenticated;

-- 3. RLS: allow recipients to set read_at on messages they did NOT send.
--    The existing messages_update_sender policy covers sender-side updates.
--    This new policy lets any chat member update read_at on messages from others.
--
--    We drop & recreate the update policy to combine both rules cleanly.
do $$ declare p record; begin
  for p in select policyname
           from pg_policies
           where schemaname = 'public'
             and tablename  = 'messages'
             and policyname = 'messages_update_member_read'
  loop
    execute format('drop policy if exists %I on public.messages', p.policyname);
  end loop;
end $$;

create policy messages_update_member_read on public.messages
  for update to authenticated
  using (
    public.is_chat_member(messages.chat_id)
    and messages.sender_id != public.current_tg_id()
  )
  with check (
    public.is_chat_member(messages.chat_id)
    and messages.sender_id != public.current_tg_id()
  );

commit;
