require("./loadEnv")();

const { createClient } = require("@supabase/supabase-js");
const { ensureRadioLevelCheckConstraints } = require("./ensureRadioLevelCheck");
const { DEFAULT_LEVELS, resolveActiveLevels } = require("./radioLevels");

const LEVEL_CONSTRAINT_HINT_NO_DB_URL =
  "Set SUPABASE_DATABASE_URL or DATABASE_URL so ingest can auto-apply level 1–6 CHECK constraints, or run supabase/migrations/012_radio_six_levels_check.sql in the Supabase SQL editor if inserts fail on level.";

const LEVEL_CONSTRAINT_HINT_CHECK_FAIL =
  "Postgres rejected a level row (often CHECK level 1–6). Run 012_radio_six_levels_check.sql or set DATABASE_URL so ingest can apply constraints.";

/**
 * @param {unknown} err
 * @returns {{ error: string, message: string, hint?: string, code?: string }}
 */
function mapRadioLevelsInsertError(err) {
  const raw = err && typeof err === "object" ? err : {};
  const code = raw.code != null ? String(raw.code) : "";
  const msg = raw.message != null ? String(raw.message) : String(err || "insert failed");
  const details = raw.details != null ? String(raw.details) : "";
  const combined = `${msg} ${details}`.toLowerCase();
  const isCheck =
    code === "23514" ||
    /check constraint/i.test(msg) ||
    /violates check constraint/i.test(combined) ||
    /radio_story_levels_level_check/i.test(combined);
  if (isCheck) {
    return {
      error: `Database rejected level rows (check constraint): ${msg}`,
      message: msg,
      code: code || undefined,
      hint: LEVEL_CONSTRAINT_HINT_CHECK_FAIL,
    };
  }
  return {
    error: msg,
    message: msg,
    code: code || undefined,
  };
}

const RESPONSES_POLL_MS = 1500;
const RESPONSES_MAX_WAIT_MS = 120_000;

/** Soft target for Stage 1 `english_article` length (prompt only; not server-validated). */
const RADIO_ENGLISH_ARTICLE_TARGET_WORDS = 150;

/** How many stories Stage 1 should return and replace-ingest caps at. Default 3 for dev cost; set RADIO_INGEST_STORY_TARGET=10 in production. Clamped 1–10. */
function ingestStoryTarget() {
  const raw = (process.env.RADIO_INGEST_STORY_TARGET || "3").trim();
  const n = Number(raw);
  const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
  return Math.max(1, Math.min(10, v));
}

function buildStage1Instructions(n) {
  return (
    "Use tools for everything time-sensitive — do not rely on training memory for recency.\n\n" +
    "Each story must be **new or newly salient within the rolling 24 hours before the `Current UTC time` line** in the user message (not merely “trending for a week” or evergreen SEO hits).\n\n" +
    `Workflow: (1) **x_search** first — within the tool date window, pick **which** ${n} tech storylines qualify for that rolling 24h rule. ` +
    "(2) **web_search** only to **verify and expand** those **same** X-picked events — do **not** use web to discover unrelated top stories. Prefer sources whose dates or ledes fall inside the window; if the best web hits are clearly **older than that 24h window**, **drop** the candidate and substitute another from X.\n\n" +
    `Each story's **english_article** should aim for **about ${RADIO_ENGLISH_ARTICLE_TARGET_WORDS} English words** when sources support it—substantive journalistic summary, no padding or invented detail.\n\n` +
    "Your final reply must be ONE JSON object only (no markdown fences, no prose outside JSON)."
  );
}

function buildStage1UserTask(n) {
  return `Current UTC time will be given below (call this T). Every story must fall in the rolling **24 hours before T** (new report, new filing, new launch, new legal ruling, or a **new development** that makes an older topic newly newsworthy within that window).

Return JSON with exactly this shape:
{"stories":[{"title":"string","significance":1,"english_article":"string","as_of":"2026-03-29T14:00:00.000Z"}]}

Workflow (both tools are available — follow this order):
1) **x_search**: Shortlist **${n} distinct** major **technology industry** storylines (products, AI, chips, security, major tech business, platforms, developer tools) that satisfy the rolling 24h-before-T rule using the tool date window.
2) **web_search**: For **each** of the ${n}, confirm/expand **only that** X-picked event. Do **not** pivot to a different story because web ranked an older article higher. If web cannot support recency within the window, drop and replace with another X candidate.

Rules:
- Exactly **${n}** objects in "stories". Each must be a **distinct** major tech story grounded in the workflow above. Rows with invalid **as_of** or missing fields may be **dropped server-side**; aim for ${n} that all pass.
- **as_of**: When the story became news for this run. Use **ISO-8601 UTC** with Z (e.g. \`2026-03-29T14:00:00.000Z\`). **YYYY-MM-DD** alone is accepted (treated as noon UTC). Must be **grounded in tool output** (snippet times / article dates), not invented. Must fall within the rolling **~24–30h before T** window (server checks; see RADIO_RECENCY_BUFFER_HOURS).
- No two "title" strings may be the same story: wording must differ enough that two headlines are not trivial rephrases of one another (otherwise downstream dedupe drops duplicates and breaks the batch).
- "title": concise headline in English.
- "significance": integer 1–10 (10 = major). Stories below 5 should be rare; prefer strong industry signal.
- "english_article": **journalistic summary in English** — prose paragraphs, no bullet lists; **aim for about ${RADIO_ENGLISH_ARTICLE_TARGET_WORDS} words** when **web_search** (and X context where still accurate) supports that much detail. State only what the tools support; if evidence is thin, a shorter piece is fine—say so briefly and do not pad.
- Do not invent specific numbers, fines, or product names without search support.`;
}

const STAGE2_SYSTEM =
  "You convert English tech news into Spanish for language learners. Reply with ONE JSON object only (no markdown). " +
  "Do not add facts, names, numbers, or claims that are not in the English source. Same story, same facts. " +
  "Each line of body_es must start with Spanish words—never start a line with an English word; use a short Spanish lead-in before any foreign brand or name (e.g. \"La empresa Apple...\" not \"Apple...\"). " +
  "In JSON string values (especially word_glosses_en), use only straight ASCII double quotes; escape any inner \" as \\\". Do not paste smart quotes or raw line breaks inside strings.";

const STAGE2B_SYSTEM =
  "You rewrite Spanish news lines for text-to-speech in European Spanish. Reply with ONE JSON object only (no markdown). " +
  "Preserve meaning and line breaks. Do not add facts. Do not output <slow> tags or [pause] markers.";

/**
 * Render Stage 2 user prompt for the given set of active levels.
 *
 * @param {string} title
 * @param {string} englishArticle
 * @param {Array<{level:number, cefr:string, prompt:string}>} activeLevels
 */
function stage2UserPrompt(title, englishArticle, activeLevels) {
  const levels = Array.isArray(activeLevels) && activeLevels.length > 0 ? activeLevels : [];
  const levelList = levels.map((L) => String(L.level)).join(", ");
  const skeleton = levels
    .map(
      (L) =>
        `{"level":${L.level},"body_es":"…","word_glosses_en":[[…],[…]]}`
    )
    .join(",\n");
  const levelBlocks = levels
    .map((L) => `**Level ${L.level} (${L.cefr}):** ${L.prompt}`)
    .join("\n\n");
  return `Title: ${title}\n\nEnglish source (ground truth — do not contradict):\n${englishArticle}\n\nReturn JSON with exactly ${levels.length} level${levels.length === 1 ? "" : "s"} (levels in order: ${levelList}) — plain Spanish for reading only, no TTS tags like [pause] or <slow> in body_es:
{"levels":[
${skeleton}
],"hard_words":[{"term":"Spanish word or phrase","gloss_en":"short English hint"}],"bridge_mcq":{"question_en":"English question about the story","options":["A","B","C","D"],"correct":0}}

**Format for each body_es:** **${RADIO_BODY_LINES_MIN}–${RADIO_BODY_LINES_MAX} separate sentences** (aim ~20). **One sentence per line** (newline between lines, no blank lines). This is the text shown to the user.

**word_glosses_en (required, per level):** An array with **one inner array per line** of body_es (same order, same count as non-empty lines). Each inner array has **one short English gloss string per whitespace-separated token** on that line (split on spaces; tokens include attached punctuation like "word,"). Same length as tokens on that line. Use literal translation or gloss for each token so learners see every word covered.

**Spanish token order is MANDATORY — do not reorder to English grammar.** The i-th gloss must describe the i-th Spanish token in body_es, **left to right**. Function words ("de", "del", "la", "el", "a", "al", "en", "que", "un", "una", "los", "las") each get their own gloss slot, and articles/contractions stay **one gloss per token**. If English would naturally reorder the words, you **still** stay in Spanish order and use literal token-by-token glosses. Examples:
- Line "memoria de bajo consumo" (4 tokens) → ["memory", "of", "low", "consumption"] — **NOT** ["low", "consumption", "memory"].
- Line "Realizaron esfuerzos." (2 tokens) → ["They carried out", "efforts."].
- Line "servidores de IA." (3 tokens) → ["servers", "of", "AI."] — **NOT** ["AI", "servers."].

**Never merge an article with the next word, never split a contraction.** Articles and contractions are single tokens → single glosses:
- Line "El software" (2 tokens) → ["The", "software"] — **NOT** ["The software"] under "El".
- Line "La empresa anunció" (3 tokens) → ["The", "company", "announced"] — **NOT** ["The company", "announced", ""].
- Line "captura movimientos del mouse." (4 tokens) → ["captures", "movements", "of the", "mouse."] — **NOT** ["captures", "movements", "of", "the mouse."] and **NOT** ["captures movements", "of", "the", "mouse."].
- "del" (one token) → **one** gloss "of the"; "al" (one token) → **one** gloss "to the". Never spread these across two cells.
- Articles "el", "la", "los", "las", "un", "una" → one single-word English gloss each ("the", "the", "the", "the", "a", "a"). Never glue the following noun into the article's gloss cell.

**Pro-drop verbs keep their full English phrase in ONE cell.** Spanish drops the subject pronoun (Spanish is pro-drop), so verbs like "es", "son", "era", "eran", "fue", "fueron", "hay", "hubo", "será", "está", "están", "estaba" translate to multi-word English ("it is", "they are", "there is/was", …). Put the **whole** English phrase in the **single** gloss cell for that Spanish verb — never split it across cells.
- Line "Es un modelo de IA." (5 tokens) → ["It is", "a", "model", "of", "AI."] — **NOT** ["It", "is", "a", "model", "of"] (shifts everything left and drops "AI.").
- Line "Hay un problema." (3 tokens) → ["There is", "a", "problem."] — **NOT** ["There", "is", "a"] across three cells.
- Line "Hubo una asociación." (3 tokens) → ["There was", "a", "partnership."] — **NOT** ["There", "was", "a"].
- Line "Son empresas grandes." (3 tokens) → ["They are", "companies", "big."] — **NOT** ["They", "are", "companies"].

**Token = one gloss (strict):** Split each line on whitespace only. Each **maximal run of non-whitespace** is **exactly one** token and gets **exactly one** gloss—never split it. Examples: \`$5B\`, \`$100B\`, \`US$\`, \`100.000\`, \`AWS\`, \`5.000\` are each **one** token (not "$" + "5B"). Hyphenated or slashed forms without spaces are one token. (The client tokenizer in \`newsroom/src/App.jsx → lineWordTokens\` applies the same rule — keep them aligned.)

**Language by level** (complexity and vocabulary increase with level; same line count band per level):

${levelBlocks}

Rules:
- Same core facts as the English source at every level; simplify wording at lower levels without omitting the main points.
- **Every line** must start with a Spanish word (article, demonstrative, verb, etc.)—never start a line with an English proper name, brand, or English technical term; introduce them after a Spanish lead-in on that line.
- **Separate every Spanish word with a space** in body_es—do not concatenate words (e.g. not "desarrollaronsiliconas"; use "Desarrollaron siliconas").
- Arabic numerals are OK in body_es (e.g. years, counts); a later step will spell them out for audio.
- hard_words: 6–12 items for the hardest Spanish terms used (any level).
- bridge_mcq.correct is 0–3 index into options.`;
}

