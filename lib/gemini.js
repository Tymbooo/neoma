const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");

/** @type {import("@google/generative-ai").ResponseSchema} */
const SCHEMA_CODENAMES_CLUE = {
  type: SchemaType.OBJECT,
  properties: {
    clue: { type: SchemaType.STRING },
    number: { type: SchemaType.INTEGER },
    targetIndices: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.INTEGER },
    },
  },
  required: ["clue", "number", "targetIndices"],
};

/** @type {import("@google/generative-ai").ResponseSchema} */
const SCHEMA_CODENAMES_CLUE_DOMINANCE = {
  type: SchemaType.OBJECT,
  properties: {
    ok: { type: SchemaType.BOOLEAN },
  },
  required: ["ok"],
};

/** @type {import("@google/generative-ai").ResponseSchema} */
const SCHEMA_CODENAMES_GUESSES = {
  type: SchemaType.OBJECT,
  properties: {
    guesses: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.INTEGER },
    },
  },
  required: ["guesses"],
};

/** JSON schema with exact array length (helps Gemini return a full guess plan). */
function buildSchemaCodenamesGuessesExact(exactLen) {
  const n = Math.max(0, Math.min(25, Math.floor(exactLen)));
  return {
    type: SchemaType.OBJECT,
    properties: {
      guesses: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.INTEGER },
        minItems: n,
        maxItems: n,
      },
    },
    required: ["guesses"],
  };
}

/** @type {import("@google/generative-ai").ResponseSchema} */
const SCHEMA_IMPOSTER_CLUE = {
  type: SchemaType.OBJECT,
  properties: {
    word: { type: SchemaType.STRING },
    reasoning: { type: SchemaType.STRING },
  },
  required: ["word", "reasoning"],
};

/** @type {import("@google/generative-ai").ResponseSchema} */
const SCHEMA_IMPOSTER_VOTE = {
  type: SchemaType.OBJECT,
  properties: {
    vote: { type: SchemaType.INTEGER },
    reasoning: { type: SchemaType.STRING },
  },
  required: ["vote", "reasoning"],
};

/** One model call for seats 1–3 (avoids triple latency / Vercel hobby timeouts). */
/** @type {import("@google/generative-ai").ResponseSchema} */
const SCHEMA_IMPOSTER_VOTES_BATCH = {
  type: SchemaType.OBJECT,
  properties: {
    votes: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          seat: { type: SchemaType.INTEGER },
          vote: { type: SchemaType.INTEGER },
          reasoning: { type: SchemaType.STRING },
        },
        required: ["seat", "vote", "reasoning"],
      },
    },
  },
  required: ["votes"],
};

/** @type {import("@google/generative-ai").ResponseSchema} */
const SCHEMA_IMPOSTER_REDEEM = {
  type: SchemaType.OBJECT,
  properties: {
    word: { type: SchemaType.STRING },
    reasoning: { type: SchemaType.STRING },
  },
  required: ["word", "reasoning"],
};

/**
 * @param {import("@google/generative-ai").ResponseSchema} [responseSchema]
 * @param {{ temperature?: number, maxOutputTokens?: number }} [options]
 */
function getModel(responseSchema, options = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const genAI = new GoogleGenerativeAI(key);
  const name =
    process.env.GEMINI_MODEL || "gemini-2.5-flash";
  /** @type {import("@google/generative-ai").GenerationConfig} */
  const generationConfig = {
    temperature: options.temperature ?? 0.4,
    maxOutputTokens: options.maxOutputTokens ?? 2048,
    responseMimeType: "application/json",
  };
  if (responseSchema) {
    generationConfig.responseSchema = responseSchema;
  }
  return genAI.getGenerativeModel({
    model: name,
    generationConfig,
  });
}

