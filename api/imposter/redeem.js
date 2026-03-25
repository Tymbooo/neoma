require("../../lib/loadEnv")();
const {
  verifyGame,
  verifyRedeemTicket,
  BOT_NAMES,
  IMPOSTER_WORDS,
} = require("../../lib/imposterState");
const { buildRedeemGuessPrompt } = require("../../lib/imposterPrompts");
const { grokRedeemGuess } = require("../../lib/xaiRedeem");

const WORD_SET = new Set(IMPOSTER_WORDS);

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

function normalizeGuessWord(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** First token, letters only — bot freeform guess from Gemini. */
function normalizeBotRedeemWord(raw) {
  const first = String(raw || "").trim().split(/\s+/)[0] || "";
  return first.toLowerCase().replace(/[^a-z]/g, "");
}

function resolvePoolWord(normalized) {
  if (WORD_SET.has(normalized)) return normalized;
  const lower = IMPOSTER_WORDS.find(
    (w) => w.toLowerCase() === normalized
  );
  return lower || null;
}

function validateClues(clues, order) {
  const n = clues.length;
  if (n !== 4 && n !== 8) return "Need 4 or 8 clues";
  for (let i = 0; i < n; i++) {
    const c = clues[i];
    if (!c || typeof c.seat !== "number" || c.seat !== order[i % 4]) {
      return "Clue sequence does not match turn order";
    }
    const r = i < 4 ? 1 : 2;
    if (c.round !== r || typeof c.word !== "string" || !/^[A-Z]{2,32}$/.test(c.word)) {
      return "Invalid clue record";
    }
  }
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
    const { redeemTicket, token, clues = [], guess } = body;

    const game = verifyGame(token);
    if (!game) {
      res.status(400).json({ error: "Invalid or expired game token" });
      return;
    }

    const rp = verifyRedeemTicket(redeemTicket, token, clues);
    if (!rp || rp.is !== game.imposterSeat) {
      res.status(400).json({ error: "Invalid or expired redeem ticket" });
      return;
    }

    const clueErr = validateClues(clues, game.order);
    if (clueErr) {
      res.status(400).json({ error: clueErr });
      return;
    }

    const { word: secretWord, imposterSeat } = game;
    let guessNorm = null;
    let redemptionReasoning = "";

    if (imposterSeat === 0) {
      if (typeof guess !== "string" || !normalizeGuessWord(guess)) {
        res.status(400).json({ error: "Submit one word guess (letters only)" });
        return;
      }
      guessNorm = resolvePoolWord(normalizeGuessWord(guess));
      if (!guessNorm) {
        res.status(400).json({
          error: "Guess must be one of the game’s secret-word pool (single common noun)",
        });
        return;
      }
    } else {
      if (!process.env.XAI_API_KEY) {
        res.status(503).json({
          error:
            "XAI_API_KEY is not configured (required for bot Imposter redemption; set on Vercel or .env.local)",
        });
        return;
      }
      const prompt = buildRedeemGuessPrompt(clues, imposterSeat);
      let parsed = await grokRedeemGuess(prompt);
      guessNorm = normalizeBotRedeemWord(parsed.word);
      redemptionReasoning =
        typeof parsed.reasoning === "string" ? parsed.reasoning : "";
      if (!guessNorm || guessNorm.length < 2 || guessNorm.length > 32) {
        const retry = `${prompt}\n\nYour previous "word" was invalid. Reply again with JSON only: one lowercase English noun, letters only, between 2 and 32 characters.`;
        parsed = await grokRedeemGuess(retry);
        guessNorm = normalizeBotRedeemWord(parsed.word);
        redemptionReasoning =
          typeof parsed.reasoning === "string" ? parsed.reasoning : "";
      }
      if (!guessNorm || guessNorm.length < 2 || guessNorm.length > 32) {
        res.status(502).json({
          error: "Bot could not produce a valid one-word guess from clues",
          reasoning: redemptionReasoning,
        });
        return;
      }
    }

    const redemptionCorrect = guessNorm === secretWord;
    const innocentsWin = !redemptionCorrect;

    res.status(200).json({
      secretWord,
      redemptionCorrect,
      innocentsWin,
      imposterStoleWin: redemptionCorrect,
      redemptionGuess: guessNorm,
      redemptionReasoning,
      imposterSeat,
      imposterName: BOT_NAMES[imposterSeat],
    });
  } catch (e) {
    res.status(502).json({ error: e.message || "Redemption failed" });
  }
};