function stage2RetryUserPrompt(title, englishArticle, validationError, attempt, maxAttempts, glossHint, activeLevels) {
  const hintBlock =
    glossHint &&
    typeof glossHint.level === "number" &&
    typeof glossHint.lineIdx === "number" &&
    Array.isArray(glossHint.tokens) &&
    glossHint.tokens.length > 0
      ? `\n\n**Fix word_glosses_en:** On **level ${glossHint.level}**, **line ${glossHint.lineIdx + 1}** of that level's body_es, the server counts **${glossHint.tokens.length}** whitespace tokens. word_glosses_en[${glossHint.lineIdx}] for that level must be an array of **exactly ${glossHint.tokens.length}** non-empty English strings in the **same order**—one gloss per token, no extra splits.\nExact token list: ${JSON.stringify(glossHint.tokens)}`
      : "";
  return (
    `${stage2UserPrompt(title, englishArticle, activeLevels)}\n\n---\n` +
    `**Retry ${attempt}/${maxAttempts}:** The server rejected your previous JSON.\n` +
    `**Reason:** ${validationError}\n` +
    `Return ONE corrected JSON object (same shape as above). Each body_es must have **${RADIO_BODY_LINES_MIN}–${RADIO_BODY_LINES_MAX}** non-empty lines (one sentence per line, no blank lines). ` +
    `Each level must include **word_glosses_en**: one array per line, each with one non-empty English gloss per whitespace token on that line (same counts as the server error stated).` +
    hintBlock
  );
}

function stage2bUserPrompt(levels) {
  const blocks = levels
    .map(
      (L) =>
        `### Level ${L.level}\n` +
        `body_es (one sentence per line — preserve this line count and order):\n` +
        `${L.body_es}`
    )
    .join("\n\n");

  const jsonExample = levels
    .map((L) => `{"level":${L.level},"tts_es":"…"}`)
    .join(",");

  return `${blocks}\n\nFor each level, produce **tts_es**: the same Spanish content transformed for TTS:\n` +
    `1) Replace **every** Arabic numeral or numeric expression with **Spanish words** (e.g. 15 → quince, 2024 → dos mil veinticuatro, 100 → cien).\n` +
    `2) Replace **English** proper names, brands, and untranslated English technical terms with **Spanish-friendly phonetic spelling** (Spanish letters + stress marks like á, é, í, ó, ú where a Spanish reader would stress the syllable—not English spelling). **Do not** make them look like English headline names: use **sentence-style casing** (lowercase inside the line except the first character of the line if it starts the sentence). **No** Title Case on name chunks (avoid “Tim Kuk”). Prefer **one tight phonetic chunk or lowercase words** that blend into the sentence (e.g. mid-line *tim kúk* or *el directivo tim kúk*), not two capitalized tokens that read as “Firstname Lastname”. Keep the same real-world entity; only the surface form for TTS changes.\n` +
    `3) Insert **commas** everywhere a short pause would sound natural (clause boundaries, after short introductory phrases, before coordinating conjunctions in longer lines, etc.)—be generous.\n` +
    `4) Keep the **same number of lines** as the input body_es, in the **same order**. One sentence per line. **No** <slow> tags.\n\n` +
    `Return JSON only:\n` +
    `{"levels":[${jsonExample}]}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envTruthy(name) {
  const v = (process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Timestamped ingest steps (returned as `ingestTrace` in API JSON + logged as [radio-ingest …]).
 * @returns {{ add: (step: string, detail?: Record<string, unknown>) => void, steps: Array<Record<string, unknown>> }}
 */
function createIngestTrace() {
  const t0 = Date.now();
  const steps = [];
  return {
    add(step, detail) {
      const ms = Date.now() - t0;
      const row = { ms, step };
      if (detail != null && typeof detail === "object" && !Array.isArray(detail)) {
        Object.assign(row, detail);
      } else if (detail != null) {
        row.detail = detail;
      }
      steps.push(row);
      try {
        const short =
          detail != null && typeof detail === "object"
            ? JSON.stringify(detail).slice(0, 500)
            : detail;
        console.log(`[radio-ingest +${ms}ms] ${step}`, short != null ? short : "");
      } catch (_) {
        console.log(`[radio-ingest +${ms}ms] ${step}`);
      }
    },
    steps,
  };
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 95_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function parseJsonBodyText(rawText) {
  if (!rawText || !rawText.trim()) return {};
  try {
    return JSON.parse(rawText);
  } catch {
    return { _unparsed: rawText };
  }
}

function extractResponsesOutputText(data) {
  const out = data?.output;
  if (!Array.isArray(out)) return "";
  const parts = [];
  for (const item of out) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === "output_text" && typeof c.text === "string") parts.push(c.text);
      }
    }
  }
  return parts.join("\n").trim();
}

async function postResponsesAndPoll(apiKey, body, maxWaitMs = RESPONSES_MAX_WAIT_MS) {
  let r;
  try {
    r = await fetchWithTimeout(
      "https://api.x.ai/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      100_000
    );
  } catch (e) {
    return { ok: false, err: e.name === "AbortError" ? "Responses request timed out" : e.message };
  }

  const rawPost = await r.text();
  let data = parseJsonBodyText(rawPost);
  if (!r.ok) {
    return { ok: false, status: r.status, err: rawPost.slice(0, 400) };
  }

  const start = Date.now();
  let cur = data;
  while (cur.status === "in_progress" && Date.now() - start < maxWaitMs) {
    await sleep(RESPONSES_POLL_MS);
    let gr;
    try {
      gr = await fetchWithTimeout(
        `https://api.x.ai/v1/responses/${cur.id}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
        55_000
      );
    } catch (e) {
      return { ok: false, err: e.message };
    }
    const t = await gr.text();
    cur = parseJsonBodyText(t);
    if (!gr.ok) return { ok: false, status: gr.status, err: t.slice(0, 400) };
  }

  if (cur.status !== "completed" && cur.status !== "incomplete") {
    return { ok: false, err: cur.error?.message || `status ${cur.status}` };
  }

  return { ok: true, text: extractResponsesOutputText(cur) };
}

function xSearchDateRange() {
  // Default 48h back so Grok's daily x_search window covers "yesterday or today" + the
  // trailing morning-UTC of the day before (articles often publish at 00:00–06:00 UTC,
  // which a pure 24h window was rejecting as "too old"). Override with RADIO_XSEARCH_LOOKBACK_HOURS.
  const lookback = Math.max(
    24,
    Math.min(96, Number(process.env.RADIO_XSEARCH_LOOKBACK_HOURS || 48))
  );
  const now = new Date();
  const ago = new Date(now.getTime() - lookback * 60 * 60 * 1000);
  const ymd = (d) => d.toISOString().slice(0, 10);
  return { from_date: ymd(ago), to_date: ymd(now) };
}

function fingerprintFromTitle(title) {
  return String(title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 96);
}

/** Slice from first `{` to matching `}` with string/escape awareness (avoids broken lastIndexOf("}") cuts). */
function sliceBalancedJsonObject(t) {
  const start = t.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

/** Remove trailing commas before ] or } (invalid JSON; models often emit them). Not string-aware; safe for normal payloads. */
function stripTrailingCommasJson(s) {
  let out = s;
  let guard = 0;
  while (guard < 32) {
    const next = out.replace(/,(\s*[\]}])/g, "$1");
    if (next === out) break;
    out = next;
    guard++;
  }
  return out;
}

