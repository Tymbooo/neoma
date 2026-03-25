require("../../lib/loadEnv")();
const { verifyGame, BOT_NAMES, signRedeemTicket } = require("../../lib/imposterState");
const { buildBotVotesBatchPrompt } = require("../../lib/imposterPrompts");
const {
  generateJsonPrompt,
  SCHEMA_IMPOSTER_VOTES_BATCH,
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

function parseVote(raw, botSeat) {
  const v = parseInt(String(raw), 10);
  if (!Number.isInteger(v) || v < 0 || v > 3) return null;
  if (v === botSeat) return null;
  return v;
}

function randomVoteNotSelf(seat) {
  const opts = [0, 1, 2, 3].filter((s) => s !== seat);
  return opts[Math.floor(Math.random() * opts.length)];
}

function tallyWinner(counts) {
  let max = -1;
  const leaders = [];
  for (let s = 0; s < 4; s++) {
    const c = counts[s] || 0;
    if (c > max) {
      max = c;
      leaders.length = 0;
      leaders.push(s);
    } else if (c === max) {
      leaders.push(s);
    }
  }
  return leaders[Math.floor(Math.random() * leaders.length)];
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = await readBody(req);
    const { token, clues = [], userVote } = body;

    const game = verifyGame(token);
    if (!game) {
      res.status(400).json({ error: "Invalid or expired game token" });
      return;
    }

    const { word: secretWord, imposterSeat, order } = game;

    const n = Array.isArray(clues) ? clues.length : 0;
    if (n !== 4 && n !== 8) {
      res.status(400).json({
        error: "Need exactly 4 clues (vote after round 1) or 8 clues (after round 2)",
      });
      return;
    }

    for (let i = 0; i < n; i++) {
      const c = clues[i];
      if (!c || typeof c.seat !== "number" || c.seat !== order[i % 4]) {
        res.status(400).json({ error: "Clue sequence does not match turn order" });
        return;
      }
      const r = i < 4 ? 1 : 2;
      if (c.round !== r || typeof c.word !== "string" || !/^[A-Z]{2,32}$/.test(c.word)) {
        res.status(400).json({ error: "Invalid clue record" });
        return;
      }
    }

    const uv = parseVote(userVote, 0);
    if (uv === null) {
      res.status(400).json({ error: "Invalid vote: choose a seat 1–3 (you cannot vote for yourself)" });
      return;
    }

    const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
    counts[uv] += 1;

    const botDetails = [];
    const batchPrompt = buildBotVotesBatchPrompt({
      secretWord,
      imposterSeat,
      clues,
    });

    try {
      const parsed = await generateJsonPrompt(batchPrompt, SCHEMA_IMPOSTER_VOTES_BATCH);
      const rows = Array.isArray(parsed.votes) ? parsed.votes : [];
      const bySeat = new Map();
      for (const row of rows) {
        const seat = typeof row.seat === "number" ? row.seat : parseInt(String(row.seat), 10);
        if (seat >= 1 && seat <= 3 && !bySeat.has(seat)) bySeat.set(seat, row);
      }
      for (const botSeat of [1, 2, 3]) {
        const row = bySeat.get(botSeat);
        let v = null;
        let reasoning = "";
        if (row) {
          v = parseVote(row.vote, botSeat);
          reasoning = typeof row.reasoning === "string" ? row.reasoning : "";
        }
        if (v === null) {
          v = randomVoteNotSelf(botSeat);
          reasoning = reasoning
            ? `${reasoning} (adjusted: invalid or missing vote)`
            : "Adjusted: invalid or missing vote";
        }
        counts[v] += 1;
        botDetails.push({ seat: botSeat, name: BOT_NAMES[botSeat], vote: v, reasoning });
      }
    } catch (e) {
      for (const botSeat of [1, 2, 3]) {
        const v = randomVoteNotSelf(botSeat);
        counts[v] += 1;
        botDetails.push({
          seat: botSeat,
          name: BOT_NAMES[botSeat],
          vote: v,
          reasoning: `Fallback vote after error: ${e.message || "model error"}`,
        });
      }
    }

    botDetails.sort((a, b) => a.seat - b.seat);

    const eliminated = tallyWinner(counts);
    const imposterCaught = eliminated === imposterSeat;

    if (imposterCaught) {
      const redeemTicket = signRedeemTicket({
        token,
        clues,
        imposterSeat,
        eliminated,
      });
      res.status(200).json({
        redemptionNeeded: true,
        redeemTicket,
        voteCounts: counts,
        userVote: uv,
        botVotes: botDetails,
        eliminated,
        eliminatedName: BOT_NAMES[eliminated],
        imposterSeat,
        imposterName: BOT_NAMES[imposterSeat],
      });
      return;
    }

    res.status(200).json({
      voteCounts: counts,
      userVote: uv,
      botVotes: botDetails,
      eliminated,
      eliminatedName: BOT_NAMES[eliminated],
      imposterSeat,
      imposterName: BOT_NAMES[imposterSeat],
      secretWord,
      innocentsWin: false,
    });
  } catch (e) {
    res.status(502).json({ error: e.message || "Vote resolution failed" });
  }
};