/** Remove optional ```json fences only (do not slice `{`…`}` — that breaks strings containing `}`). */
function stripMarkdownFences(text) {
  let t = String(text || "").replace(/^\uFEFF/, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  return t;
}

/**
 * First balanced `{...}` or `[...]` slice, respecting JSON string rules (so `}` inside "reasoning" is OK).
 * @param {string} s
 */
function extractBalancedJsonSlice(s) {
  const t = String(s || "");
  const objStart = t.indexOf("{");
  const arrStart = t.indexOf("[");
  let start = -1;
  if (objStart < 0 && arrStart < 0) return null;
  if (arrStart < 0 || (objStart >= 0 && objStart < arrStart)) start = objStart;
  else start = arrStart;

  const stack = [];
  let inStr = false;
  let esc = false;

  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") {
      stack.push("}");
      continue;
    }
    if (c === "[") {
      stack.push("]");
      continue;
    }
    if (c === "}" || c === "]") {
      if (!stack.length || stack[stack.length - 1] !== c) return null;
      stack.pop();
      if (stack.length === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

/** Decode a JSON string slice captured from model output (fallback path). */
function decodeJsonStringSlice(s) {
  if (!s) return "";
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/**
 * Last-resort extraction when the model returns prose or broken JSON.
 * @param {string} text
 */
function parseJsonFallback(text) {
  const t = String(text || "");

  const clueMatch = t.match(
    /\{[^{}]*"clue"\s*:\s*"[^"]*"\s*,\s*"number"\s*:\s*\d+\s*\}/
  );
  if (clueMatch) return JSON.parse(clueMatch[0]);

  const guessMatch = t.match(/\{[^{}]*"guesses"\s*:\s*\[[^\]]*\]\s*\}/);
  if (guessMatch) return JSON.parse(guessMatch[0]);

  // Imposter bot clue (tolerate any non-quote chars inside "word")
  const wordMatch = t.match(/"word"\s*:\s*"([^"]+)"/);
  if (wordMatch) {
    const reasoningMatch = t.match(/"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return {
      word: String(wordMatch[1] || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z]/g, ""),
      reasoning: reasoningMatch ? decodeJsonStringSlice(reasoningMatch[1]) : "",
    };
  }

  // Imposter vote: number or string digit
  let voteMatch = t.match(/"vote"\s*:\s*([0-3])\b/);
  if (!voteMatch) voteMatch = t.match(/"vote"\s*:\s*"([0-3])"/);
  if (voteMatch) {
    const reasoningMatch = t.match(/"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return {
      vote: parseInt(voteMatch[1], 10),
      reasoning: reasoningMatch ? decodeJsonStringSlice(reasoningMatch[1]) : "",
    };
  }

  return null;
}

/**
 * @param {string} prompt
 * @param {import("@google/generative-ai").ResponseSchema} [responseSchema]
 * @param {{ temperature?: number, maxOutputTokens?: number }} [modelOptions]
 */
async function generateJsonPrompt(prompt, responseSchema, modelOptions) {
  const model = getModel(responseSchema, modelOptions || {});
  const result = await model.generateContent(prompt);
  const response = result.response;
  const cands = response.candidates;
  if (!cands || cands.length === 0) {
    const br = response.promptFeedback?.blockReason;
    throw new Error(
      br ? `Model blocked (${br})` : "Empty model response (no candidates)"
    );
  }
  let text;
  try {
    text = response.text();
  } catch (e) {
    throw new Error(e.message || "No text in model response");
  }
  if (!String(text).trim()) {
    throw new Error("Empty model response text");
  }

  const cleaned = stripMarkdownFences(text);
  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const slice = extractBalancedJsonSlice(cleaned);
    if (slice) {
      try {
        parsed = JSON.parse(slice);
      } catch {
        parsed = null;
      }
    }
  }
  if (parsed !== null && typeof parsed === "object") {
    return parsed;
  }
  const fallback = parseJsonFallback(text);
  if (fallback) return fallback;
  throw new Error("Could not parse model JSON");
}

/**
 * @param {'blue'|'red'} team
 * @param {string[]} words 25
 * @param {string[]} assignment
 * @param {Record<number,string>} revealed
 */
