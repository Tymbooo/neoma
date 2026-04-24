-- Run in Supabase SQL Editor after 001_profiles.sql.
-- Coin claims and heart loss use SUPABASE_SERVICE_ROLE_KEY on Vercel (POST /api/supabase/config).

alter table public.profiles
  add column if not exists coins integer not null default 0 check (coins >= 0);

alter table public.profiles
  add column if not exists heart_losses jsonb not null default '[]'::jsonb;

create table if not exists public.reward_claims (
  claim_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists reward_claims_user_id_idx on public.reward_claims (user_id);

alter table public.reward_claims enable row level security;

comment on column public.profiles.coins is 'Earned in-game; incremented via POST /api/supabase/config with claimId.';
comment on column public.profiles.heart_losses is 'ISO timestamps of recent losses; each recovers after 1 hour.';
comment on table public.reward_claims is 'One row per claimed win reward (idempotent by claim_id).';
