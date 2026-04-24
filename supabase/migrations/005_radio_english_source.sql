-- Canonical English ground-truth article per story (search-backed in ingest).

alter table public.radio_stories
  add column if not exists english_source text;

comment on column public.radio_stories.english_source is 'English ~150w source used to generate Spanish levels; search-backed at ingest.';