function buildSpymasterPrompt(team, words, assignment, revealed) {
  const teamWords = [];
  const red = [];
  const blue = [];
  const neutral = [];
  let assassin = -1;
  for (let i = 0; i < 25; i++) {
    const role = assignment[i];
    if (role === "blue") blue.push(i);
    else if (role === "red") red.push(i);
    else if (role === "neutral") neutral.push(i);
    else if (role === "assassin") assassin = i;
  }
  if (team === "blue") teamWords.push(...blue);
  else teamWords.push(...red);

  const lines = words.map((w, i) => {
    const st = revealed[i];
    if (st) return `${i}: ${w} (already revealed as ${st})`;
    return `${i}: ${w}`;
  });

  const teamLabel = team === "blue" ? "BLUE" : "RED";
  const oppLabel = team === "blue" ? "RED" : "BLUE";
  const unrevealedTeamIdx = teamWords.filter((i) => !revealed[i]);
  const unrevealedTeamStr = unrevealedTeamIdx.join(", ") || "(none — pass)";
  const preferLargeN =
    unrevealedTeamIdx.length >= 4
      ? `
Number preference: With at least four unrevealed ${teamLabel} words, prefer N=3 or N=4 when you can satisfy collision and dominance below; use N=1 or N=2 only when no safe larger set exists.
`
      : "";
  return `You are the ${teamLabel} spymaster in Codenames (word association game).

Board (index: word). Unrevealed words have no parenthetical.
${lines.join("\n")}

Secret map (do not mention colors to the operative in natural language — output only JSON):
- BLUE card indices: ${blue.join(", ")}
- RED card indices: ${red.join(", ")}
- NEUTRAL indices: ${neutral.join(", ")}
- ASSASSIN index: ${assassin}

Your team is ${teamLabel}. Your agents still need to guess these unrevealed ${teamLabel} words: ${unrevealedTeamStr}.${preferLargeN}
Collision discipline (critical):
- For every clue you consider: would a strong player guess any unrevealed ${oppLabel} or NEUTRAL word from it as readily as your intended ${teamLabel} words? If yes, choose a different clue.
- Avoid overly broad domain clues that invite many board hits (e.g. MUSIC can suggest CONCERT, BAND, SONG) unless those cards are ${teamLabel} or already revealed.
- Do not rely on your partner "avoiding" obvious matches to non-${teamLabel} words. Your number N must count only ${teamLabel} words you intend.

Dominance rule (min–max, vs unrevealed non-${teamLabel} only: opponent, neutral, assassin):
- Among your N targets, take the WEAKEST association to the clue (T_min). Among all unrevealed non-${teamLabel} words, take the STRONGEST association to the clue (D_max). You need T_min STRICTLY stronger than D_max for a skilled player. Unrevealed ${teamLabel} words not in targetIndices are ignored. If T_min does not clearly beat D_max, pick a different clue or targets.

Rules for your clue:
- Respond with ONLY valid JSON, no markdown: {"clue":"SINGLEWORD","number":N,"targetIndices":[i1,i2,...]}
- "targetIndices" must list exactly N distinct board indices (0–24) that are unrevealed ${teamLabel} cards and that your clue is meant to highlight (same N as "number"). For {"clue":"PASS","number":0} use "targetIndices":[].
- "clue" must be ONE English word in UPPERCASE, not a homonym trick spelling.
- It must NOT be identical to any word on the board (any unrevealed or revealed word), and not a substring/contained form of any board word (e.g. if board has "WATCH", do not use "WATCH" or "ATCH").
- "number" N is how many of YOUR team's words relate to the clue (minimum 1 if any words left for your team).
- If your team has no remaining words, use {"clue":"PASS","number":0,"targetIndices":[]}

Output JSON only.`;
}

/**
 * Second-pass check: weakest target vs strongest danger (unrevealed non-team only).
 * (Unrevealed same-team words that are not targets are ignored.)
 * @param {string[]} words
 * @param {string[]} assignment
 * @param {'blue'|'red'} team
 * @param {Record<number,string>} revealed
 * @param {string} clueUpper
 * @param {number[]} targetIndices
 * @param {string} teamLabel BLUE or RED
 */
function buildClueDominanceVerifyPrompt(
  words,
  assignment,
  team,
  revealed,
  clueUpper,
  targetIndices,
  teamLabel
) {
  const tset = new Set(targetIndices);
  const targetWords = targetIndices.map((i) => words[i]).join(", ");
  const others = [];
  for (let i = 0; i < 25; i++) {
    if (revealed[i]) continue;
    if (tset.has(i)) continue;
    if (assignment[i] === team) continue;
    others.push(words[i]);
  }
  if (others.length === 0) {
    return `Codenames clue dominance check. Output JSON only.

Clue: "${clueUpper}"
Intended ${teamLabel} words: ${targetWords}
No unrevealed opponent, neutral, or assassin cards remain. Reply {"ok":true}.`;
  }
  return `Codenames clue dominance check. Output JSON only.

Clue given to operatives: "${clueUpper}"
Intended ${teamLabel} words: ${targetWords}

Unrevealed NON-${teamLabel} words (opponent, neutral, assassin): ${others.join(", ")}

Min–max rule: Among the intended words, which has the WEAKEST link to the clue? Among the second list, which has the STRONGEST link to the clue? Reply {"ok":true} only if the weakest intended link is STILL a STRICTLY STRONGER fit for the clue than the strongest danger link. If danger ties or wins, reply {"ok":false}.

Output JSON only.`;
}

