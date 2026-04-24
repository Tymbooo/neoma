/**
 * Radio Zumo HTTP handlers (/api/newspaper?radio=…).
 *
 * Vercel / server env (see also lib/radioIngest.js):
 * - XAI_API_KEY — Grok ingest + TTS
 * - RADIO_ENABLE_TTS=1 — generate MP3 on ingest (new rows only); if unset, audio_path stays null (use backfill-tts after enabling)
 * - RADIO_INGEST_FAST=1 — fastest admin refresh: skips Stage 2b and TTS on ingest (same as TTS off for this run); insert rows then run ?radio=backfill-tts. Combine with RADIO_INGEST_STORY_TARGET=1 for a single-story replace.
 * - RADIO_TTS_INGEST_CONCURRENCY (optional, default 8, max 24) — parallel xAI TTS calls per level during ingest/backfill; lower if you see 429s.
 * - RADIO_STORY_CONCURRENCY (optional, default 3, max 6) — parallel per-story workers (Stage 2 / Stage 2b / DB insert / TTS) during ingest; lower if xAI rate limits bite.
 * - RADIO_BACKFILL_ROW_CONCURRENCY (optional, default 3, max 8) — parallel level-rows during backfill-tts (each row further parallelizes sentence TTS via RADIO_TTS_INGEST_CONCURRENCY).
 * - RADIO_ADMIN_EMAILS — comma-separated emails allowed for ?radio=ingest and ?radio=backfill-tts
 * - RADIO_CRON_SECRET or CRON_SECRET — Bearer for ?radio=cron and ?radio=backfill-tts (same secret)
 * - RADIO_CHAIN_BACKFILL_AFTER_INGEST — default on: after cron ingest, run backfill TTS (see RADIO_BACKFILL_AFTER_CRON_LIMIT)
 * - RADIO_BACKFILL_AFTER_CRON_LIMIT — max level-rows to backfill after cron (default 40)
 * - RADIO_REPLACE_TOPIC_ON_INGEST=1 — admin ingest default: full replace when JSON body omits replaceTopic (see below).
 * - RADIO_REPLACE_ON_CRON=1 — cron ingest also wipes + replaces (default off so scheduled jobs append-only).
 * - Admin POST body: replaceTopic true = force replace; false = force append (ignore env); omit = use env RADIO_REPLACE_TOPIC_ON_INGEST.
 * - Admin POST body: skipTts true = defer TTS (audio left null); use with a follow-up ?radio=backfill-tts call. Newsroom UI chains both phases so each fits under Vercel's 300s cap.
 * - Retention (after successful ingest): default keep newest 10 stories per topic + MP3 cleanup; RADIO_MAX_STORIES_RETAINED_PER_TOPIC overrides (1–500); RADIO_RETENTION_DISABLED=1 turns off pruning.
 * - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * - DATABASE_URL or SUPABASE_DATABASE_URL (optional but recommended): Postgres connection URI so ingest can auto-apply level 1–6 CHECK on radio_story_levels / radio_story_completions (Supabase Dashboard → Database → Connection string → URI; use Session pooler port 5432 if DDL fails on 6543).
 * - RADIO_TTS_LANGUAGE (optional, default es-ES) — xAI TTS BCP-47 code.
 * - RADIO_TTS_VOICES (optional) — comma-separated rotation pool; default rex,sal,leo,ara when RADIO_TTS_VOICE is unset.
 * - RADIO_TTS_VOICE (optional) — if set, single voice for all TTS (disables rotation). Unset = rotate through RADIO_TTS_VOICES / default pool.
 * - RADIO_INGEST_STORY_TARGET (optional, default 3, max 10) — Stage 1 story count + replace-ingest cap; set 10 for production feeds.
 * - RADIO_MAX_STORIES_PER_RUN (append/cron when not replacing: capped by RADIO_INGEST_STORY_TARGET; unset = use that target)
 * - RADIO_STAGE2_MAX_ATTEMPTS (optional, default 5, max 8) — retry Stage 2 Spanish JSON when validation fails; server also auto-merges small gloss count mismatches (+1…+6 extra glosses per line).
 * - RADIO_STAGE2_MAX_TOKENS (optional, default 12288, max 16384) — chat completion max_tokens for Stage 2 (longer bodies need more headroom).
 * - RADIO_TTS_PREP_DISABLED=1 — skip Stage 2b (phonetic spellings, número a palabras, comas para TTS); ingest uses display text + sync numeral→words only before wrapping <slow>.
 * - RADIO_XAI_MODEL / RADIO_SPANISH_MODEL (optional): stage 1 search requires Grok 4 per xAI; defaults in lib/radioIngest.js.
 * - RADIO_STAGE1_MAX_TURNS (optional): Responses tool loop budget for Stage 1 (default 24, max 48). Lower (e.g. 12–16) to reduce Stage 1 latency; raise if Stage 1 often incomplete.
 * - RADIO_STAGE1_MAX_OUTPUT_TOKENS (optional, default 16384, min 4096): Stage 1 Responses max_output_tokens; lower for slightly faster / smaller Stage 1 payloads.
 * - RADIO_XSEARCH_LOOKBACK_HOURS (optional, default 48, min 24, max 96): x_search from_date lookback; validator auto-aligns its recency floor to this range + 1h grace.
 * - RADIO_RECENCY_BUFFER_HOURS (optional, default 6, max 24): extra grace added to the fallback 24h recency check when no x_search context is passed.
 * - RADIO_RECENCY_BUFFER_HOURS (optional): extra hours added to the 24h as_of window for Stage 1 validation (default 6, max 18).
 * - Successful ingest JSON may include stage1Rejected: rows dropped during Stage 1 validation (bad as_of, etc.).
 *
 * Newsroom admin UI: shown by default in the Radio build; set VITE_RADIO_ADMIN_UI=0 to hide. Server requires RADIO_ADMIN_EMAILS for ingest.
 */
