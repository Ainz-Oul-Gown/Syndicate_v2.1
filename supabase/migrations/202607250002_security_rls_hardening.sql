-- =============================================================================
-- Миграция: Усиление RLS-политик безопасности
-- К1: Column-level ограничение UPDATE messages (только read_at для не-отправителей)
-- В2: Ограничение произвольного добавления участников chat_keys
-- С2: Ограничение прямого INSERT в chats только type = 'group'
-- Дата: 2026-07-25
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- К1: Триггер для column-level ограничения UPDATE на таблице messages
-- ---------------------------------------------------------------------------

-- Функция триггера: разрешает не-отправителям менять ТОЛЬКО поле read_at
create or replace function public.enforce_messages_update_restriction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Отправитель может менять любые свои поля (delete_own_message через RPC и т.д.)
  -- Для не-отправителей: разрешаем менять ТОЛЬКО read_at
  if old.sender_id != public.current_tg_id() then
    -- Проверяем, что изменилось только поле read_at
    if to_jsonb(old) - 'read_at' is distinct from to_jsonb(new) - 'read_at' then
      raise exception 'Участники чата могут обновлять только статус прочтения сообщений';
    end if;
  end if;
  return new;
end;
$$;

-- Удаляем старый триггер (если был) и создаём новый
drop trigger if exists messages_update_column_restriction on public.messages;
create trigger messages_update_column_restriction
  before update on public.messages
  for each row
  execute function public.enforce_messages_update_restriction();

-- ---------------------------------------------------------------------------
-- В2: Ограничение INSERT в chat_keys
-- ---------------------------------------------------------------------------

-- Удаляем старую политику chat_keys_insert_member
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='chat_keys' and policyname='chat_keys_insert_member'
  loop execute format('drop policy if exists %I on public.chat_keys', p.policyname); end loop;
end $$;

-- Новая политика: вставка разрешена только для своих ключей ИЛИ
-- только для групповых чатов (private/saved защищены бизнес-логикой RPC)
create policy chat_keys_insert_member on public.chat_keys for insert to authenticated
  with check (
    -- Случай 1: пользователь добавляет свой собственный ключ
    user_id = public.current_tg_id()
    or (
      -- Случай 2: добавление в групповой чат (только если чат типа 'group')
      public.is_chat_member(chat_keys.chat_id)
      and exists (
        select 1 from public.chats
        where chats.id = chat_keys.chat_id
          and chats.type = 'group'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- С2: Ограничение прямого INSERT в chats только type = 'group'
-- ---------------------------------------------------------------------------

-- Удаляем старую политику chats_create_authenticated
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='chats' and policyname='chats_create_authenticated'
  loop execute format('drop policy if exists %I on public.chats', p.policyname); end loop;
end $$;

-- Новая политика: прямой INSERT разрешён ТОЛЬКО для групповых чатов
-- private/saved чаты создаются исключительно через security definer RPC
create policy chats_create_group_only on public.chats for insert to authenticated
  with check (
    type = 'group'
    and created_by = public.current_tg_id()
  );

commit;