function tryParseJsonObject(text) {
  let t = String(text || "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/im);
  if (fenced) t = fenced[1].trim();
  let candidate = sliceBalancedJsonObject(t);
  if (!candidate) {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("No JSON object in model output");
    candidate = t.slice(start, end + 1);
  }
  const attempts = [() => JSON.parse(candidate), () => JSON.parse(stripTrailingCommasJson(candidate))];
  let lastErr;
  for (const fn of attempts) {
    try {
      return fn();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function wordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

const RADIO_LEVEL_MIN = 1;
const RADIO_LEVEL_MAX = 6;

/** Target line count per level for Stage 2 body_es (one sentence per line). */
const RADIO_BODY_LINES_MIN = 10;
const RADIO_BODY_LINES_MAX = 40;

function stage2MaxAttempts() {
  const n = Number(process.env.RADIO_STAGE2_MAX_ATTEMPTS || "5");
  return Number.isFinite(n) ? Math.max(1, Math.min(8, Math.floor(n))) : 5;
}

const _ES_UNITS = [
  "cero",
  "uno",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
];
const _ES_TEENS = [
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciséis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
];
const _ES_TENS = [
  "",
  "",
  "veinte",
  "treinta",
  "cuarenta",
  "cincuenta",
  "sesenta",
  "setenta",
  "ochenta",
  "noventa",
];

/** @param {number} n 0–99 */
function _spanishUnder100(n) {
  if (n < 10) return _ES_UNITS[n];
  if (n < 20) return _ES_TEENS[n - 10];
  if (n < 30) {
    if (n === 20) return "veinte";
    if (n === 22) return "veintidós";
    if (n === 23) return "veintitrés";
    if (n === 26) return "veintiséis";
    return "veinti" + _ES_UNITS[n % 10];
  }
  const ten = Math.floor(n / 10);
  const u = n % 10;
  if (u === 0) return _ES_TENS[ten];
  const joiner = ten === 2 ? " y " : " y ";
  let unit = _ES_UNITS[u];
  if (u === 1) unit = "uno";
  if (u === 2 && ten >= 3) unit = "dos";
  if (u === 3 && ten >= 3) unit = "tres";
  return _ES_TENS[ten] + joiner + unit;
}

/** @param {number} n integer ≥ 0 */
function integerToSpanishWords(n) {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n === 0) return "cero";
  if (n < 100) return _spanishUnder100(n);
  if (n === 100) return "cien";
  if (n < 200) return "ciento" + (n === 100 ? "" : " " + _spanishUnder100(n - 100));
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    const head =
      hundreds === 1
        ? "ciento"
        : hundreds === 2
          ? "doscientos"
          : hundreds === 3
            ? "trescientos"
            : hundreds === 4
              ? "cuatrocientos"
              : hundreds === 5
                ? "quinientos"
                : hundreds === 6
                  ? "seiscientos"
                  : hundreds === 7
                    ? "setecientos"
                    : hundreds === 8
                      ? "ochocientos"
                      : "novecientos";
    return rest ? head + " " + _spanishUnder100(rest) : head;
  }
  if (n < 1_000_000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    const head =
      thousands === 1 ? "mil" : integerToSpanishWords(thousands) + " mil";
    return rest ? head + " " + integerToSpanishWords(rest) : head;
  }
  if (n < 1_000_000_000) {
    const millions = Math.floor(n / 1_000_000);
    const rest = n % 1_000_000;
    const head =
      millions === 1 ? "un millón" : integerToSpanishWords(millions) + " millones";
    return rest ? head + " " + integerToSpanishWords(rest) : head;
  }
  return String(n);
}

/** Spell out Arabic numerals for TTS fallback (integers only; large n left as digits). */
function replaceNumeralsWithSpanishWords(text) {
  return String(text || "").replace(/\b\d{1,9}\b/g, (digits) => {
    const n = parseInt(digits, 10);
    if (!Number.isFinite(n)) return digits;
    return integerToSpanishWords(n);
  });
}

function countNonEmptyLines(body) {
  return String(body || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean).length;
}

/** @returns {string[]} one TTS chunk per line (newline format) or legacy sentence split. */
function linesForTts(body) {
  const t = String(body || "").trim();
  if (!t) return [];
  const rawLines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (rawLines.length >= 2) return rawLines;
  const chunks = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  if (chunks.length <= 1 && !/[.!?…]/.test(t)) {
    return rawLines.length === 1 ? rawLines : t ? [t] : [];
  }
  return chunks.map((s) => s.trim()).filter(Boolean);
}

/** @returns {string[]} non-empty sentence chunks (legacy). */
function splitSentencesForTts(body) {
  return linesForTts(body);
}

/** Sync TTS prep when Stage 2b is skipped or unavailable: numbers → words only. */
function syncTtsPrepFromDisplay(displayBody) {
  return replaceNumeralsWithSpanishWords(String(displayBody || "").trim());
}

/**
 * Plain TTS lines (no tags): one string per sentence line for ingest / storage.
 * @param {string} displayBody multiline display Spanish
 * @param {string} preppedMultiline Stage 2b tts_es when lengths match display lines
 * @param {boolean} usePrepped
 */
function getPlainTtsLinesFromBodies(displayBody, preppedMultiline, usePrepped) {
  const dLines = linesForTts(String(displayBody || ""));
  if (!dLines.length) return [];
  if (usePrepped && preppedMultiline) {
    const pLines = linesForTts(String(preppedMultiline).trim());
    if (pLines.length === dLines.length) return pLines.map((l) => l.trim()).filter(Boolean);
  }
  return dLines.map((ln) => syncTtsPrepFromDisplay(ln));
}

/** Plain lines from DB: newline plain tts_body, or regenerate from display. */
function plainLinesFromStoredTtsBody(displayBody, ttsBody) {
  const disp = String(displayBody || "");
  const tts = String(ttsBody || "").trim();
  if (tts && !/<\s*slow[\s>]/i.test(tts) && !/\[long-pause\]/i.test(tts)) {
    const fromStore = linesForTts(tts);
    const dLines = linesForTts(disp);
    if (fromStore.length === dLines.length && fromStore.length > 0) return fromStore;
  }
  return getPlainTtsLinesFromBodies(disp, "", false);
}

/**
 * One sentence for POST /v1/tts.
 * @param {string} line
 * @param {{ ttsPrepped?: boolean }} [opts]
 */
function wrapTtsForSingleSentence(line, opts = {}) {
  const raw = String(line || "").trim();
  if (!raw) return "";
  const plain = opts.ttsPrepped ? raw : syncTtsPrepFromDisplay(raw);
  return `<slow> ${plain.trim()} </slow>`;
}

/**
 * Full article as one TTS string (preview / legacy). Uses display + optional Stage 2b multiline.
 * @param {string} displayBody
 * @param {number} [_level]
 * @param {{ preppedMultiline?: string }} [opts]
 */
function wrapTtsForLevel(displayBody, _level, opts = {}) {
  const lines = getPlainTtsLinesFromBodies(
    displayBody,
    opts.preppedMultiline || "",
    Boolean(opts.preppedMultiline)
  );
  if (!lines.length) return "";
  return lines
    .map((ln) => wrapTtsForSingleSentence(ln, { ttsPrepped: true }))
    .join(" ")
    .trim();
}

async function collectRadioAudioPathsForStories(admin, topicSlug, storyIds) {
  if (!storyIds.length) return [];
  const out = [];
  for (let i = 0; i < storyIds.length; i += 100) {
    const chunk = storyIds.slice(i, i + 100);
    const { data: levRows, error } = await admin
      .from("radio_story_levels")
      .select("story_id,level,audio_path,sentence_audio_paths")
      .in("story_id", chunk);
    if (error) throw error;
    for (const r of levRows || []) {
      if (Array.isArray(r.sentence_audio_paths) && r.sentence_audio_paths.length) {
        for (const p of r.sentence_audio_paths) {
          if (p) out.push(p);
        }
      } else if (r.audio_path) {
        out.push(r.audio_path);
      } else {
        out.push(`${topicSlug}/${r.story_id}/level_${r.level}.mp3`);
      }
    }
  }
  return out;
}

function wrapSentencesSlow(body) {
  return wrapTtsForLevel(body, 2);
}

function ttsSafeText(ttsBody) {
  return String(ttsBody || "")
    .replace(/\s+/g, " ")
    .trim();
}

const DEFAULT_RADIO_TTS_VOICES = Object.freeze(["rex", "sal", "leo", "ara"]);

function radioTtsLanguage() {
  const v = (process.env.RADIO_TTS_LANGUAGE || "es-ES").trim();
  return v || "es-ES";
}

function radioTtsVoicePool() {
  const raw = (process.env.RADIO_TTS_VOICES || "").trim();
  if (raw) {
    const parts = raw.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (parts.length) return parts;
  }
  return [...DEFAULT_RADIO_TTS_VOICES];
}

/** Unset RADIO_TTS_VOICE to rotate; if set, that single voice is used for all rows. */
function radioTtsVoiceForIndex(index) {
  const single = (process.env.RADIO_TTS_VOICE || "").trim().toLowerCase();
  if (single) return single;
  const pool = radioTtsVoicePool();
  if (!pool.length) return "rex";
  return pool[index % pool.length];
}

/**
 * Exact `{ text, voice_id, language }` sent to POST /v1/tts (after ttsSafeText + same clip as postTtsMp3).
 * Previews the **first sentence** only (per-sentence TTS in production).
 * @param {{ displayBody: string, ttsBody: string|null|undefined, level: number, voiceRotationIndex: number }} opts
 */
function buildXaiTtsRequestPreview({ displayBody, ttsBody, level, voiceRotationIndex }) {
  const disp = String(displayBody || "");
  const tts = String(ttsBody || "").trim();
  let lines = [];
  if (tts && !/<\s*slow[\s>]/i.test(tts) && !/\[long-pause\]/i.test(tts)) {
    const fromStore = linesForTts(tts);
    const dLines = linesForTts(disp);
    if (fromStore.length === dLines.length && fromStore.length > 0) lines = fromStore;
  }
  if (!lines.length) {
    lines = getPlainTtsLinesFromBodies(disp, "", false);
  }
  const inner = lines.length
    ? wrapTtsForSingleSentence(lines[0], { ttsPrepped: true })
    : wrapTtsForSingleSentence(syncTtsPrepFromDisplay(disp.slice(0, 800)), { ttsPrepped: true });
  const normalized = ttsSafeText(inner);
  const maxChars = Number(process.env.RADIO_TTS_MAX_CHARS || 12000);
  const text = normalized.length > maxChars ? normalized.slice(0, maxChars) : normalized;
  return {
    text,
    voice_id: radioTtsVoiceForIndex(voiceRotationIndex),
    language: radioTtsLanguage(),
  };
}

/**
 * Exact `{ text, voice_id, language }` sent to POST /v1/tts for one sentence line (same as each ingest clip).
 * @param {{ displayBody: string, ttsBody: string|null|undefined, lineIndex: number, voiceRotationIndex: number }} opts
 */
function buildXaiTtsSentenceRequest({ displayBody, ttsBody, lineIndex, voiceRotationIndex }) {
  const disp = String(displayBody || "");
  const displayLines = linesForTts(disp);
  const idx = Math.max(0, Math.min(Number(lineIndex) || 0, Math.max(0, displayLines.length - 1)));
  if (!displayLines.length) {
    return {
      text: "",
      voice_id: radioTtsVoiceForIndex(voiceRotationIndex),
      language: radioTtsLanguage(),
    };
  }
  const plainLines = plainLinesFromStoredTtsBody(disp, ttsBody);
  const linePlain =
    plainLines[idx] != null && plainLines.length === displayLines.length
      ? String(plainLines[idx]).trim()
      : syncTtsPrepFromDisplay(displayLines[idx] || "");
  const wrapped = wrapTtsForSingleSentence(linePlain, { ttsPrepped: true });
  const normalized = ttsSafeText(wrapped);
  const maxChars = Number(process.env.RADIO_TTS_MAX_CHARS || 12000);
  const text = normalized.length > maxChars ? normalized.slice(0, maxChars) : normalized;
  return {
    text,
    voice_id: radioTtsVoiceForIndex(voiceRotationIndex),
    language: radioTtsLanguage(),
  };
}

async function postTtsMp3(apiKey, text, voiceId, language) {
  const payload = ttsSafeText(text);
  if (!payload) throw new Error("Empty TTS text");
  const maxChars = Number(process.env.RADIO_TTS_MAX_CHARS || 12000);
  const clipped = payload.length > maxChars ? payload.slice(0, maxChars) : payload;

  const maxAttempts = Math.max(1, Math.min(6, Number(process.env.RADIO_TTS_MAX_ATTEMPTS || 3)));
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await fetchWithTimeout(
      "https://api.x.ai/v1/tts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: clipped,
          voice_id: voiceId,
          language: language || "es",
        }),
      },
      120_000
    );
    if (r.ok) {
      return Buffer.from(await r.arrayBuffer());
    }
    const errText = await r.text();
    lastErr = new Error(`TTS failed ${r.status}: ${errText.slice(0, 300)}`);
    const retryable = r.status === 429 || r.status === 502 || r.status === 503 || r.status === 504;
    if (!retryable || attempt === maxAttempts) {
      throw lastErr;
    }
    const backoff = Math.min(30_000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
    await sleep(backoff);
  }
  throw lastErr || new Error("TTS failed");
}

function radioTtsIngestConcurrency() {
  const raw = Number(process.env.RADIO_TTS_INGEST_CONCURRENCY || 8);
  if (!Number.isFinite(raw)) return 8;
  return Math.max(1, Math.min(24, Math.floor(raw)));
}

/**
 * Per-level sentence TTS: parallel chunks capped by RADIO_TTS_INGEST_CONCURRENCY; output paths stay in sentence order.
 */
