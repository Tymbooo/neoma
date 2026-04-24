/**
 * Frontend copy of the Radio Zumo level defaults. Must stay in sync with
 * ../../lib/radioLevels.js. Only `level`, `cefr`, and `defaultPrompt` are
 * consumed by the admin Niveles panel; the server is the source of truth.
 */

export const DEFAULT_LEVELS = [
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
