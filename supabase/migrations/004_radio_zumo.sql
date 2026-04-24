-- Radio Zumo: hourly tech stories, four difficulty levels, TTS audio in storage.

create table if not exists public.radio_stories (
  id uuid primary key default gen_random_uuid(),
  topic_slug text not null default 'tech',
  fingerprint text not null,
  title text not null,
  language text not null default 'es',
  created_at timestamptz not null default now(),
  unique (topic_slug, fingerprint)
);

create index if not exists radio_stories_topic_created_idx
  on public.radio_stories (topic_slug, created_at desc);

create table if not exists public.radio_story_levels (
  story_id uuid not null references public.radio_stories (id) on delete cascade,
  level int not null check (level >= 1 and level <= 4),
  display_body text not null,
  tts_body text not null,
  audio_path text,
  duration_sec double precision,
  meta jsonb not null default '{}'::jsonb,
  primary key (story_id, level)
);

create index if not exists radio_story_levels_story_idx
  on public.radio_story_levels (story_id);

alter table public.radio_stories enable row level security;
alter table public.radio_story_levels enable row level security;

create policy "radio_stories_select_public"
  on public.radio_stories for select
  using (true);

create policy "radio_story_levels_select_public"
  on public.radio_story_levels for select
  using (true);

-- Progress + streak (written only via service-role API; no direct client policies.)
create table if not exists public.radio_story_completions (
  user_id uuid not null references auth.users (id) on delete cascade,
  story_id uuid not null references public.radio_stories (id) on delete cascade,
  level int not null check (level >= 1 and level <= 4),
  completed_at timestamptz not null default now(),
  primary key (user_id, story_id, level)
);

create index if not exists radio_story_completions_user_idx
  on public.radio_story_completions (user_id, completed_at desc);

create table if not exists public.radio_user_streak (
  user_id uuid primary key references auth.users (id) on delete cascade,
  streak int not null default 0,
  last_complete_day date,
  updated_at timestamptz not null default now()
);

alter table public.radio_story_completions enable row level security;
alter table public.radio_user_streak enable row level security;

insert into storage.buckets (id, name, public)
values ('radio-audio', 'radio-audio', false)
on conflict (id) do nothing;
