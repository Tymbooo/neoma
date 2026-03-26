-- Run in Supabase SQL Editor (Dashboard → SQL → New query).
--
-- Google OAuth setup:
-- 1) Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client (Web).
-- 2) Authorized redirect URIs must include:
--      https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback
-- 3) Copy Client ID + Client Secret into Supabase → Authentication → Providers → Google.
-- 4) Supabase → Authentication → URL configuration:
--      Site URL: https://your-production-domain.com
--      Additional Redirect URLs: http://localhost:3000 (for `vercel dev`), preview URLs if needed.
-- 5) Vercel (or .env.local): SUPABASE_URL, SUPABASE_ANON_KEY (Project Settings → API).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_username_lower_idx on public.profiles (lower(username));

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

comment on table public.profiles is 'App display name per auth user; username chosen after Google sign-in.';
