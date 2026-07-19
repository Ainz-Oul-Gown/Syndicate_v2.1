create table if not exists public.user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'telegram', 'email')),
  provider_subject text not null,
  provider_email text,
  provider_username text,
  wrapped_vault_secret text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_identities_provider_subject_key unique (provider, provider_subject),
  constraint user_identities_user_provider_key unique (user_id, provider)
);

create index if not exists user_identities_user_id_idx on public.user_identities(user_id);
alter table public.user_identities enable row level security;
comment on table public.user_identities is
  'Verified provider links. Intentionally inaccessible to browser roles.';

alter table public.auth_challenges enable row level security;
revoke all on table public.auth_challenges from anon, authenticated;
