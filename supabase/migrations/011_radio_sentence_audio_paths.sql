-- Per-sentence TTS: storage paths for each line of display_body (tap-to-advance audio).

alter table public.radio_story_levels
  add column if not exists sentence_audio_paths text[];

comment on column public.radio_story_levels.sentence_audio_paths is
  'Ordered storage object paths (radio-audio bucket) for each sentence line; null/empty = legacy single audio_path.';
