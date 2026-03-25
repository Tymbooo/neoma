require("../../lib/loadEnv")();
const { verifyGame } = require("../../lib/imposterState");

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

function normalizeClueUpper(raw) {
  const w = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return w.length >= 2 && w.length <= 32 ? w : null;
}

function validateCluesPrefix(clues, order) {
  const n = clues.length;
  if (n > 8) return "Too many clues";
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

/**
 * Human Imposter: if their clue equals the secret word (exact, normalized), instant win.
 */
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = await readBody(req);
    const { token, word, clues = [], round2Started = false } = body;

    const game = verifyGame(token);
    if (!game) {
      res.status(400).json({ error: "Invalid or expired game token" });
      return;
    }

    if (game.imposterSeat !== 0) {
      res.status(400).json({ error: "Only the human Imposter can hit the secret-word clue" });
      return;
    }

    const clueErr = validateCluesPrefix(clues, game.order);
    if (clueErr) {
      res.status(400).json({ error: clueErr });
      return;
    }

    const idx = clues.length;
    if (idx >= 8) {
      res.status(400).json({ error: "No clue slot left" });
      return;
    }

    if (idx === 4 && !round2Started) {
      res.status(400).json({
        error: "Round 1 is complete — choose round 2 or vote before the next clue",
      });
      return;
    }

    if (game.order[idx % 4] !== 0) {
      res.status(400).json({ error: "It is not your turn to give a clue" });
      return;
    }

    const w = normalizeClueUpper(typeof word === "string" ? word : "");
    if (!w) {
      res.status(400).json({ error: "Invalid clue word" });
      return;
    }

    const secret = game.word;
    const hit = w.toLowerCase() === secret;

    res.status(200).json({
      hit,
      ...(hit ? { secretWord: secret } : {}),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
};
