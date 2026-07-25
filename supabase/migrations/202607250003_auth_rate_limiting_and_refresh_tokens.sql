-- =============================================================================
-- Миграция: Rate-limiting аутентификации + Refresh-токены (HTTP-only cookie)
-- К4: Rate-limit OTP (auth_attempts + check_rate_limit)
-- К2: Refresh-токены (refresh_tokens таблица)
-- Дата: 2026-07-25
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- К4: Таблица попыток аутентификации для rate-limiting
-- ---------------------------------------------------------------------------

create table if not exists public.auth_attempts (
  id          uuid primary key default gen_random_uuid(),
  identifier  text        not null,   -- username / IP / stableId
  attempt_type text       not null,   -- 'otp', 'seed', 'webauthn'
  success     boolean     not null default false,
  attempted_at timestamptz not null default now()
);

-- Индекс для быстрого окна скользящего времени
create index if not exists idx_auth_attempts_lookup
  on public.auth_attempts (identifier, attempt_type, attempted_at);

-- RLS: только service role (Edge Functions) имеет доступ
alter table public.auth_attempts enable row level security;

create policy auth_attempts_service_all on public.auth_attempts
  for all to service_role
  using (true) with check (true);

-- Полный запрет для authenticated (RLS по умолчанию deny)
-- Нет дополнительных политик — authenticated не может читать/писать

-- ---------------------------------------------------------------------------
-- К4: Функция проверки rate-limit
-- Возвращает true если лимит НЕ превышен (можно продолжать)
-- ---------------------------------------------------------------------------

create or replace function public.check_rate_limit(
  p_identifier text,
  p_attempt_type text,
  p_max_attempts int default 5,
  p_window_minutes int default 10
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select (
    select count(*) from public.auth_attempts
    where identifier = p_identifier
      and attempt_type = p_attempt_type
      and attempted_at > now() - (p_window_minutes || ' minutes')::interval
  ) < p_max_attempts
$$;

-- ---------------------------------------------------------------------------
-- К4: Функция записи попытки аутентификации
-- ---------------------------------------------------------------------------

create or replace function public.record_auth_attempt(
  p_identifier text,
  p_attempt_type text,
  p_success boolean default false
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.auth_attempts (identifier, attempt_type, success)
  values (p_identifier, p_attempt_type, p_success)
$$;

-- ---------------------------------------------------------------------------
-- К4: Автоочистка старых записей (>24 часа) через pg_cron
-- ---------------------------------------------------------------------------

-- Раскомментировать если pg_cron установлен:
-- select cron.schedule(
--   'cleanup-auth-attempts',
--   '0 * * * *',  -- каждый час
--   $$ delete from public.auth_attempts where attempted_at < now() - interval '24 hours' $$
-- );

-- Fallback: ручная очистка через вызов
create or replace function public.cleanup_old_auth_attempts()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.auth_attempts where attempted_at < now() - interval '24 hours'
$$;

-- ---------------------------------------------------------------------------
-- К2: Таблица refresh-токенов
-- ---------------------------------------------------------------------------

create table if not exists public.refresh_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references public.users(id) on delete cascade,
  token_hash  text        not null,   -- SHA-256 hex от refresh-токена
  user_agent  text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,   -- created_at + 7 дней
  revoked_at  timestamptz
);

-- Индекс для быстрого поиска активных токенов
create index if not exists idx_refresh_tokens_hash
  on public.refresh_tokens (token_hash)
  where revoked_at is null;

create index if not exists idx_refresh_tokens_user
  on public.refresh_tokens (user_id)
  where revoked_at is null;

-- RLS: только service role
alter table public.refresh_tokens enable row level security;

create policy refresh_tokens_service_all on public.refresh_tokens
  for all to service_role
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- К2: Функция выдачи refresh-токена (возвращает hex-строку)
-- ---------------------------------------------------------------------------

create or replace function public.issue_refresh_token(
  p_user_id uuid,
  p_user_agent text default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_token_hash text;
begin
  -- Генерируем криптографически стойкий токен (48 байт = 96 hex-символов)
  v_token := encode(gen_random_bytes(48), 'hex');
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  insert into public.refresh_tokens (user_id, token_hash, user_agent, expires_at)
  values (p_user_id, v_token_hash, p_user_agent, now() + interval '7 days');

  return v_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- К2: Функция верификации refresh-токена
-- Возвращает user_id если токен валиден, иначе null
-- ---------------------------------------------------------------------------

create or replace function public.verify_refresh_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token_hash text;
  v_user_id uuid;
begin
  v_token_hash := encode(digest(p_token, 'sha256'), 'hex');

  select rt.user_id into v_user_id
  from public.refresh_tokens rt
  where rt.token_hash = v_token_hash
    and rt.revoked_at is null
    and rt.expires_at > now();

  return v_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- К2: Функция отзыва refresh-токена
-- ---------------------------------------------------------------------------

create or replace function public.revoke_refresh_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token_hash text;
begin
  v_token_hash := encode(digest(p_token, 'sha256'), 'hex');
  update public.refresh_tokens
  set revoked_at = now()
  where token_hash = v_token_hash
    and revoked_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- К2: Функция отзыва ВСЕХ refresh-токенов пользователя
-- ---------------------------------------------------------------------------

create or replace function public.revoke_all_user_refresh_tokens(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.refresh_tokens
  set revoked_at = now()
  where user_id = p_user_id
    and revoked_at is null
$$;

commit;
