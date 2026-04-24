/**
 * Applies radio level CHECK (1–6) on Postgres. Supabase-js cannot run DDL; this uses a direct DB URI.
 * Set DATABASE_URL or SUPABASE_DATABASE_URL (Supabase Dashboard → Database → Connection string → URI).
 * Prefer Session mode (port 5432) if Transaction pooler (6543) rejects DDL.
 */
const { Client } = require("pg");

const FIX_SQL = `
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
`;

function getDatabaseUrl() {
  return (
    process.env.SUPABASE_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    ""
  ).trim();
}

let ensuredThisRuntime = false;

/**
 * Runs once per serverless instance. Idempotent on the database.
 * @param {{ force?: boolean }} opts
 */
async function ensureRadioLevelCheckConstraints(opts = {}) {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    return { ok: false, skipped: true, reason: "No DATABASE_URL / SUPABASE_DATABASE_URL" };
  }
  if (ensuredThisRuntime && !opts.force) {
    return { ok: true, skipped: true, reason: "already ensured this runtime" };
  }

  const client = new Client({
    connectionString,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(FIX_SQL);
    ensuredThisRuntime = true;
    return { ok: true };
  } finally {
    await client.end();
  }
}

module.exports = {
  ensureRadioLevelCheckConstraints,
  getDatabaseUrl,
};
