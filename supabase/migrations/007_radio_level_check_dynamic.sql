-- Ensure level allows 1–6 even if 004 used an auto-generated CHECK name (not radio_story_levels_level_check).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.radio_story_levels'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%level%'
  LOOP
    EXECUTE format('ALTER TABLE public.radio_story_levels DROP CONSTRAINT %I', r.conname);
  END LOOP;

  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.radio_story_completions'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%level%'
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
