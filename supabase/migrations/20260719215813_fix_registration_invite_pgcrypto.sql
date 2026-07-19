create extension if not exists pgcrypto
with schema extensions;

alter function public.create_registration_invite()
set search_path = public, extensions;