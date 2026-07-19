create or replace function public.create_saved_chat(
  encrypted_key text
)
returns public.chats
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id bigint := public.current_tg_id();
  existing_chat public.chats;
  created_chat public.chats;
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;

  if encrypted_key is null or length(btrim(encrypted_key)) = 0 then
    raise exception 'Encrypted key is required';
  end if;

  select c.*
  into existing_chat
  from public.chats c
  join public.chat_keys ck
    on ck.chat_id = c.id
  where c.type = 'saved'
    and ck.user_id = actor_id
  order by c.created_at
  limit 1;

  if found then
    return existing_chat;
  end if;

  insert into public.chats (
    name,
    type,
    created_by
  )
  values (
    'saved',
    'saved',
    actor_id
  )
  returning * into created_chat;

  insert into public.chat_keys (
    chat_id,
    user_id,
    encrypted_key
  )
  values (
    created_chat.id,
    actor_id,
    encrypted_key
  );

  return created_chat;
end;
$$;

revoke all on function public.create_saved_chat(text) from public;
grant execute on function public.create_saved_chat(text) to authenticated;