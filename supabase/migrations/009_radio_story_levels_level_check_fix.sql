-- Canonical fix: remove every CHECK on radio_story_levels / radio_story_completions, then one rule level 1–6.
-- Run against the Supabase project used by Vercel (SUPABASE_URL). Verify after:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.radio_story_levels'::regclass AND contype = 'c';

ALTER TABLE public.radio_story_levels DROP CONSTRAINT IF EXISTS radio_story_levels_level_check;
ALTER TABLE public.radio_story_completions DROP CONSTRAINT IF EXISTS radio_story_completions_level_check;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.radio_story_levels'::regclass
      AND c.contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE public.radio_story_levels DROP CONSTRAINT %I', r.conname);
  END LOOP;

  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.radio_story_completions'::regclass
      AND c.contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE public.radio_story_completions DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.radio_story_levels
  ADD CONSTRAINT radio_story_levels_level_check
  CHECK (level >= 1 AND level <= 6);

ALTER TABLE public.radio_story_completions
  ADD CONSTRAINT radio_story_completions_level_check
  CHECK (level >= 1 AND level <= 6);
