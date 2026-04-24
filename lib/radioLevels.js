/**
 * Single source of truth for Radio Zumo difficulty levels.
 *
 * Each entry describes one learner level that Grok is asked to produce during
 * Stage 2 ingest. Raising the ceiling from 6 to 7+ = append one object here
 * (and mirror it in newsroom/src/radioLevels.js so the admin UI shows it).
 * The DB CHECK constraint (currently 1..6) must be widened before ingesting
 * levels > 6 — see supabase/migrations/012_radio_six_levels_check.sql.
 *
 * Keep this file in sync with newsroom/src/radioLevels.js (frontend copy).
 */

const DEFAULT_LEVELS = [
  {
    level: 1,
    cefr: "A1",
    defaultPrompt:
      "Very short, simple sentences (often 4–9 words per line). Basic vocabulary. One clear idea per line.",
  },
  {
    level: 2,
    cefr: "A2",
    defaultPrompt:
      "Short sentences (about 7–12 words per line). Simple connectors. Still very accessible.",
  },
  {
    level: 3,
    cefr: "B1",
    defaultPrompt:
      "Medium sentences (about 10–16 words per line). More connectors and detail; common vocabulary.",
  },
  {
    level: 4,
    cefr: "B2",
    defaultPrompt:
      "Fuller sentences (about 14–22 words per line). Intermediate structures; richer but still clear Spanish.",
  },
  {
    level: 5,
    cefr: "C1",
    defaultPrompt:
      "Long, naturally complex sentences (about 18–28 words per line). Advanced connectors, subordinate clauses, and register appropriate for educated native speakers; still accurate and clear.",
  },
  {
    level: 6,
    cefr: "C2",
    defaultPrompt:
      "Native-level prose (about 22–34 words per line). Idiomatic phrasing, nuanced vocabulary, and flexible syntax; no dumbing down.",
  },
];

/**
 * Build the list of levels that a given ingest run should produce.
 *
 * @param {Array<{level:number, enabled?:boolean, prompt?:string}>|null|undefined} overrides
 *   Per-ingest admin overrides (e.g. from the Niveles panel). Missing entries
 *   default to enabled with the default prompt; `enabled === false` disables.
 * @returns {Array<{level:number, cefr:string, prompt:string}>} active levels
 *   preserving the DEFAULT_LEVELS order.
 */
function resolveActiveLevels(overrides) {
  const byLevel = new Map();
  if (Array.isArray(overrides)) {
    for (const o of overrides) {
      if (!o || typeof o !== "object") continue;
      const lv = Number(o.level);
      if (!Number.isFinite(lv)) continue;
      byLevel.set(lv, o);
    }
  }
  const out = [];
  for (const L of DEFAULT_LEVELS) {
    const o = byLevel.get(L.level);
    const enabled = !o || o.enabled !== false;
    if (!enabled) continue;
    const promptRaw = o && typeof o.prompt === "string" ? o.prompt.trim() : "";
    out.push({
      level: L.level,
      cefr: L.cefr,
      prompt: promptRaw || L.defaultPrompt,
    });
  }
  return out;
}

module.exports = { DEFAULT_LEVELS, resolveActiveLevels };
