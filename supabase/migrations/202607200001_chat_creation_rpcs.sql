-- Atomic E2EE chat creation helpers for Saved Messages and private chats.
-- Apply with: npx supabase db push

create or replace function public.get_private_chat(
  user1_id bigint,
  user2_id bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  actor_id bigint := public.current_tg_id();
  result_id uuid;
begin
  if actor_id is null or actor_id not in (user1_id, user2_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select c.id
    into result_id
  from public.chats c
  join public.chat_keys k1
    on k1.chat_id = c.id
   and k1.user_id = user1_id
  join public.chat_keys k2
    on k2.chat_id = c.id
   and k2.user_id = user2_id
  where c.type = 'private'
  order by c.created_at
  limit 1;

  return result_id;
end;
$$;

create or replace function public.create_private_chat(
  friend_id bigint,
  my_encrypted_key text,
  friend_encrypted_key text
)
returns public.chats
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id bigint := public.current_tg_id();
  result_chat public.chats;
  existing_chat_id uuid;
begin
  if actor_id is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if friend_id is null or friend_id = actor_id then
    raise exception 'invalid_friend' using errcode = '22023';
  end if;

  if coalesce(length(btrim(my_encrypted_key)), 0) < 2
     or coalesce(length(btrim(friend_encrypted_key)), 0) < 2 then
    raise exception 'encrypted_keys_required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = actor_id and f.addressee_id = friend_id)
        or
        (f.requester_id = friend_id and f.addressee_id = actor_id)
      )
  ) then
    raise exception 'accepted_friendship_required' using errcode = '42501';
  end if;

  -- Serialise concurrent creation attempts for the same user pair.
  perform pg_advisory_xact_lock(
    hashtextextended(
      least(actor_id, friend_id)::text || ':' || greatest(actor_id, friend_id)::text,
      0
    )
  );

  select public.get_private_chat(actor_id, friend_id)
    into existing_chat_id;

  if existing_chat_id is not null then
    select *
      into result_chat
    from public.chats
    where id = existing_chat_id;

    return result_chat;
  end if;

  insert into public.chats (
    name,
    type,
    created_by
  )
  values (
    'private',
    'private',
    actor_id
  )
  returning * into result_chat;

  insert into public.chat_keys (
    chat_id,
    user_id,
    encrypted_key
  )
  values
    (result_chat.id, actor_id, my_encrypted_key),
    (result_chat.id, friend_id, friend_encrypted_key);

  return result_chat;
end;
$$;

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
  result_chat public.chats;
begin
  if actor_id is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if coalesce(length(btrim(encrypted_key)), 0) < 2 then
    raise exception 'encrypted_key_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('saved:' || actor_id::text, 0)
  );

  select c.*
    into result_chat
  from public.chats c
  join public.chat_keys ck
    on ck.chat_id = c.id
   and ck.user_id = actor_id
  where c.type = 'saved'
  order by c.created_at
  limit 1;

  if found then
    return result_chat;
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
  returning * into result_chat;

  insert into public.chat_keys (
    chat_id,
    user_id,
    encrypted_key
  )
  values (
    result_chat.id,
    actor_id,
    encrypted_key
  );

  return result_chat;
end;
$$;

revoke all on function public.get_private_chat(bigint, bigint) from public;
revoke all on function public.create_private_chat(bigint, text, text) from public;
revoke all on function public.create_saved_chat(text) from public;

grant execute on function public.get_private_chat(bigint, bigint) to authenticated;
grant execute on function public.create_private_chat(bigint, text, text) to authenticated;
grant execute on function public.create_saved_chat(text) to authenticated;
