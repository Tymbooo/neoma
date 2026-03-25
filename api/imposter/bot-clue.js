require("../../lib/loadEnv")();
const { verifyGame, BOT_NAMES } = require("../../lib/imposterState");
const {
  buildBotCluePrompt,
  isBotClueArtifactWord,
} = require("../../lib/imposterPrompts");
const {
  generateJsonPrompt,
  SCHEMA_IMPOSTER_CLUE,
} = require("../../lib/gemini");

async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function normalizeClueWord(raw) {
  if (typeof raw !== "string") return null;
  const w = raw.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (w.length < 2 || w.length > 32) return null;
  return w;
}

function clueViolatesRules(wordUpper, secretLower) {
  const w = wordUpper.toLowerCase();
  const s = secretLower.toLowerCase();
  if (w === s) return "matches the secret word";
  if (w.includes(s) || s.includes(w)) return "forbidden overlap with the secret word";
  return null;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = await readBody(req);
    const { token, clues = [] } = body;

    const game = verifyGame(token);
    if (!game) {
      res.status(400).json({ error: "Invalid or expired game token" });
      return;
    }

    const { word: secretWord, imposterSeat, order } = game;

    if (!Array.isArray(clues)) {
      res.status(400).json({ error: "clues must be an array" });
      return;
    }

    for (let i = 0; i < clues.length; i++) {
      const c = clues[i];
      if (!c || typeof c.seat !== "number" || c.seat !== order[i % 4]) {
        res.status(400).json({ error: "Clue sequence does not match turn order" });
        return;
      }
      const r = i < 4 ? 1 : 2;
      if (c.round !== r) {
        res.status(400).json({ error: "Invalid round on clue record" });
        return;
      }
    }

    const expectedIdx = clues.length;
    if (expectedIdx >= 8) {
      res.status(400).json({ error: "All clue rounds are complete" });
      return;
    }

    const nextSeat = order[expectedIdx % 4];
    const round = expectedIdx < 4 ? 1 : 2;

    if (nextSeat === 0) {
      res.status(400).json({ error: "It is the human player's turn", nextSeat: 0, round });
      return;
    }

    let prompt = buildBotCluePrompt({
      secretWord,
      imposterSeat,
      order,
      botSeat: nextSeat,
      round,
      clues,
    });

    let parsed = await generateJsonPrompt(prompt, SCHEMA_IMPOSTER_CLUE);
    let word = normalizeClueWord(typeof parsed.word === "string" ? parsed.word : String(parsed.word || ""));
    const innocent = nextSeat !== imposterSeat;

    if (isBotClueArtifactWord(word)) {
      prompt +=
        "\n\nIMPORTANT: Your \"word\" was rejected (template or placeholder, not a real clue). Reply with JSON only using a genuine single English clue word, uppercase A–Z only — not YOURWORD, PLACEHOLDER, or EXAMPLE.";
      parsed = await generateJsonPrompt(prompt, SCHEMA_IMPOSTER_CLUE);
      word = normalizeClueWord(typeof parsed.word === "string" ? parsed.word : String(parsed.word || ""));
    }

    if (innocent && word) {
      const bad = clueViolatesRules(word, secretWord);
      if (bad) {
        prompt += `\n\nIMPORTANT: Your previous answer was rejected (${bad}). Reply again with JSON only, with a different single word that obeys all rules.`;
        parsed = await generateJsonPrompt(prompt, SCHEMA_IMPOSTER_CLUE);
        word = normalizeClueWord(typeof parsed.word === "string" ? parsed.word : String(parsed.word || ""));
      }
    }

    if (!word || isBotClueArtifactWord(word)) {
      res.status(502).json({
        error: "Model returned an invalid clue word",
        reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      });
      return;
    }

    if (innocent && clueViolatesRules(word, secretWord)) {
      res.status(502).json({
        error: "Bot could not produce a valid innocent clue after retry",
        reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      });
      return;
    }

    res.status(200).json({
      seat: nextSeat,
      name: BOT_NAMES[nextSeat],
      round,
      word,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    });
  } catch (e) {
    res.status(502).json({ error: e.message || "Bot clue failed" });
  }
};
