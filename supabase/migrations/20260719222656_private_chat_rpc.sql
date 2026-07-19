create or replace function public.get_private_chat(
  user1_id bigint,
  user2_id bigint
)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select c.id
  from public.chats c
  join public.chat_keys k1
    on k1.chat_id = c.id
   and k1.user_id = user1_id
  join public.chat_keys k2
    on k2.chat_id = c.id
   and k2.user_id = user2_id
  where c.type = 'private'
    and public.current_tg_id() in (user1_id, user2_id)
  order by c.created_at
  limit 1;
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
  me bigint := public.current_tg_id();
  result public.chats;
  existing_chat_id uuid;
  lock_left bigint;
  lock_right bigint;
begin
  if me is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if friend_id is null or friend_id = me then
    raise exception 'invalid_friend' using errcode = '22023';
  end if;

  if my_encrypted_key is null or length(btrim(my_encrypted_key)) < 2 then
    raise exception 'missing_my_key' using errcode = '22023';
  end if;

  if friend_encrypted_key is null
     or length(btrim(friend_encrypted_key)) < 2 then
    raise exception 'missing_friend_key' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = me and f.addressee_id = friend_id)
        or
        (f.requester_id = friend_id and f.addressee_id = me)
      )
  ) then
    raise exception 'accepted_friendship_required'
      using errcode = '42501';
  end if;

  lock_left := least(me, friend_id);
  lock_right := greatest(me, friend_id);

  perform pg_advisory_xact_lock(lock_left, lock_right);

  select public.get_private_chat(me, friend_id)
  into existing_chat_id;

  if existing_chat_id is not null then
    select *
    into result
    from public.chats
    where id = existing_chat_id;

    return result;
  end if;

  insert into public.chats (
    name,
    type,
    created_by
  )
  values (
    'private',
    'private',
    me
  )
  returning * into result;

  insert into public.chat_keys (
    chat_id,
    user_id,
    encrypted_key
  )
  values
    (
      result.id,
      me,
      my_encrypted_key
    ),
    (
      result.id,
      friend_id,
      friend_encrypted_key
    );

  return result;
end;
$$;

revoke all on function public.get_private_chat(bigint, bigint) from public;
revoke all on function public.create_private_chat(bigint, text, text) from public;

grant execute
on function public.get_private_chat(bigint, bigint)
to authenticated;

grant execute
on function public.create_private_chat(bigint, text, text)
to authenticated;