async function ttsUploadSentenceClipsForLevel({
  apiKey,
  admin,
  linePlain,
  voiceId,
  ttsLang,
  pathPrefix,
  levelNum,
}) {
  const n = linePlain.length;
  const paths = new Array(n);
  const conc = radioTtsIngestConcurrency();
  for (let start = 0; start < n; start += conc) {
    const end = Math.min(n, start + conc);
    const chunk = await Promise.all(
      Array.from({ length: end - start }, (_, j) => {
        const si = start + j;
        const one = wrapTtsForSingleSentence(linePlain[si], { ttsPrepped: true });
        return (async () => {
          const audioBuf = await postTtsMp3(apiKey, one, voiceId, ttsLang);
          const audioPath = `${pathPrefix}/level_${levelNum}_s${si}.mp3`;
          const { error: upErr } = await admin.storage.from("radio-audio").upload(audioPath, audioBuf, {
            contentType: "audio/mpeg",
            upsert: true,
          });
          if (upErr) throw upErr;
          return { si, audioPath };
        })();
      })
    );
    for (const item of chunk) {
      paths[item.si] = item.audioPath;
    }
  }
  return paths;
}

/** Parse model as_of: full ISO, date-only YYYY-MM-DD (noon UTC), or YYYY-MM-DD HH:MM:SSZ-style. */
function parseStoryAsOfMs(raw) {
  const s0 = String(raw || "").trim();
  if (!s0) return NaN;
  let ms = Date.parse(s0);
  if (Number.isFinite(ms)) return ms;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s0)) {
    ms = Date.parse(`${s0}T12:00:00.000Z`);
    if (Number.isFinite(ms)) return ms;
  }
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)$/.exec(s0);
  if (m) {
    ms = Date.parse(`${m[1]}T${m[2]}Z`);
    if (Number.isFinite(ms)) return ms;
  }
  return NaN;
}

/**
 * @param {string} refUtcIso - ingest reference time (e.g. same as Current UTC time sent to the model)
 * @param {{ fromDateYmd?: string }} [ctx] - optional context (e.g. x_search from_date) to widen the lower bound
 * @returns {{ ok: true, stories: Array, rejected: Array<{ index: number, reason: string }> } | { ok: false, error: string, rejected?: Array<{ index: number, reason: string }> }}
 */