require("./loadEnv")();

const { createClient } = require("@supabase/supabase-js");
const {
  runRadioIngest,
  runRadioBackfillTts,
  buildXaiTtsRequestPreview,
  buildXaiTtsSentenceRequest,
  linesForTts,
  RADIO_LEVEL_MIN,
  RADIO_LEVEL_MAX,
} = require("./radioIngest");

function authorizeCron(req) {
  const secret = (process.env.RADIO_CRON_SECRET || process.env.CRON_SECRET || "").trim();
  const auth = String(req.headers.authorization || "");
  return Boolean(secret && auth === `Bearer ${secret}`);
}

function chainBackfillAfterIngest() {
  const v = (process.env.RADIO_CHAIN_BACKFILL_AFTER_INGEST || "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no" && v !== "off";
}

function envTruthy(name) {
  const v = (process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function levelFromQuery(raw) {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= RADIO_LEVEL_MIN && n <= RADIO_LEVEL_MAX) return Math.floor(n);
  return 3;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) {
          resolve({});
          return;
        }
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseRadioAdminEmails() {
  const raw = (process.env.RADIO_ADMIN_EMAILS || "").trim();
  if (!raw) return [];
  return raw
    .split(/[,;]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isRadioAdminEmail(email) {
  const allow = parseRadioAdminEmails();
  if (!allow.length || !email) return false;
  return allow.includes(String(email).trim().toLowerCase());
}

async function radioAdminFromRequest(req, admin) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return { error: { status: 401, json: { error: "Missing bearer token" } } };
  }
  const {
    data: { user },
    error: userErr,
  } = await admin.auth.getUser(token);
  if (userErr || !user) {
    return { error: { status: 401, json: { error: "Invalid session" } } };
  }
  const allow = parseRadioAdminEmails();
  if (!allow.length) {
    return {
      error: {
        status: 503,
        json: {
          error: "Admin ingest disabled: set RADIO_ADMIN_EMAILS on the server",
        },
      },
    };
  }
  if (!isRadioAdminEmail(user.email)) {
    return { error: { status: 403, json: { error: "Not authorized for radio admin" } } };
  }
  return { user };
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function utcYesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function bumpStreak(admin, userId) {
  const today = utcToday();
  const yesterday = utcYesterday();

  const { data: row } = await admin
    .from("radio_user_streak")
    .select("streak,last_complete_day")
    .eq("user_id", userId)
    .maybeSingle();

  if (!row) {
    await admin.from("radio_user_streak").insert({
      user_id: userId,
      streak: 1,
      last_complete_day: today,
      updated_at: new Date().toISOString(),
    });
    return 1;
  }

  if (row.last_complete_day === today) {
    return row.streak ?? 1;
  }

  if (row.last_complete_day === yesterday) {
    const next = (row.streak ?? 0) + 1;
    await admin
      .from("radio_user_streak")
      .update({
        streak: next,
        last_complete_day: today,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    return next;
  }

  await admin
    .from("radio_user_streak")
    .update({
      streak: 1,
      last_complete_day: today,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  return 1;
}

async function handleCron(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!authorizeCron(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const dryRun =
    String(req.headers["x-radio-dry-run"] || "") === "1" ||
    String((req.query && req.query.dryRun) || "") === "1";
  try {
    const out = await runRadioIngest({
      dryRun,
      topicSlug: "tech",
      replaceTopic: envTruthy("RADIO_REPLACE_ON_CRON"),
    });
    if (!out.ok) {
      const errStr =
        typeof out.error === "string" && out.error.trim()
          ? out.error.trim()
          : out.error != null
            ? String(out.error)
            : "Ingest failed (no error message from pipeline; see ingestTrace).";
      res.status(502).json({ ...out, ok: false, error: errStr });
      return;
    }
    let backfill = null;
    if (!dryRun && chainBackfillAfterIngest()) {
      const lim = Math.max(1, Math.min(200, Number(process.env.RADIO_BACKFILL_AFTER_CRON_LIMIT || 40)));
      try {
        backfill = await runRadioBackfillTts({ topicSlug: "tech", limit: lim });
      } catch (bfErr) {
        console.error("radio cron backfill", bfErr);
        backfill = { ok: false, error: bfErr.message || String(bfErr) };
      }
    }
    res.status(200).json(backfill ? { ...out, backfill } : out);
  } catch (e) {
    console.error("radio cron", e);
    res.status(500).json({ ok: false, error: e.message || "cron failed" });
  }
}

async function handleFeed(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const topic = String((req.query && req.query.topic) || "tech").trim() || "tech";
  const level = levelFromQuery(req.query && req.query.level);
  const limit = Math.max(1, Math.min(40, Number(req.query && req.query.limit) || 10));

  const url = (process.env.SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) {
    res.status(503).json({ error: "Supabase not configured" });
    return;
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: stories, error: sErr } = await admin
    .from("radio_stories")
    .select("id,title,created_at,language,english_source")
    .eq("topic_slug", topic)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (sErr) {
    res.status(500).json({ error: sErr.message });
    return;
  }

  const ids = (stories || []).map((s) => s.id);
  if (ids.length === 0) {
    res.status(200).json({ topic, level, stories: [] });
    return;
  }

  // Generalized fallback: fetch every row at-or-below the requested level,
  // then per story pick the highest-available (exact match preferred).
  // This supports arbitrary admin-disabled subsets (e.g. a story ingested
  // with only levels 1 and 6 still serves something at every slider position).
  // Story-level output keeps the actual `row.level`, so the UI can detect fallback.
  const { data: levels, error: lErr } = await admin
    .from("radio_story_levels")
    .select("story_id,level,display_body,tts_body,audio_path,duration_sec,meta,sentence_audio_paths")
    .in("story_id", ids)
    .lte("level", level);

  if (lErr) {
    res.status(500).json({ error: lErr.message });
    return;
  }

  const byStory = new Map();
  for (const row of levels || []) {
    const prev = byStory.get(row.story_id);
    // Prefer the exact requested level; otherwise keep the highest available <= level.
    if (!prev) {
      byStory.set(row.story_id, row);
    } else if (row.level === level && prev.level !== level) {
      byStory.set(row.story_id, row);
    } else if (row.level > prev.level && row.level <= level) {
      byStory.set(row.story_id, row);
    }
  }

  const ttl = Math.max(60, Math.min(3600, Number(process.env.RADIO_SIGNED_URL_SECS || 3600)));
  const out = [];
  const storyList = stories || [];

  for (let voiceRotationIndex = 0; voiceRotationIndex < storyList.length; voiceRotationIndex++) {
    const s = storyList[voiceRotationIndex];
    const row = byStory.get(s.id);
    if (!row) continue;

    const displayLines = linesForTts(row.display_body);
    const sentencePaths = Array.isArray(row.sentence_audio_paths) ? row.sentence_audio_paths : [];
    let audioUrl = null;
    let sentences = [];

    if (sentencePaths.length > 0) {
      const signedSentenceUrls = [];
      for (const p of sentencePaths) {
        const { data: signed, error: signErr } = await admin.storage.from("radio-audio").createSignedUrl(p, ttl);
        signedSentenceUrls.push(!signErr && signed?.signedUrl ? signed.signedUrl : null);
      }
      const lineGlosses = row.meta?.line_word_glosses_en;
      sentences = displayLines.map((text, i) => ({
        text,
        audioUrl: signedSentenceUrls[i] || null,
        wordGlossesEn: Array.isArray(lineGlosses) ? lineGlosses[i] : null,
        grokVoiceRequest: buildXaiTtsSentenceRequest({
          displayBody: row.display_body,
          ttsBody: row.tts_body,
          lineIndex: i,
          voiceRotationIndex,
        }),
      }));
      audioUrl = signedSentenceUrls[0] || null;
    } else if (row.audio_path) {
      const { data: signed, error: signErr } = await admin.storage
        .from("radio-audio")
        .createSignedUrl(row.audio_path, ttl);
      if (!signErr && signed?.signedUrl) {
        audioUrl = signed.signedUrl;
      }
      // Legacy single clip: one tap-to-play item until backfill splits TTS per line.
      sentences = [
        {
          text: row.display_body,
          audioUrl,
          wordGlossesEn: Array.isArray(row.meta?.line_word_glosses_en)
            ? row.meta.line_word_glosses_en[0]
            : null,
          grokVoiceRequest: buildXaiTtsSentenceRequest({
            displayBody: row.display_body,
            ttsBody: row.tts_body,
            lineIndex: 0,
            voiceRotationIndex,
          }),
        },
      ];
    } else {
      const lineGlossesNoAudio = row.meta?.line_word_glosses_en;
      sentences = displayLines.map((text, i) => ({
        text,
        audioUrl: null,
        wordGlossesEn: Array.isArray(lineGlossesNoAudio) ? lineGlossesNoAudio[i] : null,
        grokVoiceRequest: buildXaiTtsSentenceRequest({
          displayBody: row.display_body,
          ttsBody: row.tts_body,
          lineIndex: i,
          voiceRotationIndex,
        }),
      }));
    }

    if (sentences.length === 0 && row.display_body) {
      sentences = [
        {
          text: row.display_body,
          audioUrl: null,
          wordGlossesEn: Array.isArray(row.meta?.line_word_glosses_en)
            ? row.meta.line_word_glosses_en[0]
            : null,
          grokVoiceRequest: buildXaiTtsSentenceRequest({
            displayBody: row.display_body,
            ttsBody: row.tts_body,
            lineIndex: 0,
            voiceRotationIndex,
          }),
        },
      ];
    }

    const { text: voiceInputText } = buildXaiTtsRequestPreview({
      displayBody: row.display_body,
      ttsBody: row.tts_body,
      level: row.level,
      voiceRotationIndex,
    });

    out.push({
      id: s.id,
      title: s.title,
      createdAt: s.created_at,
      language: s.language,
      englishSource: s.english_source || null,
      level: row.level,
      displayBody: row.display_body,
      sentences,
      voiceInputText,
      audioUrl,
      durationSec: row.duration_sec,
      meta: row.meta || {},
    });
  }

  res.status(200).json({
    topic,
    level,
    stories: out,
    signedUrlExpiresInSec: ttl,
  });
}

async function handleProgress(req, res) {
  const url = (process.env.SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) {
    res.status(503).json({ error: "Supabase not configured" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userErr,
  } = await admin.auth.getUser(token);
  if (userErr || !user) {
    res.status(401).json({ error: "Invalid session" });
    return;
  }

  if (req.method === "GET") {
    const topic = String((req.query && req.query.topic) || "").trim();

    let completionsQuery = admin
      .from("radio_story_completions")
      .select("story_id,level,completed_at")
      .eq("user_id", user.id)
      .order("completed_at", { ascending: false })
      .limit(500);

    if (topic) {
      const { data: sid } = await admin.from("radio_stories").select("id").eq("topic_slug", topic);
      const ids = (sid || []).map((r) => r.id);
      if (ids.length === 0) {
        const { data: streakRow } = await admin
          .from("radio_user_streak")
          .select("streak,last_complete_day")
          .eq("user_id", user.id)
          .maybeSingle();
        res.status(200).json({
          streak: streakRow?.streak ?? 0,
          lastCompleteDay: streakRow?.last_complete_day ?? null,
          completed: [],
        });
        return;
      }
      completionsQuery = completionsQuery.in("story_id", ids);
    }

    const [{ data: completions }, { data: streakRow }] = await Promise.all([
      completionsQuery,
      admin.from("radio_user_streak").select("streak,last_complete_day").eq("user_id", user.id).maybeSingle(),
    ]);

    res.status(200).json({
      streak: streakRow?.streak ?? 0,
      lastCompleteDay: streakRow?.last_complete_day ?? null,
      completed: (completions || []).map((c) => ({
        storyId: c.story_id,
        level: c.level,
        completedAt: c.completed_at,
      })),
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const storyId = String(body.storyId || "").trim();
  const level = Number(body.level);
  if (!UUID_RE.test(storyId) || !Number.isFinite(level) || level < RADIO_LEVEL_MIN || level > RADIO_LEVEL_MAX) {
    res.status(400).json({ error: `storyId and level ${RADIO_LEVEL_MIN}–${RADIO_LEVEL_MAX} required` });
    return;
  }

  const { error: insErr } = await admin.from("radio_story_completions").upsert({
    user_id: user.id,
    story_id: storyId,
    level,
    completed_at: new Date().toISOString(),
  });

  if (insErr) {
    console.error("radio completion", insErr);
    res.status(500).json({ error: "Could not save completion" });
    return;
  }

  const streak = await bumpStreak(admin, user.id);
  res.status(200).json({ ok: true, streak });
}

async function handleRadioIngest(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const url = (process.env.SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) {
    res.status(503).json({ error: "Supabase not configured" });
    return;
  }
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authz = await radioAdminFromRequest(req, admin);
  if (authz.error) {
    res.status(authz.error.status).json(authz.error.json);
    return;
  }
  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  const dryRun = Boolean(body.dryRun);
  const debugTrace = Boolean(body.debugTrace);
  const topicSlug = String(body.topicSlug || "tech").trim() || "tech";
  const skipTts = Boolean(body.skipTts);
  let replaceTopic;
  if (body.replaceTopic === true) replaceTopic = true;
  else if (body.replaceTopic === false) replaceTopic = false;
  else replaceTopic = envTruthy("RADIO_REPLACE_TOPIC_ON_INGEST");

  // Per-ingest level overrides from the admin Niveles panel. Each entry is
  // { level, enabled?, prompt? }. Missing levels default to enabled with the
  // hardcoded prompt (see lib/radioLevels.js). Cron never sets this so
  // scheduled runs stay on defaults.
  let levelOverrides;
  if (body.levels !== undefined) {
    if (!Array.isArray(body.levels)) {
      res.status(400).json({ error: "levels must be an array" });
      return;
    }
    const parsed = [];
    for (const raw of body.levels) {
      if (!raw || typeof raw !== "object") {
        res.status(400).json({ error: "each level override must be an object" });
        return;
      }
      const levelNum = Number(raw.level);
      if (!Number.isFinite(levelNum) || levelNum < 1 || levelNum > 100) {
        res.status(400).json({ error: `invalid level: ${raw.level}` });
        return;
      }
      const entry = { level: levelNum };
      if (typeof raw.enabled === "boolean") entry.enabled = raw.enabled;
      if (raw.prompt !== undefined) {
        if (typeof raw.prompt !== "string") {
          res.status(400).json({ error: `level ${levelNum}: prompt must be a string` });
          return;
        }
        entry.prompt = raw.prompt;
      }
      parsed.push(entry);
    }
    levelOverrides = parsed;
  }

  try {
    const out = await runRadioIngest({ dryRun, topicSlug, replaceTopic, debugTrace, skipTts, levelOverrides });
    if (!out.ok) {
      const errStr =
        typeof out.error === "string" && out.error.trim()
          ? out.error.trim()
          : out.error != null
            ? String(out.error)
            : "Ingest failed (no error message from pipeline; see ingestTrace).";
      res.status(502).json({ ...out, ok: false, error: errStr });
      return;
    }
    res.status(200).json(out);
  } catch (e) {
    console.error("radio ingest", e);
    res.status(500).json({ ok: false, error: e.message || String(e) || "ingest failed" });
  }
}

async function handleRadioTtsPreview(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const url = (process.env.SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) {
    res.status(503).json({ error: "Supabase not configured" });
    return;
  }
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authz = await radioAdminFromRequest(req, admin);
  if (authz.error) {
    res.status(authz.error.status).json(authz.error.json);
    return;
  }
  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  const storyId = String(body.storyId || "").trim();
  const level = levelFromQuery(body.level);
  if (!UUID_RE.test(storyId)) {
    res.status(400).json({ error: "storyId must be a UUID" });
    return;
  }

  const { data: story, error: sErr } = await admin
    .from("radio_stories")
    .select("id,topic_slug")
    .eq("id", storyId)
    .maybeSingle();
  if (sErr) {
    res.status(500).json({ error: sErr.message });
    return;
  }
  if (!story) {
    res.status(404).json({ error: "Story not found" });
    return;
  }

  const { data: row, error: lErr } = await admin
    .from("radio_story_levels")
    .select("story_id,level,display_body,tts_body")
    .eq("story_id", storyId)
    .eq("level", level)
    .maybeSingle();
  if (lErr) {
    res.status(500).json({ error: lErr.message });
    return;
  }
  if (!row) {
    res.status(404).json({ error: "No radio_story_levels row for this story and level" });
    return;
  }

  const { data: ordered } = await admin
    .from("radio_stories")
    .select("id")
    .eq("topic_slug", story.topic_slug)
    .order("created_at", { ascending: false });
  let voiceRotationIndex = (ordered || []).findIndex((r) => r.id === storyId);
  if (voiceRotationIndex < 0) voiceRotationIndex = 0;

  const usedStoredTtsBody = Boolean(row.tts_body && String(row.tts_body).trim());
  const ttsBody = buildXaiTtsRequestPreview({
    displayBody: row.display_body || "",
    ttsBody: row.tts_body,
    level: row.level,
    voiceRotationIndex,
  });
  const maxChars = Math.max(1, Number(process.env.RADIO_TTS_MAX_CHARS || 12000));

  res.status(200).json({
    ok: true,
    method: "POST",
    url: "https://api.x.ai/v1/tts",
    body: ttsBody,
    debug: {
      storyId,
      level: row.level,
      topic_slug: story.topic_slug,
      usedStoredTtsBody,
      voiceRotationIndex,
      textCharCount: ttsBody.text.length,
      maxCharsApplied: maxChars,
    },
  });
}

async function handleBackfillTts(req, res) {
  const url = (process.env.SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) {
    res.status(503).json({ error: "Supabase not configured" });
    return;
  }

  let body = {};
  if (req.method === "POST") {
    try {
      body = await readJsonBody(req);
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
  } else if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const q = req.query || {};
  const topicSlug = String(body.topicSlug || q.topic || q.topicSlug || "tech").trim() || "tech";
  const limitRaw = body.limit !== undefined && body.limit !== null ? body.limit : q.limit;
  const limit = Number(limitRaw);

  if (authorizeCron(req)) {
    try {
      const out = await runRadioBackfillTts({
        topicSlug,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      if (!out.ok && !out.updated && out.error) {
        res.status(502).json(out);
        return;
      }
      res.status(200).json(out);
    } catch (e) {
      console.error("radio backfill tts", e);
      res.status(500).json({ ok: false, error: e.message || "backfill failed" });
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authz = await radioAdminFromRequest(req, admin);
  if (authz.error) {
    res.status(authz.error.status).json(authz.error.json);
    return;
  }

  try {
    const out = await runRadioBackfillTts({
      topicSlug,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    if (!out.ok && !out.updated && out.error) {
      res.status(502).json(out);
      return;
    }
    res.status(200).json(out);
  } catch (e) {
    console.error("radio backfill tts", e);
    res.status(500).json({ ok: false, error: e.message || "backfill failed" });
  }
}

/**
 * Radio Zumo HTTP handlers (mounted under /api/newspaper?radio=… to save Vercel function slots).
 * radio=cron|feed|progress|ingest|backfill-tts|tts-preview (tts-preview: admin JWT POST body { storyId, level } — dev xAI TTS JSON preview)
 */
async function dispatchRadio(req, res, op) {
  res.setHeader("Content-Type", "application/json");
  const o = String(op || "").trim().toLowerCase();
  if (o === "cron") {
    await handleCron(req, res);
    return;
  }
  if (o === "feed") {
    await handleFeed(req, res);
    return;
  }
  if (o === "progress") {
    await handleProgress(req, res);
    return;
  }
  if (o === "ingest") {
    await handleRadioIngest(req, res);
    return;
  }
  if (o === "backfill-tts") {
    await handleBackfillTts(req, res);
    return;
  }
  if (o === "tts-preview") {
    await handleRadioTtsPreview(req, res);
    return;
  }
  res.status(400).json({
    error:
      "Unknown radio action (use cron|feed|progress|ingest|backfill-tts|tts-preview). backfill-tts accepts cron Bearer.",
  });
}

module.exports = { dispatchRadio };
