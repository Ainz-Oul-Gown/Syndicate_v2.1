create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  device_id text not null,
  token text not null,
  platform text not null default 'web' check (platform in ('web', 'pwa', 'android')),
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(token)
);

create index if not exists push_subscriptions_user_active_idx
  on public.push_subscriptions(user_id, active);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

comment on table public.push_subscriptions is
  'FCM registration tokens. Access is restricted to server-side Edge Functions.';