function validateStage1(obj, refUtcIso, ctx) {
  if (!obj || typeof obj !== "object") return { ok: false, error: "not an object" };
  if (!Array.isArray(obj.stories)) return { ok: false, error: "stories[] required" };
  if (obj.stories.length === 0) {
    return { ok: false, error: "stories[] is empty" };
  }
  const refMs = Date.parse(String(refUtcIso || ""));
  if (!Number.isFinite(refMs)) {
    return { ok: false, error: "validateStage1: invalid refUtcIso" };
  }
  const bufferHours = Math.max(0, Math.min(24, Number(process.env.RADIO_RECENCY_BUFFER_HOURS || 6)));
  const fallbackMinMs = refMs - (24 + bufferHours) * 60 * 60 * 1000;
  // Prefer the actual x_search lower bound (midnight UTC of from_date) with a 1h grace:
  // this keeps the validator consistent with what Grok was allowed to return.
  const xsFromYmd = ctx && typeof ctx.fromDateYmd === "string" ? ctx.fromDateYmd.trim() : "";
  const xsFromMidnightMs = xsFromYmd ? Date.parse(`${xsFromYmd}T00:00:00.000Z`) : NaN;
  const xsMinMs = Number.isFinite(xsFromMidnightMs) ? xsFromMidnightMs - 60 * 60 * 1000 : NaN;
  const minAsOfMs = Number.isFinite(xsMinMs) ? Math.min(fallbackMinMs, xsMinMs) : fallbackMinMs;
  const maxAsOfMs = refMs + 60 * 60 * 1000;
  const effectiveHours = Math.round((refMs - minAsOfMs) / (60 * 60 * 1000));

  const out = [];
  const rejected = [];
  for (let i = 0; i < obj.stories.length; i++) {
    const idx = i + 1;
    const s = obj.stories[i];
    if (!s || typeof s !== "object") {
      rejected.push({ index: idx, reason: "invalid story object" });
      continue;
    }
    const title = typeof s.title === "string" ? s.title.trim() : "";
    const english = typeof s.english_article === "string" ? s.english_article.trim() : "";
    if (!title || !english) {
      rejected.push({ index: idx, reason: "needs title and english_article" });
      continue;
    }
    const asOfRaw = typeof s.as_of === "string" ? s.as_of.trim() : "";
    const asOfMs = parseStoryAsOfMs(asOfRaw);
    if (!asOfRaw || !Number.isFinite(asOfMs)) {
      rejected.push({
        index: idx,
        reason: `needs valid as_of (ISO-8601 UTC or YYYY-MM-DD; got ${JSON.stringify(s.as_of)})`,
      });
      continue;
    }
    if (asOfMs < minAsOfMs) {
      rejected.push({
        index: idx,
        reason: `as_of ${asOfRaw} is older than allowed window (~${effectiveHours}h before ingest time; set RADIO_XSEARCH_LOOKBACK_HOURS or RADIO_RECENCY_BUFFER_HOURS to widen)`,
      });
      continue;
    }
    if (asOfMs > maxAsOfMs) {
      rejected.push({
        index: idx,
        reason: `as_of ${asOfRaw} is too far in the future relative to ingest time`,
      });
      continue;
    }
    if (english.length < 20 || english.length > 60000) {
      rejected.push({
        index: idx,
        reason: `english_article must be between 20 and 60000 characters (got ${english.length})`,
      });
      continue;
    }
    let sig = Number(s.significance);
    if (!Number.isFinite(sig)) sig = 7;
    sig = Math.max(1, Math.min(10, Math.floor(sig)));
    out.push({ title, english_article: english, significance: sig });
  }

  if (out.length === 0) {
    const detail = rejected.length
      ? ` ${rejected
          .slice(0, 10)
          .map((r) => `#${r.index}: ${r.reason}`)
          .join(" · ")}${rejected.length > 10 ? ` · …+${rejected.length - 10} more` : ""}`
      : "";
    return {
      ok: false,
      error: `No valid stories after Stage 1 validation.${detail}`,
      rejected,
    };
  }
  return { ok: true, stories: out, rejected };
}

/** Normalize spaces so token counts match UI and model (NBSP, narrow NBSP, ZWSP). */
function normalizeLineForWordTokens(line) {
  return String(line || "")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/[\u00a0\u202f]/g, " ");
}

/** Tokens per line: same rule as newsroom WordStackLine (whitespace-separated runs). */
function lineTokensForGlossValidate(line) {
  return normalizeLineForWordTokens(line).match(/[^\s]+/g) || [];
}

/**
 * If the model emitted one or more extra glosses for a line (e.g. split "$5B" into two),
 * merge adjacent glosses until the count matches. DFS over merge positions; first solution wins.
 */
/**
 * When the model emits fewer glosses than tokens, pad with empty strings so the
 * length check passes. The client renders empty glosses as a fallback lookup via
 * `hard_words` and avoids misleading surface-token glosses like "de" / "ia".
 * Returns null when the gap is too wide or inputs are malformed.
 */
function padGlossRowToTokenCount(glossRow, tokens) {
  if (!Array.isArray(glossRow) || !Array.isArray(tokens)) return null;
  if (tokens.length < 1) return null;
  const cells = glossRow.map((x) => (typeof x === "string" ? x.trim() : String(x || "").trim()));
  if (cells.length >= tokens.length) return null;
  const missing = tokens.length - cells.length;
  if (missing > 6) return null;
  const padded = cells.slice();
  for (let i = cells.length; i < tokens.length; i++) {
    padded.push("");
  }
  return padded;
}

/**
 * Fix three frequent model slip-ups that shift gloss-to-token alignment:
 *  1) Article merge — Spanish token "el"/"la"/... gets a multi-word gloss like
 *     "The software" under "El". Split to ["The", "software"] so the next
 *     Spanish token picks up the noun gloss.
 *  2) Contraction split — "del"/"al" gets its "of the" / "to the" spread over
 *     two cells (e.g. glossRow = [..., "of", "the", ...] for tokens
 *     [..., "movimientos", "del", ...]). Collapse into one cell "of the".
 *  3) Pro-drop verb split — Spanish verbs that pack subject + copula/existential
 *     into one word ("es", "son", "era", "fue", "hay", "hubo", "está", …) get
 *     glossed across two cells ["It", "is"] instead of one ["It is"], which
 *     shifts every following gloss left by one (and the final gloss is lost).
 *     Detect ["subj_pronoun", "copula"] at the right position and merge.
 *
 * These can occur in any mix; when two of them cancel in length
 * (glossRow.length === tokens.length but alignment is off), we must still
 * repair, so we ignore the length check here and run on every row.
 *
 * Walks tokens left-to-right with a separate cursor `gi` into glossRow so
 * splits/merges re-align as we go.
 */
function repairArticleContractionGlosses(glossRow, tokens) {
  if (!Array.isArray(glossRow) || !Array.isArray(tokens)) return glossRow;
  if (tokens.length < 1) return glossRow;
  const articleRe = /^(el|la|los|las|un|una)[.,;:!?)\]»]*$/i;
  const contractionRe = /^(del|al)[.,;:!?)\]»]*$/i;
  const proDropVerbRe =
    /^(es|son|era|eran|fue|fueron|hay|hubo|habrá|será|serán|sea|sean|está|están|estaba|estaban|había|habían|soy|somos|eres|fui|fuiste|fuimos)[.,;:!?)\]»]*$/i;
  const leadsWithArticle = /^(the|a|an)\b/i;
  const subjPronounRe = /^(it|they|he|she|there|we|i|you)$/i;
  const copulaRe = /^(is|are|was|were|am|be|been|being|will|has|have|had)$/i;
  let row = glossRow.slice();
  const out = [];
  let gi = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const cell = typeof row[gi] === "string" ? row[gi].trim() : "";

    // (1) Article merge: article token whose cell starts with "the"/"a"/"an"
    // followed by more words → take the article word, leave the rest as the
    // next cell to be consumed by the following token.
    if (articleRe.test(tok) && cell) {
      const parts = cell.split(/\s+/);
      if (parts.length >= 2 && leadsWithArticle.test(parts[0])) {
        out.push(parts[0]);
        row[gi] = parts.slice(1).join(" ");
        // Do NOT advance gi — next token reads the remainder we just placed.
        continue;
      }
    }

    // (2) Contraction split: contraction token where the current cell is
    // "of"/"to" and the next cell is "the" — pull both into one "of the" /
    // "to the" gloss and advance past both.
    if (contractionRe.test(tok)) {
      const cellLower = cell.toLowerCase();
      const nextCell = typeof row[gi + 1] === "string" ? row[gi + 1].trim().toLowerCase() : "";
      if ((cellLower === "of" || cellLower === "to") && nextCell === "the") {
        out.push(cellLower === "of" ? "of the" : "to the");
        gi += 2;
        continue;
      }
      // Alternate pattern: "of" was already consumed by the previous token
      // (so out.last is "of"/"to") and the current cell is "the" or empty.
      const prev = out.length > 0 ? String(out[out.length - 1] || "").trim() : "";
      if ((cellLower === "the" || cellLower === "") && /^(of|to)$/i.test(prev)) {
        out.pop();
        out.push(/^of$/i.test(prev) ? "of the" : "to the");
        gi++;
        continue;
      }
    }

    // (3) Pro-drop verb split: verb token where current cell is a subject
    // pronoun alone and the next cell is a copula/auxiliary alone — merge into
    // one multi-word gloss ("It is", "They are", "There was", …).
    if (proDropVerbRe.test(tok)) {
      const cellLower = cell.toLowerCase();
      const nextCellRaw = typeof row[gi + 1] === "string" ? row[gi + 1].trim() : "";
      const nextCellLower = nextCellRaw.toLowerCase();
      if (subjPronounRe.test(cell) && copulaRe.test(nextCellRaw)) {
        // Preserve capitalization of the first word as the model emitted it.
        out.push(`${cell} ${nextCellLower}`);
        gi += 2;
        continue;
      }
      // Mirror pattern: subject pronoun already consumed, next cell is copula
      // alone while we expected the verb gloss here.
      const prev = out.length > 0 ? String(out[out.length - 1] || "").trim() : "";
      if (subjPronounRe.test(prev) && copulaRe.test(cell)) {
        out.pop();
        out.push(`${prev} ${cellLower}`);
        gi++;
        continue;
      }
    }

    out.push(cell);
    gi++;
  }
  return out;
}

function repairGlossRowToTokenCount(glossRow, tokenCount) {
  if (!Array.isArray(glossRow) || !Number.isFinite(tokenCount) || tokenCount < 1) return null;
  const cells = glossRow.map((x) => (typeof x === "string" ? x.trim() : String(x || "").trim()));
  if (cells.some((c) => !c)) return null;
  if (cells.length < tokenCount) return null;
  if (cells.length === tokenCount) return cells.slice();
  const excess = cells.length - tokenCount;
  if (excess > 6) return null;

  function dfs(cur, mergesLeft) {
    if (mergesLeft === 0) {
      return cur.length === tokenCount ? cur.slice() : null;
    }
    if (cur.length <= mergesLeft) return null;
    for (let i = 0; i < cur.length - 1; i++) {
      const merged = `${cur[i]} ${cur[i + 1]}`.trim();
      if (!merged) continue;
      const next = [...cur.slice(0, i), merged, ...cur.slice(i + 2)];
      const r = dfs(next, mergesLeft - 1);
      if (r) return r;
    }
    return null;
  }

  return dfs(cells, excess);
}

function validateStage2Spanish(obj, activeLevels) {
  if (!obj || typeof obj !== "object") return { ok: false, error: "not an object" };
  const active =
    Array.isArray(activeLevels) && activeLevels.length > 0
      ? activeLevels
      : // Back-compat: default to the full 1..RADIO_LEVEL_MAX set.
        Array.from({ length: RADIO_LEVEL_MAX }, (_, k) => ({ level: k + 1 }));
  const expectedNums = active.map((L) => Number(L.level));
  const expectedCount = expectedNums.length;
  if (!Array.isArray(obj.levels) || obj.levels.length !== expectedCount) {
    return { ok: false, error: `levels must have ${expectedCount} entries` };
  }
  const levels = [];
  for (const i of expectedNums) {
    const L = obj.levels.find((x) => x && Number(x.level) === i);
    if (!L || typeof L.body_es !== "string" || !L.body_es.trim()) {
      return { ok: false, error: `Missing body_es for level ${i}` };
    }
    const bodyTrim = L.body_es.trim();
    const lineCount = countNonEmptyLines(bodyTrim);
    if (lineCount < RADIO_BODY_LINES_MIN || lineCount > RADIO_BODY_LINES_MAX) {
      return {
        ok: false,
        error: `body_es for level ${i} must have ${RADIO_BODY_LINES_MIN}–${RADIO_BODY_LINES_MAX} lines (one sentence per line), got ${lineCount}`,
      };
    }
    const lines = linesForTts(bodyTrim);
    const wge = L.word_glosses_en;
    if (!Array.isArray(wge) || wge.length !== lines.length) {
      return {
        ok: false,
        error: `level ${i}: word_glosses_en must be an array of ${lines.length} rows (one per line), got ${Array.isArray(wge) ? wge.length : "missing"}`,
      };
    }
    const normalizedGlossRows = [];
    for (let li = 0; li < lines.length; li++) {
      const toks = lineTokensForGlossValidate(lines[li]);
      let glossRow = wge[li];
      if (Array.isArray(glossRow)) {
        // Fix article-merge / contraction-split patterns first; these can
        // change the array length when only one of the two errors occurred.
        glossRow = repairArticleContractionGlosses(glossRow, toks);
      }
      if (Array.isArray(glossRow) && glossRow.length > toks.length) {
        const repaired = repairGlossRowToTokenCount(glossRow, toks.length);
        if (repaired) glossRow = repaired;
      } else if (Array.isArray(glossRow) && glossRow.length < toks.length) {
        const padded = padGlossRowToTokenCount(glossRow, toks);
        if (padded) glossRow = padded;
      }
      if (!Array.isArray(glossRow) || glossRow.length !== toks.length) {
        return {
          ok: false,
          error: `level ${i} line ${li + 1}: word_glosses_en[${li}] must have ${toks.length} glosses (one per token), got ${Array.isArray(wge[li]) ? wge[li].length : "invalid"}`,
          glossHint: { level: i, lineIdx: li, tokens: toks },
        };
      }
      // Empty glosses are allowed — the client falls back to hard_words / blank at render time.
      // This keeps partially-correct rows usable instead of hard-failing the whole Stage 2 pass.
      const trimmed = glossRow.map((g) =>
        typeof g === "string" ? g.trim() : ""
      );
      normalizedGlossRows.push(trimmed);
    }
    levels.push({ level: i, body_es: bodyTrim, word_glosses_en: normalizedGlossRows });
  }
  const hw = Array.isArray(obj.hard_words) ? obj.hard_words : [];
  const words = hw
    .filter((w) => w && typeof w.term === "string" && typeof w.gloss_en === "string")
    .map((w) => ({ term: w.term.trim(), gloss_en: w.gloss_en.trim() }))
    .slice(0, 20);
  const mcq = obj.bridge_mcq;
  let bridge = null;
  if (mcq && typeof mcq.question_en === "string" && Array.isArray(mcq.options) && mcq.options.length === 4) {
    let c = Number(mcq.correct);
    if (!Number.isFinite(c)) c = 0;
    c = Math.max(0, Math.min(3, Math.floor(c)));
    bridge = {
      question_en: mcq.question_en.trim(),
      options: mcq.options.map((x) => String(x)),
      correct: c,
    };
  }
  return { ok: true, levels, hard_words: words, bridge_mcq: bridge };
}

function validateStage2bPrep(obj, expectedLevels) {
  if (!obj || typeof obj !== "object") return { ok: false, error: "not an object" };
  const expectedNums = Array.isArray(expectedLevels)
    ? expectedLevels.map((L) => Number(L.level)).filter((n) => Number.isFinite(n))
    : [];
  const expectedCount = expectedNums.length;
  if (!Array.isArray(obj.levels) || obj.levels.length !== expectedCount) {
    return { ok: false, error: `tts prep: levels must have ${expectedCount} entries` };
  }
  const out = [];
  for (const i of expectedNums) {
    const L = obj.levels.find((x) => x && Number(x.level) === i);
    if (!L || typeof L.tts_es !== "string" || !L.tts_es.trim()) {
      return { ok: false, error: `Missing tts_es for level ${i}` };
    }
    const tts = L.tts_es.trim();
    const exp = expectedLevels.find((b) => b.level === i);
    if (!exp) return { ok: false, error: `internal: missing expected level ${i}` };
    const nIn = countNonEmptyLines(exp.body_es);
    const nOut = countNonEmptyLines(tts);
    if (nIn !== nOut) {
      return { ok: false, error: `tts_es line count mismatch for level ${i}: got ${nOut}, expected ${nIn}` };
    }
    out.push({ level: i, tts_es: tts });
  }
  return { ok: true, levels: out };
}

function ttsPrepDisabled() {
  const v = (process.env.RADIO_TTS_PREP_DISABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function runStage2bTtsPrep(apiKey, model, levels) {
  if (ttsPrepDisabled()) {
    return { ok: false, skipped: true, reason: "RADIO_TTS_PREP_DISABLED" };
  }
  try {
    const raw = await postChatJson(apiKey, model, STAGE2B_SYSTEM, stage2bUserPrompt(levels), {
      max_tokens: 12_000,
    });
    const v = validateStage2bPrep(raw, levels);
    if (!v.ok) return { ok: false, error: v.error };
    return { ok: true, levels: v.levels };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function fetchExistingFingerprints(admin, topicSlug, limit) {
  const { data, error } = await admin
    .from("radio_stories")
    .select("fingerprint")
    .eq("topic_slug", topicSlug)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return new Set((data || []).map((r) => r.fingerprint).filter(Boolean));
}

function dedupeStoriesAgainstDb(stories, fpSet, seenBatch) {
  const out = [];
  for (const s of stories) {
    const fp = fingerprintFromTitle(s.title);
    if (!fp || fpSet.has(fp) || seenBatch.has(fp)) continue;
    seenBatch.add(fp);
    out.push({ ...s, fingerprint: fp });
  }
  return out;
}

/** @returns {number|null} null = pruning disabled */
function resolveRetentionCap() {
  if (envTruthy("RADIO_RETENTION_DISABLED")) return null;
  const raw = (process.env.RADIO_MAX_STORIES_RETAINED_PER_TOPIC || "").trim();
  if (raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.max(1, Math.min(500, Math.floor(n)));
  }
  return 10;
}

/**
 * Keep the newest keepN stories for the topic; remove older rows (cascade levels/completions) and MP3s.
 * @returns {{ pruned: number }}
 */
async function pruneRadioStoriesBeyondCap(admin, topicSlug, keepN) {
  if (!Number.isFinite(keepN) || keepN < 1) return { pruned: 0 };

  const pageSize = 500;
  const pruneIds = [];
  let offset = keepN;

  for (;;) {
    const { data: batch, error } = await admin
      .from("radio_stories")
      .select("id")
      .eq("topic_slug", topicSlug)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!batch || batch.length === 0) break;
    for (const row of batch) pruneIds.push(row.id);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  if (pruneIds.length === 0) return { pruned: 0 };

  let paths = [];
  try {
    paths = await collectRadioAudioPathsForStories(admin, topicSlug, pruneIds);
  } catch (e) {
    console.error("radio retention collect paths", e);
    paths = [];
    for (const id of pruneIds) {
      for (let lv = RADIO_LEVEL_MIN; lv <= RADIO_LEVEL_MAX; lv++) {
        paths.push(`${topicSlug}/${id}/level_${lv}.mp3`);
      }
    }
  }
  for (let i = 0; i < paths.length; i += 100) {
    const { error: rmErr } = await admin.storage.from("radio-audio").remove(paths.slice(i, i + 100));
    if (rmErr) {
      console.error("radio retention storage remove", rmErr);
    }
  }

  for (let i = 0; i < pruneIds.length; i += 100) {
    const { error: delErr } = await admin.from("radio_stories").delete().in("id", pruneIds.slice(i, i + 100));
    if (delErr) throw delErr;
  }

  return { pruned: pruneIds.length };
}

async function postChatJson(apiKey, model, systemContent, userContent, chatOpts = {}) {
  const maxTokens = chatOpts.max_tokens ?? 4096;
  const messages = [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
  const doReq = async (withJsonObjectFormat) => {
    const body = {
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages,
    };
    if (withJsonObjectFormat) {
      body.response_format = { type: "json_object" };
    }
    const r = await fetchWithTimeout(
      "https://api.x.ai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      120_000
    );
    const raw = await r.text();
    const data = parseJsonBodyText(raw);
    return { r, raw, data };
  };

  let { r, raw, data } = await doReq(true);
  if (!r.ok) {
    const msg = String(data?.error?.message || data?.error || "");
    if (/response_format|json_object|unknown.*parameter|unsupported.*format/i.test(msg)) {
      ({ r, raw, data } = await doReq(false));
    }
  }
  if (!r.ok) {
    throw new Error(data?.error?.message || raw.slice(0, 300));
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Empty chat completion");
  }
  return tryParseJsonObject(content);
}

/**
 * @param {{ dryRun?: boolean, topicSlug?: string, replaceTopic?: boolean }} opts
 * @param {{ add: Function, steps: Array }} trace
 */
async function runRadioIngestBody(opts, trace) {
  const topicSlug = opts.topicSlug || "tech";
  const dryRun = Boolean(opts.dryRun);
  const apiKey = (process.env.XAI_API_KEY || "").trim();
  if (!apiKey) {
    trace.add("fail", { where: "env", reason: "XAI_API_KEY missing" });
    return { ok: false, error: "XAI_API_KEY missing" };
  }

  // Resolve the set of difficulty levels this ingest run should produce.
  // Admin UI passes per-ingest overrides; anything missing defaults to the
  // full set from DEFAULT_LEVELS (matches the prior hardcoded behavior).
  const activeLevels = resolveActiveLevels(opts.levelOverrides);
  if (!activeLevels.length) {
    trace.add("fail", {
      where: "level_config",
      reason: "no levels enabled",
    });
    return { ok: false, error: "At least one level must be enabled" };
  }
  trace.add("level_config", {
    activeLevels: activeLevels.map((L) => ({
      level: L.level,
      cefr: L.cefr,
      prompt: L.prompt,
    })),
    totalDefault: DEFAULT_LEVELS.length,
    promptOverrides: activeLevels
      .filter((L) => {
        const def = DEFAULT_LEVELS.find((d) => d.level === L.level);
        return def && def.defaultPrompt !== L.prompt;
      })
      .map((L) => L.level),
    stage2PromptPreview: stage2UserPrompt(
      "<story title>",
      "<english article>",
      activeLevels
    ),
  });

  const url = (process.env.SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) {
    trace.add("fail", { where: "env", reason: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" });
    return { ok: false, error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" };
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const levelMeta = {
    levelConstraintCheck: "pending",
  };
  trace.add("db_level_check", { running: true });
  try {
    const checkOut = await ensureRadioLevelCheckConstraints();
    if (checkOut.skipped) {
      const r = String(checkOut.reason || "");
      if (r.includes("already ensured")) {
        levelMeta.levelConstraintCheck = "already_applied_this_runtime";
      } else if (r.includes("No DATABASE_URL") || r.includes("No DATABASE")) {
        levelMeta.levelConstraintCheck = "skipped_no_direct_db_url";
        levelMeta.levelConstraintHint = LEVEL_CONSTRAINT_HINT_NO_DB_URL;
      } else {
        levelMeta.levelConstraintCheck = "skipped";
        if (checkOut.reason) levelMeta.levelConstraintHint = String(checkOut.reason);
      }
      trace.add("db_level_check", { skipped: true, reason: checkOut.reason });
    } else if (checkOut.ok) {
      levelMeta.levelConstraintCheck = "applied";
      trace.add("db_level_check", { ok: true });
    } else {
      levelMeta.levelConstraintCheck = "unknown";
      trace.add("db_level_check", { warn: true, checkOut });
    }
  } catch (e) {
    console.error("ensureRadioLevelCheckConstraints", e);
    trace.add("fail", {
      where: "ensureRadioLevelCheckConstraints",
      message: e.message || String(e),
    });
    return {
      ok: false,
      error: `Database level constraint update failed: ${e.message || e}. Set DATABASE_URL or SUPABASE_DATABASE_URL (Supabase → Database → URI) so ingest can fix radio_story_levels checks.`,
      ...levelMeta,
    };
  }

  function packLevel(out) {
    const meta = { ...levelMeta };
    if (out && out.ok === false) {
      const blob = `${out.error || ""} ${out.hint || ""}`.toLowerCase();
      const dbRelated =
        Boolean(out.hint) ||
        /23514|check constraint|violates check|radio_story_levels|postgres.*level|database rejected level/.test(blob);
      if (!dbRelated && meta.levelConstraintHint) {
        delete meta.levelConstraintHint;
      }
    }
    return { ...out, ...meta };
  }

  const replaceTopicOnIngest = Boolean(opts.replaceTopic);
  const storyTarget = ingestStoryTarget();
  const retentionCap = resolveRetentionCap();
  const fpFetchLimit =
    replaceTopicOnIngest || retentionCap == null ? 100 : Math.max(10, retentionCap);
  const fpSet = replaceTopicOnIngest ? new Set() : await fetchExistingFingerprints(admin, topicSlug, fpFetchLimit);
  const nowUtc = new Date().toISOString();
  const dates = xSearchDateRange();

  // Stage 1: Responses API with web_search + x_search (dated). No web-only fallback — avoids stale unbounded web results.
  // Stage 2: chat/completions only (no tools); default to a smaller model unless RADIO_SPANISH_MODEL / XAI_MODEL override.
  const modelSearch = (
    process.env.RADIO_XAI_MODEL ||
    process.env.XAI_MODEL ||
    "grok-4-1-fast-non-reasoning"
  ).trim();
  const modelSpanish = (
    process.env.RADIO_SPANISH_MODEL ||
    process.env.XAI_MODEL ||
    "grok-3-mini"
  ).trim();
  const ingestFast = envTruthy("RADIO_INGEST_FAST");
  const skipTtsRequested = opts.skipTts === true;
  const enableTts = envTruthy("RADIO_ENABLE_TTS") && !ingestFast && !skipTtsRequested;

  const userContent1 = `Current UTC time: ${nowUtc}\n\n${buildStage1UserTask(storyTarget)}`;

  const stage1Tools = [
    { type: "web_search" },
    { type: "x_search", from_date: dates.from_date, to_date: dates.to_date },
  ];

  const stage1MaxTurns = Math.max(8, Math.min(48, Number(process.env.RADIO_STAGE1_MAX_TURNS || 24)));
  const stage1MaxOutputTokens = (() => {
    const raw = Number(process.env.RADIO_STAGE1_MAX_OUTPUT_TOKENS || 16_384);
    if (!Number.isFinite(raw)) return 16_384;
    return Math.max(4096, Math.min(16_384, Math.floor(raw)));
  })();

  trace.add("config", {
    topicSlug,
    dryRun,
    replaceTopicOnIngest,
    storyTarget,
    modelSearch,
    modelSpanish,
    enableTts,
    ingestFast,
    skipTtsRequested,
    ttsIngestConcurrency: radioTtsIngestConcurrency(),
    stage2Attempts: stage2MaxAttempts(),
    stage1MaxTurns,
    stage1MaxOutputTokens,
    xSearchFrom: dates.from_date,
    xSearchTo: dates.to_date,
  });

  const body = {
    model: modelSearch,
    instructions: buildStage1Instructions(storyTarget),
    input: [{ role: "user", content: userContent1 }],
    tools: stage1Tools,
    tool_choice: "auto",
    temperature: 0.25,
    max_output_tokens: stage1MaxOutputTokens,
    max_turns: stage1MaxTurns,
  };
  trace.add("stage1_request", {
    model: modelSearch,
    maxTurns: stage1MaxTurns,
    maxOutputTokens: stage1MaxOutputTokens,
  });
  const rr = await postResponsesAndPoll(apiKey, body);
  if (!rr.ok) {
    trace.add("fail", { where: "stage1_responses", err: rr.err, status: rr.status });
    return packLevel({ ok: false, error: rr.err || String(rr.status) || "Stage1: Responses failed" });
  }
  trace.add("stage1_response", { textChars: (rr.text || "").length });
  let parsed1;
  try {
    parsed1 = tryParseJsonObject(rr.text);
  } catch (e) {
    trace.add("fail", { where: "stage1_parse_json", message: e.message });
    return packLevel({ ok: false, error: e.message || String(e) || "Stage1: no JSON from model" });
  }

  const v1 = validateStage1(parsed1, nowUtc, { fromDateYmd: dates.from_date });
  if (!v1.ok) {
    trace.add("fail", {
      where: "stage1_validate",
      error: v1.error,
      rejectedCount: v1.rejected?.length,
    });
    return packLevel({
      ok: false,
      error: `Stage1: ${v1.error}`,
      ...(v1.rejected?.length ? { stage1Rejected: v1.rejected } : {}),
    });
  }
  trace.add("stage1_ok", {
    validStories: v1.stories.length,
    rejected: v1.rejected?.length || 0,
  });
  if (v1.rejected?.length) {
    console.warn("radio stage1 rejected rows", v1.rejected.length);
  }

  const seen = new Set();
  let stories = dedupeStoriesAgainstDb(v1.stories, fpSet, seen);
  // Replace: up to storyTarget (RADIO_INGEST_STORY_TARGET). Append/cron: min(storyTarget, RADIO_MAX_STORIES_PER_RUN or storyTarget).
  const rawAppend = (process.env.RADIO_MAX_STORIES_PER_RUN || "").trim();
  const appendNum = rawAppend ? Number(rawAppend) : storyTarget;
  const appendParsed =
    Number.isFinite(appendNum) && appendNum > 0 ? Math.floor(appendNum) : storyTarget;
  const appendCap = Math.max(1, Math.min(storyTarget, appendParsed));
  const maxStories = replaceTopicOnIngest ? storyTarget : appendCap;
  stories = stories.slice(0, maxStories);

  trace.add("after_dedupe", {
    batchSize: stories.length,
    maxStories,
    replaceTopicOnIngest,
  });

  const stage1RejectedPayload = v1.rejected?.length ? { stage1Rejected: v1.rejected } : {};
  const partialReplaceNote =
    replaceTopicOnIngest && stories.length > 0 && stories.length < storyTarget
      ? `Partial replace: ${stories.length} unique stor${stories.length === 1 ? "y" : "ies"} after dedupe (target ${storyTarget}). Some Stage 1 rows may have been rejected or deduped.`
      : null;

  if (stories.length === 0) {
    trace.add("early_exit", { reason: "no_stories_after_dedupe" });
    const stage1Valid = v1.stories.length;
    const baseNote = replaceTopicOnIngest
      ? "No stories remained after in-batch dedupe (all were duplicates within this batch)."
      : "No new stories to insert: every Stage 1 headline was already in the database (same fingerprint) or was filtered out.";
    return packLevel({
      ok: true,
      inserted: 0,
      ingestStopReason: "dedupe_or_filter_empty",
      stage1ValidCount: stage1Valid,
      note:
        stage1Valid > 0
          ? `${baseNote} Stage 1 produced ${stage1Valid} valid stor${stage1Valid === 1 ? "y" : "ies"}; none were new for this topic. Try “Replace feed & ingest” if you want to wipe and reload, or wait for fresher headlines.`
          : `${baseNote} Stage 1 returned no valid stories (check stage1Rejected if present).`,
      stage1Count: stage1Valid,
      ...stage1RejectedPayload,
    });
  }

  if (dryRun) {
    let wouldDeleteStories = 0;
    if (replaceTopicOnIngest) {
      const { data: existingRows, error: cntErr } = await admin
        .from("radio_stories")
        .select("id")
        .eq("topic_slug", topicSlug);
      if (cntErr) {
        trace.add("fail", { where: "dry_run_count", message: cntErr.message });
        return packLevel({ ok: false, error: cntErr.message });
      }
      wouldDeleteStories = (existingRows || []).length;
    }
    trace.add("dry_run_done", { wouldInsert: stories.length });
    return packLevel({
      ok: true,
      dryRun: true,
      wouldInsert: stories.length,
      titles: stories.map((s) => s.title),
      enableTts,
      ingestFast,
      replaceTopicOnIngest,
      retentionCap,
      ...(partialReplaceNote ? { note: partialReplaceNote } : {}),
      ...stage1RejectedPayload,
      ...(replaceTopicOnIngest && {
        wouldDeleteStories,
        wouldDeleteStorageObjects: wouldDeleteStories * RADIO_LEVEL_MAX * 20,
      }),
    });
  }

  let deletedStoriesForReplace = 0;
  if (replaceTopicOnIngest) {
    const { data: existingRows, error: qErr } = await admin
      .from("radio_stories")
      .select("id")
      .eq("topic_slug", topicSlug);
    if (qErr) {
      trace.add("fail", { where: "replace_select_stories", message: qErr.message });
      return packLevel({ ok: false, error: qErr.message });
    }
    const ids = (existingRows || []).map((r) => r.id);
    deletedStoriesForReplace = ids.length;
    if (ids.length > 0) {
      let paths = [];
      try {
        paths = await collectRadioAudioPathsForStories(admin, topicSlug, ids);
      } catch (e) {
        console.error("radio replace collect paths", e);
        for (const id of ids) {
          for (let lv = RADIO_LEVEL_MIN; lv <= RADIO_LEVEL_MAX; lv++) {
            paths.push(`${topicSlug}/${id}/level_${lv}.mp3`);
          }
        }
      }
      for (let i = 0; i < paths.length; i += 100) {
        const { error: rmErr } = await admin.storage.from("radio-audio").remove(paths.slice(i, i + 100));
        if (rmErr) {
          console.error("radio replace storage remove", rmErr);
        }
      }
    }
    const { error: delErr } = await admin.from("radio_stories").delete().eq("topic_slug", topicSlug);
    if (delErr) {
      trace.add("fail", { where: "replace_delete_topic", message: delErr.message });
      return packLevel({ ok: false, error: delErr.message });
    }
    trace.add("replace_topic_done", { deletedStoryRows: deletedStoriesForReplace });
  }

  const ttsLang = radioTtsLanguage();
  const inserted = [];

  const stage2Attempts = stage2MaxAttempts();
  const stage2Tokens = Math.max(8192, Math.min(16384, Number(process.env.RADIO_STAGE2_MAX_TOKENS || 12288)));
  const storyConcurrency = Math.max(
    1,
    Math.min(6, Number(process.env.RADIO_STORY_CONCURRENCY || 3))
  );

  trace.add("per_story_begin", { storyConcurrency, batchSize: stories.length });

  const storyResults = new Array(stories.length);

  async function processStory(storyIdx) {
    const s = stories[storyIdx];
    trace.add("story_start", { storyIdx, title: s.title.slice(0, 120) });
    let v2;
    let lastStage2Err = "";
    let lastGlossHint = null;
    for (let attempt = 1; attempt <= stage2Attempts; attempt++) {
      let spanishRaw;
      try {
        trace.add("stage2_chat_request", { storyIdx, attempt, model: modelSpanish });
        const userPrompt =
          attempt === 1
            ? stage2UserPrompt(s.title, s.english_article, activeLevels)
            : stage2RetryUserPrompt(
                s.title,
                s.english_article,
                lastStage2Err,
                attempt,
                stage2Attempts,
                lastGlossHint,
                activeLevels
              );
        spanishRaw = await postChatJson(apiKey, modelSpanish, STAGE2_SYSTEM, userPrompt, {
          max_tokens: stage2Tokens,
        });
      } catch (e) {
        trace.add("fail", {
          where: "stage2_chat",
          storyIdx,
          title: s.title.slice(0, 80),
          attempt,
          message: e.message || String(e),
        });
        return {
          ok: false,
          err: { error: `Stage2 failed for "${s.title}": ${e.message || e}` },
          failedTitle: s.title,
        };
      }
      v2 = validateStage2Spanish(spanishRaw, activeLevels);
      trace.add("stage2_validate", {
        storyIdx,
        attempt,
        ok: v2.ok,
        error: v2.ok ? undefined : v2.error,
      });
      if (v2.ok) break;
      lastStage2Err = v2.error;
      lastGlossHint = v2.glossHint || null;
      if (attempt < stage2Attempts) {
        console.warn(
          `Radio Stage2 attempt ${attempt}/${stage2Attempts} invalid for "${s.title}": ${v2.error}; retrying`
        );
      }
    }
    if (!v2.ok) {
      trace.add("fail", {
        where: "stage2_exhausted",
        storyIdx,
        title: s.title.slice(0, 80),
        lastError: lastStage2Err,
      });
      return {
        ok: false,
        err: {
          error: `Stage2 invalid for "${s.title}" after ${stage2Attempts} attempt(s): ${lastStage2Err}`,
        },
        failedTitle: s.title,
      };
    }

    trace.add("stage2b_start", { storyIdx });
    const prep2b = ingestFast
      ? { ok: false, skipped: true, reason: "RADIO_INGEST_FAST" }
      : await runStage2bTtsPrep(apiKey, modelSpanish, v2.levels);
    trace.add("stage2b_done", {
      storyIdx,
      ok: prep2b.ok,
      skipped: prep2b.skipped,
      error: prep2b.error || prep2b.reason,
    });
    const ttsPrepByLevel = new Map();
    if (prep2b.ok && prep2b.levels) {
      for (const p of prep2b.levels) ttsPrepByLevel.set(p.level, p.tts_es);
    } else if (!prep2b.skipped) {
      console.warn(
        `Radio Stage2b TTS prep failed for "${s.title}": ${prep2b.error || prep2b.reason || "unknown"}; using sync numeral prep only`
      );
    }

    const { data: storyRow, error: insStoryErr } = await admin
      .from("radio_stories")
      .insert({
        topic_slug: topicSlug,
        fingerprint: s.fingerprint,
        title: s.title,
        language: "es",
        english_source: s.english_article,
      })
      .select("id")
      .maybeSingle();

    if (insStoryErr) {
      if (insStoryErr.code === "23505") {
        trace.add("story_skip_duplicate", { storyIdx, code: "23505", title: s.title.slice(0, 80) });
        return { ok: true, skipped: true, reason: "duplicate_fingerprint" };
      }
      trace.add("fail", {
        where: "db_insert_radio_stories",
        storyIdx,
        message: insStoryErr.message,
        code: insStoryErr.code,
      });
      return {
        ok: false,
        err: {
          error: insStoryErr.message || "radio_stories insert failed",
          hint:
            insStoryErr.code === "23514" ? LEVEL_CONSTRAINT_HINT_CHECK_FAIL : undefined,
        },
        failedTitle: s.title,
      };
    }
    const storyId = storyRow?.id;
    if (!storyId) {
      trace.add("story_skip_no_id", { storyIdx });
      return { ok: true, skipped: true, reason: "no_id_from_insert" };
    }
    trace.add("db_story_inserted", { storyIdx, storyId });

    const baseMeta = {
      hard_words: v2.hard_words,
      bridge_mcq: v2.bridge_mcq,
      english_source: s.english_article,
      significance: s.significance,
    };

    const levelRows = v2.levels.map((L) => {
      const displayBody = L.body_es;
      const levelNum = L.level;
      const prepped = ttsPrepByLevel.get(levelNum);
      const linePlain = getPlainTtsLinesFromBodies(displayBody, prepped || "", Boolean(prepped));
      return {
        story_id: storyId,
        level: levelNum,
        display_body: displayBody,
        tts_body: linePlain.join("\n"),
        audio_path: null,
        sentence_audio_paths: null,
        duration_sec: null,
        meta: {
          ...baseMeta,
          line_word_glosses_en: L.word_glosses_en,
        },
      };
    });

    for (const row of levelRows) {
      if (
        !Number.isFinite(row.level) ||
        row.level < RADIO_LEVEL_MIN ||
        row.level > RADIO_LEVEL_MAX
      ) {
        await admin.from("radio_stories").delete().eq("id", storyId);
        return {
          ok: false,
          err: {
            error: `radio_story_levels: level out of range (${row.level}), expected ${RADIO_LEVEL_MIN}–${RADIO_LEVEL_MAX}`,
          },
          failedTitle: s.title,
        };
      }
    }

    try {
      const { error: batchErr } = await admin.from("radio_story_levels").insert(levelRows);
      if (batchErr) throw batchErr;
      trace.add("db_levels_inserted", { storyIdx, storyId, rows: levelRows.length });
    } catch (e) {
      const mapped = mapRadioLevelsInsertError(e);
      trace.add("fail", {
        where: "db_insert_radio_story_levels",
        storyIdx,
        storyId,
        message: mapped.message,
        code: mapped.code,
      });
      await admin.from("radio_stories").delete().eq("id", storyId);
      return {
        ok: false,
        err: {
          error: mapped.error,
          ...(mapped.hint ? { hint: mapped.hint } : {}),
        },
        failedTitle: s.title,
      };
    }

    if (enableTts) {
      // One voice per story: every level and every sentence clip uses the same voice_id.
      const voiceId = radioTtsVoiceForIndex(storyIdx);
      trace.add("tts_batch_start", { storyIdx, storyId, voiceId });
      try {
        await Promise.all(
          v2.levels.map(async (L) => {
            const levelNum = L.level;
            const prepped = ttsPrepByLevel.get(levelNum);
            const linePlain = getPlainTtsLinesFromBodies(L.body_es, prepped || "", Boolean(prepped));
            const pathPrefix = `${topicSlug}/${storyId}`;
            const paths = await ttsUploadSentenceClipsForLevel({
              apiKey,
              admin,
              linePlain,
              voiceId,
              ttsLang,
              pathPrefix,
              levelNum,
            });
            const { error: updErr } = await admin
              .from("radio_story_levels")
              .update({
                sentence_audio_paths: paths,
                audio_path: null,
              })
              .eq("story_id", storyId)
              .eq("level", levelNum);
            if (updErr) throw updErr;
            trace.add("tts_level_done", {
              storyIdx,
              level: levelNum,
              sentenceClips: paths.length,
            });
          })
        );
        trace.add("tts_batch_done", { storyIdx, storyId });
      } catch (ttsErr) {
        // TTS failure should not orphan the inserted rows: log and fall through so the
        // story still counts as inserted (user can run Backfill TTS later).
        trace.add("fail", {
          where: "tts_batch",
          storyIdx,
          storyId,
          message: ttsErr.message || String(ttsErr),
        });
      }
    } else {
      trace.add("tts_skipped", {
        storyIdx,
        reason: ingestFast
          ? "RADIO_INGEST_FAST"
          : skipTtsRequested
          ? "skipTts flag"
          : "RADIO_ENABLE_TTS off",
      });
    }

    trace.add("story_complete", { storyIdx, storyId });
    return { ok: true, storyId };
  }

  // Concurrency-limited fan-out: multiple stories can run Stage 2 / DB / TTS in parallel.
  {
    let next = 0;
    const workers = Array.from({ length: Math.min(storyConcurrency, stories.length) }, async () => {
      while (true) {
        const mine = next++;
        if (mine >= stories.length) return;
        try {
          storyResults[mine] = await processStory(mine);
        } catch (e) {
          storyResults[mine] = {
            ok: false,
            err: { error: e.message || String(e) },
            failedTitle: stories[mine]?.title,
          };
        }
      }
    });
    await Promise.all(workers);
  }

  let firstFailure = null;
  for (let i = 0; i < storyResults.length; i++) {
    const r = storyResults[i];
    if (!r) continue;
    if (r.ok && r.storyId) inserted.push(r.storyId);
    if (!r.ok && !firstFailure) firstFailure = { storyIdx: i, ...r };
  }

  if (firstFailure && inserted.length === 0) {
    return packLevel({
      ok: false,
      ...firstFailure.err,
      failedStoryIndex: firstFailure.storyIdx,
      failedTitle: firstFailure.failedTitle,
    });
  }

  let prunedStories = 0;
  if (retentionCap != null) {
    try {
      const { pruned } = await pruneRadioStoriesBeyondCap(admin, topicSlug, retentionCap);
      prunedStories = pruned;
    } catch (e) {
      console.error("radio retention prune", e);
      trace.add("fail", { where: "retention_prune", message: e.message || String(e) });
      return packLevel({ ok: false, error: e.message || String(e) || "retention prune failed" });
    }
  }

  trace.add("ingest_success", { inserted: inserted.length, prunedStories });
  const skipAllMsg =
    inserted.length === 0 && stories.length > 0
      ? `No rows inserted: every story in this run hit a duplicate fingerprint at insert time (race or overlap). ${stories.length} stor${stories.length === 1 ? "y was" : "ies were"} processed; try again later or use replace ingest.`
      : null;
  const fastIngestNote = ingestFast
    ? "Fast ingest (RADIO_INGEST_FAST): TTS and Stage 2b were skipped. Run Backfill TTS to generate audio."
    : skipTtsRequested
    ? "Two-phase ingest: TTS deferred to backfill-tts."
    : null;
  const partialFailureNote = firstFailure
    ? `Partial ingest: inserted ${inserted.length}/${stories.length} stor${inserted.length === 1 ? "y" : "ies"}; first failure was "${firstFailure.failedTitle || "unknown"}" — ${firstFailure.err?.error || "see trace"}.`
    : null;
  const combinedSuccessNote = (() => {
    const parts = [];
    if (fastIngestNote) parts.push(fastIngestNote);
    if (partialReplaceNote) parts.push(partialReplaceNote);
    if (partialFailureNote) parts.push(partialFailureNote);
    if (skipAllMsg) parts.push(skipAllMsg);
    return parts.length ? parts.join("\n") : undefined;
  })();
  return packLevel({
    ok: true,
    inserted: inserted.length,
    storyIds: inserted,
    enableTts,
    ingestFast,
    skipTtsRequested,
    retentionCap,
    prunedStories,
    ...(combinedSuccessNote ? { note: combinedSuccessNote } : {}),
    ...(skipAllMsg ? { ingestStopReason: "all_stories_skipped_at_insert" } : {}),
    ...stage1RejectedPayload,
    ...(replaceTopicOnIngest && {
      replaceTopicOnIngest: true,
      deletedStories: deletedStoriesForReplace,
    }),
  });
}

/**
 * Generate and upload per-sentence TTS for rows missing sentence_audio_paths (legacy single-clip rows included).
 */
async function runRadioBackfillTts(opts = {}) {
  const topicSlug = opts.topicSlug || "tech";
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 40));
  const apiKey = (process.env.XAI_API_KEY || "").trim();
  if (!apiKey) {
    return { ok: false, error: "XAI_API_KEY missing" };
  }
  const url = (process.env.SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) {
    return { ok: false, error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" };
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ttsLang = radioTtsLanguage();

  const { data: storyRows, error: sErr } = await admin.from("radio_stories").select("id").eq("topic_slug", topicSlug);
  if (sErr) {
    return { ok: false, error: sErr.message };
  }
  const ids = (storyRows || []).map((r) => r.id);
  if (ids.length === 0) {
    return { ok: true, updated: 0, attempted: 0, note: "No stories for topic" };
  }

  // Load all level rows for this topic (do not cap the select — a low cap made backfill
  // look at only a slice of rows; if that slice already had paths, it falsely reported "nothing to do").
  const pageSize = 1000;
  const levels = [];
  for (let off = 0; ; off += pageSize) {
    const { data: page, error: lErr } = await admin
      .from("radio_story_levels")
      .select("story_id,level,display_body,tts_body,audio_path,sentence_audio_paths")
      .in("story_id", ids)
      .order("story_id", { ascending: true })
      .order("level", { ascending: true })
      .range(off, off + pageSize - 1);
    if (lErr) {
      return { ok: false, error: lErr.message };
    }
    const chunk = page || [];
    levels.push(...chunk);
    if (chunk.length < pageSize) break;
  }

  const needsPaths = (r) =>
    !Array.isArray(r.sentence_audio_paths) || r.sentence_audio_paths.length === 0;
  const candidates = levels.filter(needsPaths);
  const rows = candidates.slice(0, limit);
  if (rows.length === 0) {
    return {
      ok: true,
      updated: 0,
      attempted: 0,
      topicSlug,
      storiesCount: ids.length,
      levelRowsScanned: levels.length,
      levelsMissingSentenceAudio: candidates.length,
      note:
        levels.length === 0
          ? "No radio_story_levels rows for this topic (nothing to backfill)."
          : "All level rows already have per-sentence audio paths.",
    };
  }

  const { data: orderedStories, error: ordErr } = await admin
    .from("radio_stories")
    .select("id")
    .eq("topic_slug", topicSlug)
    .order("created_at", { ascending: false });
  if (ordErr) {
    return { ok: false, error: ordErr.message };
  }
  const storyVoiceIndex = new Map();
  (orderedStories || []).forEach((r, idx) => {
    storyVoiceIndex.set(r.id, idx);
  });

  let updated = 0;
  const errors = [];
  // Row-level concurrency (each row also runs up to RADIO_TTS_INGEST_CONCURRENCY parallel
  // sentence TTS calls, so keep row concurrency modest to avoid overloading xAI).
  const rowConcurrency = Math.max(
    1,
    Math.min(8, Number(process.env.RADIO_BACKFILL_ROW_CONCURRENCY || 3))
  );

  async function processBackfillRow(row) {
    try {
      const linePlain = plainLinesFromStoredTtsBody(row.display_body, row.tts_body);
      if (!linePlain.length) throw new Error("No sentences in display_body");
      const voiceIdx = storyVoiceIndex.get(row.story_id) ?? 0;
      const voiceId = radioTtsVoiceForIndex(voiceIdx);
      const pathPrefix = `${topicSlug}/${row.story_id}`;
      const paths = await ttsUploadSentenceClipsForLevel({
        apiKey,
        admin,
        linePlain,
        voiceId,
        ttsLang,
        pathPrefix,
        levelNum: row.level,
      });
      if (row.audio_path) {
        await admin.storage.from("radio-audio").remove([row.audio_path]).catch(() => {});
      }
      const { error: updErr } = await admin
        .from("radio_story_levels")
        .update({
          sentence_audio_paths: paths,
          audio_path: null,
          tts_body: linePlain.join("\n"),
        })
        .eq("story_id", row.story_id)
        .eq("level", row.level);
      if (updErr) throw updErr;
      updated++;
    } catch (e) {
      errors.push({
        storyId: row.story_id,
        level: row.level,
        error: e.message || String(e),
      });
    }
  }

  let nextIdx = 0;
  const workers = Array.from({ length: Math.min(rowConcurrency, rows.length) }, async () => {
    while (true) {
      const mine = nextIdx++;
      if (mine >= rows.length) return;
      await processBackfillRow(rows[mine]);
    }
  });
  await Promise.all(workers);

  return {
    ok: errors.length === 0,
    updated,
    attempted: rows.length,
    errors: errors.length ? errors : undefined,
  };
}

/**
 * Public entry: attaches `ingestTrace` on failures always; on success only if `debugTrace` is true (keeps cron/UI payloads small).
 * @param {{ dryRun?: boolean, topicSlug?: string, replaceTopic?: boolean, debugTrace?: boolean, skipTts?: boolean, levelOverrides?: Array<{level:number, enabled?:boolean, prompt?:string}> }} [opts]
 */
async function runRadioIngest(opts = {}) {
  const debugTrace = Boolean(opts.debugTrace);
  const trace = createIngestTrace();
  trace.add("ingest_start", {
    topicSlug: opts.topicSlug || "tech",
    dryRun: Boolean(opts.dryRun),
    replaceTopic: opts.replaceTopic === true ? true : opts.replaceTopic === false ? false : "env_default",
    skipTts: opts.skipTts === true ? true : undefined,
    levelOverridesCount: Array.isArray(opts.levelOverrides) ? opts.levelOverrides.length : 0,
  });
  try {
    const out = await runRadioIngestBody(opts, trace);
    if (!out.ok || debugTrace) {
      return { ...out, ingestTrace: trace.steps };
    }
    return { ...out };
  } catch (e) {
    trace.add("uncaught_exception", {
      message: e.message || String(e),
      name: e.name,
      stack: e.stack ? String(e.stack).split("\n").slice(0, 8).join("\n") : undefined,
    });
    return {
      ok: false,
      error: e.message || String(e),
      ingestTrace: trace.steps,
    };
  }
}

module.exports = {
  runRadioIngest,
  runRadioBackfillTts,
  fingerprintFromTitle,
  wrapSentencesSlow,
  wrapTtsForLevel,
  wrapTtsForSingleSentence,
  splitSentencesForTts,
  linesForTts,
  syncTtsPrepFromDisplay,
  buildXaiTtsRequestPreview,
  buildXaiTtsSentenceRequest,
  RADIO_LEVEL_MIN,
  RADIO_LEVEL_MAX,
};
