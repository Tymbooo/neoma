const { GoogleGenerativeAI } = require("@google/generative-ai");

function getModel() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const genAI = new GoogleGenerativeAI(key);
  const name =
    process.env.GEMINI_MODEL || "gemini-2.5-flash";
  return genAI.getGenerativeModel({
    model: name,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048,
      // Forces syntactically valid JSON so multiline "reasoning" is escaped (Imposter bots).
      responseMimeType: "application/json",
    },
  });
}

function stripJson(text) {
  let t = String(text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return t;
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

  // Imposter bot clue: word + reasoning (reasoning may be truncated in messy output)
  const wordMatch = t.match(/"word"\s*:\s*"([A-Za-z]{2,32})"/);
  if (wordMatch) {
    const reasoningMatch = t.match(/"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return {
      word: wordMatch[1].toUpperCase(),
      reasoning: reasoningMatch ? decodeJsonStringSlice(reasoningMatch[1]) : "",
    };
  }

  // Imposter vote
  const voteMatch = t.match(/"vote"\s*:\s*([0-3])\b/);
  if (voteMatch) {
    const reasoningMatch = t.match(/"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return {
      vote: parseInt(voteMatch[1], 10),
      reasoning: reasoningMatch ? decodeJsonStringSlice(reasoningMatch[1]) : "",
    };
  }

  return null;
}

async function generateJsonPrompt(prompt) {
  const model = getModel();
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

  const raw = stripJson(text);
  try {
    return JSON.parse(raw);
  } catch {
    const fallback = parseJsonFallback(text);
    if (fallback) return fallback;
    throw new Error("Could not parse model JSON");
  }
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
  return `You are the ${teamLabel} spymaster in Codenames (word association game).

Board (index: word). Unrevealed words have no parenthetical.
${lines.join("\n")}

Secret map (do not mention colors to the operative in natural language — output only JSON):
- BLUE card indices: ${blue.join(", ")}
- RED card indices: ${red.join(", ")}
- NEUTRAL indices: ${neutral.join(", ")}
- ASSASSIN index: ${assassin}

Your team is ${teamLabel}. Your agents still need to guess these unrevealed ${teamLabel} words: ${teamWords.filter((i) => !revealed[i]).join(", ") || "(none — pass)"}.

Rules for your clue:
- Respond with ONLY valid JSON, no markdown: {"clue":"SINGLEWORD","number":N}
- "clue" must be ONE English word in UPPERCASE, not a homonym trick spelling.
- It must NOT be identical to any word on the board (any unrevealed or revealed word), and not a substring/contained form of any board word (e.g. if board has "WATCH", do not use "WATCH" or "ATCH").
- "number" N is how many of YOUR team's words relate to the clue (minimum 1 if any words left for your team).
- If your team has no remaining words, use {"clue":"PASS","number":0}

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
  const maxGuesses = clueNumber <= 0 ? 0 : clueNumber + 1;

  return `You are the RED operative in Codenames.

Board:
${lines.join("\n")}

Your spymaster clue is: "${clueWord}" ${clueNumber}.
You may choose up to ${maxGuesses} total guesses this turn (Codenames rule: number + 1 guesses maximum).

Your goal is to pick indices of words that are likely RED team words. You do NOT know which are red; infer from the clue.

Respond ONLY with JSON: {"guesses":[i1,i2,...]} where each i is 0-24, only UNREVEALED positions (not listed as revealed), no duplicates, at most ${maxGuesses} indices. You may guess fewer if unsure. Order is your guess order.

Output JSON only.`;
}

module.exports = {
  generateJsonPrompt,
  buildSpymasterPrompt,
  buildOperativePrompt,
};
