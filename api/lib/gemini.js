const { GoogleGenerativeAI } = require("@google/generative-ai");

function getModel() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const genAI = new GoogleGenerativeAI(key);
  const name =
    process.env.GEMINI_MODEL || "gemini-1.5-flash";
  return genAI.getGenerativeModel({
    model: name,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 512,
      responseMimeType: "application/json",
    },
  });
}

function stripJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return t;
}

async function generateJsonPrompt(prompt) {
  const model = getModel();
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const raw = stripJson(text);
  return JSON.parse(raw);
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