/**
 * @param {'red'} team — operative
 */
function buildOperativePrompt(team, words, revealed, clueWord, clueNumber, redIndices) {
  const lines = words.map((w, i) => {
    const st = revealed[i];
    if (st) return `${i}: ${w} (revealed)`;
    return `${i}: ${w}`;
  });

  const unrevealedRed = redIndices.filter((i) => !revealed[i]);
  const maxGuesses = clueNumber <= 0 ? 0 : clueNumber;

  return `You are the RED operative in Codenames.

Board:
${lines.join("\n")}

Your spymaster clue is: "${clueWord}" ${clueNumber}.
You may make at most ${maxGuesses} guess(es) this turn — the clue number is your maximum guesses.

Your goal is to pick indices of words that are likely RED team words. You do NOT know which are red; infer from the clue.

Respond ONLY with JSON: {"guesses":[i1,i2,...]} where each i is 0-24, only UNREVEALED positions (not listed as revealed), no duplicates, at most ${maxGuesses} indices. You may guess fewer if unsure. Order is your guess order.

Output JSON only.`;
}

/**
 * Blue operative (for human spymaster + AI operative).
 * @param {string[]} words
 * @param {Record<number,string>} revealed
 * @param {string} clueWord
 * @param {number} clueNumber
 * @param {{ requiredGuessCount?: number, correctionNote?: string }} [opts]
 */
function buildBlueOperativePrompt(words, revealed, clueWord, clueNumber, opts = {}) {
  const lines = words.map((w, i) => {
    const st = revealed[i];
    if (st) return `${i}: ${w} (revealed)`;
    return `${i}: ${w}`;
  });

  const allowance = clueNumber <= 0 ? 0 : clueNumber;
  const unrevealed = words.reduce((acc, _, i) => acc + (revealed[i] ? 0 : 1), 0);
  const requiredGuessCount =
    typeof opts.requiredGuessCount === "number"
      ? opts.requiredGuessCount
      : Math.min(allowance, unrevealed);

  const correction = opts.correctionNote
    ? `\n\n${opts.correctionNote}\n`
    : "";

  return `You are the BLUE operative in Codenames.

Board:
${lines.join("\n")}

Your spymaster clue is: "${clueWord}" ${clueNumber}.
The clue number is your maximum guesses this turn: **${allowance}** guess(es), capped by how many covered words remain on the board.

You must plan a **full ordered guess list** of exactly **${requiredGuessCount}** distinct indices (unrevealed cells only). The game will stop early if you hit a wrong color or the assassin, but you still output **${requiredGuessCount}** guesses in the order you would tap them.${correction}

Your goal is to pick indices likely to be BLUE team words. You do NOT know which are blue; infer from the clue.

Respond ONLY with JSON: {"guesses":[...]} — the array must have **exactly ${requiredGuessCount}** integers, each 0–24, only UNREVEALED positions, no duplicates. Order is your guess order.

Output JSON only.`;
}

module.exports = {
  generateJsonPrompt,
  buildSpymasterPrompt,
  buildClueDominanceVerifyPrompt,
  buildOperativePrompt,
  buildBlueOperativePrompt,
  buildSchemaCodenamesGuessesExact,
  SCHEMA_CODENAMES_CLUE,
  SCHEMA_CODENAMES_CLUE_DOMINANCE,
  SCHEMA_CODENAMES_GUESSES,
  SCHEMA_IMPOSTER_CLUE,
  SCHEMA_IMPOSTER_VOTE,
  SCHEMA_IMPOSTER_VOTES_BATCH,
  SCHEMA_IMPOSTER_REDEEM,
};
