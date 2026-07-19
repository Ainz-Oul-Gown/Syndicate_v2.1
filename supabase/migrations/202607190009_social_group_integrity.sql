-- Stage 18: atomic friendship workflows, group ownership and tighter currency visibility.

alter table public.chats add column if not exists created_by bigint;

update public.chats c
set created_by = src.user_id
from (
  select distinct on (chat_id) chat_id, user_id
  from public.chat_keys
  where user_id is not null
  order by chat_id, id
) src
where c.id = src.chat_id and c.created_by is null;

alter table public.chats
  add constraint chats_created_by_fkey foreign key (created_by)
  references public.users(tg_id) on delete set null not valid;

create index if not exists chats_created_by_idx on public.chats(created_by);

create or replace function public.set_chat_creator()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.created_by is null then
    new.created_by := public.current_tg_id();
  end if;
  return new;
end;
$$;

drop trigger if exists chats_set_creator on public.chats;
create trigger chats_set_creator before insert on public.chats
for each row execute function public.set_chat_creator();

-- Group mutation belongs to its creator. Private chat metadata is immutable from clients.
drop policy if exists chats_update_member on public.chats;
drop policy if exists chats_delete_member on public.chats;
create policy chats_update_creator on public.chats for update to authenticated
using (type = 'group' and created_by = public.current_tg_id())
with check (type = 'group' and created_by = public.current_tg_id());
create policy chats_delete_creator on public.chats for delete to authenticated
using (type = 'group' and created_by = public.current_tg_id());

-- Direct friendship writes are replaced by state-aware RPCs below.
drop policy if exists friendships_create_self on public.friendships;
drop policy if exists friendships_accept_addressee on public.friendships;
drop policy if exists friendships_delete_participant on public.friendships;

create or replace function public.send_friend_request(target_id bigint)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  me bigint := public.current_tg_id();
  result public.friendships;
begin
  if me is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if target_id is null or target_id = me then raise exception 'invalid_target' using errcode = '22023'; end if;
  if not exists (select 1 from public.users where tg_id = target_id and status <> 'blocked') then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  select * into result from public.friendships
  where least(requester_id, addressee_id) = least(me, target_id)
    and greatest(requester_id, addressee_id) = greatest(me, target_id)
  limit 1 for update;

  if found then
    if result.status = 'accepted' then raise exception 'already_friends' using errcode = '23505'; end if;
    if result.requester_id = target_id and result.addressee_id = me then
      update public.friendships set status='accepted' where id=result.id returning * into result;
      return result;
    end if;
    raise exception 'request_exists' using errcode = '23505';
  end if;

  insert into public.friendships(requester_id, addressee_id, status)
  values (me, target_id, 'pending') returning * into result;
  return result;
end;
$$;

create or replace function public.respond_friend_request(request_id uuid, accept_request boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare me bigint := public.current_tg_id();
begin
  if me is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if accept_request then
    update public.friendships set status='accepted'
    where id=request_id and addressee_id=me and status='pending';
  else
    delete from public.friendships
    where id=request_id and addressee_id=me and status='pending';
  end if;
  if not found then raise exception 'request_not_found_or_not_allowed' using errcode='P0002'; end if;
  return true;
end;
$$;

create or replace function public.remove_friend(target_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare me bigint := public.current_tg_id();
begin
  if me is null then raise exception 'unauthorized' using errcode='42501'; end if;
  delete from public.friendships
  where status='accepted' and ((requester_id=me and addressee_id=target_id) or (requester_id=target_id and addressee_id=me));
  if not found then raise exception 'friendship_not_found' using errcode='P0002'; end if;
  return true;
end;
$$;

-- Atomic group creation prevents orphan chats without the creator key.
create or replace function public.create_group_chat(group_name text, creator_encrypted_key text)
returns public.chats
language plpgsql
security definer
set search_path = public
as $$
declare me bigint := public.current_tg_id(); result public.chats;
begin
  if me is null then raise exception 'unauthorized' using errcode='42501'; end if;
  group_name := btrim(group_name);
  if length(group_name) < 1 or length(group_name) > 120 then raise exception 'invalid_group_name' using errcode='22023'; end if;
  if creator_encrypted_key is null or length(creator_encrypted_key) < 2 then raise exception 'missing_creator_key' using errcode='22023'; end if;

  insert into public.chats(name, type, created_by) values(group_name, 'group', me) returning * into result;
  insert into public.chat_keys(chat_id, user_id, encrypted_key) values(result.id, me, creator_encrypted_key);
  return result;
end;
$$;

-- Currency rates are visible only to the owner and accepted friends.
drop policy if exists currencies_read_authenticated on public.currencies;
create policy currencies_read_owner_or_friend on public.currencies for select to authenticated using (
  owner_id = public.current_tg_id()
  or exists (
    select 1 from public.friendships f
    where f.status='accepted' and (
      (f.requester_id=owner_id and f.addressee_id=public.current_tg_id()) or
      (f.addressee_id=owner_id and f.requester_id=public.current_tg_id())
    )
  )
);

grant execute on function public.send_friend_request(bigint) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(bigint) to authenticated;
grant execute on function public.create_group_chat(text, text) to authenticated;
