-- Allow six learner levels (1–6) for Radio Zumo TTS and progress.

alter table public.radio_story_levels
  drop constraint if exists radio_story_levels_level_check;

alter table public.radio_story_levels
  add constraint radio_story_levels_level_check
  check (level >= 1 and level <= 6);

alter table public.radio_story_completions
  drop constraint if exists radio_story_completions_level_check;

alter table public.radio_story_completions
  add constraint radio_story_completions_level_check
  check (level >= 1 and level <= 6);
